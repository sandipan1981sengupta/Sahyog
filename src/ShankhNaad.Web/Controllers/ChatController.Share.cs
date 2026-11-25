using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Hubs;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Files page → Team panel → Share: send files (and a short message) to one person.
/// They go into your one-to-one chat with them, so you can talk about them there and both see them in Files.
/// </summary>
public sealed partial class ChatController
{
    private const int MaxShareFiles = 10;

    [HttpPost("share/{userId:guid}")]
    [RequestSizeLimit(500L * 1024 * 1024)]
    public async Task<IActionResult> ShareWith(Guid userId, [FromForm] List<IFormFile>? files, string? message)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        if (userId == Me) return BadRequest(new { error = "Pick someone else to share with." });
        var list = (files ?? new List<IFormFile>()).Where(f => f is { Length: > 0 }).ToList();
        var text = (message ?? "").Trim();
        if (list.Count == 0 && text.Length == 0) return BadRequest(new { error = "Choose at least one file." });
        if (list.Count > MaxShareFiles) return BadRequest(new { error = $"Share up to {MaxShareFiles} files at a time." });

        var channelId = await _chat.GetOrCreateDirectAsync(tenantId, Me, userId);
        if (channelId is not Guid cid) return BadRequest(new { error = "That person isn't in your workspace." });
        await AddConnectionsToGroupAsync(cid, new[] { Me.ToString(), userId.ToString() });

        // the message first, then the files under it
        if (text.Length > 0)
        {
            var (status, posted) = await _chat.SendMessageAsync(new SendMessageRequest(tenantId, cid, Me, text.Length > 4000 ? text[..4000] : text));
            if (status == SendStatus.Ok && posted is not null)
                await _hub.Clients.Group(ChatHub.ChannelGroup(cid)).SendAsync("MessageReceived", posted);
        }
        var sent = 0;
        var problems = new List<string>();
        foreach (var file in list)
        {
            var result = await Upload(cid, file);
            if (result is JsonResult) sent++;
            else problems.Add($"{file.FileName}: {ErrorOf(result)}");
        }
        return Json(new { ok = problems.Count == 0, sent, chat = $"/chat/{cid}", problems });

        static string ErrorOf(IActionResult r) => r switch
        {
            BadRequestObjectResult { Value: not null } bad => bad.Value.GetType().GetProperty("error")?.GetValue(bad.Value) as string ?? "not sent",
            ForbidResult => "not allowed",
            _ => "not sent"
        };
    }
}
