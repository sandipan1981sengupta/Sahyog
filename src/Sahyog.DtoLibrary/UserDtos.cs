namespace Sahyog.DtoLibrary;

/// <summary>A person in a workspace (sahyog_User_GetById / sahyog_User_ListByTenant).</summary>
public sealed record UserDto(Guid UserId, Guid? TenantId, string Email, string DisplayName, string Role, int AvatarTone, bool IsActive)
{
    public string Id => UserId.ToString();
    public string Initials => Names.Initials(DisplayName);
    /// <summary>Has this person ever signed in? Null when the database doesn't say (13_InvitePending.sql not run yet).</summary>
    public bool? HasSignedIn { get; init; }
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

/// <summary>Edit a person (Team page). NewPassword empty = keep the current password.</summary>
public sealed class UpdateUserRequest
{
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public string DisplayName { get; set; } = "";
    public string Email { get; set; } = "";
    public string Role { get; set; } = AppRoles.Member;
    public string? NewPassword { get; set; }
}

/// <summary>Result of an edit: NewStamp is the person's security stamp afterwards (changes when they are signed out).</summary>
public sealed record UpdateUserResult(OperationResult Result, Guid? NewStamp);

/// <summary>What a one-time "set your password" link is for.</summary>
public enum PasswordLinkPurpose : byte { Welcome = 1, Reset = 2 }

/// <summary>A password link as shown on the Set password page. Problem is set when it can't be used.</summary>
public sealed record PasswordLinkInfo(PasswordLinkPurpose Purpose, string DisplayName, string Email, string? TenantSlug, string? TenantName, string? Problem);

public enum SetUserActiveStatus { Ok = 0, LimitReached = 2, NotFound = 3 }
