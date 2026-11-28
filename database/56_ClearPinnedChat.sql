/* =====================================================================
   ShankhNaad round 56 (safe to run more than once; needs 21_DeleteChatClearsAll.sql):
     "Delete chat" on a PINNED one-to-one chat clears it instead of deleting it.
     All messages and files go, for both people (exactly like a delete), but the chat itself stays: so it keeps its
     pin and its place in the list, and does not disappear and come back. Unpinned chats are still deleted as before.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_ClearDirect
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @Result = 0;

    -- only a one-to-one chat you are in
    IF NOT EXISTS (
        SELECT 1 FROM dbo.sahyog_Channels c
        JOIN dbo.sahyog_ChannelMembers m ON m.ChannelId = c.ChannelId AND m.UserId = @UserId
        WHERE c.ChannelId = @ChannelId AND c.TenantId = @TenantId AND c.IsDirect = 1)
        RETURN;

    DECLARE @OtherId UNIQUEIDENTIFIER =
        (SELECT TOP (1) UserId FROM dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId AND UserId <> @UserId);
    DECLARE @Files TABLE (StoragePath NVARCHAR(400) NOT NULL, SizeBytes BIGINT NOT NULL);

    BEGIN TRANSACTION;
        -- files another chat still shows move there and stay (as in sahyog_Chat_DeleteDirect)
        UPDATE a SET ChannelId = x.OtherChannel
        FROM dbo.sahyog_Attachments a
        CROSS APPLY (SELECT TOP (1) m.ChannelId AS OtherChannel FROM dbo.sahyog_Messages m
                     WHERE m.AttachmentId = a.AttachmentId AND m.ChannelId <> @ChannelId) x
        WHERE a.ChannelId = @ChannelId AND a.TenantId = @TenantId;

        INSERT @Files (StoragePath, SizeBytes)
        SELECT StoragePath, SizeBytes FROM dbo.sahyog_Attachments WHERE ChannelId = @ChannelId AND TenantId = @TenantId;

        -- the call history between the two is cleared too (as in sahyog_Chat_DeleteDirect)
        IF @OtherId IS NOT NULL
        BEGIN
            DECLARE @A UNIQUEIDENTIFIER = CASE WHEN CAST(@UserId AS NVARCHAR(36)) < CAST(@OtherId AS NVARCHAR(36)) THEN @UserId ELSE @OtherId END;
            DECLARE @B UNIQUEIDENTIFIER = CASE WHEN CAST(@UserId AS NVARCHAR(36)) < CAST(@OtherId AS NVARCHAR(36)) THEN @OtherId ELSE @UserId END;
            MERGE dbo.sahyog_ChatClears WITH (HOLDLOCK) AS t
            USING (SELECT @A AS UserA, @B AS UserB) AS s ON t.TenantId = @TenantId AND t.UserA = s.UserA AND t.UserB = s.UserB
            WHEN MATCHED THEN UPDATE SET ClearedUtc = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (TenantId, UserA, UserB, ClearedUtc) VALUES (@TenantId, @A, @B, SYSUTCDATETIME());
        END

        UPDATE dbo.sahyog_Meetings SET ChannelId = NULL WHERE ChannelId = @ChannelId;
        DELETE dbo.sahyog_Messages    WHERE ChannelId = @ChannelId AND TenantId = @TenantId;
        DELETE dbo.sahyog_Attachments WHERE ChannelId = @ChannelId AND TenantId = @TenantId;
        -- the chat and its members stay (pin, pinned time, place in the list); nothing is unread any more
        UPDATE dbo.sahyog_ChannelMembers SET UnreadCount = 0 WHERE ChannelId = @ChannelId;

        UPDATE dbo.sahyog_Tenants
        SET StorageUsedBytes = CASE WHEN StorageUsedBytes - x.Total < 0 THEN 0 ELSE StorageUsedBytes - x.Total END
        FROM (SELECT COALESCE(SUM(SizeBytes), 0) AS Total FROM @Files) x
        WHERE TenantId = @TenantId;
    COMMIT;

    SET @Result = 1;
    SELECT StoragePath FROM @Files;
END
GO

PRINT N'56_ClearPinnedChat.sql: deleting a pinned chat now clears it and keeps the pin and its place.';
GO
