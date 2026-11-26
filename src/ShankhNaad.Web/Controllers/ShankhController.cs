using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Hubs;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Shankh: an urgent alert (outage, fire drill, client issue) that rings every person's screen until they press Seen.
/// A workspace admin sends it to everyone, a department or picked people; the board shows who has seen it, live.
/// After the chosen minutes, the managers of people who still haven't seen it get a reminder (Infrastructure/ShankhReminders.cs).
/// Real-time messages: "Shankh" (ring), "ShankhSeen" (board), "ShankhClosed" (stop ringing), "ShankhRemind" (to a manager).
/// </summary>
[Authorize(Roles = AppRoles.TenantAdmin + "," + AppRoles.Member), Route("shankh")]
public sealed class ShankhController : Controller
{
    private static readonly string[] Kinds = { "outage", "drill", "client", "other" };
    private static readonly int[] RemindChoices = { 2, 5, 10, 15 };

    private readonly IShankhService _shankh;
    private readonly IOrgService _org;
    private readonly IUserService _users;
    private readonly IHubContext<ChatHub> _hub;
    private readonly IAppEmailSender _email;
    private readonly AppOptions _app;

    public ShankhController(IShankhService shankh, IOrgService org, IUserService users, IHubContext<ChatHub> hub, IAppEmailSender email, IOptions<AppOptions> app)
    {
        _shankh = shankh;
        _org = org;
        _users = users;
        _hub = hub;
        _email = email;
        _app = app.Value;
    }

    /// <summary>Everyone active in the company (from the org chart; just names when it isn't set up yet).</summary>
    private async Task<List<OrgPersonDto>> PeopleAsync()
    {
        var org = await _org.GetAsync(TenantId);
        if (org.People.Count > 0) return org.People;
        return (await _users.ListByTenantAsync(TenantId)).Where(u => u.IsActive)
            .Select(u => new OrgPersonDto(u.UserId, u.DisplayName, u.Email, u.Role, u.AvatarTone, null, null, null, null, null, null, null)).ToList();
    }

    private Guid TenantId => User.TenantId()!.Value;
    private Guid Me => Guid.Parse(User.UserId());
    private bool IsAdmin => User.IsInRole(AppRoles.TenantAdmin);

    public sealed class SendInput
    {
        public string? Kind { get; set; }
        public string? Body { get; set; }
        /// <summary>"all", "dept" or "people".</summary>
        public string? To { get; set; }
        public Guid? DepartmentId { get; set; }
        public List<Guid>? People { get; set; }
        /// <summary>Minutes before managers are reminded; 0 or null = no reminder.</summary>
        public int? RemindAfter { get; set; }
        public bool Email { get; set; }
    }

    /// <summary>Who can receive one (for the send window): departments with their people.</summary>
    [HttpGet("audience"), Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> Audience()
    {
        var people = (await PeopleAsync()).Where(p => p.UserId != Me).ToList();
        return Json(new
        {
            everyone = people.Count,
            departments = people.Where(p => p.DepartmentId is not null)
                .GroupBy(p => new { Id = p.DepartmentId!.Value, Name = p.DepartmentName ?? "Department" })
                .OrderBy(g => g.Key.Name).Select(g => new { id = g.Key.Id, name = g.Key.Name, count = g.Count() }),
            people = people.OrderBy(p => p.DisplayName, StringComparer.OrdinalIgnoreCase)
                .Select(p => new { id = p.UserId, name = p.DisplayName, initials = p.Initials, tone = p.AvatarTone, dept = p.DepartmentName ?? "", title = p.JobTitle ?? "" })
        });
    }

    /// <summary>Sound the Shankh.</summary>
    [HttpPost("send"), Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> Send([FromBody] SendInput input)
    {
        var body = (input.Body ?? "").Trim();
        if (body.Length == 0) return BadRequest(new { error = "Write what's happening and what people should do." });
        if (body.Length > 1000) return BadRequest(new { error = "Keep it under 1,000 characters." });
        var kind = Kinds.Contains(input.Kind) ? input.Kind! : "other";
        int? remind = input.RemindAfter is int m && RemindChoices.Contains(m) ? m : null;

        var people = (await PeopleAsync()).Where(p => p.UserId != Me).ToList();
        string audience;
        List<OrgPersonDto> to;
        switch ((input.To ?? "all").ToLowerInvariant())
        {
            case "dept":
                to = people.Where(p => input.DepartmentId is not null && p.DepartmentId == input.DepartmentId).ToList();
                audience = to.FirstOrDefault()?.DepartmentName ?? "A department";
                break;
            case "people":
                var pick = (input.People ?? new()).ToHashSet();
                to = people.Where(p => pick.Contains(p.UserId)).ToList();
                audience = to.Count == 1 ? to[0].DisplayName : $"{to.Count} people";
                break;
            default:
                to = people;
                audience = "Everyone";
                break;
        }
        if (to.Count == 0) return BadRequest(new { error = "Nobody to send it to. Pick at least one person." });

        var alertId = Guid.NewGuid();
        int reached;
        try
        {
            reached = await _shankh.CreateAsync(alertId, TenantId, Me, kind, body, audience, remind, to.Select(p => p.UserId).Append(Me));
        }
        catch (Microsoft.Data.SqlClient.SqlException)
        {
            return StatusCode(503, new { error = "Shankh needs a database update (45_Shankh.sql). Ask your administrator." });
        }

        var alert = new ShankhAlertDto(alertId, kind, body, audience, DateTime.UtcNow, Me, User.DisplayName());
        await _hub.Clients.Users(to.Select(p => p.UserId.ToString()).ToList()).SendAsync("Shankh", alert);

        // ---- optionally also by email (for people who don't have ShankhNaad open) ----
        int mailed = 0;
        string? mailNote = null;
        if (input.Email)
        {
            var emails = to.Select(p => p.Email).Where(e => !string.IsNullOrWhiteSpace(e)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (!_email.IsConfigured) mailNote = "Email isn't set up on the server, so no email was sent.";
            else if (emails.Count > 0)
            {
                var me = await _users.GetByIdAsync(Me);
                var html = MailHtml(User.DisplayName(), kind, body);
                if (await _email.SendHiddenAsync(emails, $"URGENT ({KindName(kind)}): {Short(body, 60)}", html, me?.Email, User.DisplayName())) mailed = emails.Count;
                else mailNote = "The alert went out, but the email couldn't be sent.";
            }
        }
        return Json(new { alertId, people = reached - 1, mailed, mailNote });
    }

    /// <summary>"Seen — I'm on it".</summary>
    [HttpPost("{id:guid}/seen")]
    public async Task<IActionResult> Seen(Guid id)
    {
        var r = await _shankh.SeenAsync(TenantId, id, Me);
        if (r is null) return NotFound();
        await _hub.Clients.Group(ChatHub.TenantGroup(TenantId)).SendAsync("ShankhSeen", id, Me.ToString(), r.Value.SeenUtc);
        // my other open tabs and devices stop ringing too
        await _hub.Clients.User(Me.ToString()).SendAsync("ShankhClosed", id);
        return Json(new { seenUtc = r.Value.SeenUtc });
    }

    /// <summary>Alerts still ringing for me (each page shows them again until I press Seen).</summary>
    [HttpGet("open")]
    public async Task<IActionResult> Open() => Json(await _shankh.MyOpenAsync(TenantId, Me));

    /// <summary>The live board: sender and admins.</summary>
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Board(Guid id)
    {
        var b = await _shankh.BoardAsync(TenantId, id);
        if (b is null) return NotFound();
        if (!IsAdmin && b.Value.Alert.SenderId != Me) return Forbid();
        var people = b.Value.People.Where(p => p.UserId != b.Value.Alert.SenderId).ToList();
        return Json(new
        {
            alert = b.Value.Alert,
            total = people.Count,
            seen = people.Count(p => p.SeenUtc is not null),
            people = people.Select(p => new
            {
                id = p.UserId, name = p.DisplayName, initials = p.Initials, tone = p.AvatarTone, dept = p.DepartmentName ?? "",
                manager = p.ManagerName, seenUtc = p.SeenUtc, remindedUtc = p.RemindedUtc
            })
        });
    }

    /// <summary>Recent alerts (admins).</summary>
    [HttpGet("recent"), Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> Recent() => Json(await _shankh.RecentAsync(TenantId));

    /// <summary>Stop it ringing everywhere.</summary>
    [HttpPost("{id:guid}/close")]
    public async Task<IActionResult> Close(Guid id)
    {
        var b = await _shankh.BoardAsync(TenantId, id);
        if (b is null) return NotFound();
        if (!IsAdmin && b.Value.Alert.SenderId != Me) return Forbid();
        await _shankh.CloseAsync(TenantId, id, Me);
        await _hub.Clients.Group(ChatHub.TenantGroup(TenantId)).SendAsync("ShankhClosed", id);
        return Json(new { closed = true });
    }

    /// <summary>"Remind their managers now": rings everyone who hasn't seen it again, and tells their managers.</summary>
    [HttpPost("{id:guid}/remind")]
    public async Task<IActionResult> Remind(Guid id)
    {
        var b = await _shankh.BoardAsync(TenantId, id);
        if (b is null) return NotFound();
        if (!IsAdmin && b.Value.Alert.SenderId != Me) return Forbid();
        if (b.Value.Alert.ClosedUtc is not null) return BadRequest(new { error = "This alert is closed." });
        var waiting = b.Value.People.Where(p => p.SeenUtc is null && p.UserId != b.Value.Alert.SenderId).ToList();
        if (waiting.Count > 0)
            await _hub.Clients.Users(waiting.Select(p => p.UserId.ToString()).ToList()).SendAsync("Shankh", b.Value.Alert);
        foreach (var g in waiting.Where(p => p.ManagerId is not null).GroupBy(p => p.ManagerId!.Value))
            await _hub.Clients.User(g.Key.ToString()).SendAsync("ShankhRemind", id, g.Select(p => p.DisplayName).ToList(), b.Value.Alert.Body);
        return Json(new { rang = waiting.Count, managers = waiting.Where(p => p.ManagerId is not null).Select(p => p.ManagerId).Distinct().Count() });
    }

    private static string KindName(string kind) => kind switch { "outage" => "Outage", "drill" => "Fire drill", "client" => "Client issue", _ => "Alert" };
    private static string Short(string s, int n) => s.Length <= n ? s : s[..(n - 1)].TrimEnd() + "…";

    private string MailHtml(string sender, string kind, string body)
    {
        var url = string.IsNullOrWhiteSpace(_app.PublicBaseUrl) ? null : _app.PublicBaseUrl.TrimEnd('/') + "/chat";
        var link = url is null ? "" : $"<p style=\"margin:20px 0 0\"><a href=\"{WebUtility.HtmlEncode(url)}\" style=\"background:#DC2626;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold\">Open ShankhNaad and press Seen</a></p>";
        return $@"<div style=""font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border-radius:18px;border:2px solid #DC2626"">
<p style=""margin:0;color:#DC2626;font-weight:bold;letter-spacing:.08em;font-size:12px"">🐚 SHANKH · URGENT · {WebUtility.HtmlEncode(KindName(kind).ToUpperInvariant())}</p>
<p style=""font-size:18px;line-height:1.5;margin:12px 0"">{WebUtility.HtmlEncode(body).Replace("\n", "<br>")}</p>
<p style=""color:#555;margin:0"">From {WebUtility.HtmlEncode(sender)}</p>{link}</div>";
    }
}
