/* =====================================================================
   42b_MeetingAttendanceFix.sql  —  re-creates the two attendance procedures that failed
   ("Incorrect syntax near 'who'") when 42_MeetingAttendance.sql was first run.
   Run this once if you already ran the older 42 / 99 script. Safe to run more than once.
   ===================================================================== */
SET NOCOUNT ON;
GO

/* Guests in the call right now, by name (sent every minute by the people in the call, separated by |).
   A guest who is no longer in the list has left (at the time they were last seen).
   (The sheet itself needs 40_OrgStructure.sql first: it shows job titles and departments.) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Attendance_Guests
    @TenantId  UNIQUEIDENTIFIER,
    @MeetingId UNIQUEIDENTIFIER,
    @UserId    UNIQUEIDENTIFIER,     -- who sent it: they're still in the call too
    @Names     NVARCHAR(4000)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @SessionId UNIQUEIDENTIFIER, @Now DATETIME2(3) = SYSUTCDATETIME();
    SELECT TOP (1) @SessionId = SessionId FROM dbo.sahyog_MeetingSessions
    WHERE MeetingId = @MeetingId AND TenantId = @TenantId AND EndedUtc IS NULL ORDER BY StartedUtc DESC;
    IF @SessionId IS NULL RETURN;

    DECLARE @Now_In TABLE (Name NVARCHAR(100) PRIMARY KEY);
    UPDATE dbo.sahyog_MeetingAttendance SET LastSeenUtc = @Now WHERE SessionId = @SessionId AND UserId = @UserId AND LeftUtc IS NULL;

    INSERT @Now_In (Name)
    SELECT DISTINCT LEFT(LTRIM(RTRIM(value)), 100) FROM STRING_SPLIT(ISNULL(@Names, N''), N'|') WHERE LTRIM(RTRIM(value)) <> N'';

    -- still here or back again
    UPDATE a
    SET Joins = a.Joins + CASE WHEN a.LeftUtc IS NULL THEN 0 ELSE 1 END,
        LastJoinUtc = CASE WHEN a.LeftUtc IS NULL THEN a.LastJoinUtc ELSE @Now END,
        LeftUtc = NULL, LastSeenUtc = @Now
    FROM dbo.sahyog_MeetingAttendance a JOIN @Now_In n ON a.GuestName = n.Name
    WHERE a.SessionId = @SessionId AND a.UserId IS NULL;
    -- new
    INSERT dbo.sahyog_MeetingAttendance (SessionId, GuestName, FirstJoinUtc, LastJoinUtc, LastSeenUtc)
    SELECT @SessionId, n.Name, @Now, @Now, @Now FROM @Now_In n
    WHERE NOT EXISTS (SELECT 1 FROM dbo.sahyog_MeetingAttendance a WHERE a.SessionId = @SessionId AND a.UserId IS NULL AND a.GuestName = n.Name);
    -- gone
    UPDATE a
    SET Seconds = a.Seconds + DATEDIFF(SECOND, a.LastJoinUtc, a.LastSeenUtc), LeftUtc = a.LastSeenUtc
    FROM dbo.sahyog_MeetingAttendance a
    WHERE a.SessionId = @SessionId AND a.UserId IS NULL AND a.LeftUtc IS NULL
      AND NOT EXISTS (SELECT 1 FROM @Now_In n WHERE n.Name = a.GuestName);
END
GO

/* The attendance sheet of the latest (or current) session of a meeting. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Attendance_List
    @TenantId  UNIQUEIDENTIFIER,
    @MeetingId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @SessionId UNIQUEIDENTIFIER, @Started DATETIME2(3), @Ended DATETIME2(3), @Now DATETIME2(3) = SYSUTCDATETIME();
    SELECT TOP (1) @SessionId = SessionId, @Started = StartedUtc, @Ended = EndedUtc FROM dbo.sahyog_MeetingSessions
    WHERE MeetingId = @MeetingId AND TenantId = @TenantId ORDER BY StartedUtc DESC;

    SELECT @SessionId AS SessionId, @Started AS StartedUtc, @Ended AS EndedUtc;

    SELECT a.UserId, COALESCE(u.DisplayName, a.GuestName, N'Someone') AS Name, u.Email, u.AvatarTone,
           CAST(CASE WHEN a.UserId IS NULL THEN 1 ELSE 0 END AS BIT) AS IsGuest,
           u.JobTitle, d.Name AS DepartmentName,
           a.FirstJoinUtc, a.LeftUtc, a.Joins,
           a.Seconds + CASE WHEN a.LeftUtc IS NULL THEN DATEDIFF(SECOND, a.LastJoinUtc, @Now) ELSE 0 END AS Seconds,
           CAST(CASE WHEN a.LeftUtc IS NULL THEN 1 ELSE 0 END AS BIT) AS InCall
    FROM dbo.sahyog_MeetingAttendance a
    LEFT JOIN dbo.sahyog_Users u ON u.UserId = a.UserId AND u.TenantId = @TenantId
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = u.DepartmentId
    WHERE a.SessionId = @SessionId
    ORDER BY a.FirstJoinUtc;
END
GO
