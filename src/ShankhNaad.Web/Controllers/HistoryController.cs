using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using ShankhNaad.Web.Hubs;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Infrastructure;
using ShankhNaad.Web.Models;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// The Calls and Files pages on the left rail (like Microsoft Teams):
/// every call in your chats, and every file shared with you or by you.
/// </summary>
[Authorize(Roles = AppRoles.TenantAdmin + "," + AppRoles.Member)]
public sealed class HistoryController : Controller
{
    private readonly ICallLogService _calls;
    private readonly PresenceTracker _presence;
    private readonly IChatService _chat;
    private readonly IFileStorage _files;
    private readonly IHubContext<ChatHub> _hub;

    public HistoryController(ICallLogService calls, PresenceTracker presence, IChatService chat, IFileStorage files, IHubContext<ChatHub> hub)
    {
        _calls = calls;
        _presence = presence;
        _chat = chat;
        _files = files;
        _hub = hub;
    }

    private static List<Guid> ParseIds(string? ids) =>
        (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).Distinct().ToList();

    private static string Plural(int n, string one) => n == 1 ? $"1 {one}" : $"{n} {one}s";

    /// <summary>Removes calls from your call history (one, the picked ones, or all). The other person keeps theirs.</summary>
    [HttpPost("/calls/delete")]
    public async Task<IActionResult> DeleteCalls(string? ids, bool all)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var list = ParseIds(ids);
        if (!all && list.Count == 0) return Redirect("/calls");
        var n = await _calls.HideCallsAsync(tenantId, User.UserGuid(), list, all);
        TempData[n is null ? "HistoryError" : "HistoryMsg"] = n is null
            ? "Run database/24_HistoryDelete.sql (or 99_ApplyAllUpdates.sql) to delete calls."
            : $"{Plural(n.Value, "call")} removed from your call history.";
        return Redirect("/calls");
    }

    /// <summary>Removes files from your Files list (one, the picked ones, or all). They stay in the chat.</summary>
    [HttpPost("/files/delete")]
    public async Task<IActionResult> DeleteFiles(string? ids, bool all)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var list = ParseIds(ids);
        if (!all && list.Count == 0) return Redirect("/files");
        var n = await _calls.HideFilesAsync(tenantId, User.UserGuid(), list, all);
        TempData[n is null ? "HistoryError" : "HistoryMsg"] = n is null
            ? "Run database/24_HistoryDelete.sql (or 99_ApplyAllUpdates.sql) to delete files from the list."
            : $"{Plural(n.Value, "file")} removed from your list. {(n == 1 ? "It stays" : "They stay")} in the chat.";
        return Redirect("/files");
    }

    /// <summary>Deletes a file you shared for everyone: it disappears from the chat and from storage.</summary>
    [HttpPost("/files/{id:guid}/delete-everyone")]
    public async Task<IActionResult> DeleteFileForEveryone(Guid id)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var deleted = 0; var refused = false;
        foreach (var messageId in await _calls.FileMessageIdsAsync(tenantId, id))
        {
            // the normal message delete: only the sender may, and it frees the storage
            var (status, channelId, path) = await _chat.DeleteMessageAsync(tenantId, messageId, User.UserGuid(), isAdmin: false);
            if (status == 2) { refused = true; continue; }
            if (status != 0) continue;
            deleted++;
            if (path is not null) { try { _files.Delete(path); } catch { /* record is gone; a stray file is harmless */ } }
            if (channelId is Guid ch) await _hub.Clients.Group(ChatHub.ChannelGroup(ch)).SendAsync("MessageDeleted", ch, messageId);
        }
        TempData[deleted > 0 ? "HistoryMsg" : "HistoryError"] = deleted > 0
            ? "File deleted for everyone. It's gone from the chat too."
            : refused ? "You can delete for everyone only files you shared yourself." : "That file was already deleted.";
        return Redirect("/files");
    }

    [HttpGet("/calls")]
    public async Task<IActionResult> Calls()
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var list = await _calls.ListForUserAsync(tenantId, User.UserGuid());
        return View(new CallsViewModel
        {
            Calls = list ?? new(),
            NeedsSql = list is null,
            Online = _presence.OnlineUsers(tenantId)
        });
    }

    [HttpGet("/files")]
    public async Task<IActionResult> Files()
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var list = await _calls.ListFilesForUserAsync(tenantId, User.UserGuid());
        return View(new FilesViewModel
        {
            Files = list ?? new(),
            NeedsSql = list is null,
            Online = _presence.OnlineUsers(tenantId)
        });
    }
}
