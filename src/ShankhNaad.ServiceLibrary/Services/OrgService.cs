using System.Data;
using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>Organization structure: departments, job titles and who reports to whom (database/40_OrgStructure.sql).</summary>
public interface IOrgService
{
    /// <summary>People and departments. Ready = false (and empty lists) before 40_OrgStructure.sql is run.</summary>
    Task<OrgDataDto> GetAsync(Guid tenantId);
    Task<OrgSaveStatus> SetPersonAsync(OrgPersonUpdate update);
    Task<(DepartmentSaveStatus Status, Guid? Id)> SaveDepartmentAsync(Guid tenantId, Guid? departmentId, string name, Guid? headUserId);
    Task<bool> DeleteDepartmentAsync(Guid tenantId, Guid departmentId);
    /// <summary>The department with this name, created when missing. Null for an empty name.</summary>
    Task<Guid?> EnsureDepartmentAsync(Guid tenantId, string? name);
    /// <summary>People this person pinned on the Calls page (empty before 41_PeoplePins.sql is run).</summary>
    Task<List<Guid>> ListPinsAsync(Guid userId);
    /// <summary>Pin or unpin someone. Null when it worked, else the reason.</summary>
    Task<string?> SetPinAsync(Guid tenantId, Guid userId, Guid pinnedUserId, bool pinned);
}

public sealed class OrgService : IOrgService
{
    private const int MissingProcedure = 2812;
    private readonly SqlDb _db;
    public OrgService(SqlDb db) => _db = db;

    private static DateOnly? DateOpt(SqlDataReader r, string column)
    {
        var i = r.GetOrdinal(column);
        return r.IsDBNull(i) ? null : DateOnly.FromDateTime(r.GetDateTime(i));
    }

    public async Task<OrgDataDto> GetAsync(Guid tenantId)
    {
        try
        {
            var people = await _db.QueryAsync("dbo.sahyog_Org_ListPeople", p => p.With("@TenantId", tenantId),
                r => new OrgPersonDto(r.G("UserId"), r.S("DisplayName"), r.S("Email"), r.S("Role"), r.I("AvatarTone"),
                    r.SN("JobTitle"), r.GN("DepartmentId"), r.SN("DepartmentName"), r.GN("ManagerId"),
                    r.SN("Phone"), r.SN("EmployeeCode"), DateOpt(r, "JoinedOn")));
            var departments = await _db.QueryAsync("dbo.sahyog_Org_ListDepartments", p => p.With("@TenantId", tenantId),
                r => new DepartmentDto(r.G("DepartmentId"), r.S("Name"), r.GN("HeadUserId"), r.SN("HeadName"), r.I("People")));
            return new OrgDataDto(true, people, departments);
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure)
        {
            return new OrgDataDto(false, new(), new());
        }
    }

    public async Task<OrgSaveStatus> SetPersonAsync(OrgPersonUpdate u)
    {
        try
        {
            SqlParameter? result = null;
            await _db.ExecAsync("dbo.sahyog_Org_SetPerson", p =>
            {
                p.With("@TenantId", u.TenantId).With("@UserId", u.UserId)
                 .AddText("@JobTitle", Trim(u.JobTitle, 100), 100)
                 .With("@DepartmentId", u.DepartmentId)
                 .With("@ManagerId", u.ManagerId)
                 .AddText("@Phone", Trim(u.Phone, 40), 40)
                 .AddText("@EmployeeCode", Trim(u.EmployeeCode, 40), 40);
                p.Add(new SqlParameter("@JoinedOn", SqlDbType.Date)
                {
                    Value = u.JoinedOn is DateOnly d ? d.ToDateTime(TimeOnly.MinValue) : DBNull.Value
                });
                result = p.AddOutput("@Result", SqlDbType.Int);
            });
            return (OrgSaveStatus)result!.OutInt();
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return OrgSaveStatus.NeedsDatabase; }
    }

    public async Task<(DepartmentSaveStatus Status, Guid? Id)> SaveDepartmentAsync(Guid tenantId, Guid? departmentId, string name, Guid? headUserId)
    {
        try
        {
            SqlParameter? result = null, newId = null;
            await _db.ExecAsync("dbo.sahyog_Org_SaveDepartment", p =>
            {
                p.With("@TenantId", tenantId).With("@DepartmentId", departmentId)
                 .AddText("@Name", Trim(name, 100), 100).With("@HeadUserId", headUserId);
                result = p.AddOutput("@Result", SqlDbType.Int);
                newId = p.AddOutput("@NewId", SqlDbType.UniqueIdentifier);
            });
            var status = (DepartmentSaveStatus)result!.OutInt();
            return (status, newId!.Value is Guid g ? g : null);
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return (DepartmentSaveStatus.NeedsDatabase, null); }
    }

    public async Task<bool> DeleteDepartmentAsync(Guid tenantId, Guid departmentId)
    {
        try
        {
            await _db.ExecAsync("dbo.sahyog_Org_DeleteDepartment", p => p.With("@TenantId", tenantId).With("@DepartmentId", departmentId));
            return true;
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return false; }
    }

    public async Task<Guid?> EnsureDepartmentAsync(Guid tenantId, string? name)
    {
        var clean = Trim(name, 100);
        if (string.IsNullOrEmpty(clean)) return null;
        SqlParameter? id = null;
        await _db.ExecAsync("dbo.sahyog_Org_EnsureDepartment", p =>
        {
            p.With("@TenantId", tenantId).AddText("@Name", clean, 100);
            id = p.AddOutput("@DepartmentId", SqlDbType.UniqueIdentifier);
        });
        return id!.Value is Guid g ? g : null;
    }

    private static string? Trim(string? value, int max)
    {
        var t = (value ?? "").Trim();
        return t.Length == 0 ? null : t.Length > max ? t[..max] : t;
    }

    public async Task<List<Guid>> ListPinsAsync(Guid userId)
    {
        try { return await _db.QueryAsync("dbo.sahyog_PeoplePins_List", p => p.With("@UserId", userId), r => r.G("PinnedUserId")); }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return new(); }
    }

    public async Task<string?> SetPinAsync(Guid tenantId, Guid userId, Guid pinnedUserId, bool pinned)
    {
        try
        {
            SqlParameter? result = null;
            await _db.ExecAsync("dbo.sahyog_PeoplePins_Set", p =>
            {
                p.With("@TenantId", tenantId).With("@UserId", userId).With("@PinnedUserId", pinnedUserId).With("@Pinned", pinned);
                result = p.AddOutput("@Result", SqlDbType.Int);
            });
            return result!.OutInt() == 0 ? null : "That person isn't in your workspace.";
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure)
        {
            return "Pins need the database update database/41_PeoplePins.sql. Ask CloudWheel to run it.";
        }
    }
}
