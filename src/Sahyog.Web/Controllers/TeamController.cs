using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary;
using Sahyog.Web.Infrastructure;
using Sahyog.Web.Models;

namespace Sahyog.Web.Controllers;

/// <summary>Workspace admin: add and remove people, within the plan's user limit.</summary>
[Authorize(Roles = AppRoles.TenantAdmin), Route("team")]
public sealed class TeamController : Controller
{
    private readonly ITenantService _tenants;
    private readonly IUserService _users;
    private readonly PresenceTracker _presence;

    public TeamController(ITenantService tenants, IUserService users, PresenceTracker presence)
    {
        _tenants = tenants;
        _users = users;
        _presence = presence;
    }

    private Guid TenantId => User.TenantId()!.Value;

    [HttpGet("")]
    public async Task<IActionResult> Index() => View(await BuildAsync(new AddMemberInput()));

    [HttpPost("")]
    public async Task<IActionResult> Add([Bind(Prefix = "NewMember")] AddMemberInput input)
    {
        if (!ModelState.IsValid)
            return View(nameof(Index), await BuildAsync(input, error: "Please fix the highlighted fields."));

        var result = await _users.CreateAsync(new CreateUserRequest
        {
            TenantId = TenantId,
            DisplayName = input.DisplayName,
            Email = input.Email,
            Password = input.TemporaryPassword,
            Role = input.MakeAdmin ? AppRoles.TenantAdmin : AppRoles.Member
        });
        if (!result.Succeeded)
            return View(nameof(Index), await BuildAsync(input, error: result.Error));

        TempData["Message"] = $"{input.DisplayName} added. Share the temporary password with them privately.";
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("{id:guid}/deactivate")]
    public async Task<IActionResult> Deactivate(Guid id)
    {
        if (id == User.UserGuid()) return BadRequest();
        if (await _users.SetActiveAsync(TenantId, id, false) == SetUserActiveStatus.NotFound) return NotFound();
        TempData["Message"] = "Person removed. They are signed out and their messages stay.";
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("{id:guid}/activate")]
    public async Task<IActionResult> Activate(Guid id)
    {
        var status = await _users.SetActiveAsync(TenantId, id, true);
        if (status == SetUserActiveStatus.NotFound) return NotFound();
        if (status == SetUserActiveStatus.LimitReached) TempData["Error"] = "Your plan's user limit is reached. Remove someone or upgrade the plan.";
        else TempData["Message"] = "Person restored. They can sign in again.";
        return RedirectToAction(nameof(Index));
    }

    private async Task<TeamViewModel> BuildAsync(AddMemberInput form, string? error = null)
    {
        var limits = (await _tenants.GetLimitsAsync(TenantId))!;
        var online = _presence.OnlineUsers(TenantId);
        var all = await _users.ListByTenantAsync(TenantId);

        PersonVm ToVm(UserDto u) => new(u.Id, u.DisplayName, u.Initials, u.AvatarTone, online.Contains(u.Id),
            u.Role == AppRoles.TenantAdmin ? "Admin" : "Member");

        return new TeamViewModel
        {
            Limits = limits,
            ActiveUsers = all.Count(u => u.IsActive),
            People = all.Where(u => u.IsActive).Select(ToVm).ToList(),
            Inactive = all.Where(u => !u.IsActive).Select(ToVm).ToList(),
            NewMember = form,
            Message = TempData["Message"] as string,
            Error = error ?? TempData["Error"] as string
        };
    }
}
