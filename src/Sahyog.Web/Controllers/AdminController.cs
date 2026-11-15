using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary;
using Sahyog.Web.Models;

namespace Sahyog.Web.Controllers;

/// <summary>CloudWheel super admin: create client workspaces, change plans, pause or resume them.</summary>
[Authorize(Roles = AppRoles.SuperAdmin), Route("admin")]
public sealed class AdminController : Controller
{
    private readonly ITenantService _tenants;

    public AdminController(ITenantService tenants) => _tenants = tenants;

    [HttpGet("")]
    public async Task<IActionResult> Index() => View(await BuildAsync(new CreateTenantInput()));

    [HttpPost("tenants")]
    public async Task<IActionResult> CreateTenant([Bind(Prefix = "NewTenant")] CreateTenantInput input)
    {
        if (!ModelState.IsValid)
            return View(nameof(Index), await BuildAsync(input, error: "Please fix the highlighted fields."));

        var result = await _tenants.CreateAsync(new CreateTenantRequest
        {
            Name = input.Name,
            Slug = input.Slug,
            PlanId = input.PlanId,
            AdminName = input.AdminName,
            AdminEmail = input.AdminEmail,
            AdminPassword = input.AdminPassword
        });
        if (!result.Succeeded)
            return View(nameof(Index), await BuildAsync(input, error: result.Error));

        TempData["Message"] = $"Workspace '{input.Slug}' created. {input.AdminEmail} can now sign in.";
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("tenants/{id:guid}/plan")]
    public async Task<IActionResult> ChangePlan(Guid id, int planId)
    {
        if (!await _tenants.SetPlanAsync(id, planId)) return NotFound();
        TempData["Message"] = "Plan changed. New limits apply straight away.";
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("tenants/{id:guid}/active")]
    public async Task<IActionResult> ToggleActive(Guid id)
    {
        var tenant = await _tenants.ToggleActiveAsync(id);
        if (tenant is null) return NotFound();
        TempData["Message"] = tenant.IsActive
            ? $"{tenant.Name} is active again."
            : $"{tenant.Name} is paused. Its users are signed out and cannot sign in.";
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("plans/{id:int}")]
    public async Task<IActionResult> UpdatePlan(int id, int maxUsers, int maxMeetingParticipants, long storageQuotaMb,
        int maxVideoHeight, bool recordingEnabled, int maxMeetingMinutes, string videoProvider)
    {
        var plan = new PlanDto
        {
            PlanId = id,
            MaxUsers = Math.Clamp(maxUsers, 1, 100_000),
            MaxMeetingParticipants = Math.Clamp(maxMeetingParticipants, 2, 500),
            StorageQuotaMb = Math.Clamp(storageQuotaMb, 100, 100L * 1024 * 1024),
            MaxVideoHeight = maxVideoHeight is 360 or 540 or 720 or 1080 ? maxVideoHeight : 720,
            RecordingEnabled = recordingEnabled,
            MaxMeetingMinutes = Math.Clamp(maxMeetingMinutes, 15, 1440),
            VideoProvider = string.IsNullOrWhiteSpace(videoProvider) ? "JaaS" : videoProvider.Trim()
        };
        if (!await _tenants.UpdatePlanAsync(plan)) return NotFound();
        TempData["Message"] = "Plan updated.";
        return RedirectToAction(nameof(Index));
    }

    private async Task<AdminViewModel> BuildAsync(CreateTenantInput form, string? error = null)
    {
        var plans = await _tenants.GetPlansAsync();
        var tenants = (await _tenants.ListAsync())
            .Select(t => new TenantRowVm(t.TenantId, t.Name, t.Slug, t.PlanName, t.ActiveUsers, t.MaxUsers,
                t.StorageUsedBytes, t.StorageQuotaBytes, t.VideoProvider, t.IsActive, t.CreatedUtc))
            .ToList();

        if (form.PlanId == 0 && plans.Count > 0) form.PlanId = plans[0].PlanId;

        return new AdminViewModel
        {
            Tenants = tenants,
            Plans = plans,
            NewTenant = form,
            Message = TempData["Message"] as string,
            Error = error
        };
    }
}
