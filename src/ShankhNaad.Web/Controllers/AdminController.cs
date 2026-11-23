using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Infrastructure;
using ShankhNaad.Web.Models;

namespace ShankhNaad.Web.Controllers;

/// <summary>CloudWheel super admin: create client workspaces, change plans, pause or resume them.</summary>
[Authorize(Roles = AppRoles.SuperAdmin), Route("admin")]
public sealed class AdminController : Controller
{
    private readonly ITenantService _tenants;
    private readonly IFileStorage _files;
    private readonly ILogger<AdminController> _log;
    private readonly ILocationService _location;
    private readonly IUserService _users;
    private readonly IAccountEmailService _mail;
    private readonly AppOptions _app;

    /// <summary>How long the client admin's "set your password" link works.</summary>
    private const int InviteLinkDays = 7;

    public AdminController(ITenantService tenants, IFileStorage files, ILogger<AdminController> log, ILocationService location,
        IUserService users, IAccountEmailService mail, IOptions<AppOptions> app)
    {
        _users = users;
        _mail = mail;
        _app = app.Value;
        _location = location;
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

        if (input.SendInvite && _mail.CanSend)
        {
            var problem = await EmailAdminLinkAsync(input.AdminEmail, welcome: true);
            if (problem is null)
                TempData["Message"] = $"Workspace '{input.Slug}' created. We emailed {input.AdminEmail.Trim()} a link to set their own password (it works for {InviteLinkDays} days). The temporary password also works until then.";
            else
                TempData["Error"] = $"Workspace '{input.Slug}' was created, but the invite email wasn't sent: {problem} Share the temporary password with {input.AdminEmail.Trim()} privately, or select the client and use \"Email admin link\" to try again.";
        }
        else
            TempData["Message"] = $"Workspace '{input.Slug}' created. Share the email {input.AdminEmail.Trim()} and the temporary password with the client admin privately.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>
    /// Emails a client's admins a one-time link to set their own password: a welcome link for an admin who
    /// has never signed in (7 days), otherwise a set-password link. Each new link cancels the earlier ones.
    /// </summary>
    [HttpPost("tenants/{id:guid}/invite-admin")]
    public async Task<IActionResult> InviteAdmin(Guid id)
    {
        var admins = (await _users.ListByTenantAsync(id)).Where(u => u.Role == AppRoles.TenantAdmin && u.IsActive).ToList();
        if (admins.Count == 0)
        {
            TempData["Error"] = "This client has no active admin to email.";
            return RedirectToAction(nameof(Index));
        }
        var sent = new List<string>();
        var failed = new List<string>();
        foreach (var a in admins)
        {
            var problem = await EmailAdminLinkAsync(a.Email, welcome: a.HasSignedIn != true);
            if (problem is null) sent.Add(a.Email); else failed.Add($"{a.Email} ({problem})");
        }
        if (sent.Count > 0)
            TempData["Message"] = $"We emailed a link to set a password to {string.Join(", ", sent)} (it works for {InviteLinkDays} days). Earlier links no longer work.";
        if (failed.Count > 0)
            TempData["Error"] = $"Not sent to {string.Join("; ", failed)}.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Creates a one-time link for a client admin and emails it. Returns null when it was sent, otherwise why not.</summary>
    private async Task<string?> EmailAdminLinkAsync(string email, bool welcome)
    {
        if (!_mail.CanSend) return "Email isn't set up on this server yet (Smtp settings).";
        var person = await _users.FindByEmailAsync(email);
        if (person is null) return "That admin wasn't found.";
        if (!person.IsActive) return "That admin is switched off.";

        var (token, error) = await _users.CreatePasswordLinkAsync(person.UserId,
            welcome ? PasswordLinkPurpose.Welcome : PasswordLinkPurpose.Reset, TimeSpan.FromDays(InviteLinkDays));
        if (token is null) return error ?? "The link couldn't be created.";

        var url = PasswordLinks.Url(_app, Request, token);
        var ok = welcome
            ? await _mail.SendWelcomeAsync(person.Email, person.DisplayName, person.TenantSlug ?? "", person.TenantName ?? "",
                "CloudWheel Ltd", url, InviteLinkDays)
            : await _mail.SendPasswordResetAsync(person.Email, person.DisplayName, person.TenantSlug, url, $"{InviteLinkDays} days");
        if (!ok) _log.LogWarning("Client admin link for {Email} was not sent (see the SMTP line above).", email);
        return ok ? null : "The mail server didn't accept the email. Check the Smtp settings and the app's log.";
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

    /// <summary>Team location for this client: on / off. Off erases every stored location of that client.</summary>
    [HttpPost("tenants/{id:guid}/location")]
    public async Task<IActionResult> SetLocation(Guid id, bool on)
    {
        if (!await _location.SetEnabledAsync(id, on)) return NotFound();
        TempData["Message"] = on
            ? "Team location is on for this client. Each person chooses whether to share; their admins can add the office's internet address on the Team page."
            : "Team location is off for this client. Stored locations were erased.";
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
            RecordingEnabled = ShankhNaad.ServiceLibrary.Video.VideoFeatures.RecordingAvailable && recordingEnabled,   // off for now, see VideoFeatures
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
        var locationOn = await _location.EnabledTenantsAsync();
        var tenants = (await _tenants.ListAsync())
            .Select(t => new TenantRowVm(t.TenantId, t.Name, t.Slug, t.PlanName, t.ActiveUsers, t.MaxUsers,
                t.StorageUsedBytes, t.StorageQuotaBytes, t.VideoProvider, t.IsActive, t.CreatedUtc, locationOn.Contains(t.TenantId)))
            .ToList();

        if (form.PlanId == 0 && plans.Count > 0) form.PlanId = plans[0].PlanId;

        return new AdminViewModel
        {
            Tenants = tenants,
            Plans = plans,
            NewTenant = form,
            CanEmail = _mail.CanSend,
            Message = TempData["Message"] as string,
            Error = error ?? TempData["Error"] as string
        };
    }
}
