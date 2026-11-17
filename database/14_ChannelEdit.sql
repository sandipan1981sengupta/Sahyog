/* =====================================================================
   ShankhNaad round 23 (safe to run more than once; needs 01–04):
     Rename / describe / delete group channels from Chat → Details → Edit channel.
       - Workspace admins can rename and delete any channel of their workspace.
       - The person who created a channel can rename it (not delete it).
       - The workspace's first channel (#general, the one everybody is in) can be renamed but never deleted.
     sahyog_Chat_GetChannel now also returns CreatedBy and IsMain (the app works without them until this runs).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetChannel
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @MainId UNIQUEIDENTIFIER =
        (SELECT TOP (1) ChannelId FROM dbo.sahyog_Channels
         WHERE TenantId = @TenantId AND IsDirect = 0 ORDER BY CreatedUtc, ChannelId);
    SELECT ChannelId, Name, Description, IsDirect, CreatedBy,
           CAST(CASE WHEN ChannelId = @MainId THEN 1 ELSE 0 END AS BIT) AS IsMain
    FROM dbo.sahyog_Channels
    WHERE TenantId = @TenantId AND ChannelId = @ChannelId;
END
GO

/* @Result: 0 saved, 1 not found (or a direct chat), 2 not allowed, 3 name already used */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_UpdateChannel
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT,
    @Name NVARCHAR(80), @Description NVARCHAR(300) = NULL,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @CreatedBy UNIQUEIDENTIFIER, @Found BIT = 0;
    SELECT @Found = 1, @CreatedBy = CreatedBy
    FROM dbo.sahyog_Channels WITH (UPDLOCK, HOLDLOCK)
    WHERE ChannelId = @ChannelId AND TenantId = @TenantId AND IsDirect = 0;

    IF @Found = 0 BEGIN SET @Result = 1; RETURN; END
    IF @IsAdmin = 0 AND (@CreatedBy IS NULL OR @CreatedBy <> @UserId) BEGIN SET @Result = 2; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Channels
               WHERE TenantId = @TenantId AND IsDirect = 0 AND Name = @Name AND ChannelId <> @ChannelId)
    BEGIN SET @Result = 3; RETURN; END

    UPDATE dbo.sahyog_Channels
    SET Name = @Name, Description = NULLIF(LTRIM(RTRIM(@Description)), N'')
    WHERE ChannelId = @ChannelId AND TenantId = @TenantId;

    SET @Result = 0;
END
GO

/* Deletes a group channel with its messages and files (admins only; the app checks the role).
   Meetings that were started from it are kept (they just no longer point at a channel).
   Returns one row per deleted file (StoragePath) so the app can remove them from disk.
   @Result: 0 deleted, 1 not found (or a direct chat), 4 it's the workspace's main channel (#general) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_DeleteChannel
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Channels WHERE ChannelId = @ChannelId AND TenantId = @TenantId AND IsDirect = 0)
    BEGIN SET @Result = 1; RETURN; END

    DECLARE @MainId UNIQUEIDENTIFIER =
        (SELECT TOP (1) ChannelId FROM dbo.sahyog_Channels
         WHERE TenantId = @TenantId AND IsDirect = 0 ORDER BY CreatedUtc, ChannelId);
    IF @ChannelId = @MainId BEGIN SET @Result = 4; RETURN; END

    DECLARE @Files TABLE (StoragePath NVARCHAR(400) NOT NULL, SizeBytes BIGINT NOT NULL);
    INSERT @Files (StoragePath, SizeBytes)
    SELECT StoragePath, SizeBytes FROM dbo.sahyog_Attachments WHERE ChannelId = @ChannelId AND TenantId = @TenantId;

    BEGIN TRANSACTION;
        UPDATE dbo.sahyog_Meetings SET ChannelId = NULL WHERE ChannelId = @ChannelId;
        DELETE dbo.sahyog_Messages       WHERE ChannelId = @ChannelId AND TenantId = @TenantId;
        DELETE dbo.sahyog_Attachments    WHERE ChannelId = @ChannelId AND TenantId = @TenantId;
        DELETE dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId;
        DELETE dbo.sahyog_Channels       WHERE ChannelId = @ChannelId AND TenantId = @TenantId;

        UPDATE dbo.sahyog_Tenants
        SET StorageUsedBytes = CASE WHEN StorageUsedBytes - x.Total < 0 THEN 0 ELSE StorageUsedBytes - x.Total END
        FROM (SELECT COALESCE(SUM(SizeBytes), 0) AS Total FROM @Files) x
        WHERE TenantId = @TenantId;
    COMMIT;

    SET @Result = 0;
    SELECT StoragePath FROM @Files;
END
GO
