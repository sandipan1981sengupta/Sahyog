using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Infrastructure;
using ShankhNaad.Web.Models;

namespace ShankhNaad.Web.Controllers;

[Route("account")]
public sealed class AccountController : Controller
{
    private readonly IUserService _users;
    private readonly IAccountEmailService _mail;
    private readonly AppOptions _app;

    public AccountController(IUserService users, IAccountEmailService mail, IOptions<AppOptions> app)
    {
        _users = users;
        _mail = mail;
        _app = app.Value;
    }

    /// <summary>How long a "Forgot password" link works.</summary>
    private static readonly TimeSpan ResetLinkLifetime = TimeSpan.FromHours(1);

    [HttpGet("login"), AllowAnonymous]
    public IActionResult Login(string? returnUrl = null, string? workspace = null, string? email = null)
    {
        if (User.Identity?.IsAuthenticated == true) return Redirect("/");
        return View(new LoginViewModel { ReturnUrl = returnUrl, Workspace = workspace, Email = email ?? "" });
    }

    // ---------- Forgot password ----------

    [HttpGet("forgot"), AllowAnonymous]
    public IActionResult Forgot(string? email = null) =>
        View(new ForgotPasswordViewModel { Email = email ?? "", CanEmail = _mail.CanSend });

    /// <summary>
    /// Emails a one-hour set-password link if the address belongs to an active account.
    /// The page always says the same thing, so it can't be used to find out who has an account.
    /// </summary>
    [HttpPost("forgot"), AllowAnonymous]
    public async Task<IActionResult> Forgot(ForgotPasswordViewModel model, [FromServices] ILogger<AccountController> log)
    {
        model.CanEmail = _mail.CanSend;
        if (!ModelState.IsValid || !model.CanEmail) return View(model);

        var user = await _users.FindByEmailAsync(model.Email);
        if (user is not null && user.IsActive && user.TenantActive)
        {
            var (token, error) = await _users.CreatePasswordLinkAsync(user.UserId, PasswordLinkPurpose.Reset, ResetLinkLifetime);
            if (token is not null)
            {
                var sent = await _mail.SendPasswordResetAsync(user.Email, user.DisplayName, user.TenantSlug,
                    PasswordLinks.Url(_app, Request, token), "1 hour");
                log.LogInformation("Forgot password for {Email}: reset email {Result}.", model.Email.Trim(), sent ? "sent" : "NOT sent (see the SMTP line above)");
            }
            else log.LogWarning("Forgot password for {Email}: no email sent: {Why}", model.Email.Trim(),
                     error ?? "couldn't create a reset link");
        }
        else
            // the page says the same thing either way (so nobody can test which emails have accounts); the log tells the admin
            log.LogInformation("Forgot password for {Email}: {Why}, no email sent.", model.Email.Trim(),
                user is null ? "no account with this email" : !user.IsActive ? "the account is switched off" : "the workspace is switched off");
        return View(new ForgotPasswordViewModel { Email = model.Email.Trim(), Sent = true, CanEmail = true });
    }

    // ---------- Set password (from a welcome or reset email) ----------

    [HttpGet("set-password"), AllowAnonymous]
    public async Task<IActionResult> SetPassword(string? token)
    {
        var link = await _users.GetPasswordLinkAsync(token ?? "");
        return View(new SetPasswordViewModel { Token = token ?? "", Link = link });
    }

    [HttpPost("set-password"), AllowAnonymous]
    public async Task<IActionResult> SetPassword(SetPasswordViewModel model)
    {
        model.Link = await _users.GetPasswordLinkAsync(model.Token);
        if (model.Link is null || model.Link.Problem is not null) return View(model);
        if (!ModelState.IsValid) return View(model);

        var (result, email, slug) = await _users.UsePasswordLinkAsync(model.Token, model.NewPassword);
        if (!result.Succeeded)
        {
            ModelState.AddModelError("", result.Error!);
            return View(model);
        }

        // you're signed out everywhere: sign in fresh with the new password
        if (User.Identity?.IsAuthenticated == true)
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        TempData["SetupMessage"] = "Your password is set. Sign in with it now.";
        return RedirectToAction(nameof(Login), new { workspace = slug, email });
    }

    [HttpPost("login"), AllowAnonymous]
    public async Task<IActionResult> Login(LoginViewModel model)
    {
        if (!ModelState.IsValid) return View(model);

        var login = await _users.LoginAsync(model.Workspace, model.Email, model.Password);
        switch (login.Status)
        {
            case LoginStatus.LockedOut:
                ModelState.AddModelError("", "Too many attempts. Try again in a few minutes.");
                return View(model);
            case LoginStatus.WorkspacePaused:
                ModelState.AddModelError("", "This workspace is paused. Please contact CloudWheel Ltd.");
                return View(model);
            case LoginStatus.Invalid:
                ModelState.AddModelError("", "Email or password is not correct.");
                return View(model);
        }

        var user = login.User!;
        await CookieAuth.SignInAsync(HttpContext, user, model.RememberMe);

        if (!string.IsNullOrEmpty(model.ReturnUrl) && Url.IsLocalUrl(model.ReturnUrl))
            return LocalRedirect(model.ReturnUrl);

        return user.Role == AppRoles.SuperAdmin ? RedirectToAction("Index", "Admin") : RedirectToAction("Index", "Chat");
    }

    [HttpPost("logout"), Authorize]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return RedirectToAction(nameof(Login));
    }

    [HttpGet("denied"), AllowAnonymous]
    public IActionResult Denied() => View();
}
