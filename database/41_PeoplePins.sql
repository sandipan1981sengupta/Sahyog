/* =====================================================================
   41_PeoplePins.sql  —  Calls page: pin people to the top of your Team panel
   Pins belong to the person who set them, so they follow you to every device.
   Safe to run more than once.
   ===================================================================== */
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.sahyog_PeoplePins', N'U') IS NULL
CREATE TABLE dbo.sahyog_PeoplePins
(
    UserId          UNIQUEIDENTIFIER NOT NULL,
    PinnedUserId    UNIQUEIDENTIFIER NOT NULL,
    PinnedUtc       DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_PeoplePins_Utc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sahyog_PeoplePins PRIMARY KEY (UserId, PinnedUserId)
);
GO

/* The people you pinned (oldest pin first). */
CREATE OR ALTER PROCEDURE dbo.sahyog_PeoplePins_List
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT PinnedUserId FROM dbo.sahyog_PeoplePins WHERE UserId = @UserId ORDER BY PinnedUtc;
END
GO

/* Pin (@Pinned = 1) or unpin someone. Result: 0 done, 1 that person isn't in your workspace. */
CREATE OR ALTER PROCEDURE dbo.sahyog_PeoplePins_Set
    @TenantId     UNIQUEIDENTIFIER,
    @UserId       UNIQUEIDENTIFIER,
    @PinnedUserId UNIQUEIDENTIFIER,
    @Pinned       BIT,
    @Result       INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF @Pinned = 0
    BEGIN
        DELETE dbo.sahyog_PeoplePins WHERE UserId = @UserId AND PinnedUserId = @PinnedUserId;
        SET @Result = 0; RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @PinnedUserId AND TenantId = @TenantId)
       OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId)
        BEGIN SET @Result = 1; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_PeoplePins WHERE UserId = @UserId AND PinnedUserId = @PinnedUserId)
        INSERT dbo.sahyog_PeoplePins (UserId, PinnedUserId) VALUES (@UserId, @PinnedUserId);
    SET @Result = 0;
END
GO
