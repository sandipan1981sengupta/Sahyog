/* =====================================================================
   ShankhNaad round 44 (safe to run more than once; needs 30_Location.sql):
     Location privacy.
     1. A record of each person's choice: when they said yes / no and which version of the notice they saw.
     2. Automatic deletion: a workspace admin chooses how long a location is kept (7 to 365 days, 30 by default).
        A location that hasn't been refreshed for that long is erased (the app runs this every few hours).
     3. "What's stored about me": a person can read their own stored record.
   Nothing that is already stored changes, except that old locations get erased by the new clean-up.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_TenantLocation', N'RetentionDays') IS NULL
    ALTER TABLE dbo.sahyog_TenantLocation ADD RetentionDays INT NOT NULL
        CONSTRAINT DF_sahyog_TenantLocation_Retention DEFAULT (30);
GO
IF COL_LENGTH(N'dbo.sahyog_UserLocations', N'DecidedUtc') IS NULL
    ALTER TABLE dbo.sahyog_UserLocations ADD DecidedUtc DATETIME2(3) NULL;     -- when the person last said yes / no
GO
IF COL_LENGTH(N'dbo.sahyog_UserLocations', N'NoticeVersion') IS NULL
    ALTER TABLE dbo.sahyog_UserLocations ADD NoticeVersion VARCHAR(20) NULL;   -- which notice they saw when deciding
GO

/* ---------- how long a location is kept ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_GetRetention @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COALESCE(MAX(RetentionDays), 30) AS RetentionDays FROM dbo.sahyog_TenantLocation WHERE TenantId = @TenantId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Location_SetRetention @TenantId UNIQUEIDENTIFIER, @Days INT
AS
BEGIN
    SET NOCOUNT ON;
    IF @Days < 1 SET @Days = 1;
    IF @Days > 365 SET @Days = 365;
    MERGE dbo.sahyog_TenantLocation AS t
    USING (SELECT @TenantId AS TenantId) AS s ON t.TenantId = s.TenantId
    WHEN MATCHED THEN UPDATE SET RetentionDays = @Days, UpdatedUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (TenantId, Enabled, RetentionDays) VALUES (@TenantId, 0, @Days);
    SELECT @Days AS RetentionDays;
END
GO

/* ---------- yes / no, with a record of when and which notice ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_UserSetSharing2
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Sharing BIT, @NoticeVersion VARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId) RETURN;
    MERGE dbo.sahyog_UserLocations AS t
    USING (SELECT @UserId AS UserId) AS s ON t.UserId = s.UserId
    WHEN MATCHED THEN UPDATE SET Sharing = @Sharing, DecidedUtc = SYSUTCDATETIME(), NoticeVersion = @NoticeVersion
    WHEN NOT MATCHED THEN INSERT (UserId, TenantId, Sharing, DecidedUtc, NoticeVersion)
                          VALUES (@UserId, @TenantId, @Sharing, SYSUTCDATETIME(), @NoticeVersion);
    IF @Sharing = 0      -- no: erase what was stored (the yes / no record itself is kept)
        UPDATE dbo.sahyog_UserLocations
        SET InOffice = NULL, Ip = NULL, Lat = NULL, Lng = NULL, AccuracyM = NULL, Address = NULL, Area = NULL,
            City = NULL, Region = NULL, Country = NULL, PreciseUtc = NULL, SeenUtc = NULL
        WHERE UserId = @UserId;
END
GO

/* ---------- automatic deletion ----------
   @TenantId NULL = every client. A location not refreshed within the client's RetentionDays is erased;
   a map position (and its address) older than that is erased even when office / remote was refreshed. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_Purge @TenantId UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @now DATETIME2(3) = SYSUTCDATETIME(), @all INT = 0, @maps INT = 0;

    UPDATE l
    SET InOffice = NULL, Ip = NULL, Lat = NULL, Lng = NULL, AccuracyM = NULL, Address = NULL, Area = NULL,
        City = NULL, Region = NULL, Country = NULL, PreciseUtc = NULL, SeenUtc = NULL
    FROM dbo.sahyog_UserLocations l
    LEFT JOIN dbo.sahyog_TenantLocation t ON t.TenantId = l.TenantId
    WHERE (@TenantId IS NULL OR l.TenantId = @TenantId)
      AND l.SeenUtc IS NOT NULL
      AND l.SeenUtc < DATEADD(DAY, -COALESCE(t.RetentionDays, 30), @now);
    SET @all = @@ROWCOUNT;

    UPDATE l
    SET Lat = NULL, Lng = NULL, AccuracyM = NULL, Address = NULL, Area = NULL,
        City = NULL, Region = NULL, Country = NULL, PreciseUtc = NULL
    FROM dbo.sahyog_UserLocations l
    LEFT JOIN dbo.sahyog_TenantLocation t ON t.TenantId = l.TenantId
    WHERE (@TenantId IS NULL OR l.TenantId = @TenantId)
      AND l.PreciseUtc IS NOT NULL
      AND l.PreciseUtc < DATEADD(DAY, -COALESCE(t.RetentionDays, 30), @now);
    SET @maps = @@ROWCOUNT;

    SELECT @all AS Erased, @maps AS MapsErased;
END
GO

/* ---------- "What's stored about me" ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_Mine @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.Sharing, l.InOffice, l.Ip, l.Lat, l.Lng, l.AccuracyM, l.Address, l.Area, l.City, l.Region, l.Country,
           l.PreciseUtc, l.SeenUtc, l.DecidedUtc, l.NoticeVersion,
           COALESCE(t.RetentionDays, 30) AS RetentionDays
    FROM dbo.sahyog_UserLocations l
    LEFT JOIN dbo.sahyog_TenantLocation t ON t.TenantId = l.TenantId
    WHERE l.UserId = @UserId AND l.TenantId = @TenantId;
END
GO

PRINT N'44_LocationPrivacy.sql applied.';
GO
