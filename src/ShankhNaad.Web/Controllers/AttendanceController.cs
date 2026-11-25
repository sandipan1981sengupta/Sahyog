using System.Globalization;
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
/// Attendance sheet of a call or meeting (database/42_MeetingAttendance.sql): who joined, when, for how long.
/// From the call: see it live, print it, download it (Excel) or attach it to the call's chat and the chat it was started from.
/// Open to the host, workspace admins and anyone who was in the call.
/// </summary>
[Authorize(Roles = AppRoles.TenantAdmin + "," + AppRoles.Member), Route("meetings/{id:guid}/attendance")]
public sealed class AttendanceController : Controller
{
    private readonly IAttendanceService _attendance;
    private readonly IMeetingService _meetings;
    private readonly ITenantService _tenants;
    private readonly MeetingRoomTracker _rooms;
    private const string NeedsDatabase = "The attendance sheet needs the database update database/42_MeetingAttendance.sql. Ask CloudWheel to run it.";

    public AttendanceController(IAttendanceService attendance, IMeetingService meetings, ITenantService tenants, MeetingRoomTracker rooms)
    {
        _attendance = attendance;
        _meetings = meetings;
        _tenants = tenants;
        _rooms = rooms;
    }

    private Guid Me => User.UserGuid();

    private sealed record Sheet(MeetingDto Meeting, AttendanceSheetDto Data, TimeZoneInfo Zone, string Workspace);

    /// <summary>The sheet, or null when this person may not see it.</summary>
    private async Task<Sheet?> LoadAsync(Guid id)
    {
        if (User.TenantId() is not Guid tenantId) return null;
        var meeting = await _meetings.GetAsync(tenantId, id);
        if (meeting is null) return null;
        var data = await _attendance.GetAsync(tenantId, id);
        var allowed = meeting.HostId == Me || User.IsInRole(AppRoles.TenantAdmin)
                      || _rooms.Contains(id, Me.ToString()) || data.Rows.Any(r => r.UserId == Me);
        if (!allowed) return null;
        var limits = await _tenants.GetLimitsAsync(tenantId);
        return new Sheet(meeting, data, MeetingCalendar.FindZone(limits?.TimeZoneId), limits?.TenantName ?? User.TenantName() ?? "");
    }

    private static string Local(DateTime utc, TimeZoneInfo zone, string format) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone).ToString(format, CultureInfo.InvariantCulture);

    public static string Duration(int seconds)
    {
        if (seconds < 60) return seconds <= 0 ? "less than a minute" : $"{seconds}s";
        var t = TimeSpan.FromSeconds(seconds);
        return t.TotalHours >= 1 ? $"{(int)t.TotalHours}h {t.Minutes:00}m" : $"{t.Minutes}m {t.Seconds:00}s";
    }

    private static string FileName(MeetingDto m, DateTime? startedUtc, TimeZoneInfo zone)
    {
        var day = startedUtc is DateTime s ? Local(s, zone, "yyyy-MM-dd") : DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var title = new string((m.Title ?? "Call").Where(c => char.IsLetterOrDigit(c) || c is ' ' or '-' or '_').ToArray()).Trim();
        if (title.Length == 0) title = "Call";
        if (title.Length > 60) title = title[..60];
        return $"Attendance - {title} - {day}.xlsx";
    }

    // ---------- see it ----------

    /// <summary>The sheet as JSON, for the Attendance panel in the call (refreshes while the call goes on).</summary>
    [HttpGet("")]
    public async Task<IActionResult> Get(Guid id)
    {
        var sheet = await LoadAsync(id);
        if (sheet is null) return NotFound();
        if (!sheet.Data.Ready) return Json(new { ready = false, error = NeedsDatabase });
        var z = sheet.Zone;
        return Json(new
        {
            ready = true,
            title = sheet.Meeting.Title,
            started = sheet.Data.StartedUtc is DateTime s ? Local(s, z, "h:mm tt") : "",
            ended = sheet.Data.EndedUtc is DateTime e ? Local(e, z, "h:mm tt") : "",
            day = sheet.Data.StartedUtc is DateTime d ? Local(d, z, "ddd d MMM yyyy") : "",
            count = sheet.Data.Rows.Count,
            inCall = sheet.Data.Rows.Count(r => r.InCall),
            canShare = _rooms.Contains(id, Me.ToString()),
            rows = sheet.Data.Rows.Select(r => new
            {
                id = r.UserId?.ToString() ?? "",
                name = r.Name, email = r.Email ?? "", guest = r.IsGuest, tone = r.AvatarTone,
                title = string.Join(" · ", new[] { r.JobTitle, r.DepartmentName }.Where(x => !string.IsNullOrWhiteSpace(x))),
                joined = Local(r.FirstJoinUtc, z, "h:mm tt"),
                left = r.InCall ? "" : r.LeftUtc is DateTime l ? Local(l, z, "h:mm tt") : "",
                time = Duration(r.Seconds), seconds = r.Seconds, joins = r.Joins, inCall = r.InCall
            })
        });
    }

    /// <summary>A page made for printing (or "Save as PDF"); ?print=1 opens the print window straight away.</summary>
    [HttpGet("print")]
    public async Task<IActionResult> Print(Guid id, int? print)
    {
        var sheet = await LoadAsync(id);
        if (sheet is null) return NotFound();
        ViewData["AutoPrint"] = print == 1;
        return View("~/Views/Meetings/AttendancePrint.cshtml", new AttendancePrintVm(sheet.Meeting, sheet.Data, sheet.Zone, sheet.Workspace,
            User.DisplayName(), DateTime.UtcNow));
    }

    /// <summary>Excel file of the sheet.</summary>
    [HttpGet("xlsx")]
    public async Task<IActionResult> Excel(Guid id)
    {
        var sheet = await LoadAsync(id);
        if (sheet is null) return NotFound();
        if (!sheet.Data.Ready) return Content(NeedsDatabase);
        return File(BuildXlsx(sheet), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            FileName(sheet.Meeting, sheet.Data.StartedUtc, sheet.Zone));
    }

    private byte[] BuildXlsx(Sheet sheet)
    {
        var z = sheet.Zone;
        var d = sheet.Data;
        var x = new XlsxWriter().Widths(5, 26, 32, 30, 11, 11, 14, 9, 14);
        x.Row(2, "Attendance · " + sheet.Meeting.Title);
        x.Row(0, "Workspace", sheet.Workspace);
        x.Row(0, "Date", d.StartedUtc is DateTime s ? Local(s, z, "dddd, d MMMM yyyy") : "");
        x.Row(0, "Started", d.StartedUtc is DateTime s2 ? Local(s2, z, "h:mm tt") : "",
                 "Ended", d.EndedUtc is DateTime e ? Local(e, z, "h:mm tt") : "still going on");
        x.Row(0, "Host", sheet.Meeting.HostName);
        x.Row(0, "People", d.Rows.Count, "Team members", d.Rows.Count(r => !r.IsGuest), "Guests", d.Rows.Count(r => r.IsGuest));
        x.Blank();
        x.Row(3, "#", "Name", "Email", "Job title · Department", "Joined", "Left", "Time in call", "Times joined", "Status");
        x.FreezeAfter(8);
        var n = 0;
        foreach (var r in d.Rows)
            x.Row(0, ++n, r.Name, r.IsGuest ? "Guest" : r.Email ?? "",
                string.Join(" · ", new[] { r.JobTitle, r.DepartmentName }.Where(v => !string.IsNullOrWhiteSpace(v))),
                Local(r.FirstJoinUtc, z, "h:mm tt"),
                r.InCall ? "" : r.LeftUtc is DateTime l ? Local(l, z, "h:mm tt") : "",
                Duration(r.Seconds), r.Joins, r.InCall ? "In the call" : "Left");
        x.Blank();
        x.Row(4, $"Made with ShankhNaad by {User.DisplayName()} on {Local(DateTime.UtcNow, z, "d MMM yyyy, h:mm tt")} ({z.DisplayName}).");
        return x.Build("Attendance");
    }

    // ---------- keep it up to date ----------

    /// <summary>Guests in the call now (their names), sent every minute by people in the call.</summary>
    [HttpPost("guests")]
    public async Task<IActionResult> Guests(Guid id, [FromForm] List<string>? names)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        if (!_rooms.Contains(id, Me.ToString())) return Json(new { ok = false });
        await _attendance.GuestsAsync(tenantId, id, Me, names ?? new List<string>());
        return Json(new { ok = true });
    }

    // ---------- attach it to the chats ----------

    /// <summary>
    /// Attaches the Excel sheet to the call's chat (everyone in the call sees it now) and, for a call started
    /// from a chat, to that chat too (it stays there with the other files).
    /// </summary>
    [HttpPost("share")]
    public async Task<IActionResult> Share(Guid id, [FromServices] ICallChatService callChat, [FromServices] IChatService chat,
        [FromServices] IFileStorage files, [FromServices] IHubContext<ChatHub> hub)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var sheet = await LoadAsync(id);
        if (sheet is null) return NotFound();
        if (!sheet.Data.Ready) return BadRequest(new { error = NeedsDatabase });
        if (sheet.Data.Rows.Count == 0) return BadRequest(new { error = "No one is on the sheet yet." });

        var bytes = BuildXlsx(sheet);
        var name = FileName(sheet.Meeting, sheet.Data.StartedUtc, sheet.Zone);
        const string type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        var sentTo = new List<string>();

        // 1) the call's chat
        if (_rooms.Contains(id, Me.ToString()))
        {
            string path;
            using (var ms = new MemoryStream(bytes)) path = await files.SaveAsync(tenantId, ms, ".xlsx", HttpContext.RequestAborted);
            var (status, message) = await callChat.AddAsync(tenantId, id, Me, User.DisplayName(), User.AvatarTone(), null,
                Guid.NewGuid(), name, type, bytes.Length, path);
            if (status == 0 && message is not null)
            {
                await hub.Clients.Group(ChatHub.MeetingGroup(id)).SendAsync("CallChat", message);
                sentTo.Add("the call chat");
            }
            else files.Delete(path);
        }

        // 2) the chat the call was started from (group or one-to-one), if you're in it
        if (sheet.Meeting.ChannelId is Guid channelId && await chat.IsMemberAsync(tenantId, channelId, Me))
        {
            string path;
            using (var ms = new MemoryStream(bytes)) path = await files.SaveAsync(tenantId, ms, ".xlsx", HttpContext.RequestAborted);
            var (status, message) = await chat.SendFileAsync(new SendFileRequest(tenantId, channelId, Me, Guid.NewGuid(), name, type, bytes.Length, path));
            if (status == SendStatus.Ok && message is not null)
            {
                if (await chat.GetChannelAsync(tenantId, channelId) is { IsDirect: false } group)
                    message = message with { FromGroup = group.Name };
                await hub.Clients.Group(ChatHub.ChannelGroup(channelId)).SendAsync("MessageReceived", message);
                sentTo.Add(sheet.Meeting.ChannelIsDirect ? "your chat with " + (sheet.Meeting.ChannelName ?? "them") : "the group chat " + (sheet.Meeting.ChannelName ?? ""));
            }
            else
            {
                files.Delete(path);
                if (status == SendStatus.StorageFull) return BadRequest(new { error = "Storage full. Ask your admin to upgrade the plan." });
            }
        }

        if (sentTo.Count == 0) return BadRequest(new { error = "Join the call to attach the sheet to its chat." });
        return Json(new { ok = true, file = name, sentTo });
    }
}

/// <summary>The printable attendance sheet (Views/Meetings/AttendancePrint.cshtml).</summary>
public sealed record AttendancePrintVm(MeetingDto Meeting, AttendanceSheetDto Data, TimeZoneInfo Zone, string Workspace, string MadeBy, DateTime MadeUtc);
