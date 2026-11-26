using System.Globalization;
using System.Security.Cryptography;
using ShankhNaad.ServiceLibrary;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>Small helpers shared by the Work features (stand-up, roles, visitors, approvals, scheduling).</summary>
public static class WorkHelpers
{
    public static async Task<TimeZoneInfo> ZoneAsync(this ITenantService tenants, Guid tenantId) =>
        MeetingCalendar.FindZone((await tenants.GetLimitsAsync(tenantId))?.TimeZoneId);

    public static DateOnly Today(TimeZoneInfo zone) => DateOnly.FromDateTime(MeetingCalendar.ToLocal(DateTime.UtcNow, zone));

    public static DateOnly? Day(string? s) =>
        DateOnly.TryParseExact((s ?? "").Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    public static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>Trimmed and cut to a length; null when empty.</summary>
    public static string? Clip(string? s, int max)
    {
        s = (s ?? "").Trim();
        if (s.Length == 0) return null;
        return s.Length > max ? s[..max] : s;
    }

    /// <summary>Start (inclusive) and end (exclusive) of a local day, in UTC.</summary>
    public static (DateTime From, DateTime To) DayUtc(DateOnly day, TimeZoneInfo zone) =>
        (MeetingCalendar.ToUtc(day.ToDateTime(TimeOnly.MinValue), zone), MeetingCalendar.ToUtc(day.AddDays(1).ToDateTime(TimeOnly.MinValue), zone));

    /// <summary>Monday = 0 … Sunday = 6.</summary>
    public static int Dow(DateOnly d) => ((int)d.DayOfWeek + 6) % 7;

    /// <summary>A random code for links (letters and digits people can read out: no 0/O, 1/l).</summary>
    public static string Code(int length)
    {
        const string chars = "abcdefghjkmnpqrstuvwxyz23456789";
        return string.Create(length, chars, (span, c) => { for (var i = 0; i < span.Length; i++) span[i] = c[RandomNumberGenerator.GetInt32(c.Length)]; });
    }

    /// <summary>Is this out-of-office record in force now?</summary>
    public static bool IsAway(DtoLibrary.OutOfOfficeDto? o, DateTime? atUtc = null)
    {
        if (o is null) return false;
        var now = atUtc ?? DateTime.UtcNow;
        return (o.StartUtc is null || o.StartUtc <= now) && (o.UntilUtc is null || o.UntilUtc > now);
    }

    /// <summary>One CSV cell; a cell that starts like a formula stays text in Excel.</summary>
    public static string Csv(string? v)
    {
        v ??= "";
        if (v.Length > 0 && "=+-@\t\r".Contains(v[0])) v = "'" + v;
        return v.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v;
    }
}
