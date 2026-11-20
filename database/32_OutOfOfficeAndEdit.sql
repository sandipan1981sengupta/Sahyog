/* =====================================================================
   ShankhNaad round 41 (safe to run more than once; needs 01–29):
     1. Out of office: a purple status with a note and an optional "back on" date. Kept in the database,
        so everyone sees it even while that person is offline. It ends by itself after the date.
     2. Edit a message: only your own text messages; the chat shows "Edited".
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------- 1. out of office ---------- */
IF OBJECT_ID(N'dbo.sahyog_OutOfOffice', N'U') IS NULL
CREATE TABLE dbo.sahyog_OutOfOffice
(
    UserId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_OutOfOffice PRIMARY KEY
                CONSTRAINT FK_sahyog_OutOfOffice_Users REFERENCES dbo.sahyog_Users(UserId) ON DELETE CASCADE,
    TenantId    UNIQUEIDENTIFIER NOT NULL,
    Message     NVARCHAR(500)    NULL,
    UntilUtc    DATETIME2(3)     NULL,       -- NULL = until turned off
    SinceUtc    DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_OutOfOffice_Since DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_OutOfOffice_Tenant')
    CREATE INDEX IX_sahyog_OutOfOffice_Tenant ON dbo.sahyog_OutOfOffice(TenantId);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Ooo_Set
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Message NVARCHAR(500), @UntilUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId) RETURN;
    MERGE dbo.sahyog_OutOfOffice AS t
    USING (SELECT @UserId AS UserId) AS s ON t.UserId = s.UserId
    WHEN MATCHED THEN UPDATE SET Message = NULLIF(@Message, N''), UntilUtc = @UntilUtc
    WHEN NOT MATCHED THEN INSERT (UserId, TenantId, Message, UntilUtc) VALUES (@UserId, @TenantId, NULLIF(@Message, N''), @UntilUtc);
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Ooo_Clear @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_OutOfOffice WHERE UserId = @UserId AND TenantId = @TenantId;
END
GO

/* everyone in the workspace who is out of office right now (ended ones are tidied away) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Ooo_List @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_OutOfOffice WHERE TenantId = @TenantId AND UntilUtc IS NOT NULL AND UntilUtc <= SYSUTCDATETIME();
    SELECT o.UserId, o.Message, o.UntilUtc, o.SinceUtc
    FROM dbo.sahyog_OutOfOffice o
    JOIN dbo.sahyog_Users u ON u.UserId = o.UserId AND u.TenantId = @TenantId AND u.IsActive = 1
    WHERE o.TenantId = @TenantId;
END
GO

/* ---------- 2. edit a message ---------- */
IF COL_LENGTH(N'dbo.sahyog_Messages', N'EditedUtc') IS NULL
    ALTER TABLE dbo.sahyog_Messages ADD EditedUtc DATETIME2(3) NULL;
GO

/* the message shape (as in 29_GroupMembers.sql), now with EditedUtc */
CREATE OR ALTER VIEW dbo.sahyog_vMessages
AS
SELECT m.MessageId, m.TenantId, m.ChannelId, m.SenderId, u.DisplayName AS SenderName, u.AvatarTone AS SenderTone,
       m.Body, m.SentUtc, a.AttachmentId, a.FileName, a.ContentType, a.SizeBytes,
       m.ReplyToId,
       ru.DisplayName       AS ReplyToSenderName,
       LEFT(r.Body, 200)    AS ReplyToBody,
       ra.FileName          AS ReplyToFileName,
       m.CopiedFromId,
       m.EditedUtc
FROM dbo.sahyog_Messages m
JOIN dbo.sahyog_Users u ON u.UserId = m.SenderId
LEFT JOIN dbo.sahyog_Attachments a ON a.AttachmentId = m.AttachmentId
LEFT JOIN dbo.sahyog_Messages r ON r.MessageId = m.ReplyToId AND r.TenantId = m.TenantId
LEFT JOIN dbo.sahyog_Users ru ON ru.UserId = r.SenderId
LEFT JOIN dbo.sahyog_Attachments ra ON ra.AttachmentId = r.AttachmentId;
GO

/* Only the person who wrote it, still in that chat; not call cards; text only.
   @Result: 0 done, 1 not found, 2 not yours / not in the chat, 3 can't be edited (call card or empty). Returns the message. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_EditMessage
    @TenantId UNIQUEIDENTIFIER, @MessageId BIGINT, @UserId UNIQUEIDENTIFIER, @Body NVARCHAR(4000), @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @SenderId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @Old NVARCHAR(4000), @HasFile BIT;
    SELECT @SenderId = SenderId, @ChannelId = ChannelId, @Old = Body, @HasFile = CASE WHEN AttachmentId IS NULL THEN 0 ELSE 1 END
    FROM dbo.sahyog_Messages WHERE MessageId = @MessageId AND TenantId = @TenantId;

    IF @SenderId IS NULL BEGIN SET @Result = 1; RETURN; END
    IF @SenderId <> @UserId BEGIN SET @Result = 2; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId AND UserId = @UserId) BEGIN SET @Result = 2; RETURN; END
    IF @Old LIKE N'[[][[]call:%' OR (LEN(LTRIM(RTRIM(@Body))) = 0 AND @HasFile = 0) BEGIN SET @Result = 3; RETURN; END

    UPDATE dbo.sahyog_Messages SET Body = @Body, EditedUtc = SYSUTCDATETIME()
    WHERE MessageId = @MessageId AND TenantId = @TenantId;
    SET @Result = 0;
    SELECT * FROM dbo.sahyog_vMessages WHERE MessageId = @MessageId;
END
GO

PRINT N'32_OutOfOfficeAndEdit.sql applied.';
GO
