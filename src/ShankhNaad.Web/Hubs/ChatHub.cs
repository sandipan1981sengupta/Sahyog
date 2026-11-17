using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using ShankhNaad.Web.Infrastructure;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;

namespace ShankhNaad.Web.Hubs;

/// <summary>
/// One real-time connection per browser tab: chat messages, typing, presence, incoming calls
/// and meeting attendance. Client methods: MessageReceived, Typing, PresenceChanged,
/// ChannelCreated, IncomingCall, CallDeclined.
/// </summary>
[Authorize]
public sealed class ChatHub : Hub
{
    private readonly IChatService _chat;
    private readonly IMeetingService _meetings;
    private readonly PresenceTracker _presence;
    private readonly MeetingRoomTracker _rooms;

    public ChatHub(IChatService chat, IMeetingService meetings, PresenceTracker presence, MeetingRoomTracker rooms)
    {
        _chat = chat;
        _meetings = meetings;
        _presence = presence;
        _rooms = rooms;
    }

    public static string ChannelGroup(Guid channelId) => $"ch:{channelId}";
    public static string TenantGroup(Guid tenantId) => $"t:{tenantId}";

    private (Guid TenantId, Guid UserId) Caller()
    {
        var tenantId = Context.User?.TenantId() ?? throw new HubException("No workspace.");
        return (tenantId, Context.User!.UserGuid());
    }

    public override async Task OnConnectedAsync()
    {
        if (Context.User?.TenantId() is not Guid tenantId)
        {
            Context.Abort();
            return;
        }
        var userId = Context.User.UserGuid();

        await Groups.AddToGroupAsync(Context.ConnectionId, TenantGroup(tenantId));
        foreach (var channelId in await _chat.GetUserChannelIdsAsync(tenantId, userId))
            await Groups.AddToGroupAsync(Context.ConnectionId, ChannelGroup(channelId));

        if (_presence.Connect(tenantId, Context.UserIdentifier!, Context.ConnectionId))
            await Clients.Group(TenantGroup(tenantId)).SendAsync("PresenceChanged", Context.UserIdentifier, true);

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = Context.UserIdentifier;
        var wasBusy = userId is not null && _rooms.IsBusy(userId);
        _rooms.LeaveAll(Context.ConnectionId);
        // closing the meeting tab ends "on a call"
        if (wasBusy && !_rooms.IsBusy(userId!) && Context.User?.TenantId() is Guid tid)
            await Clients.Group(TenantGroup(tid)).SendAsync("BusyChanged", userId, false);
        if (userId is not null && Context.User?.TenantId() is Guid tenantId && _presence.Disconnect(userId, Context.ConnectionId))
            await Clients.Group(TenantGroup(tenantId)).SendAsync("PresenceChanged", userId, false);

        await base.OnDisconnectedAsync(exception);
    }

    public async Task<MessageDto> SendMessage(Guid channelId, string body)
    {
        var (tenantId, userId) = Caller();
        body = (body ?? "").Trim();
        if (body.Length == 0) throw new HubException("Message is empty.");
        if (body.Length > 4000) throw new HubException("Message is too long (4000 characters max).");

        var (status, message) = await _chat.SendMessageAsync(new SendMessageRequest(tenantId, channelId, userId, body));
        if (status != SendStatus.Ok || message is null) throw new HubException("You are not a member of this chat.");

        // group messages carry the group's name, so a person's chat can show "in Everyone" when it lists them
        if (await _chat.GetChannelAsync(tenantId, channelId) is { IsDirect: false } group)
            message = message with { FromGroup = group.Name };
        await Clients.Group(ChannelGroup(channelId)).SendAsync("MessageReceived", message);
        return message;
    }

    public async Task Typing(Guid channelId)
    {
        Caller();
        await Clients.OthersInGroup(ChannelGroup(channelId)).SendAsync("Typing", channelId, Context.User!.DisplayName());
    }

    public async Task MarkRead(Guid channelId)
    {
        var (tenantId, userId) = Caller();
        // tell everyone in the conversation, so the senders' ✓ turns into ✓✓ straight away
        if (await _chat.MarkReadAsync(tenantId, channelId, userId) is DateTime readUtc)
            await Clients.Group(ChannelGroup(channelId)).SendAsync("ChannelRead", channelId, userId.ToString(), readUtc);
    }

    /// <summary>Called after a channel or DM is created so this tab starts receiving its messages.</summary>
    public async Task WatchChannel(Guid channelId)
    {
        var (tenantId, userId) = Caller();
        if (await _chat.IsMemberAsync(tenantId, channelId, userId))
            await Groups.AddToGroupAsync(Context.ConnectionId, ChannelGroup(channelId));
    }

    public HashSet<string> OnlineUsers()
    {
        var (tenantId, _) = Caller();
        return _presence.OnlineUsers(tenantId);
    }

    /// <summary>People in this workspace who are in a call or meeting right now (shown with a red dot).</summary>
    public HashSet<string> BusyUsers()
    {
        var (tenantId, _) = Caller();
        var online = _presence.OnlineUsers(tenantId);
        return _rooms.BusyUsers().Where(online.Contains).ToHashSet();
    }

    public async Task DeclineCall(Guid meetingId)
    {
        var (tenantId, _) = Caller();
        var meeting = await _meetings.GetAsync(tenantId, meetingId);
        if (meeting is not null)
            await Clients.User(meeting.HostId.ToString()).SendAsync("CallDeclined", meetingId, Context.User!.DisplayName(), Context.UserIdentifier);
    }

    /// <summary>The meeting page reports join/leave so the plan's per-meeting limit can be enforced.</summary>
    public async Task MeetingJoined(Guid meetingId)
    {
        var (tenantId, _) = Caller();
        if (await _meetings.GetAsync(tenantId, meetingId) is null) return;
        var me = Context.UserIdentifier!;
        var wasBusy = _rooms.IsBusy(me);
        _rooms.Join(meetingId, me, Context.ConnectionId);
        if (!wasBusy) await Clients.Group(TenantGroup(tenantId)).SendAsync("BusyChanged", me, true);   // red "on a call" dot
    }

    public async Task MeetingLeft(Guid meetingId)
    {
        var (tenantId, _) = Caller();
        var me = Context.UserIdentifier!;
        _rooms.Leave(meetingId, Context.ConnectionId);
        if (!_rooms.IsBusy(me)) await Clients.Group(TenantGroup(tenantId)).SendAsync("BusyChanged", me, false);
    }
}
