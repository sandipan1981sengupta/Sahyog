namespace Sahyog.DtoLibrary;

/// <summary>One row of sahyog_Plans. Also used to update a plan.</summary>
public sealed class PlanDto
{
    public int PlanId { get; set; }
    public string Name { get; set; } = "";
    public int MaxUsers { get; set; }
    public int MaxMeetingParticipants { get; set; }
    public long StorageQuotaMb { get; set; }
    public int MaxVideoHeight { get; set; }
    public bool RecordingEnabled { get; set; }
    public int MaxMeetingMinutes { get; set; }
    public string VideoProvider { get; set; } = "JaaS";
}

/// <summary>All plan limits for one client, with per-client overrides applied (sahyog_Tenant_GetLimits).</summary>
public sealed record TenantLimitsDto(
    Guid TenantId,
    string TenantName,
    string PlanName,
    int MaxUsers,
    int MaxMeetingParticipants,
    long StorageQuotaBytes,
    long StorageUsedBytes,
    int MaxVideoHeight,
    int MaxMeetingMinutes,
    bool RecordingEnabled,
    string VideoProvider,
    string TimeZoneId,
    bool IsActive,
    int ActiveUsers)
{
    public int StoragePercent => StorageQuotaBytes <= 0 ? 0 : (int)Math.Min(100, StorageUsedBytes * 100 / StorageQuotaBytes);
}

/// <summary>A client in the super admin list (sahyog_Tenant_List).</summary>
public sealed record TenantDto(
    Guid TenantId, string Name, string Slug, string PlanName, int PlanId, bool IsActive, DateTime CreatedUtc,
    long StorageUsedBytes, long StorageQuotaBytes, int MaxUsers, string VideoProvider, int ActiveUsers);

public sealed record TenantSlugDto(Guid TenantId, string Name, string Slug, bool IsActive);

public sealed record TenantActiveDto(string Name, bool IsActive);

/// <summary>Input for creating a client workspace with its first admin.</summary>
public sealed class CreateTenantRequest
{
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";
    public int PlanId { get; set; }
    public string TimeZoneId { get; set; } = "Asia/Kolkata";
    public string AdminName { get; set; } = "";
    public string AdminEmail { get; set; } = "";
    public string AdminPassword { get; set; } = "";
}
