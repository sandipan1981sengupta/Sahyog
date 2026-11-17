using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ShankhNaad.DtoLibrary;

namespace ShankhNaad.Web.Controllers;

public sealed class HomeController : Controller
{
    [Route("")]
    public IActionResult Index()
    {
        if (User.Identity?.IsAuthenticated != true) return RedirectToAction("Login", "Account");
        return User.IsInRole(AppRoles.SuperAdmin)
            ? RedirectToAction("Index", "Admin")
            : RedirectToAction("Index", "Chat");
    }

    [Route("error"), AllowAnonymous]
    public IActionResult Error() => View();
}
