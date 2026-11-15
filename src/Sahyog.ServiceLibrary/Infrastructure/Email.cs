using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using Sahyog.DtoLibrary;

namespace Sahyog.ServiceLibrary;

public sealed class SmtpOptions
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public bool EnableSsl { get; set; } = true;
    public string UserName { get; set; } = "";
    public string Password { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "Sahyog";
}

public sealed record EmailCalendarPart(string FileName, string IcsContent);

public interface IAppEmailSender
{
    bool IsConfigured { get; }
    Task SendAsync(IEnumerable<string> to, string subject, string html, EmailCalendarPart? calendar = null);
}

/// <summary>Plain SMTP (Office 365, Gmail Workspace, Brevo, etc.). If Smtp:Host is empty, emails are only logged.</summary>
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

    public async Task SendAsync(IEnumerable<string> to, string subject, string html, EmailCalendarPart? calendar = null)
    {
        var recipients = to.Where(e => !string.IsNullOrWhiteSpace(e)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (recipients.Count == 0) return;

        if (!IsConfigured)
        {
            _log.LogInformation("SMTP not configured. Would have sent '{Subject}' to {Recipients}.", subject, string.Join(", ", recipients));
            return;
        }

        using var message = new MailMessage
        {
            From = new MailAddress(_o.FromAddress, _o.FromName),
            Subject = subject,
            Body = html,
            IsBodyHtml = true
        };
        foreach (var r in recipients) message.To.Add(r);

        if (calendar is not null)
        {
            var bytes = Encoding.UTF8.GetBytes(calendar.IcsContent);
            var type = new ContentType("text/calendar") { CharSet = "utf-8" };
            type.Parameters.Add("method", "REQUEST");
            message.Attachments.Add(new System.Net.Mail.Attachment(new MemoryStream(bytes), calendar.FileName, type.ToString()));
        }

        using var client = new SmtpClient(_o.Host, _o.Port)
        {
            EnableSsl = _o.EnableSsl,
            Credentials = string.IsNullOrEmpty(_o.UserName) ? null : new NetworkCredential(_o.UserName, _o.Password)
        };

        try
        {
            await client.SendMailAsync(message);
        }
        catch (Exception ex)
        {
            // An email failure must never break scheduling a meeting.
            _log.LogError(ex, "Sending '{Subject}' failed.", subject);
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
        sb.Append("PRODID:-//CloudWheel Ltd//Sahyog//EN\r\n");
        sb.Append("VERSION:2.0\r\n");
        sb.Append("METHOD:REQUEST\r\n");
        sb.Append("BEGIN:VEVENT\r\n");
        sb.Append($"UID:{meeting.MeetingId}@sahyog\r\n");
        sb.Append($"DTSTAMP:{Utc(DateTime.UtcNow)}\r\n");
        sb.Append($"DTSTART:{Utc(meeting.StartUtc)}\r\n");
        sb.Append($"DTEND:{Utc(meeting.EndUtc)}\r\n");
        if (meeting.Recurrence == MeetingRecurrence.Weekly) sb.Append("RRULE:FREQ=WEEKLY\r\n");
        if (meeting.Recurrence == MeetingRecurrence.Daily) sb.Append("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n");
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
