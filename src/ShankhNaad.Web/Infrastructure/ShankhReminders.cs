using Microsoft.AspNetCore.SignalR;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Hubs;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// Shankh: every minute, finds people who still haven't pressed Seen after the alert's reminder time,
/// rings their screens again and tells their managers (once per person per alert).
/// </summary>
public sealed class ShankhReminders : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IHubContext<ChatHub> _hub;
    private readonly ILogger<ShankhReminders> _log;

    public ShankhReminders(IServiceScopeFactory scopes, IHubContext<ChatHub> hub, ILogger<ShankhReminders> log)
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
                try
                {
                    using var scope = _scopes.CreateScope();
                    var shankh = scope.ServiceProvider.GetRequiredService<IShankhService>();
                    var due = await shankh.TakeDueRemindersAsync();
                    if (due.Count == 0) continue;
                    foreach (var alert in due.GroupBy(d => d.AlertId))
                    {
                        var first = alert.First();
                        var board = await shankh.BoardAsync(first.TenantId, first.AlertId);
                        if (board is not null)
                            await _hub.Clients.Users(alert.Select(d => d.UserId.ToString()).ToList()).SendAsync("Shankh", board.Value.Alert, stop);
                        foreach (var mgr in alert.Where(d => d.ManagerId is not null).GroupBy(d => d.ManagerId!.Value))
                            await _hub.Clients.User(mgr.Key.ToString()).SendAsync("ShankhRemind", first.AlertId, mgr.Select(d => d.DisplayName).ToList(), first.Body, stop);
                        // the board updates "Manager reminded"
                        await _hub.Clients.Group(ChatHub.TenantGroup(first.TenantId)).SendAsync("ShankhReminded", first.AlertId, alert.Select(d => d.UserId.ToString()).ToList(), stop);
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _log.LogWarning(ex, "Shankh reminders failed; trying again in a minute.");
                }
            }
        }
        catch (OperationCanceledException) { }
    }
}
