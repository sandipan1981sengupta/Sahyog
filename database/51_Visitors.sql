/* =====================================================================
   ShankhNaad round 51 (safe to run more than once; needs 01–02 and 40_OrgStructure.sql):
     Visitor lobby. A reception tablet (a secret link, no sign-in) where visitors sign in and pick who
     they are meeting; the host gets a card in ShankhNaad and answers "Coming" or "Please wait".
     Staff can expect visitors ahead of time; the day's visitor list is on Work → Visitors.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Lobby', N'U') IS NULL
CREATE TABLE dbo.sahyog_Lobby
(
    TenantId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_Lobby PRIMARY KEY
               CONSTRAINT FK_sahyog_Lobby_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    KioskCode  NVARCHAR(24)     NOT NULL CONSTRAINT UX_sahyog_Lobby_Code UNIQUE,
    Enabled    BIT              NOT NULL CONSTRAINT DF_sahyog_Lobby_Enabled DEFAULT (1),
    Welcome    NVARCHAR(200)    NULL
);
GO
IF OBJECT_ID(N'dbo.sahyog_Visitors', N'U') IS NULL
CREATE TABLE dbo.sahyog_Visitors
(
    VisitorId    INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Visitors PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Visitors_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Name         NVARCHAR(100)    NOT NULL,
    Phone        NVARCHAR(30)     NULL,
    Company      NVARCHAR(100)    NULL,
    Purpose      NVARCHAR(200)    NULL,
    HostId       UNIQUEIDENTIFIER NULL,
    ExpectedUtc  DATETIME2(3)     NULL,             -- set when someone expects them
    ArrivedUtc   DATETIME2(3)     NULL,
    LeftUtc      DATETIME2(3)     NULL,
    HostReply    NVARCHAR(20)     NULL,             -- coming | wait
    HostReplyUtc DATETIME2(3)     NULL,
    KioskToken   NVARCHAR(32)     NULL,             -- lets the tablet see the host's answer
    CreatedBy    UNIQUEIDENTIFIER NULL,             -- NULL = signed in at the tablet
    CreatedUtc   DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Visitors_Created DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Visitors_Day')
    CREATE INDEX IX_sahyog_Visitors_Day ON dbo.sahyog_Visitors(TenantId, CreatedUtc);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Lobby_Get
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TenantId, KioskCode, Enabled, Welcome FROM dbo.sahyog_Lobby WHERE TenantId = @TenantId;
END
GO

/* @NewCode: set (first time, or "make a new link" so the old one stops working) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Lobby_Save
    @TenantId UNIQUEIDENTIFIER, @Enabled BIT, @Welcome NVARCHAR(200) = NULL, @NewCode NVARCHAR(24) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Lobby WHERE TenantId = @TenantId)
        UPDATE dbo.sahyog_Lobby SET Enabled = @Enabled, Welcome = @Welcome, KioskCode = ISNULL(@NewCode, KioskCode) WHERE TenantId = @TenantId;
    ELSE IF @NewCode IS NOT NULL
        INSERT dbo.sahyog_Lobby (TenantId, KioskCode, Enabled, Welcome) VALUES (@TenantId, @NewCode, @Enabled, @Welcome);
    SELECT TenantId, KioskCode, Enabled, Welcome FROM dbo.sahyog_Lobby WHERE TenantId = @TenantId;
END
GO

/* the tablet: which workspace this link belongs to */
CREATE OR ALTER PROCEDURE dbo.sahyog_Lobby_ByCode
    @Code NVARCHAR(24)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.TenantId, l.Welcome, t.Name AS TenantName, t.TimeZoneId
    FROM dbo.sahyog_Lobby l JOIN dbo.sahyog_Tenants t ON t.TenantId = l.TenantId AND t.IsActive = 1
    WHERE l.KioskCode = @Code AND l.Enabled = 1;
END
GO

/* people a visitor can pick at the tablet */
CREATE OR ALTER PROCEDURE dbo.sahyog_Lobby_Hosts
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.UserId, u.DisplayName, u.AvatarTone, u.JobTitle, d.Name AS DepartmentName
    FROM dbo.sahyog_Users u LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = u.DepartmentId
    WHERE u.TenantId = @TenantId AND u.IsActive = 1
    ORDER BY u.DisplayName;
END
GO

/* someone arrives at the tablet: if they were expected today (same phone), check that visit in; otherwise a new one */
CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_KioskArrive
    @TenantId UNIQUEIDENTIFIER, @Name NVARCHAR(100), @Phone NVARCHAR(30) = NULL, @Company NVARCHAR(100) = NULL,
    @Purpose NVARCHAR(200) = NULL, @HostId UNIQUEIDENTIFIER = NULL, @Token NVARCHAR(32), @DayStartUtc DATETIME2(3), @DayEndUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    IF @HostId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @HostId AND TenantId = @TenantId AND IsActive = 1)
        SET @HostId = NULL;
    DECLARE @id INT = NULL;
    IF NULLIF(@Phone, N'') IS NOT NULL
        SELECT TOP (1) @id = VisitorId FROM dbo.sahyog_Visitors
        WHERE TenantId = @TenantId AND Phone = @Phone AND ArrivedUtc IS NULL
          AND ExpectedUtc >= @DayStartUtc AND ExpectedUtc < @DayEndUtc
        ORDER BY ExpectedUtc;
    IF @id IS NOT NULL
        UPDATE dbo.sahyog_Visitors
        SET ArrivedUtc = SYSUTCDATETIME(), KioskToken = @Token, HostId = ISNULL(@HostId, HostId),
            Company = ISNULL(NULLIF(@Company, N''), Company), Purpose = ISNULL(NULLIF(@Purpose, N''), Purpose)
        WHERE VisitorId = @id;
    ELSE
    BEGIN
        INSERT dbo.sahyog_Visitors (TenantId, Name, Phone, Company, Purpose, HostId, ArrivedUtc, KioskToken)
        VALUES (@TenantId, @Name, NULLIF(@Phone, N''), NULLIF(@Company, N''), NULLIF(@Purpose, N''), @HostId, SYSUTCDATETIME(), @Token);
        SET @id = CAST(SCOPE_IDENTITY() AS INT);
    END;
    EXEC dbo.sahyog_Visitor_Get @TenantId = @TenantId, @VisitorId = @id;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_Get
    @TenantId UNIQUEIDENTIFIER, @VisitorId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.VisitorId, v.Name, v.Phone, v.Company, v.Purpose, v.HostId, h.DisplayName AS HostName, h.AvatarTone AS HostTone,
           v.ExpectedUtc, v.ArrivedUtc, v.LeftUtc, v.HostReply, v.HostReplyUtc, v.KioskToken, v.CreatedBy, c.DisplayName AS CreatedByName, v.CreatedUtc
    FROM dbo.sahyog_Visitors v
    LEFT JOIN dbo.sahyog_Users h ON h.UserId = v.HostId
    LEFT JOIN dbo.sahyog_Users c ON c.UserId = v.CreatedBy
    WHERE v.VisitorId = @VisitorId AND v.TenantId = @TenantId;
END
GO

/* a member expects a visitor (@Arrived = 1: a walk-in checked in by staff) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_Expect
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Name NVARCHAR(100), @Phone NVARCHAR(30) = NULL, @Company NVARCHAR(100) = NULL,
    @Purpose NVARCHAR(200) = NULL, @HostId UNIQUEIDENTIFIER = NULL, @ExpectedUtc DATETIME2(3) = NULL, @Arrived BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @HostId IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @HostId AND TenantId = @TenantId AND IsActive = 1)
        SET @HostId = @UserId;
    INSERT dbo.sahyog_Visitors (TenantId, Name, Phone, Company, Purpose, HostId, ExpectedUtc, ArrivedUtc, CreatedBy)
    VALUES (@TenantId, @Name, NULLIF(@Phone, N''), NULLIF(@Company, N''), NULLIF(@Purpose, N''), @HostId,
            ISNULL(@ExpectedUtc, SYSUTCDATETIME()), CASE WHEN @Arrived = 1 THEN SYSUTCDATETIME() END, @UserId);
    DECLARE @id INT = CAST(SCOPE_IDENTITY() AS INT);
    EXEC dbo.sahyog_Visitor_Get @TenantId = @TenantId, @VisitorId = @id;
END
GO

/* what = arrive | leave | coming | wait | delete */
CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_Update
    @TenantId UNIQUEIDENTIFIER, @VisitorId INT, @What NVARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;
    IF @What = N'delete'
    BEGIN
        DELETE dbo.sahyog_Visitors WHERE VisitorId = @VisitorId AND TenantId = @TenantId;
        SELECT CAST(NULL AS INT) AS VisitorId WHERE 1 = 0;
        RETURN;
    END;
    UPDATE dbo.sahyog_Visitors
    SET ArrivedUtc   = CASE WHEN @What = N'arrive' THEN ISNULL(ArrivedUtc, SYSUTCDATETIME()) ELSE ArrivedUtc END,
        LeftUtc      = CASE WHEN @What = N'leave' THEN SYSUTCDATETIME() ELSE LeftUtc END,
        HostReply    = CASE WHEN @What IN (N'coming', N'wait') THEN @What ELSE HostReply END,
        HostReplyUtc = CASE WHEN @What IN (N'coming', N'wait') THEN SYSUTCDATETIME() ELSE HostReplyUtc END
    WHERE VisitorId = @VisitorId AND TenantId = @TenantId;
    EXEC dbo.sahyog_Visitor_Get @TenantId = @TenantId, @VisitorId = @VisitorId;
END
GO

/* one day's visitors (expected or arrived that day, or still in the building) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_Day
    @TenantId UNIQUEIDENTIFIER, @FromUtc DATETIME2(3), @ToUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.VisitorId, v.Name, v.Phone, v.Company, v.Purpose, v.HostId, h.DisplayName AS HostName, h.AvatarTone AS HostTone,
           v.ExpectedUtc, v.ArrivedUtc, v.LeftUtc, v.HostReply, v.HostReplyUtc, v.CreatedBy, c.DisplayName AS CreatedByName, v.CreatedUtc
    FROM dbo.sahyog_Visitors v
    LEFT JOIN dbo.sahyog_Users h ON h.UserId = v.HostId
    LEFT JOIN dbo.sahyog_Users c ON c.UserId = v.CreatedBy
    WHERE v.TenantId = @TenantId
      AND (   (v.ArrivedUtc >= @FromUtc AND v.ArrivedUtc < @ToUtc)
           OR (v.ArrivedUtc IS NULL AND v.ExpectedUtc >= @FromUtc AND v.ExpectedUtc < @ToUtc)
           OR (v.ArrivedUtc < @FromUtc AND v.LeftUtc IS NULL AND @ToUtc > SYSUTCDATETIME()))
    ORDER BY ISNULL(v.ArrivedUtc, v.ExpectedUtc);
END
GO

/* the tablet asks how the host answered */
CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_KioskStatus
    @TenantId UNIQUEIDENTIFIER, @VisitorId INT, @Token NVARCHAR(32)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.HostReply, v.HostReplyUtc, h.DisplayName AS HostName
    FROM dbo.sahyog_Visitors v LEFT JOIN dbo.sahyog_Users h ON h.UserId = v.HostId
    WHERE v.VisitorId = @VisitorId AND v.TenantId = @TenantId AND v.KioskToken = @Token
      AND v.ArrivedUtc > DATEADD(HOUR, -2, SYSUTCDATETIME());
END
GO

PRINT N'51_Visitors.sql: visitor lobby ready.';
GO
