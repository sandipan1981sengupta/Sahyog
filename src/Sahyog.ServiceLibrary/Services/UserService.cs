using System.Data;
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
        r.G("UserId"), r.GN("TenantId"), r.S("Email"), r.S("DisplayName"), r.S("Role"), r.I("AvatarTone"), r.B("IsActive"));

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

        if (user.Role != AppRoles.SuperAdmin)
        {
            var slug = (workspace ?? "").Trim().ToLowerInvariant();
            if (!string.Equals(slug, user.TenantSlug, StringComparison.Ordinal)) return new(LoginStatus.Invalid);
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
