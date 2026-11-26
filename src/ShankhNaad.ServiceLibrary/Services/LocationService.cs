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

    // ---- privacy (44_LocationPrivacy.sql). Each falls back quietly when that script hasn't been run yet. ----
    /// <summary>How many days a location is kept without being refreshed (30 by default).</summary>
    Task<int> GetRetentionDaysAsync(Guid tenantId);
    /// <summary>Workspace admin: 1 to 365 days. Returns the value saved.</summary>
    Task<int> SetRetentionDaysAsync(Guid tenantId, int days);
    /// <summary>Yes / no with a record of when, and which version of the notice the person saw.</summary>
    Task SetSharingAsync(Guid tenantId, Guid userId, bool sharing, string noticeVersion);
    /// <summary>Erases locations older than each client's retention (tenantId null = every client).</summary>
    Task<LocationPurgeResult> PurgeAsync(Guid? tenantId = null);
    /// <summary>The person's own stored record (null when nothing was ever stored).</summary>
    Task<MyLocationRecord?> GetMineAsync(Guid tenantId, Guid userId);
    /// <summary>How many sharing people connected from each internet address since a time, most first (31_OfficeSuggestion.sql).
    /// Empty when that script hasn't been run yet.</summary>
    Task<List<LocationIpCount>> IpCountsAsync(Guid tenantId, DateTime sinceUtc);
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

    public async Task<List<LocationIpCount>> IpCountsAsync(Guid tenantId, DateTime sinceUtc)
    {
        try
        {
            return await _db.QueryAsync("dbo.sahyog_Location_IpCounts",
                p => p.With("@TenantId", tenantId).AddDateTime2("@SinceUtc", sinceUtc), r => new LocationIpCount(r.S("Ip"), r.I("People")));
        }
        catch (SqlException) { return new(); }      // 31_OfficeSuggestion.sql not run yet: simply no suggestion
    }

    public async Task<int> GetRetentionDaysAsync(Guid tenantId)
    {
        try
        {
            var rows = await _db.QueryAsync("dbo.sahyog_Location_GetRetention", p => p.With("@TenantId", tenantId), r => r.I("RetentionDays"));
            return rows.Count == 0 ? 30 : rows[0];
        }
        catch (SqlException) { return 30; }      // 44_LocationPrivacy.sql not run yet
    }

    public async Task<int> SetRetentionDaysAsync(Guid tenantId, int days)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Location_SetRetention",
            p => p.With("@TenantId", tenantId).With("@Days", Math.Clamp(days, 1, 365)), r => r.I("RetentionDays"));
        return rows.FirstOrDefault();
    }

    public async Task SetSharingAsync(Guid tenantId, Guid userId, bool sharing, string noticeVersion)
    {
        try
        {
            await _db.ExecAsync("dbo.sahyog_Location_UserSetSharing2",
                p => p.With("@TenantId", tenantId).With("@UserId", userId).With("@Sharing", sharing).AddText("@NoticeVersion", noticeVersion, 20));
        }
        catch (SqlException) { await SetSharingAsync(tenantId, userId, sharing); }   // old database: yes / no without the record
    }

    public async Task<LocationPurgeResult> PurgeAsync(Guid? tenantId = null)
    {
        try
        {
            var rows = await _db.QueryAsync("dbo.sahyog_Location_Purge",
                p => p.With("@TenantId", tenantId), r => new LocationPurgeResult(r.I("Erased"), r.I("MapsErased")));
            return rows.FirstOrDefault() ?? new LocationPurgeResult(0, 0);
        }
        catch (SqlException) { return new LocationPurgeResult(0, 0); }
    }

    public async Task<MyLocationRecord?> GetMineAsync(Guid tenantId, Guid userId)
    {
        try
        {
            return await _db.QueryFirstAsync("dbo.sahyog_Location_Mine", p => p.With("@TenantId", tenantId).With("@UserId", userId), r => new MyLocationRecord(
                BN(r, "Sharing"), BN(r, "InOffice"), r.SN("Ip"), D(r, "Lat"), D(r, "Lng"), r.IN("AccuracyM"),
                r.SN("Address"), r.SN("Area"), r.SN("City"), r.SN("Region"), r.SN("Country"),
                r.UtcN("PreciseUtc"), r.UtcN("SeenUtc"), r.UtcN("DecidedUtc"), r.SN("NoticeVersion"), r.I("RetentionDays")));
        }
        catch (SqlException) { return null; }
    }

    public async Task<List<UserLocationDto>> ListAsync(Guid tenantId)
    {
        await PurgeAsync(tenantId);      // never show a location older than the company's "keep for" setting
        return await _db.QueryAsync("dbo.sahyog_Location_List", p => p.With("@TenantId", tenantId), r => new UserLocationDto(
            r.G("UserId"), BN(r, "Sharing"), BN(r, "InOffice"), D(r, "Lat"), D(r, "Lng"), r.IN("AccuracyM"),
            r.SN("Address"), r.SN("Area"), r.SN("City"), r.SN("Region"), r.SN("Country"), r.UtcN("PreciseUtc"), r.UtcN("SeenUtc")));
    }
}
