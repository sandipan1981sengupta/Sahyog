namespace ShankhNaad.DtoLibrary;

public static class AppRoles
{
    public const string SuperAdmin = "SuperAdmin";
    public const string TenantAdmin = "TenantAdmin";
    public const string Member = "Member";
}

public static class AppClaims
{
    public const string TenantId = "tenant_id";
    public const string TenantName = "tenant_name";
    public const string DisplayName = "display_name";
    public const string AvatarTone = "avatar_tone";
    public const string SecurityStamp = "stamp";
}

public enum MeetingRecurrence : byte
{
    None = 0,
    Weekly = 1,
    /// <summary>Every weekday (Mon–Fri).</summary>
    Daily = 2,
    /// <summary>On the days picked in RepeatDays (e.g. Mon, Wed, Fri).</summary>
    Custom = 3
}

/// <summary>Result of a create/update call: success, or a message to show the user.</summary>
public sealed record OperationResult(bool Succeeded, string? Error = null, Guid? Id = null)
{
    public static OperationResult Ok(Guid? id = null) => new(true, null, id);
    public static OperationResult Fail(string error) => new(false, error);
}

public static class Names
{
    /// <summary>"Priya Sharma" → "PS", "Ravi" → "RA". Used for the round avatars.</summary>
    public static string Initials(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "?";
        var parts = name.Replace("(guest)", "", StringComparison.OrdinalIgnoreCase).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return "?";
        return parts.Length == 1
            ? parts[0][..Math.Min(2, parts[0].Length)].ToUpperInvariant()
            : $"{char.ToUpperInvariant(parts[0][0])}{char.ToUpperInvariant(parts[^1][0])}";
    }
}
