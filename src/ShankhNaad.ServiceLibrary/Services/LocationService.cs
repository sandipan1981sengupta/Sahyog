using System.Data;
using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>Team member location (sahyog_TenantLocation, sahyog_UserLocations; database/30_Location.sql).</summary>
public interface ILocationService
{
    Task<TenantLocationDto> GetTenantAsync(Guid tenantId);
    /// <summary>Clients that have location switched on (the super admin list).</summary>
    Task<HashSet<Guid>> EnabledTenantsAsync();
    /// <summary>Super admin: on / off. Off erases every stored location of that client.</summary>
    Task<bool> SetEnabledAsync(Guid tenantId, bool enabled);
    /// <summary>Workspace admin: the office's internet addresses (one per line).</summary>
    Task SetOfficeAsync(Guid tenantId, string? officeIps);
    /// <summary>null = not asked yet.</summary>
    Task<bool?> GetSharingAsync(Guid tenantId, Guid userId);
    /// <summary>Yes / no. No erases what was stored.</summary>
    Task SetSharingAsync(Guid tenantId, Guid userId, bool sharing);
    /// <summary>0 saved, 1 the client has it off, 2 this person doesn't share.</summary>
    Task<int> SaveAsync(Guid tenantId, Guid userId, LocationCheckIn checkIn);
    Task<List<UserLocationDto>> ListAsync(Guid tenantId);
}

public sealed class LocationService : ILocationService
{
    private readonly SqlDb _db;
    public LocationService(SqlDb db) => _db = db;

    private static double? D(SqlDataReader r, string c) { var i = r.GetOrdinal(c); return r.IsDBNull(i) ? null : Convert.ToDouble(r.GetValue(i)); }
    private static bool? BN(SqlDataReader r, string c) { var i = r.GetOrdinal(c); return r.IsDBNull(i) ? null : r.GetBoolean(i); }

    public async Task<TenantLocationDto> GetTenantAsync(Guid tenantId) =>
        await _db.QueryFirstAsync("dbo.sahyog_Location_TenantGet", p => p.With("@TenantId", tenantId),
            r => new TenantLocationDto(r.B("Enabled"), r.SN("OfficeIps"))) ?? new TenantLocationDto(false, null);

    public async Task<HashSet<Guid>> EnabledTenantsAsync() =>
        (await _db.QueryAsync("dbo.sahyog_Location_TenantList", null, r => r.G("TenantId"))).ToHashSet();

    public async Task<bool> SetEnabledAsync(Guid tenantId, bool enabled)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Location_TenantSetEnabled",
            p => p.With("@TenantId", tenantId).With("@Enabled", enabled), r => r.I("Affected"));
        return rows.FirstOrDefault() > 0;
    }

    public Task SetOfficeAsync(Guid tenantId, string? officeIps) =>
        _db.ExecAsync("dbo.sahyog_Location_TenantSetOffice", p => p.With("@TenantId", tenantId).AddText("@OfficeIps", officeIps ?? "", 2000));

    public async Task<bool?> GetSharingAsync(Guid tenantId, Guid userId)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Location_UserGetSharing",
            p => p.With("@TenantId", tenantId).With("@UserId", userId), r => BN(r, "Sharing"));
        return rows.Count == 0 ? null : rows[0];
    }

    public Task SetSharingAsync(Guid tenantId, Guid userId, bool sharing) =>
        _db.ExecAsync("dbo.sahyog_Location_UserSetSharing",
            p => p.With("@TenantId", tenantId).With("@UserId", userId).With("@Sharing", sharing));

    public async Task<int> SaveAsync(Guid tenantId, Guid userId, LocationCheckIn c)
    {
        SqlParameter? result = null;
        await _db.ExecAsync("dbo.sahyog_Location_UserSave", p =>
        {
            p.With("@TenantId", tenantId).With("@UserId", userId)
             .AddText("@Ip", c.Ip, 45)
             .With("@InOffice", c.InOffice)
             .With("@Lat", c.Lat).With("@Lng", c.Lng).With("@AccuracyM", c.AccuracyM)
             .AddText("@Address", c.Address, 300).AddText("@Area", c.Area, 120).AddText("@City", c.City, 120)
             .AddText("@Region", c.Region, 120).AddText("@Country", c.Country, 80);
            result = p.AddOutput("@Result", SqlDbType.Int);
        });
        return result!.OutInt();
    }

    public Task<List<UserLocationDto>> ListAsync(Guid tenantId) =>
        _db.QueryAsync("dbo.sahyog_Location_List", p => p.With("@TenantId", tenantId), r => new UserLocationDto(
            r.G("UserId"), BN(r, "Sharing"), BN(r, "InOffice"), D(r, "Lat"), D(r, "Lng"), r.IN("AccuracyM"),
            r.SN("Address"), r.SN("Area"), r.SN("City"), r.SN("Region"), r.SN("Country"), r.UtcN("PreciseUtc"), r.UtcN("SeenUtc")));
}
