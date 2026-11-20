namespace ShankhNaad.DtoLibrary;

/// <summary>A client's location setting: switched on by the super admin; office addresses set by a workspace admin.</summary>
public sealed record TenantLocationDto(bool Enabled, string? OfficeIps)
{
    /// <summary>The office addresses, one per line (single addresses or ranges like 203.0.113.0/24).</summary>
    public IReadOnlyList<string> OfficeList => (OfficeIps ?? "")
        .Split(new[] { '\n', '\r', ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}

/// <summary>One person's latest location (only the latest is kept). Sharing: null = not asked yet.</summary>
public sealed record UserLocationDto(
    Guid UserId, bool? Sharing, bool? InOffice,
    double? Lat, double? Lng, int? AccuracyM,
    string? Address, string? Area, string? City, string? Region, string? Country,
    DateTime? PreciseUtc, DateTime? SeenUtc)
{
    /// <summary>"Bengaluru, Karnataka" (or the area / country when that's all there is).</summary>
    public string? Place => City is { Length: > 0 }
        ? (Region is { Length: > 0 } && Region != City ? $"{City}, {Region}" : City)
        : Area ?? Country;
}

/// <summary>A check-in from someone's browser: always the office/remote part, plus a map position when allowed.</summary>
public sealed record LocationCheckIn(
    string? Ip, bool? InOffice, double? Lat, double? Lng, int? AccuracyM,
    string? Address, string? Area, string? City, string? Region, string? Country);

/// <summary>How many people connected from one internet address (the office suggestion).</summary>
public sealed record LocationIpCount(string Ip, int People);
