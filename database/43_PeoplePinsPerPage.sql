/* =====================================================================
   43_PeoplePinsPerPage.sql  —  pins on the Calls page and the Files page are separate
   (pinning someone in Calls no longer pins them in Files, and the other way round).
   Pins made before this keep showing on both pages. Safe to run more than once.
   ===================================================================== */
SET NOCOUNT ON;
GO

IF COL_LENGTH(N'dbo.sahyog_PeoplePins', N'Scope') IS NULL
BEGIN
    ALTER TABLE dbo.sahyog_PeoplePins ADD Scope VARCHAR(10) NOT NULL CONSTRAINT DF_sahyog_PeoplePins_Scope DEFAULT ('calls');
END
GO
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'PK_sahyog_PeoplePins'
           AND NOT EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                           WHERE ic.object_id = OBJECT_ID(N'dbo.sahyog_PeoplePins') AND ic.index_id = sys.key_constraints.unique_index_id AND c.name = N'Scope'))
BEGIN
    ALTER TABLE dbo.sahyog_PeoplePins DROP CONSTRAINT PK_sahyog_PeoplePins;
    ALTER TABLE dbo.sahyog_PeoplePins ADD CONSTRAINT PK_sahyog_PeoplePins PRIMARY KEY (UserId, Scope, PinnedUserId);
    -- pins made before were shared by both pages: keep them on the Files page too
    INSERT dbo.sahyog_PeoplePins (UserId, PinnedUserId, PinnedUtc, Scope)
    SELECT p.UserId, p.PinnedUserId, p.PinnedUtc, 'files' FROM dbo.sahyog_PeoplePins p
    WHERE p.Scope = 'calls'
      AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_PeoplePins f WHERE f.UserId = p.UserId AND f.PinnedUserId = p.PinnedUserId AND f.Scope = 'files');
END
GO

/* The people you pinned on one page ('calls' or 'files'), oldest pin first. */
CREATE OR ALTER PROCEDURE dbo.sahyog_PeoplePins_List
    @UserId UNIQUEIDENTIFIER,
    @Scope  VARCHAR(10) = 'calls'
AS
BEGIN
    SET NOCOUNT ON;
    SELECT PinnedUserId FROM dbo.sahyog_PeoplePins WHERE UserId = @UserId AND Scope = @Scope ORDER BY PinnedUtc;
END
GO

/* Pin (@Pinned = 1) or unpin someone on one page. Result: 0 done, 1 that person isn't in your workspace. */
CREATE OR ALTER PROCEDURE dbo.sahyog_PeoplePins_Set
    @TenantId     UNIQUEIDENTIFIER,
    @UserId       UNIQUEIDENTIFIER,
    @PinnedUserId UNIQUEIDENTIFIER,
    @Pinned       BIT,
    @Scope        VARCHAR(10) = 'calls',
    @Result       INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF @Scope NOT IN ('calls', 'files') SET @Scope = 'calls';
    IF @Pinned = 0
    BEGIN
        DELETE dbo.sahyog_PeoplePins WHERE UserId = @UserId AND PinnedUserId = @PinnedUserId AND Scope = @Scope;
        SET @Result = 0; RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @PinnedUserId AND TenantId = @TenantId)
       OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId)
        BEGIN SET @Result = 1; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_PeoplePins WHERE UserId = @UserId AND PinnedUserId = @PinnedUserId AND Scope = @Scope)
        INSERT dbo.sahyog_PeoplePins (UserId, PinnedUserId, Scope) VALUES (@UserId, @PinnedUserId, @Scope);
    SET @Result = 0;
END
GO
