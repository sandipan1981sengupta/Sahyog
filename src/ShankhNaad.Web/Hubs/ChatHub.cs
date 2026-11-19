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
    private readonly ICallLogService _calls;
    private readonly IUserService _users;
    private readonly ICallChatService _callChat;
    private readonly IReactionService _reactions;

    public ChatHub(IChatService chat, IMeetingService meetings, PresenceTracker presence, MeetingRoomTracker rooms, ICallLogService calls, IUserService users, ICallChatService callChat, IReactionService reactions)
    {
        _reactions = reactions;
        _callChat = callChat;
        _users = users;
        _calls = calls;
        _chat = chat;
        _meetings = meetings;
        _presence = presence;
        _rooms = rooms;
    }

    public static string ChannelGroup(Guid channelId) => $"ch:{channelId}";
    public static string TenantGroup(Guid tenantId) => $"t:{tenantId}";
    /// <summary>Everyone's meeting page in one call (for "Sandy left the call" notices).</summary>
    public static string MeetingGroup(Guid meetingId) => $"m:{meetingId}";

    // when each scheduled meeting last rang its participants (a quick leave + rejoin doesn't ring them twice)
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, DateTime> MeetingRungAt = new();

    private static string? CleanNote(string? note)
    {
        note = (note ?? "").Trim();
        return note.Length == 0 ? null : note.Length > 300 ? note[..300] : note;
    }

    /// <summary>A short note ("Can't talk now, I'll call you back") goes into the call's chat as a normal message.</summary>
    private async Task PostNoteAsync(Guid tenantId, Guid? channelId, Guid userId, string? note)
    {
        if (note is null || channelId is not Guid ch) return;
        var (status, message) = await _chat.SendMessageAsync(new SendMessageRequest(tenantId, ch, userId, note));
        if (status != SendStatus.Ok || message is null) return;
        if (await _chat.GetChannelAsync(tenantId, ch) is { IsDirect: false } group)
            message = message with { FromGroup = group.Name };
        await Clients.Group(ChannelGroup(ch)).SendAsync("MessageReceived", message);
    }

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
        var inMeetings = _rooms.MeetingsOf(Context.ConnectionId);
        var emptied = _rooms.LeaveAll(Context.ConnectionId);
        // closed the meeting tab: tell the others in the call
        if (userId is not null)
            foreach (var meetingId in inMeetings.Where(m => !_rooms.Contains(m, userId)))
                await Clients.Group(MeetingGroup(meetingId)).SendAsync("ParticipantLeft", meetingId, userId, Context.User?.DisplayName() ?? "Someone", null);
        // closing the call tab: a call whose room is now empty is over
        if (Context.User?.TenantId() is Guid callTenant && userId is not null)
            foreach (var meetingId in emptied)
                await CallEvent(callTenant, meetingId, Context.User.UserGuid(), 2);
        // closing the meeting tab ends "on a call"
        if (wasBusy && !_rooms.IsBusy(userId!) && Context.User?.TenantId() is Guid tid)
        {
            await Clients.Group(TenantGroup(tid)).SendAsync("BusyChanged", userId, false);
            _presence.SetCall(userId!, null);
            await BroadcastStatus(tid, userId!);
        }
        if (userId is not null && Context.User?.TenantId() is Guid tenantId && _presence.Disconnect(userId, Context.ConnectionId))
            await Clients.Group(TenantGroup(tenantId)).SendAsync("PresenceChanged", userId, false);

        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>Sends a message; replyToId (or null) makes it a reply to that message.</summary>
    public async Task<MessageDto> SendMessage(Guid channelId, string body, long? replyToId)
    {
        var (tenantId, userId) = Caller();
        body = (body ?? "").Trim();
        if (body.Length == 0) throw new HubException("Message is empty.");
        if (body.Length > 4000) throw new HubException("Message is too long (4000 characters max).");

        var (status, message) = await _chat.SendMessageAsync(new SendMessageRequest(tenantId, channelId, userId, body) { ReplyToId = replyToId });
        if (status != SendStatus.Ok || message is null) throw new HubException("You are not a member of this chat.");

        // group messages carry the group's name, so a person's chat can show "in Everyone" when it lists them
        var channel = await _chat.GetChannelAsync(tenantId, channelId);
        if (channel is { IsDirect: false } group)
            message = message with { FromGroup = group.Name };
        else
        {
            // a one-to-one chat that was just started: the other person's open tabs join it now,
            // so the first "Hi" reaches them straight away (not only after a page refresh)
            foreach (var member in await _chat.GetMembersAsync(tenantId, channelId))
                foreach (var conn in _presence.Connections(member.UserId.ToString()))
                    await Groups.AddToGroupAsync(conn, ChannelGroup(channelId));
        }
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

    // ---------- status, like Teams: Available, Busy, Do not disturb, Be right back, Away, Appear offline ----------

    private Task BroadcastStatus(Guid tenantId, string userId) =>
        Clients.Group(TenantGroup(tenantId)).SendAsync("StatusChanged", userId, _presence.Status(userId));

    /// <summary>Everyone online in this workspace who has a status (picked, away, in a call, presenting).</summary>
    public Dictionary<string, UserStatusDto> Statuses()
    {
        var (tenantId, _) = Caller();
        return _presence.Statuses(tenantId);
    }

    /// <summary>Picks a status ("available", "busy", "dnd", "brb", "away", "offline"), or "auto" to reset it.</summary>
    public async Task SetStatus(string? status)
    {
        var (tenantId, _) = Caller();
        if (!_presence.SetManual(Context.UserIdentifier!, status)) throw new HubException("Unknown status.");
        await BroadcastStatus(tenantId, Context.UserIdentifier!);
    }

    /// <summary>The browser reports no activity for a while (shown as Away unless a status is picked).</summary>
    public async Task SetIdle(bool idle)
    {
        var (tenantId, _) = Caller();
        var me = Context.UserIdentifier!;
        if (_presence.Status(me).Idle == idle) return;
        _presence.SetIdle(me, idle);
        await BroadcastStatus(tenantId, me);
    }

    /// <summary>The call page reports screen sharing (shown as Presenting).</summary>
    public async Task SetPresenting(Guid meetingId, bool on)
    {
        var (tenantId, _) = Caller();
        var me = Context.UserIdentifier!;
        if (on && !_rooms.Contains(meetingId, me)) return;
        _presence.SetPresenting(me, on);
        await BroadcastStatus(tenantId, me);
    }

    /// <summary>People in this workspace who are in a call or meeting right now (shown with a red dot).</summary>
    public HashSet<string> BusyUsers()
    {
        var (tenantId, _) = Caller();
        var online = _presence.OnlineUsers(tenantId);
        return _rooms.BusyUsers().Where(online.Contains).ToHashSet();
    }

    /// <param name="note">Optional: "Can't talk now, I'll call you back". Also posted in the chat.</param>
    public async Task DeclineCall(Guid meetingId, string? note)
    {
        var (tenantId, userId) = Caller();
        var meeting = await _meetings.GetAsync(tenantId, meetingId);
        if (meeting is null) return;
        note = CleanNote(note);
        var name = Context.User!.DisplayName();
        await PostNoteAsync(tenantId, meeting.ChannelId, userId, note);
        // the caller's other pages, and everyone already in the call (the caller's meeting page closes on a one-to-one call)
        await Clients.User(meeting.HostId.ToString()).SendAsync("CallDeclined", meetingId, name, Context.UserIdentifier, note);
        await Clients.Group(MeetingGroup(meetingId)).SendAsync("CallDeclined", meetingId, name, Context.UserIdentifier, note);
        await CallEvent(tenantId, meetingId, userId, 4);
    }

    /// <summary>
    /// "On hold" in a call (e.g. to answer another call): the others see "Sandy put the call on hold" and
    /// "On hold" next to the name, until "Sandy is back". The meeting page itself mutes mic, camera and sound.
    /// </summary>
    public async Task SetOnHold(Guid meetingId, bool on)
    {
        Caller();
        var me = Context.UserIdentifier!;
        if (!_rooms.Contains(meetingId, me)) return;
        await Clients.OthersInGroup(MeetingGroup(meetingId)).SendAsync("ParticipantOnHold", meetingId, me, Context.User!.DisplayName(), on);
    }

    /// <summary>Leave a call, optionally with a note for the others ("Have to drop, will catch up later").</summary>
    public async Task LeaveCall(Guid meetingId, string? note)
    {
        var (tenantId, userId) = Caller();
        note = CleanNote(note);
        if (note is not null && await _meetings.GetAsync(tenantId, meetingId) is { } meeting)
            await PostNoteAsync(tenantId, meeting.ChannelId, userId, note);
        await LeaveRoomAsync(tenantId, meetingId, note);
    }

    // ---------- reactions on chat messages ----------

    /// <summary>Adds my reaction to a message (or takes it back); everyone in that chat sees it at once.</summary>
    public async Task<string?> ReactToMessage(long messageId, string emoji)
    {
        var (tenantId, userId) = Caller();
        var (status, channelId, list) = await _reactions.ToggleAsync(tenantId, messageId, userId, emoji);
        if (status == 9) return "Run database/26_MessageReactions.sql (or 99_ApplyAllUpdates.sql) to react to messages.";
        if (status != 0 || channelId is not Guid ch) return "You can't react to that message.";
        await Clients.Group(ChannelGroup(ch)).SendAsync("MessageReactions", messageId, list);
        return null;
    }

    // ---------- in a call: chat and reactions ----------

    /// <summary>The chat of this call so far (null = 25_CallChat.sql not run yet).</summary>
    public async Task<List<CallChatMessageDto>?> CallChatHistory(Guid meetingId)
    {
        var (tenantId, _) = Caller();
        if (await _meetings.GetAsync(tenantId, meetingId) is null) return new();
        return await _callChat.ListAsync(tenantId, meetingId);
    }

    /// <summary>Sends a message to everyone in the call. Returns an error text, or null when sent.</summary>
    public async Task<string?> CallChatSend(Guid meetingId, string body)
    {
        var (tenantId, me) = Caller();
        body = (body ?? "").Trim();
        if (body.Length == 0) return null;
        if (body.Length > 2000) body = body[..2000];
        if (!_rooms.Contains(meetingId, me.ToString())) return "Join the call to send messages.";
        var (status, message) = await _callChat.AddAsync(tenantId, meetingId, me, Context.User!.DisplayName(), Context.User!.AvatarTone(), body);
        if (status == 9) return "Run database/25_CallChat.sql (or 99_ApplyAllUpdates.sql) to use chat in calls.";
        if (status != 0 || message is null) return "Couldn't send. Try again.";
        await Clients.Group(MeetingGroup(meetingId)).SendAsync("CallChat", message);
        return null;
    }

    /// <summary>A reaction (👍 👏 ❤️ …) everyone in the call sees float up for a moment. Nothing is saved.</summary>
    public async Task CallReact(Guid meetingId, string emoji, string id)
    {
        var (_, me) = Caller();
        var allowed = new[] { "👍", "👏", "❤️", "😂", "😮", "🎉", "🙌", "🙏" };
        if (!allowed.Contains(emoji) || !_rooms.Contains(meetingId, me.ToString())) return;
        await Clients.Group(MeetingGroup(meetingId)).SendAsync("CallReaction", meetingId, emoji, Context.User!.DisplayName(), (id ?? "").Length > 40 ? id![..40] : id);
    }

    /// <summary>"Add people" in a call: everyone in my workspace, with whether they're online, on another call or already here.</summary>
    public async Task<List<CallPersonDto>> PeopleForCall(Guid meetingId)
    {
        var (tenantId, userId) = Caller();
        if (await _meetings.GetAsync(tenantId, meetingId) is null) return new();
        var online = _presence.OnlineUsers(tenantId);
        var busy = _rooms.BusyUsers();
        return (await _users.ListByTenantAsync(tenantId))
            .Where(u => u.IsActive && u.UserId != userId)
            .Select(u => new CallPersonDto(u.UserId, u.DisplayName, u.Initials, u.AvatarTone,
                online.Contains(u.Id), busy.Contains(u.Id), _rooms.Contains(meetingId, u.Id)))
            .OrderByDescending(p => p.Online).ThenBy(p => p.Name)
            .ToList();
    }

    /// <summary>
    /// Rings team members into a call that's already going: their screen shows the ringing card and they join
    /// with Accept. Only someone who is in the call can do this. Returns who was rung and who is offline.
    /// </summary>
    public async Task<RingResultDto> RingIntoCall(Guid meetingId, List<Guid> userIds)
    {
        var (tenantId, me) = Caller();
        var meeting = await _meetings.GetAsync(tenantId, meetingId);
        if (meeting is null || !_rooms.Contains(meetingId, me.ToString())) return new RingResultDto(new(), new());
        var team = (await _users.ListByTenantAsync(tenantId)).Where(u => u.IsActive).ToDictionary(u => u.UserId);
        var online = _presence.OnlineUsers(tenantId);
        var targets = (userIds ?? new()).Distinct().Where(id => id != me && team.ContainsKey(id) && !_rooms.Contains(meetingId, id.ToString())).Take(50).ToList();
        var call = new IncomingCallDto(meetingId, meeting.Title, Context.User!.DisplayName(), Context.User!.Initials(), Context.User!.AvatarTone(),
            $"/meetings/room/{meetingId}")
        {
            CallerId = me.ToString()
        };
        var rung = targets.Where(id => online.Contains(id.ToString())).ToList();
        if (rung.Count > 0) await Clients.Users(rung.Select(id => id.ToString()).ToList()).SendAsync("IncomingCall", call);
        // tell the others in the call who is being added
        if (rung.Count > 0)
            await Clients.OthersInGroup(MeetingGroup(meetingId)).SendAsync("PeopleRung", meetingId, Context.User!.DisplayName(), rung.Select(id => team[id].DisplayName).ToList());
        return new RingResultDto(rung.Select(id => team[id].DisplayName).ToList(),
                                 targets.Where(id => !online.Contains(id.ToString())).Select(id => team[id].DisplayName).ToList());
    }

    /// <summary>Calls ringing for me right now (a page that was asleep or reconnecting asks on wake-up).</summary>
    public async Task<List<IncomingCallDto>> PendingCalls()
    {
        var (tenantId, userId) = Caller();
        var list = new List<IncomingCallDto>();
        foreach (var c in await _calls.PendingForUserAsync(tenantId, userId))
        {
            var title = c.IsDirect ? $"Call with {Context.User!.DisplayName()}" : $"{c.ChannelName} meeting";
            list.Add(new IncomingCallDto(c.MeetingId, title, c.CallerName, Names.Initials(c.CallerName), c.CallerTone, $"/meetings/room/{c.MeetingId}")
            {
                CallerId = c.CallerId.ToString()
            });
        }
        return list;
    }

    /// <summary>The ringing card timed out on this person's screen.</summary>
    public async Task CallNotAnswered(Guid meetingId)
    {
        var (tenantId, userId) = Caller();
        await CallEvent(tenantId, meetingId, userId, 3);
    }

    /// <summary>Updates the call's history and tells everyone in that chat (the call card changes; ringing stops).</summary>
    private async Task CallEvent(Guid tenantId, Guid meetingId, Guid userId, int evt)
    {
        try
        {
            var call = await _calls.EventAsync(tenantId, meetingId, userId, evt);
            // to every member of that chat (by user, so it also reaches a chat that was created just for this call)
            if (call?.ChannelId is Guid channelId)
            {
                var members = await _chat.GetMembersAsync(tenantId, channelId);
                await Clients.Users(members.Select(m => m.UserId.ToString()).ToList()).SendAsync("CallUpdated", call);
            }
        }
        catch { /* call history is best-effort */ }
    }

    /// <summary>The meeting page reports join/leave so the plan's per-meeting limit can be enforced.</summary>
    public async Task MeetingJoined(Guid meetingId)
    {
        var (tenantId, _) = Caller();
        var joined = await _meetings.GetAsync(tenantId, meetingId);
        if (joined is null) return;
        var me = Context.UserIdentifier!;
        var wasBusy = _rooms.IsBusy(me);
        var firstIn = _rooms.Count(meetingId) == 0;
        _rooms.Join(meetingId, me, Context.ConnectionId);
        await Groups.AddToGroupAsync(Context.ConnectionId, MeetingGroup(meetingId));
        if (!wasBusy) await Clients.Group(TenantGroup(tenantId)).SendAsync("BusyChanged", me, true);   // red "on a call" dot
        // "In a call" (started from a chat) or "In a meeting" (scheduled)
        _presence.SetCall(me, joined.IsInstant ? "call" : "meeting");
        await BroadcastStatus(tenantId, me);
        await CallEvent(tenantId, meetingId, Context.User!.UserGuid(), 1);   // the person called has picked up
        // the first person into a scheduled meeting starts it: ring everyone invited who isn't in it yet
        if (firstIn && !joined.IsInstant && !joined.IsAllDay)
            await RingMeetingStartedAsync(tenantId, joined);
    }

    /// <summary>
    /// A scheduled meeting has started: every participant (host and team invitees) who is online and not in it
    /// gets the ringing card ("Sandy started Weekly review · Join"). Not again within 2 minutes for the same meeting.
    /// </summary>
    private async Task RingMeetingStartedAsync(Guid tenantId, MeetingDto meeting)
    {
        var now = DateTime.UtcNow;
        if (MeetingRungAt.TryGetValue(meeting.MeetingId, out var last) && now - last < TimeSpan.FromMinutes(2)) return;
        MeetingRungAt[meeting.MeetingId] = now;
        foreach (var old in MeetingRungAt.Where(kv => now - kv.Value > TimeSpan.FromHours(1)).Select(kv => kv.Key).ToList())
            MeetingRungAt.TryRemove(old, out _);

        var me = Context.UserIdentifier!;
        var online = _presence.OnlineUsers(tenantId);
        var people = (await _meetings.GetInviteesAsync(tenantId, meeting.MeetingId))
            .Where(i => i.UserId is not null).Select(i => i.UserId!.Value.ToString())
            .Append(meeting.HostId.ToString())
            .Distinct()
            .Where(id => id != me && online.Contains(id) && !_rooms.Contains(meeting.MeetingId, id))
            .ToList();
        if (people.Count == 0) return;
        var ring = new IncomingCallDto(meeting.MeetingId, meeting.Title, Context.User!.DisplayName(), Context.User!.Initials(), Context.User!.AvatarTone(),
            $"/meetings/room/{meeting.MeetingId}")
        {
            CallerId = me,
            Kind = "meeting",
            Note = "started the meeting"
        };
        await Clients.Users(people).SendAsync("IncomingCall", ring);
    }

    public async Task MeetingLeft(Guid meetingId)
    {
        var (tenantId, _) = Caller();
        await LeaveRoomAsync(tenantId, meetingId, null);
    }

    private async Task LeaveRoomAsync(Guid tenantId, Guid meetingId, string? note)
    {
        var me = Context.UserIdentifier!;
        var wasIn = _rooms.Contains(meetingId, me);
        var emptied = _rooms.Leave(meetingId, Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, MeetingGroup(meetingId));
        // "Sandy left the call" for the others (only once, when this person has no other tab in the call)
        if (wasIn && !_rooms.Contains(meetingId, me))
            await Clients.Group(MeetingGroup(meetingId)).SendAsync("ParticipantLeft", meetingId, me, Context.User!.DisplayName(), note);
        if (emptied)
            await CallEvent(tenantId, meetingId, Context.User!.UserGuid(), 2);   // last one out: the call has ended
        if (!_rooms.IsBusy(me))
        {
            await Clients.Group(TenantGroup(tenantId)).SendAsync("BusyChanged", me, false);
            _presence.SetCall(me, null);
            await BroadcastStatus(tenantId, me);
        }
    }
}
