using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary;

namespace Sahyog.Web.Infrastructure;

/// <summary>Creates and checks the sign-in cookie. The password/lockout checks are in IUserService.LoginAsync.</summary>
public static class CookieAuth
{
    public static Task SignInAsync(HttpContext http, LoginUserDto user, bool remember)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.UserId.ToString()),
            new(ClaimTypes.Name, user.Email),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Role, user.Role),
            new(AppClaims.DisplayName, user.DisplayName),
            new(AppClaims.AvatarTone, user.AvatarTone.ToString()),
            new(AppClaims.SecurityStamp, user.SecurityStamp.ToString())
        };
        if (user.TenantId is Guid tenantId)
        {
            claims.Add(new Claim(AppClaims.TenantId, tenantId.ToString()));
            claims.Add(new Claim(AppClaims.TenantName, user.TenantName ?? ""));
        }

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
        var properties = new AuthenticationProperties
        {
            IsPersistent = remember,
            ExpiresUtc = remember ? DateTimeOffset.UtcNow.AddDays(14) : null
        };
        return http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, properties);
    }

    /// <summary>
    /// Every 5 minutes, re-checks the person in the database so a removed person or a paused client
    /// is signed out quickly (one small stored procedure call, not one per request).
    /// </summary>
    public static async Task ValidatePrincipalAsync(CookieValidatePrincipalContext context)
    {
        const string checkedKey = ".sahyog.checked";
        var now = DateTimeOffset.UtcNow;
        if (context.Properties.Items.TryGetValue(checkedKey, out var raw)
            && DateTimeOffset.TryParse(raw, out var last) && now - last < TimeSpan.FromMinutes(5))
            return;

        var principal = context.Principal!;
        var users = context.HttpContext.RequestServices.GetRequiredService<IUserService>();
        var state = Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)
            ? await users.GetAuthStateAsync(userId)
            : null;

        if (state is null || !state.IsActive || !state.TenantActive
            || state.SecurityStamp.ToString() != principal.FindFirstValue(AppClaims.SecurityStamp))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }

        context.Properties.Items[checkedKey] = now.ToString("O");
        context.ShouldRenew = true;
    }
}
