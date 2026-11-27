using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ShankhNaad.DtoLibrary;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Help Center: narrated video guides for every page, and the PDF user manual (same as Kaustubh's Help Center).
/// The videos live in wwwroot/HelpVideos/&lt;menu&gt;/NN-page-name.mp4 (+ .jpg poster, + .captions.json) and are listed in
/// wwwroot/HelpVideos/help-videos.json. To add a video: copy the files there and add an entry to the json.
/// The manual is wwwroot/HelpVideos/ShankhNaad_User_Manual.pdf.
/// </summary>
[Authorize]
public sealed class HelpController : Controller
{
    private const string Folder = "HelpVideos";
    private const string Manifest = "help-videos.json";
    private readonly IWebHostEnvironment _env;
    public HelpController(IWebHostEnvironment env) => _env = env;

    [HttpGet("/help")]
    public IActionResult Index() => View();

    // old Kaustubh-style address
    [HttpGet("/Help/HelpPage")]
    public IActionResult HelpPage() => RedirectToAction(nameof(Index));

    /// <summary>GET /help/videos → { success, menus, videos }; a video whose file is missing gets available = false ("Coming soon").</summary>
    [HttpGet("/help/videos")]
    public IActionResult Videos()
    {
        try
        {
            var root = Path.Combine(_env.WebRootPath, Folder);
            var file = Path.Combine(root, Manifest);
            if (!System.IO.File.Exists(file))
                return Json(new { success = false, message = "No help videos are installed yet (" + Folder + "/" + Manifest + " is missing)." });

            using var doc = JsonDocument.Parse(System.IO.File.ReadAllText(file));
            var menus = doc.RootElement.GetProperty("menus").EnumerateArray().Select(m => m.GetString()).ToList();
            var admin = User.IsInRole(AppRoles.TenantAdmin) || User.IsInRole(AppRoles.SuperAdmin);
            var videos = new List<Dictionary<string, object?>>();
            foreach (var v in doc.RootElement.GetProperty("videos").EnumerateArray())
            {
                // guides marked "adminOnly" are listed for admins only
                if (v.TryGetProperty("adminOnly", out var ao) && ao.ValueKind == JsonValueKind.True && !admin) continue;
                var row = JsonSerializer.Deserialize<Dictionary<string, object?>>(v.GetRawText()) ?? new();
                var url = v.TryGetProperty("video", out var u) ? u.GetString() ?? "" : "";
                var local = Path.Combine(_env.WebRootPath, url.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
                row["available"] = System.IO.File.Exists(local);
                videos.Add(row);
            }
            return Json(new { success = true, menus, videos });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = "Could not read the help videos: " + ex.Message });
        }
    }
}
