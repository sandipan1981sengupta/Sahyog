using StackExchange.Redis;

namespace ShankhNaad.ServiceLibrary;

// Who is online and who is in which call. Never in SQL, so these frequent changes cost the database nothing.
// One web server (no "Redis" in appsettings): kept in this server's memory, as always.
// Several web servers ("Redis:Connection" set): kept in Redis, so every server sees the same people online and in calls.
// Each connection is also listed under the server that holds it, so the others can clean up when a server stops
// (Web: Infrastructure/ClusterHeartbeat.cs). The callers don't change: same methods either way.
/// <summary>
/// A person's status, like Microsoft Teams. Manual = what they picked (null = automatic):
/// "available", "busy", "dnd", "brb", "away", "offline" (appear offline). Idle = no activity for a while.
/// Call = "call" or "meeting" while they're in one; Presenting = sharing their screen in it.
/// The browser works out what to show (Presenting › Do not disturb › In a call › Busy › Be right back › Away › Available).
/// </summary>
public sealed record UserStatusDto(string? Manual, bool Idle, bool Presenting, string? Call);

public sealed class PresenceTracker
{
    private readonly Cluster _cluster;
    public PresenceTracker(Cluster cluster) => _cluster = cluster;
    private bool Shared => _cluster.IsShared;
    private IDatabase Db => _cluster.Db;
    private RedisKey K(string name) => _cluster.Key("p:" + name);

    private readonly object _gate = new();
    private readonly Dictionary<string, (Guid TenantId, HashSet<string> Connections)> _users = new();
    // status, kept while the person is connected (their browser sends their picked status again after a restart)
    private readonly Dictionary<string, string> _manual = new();
    private readonly HashSet<string> _idle = new();
    private readonly HashSet<string> _presenting = new();
    private readonly Dictionary<string, string> _call = new();

    public static readonly HashSet<string> ManualStatuses = new(StringComparer.Ordinal) { "available", "busy", "dnd", "brb", "away", "offline" };

    /// <summary>Picks a status; null, "" or "auto" goes back to automatic. Returns false for an unknown status.</summary>
    public bool SetManual(string userId, string? status)
    {
        if (Shared)
        {
            if (string.IsNullOrEmpty(status) || status == "auto") { Db.HashDelete(K("manual"), userId); return true; }
            if (!ManualStatuses.Contains(status)) return false;
            Db.HashSet(K("manual"), userId, status);
            return true;
        }
        lock (_gate)
        {
            if (string.IsNullOrEmpty(status) || status == "auto") { _manual.Remove(userId); return true; }
            if (!ManualStatuses.Contains(status)) return false;
            _manual[userId] = status;
            return true;
        }
    }

    public void SetIdle(string userId, bool idle)
    {
        if (Shared) { if (idle) Db.SetAdd(K("idle"), userId); else Db.SetRemove(K("idle"), userId); return; }
        lock (_gate) { if (idle) _idle.Add(userId); else _idle.Remove(userId); }
    }

    public void SetPresenting(string userId, bool on)
    {
        if (Shared) { if (on) Db.SetAdd(K("presenting"), userId); else Db.SetRemove(K("presenting"), userId); return; }
        lock (_gate) { if (on) _presenting.Add(userId); else _presenting.Remove(userId); }
    }
    /// <summary>"call", "meeting", or null when they've left.</summary>
    public void SetCall(string userId, string? kind)
    {
        if (Shared)
        {
            if (kind is null) { Db.HashDelete(K("call"), userId); Db.SetRemove(K("presenting"), userId); }
            else Db.HashSet(K("call"), userId, kind);
            return;
        }
        lock (_gate)
        {
            if (kind is null) { _call.Remove(userId); _presenting.Remove(userId); }
            else _call[userId] = kind;
        }
    }

    public UserStatusDto Status(string userId)
    {
        if (Shared)
        {
            var b = Db.CreateBatch();
            var manual = b.HashGetAsync(K("manual"), userId);
            var idle = b.SetContainsAsync(K("idle"), userId);
            var presenting = b.SetContainsAsync(K("presenting"), userId);
            var call = b.HashGetAsync(K("call"), userId);
            b.Execute();
            return new UserStatusDto(manual.Result.IsNull ? null : manual.Result.ToString(), idle.Result, presenting.Result,
                call.Result.IsNull ? null : call.Result.ToString());
        }
        lock (_gate)
            return new UserStatusDto(_manual.GetValueOrDefault(userId), _idle.Contains(userId), _presenting.Contains(userId), _call.GetValueOrDefault(userId));
    }

    /// <summary>Status of everyone online in this workspace who has one (others are simply "Available").</summary>
    public Dictionary<string, UserStatusDto> Statuses(Guid tenantId)
    {
        if (Shared)
        {
            var b = Db.CreateBatch();
            var online = b.SetMembersAsync(K($"online:{tenantId:N}"));
            var manualT = b.HashGetAllAsync(K("manual"));
            var idleT = b.SetMembersAsync(K("idle"));
            var presentingT = b.SetMembersAsync(K("presenting"));
            var callT = b.HashGetAllAsync(K("call"));
            b.Execute();
            var manual = manualT.Result.ToDictionary(e => e.Name.ToString(), e => e.Value.ToString());
            var idle = idleT.Result.Select(v => v.ToString()).ToHashSet();
            var presenting = presentingT.Result.Select(v => v.ToString()).ToHashSet();
            var call = callT.Result.ToDictionary(e => e.Name.ToString(), e => e.Value.ToString());
            return online.Result.Select(v => v.ToString())
                .Where(id => manual.ContainsKey(id) || idle.Contains(id) || presenting.Contains(id) || call.ContainsKey(id))
                .ToDictionary(id => id, id => new UserStatusDto(manual.GetValueOrDefault(id), idle.Contains(id), presenting.Contains(id), call.GetValueOrDefault(id)));
        }
        lock (_gate)
            return _users.Where(u => u.Value.TenantId == tenantId)
                .Select(u => u.Key)
                .Where(id => _manual.ContainsKey(id) || _idle.Contains(id) || _presenting.Contains(id) || _call.ContainsKey(id))
                .ToDictionary(id => id, id => new UserStatusDto(_manual.GetValueOrDefault(id), _idle.Contains(id), _presenting.Contains(id), _call.GetValueOrDefault(id)));
    }

    /// <returns>true when this is the user's first connection (they just came online).</returns>
    public bool Connect(Guid tenantId, string userId, string connectionId)
    {
        if (Shared)
            return (int)Db.ScriptEvaluate(ConnectLua,
                new[] { K($"conn:{userId}"), K($"tenant:{userId}"), K($"online:{tenantId:N}"), _cluster.Key($"srv:{_cluster.ServerId}:conns") },
                new RedisValue[] { connectionId, _cluster.ServerId, userId, tenantId.ToString("N"), $"{userId}|{connectionId}" }) == 1;
        lock (_gate)
        {
            if (!_users.TryGetValue(userId, out var entry))
            {
                _users[userId] = (tenantId, new HashSet<string> { connectionId });
                return true;
            }
            entry.Connections.Add(connectionId);
            return false;
        }
    }

    /// <returns>true when the user's last connection closed (they went offline).</returns>
    public bool Disconnect(string userId, string connectionId)
    {
        if (Shared)
            return (int)Db.ScriptEvaluate(DisconnectLua,
                new[] { K($"conn:{userId}"), K($"tenant:{userId}") },
                new RedisValue[] { connectionId, userId, _cluster.Prefix }) == 1;
        lock (_gate)
        {
            if (!_users.TryGetValue(userId, out var entry)) return false;
            entry.Connections.Remove(connectionId);
            if (entry.Connections.Count > 0) return false;
            _users.Remove(userId);
            _manual.Remove(userId); _idle.Remove(userId); _presenting.Remove(userId); _call.Remove(userId);
            return true;
        }
    }

    public HashSet<string> OnlineUsers(Guid tenantId)
    {
        if (Shared) return Db.SetMembers(K($"online:{tenantId:N}")).Select(v => v.ToString()).ToHashSet();
        lock (_gate)
            return _users.Where(u => u.Value.TenantId == tenantId).Select(u => u.Key).ToHashSet();
    }

    public List<string> Connections(string userId)
    {
        if (Shared) return Db.HashKeys(K($"conn:{userId}")).Select(v => v.ToString()).ToList();
        lock (_gate)
            return _users.TryGetValue(userId, out var e) ? e.Connections.ToList() : new List<string>();
    }

    /// <summary>The workspace a connected person belongs to (null when they aren't online). Used by the clean-up after a server stops.</summary>
    public Guid? TenantOf(string userId)
    {
        if (Shared) { var t = Db.StringGet(K($"tenant:{userId}")); return !t.IsNull && Guid.TryParse(t.ToString(), out var g) ? g : null; }
        lock (_gate)
            return _users.TryGetValue(userId, out var e) ? e.TenantId : null;
    }

    // KEYS: conn:{user} (connection → server), tenant:{user}, online:{tenant}, srv:{server}:conns
    // ARGV: connectionId, serverId, userId, tenantId, "user|connection". Returns 1 when this is their first connection.
    private const string ConnectLua = @"
local first = redis.call('HLEN', KEYS[1]) == 0
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[4])
redis.call('SADD', KEYS[3], ARGV[3])
redis.call('SADD', KEYS[4], ARGV[5])
if first then return 1 else return 0 end";

    // KEYS: conn:{user}, tenant:{user}. ARGV: connectionId, userId, key prefix.
    // Returns 1 when that was their last connection (they went offline): then their status is cleared too.
    private const string DisconnectLua = @"
local srv = redis.call('HGET', KEYS[1], ARGV[1])
if not srv then return 0 end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('SREM', ARGV[3] .. 'srv:' .. srv .. ':conns', ARGV[2] .. '|' .. ARGV[1])
if redis.call('HLEN', KEYS[1]) > 0 then return 0 end
local t = redis.call('GET', KEYS[2])
redis.call('DEL', KEYS[2])
if t then redis.call('SREM', ARGV[3] .. 'p:online:' .. t, ARGV[2]) end
redis.call('HDEL', ARGV[3] .. 'p:manual', ARGV[2])
redis.call('SREM', ARGV[3] .. 'p:idle', ARGV[2])
redis.call('SREM', ARGV[3] .. 'p:presenting', ARGV[2])
redis.call('HDEL', ARGV[3] .. 'p:call', ARGV[2])
return 1";
}

/// <summary>Counts people currently inside each meeting, so a plan's "max people per meeting" can be enforced.</summary>
public sealed class MeetingRoomTracker
{
    private readonly Cluster _cluster;
    public MeetingRoomTracker(Cluster cluster) => _cluster = cluster;
    private bool Shared => _cluster.IsShared;
    private IDatabase Db => _cluster.Db;
    private RedisKey K(string name) => _cluster.Key("r:" + name);

    private readonly object _gate = new();
    private readonly Dictionary<Guid, Dictionary<string, string>> _rooms = new();   // meeting → (connectionId → userId)

    public void Join(Guid meetingId, string userId, string connectionId)
    {
        if (Shared)
        {
            var b = Db.CreateBatch();
            _ = b.HashSetAsync(K($"room:{meetingId:N}"), connectionId, userId);
            _ = b.SetAddAsync(K("rooms"), meetingId.ToString("N"));
            _ = b.SetAddAsync(K($"conn:{connectionId}"), meetingId.ToString("N"));
            _ = b.SetAddAsync(_cluster.Key($"srv:{_cluster.ServerId}:rconns"), connectionId);
            b.Execute();
            return;
        }
        lock (_gate)
        {
            if (!_rooms.TryGetValue(meetingId, out var room)) _rooms[meetingId] = room = new();
            room[connectionId] = userId;
        }
    }

    /// <returns>True when the room is now empty (the call is over).</returns>
    public bool Leave(Guid meetingId, string connectionId)
    {
        if (Shared)
            return (int)Db.ScriptEvaluate(LeaveLua,
                new[] { K($"room:{meetingId:N}"), K("rooms"), K($"conn:{connectionId}") },
                new RedisValue[] { connectionId, meetingId.ToString("N") }) == 1;
        lock (_gate)
        {
            if (!_rooms.TryGetValue(meetingId, out var room) || !room.Remove(connectionId)) return false;
            if (room.Count > 0) return false;
            _rooms.Remove(meetingId);
            return true;
        }
    }

    /// <returns>The meetings that are now empty.</returns>
    public List<Guid> LeaveAll(string connectionId) => LeaveAll(connectionId, _cluster.IsShared ? _cluster.ServerId : null);

    /// <summary>LeaveAll for a connection that a stopped server held (the clean-up passes that server's id).</summary>
    public List<Guid> LeaveAll(string connectionId, string? serverId)
    {
        if (Shared)
        {
            var emptied = MeetingsOf(connectionId).Where(id => Leave(id, connectionId)).ToList();
            Db.KeyDelete(K($"conn:{connectionId}"));
            if (serverId is not null) Db.SetRemove(_cluster.Key($"srv:{serverId}:rconns"), connectionId);
            return emptied;
        }
        lock (_gate)
        {
            var emptied = new List<Guid>();
            foreach (var id in _rooms.Keys.ToList())
                if (Leave(id, connectionId)) emptied.Add(id);
            return emptied;
        }
    }

    /// <summary>The meetings this browser tab is in.</summary>
    public List<Guid> MeetingsOf(string connectionId)
    {
        if (Shared) return Db.SetMembers(K($"conn:{connectionId}")).Select(v => Guid.Parse(v.ToString())).ToList();
        lock (_gate)
            return _rooms.Where(r => r.Value.ContainsKey(connectionId)).Select(r => r.Key).ToList();
    }

    public int Count(Guid meetingId)
    {
        if (Shared) return Db.HashValues(K($"room:{meetingId:N}")).Select(v => v.ToString()).Distinct().Count();
        lock (_gate)
            return _rooms.TryGetValue(meetingId, out var room) ? room.Values.Distinct().Count() : 0;
    }

    /// <summary>Is this person in any call or meeting right now (on any device)?</summary>
    public bool IsBusy(string userId)
    {
        if (Shared) return SharedRooms().Any(r => r.Contains(userId));
        lock (_gate)
            return _rooms.Values.Any(r => r.ContainsValue(userId));
    }

    /// <summary>Everyone who is in a call or meeting right now.</summary>
    public HashSet<string> BusyUsers()
    {
        if (Shared) return SharedRooms().SelectMany(r => r).ToHashSet();
        lock (_gate)
            return _rooms.Values.SelectMany(r => r.Values).ToHashSet();
    }

    public bool Contains(Guid meetingId, string userId)
    {
        if (Shared) return Db.HashValues(K($"room:{meetingId:N}")).Any(v => v.ToString() == userId);
        lock (_gate)
            return _rooms.TryGetValue(meetingId, out var room) && room.ContainsValue(userId);
    }

    /// <summary>The people in every live room (one round trip for all rooms).</summary>
    private List<HashSet<string>> SharedRooms()
    {
        var ids = Db.SetMembers(K("rooms"));
        if (ids.Length == 0) return new();
        var b = Db.CreateBatch();
        var tasks = ids.Select(id => b.HashValuesAsync(K($"room:{id}"))).ToList();
        b.Execute();
        return tasks.Select(t => t.Result.Select(v => v.ToString()).ToHashSet()).ToList();
    }

    // KEYS: room:{meeting} (connection → user), rooms, conn:{connection}. ARGV: connectionId, meetingId.
    // Returns 1 when the room is now empty (the call is over).
    private const string LeaveLua = @"
if redis.call('HDEL', KEYS[1], ARGV[1]) == 0 then return 0 end
redis.call('SREM', KEYS[3], ARGV[2])
if redis.call('HLEN', KEYS[1]) > 0 then return 0 end
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[2])
return 1";
}
