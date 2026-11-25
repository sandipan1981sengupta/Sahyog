using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Hubs;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Forwarding a message to other chats (people or groups you're in).
/// The copy starts with "[[fwd:NAME]]" (who wrote the original), which the chat shows as "Forwarded from NAME".
/// A file is copied (so deleting the original message never breaks the forwarded one).
/// </summary>
public sealed partial class ChatController
{
    private const int MaxForwardTargets = 10;

    [GeneratedRegex(@"^\[\[fwd:([^\]\r\n]{1,80})\]\]\n?")]
    private static partial Regex ForwardMarker();

    [HttpPost("messages/{messageId:long}/forward")]
    public async Task<IActionResult> Forward(long messageId, Guid from, [FromForm] List<Guid>? to, string? note)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var targets = (to ?? new List<Guid>()).Where(t => t != Guid.Empty).Distinct().Take(MaxForwardTargets).ToList();
        if (targets.Count == 0) return BadRequest(new { error = "Pick at least one chat to forward to." });
        if (!await _chat.IsMemberAsync(tenantId, from, Me)) return BadRequest(new { error = "You can only forward messages from your own chats." });

        // the message itself (only if you can see it in that chat)
        var src = (await _chat.GetMessagesAsync(tenantId, from, messageId + 1, 1, Me)).FirstOrDefault(m => m.Id == messageId);
        if (src is null) return BadRequest(new { error = "That message was deleted." });
        var body = src.Body ?? "";
        if (body.StartsWith("[[call:", StringComparison.OrdinalIgnoreCase)) return BadRequest(new { error = "Call cards can't be forwarded." });

        // forwarding a forward keeps the original author
        var origin = src.SenderName;
        if (ForwardMarker().Match(body) is { Success: true } fwd) { origin = fwd.Groups[1].Value; body = body[fwd.Length..]; }
        origin = Regex.Replace(origin ?? "", @"[\]\[\r\n]", "").Trim();
        if (origin.Length == 0) origin = "someone";
        if (origin.Length > 60) origin = origin[..60];
        var marker = $"[[fwd:{origin}]]";
        if (body.Length > 4000 - marker.Length - 1) body = body[..(4000 - marker.Length - 1)];
        note = (note ?? "").Trim();
        if (note.Length > 1000) note = note[..1000];

        AttachmentFileDto? file = null;
        if (src.Attachment is { } att)
        {
            file = await _chat.GetAttachmentAsync(tenantId, att.Id, Me);
            if (file is null) return BadRequest(new { error = "That file isn't available any more." });
        }

        var sent = 0;
        var skipped = 0;
        foreach (var channelId in targets)
        {
            if (!await _chat.IsMemberAsync(tenantId, channelId, Me)) { skipped++; continue; }
            var groupName = (await _chat.GetChannelAsync(tenantId, channelId)) is { IsDirect: false } g ? g.Name : null;

            async Task<bool> SendText(string text)
            {
                var (status, message) = await _chat.SendMessageAsync(new SendMessageRequest(tenantId, channelId, Me, text));
                if (status != SendStatus.Ok || message is null) return false;
                if (groupName is not null) message = message with { FromGroup = groupName };
                await _hub.Clients.Group(ChatHub.ChannelGroup(channelId)).SendAsync("MessageReceived", message);
                return true;
            }

            if (note.Length > 0 && !await SendText(note)) { skipped++; continue; }
            // the forwarded text, or for a file the "Forwarded from" line just before it
            if (!await SendText(marker + (body.Length > 0 ? "\n" + body : ""))) { skipped++; continue; }

            if (file is not null)
            {
                var limits = (await _tenants.GetLimitsAsync(tenantId))!;
                if (limits.StorageUsedBytes + file.SizeBytes > limits.StorageQuotaBytes)
                    return BadRequest(new { error = "Storage full, so the file wasn't forwarded. Ask your admin to upgrade the plan.", sent });
                string path;
                await using (var stream = _files.OpenRead(file.StoragePath))
                    path = await _files.SaveAsync(tenantId, stream, Path.GetExtension(file.FileName), HttpContext.RequestAborted);
                var (status, message) = await _chat.SendFileAsync(new SendFileRequest(tenantId, channelId, Me, Guid.NewGuid(),
                    file.FileName, file.ContentType, file.SizeBytes, path));
                if (status != SendStatus.Ok || message is null) { _files.Delete(path); skipped++; continue; }
                if (groupName is not null) message = message with { FromGroup = groupName };
                await _hub.Clients.Group(ChatHub.ChannelGroup(channelId)).SendAsync("MessageReceived", message);
            }
            sent++;
        }

        if (sent == 0) return BadRequest(new { error = "The message wasn't forwarded. You can only forward to chats you're in." });
        return Json(new
        {
            ok = true,
            sent,
            message = $"Forwarded to {sent} chat{(sent == 1 ? "" : "s")}." + (skipped > 0 ? $" {skipped} couldn't be sent." : "")
        });
    }
}
