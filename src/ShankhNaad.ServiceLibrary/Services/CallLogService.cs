using System.Data;
using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>Call history for calls started from Chat (needs 22_CallLog.sql; does nothing until it is run).</summary>
public interface ICallLogService
{
    Task StartAsync(Guid tenantId, Guid meetingId, Guid? channelId, Guid callerId);
    /// <summary>A call in this chat that is still ringing or in progress, if any.</summary>
    Task<(Guid MeetingId, int Outcome)?> GetOpenAsync(Guid tenantId, Guid channelId);
    /// <summary>Event: 1 answered, 2 room empty, 3 not answered, 4 declined. Returns the call when its state changed.</summary>
    Task<CallLogDto?> EventAsync(Guid tenantId, Guid meetingId, Guid userId, int evt);
    Task<List<CallLogDto>> GetAsync(Guid tenantId, IEnumerable<Guid> meetingIds);
}

public sealed class CallLogService : ICallLogService
{
    private readonly SqlDb _db;
    private static bool? _ready;
    public CallLogService(SqlDb db) => _db = db;

    private static CallLogDto Map(SqlDataReader r) => new(
        r.G("MeetingId"), r.GN("ChannelId"), r.G("CallerId"), r.Utc("StartedUtc"), r.UtcN("AnsweredUtc"), r.UtcN("EndedUtc"), r.I("Outcome"));

    // 208 = table missing, 2812 = procedure missing: 22_CallLog.sql hasn't been run yet
    private static bool Missing(SqlException ex) => ex.Number is 208 or 2812;

    public async Task StartAsync(Guid tenantId, Guid meetingId, Guid? channelId, Guid callerId)
    {
        if (_ready == false) return;
        try
        {
            await _db.ExecAsync("dbo.sahyog_CallLog_Start", p => p.With("@TenantId", tenantId).With("@MeetingId", meetingId)
                .With("@ChannelId", (object?)channelId ?? DBNull.Value).With("@CallerId", callerId));
            _ready = true;
        }
        catch (SqlException ex) when (Missing(ex)) { _ready = false; }
    }

    public async Task<(Guid MeetingId, int Outcome)?> GetOpenAsync(Guid tenantId, Guid channelId)
    {
        if (_ready == false) return null;
        try
        {
            var rows = await _db.QueryAsync("dbo.sahyog_CallLog_GetOpen", p => p.With("@TenantId", tenantId).With("@ChannelId", channelId),
                r => (r.G("MeetingId"), r.I("Outcome")));
            return rows.Count > 0 ? rows[0] : null;
        }
        catch (SqlException ex) when (Missing(ex)) { _ready = false; return null; }
    }

    public async Task<CallLogDto?> EventAsync(Guid tenantId, Guid meetingId, Guid userId, int evt)
    {
        if (_ready == false) return null;
        try
        {
            SqlParameter? changed = null;
            var rows = await _db.QueryAsync("dbo.sahyog_CallLog_Event", p =>
            {
                p.With("@TenantId", tenantId).With("@MeetingId", meetingId).With("@UserId", userId).With("@Event", (byte)evt);
                changed = p.AddOutput("@Changed", SqlDbType.Bit);
            }, Map);
            return changed?.Value is true && rows.Count > 0 ? rows[0] : null;
        }
        catch (SqlException ex) when (Missing(ex)) { _ready = false; return null; }
    }

    public async Task<List<CallLogDto>> GetAsync(Guid tenantId, IEnumerable<Guid> meetingIds)
    {
        var ids = string.Join(",", meetingIds.Distinct().Take(200));
        if (_ready == false || ids.Length == 0) return new();
        try
        {
            return await _db.QueryAsync("dbo.sahyog_CallLog_Get", p => p.With("@TenantId", tenantId).With("@Ids", ids), Map);
        }
        catch (SqlException ex) when (Missing(ex)) { _ready = false; return new(); }
    }
}
