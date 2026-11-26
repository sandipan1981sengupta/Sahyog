/* =====================================================================
   ShankhNaad round 50 (safe to run more than once; needs 01–02):
     Smart scheduling: the workspace's holidays (suggested meeting times skip them).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Holidays', N'U') IS NULL
CREATE TABLE dbo.sahyog_Holidays
(
    HolidayId  INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Holidays PRIMARY KEY,
    TenantId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Holidays_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Day        DATE             NOT NULL,
    Name       NVARCHAR(100)    NOT NULL,
    CONSTRAINT UX_sahyog_Holidays_Day UNIQUE (TenantId, Day)
);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Holiday_List
    @TenantId UNIQUEIDENTIFIER, @From DATE = NULL, @To DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT HolidayId, Day, Name FROM dbo.sahyog_Holidays
    WHERE TenantId = @TenantId AND (@From IS NULL OR Day >= @From) AND (@To IS NULL OR Day <= @To)
    ORDER BY Day;
END
GO

/* add, or rename the holiday on that day */
CREATE OR ALTER PROCEDURE dbo.sahyog_Holiday_Save
    @TenantId UNIQUEIDENTIFIER, @Day DATE, @Name NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Holidays WHERE TenantId = @TenantId AND Day = @Day)
        UPDATE dbo.sahyog_Holidays SET Name = @Name WHERE TenantId = @TenantId AND Day = @Day;
    ELSE
        INSERT dbo.sahyog_Holidays (TenantId, Day, Name) VALUES (@TenantId, @Day, @Name);
    SELECT HolidayId, Day, Name FROM dbo.sahyog_Holidays WHERE TenantId = @TenantId AND Day = @Day;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Holiday_Delete
    @TenantId UNIQUEIDENTIFIER, @HolidayId INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_Holidays WHERE TenantId = @TenantId AND HolidayId = @HolidayId;
    SELECT @@ROWCOUNT AS Changed;
END
GO

PRINT N'50_Scheduling.sql: holidays ready.';
GO
