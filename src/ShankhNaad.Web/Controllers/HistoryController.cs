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
    private readonly IUserService _users;
    private readonly IOrgService _org;

    public HistoryController(ICallLogService calls, PresenceTracker presence, IChatService chat, IFileStorage files, IHubContext<ChatHub> hub,
        IUserService users, IOrgService org)
    {
        _users = users;
        _org = org;
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

    // ---------- workspace admins: free up space (everyone's chat files in this workspace) ----------

    private static DateTime? OlderThan(string? age) => age switch
    {
        "30" => DateTime.UtcNow.AddDays(-30),
        "90" => DateTime.UtcNow.AddDays(-90),
        "180" => DateTime.UtcNow.AddDays(-180),
        "365" => DateTime.UtcNow.AddDays(-365),
        "all" => null,
        _ => DateTime.UtcNow.AddDays(-90)
    };

    /// <summary>Preview for "Free up space": how many of the workspace's chat files (and how much space) each choice removes.</summary>
    [HttpGet("/files/free-up"), Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> FreeUpPreview(string? age, [FromServices] ITenantService tenants)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var all = await tenants.FilesSummaryAsync(tenantId, null);
        var picked = await tenants.FilesSummaryAsync(tenantId, OlderThan(age));
        return Json(new
        {
            totalFiles = all.Files, totalBytes = all.Bytes, totalText = UserExtensions.FormatBytes(all.Bytes),
            files = picked.Files, bytes = picked.Bytes, text = UserExtensions.FormatBytes(picked.Bytes)
        });
    }

    /// <summary>
    /// Removes everyone's chat files in this workspace (all, or older than the chosen age) and gives the space back.
    /// Each chat message stays and says the file was removed. Same as the super admin's "Free up space", for one's own workspace.
    /// </summary>
    [HttpPost("/files/free-up"), Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> FreeUp(string? age, [FromServices] ITenantService tenants, [FromServices] ILogger<HistoryController> log)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var gone = await tenants.PurgeFilesAsync(tenantId, OlderThan(age));
        var failed = 0;
        foreach (var (path, _) in gone)
        {
            try { _files.Delete(path); }
            catch (Exception ex) { failed++; log.LogWarning(ex, "Could not delete file {Path} for workspace {TenantId}.", path, tenantId); }
        }
        log.LogInformation("Workspace admin {UserId} freed space in {TenantId}: {Count} files, age {Age}.", User.UserGuid(), tenantId, gone.Count, age);
        TempData[gone.Count == 0 ? "HistoryError" : "HistoryMsg"] = gone.Count == 0
            ? "No files matched, so nothing was removed."
            : $"Removed {Plural(gone.Count, "file")} and freed {UserExtensions.FormatBytes(gone.Sum(g => g.Bytes))}. The chat messages now say the file was removed."
              + (failed > 0 ? $" {failed} could not be deleted from disk; see the log." : "");
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
        var online = _presence.OnlineUsers(tenantId);
        var panel = await TeamPanelAsync(tenantId, online, share: false);
        return View(new CallsViewModel
        {
            Calls = list ?? new(),
            NeedsSql = list is null,
            Online = online,
            Team = panel.Team,
            Pinned = panel.Pinned,
            Titles = panel.Titles
        });
    }

    /// <summary>
    /// Everyone you can call, chat with or share with (online first, by name), your pins
    /// (41_PeoplePins.sql) and job titles (40_OrgStructure.sql); empty extras until those scripts are run.
    /// </summary>
    private async Task<TeamPanelVm> TeamPanelAsync(Guid tenantId, HashSet<string> online, bool share)
    {
        var me = User.UserGuid().ToString();
        var team = (await _users.ListByTenantAsync(tenantId))
            .Where(u => u.IsActive && !string.Equals(u.Id, me, StringComparison.OrdinalIgnoreCase))
            .Select(u => new PersonVm(u.Id, u.DisplayName, u.Initials, u.AvatarTone, online.Contains(u.Id)))
            .OrderByDescending(p => p.Online).ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        // each page keeps its own pins (43_PeoplePinsPerPage.sql)
        var pins = (await _org.ListPinsAsync(User.UserGuid(), share ? "files" : "calls")).Select(g => g.ToString()).ToList();
        var org = await _org.GetAsync(tenantId);
        return new TeamPanelVm
        {
            Team = team,
            Pinned = pins,
            Titles = org.People.Where(p => !string.IsNullOrWhiteSpace(p.JobTitle)).ToDictionary(p => p.Id, p => p.JobTitle!),
            Share = share
        };
    }

    /// <summary>Calls page → Team panel: pin someone to the top of your list, or unpin them. Saved for you on every device.</summary>
    [HttpPost("/calls/pin/{id:guid}")]
    public async Task<IActionResult> Pin(Guid id, bool pinned, string? scope)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var problem = await _org.SetPinAsync(tenantId, User.UserGuid(), id, pinned, scope == "files" ? "files" : "calls");
        return Json(new { ok = problem is null, error = problem });
    }

    [HttpGet("/files")]
    public async Task<IActionResult> Files()
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var list = await _calls.ListFilesForUserAsync(tenantId, User.UserGuid());
        var online = _presence.OnlineUsers(tenantId);
        return View(new FilesViewModel
        {
            Files = list ?? new(),
            NeedsSql = list is null,
            Online = online,
            TeamPanel = await TeamPanelAsync(tenantId, online, share: true)
        });
    }
}
