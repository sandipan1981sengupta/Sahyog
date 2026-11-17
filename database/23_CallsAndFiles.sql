/* =====================================================================
   ShankhNaad round 32 (safe to run more than once; needs 01–02 and 22):
     Two new pages on the left rail, like Microsoft Teams:
       Calls - every call you made or got (missed, declined, how long)
       Files - every file shared with you or by you, and in which chat
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_CallLog_Tenant')
    CREATE INDEX IX_sahyog_CallLog_Tenant ON dbo.sahyog_CallLog(TenantId, StartedUtc DESC) INCLUDE (ChannelId, CallerId, Outcome);
GO

/* Calls in chats this person is in, newest first.
   For a one-to-one chat, Other* is the other person; for a group, the group's name and size. */
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
    ORDER BY c.StartedUtc DESC;
END
GO

/* Files shared in chats this person is in, newest first, with who shared them and where. */
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
    ORDER BY a.UploadedUtc DESC;
END
GO

/* Calls ringing for this person right now (started under 45 s ago, not answered, declined or cancelled),
   so a page that was asleep or reconnecting still shows the ringing card. */
CREATE OR ALTER PROCEDURE dbo.sahyog_CallLog_Pending
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.MeetingId, c.CallerId, u.DisplayName AS CallerName, u.AvatarTone AS CallerTone, ch.IsDirect, ch.Name AS ChannelName
    FROM dbo.sahyog_CallLog c
    JOIN dbo.sahyog_ChannelMembers me ON me.ChannelId = c.ChannelId AND me.UserId = @UserId
    JOIN dbo.sahyog_Channels ch ON ch.ChannelId = c.ChannelId
    JOIN dbo.sahyog_Users u ON u.UserId = c.CallerId
    WHERE c.TenantId = @TenantId AND c.CallerId <> @UserId AND c.Outcome = 0
      AND c.StartedUtc > DATEADD(SECOND, -40, SYSUTCDATETIME());
END
GO
