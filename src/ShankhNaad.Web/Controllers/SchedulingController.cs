using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.ServiceLibrary.Data;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Smart scheduling for the Meetings page (js/meeting-smart.js):
///  • suggest: the next times when you and everyone invited are free (their meetings, out of office, weekends and holidays skipped);
///  • load: how much of your week is meetings (with a nudge when it's a lot);
///  • holidays: the workspace's holidays (admins add them; database/50_Scheduling.sql).
/// The cost line ("6 people × 1 h = 6 working hours") is worked out in the browser.
/// </summary>
[Route("meetings/smart")]
public sealed class SchedulingController : WorkControllerBase
{
    private const int DayStart = 9 * 60 + 30, DayEnd = 18 * 60 + 30, LunchFrom = 13 * 60, LunchTo = 14 * 60;
    private const int WorkWeekMinutes = 5 * (DayEnd - DayStart);

    private readonly IMeetingService _meetings;
    private readonly ITenantService _tenants;
    private readonly IOutOfOfficeService _ooo;
    private readonly IUserService _users;
    private readonly IWorkData _db;

    public SchedulingController(IMeetingService meetings, ITenantService tenants, IOutOfOfficeService ooo, IUserService users, IWorkData db)
    {
        _meetings = meetings;
        _tenants = tenants;
        _ooo = ooo;
        _users = users;
        _db = db;
    }

    private async Task<List<(DateOnly Day, string Name)>> HolidaysAsync(DateOnly from, DateOnly to)
    {
        try
        {
            var rows = await _db.RowsAsync("dbo.sahyog_Holiday_List", p => p.With("@TenantId", TenantId)
                .With("@From", from.ToDateTime(TimeOnly.MinValue)).With("@To", to.ToDateTime(TimeOnly.MinValue)));
            return rows.Where(r => r.Day("day") is not null).Select(r => (r.Day("day")!.Value, r.S("name") ?? "Holiday")).ToList();
        }
        catch (Microsoft.Data.SqlClient.SqlException) { return new(); }   // 50_Scheduling.sql not run yet: no holidays
    }

    /// <summary>A person's busy times (local), from their meetings (not "free" all-day ones, not cancelled).</summary>
    private async Task<List<(DateTime From, DateTime To)>> BusyAsync(Guid userId, DateTime fromLocal, DateTime toLocal, TimeZoneInfo zone)
    {
        var (meetings, _) = await _meetings.ListForUserAsync(TenantId, userId, MeetingCalendar.ToUtc(fromLocal, zone).AddDays(-1), MeetingCalendar.ToUtc(toLocal, zone));
        meetings = await _meetings.WithExceptionsAsync(TenantId, meetings);
        return MeetingCalendar.Expand(meetings.Where(m => !m.IsInstant && !m.IsCancelled && !(m.IsAllDay && m.ShowAsFree)), fromLocal, toLocal, zone)
            .Select(o => (o.StartLocal, o.EndLocal)).ToList();
    }

    /// <summary>/meetings/smart/suggest?people=id,id&amp;minutes=60&amp;from=yyyy-MM-dd → up to 6 times in the next working days.</summary>
    [HttpGet("suggest")]
    public async Task<IActionResult> Suggest(string? people, int minutes = 30, string? from = null)
    {
        minutes = Math.Clamp(minutes, 15, 8 * 60);
        var zone = await _tenants.ZoneAsync(TenantId);
        var nowLocal = MeetingCalendar.ToLocal(DateTime.UtcNow, zone);
        var start = WorkHelpers.Day(from) is DateOnly f && f > DateOnly.FromDateTime(nowLocal) ? f : DateOnly.FromDateTime(nowLocal);
        var end = start.AddDays(14);

        var team = (await _users.ListByTenantAsync(TenantId)).Where(u => u.IsActive).ToDictionary(u => u.UserId);
        var ids = new List<Guid> { Me };
        foreach (var part in (people ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            if (Guid.TryParse(part, out var g) && team.ContainsKey(g) && !ids.Contains(g)) ids.Add(g);
        if (ids.Count > 30) ids = ids.Take(30).ToList();

        var fromLocal = start.ToDateTime(TimeOnly.MinValue);
        var toLocal = end.ToDateTime(TimeOnly.MinValue);
        var busy = new Dictionary<Guid, List<(DateTime From, DateTime To)>>();
        foreach (var id in ids) busy[id] = await BusyAsync(id, fromLocal, toLocal, zone);
        var ooo = await _ooo.ListAsync(TenantId);
        foreach (var id in ids)
            if (ooo.TryGetValue(id.ToString(), out var o))
            {
                var a = MeetingCalendar.ToLocal(o.StartUtc ?? o.SinceUtc, zone);
                var b = o.UntilUtc is DateTime u ? MeetingCalendar.ToLocal(u, zone) : toLocal.AddDays(365);
                busy[id].Add((a, b));
            }
        var holidays = await HolidaysAsync(start, end);
        var holidaySet = holidays.Select(h => h.Day).ToHashSet();

        var slots = new List<(DateTime At, int Free, List<Guid> Busy, int Score)>();
        for (var day = start; day < end; day = day.AddDays(1))
        {
            if (day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday || holidaySet.Contains(day)) continue;
            for (var m = DayStart; m + minutes <= DayEnd; m += 30)
            {
                var at = day.ToDateTime(TimeOnly.MinValue).AddMinutes(m);
                if (at < nowLocal.AddMinutes(15)) continue;
                var until = at.AddMinutes(minutes);
                var who = ids.Where(id => busy[id].Any(x => x.From < until && at < x.To)).ToList();
                if (who.Contains(Me)) continue;                                  // you have to be free
                var score = who.Count * 1000 + (m < LunchTo && m + minutes > LunchFrom ? 50 : 0) + (day.DayNumber - start.DayNumber) * 2;
                slots.Add((at, ids.Count - who.Count, who, score));
            }
        }
        var best = slots.Where(s => s.Busy.Count == 0).Take(6).ToList();
        var partial = best.Count >= 3 ? new List<(DateTime At, int Free, List<Guid> Busy, int Score)>() : slots.Where(s => s.Busy.Count > 0).OrderBy(s => s.Score).Take(6 - best.Count).OrderBy(s => s.At).ToList();
        string Name(Guid g) => team.TryGetValue(g, out var u) ? u.DisplayName : "Someone";
        object Out((DateTime At, int Free, List<Guid> Busy, int Score) s) => new
        {
            date = s.At.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture),
            iso = s.At.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture),
            time = s.At.ToString("HH:mm", CultureInfo.InvariantCulture),
            free = s.Free, total = ids.Count,
            busy = s.Busy.Select(Name).ToList(),
            away = s.Busy.Where(b => ooo.TryGetValue(b.ToString(), out var o) && WorkHelpers.IsAway(o, MeetingCalendar.ToUtc(s.At, zone))).Select(Name).ToList()
        };
        return Json(new
        {
            people = ids.Count, minutes,
            slots = best.Select(Out).Concat(partial.Select(Out)),
            holidays = holidays.Select(h => new { day = WorkHelpers.Iso(h.Day), name = h.Name }),
            hours = $"{DayStart / 60}:{DayStart % 60:00}–{DayEnd / 60}:{DayEnd % 60:00}"
        });
    }

    /// <summary>Your meeting time this week and next (for the bar on the Meetings page).</summary>
    [HttpGet("load")]
    public async Task<IActionResult> Load()
    {
        var zone = await _tenants.ZoneAsync(TenantId);
        var today = WorkHelpers.Today(zone);
        var monday = MeetingCalendar.WeekOf(today);
        var busy = await BusyAsync(Me, monday.ToDateTime(TimeOnly.MinValue), monday.AddDays(14).ToDateTime(TimeOnly.MinValue), zone);
        object Week(DateOnly mon)
        {
            var a = mon.ToDateTime(TimeOnly.MinValue);
            var b = a.AddDays(5);       // Monday–Friday
            var list = busy.Where(x => x.From < b && a < x.To && (x.To - x.From).TotalHours < 12).ToList();
            var mins = (int)list.Sum(x => (Min(x.To, b) - Max(x.From, a)).TotalMinutes);
            return new { from = WorkHelpers.Iso(mon), minutes = mins, meetings = list.Count, percent = (int)Math.Round(100.0 * mins / WorkWeekMinutes) };
        }
        return Json(new { thisWeek = Week(monday), nextWeek = Week(monday.AddDays(7)), workWeekMinutes = WorkWeekMinutes });
    }

    private static DateTime Min(DateTime a, DateTime b) => a < b ? a : b;
    private static DateTime Max(DateTime a, DateTime b) => a > b ? a : b;

    [HttpGet("holidays"), NeedsScript("50_Scheduling.sql")]
    public async Task<IActionResult> Holidays(int? year)
    {
        var y = year ?? WorkHelpers.Today(await _tenants.ZoneAsync(TenantId)).Year;
        var rows = await _db.RowsAsync("dbo.sahyog_Holiday_List", p => p.With("@TenantId", TenantId)
            .With("@From", new DateTime(y, 1, 1)).With("@To", new DateTime(y, 12, 31)));
        return Json(new { year = y, holidays = rows, canEdit = IsAdmin });
    }

    public sealed class HolidayInput { public string? Day { get; set; } public string? Name { get; set; } }

    [HttpPost("holidays"), NeedsScript("50_Scheduling.sql")]
    public async Task<IActionResult> SaveHoliday([FromBody] HolidayInput input)
    {
        if (!IsAdmin) return Fail("Only an admin can change holidays.", 403);
        if (WorkHelpers.Day(input.Day) is not DateOnly d) return Fail("Pick a date.");
        var name = WorkHelpers.Clip(input.Name, 100);
        if (name is null) return Fail("Name the holiday, e.g. Diwali.");
        var r = await _db.RowAsync("dbo.sahyog_Holiday_Save", p => p.With("@TenantId", TenantId).With("@Day", d.ToDateTime(TimeOnly.MinValue)).AddText("@Name", name, 100));
        return Json(r);
    }

    [HttpPost("holidays/{id:int}/delete"), NeedsScript("50_Scheduling.sql")]
    public async Task<IActionResult> DeleteHoliday(int id)
    {
        if (!IsAdmin) return Fail("Only an admin can change holidays.", 403);
        await _db.RowsAsync("dbo.sahyog_Holiday_Delete", p => p.With("@TenantId", TenantId).With("@HolidayId", id));
        return Json(new { ok = true });
    }
}
