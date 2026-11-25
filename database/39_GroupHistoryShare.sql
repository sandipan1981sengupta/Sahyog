/* =====================================================================
   ShankhNaad round 39 (safe to run more than once; needs 01–38):
   Choose what people added to a group can see, and whether files come with it.

     1. Adding people to a group that already exists now asks how much of the group's history they see:
        Don't share / Last day / Last 7 days / All history, and whether files sent before they joined are included.
        Each member keeps their own "sees from" time (HistoryFromUtc) and "sees earlier files" switch (ShareOldFiles).
        People already in groups keep seeing everything (NULL / 1), so nothing changes for them.
     2. Making a group from a one-to-one chat ("Add people") can copy the history with or without its files.
     3. Everything that shows messages or files respects it: the group's messages (a reply never quotes a message
        the person can't see), "Files shared" in Details, the Files page, opening a file, and a person's chat that
        also lists group messages between the two of you.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_ChannelMembers', N'HistoryFromUtc') IS NULL
    ALTER TABLE dbo.sahyog_ChannelMembers ADD HistoryFromUtc DATETIME2(3) NULL;   -- NULL = sees the whole history
GO
IF COL_LENGTH(N'dbo.sahyog_ChannelMembers', N'ShareOldFiles') IS NULL
    ALTER TABLE dbo.sahyog_ChannelMembers ADD ShareOldFiles BIT NOT NULL
        CONSTRAINT DF_sahyog_ChannelMembers_ShareOldFiles DEFAULT (1);            -- 0 = files sent before they joined are hidden
GO

/* ---------- 1. add people, choosing what they see ----------
   @HistoryFromUtc: NULL = everything; otherwise they see messages from that time on (now = nothing from before).
   @ShareFiles: 0 = files sent before they joined stay hidden from them.
   @Result: 0 done, 1 not found / one-to-one / Everyone, 2 not allowed, 3 nobody new. Returns the ids added. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_AddMembers
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT,
    @MemberIds NVARCHAR(MAX), @Result INT OUTPUT,
    @HistoryFromUtc DATETIME2(3) = NULL, @ShareFiles BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @CreatedBy UNIQUEIDENTIFIER, @Private BIT;
    SELECT @CreatedBy = CreatedBy, @Private = IsPrivate
    FROM dbo.sahyog_Channels WHERE ChannelId = @ChannelId AND TenantId = @TenantId AND IsDirect = 0;
    IF @Private IS NULL OR @Private = 0 BEGIN SET @Result = 1; RETURN; END
    IF @IsAdmin = 0 AND (@CreatedBy IS NULL OR @CreatedBy <> @UserId) BEGIN SET @Result = 2; RETURN; END

    DECLARE @New TABLE (UserId UNIQUEIDENTIFIER PRIMARY KEY);
    INSERT @New (UserId)
    SELECT DISTINCT u.UserId
    FROM STRING_SPLIT(ISNULL(@MemberIds, N''), N',') s
    JOIN dbo.sahyog_Users u ON u.UserId = TRY_CAST(LTRIM(RTRIM(s.value)) AS UNIQUEIDENTIFIER)
    WHERE u.TenantId = @TenantId AND u.IsActive = 1
      AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers cm WHERE cm.ChannelId = @ChannelId AND cm.UserId = u.UserId);
    IF NOT EXISTS (SELECT 1 FROM @New) BEGIN SET @Result = 3; RETURN; END

    -- they join with everything already read, so the group doesn't show a big unread number
    INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId, HistoryFromUtc, ShareOldFiles)
    SELECT @ChannelId, UserId, @TenantId, @HistoryFromUtc, ISNULL(@ShareFiles, 1) FROM @New;

    SET @Result = 0;
    SELECT UserId FROM @New;
END
GO

/* ---------- a group's messages for one person ----------
   Same rows as sahyog_Chat_GetMessages, without what this person can't see; a reply to a message they can't see
   shows no quote. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetMessagesFor
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER,
    @BeforeId BIGINT = NULL, @Take INT = 51
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @From DATETIME2(3), @Files BIT, @Joined DATETIME2(3);
    SELECT @From = HistoryFromUtc, @Files = ShareOldFiles, @Joined = JoinedUtc
    FROM dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId AND UserId = @UserId;
    IF @Joined IS NULL RETURN;                      -- not in this chat

    SELECT TOP (@Take)
           v.MessageId, v.TenantId, v.ChannelId, v.SenderId, v.SenderName, v.SenderTone,
           v.Body, v.SentUtc, v.AttachmentId, v.FileName, v.ContentType, v.SizeBytes,
           v.ReplyToId,
           CASE WHEN rv.Ok = 1 THEN v.ReplyToSenderName END AS ReplyToSenderName,
           CASE WHEN rv.Ok = 1 THEN v.ReplyToBody END       AS ReplyToBody,
           CASE WHEN rv.Ok = 1 THEN v.ReplyToFileName END   AS ReplyToFileName,
           v.CopiedFromId, v.EditedUtc
    FROM dbo.sahyog_vMessages v
    LEFT JOIN dbo.sahyog_Messages r ON r.MessageId = v.ReplyToId AND r.TenantId = v.TenantId
    CROSS APPLY (SELECT CASE WHEN r.MessageId IS NULL THEN 0
                             WHEN (@From IS NULL OR r.SentUtc >= @From)
                              AND (@Files = 1 OR r.AttachmentId IS NULL OR r.SentUtc >= @Joined) THEN 1
                             ELSE 0 END AS Ok) rv
    WHERE v.TenantId = @TenantId AND v.ChannelId = @ChannelId
      AND (@BeforeId IS NULL OR v.MessageId < @BeforeId)
      AND (@From IS NULL OR v.SentUtc >= @From)
      AND (@Files = 1 OR v.AttachmentId IS NULL OR v.SentUtc >= @Joined)
    ORDER BY v.MessageId DESC;
END
GO

/* ---------- 2. copy a one-to-one chat into a new group, with or without its files ----------
   As in 29_GroupMembers.sql; @ShareFiles = 0 leaves out messages that carry a file. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_CopyHistory
    @TenantId UNIQUEIDENTIFIER, @FromChannelId UNIQUEIDENTIFIER, @ToChannelId UNIQUEIDENTIFIER,
    @UserId UNIQUEIDENTIFIER, @SinceUtc DATETIME2(3) = NULL, @Result INT OUTPUT, @ShareFiles BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Channels c JOIN dbo.sahyog_ChannelMembers m ON m.ChannelId = c.ChannelId AND m.UserId = @UserId
                   WHERE c.ChannelId = @FromChannelId AND c.TenantId = @TenantId AND c.IsDirect = 1)
       OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_Channels c JOIN dbo.sahyog_ChannelMembers m ON m.ChannelId = c.ChannelId AND m.UserId = @UserId
                      WHERE c.ChannelId = @ToChannelId AND c.TenantId = @TenantId AND c.IsDirect = 0)
    BEGIN SET @Result = 1; RETURN; END

    DECLARE @Copied INT;
    BEGIN TRANSACTION;
        INSERT dbo.sahyog_Messages (TenantId, ChannelId, SenderId, Body, SentUtc, AttachmentId, CopiedFromId)
        SELECT m.TenantId, @ToChannelId, m.SenderId, m.Body, m.SentUtc, m.AttachmentId, m.MessageId
        FROM dbo.sahyog_Messages m
        WHERE m.ChannelId = @FromChannelId AND m.TenantId = @TenantId
          AND (@SinceUtc IS NULL OR m.SentUtc >= @SinceUtc)
          AND m.Body NOT LIKE N'[[][[]call:%'
          AND (ISNULL(@ShareFiles, 1) = 1 OR m.AttachmentId IS NULL)
        ORDER BY m.MessageId;
        SET @Copied = @@ROWCOUNT;

        UPDATE n SET ReplyToId = target.MessageId
        FROM dbo.sahyog_Messages n
        JOIN dbo.sahyog_Messages src ON src.MessageId = n.CopiedFromId
        JOIN dbo.sahyog_Messages target ON target.CopiedFromId = src.ReplyToId AND target.ChannelId = @ToChannelId
        WHERE n.ChannelId = @ToChannelId AND src.ReplyToId IS NOT NULL;
    COMMIT;

    SET @Result = 0;
    SELECT @Copied AS Copied;
END
GO

/* ---------- 3. files ---------- */

/* "Files shared" in Details, for one person. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetRecentFilesFor
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Take INT = 5
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@Take) a.AttachmentId, a.FileName, a.ContentType, a.SizeBytes
    FROM dbo.sahyog_Attachments a
    WHERE a.TenantId = @TenantId
      AND EXISTS (SELECT 1 FROM dbo.sahyog_Messages m
                  JOIN dbo.sahyog_ChannelMembers cm ON cm.ChannelId = m.ChannelId AND cm.UserId = @UserId
                  WHERE m.AttachmentId = a.AttachmentId AND m.ChannelId = @ChannelId
                    AND (cm.HistoryFromUtc IS NULL OR m.SentUtc >= cm.HistoryFromUtc)
                    AND (cm.ShareOldFiles = 1 OR m.SentUtc >= cm.JoinedUtc))
    ORDER BY a.UploadedUtc DESC;
END
GO

/* Opening a file: allowed if a chat you're in shows it to you. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetAttachment
    @TenantId UNIQUEIDENTIFIER, @AttachmentId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT a.AttachmentId, a.ChannelId, a.FileName, a.ContentType, a.SizeBytes, a.StoragePath
    FROM dbo.sahyog_Attachments a
    WHERE a.TenantId = @TenantId AND a.AttachmentId = @AttachmentId
      AND (EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers m
                   WHERE m.ChannelId = a.ChannelId AND m.UserId = @UserId AND m.TenantId = @TenantId
                     AND m.HistoryFromUtc IS NULL AND m.ShareOldFiles = 1)
        OR EXISTS (SELECT 1 FROM dbo.sahyog_Messages msg
                   JOIN dbo.sahyog_ChannelMembers m ON m.ChannelId = msg.ChannelId AND m.UserId = @UserId
                   WHERE msg.AttachmentId = a.AttachmentId AND msg.TenantId = @TenantId
                     AND (m.HistoryFromUtc IS NULL OR msg.SentUtc >= m.HistoryFromUtc)
                     AND (m.ShareOldFiles = 1 OR msg.SentUtc >= m.JoinedUtc)));
END
GO

/* Files page: as in 29_GroupMembers.sql, only files a chat you're in shows to you. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Files_ListForUser
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Take INT = 500
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@Take)
           a.AttachmentId, a.FileName, a.ContentType, a.SizeBytes, a.UploadedUtc,
           a.UploaderId, up.DisplayName AS UploaderName, up.AvatarTone AS UploaderTone,
           ch.ChannelId, ch.IsDirect, ch.Name AS ChannelName,
           o.UserId AS OtherId, o.DisplayName AS OtherName, o.AvatarTone AS OtherTone
    FROM dbo.sahyog_Attachments a
    CROSS APPLY (
        SELECT TOP (1) x.ChannelId
        FROM (
            SELECT a.ChannelId AS ChannelId, 0 AS Pref
            WHERE EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers cm
                          WHERE cm.ChannelId = a.ChannelId AND cm.UserId = @UserId
                            AND cm.HistoryFromUtc IS NULL AND cm.ShareOldFiles = 1)
            UNION ALL
            SELECT m.ChannelId, 1
            FROM dbo.sahyog_Messages m
            JOIN dbo.sahyog_ChannelMembers cm ON cm.ChannelId = m.ChannelId AND cm.UserId = @UserId
            WHERE m.AttachmentId = a.AttachmentId AND m.TenantId = @TenantId
              AND (cm.HistoryFromUtc IS NULL OR m.SentUtc >= cm.HistoryFromUtc)
              AND (cm.ShareOldFiles = 1 OR m.SentUtc >= cm.JoinedUtc)
        ) x
        ORDER BY x.Pref
    ) seen
    JOIN dbo.sahyog_Channels ch ON ch.ChannelId = seen.ChannelId
    JOIN dbo.sahyog_Users up ON up.UserId = a.UploaderId
    OUTER APPLY (SELECT TOP (1) u.UserId, u.DisplayName, u.AvatarTone
                 FROM dbo.sahyog_ChannelMembers m JOIN dbo.sahyog_Users u ON u.UserId = m.UserId
                 WHERE ch.IsDirect = 1 AND m.ChannelId = ch.ChannelId AND m.UserId <> @UserId) o
    WHERE a.TenantId = @TenantId
      AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_FileHidden h WHERE h.UserId = @UserId AND h.AttachmentId = a.AttachmentId)
    ORDER BY a.UploadedUtc DESC;
END
GO

/* A person's chat also lists group messages between the two people: as in 29_GroupMembers.sql,
   only the group messages you can see there yourself. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetPersonTimeline
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER,
    @UserId UNIQUEIDENTIFIER, @OtherId UNIQUEIDENTIFIER,
    @BeforeId BIGINT = NULL, @Take INT = 301
AS
BEGIN
    SET NOCOUNT ON;
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
             AND v.CopiedFromId IS NULL
             AND v.SenderId IN (@UserId, @OtherId)
             AND (@Cleared IS NULL OR v.SentUtc > @Cleared)
             AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers a
                         WHERE a.ChannelId = c.ChannelId AND a.UserId = @UserId
                           AND (a.HistoryFromUtc IS NULL OR v.SentUtc >= a.HistoryFromUtc)
                           AND (a.ShareOldFiles = 1 OR v.AttachmentId IS NULL OR v.SentUtc >= a.JoinedUtc))
             AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers b WHERE b.ChannelId = c.ChannelId AND b.UserId = @OtherId))
          )
    ORDER BY v.MessageId DESC;
END
GO
