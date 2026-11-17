/* =====================================================================
   ShankhNaad round 29 (safe to run more than once; needs 01–02):
     Profile photos, stored in the database. The browser shrinks every photo to a small
     square (192 × 192 JPEG, usually 10–25 KB) before uploading; the server accepts up to 200 KB.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_UserPhotos', N'U') IS NULL
CREATE TABLE dbo.sahyog_UserPhotos
(
    UserId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_UserPhotos PRIMARY KEY
                CONSTRAINT FK_sahyog_UserPhotos_Users REFERENCES dbo.sahyog_Users(UserId) ON DELETE CASCADE,
    TenantId    UNIQUEIDENTIFIER NOT NULL,
    Photo       VARBINARY(MAX)  NOT NULL,
    ContentType NVARCHAR(40)    NOT NULL,
    UpdatedUtc  DATETIME2(3)    NOT NULL CONSTRAINT DF_sahyog_UserPhotos_Updated DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_UserPhotos_Tenant')
    CREATE INDEX IX_sahyog_UserPhotos_Tenant ON dbo.sahyog_UserPhotos(TenantId) INCLUDE (UpdatedUtc);
GO

/* Saves (or replaces) a person's photo. @Result: 0 saved, 1 that person isn't in this workspace. */
CREATE OR ALTER PROCEDURE dbo.sahyog_UserPhoto_Set
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Photo VARBINARY(MAX), @ContentType NVARCHAR(40),
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId)
    BEGIN SET @Result = 1; RETURN; END

    MERGE dbo.sahyog_UserPhotos WITH (HOLDLOCK) AS t
    USING (SELECT @UserId AS UserId) AS s ON t.UserId = s.UserId
    WHEN MATCHED THEN UPDATE SET Photo = @Photo, ContentType = @ContentType, UpdatedUtc = SYSUTCDATETIME(), TenantId = @TenantId
    WHEN NOT MATCHED THEN INSERT (UserId, TenantId, Photo, ContentType) VALUES (@UserId, @TenantId, @Photo, @ContentType);
    SET @Result = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_UserPhoto_Get
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Photo, ContentType, UpdatedUtc FROM dbo.sahyog_UserPhotos WHERE UserId = @UserId AND TenantId = @TenantId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_UserPhoto_Delete
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_UserPhotos WHERE UserId = @UserId AND TenantId = @TenantId;
END
GO

/* Who in the workspace has a photo, and when it last changed (the page uses it to show photos on avatars). */
CREATE OR ALTER PROCEDURE dbo.sahyog_UserPhoto_List
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UserId, UpdatedUtc FROM dbo.sahyog_UserPhotos WHERE TenantId = @TenantId;
END
GO
