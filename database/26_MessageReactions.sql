/* =====================================================================
   ShankhNaad round 35 (safe to run more than once; needs 01–02):
     Reactions on chat messages (👍 ❤️ 😂 😮 😢 🙏 …), like Microsoft Teams.
     One row per person per emoji per message; pressing it again takes it back.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_MessageReactions', N'U') IS NULL
CREATE TABLE dbo.sahyog_MessageReactions
(
    MessageId   BIGINT           NOT NULL CONSTRAINT FK_sahyog_MessageReactions_Messages REFERENCES dbo.sahyog_Messages(MessageId) ON DELETE CASCADE,
    UserId      UNIQUEIDENTIFIER NOT NULL,
    Emoji       NVARCHAR(16)     NOT NULL,
    TenantId    UNIQUEIDENTIFIER NOT NULL,
    ReactedUtc  DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_MessageReactions_Utc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sahyog_MessageReactions PRIMARY KEY (MessageId, UserId, Emoji)
);
GO

/* Adds my reaction, or takes it back if I already gave that one. Only people in the message's chat may react.
   @Result: 0 done, 1 not allowed / no such message. Returns the message's chat and all its reactions. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_ToggleReaction
    @TenantId UNIQUEIDENTIFIER, @MessageId BIGINT, @UserId UNIQUEIDENTIFIER, @Emoji NVARCHAR(16),
    @ChannelId UNIQUEIDENTIFIER OUTPUT, @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT @ChannelId = m.ChannelId
    FROM dbo.sahyog_Messages m
    JOIN dbo.sahyog_ChannelMembers cm ON cm.ChannelId = m.ChannelId AND cm.UserId = @UserId
    WHERE m.MessageId = @MessageId AND m.TenantId = @TenantId;
    IF @ChannelId IS NULL BEGIN SET @Result = 1; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.sahyog_MessageReactions WHERE MessageId = @MessageId AND UserId = @UserId AND Emoji = @Emoji)
        DELETE dbo.sahyog_MessageReactions WHERE MessageId = @MessageId AND UserId = @UserId AND Emoji = @Emoji;
    ELSE
        INSERT dbo.sahyog_MessageReactions (MessageId, UserId, Emoji, TenantId) VALUES (@MessageId, @UserId, @Emoji, @TenantId);

    SET @Result = 0;
    SELECT r.MessageId, r.Emoji, r.UserId, u.DisplayName
    FROM dbo.sahyog_MessageReactions r JOIN dbo.sahyog_Users u ON u.UserId = r.UserId
    WHERE r.MessageId = @MessageId
    ORDER BY r.ReactedUtc;
END
GO

/* Reactions on a set of messages (@Ids: comma-separated message ids) in chats this person is in. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetReactions
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Ids NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT r.MessageId, r.Emoji, r.UserId, u.DisplayName
    FROM dbo.sahyog_MessageReactions r
    JOIN dbo.sahyog_Messages m ON m.MessageId = r.MessageId AND m.TenantId = @TenantId
    JOIN dbo.sahyog_ChannelMembers cm ON cm.ChannelId = m.ChannelId AND cm.UserId = @UserId
    JOIN dbo.sahyog_Users u ON u.UserId = r.UserId
    WHERE r.MessageId IN (SELECT TRY_CAST(LTRIM(RTRIM(value)) AS BIGINT) FROM STRING_SPLIT(@Ids, N','))
    ORDER BY r.MessageId, r.ReactedUtc;
END
GO
