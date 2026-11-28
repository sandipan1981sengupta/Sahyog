using Microsoft.AspNetCore.SignalR;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Hubs;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// Several web servers only (Redis set). Every 20 seconds this server says "I'm alive" in Redis (kept 60 seconds).
/// Every minute it looks for servers that stopped saying so (crashed, restarted, switched off) and cleans up after them:
/// the people connected to that server are marked offline and taken out of their calls, and their workspace is told,
/// so nobody stays "online" or "in a call" forever. A restarted server gets a new id, so this also tidies its old self.
/// </summary>
public sealed class ClusterHeartbeat : BackgroundService
{
    private static readonly TimeSpan Beat = TimeSpan.FromSeconds(20), Alive = TimeSpan.FromSeconds(60);
    private readonly Cluster _cluster;
    private readonly PresenceTracker _presence;
    private readonly MeetingRoomTracker _rooms;
    private readonly IHubContext<ChatHub> _hub;
    private readonly ILogger<ClusterHeartbeat> _log;

    public ClusterHeartbeat(Cluster cluster, PresenceTracker presence, MeetingRoomTracker rooms, IHubContext<ChatHub> hub, ILogger<ClusterHeartbeat> log)
    {
        _cluster = cluster; _presence = presence; _rooms = rooms; _hub = hub; _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var lastSweep = DateTime.MinValue;
        while (!stop.IsCancellationRequested)
        {
            try
            {
                var db = _cluster.Db;
                await db.StringSetAsync(_cluster.Key($"srv:{_cluster.ServerId}:alive"), 1, Alive);
                await db.SetAddAsync(_cluster.Key("servers"), _cluster.ServerId);
                if (DateTime.UtcNow - lastSweep > TimeSpan.FromMinutes(1))
                {
                    lastSweep = DateTime.UtcNow;
                    // one server at a time does the clean-up
                    if (await db.StringSetAsync(_cluster.Key("sweep-lock"), _cluster.ServerId, TimeSpan.FromSeconds(50), StackExchange.Redis.When.NotExists))
                        await SweepAsync();
                }
            }
            catch (Exception ex) { _log.LogWarning(ex, "Redis heartbeat failed; trying again shortly"); }
            try { await Task.Delay(Beat, stop); } catch (TaskCanceledException) { break; }
        }
        // shutting down normally: let the others clean up now instead of waiting a minute
        try { await _cluster.Db.KeyDeleteAsync(_cluster.Key($"srv:{_cluster.ServerId}:alive")); } catch { }
    }

    private async Task SweepAsync()
    {
        var db = _cluster.Db;
        foreach (var server in (await db.SetMembersAsync(_cluster.Key("servers"))).Select(v => v.ToString()))
        {
            if (server == _cluster.ServerId || await db.KeyExistsAsync(_cluster.Key($"srv:{server}:alive"))) continue;
            _log.LogInformation("Web server {ServerId} stopped; cleaning up its connections", server);

            // out of their calls first, then offline
            var wasBusy = _rooms.BusyUsers();
            foreach (var cid in (await db.SetMembersAsync(_cluster.Key($"srv:{server}:rconns"))).Select(v => v.ToString()))
                _rooms.LeaveAll(cid, server);
            var stillBusy = _rooms.BusyUsers();

            foreach (var entry in (await db.SetMembersAsync(_cluster.Key($"srv:{server}:conns"))).Select(v => v.ToString()))
            {
                var bar = entry.IndexOf('|');
                if (bar <= 0) continue;
                var (userId, cid) = (entry[..bar], entry[(bar + 1)..]);
                var tenant = _presence.TenantOf(userId);
                if (wasBusy.Contains(userId) && !stillBusy.Contains(userId))
                {
                    _presence.SetCall(userId, null);
                    if (tenant is Guid bt) await _hub.Clients.Group(ChatHub.TenantGroup(bt)).SendAsync("BusyChanged", userId, false);
                }
                if (_presence.Disconnect(userId, cid) && tenant is Guid t)
                    await _hub.Clients.Group(ChatHub.TenantGroup(t)).SendAsync("PresenceChanged", userId, false);
            }

            await db.KeyDeleteAsync(new StackExchange.Redis.RedisKey[]
                { _cluster.Key($"srv:{server}:conns"), _cluster.Key($"srv:{server}:rconns") });
            await db.SetRemoveAsync(_cluster.Key("servers"), server);
        }
    }
}
