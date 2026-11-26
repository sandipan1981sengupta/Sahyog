using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>Shared by the Work features: who is asking, and a friendly answer when their database script isn't run yet.</summary>
[Authorize(Roles = AppRoles.TenantAdmin + "," + AppRoles.Member)]
public abstract class WorkControllerBase : Controller
{
    protected Guid TenantId => User.TenantId()!.Value;
    protected Guid Me => User.UserGuid();
    protected bool IsAdmin => User.IsInRole(AppRoles.TenantAdmin);

    protected IActionResult Fail(string error, int status = 400) => StatusCode(status, new { error });

    /// <summary>The page with the Work look (Views/Work/…), section "work".</summary>
    protected IActionResult WorkPage(string view, string title, object? model = null)
    {
        ViewData["Section"] = "work";
        ViewData["Title"] = title;
        return View($"~/Views/Work/{view}.cshtml", model);
    }
}

/// <summary>A missing table or procedure (script not run yet) → 503 "Run database/NN_….sql".</summary>
public sealed class NeedsScriptAttribute : ExceptionFilterAttribute
{
    private readonly string _script;
    public NeedsScriptAttribute(string script) => _script = script;

    public override void OnException(ExceptionContext context)
    {
        if (context.Exception is SqlException { Number: 2812 or 208 or 207 or 8144 })
        {
            context.Result = new ObjectResult(new { error = $"This needs the database update database/{_script} (or 99_ApplyAllUpdates.sql). Ask CloudWheel to run it.", needsDatabase = _script })
            { StatusCode = 503 };
            context.ExceptionHandled = true;
        }
    }
}
