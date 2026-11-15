using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary;
using Sahyog.Web.Infrastructure;
using Sahyog.Web.Models;

namespace Sahyog.Web.Controllers;

[Route("account")]
public sealed class AccountController : Controller
{
    private readonly IUserService _users;

    public AccountController(IUserService users) => _users = users;

    [HttpGet("login"), AllowAnonymous]
    public IActionResult Login(string? returnUrl = null, string? workspace = null)
    {
        if (User.Identity?.IsAuthenticated == true) return Redirect("/");
        return View(new LoginViewModel { ReturnUrl = returnUrl, Workspace = workspace });
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
                ModelState.AddModelError("", "Workspace, email or password is not correct.");
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
