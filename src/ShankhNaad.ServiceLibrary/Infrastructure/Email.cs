using System.Net;
using System.Text;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using MimeKit;
using ShankhNaad.DtoLibrary;

namespace ShankhNaad.ServiceLibrary;

public sealed class SmtpOptions
{
    public string Host { get; set; } = "";
    /// <summary>465 = SSL from the first byte (Plesk / Windows hosting). 587 = STARTTLS (Gmail, Brevo, Office 365).</summary>
    public int Port { get; set; } = 587;
    public bool EnableSsl { get; set; } = true;
    public string UserName { get; set; } = "";
    public string Password { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "ShankhNaad";
}

public sealed record EmailCalendarPart(string FileName, string IcsContent);

public interface IAppEmailSender
{
    bool IsConfigured { get; }
    /// <summary>True when the mail server accepted the message. Never throws: failures are logged.</summary>
    Task<bool> SendAsync(IEnumerable<string> to, string subject, string html, EmailCalendarPart? calendar = null);
}

/// <summary>
/// SMTP through MailKit, so both port 465 (implicit SSL, e.g. MilesWeb / Plesk) and 587 (STARTTLS) work.
/// If Smtp:Host is empty, emails are only logged.
/// </summary>
public sealed class SmtpEmailSender : IAppEmailSender
{
    private readonly SmtpOptions _o;
    private readonly ILogger<SmtpEmailSender> _log;

    public SmtpEmailSender(IOptions<SmtpOptions> options, ILogger<SmtpEmailSender> log)
    {
        _o = options.Value;
        _log = log;
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_o.Host);

    /// <summary>Port 465 means SSL from the start; any other port upgrades with STARTTLS when EnableSsl is on.</summary>
    private SecureSocketOptions SocketOptions =>
        !_o.EnableSsl ? SecureSocketOptions.None
        : _o.Port == 465 ? SecureSocketOptions.SslOnConnect
        : SecureSocketOptions.StartTls;

    public async Task<bool> SendAsync(IEnumerable<string> to, string subject, string html, EmailCalendarPart? calendar = null)
    {
        var recipients = to.Where(e => !string.IsNullOrWhiteSpace(e)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (recipients.Count == 0) return false;

        if (!IsConfigured)
        {
            _log.LogInformation("SMTP not configured. Would have sent '{Subject}' to {Recipients}.", subject, string.Join(", ", recipients));
            return false;
        }

        try
        {
            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(_o.FromName, _o.FromAddress));
            foreach (var r in recipients) message.To.Add(MailboxAddress.Parse(r));
            message.Subject = subject;

            var body = new BodyBuilder { HtmlBody = html };
            if (calendar is not null)
            {
                // the .ics invite Outlook / Google Calendar turn into an "Accept / Decline" event
                var ics = body.Attachments.Add(calendar.FileName, Encoding.UTF8.GetBytes(calendar.IcsContent), new ContentType("text", "calendar"));
                ics.ContentType.Charset = "utf-8";
                ics.ContentType.Parameters.Add("method", "REQUEST");
            }
            message.Body = body.ToMessageBody();

            using var client = new SmtpClient { Timeout = 30_000 };
            await client.ConnectAsync(_o.Host, _o.Port, SocketOptions);
            if (!string.IsNullOrEmpty(_o.UserName))
                await client.AuthenticateAsync(new NetworkCredential(_o.UserName, _o.Password));
            await client.SendAsync(message);
            await client.DisconnectAsync(true);

            _log.LogInformation("Sent '{Subject}' to {Count} recipient(s).", subject, recipients.Count);
            return true;
        }
        catch (Exception ex)
        {
            // An email failure must never break scheduling a meeting or adding a person.
            _log.LogError(ex, "Sending '{Subject}' failed (SMTP {Host}:{Port}).", subject, _o.Host, _o.Port);
            return false;
        }
    }
}

/// <summary>Builds the .ics calendar invite that Outlook and Google Calendar understand.</summary>
public static class IcsBuilder
{
    public static string Build(MeetingDto meeting, string organizerName, string organizerEmail, IEnumerable<string> attendeeEmails, string joinUrl)
    {
        static string Esc(string s) => s.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,").Replace("\r", "").Replace("\n", "\\n");
        static string Utc(DateTime d) => DateTime.SpecifyKind(d, DateTimeKind.Utc).ToString("yyyyMMdd'T'HHmmss'Z'");

        var sb = new StringBuilder();
        sb.Append("BEGIN:VCALENDAR\r\n");
        sb.Append("PRODID:-//CloudWheel Ltd//ShankhNaad//EN\r\n");
        sb.Append("VERSION:2.0\r\n");
        sb.Append("METHOD:REQUEST\r\n");
        sb.Append("BEGIN:VEVENT\r\n");
        sb.Append($"UID:{meeting.MeetingId}@sahyog\r\n");
        sb.Append($"DTSTAMP:{Utc(DateTime.UtcNow)}\r\n");
        sb.Append($"DTSTART:{Utc(meeting.StartUtc)}\r\n");
        sb.Append($"DTEND:{Utc(meeting.EndUtc)}\r\n");
        var until = meeting.RepeatUntilUtc is DateTime u ? $";UNTIL={Utc(u)}" : "";
        if (meeting.Recurrence == MeetingRecurrence.Weekly) sb.Append($"RRULE:FREQ=WEEKLY{until}\r\n");
        if (meeting.Recurrence == MeetingRecurrence.Daily) sb.Append($"RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR{until}\r\n");
        if (meeting.Recurrence == MeetingRecurrence.Custom && meeting.RepeatDays != 0)
        {
            // iCalendar day codes: SU MO TU WE TH FR SA, in DayOfWeek order
            var codes = new[] { "SU", "MO", "TU", "WE", "TH", "FR", "SA" };
            var byDay = string.Join(",", Enumerable.Range(0, 7).Where(i => (meeting.RepeatDays & (1 << i)) != 0).Select(i => codes[i]));
            sb.Append($"RRULE:FREQ=WEEKLY;BYDAY={byDay}{until}\r\n");
        }
        sb.Append($"SUMMARY:{Esc(meeting.Title)}\r\n");
        sb.Append($"DESCRIPTION:{Esc((meeting.Agenda ?? "") + "\n\nJoin: " + joinUrl)}\r\n");
        sb.Append($"LOCATION:{Esc(joinUrl)}\r\n");
        sb.Append($"URL:{joinUrl}\r\n");
        sb.Append($"ORGANIZER;CN={Esc(organizerName)}:mailto:{organizerEmail}\r\n");
        foreach (var email in attendeeEmails)
            sb.Append($"ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{email}\r\n");
        sb.Append("BEGIN:VALARM\r\nTRIGGER:-PT5M\r\nACTION:DISPLAY\r\nDESCRIPTION:Meeting starts in 5 minutes\r\nEND:VALARM\r\n");
        sb.Append("END:VEVENT\r\n");
        sb.Append("END:VCALENDAR\r\n");
        return sb.ToString();
    }
}
