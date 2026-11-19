namespace ShankhNaad.ServiceLibrary;

/// <summary>
/// Who is online, kept in memory (not in SQL) so presence changes cost the 10 DTU database nothing.
/// For more than one web server, replace with a Redis-backed version.
/// </summary>
/// <summary>
/// A person's status, like Microsoft Teams. Manual = what they picked (null = automatic):
/// "available", "busy", "dnd", "brb", "away", "offline" (appear offline). Idle = no activity for a while.
/// Call = "call" or "meeting" while they're in one; Presenting = sharing their screen in it.
/// The browser works out what to show (Presenting › Do not disturb › In a call › Busy › Be right back › Away › Available).
/// </summary>
public sealed record UserStatusDto(string? Manual, bool Idle, bool Presenting, string? Call);

public sealed class PresenceTracker
{
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
        lock (_gate)
        {
            if (string.IsNullOrEmpty(status) || status == "auto") { _manual.Remove(userId); return true; }
            if (!ManualStatuses.Contains(status)) return false;
            _manual[userId] = status;
            return true;
        }
    }

    public void SetIdle(string userId, bool idle) { lock (_gate) { if (idle) _idle.Add(userId); else _idle.Remove(userId); } }
    public void SetPresenting(string userId, bool on) { lock (_gate) { if (on) _presenting.Add(userId); else _presenting.Remove(userId); } }
    /// <summary>"call", "meeting", or null when they've left.</summary>
    public void SetCall(string userId, string? kind)
    {
        lock (_gate)
        {
            if (kind is null) { _call.Remove(userId); _presenting.Remove(userId); }
            else _call[userId] = kind;
        }
    }

    public UserStatusDto Status(string userId)
    {
        lock (_gate)
            return new UserStatusDto(_manual.GetValueOrDefault(userId), _idle.Contains(userId), _presenting.Contains(userId), _call.GetValueOrDefault(userId));
    }

    /// <summary>Status of everyone online in this workspace who has one (others are simply "Available").</summary>
    public Dictionary<string, UserStatusDto> Statuses(Guid tenantId)
    {
        lock (_gate)
            return _users.Where(u => u.Value.TenantId == tenantId)
                .Select(u => u.Key)
                .Where(id => _manual.ContainsKey(id) || _idle.Contains(id) || _presenting.Contains(id) || _call.ContainsKey(id))
                .ToDictionary(id => id, id => new UserStatusDto(_manual.GetValueOrDefault(id), _idle.Contains(id), _presenting.Contains(id), _call.GetValueOrDefault(id)));
    }

    /// <returns>true when this is the user's first connection (they just came online).</returns>
    public bool Connect(Guid tenantId, string userId, string connectionId)
    {
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
        lock (_gate)
            return _users.Where(u => u.Value.TenantId == tenantId).Select(u => u.Key).ToHashSet();
    }

    public List<string> Connections(string userId)
    {
        lock (_gate)
            return _users.TryGetValue(userId, out var e) ? e.Connections.ToList() : new List<string>();
    }
}

/// <summary>Counts people currently inside each meeting, so a plan's "max people per meeting" can be enforced.</summary>
public sealed class MeetingRoomTracker
{
    private readonly object _gate = new();
    private readonly Dictionary<Guid, Dictionary<string, string>> _rooms = new();   // meeting → (connectionId → userId)

    public void Join(Guid meetingId, string userId, string connectionId)
    {
        lock (_gate)
        {
            if (!_rooms.TryGetValue(meetingId, out var room)) _rooms[meetingId] = room = new();
            room[connectionId] = userId;
        }
    }

    /// <returns>True when the room is now empty (the call is over).</returns>
    public bool Leave(Guid meetingId, string connectionId)
    {
        lock (_gate)
        {
            if (!_rooms.TryGetValue(meetingId, out var room) || !room.Remove(connectionId)) return false;
            if (room.Count > 0) return false;
            _rooms.Remove(meetingId);
            return true;
        }
    }

    /// <returns>The meetings that are now empty.</returns>
    public List<Guid> LeaveAll(string connectionId)
    {
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
        lock (_gate)
            return _rooms.Where(r => r.Value.ContainsKey(connectionId)).Select(r => r.Key).ToList();
    }

    public int Count(Guid meetingId)
    {
        lock (_gate)
            return _rooms.TryGetValue(meetingId, out var room) ? room.Values.Distinct().Count() : 0;
    }

    /// <summary>Is this person in any call or meeting right now (on any device)?</summary>
    public bool IsBusy(string userId)
    {
        lock (_gate)
            return _rooms.Values.Any(r => r.ContainsValue(userId));
    }

    /// <summary>Everyone who is in a call or meeting right now.</summary>
    public HashSet<string> BusyUsers()
    {
        lock (_gate)
            return _rooms.Values.SelectMany(r => r.Values).ToHashSet();
    }

    public bool Contains(Guid meetingId, string userId)
    {
        lock (_gate)
            return _rooms.TryGetValue(meetingId, out var room) && room.ContainsValue(userId);
    }
}
