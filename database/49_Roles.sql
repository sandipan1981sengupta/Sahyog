/* =====================================================================
   ShankhNaad round 49 (safe to run more than once; needs 01–02 and 40_OrgStructure.sql):
     Message a role. Write to "IT help desk" or "Head of HR" instead of a person; ShankhNaad picks who
     is in and free, opens a chat with them, and escalates when nobody replies in time.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Roles', N'U') IS NULL
CREATE TABLE dbo.sahyog_Roles
(
    RoleId       INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Roles PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Roles_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Name         NVARCHAR(80)     NOT NULL,
    Description  NVARCHAR(200)    NULL,
    Icon         NVARCHAR(30)     NULL,               -- a Font Awesome name, e.g. "life-ring"
    EscalateMin  INT              NOT NULL CONSTRAINT DF_sahyog_Roles_Esc DEFAULT (15),   -- 0 = never
    CreatedUtc   DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Roles_Created DEFAULT (SYSUTCDATETIME())
);
GO
IF OBJECT_ID(N'dbo.sahyog_RoleMembers', N'U') IS NULL
CREATE TABLE dbo.sahyog_RoleMembers
(
    RoleId   INT              NOT NULL CONSTRAINT FK_sahyog_RoleMembers_Roles REFERENCES dbo.sahyog_Roles(RoleId) ON DELETE CASCADE,
    UserId   UNIQUEIDENTIFIER NOT NULL,
    Sort     INT              NOT NULL CONSTRAINT DF_sahyog_RoleMembers_Sort DEFAULT (0),     -- 0 = first to be asked
    CONSTRAINT PK_sahyog_RoleMembers PRIMARY KEY (RoleId, UserId)
);
GO
IF OBJECT_ID(N'dbo.sahyog_RoleRequests', N'U') IS NULL
CREATE TABLE dbo.sahyog_RoleRequests
(
    RequestId    INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_RoleRequests PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL,
    RoleId       INT              NOT NULL CONSTRAINT FK_sahyog_RoleRequests_Roles REFERENCES dbo.sahyog_Roles(RoleId) ON DELETE CASCADE,
    FromUserId   UNIQUEIDENTIFIER NOT NULL,
    Body         NVARCHAR(1000)   NOT NULL,
    AssignedTo   UNIQUEIDENTIFIER NOT NULL,
    ChannelId    UNIQUEIDENTIFIER NOT NULL,
    CreatedUtc   DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_RoleRequests_Created DEFAULT (SYSUTCDATETIME()),
    AnsweredUtc  DATETIME2(3)     NULL,
    EscalatedUtc DATETIME2(3)     NULL,
    EscalatedTo  UNIQUEIDENTIFIER NULL,
    EscChannelId UNIQUEIDENTIFIER NULL,               -- the chat with the person it was escalated to
    ClosedUtc    DATETIME2(3)     NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_RoleRequests_Open')
    CREATE INDEX IX_sahyog_RoleRequests_Open ON dbo.sahyog_RoleRequests(CreatedUtc) WHERE AnsweredUtc IS NULL AND EscalatedUtc IS NULL AND ClosedUtc IS NULL;
GO

/* roles, then their people (in order) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Role_List
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT r.RoleId, r.Name, r.Description, r.Icon, r.EscalateMin,
           (SELECT COUNT(*) FROM dbo.sahyog_RoleRequests q WHERE q.RoleId = r.RoleId AND q.AnsweredUtc IS NULL AND q.ClosedUtc IS NULL) AS Waiting
    FROM dbo.sahyog_Roles r WHERE r.TenantId = @TenantId ORDER BY r.Name;

    SELECT m.RoleId, m.UserId, m.Sort, u.DisplayName, u.AvatarTone, u.JobTitle, u.ManagerId
    FROM dbo.sahyog_RoleMembers m
    JOIN dbo.sahyog_Roles r ON r.RoleId = m.RoleId AND r.TenantId = @TenantId
    JOIN dbo.sahyog_Users u ON u.UserId = m.UserId AND u.IsActive = 1
    ORDER BY m.RoleId, m.Sort, u.DisplayName;
END
GO

/* add or change a role; @MemberIds = a JSON array of ids, in the order they are asked: ["id","id"] */
CREATE OR ALTER PROCEDURE dbo.sahyog_Role_Save
    @RoleId INT = NULL, @TenantId UNIQUEIDENTIFIER, @Name NVARCHAR(80), @Description NVARCHAR(200) = NULL,
    @Icon NVARCHAR(30) = NULL, @EscalateMin INT = 15, @MemberIds NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;
    IF @RoleId IS NULL OR @RoleId = 0
    BEGIN
        INSERT dbo.sahyog_Roles (TenantId, Name, Description, Icon, EscalateMin) VALUES (@TenantId, @Name, @Description, @Icon, @EscalateMin);
        SET @RoleId = CAST(SCOPE_IDENTITY() AS INT);
    END
    ELSE
    BEGIN
        UPDATE dbo.sahyog_Roles SET Name = @Name, Description = @Description, Icon = @Icon, EscalateMin = @EscalateMin
        WHERE RoleId = @RoleId AND TenantId = @TenantId;
        IF @@ROWCOUNT = 0 BEGIN ROLLBACK; SELECT CAST(0 AS INT) AS RoleId; RETURN; END;
        DELETE dbo.sahyog_RoleMembers WHERE RoleId = @RoleId;
    END;
    INSERT dbo.sahyog_RoleMembers (RoleId, UserId, Sort)
    SELECT @RoleId, u.UserId, MIN(x.ordinal)
    FROM (SELECT TRY_CAST(j.[value] AS UNIQUEIDENTIFIER) AS Id, CAST(j.[key] AS INT) AS ordinal
          FROM OPENJSON(@MemberIds) j) x
    JOIN dbo.sahyog_Users u ON u.UserId = x.Id AND u.TenantId = @TenantId AND u.IsActive = 1
    GROUP BY u.UserId;
    COMMIT;
    SELECT @RoleId AS RoleId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Role_Delete
    @TenantId UNIQUEIDENTIFIER, @RoleId INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_Roles WHERE RoleId = @RoleId AND TenantId = @TenantId;
    SELECT @@ROWCOUNT AS Changed;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_RoleRequest_Create
    @TenantId UNIQUEIDENTIFIER, @RoleId INT, @FromUserId UNIQUEIDENTIFIER, @Body NVARCHAR(1000),
    @AssignedTo UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Roles WHERE RoleId = @RoleId AND TenantId = @TenantId)
    BEGIN SELECT CAST(0 AS INT) AS RequestId; RETURN; END;
    INSERT dbo.sahyog_RoleRequests (TenantId, RoleId, FromUserId, Body, AssignedTo, ChannelId)
    VALUES (@TenantId, @RoleId, @FromUserId, @Body, @AssignedTo, @ChannelId);
    SELECT CAST(SCOPE_IDENTITY() AS INT) AS RequestId;
END
GO

/* requests I sent, and requests to roles I'm in (latest 60) */
CREATE OR ALTER PROCEDURE dbo.sahyog_RoleRequest_Mine
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    -- first: notice replies (from the person asked in that chat, or from the person it was escalated to in theirs)
    UPDATE q SET AnsweredUtc = SYSUTCDATETIME()
    FROM dbo.sahyog_RoleRequests q
    WHERE q.TenantId = @TenantId AND q.AnsweredUtc IS NULL AND q.ClosedUtc IS NULL
      AND (EXISTS (SELECT 1 FROM dbo.sahyog_Messages m WHERE m.ChannelId = q.ChannelId AND m.SentUtc > q.CreatedUtc AND m.SenderId = q.AssignedTo)
        OR EXISTS (SELECT 1 FROM dbo.sahyog_Messages m WHERE m.ChannelId = q.EscChannelId AND m.SentUtc > q.EscalatedUtc AND m.SenderId = q.EscalatedTo));

    SELECT TOP (60) q.RequestId, q.RoleId, q.EscChannelId, r.Name AS RoleName, r.Icon, q.Body, q.CreatedUtc, q.AnsweredUtc, q.EscalatedUtc, q.ClosedUtc, q.ChannelId,
           q.FromUserId, f.DisplayName AS FromName, f.AvatarTone AS FromTone,
           q.AssignedTo, a.DisplayName AS AssignedName, q.EscalatedTo, e.DisplayName AS EscalatedName,
           CAST(CASE WHEN q.FromUserId = @UserId THEN 1 ELSE 0 END AS BIT) AS Sent
    FROM dbo.sahyog_RoleRequests q
    JOIN dbo.sahyog_Roles r ON r.RoleId = q.RoleId
    JOIN dbo.sahyog_Users f ON f.UserId = q.FromUserId
    JOIN dbo.sahyog_Users a ON a.UserId = q.AssignedTo
    LEFT JOIN dbo.sahyog_Users e ON e.UserId = q.EscalatedTo
    WHERE q.TenantId = @TenantId
      AND (q.FromUserId = @UserId OR q.AssignedTo = @UserId OR q.EscalatedTo = @UserId
           OR EXISTS (SELECT 1 FROM dbo.sahyog_RoleMembers rm WHERE rm.RoleId = q.RoleId AND rm.UserId = @UserId))
    ORDER BY CASE WHEN q.AnsweredUtc IS NULL AND q.ClosedUtc IS NULL THEN 0 ELSE 1 END, q.CreatedUtc DESC;
END
GO

/* close: the person who asked, or anyone in the role */
CREATE OR ALTER PROCEDURE dbo.sahyog_RoleRequest_Close
    @TenantId UNIQUEIDENTIFIER, @RequestId INT, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE q SET ClosedUtc = SYSUTCDATETIME()
    FROM dbo.sahyog_RoleRequests q
    WHERE q.RequestId = @RequestId AND q.TenantId = @TenantId AND q.ClosedUtc IS NULL
      AND (q.FromUserId = @UserId OR q.AssignedTo = @UserId OR q.EscalatedTo = @UserId
           OR EXISTS (SELECT 1 FROM dbo.sahyog_RoleMembers rm WHERE rm.RoleId = q.RoleId AND rm.UserId = @UserId));
    SELECT @@ROWCOUNT AS Changed;
END
GO

/* the escalation job: marks replies, then takes requests still unanswered after the role's minutes (each once) */
CREATE OR ALTER PROCEDURE dbo.sahyog_RoleRequest_TakeDue
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE q SET AnsweredUtc = SYSUTCDATETIME()
    FROM dbo.sahyog_RoleRequests q
    WHERE q.AnsweredUtc IS NULL AND q.ClosedUtc IS NULL AND q.EscalatedUtc IS NULL
      AND EXISTS (SELECT 1 FROM dbo.sahyog_Messages m WHERE m.ChannelId = q.ChannelId AND m.SentUtc > q.CreatedUtc AND m.SenderId = q.AssignedTo);

    DECLARE @due TABLE (RequestId INT);
    UPDATE q SET EscalatedUtc = SYSUTCDATETIME()
    OUTPUT inserted.RequestId INTO @due
    FROM dbo.sahyog_RoleRequests q
    JOIN dbo.sahyog_Roles r ON r.RoleId = q.RoleId
    WHERE q.AnsweredUtc IS NULL AND q.ClosedUtc IS NULL AND q.EscalatedUtc IS NULL
      AND r.EscalateMin > 0 AND q.CreatedUtc <= DATEADD(MINUTE, -r.EscalateMin, SYSUTCDATETIME());

    SELECT q.RequestId, q.TenantId, q.RoleId, r.Name AS RoleName, r.EscalateMin, q.Body, q.FromUserId, f.DisplayName AS FromName,
           q.AssignedTo, a.DisplayName AS AssignedName, a.ManagerId
    FROM @due d
    JOIN dbo.sahyog_RoleRequests q ON q.RequestId = d.RequestId
    JOIN dbo.sahyog_Roles r ON r.RoleId = q.RoleId
    JOIN dbo.sahyog_Users f ON f.UserId = q.FromUserId
    JOIN dbo.sahyog_Users a ON a.UserId = q.AssignedTo;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_RoleRequest_SetEscalated
    @RequestId INT, @EscalatedTo UNIQUEIDENTIFIER, @EscChannelId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_RoleRequests SET EscalatedTo = @EscalatedTo, EscChannelId = @EscChannelId WHERE RequestId = @RequestId;
END
GO

PRINT N'49_Roles.sql: message a role ready.';
GO
