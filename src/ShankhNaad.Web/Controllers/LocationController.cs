using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Team member location (only for clients the super admin switched it on for).
/// Each person chooses to share; only the latest location is kept.
/// Everyone sees "In office / Remote · city"; the map and exact address are for workspace admins (and the person).
/// </summary>
[Authorize(Roles = AppRoles.TenantAdmin + "," + AppRoles.Member), Route("location")]
public sealed class LocationController : Controller
{
    private readonly ILocationService _location;
    private readonly IUserService _users;
    private readonly PresenceTracker _presence;
    private readonly ReverseGeocoder _geo;

    public LocationController(ILocationService location, IUserService users, PresenceTracker presence, ReverseGeocoder geo)
    {
        _location = location;
        _users = users;
        _presence = presence;
        _geo = geo;
    }

    private Guid TenantId => User.TenantId()!.Value;
    private Guid Me => Guid.Parse(User.UserId());
    private bool IsAdmin => User.IsInRole(AppRoles.TenantAdmin);

    /// <summary>For this page: is location on for my company, and have I said yes / no?</summary>
    [HttpGet("me")]
    public async Task<IActionResult> MyState()
    {
        var t = await _location.GetTenantAsync(TenantId);
        if (!t.Enabled) return Json(new { enabled = false });
        return Json(new { enabled = true, sharing = await _location.GetSharingAsync(TenantId, Me), officeSet = t.OfficeList.Count > 0 });
    }

    /// <summary>Yes / no to sharing. No erases what was stored.</summary>
    [HttpPost("sharing")]
    public async Task<IActionResult> SetSharing(bool on)
    {
        if (!(await _location.GetTenantAsync(TenantId)).Enabled) return BadRequest(new { error = "Location isn't switched on for your company." });
        await _location.SetSharingAsync(TenantId, Me, on);
        return Json(new { sharing = on });
    }

    public sealed record CheckInInput(double? Lat, double? Lng, double? Accuracy);

    /// <summary>A check-in from this browser: office or remote (from the internet address), plus a map position when the browser allowed it.</summary>
    [HttpPost("check-in")]
    public async Task<IActionResult> CheckIn([FromBody] CheckInInput input, CancellationToken ct)
    {
        var t = await _location.GetTenantAsync(TenantId);
        if (!t.Enabled) return Json(new { saved = false, reason = "off" });

        var ip = TeamLocation.ClientIp(HttpContext);
        var inOffice = t.OfficeList.Count > 0 ? TeamLocation.InOffice(ip, t.OfficeList) : (bool?)null;

        double? lat = input.Lat, lng = input.Lng;
        if (lat is not (>= -90 and <= 90) || lng is not (>= -180 and <= 180) || (lat == 0 && lng == 0)) { lat = null; lng = null; }
        var acc = input.Accuracy is > 0 and < 100000 ? (int?)Math.Round(input.Accuracy.Value) : null;

        ReverseGeocoder.Place? place = null;
        if (lat is double la && lng is double lo) place = await _geo.LookupAsync(la, lo, ct);

        var result = await _location.SaveAsync(TenantId, Me, new LocationCheckIn(
            ip?.ToString(), inOffice, lat, lng, lat is null ? null : acc,
            place?.Address, place?.Area, place?.City, place?.Region, place?.Country));
        return Json(new { saved = result == 0, inOffice, place = place?.City ?? place?.Area });
    }

    /// <summary>One person's card on the Team page.</summary>
    [HttpGet("person/{id:guid}")]
    public async Task<IActionResult> Person(Guid id)
    {
        var t = await _location.GetTenantAsync(TenantId);
        var user = (await _users.ListByTenantAsync(TenantId)).FirstOrDefault(u => u.UserId == id);
        if (user is null) return NotFound();
        if (!t.Enabled) return Json(new { enabled = false });

        var loc = (await _location.ListAsync(TenantId)).FirstOrDefault(l => l.UserId == id);
        var self = id == Me;
        var exact = IsAdmin || self;          // the map and street address: admins and the person themselves
        var sharing = loc?.Sharing;
        if (sharing != true) return Json(new { enabled = true, sharing, self, canSeeMap = exact });

        return Json(new
        {
            enabled = true,
            sharing = true,
            self,
            canSeeMap = exact,
            online = _presence.OnlineUsers(TenantId).Contains(id.ToString()),
            inOffice = loc!.InOffice,
            officeSet = t.OfficeList.Count > 0,
            place = loc.Place,
            country = loc.Country,
            seenUtc = loc.SeenUtc,
            preciseUtc = exact ? loc.PreciseUtc : null,
            area = exact ? loc.Area : null,
            city = loc.City,
            region = loc.Region,
            address = exact ? loc.Address : null,
            lat = exact ? loc.Lat : null,
            lng = exact ? loc.Lng : null,
            accuracy = exact ? loc.AccuracyM : null
        });
    }

    /// <summary>Workspace admin: the office's internet addresses, and the one this browser is using right now.</summary>
    [HttpGet("office")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> Office()
    {
        var t = await _location.GetTenantAsync(TenantId);
        var ip = TeamLocation.ClientIp(HttpContext);
        var s = await SuggestAsync(t);
        return Json(new
        {
            enabled = t.Enabled, ips = t.OfficeIps ?? "", myIp = ip?.ToString(), myIpInOffice = TeamLocation.InOffice(ip, t.OfficeList),
            suggestIp = s?.Ip, suggestPeople = s?.People
        });
    }

    /// <summary>Team page (admins): "4 people are connecting from 49.205.32.120. Is this your office?"</summary>
    [HttpGet("office/suggestion")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> OfficeSuggestion()
    {
        var t = await _location.GetTenantAsync(TenantId);
        if (!t.Enabled) return Json(new { ip = (string?)null });
        var s = await SuggestAsync(t);
        return Json(new { ip = s?.Ip, people = s?.People ?? 0, officeSet = t.OfficeList.Count > 0 });
    }

    /// <summary>The address most people connected from in the last 12 hours (at least 2 people), if it isn't the office yet.</summary>
    private async Task<LocationIpCount?> SuggestAsync(TenantLocationDto t) =>
        (await _location.IpCountsAsync(TenantId, DateTime.UtcNow.AddHours(-12)))
            .FirstOrDefault(c => c.People >= 2 && System.Net.IPAddress.TryParse(c.Ip, out var a) && !TeamLocation.InOffice(a, t.OfficeList));

    [HttpPost("office")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> SaveOffice(string? ips)
    {
        var entries = (ips ?? "").Split(new[] { '\n', '\r', ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var bad = entries.Where(e => !TeamLocation.IsValidEntry(e)).ToList();
        if (bad.Count > 0) return BadRequest(new { error = $"Not an internet address or range: {string.Join(", ", bad.Take(3))}. Use e.g. 203.0.113.5 or 203.0.113.0/24." });
        var text = string.Join("\n", entries);
        if (text.Length > 2000) return BadRequest(new { error = "Too many addresses (2000 characters at most)." });
        await _location.SetOfficeAsync(TenantId, text);
        return Json(new { ips = text, count = entries.Count });
    }
}
