/* =====================================================================
   ShankhNaad round 33 (safe to run more than once; needs 22 and 23):
     Delete on the Calls and Files pages: one, the ones you pick, or all.
       Calls - removed from YOUR call history only (the other person keeps theirs).
       Files - removed from YOUR list only; a file you shared yourself can also be
               deleted for everyone (that is done through the normal message delete).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_CallHidden', N'U') IS NULL
CREATE TABLE dbo.sahyog_CallHidden
(
    UserId     UNIQUEIDENTIFIER NOT NULL,
    MeetingId  UNIQUEIDENTIFIER NOT NULL,
    TenantId   UNIQUEIDENTIFIER NOT NULL,
    HiddenUtc  DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_CallHidden_Utc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sahyog_CallHidden PRIMARY KEY (UserId, MeetingId)
);
GO
IF OBJECT_ID(N'dbo.sahyog_FileHidden', N'U') IS NULL
CREATE TABLE dbo.sahyog_FileHidden
(
    UserId       UNIQUEIDENTIFIER NOT NULL,
    AttachmentId UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_FileHidden_Attachments REFERENCES dbo.sahyog_Attachments(AttachmentId) ON DELETE CASCADE,
    TenantId     UNIQUEIDENTIFIER NOT NULL,
    HiddenUtc    DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_FileHidden_Utc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sahyog_FileHidden PRIMARY KEY (UserId, AttachmentId)
);
GO

/* Removes calls from this person's history. @Ids: comma-separated meeting ids; @All = 1: every call they can see. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Calls_Hide
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Ids NVARCHAR(MAX) = NULL, @All BIT = 0,
    @Count INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.sahyog_CallHidden (UserId, MeetingId, TenantId)
    SELECT @UserId, c.MeetingId, @TenantId
    FROM dbo.sahyog_CallLog c
    JOIN dbo.sahyog_ChannelMembers m ON m.ChannelId = c.ChannelId AND m.UserId = @UserId
    WHERE c.TenantId = @TenantId
      AND (@All = 1 OR c.MeetingId IN (SELECT TRY_CAST(LTRIM(RTRIM(value)) AS UNIQUEIDENTIFIER) FROM STRING_SPLIT(ISNULL(@Ids, N''), N',')))
      AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_CallHidden h WHERE h.UserId = @UserId AND h.MeetingId = c.MeetingId);
    SET @Count = @@ROWCOUNT;
END
GO

/* Removes files from this person's Files list (they stay in the chat). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Files_Hide
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Ids NVARCHAR(MAX) = NULL, @All BIT = 0,
    @Count INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.sahyog_FileHidden (UserId, AttachmentId, TenantId)
    SELECT @UserId, a.AttachmentId, @TenantId
    FROM dbo.sahyog_Attachments a
    JOIN dbo.sahyog_ChannelMembers m ON m.ChannelId = a.ChannelId AND m.UserId = @UserId
    WHERE a.TenantId = @TenantId
      AND (@All = 1 OR a.AttachmentId IN (SELECT TRY_CAST(LTRIM(RTRIM(value)) AS UNIQUEIDENTIFIER) FROM STRING_SPLIT(ISNULL(@Ids, N''), N',')))
      AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_FileHidden h WHERE h.UserId = @UserId AND h.AttachmentId = a.AttachmentId);
    SET @Count = @@ROWCOUNT;
END
GO

/* The messages that carry a file (to delete it for everyone through the normal message delete). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Files_MessageIds
    @TenantId UNIQUEIDENTIFIER, @AttachmentId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT m.MessageId FROM dbo.sahyog_Messages m WHERE m.TenantId = @TenantId AND m.AttachmentId = @AttachmentId;
END
GO

/* The Calls and Files lists, now leaving out what this person removed. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Calls_ListForUser
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Take INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
    SELECT TOP (@Take)
           c.MeetingId, c.ChannelId, c.CallerId, cu.DisplayName AS CallerName, cu.AvatarTone AS CallerTone,
           c.StartedUtc, c.AnsweredUtc, c.EndedUtc,
           CASE WHEN c.Outcome = 0 AND c.StartedUtc <= DATEADD(SECOND, -45, @now) THEN 3 ELSE c.Outcome END AS Outcome,
           ch.IsDirect, ch.Name AS ChannelName,
           (SELECT COUNT(*) FROM dbo.sahyog_ChannelMembers x WHERE x.ChannelId = ch.ChannelId) AS MemberCount,
           o.UserId AS OtherId, o.DisplayName AS OtherName, o.AvatarTone AS OtherTone
    FROM dbo.sahyog_CallLog c
    JOIN dbo.sahyog_Channels ch ON ch.ChannelId = c.ChannelId
    JOIN dbo.sahyog_ChannelMembers me ON me.ChannelId = c.ChannelId AND me.UserId = @UserId
    JOIN dbo.sahyog_Users cu ON cu.UserId = c.CallerId
    OUTER APPLY (SELECT TOP (1) u.UserId, u.DisplayName, u.AvatarTone
                 FROM dbo.sahyog_ChannelMembers m JOIN dbo.sahyog_Users u ON u.UserId = m.UserId
                 WHERE ch.IsDirect = 1 AND m.ChannelId = ch.ChannelId AND m.UserId <> @UserId) o
    WHERE c.TenantId = @TenantId
      AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_CallHidden h WHERE h.UserId = @UserId AND h.MeetingId = c.MeetingId)
    ORDER BY c.StartedUtc DESC;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Files_ListForUser
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Take INT = 500
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@Take)
           a.AttachmentId, a.FileName, a.ContentType, a.SizeBytes, a.UploadedUtc,
           a.UploaderId, up.DisplayName AS UploaderName, up.AvatarTone AS UploaderTone,
           a.ChannelId, ch.IsDirect, ch.Name AS ChannelName,
           o.UserId AS OtherId, o.DisplayName AS OtherName, o.AvatarTone AS OtherTone
    FROM dbo.sahyog_Attachments a
    JOIN dbo.sahyog_Channels ch ON ch.ChannelId = a.ChannelId
    JOIN dbo.sahyog_ChannelMembers me ON me.ChannelId = a.ChannelId AND me.UserId = @UserId
    JOIN dbo.sahyog_Users up ON up.UserId = a.UploaderId
    OUTER APPLY (SELECT TOP (1) u.UserId, u.DisplayName, u.AvatarTone
                 FROM dbo.sahyog_ChannelMembers m JOIN dbo.sahyog_Users u ON u.UserId = m.UserId
                 WHERE ch.IsDirect = 1 AND m.ChannelId = ch.ChannelId AND m.UserId <> @UserId) o
    WHERE a.TenantId = @TenantId
      AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_FileHidden h WHERE h.UserId = @UserId AND h.AttachmentId = a.AttachmentId)
    ORDER BY a.UploadedUtc DESC;
END
GO
