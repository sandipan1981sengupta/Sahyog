using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using StackExchange.Redis;

namespace ShankhNaad.ServiceLibrary;

/// <summary>
/// Settings from appsettings.json "Redis". Leave Connection empty (the default) to run on one web server,
/// exactly as before: everything stays in this server's memory.
/// Fill it in to run several web servers behind a load balancer: who is online, who is in which call,
/// live updates (SignalR) and the login keys are then shared through Redis.
/// </summary>
public sealed class RedisOptions
{
    /// <summary>StackExchange.Redis connection string, e.g. "10.0.0.5:6379,password=…,abortConnect=false". Empty = one server, no Redis.</summary>
    public string Connection { get; set; } = "";

    /// <summary>Start of every key, so one Redis can serve several installs (e.g. "sn:" and "sn-test:").</summary>
    public string KeyPrefix { get; set; } = "sn:";
}

/// <summary>
/// The web servers working together. On one server (no Redis) it only gives the in-memory "once per window" check.
/// With Redis it holds the connection, this server's id (for cleaning up after a server that stopped) and the key prefix.
/// </summary>
public sealed class Cluster : IDisposable
{
    private readonly ConcurrentDictionary<string, DateTime> _once = new();
    private readonly ConnectionMultiplexer? _mux;

    public Cluster(IOptions<RedisOptions> options, ILogger<Cluster> log)
    {
        Prefix = string.IsNullOrWhiteSpace(options.Value.KeyPrefix) ? "sn:" : options.Value.KeyPrefix.Trim();
        var cs = options.Value.Connection?.Trim();
        if (string.IsNullOrEmpty(cs)) return;
        var config = ConfigurationOptions.Parse(cs);
        config.AbortOnConnectFail = false;          // keep retrying in the background instead of failing start-up
        _mux = ConnectionMultiplexer.Connect(config);
        log.LogInformation("Several web servers: shared state in Redis ({Endpoints}), this server is {ServerId}",
            string.Join(", ", config.EndPoints), ServerId);
    }

    /// <summary>True when Redis is configured (several web servers can run side by side).</summary>
    public bool IsShared => _mux is not null;

    /// <summary>The Redis connection (null on one server). Also used by SignalR and the login keys in Program.cs.</summary>
    public IConnectionMultiplexer? Multiplexer => _mux;

    public IDatabase Db => _mux?.GetDatabase() ?? throw new InvalidOperationException("Redis is not configured.");

    public string Prefix { get; }

    /// <summary>This running copy of the app. New on every start, so a restarted server never mixes with its old self.</summary>
    public string ServerId { get; } = $"{Environment.MachineName}-{Guid.NewGuid():N}";

    public RedisKey Key(string name) => Prefix + name;

    /// <summary>
    /// True the first time this key is seen within the window (then false until it has passed), on every server together.
    /// For "ring a meeting once in 2 minutes", "one ping per 15 seconds", "one email per 3 hours".
    /// </summary>
    public bool TryOnce(string key, TimeSpan window)
    {
        if (_mux is not null)
            return Db.StringSet(Key("once:" + key), 1, window, When.NotExists);

        var now = DateTime.UtcNow;
        if (_once.TryGetValue(key, out var until) && until > now) return false;
        _once[key] = now + window;
        if (_once.Count > 2000)                                   // forget old entries now and then
            foreach (var old in _once.Where(kv => kv.Value <= now).Select(kv => kv.Key).ToList())
                _once.TryRemove(old, out _);
        return true;
    }

    public void Dispose() => _mux?.Dispose();
}
