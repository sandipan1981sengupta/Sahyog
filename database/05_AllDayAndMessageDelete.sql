/* =====================================================================
   ShankhNaad round 10 (run once, after 01–04):
     1. All-day events that show as Busy or Free  (two new columns with defaults)
     2. Delete a single chat message              (one new procedure)
   Existing data is untouched: every current meeting stays a normal (timed, busy) meeting.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_Meetings', N'IsAllDay') IS NULL
    ALTER TABLE dbo.sahyog_Meetings ADD IsAllDay BIT NOT NULL CONSTRAINT DF_sahyog_Meetings_AllDay DEFAULT (0);
IF COL_LENGTH(N'dbo.sahyog_Meetings', N'ShowAsFree') IS NULL
    ALTER TABLE dbo.sahyog_Meetings ADD ShowAsFree BIT NOT NULL CONSTRAINT DF_sahyog_Meetings_Free DEFAULT (0);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_Create
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @Title NVARCHAR(150), @Agenda NVARCHAR(2000) = NULL,
    @StartUtc DATETIME2(0), @DurationMinutes INT, @Recurrence TINYINT, @RoomName NVARCHAR(80), @GuestCode NVARCHAR(16),
    @HostId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER = NULL, @IsInstant BIT,
    @GuestLinkEnabled BIT, @LobbyEnabled BIT, @CaptionsOn BIT,
    @InviteeIds dbo.sahyog_GuidList READONLY, @GuestEmails dbo.sahyog_EmailList READONLY,
    @IsAllDay BIT = 0, @ShowAsFree BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;
        INSERT dbo.sahyog_Meetings (MeetingId, TenantId, Title, Agenda, StartUtc, DurationMinutes, Recurrence, RoomName, GuestCode,
                             HostId, ChannelId, IsInstant, GuestLinkEnabled, LobbyEnabled, CaptionsOn, IsAllDay, ShowAsFree)
        VALUES (@MeetingId, @TenantId, @Title, @Agenda, @StartUtc, @DurationMinutes, @Recurrence, @RoomName, @GuestCode,
                @HostId, @ChannelId, @IsInstant, @GuestLinkEnabled, @LobbyEnabled, @CaptionsOn, @IsAllDay, @ShowAsFree);

        INSERT dbo.sahyog_MeetingInvitees (TenantId, MeetingId, UserId)
        SELECT @TenantId, @MeetingId, u.UserId
        FROM @InviteeIds i
        JOIN dbo.sahyog_Users u ON u.UserId = i.Id AND u.TenantId = @TenantId AND u.IsActive = 1
        WHERE u.UserId <> @HostId;

        INSERT dbo.sahyog_MeetingInvitees (TenantId, MeetingId, GuestEmail)
        SELECT @TenantId, @MeetingId, g.Email FROM @GuestEmails g;
    COMMIT;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_ListForUser
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @FromUtc DATETIME2(0), @ToUtc DATETIME2(0)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT m.MeetingId, m.Title, m.Agenda, m.StartUtc, m.DurationMinutes, m.Recurrence, m.RoomName, m.GuestCode,
           m.HostId, h.DisplayName AS HostName, h.AvatarTone AS HostTone, m.ChannelId, m.IsInstant,
           m.GuestLinkEnabled, m.LobbyEnabled, m.CaptionsOn, m.IsAllDay, m.ShowAsFree
    INTO #m
    FROM dbo.sahyog_Meetings m
    JOIN dbo.sahyog_Users h ON h.UserId = m.HostId
    WHERE m.TenantId = @TenantId
      AND m.StartUtc < @ToUtc
      AND (m.Recurrence <> 0 OR m.StartUtc >= DATEADD(DAY, -1, @FromUtc))
      AND (m.HostId = @UserId
           OR EXISTS (SELECT 1 FROM dbo.sahyog_MeetingInvitees i WHERE i.MeetingId = m.MeetingId AND i.UserId = @UserId));

    SELECT * FROM #m;

    SELECT i.MeetingId, i.UserId, u.DisplayName, u.AvatarTone, u.Email, i.GuestEmail
    FROM dbo.sahyog_MeetingInvitees i
    JOIN #m ON #m.MeetingId = i.MeetingId
    LEFT JOIN dbo.sahyog_Users u ON u.UserId = i.UserId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_Get
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT m.MeetingId, m.Title, m.Agenda, m.StartUtc, m.DurationMinutes, m.Recurrence, m.RoomName, m.GuestCode,
           m.HostId, h.DisplayName AS HostName, h.AvatarTone AS HostTone, m.ChannelId, m.IsInstant,
           m.GuestLinkEnabled, m.LobbyEnabled, m.CaptionsOn, m.IsAllDay, m.ShowAsFree,
           c.Name AS ChannelName, c.IsDirect AS ChannelIsDirect
    FROM dbo.sahyog_Meetings m
    JOIN dbo.sahyog_Users h ON h.UserId = m.HostId
    LEFT JOIN dbo.sahyog_Channels c ON c.ChannelId = m.ChannelId
    WHERE m.TenantId = @TenantId AND m.MeetingId = @MeetingId;
END
GO

/* Deletes one chat message. The sender can delete their own; a workspace admin can delete any.
   A file attached to the message is removed too and its space is given back to the workspace.
   @Result: 0 deleted, 1 not found, 2 not allowed. Returns ChannelId and StoragePath (NULL when no file). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_DeleteMessage
    @TenantId UNIQUEIDENTIFIER, @MessageId BIGINT, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @SenderId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @AttachmentId UNIQUEIDENTIFIER;
    SELECT @SenderId = SenderId, @ChannelId = ChannelId, @AttachmentId = AttachmentId
    FROM dbo.sahyog_Messages WHERE MessageId = @MessageId AND TenantId = @TenantId;

    IF @SenderId IS NULL BEGIN SET @Result = 1; RETURN; END
    IF @SenderId <> @UserId AND @IsAdmin = 0 BEGIN SET @Result = 2; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId AND UserId = @UserId)
       AND @IsAdmin = 0 BEGIN SET @Result = 2; RETURN; END

    DECLARE @Path NVARCHAR(400) = NULL, @Size BIGINT = 0;
    IF @AttachmentId IS NOT NULL
        SELECT @Path = StoragePath, @Size = SizeBytes FROM dbo.sahyog_Attachments WHERE AttachmentId = @AttachmentId AND TenantId = @TenantId;

    BEGIN TRANSACTION;
        DELETE dbo.sahyog_Messages WHERE MessageId = @MessageId AND TenantId = @TenantId;
        IF @AttachmentId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Messages WHERE AttachmentId = @AttachmentId)
        BEGIN
            DELETE dbo.sahyog_Attachments WHERE AttachmentId = @AttachmentId AND TenantId = @TenantId;
            UPDATE dbo.sahyog_Tenants
            SET StorageUsedBytes = CASE WHEN StorageUsedBytes - @Size < 0 THEN 0 ELSE StorageUsedBytes - @Size END
            WHERE TenantId = @TenantId;
        END
        ELSE SET @Path = NULL;
    COMMIT;

    SET @Result = 0;
    SELECT @ChannelId AS ChannelId, @Path AS StoragePath;
END
GO
