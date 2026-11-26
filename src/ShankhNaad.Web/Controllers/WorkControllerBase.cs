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

    /// <summary>
    /// What the Work windows' dropdowns need (drawn by the tag-helper controls):
    /// ViewData["People"] = (id, "Name · Team") for owner / host / approver pickers, ViewData["Departments"].
    /// </summary>
    protected async Task LoadPickListsAsync()
    {
        var org = await HttpContext.RequestServices.GetRequiredService<ShankhNaad.ServiceLibrary.IOrgService>().GetAsync(TenantId);
        List<(string Value, string Text)> people;
        if (org.People.Count > 0)
            people = org.People.OrderBy(p => p.DisplayName, StringComparer.OrdinalIgnoreCase)
                .Select(p => (p.UserId.ToString(), System.Net.WebUtility.HtmlEncode(p.DisplayName + (string.IsNullOrWhiteSpace(p.DepartmentName) ? "" : " · " + p.DepartmentName)))).ToList();
        else
            people = (await HttpContext.RequestServices.GetRequiredService<ShankhNaad.ServiceLibrary.IUserService>().ListByTenantAsync(TenantId))
                .Where(u => u.IsActive).OrderBy(u => u.DisplayName, StringComparer.OrdinalIgnoreCase)
                .Select(u => (u.UserId.ToString(), System.Net.WebUtility.HtmlEncode(u.DisplayName))).ToList();
        ViewData["People"] = people;
        ViewData["Departments"] = org.Departments
            .OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase)
            .Select(d => (d.DepartmentId.ToString(), System.Net.WebUtility.HtmlEncode(d.Name))).ToList();
    }

    /// <summary>A Work page with its pick lists loaded.</summary>
    protected async Task<IActionResult> WorkFormPageAsync(string view, string title)
    {
        await LoadPickListsAsync();
        return WorkPage(view, title);
    }

    /// <summary>The page with the Work look (Views/Work/…), section "work".</summary>
    protected IActionResult WorkPage(string view, string title, object? model = null)
    {
        ViewData["Section"] = "work";
        ViewData["Title"] = title;
        ViewData["WorkTab"] = view.ToLowerInvariant();
        // the Work tabs fetch a section on its own (no page around it) and keep it: Views/Work/_ViewStart.cshtml
        if (Request.Headers.TryGetValue("X-SN-Pane", out var pane) && pane == "1")
        {
            ViewData["WorkPane"] = true;
            Response.Headers.CacheControl = "no-store";
            Response.Headers.Vary = "X-SN-Pane";
        }
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
