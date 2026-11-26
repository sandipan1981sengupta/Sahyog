using System.Globalization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.SqlClient;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.ServiceLibrary.Data;
using ShankhNaad.Web.Hubs;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// Every minute:
///  • Stand-up: at each stand-up's time (its workspace's time zone, on its days), reminds whoever hasn't answered ("StandupDue"), once a day.
///  • Message a role: a request nobody answered within the role's minutes goes to the person's manager
///    (or the next person in the role), as a chat message from the person who asked ("RoleRequest" / "RoleEscalated").
/// Both quietly do nothing until 47_Standup.sql / 49_Roles.sql are run.
/// </summary>
public sealed class WorkJobs : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IHubContext<ChatHub> _hub;
    private readonly ILogger<WorkJobs> _log;

    public WorkJobs(IServiceScopeFactory scopes, IHubContext<ChatHub> hub, ILogger<WorkJobs> log)
    {
        _scopes = scopes;
        _hub = hub;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        try
        {
            while (await timer.WaitForNextTickAsync(stop))
            {
                using var scope = _scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<IWorkData>();
                try { await StandupsAsync(db, stop); }
                catch (SqlException ex) when (ex.Number == 2812) { }   // 47_Standup.sql not run yet
                catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogWarning(ex, "Stand-up reminders failed; trying again in a minute."); }
                try { await EscalateAsync(db, scope.ServiceProvider.GetRequiredService<ChatPoster>(), stop); }
                catch (SqlException ex) when (ex.Number == 2812) { }   // 49_Roles.sql not run yet
                catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogWarning(ex, "Role escalation failed; trying again in a minute."); }
            }
        }
        catch (OperationCanceledException) { }
    }

    private async Task StandupsAsync(IWorkData db, CancellationToken stop)
    {
        foreach (var s in await db.RowsAsync("dbo.sahyog_Standup_All"))
        {
            var zone = MeetingCalendar.FindZone(s.S("timeZoneId"));
            var local = MeetingCalendar.ToLocal(DateTime.UtcNow, zone);
            var today = DateOnly.FromDateTime(local);
            if (((s.I("days") >> WorkHelpers.Dow(today)) & 1) == 0) continue;
            var minutes = local.Hour * 60 + local.Minute;
            var at = s.I("atMinutes");
            if (minutes < at || minutes > at + 240) continue;                 // its time today (not hours later, e.g. after a restart)
            if (s.Day("lastRunDay") is DateOnly last && last >= today) continue;
            var pending = await db.RowsAsync("dbo.sahyog_Standup_TakeRun", p => p
                .With("@StandupId", s.I("standupId")).With("@Day", today.ToDateTime(TimeOnly.MinValue)));
            var ids = pending.Select(r => r.G("userId").ToString()).ToList();
            if (ids.Count > 0)
                await _hub.Clients.Users(ids).SendAsync("StandupDue", s.I("standupId"), s.S("name"), stop);
        }
    }

    private async Task EscalateAsync(IWorkData db, ChatPoster poster, CancellationToken stop)
    {
        var due = await db.RowsAsync("dbo.sahyog_RoleRequest_TakeDue");
        if (due.Count == 0) return;
        foreach (var q in due)
        {
            var tenantId = q.G("tenantId");
            var from = q.G("fromUserId");
            var assigned = q.G("assignedTo");
            // the manager of the person who didn't answer, else the next person in the role
            Guid? target = q.GN("managerId") is Guid m && m != from && m != assigned ? m : null;
            if (target is null)
            {
                var sets = await db.SetsAsync("dbo.sahyog_Role_List", p => p.With("@TenantId", tenantId));
                var members = sets.Count > 1 ? sets[1].Where(r => r.I("roleId") == q.I("roleId")).Select(r => r.G("userId")).ToList() : new();
                var i = members.IndexOf(assigned);
                target = members.Skip(i + 1).Concat(members.Take(Math.Max(i, 0))).FirstOrDefault(u => u != from && u != assigned) is Guid next && next != Guid.Empty ? next : null;
            }
            if (target is not Guid to) continue;

            var body = $"⏫ Escalated to you: {q.S("assignedName")} hasn't replied in {q.I("escalateMin")} min.\nTo {q.S("roleName")}: {q.S("body")}";
            var (channel, message) = await poster.SendDirectAsync(tenantId, from, to, body);
            if (channel is not Guid ch) continue;
            await db.ExecAsync("dbo.sahyog_RoleRequest_SetEscalated", p => p
                .With("@RequestId", q.I("requestId")).With("@EscalatedTo", to).With("@EscChannelId", ch));
            await _hub.Clients.User(to.ToString()).SendAsync("RoleRequest", q.S("roleName"), q.S("fromName"), $"/chat/{ch}", true, stop);
            await _hub.Clients.User(from.ToString()).SendAsync("RoleEscalated", q.S("roleName"), q.S("assignedName"), $"/chat/{ch}", stop);
        }
    }
}
