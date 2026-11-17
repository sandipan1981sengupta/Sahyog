/* =====================================================================
   ShankhNaad round 26 (safe to run more than once; needs 04):
     Fix: deleting a one-to-one chat failed with "FK_sahyog_Meetings_Channels"
     when a call had been started from that chat. The call (meeting) is kept and
     simply no longer points at the deleted chat.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_DeleteDirect
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @Result = 0;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.sahyog_Channels c
        JOIN dbo.sahyog_ChannelMembers m ON m.ChannelId = c.ChannelId AND m.UserId = @UserId
        WHERE c.ChannelId = @ChannelId AND c.TenantId = @TenantId AND c.IsDirect = 1)
        RETURN;

    DECLARE @Files TABLE (StoragePath NVARCHAR(400) NOT NULL, SizeBytes BIGINT NOT NULL);
    INSERT @Files (StoragePath, SizeBytes)
    SELECT StoragePath, SizeBytes FROM dbo.sahyog_Attachments WHERE ChannelId = @ChannelId AND TenantId = @TenantId;

    BEGIN TRANSACTION;
        -- calls started from this chat stay in Meetings; they just no longer point at the deleted chat
        UPDATE dbo.sahyog_Meetings SET ChannelId = NULL WHERE ChannelId = @ChannelId;
        DELETE dbo.sahyog_Messages       WHERE ChannelId = @ChannelId AND TenantId = @TenantId;
        DELETE dbo.sahyog_Attachments    WHERE ChannelId = @ChannelId AND TenantId = @TenantId;
        DELETE dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId;
        DELETE dbo.sahyog_Channels       WHERE ChannelId = @ChannelId AND TenantId = @TenantId;

        -- give the storage back to the workspace
        UPDATE dbo.sahyog_Tenants
        SET StorageUsedBytes = CASE WHEN StorageUsedBytes - x.Total < 0 THEN 0 ELSE StorageUsedBytes - x.Total END
        FROM (SELECT COALESCE(SUM(SizeBytes), 0) AS Total FROM @Files) x
        WHERE TenantId = @TenantId;
    COMMIT;

    SET @Result = 1;
    SELECT StoragePath FROM @Files;
END
GO
