/* =====================================================================
   ShankhNaad round 38 (safe to run more than once; needs 01–27):
     1. Add people to a group that already exists (the group's creator or a workspace admin).
     2. Remove people from a group (the same people can).
     3. When a group is made from a one-to-one chat ("Add people"), copy that chat's history into it
        (none / last day / last 7 days / all). Copies keep sender and time and are marked (CopiedFromId).
        Files are not duplicated: the copy points at the same file, so storage doesn't double.
     Because a file can now be used by more than one chat:
       - opening a file is allowed for anyone in ANY chat that shows it;
       - the Files page lists a file for anyone in ANY chat that shows it (new group members included);
       - deleting a chat (one-to-one or group) keeps files another chat still shows.
     "Everyone" can't have people added or removed: the whole workspace is always in it.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_Messages', N'ReplyToId') IS NULL
    ALTER TABLE dbo.sahyog_Messages ADD ReplyToId BIGINT NULL;
GO
IF COL_LENGTH(N'dbo.sahyog_Messages', N'CopiedFromId') IS NULL
    ALTER TABLE dbo.sahyog_Messages ADD CopiedFromId BIGINT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Messages_Attachment')
    CREATE INDEX IX_sahyog_Messages_Attachment ON dbo.sahyog_Messages(AttachmentId) WHERE AttachmentId IS NOT NULL;
GO

/* The message shape, now also saying whether a message is a copy from a one-to-one chat. */
CREATE OR ALTER VIEW dbo.sahyog_vMessages
AS
SELECT m.MessageId, m.TenantId, m.ChannelId, m.SenderId, u.DisplayName AS SenderName, u.AvatarTone AS SenderTone,
       m.Body, m.SentUtc, a.AttachmentId, a.FileName, a.ContentType, a.SizeBytes,
       m.ReplyToId,
       ru.DisplayName       AS ReplyToSenderName,
       LEFT(r.Body, 200)    AS ReplyToBody,
       ra.FileName          AS ReplyToFileName,
       m.CopiedFromId
FROM dbo.sahyog_Messages m
JOIN dbo.sahyog_Users u ON u.UserId = m.SenderId
LEFT JOIN dbo.sahyog_Attachments a ON a.AttachmentId = m.AttachmentId
LEFT JOIN dbo.sahyog_Messages r ON r.MessageId = m.ReplyToId AND r.TenantId = m.TenantId
LEFT JOIN dbo.sahyog_Users ru ON ru.UserId = r.SenderId
LEFT JOIN dbo.sahyog_Attachments ra ON ra.AttachmentId = r.AttachmentId;
GO

/* ---------- 1. add people ----------
   @MemberIds: comma-separated user ids. Only active people of this workspace who aren't in it yet are added.
   @Result: 0 done, 1 not found / one-to-one / Everyone, 2 not allowed, 3 nobody new. Returns the ids added. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_AddMembers
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT,
    @MemberIds NVARCHAR(MAX), @Result INT OUTPUT
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
    INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId)
    SELECT @ChannelId, UserId, @TenantId FROM @New;

    SET @Result = 0;
    SELECT UserId FROM @New;
END
GO

/* ---------- 2. remove someone ----------
   @Result: 0 done, 1 not found / one-to-one / Everyone, 2 not allowed, 3 not in the group,
            4 can't remove yourself, 5 only an admin can remove the person who created the group. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_RemoveMember
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT,
    @MemberId UNIQUEIDENTIFIER, @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @CreatedBy UNIQUEIDENTIFIER, @Private BIT;
    SELECT @CreatedBy = CreatedBy, @Private = IsPrivate
    FROM dbo.sahyog_Channels WHERE ChannelId = @ChannelId AND TenantId = @TenantId AND IsDirect = 0;
    IF @Private IS NULL OR @Private = 0 BEGIN SET @Result = 1; RETURN; END
    IF @IsAdmin = 0 AND (@CreatedBy IS NULL OR @CreatedBy <> @UserId) BEGIN SET @Result = 2; RETURN; END
    IF @MemberId = @UserId BEGIN SET @Result = 4; RETURN; END
    IF @MemberId = @CreatedBy AND @IsAdmin = 0 BEGIN SET @Result = 5; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId AND UserId = @MemberId)
    BEGIN SET @Result = 3; RETURN; END

    DELETE dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId AND UserId = @MemberId;
    SET @Result = 0;
END
GO

/* ---------- 3. copy a one-to-one chat's history into a group ----------
   @SinceUtc NULL = everything. Call cards ("[[call:…]]") aren't copied. Copies are inserted oldest first,
   so they keep their order; replies between copied messages still point at the right message.
   @Result: 0 done (returns the count), 1 not allowed (not your one-to-one chat, or not your group). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_CopyHistory
    @TenantId UNIQUEIDENTIFIER, @FromChannelId UNIQUEIDENTIFIER, @ToChannelId UNIQUEIDENTIFIER,
    @UserId UNIQUEIDENTIFIER, @SinceUtc DATETIME2(3) = NULL, @Result INT OUTPUT
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
        -- INSERT … SELECT … ORDER BY hands out the new ids in that order
        INSERT dbo.sahyog_Messages (TenantId, ChannelId, SenderId, Body, SentUtc, AttachmentId, CopiedFromId)
        SELECT m.TenantId, @ToChannelId, m.SenderId, m.Body, m.SentUtc, m.AttachmentId, m.MessageId
        FROM dbo.sahyog_Messages m
        WHERE m.ChannelId = @FromChannelId AND m.TenantId = @TenantId
          AND (@SinceUtc IS NULL OR m.SentUtc >= @SinceUtc)
          AND m.Body NOT LIKE N'[[][[]call:%'
        ORDER BY m.MessageId;
        SET @Copied = @@ROWCOUNT;

        -- a reply to a message that was copied too now points at that copy
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

/* ---------- files used by more than one chat ---------- */

/* Opening a file: allowed if you're in any chat that shows it. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetAttachment
    @TenantId UNIQUEIDENTIFIER, @AttachmentId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT a.AttachmentId, a.ChannelId, a.FileName, a.ContentType, a.SizeBytes, a.StoragePath
    FROM dbo.sahyog_Attachments a
    WHERE a.TenantId = @TenantId AND a.AttachmentId = @AttachmentId
      AND (EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers m
                   WHERE m.ChannelId = a.ChannelId AND m.UserId = @UserId AND m.TenantId = @TenantId)
        OR EXISTS (SELECT 1 FROM dbo.sahyog_Messages msg
                   JOIN dbo.sahyog_ChannelMembers m ON m.ChannelId = msg.ChannelId AND m.UserId = @UserId
                   WHERE msg.AttachmentId = a.AttachmentId AND msg.TenantId = @TenantId));
END
GO

/* "Files shared" in Details: every file shown in this chat (copied history included). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetRecentFiles
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @Take INT = 5
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@Take) a.AttachmentId, a.FileName, a.ContentType, a.SizeBytes
    FROM dbo.sahyog_Attachments a
    WHERE a.TenantId = @TenantId
      AND EXISTS (SELECT 1 FROM dbo.sahyog_Messages m WHERE m.AttachmentId = a.AttachmentId AND m.ChannelId = @ChannelId)
    ORDER BY a.UploadedUtc DESC;
END
GO

/* Files page: every file in any chat you're in, copied history included. A file shown in more than one of your
   chats is listed once, under the chat it was first shared in if you're in that one, otherwise under one of yours.
   Same columns as 24_HistoryDelete.sql. */
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
            WHERE EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers cm WHERE cm.ChannelId = a.ChannelId AND cm.UserId = @UserId)
            UNION ALL
            SELECT m.ChannelId, 1
            FROM dbo.sahyog_Messages m
            JOIN dbo.sahyog_ChannelMembers cm ON cm.ChannelId = m.ChannelId AND cm.UserId = @UserId
            WHERE m.AttachmentId = a.AttachmentId AND m.TenantId = @TenantId
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

/* A person's chat also lists group messages between the two people; copies of this very chat are left out
   (otherwise every copied message would show twice). Same as 21_DeleteChatClearsAll.sql otherwise. */
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
             AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers a WHERE a.ChannelId = c.ChannelId AND a.UserId = @UserId)
             AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers b WHERE b.ChannelId = c.ChannelId AND b.UserId = @OtherId))
          )
    ORDER BY v.MessageId DESC;
END
GO

/* Deleting a one-to-one chat: as in 21_DeleteChatClearsAll.sql, except a file that a group still shows
   (copied history) moves to that group instead of being deleted. */
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

    DECLARE @OtherId UNIQUEIDENTIFIER =
        (SELECT TOP (1) UserId FROM dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId AND UserId <> @UserId);
    DECLARE @Files TABLE (StoragePath NVARCHAR(400) NOT NULL, SizeBytes BIGINT NOT NULL);

    BEGIN TRANSACTION;
        -- files another chat still shows move there and stay
        UPDATE a SET ChannelId = x.OtherChannel
        FROM dbo.sahyog_Attachments a
        CROSS APPLY (SELECT TOP (1) m.ChannelId AS OtherChannel FROM dbo.sahyog_Messages m
                     WHERE m.AttachmentId = a.AttachmentId AND m.ChannelId <> @ChannelId) x
        WHERE a.ChannelId = @ChannelId AND a.TenantId = @TenantId;

        INSERT @Files (StoragePath, SizeBytes)
        SELECT StoragePath, SizeBytes FROM dbo.sahyog_Attachments WHERE ChannelId = @ChannelId AND TenantId = @TenantId;

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
        DELETE dbo.sahyog_Messages       WHERE ChannelId = @ChannelId AND TenantId = @TenantId;
        DELETE dbo.sahyog_Attachments    WHERE ChannelId = @ChannelId AND TenantId = @TenantId;
        DELETE dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId;
        DELETE dbo.sahyog_Channels       WHERE ChannelId = @ChannelId AND TenantId = @TenantId;

        UPDATE dbo.sahyog_Tenants
        SET StorageUsedBytes = CASE WHEN StorageUsedBytes - x.Total < 0 THEN 0 ELSE StorageUsedBytes - x.Total END
        FROM (SELECT COALESCE(SUM(SizeBytes), 0) AS Total FROM @Files) x
        WHERE TenantId = @TenantId;
    COMMIT;

    SET @Result = 1;
    SELECT StoragePath FROM @Files;
END
GO

/* Deleting a group: as in 14_ChannelEdit.sql, except a file another chat still shows stays (it moves there). */
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

    BEGIN TRANSACTION;
        UPDATE a SET ChannelId = x.OtherChannel
        FROM dbo.sahyog_Attachments a
        CROSS APPLY (SELECT TOP (1) m.ChannelId AS OtherChannel FROM dbo.sahyog_Messages m
                     WHERE m.AttachmentId = a.AttachmentId AND m.ChannelId <> @ChannelId) x
        WHERE a.ChannelId = @ChannelId AND a.TenantId = @TenantId;

        INSERT @Files (StoragePath, SizeBytes)
        SELECT StoragePath, SizeBytes FROM dbo.sahyog_Attachments WHERE ChannelId = @ChannelId AND TenantId = @TenantId;

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
