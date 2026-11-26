using Microsoft.AspNetCore.SignalR;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Hubs;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// Posts into chats from the server side (message a role, approvals, stand-up blockers):
/// opens the one-to-one chat if needed, joins both people's open connections to it, sends the message live.
/// </summary>
public sealed class ChatPoster
{
    private readonly IChatService _chat;
    private readonly IHubContext<ChatHub> _hub;
    private readonly PresenceTracker _presence;

    public ChatPoster(IChatService chat, IHubContext<ChatHub> hub, PresenceTracker presence)
    {
        _chat = chat;
        _hub = hub;
        _presence = presence;
    }

    /// <summary>The one-to-one chat between two people (made if it doesn't exist yet). Null when one of them isn't in the workspace.</summary>
    public async Task<Guid?> DirectAsync(Guid tenantId, Guid a, Guid b)
    {
        if (a == b) return null;
        var channelId = await _chat.GetOrCreateDirectAsync(tenantId, a, b);
        if (channelId is not Guid ch) return null;
        foreach (var user in new[] { a, b })
            foreach (var connectionId in _presence.Connections(user.ToString()))
                await _hub.Groups.AddToGroupAsync(connectionId, ChatHub.ChannelGroup(ch));
        return ch;
    }

    /// <summary>Sends a message as this person into a chat they are in; everyone in it sees it live. Null when it couldn't be sent.</summary>
    public async Task<MessageDto?> PostAsync(Guid tenantId, Guid channelId, Guid senderId, string body)
    {
        if (body.Length > 3990) body = body[..3990] + "…";
        var (status, message) = await _chat.SendMessageAsync(new SendMessageRequest(tenantId, channelId, senderId, body));
        if (status != SendStatus.Ok || message is null) return null;
        if (await _chat.GetChannelAsync(tenantId, channelId) is { IsDirect: false } group)
            message = message with { FromGroup = group.Name };
        await _hub.Clients.Group(ChatHub.ChannelGroup(channelId)).SendAsync("MessageReceived", message);
        return message;
    }

    /// <summary>Opens the one-to-one chat and sends the message from <paramref name="from"/> to <paramref name="to"/>.</summary>
    public async Task<(Guid? ChannelId, MessageDto? Message)> SendDirectAsync(Guid tenantId, Guid from, Guid to, string body)
    {
        var ch = await DirectAsync(tenantId, from, to);
        if (ch is not Guid channel) return (null, null);
        return (channel, await PostAsync(tenantId, channel, from, body));
    }
}
