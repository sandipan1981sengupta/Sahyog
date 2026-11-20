using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>Out of office (sahyog_OutOfOffice; database/32_OutOfOfficeAndEdit.sql). Kept in the database so it shows while you're offline.</summary>
public interface IOutOfOfficeService
{
    /// <summary>Everyone in the workspace who is out of office now (user id → note). Empty before the script is run.</summary>
    Task<Dictionary<string, OutOfOfficeDto>> ListAsync(Guid tenantId);
    /// <summary>False when the database doesn't have the table yet (32_OutOfOfficeAndEdit.sql).</summary>
    Task<bool> SetAsync(Guid tenantId, Guid userId, string? message, DateTime? untilUtc);
    Task<bool> ClearAsync(Guid tenantId, Guid userId);
}

public sealed class OutOfOfficeService : IOutOfOfficeService
{
    private readonly SqlDb _db;
    public OutOfOfficeService(SqlDb db) => _db = db;
    private const int MissingProcedure = 2812;

    public async Task<Dictionary<string, OutOfOfficeDto>> ListAsync(Guid tenantId)
    {
        try
        {
            var rows = await _db.QueryAsync("dbo.sahyog_Ooo_List", p => p.With("@TenantId", tenantId),
                r => (Id: r.G("UserId").ToString(), Dto: new OutOfOfficeDto(r.SN("Message"), r.UtcN("UntilUtc"), r.Utc("SinceUtc"))));
            return rows.ToDictionary(x => x.Id, x => x.Dto);
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return new(); }
    }

    public async Task<bool> SetAsync(Guid tenantId, Guid userId, string? message, DateTime? untilUtc)
    {
        try
        {
            await _db.ExecAsync("dbo.sahyog_Ooo_Set", p => p.With("@TenantId", tenantId).With("@UserId", userId)
                .AddText("@Message", message, 500).AddDateTime2("@UntilUtc", untilUtc));
            return true;
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return false; }
    }

    public async Task<bool> ClearAsync(Guid tenantId, Guid userId)
    {
        try
        {
            await _db.ExecAsync("dbo.sahyog_Ooo_Clear", p => p.With("@TenantId", tenantId).With("@UserId", userId));
            return true;
        }
        catch (SqlException ex) when (ex.Number == MissingProcedure) { return false; }
    }
}
