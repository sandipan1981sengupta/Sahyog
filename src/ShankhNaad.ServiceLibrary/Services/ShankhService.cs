using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>Shankh: urgent alerts that ring until each person presses Seen (45_Shankh.sql).</summary>
public interface IShankhService
{
    /// <summary>Sends an alert to these people. Returns how many people it reached (active people of this company only).</summary>
    Task<int> CreateAsync(Guid alertId, Guid tenantId, Guid senderId, string kind, string body, string audience, int? remindAfterMin, IEnumerable<Guid> userIds);
    /// <summary>"Seen". Returns when, and who sent it (null when the alert isn't theirs).</summary>
    Task<(DateTime SeenUtc, Guid SenderId)?> SeenAsync(Guid tenantId, Guid alertId, Guid userId);
    /// <summary>Alerts still ringing for this person.</summary>
    Task<List<ShankhAlertDto>> MyOpenAsync(Guid tenantId, Guid userId);
    /// <summary>The alert and everyone on it (null when not found).</summary>
    Task<(ShankhAlertDto Alert, List<ShankhRecipientDto> People)?> BoardAsync(Guid tenantId, Guid alertId);
    Task<List<ShankhSummaryDto>> RecentAsync(Guid tenantId);
    /// <summary>Stops the alert. Returns the people whose screens were still ringing.</summary>
    Task<List<Guid>> CloseAsync(Guid tenantId, Guid alertId, Guid userId);
    /// <summary>People who still haven't seen an alert after its reminder time (each returned once).</summary>
    Task<List<ShankhReminderDto>> TakeDueRemindersAsync();
}

public sealed class ShankhService : IShankhService
{
    private readonly SqlDb _db;
    public ShankhService(SqlDb db) => _db = db;

    private static ShankhAlertDto Alert(SqlDataReader r, bool full) => new(
        r.G("AlertId"), r.S("Kind"), r.S("Body"), r.S("Audience"), r.Utc("SentUtc"), r.G("SenderId"), r.SN("SenderName") ?? "Someone",
        full ? r.UtcN("ClosedUtc") : null, full ? r.IN("RemindAfterMin") : null);

    public async Task<int> CreateAsync(Guid alertId, Guid tenantId, Guid senderId, string kind, string body, string audience, int? remindAfterMin, IEnumerable<Guid> userIds)
    {
        var ids = string.Join(",", userIds.Distinct());
        var rows = await _db.QueryAsync("dbo.sahyog_Shankh_Create", p => p
            .With("@AlertId", alertId).With("@TenantId", tenantId).With("@SenderId", senderId)
            .AddText("@Kind", kind, 20).AddText("@Body", body, 1000).AddText("@Audience", audience, 200)
            .With("@RemindAfterMin", remindAfterMin).AddText("@UserIds", ids, -1), r => r.I("People"));
        return rows.FirstOrDefault();
    }

    public async Task<(DateTime SeenUtc, Guid SenderId)?> SeenAsync(Guid tenantId, Guid alertId, Guid userId)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Shankh_Seen",
            p => p.With("@AlertId", alertId).With("@UserId", userId).With("@TenantId", tenantId),
            r => (Seen: r.UtcN("SeenUtc"), Sender: r.G("SenderId")));
        if (rows.Count == 0 || rows[0].Seen is null) return null;
        return (rows[0].Seen!.Value, rows[0].Sender);
    }

    public async Task<List<ShankhAlertDto>> MyOpenAsync(Guid tenantId, Guid userId)
    {
        try
        {
            return await _db.QueryAsync("dbo.sahyog_Shankh_MyOpen",
                p => p.With("@TenantId", tenantId).With("@UserId", userId), r => Alert(r, false));
        }
        catch (SqlException) { return new(); }      // 45_Shankh.sql not run yet: nothing to ring
    }

    public async Task<(ShankhAlertDto Alert, List<ShankhRecipientDto> People)?> BoardAsync(Guid tenantId, Guid alertId)
    {
        var (a, people) = await _db.QueryMultipleAsync("dbo.sahyog_Shankh_Board",
            p => p.With("@TenantId", tenantId).With("@AlertId", alertId),
            r => Alert(r, true),
            r => new ShankhRecipientDto(r.G("UserId"), r.S("DisplayName"), r.I("AvatarTone"), r.SN("DepartmentName"),
                r.GN("ManagerId"), r.SN("ManagerName"), r.UtcN("SeenUtc"), r.UtcN("RemindedUtc")));
        return a.Count == 0 ? null : (a[0], people);
    }

    public async Task<List<ShankhSummaryDto>> RecentAsync(Guid tenantId)
    {
        try
        {
            return await _db.QueryAsync("dbo.sahyog_Shankh_Recent", p => p.With("@TenantId", tenantId),
                r => new ShankhSummaryDto(r.G("AlertId"), r.S("Kind"), r.S("Body"), r.S("Audience"), r.Utc("SentUtc"), r.UtcN("ClosedUtc"),
                    r.SN("SenderName") ?? "Someone", r.I("People"), r.I("Seen")));
        }
        catch (SqlException) { return new(); }
    }

    public Task<List<Guid>> CloseAsync(Guid tenantId, Guid alertId, Guid userId) =>
        _db.QueryAsync("dbo.sahyog_Shankh_Close",
            p => p.With("@TenantId", tenantId).With("@AlertId", alertId).With("@UserId", userId), r => r.G("UserId"));

    public async Task<List<ShankhReminderDto>> TakeDueRemindersAsync()
    {
        try
        {
            return await _db.QueryAsync("dbo.sahyog_Shankh_TakeDueReminders", null,
                r => new ShankhReminderDto(r.G("AlertId"), r.G("TenantId"), r.S("Body"), r.G("SenderId"),
                    r.G("UserId"), r.S("DisplayName"), r.GN("ManagerId"), r.SN("ManagerName")));
        }
        catch (SqlException) { return new(); }
    }
}
