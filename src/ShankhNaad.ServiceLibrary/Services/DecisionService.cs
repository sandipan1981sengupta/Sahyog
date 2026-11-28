using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>Nirnay: the decision log (46_Nirnay.sql). Reads only return what the person may see.</summary>
public interface IDecisionService
{
    /// <summary>Adds or changes one. Returns its id (0 when the message wasn't in that chat, or it wasn't found).</summary>
    Task<int> SaveAsync(Guid tenantId, Guid userId, DecisionSave d);
    Task<DecisionDto?> GetAsync(Guid tenantId, Guid userId, int decisionId);
    Task<List<DecisionDto>> ListAsync(Guid tenantId, Guid userId, DecisionFilter f);
    Task<List<DecisionDto>> ForMessagesAsync(Guid tenantId, Guid userId, IEnumerable<long> messageIds);
    Task<List<DecisionDto>> ForMeetingAsync(Guid tenantId, Guid meetingId, DateOnly? date);
    Task<bool> SetDoneAsync(Guid tenantId, Guid userId, int decisionId, bool done);
    Task<bool> DeleteAsync(Guid tenantId, int decisionId);
    /// <summary>The person asked to own it answers: accept (they become the owner) or decline. False when it wasn't asked of them.</summary>
    Task<bool> AnswerAsync(Guid tenantId, Guid userId, int decisionId, bool accept);
    /// <summary>"Not mine": the owner hands it back to whoever recorded it. False when they don't own it or recorded it themselves.</summary>
    Task<bool> ReleaseAsync(Guid tenantId, Guid userId, int decisionId);
}

public sealed class DecisionService : IDecisionService
{
    private readonly SqlDb _db;
    public DecisionService(SqlDb db) => _db = db;

    private static DateOnly? Date(SqlDataReader r, string c) => r[c] is DateTime d ? DateOnly.FromDateTime(d) : null;
    private static long? LongN(SqlDataReader r, string c) => r[c] is DBNull or null ? null : Convert.ToInt64(r[c]);
    private static DateTime? AsDate(DateOnly? d) => d?.ToDateTime(TimeOnly.MinValue);

    /// <summary>Does this result have the column? (the owner columns come with 55_DecisionOwners.sql)</summary>
    private static bool Has(SqlDataReader r, string c)
    {
        for (var i = 0; i < r.FieldCount; i++) if (string.Equals(r.GetName(i), c, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static DecisionDto Row(SqlDataReader r)
    {
        var d = new DecisionDto(
            r.I("DecisionId"), r.S("Kind"), r.S("Title"), r.SN("Details"),
            r.GN("OwnerId"), r.SN("OwnerName"), r["OwnerTone"] is DBNull ? 0 : r.I("OwnerTone"), r.GN("DepartmentId"), r.SN("DepartmentName"),
            Date(r, "DueDate"), r.UtcN("DoneUtc"),
            r.GN("ChannelId"), LongN(r, "MessageId"), r.SN("ChannelName"), r.B("ChannelIsDirect"),
            r.GN("MeetingId"), Date(r, "MeetingDate"), r.SN("MeetingTitle"), r.GN("MeetingHostId"),
            r.G("RecordedBy"), r.SN("RecordedByName"), r.Utc("RecordedUtc"));
        if (!Has(r, "AskedOwnerId")) return d;
        return d with
        {
            AskedOwnerId = r.GN("AskedOwnerId"), AskedOwnerName = r.SN("AskedOwnerName"),
            AskedOwnerTone = r["AskedOwnerTone"] is DBNull ? 0 : r.I("AskedOwnerTone"), AskedUtc = r.UtcN("AskedUtc"),
            DeclinedBy = r.GN("DeclinedBy"), DeclinedByName = r.SN("DeclinedByName"), DeclinedUtc = r.UtcN("DeclinedUtc")
        };
    }

    public async Task<int> SaveAsync(Guid tenantId, Guid userId, DecisionSave d)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Decision_Save", p =>
        {
            p.With("@DecisionId", d.DecisionId == 0 ? null : d.DecisionId).With("@TenantId", tenantId).With("@UserId", userId)
             .AddText("@Kind", d.Kind == "A" ? "A" : "D", 1).AddText("@Title", d.Title, 300).AddText("@Details", d.Details, 1000)
             .With("@OwnerId", d.OwnerId).With("@DueDate", AsDate(d.DueDate))
             .With("@ChannelId", d.ChannelId).With("@MessageId", d.MessageId)
             .With("@MeetingId", d.MeetingId).With("@MeetingDate", AsDate(d.MeetingDate));
            // only sent when someone is asked, so saving still works before 55_DecisionOwners.sql is run
            if (d.AskedOwnerId is Guid asked) p.With("@AskedOwnerId", asked);
        }, r => r.I("DecisionId"));
        return rows.FirstOrDefault();
    }

    public async Task<DecisionDto?> GetAsync(Guid tenantId, Guid userId, int decisionId)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Decision_Get",
            p => p.With("@TenantId", tenantId).With("@UserId", userId).With("@DecisionId", decisionId), Row);
        return rows.FirstOrDefault();
    }

    public async Task<List<DecisionDto>> ListAsync(Guid tenantId, Guid userId, DecisionFilter f)
    {
        try
        {
            return await _db.QueryAsync("dbo.sahyog_Decision_List", p => p
                .With("@TenantId", tenantId).With("@UserId", userId)
                .AddText("@Kind", f.Kind is "A" or "D" ? f.Kind : null, 1).With("@Open", f.Open).With("@Mine", f.Mine)
                .AddText("@Source", f.Source is "chat" or "meeting" or "other" ? f.Source : null, 10)
                .With("@DepartmentId", f.DepartmentId).AddDateTime2("@FromUtc", f.FromUtc)
                .AddText("@Search", string.IsNullOrWhiteSpace(f.Search) ? null : f.Search.Trim(), 100)
                .With("@Top", Math.Clamp(f.Top, 1, 1000)), Row);
        }
        catch (SqlException) { return new(); }   // 46_Nirnay.sql not run yet
    }

    public async Task<List<DecisionDto>> ForMessagesAsync(Guid tenantId, Guid userId, IEnumerable<long> messageIds)
    {
        var ids = string.Join(",", messageIds.Where(i => i > 0).Distinct().Take(300));
        if (ids.Length == 0) return new();
        try
        {
            return await _db.QueryAsync("dbo.sahyog_Decision_ForMessages",
                p => p.With("@TenantId", tenantId).With("@UserId", userId).AddText("@Ids", ids, -1), Row);
        }
        catch (SqlException) { return new(); }
    }

    public async Task<List<DecisionDto>> ForMeetingAsync(Guid tenantId, Guid meetingId, DateOnly? date)
    {
        try
        {
            return await _db.QueryAsync("dbo.sahyog_Decision_ForMeeting",
                p => p.With("@TenantId", tenantId).With("@MeetingId", meetingId).With("@MeetingDate", AsDate(date)), Row);
        }
        catch (SqlException) { return new(); }
    }

    public async Task<bool> SetDoneAsync(Guid tenantId, Guid userId, int decisionId, bool done)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Decision_SetDone",
            p => p.With("@TenantId", tenantId).With("@UserId", userId).With("@DecisionId", decisionId).With("@Done", done), r => r.I("Changed"));
        return rows.FirstOrDefault() > 0;
    }

    public async Task<bool> AnswerAsync(Guid tenantId, Guid userId, int decisionId, bool accept)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Decision_Answer",
            p => p.With("@TenantId", tenantId).With("@UserId", userId).With("@DecisionId", decisionId).With("@Accept", accept), r => r.I("Changed"));
        return rows.FirstOrDefault() > 0;
    }

    public async Task<bool> ReleaseAsync(Guid tenantId, Guid userId, int decisionId)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Decision_Release",
            p => p.With("@TenantId", tenantId).With("@UserId", userId).With("@DecisionId", decisionId), r => r.I("Changed"));
        return rows.FirstOrDefault() > 0;
    }

    public async Task<bool> DeleteAsync(Guid tenantId, int decisionId)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Decision_Delete",
            p => p.With("@TenantId", tenantId).With("@DecisionId", decisionId), r => r.I("Changed"));
        return rows.FirstOrDefault() > 0;
    }
}
