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
    /// <summary>The Calls page: every call in this person's chats (needs 23_CallsAndFiles.sql). Null until it is run.</summary>
    Task<List<CallHistoryDto>?> ListForUserAsync(Guid tenantId, Guid userId, int take = 200);
    /// <summary>The Files page: every file shared in this person's chats (needs 23_CallsAndFiles.sql). Null until it is run.</summary>
    Task<List<SharedFileDto>?> ListFilesForUserAsync(Guid tenantId, Guid userId, int take = 500);
    /// <summary>Calls ringing for this person right now: (meeting, caller id, caller name, caller tone, one-to-one, chat name).</summary>
    Task<List<(Guid MeetingId, Guid CallerId, string CallerName, int CallerTone, bool IsDirect, string ChannelName)>> PendingForUserAsync(Guid tenantId, Guid userId);
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

    public async Task<List<CallHistoryDto>?> ListForUserAsync(Guid tenantId, Guid userId, int take = 200)
    {
        try
        {
            return await _db.QueryAsync("dbo.sahyog_Calls_ListForUser",
                p => p.With("@TenantId", tenantId).With("@UserId", userId).With("@Take", take),
                r => new CallHistoryDto(r.G("MeetingId"), r.G("ChannelId"), r.G("CallerId"), r.S("CallerName"), r.I("CallerTone"),
                    r.Utc("StartedUtc"), r.UtcN("AnsweredUtc"), r.UtcN("EndedUtc"), r.I("Outcome"),
                    Convert.ToBoolean(r["IsDirect"]), r.S("ChannelName"), r.I("MemberCount"),
                    r.GN("OtherId"), r.SN("OtherName"), r["OtherTone"] is DBNull ? 0 : Convert.ToInt32(r["OtherTone"])));
        }
        catch (SqlException ex) when (Missing(ex)) { return null; }
    }

    public async Task<List<SharedFileDto>?> ListFilesForUserAsync(Guid tenantId, Guid userId, int take = 500)
    {
        try
        {
            return await _db.QueryAsync("dbo.sahyog_Files_ListForUser",
                p => p.With("@TenantId", tenantId).With("@UserId", userId).With("@Take", take),
                r => new SharedFileDto(r.G("AttachmentId"), r.S("FileName"), r.S("ContentType"), Convert.ToInt64(r["SizeBytes"]), r.Utc("UploadedUtc"),
                    r.G("UploaderId"), r.S("UploaderName"), r.I("UploaderTone"),
                    r.G("ChannelId"), Convert.ToBoolean(r["IsDirect"]), r.S("ChannelName"),
                    r.GN("OtherId"), r.SN("OtherName"), r["OtherTone"] is DBNull ? 0 : Convert.ToInt32(r["OtherTone"])));
        }
        catch (SqlException ex) when (Missing(ex)) { return null; }
    }

    public async Task<List<(Guid MeetingId, Guid CallerId, string CallerName, int CallerTone, bool IsDirect, string ChannelName)>> PendingForUserAsync(Guid tenantId, Guid userId)
    {
        try
        {
            return await _db.QueryAsync("dbo.sahyog_CallLog_Pending", p => p.With("@TenantId", tenantId).With("@UserId", userId),
                r => (r.G("MeetingId"), r.G("CallerId"), r.S("CallerName"), r.I("CallerTone"), Convert.ToBoolean(r["IsDirect"]), r.S("ChannelName")));
        }
        catch (SqlException ex) when (Missing(ex)) { return new(); }
    }
}
