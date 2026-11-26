/* =====================================================================
   ShankhNaad round 47 (safe to run more than once; needs 01–02 and 40_OrgStructure.sql):
     Async stand-up. A team (a department, or everyone) answers three short questions on set days;
     at the set time ShankhNaad reminds whoever hasn't answered; the roll-up shows answers and blockers.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Standups', N'U') IS NULL
CREATE TABLE dbo.sahyog_Standups
(
    StandupId    INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Standups PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Standups_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Name         NVARCHAR(80)     NOT NULL,
    DepartmentId UNIQUEIDENTIFIER NULL,                -- NULL = everyone in the workspace
    Days         TINYINT          NOT NULL CONSTRAINT DF_sahyog_Standups_Days DEFAULT (31),   -- bit 0 Monday … bit 6 Sunday
    AtMinutes    SMALLINT         NOT NULL CONSTRAINT DF_sahyog_Standups_At DEFAULT (600),    -- local time, minutes after midnight
    Q1           NVARCHAR(150)    NOT NULL,
    Q2           NVARCHAR(150)    NOT NULL,
    Q3           NVARCHAR(150)    NOT NULL,
    IsActive     BIT              NOT NULL CONSTRAINT DF_sahyog_Standups_Active DEFAULT (1),
    CreatedBy    UNIQUEIDENTIFIER NOT NULL,
    CreatedUtc   DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Standups_Created DEFAULT (SYSUTCDATETIME()),
    LastRunDay   DATE             NULL                  -- the day the reminder last went out
);
GO
IF OBJECT_ID(N'dbo.sahyog_StandupAnswers', N'U') IS NULL
CREATE TABLE dbo.sahyog_StandupAnswers
(
    StandupId    INT              NOT NULL CONSTRAINT FK_sahyog_StandupAnswers_Standups REFERENCES dbo.sahyog_Standups(StandupId) ON DELETE CASCADE,
    UserId       UNIQUEIDENTIFIER NOT NULL,
    Day          DATE             NOT NULL,
    A1           NVARCHAR(1000)   NULL,
    A2           NVARCHAR(1000)   NULL,
    A3           NVARCHAR(1000)   NULL,
    HasBlocker   BIT              NOT NULL CONSTRAINT DF_sahyog_StandupAnswers_Blocker DEFAULT (0),
    AnsweredUtc  DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_StandupAnswers_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sahyog_StandupAnswers PRIMARY KEY (StandupId, Day, UserId)
);
GO

/* the people in a stand-up: its department, or everyone active */
CREATE OR ALTER FUNCTION dbo.sahyog_Standup_People (@StandupId INT)
RETURNS TABLE
AS RETURN
    SELECT u.UserId, u.DisplayName, u.AvatarTone, u.ManagerId, u.JobTitle
    FROM dbo.sahyog_Standups s
    JOIN dbo.sahyog_Users u ON u.TenantId = s.TenantId AND u.IsActive = 1
    WHERE s.StandupId = @StandupId
      AND (s.DepartmentId IS NULL OR u.DepartmentId = s.DepartmentId);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_List
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.StandupId, s.Name, s.DepartmentId, d.Name AS DepartmentName, s.Days, s.AtMinutes, s.Q1, s.Q2, s.Q3, s.IsActive,
           s.CreatedBy, c.DisplayName AS CreatedByName,
           (SELECT COUNT(*) FROM dbo.sahyog_Standup_People(s.StandupId)) AS People
    FROM dbo.sahyog_Standups s
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = s.DepartmentId
    LEFT JOIN dbo.sahyog_Users c ON c.UserId = s.CreatedBy
    WHERE s.TenantId = @TenantId
    ORDER BY s.IsActive DESC, s.Name;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_Save
    @StandupId INT = NULL, @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER,
    @Name NVARCHAR(80), @DepartmentId UNIQUEIDENTIFIER = NULL, @Days TINYINT, @AtMinutes SMALLINT,
    @Q1 NVARCHAR(150), @Q2 NVARCHAR(150), @Q3 NVARCHAR(150), @IsActive BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    IF @DepartmentId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Departments WHERE DepartmentId = @DepartmentId AND TenantId = @TenantId)
        SET @DepartmentId = NULL;
    IF @StandupId IS NULL OR @StandupId = 0
    BEGIN
        INSERT dbo.sahyog_Standups (TenantId, Name, DepartmentId, Days, AtMinutes, Q1, Q2, Q3, IsActive, CreatedBy)
        VALUES (@TenantId, @Name, @DepartmentId, @Days, @AtMinutes, @Q1, @Q2, @Q3, @IsActive, @UserId);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS StandupId;
        RETURN;
    END;
    UPDATE dbo.sahyog_Standups
    SET Name = @Name, DepartmentId = @DepartmentId, Days = @Days,
        -- a new time today: let the reminder go out again
        LastRunDay = CASE WHEN AtMinutes <> @AtMinutes THEN NULL ELSE LastRunDay END,
        AtMinutes = @AtMinutes, Q1 = @Q1, Q2 = @Q2, Q3 = @Q3, IsActive = @IsActive
    WHERE StandupId = @StandupId AND TenantId = @TenantId;
    SELECT CASE WHEN @@ROWCOUNT = 1 THEN @StandupId ELSE 0 END AS StandupId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_Delete
    @TenantId UNIQUEIDENTIFIER, @StandupId INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_Standups WHERE StandupId = @StandupId AND TenantId = @TenantId;
    SELECT @@ROWCOUNT AS Changed;
END
GO

/* my stand-ups (I'm in them), with my answer for @Day if I gave one */
CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_Mine
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Day DATE
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.StandupId, s.Name, s.Days, s.AtMinutes, s.Q1, s.Q2, s.Q3, d.Name AS DepartmentName,
           a.A1, a.A2, a.A3, a.HasBlocker, a.AnsweredUtc
    FROM dbo.sahyog_Standups s
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = s.DepartmentId
    LEFT JOIN dbo.sahyog_StandupAnswers a ON a.StandupId = s.StandupId AND a.Day = @Day AND a.UserId = @UserId
    WHERE s.TenantId = @TenantId AND s.IsActive = 1
      AND EXISTS (SELECT 1 FROM dbo.sahyog_Standup_People(s.StandupId) p WHERE p.UserId = @UserId)
    ORDER BY s.AtMinutes, s.Name;
END
GO

/* answer (or change my answer). Returns 0 when I'm not in that stand-up. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_Answer
    @TenantId UNIQUEIDENTIFIER, @StandupId INT, @UserId UNIQUEIDENTIFIER, @Day DATE,
    @A1 NVARCHAR(1000), @A2 NVARCHAR(1000), @A3 NVARCHAR(1000), @HasBlocker BIT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Standups WHERE StandupId = @StandupId AND TenantId = @TenantId)
       OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_Standup_People(@StandupId) WHERE UserId = @UserId)
    BEGIN SELECT CAST(0 AS BIT) AS Saved, CAST(0 AS BIT) AS WasBlocked; RETURN; END;

    DECLARE @was BIT = (SELECT HasBlocker FROM dbo.sahyog_StandupAnswers WHERE StandupId = @StandupId AND Day = @Day AND UserId = @UserId);
    IF @was IS NULL
        INSERT dbo.sahyog_StandupAnswers (StandupId, UserId, Day, A1, A2, A3, HasBlocker) VALUES (@StandupId, @UserId, @Day, @A1, @A2, @A3, @HasBlocker);
    ELSE
        UPDATE dbo.sahyog_StandupAnswers SET A1 = @A1, A2 = @A2, A3 = @A3, HasBlocker = @HasBlocker, AnsweredUtc = SYSUTCDATETIME()
        WHERE StandupId = @StandupId AND Day = @Day AND UserId = @UserId;

    -- who to tell about a new blocker: the person's manager and whoever set up the stand-up
    SELECT CAST(1 AS BIT) AS Saved, CAST(ISNULL(@was, 0) AS BIT) AS WasBlocked, s.Name, s.CreatedBy, u.ManagerId, u.DisplayName
    FROM dbo.sahyog_Standups s CROSS JOIN dbo.sahyog_Users u
    WHERE s.StandupId = @StandupId AND u.UserId = @UserId;
END
GO

/* the roll-up for one day: the stand-up, then everyone in it with their answer (or none) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_Rollup
    @TenantId UNIQUEIDENTIFIER, @StandupId INT, @Day DATE
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.StandupId, s.Name, s.DepartmentId, d.Name AS DepartmentName, s.Days, s.AtMinutes, s.Q1, s.Q2, s.Q3, s.IsActive, s.CreatedBy
    FROM dbo.sahyog_Standups s
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = s.DepartmentId
    WHERE s.StandupId = @StandupId AND s.TenantId = @TenantId;

    SELECT p.UserId, p.DisplayName, p.AvatarTone, p.JobTitle, a.A1, a.A2, a.A3, a.HasBlocker, a.AnsweredUtc
    FROM dbo.sahyog_Standup_People(@StandupId) p
    JOIN dbo.sahyog_Standups s ON s.StandupId = @StandupId AND s.TenantId = @TenantId
    LEFT JOIN dbo.sahyog_StandupAnswers a ON a.StandupId = @StandupId AND a.Day = @Day AND a.UserId = p.UserId
    ORDER BY CASE WHEN a.HasBlocker = 1 THEN 0 WHEN a.UserId IS NOT NULL THEN 1 ELSE 2 END, a.AnsweredUtc, p.DisplayName;
END
GO

/* the reminder job: every active stand-up, with its workspace's time zone */
CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_All
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.StandupId, s.TenantId, s.Name, s.Days, s.AtMinutes, s.LastRunDay, t.TimeZoneId
    FROM dbo.sahyog_Standups s
    JOIN dbo.sahyog_Tenants t ON t.TenantId = s.TenantId AND t.IsActive = 1
    WHERE s.IsActive = 1;
END
GO

/* marks today's reminder as sent and returns who hasn't answered yet (each stand-up once a day) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_TakeRun
    @StandupId INT, @Day DATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Standups SET LastRunDay = @Day
    WHERE StandupId = @StandupId AND (LastRunDay IS NULL OR LastRunDay < @Day);
    IF @@ROWCOUNT = 0 RETURN;
    SELECT p.UserId
    FROM dbo.sahyog_Standup_People(@StandupId) p
    WHERE NOT EXISTS (SELECT 1 FROM dbo.sahyog_StandupAnswers a WHERE a.StandupId = @StandupId AND a.Day = @Day AND a.UserId = p.UserId);
END
GO

PRINT N'47_Standup.sql: async stand-up ready.';
GO
