using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.ServiceLibrary.Data;
using ShankhNaad.Web.Hubs;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Work → Stand-up (database/47_Standup.sql, page js/work-stand-up.js, reminders Infrastructure/WorkJobs.cs).
/// Admins set up stand-ups for everyone or a department (a department's head can too). People answer three questions;
/// the roll-up shows answers with blockers first. Live: "StandupAnswered" (roll-ups refresh), "StandupBlocker" (to the manager and the organizer).
/// </summary>
[Route("work/standup"), NeedsScript("47_Standup.sql")]
public sealed class StandupController : WorkControllerBase
{
    private readonly IWorkData _db;
    private readonly IOrgService _org;
    private readonly ITenantService _tenants;
    private readonly IHubContext<ChatHub> _hub;

    public StandupController(IWorkData db, IOrgService org, ITenantService tenants, IHubContext<ChatHub> hub)
    {
        _db = db;
        _org = org;
        _tenants = tenants;
        _hub = hub;
    }

    [HttpGet("")]
    public Task<IActionResult> Index() => WorkFormPageAsync("Standup", "Stand-up");

    /// <summary>Departments this person may set stand-ups up for (admins: all, and "everyone").</summary>
    private async Task<(bool Everyone, HashSet<Guid> Depts)> ManageableAsync()
    {
        var org = await _org.GetAsync(TenantId);
        if (IsAdmin) return (true, org.Departments.Select(d => d.DepartmentId).ToHashSet());
        return (false, org.Departments.Where(d => d.HeadUserId == Me).Select(d => d.DepartmentId).ToHashSet());
    }

    private bool CanManage((bool Everyone, HashSet<Guid> Depts) m, Guid? dept) => dept is Guid d ? m.Depts.Contains(d) : m.Everyone;

    /// <summary>My stand-ups for the day, every stand-up (to pick a roll-up), and what I may manage.</summary>
    [HttpGet("data")]
    public async Task<IActionResult> Data(string? day)
    {
        var zone = await _tenants.ZoneAsync(TenantId);
        var today = WorkHelpers.Today(zone);
        var d = WorkHelpers.Day(day) ?? today;
        var mine = await _db.RowsAsync("dbo.sahyog_Standup_Mine", p => p.With("@TenantId", TenantId).With("@UserId", Me).With("@Day", d.ToDateTime(TimeOnly.MinValue)));
        var all = await _db.RowsAsync("dbo.sahyog_Standup_List", p => p.With("@TenantId", TenantId));
        var m = await ManageableAsync();
        foreach (var s in all) s["canEdit"] = CanManage(m, s.GN("departmentId"));
        var now = MeetingCalendar.ToLocal(DateTime.UtcNow, zone);
        Response.Headers.CacheControl = "no-store";
        return Json(new
        {
            day = WorkHelpers.Iso(d), today = WorkHelpers.Iso(today), dow = WorkHelpers.Dow(d),
            nowMinutes = now.Hour * 60 + now.Minute,
            mine, standups = all, canCreate = m.Everyone || m.Depts.Count > 0, canEveryone = m.Everyone,
            manageDepts = m.Depts
        });
    }

    /// <summary>Stand-ups I still have to answer today whose time has come (for a reminder when the app opens).</summary>
    [HttpGet("due")]
    public async Task<IActionResult> Due()
    {
        var zone = await _tenants.ZoneAsync(TenantId);
        var now = MeetingCalendar.ToLocal(DateTime.UtcNow, zone);
        var today = DateOnly.FromDateTime(now);
        var mins = now.Hour * 60 + now.Minute;
        var mine = await _db.RowsAsync("dbo.sahyog_Standup_Mine", p => p.With("@TenantId", TenantId).With("@Day", today.ToDateTime(TimeOnly.MinValue)).With("@UserId", Me));
        return Json(mine.Where(s => s["answeredUtc"] is null && ((s.I("days") >> WorkHelpers.Dow(today)) & 1) == 1 && s.I("atMinutes") <= mins)
            .Select(s => new { standupId = s.I("standupId"), name = s.S("name") }));
    }

    [HttpGet("{id:int}/rollup")]
    public async Task<IActionResult> Rollup(int id, string? day)
    {
        var zone = await _tenants.ZoneAsync(TenantId);
        var d = WorkHelpers.Day(day) ?? WorkHelpers.Today(zone);
        var sets = await _db.SetsAsync("dbo.sahyog_Standup_Rollup", p => p.With("@TenantId", TenantId).With("@StandupId", id).With("@Day", d.ToDateTime(TimeOnly.MinValue)));
        if (sets.Count == 0 || sets[0].Count == 0) return Fail("That stand-up was deleted.", 404);
        var s = sets[0][0];
        var people = sets.Count > 1 ? sets[1] : new();
        // who may read it: the people in it, whoever set it up, its department's head, admins
        var m = await ManageableAsync();
        if (!IsAdmin && s.G("createdBy") != Me && !people.Any(x => x.G("userId") == Me) && !CanManage(m, s.GN("departmentId")))
            return Fail("Only the people in this stand-up can see its answers.", 403);
        s["canEdit"] = CanManage(m, s.GN("departmentId"));
        Response.Headers.CacheControl = "no-store";
        return Json(new { day = WorkHelpers.Iso(d), standup = s, people, runsToday = ((s.I("days") >> WorkHelpers.Dow(d)) & 1) == 1 });
    }

    public sealed class SaveInput
    {
        public int StandupId { get; set; }
        public string? Name { get; set; }
        public Guid? DepartmentId { get; set; }
        public List<int>? Days { get; set; }
        public string? At { get; set; }
        public string? Q1 { get; set; }
        public string? Q2 { get; set; }
        public string? Q3 { get; set; }
        public bool IsActive { get; set; } = true;
    }

    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] SaveInput input)
    {
        var name = WorkHelpers.Clip(input.Name, 80);
        if (name is null) return Fail("Give the stand-up a name.");
        var m = await ManageableAsync();
        if (!CanManage(m, input.DepartmentId))
            return Fail(input.DepartmentId is null ? "Only an admin can set up a stand-up for everyone." : "Only an admin or the department's head can set up its stand-up.", 403);
        if (input.StandupId > 0)
        {
            var all = await _db.RowsAsync("dbo.sahyog_Standup_List", p => p.With("@TenantId", TenantId));
            var old = all.FirstOrDefault(s => s.I("standupId") == input.StandupId);
            if (old is null) return Fail("That stand-up was deleted.", 404);
            if (!CanManage(m, old.GN("departmentId"))) return Fail("You can't change this stand-up.", 403);
        }
        byte days = 0;
        foreach (var d in (input.Days ?? new()).Where(d => d is >= 0 and <= 6)) days |= (byte)(1 << d);
        if (days == 0) return Fail("Pick at least one day.");
        if (!TimeOnly.TryParseExact(input.At ?? "", "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var at)) return Fail("Pick a time.");
        var id = (await _db.RowAsync("dbo.sahyog_Standup_Save", p => p
            .With("@StandupId", input.StandupId == 0 ? null : input.StandupId).With("@TenantId", TenantId).With("@UserId", Me)
            .AddText("@Name", name, 80).With("@DepartmentId", input.DepartmentId).With("@Days", days).With("@AtMinutes", (short)(at.Hour * 60 + at.Minute))
            .AddText("@Q1", WorkHelpers.Clip(input.Q1, 150) ?? "What did you finish since the last stand-up?", 150)
            .AddText("@Q2", WorkHelpers.Clip(input.Q2, 150) ?? "What are you working on today?", 150)
            .AddText("@Q3", WorkHelpers.Clip(input.Q3, 150) ?? "Anything blocking you?", 150)
            .With("@IsActive", input.IsActive)))?.I("standupId") ?? 0;
        if (id == 0) return Fail("That stand-up was deleted.", 404);
        return Json(new { standupId = id });
    }

    [HttpPost("{id:int}/delete")]
    public async Task<IActionResult> Delete(int id)
    {
        var all = await _db.RowsAsync("dbo.sahyog_Standup_List", p => p.With("@TenantId", TenantId));
        var old = all.FirstOrDefault(s => s.I("standupId") == id);
        if (old is null) return Json(new { ok = true });
        if (!CanManage(await ManageableAsync(), old.GN("departmentId"))) return Fail("You can't delete this stand-up.", 403);
        await _db.RowsAsync("dbo.sahyog_Standup_Delete", p => p.With("@TenantId", TenantId).With("@StandupId", id));
        return Json(new { ok = true });
    }

    public sealed class AnswerInput
    {
        public string? Day { get; set; }
        public string? A1 { get; set; }
        public string? A2 { get; set; }
        public string? A3 { get; set; }
        public bool Blocker { get; set; }
    }

    [HttpPost("{id:int}/answer")]
    public async Task<IActionResult> Answer(int id, [FromBody] AnswerInput input)
    {
        var zone = await _tenants.ZoneAsync(TenantId);
        var today = WorkHelpers.Today(zone);
        var day = WorkHelpers.Day(input.Day) ?? today;
        if (day > today || day < today.AddDays(-7)) return Fail("You can answer for today, or change an answer from the last week.");
        string? a1 = WorkHelpers.Clip(input.A1, 1000), a2 = WorkHelpers.Clip(input.A2, 1000), a3 = WorkHelpers.Clip(input.A3, 1000);
        if (a1 is null && a2 is null && a3 is null) return Fail("Write at least one answer.");
        var r = await _db.RowAsync("dbo.sahyog_Standup_Answer", p => p
            .With("@TenantId", TenantId).With("@StandupId", id).With("@UserId", Me).With("@Day", day.ToDateTime(TimeOnly.MinValue))
            .AddText("@A1", a1, 1000).AddText("@A2", a2, 1000).AddText("@A3", a3, 1000).With("@HasBlocker", input.Blocker));
        if (r is null || !r.B("saved")) return Fail("You're not in this stand-up.", 403);
        await _hub.Clients.Group(ChatHub.TenantGroup(TenantId)).SendAsync("StandupAnswered", id, WorkHelpers.Iso(day));
        // a new blocker: tell the manager and whoever set the stand-up up
        if (input.Blocker && !r.B("wasBlocked"))
        {
            var tell = new[] { r.GN("managerId"), r.GN("createdBy") }.Where(x => x is Guid g && g != Me).Select(x => x!.Value.ToString()).Distinct().ToList();
            if (tell.Count > 0)
                await _hub.Clients.Users(tell).SendAsync("StandupBlocker", r.S("displayName"), r.S("name"), a3 ?? a2 ?? a1, id);
        }
        return Json(new { ok = true });
    }
}
