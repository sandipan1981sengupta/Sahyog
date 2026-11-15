namespace Sahyog.DtoLibrary;

/// <summary>A person in a workspace (sahyog_User_GetById / sahyog_User_ListByTenant).</summary>
public sealed record UserDto(Guid UserId, Guid? TenantId, string Email, string DisplayName, string Role, int AvatarTone, bool IsActive)
{
    public string Id => UserId.ToString();
    public string Initials => Names.Initials(DisplayName);
}

/// <summary>Everything needed to check a sign-in (sahyog_Auth_GetUserByEmail). Contains the password hash: never send to a view.</summary>
public sealed record LoginUserDto(
    Guid UserId, Guid? TenantId, string Email, string DisplayName, string PasswordHash, string Role, int AvatarTone,
    bool IsActive, Guid SecurityStamp, int FailedLoginCount, DateTime? LockoutEndUtc,
    string? TenantSlug, string? TenantName, bool TenantActive);

public sealed record AuthStateDto(bool IsActive, Guid SecurityStamp, bool TenantActive);

public enum LoginStatus { Success, Invalid, LockedOut, WorkspacePaused }

public sealed record LoginResultDto(LoginStatus Status, LoginUserDto? User = null);

/// <summary>Input for adding a person. TenantId null = CloudWheel super admin.</summary>
public sealed class CreateUserRequest
{
    public Guid? TenantId { get; set; }
    public string DisplayName { get; set; } = "";
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
    public string Role { get; set; } = AppRoles.Member;
    public bool EnforceLimit { get; set; } = true;
}

public enum SetUserActiveStatus { Ok = 0, LimitReached = 2, NotFound = 3 }
