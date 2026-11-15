namespace Sahyog.ServiceLibrary;

/// <summary>
/// Who is online, kept in memory (not in SQL) so presence changes cost the 10 DTU database nothing.
/// For more than one web server, replace with a Redis-backed version.
/// </summary>
public sealed class PresenceTracker
{
    private readonly object _gate = new();
    private readonly Dictionary<string, (Guid TenantId, HashSet<string> Connections)> _users = new();

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

    public void Leave(Guid meetingId, string connectionId)
    {
        lock (_gate)
        {
            if (!_rooms.TryGetValue(meetingId, out var room)) return;
            room.Remove(connectionId);
            if (room.Count == 0) _rooms.Remove(meetingId);
        }
    }

    public void LeaveAll(string connectionId)
    {
        lock (_gate)
        {
            foreach (var id in _rooms.Keys.ToList()) Leave(id, connectionId);
        }
    }

    public int Count(Guid meetingId)
    {
        lock (_gate)
            return _rooms.TryGetValue(meetingId, out var room) ? room.Values.Distinct().Count() : 0;
    }

    public bool Contains(Guid meetingId, string userId)
    {
        lock (_gate)
            return _rooms.TryGetValue(meetingId, out var room) && room.ContainsValue(userId);
    }
}
