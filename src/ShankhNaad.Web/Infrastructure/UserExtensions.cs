using System.Security.Claims;
using ShankhNaad.DtoLibrary;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>Reads the signed-in person's details from their login cookie.</summary>
public static class UserExtensions
{
    public static string DisplayName(this ClaimsPrincipal user) =>
        user.FindFirstValue(AppClaims.DisplayName) ?? user.Identity?.Name ?? "";

    public static string TenantName(this ClaimsPrincipal user) =>
        user.FindFirstValue(AppClaims.TenantName) ?? "";

    public static int AvatarTone(this ClaimsPrincipal user) =>
        int.TryParse(user.FindFirstValue(AppClaims.AvatarTone), out var t) ? t : 0;

    public static string Initials(this ClaimsPrincipal user) => Names.Initials(user.DisplayName());

    /// <summary>User id as text (same format SignalR uses for Clients.User).</summary>
    public static string UserId(this ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

    public static Guid UserGuid(this ClaimsPrincipal user) =>
        Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;

    /// <summary>The client workspace of the signed-in person; null for CloudWheel super admins.</summary>
    public static Guid? TenantId(this ClaimsPrincipal user) =>
        Guid.TryParse(user.FindFirstValue(AppClaims.TenantId), out var id) ? id : null;

    public static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        double size = bytes;
        var unit = 0;
        while (size >= 1024 && unit < units.Length - 1)
        {
            size /= 1024;
            unit++;
        }
        return unit == 0 ? $"{bytes} B" : $"{size:0.#} {units[unit]}";
    }
}
