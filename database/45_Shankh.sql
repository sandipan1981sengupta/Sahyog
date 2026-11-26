/* =====================================================================
   ShankhNaad round 45 (safe to run more than once; needs 01–02 and 40_OrgStructure.sql):
     Shankh: an urgent alert that rings every person's screen until they press "Seen".
     1. A workspace admin sends it to everyone, a department, or picked people.
     2. Each person's row records when they saw it.
     3. After N minutes, the managers of people who still haven't seen it get a reminder (once).
     4. The sender or an admin closes it: it stops ringing everywhere.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_ShankhAlerts', N'U') IS NULL
CREATE TABLE dbo.sahyog_ShankhAlerts
(
    AlertId         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_ShankhAlerts PRIMARY KEY,
    TenantId        UNIQUEIDENTIFIER NOT NULL
                    CONSTRAINT FK_sahyog_ShankhAlerts_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    SenderId        UNIQUEIDENTIFIER NOT NULL,
    Kind            VARCHAR(20)      NOT NULL,          -- outage · drill · client · other
    Body            NVARCHAR(1000)   NOT NULL,
    Audience        NVARCHAR(200)    NOT NULL,          -- "Everyone", "Engineering", "4 people" (shown on the board)
    RemindAfterMin  INT              NULL,              -- NULL = no reminder to managers
    SentUtc         DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_ShankhAlerts_Sent DEFAULT (SYSUTCDATETIME()),
    ClosedUtc       DATETIME2(3)     NULL,
    ClosedBy        UNIQUEIDENTIFIER NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_ShankhAlerts_Tenant')
    CREATE INDEX IX_sahyog_ShankhAlerts_Tenant ON dbo.sahyog_ShankhAlerts(TenantId, SentUtc DESC);
GO

IF OBJECT_ID(N'dbo.sahyog_ShankhRecipients', N'U') IS NULL
CREATE TABLE dbo.sahyog_ShankhRecipients
(
    AlertId         UNIQUEIDENTIFIER NOT NULL
                    CONSTRAINT FK_sahyog_ShankhRecipients_Alerts REFERENCES dbo.sahyog_ShankhAlerts(AlertId) ON DELETE CASCADE,
    UserId          UNIQUEIDENTIFIER NOT NULL,
    ManagerId       UNIQUEIDENTIFIER NULL,               -- their manager when the alert was sent (for the reminder)
    SeenUtc         DATETIME2(3)     NULL,
    RemindedUtc     DATETIME2(3)     NULL,               -- when their manager was reminded
    CONSTRAINT PK_sahyog_ShankhRecipients PRIMARY KEY (AlertId, UserId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_ShankhRecipients_User')
    CREATE INDEX IX_sahyog_ShankhRecipients_User ON dbo.sahyog_ShankhRecipients(UserId) INCLUDE (SeenUtc);
GO

/* ---------- send: the alert and one row per person (ids separated by commas) ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_Create
    @AlertId UNIQUEIDENTIFIER, @TenantId UNIQUEIDENTIFIER, @SenderId UNIQUEIDENTIFIER,
    @Kind VARCHAR(20), @Body NVARCHAR(1000), @Audience NVARCHAR(200), @RemindAfterMin INT,
    @UserIds NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.sahyog_ShankhAlerts (AlertId, TenantId, SenderId, Kind, Body, Audience, RemindAfterMin)
    VALUES (@AlertId, @TenantId, @SenderId, @Kind, @Body, @Audience, @RemindAfterMin);

    INSERT dbo.sahyog_ShankhRecipients (AlertId, UserId, ManagerId, SeenUtc)
    SELECT @AlertId, u.UserId, u.ManagerId,
           CASE WHEN u.UserId = @SenderId THEN SYSUTCDATETIME() END      -- the sender has seen it
    FROM (SELECT DISTINCT TRY_CAST(LTRIM(RTRIM(value)) AS UNIQUEIDENTIFIER) AS UserId FROM STRING_SPLIT(@UserIds, N',')) s
    JOIN dbo.sahyog_Users u ON u.UserId = s.UserId AND u.TenantId = @TenantId AND u.IsActive = 1;

    SELECT COUNT(*) AS People FROM dbo.sahyog_ShankhRecipients WHERE AlertId = @AlertId;
END
GO

/* ---------- "Seen" ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_Seen @AlertId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE r SET SeenUtc = COALESCE(r.SeenUtc, SYSUTCDATETIME())
    FROM dbo.sahyog_ShankhRecipients r
    JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId AND a.TenantId = @TenantId
    WHERE r.AlertId = @AlertId AND r.UserId = @UserId;
    SELECT r.SeenUtc, a.SenderId FROM dbo.sahyog_ShankhRecipients r JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId
    WHERE r.AlertId = @AlertId AND r.UserId = @UserId AND a.TenantId = @TenantId;
END
GO

/* ---------- my alerts still ringing (shown again on every page until I press Seen) ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_MyOpen @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT a.AlertId, a.Kind, a.Body, a.Audience, a.SentUtc, a.SenderId, s.DisplayName AS SenderName
    FROM dbo.sahyog_ShankhRecipients r
    JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId AND a.TenantId = @TenantId
    LEFT JOIN dbo.sahyog_Users s ON s.UserId = a.SenderId
    WHERE r.UserId = @UserId AND r.SeenUtc IS NULL AND a.ClosedUtc IS NULL
      AND a.SentUtc > DATEADD(HOUR, -24, SYSUTCDATETIME())               -- an old alert nobody closed stops after a day
    ORDER BY a.SentUtc DESC;
END
GO

/* ---------- the board: the alert, then everyone on it ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_Board @TenantId UNIQUEIDENTIFIER, @AlertId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT a.AlertId, a.Kind, a.Body, a.Audience, a.RemindAfterMin, a.SentUtc, a.ClosedUtc, a.SenderId,
           s.DisplayName AS SenderName
    FROM dbo.sahyog_ShankhAlerts a LEFT JOIN dbo.sahyog_Users s ON s.UserId = a.SenderId
    WHERE a.AlertId = @AlertId AND a.TenantId = @TenantId;

    SELECT r.UserId, u.DisplayName, u.AvatarTone, d.Name AS DepartmentName, r.ManagerId, m.DisplayName AS ManagerName,
           r.SeenUtc, r.RemindedUtc
    FROM dbo.sahyog_ShankhRecipients r
    JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId AND a.TenantId = @TenantId
    JOIN dbo.sahyog_Users u ON u.UserId = r.UserId
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = u.DepartmentId
    LEFT JOIN dbo.sahyog_Users m ON m.UserId = r.ManagerId
    WHERE r.AlertId = @AlertId
    ORDER BY CASE WHEN r.SeenUtc IS NULL THEN 0 ELSE 1 END, u.DisplayName;
END
GO

/* ---------- recent alerts (the admin's list) ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_Recent @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (20) a.AlertId, a.Kind, a.Body, a.Audience, a.SentUtc, a.ClosedUtc, s.DisplayName AS SenderName,
           (SELECT COUNT(*) FROM dbo.sahyog_ShankhRecipients r WHERE r.AlertId = a.AlertId) AS People,
           (SELECT COUNT(*) FROM dbo.sahyog_ShankhRecipients r WHERE r.AlertId = a.AlertId AND r.SeenUtc IS NOT NULL) AS Seen
    FROM dbo.sahyog_ShankhAlerts a LEFT JOIN dbo.sahyog_Users s ON s.UserId = a.SenderId
    WHERE a.TenantId = @TenantId
    ORDER BY a.SentUtc DESC;
END
GO

/* ---------- close: stops ringing everywhere; returns who was still ringing ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_Close @TenantId UNIQUEIDENTIFIER, @AlertId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_ShankhAlerts SET ClosedUtc = COALESCE(ClosedUtc, SYSUTCDATETIME()), ClosedBy = COALESCE(ClosedBy, @UserId)
    WHERE AlertId = @AlertId AND TenantId = @TenantId;
    SELECT r.UserId FROM dbo.sahyog_ShankhRecipients r JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId
    WHERE r.AlertId = @AlertId AND a.TenantId = @TenantId AND r.SeenUtc IS NULL;
END
GO

/* ---------- reminders due: people who haven't seen it after RemindAfterMin; each is returned once ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_TakeDueReminders
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @due TABLE (AlertId UNIQUEIDENTIFIER, UserId UNIQUEIDENTIFIER, ManagerId UNIQUEIDENTIFIER);
    UPDATE r SET RemindedUtc = SYSUTCDATETIME()
    OUTPUT inserted.AlertId, inserted.UserId, inserted.ManagerId INTO @due
    FROM dbo.sahyog_ShankhRecipients r
    JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId
    WHERE r.SeenUtc IS NULL AND r.RemindedUtc IS NULL AND a.ClosedUtc IS NULL AND a.RemindAfterMin IS NOT NULL
      AND a.SentUtc < DATEADD(MINUTE, -a.RemindAfterMin, SYSUTCDATETIME())
      AND a.SentUtc > DATEADD(HOUR, -24, SYSUTCDATETIME());
    SELECT d.AlertId, a.TenantId, a.Body, a.SenderId, d.UserId, u.DisplayName, d.ManagerId, m.DisplayName AS ManagerName
    FROM @due d
    JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = d.AlertId
    JOIN dbo.sahyog_Users u ON u.UserId = d.UserId
    LEFT JOIN dbo.sahyog_Users m ON m.UserId = d.ManagerId AND m.IsActive = 1;
END
GO

PRINT N'45_Shankh.sql applied.';
GO
