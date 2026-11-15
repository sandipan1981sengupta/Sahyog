using System.Data;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary.Data;

namespace Sahyog.ServiceLibrary;

/// <summary>Plans and client workspaces (super admin + plan limits).</summary>
public interface ITenantService
{
    Task<List<PlanDto>> GetPlansAsync();
    Task<bool> UpdatePlanAsync(PlanDto plan);
    Task<TenantLimitsDto?> GetLimitsAsync(Guid tenantId);
    Task<List<TenantDto>> ListAsync();
    Task<TenantSlugDto?> GetBySlugAsync(string slug);
    Task<OperationResult> CreateAsync(CreateTenantRequest request);
    Task<bool> SetPlanAsync(Guid tenantId, int planId);
    Task<TenantActiveDto?> ToggleActiveAsync(Guid tenantId);
}

public sealed partial class TenantService : ITenantService
{
    private readonly SqlDb _db;
    public TenantService(SqlDb db) => _db = db;

    [GeneratedRegex("^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$")]
    private static partial Regex SlugRegex();

    public Task<List<PlanDto>> GetPlansAsync() =>
        _db.QueryAsync("dbo.sahyog_Plan_List", null, r => new PlanDto
        {
            PlanId = r.I("PlanId"),
            Name = r.S("Name"),
            MaxUsers = r.I("MaxUsers"),
            MaxMeetingParticipants = r.I("MaxMeetingParticipants"),
            StorageQuotaMb = r.L("StorageQuotaMb"),
            MaxVideoHeight = r.I("MaxVideoHeight"),
            RecordingEnabled = r.B("RecordingEnabled"),
            MaxMeetingMinutes = r.I("MaxMeetingMinutes"),
            VideoProvider = r.S("VideoProvider")
        });

    public async Task<bool> UpdatePlanAsync(PlanDto plan)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Plan_Update", p => p
            .With("@PlanId", plan.PlanId)
            .With("@MaxUsers", plan.MaxUsers)
            .With("@MaxMeetingParticipants", plan.MaxMeetingParticipants)
            .With("@StorageQuotaMb", plan.StorageQuotaMb)
            .With("@MaxVideoHeight", plan.MaxVideoHeight)
            .With("@RecordingEnabled", plan.RecordingEnabled)
            .With("@MaxMeetingMinutes", plan.MaxMeetingMinutes)
            .AddText("@VideoProvider", plan.VideoProvider, 30), r => r.I("Affected"));
        return rows.FirstOrDefault() > 0;
    }

    public Task<TenantLimitsDto?> GetLimitsAsync(Guid tenantId) =>
        _db.QueryFirstAsync("dbo.sahyog_Tenant_GetLimits", p => p.With("@TenantId", tenantId), r => new TenantLimitsDto(
            r.G("TenantId"), r.S("TenantName"), r.S("PlanName"), r.I("MaxUsers"), r.I("MaxMeetingParticipants"),
            r.L("StorageQuotaBytes"), r.L("StorageUsedBytes"), r.I("MaxVideoHeight"), r.I("MaxMeetingMinutes"),
            r.B("RecordingEnabled"), r.S("VideoProvider"), r.S("TimeZoneId"), r.B("IsActive"), r.I("ActiveUsers")));

    public Task<List<TenantDto>> ListAsync() =>
        _db.QueryAsync("dbo.sahyog_Tenant_List", null, r => new TenantDto(
            r.G("TenantId"), r.S("Name"), r.S("Slug"), r.S("PlanName"), r.I("PlanId"), r.B("IsActive"), r.Utc("CreatedUtc"),
            r.L("StorageUsedBytes"), r.L("StorageQuotaBytes"), r.I("MaxUsers"), r.S("VideoProvider"), r.I("ActiveUsers")));

    public Task<TenantSlugDto?> GetBySlugAsync(string slug) =>
        _db.QueryFirstAsync("dbo.sahyog_Tenant_GetBySlug", p => p.AddText("@Slug", slug.Trim().ToLowerInvariant(), 40),
            r => new TenantSlugDto(r.G("TenantId"), r.S("Name"), r.S("Slug"), r.B("IsActive")));

    /// <summary>Creates the workspace, its #general channel and its first admin in one transaction (sahyog_Tenant_Create).</summary>
    public async Task<OperationResult> CreateAsync(CreateTenantRequest request)
    {
        var slug = request.Slug.Trim().ToLowerInvariant();
        var email = request.AdminEmail.Trim().ToLowerInvariant();
        if (!SlugRegex().IsMatch(slug))
            return OperationResult.Fail("Workspace name must be 3–40 characters: lowercase letters, numbers and hyphens.");
        if (Passwords.Validate(request.AdminPassword) is string passwordError)
            return OperationResult.Fail(passwordError);

        var tenantId = Guid.NewGuid();
        SqlParameter? result = null;
        await _db.ExecAsync("dbo.sahyog_Tenant_Create", p =>
        {
            p.With("@TenantId", tenantId)
             .AddText("@Name", request.Name.Trim(), 120)
             .AddText("@Slug", slug, 40)
             .With("@PlanId", request.PlanId)
             .AddText("@TimeZoneId", request.TimeZoneId, 64)
             .With("@AdminUserId", Guid.NewGuid())
             .AddText("@AdminEmail", email, 256)
             .AddText("@AdminName", request.AdminName.Trim(), 100)
             .AddText("@AdminPasswordHash", Passwords.Hash(request.AdminPassword), 400)
             .With("@AdminTone", Passwords.ToneFor(email));
            result = p.AddOutput("@Result", SqlDbType.Int);
        });

        return result!.OutInt() switch
        {
            0 => OperationResult.Ok(tenantId),
            1 => OperationResult.Fail("That workspace name is already taken."),
            2 => OperationResult.Fail("A user with this email already exists."),
            3 => OperationResult.Fail("Unknown plan."),
            _ => OperationResult.Fail("Could not create the workspace.")
        };
    }

    public async Task<bool> SetPlanAsync(Guid tenantId, int planId)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Tenant_SetPlan", p => p.With("@TenantId", tenantId).With("@PlanId", planId), r => r.I("Affected"));
        return rows.FirstOrDefault() > 0;
    }

    public Task<TenantActiveDto?> ToggleActiveAsync(Guid tenantId) =>
        _db.QueryFirstAsync("dbo.sahyog_Tenant_ToggleActive", p => p.With("@TenantId", tenantId),
            r => new TenantActiveDto(r.S("Name"), r.B("IsActive")));
}
