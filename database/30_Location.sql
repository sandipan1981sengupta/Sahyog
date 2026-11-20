/* =====================================================================
   ShankhNaad round 39 (safe to run more than once; needs 01–29):
     Team member location.
     1. The super admin switches it on per client (off by default).
     2. A workspace admin lists the office's internet addresses: people connecting from one show "In office".
     3. Each person decides for themselves whether to share (nothing is stored until they say yes).
        Only the LATEST location is kept (no history). Turning sharing off, or the super admin
        switching the feature off, erases what was stored.
   Both tables cascade when a client or a person is deleted, so nothing else had to change.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_TenantLocation', N'U') IS NULL
CREATE TABLE dbo.sahyog_TenantLocation
(
    TenantId    UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_TenantLocation PRIMARY KEY
                CONSTRAINT FK_sahyog_TenantLocation_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Enabled     BIT              NOT NULL CONSTRAINT DF_sahyog_TenantLocation_Enabled DEFAULT (0),
    OfficeIps   NVARCHAR(2000)   NULL,          -- one address or range (CIDR) per line
    UpdatedUtc  DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_TenantLocation_Updated DEFAULT (SYSUTCDATETIME())
);
GO

IF OBJECT_ID(N'dbo.sahyog_UserLocations', N'U') IS NULL
CREATE TABLE dbo.sahyog_UserLocations
(
    UserId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_UserLocations PRIMARY KEY
                CONSTRAINT FK_sahyog_UserLocations_Users REFERENCES dbo.sahyog_Users(UserId) ON DELETE CASCADE,
    TenantId    UNIQUEIDENTIFIER NOT NULL,
    Sharing     BIT              NULL,          -- NULL = not asked yet, 0 = said no, 1 = shares
    InOffice    BIT              NULL,
    Ip          VARCHAR(45)      NULL,
    Lat         FLOAT            NULL,
    Lng         FLOAT            NULL,
    AccuracyM   INT              NULL,
    Address     NVARCHAR(300)    NULL,
    Area        NVARCHAR(120)    NULL,
    City        NVARCHAR(120)    NULL,
    Region      NVARCHAR(120)    NULL,
    Country     NVARCHAR(80)     NULL,
    PreciseUtc  DATETIME2(3)     NULL,          -- when the map position was taken
    SeenUtc     DATETIME2(3)     NULL           -- last check-in (office / remote)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_UserLocations_Tenant')
    CREATE INDEX IX_sahyog_UserLocations_Tenant ON dbo.sahyog_UserLocations(TenantId);
GO

/* ---------- a client's setting ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_TenantGet @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT CAST(COALESCE(MAX(CAST(Enabled AS INT)), 0) AS BIT) AS Enabled, MAX(OfficeIps) AS OfficeIps
    FROM dbo.sahyog_TenantLocation WHERE TenantId = @TenantId;
END
GO

/* every client that has it switched on (the super admin list) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_TenantList
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TenantId FROM dbo.sahyog_TenantLocation WHERE Enabled = 1;
END
GO

/* super admin: on / off. Off also erases every stored location of that client (people's yes/no is kept). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_TenantSetEnabled @TenantId UNIQUEIDENTIFIER, @Enabled BIT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Tenants WHERE TenantId = @TenantId) BEGIN SELECT 0 AS Affected; RETURN; END
    MERGE dbo.sahyog_TenantLocation AS t
    USING (SELECT @TenantId AS TenantId) AS s ON t.TenantId = s.TenantId
    WHEN MATCHED THEN UPDATE SET Enabled = @Enabled, UpdatedUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (TenantId, Enabled) VALUES (@TenantId, @Enabled);
    IF @Enabled = 0
        UPDATE dbo.sahyog_UserLocations
        SET InOffice = NULL, Ip = NULL, Lat = NULL, Lng = NULL, AccuracyM = NULL, Address = NULL, Area = NULL,
            City = NULL, Region = NULL, Country = NULL, PreciseUtc = NULL, SeenUtc = NULL
        WHERE TenantId = @TenantId;
    SELECT 1 AS Affected;
END
GO

/* workspace admin: the office's internet addresses */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_TenantSetOffice @TenantId UNIQUEIDENTIFIER, @OfficeIps NVARCHAR(2000)
AS
BEGIN
    SET NOCOUNT ON;
    MERGE dbo.sahyog_TenantLocation AS t
    USING (SELECT @TenantId AS TenantId) AS s ON t.TenantId = s.TenantId
    WHEN MATCHED THEN UPDATE SET OfficeIps = NULLIF(@OfficeIps, N''), UpdatedUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (TenantId, Enabled, OfficeIps) VALUES (@TenantId, 0, NULLIF(@OfficeIps, N''));
END
GO

/* ---------- one person's choice ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_UserGetSharing @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Sharing FROM dbo.sahyog_UserLocations WHERE UserId = @UserId AND TenantId = @TenantId;
END
GO

/* yes / no. No erases what was stored. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_UserSetSharing @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Sharing BIT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId) RETURN;
    MERGE dbo.sahyog_UserLocations AS t
    USING (SELECT @UserId AS UserId) AS s ON t.UserId = s.UserId
    WHEN MATCHED THEN UPDATE SET Sharing = @Sharing
    WHEN NOT MATCHED THEN INSERT (UserId, TenantId, Sharing) VALUES (@UserId, @TenantId, @Sharing);
    IF @Sharing = 0
        UPDATE dbo.sahyog_UserLocations
        SET InOffice = NULL, Ip = NULL, Lat = NULL, Lng = NULL, AccuracyM = NULL, Address = NULL, Area = NULL,
            City = NULL, Region = NULL, Country = NULL, PreciseUtc = NULL, SeenUtc = NULL
        WHERE UserId = @UserId;
END
GO

/* a check-in. Only stored when the client has it on AND the person shares.
   @Lat NULL = no map position this time (office / remote only; the last position stays). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_UserSave
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Ip VARCHAR(45), @InOffice BIT,
    @Lat FLOAT, @Lng FLOAT, @AccuracyM INT,
    @Address NVARCHAR(300), @Area NVARCHAR(120), @City NVARCHAR(120), @Region NVARCHAR(120), @Country NVARCHAR(80),
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_TenantLocation WHERE TenantId = @TenantId AND Enabled = 1) BEGIN SET @Result = 1; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_UserLocations WHERE UserId = @UserId AND TenantId = @TenantId AND Sharing = 1) BEGIN SET @Result = 2; RETURN; END
    UPDATE dbo.sahyog_UserLocations
    SET Ip = @Ip, InOffice = @InOffice, SeenUtc = SYSUTCDATETIME(),
        Lat       = CASE WHEN @Lat IS NULL THEN Lat ELSE @Lat END,
        Lng       = CASE WHEN @Lat IS NULL THEN Lng ELSE @Lng END,
        AccuracyM = CASE WHEN @Lat IS NULL THEN AccuracyM ELSE @AccuracyM END,
        PreciseUtc= CASE WHEN @Lat IS NULL THEN PreciseUtc ELSE SYSUTCDATETIME() END,
        Address   = CASE WHEN @Lat IS NULL OR @City IS NULL THEN Address ELSE @Address END,
        Area      = CASE WHEN @Lat IS NULL OR @City IS NULL THEN Area ELSE @Area END,
        City      = CASE WHEN @Lat IS NULL OR @City IS NULL THEN City ELSE @City END,
        Region    = CASE WHEN @Lat IS NULL OR @City IS NULL THEN Region ELSE @Region END,
        Country   = CASE WHEN @Lat IS NULL OR @City IS NULL THEN Country ELSE @Country END
    WHERE UserId = @UserId AND TenantId = @TenantId;
    SET @Result = 0;
END
GO

/* everyone's latest (active people of the client) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_List @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.UserId, l.Sharing, l.InOffice, l.Lat, l.Lng, l.AccuracyM, l.Address, l.Area, l.City, l.Region, l.Country,
           l.PreciseUtc, l.SeenUtc
    FROM dbo.sahyog_UserLocations l
    JOIN dbo.sahyog_Users u ON u.UserId = l.UserId AND u.TenantId = @TenantId
    WHERE l.TenantId = @TenantId;
END
GO

PRINT N'30_Location.sql applied.';
GO
