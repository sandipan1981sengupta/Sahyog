using System.Data;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary.Data;

namespace Sahyog.ServiceLibrary;

/// <summary>Password hashing with ASP.NET's built-in PBKDF2 hasher. Only hashes are stored in sahyog_Users.</summary>
public static class Passwords
{
    private sealed class Account { }
    private static readonly PasswordHasher<Account> Hasher = new();
    private static readonly Account Anyone = new();

    public static string Hash(string password) => Hasher.HashPassword(Anyone, password);

    /// <returns>ok, and whether the stored hash should be upgraded to the current format.</returns>
    public static (bool Ok, bool NeedsRehash) Verify(string hash, string password)
    {
        var result = Hasher.VerifyHashedPassword(Anyone, hash, password);
        return (result != PasswordVerificationResult.Failed, result == PasswordVerificationResult.SuccessRehashNeeded);
    }

    public static string? Validate(string password) =>
        string.IsNullOrEmpty(password) || password.Length < 8 ? "Password must be at least 8 characters." : null;

    /// <summary>Avatar colour 0–5, stable for an email address.</summary>
    public static byte ToneFor(string email) => (byte)(email.Sum(c => c) % 6);
}

/// <summary>People: sign-in checks, adding, listing, removing.</summary>
public interface IUserService
{
    /// <summary>Checks workspace, email and password, handles lockout. Does not create the cookie (the web app does).</summary>
    Task<LoginResultDto> LoginAsync(string? workspace, string email, string password);
    Task<AuthStateDto?> GetAuthStateAsync(Guid userId);
    Task<UserDto?> GetByIdAsync(Guid userId);
    Task<List<UserDto>> ListByTenantAsync(Guid tenantId);
    Task<OperationResult> CreateAsync(CreateUserRequest request);
    /// <summary>Looks a person up by email (for "Forgot password" and welcome emails). Null when there's no such person.</summary>
    Task<LoginUserDto?> FindByEmailAsync(string email);
    /// <summary>Creates a one-time set-password link. Returns the secret to put in the URL, or an error.</summary>
    Task<(string? Token, string? Error)> CreatePasswordLinkAsync(Guid userId, PasswordLinkPurpose purpose, TimeSpan validFor);
    /// <summary>Reads a link for the Set password page (null when the secret matches nothing).</summary>
    Task<PasswordLinkInfo?> GetPasswordLinkAsync(string token);
    /// <summary>Sets the password through a link. Returns the person's email and workspace for the sign-in page.</summary>
    Task<(OperationResult Result, string? Email, string? TenantSlug)> UsePasswordLinkAsync(string token, string newPassword);
    /// <summary>Edits name, email, role and (optionally) the password of a person in a workspace.</summary>
    Task<UpdateUserResult> UpdateAsync(UpdateUserRequest request);
    Task<SetUserActiveStatus> SetActiveAsync(Guid tenantId, Guid userId, bool isActive);
    /// <summary>True once a CloudWheel super admin exists (the /setup page then switches itself off).</summary>
    Task<bool> SuperAdminExistsAsync();
}

public sealed class UserService : IUserService
{
    private const int MaxAttempts = 5;
    private const int LockMinutes = 10;

    private readonly SqlDb _db;
    public UserService(SqlDb db) => _db = db;

    private static UserDto MapUser(SqlDataReader r) => new(
        r.G("UserId"), r.GN("TenantId"), r.S("Email"), r.S("DisplayName"), r.S("Role"), r.I("AvatarTone"), r.B("IsActive"))
    {
        HasSignedIn = r.Has("LastLoginUtc") ? r.UtcOpt("LastLoginUtc") is not null : null
    };

    public async Task<LoginResultDto> LoginAsync(string? workspace, string email, string password)
    {
        var user = await _db.QueryFirstAsync("dbo.sahyog_Auth_GetUserByEmail",
            p => p.AddText("@Email", email.Trim().ToLowerInvariant(), 256),
            r => new LoginUserDto(
                r.G("UserId"), r.GN("TenantId"), r.S("Email"), r.S("DisplayName"), r.S("PasswordHash"), r.S("Role"),
                r.I("AvatarTone"), r.B("IsActive"), r.G("SecurityStamp"), r.I("FailedLoginCount"), r.UtcN("LockoutEndUtc"),
                r.SN("TenantSlug"), r.SN("TenantName"), r.B("TenantActive")));

        if (user is null || !user.IsActive) return new(LoginStatus.Invalid);
        if (user.LockoutEndUtc is DateTime until && until > DateTime.UtcNow) return new(LoginStatus.LockedOut);

        // Emails are unique across all workspaces, so the email alone identifies the person and their workspace.
        // The workspace is optional: when someone does give one (an old link or bookmark), it must still match.
        if (user.Role != AppRoles.SuperAdmin)
        {
            var slug = (workspace ?? "").Trim().ToLowerInvariant();
            if (slug.Length > 0 && !string.Equals(slug, user.TenantSlug, StringComparison.Ordinal)) return new(LoginStatus.Invalid);
            if (!user.TenantActive) return new(LoginStatus.WorkspacePaused);
        }

        var (ok, needsRehash) = Passwords.Verify(user.PasswordHash, password);
        if (!ok)
        {
            var lockedUntil = (await _db.QueryAsync("dbo.sahyog_Auth_LoginFailed",
                p => p.With("@UserId", user.UserId).With("@MaxAttempts", MaxAttempts).With("@LockMinutes", LockMinutes),
                r => r.UtcN("LockoutEndUtc"))).FirstOrDefault();
            return new(lockedUntil > DateTime.UtcNow ? LoginStatus.LockedOut : LoginStatus.Invalid);
        }

        await _db.ExecAsync("dbo.sahyog_Auth_LoginSucceeded",
            p => p.With("@UserId", user.UserId).AddText("@NewPasswordHash", needsRehash ? Passwords.Hash(password) : null, 400));
        return new(LoginStatus.Success, user);
    }

    public Task<AuthStateDto?> GetAuthStateAsync(Guid userId) =>
        _db.QueryFirstAsync("dbo.sahyog_User_GetAuthState", p => p.With("@UserId", userId),
            r => new AuthStateDto(r.B("IsActive"), r.G("SecurityStamp"), r.B("TenantActive")));

    public Task<UserDto?> GetByIdAsync(Guid userId) =>
        _db.QueryFirstAsync("dbo.sahyog_User_GetById", p => p.With("@UserId", userId), MapUser);

    public Task<List<UserDto>> ListByTenantAsync(Guid tenantId) =>
        _db.QueryAsync("dbo.sahyog_User_ListByTenant", p => p.With("@TenantId", tenantId), MapUser);

    /// <summary>Adds a person. sahyog_User_Create enforces the plan's user limit inside a transaction.</summary>
    public async Task<OperationResult> CreateAsync(CreateUserRequest request)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        if (Passwords.Validate(request.Password) is string passwordError) return OperationResult.Fail(passwordError);

        var userId = Guid.NewGuid();
        SqlParameter? result = null;
        await _db.ExecAsync("dbo.sahyog_User_Create", p =>
        {
            p.With("@UserId", userId)
             .With("@TenantId", request.TenantId)
             .AddText("@Email", email, 256)
             .AddText("@DisplayName", request.DisplayName.Trim(), 100)
             .AddText("@PasswordHash", Passwords.Hash(request.Password), 400)
             .AddText("@Role", request.Role, 20)
             .With("@AvatarTone", Passwords.ToneFor(email))
             .With("@EnforceLimit", request.EnforceLimit);
            result = p.AddOutput("@Result", SqlDbType.Int);
        });

        return result!.OutInt() switch
        {
            0 => OperationResult.Ok(userId),
            1 => OperationResult.Fail("A user with this email already exists."),
            2 => OperationResult.Fail("This workspace has reached its plan's user limit. Upgrade the plan to add more people."),
            _ => OperationResult.Fail("Could not add the person.")
        };
    }

    // ---------- one-time set-password links ----------
    // The URL carries 32 random bytes; only their SHA-256 is stored, so a database copy can't be used.

    private static byte[] HashToken(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token ?? ""));

    private static SqlParameter TokenParam(byte[] hash) =>
        new("@TokenHash", SqlDbType.Binary, 32) { Value = hash };

    public Task<LoginUserDto?> FindByEmailAsync(string email) =>
        _db.QueryFirstAsync("dbo.sahyog_Auth_GetUserByEmail",
            p => p.AddText("@Email", (email ?? "").Trim().ToLowerInvariant(), 256),
            r => new LoginUserDto(
                r.G("UserId"), r.GN("TenantId"), r.S("Email"), r.S("DisplayName"), r.S("PasswordHash"), r.S("Role"),
                r.I("AvatarTone"), r.B("IsActive"), r.G("SecurityStamp"), r.I("FailedLoginCount"), r.UtcN("LockoutEndUtc"),
                r.SN("TenantSlug"), r.SN("TenantName"), r.B("TenantActive")));

    public async Task<(string? Token, string? Error)> CreatePasswordLinkAsync(Guid userId, PasswordLinkPurpose purpose, TimeSpan validFor)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        SqlParameter? result = null;
        await _db.ExecAsync("dbo.sahyog_PasswordLink_Create", p =>
        {
            p.With("@UserId", userId);
            p.Add(TokenParam(HashToken(token)));
            p.With("@Purpose", (byte)purpose)
             .AddDateTime2("@ExpiresUtc", DateTime.UtcNow.Add(validFor));
            result = p.AddOutput("@Result", SqlDbType.Int);
        });
        return result!.OutInt() switch
        {
            0 => (token, null),
            5 => (null, "A link was sent less than a minute ago. Please wait a minute before sending another."),
            _ => (null, "Could not create the link.")
        };
    }

    public async Task<PasswordLinkInfo?> GetPasswordLinkAsync(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var rows = await _db.QueryAsync("dbo.sahyog_PasswordLink_Get", p => p.Add(TokenParam(HashToken(token))), r =>
        {
            var used = r.UtcN("UsedUtc");
            var expires = r.Utc("ExpiresUtc");
            var problem = used is not null ? "This link has already been used. Ask for a new one if you need to change your password again."
                : expires < DateTime.UtcNow ? "This link has expired. Ask for a new one."
                : !r.B("IsActive") ? "This account is inactive. Ask your workspace admin."
                : !r.B("TenantActive") ? "This workspace is paused. Please contact CloudWheel Ltd."
                : null;
            return new PasswordLinkInfo((PasswordLinkPurpose)r.I("Purpose"), r.S("DisplayName"), r.S("Email"),
                r.SN("TenantSlug"), r.SN("TenantName"), problem);
        });
        return rows.FirstOrDefault();
    }

    public async Task<(OperationResult Result, string? Email, string? TenantSlug)> UsePasswordLinkAsync(string token, string newPassword)
    {
        if (Passwords.Validate(newPassword) is string passwordError) return (OperationResult.Fail(passwordError), null, null);

        SqlParameter? result = null, email = null, slug = null;
        await _db.ExecAsync("dbo.sahyog_PasswordLink_Use", p =>
        {
            p.Add(TokenParam(HashToken(token)));
            p.AddText("@NewPasswordHash", Passwords.Hash(newPassword), 400);
            result = p.AddOutput("@Result", SqlDbType.Int);
            email = p.AddOutput("@Email", SqlDbType.NVarChar); email.Size = 256;
            slug = p.AddOutput("@TenantSlug", SqlDbType.NVarChar); slug.Size = 40;
        });
        return result!.OutInt() switch
        {
            0 => (OperationResult.Ok(), email!.Value as string, slug!.Value as string),
            2 => (OperationResult.Fail("This account is inactive or its workspace is paused. Ask your workspace admin."), null, null),
            _ => (OperationResult.Fail("This link is no longer valid. Ask for a new one."), null, null)
        };
    }

    public async Task<UpdateUserResult> UpdateAsync(UpdateUserRequest request)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var name = request.DisplayName.Trim();
        if (name.Length is 0 or > 100) return new(OperationResult.Fail("Enter a name (up to 100 characters)."), null);
        if (email.Length is 0 or > 256 || !email.Contains('@')) return new(OperationResult.Fail("Enter a valid email address."), null);
        if (request.Role is not (AppRoles.TenantAdmin or AppRoles.Member)) return new(OperationResult.Fail("Unknown role."), null);

        string? newHash = null;
        if (!string.IsNullOrWhiteSpace(request.NewPassword))
        {
            if (Passwords.Validate(request.NewPassword) is string passwordError) return new(OperationResult.Fail(passwordError), null);
            newHash = Passwords.Hash(request.NewPassword);
        }

        SqlParameter? result = null, stamp = null;
        await _db.ExecAsync("dbo.sahyog_User_Update", p =>
        {
            p.With("@TenantId", request.TenantId)
             .With("@UserId", request.UserId)
             .AddText("@DisplayName", name, 100)
             .AddText("@Email", email, 256)
             .AddText("@Role", request.Role, 20)
             .AddText("@NewPasswordHash", newHash, 400);
            result = p.AddOutput("@Result", SqlDbType.Int);
            stamp = p.AddOutput("@NewStamp", SqlDbType.UniqueIdentifier);
        });

        Guid? newStamp = stamp!.Value is Guid g ? g : null;
        return result!.OutInt() switch
        {
            0 => new(OperationResult.Ok(request.UserId), newStamp),
            1 => new(OperationResult.Fail("Someone else already uses this email."), null),
            3 => new(OperationResult.Fail("That person no longer exists."), null),
            4 => new(OperationResult.Fail("The workspace needs at least one admin. Make someone else an admin first."), null),
            _ => new(OperationResult.Fail("Could not save the changes."), null)
        };
    }

    public async Task<bool> SuperAdminExistsAsync()
    {
        var rows = await _db.QueryAsync("dbo.sahyog_User_SuperAdminExists", null, r => r.B("AnyExists"));
        return rows.FirstOrDefault();
    }

    public async Task<SetUserActiveStatus> SetActiveAsync(Guid tenantId, Guid userId, bool isActive)
    {
        SqlParameter? result = null;
        await _db.ExecAsync("dbo.sahyog_User_SetActive", p =>
        {
            p.With("@TenantId", tenantId).With("@UserId", userId).With("@IsActive", isActive);
            result = p.AddOutput("@Result", SqlDbType.Int);
        });
        return (SetUserActiveStatus)result!.OutInt();
    }
}
