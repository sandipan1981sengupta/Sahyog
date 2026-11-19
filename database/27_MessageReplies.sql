/* =====================================================================
   ShankhNaad round 36 (safe to run more than once; needs 01–02):
     Reply to a particular message. The new message keeps the id of the one
     it answers (ReplyToId) and shows a small quote of it above the text.
     If the original is deleted later, the reply stays and says so.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_Messages', N'ReplyToId') IS NULL
    ALTER TABLE dbo.sahyog_Messages ADD ReplyToId BIGINT NULL;
GO

/* Same message shape as before, plus the message it replies to (sender, start of the text, file name). */
CREATE OR ALTER VIEW dbo.sahyog_vMessages
AS
SELECT m.MessageId, m.TenantId, m.ChannelId, m.SenderId, u.DisplayName AS SenderName, u.AvatarTone AS SenderTone,
       m.Body, m.SentUtc, a.AttachmentId, a.FileName, a.ContentType, a.SizeBytes,
       m.ReplyToId,
       ru.DisplayName       AS ReplyToSenderName,
       LEFT(r.Body, 200)    AS ReplyToBody,
       ra.FileName          AS ReplyToFileName
FROM dbo.sahyog_Messages m
JOIN dbo.sahyog_Users u ON u.UserId = m.SenderId
LEFT JOIN dbo.sahyog_Attachments a ON a.AttachmentId = m.AttachmentId
LEFT JOIN dbo.sahyog_Messages r ON r.MessageId = m.ReplyToId AND r.TenantId = m.TenantId
LEFT JOIN dbo.sahyog_Users ru ON ru.UserId = r.SenderId
LEFT JOIN dbo.sahyog_Attachments ra ON ra.AttachmentId = r.AttachmentId;
GO

/* Saves a text message (optionally as a reply), bumps the channel and everyone else's unread count,
   returns the saved message. A reply is kept only if the sender can see the original message.
   @Result: 0 ok, 1 not a member. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_SendMessage
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @SenderId UNIQUEIDENTIFIER, @Body NVARCHAR(4000),
    @Result INT OUTPUT,
    @ReplyToId BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers WHERE TenantId = @TenantId AND ChannelId = @ChannelId AND UserId = @SenderId)
    BEGIN SET @Result = 1; RETURN; END

    IF @ReplyToId IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM dbo.sahyog_Messages r
        JOIN dbo.sahyog_ChannelMembers cm ON cm.ChannelId = r.ChannelId AND cm.UserId = @SenderId
        WHERE r.MessageId = @ReplyToId AND r.TenantId = @TenantId)
        SET @ReplyToId = NULL;

    DECLARE @Id BIGINT;
    BEGIN TRANSACTION;
        INSERT dbo.sahyog_Messages (TenantId, ChannelId, SenderId, Body, ReplyToId) VALUES (@TenantId, @ChannelId, @SenderId, @Body, @ReplyToId);
        SET @Id = SCOPE_IDENTITY();
        UPDATE dbo.sahyog_Channels SET LastMessageUtc = SYSUTCDATETIME() WHERE ChannelId = @ChannelId AND TenantId = @TenantId;
        UPDATE dbo.sahyog_ChannelMembers SET UnreadCount = UnreadCount + 1
        WHERE TenantId = @TenantId AND ChannelId = @ChannelId AND UserId <> @SenderId;
    COMMIT;

    SET @Result = 0;
    SELECT * FROM dbo.sahyog_vMessages WHERE MessageId = @Id;
END
GO
