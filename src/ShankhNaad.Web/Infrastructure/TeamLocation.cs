using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// Team member location helpers: the caller's internet address, "is that the office?",
/// and turning a map position into a place name (OpenStreetMap Nominatim, cached, at most one lookup a second).
/// </summary>
public static class TeamLocation
{
    /// <summary>The address this request came from. Behind a proxy on the same machine or network, the first X-Forwarded-For.</summary>
    public static IPAddress? ClientIp(HttpContext http)
    {
        var ip = http.Connection.RemoteIpAddress;
        if (ip is not null && ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip is null || IPAddress.IsLoopback(ip) || IsPrivate(ip))
        {
            var fwd = http.Request.Headers["X-Forwarded-For"].ToString().Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            if (fwd is not null && IPAddress.TryParse(fwd, out var f)) ip = f.IsIPv4MappedToIPv6 ? f.MapToIPv4() : f;
        }
        return ip;
    }

    public static bool IsPrivate(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        var b = ip.GetAddressBytes();
        if (b.Length == 4)
            return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) || b[0] == 127;
        return ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6UniqueLocal || IPAddress.IsLoopback(ip);
    }

    /// <summary>Is one office entry valid? An address (203.0.113.5) or a range (203.0.113.0/24, 192.168.1.0/24, IPv6 too).</summary>
    public static bool IsValidEntry(string entry) =>
        entry.Contains('/') ? IPNetwork.TryParse(entry, out _) : IPAddress.TryParse(entry, out _);

    /// <summary>True when <paramref name="ip"/> is one of the office addresses or inside one of its ranges.</summary>
    public static bool InOffice(IPAddress? ip, IEnumerable<string> entries)
    {
        if (ip is null) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        foreach (var e in entries)
        {
            if (e.Contains('/'))
            {
                if (IPNetwork.TryParse(e, out var net) && net.Contains(ip)) return true;
            }
            else if (IPAddress.TryParse(e, out var one))
            {
                if (one.IsIPv4MappedToIPv6) one = one.MapToIPv4();
                if (one.Equals(ip)) return true;
            }
        }
        return false;
    }
}

/// <summary>A map position → place name ("Koramangala, Bengaluru, Karnataka, India") via OpenStreetMap Nominatim.</summary>
public sealed class ReverseGeocoder
{
    public sealed record Place(string? Address, string? Area, string? City, string? Region, string? Country);

    private static readonly HttpClient Http = new(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(10) })
    {
        BaseAddress = new Uri("https://nominatim.openstreetmap.org/"),
        Timeout = TimeSpan.FromSeconds(5)
    };
    static ReverseGeocoder()
    {
        // Nominatim's rules: say who you are; at most one request a second; cache results
        Http.DefaultRequestHeaders.UserAgent.ParseAdd("ShankhNaad/1.0 (team location; self-hosted)");
        Http.DefaultRequestHeaders.AcceptLanguage.ParseAdd("en");
    }
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static DateTime _last = DateTime.MinValue;
    // ~100 m cells: people at the same place share one lookup
    private static readonly ConcurrentDictionary<(double, double), Place> Cache = new();

    private readonly ILogger<ReverseGeocoder> _log;
    public ReverseGeocoder(ILogger<ReverseGeocoder> log) => _log = log;

    public async Task<Place?> LookupAsync(double lat, double lng, CancellationToken ct = default)
    {
        var key = (Math.Round(lat, 3), Math.Round(lng, 3));
        if (Cache.TryGetValue(key, out var hit)) return hit;
        await Gate.WaitAsync(ct);
        try
        {
            if (Cache.TryGetValue(key, out hit)) return hit;
            var wait = _last.AddMilliseconds(1100) - DateTime.UtcNow;
            if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
            _last = DateTime.UtcNow;
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            var r = await Http.GetFromJsonAsync<NominatimResult>(
                $"reverse?format=jsonv2&zoom=17&addressdetails=1&lat={lat.ToString(inv)}&lon={lng.ToString(inv)}", ct);
            if (r?.address is not { } a) return null;
            var place = new Place(
                Trim(r.display_name, 300),
                Trim(a.suburb ?? a.neighbourhood ?? a.quarter ?? a.residential ?? a.road, 120),
                Trim(a.city ?? a.town ?? a.village ?? a.municipality ?? a.state_district ?? a.county, 120),
                Trim(a.state, 120),
                Trim(a.country, 80));
            if (Cache.Count > 20000) Cache.Clear();
            Cache[key] = place;
            return place;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            _log.LogInformation("Place lookup failed ({Message}); the map position is kept without a place name.", ex.Message);
            return null;
        }
        finally { Gate.Release(); }
    }

    private static string? Trim(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : s.Length <= max ? s : s[..max];

    private sealed class NominatimResult
    {
        public string? display_name { get; set; }
        public NominatimAddress? address { get; set; }
    }
    private sealed class NominatimAddress
    {
        public string? road { get; set; }
        public string? suburb { get; set; }
        public string? neighbourhood { get; set; }
        public string? quarter { get; set; }
        public string? residential { get; set; }
        public string? city { get; set; }
        public string? town { get; set; }
        public string? village { get; set; }
        public string? municipality { get; set; }
        public string? state_district { get; set; }
        public string? county { get; set; }
        public string? state { get; set; }
        public string? country { get; set; }
    }
}
