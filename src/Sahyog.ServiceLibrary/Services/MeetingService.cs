using System.Data;
using System.Net;
using System.Security.Cryptography;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary.Data;

namespace Sahyog.ServiceLibrary;

/// <summary>Meetings: schedule, list for the calendar, cancel, guest links, email invites.</summary>
public interface IMeetingService
{
    Task CreateAsync(CreateMeetingRequest request);
    Task<MeetingListDto> ListForUserAsync(Guid tenantId, Guid userId, DateTime fromUtc, DateTime toUtc);
    Task<MeetingDto?> GetAsync(Guid tenantId, Guid meetingId);
    Task<List<InviteeDto>> GetInviteesAsync(Guid tenantId, Guid meetingId);
    Task<DeleteMeetingResultDto> DeleteAsync(Guid tenantId, Guid meetingId, Guid userId, bool isAdmin);
    Task<GuestMeetingDto?> GetByGuestCodeAsync(string code);
    Task SendInvitesAsync(MeetingDto meeting, IReadOnlyList<InviteeDto> invitees, string hostName, string hostEmail, TimeZoneInfo zone);
    string RoomUrl(Guid meetingId);
    string GuestUrl(string code);
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
        r.GN("ChannelId"), r.B("IsInstant"), r.B("GuestLinkEnabled"), r.B("LobbyEnabled"), r.B("CaptionsOn"));

    private static InviteeDto MapInvitee(SqlDataReader r) => new(
        r.G("MeetingId"), r.GN("UserId"), r.SN("DisplayName"), r.IN("AvatarTone"), r.SN("Email"), r.SN("GuestEmail"));

    public string RoomUrl(Guid meetingId) => $"{_app.PublicBaseUrl.TrimEnd('/')}/meetings/room/{meetingId}";
    public string GuestUrl(string code) => $"{_app.PublicBaseUrl.TrimEnd('/')}/join/{code}";

    public Task CreateAsync(CreateMeetingRequest m) =>
        _db.ExecAsync("dbo.sahyog_Meeting_Create", p => p
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
            .AddEmailList("@GuestEmails", m.GuestEmails));

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

    public Task<GuestMeetingDto?> GetByGuestCodeAsync(string code) =>
        _db.QueryFirstAsync("dbo.sahyog_Meeting_GetByGuestCode", p => p.AddText("@GuestCode", code, 16), r => new GuestMeetingDto(
            r.G("MeetingId"), r.G("TenantId"), r.S("Title"), r.Utc("StartUtc"), r.I("DurationMinutes"), r.S("RoomName"),
            r.B("LobbyEnabled"), r.B("CaptionsOn"), r.S("HostName"), r.S("TenantName"), r.S("TimeZoneId"), r.B("TenantActive")));

    /// <summary>Emails team members the room link and guests the guest link, each with a calendar invite (.ics).</summary>
    public async Task SendInvitesAsync(MeetingDto meeting, IReadOnlyList<InviteeDto> invitees, string hostName, string hostEmail, TimeZoneInfo zone)
    {
        var memberEmails = invitees.Where(i => i.UserId is not null && !string.IsNullOrEmpty(i.Email)).Select(i => i.Email!).ToList();
        var guestEmails = invitees.Where(i => i.GuestEmail is not null).Select(i => i.GuestEmail!).ToList();
        var startLocal = MeetingCalendar.ToLocal(meeting.StartUtc, zone);
        var when = $"{startLocal:dddd, d MMMM yyyy} · {startLocal:h:mm tt} – {startLocal.AddMinutes(meeting.DurationMinutes):h:mm tt}";
        var title = WebUtility.HtmlEncode(meeting.Title);
        var host = WebUtility.HtmlEncode(hostName);

        async Task SendTo(List<string> emails, string joinUrl)
        {
            if (emails.Count == 0) return;
            var html = $"""
                <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:28px;border-radius:24px;background:#F8FAFC">
                  <p style="margin:0 0 6px;color:#475569;font-size:13px">{host} invited you to a meeting on Sahyog</p>
                  <h2 style="margin:0 0 12px;color:#0F172A">{title}</h2>
                  <p style="margin:0 0 20px;color:#334155">{WebUtility.HtmlEncode(when)}</p>
                  <a href="{joinUrl}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:linear-gradient(110deg,#2563EB,#DB2777);color:#fff;text-decoration:none;font-weight:600">Join meeting</a>
                  <p style="margin:20px 0 0;color:#64748B;font-size:12px">Sahyog by CloudWheel Ltd</p>
                </div>
                """;
            var ics = IcsBuilder.Build(meeting, hostName, hostEmail, emails, joinUrl);
            await _email.SendAsync(emails, $"Invitation: {meeting.Title} · {startLocal:d MMM, h:mm tt}", html, new EmailCalendarPart("invite.ics", ics));
        }

        await SendTo(memberEmails, RoomUrl(meeting.MeetingId));
        if (meeting.GuestLinkEnabled)
            await SendTo(guestEmails, GuestUrl(meeting.GuestCode));
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
                    yield return new MeetingOccurrenceDto(m, firstLocal, firstLocal + duration);
                continue;
            }

            for (var day = fromLocal.Date; day < toLocal; day = day.AddDays(1))
            {
                var start = day + firstLocal.TimeOfDay;
                if (start < firstLocal) continue;
                var matches = m.Recurrence == MeetingRecurrence.Weekly
                    ? day.DayOfWeek == firstLocal.DayOfWeek
                    : day.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday);
                if (matches)
                    yield return new MeetingOccurrenceDto(m, start, start + duration);
            }
        }
    }
}
