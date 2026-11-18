using System.Data;
using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>Chat inside a call: messages and files everyone in the call sees (needs 25_CallChat.sql).</summary>
public interface ICallChatService
{
    /// <summary>Status: 0 sent, 1 no such meeting, 2 storage full, 9 the database script hasn't been run.</summary>
    Task<(int Status, CallChatMessageDto? Message)> AddAsync(Guid tenantId, Guid meetingId, Guid? senderId, string senderName, int senderTone,
        string? body, Guid? fileId = null, string? fileName = null, string? contentType = null, long? sizeBytes = null, string? storagePath = null);
    /// <summary>Null when 25_CallChat.sql hasn't been run.</summary>
    Task<List<CallChatMessageDto>?> ListAsync(Guid tenantId, Guid meetingId);
    Task<CallChatFileDto?> GetFileAsync(Guid tenantId, Guid fileId);
}

public sealed class CallChatService : ICallChatService
{
    private readonly SqlDb _db;
    public CallChatService(SqlDb db) => _db = db;
    private static bool Missing(SqlException ex) => ex.Number is 208 or 2812;

    private static CallChatMessageDto Map(SqlDataReader r) => new(
        Convert.ToInt64(r["MessageId"]), r.G("MeetingId"), r.GN("SenderId"), r.S("SenderName"), r.I("SenderTone"),
        r.SN("Body"), r.GN("FileId"), r.SN("FileName"), r.SN("ContentType"),
        r["SizeBytes"] is DBNull ? null : Convert.ToInt64(r["SizeBytes"]), r.Utc("SentUtc"));

    public async Task<(int Status, CallChatMessageDto? Message)> AddAsync(Guid tenantId, Guid meetingId, Guid? senderId, string senderName, int senderTone,
        string? body, Guid? fileId = null, string? fileName = null, string? contentType = null, long? sizeBytes = null, string? storagePath = null)
    {
        try
        {
            SqlParameter? result = null;
            var rows = await _db.QueryAsync("dbo.sahyog_CallChat_Add", p =>
            {
                p.With("@TenantId", tenantId).With("@MeetingId", meetingId)
                 .With("@SenderId", (object?)senderId ?? DBNull.Value).With("@SenderName", senderName).With("@SenderTone", senderTone)
                 .With("@Body", (object?)body ?? DBNull.Value)
                 .With("@FileId", (object?)fileId ?? DBNull.Value).With("@FileName", (object?)fileName ?? DBNull.Value)
                 .With("@ContentType", (object?)contentType ?? DBNull.Value).With("@SizeBytes", (object?)sizeBytes ?? DBNull.Value)
                 .With("@StoragePath", (object?)storagePath ?? DBNull.Value);
                result = p.AddOutput("@Result", SqlDbType.Int);
            }, Map);
            var status = result!.OutInt();
            return (status, status == 0 && rows.Count > 0 ? rows[0] : null);
        }
        catch (SqlException ex) when (Missing(ex)) { return (9, null); }
    }

    public async Task<List<CallChatMessageDto>?> ListAsync(Guid tenantId, Guid meetingId)
    {
        try { return await _db.QueryAsync("dbo.sahyog_CallChat_List", p => p.With("@TenantId", tenantId).With("@MeetingId", meetingId), Map); }
        catch (SqlException ex) when (Missing(ex)) { return null; }
    }

    public async Task<CallChatFileDto?> GetFileAsync(Guid tenantId, Guid fileId)
    {
        try
        {
            var rows = await _db.QueryAsync("dbo.sahyog_CallChat_GetFile", p => p.With("@TenantId", tenantId).With("@FileId", fileId),
                r => new CallChatFileDto(r.G("MeetingId"), r.S("FileName"), r.S("ContentType"), Convert.ToInt64(r["SizeBytes"]), r.S("StoragePath")));
            return rows.Count > 0 ? rows[0] : null;
        }
        catch (SqlException ex) when (Missing(ex)) { return null; }
    }
}
