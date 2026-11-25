/* =====================================================================
   42_MeetingAttendance.sql  —  attendance sheet for calls and meetings
   - A "session" is one sitting of a call or meeting: it starts when the first person
     joins an empty room and ends when the last person leaves (a weekly meeting gets
     one session per week).
   - One row per person per session: first joined, left, total time, how many times joined.
     Team members are recorded by the server; guests (named in the call) by the people in it.
   Safe to run more than once.
   ===================================================================== */
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.sahyog_MeetingSessions', N'U') IS NULL
CREATE TABLE dbo.sahyog_MeetingSessions
(
    SessionId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_MeetingSessions PRIMARY KEY,
    TenantId    UNIQUEIDENTIFIER NOT NULL,
    MeetingId   UNIQUEIDENTIFIER NOT NULL,
    StartedUtc  DATETIME2(3)     NOT NULL,
    EndedUtc    DATETIME2(3)     NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_MeetingSessions_Meeting')
    CREATE INDEX IX_sahyog_MeetingSessions_Meeting ON dbo.sahyog_MeetingSessions(MeetingId, StartedUtc DESC);
GO

IF OBJECT_ID(N'dbo.sahyog_MeetingAttendance', N'U') IS NULL
CREATE TABLE dbo.sahyog_MeetingAttendance
(
    AttendanceId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_MeetingAttendance PRIMARY KEY,
    SessionId    UNIQUEIDENTIFIER NOT NULL,
    UserId       UNIQUEIDENTIFIER NULL,          -- a team member
    GuestName    NVARCHAR(100)    NULL,          -- or a guest, by the name they gave
    FirstJoinUtc DATETIME2(3)     NOT NULL,
    LastJoinUtc  DATETIME2(3)     NOT NULL,      -- start of the current stay
    LastSeenUtc  DATETIME2(3)     NOT NULL,
    LeftUtc      DATETIME2(3)     NULL,          -- NULL = in the call now
    Seconds      INT              NOT NULL CONSTRAINT DF_sahyog_MeetingAttendance_Seconds DEFAULT (0),   -- finished stays
    Joins        INT              NOT NULL CONSTRAINT DF_sahyog_MeetingAttendance_Joins DEFAULT (1)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_MeetingAttendance_Session')
    CREATE INDEX IX_sahyog_MeetingAttendance_Session ON dbo.sahyog_MeetingAttendance(SessionId);
GO

/* The open session of a meeting, started now when there is none. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Attendance_OpenSession
    @TenantId  UNIQUEIDENTIFIER,
    @MeetingId UNIQUEIDENTIFIER,
    @SessionId UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME2(3) = SYSUTCDATETIME(), @LastSeen DATETIME2(3);
    SELECT TOP (1) @SessionId = SessionId FROM dbo.sahyog_MeetingSessions
    WHERE MeetingId = @MeetingId AND TenantId = @TenantId AND EndedUtc IS NULL ORDER BY StartedUtc DESC;
    -- a session nobody has been seen in for 15 minutes (e.g. the server restarted) is over
    IF @SessionId IS NOT NULL
    BEGIN
        SELECT @LastSeen = MAX(LastSeenUtc) FROM dbo.sahyog_MeetingAttendance WHERE SessionId = @SessionId;
        IF @LastSeen IS NOT NULL AND @LastSeen < DATEADD(MINUTE, -15, @Now)
        BEGIN
            UPDATE dbo.sahyog_MeetingAttendance
            SET Seconds = Seconds + DATEDIFF(SECOND, LastJoinUtc, LastSeenUtc), LeftUtc = LastSeenUtc
            WHERE SessionId = @SessionId AND LeftUtc IS NULL;
            UPDATE dbo.sahyog_MeetingSessions SET EndedUtc = @LastSeen WHERE SessionId = @SessionId;
            SET @SessionId = NULL;
        END
    END
    IF @SessionId IS NULL
    BEGIN
        SET @SessionId = NEWID();
        INSERT dbo.sahyog_MeetingSessions (SessionId, TenantId, MeetingId, StartedUtc) VALUES (@SessionId, @TenantId, @MeetingId, SYSUTCDATETIME());
    END
END
GO

/* A team member came into the call (again). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Attendance_Join
    @TenantId  UNIQUEIDENTIFIER,
    @MeetingId UNIQUEIDENTIFIER,
    @UserId    UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @SessionId UNIQUEIDENTIFIER, @Now DATETIME2(3) = SYSUTCDATETIME();
    EXEC dbo.sahyog_Attendance_OpenSession @TenantId, @MeetingId, @SessionId OUTPUT;
    UPDATE dbo.sahyog_MeetingAttendance
    SET Joins = Joins + CASE WHEN LeftUtc IS NULL THEN 0 ELSE 1 END,
        LastJoinUtc = CASE WHEN LeftUtc IS NULL THEN LastJoinUtc ELSE @Now END,
        LeftUtc = NULL, LastSeenUtc = @Now
    WHERE SessionId = @SessionId AND UserId = @UserId;
    IF @@ROWCOUNT = 0
        INSERT dbo.sahyog_MeetingAttendance (SessionId, UserId, FirstJoinUtc, LastJoinUtc, LastSeenUtc)
        VALUES (@SessionId, @UserId, @Now, @Now, @Now);
END
GO

/* A team member left. @RoomEmpty = 1: they were the last one, so the session ends (guests leave with it). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Attendance_Leave
    @TenantId  UNIQUEIDENTIFIER,
    @MeetingId UNIQUEIDENTIFIER,
    @UserId    UNIQUEIDENTIFIER,
    @RoomEmpty BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @SessionId UNIQUEIDENTIFIER, @Now DATETIME2(3) = SYSUTCDATETIME();
    SELECT TOP (1) @SessionId = SessionId FROM dbo.sahyog_MeetingSessions
    WHERE MeetingId = @MeetingId AND TenantId = @TenantId AND EndedUtc IS NULL ORDER BY StartedUtc DESC;
    IF @SessionId IS NULL RETURN;
    UPDATE dbo.sahyog_MeetingAttendance
    SET Seconds = Seconds + DATEDIFF(SECOND, LastJoinUtc, @Now), LeftUtc = @Now, LastSeenUtc = @Now
    WHERE SessionId = @SessionId AND UserId = @UserId AND LeftUtc IS NULL;
    IF @RoomEmpty = 1
    BEGIN
        UPDATE dbo.sahyog_MeetingAttendance
        SET Seconds = Seconds + DATEDIFF(SECOND, LastJoinUtc, LastSeenUtc), LeftUtc = LastSeenUtc
        WHERE SessionId = @SessionId AND LeftUtc IS NULL;
        UPDATE dbo.sahyog_MeetingSessions SET EndedUtc = @Now WHERE SessionId = @SessionId;
    END
END
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
