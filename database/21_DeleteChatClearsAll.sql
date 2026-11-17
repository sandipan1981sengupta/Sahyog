/* =====================================================================
   ShankhNaad round 30 (safe to run more than once; run after 17 and 19):
     "Delete chat" clears everything shown in a person's chat: the private messages are deleted
     (as before) and the older group messages between the two of you (e.g. "in Everyone") stop
     showing there. The group itself is not changed.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_ChatClears', N'U') IS NULL
CREATE TABLE dbo.sahyog_ChatClears
(
    TenantId    UNIQUEIDENTIFIER NOT NULL,
    UserA       UNIQUEIDENTIFIER NOT NULL,     -- the two people, smaller id first
    UserB       UNIQUEIDENTIFIER NOT NULL,
    ClearedUtc  DATETIME2(3)     NOT NULL,
    CONSTRAINT PK_sahyog_ChatClears PRIMARY KEY (TenantId, UserA, UserB)
);
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

    -- remember when this pair cleared their chat: older group messages between them stop showing in it
    DECLARE @OtherId UNIQUEIDENTIFIER =
        (SELECT TOP (1) UserId FROM dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId AND UserId <> @UserId);

    BEGIN TRANSACTION;
        IF @OtherId IS NOT NULL
        BEGIN
            DECLARE @A UNIQUEIDENTIFIER = CASE WHEN CAST(@UserId AS NVARCHAR(36)) < CAST(@OtherId AS NVARCHAR(36)) THEN @UserId ELSE @OtherId END;
            DECLARE @B UNIQUEIDENTIFIER = CASE WHEN CAST(@UserId AS NVARCHAR(36)) < CAST(@OtherId AS NVARCHAR(36)) THEN @OtherId ELSE @UserId END;
            MERGE dbo.sahyog_ChatClears WITH (HOLDLOCK) AS t
            USING (SELECT @A AS UserA, @B AS UserB) AS s ON t.TenantId = @TenantId AND t.UserA = s.UserA AND t.UserB = s.UserB
            WHEN MATCHED THEN UPDATE SET ClearedUtc = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (TenantId, UserA, UserB, ClearedUtc) VALUES (@TenantId, @A, @B, SYSUTCDATETIME());
        END

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

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetPersonTimeline
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER,      -- the private (direct) chat
    @UserId UNIQUEIDENTIFIER, @OtherId UNIQUEIDENTIFIER,
    @BeforeId BIGINT = NULL, @Take INT = 301
AS
BEGIN
    SET NOCOUNT ON;
    -- after "Delete chat", older group messages between these two no longer show here
    DECLARE @Cleared DATETIME2(3) = (
        SELECT ClearedUtc FROM dbo.sahyog_ChatClears
        WHERE TenantId = @TenantId
          AND ((UserA = @UserId AND UserB = @OtherId) OR (UserA = @OtherId AND UserB = @UserId)));

    SELECT TOP (@Take) v.*,
           CASE WHEN v.ChannelId = @ChannelId THEN NULL ELSE c.Name END AS FromGroup
    FROM dbo.sahyog_vMessages v
    JOIN dbo.sahyog_Channels c ON c.ChannelId = v.ChannelId AND c.TenantId = @TenantId
    WHERE v.TenantId = @TenantId
      AND (@BeforeId IS NULL OR v.MessageId < @BeforeId)
      AND (
            v.ChannelId = @ChannelId
         OR (c.IsDirect = 0
             AND v.SenderId IN (@UserId, @OtherId)
             AND (@Cleared IS NULL OR v.SentUtc > @Cleared)
             AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers a WHERE a.ChannelId = c.ChannelId AND a.UserId = @UserId)
             AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers b WHERE b.ChannelId = c.ChannelId AND b.UserId = @OtherId))
          )
    ORDER BY v.MessageId DESC;
END
GO
