using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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

    public HistoryController(ICallLogService calls, PresenceTracker presence)
    {
        _calls = calls;
        _presence = presence;
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
