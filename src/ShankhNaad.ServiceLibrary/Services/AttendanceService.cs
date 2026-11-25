using System.Data;
using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>
/// Attendance sheet for calls and meetings (database/42_MeetingAttendance.sql). Every method quietly
/// does nothing until that script is run, so calls never break because of it.
/// </summary>
public interface IAttendanceService
{
    Task JoinAsync(Guid tenantId, Guid meetingId, Guid userId);
    /// <param name="roomEmpty">They were the last one in: the sitting is over.</param>
    Task LeaveAsync(Guid tenantId, Guid meetingId, Guid userId, bool roomEmpty);
    /// <summary>Guests in the call now (names), sent by someone in the call every minute.</summary>
    Task GuestsAsync(Guid tenantId, Guid meetingId, Guid fromUserId, IEnumerable<string> names);
    Task<AttendanceSheetDto> GetAsync(Guid tenantId, Guid meetingId);
}

public sealed class AttendanceService : IAttendanceService
{
    private readonly SqlDb _db;
    public AttendanceService(SqlDb db) => _db = db;
    // 208 = table missing, 2812 = procedure missing
    private static bool Missing(SqlException ex) => ex.Number is 208 or 2812;

    public async Task JoinAsync(Guid tenantId, Guid meetingId, Guid userId)
    {
        try { await _db.ExecAsync("dbo.sahyog_Attendance_Join", p => p.With("@TenantId", tenantId).With("@MeetingId", meetingId).With("@UserId", userId)); }
        catch (SqlException ex) when (Missing(ex)) { }
    }

    public async Task LeaveAsync(Guid tenantId, Guid meetingId, Guid userId, bool roomEmpty)
    {
        try
        {
            await _db.ExecAsync("dbo.sahyog_Attendance_Leave", p => p.With("@TenantId", tenantId).With("@MeetingId", meetingId)
                .With("@UserId", userId).With("@RoomEmpty", roomEmpty));
        }
        catch (SqlException ex) when (Missing(ex)) { }
    }

    public async Task GuestsAsync(Guid tenantId, Guid meetingId, Guid fromUserId, IEnumerable<string> names)
    {
        var list = string.Join("|", names.Select(n => (n ?? "").Replace("|", " ").Trim()).Where(n => n.Length > 0)
            .Select(n => n.Length > 100 ? n[..100] : n).Distinct(StringComparer.OrdinalIgnoreCase).Take(200));
        if (list.Length > 4000) list = list[..4000];
        try
        {
            await _db.ExecAsync("dbo.sahyog_Attendance_Guests", p => p.With("@TenantId", tenantId).With("@MeetingId", meetingId)
                .With("@UserId", fromUserId).AddText("@Names", list, 4000));
        }
        catch (SqlException ex) when (Missing(ex)) { }
    }

    public async Task<AttendanceSheetDto> GetAsync(Guid tenantId, Guid meetingId)
    {
        try
        {
            DateTime? started = null, ended = null;
            var rows = new List<AttendanceRowDto>();
            await using var conn = await _db.OpenAsync();
            await using var cmd = new SqlCommand("dbo.sahyog_Attendance_List", conn) { CommandType = CommandType.StoredProcedure };
            cmd.Parameters.Add(new SqlParameter("@TenantId", SqlDbType.UniqueIdentifier) { Value = tenantId });
            cmd.Parameters.Add(new SqlParameter("@MeetingId", SqlDbType.UniqueIdentifier) { Value = meetingId });
            await using var r = await cmd.ExecuteReaderAsync();
            if (await r.ReadAsync())
            {
                started = r.IsDBNull(1) ? null : r.GetDateTime(1);
                ended = r.IsDBNull(2) ? null : r.GetDateTime(2);
            }
            if (await r.NextResultAsync())
                while (await r.ReadAsync())
                    rows.Add(new AttendanceRowDto(
                        r.IsDBNull(r.GetOrdinal("UserId")) ? null : r.GetGuid(r.GetOrdinal("UserId")),
                        r.GetString(r.GetOrdinal("Name")),
                        r.IsDBNull(r.GetOrdinal("Email")) ? null : r.GetString(r.GetOrdinal("Email")),
                        r.IsDBNull(r.GetOrdinal("AvatarTone")) ? 0 : Convert.ToInt32(r.GetValue(r.GetOrdinal("AvatarTone"))),
                        r.GetBoolean(r.GetOrdinal("IsGuest")),
                        r.IsDBNull(r.GetOrdinal("JobTitle")) ? null : r.GetString(r.GetOrdinal("JobTitle")),
                        r.IsDBNull(r.GetOrdinal("DepartmentName")) ? null : r.GetString(r.GetOrdinal("DepartmentName")),
                        r.GetDateTime(r.GetOrdinal("FirstJoinUtc")),
                        r.IsDBNull(r.GetOrdinal("LeftUtc")) ? null : r.GetDateTime(r.GetOrdinal("LeftUtc")),
                        r.GetInt32(r.GetOrdinal("Joins")),
                        Math.Max(0, r.GetInt32(r.GetOrdinal("Seconds"))),
                        r.GetBoolean(r.GetOrdinal("InCall"))));
            return new AttendanceSheetDto(true, started, ended, rows);
        }
        catch (SqlException ex) when (Missing(ex))
        {
            return new AttendanceSheetDto(false, null, null, new());
        }
    }
}
