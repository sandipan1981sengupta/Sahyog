using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary;
using Sahyog.Web.Infrastructure;
using Sahyog.Web.Models;

namespace Sahyog.Web.Controllers;

/// <summary>CloudWheel super admin: create client workspaces, change plans, pause or resume them.</summary>
[Authorize(Roles = AppRoles.SuperAdmin), Route("admin")]
public sealed class AdminController : Controller
{
    private readonly ITenantService _tenants;
    private readonly IFileStorage _files;
    private readonly ILogger<AdminController> _log;

    public AdminController(ITenantService tenants, IFileStorage files, ILogger<AdminController> log)
    {
        _tenants = tenants;
        _files = files;
        _log = log;
    }

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

    /// <summary>Rename a client: company name and the workspace name people type when signing in.</summary>
    [HttpPost("tenants/{id:guid}/edit")]
    public async Task<IActionResult> EditTenant(Guid id, string name, string slug)
    {
        var result = await _tenants.UpdateAsync(id, name, slug);
        if (result.Succeeded) TempData["Message"] = $"Saved. People in this client now sign in with workspace '{slug.Trim().ToLowerInvariant()}'.";
        else TempData["Error"] = result.Error;
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Delete a paused client and all its data. The typed workspace name must match.</summary>
    [HttpPost("tenants/{id:guid}/delete")]
    public async Task<IActionResult> DeleteTenant(Guid id, string confirmSlug)
    {
        var result = await _tenants.DeleteAsync(id, confirmSlug);
        if (!result.Succeeded)
        {
            TempData["Error"] = result.Error;
            return RedirectToAction(nameof(Index));
        }
        try { _files.DeleteTenant(id); }
        catch (Exception ex) { _log.LogWarning(ex, "Client {TenantId} deleted, but its file folder could not be removed.", id); }
        TempData["Message"] = $"Client '{confirmSlug.Trim().ToLowerInvariant()}' and all its data were deleted.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>"Free up space" preview: files and size that would be removed. age = 30, 90, 180, 365 days or "all".</summary>
    [HttpGet("tenants/{id:guid}/files")]
    public async Task<IActionResult> FilesSummary(Guid id, string? age)
    {
        var all = await _tenants.FilesSummaryAsync(id, null);
        var picked = await _tenants.FilesSummaryAsync(id, OlderThan(age));
        return Json(new
        {
            totalFiles = all.Files, totalBytes = all.Bytes, totalText = UserExtensions.FormatBytes(all.Bytes),
            files = picked.Files, bytes = picked.Bytes, text = UserExtensions.FormatBytes(picked.Bytes)
        });
    }

    /// <summary>Removes the client's chat files (all, or older than the chosen age) and gives the space back.</summary>
    [HttpPost("tenants/{id:guid}/files/purge")]
    public async Task<IActionResult> PurgeFiles(Guid id, string? age)
    {
        var gone = await _tenants.PurgeFilesAsync(id, OlderThan(age));
        var failed = 0;
        foreach (var (path, _) in gone)
        {
            try { _files.Delete(path); }
            catch (Exception ex) { failed++; _log.LogWarning(ex, "Could not delete file {Path} for client {TenantId}.", path, id); }
        }
        var freed = UserExtensions.FormatBytes(gone.Sum(g => g.Bytes));
        TempData["Message"] = gone.Count == 0
            ? "No files matched, so nothing was removed."
            : $"Removed {gone.Count} file{(gone.Count == 1 ? "" : "s")} and freed {freed}. The chat messages now say the file was removed."
              + (failed > 0 ? $" {failed} file(s) could not be deleted from disk; see the log." : "");
        return RedirectToAction(nameof(Index));
    }

    private static DateTime? OlderThan(string? age) => age switch
    {
        "30" => DateTime.UtcNow.AddDays(-30),
        "90" => DateTime.UtcNow.AddDays(-90),
        "180" => DateTime.UtcNow.AddDays(-180),
        "365" => DateTime.UtcNow.AddDays(-365),
        "all" => null,
        _ => DateTime.UtcNow.AddDays(-90)
    };

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
            RecordingEnabled = Sahyog.ServiceLibrary.Video.VideoFeatures.RecordingAvailable && recordingEnabled,   // off for now, see VideoFeatures
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
            Error = error ?? TempData["Error"] as string
        };
    }
}
