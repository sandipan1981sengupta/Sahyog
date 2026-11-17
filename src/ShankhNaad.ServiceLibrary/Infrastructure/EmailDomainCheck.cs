using System.Collections.Concurrent;
using DnsClient;
using Microsoft.Extensions.Logging;

namespace ShankhNaad.ServiceLibrary;

/// <summary>Result of checking whether an email address's domain can receive mail.</summary>
public enum EmailDomainStatus
{
    /// <summary>The domain has a mail server (MX record) or at least an address it could receive mail on.</summary>
    Ok,
    /// <summary>The domain doesn't exist, or says it doesn't accept mail. An email there can never arrive.</summary>
    NoMail,
    /// <summary>Not a valid email address.</summary>
    Invalid,
    /// <summary>The check couldn't run (no DNS answer in time). Never blocks anyone.</summary>
    Unknown
}

public sealed record EmailCheckResult(EmailDomainStatus Status, string Domain, string? Suggestion)
{
    /// <summary>A short sentence for the admin, or null when there's nothing to say.</summary>
    public string? Message => Status switch
    {
        EmailDomainStatus.Invalid => "That isn't a valid email address.",
        EmailDomainStatus.NoMail => Suggestion is null
            ? $"\"{Domain}\" can't receive email. Check the part after the @."
            : $"\"{Domain}\" can't receive email. Did you mean {Suggestion}?",
        _ => null
    };
}

/// <summary>
/// Catches mistyped email addresses before an invite is sent:
/// 1. "Did you mean …?" for near-misses of common domains (gmial.com → gmail.com).
/// 2. A DNS check that the domain can receive mail at all (MX record, or an A/AAAA record as the fallback).
/// It can't tell whether a mailbox exists (ravii@gmail.com vs ravi@gmail.com): no mail provider reveals that.
/// </summary>
public interface IEmailDomainCheck
{
    Task<EmailCheckResult> CheckAsync(string email, IEnumerable<string>? knownDomains = null, CancellationToken ct = default);
}

public sealed class EmailDomainCheck : IEmailDomainCheck
{
    private static readonly string[] CommonDomains =
    {
        "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "ymail.com", "rocketmail.com",
        "outlook.com", "hotmail.com", "live.com", "msn.com", "outlook.in", "hotmail.co.in",
        "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "zoho.com", "zohomail.in",
        "rediffmail.com", "gmx.com", "mail.com", "yandex.com", "cloudwheel.info"
    };

    private static readonly ConcurrentDictionary<string, (EmailDomainStatus Status, DateTime Until)> Cache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly LookupClient Dns = new(new LookupClientOptions
    {
        Timeout = TimeSpan.FromSeconds(3),
        Retries = 1,
        UseCache = true,
        ThrowDnsErrors = false,
        ContinueOnDnsError = true
    });

    private readonly ILogger<EmailDomainCheck> _log;
    public EmailDomainCheck(ILogger<EmailDomainCheck> log) => _log = log;

    public async Task<EmailCheckResult> CheckAsync(string email, IEnumerable<string>? knownDomains = null, CancellationToken ct = default)
    {
        email = (email ?? "").Trim().ToLowerInvariant();
        var at = email.LastIndexOf('@');
        if (at <= 0 || at == email.Length - 1 || email.Contains(' ')) return new(EmailDomainStatus.Invalid, "", null);

        var local = email[..at];
        var domain = email[(at + 1)..].TrimEnd('.');
        if (!domain.Contains('.') && Suggest(domain, knownDomains) is null) return new(EmailDomainStatus.Invalid, domain, null);

        var suggestedDomain = Suggest(domain, knownDomains);
        var suggestion = suggestedDomain is null ? null : $"{local}@{suggestedDomain}";
        var status = domain.Contains('.') ? await LookupAsync(domain, ct) : EmailDomainStatus.NoMail;
        return new(status, domain, suggestion);
    }

    private async Task<EmailDomainStatus> LookupAsync(string domain, CancellationToken ct)
    {
        if (Cache.TryGetValue(domain, out var hit) && hit.Until > DateTime.UtcNow) return hit.Status;

        var status = EmailDomainStatus.Unknown;
        try
        {
            var mx = await Dns.QueryAsync(domain, QueryType.MX, QueryClass.IN, ct);
            if (mx.Header.ResponseCode == DnsHeaderResponseCode.NotExistentDomain)
                status = EmailDomainStatus.NoMail;
            else if (!mx.HasError)
            {
                var records = mx.Answers.MxRecords().ToList();
                if (records.Count > 0)
                    // "Null MX" (RFC 7505): a single MX pointing at "." means the domain never accepts mail
                    status = records.All(r => r.Exchange.Value.Trim('.').Length == 0) ? EmailDomainStatus.NoMail : EmailDomainStatus.Ok;
                else
                {
                    // no MX: mail falls back to the domain's own address (A / AAAA)
                    var a = await Dns.QueryAsync(domain, QueryType.A, QueryClass.IN, ct);
                    var aaaa = a.Answers.ARecords().Any() ? null : await Dns.QueryAsync(domain, QueryType.AAAA, QueryClass.IN, ct);
                    status = a.Answers.ARecords().Any() || (aaaa?.Answers.AaaaRecords().Any() ?? false)
                        ? EmailDomainStatus.Ok
                        : (a.HasError ? EmailDomainStatus.Unknown : EmailDomainStatus.NoMail);
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // no DNS (offline server, firewall): never block an invite because of that
            _log.LogInformation(ex, "Couldn't check the mail domain {Domain}", domain);
            status = EmailDomainStatus.Unknown;
        }

        if (status != EmailDomainStatus.Unknown)
            Cache[domain] = (status, DateTime.UtcNow.AddHours(status == EmailDomainStatus.Ok ? 12 : 1));
        return status;
    }

    /// <summary>A common (or already used) domain that is one or two typing slips away, or null.</summary>
    public static string? Suggest(string domain, IEnumerable<string>? knownDomains = null)
    {
        domain = (domain ?? "").Trim().ToLowerInvariant().TrimEnd('.');
        if (domain.Length < 3) return null;
        var candidates = CommonDomains.Concat(knownDomains ?? Array.Empty<string>())
            .Select(d => d.Trim().ToLowerInvariant()).Where(d => d.Length > 0).Distinct().ToList();
        if (candidates.Contains(domain)) return null;

        // "gmail" with no ending → gmail.com
        var noDot = candidates.FirstOrDefault(d => !domain.Contains('.') && d.StartsWith(domain + ".", StringComparison.Ordinal));
        if (noDot is not null) return noDot;

        string? best = null;
        var bestDistance = int.MaxValue;
        foreach (var c in candidates)
        {
            var max = c.Length <= 8 ? 1 : 2;           // short domains: only one slip, so "mail.com" isn't pushed to "gmail.com"
            var d = Distance(domain, c);
            if (d <= max && d < bestDistance) { best = c; bestDistance = d; }
        }
        return best;
    }

    /// <summary>Edit distance where swapping two neighbouring letters counts as one slip (gmial → gmail).</summary>
    private static int Distance(string a, string b)
    {
        if (Math.Abs(a.Length - b.Length) > 2) return 99;
        var d = new int[a.Length + 1, b.Length + 1];
        for (var i = 0; i <= a.Length; i++) d[i, 0] = i;
        for (var j = 0; j <= b.Length; j++) d[0, j] = j;
        for (var i = 1; i <= a.Length; i++)
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                d[i, j] = Math.Min(Math.Min(d[i - 1, j] + 1, d[i, j - 1] + 1), d[i - 1, j - 1] + cost);
                if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1])
                    d[i, j] = Math.Min(d[i, j], d[i - 2, j - 2] + 1);
            }
        return d[a.Length, b.Length];
    }
}
