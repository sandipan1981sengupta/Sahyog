using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Models;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// One-time first run: /setup creates the CloudWheel super admin and (optionally) the first client workspace.
/// As soon as a super admin exists, this page redirects to sign-in and can't be used again.
/// </summary>
[AllowAnonymous, Route("setup")]
public sealed class SetupController : Controller
{
    private readonly IUserService _users;
    private readonly ITenantService _tenants;

    public SetupController(IUserService users, ITenantService tenants)
    {
        _users = users;
        _tenants = tenants;
    }

    [HttpGet("")]
    public async Task<IActionResult> Index()
    {
        if (await _users.SuperAdminExistsAsync()) return RedirectToAction("Login", "Account");
        var plans = await _tenants.GetPlansAsync();
        return View(new SetupInput { PlanId = plans.FirstOrDefault()?.PlanId ?? 0 });
    }

    [HttpPost("")]
    public async Task<IActionResult> Index(SetupInput input)
    {
        if (await _users.SuperAdminExistsAsync()) return RedirectToAction("Login", "Account");
        if (input.AdminPassword != input.ConfirmPassword)
            ModelState.AddModelError(nameof(input.ConfirmPassword), "Passwords don't match.");
        if (input.CreateWorkspace && (string.IsNullOrWhiteSpace(input.CompanyName) || string.IsNullOrWhiteSpace(input.Workspace)
                                      || string.IsNullOrWhiteSpace(input.ClientAdminEmail) || string.IsNullOrWhiteSpace(input.ClientAdminPassword)))
            ModelState.AddModelError("", "Fill in all first-client fields, or untick \"Also create my first client\".");
        if (!ModelState.IsValid) return View(input);

        var admin = await _users.CreateAsync(new CreateUserRequest
        {
            TenantId = null,
            DisplayName = input.AdminName,
            Email = input.AdminEmail,
            Password = input.AdminPassword,
            Role = AppRoles.SuperAdmin,
            EnforceLimit = false
        });
        if (!admin.Succeeded)
        {
            ModelState.AddModelError("", admin.Error!);
            return View(input);
        }

        var message = $"Setup done. Sign in as {input.AdminEmail} with Workspace left empty.";
        if (input.CreateWorkspace)
        {
            var client = await _tenants.CreateAsync(new CreateTenantRequest
            {
                Name = input.CompanyName!,
                Slug = input.Workspace!,
                PlanId = input.PlanId,
                AdminName = input.ClientAdminName ?? "Admin",
                AdminEmail = input.ClientAdminEmail!,
                AdminPassword = input.ClientAdminPassword!
            });
            message = client.Succeeded
                ? $"Setup done. Client admin: workspace \"{input.Workspace!.Trim().ToLowerInvariant()}\", {input.ClientAdminEmail}. Super admin: {input.AdminEmail} (Workspace empty)."
                : $"Super admin created, but the client wasn't: {client.Error} You can add it later in Admin.";
        }

        TempData["SetupMessage"] = message;
        return RedirectToAction("Login", "Account");
    }
}
