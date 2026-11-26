using ShankhNaad.ServiceLibrary;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// Team location privacy: erases locations that weren't refreshed within each company's "keep for" setting
/// (Team → Office address → Keep locations for; 30 days by default). Runs a minute after the app starts,
/// then every 6 hours. Reading a location also never shows one older than the setting (see LocationController),
/// so even if the app was asleep, nothing expired is ever shown.
/// </summary>
public sealed class LocationRetention : BackgroundService
{
    private static readonly TimeSpan First = TimeSpan.FromMinutes(1), Every = TimeSpan.FromHours(6);
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<LocationRetention> _log;

    public LocationRetention(IServiceScopeFactory scopes, ILogger<LocationRetention> log)
    {
        _scopes = scopes;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        try { await Task.Delay(First, stop); } catch (OperationCanceledException) { return; }
        using var timer = new PeriodicTimer(Every);
        do
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var r = await scope.ServiceProvider.GetRequiredService<ILocationService>().PurgeAsync();
                if (r.Erased > 0 || r.MapsErased > 0)
                    _log.LogInformation("Location clean-up: erased {Erased} old locations and {Maps} old map positions.", r.Erased, r.MapsErased);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogWarning(ex, "Location clean-up failed; it will try again in 6 hours.");
            }
        }
        while (await NextAsync(timer, stop));
    }

    private static async Task<bool> NextAsync(PeriodicTimer timer, CancellationToken stop)
    {
        try { return await timer.WaitForNextTickAsync(stop); }
        catch (OperationCanceledException) { return false; }
    }
}
