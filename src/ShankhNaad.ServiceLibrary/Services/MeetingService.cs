using System.Data;
using System.Net;
using System.Security.Cryptography;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>Meetings: schedule, list for the calendar, cancel, guest links, email invites.</summary>
public interface IMeetingService
{
    Task CreateAsync(CreateMeetingRequest request);
    Task<MeetingListDto> ListForUserAsync(Guid tenantId, Guid userId, DateTime fromUtc, DateTime toUtc);
    Task<MeetingDto?> GetAsync(Guid tenantId, Guid meetingId);
    Task<List<InviteeDto>> GetInviteesAsync(Guid tenantId, Guid meetingId);
    Task<DeleteMeetingResultDto> DeleteAsync(Guid tenantId, Guid meetingId, Guid userId, bool isAdmin);
    Task<GuestMeetingDto?> GetByGuestCodeAsync(string code);
    /// <param name="respondUrl">Optional: each person's own link to answer (the email then has Accept / Maybe / Decline buttons; "?r=yes|maybe|no" is added).</param>
    Task SendInvitesAsync(MeetingDto meeting, IReadOnlyList<InviteeDto> invitees, string hostName, string hostEmail, TimeZoneInfo zone,
        Func<InviteeDto, string?>? respondUrl = null);
    /// <summary>Saves a person's answer (userId for a team member, guestEmail for a guest; date null = whole meeting / series).</summary>
    Task<RespondStatus> SetResponseAsync(Guid tenantId, Guid meetingId, Guid? userId, string? guestEmail, DateOnly? date, MeetingResponse response, string? note);
    /// <summary>The answers for these meetings (36_MeetingResponses.sql; without it: none).</summary>
    Task<List<MeetingResponseDto>> GetResponsesAsync(Guid tenantId, IEnumerable<Guid> meetingIds);
    /// <summary>"Sandy started Project planning · Join": to everyone invited except the people listed in skip (keys).</summary>
    Task<int> SendStartedAsync(MeetingDto meeting, IReadOnlyList<InviteeDto> invitees, string startedBy, string hostEmail, TimeZoneInfo zone, ISet<string> skip);
    /// <summary>Cancels a meeting (a repeating meeting: the whole series). It stays on calendars, marked cancelled.</summary>
    Task<CancelMeetingStatus> CancelAsync(Guid tenantId, Guid meetingId, Guid userId, bool isAdmin, string? note);
    /// <summary>Removes a cancelled meeting from one person's calendar.</summary>
    Task<HideMeetingStatus> HideAsync(Guid tenantId, Guid meetingId, Guid userId);
    /// <summary>Tells everyone invited (team and guests) that the meeting is cancelled, with a calendar cancellation (.ics).</summary>
    Task<int> SendCancellationAsync(MeetingDto meeting, IReadOnlyList<InviteeDto> invitees, string cancelledBy, string hostEmail, TimeZoneInfo zone, string? note);
    string RoomUrl(Guid meetingId);
    string GuestUrl(string code);
    /// <summary>The cancelled / moved single dates of these meetings, added to each (35_MeetingChanges.sql; without it: none).</summary>
    Task<List<MeetingDto>> WithExceptionsAsync(Guid tenantId, IEnumerable<MeetingDto> meetings);
    /// <summary>Cancels (newStartUtc null) or moves one date of a repeating meeting.</summary>
    Task<MeetingChangeStatus> SetExceptionAsync(Guid tenantId, Guid meetingId, Guid userId, bool isAdmin, DateOnly occurrenceDate, bool cancel, DateTime? newStartUtc, int? newMinutes);
    /// <summary>Edits a meeting (a repeating one: the whole series).</summary>
    Task<MeetingChangeStatus> UpdateAsync(Guid tenantId, Guid meetingId, Guid userId, bool isAdmin, string title, string? agenda, DateTime startUtc, int minutes, bool keepCancelledDates);
    /// <summary>Emails everyone invited (team and guests) what changed, with a calendar update (.ics).</summary>
    Task<int> SendChangeAsync(MeetingDto meeting, IReadOnlyList<InviteeDto> invitees, string changedBy, string hostEmail, TimeZoneInfo zone,
        MeetingChangeKind kind, DateTime oldStartLocal, int oldMinutes, DateTime newStartLocal, int newMinutes, DateOnly? occurrenceDate, string? note);
}

public sealed class MeetingService : IMeetingService
{
    private readonly SqlDb _db;
    private readonly IAppEmailSender _email;
    private readonly AppOptions _app;

    public MeetingService(SqlDb db, IAppEmailSender email, IOptions<AppOptions> app)
    {
        _db = db;
        _email = email;
        _app = app.Value;
    }

    private static MeetingDto MapMeeting(SqlDataReader r) => new(
        r.G("MeetingId"), r.S("Title"), r.SN("Agenda"), r.Utc("StartUtc"), r.I("DurationMinutes"),
        (MeetingRecurrence)r.I("Recurrence"), r.S("RoomName"), r.S("GuestCode"), r.G("HostId"), r.S("HostName"), r.I("HostTone"),
        r.GN("ChannelId"), r.B("IsInstant"), r.B("GuestLinkEnabled"), r.B("LobbyEnabled"), r.B("CaptionsOn"))
    {
        IsAllDay = r.BOpt("IsAllDay"),
        ShowAsFree = r.BOpt("ShowAsFree"),
        RepeatDays = (byte)r.IOpt("RepeatDays"),
        RepeatUntilUtc = r.UtcOpt("RepeatUntilUtc"),
        // 34_MeetingCancel.sql: older databases don't return these columns
        CancelledUtc = r.UtcOpt("CancelledUtc"),
        CancelledByName = r.Has("CancelledByName") ? r.SN("CancelledByName") : null,
        CancelNote = r.Has("CancelNote") ? r.SN("CancelNote") : null
    };

    private static InviteeDto MapInvitee(SqlDataReader r) => new(
        r.G("MeetingId"), r.GN("UserId"), r.SN("DisplayName"), r.IN("AvatarTone"), r.SN("Email"), r.SN("GuestEmail"));

    public string RoomUrl(Guid meetingId) => $"{_app.PublicBaseUrl.TrimEnd('/')}/meetings/room/{meetingId}";
    public string GuestUrl(string code) => $"{_app.PublicBaseUrl.TrimEnd('/')}/join/{code}";

    public Task CreateAsync(CreateMeetingRequest m) =>
        _db.ExecAsync("dbo.sahyog_Meeting_Create", p =>
        {
            Fill(p, m);
            // only sent for all-day events, so normal meetings keep working before 05_AllDayAndMessageDelete.sql is run
            if (m.IsAllDay) p.With("@IsAllDay", true).With("@ShowAsFree", m.ShowAsFree);
            // only sent for custom days or an end date, so plain meetings keep working before 06_CustomRepeat.sql is run
            if (m.RepeatDays != 0) p.With("@RepeatDays", m.RepeatDays);
            if (m.RepeatUntilUtc is DateTime until) p.AddDateTime2("@RepeatUntilUtc", until);
        });

    private static void Fill(SqlParameterCollection p, CreateMeetingRequest m) => p
            .With("@TenantId", m.TenantId)
            .With("@MeetingId", m.MeetingId)
            .AddText("@Title", m.Title, 150)
            .AddText("@Agenda", m.Agenda, 2000)
            .AddDateTime2("@StartUtc", m.StartUtc)
            .With("@DurationMinutes", m.DurationMinutes)
            .With("@Recurrence", (byte)m.Recurrence)
            .AddText("@RoomName", string.IsNullOrEmpty(m.RoomName) ? MeetingCalendar.NewRoomName() : m.RoomName, 80)
            .AddText("@GuestCode", string.IsNullOrEmpty(m.GuestCode) ? MeetingCalendar.NewGuestCode() : m.GuestCode, 16)
            .With("@HostId", m.HostId)
            .With("@ChannelId", m.ChannelId)
            .With("@IsInstant", m.IsInstant)
            .With("@GuestLinkEnabled", m.GuestLinkEnabled)
            .With("@LobbyEnabled", m.LobbyEnabled)
            .With("@CaptionsOn", m.CaptionsOn)
            .AddGuidList("@InviteeIds", m.InviteeIds)
            .AddEmailList("@GuestEmails", m.GuestEmails);

    public async Task<MeetingListDto> ListForUserAsync(Guid tenantId, Guid userId, DateTime fromUtc, DateTime toUtc)
    {
        var (meetings, invitees) = await _db.QueryMultipleAsync("dbo.sahyog_Meeting_ListForUser",
            p => p.With("@TenantId", tenantId).With("@UserId", userId).AddDateTime2("@FromUtc", fromUtc).AddDateTime2("@ToUtc", toUtc),
            MapMeeting, MapInvitee);
        return new MeetingListDto(meetings, invitees);
    }

    public Task<MeetingDto?> GetAsync(Guid tenantId, Guid meetingId) =>
        _db.QueryFirstAsync("dbo.sahyog_Meeting_Get", p => p.With("@TenantId", tenantId).With("@MeetingId", meetingId),
            r => MapMeeting(r) with
            {
                ChannelName = r.SN("ChannelName"),
                ChannelIsDirect = r.IN("ChannelIsDirect") == 1
            });

    public Task<List<InviteeDto>> GetInviteesAsync(Guid tenantId, Guid meetingId) =>
        _db.QueryAsync("dbo.sahyog_Meeting_GetInvitees", p => p.With("@TenantId", tenantId).With("@MeetingId", meetingId), MapInvitee);

    public async Task<DeleteMeetingResultDto> DeleteAsync(Guid tenantId, Guid meetingId, Guid userId, bool isAdmin)
    {
        SqlParameter? result = null;
        SqlParameter? start = null;
        await _db.ExecAsync("dbo.sahyog_Meeting_Delete", p =>
        {
            p.With("@TenantId", tenantId).With("@MeetingId", meetingId).With("@UserId", userId).With("@IsAdmin", isAdmin);
            result = p.AddOutput("@Result", SqlDbType.Int);
            start = p.AddOutput("@StartUtc", SqlDbType.DateTime2);
        });
        DateTime? startUtc = start!.Value is DateTime d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null;
        return new DeleteMeetingResultDto((DeleteMeetingStatus)result!.OutInt(), startUtc);
    }

    private const int MissingProcedure = 2812;

    public async Task<CancelMeetingStatus> CancelAsync(Guid tenantId, Guid meetingId, Guid userId, bool isAdmin, string? note)
    {
        SqlParameter? result = null;
        try
        {
            await _db.ExecAsync("dbo.sahyog_Meeting_Cancel", p =>
            {
                p.With("@TenantId", tenantId).With("@MeetingId", meetingId).With("@UserId", userId).With("@IsAdmin", isAdmin)
                 .AddText("@Note", string.IsNullOrWhiteSpace(note) ? null : note.Trim(), 500);
                result = p.AddOutput("@Result", SqlDbType.Int);
            });
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return CancelMeetingStatus.NeedsDatabase; }
        return (CancelMeetingStatus)result!.OutInt();
    }

    public async Task<HideMeetingStatus> HideAsync(Guid tenantId, Guid meetingId, Guid userId)
    {
        SqlParameter? result = null;
        try
        {
            await _db.ExecAsync("dbo.sahyog_Meeting_Hide", p =>
            {
                p.With("@TenantId", tenantId).With("@MeetingId", meetingId).With("@UserId", userId);
                result = p.AddOutput("@Result", SqlDbType.Int);
            });
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return HideMeetingStatus.NeedsDatabase; }
        return (HideMeetingStatus)result!.OutInt();
    }

    public async Task<int> SendCancellationAsync(MeetingDto meeting, IReadOnlyList<InviteeDto> invitees, string cancelledBy, string hostEmail, TimeZoneInfo zone, string? note)
    {
        var emails = invitees.Select(i => i.UserId is not null ? i.Email : i.GuestEmail)
            .Where(e => !string.IsNullOrWhiteSpace(e)).Select(e => e!).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (!string.IsNullOrWhiteSpace(hostEmail) && !emails.Contains(hostEmail, StringComparer.OrdinalIgnoreCase)) emails.Add(hostEmail);   // the host's own calendar too
        if (emails.Count == 0) return 0;

        var startLocal = MeetingCalendar.ToLocal(meeting.StartUtc, zone);
        var when = meeting.IsAllDay
            ? $"{startLocal:dddd, d MMMM yyyy} · All day"
            : $"{startLocal:dddd, d MMMM yyyy} · {startLocal:h:mm tt} – {startLocal.AddMinutes(meeting.DurationMinutes):h:mm tt}";
        var repeat = MeetingCalendar.DescribeRepeat(meeting, zone);
        var series = repeat is not null;
        if (series) when += $" · {repeat}";
        var noteHtml = string.IsNullOrWhiteSpace(note) ? "" :
            $"""<p style="margin:0 0 18px;padding:14px 16px;border-radius:14px;background:#FEE2E2;color:#7F1D1D;font-style:italic">“{WebUtility.HtmlEncode(note.Trim()).Replace("\n", "<br>")}”</p>""";
        var html = $"""
            <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:28px;border-radius:24px;background:#F8FAFC">
              <p style="margin:0 0 6px;color:#B91C1C;font-size:13px;font-weight:600">{WebUtility.HtmlEncode(cancelledBy)} cancelled {(series ? "this meeting series (every meeting in it)" : "this meeting")}</p>
              <h2 style="margin:0 0 12px;color:#0F172A;text-decoration:line-through">{WebUtility.HtmlEncode(meeting.Title)}</h2>
              <p style="margin:0 0 18px;color:#334155">{WebUtility.HtmlEncode(when)}</p>
              {noteHtml}
              <p style="margin:0;color:#475569;font-size:13px">It's marked as cancelled in ShankhNaad, and the calendar file below removes it from Outlook or Google Calendar.</p>
              <p style="margin:20px 0 0;color:#64748B;font-size:12px">ShankhNaad by CloudWheel Ltd</p>
            </div>
            """;
        var ics = IcsBuilder.Build(meeting, meeting.HostName, hostEmail, emails, RoomUrl(meeting.MeetingId), cancel: true);
        var subject = series ? $"Cancelled: {meeting.Title} (all meetings in the series)" : $"Cancelled: {meeting.Title} · {startLocal:d MMM, h:mm tt}";
        return await _email.SendAsync(emails, subject, html, new EmailCalendarPart("cancel.ics", ics, "CANCEL")) ? emails.Count : 0;
    }

    public async Task<List<MeetingDto>> WithExceptionsAsync(Guid tenantId, IEnumerable<MeetingDto> meetings)
    {
        var list = meetings.ToList();
        var ids = list.Where(m => m.Recurrence != MeetingRecurrence.None).Select(m => m.MeetingId).Distinct().ToList();
        if (ids.Count == 0) return list;
        List<MeetingExceptionDto> rows;
        try
        {
            rows = await _db.QueryAsync("dbo.sahyog_Meeting_ListExceptions",
                p => p.With("@TenantId", tenantId).AddText("@MeetingIds", string.Join(",", ids), -1),
                r => new MeetingExceptionDto(r.G("MeetingId"), DateOnly.FromDateTime(r.GetDateTime(r.GetOrdinal("OccurrenceDate"))), r.B("IsCancelled"),
                    r.UtcN("NewStartUtc"), r.IN("NewDurationMinutes")));
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return list; }
        if (rows.Count == 0) return list;
        var byMeeting = rows.ToLookup(x => x.MeetingId);
        return list.Select(m => byMeeting.Contains(m.MeetingId) ? m with { Exceptions = byMeeting[m.MeetingId].ToList() } : m).ToList();
    }

    public async Task<MeetingChangeStatus> SetExceptionAsync(Guid tenantId, Guid meetingId, Guid userId, bool isAdmin, DateOnly occurrenceDate, bool cancel, DateTime? newStartUtc, int? newMinutes)
    {
        SqlParameter? result = null;
        try
        {
            await _db.ExecAsync("dbo.sahyog_Meeting_SetException", p =>
            {
                p.With("@TenantId", tenantId).With("@MeetingId", meetingId).With("@UserId", userId).With("@IsAdmin", isAdmin)
                 .With("@OccurrenceDate", occurrenceDate.ToDateTime(TimeOnly.MinValue)).With("@IsCancelled", cancel)
                 .AddDateTime2("@NewStartUtc", newStartUtc).With("@NewDurationMinutes", (object?)newMinutes ?? DBNull.Value);
                result = p.AddOutput("@Result", SqlDbType.Int);
            });
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return MeetingChangeStatus.NeedsDatabase; }
        return (MeetingChangeStatus)result!.OutInt();
    }

    public async Task<MeetingChangeStatus> UpdateAsync(Guid tenantId, Guid meetingId, Guid userId, bool isAdmin, string title, string? agenda, DateTime startUtc, int minutes, bool keepCancelledDates)
    {
        SqlParameter? result = null;
        try
        {
            await _db.ExecAsync("dbo.sahyog_Meeting_Update", p =>
            {
                p.With("@TenantId", tenantId).With("@MeetingId", meetingId).With("@UserId", userId).With("@IsAdmin", isAdmin)
                 .AddText("@Title", title, 150).AddText("@Agenda", string.IsNullOrWhiteSpace(agenda) ? null : agenda.Trim(), 2000)
                 .AddDateTime2("@StartUtc", startUtc).With("@DurationMinutes", minutes).With("@KeepCancelledDates", keepCancelledDates);
                result = p.AddOutput("@Result", SqlDbType.Int);
            });
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return MeetingChangeStatus.NeedsDatabase; }
        return (MeetingChangeStatus)result!.OutInt();
    }

    public async Task<int> SendChangeAsync(MeetingDto meeting, IReadOnlyList<InviteeDto> invitees, string changedBy, string hostEmail, TimeZoneInfo zone,
        MeetingChangeKind kind, DateTime oldStartLocal, int oldMinutes, DateTime newStartLocal, int newMinutes, DateOnly? occurrenceDate, string? note)
    {
        var memberEmails = invitees.Where(i => i.UserId is not null && !string.IsNullOrEmpty(i.Email)).Select(i => i.Email!)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var guestEmails = invitees.Where(i => i.UserId is null && !string.IsNullOrEmpty(i.GuestEmail)).Select(i => i.GuestEmail!)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (memberEmails.Count + guestEmails.Count == 0) return 0;

        string When(DateTime start, int minutes) => meeting.IsAllDay
            ? $"{start:dddd, d MMMM yyyy} · All day"
            : $"{start:dddd, d MMMM yyyy} · {start:h:mm tt} – {start.AddMinutes(minutes):h:mm tt}";
        var repeat = MeetingCalendar.DescribeRepeat(meeting, zone);
        var who = WebUtility.HtmlEncode(changedBy);
        var (headline, subject) = kind switch
        {
            MeetingChangeKind.DateCancelled => ($"{who} cancelled one meeting in this series", $"Cancelled: {meeting.Title} · {oldStartLocal:ddd d MMM}"),
            MeetingChangeKind.DateMoved => ($"{who} moved one meeting in this series", $"Moved: {meeting.Title} · {oldStartLocal:ddd d MMM} → {newStartLocal:ddd d MMM, h:mm tt}"),
            MeetingChangeKind.Moved => ($"{who} moved this meeting", $"Moved: {meeting.Title} → {newStartLocal:ddd d MMM, h:mm tt}"),
            _ => ($"{who} changed this meeting{(repeat is null ? "" : " (every meeting in the series)")}", $"Updated: {meeting.Title}")
        };
        var timeChanged = oldStartLocal != newStartLocal || oldMinutes != newMinutes;
        var was = kind == MeetingChangeKind.DateCancelled || timeChanged
            ? $"""<p style="margin:0 0 4px;color:#94A3B8;text-decoration:line-through">{WebUtility.HtmlEncode(When(oldStartLocal, oldMinutes))}</p>""" : "";
        var now = kind == MeetingChangeKind.DateCancelled
            ? """<p style="margin:0 0 18px;color:#B91C1C;font-weight:600">This date is cancelled. The other meetings in the series stay as they are.</p>"""
            : $"""<p style="margin:0 0 18px;color:#0F172A;font-weight:600">{WebUtility.HtmlEncode(When(newStartLocal, newMinutes))}{(kind == MeetingChangeKind.Edited && repeat is not null ? " · " + WebUtility.HtmlEncode(repeat) : "")}</p>""";
        var noteHtml = string.IsNullOrWhiteSpace(note) ? "" :
            $"""<p style="margin:0 0 18px;padding:12px 14px;border-radius:14px;background:#EEF2FF;color:#3730A3;font-style:italic">“{WebUtility.HtmlEncode(note.Trim())}”</p>""";

        // the planned start of that date (the calendar file names the date it replaces)
        DateTime? recurrenceIdUtc = kind is MeetingChangeKind.DateMoved or MeetingChangeKind.DateCancelled && occurrenceDate is DateOnly d
            ? MeetingCalendar.ToUtc(d.ToDateTime(TimeOnly.FromTimeSpan(MeetingCalendar.ToLocal(meeting.StartUtc, zone).TimeOfDay)), zone)
            : null;
        var cancelDate = kind == MeetingChangeKind.DateCancelled;

        var sent = 0;
        async Task SendTo(List<string> emails, string joinUrl)
        {
            if (emails.Count == 0) return;
            var button = cancelDate ? "" :
                $"""<a href="{joinUrl}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:linear-gradient(110deg,#2563EB,#DB2777);color:#fff;text-decoration:none;font-weight:600">Join meeting</a>""";
            var html = $"""
                <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:28px;border-radius:24px;background:#F8FAFC">
                  <p style="margin:0 0 6px;color:{(cancelDate ? "#B91C1C" : "#2563EB")};font-size:13px;font-weight:600">{headline}</p>
                  <h2 style="margin:0 0 12px;color:#0F172A">{WebUtility.HtmlEncode(meeting.Title)}</h2>
                  {was}{now}{noteHtml}{button}
                  <p style="margin:20px 0 0;color:#64748B;font-size:12px">The calendar file below updates Outlook or Google Calendar. ShankhNaad by CloudWheel Ltd</p>
                </div>
                """;
            var ics = IcsBuilder.Build(meeting, meeting.HostName, hostEmail, emails, joinUrl, cancel: cancelDate, isChange: true,
                recurrenceIdUtc: recurrenceIdUtc,
                overrideStartUtc: kind == MeetingChangeKind.DateMoved ? MeetingCalendar.ToUtc(newStartLocal, zone) : null,
                overrideMinutes: kind == MeetingChangeKind.DateMoved ? newMinutes : null);
            if (await _email.SendAsync(emails, subject, html, new EmailCalendarPart(cancelDate ? "cancel.ics" : "update.ics", ics, cancelDate ? "CANCEL" : "REQUEST")))
                sent += emails.Count;
        }

        await SendTo(memberEmails, RoomUrl(meeting.MeetingId));
        if (meeting.GuestLinkEnabled) await SendTo(guestEmails, GuestUrl(meeting.GuestCode));
        return sent;
    }

    public Task<GuestMeetingDto?> GetByGuestCodeAsync(string code) =>
        _db.QueryFirstAsync("dbo.sahyog_Meeting_GetByGuestCode", p => p.AddText("@GuestCode", code, 16), r => new GuestMeetingDto(
            r.G("MeetingId"), r.G("TenantId"), r.S("Title"), r.Utc("StartUtc"), r.I("DurationMinutes"), r.S("RoomName"),
            r.B("LobbyEnabled"), r.B("CaptionsOn"), r.S("HostName"), r.S("TenantName"), r.S("TimeZoneId"), r.B("TenantActive")));

    /// <summary>Emails team members the room link and guests the guest link, each with a calendar invite (.ics).</summary>
    public async Task SendInvitesAsync(MeetingDto meeting, IReadOnlyList<InviteeDto> invitees, string hostName, string hostEmail, TimeZoneInfo zone,
        Func<InviteeDto, string?>? respondUrl = null)
    {
        var memberEmails = invitees.Where(i => i.UserId is not null && !string.IsNullOrEmpty(i.Email)).Select(i => i.Email!).ToList();
        var guestEmails = invitees.Where(i => i.GuestEmail is not null).Select(i => i.GuestEmail!).ToList();
        var startLocal = MeetingCalendar.ToLocal(meeting.StartUtc, zone);
        var when = meeting.IsAllDay
            ? $"{startLocal:dddd, d MMMM yyyy} · All day"
            : $"{startLocal:dddd, d MMMM yyyy} · {startLocal:h:mm tt} – {startLocal.AddMinutes(meeting.DurationMinutes):h:mm tt}";
        var repeat = MeetingCalendar.DescribeRepeat(meeting, zone);
        if (repeat is not null) when += $" · {repeat}";
        var title = WebUtility.HtmlEncode(meeting.Title);
        var host = WebUtility.HtmlEncode(hostName);

        async Task SendTo(List<string> emails, string joinUrl, string? answerUrl)
        {
            if (emails.Count == 0) return;
            // the person's own Accept / Maybe / Decline buttons (one click, no sign-in)
            string Btn(string r, string text, string bg, string fg) =>
                $"""<a href="{answerUrl}{(answerUrl!.Contains('?') ? "&" : "?")}r={r}" style="display:inline-block;margin:0 6px 6px 0;padding:10px 18px;border-radius:999px;background:{bg};color:{fg};text-decoration:none;font-weight:600;font-size:14px">{text}</a>""";
            var answers = answerUrl is null ? "" :
                $"""<p style="margin:20px 0 8px;color:#334155;font-size:13px;font-weight:600">Will you come?</p><div>{Btn("yes", "✓ Accept", "#DCFCE7", "#166534")}{Btn("maybe", "? Maybe", "#FEF3C7", "#92400E")}{Btn("no", "✕ Decline", "#FEE2E2", "#991B1B")}</div>""";
            var html = $"""
                <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:28px;border-radius:24px;background:#F8FAFC">
                  <p style="margin:0 0 6px;color:#475569;font-size:13px">{host} invited you to a meeting on ShankhNaad</p>
                  <h2 style="margin:0 0 12px;color:#0F172A">{title}</h2>
                  <p style="margin:0 0 20px;color:#334155">{WebUtility.HtmlEncode(when)}</p>
                  <a href="{joinUrl}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:linear-gradient(110deg,#2563EB,#DB2777);color:#fff;text-decoration:none;font-weight:600">Join meeting</a>
                  {answers}
                  <p style="margin:20px 0 0;color:#64748B;font-size:12px">ShankhNaad by CloudWheel Ltd</p>
                </div>
                """;
            var ics = IcsBuilder.Build(meeting, hostName, hostEmail, emails, joinUrl);
            await _email.SendAsync(emails, $"Invitation: {meeting.Title} · {startLocal:d MMM, h:mm tt}", html, new EmailCalendarPart("invite.ics", ics));
        }

        if (respondUrl is null)
        {
            await SendTo(memberEmails, RoomUrl(meeting.MeetingId), null);
            if (meeting.GuestLinkEnabled)
                await SendTo(guestEmails, GuestUrl(meeting.GuestCode), null);
            return;
        }
        // one email each, so everyone gets their own answer buttons
        foreach (var i in invitees)
        {
            var email = i.UserId is not null ? i.Email : i.GuestEmail;
            if (string.IsNullOrWhiteSpace(email)) continue;
            if (i.UserId is null && !meeting.GuestLinkEnabled) continue;
            await SendTo(new List<string> { email }, i.UserId is not null ? RoomUrl(meeting.MeetingId) : GuestUrl(meeting.GuestCode), respondUrl(i));
        }
    }

    public async Task<RespondStatus> SetResponseAsync(Guid tenantId, Guid meetingId, Guid? userId, string? guestEmail, DateOnly? date, MeetingResponse response, string? note)
    {
        SqlParameter? result = null;
        try
        {
            await _db.ExecAsync("dbo.sahyog_Meeting_SetResponse", p =>
            {
                p.With("@TenantId", tenantId).With("@MeetingId", meetingId)
                 .With("@UserId", (object?)userId ?? DBNull.Value).AddText("@GuestEmail", guestEmail, 256)
                 .With("@OccurrenceDate", date is DateOnly d ? (object)d.ToDateTime(TimeOnly.MinValue) : DBNull.Value)
                 .With("@Response", (byte)response).AddText("@Note", string.IsNullOrWhiteSpace(note) ? null : note.Trim(), 300);
                result = p.AddOutput("@Result", SqlDbType.Int);
            });
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return RespondStatus.NeedsDatabase; }
        return (RespondStatus)result!.OutInt();
    }

    public async Task<List<MeetingResponseDto>> GetResponsesAsync(Guid tenantId, IEnumerable<Guid> meetingIds)
    {
        var ids = meetingIds.Distinct().ToList();
        if (ids.Count == 0) return new List<MeetingResponseDto>();
        try
        {
            return await _db.QueryAsync("dbo.sahyog_Meeting_ListResponses",
                p => p.With("@TenantId", tenantId).AddText("@MeetingIds", string.Join(",", ids), -1),
                r =>
                {
                    var day = DateOnly.FromDateTime(r.GetDateTime(r.GetOrdinal("OccurrenceDate")));
                    return new MeetingResponseDto(r.G("MeetingId"), r.S("PersonKey"), day.Year <= 1900 ? null : day,
                        (MeetingResponse)Convert.ToByte(r["Response"]), r.SN("Note"), r.Utc("RespondedUtc"));
                });
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return new List<MeetingResponseDto>(); }
    }

    public async Task<int> SendStartedAsync(MeetingDto meeting, IReadOnlyList<InviteeDto> invitees, string startedBy, string hostEmail, TimeZoneInfo zone, ISet<string> skip)
    {
        var sent = 0;
        var who = WebUtility.HtmlEncode(startedBy);
        var title = WebUtility.HtmlEncode(meeting.Title);
        var people = invitees.Select(i => (Key: i.UserId is Guid u ? MeetingResponseDto.KeyOf(u) : MeetingResponseDto.KeyOf(i.GuestEmail ?? ""),
                                           Email: i.UserId is not null ? i.Email : i.GuestEmail, Guest: i.UserId is null)).ToList();
        if (!string.IsNullOrWhiteSpace(hostEmail)) people.Add((MeetingResponseDto.KeyOf(meeting.HostId), hostEmail, false));
        foreach (var group in people.Where(p => !string.IsNullOrWhiteSpace(p.Email) && !skip.Contains(p.Key) && (!p.Guest || meeting.GuestLinkEnabled))
                                    .GroupBy(p => p.Guest))
        {
            var emails = group.Select(p => p.Email!).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var joinUrl = group.Key ? GuestUrl(meeting.GuestCode) : RoomUrl(meeting.MeetingId);
            var html = $"""
                <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:28px;border-radius:24px;background:#F8FAFC">
                  <p style="margin:0 0 6px;color:#16A34A;font-size:13px;font-weight:700">● Live now · {who} started the meeting</p>
                  <h2 style="margin:0 0 18px;color:#0F172A">{title}</h2>
                  <a href="{joinUrl}" style="display:inline-block;padding:14px 32px;border-radius:999px;background:linear-gradient(110deg,#16A34A,#2563EB);color:#fff;text-decoration:none;font-weight:700">Join now</a>
                  <p style="margin:20px 0 0;color:#64748B;font-size:12px">ShankhNaad by CloudWheel Ltd</p>
                </div>
                """;
            if (await _email.SendAsync(emails, $"Started: {meeting.Title} · join now", html)) sent += emails.Count;
        }
        return sent;
    }
}

/// <summary>Time-zone and calendar helpers (no database).</summary>
public static class MeetingCalendar
{
    public static TimeZoneInfo FindZone(string? id)
    {
        foreach (var candidate in new[] { id, "Asia/Kolkata", "India Standard Time" })
        {
            if (string.IsNullOrWhiteSpace(candidate)) continue;
            if (TimeZoneInfo.TryFindSystemTimeZoneById(candidate, out var zone)) return zone;
        }
        return TimeZoneInfo.Utc;
    }

    public static DateTime ToLocal(DateTime utc, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone);

    public static DateTime ToUtc(DateTime local, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), zone);

    /// <summary>Monday of the week that contains <paramref name="date"/>.</summary>
    public static DateOnly WeekOf(DateOnly date) => date.AddDays(-(((int)date.DayOfWeek + 6) % 7));

    public static string NewRoomName() => $"sahyog-{Guid.NewGuid():N}";

    /// <summary>10 characters, no look-alike letters. Used in /join/{code}.</summary>
    public static string NewGuestCode()
    {
        const string alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
        Span<char> chars = stackalloc char[10];
        for (var i = 0; i < chars.Length; i++)
            chars[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
        return new string(chars);
    }

    /// <summary>Bit for one day in a RepeatDays mask (Sun = 1, Mon = 2 … Sat = 64).</summary>
    public static byte DayBit(DayOfWeek day) => (byte)(1 << (int)day);

    /// <summary>Does a repeating meeting fall on <paramref name="day"/>? <paramref name="firstDay"/> is the weekday of its first occurrence.</summary>
    public static bool Occurs(MeetingRecurrence recurrence, byte repeatDays, DayOfWeek firstDay, DayOfWeek day) => recurrence switch
    {
        MeetingRecurrence.Weekly => day == firstDay,
        MeetingRecurrence.Daily => day is not (DayOfWeek.Saturday or DayOfWeek.Sunday),
        MeetingRecurrence.Custom => (repeatDays & DayBit(day)) != 0,
        _ => false
    };

    /// <summary>The days a repeating meeting uses, Monday first (for labels and the calendar file).</summary>
    public static List<DayOfWeek> RepeatDayList(MeetingRecurrence recurrence, byte repeatDays, DayOfWeek firstDay)
    {
        var week = new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday, DayOfWeek.Saturday, DayOfWeek.Sunday };
        return week.Where(d => Occurs(recurrence, repeatDays, firstDay, d)).ToList();
    }

    /// <summary>"Repeats every Mon, Wed, Fri until 31 Mar 2027", or null for a one-off meeting.</summary>
    public static string? DescribeRepeat(MeetingDto m, TimeZoneInfo zone)
    {
        if (m.Recurrence == MeetingRecurrence.None) return null;
        var first = ToLocal(m.StartUtc, zone);
        var days = m.Recurrence switch
        {
            MeetingRecurrence.Daily => "every weekday",
            MeetingRecurrence.Weekly => $"every {first:dddd}",
            _ => "every " + string.Join(", ", RepeatDayList(m.Recurrence, m.RepeatDays, first.DayOfWeek).Select(d => d.ToString()[..3]))
        };
        var until = m.RepeatUntilUtc is DateTime u ? $" until {ToLocal(u, zone):d MMM yyyy}" : "";
        return $"Repeats {days}{until}";
    }

    /// <summary>Expands one-off and recurring meetings into the occurrences inside [fromLocal, toLocal).</summary>
    public static IEnumerable<MeetingOccurrenceDto> Expand(IEnumerable<MeetingDto> meetings, DateTime fromLocal, DateTime toLocal, TimeZoneInfo zone)
    {
        foreach (var m in meetings)
        {
            var firstLocal = ToLocal(m.StartUtc, zone);
            var duration = TimeSpan.FromMinutes(m.DurationMinutes);

            if (m.Recurrence == MeetingRecurrence.None)
            {
                if (firstLocal < toLocal && firstLocal + duration > fromLocal)
                    yield return new MeetingOccurrenceDto(m, firstLocal, firstLocal + duration, DateOnly.FromDateTime(firstLocal));
                continue;
            }

            // single dates that were cancelled or moved (35_MeetingChanges.sql)
            Dictionary<DateOnly, MeetingExceptionDto>? changed = null;
            foreach (var x in m.Exceptions) (changed ??= new())[x.OccurrenceDate] = x;

            var lastLocal = m.RepeatUntilUtc is DateTime until ? ToLocal(until, zone) : DateTime.MaxValue;
            for (var day = fromLocal.Date; day < toLocal; day = day.AddDays(1))
            {
                var start = day + firstLocal.TimeOfDay;
                if (start < firstLocal) continue;
                if (start > lastLocal) break;
                if (!Occurs(m.Recurrence, m.RepeatDays, firstLocal.DayOfWeek, day.DayOfWeek)) continue;
                var date = DateOnly.FromDateTime(day);
                if (changed is not null && changed.ContainsKey(date)) continue;     // cancelled, or shown below at its new time
                yield return new MeetingOccurrenceDto(m, start, start + duration, date);
            }

            // moved dates whose new time is inside the period (they may come from a date outside it)
            if (changed is null) continue;
            foreach (var x in changed.Values)
            {
                if (x.IsCancelled || x.NewStartUtc is not DateTime newStart || !IsOccurrenceDate(m, x.OccurrenceDate, zone)) continue;
                var s = ToLocal(newStart, zone);
                var e = s.AddMinutes(x.NewDurationMinutes ?? m.DurationMinutes);
                if (s < toLocal && e > fromLocal) yield return new MeetingOccurrenceDto(m, s, e, x.OccurrenceDate, true);
            }
        }
    }

    /// <summary>Is this date one of the meeting's dates (as planned, before any single-date change)?</summary>
    public static bool IsOccurrenceDate(MeetingDto m, DateOnly date, TimeZoneInfo zone)
    {
        var firstLocal = ToLocal(m.StartUtc, zone);
        if (m.Recurrence == MeetingRecurrence.None) return date == DateOnly.FromDateTime(firstLocal);
        var start = date.ToDateTime(TimeOnly.FromTimeSpan(firstLocal.TimeOfDay));
        if (start < firstLocal) return false;
        if (m.RepeatUntilUtc is DateTime u && start > ToLocal(u, zone)) return false;
        return Occurs(m.Recurrence, m.RepeatDays, firstLocal.DayOfWeek, date.DayOfWeek);
    }
}
