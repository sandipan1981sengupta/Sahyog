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

    /// <summary>
    /// The error page. Every error is written to App_Data/logs/errors-yyyyMMdd.log with a short reference code,
    /// and admins also see what went wrong on the page itself (so a problem on the server can be found quickly).
    /// </summary>
    [Route("error"), AllowAnonymous]
    public IActionResult Error([FromServices] IWebHostEnvironment env, [FromServices] ILogger<HomeController> log)
    {
        var feature = HttpContext.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerPathFeature>();
        var code = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        if (feature?.Error is Exception ex)
        {
            log.LogError(ex, "Error {Code} on {Path}", code, feature.Path);
            try
            {
                var dir = Path.Combine(env.ContentRootPath, "App_Data", "logs");
                Directory.CreateDirectory(dir);
                System.IO.File.AppendAllText(Path.Combine(dir, $"errors-{DateTime.UtcNow:yyyyMMdd}.log"),
                    $"[{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC] {code} {feature.Path} user={User.Identity?.Name}{Environment.NewLine}{ex}{Environment.NewLine}{Environment.NewLine}");
            }
            catch { /* the log folder can't be written: the page still shows */ }

            if (User.IsInRole(AppRoles.SuperAdmin) || User.IsInRole(AppRoles.TenantAdmin))
            {
                var inner = ex;
                while (inner.InnerException is not null) inner = inner.InnerException;
                ViewData["ErrorDetail"] = $"{inner.GetType().Name}: {inner.Message}";
                ViewData["ErrorPath"] = feature.Path;
            }
        }
        ViewData["ErrorCode"] = code;
        return View();
    }
}
