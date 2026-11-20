using System.Globalization;
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
/// Out of office from one date to another, and the email that tells the team.
/// Dates are whole days in the workspace's time zone (same as the meetings calendar):
/// "24 Nov → 28 Nov" = from 24 Nov 00:00 until 29 Nov 00:00.
/// </summary>
[Authorize(Roles = AppRoles.TenantAdmin + "," + AppRoles.Member), Route("status")]
public sealed class StatusController : Controller
{
    private readonly IOutOfOfficeService _ooo;
    private readonly IUserService _users;
    private readonly ITenantService _tenants;
    private readonly IAppEmailSender _email;
    private readonly IHubContext<ChatHub> _hub;
    private readonly AppOptions _app;

    public StatusController(IOutOfOfficeService ooo, IUserService users, ITenantService tenants, IAppEmailSender email,
        IHubContext<ChatHub> hub, IOptions<AppOptions> app)
    {
        _ooo = ooo;
        _users = users;
        _tenants = tenants;
        _email = email;
        _hub = hub;
        _app = app.Value;
    }

    private Guid TenantId => User.TenantId()!.Value;
    private Guid Me => Guid.Parse(User.UserId());

    private const int MaxDays = 365;

    /// <summary>Who can be told by email (everyone active in the workspace but me). Addresses stay on the server.</summary>
    [HttpGet("out-of-office/people")]
    public async Task<IActionResult> People()
    {
        var list = (await _users.ListByTenantAsync(TenantId))
            .Where(u => u.IsActive && u.UserId != Me)
            .OrderBy(u => u.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(u => new { id = u.UserId, name = u.DisplayName, initials = Names.Initials(u.DisplayName), tone = u.AvatarTone, hasEmail = !string.IsNullOrWhiteSpace(u.Email) });
        return Json(new { people = list, canEmail = _email.IsConfigured });
    }

    public sealed class OooInput
    {
        public string? Message { get; set; }
        /// <summary>First day away, yyyy-MM-dd.</summary>
        public string? From { get; set; }
        /// <summary>Last day away, yyyy-MM-dd. Empty = until I turn it off.</summary>
        public string? To { get; set; }
        /// <summary>none | all | some</summary>
        public string? Notify { get; set; }
        public List<Guid>? People { get; set; }
    }

    [HttpPost("out-of-office")]
    public async Task<IActionResult> Set([FromForm] OooInput input)
    {
        var limits = await _tenants.GetLimitsAsync(TenantId);
        var zone = MeetingCalendar.FindZone(limits?.TimeZoneId ?? _app.DefaultTimeZone);
        var today = DateOnly.FromDateTime(MeetingCalendar.ToLocal(DateTime.UtcNow, zone));

        if (!TryDay(input.From, out var from)) return BadRequest(new { error = "Pick the first day you're away." });
        if (from < today) return BadRequest(new { error = "The first day can't be in the past." });
        if (from > today.AddDays(MaxDays)) return BadRequest(new { error = "Pick a first day within a year." });
        DateOnly? to = null;
        if (!string.IsNullOrWhiteSpace(input.To))
        {
            if (!TryDay(input.To, out var t)) return BadRequest(new { error = "The last day isn't a valid date." });
            if (t < from) return BadRequest(new { error = "The last day can't be before the first day." });
            if (t > from.AddDays(MaxDays)) return BadRequest(new { error = "Out of office can be at most a year." });
            to = t;
        }

        var message = (input.Message ?? "").Trim();
        if (message.Length > 500) message = message[..500];
        var note = message.Length == 0 ? null : message;

        // starting today = starting now; a later day = planned
        DateTime? startUtc = from > today ? MeetingCalendar.ToUtc(from.ToDateTime(TimeOnly.MinValue), zone) : null;
        DateTime? untilUtc = to is DateOnly last ? MeetingCalendar.ToUtc(last.AddDays(1).ToDateTime(TimeOnly.MinValue), zone) : null;

        var saved = startUtc is null && to is null
            ? (await _ooo.SetAsync(TenantId, Me, note, null) ? OooSaveStatus.Saved : OooSaveStatus.NeedsDatabase32)
            : await _ooo.SetRangeAsync(TenantId, Me, note, startUtc, untilUtc);
        if (saved == OooSaveStatus.NeedsDatabase32)
            return StatusCode(503, new { error = "Out of office needs a database update (32_OutOfOfficeAndEdit.sql). Ask your administrator." });
        if (saved == OooSaveStatus.NeedsDatabase33)
            return StatusCode(503, new { error = "Planning out of office for later days needs a database update (33_OutOfOfficeDates.sql). Ask your administrator." });

        var dto = new OutOfOfficeDto(note, untilUtc, DateTime.UtcNow, startUtc);
        await _hub.Clients.Group(ChatHub.TenantGroup(TenantId)).SendAsync("OooChanged", Me.ToString(), dto);

        // ---- tell people by email ----
        var notify = (input.Notify ?? "none").Trim().ToLowerInvariant();
        int mailed = 0;
        string? mailNote = null;
        if (notify is "all" or "some")
        {
            var team = (await _users.ListByTenantAsync(TenantId)).Where(u => u.IsActive && u.UserId != Me).ToList();
            var picked = notify == "all" ? team : team.Where(u => input.People?.Contains(u.UserId) == true).ToList();
            var emails = picked.Select(u => u.Email).Where(e => !string.IsNullOrWhiteSpace(e)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (emails.Count == 0) mailNote = notify == "some" ? "Nobody was picked, so no email was sent." : "Nobody in the team has an email address.";
            else if (!_email.IsConfigured) mailNote = "Email isn't set up on the server, so no email was sent.";
            else
            {
                var me = await _users.GetByIdAsync(Me);
                var name = me?.DisplayName ?? User.DisplayName();
                var when = DescribeRange(from, to, today);
                var html = MailHtml(name, when, note);
                if (await _email.SendHiddenAsync(emails, $"Out of office: {name} · {when}", html, me?.Email, name)) mailed = emails.Count;
                else mailNote = "Saved, but the email couldn't be sent. Please try again later.";
            }
        }

        return Json(new { ooo = dto, mailed, mailNote });
    }

    private static bool TryDay(string? s, out DateOnly day) =>
        DateOnly.TryParseExact((s ?? "").Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day);

    private static readonly CultureInfo En = CultureInfo.GetCultureInfo("en-GB");

    /// <summary>"Mon 24 Nov – Fri 28 Nov 2026" · "Mon 24 Nov 2026" · "from Mon 24 Nov 2026 until further notice".</summary>
    private static string DescribeRange(DateOnly from, DateOnly? to, DateOnly today)
    {
        string D(DateOnly d, bool year) => d.ToString(year ? "ddd d MMM yyyy" : "ddd d MMM", En);
        if (to is null) return from == today ? "until further notice" : $"from {D(from, true)} until further notice";
        if (to == from) return D(from, true);
        return $"{D(from, from.Year != to.Value.Year)} – {D(to.Value, true)}";
    }

    private string MailHtml(string name, string when, string? note)
    {
        var url = string.IsNullOrWhiteSpace(_app.PublicBaseUrl) ? null : _app.PublicBaseUrl.TrimEnd('/') + "/chat";
        var noteHtml = note is null ? "" :
            $"""<p style="margin:0 0 18px;padding:14px 16px;border-radius:14px;background:#F3E8FF;color:#3B0764;font-style:italic">“{WebUtility.HtmlEncode(note).Replace("\n", "<br>")}”</p>""";
        var button = url is null ? "" :
            $"""<a href="{url}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:linear-gradient(110deg,#7E22CE,#DB2777);color:#fff;text-decoration:none;font-weight:600">Open ShankhNaad</a>""";
        return $"""
            <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:28px;border-radius:24px;background:#F8FAFC">
              <p style="margin:0 0 6px;color:#7E22CE;font-size:13px;font-weight:600">● Out of office</p>
              <h2 style="margin:0 0 8px;color:#0F172A">{WebUtility.HtmlEncode(name)} is out of office</h2>
              <p style="margin:0 0 18px;color:#334155;font-size:15px">{WebUtility.HtmlEncode(when)}</p>
              {noteHtml}
              {button}
              <p style="margin:20px 0 0;color:#64748B;font-size:12px">Sent from ShankhNaad by CloudWheel Ltd. Replying reaches {WebUtility.HtmlEncode(name)}.</p>
            </div>
            """;
    }
}
