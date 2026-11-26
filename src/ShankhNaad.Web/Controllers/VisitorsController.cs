using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.ServiceLibrary.Data;
using ShankhNaad.Web.Hubs;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Work → Visitors (database/51_Visitors.sql, page js/work-visitors.js). Everyone sees the day's visitors and can expect one;
/// admins turn the reception tablet on and get its link. Live: "VisitorChanged" (lists), "Visitor" (the host's card, js/work-live.js).
/// </summary>
[Route("work/visitors"), NeedsScript("51_Visitors.sql")]
public sealed class VisitorsController : WorkControllerBase
{
    private readonly IWorkData _db;
    private readonly ITenantService _tenants;
    private readonly IHubContext<ChatHub> _hub;
    private readonly AppOptions _app;

    public VisitorsController(IWorkData db, ITenantService tenants, IHubContext<ChatHub> hub, IOptions<AppOptions> app)
    {
        _db = db;
        _tenants = tenants;
        _hub = hub;
        _app = app.Value;
    }

    [HttpGet("")]
    public IActionResult Index() => WorkPage("Visitors", "Visitors");

    private string KioskUrl(string code) => $"{(string.IsNullOrWhiteSpace(_app.PublicBaseUrl) ? $"{Request.Scheme}://{Request.Host}" : _app.PublicBaseUrl.TrimEnd('/'))}/lobby/{code}";

    /// <summary>Never send the tablet's secret token to the browser lists.</summary>
    private static Row Clean(Row r) { r.Remove("kioskToken"); return r; }

    [HttpGet("data")]
    public async Task<IActionResult> Data(string? day)
    {
        var zone = await _tenants.ZoneAsync(TenantId);
        var today = WorkHelpers.Today(zone);
        var d = WorkHelpers.Day(day) ?? today;
        var (from, to) = WorkHelpers.DayUtc(d, zone);
        var list = await _db.RowsAsync("dbo.sahyog_Visitor_Day", p => p.With("@TenantId", TenantId).AddDateTime2("@FromUtc", from).AddDateTime2("@ToUtc", to));
        object? lobby = null;
        if (IsAdmin)
        {
            var l = await _db.RowAsync("dbo.sahyog_Lobby_Get", p => p.With("@TenantId", TenantId));
            lobby = l is null ? new { enabled = false, url = (string?)null, welcome = (string?)null }
                              : new { enabled = l.B("enabled"), url = (string?)KioskUrl(l.S("kioskCode")!), welcome = l.S("welcome") };
        }
        Response.Headers.CacheControl = "no-store";
        return Json(new { day = WorkHelpers.Iso(d), today = WorkHelpers.Iso(today), visitors = list.Select(Clean), lobby, isAdmin = IsAdmin });
    }

    public sealed class LobbyInput { public bool Enabled { get; set; } public string? Welcome { get; set; } public bool NewLink { get; set; } }

    [HttpPost("lobby")]
    public async Task<IActionResult> Lobby([FromBody] LobbyInput input)
    {
        if (!IsAdmin) return Fail("Only an admin can set up the reception tablet.", 403);
        var old = await _db.RowAsync("dbo.sahyog_Lobby_Get", p => p.With("@TenantId", TenantId));
        var code = old is null || input.NewLink ? WorkHelpers.Code(12) : null;
        var l = await _db.RowAsync("dbo.sahyog_Lobby_Save", p => p.With("@TenantId", TenantId).With("@Enabled", input.Enabled)
            .AddText("@Welcome", WorkHelpers.Clip(input.Welcome, 200), 200).AddText("@NewCode", code, 24));
        return Json(new { enabled = l?.B("enabled") ?? false, url = l is null ? null : KioskUrl(l.S("kioskCode")!), welcome = l?.S("welcome") });
    }

    public sealed class ExpectInput
    {
        public string? Name { get; set; }
        public string? Phone { get; set; }
        public string? Company { get; set; }
        public string? Purpose { get; set; }
        public Guid? HostId { get; set; }
        public string? Day { get; set; }
        public string? Time { get; set; }
        /// <summary>A walk-in: checked in now.</summary>
        public bool Arrived { get; set; }
    }

    [HttpPost("expect")]
    public async Task<IActionResult> Expect([FromBody] ExpectInput input)
    {
        var name = WorkHelpers.Clip(input.Name, 100);
        if (name is null) return Fail("Write the visitor's name.");
        var zone = await _tenants.ZoneAsync(TenantId);
        DateTime? expected = null;
        if (!input.Arrived)
        {
            if (WorkHelpers.Day(input.Day) is not DateOnly d) return Fail("Pick the day.");
            var t = TimeOnly.TryParseExact(input.Time ?? "", "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var tt) ? tt : new TimeOnly(10, 0);
            expected = MeetingCalendar.ToUtc(d.ToDateTime(t), zone);
            if (expected < DateTime.UtcNow.AddDays(-1)) return Fail("That day has passed.");
        }
        var v = await _db.RowAsync("dbo.sahyog_Visitor_Expect", p => p.With("@TenantId", TenantId).With("@UserId", Me)
            .AddText("@Name", name, 100).AddText("@Phone", Phone(input.Phone), 30).AddText("@Company", WorkHelpers.Clip(input.Company, 100), 100)
            .AddText("@Purpose", WorkHelpers.Clip(input.Purpose, 200), 200).With("@HostId", input.HostId).AddDateTime2("@ExpectedUtc", expected).With("@Arrived", input.Arrived));
        if (v is null) return Fail("Couldn't save it. Try again.");
        Clean(v);
        await _hub.Clients.Group(ChatHub.TenantGroup(TenantId)).SendAsync("VisitorChanged", v);
        if (input.Arrived && v.GN("hostId") is Guid host && host != Me)
            await _hub.Clients.User(host.ToString()).SendAsync("Visitor", v);
        return Json(v);
    }

    /// <summary>Digits and + only (the tablet matches an expected visitor by phone).</summary>
    internal static string? Phone(string? s)
    {
        var p = new string((s ?? "").Where(c => char.IsDigit(c) || c == '+').ToArray());
        return p.Length == 0 ? null : p.Length > 30 ? p[..30] : p;
    }

    /// <summary>arrive | leave | coming | wait | delete</summary>
    [HttpPost("{id:int}/{what}")]
    public async Task<IActionResult> Update(int id, string what)
    {
        what = (what ?? "").ToLowerInvariant();
        if (what is not ("arrive" or "leave" or "coming" or "wait" or "delete")) return NotFound();
        var cur = await _db.RowAsync("dbo.sahyog_Visitor_Get", p => p.With("@TenantId", TenantId).With("@VisitorId", id));
        if (cur is null) return Fail("That visitor was removed.", 404);
        if (what is "coming" or "wait" && cur.GN("hostId") != Me) return Fail("Only the person they are meeting can answer.", 403);
        if (what == "delete" && !IsAdmin && cur.GN("createdBy") != Me && cur.GN("hostId") != Me) return Fail("Only the host, whoever added the visit, or an admin can remove it.", 403);
        var v = await _db.RowAsync("dbo.sahyog_Visitor_Update", p => p.With("@TenantId", TenantId).With("@VisitorId", id).AddText("@What", what, 10));
        if (what == "delete") { await _hub.Clients.Group(ChatHub.TenantGroup(TenantId)).SendAsync("VisitorChanged", new { visitorId = id, deleted = true }); return Json(new { ok = true }); }
        if (v is null) return Fail("That visitor was removed.", 404);
        Clean(v);
        await _hub.Clients.Group(ChatHub.TenantGroup(TenantId)).SendAsync("VisitorChanged", v);
        // checked in by reception: the host gets the card
        if (what == "arrive" && cur["arrivedUtc"] is null && v.GN("hostId") is Guid host && host != Me)
            await _hub.Clients.User(host.ToString()).SendAsync("Visitor", v);
        return Json(v);
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export(string? day)
    {
        var zone = await _tenants.ZoneAsync(TenantId);
        var d = WorkHelpers.Day(day) ?? WorkHelpers.Today(zone);
        var (from, to) = WorkHelpers.DayUtc(d, zone);
        var list = await _db.RowsAsync("dbo.sahyog_Visitor_Day", p => p.With("@TenantId", TenantId).AddDateTime2("@FromUtc", from).AddDateTime2("@ToUtc", to));
        string T(DateTime? utc) => utc is DateTime x ? MeetingCalendar.ToLocal(x, zone).ToString("HH:mm", CultureInfo.InvariantCulture) : "";
        var sb = new StringBuilder("Name,Company,Phone,Meeting,Purpose,Expected,Arrived,Left\r\n");
        foreach (var v in list)
            sb.Append(string.Join(",", new[] { v.S("name"), v.S("company"), v.S("phone"), v.S("hostName"), v.S("purpose"), T(v.Utc("expectedUtc")), T(v.Utc("arrivedUtc")), T(v.Utc("leftUtc")) }
                .Select(WorkHelpers.Csv))).Append("\r\n");
        return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(), "text/csv", $"visitors-{WorkHelpers.Iso(d)}.csv");
    }
}

/// <summary>
/// The reception tablet: /lobby/{code} (no sign-in; the code is the secret, made on Work → Visitors).
/// A visitor writes their name, picks who they are meeting; the host's card rings in ShankhNaad;
/// the tablet then shows "Asha is coming" or "Please take a seat".
/// </summary>
[AllowAnonymous, Route("lobby"), NeedsScript("51_Visitors.sql")]
public sealed class LobbyController : Controller
{
    private readonly IWorkData _db;
    private readonly IHubContext<ChatHub> _hub;

    public LobbyController(IWorkData db, IHubContext<ChatHub> hub)
    {
        _db = db;
        _hub = hub;
    }

    private Task<Row?> LobbyAsync(string code) =>
        code.Length is < 8 or > 24 ? Task.FromResult<Row?>(null) : _db.RowAsync("dbo.sahyog_Lobby_ByCode", p => p.AddText("@Code", code, 24));

    [HttpGet("{code}")]
    public async Task<IActionResult> Kiosk(string code)
    {
        var l = await LobbyAsync(code);
        if (l is null) return NotFound("This reception link is turned off or was replaced. Ask the office for the new one.");
        Response.Headers["X-Robots-Tag"] = "noindex";
        return View("~/Views/Lobby/Kiosk.cshtml", l);
    }

    [HttpGet("{code}/hosts")]
    public async Task<IActionResult> Hosts(string code)
    {
        var l = await LobbyAsync(code);
        if (l is null) return NotFound();
        var rows = await _db.RowsAsync("dbo.sahyog_Lobby_Hosts", p => p.With("@TenantId", l.G("tenantId")));
        return Json(rows.Select(r => new { id = r.G("userId"), name = r.S("displayName"), tone = r.I("avatarTone"), title = r.S("jobTitle"), dept = r.S("departmentName") }));
    }

    public sealed class ArriveInput
    {
        public string? Name { get; set; }
        public string? Phone { get; set; }
        public string? Company { get; set; }
        public string? Purpose { get; set; }
        public Guid? HostId { get; set; }
    }

    [HttpPost("{code}/arrive")]
    public async Task<IActionResult> Arrive(string code, [FromBody] ArriveInput input)
    {
        var l = await LobbyAsync(code);
        if (l is null) return NotFound(new { error = "This reception link is turned off." });
        var name = WorkHelpers.Clip(input.Name, 100);
        if (name is null) return BadRequest(new { error = "Please write your name." });
        var tenantId = l.G("tenantId");
        var zone = MeetingCalendar.FindZone(l.S("timeZoneId"));
        var (from, to) = WorkHelpers.DayUtc(WorkHelpers.Today(zone), zone);
        var token = WorkHelpers.Code(24);
        var v = await _db.RowAsync("dbo.sahyog_Visitor_KioskArrive", p => p.With("@TenantId", tenantId)
            .AddText("@Name", name, 100).AddText("@Phone", VisitorsController.Phone(input.Phone), 30)
            .AddText("@Company", WorkHelpers.Clip(input.Company, 100), 100).AddText("@Purpose", WorkHelpers.Clip(input.Purpose, 200), 200)
            .With("@HostId", input.HostId).AddText("@Token", token, 32).AddDateTime2("@DayStartUtc", from).AddDateTime2("@DayEndUtc", to));
        if (v is null) return BadRequest(new { error = "Couldn't sign you in. Please ask at the desk." });
        v.Remove("kioskToken");
        await _hub.Clients.Group(ChatHub.TenantGroup(tenantId)).SendAsync("VisitorChanged", v);
        if (v.GN("hostId") is Guid host) await _hub.Clients.User(host.ToString()).SendAsync("Visitor", v);
        return Json(new { visitorId = v.I("visitorId"), token, host = v.S("hostName") });
    }

    [HttpGet("{code}/status/{id:int}")]
    public async Task<IActionResult> Status(string code, int id, string? t)
    {
        var l = await LobbyAsync(code);
        if (l is null || string.IsNullOrEmpty(t)) return NotFound();
        var s = await _db.RowAsync("dbo.sahyog_Visitor_KioskStatus", p => p.With("@TenantId", l.G("tenantId")).With("@VisitorId", id).AddText("@Token", t, 32));
        Response.Headers.CacheControl = "no-store";
        return s is null ? NotFound() : Json(new { reply = s.S("hostReply"), host = s.S("hostName") });
    }
}
