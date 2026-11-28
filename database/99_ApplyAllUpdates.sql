/* =====================================================================
   ShankhNaad · 99_ApplyAllUpdates.sql
   ONE file with every database update (03 → 55), in the right order.
   Safe to run more than once: each step only adds or replaces what it needs,
   and no data is deleted.

   How: SQL Server Management Studio → File → Open → this file →
        pick your Sahyog database in the toolbar → Execute (F5).
   It should end with "ShankhNaad database is up to date."

   (01_Tables.sql and 02_StoredProcedures.sql are only for a brand-new database.)
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ############################## 03_Setup.sql ############################## */
PRINT N'Applying 03_Setup.sql ...';
GO
/* =====================================================================
   Sahyog · 03_Setup.sql
   Run this once if you already ran 02_StoredProcedures.sql before the /setup page existed.
   (Running the whole 02_StoredProcedures.sql again does the same thing.)
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sahyog_User_SuperAdminExists
AS
BEGIN
    SET NOCOUNT ON;
    SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE Role = N'SuperAdmin') THEN 1 ELSE 0 END AS BIT) AS AnyExists;
END
GO

/* ############################## 04_DeleteDirectChat.sql ############################## */
PRINT N'Applying 04_DeleteDirectChat.sql ...';
GO
/* =====================================================================
   ShankhNaad: delete a one-to-one (direct) conversation.
   New stored procedure only; no table changes. Run after 02_StoredProcedures.sql.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* Deletes a direct conversation, its messages and its files for both people.
   Only a member of that conversation can do it; group channels cannot be deleted here.
   Returns one row per deleted file (StoragePath) so the app can remove them from disk.
   @Result: 1 = deleted, 0 = not found / not a direct chat / not a member. */
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

    BEGIN TRANSACTION;
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

/* ############################## 05_AllDayAndMessageDelete.sql ############################## */
PRINT N'Applying 05_AllDayAndMessageDelete.sql ...';
GO
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

/* ############################## 06_CustomRepeat.sql ############################## */
PRINT N'Applying 06_CustomRepeat.sql ...';
GO
/* =====================================================================
   ShankhNaad round 11 (safe to run more than once; needs 01–04):
     Custom repeat: pick the days (e.g. Mon, Wed, Fri) and an optional last day.
       RepeatDays     TINYINT NULL  bit per day, same numbering as .NET DayOfWeek:
                                    Sun = 1, Mon = 2, Tue = 4, Wed = 8, Thu = 16, Fri = 32, Sat = 64
                                    (used when Recurrence = 3 "Custom")
       RepeatUntilUtc DATETIME2 NULL start of the LAST occurrence (UTC). NULL = repeats with no end.
   Existing meetings are untouched: NULLs mean "repeat as before, forever".
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- from 05_AllDayAndMessageDelete.sql: added here too so this script also works when 05 was skipped
IF COL_LENGTH(N'dbo.sahyog_Meetings', N'IsAllDay') IS NULL
    ALTER TABLE dbo.sahyog_Meetings ADD IsAllDay BIT NOT NULL CONSTRAINT DF_sahyog_Meetings_AllDay DEFAULT (0);
IF COL_LENGTH(N'dbo.sahyog_Meetings', N'ShowAsFree') IS NULL
    ALTER TABLE dbo.sahyog_Meetings ADD ShowAsFree BIT NOT NULL CONSTRAINT DF_sahyog_Meetings_Free DEFAULT (0);

IF COL_LENGTH(N'dbo.sahyog_Meetings', N'RepeatDays') IS NULL
    ALTER TABLE dbo.sahyog_Meetings ADD RepeatDays TINYINT NULL;
IF COL_LENGTH(N'dbo.sahyog_Meetings', N'RepeatUntilUtc') IS NULL
    ALTER TABLE dbo.sahyog_Meetings ADD RepeatUntilUtc DATETIME2(0) NULL;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_Create
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @Title NVARCHAR(150), @Agenda NVARCHAR(2000) = NULL,
    @StartUtc DATETIME2(0), @DurationMinutes INT, @Recurrence TINYINT, @RoomName NVARCHAR(80), @GuestCode NVARCHAR(16),
    @HostId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER = NULL, @IsInstant BIT,
    @GuestLinkEnabled BIT, @LobbyEnabled BIT, @CaptionsOn BIT,
    @InviteeIds dbo.sahyog_GuidList READONLY, @GuestEmails dbo.sahyog_EmailList READONLY,
    @IsAllDay BIT = 0, @ShowAsFree BIT = 0,
    @RepeatDays TINYINT = NULL, @RepeatUntilUtc DATETIME2(0) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;
        INSERT dbo.sahyog_Meetings (MeetingId, TenantId, Title, Agenda, StartUtc, DurationMinutes, Recurrence, RoomName, GuestCode,
                             HostId, ChannelId, IsInstant, GuestLinkEnabled, LobbyEnabled, CaptionsOn, IsAllDay, ShowAsFree,
                             RepeatDays, RepeatUntilUtc)
        VALUES (@MeetingId, @TenantId, @Title, @Agenda, @StartUtc, @DurationMinutes, @Recurrence, @RoomName, @GuestCode,
                @HostId, @ChannelId, @IsInstant, @GuestLinkEnabled, @LobbyEnabled, @CaptionsOn, @IsAllDay, @ShowAsFree,
                @RepeatDays, @RepeatUntilUtc);

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
           m.GuestLinkEnabled, m.LobbyEnabled, m.CaptionsOn, m.IsAllDay, m.ShowAsFree,
           m.RepeatDays, m.RepeatUntilUtc
    INTO #m
    FROM dbo.sahyog_Meetings m
    JOIN dbo.sahyog_Users h ON h.UserId = m.HostId
    WHERE m.TenantId = @TenantId
      AND m.StartUtc < @ToUtc
      AND (   (m.Recurrence <> 0 AND (m.RepeatUntilUtc IS NULL OR m.RepeatUntilUtc >= DATEADD(DAY, -1, @FromUtc)))
           OR m.StartUtc >= DATEADD(DAY, -1, @FromUtc))
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
           m.RepeatDays, m.RepeatUntilUtc,
           c.Name AS ChannelName, c.IsDirect AS ChannelIsDirect
    FROM dbo.sahyog_Meetings m
    JOIN dbo.sahyog_Users h ON h.UserId = m.HostId
    LEFT JOIN dbo.sahyog_Channels c ON c.ChannelId = m.ChannelId
    WHERE m.TenantId = @TenantId AND m.MeetingId = @MeetingId;
END
GO

/* ############################## 07_ClientEditDelete.sql ############################## */
PRINT N'Applying 07_ClientEditDelete.sql ...';
GO
/* =====================================================================
   ShankhNaad round 12 (safe to run more than once; needs 01–04):
     Super admin can rename a client (company name + workspace name) and delete a client.
       sahyog_Tenant_Update  @Result: 0 saved, 1 workspace name taken, 2 not found
       sahyog_Tenant_Delete  @Result: 0 deleted, 1 not found, 2 typed workspace name does not match,
                                      3 client is still active (pause it first)
   Delete removes everything the client owns: meetings, messages, files (rows), channels and people.
   The app then removes the client's file folder (tenant-<id>) from disk.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_Update
    @TenantId UNIQUEIDENTIFIER, @Name NVARCHAR(120), @Slug NVARCHAR(40),
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Tenants WHERE TenantId = @TenantId) BEGIN SET @Result = 2; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Tenants WHERE Slug = @Slug AND TenantId <> @TenantId) BEGIN SET @Result = 1; RETURN; END

    UPDATE dbo.sahyog_Tenants SET Name = @Name, Slug = @Slug WHERE TenantId = @TenantId;
    SET @Result = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_Delete
    @TenantId UNIQUEIDENTIFIER, @ConfirmSlug NVARCHAR(40),
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Slug NVARCHAR(40), @IsActive BIT;
    SELECT @Slug = Slug, @IsActive = IsActive FROM dbo.sahyog_Tenants WHERE TenantId = @TenantId;

    IF @Slug IS NULL BEGIN SET @Result = 1; RETURN; END
    IF @Slug <> LOWER(LTRIM(RTRIM(@ConfirmSlug))) BEGIN SET @Result = 2; RETURN; END
    IF @IsActive = 1 BEGIN SET @Result = 3; RETURN; END

    BEGIN TRANSACTION;
        -- meetings (invitees first; they also point at people)
        DELETE i FROM dbo.sahyog_MeetingInvitees i
        JOIN dbo.sahyog_Meetings m ON m.MeetingId = i.MeetingId
        WHERE m.TenantId = @TenantId;
        DELETE dbo.sahyog_Meetings WHERE TenantId = @TenantId;

        -- chat: messages before files (a message can point at a file), then members and channels
        DELETE msg FROM dbo.sahyog_Messages msg
        JOIN dbo.sahyog_Channels c ON c.ChannelId = msg.ChannelId
        WHERE c.TenantId = @TenantId;
        DELETE a FROM dbo.sahyog_Attachments a
        JOIN dbo.sahyog_Channels c ON c.ChannelId = a.ChannelId
        WHERE c.TenantId = @TenantId;
        DELETE cm FROM dbo.sahyog_ChannelMembers cm
        JOIN dbo.sahyog_Channels c ON c.ChannelId = cm.ChannelId
        WHERE c.TenantId = @TenantId;
        DELETE dbo.sahyog_Channels WHERE TenantId = @TenantId;

        -- people, then the client itself
        DELETE dbo.sahyog_Users WHERE TenantId = @TenantId;
        DELETE dbo.sahyog_Tenants WHERE TenantId = @TenantId;
    COMMIT;

    SET @Result = 0;
END
GO

/* ############################## 08_FreeUpStorage.sql ############################## */
PRINT N'Applying 08_FreeUpStorage.sql ...';
GO
/* =====================================================================
   ShankhNaad round 13 (safe to run more than once; needs 01–04):
     Super admin "Free up space" for a client.
       sahyog_Tenant_FilesSummary  how many chat files (and bytes) are older than a date (NULL = all files)
       sahyog_Tenant_PurgeFiles    removes those files: the chat message stays and says the file was removed,
                                   the file row goes, and the client's storage figure is recounted from what's left.
                                   Returns one row per removed file (StoragePath, SizeBytes) so the app deletes them from disk.
   Only chat file uploads use storage. Message text, meetings and video recordings (kept by JaaS) do not.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_FilesSummary
    @TenantId UNIQUEIDENTIFIER, @OlderThanUtc DATETIME2(3) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) AS Files, CAST(ISNULL(SUM(SizeBytes), 0) AS BIGINT) AS Bytes
    FROM dbo.sahyog_Attachments
    WHERE TenantId = @TenantId AND (@OlderThanUtc IS NULL OR UploadedUtc < @OlderThanUtc);
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_PurgeFiles
    @TenantId UNIQUEIDENTIFIER, @OlderThanUtc DATETIME2(3) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SELECT AttachmentId, FileName, StoragePath, SizeBytes
    INTO #gone
    FROM dbo.sahyog_Attachments
    WHERE TenantId = @TenantId AND (@OlderThanUtc IS NULL OR UploadedUtc < @OlderThanUtc);

    BEGIN TRANSACTION;
        -- keep the conversation readable: the message stays and says what was there
        UPDATE m
        SET m.AttachmentId = NULL,
            m.Body = LEFT(CASE WHEN m.Body = N'' THEN N'' ELSE m.Body + NCHAR(10) END
                          + N'[File removed to free up space: ' + g.FileName + N']', 4000)
        FROM dbo.sahyog_Messages m
        JOIN #gone g ON g.AttachmentId = m.AttachmentId
        WHERE m.TenantId = @TenantId;

        DELETE a FROM dbo.sahyog_Attachments a JOIN #gone g ON g.AttachmentId = a.AttachmentId;

        -- recount from what's left (also corrects any drift in the stored figure)
        UPDATE dbo.sahyog_Tenants
        SET StorageUsedBytes = (SELECT CAST(ISNULL(SUM(SizeBytes), 0) AS BIGINT) FROM dbo.sahyog_Attachments WHERE TenantId = @TenantId)
        WHERE TenantId = @TenantId;
    COMMIT;

    SELECT StoragePath, SizeBytes FROM #gone;
END
GO

/* ############################## 09_RecordingOff.sql ############################## */
PRINT N'Applying 09_RecordingOff.sql ...';
GO
/* =====================================================================
   ShankhNaad round 15 (safe to run more than once):
     Recording is switched off for every plan for now.
     The app also refuses to turn it on (VideoFeatures.RecordingAvailable = false in
     ShankhNaad.ServiceLibrary/Video/VideoProviders.cs) and never puts recording in a meeting pass,
     so this script only makes the stored plans match.
   ===================================================================== */
SET NOCOUNT ON;
UPDATE dbo.sahyog_Plans SET RecordingEnabled = 0 WHERE RecordingEnabled = 1;
SELECT PlanId, Name, RecordingEnabled FROM dbo.sahyog_Plans ORDER BY PlanId;
GO

/* ############################## 10_EditPerson.sql ############################## */
PRINT N'Applying 10_EditPerson.sql ...';
GO
/* =====================================================================
   ShankhNaad round 16 (safe to run more than once; needs 01–04):
     Workspace admins can edit a person on the Team page: name, email, admin role,
     and optionally set a new temporary password.
       sahyog_User_Update  @Result: 0 saved, 1 email used by someone else, 3 not found,
                                    4 would leave the workspace without an admin
     Changing the email, role or password signs that person out everywhere (new security stamp),
     and a new password also clears any sign-in lockout. A name-only change keeps them signed in.
     @NewStamp returns the person's security stamp after the change (the app refreshes your own
     sign-in with it when you edit yourself).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_User_Update
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER,
    @DisplayName NVARCHAR(100), @Email NVARCHAR(256), @Role NVARCHAR(20),
    @NewPasswordHash NVARCHAR(400) = NULL,
    @Result INT OUTPUT, @NewStamp UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    DECLARE @OldEmail NVARCHAR(256), @OldRole NVARCHAR(20);
    SELECT @OldEmail = Email, @OldRole = Role
    FROM dbo.sahyog_Users WITH (UPDLOCK, HOLDLOCK)
    WHERE UserId = @UserId AND TenantId = @TenantId;

    IF @OldEmail IS NULL BEGIN ROLLBACK; SET @Result = 3; RETURN; END

    IF @Email <> @OldEmail
       AND EXISTS (SELECT 1 FROM dbo.sahyog_Users WITH (UPDLOCK, HOLDLOCK) WHERE Email = @Email AND UserId <> @UserId)
    BEGIN ROLLBACK; SET @Result = 1; RETURN; END

    -- never leave a workspace without an active admin
    IF @OldRole = N'TenantAdmin' AND @Role <> N'TenantAdmin'
       AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users
                       WHERE TenantId = @TenantId AND Role = N'TenantAdmin' AND IsActive = 1 AND UserId <> @UserId)
    BEGIN ROLLBACK; SET @Result = 4; RETURN; END

    DECLARE @SignOut BIT = CASE WHEN @Email <> @OldEmail OR @Role <> @OldRole OR @NewPasswordHash IS NOT NULL THEN 1 ELSE 0 END;

    UPDATE dbo.sahyog_Users
    SET DisplayName      = @DisplayName,
        Email            = @Email,
        Role             = @Role,
        PasswordHash     = COALESCE(@NewPasswordHash, PasswordHash),
        FailedLoginCount = CASE WHEN @NewPasswordHash IS NULL THEN FailedLoginCount ELSE 0 END,
        LockoutEndUtc    = CASE WHEN @NewPasswordHash IS NULL THEN LockoutEndUtc ELSE NULL END,
        SecurityStamp    = CASE WHEN @SignOut = 1 THEN NEWID() ELSE SecurityStamp END
    WHERE UserId = @UserId AND TenantId = @TenantId;

    SELECT @NewStamp = SecurityStamp FROM dbo.sahyog_Users WHERE UserId = @UserId;
    COMMIT;

    SET @Result = 0;
END
GO

/* ############################## 11_PasswordLinks.sql ############################## */
PRINT N'Applying 11_PasswordLinks.sql ...';
GO
/* =====================================================================
   ShankhNaad round 17 (safe to run more than once; needs 01–04):
     One-time "set your password" links, used by:
       - the welcome email when an admin adds a person (Purpose 1, valid 7 days)
       - "Forgot password?" on the sign-in page and "Email a set-password link" on Team (Purpose 2)
     Only a SHA-256 hash of each link's secret is stored, so a database copy can't be used to sign in.
     A new link cancels the person's older unused links. Using a link sets the password, clears any
     lockout and signs the person out everywhere (new security stamp).

       sahyog_PasswordLink_Create  @Result: 0 created, 5 a link was created less than @MinGapSeconds ago
       sahyog_PasswordLink_Get     the link's person and state (for showing the page)
       sahyog_PasswordLink_Use     @Result: 0 password set, 1 link not valid (wrong, used or expired),
                                            2 account inactive or workspace paused
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_PasswordLinks', N'U') IS NULL
CREATE TABLE dbo.sahyog_PasswordLinks
(
    TokenHash   BINARY(32)       NOT NULL CONSTRAINT PK_sahyog_PasswordLinks PRIMARY KEY,
    UserId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_PasswordLinks_Users REFERENCES dbo.sahyog_Users(UserId) ON DELETE CASCADE,
    Purpose     TINYINT          NOT NULL,          -- 1 welcome, 2 reset
    CreatedUtc  DATETIME2(0)     NOT NULL CONSTRAINT DF_sahyog_PasswordLinks_Created DEFAULT (SYSUTCDATETIME()),
    ExpiresUtc  DATETIME2(0)     NOT NULL,
    UsedUtc     DATETIME2(0)     NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_PasswordLinks_User')
    CREATE INDEX IX_sahyog_PasswordLinks_User ON dbo.sahyog_PasswordLinks(UserId, CreatedUtc DESC);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_PasswordLink_Create
    @UserId UNIQUEIDENTIFIER, @TokenHash BINARY(32), @Purpose TINYINT, @ExpiresUtc DATETIME2(0),
    @MinGapSeconds INT = 60,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    -- one link a minute per person is plenty (stops "Forgot password" being used to flood an inbox)
    IF EXISTS (SELECT 1 FROM dbo.sahyog_PasswordLinks WITH (UPDLOCK, HOLDLOCK)
               WHERE UserId = @UserId AND CreatedUtc > DATEADD(SECOND, -@MinGapSeconds, SYSUTCDATETIME()))
    BEGIN ROLLBACK; SET @Result = 5; RETURN; END

    -- a new link replaces any older unused ones
    UPDATE dbo.sahyog_PasswordLinks SET UsedUtc = SYSUTCDATETIME()
    WHERE UserId = @UserId AND UsedUtc IS NULL;

    INSERT dbo.sahyog_PasswordLinks (TokenHash, UserId, Purpose, ExpiresUtc)
    VALUES (@TokenHash, @UserId, @Purpose, @ExpiresUtc);

    -- tidy up links that ended more than 30 days ago
    DELETE dbo.sahyog_PasswordLinks WHERE ExpiresUtc < DATEADD(DAY, -30, SYSUTCDATETIME());

    COMMIT;
    SET @Result = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_PasswordLink_Get
    @TokenHash BINARY(32)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.Purpose, l.ExpiresUtc, l.UsedUtc,
           u.DisplayName, u.Email, u.IsActive,
           t.Slug AS TenantSlug, t.Name AS TenantName, CAST(ISNULL(t.IsActive, 1) AS BIT) AS TenantActive
    FROM dbo.sahyog_PasswordLinks l
    JOIN dbo.sahyog_Users u ON u.UserId = l.UserId
    LEFT JOIN dbo.sahyog_Tenants t ON t.TenantId = u.TenantId
    WHERE l.TokenHash = @TokenHash;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_PasswordLink_Use
    @TokenHash BINARY(32), @NewPasswordHash NVARCHAR(400),
    @Result INT OUTPUT, @Email NVARCHAR(256) OUTPUT, @TenantSlug NVARCHAR(40) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    DECLARE @UserId UNIQUEIDENTIFIER, @Expires DATETIME2(0), @Used DATETIME2(0);
    SELECT @UserId = UserId, @Expires = ExpiresUtc, @Used = UsedUtc
    FROM dbo.sahyog_PasswordLinks WITH (UPDLOCK, HOLDLOCK)
    WHERE TokenHash = @TokenHash;

    IF @UserId IS NULL OR @Used IS NOT NULL OR @Expires < SYSUTCDATETIME()
    BEGIN ROLLBACK; SET @Result = 1; RETURN; END

    DECLARE @Active BIT, @TenantActive BIT;
    SELECT @Active = u.IsActive, @TenantActive = CAST(ISNULL(t.IsActive, 1) AS BIT),
           @Email = u.Email, @TenantSlug = t.Slug
    FROM dbo.sahyog_Users u
    LEFT JOIN dbo.sahyog_Tenants t ON t.TenantId = u.TenantId
    WHERE u.UserId = @UserId;

    IF @Active = 0 OR @TenantActive = 0
    BEGIN ROLLBACK; SET @Result = 2; RETURN; END

    UPDATE dbo.sahyog_Users
    SET PasswordHash = @NewPasswordHash, FailedLoginCount = 0, LockoutEndUtc = NULL, SecurityStamp = NEWID()
    WHERE UserId = @UserId;

    UPDATE dbo.sahyog_PasswordLinks SET UsedUtc = SYSUTCDATETIME()
    WHERE UserId = @UserId AND UsedUtc IS NULL;

    COMMIT;
    SET @Result = 0;
END
GO

/* ############################## 12_EmailFixCancelsLinks.sql ############################## */
PRINT N'Applying 12_EmailFixCancelsLinks.sql ...';
GO
/* =====================================================================
   ShankhNaad round 21 (safe to run more than once; run after 10 and 11):
     Correcting someone's email on Team → Edit now also cancels every set-password link
     that was already sent (for example a welcome email that went to a mistyped address),
     so only the new address can set the password.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_User_Update
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER,
    @DisplayName NVARCHAR(100), @Email NVARCHAR(256), @Role NVARCHAR(20),
    @NewPasswordHash NVARCHAR(400) = NULL,
    @Result INT OUTPUT, @NewStamp UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    DECLARE @OldEmail NVARCHAR(256), @OldRole NVARCHAR(20);
    SELECT @OldEmail = Email, @OldRole = Role
    FROM dbo.sahyog_Users WITH (UPDLOCK, HOLDLOCK)
    WHERE UserId = @UserId AND TenantId = @TenantId;

    IF @OldEmail IS NULL BEGIN ROLLBACK; SET @Result = 3; RETURN; END

    IF @Email <> @OldEmail
       AND EXISTS (SELECT 1 FROM dbo.sahyog_Users WITH (UPDLOCK, HOLDLOCK) WHERE Email = @Email AND UserId <> @UserId)
    BEGIN ROLLBACK; SET @Result = 1; RETURN; END

    -- never leave a workspace without an active admin
    IF @OldRole = N'TenantAdmin' AND @Role <> N'TenantAdmin'
       AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users
                       WHERE TenantId = @TenantId AND Role = N'TenantAdmin' AND IsActive = 1 AND UserId <> @UserId)
    BEGIN ROLLBACK; SET @Result = 4; RETURN; END

    DECLARE @SignOut BIT = CASE WHEN @Email <> @OldEmail OR @Role <> @OldRole OR @NewPasswordHash IS NOT NULL THEN 1 ELSE 0 END;

    UPDATE dbo.sahyog_Users
    SET DisplayName      = @DisplayName,
        Email            = @Email,
        Role             = @Role,
        PasswordHash     = COALESCE(@NewPasswordHash, PasswordHash),
        FailedLoginCount = CASE WHEN @NewPasswordHash IS NULL THEN FailedLoginCount ELSE 0 END,
        LockoutEndUtc    = CASE WHEN @NewPasswordHash IS NULL THEN LockoutEndUtc ELSE NULL END,
        SecurityStamp    = CASE WHEN @SignOut = 1 THEN NEWID() ELSE SecurityStamp END
    WHERE UserId = @UserId AND TenantId = @TenantId;

    -- New email: any set-password link still open (for example one sent to a mistyped address) stops working.
    IF @Email <> @OldEmail
        UPDATE dbo.sahyog_PasswordLinks SET UsedUtc = SYSUTCDATETIME()
        WHERE UserId = @UserId AND UsedUtc IS NULL;

    SELECT @NewStamp = SecurityStamp FROM dbo.sahyog_Users WHERE UserId = @UserId;
    COMMIT;

    SET @Result = 0;
END
GO

/* ############################## 13_InvitePending.sql ############################## */
PRINT N'Applying 13_InvitePending.sql ...';
GO
/* =====================================================================
   ShankhNaad round 22 (safe to run more than once; needs 01–02):
     Team list also returns LastLoginUtc, so the Team page can mark people who were
     invited but have never signed in ("Invited · not joined") and offer "Resend invite".
     Until this runs, the app simply shows nobody as pending.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_User_ListByTenant
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UserId, TenantId, Email, DisplayName, Role, AvatarTone, IsActive, LastLoginUtc
    FROM dbo.sahyog_Users
    WHERE TenantId = @TenantId
    ORDER BY DisplayName;
END
GO

/* ############################## 14_ChannelEdit.sql ############################## */
PRINT N'Applying 14_ChannelEdit.sql ...';
GO
/* =====================================================================
   ShankhNaad round 23 (safe to run more than once; needs 01–04):
     Rename / describe / delete group channels from Chat → Details → Edit channel.
       - Workspace admins can rename and delete any channel of their workspace.
       - The person who created a channel can rename it (not delete it).
       - The workspace's first channel (#general, the one everybody is in) can be renamed but never deleted.
     sahyog_Chat_GetChannel now also returns CreatedBy and IsMain (the app works without them until this runs).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetChannel
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @MainId UNIQUEIDENTIFIER =
        (SELECT TOP (1) ChannelId FROM dbo.sahyog_Channels
         WHERE TenantId = @TenantId AND IsDirect = 0 ORDER BY CreatedUtc, ChannelId);
    SELECT ChannelId, Name, Description, IsDirect, CreatedBy,
           CAST(CASE WHEN ChannelId = @MainId THEN 1 ELSE 0 END AS BIT) AS IsMain
    FROM dbo.sahyog_Channels
    WHERE TenantId = @TenantId AND ChannelId = @ChannelId;
END
GO

/* @Result: 0 saved, 1 not found (or a direct chat), 2 not allowed, 3 name already used */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_UpdateChannel
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT,
    @Name NVARCHAR(80), @Description NVARCHAR(300) = NULL,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @CreatedBy UNIQUEIDENTIFIER, @Found BIT = 0;
    SELECT @Found = 1, @CreatedBy = CreatedBy
    FROM dbo.sahyog_Channels WITH (UPDLOCK, HOLDLOCK)
    WHERE ChannelId = @ChannelId AND TenantId = @TenantId AND IsDirect = 0;

    IF @Found = 0 BEGIN SET @Result = 1; RETURN; END
    IF @IsAdmin = 0 AND (@CreatedBy IS NULL OR @CreatedBy <> @UserId) BEGIN SET @Result = 2; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Channels
               WHERE TenantId = @TenantId AND IsDirect = 0 AND Name = @Name AND ChannelId <> @ChannelId)
    BEGIN SET @Result = 3; RETURN; END

    UPDATE dbo.sahyog_Channels
    SET Name = @Name, Description = NULLIF(LTRIM(RTRIM(@Description)), N'')
    WHERE ChannelId = @ChannelId AND TenantId = @TenantId;

    SET @Result = 0;
END
GO

/* Deletes a group channel with its messages and files (admins only; the app checks the role).
   Meetings that were started from it are kept (they just no longer point at a channel).
   Returns one row per deleted file (StoragePath) so the app can remove them from disk.
   @Result: 0 deleted, 1 not found (or a direct chat), 4 it's the workspace's main channel (#general) */
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
    INSERT @Files (StoragePath, SizeBytes)
    SELECT StoragePath, SizeBytes FROM dbo.sahyog_Attachments WHERE ChannelId = @ChannelId AND TenantId = @TenantId;

    BEGIN TRANSACTION;
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

/* ############################## 15_ReadReceipts.sql ############################## */
PRINT N'Applying 15_ReadReceipts.sql ...';
GO
/* =====================================================================
   ShankhNaad round 24 (safe to run more than once; needs 01–02):
     Read ticks on your own messages (✓ sent, ✓✓ read).
       sahyog_Chat_MarkReadV2   marks a conversation read for someone and says whether anything changed
                                (so the app tells the senders only when there's something new to show).
       sahyog_Chat_GetReadState who in a conversation has read up to when.
     Until this runs, the app works as before without ticks.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_MarkReadV2
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER,
    @ReadUtc DATETIME2(3) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @ReadUtc = NULL;
    DECLARE @Now DATETIME2(3) = SYSUTCDATETIME();

    -- only when there is something new from someone else (keeps writes and notifications rare)
    UPDATE cm
    SET UnreadCount = 0, LastReadUtc = @Now, @ReadUtc = @Now
    FROM dbo.sahyog_ChannelMembers cm
    WHERE cm.TenantId = @TenantId AND cm.ChannelId = @ChannelId AND cm.UserId = @UserId
      AND (cm.UnreadCount > 0
           OR EXISTS (SELECT 1 FROM dbo.sahyog_Messages m
                      WHERE m.TenantId = @TenantId AND m.ChannelId = @ChannelId
                        AND m.SenderId <> @UserId AND m.SentUtc > cm.LastReadUtc));
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetReadState
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT cm.UserId, u.DisplayName, cm.LastReadUtc
    FROM dbo.sahyog_ChannelMembers cm
    JOIN dbo.sahyog_Users u ON u.UserId = cm.UserId AND u.IsActive = 1
    WHERE cm.TenantId = @TenantId AND cm.ChannelId = @ChannelId;
END
GO

/* ############################## 16_Groups.sql ############################## */
PRINT N'Applying 16_Groups.sql ...';
GO
/* =====================================================================
   ShankhNaad round 25 (safe to run more than once; needs 01–04, run after 14):
     Private groups: a group conversation with only the people you pick
     (channels stay "everyone in the workspace").
       - sahyog_Channels.IsPrivate (0 = channel for everyone, 1 = group of chosen people)
       - sahyog_Chat_CreateGroup: creates the group with you + the people picked
       - sahyog_User_Create: new people join every channel, but not private groups
       - sahyog_Chat_GetSidebar: also returns IsPrivate (group icon in the list)
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_Channels', N'IsPrivate') IS NULL
    ALTER TABLE dbo.sahyog_Channels ADD IsPrivate BIT NOT NULL CONSTRAINT DF_sahyog_Channels_IsPrivate DEFAULT (0);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_User_Create
    @UserId UNIQUEIDENTIFIER, @TenantId UNIQUEIDENTIFIER = NULL, @Email NVARCHAR(256), @DisplayName NVARCHAR(100),
    @PasswordHash NVARCHAR(400), @Role NVARCHAR(20), @AvatarTone TINYINT, @EnforceLimit BIT = 1,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    IF EXISTS (SELECT 1 FROM dbo.sahyog_Users WITH (UPDLOCK, HOLDLOCK) WHERE Email = @Email)
    BEGIN
        ROLLBACK; SET @Result = 1; RETURN;
    END

    IF @TenantId IS NOT NULL AND @EnforceLimit = 1
    BEGIN
        DECLARE @Max INT;
        SELECT @Max = COALESCE(t.MaxUsersOverride, p.MaxUsers)
        FROM dbo.sahyog_Tenants t WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.sahyog_Plans p ON p.PlanId = t.PlanId
        WHERE t.TenantId = @TenantId;

        IF (SELECT COUNT(*) FROM dbo.sahyog_Users WHERE TenantId = @TenantId AND IsActive = 1) >= @Max
        BEGIN
            ROLLBACK; SET @Result = 2; RETURN;
        END
    END

    INSERT dbo.sahyog_Users (UserId, TenantId, Email, DisplayName, PasswordHash, Role, AvatarTone)
    VALUES (@UserId, @TenantId, @Email, @DisplayName, @PasswordHash, @Role, @AvatarTone);

    IF @TenantId IS NOT NULL
        INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId)
        SELECT c.ChannelId, @UserId, @TenantId
        FROM dbo.sahyog_Channels c
        WHERE c.TenantId = @TenantId AND c.IsDirect = 0 AND c.IsPrivate = 0;   -- not into private groups

    COMMIT;
    SET @Result = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetSidebar
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.ChannelId, c.Name, c.Description, c.IsDirect, c.IsPrivate, cm.UnreadCount, c.LastMessageUtc,
           o.UserId AS OtherUserId, o.DisplayName AS OtherName, o.AvatarTone AS OtherTone
    FROM dbo.sahyog_ChannelMembers cm
    JOIN dbo.sahyog_Channels c ON c.ChannelId = cm.ChannelId AND c.TenantId = @TenantId
    OUTER APPLY (
        SELECT TOP (1) u.UserId, u.DisplayName, u.AvatarTone
        FROM dbo.sahyog_ChannelMembers m2
        JOIN dbo.sahyog_Users u ON u.UserId = m2.UserId
        WHERE c.IsDirect = 1 AND m2.ChannelId = c.ChannelId AND m2.UserId <> @UserId
    ) o
    WHERE cm.TenantId = @TenantId AND cm.UserId = @UserId;
END
GO

/* @MemberIds: comma-separated user ids. Only active people of the same workspace are added; the creator always is.
   @Result: 0 created, 1 name already used, 2 nobody else picked. Returns the members' ids. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_CreateGroup
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @Name NVARCHAR(80), @Description NVARCHAR(300) = NULL,
    @CreatedBy UNIQUEIDENTIFIER, @MemberIds NVARCHAR(MAX), @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM dbo.sahyog_Channels WHERE TenantId = @TenantId AND IsDirect = 0 AND Name = @Name)
    BEGIN SET @Result = 1; RETURN; END

    DECLARE @Members TABLE (UserId UNIQUEIDENTIFIER PRIMARY KEY);
    INSERT @Members (UserId)
    SELECT DISTINCT u.UserId
    FROM STRING_SPLIT(ISNULL(@MemberIds, N''), N',') s
    JOIN dbo.sahyog_Users u ON u.UserId = TRY_CAST(LTRIM(RTRIM(s.value)) AS UNIQUEIDENTIFIER)
    WHERE u.TenantId = @TenantId AND u.IsActive = 1 AND u.UserId <> @CreatedBy;

    IF NOT EXISTS (SELECT 1 FROM @Members) BEGIN SET @Result = 2; RETURN; END
    INSERT @Members (UserId) VALUES (@CreatedBy);

    BEGIN TRANSACTION;
        INSERT dbo.sahyog_Channels (ChannelId, TenantId, Name, Description, CreatedBy, IsPrivate)
        VALUES (@ChannelId, @TenantId, @Name, @Description, @CreatedBy, 1);
        INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId)
        SELECT @ChannelId, UserId, @TenantId FROM @Members;
    COMMIT;

    SET @Result = 0;
    SELECT UserId FROM @Members;
END
GO

/* ############################## 17_DeleteChatWithCalls.sql ############################## */
PRINT N'Applying 17_DeleteChatWithCalls.sql ...';
GO
/* =====================================================================
   ShankhNaad round 26 (safe to run more than once; needs 04):
     Fix: deleting a one-to-one chat failed with "FK_sahyog_Meetings_Channels"
     when a call had been started from that chat. The call (meeting) is kept and
     simply no longer points at the deleted chat.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
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

    BEGIN TRANSACTION;
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

/* ############################## 18_EveryoneAndPins.sql ############################## */
PRINT N'Applying 18_EveryoneAndPins.sql ...';
GO
/* =====================================================================
   ShankhNaad round 27 (safe to run more than once; run after 16):
     - No more "channels": the workspace's main channel (#general) becomes the group "Everyone"
       (everybody stays in it, new people still join it automatically, messages are kept);
       any other channel becomes a normal group with the same members.
     - New workspaces start with "Everyone" instead of "#general".
     - Pinned chats: each person can pin chats to the top of their own list.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_ChannelMembers', N'IsPinned') IS NULL
    ALTER TABLE dbo.sahyog_ChannelMembers ADD IsPinned BIT NOT NULL CONSTRAINT DF_sahyog_ChannelMembers_IsPinned DEFAULT (0);
IF COL_LENGTH(N'dbo.sahyog_ChannelMembers', N'PinnedUtc') IS NULL
    ALTER TABLE dbo.sahyog_ChannelMembers ADD PinnedUtc DATETIME2(3) NULL;
GO

-- each workspace's first channel → "Everyone" (only if it's still called general and the name is free)
;WITH main AS (
    SELECT c.ChannelId, c.TenantId, c.Name,
           ROW_NUMBER() OVER (PARTITION BY c.TenantId ORDER BY c.CreatedUtc, c.ChannelId) AS rn
    FROM dbo.sahyog_Channels c WHERE c.IsDirect = 0
)
UPDATE c SET Name = N'Everyone', Description = N'Everyone in the workspace', IsPrivate = 0
FROM dbo.sahyog_Channels c
JOIN main m ON m.ChannelId = c.ChannelId AND m.rn = 1
WHERE c.Name = N'general'
  AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Channels x WHERE x.TenantId = c.TenantId AND x.IsDirect = 0 AND x.Name = N'Everyone');
GO

-- every other channel → a group (same members, messages kept)
;WITH main AS (
    SELECT c.ChannelId, ROW_NUMBER() OVER (PARTITION BY c.TenantId ORDER BY c.CreatedUtc, c.ChannelId) AS rn
    FROM dbo.sahyog_Channels c WHERE c.IsDirect = 0
)
UPDATE c SET IsPrivate = 1
FROM dbo.sahyog_Channels c
JOIN main m ON m.ChannelId = c.ChannelId AND m.rn > 1
WHERE c.IsPrivate = 0;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_Create
    @TenantId UNIQUEIDENTIFIER, @Name NVARCHAR(120), @Slug NVARCHAR(40), @PlanId INT, @TimeZoneId NVARCHAR(64),
    @AdminUserId UNIQUEIDENTIFIER, @AdminEmail NVARCHAR(256), @AdminName NVARCHAR(100),
    @AdminPasswordHash NVARCHAR(400), @AdminTone TINYINT,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM dbo.sahyog_Tenants WHERE Slug = @Slug) BEGIN SET @Result = 1; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE Email = @AdminEmail) BEGIN SET @Result = 2; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Plans WHERE PlanId = @PlanId) BEGIN SET @Result = 3; RETURN; END

    DECLARE @GeneralId UNIQUEIDENTIFIER = NEWID();

    BEGIN TRANSACTION;
        INSERT dbo.sahyog_Tenants (TenantId, Name, Slug, PlanId, TimeZoneId)
        VALUES (@TenantId, @Name, @Slug, @PlanId, @TimeZoneId);

        INSERT dbo.sahyog_Users (UserId, TenantId, Email, DisplayName, PasswordHash, Role, AvatarTone)
        VALUES (@AdminUserId, @TenantId, @AdminEmail, @AdminName, @AdminPasswordHash, N'TenantAdmin', @AdminTone);

        INSERT dbo.sahyog_Channels (ChannelId, TenantId, Name, Description, CreatedBy)
        VALUES (@GeneralId, @TenantId, N'Everyone', N'Everyone in the workspace', @AdminUserId);

        INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId)
        VALUES (@GeneralId, @AdminUserId, @TenantId);
    COMMIT;

    SET @Result = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetSidebar
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.ChannelId, c.Name, c.Description, c.IsDirect, c.IsPrivate, cm.IsPinned, cm.PinnedUtc, cm.UnreadCount, c.LastMessageUtc,
           o.UserId AS OtherUserId, o.DisplayName AS OtherName, o.AvatarTone AS OtherTone
    FROM dbo.sahyog_ChannelMembers cm
    JOIN dbo.sahyog_Channels c ON c.ChannelId = cm.ChannelId AND c.TenantId = @TenantId
    OUTER APPLY (
        SELECT TOP (1) u.UserId, u.DisplayName, u.AvatarTone
        FROM dbo.sahyog_ChannelMembers m2
        JOIN dbo.sahyog_Users u ON u.UserId = m2.UserId
        WHERE c.IsDirect = 1 AND m2.ChannelId = c.ChannelId AND m2.UserId <> @UserId
    ) o
    WHERE cm.TenantId = @TenantId AND cm.UserId = @UserId;
END
GO

/* Pin or unpin a chat for one person (pins are personal). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_SetPinned
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Pinned BIT, @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_ChannelMembers
    SET IsPinned = @Pinned, PinnedUtc = CASE WHEN @Pinned = 1 THEN SYSUTCDATETIME() ELSE NULL END
    WHERE TenantId = @TenantId AND ChannelId = @ChannelId AND UserId = @UserId;
    SET @Result = CASE WHEN @@ROWCOUNT = 0 THEN 1 ELSE 0 END;
END
GO

/* ############################## 19_PersonTimeline.sql ############################## */
PRINT N'Applying 19_PersonTimeline.sql ...';
GO
/* =====================================================================
   ShankhNaad round 28 (safe to run more than once; needs 01–02):
     Clicking a person shows your private chat with them PLUS what either of you wrote
     in groups you're both in (e.g. "Everyone"), newest first. Replies still go to the private chat.
     FromGroup = the group's name for group messages, NULL for private ones.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetPersonTimeline
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER,      -- the private (direct) chat
    @UserId UNIQUEIDENTIFIER, @OtherId UNIQUEIDENTIFIER,
    @BeforeId BIGINT = NULL, @Take INT = 301
AS
BEGIN
    SET NOCOUNT ON;
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
             AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers a WHERE a.ChannelId = c.ChannelId AND a.UserId = @UserId)
             AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers b WHERE b.ChannelId = c.ChannelId AND b.UserId = @OtherId))
          )
    ORDER BY v.MessageId DESC;
END
GO

/* ############################## 20_UserPhotos.sql ############################## */
PRINT N'Applying 20_UserPhotos.sql ...';
GO
/* =====================================================================
   ShankhNaad round 29 (safe to run more than once; needs 01–02):
     Profile photos, stored in the database. The browser shrinks every photo to a small
     square (192 × 192 JPEG, usually 10–25 KB) before uploading; the server accepts up to 200 KB.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_UserPhotos', N'U') IS NULL
CREATE TABLE dbo.sahyog_UserPhotos
(
    UserId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_UserPhotos PRIMARY KEY
                CONSTRAINT FK_sahyog_UserPhotos_Users REFERENCES dbo.sahyog_Users(UserId) ON DELETE CASCADE,
    TenantId    UNIQUEIDENTIFIER NOT NULL,
    Photo       VARBINARY(MAX)  NOT NULL,
    ContentType NVARCHAR(40)    NOT NULL,
    UpdatedUtc  DATETIME2(3)    NOT NULL CONSTRAINT DF_sahyog_UserPhotos_Updated DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_UserPhotos_Tenant')
    CREATE INDEX IX_sahyog_UserPhotos_Tenant ON dbo.sahyog_UserPhotos(TenantId) INCLUDE (UpdatedUtc);
GO

/* Saves (or replaces) a person's photo. @Result: 0 saved, 1 that person isn't in this workspace. */
CREATE OR ALTER PROCEDURE dbo.sahyog_UserPhoto_Set
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Photo VARBINARY(MAX), @ContentType NVARCHAR(40),
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId)
    BEGIN SET @Result = 1; RETURN; END

    MERGE dbo.sahyog_UserPhotos WITH (HOLDLOCK) AS t
    USING (SELECT @UserId AS UserId) AS s ON t.UserId = s.UserId
    WHEN MATCHED THEN UPDATE SET Photo = @Photo, ContentType = @ContentType, UpdatedUtc = SYSUTCDATETIME(), TenantId = @TenantId
    WHEN NOT MATCHED THEN INSERT (UserId, TenantId, Photo, ContentType) VALUES (@UserId, @TenantId, @Photo, @ContentType);
    SET @Result = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_UserPhoto_Get
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Photo, ContentType, UpdatedUtc FROM dbo.sahyog_UserPhotos WHERE UserId = @UserId AND TenantId = @TenantId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_UserPhoto_Delete
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_UserPhotos WHERE UserId = @UserId AND TenantId = @TenantId;
END
GO

/* Who in the workspace has a photo, and when it last changed (the page uses it to show photos on avatars). */
CREATE OR ALTER PROCEDURE dbo.sahyog_UserPhoto_List
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UserId, UpdatedUtc FROM dbo.sahyog_UserPhotos WHERE TenantId = @TenantId;
END
GO

/* ############################## 21_DeleteChatClearsAll.sql ############################## */
PRINT N'Applying 21_DeleteChatClearsAll.sql ...';
GO
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

/* ############################## 22_CallLog.sql ############################## */
PRINT N'Applying 22_CallLog.sql ...';
GO
/* =====================================================================
   ShankhNaad round 31 (safe to run more than once; needs 01–02):
     Call history for calls started from Chat, so a chat shows one card per call
     ("Calling…", "Call in progress · Join", "Call ended · 4m 12s", "Missed call", "Declined")
     instead of a new "Join" card every time.
   Outcome: 0 ringing, 1 in progress, 2 ended, 3 not answered, 4 declined, 5 cancelled by the caller.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_CallLog', N'U') IS NULL
CREATE TABLE dbo.sahyog_CallLog
(
    MeetingId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_CallLog PRIMARY KEY,
    TenantId    UNIQUEIDENTIFIER NOT NULL,
    ChannelId   UNIQUEIDENTIFIER NULL,
    CallerId    UNIQUEIDENTIFIER NOT NULL,
    StartedUtc  DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_CallLog_Started DEFAULT (SYSUTCDATETIME()),
    AnsweredUtc DATETIME2(3)     NULL,
    EndedUtc    DATETIME2(3)     NULL,
    Outcome     TINYINT          NOT NULL CONSTRAINT DF_sahyog_CallLog_Outcome DEFAULT (0),
    EndedBy     UNIQUEIDENTIFIER NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_CallLog_Channel')
    CREATE INDEX IX_sahyog_CallLog_Channel ON dbo.sahyog_CallLog(TenantId, ChannelId, StartedUtc DESC) INCLUDE (Outcome);
GO

/* A new call. */
CREATE OR ALTER PROCEDURE dbo.sahyog_CallLog_Start
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER = NULL, @CallerId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_CallLog WHERE MeetingId = @MeetingId)
        INSERT dbo.sahyog_CallLog (MeetingId, TenantId, ChannelId, CallerId) VALUES (@MeetingId, @TenantId, @ChannelId, @CallerId);
END
GO

/* A call in this chat that is still ringing (under 45 s) or in progress, so pressing Call again rings the same call. */
CREATE OR ALTER PROCEDURE dbo.sahyog_CallLog_GetOpen
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) MeetingId, CallerId, Outcome
    FROM dbo.sahyog_CallLog
    WHERE TenantId = @TenantId AND ChannelId = @ChannelId
      AND (Outcome = 1 OR (Outcome = 0 AND StartedUtc > DATEADD(SECOND, -45, SYSUTCDATETIME())))
    ORDER BY StartedUtc DESC;
END
GO

/* @Event: 1 someone else joined (answered), 2 the room is now empty, 4 declined, 3 not answered.
   @Changed = 1 when the call's state actually changed. */
CREATE OR ALTER PROCEDURE dbo.sahyog_CallLog_Event
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Event TINYINT,
    @Changed BIT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Changed = 0;
    DECLARE @now DATETIME2(3) = SYSUTCDATETIME();

    IF @Event = 1
        UPDATE dbo.sahyog_CallLog SET Outcome = 1, AnsweredUtc = @now, EndedUtc = NULL
        WHERE MeetingId = @MeetingId AND TenantId = @TenantId AND CallerId <> @UserId AND Outcome IN (0, 3, 5);
    ELSE IF @Event = 2
        UPDATE dbo.sahyog_CallLog
           SET Outcome = CASE WHEN Outcome = 1 THEN 2
                              WHEN StartedUtc <= DATEADD(SECOND, -30, @now) THEN 3
                              ELSE 5 END,
               EndedUtc = @now, EndedBy = @UserId
        WHERE MeetingId = @MeetingId AND TenantId = @TenantId AND Outcome IN (0, 1);
    ELSE IF @Event = 4
        UPDATE dbo.sahyog_CallLog SET Outcome = 4, EndedUtc = @now, EndedBy = @UserId
        WHERE MeetingId = @MeetingId AND TenantId = @TenantId AND Outcome = 0 AND CallerId <> @UserId;
    ELSE IF @Event = 3
        UPDATE dbo.sahyog_CallLog SET Outcome = 3
        WHERE MeetingId = @MeetingId AND TenantId = @TenantId AND Outcome = 0;

    IF @@ROWCOUNT > 0 SET @Changed = 1;

    SELECT MeetingId, ChannelId, CallerId, StartedUtc, AnsweredUtc, EndedUtc,
           CASE WHEN Outcome = 0 AND StartedUtc <= DATEADD(SECOND, -45, @now) THEN 3 ELSE Outcome END AS Outcome
    FROM dbo.sahyog_CallLog WHERE MeetingId = @MeetingId AND TenantId = @TenantId;
END
GO

/* The calls behind call cards in a chat. @Ids: comma-separated meeting ids. Ringing for over 45 s counts as not answered. */
CREATE OR ALTER PROCEDURE dbo.sahyog_CallLog_Get
    @TenantId UNIQUEIDENTIFIER, @Ids NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
    SELECT c.MeetingId, c.ChannelId, c.CallerId, c.StartedUtc, c.AnsweredUtc, c.EndedUtc,
           CASE WHEN c.Outcome = 0 AND c.StartedUtc <= DATEADD(SECOND, -45, @now) THEN 3 ELSE c.Outcome END AS Outcome
    FROM dbo.sahyog_CallLog c
    WHERE c.TenantId = @TenantId
      AND c.MeetingId IN (SELECT TRY_CAST(LTRIM(RTRIM(value)) AS UNIQUEIDENTIFIER) FROM STRING_SPLIT(@Ids, ','));
END
GO

/* ############################## 23_CallsAndFiles.sql ############################## */
PRINT N'Applying 23_CallsAndFiles.sql ...';
GO
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

/* ############################## 24_HistoryDelete.sql ############################## */
PRINT N'Applying 24_HistoryDelete.sql ...';
GO
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

/* ############################## 25_CallChat.sql ############################## */
PRINT N'Applying 25_CallChat.sql ...';
GO
/* =====================================================================
   ShankhNaad round 34 (safe to run more than once; needs 01–02):
     Chat inside a call: messages and files everyone in the call sees
     (like the meeting chat in Microsoft Teams). Kept with the meeting, so
     people who join later, or rejoin, see what was said and shared.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_CallChat', N'U') IS NULL
CREATE TABLE dbo.sahyog_CallChat
(
    MessageId    BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_sahyog_CallChat PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL,
    MeetingId    UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_CallChat_Meetings REFERENCES dbo.sahyog_Meetings(MeetingId) ON DELETE CASCADE,
    SenderId     UNIQUEIDENTIFIER NULL,          -- NULL = a guest
    SenderName   NVARCHAR(120)    NOT NULL,
    SenderTone   INT              NOT NULL CONSTRAINT DF_sahyog_CallChat_Tone DEFAULT (3),
    Body         NVARCHAR(2000)   NULL,
    FileId       UNIQUEIDENTIFIER NULL,
    FileName     NVARCHAR(255)    NULL,
    ContentType  NVARCHAR(150)    NULL,
    SizeBytes    BIGINT           NULL,
    StoragePath  NVARCHAR(400)    NULL,
    SentUtc      DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_CallChat_Sent DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_CallChat_Meeting')
    CREATE INDEX IX_sahyog_CallChat_Meeting ON dbo.sahyog_CallChat(MeetingId, MessageId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_sahyog_CallChat_File')
    CREATE UNIQUE INDEX UX_sahyog_CallChat_File ON dbo.sahyog_CallChat(FileId) WHERE FileId IS NOT NULL;
GO

/* A message (text, or a file) in a call. A file counts toward the workspace's storage;
   @Result: 0 sent, 1 no such meeting, 2 storage full. */
CREATE OR ALTER PROCEDURE dbo.sahyog_CallChat_Add
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER,
    @SenderId UNIQUEIDENTIFIER = NULL, @SenderName NVARCHAR(120), @SenderTone INT = 3,
    @Body NVARCHAR(2000) = NULL,
    @FileId UNIQUEIDENTIFIER = NULL, @FileName NVARCHAR(255) = NULL, @ContentType NVARCHAR(150) = NULL,
    @SizeBytes BIGINT = NULL, @StoragePath NVARCHAR(400) = NULL,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Meetings WHERE MeetingId = @MeetingId AND TenantId = @TenantId)
    BEGIN SET @Result = 1; RETURN; END

    DECLARE @Id BIGINT;
    BEGIN TRANSACTION;
        IF @FileId IS NOT NULL
        BEGIN
            UPDATE t SET StorageUsedBytes = t.StorageUsedBytes + @SizeBytes
            FROM dbo.sahyog_Tenants t JOIN dbo.sahyog_Plans p ON p.PlanId = t.PlanId
            WHERE t.TenantId = @TenantId
              AND t.StorageUsedBytes + @SizeBytes <= COALESCE(t.StorageQuotaMbOverride, p.StorageQuotaMb) * CAST(1048576 AS BIGINT);
            IF @@ROWCOUNT = 0 BEGIN ROLLBACK; SET @Result = 2; RETURN; END
        END

        INSERT dbo.sahyog_CallChat (TenantId, MeetingId, SenderId, SenderName, SenderTone, Body, FileId, FileName, ContentType, SizeBytes, StoragePath)
        VALUES (@TenantId, @MeetingId, @SenderId, @SenderName, @SenderTone, @Body, @FileId, @FileName, @ContentType, @SizeBytes, @StoragePath);
        SET @Id = SCOPE_IDENTITY();
    COMMIT;

    SET @Result = 0;
    SELECT MessageId, MeetingId, SenderId, SenderName, SenderTone, Body, FileId, FileName, ContentType, SizeBytes, SentUtc
    FROM dbo.sahyog_CallChat WHERE MessageId = @Id;
END
GO

/* The chat of a call, oldest first (the last @Take messages). */
CREATE OR ALTER PROCEDURE dbo.sahyog_CallChat_List
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @Take INT = 300
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM (
        SELECT TOP (@Take) MessageId, MeetingId, SenderId, SenderName, SenderTone, Body, FileId, FileName, ContentType, SizeBytes, SentUtc
        FROM dbo.sahyog_CallChat
        WHERE TenantId = @TenantId AND MeetingId = @MeetingId
        ORDER BY MessageId DESC) x
    ORDER BY MessageId;
END
GO

/* One shared file (to download it). */
CREATE OR ALTER PROCEDURE dbo.sahyog_CallChat_GetFile
    @TenantId UNIQUEIDENTIFIER, @FileId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT MeetingId, FileName, ContentType, SizeBytes, StoragePath
    FROM dbo.sahyog_CallChat WHERE TenantId = @TenantId AND FileId = @FileId;
END
GO

/* ############################## 26_MessageReactions.sql ############################## */
PRINT N'Applying 26_MessageReactions.sql ...';
GO
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

/* ############################## 27_MessageReplies.sql ############################## */
PRINT N'Applying 27_MessageReplies.sql ...';
GO
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

/* ############################## 29_GroupMembers.sql ############################## */
PRINT N'Applying 29_GroupMembers.sql ...';
GO
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


/* ############################## 30_Location.sql ############################## */
PRINT N'Applying 30_Location.sql ...';
GO
/* =====================================================================
   ShankhNaad round 39 (safe to run more than once; needs 01–29):
     Team member location.
     1. The super admin switches it on per client (off by default).
     2. A workspace admin lists the office's internet addresses: people connecting from one show "In office".
     3. Each person decides for themselves whether to share (nothing is stored until they say yes).
        Only the LATEST location is kept (no history). Turning sharing off, or the super admin
        switching the feature off, erases what was stored.
   Both tables cascade when a client or a person is deleted, so nothing else had to change.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_TenantLocation', N'U') IS NULL
CREATE TABLE dbo.sahyog_TenantLocation
(
    TenantId    UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_TenantLocation PRIMARY KEY
                CONSTRAINT FK_sahyog_TenantLocation_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Enabled     BIT              NOT NULL CONSTRAINT DF_sahyog_TenantLocation_Enabled DEFAULT (0),
    OfficeIps   NVARCHAR(2000)   NULL,          -- one address or range (CIDR) per line
    UpdatedUtc  DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_TenantLocation_Updated DEFAULT (SYSUTCDATETIME())
);
GO

IF OBJECT_ID(N'dbo.sahyog_UserLocations', N'U') IS NULL
CREATE TABLE dbo.sahyog_UserLocations
(
    UserId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_UserLocations PRIMARY KEY
                CONSTRAINT FK_sahyog_UserLocations_Users REFERENCES dbo.sahyog_Users(UserId) ON DELETE CASCADE,
    TenantId    UNIQUEIDENTIFIER NOT NULL,
    Sharing     BIT              NULL,          -- NULL = not asked yet, 0 = said no, 1 = shares
    InOffice    BIT              NULL,
    Ip          VARCHAR(45)      NULL,
    Lat         FLOAT            NULL,
    Lng         FLOAT            NULL,
    AccuracyM   INT              NULL,
    Address     NVARCHAR(300)    NULL,
    Area        NVARCHAR(120)    NULL,
    City        NVARCHAR(120)    NULL,
    Region      NVARCHAR(120)    NULL,
    Country     NVARCHAR(80)     NULL,
    PreciseUtc  DATETIME2(3)     NULL,          -- when the map position was taken
    SeenUtc     DATETIME2(3)     NULL           -- last check-in (office / remote)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_UserLocations_Tenant')
    CREATE INDEX IX_sahyog_UserLocations_Tenant ON dbo.sahyog_UserLocations(TenantId);
GO

/* ---------- a client's setting ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_TenantGet @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT CAST(COALESCE(MAX(CAST(Enabled AS INT)), 0) AS BIT) AS Enabled, MAX(OfficeIps) AS OfficeIps
    FROM dbo.sahyog_TenantLocation WHERE TenantId = @TenantId;
END
GO

/* every client that has it switched on (the super admin list) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_TenantList
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TenantId FROM dbo.sahyog_TenantLocation WHERE Enabled = 1;
END
GO

/* super admin: on / off. Off also erases every stored location of that client (people's yes/no is kept). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_TenantSetEnabled @TenantId UNIQUEIDENTIFIER, @Enabled BIT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Tenants WHERE TenantId = @TenantId) BEGIN SELECT 0 AS Affected; RETURN; END
    MERGE dbo.sahyog_TenantLocation AS t
    USING (SELECT @TenantId AS TenantId) AS s ON t.TenantId = s.TenantId
    WHEN MATCHED THEN UPDATE SET Enabled = @Enabled, UpdatedUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (TenantId, Enabled) VALUES (@TenantId, @Enabled);
    IF @Enabled = 0
        UPDATE dbo.sahyog_UserLocations
        SET InOffice = NULL, Ip = NULL, Lat = NULL, Lng = NULL, AccuracyM = NULL, Address = NULL, Area = NULL,
            City = NULL, Region = NULL, Country = NULL, PreciseUtc = NULL, SeenUtc = NULL
        WHERE TenantId = @TenantId;
    SELECT 1 AS Affected;
END
GO

/* workspace admin: the office's internet addresses */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_TenantSetOffice @TenantId UNIQUEIDENTIFIER, @OfficeIps NVARCHAR(2000)
AS
BEGIN
    SET NOCOUNT ON;
    MERGE dbo.sahyog_TenantLocation AS t
    USING (SELECT @TenantId AS TenantId) AS s ON t.TenantId = s.TenantId
    WHEN MATCHED THEN UPDATE SET OfficeIps = NULLIF(@OfficeIps, N''), UpdatedUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (TenantId, Enabled, OfficeIps) VALUES (@TenantId, 0, NULLIF(@OfficeIps, N''));
END
GO

/* ---------- one person's choice ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_UserGetSharing @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Sharing FROM dbo.sahyog_UserLocations WHERE UserId = @UserId AND TenantId = @TenantId;
END
GO

/* yes / no. No erases what was stored. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_UserSetSharing @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Sharing BIT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId) RETURN;
    MERGE dbo.sahyog_UserLocations AS t
    USING (SELECT @UserId AS UserId) AS s ON t.UserId = s.UserId
    WHEN MATCHED THEN UPDATE SET Sharing = @Sharing
    WHEN NOT MATCHED THEN INSERT (UserId, TenantId, Sharing) VALUES (@UserId, @TenantId, @Sharing);
    IF @Sharing = 0
        UPDATE dbo.sahyog_UserLocations
        SET InOffice = NULL, Ip = NULL, Lat = NULL, Lng = NULL, AccuracyM = NULL, Address = NULL, Area = NULL,
            City = NULL, Region = NULL, Country = NULL, PreciseUtc = NULL, SeenUtc = NULL
        WHERE UserId = @UserId;
END
GO

/* a check-in. Only stored when the client has it on AND the person shares.
   @Lat NULL = no map position this time (office / remote only; the last position stays). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_UserSave
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Ip VARCHAR(45), @InOffice BIT,
    @Lat FLOAT, @Lng FLOAT, @AccuracyM INT,
    @Address NVARCHAR(300), @Area NVARCHAR(120), @City NVARCHAR(120), @Region NVARCHAR(120), @Country NVARCHAR(80),
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_TenantLocation WHERE TenantId = @TenantId AND Enabled = 1) BEGIN SET @Result = 1; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_UserLocations WHERE UserId = @UserId AND TenantId = @TenantId AND Sharing = 1) BEGIN SET @Result = 2; RETURN; END
    UPDATE dbo.sahyog_UserLocations
    SET Ip = @Ip, InOffice = @InOffice, SeenUtc = SYSUTCDATETIME(),
        Lat       = CASE WHEN @Lat IS NULL THEN Lat ELSE @Lat END,
        Lng       = CASE WHEN @Lat IS NULL THEN Lng ELSE @Lng END,
        AccuracyM = CASE WHEN @Lat IS NULL THEN AccuracyM ELSE @AccuracyM END,
        PreciseUtc= CASE WHEN @Lat IS NULL THEN PreciseUtc ELSE SYSUTCDATETIME() END,
        Address   = CASE WHEN @Lat IS NULL OR @City IS NULL THEN Address ELSE @Address END,
        Area      = CASE WHEN @Lat IS NULL OR @City IS NULL THEN Area ELSE @Area END,
        City      = CASE WHEN @Lat IS NULL OR @City IS NULL THEN City ELSE @City END,
        Region    = CASE WHEN @Lat IS NULL OR @City IS NULL THEN Region ELSE @Region END,
        Country   = CASE WHEN @Lat IS NULL OR @City IS NULL THEN Country ELSE @Country END
    WHERE UserId = @UserId AND TenantId = @TenantId;
    SET @Result = 0;
END
GO

/* everyone's latest (active people of the client) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_List @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.UserId, l.Sharing, l.InOffice, l.Lat, l.Lng, l.AccuracyM, l.Address, l.Area, l.City, l.Region, l.Country,
           l.PreciseUtc, l.SeenUtc
    FROM dbo.sahyog_UserLocations l
    JOIN dbo.sahyog_Users u ON u.UserId = l.UserId AND u.TenantId = @TenantId
    WHERE l.TenantId = @TenantId;
END
GO

PRINT N'30_Location.sql applied.';
GO


/* ############################## 31_OfficeSuggestion.sql ############################## */
PRINT N'Applying 31_OfficeSuggestion.sql ...';
GO
/* =====================================================================
   ShankhNaad round 40 (safe to run more than once; needs 30_Location.sql):
     "4 people are connecting from 49.205.32.120. Is this your office?"
     How many people (who share their location) connected from each internet address recently.
     Read-only: nothing is stored or changed by this script except the new procedure.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Location_IpCounts @TenantId UNIQUEIDENTIFIER, @SinceUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.Ip, COUNT(DISTINCT l.UserId) AS People
    FROM dbo.sahyog_UserLocations l
    JOIN dbo.sahyog_Users u ON u.UserId = l.UserId AND u.TenantId = @TenantId AND u.IsActive = 1
    WHERE l.TenantId = @TenantId AND l.Sharing = 1 AND l.Ip IS NOT NULL AND l.SeenUtc >= @SinceUtc
    GROUP BY l.Ip
    ORDER BY COUNT(DISTINCT l.UserId) DESC;
END
GO

PRINT N'31_OfficeSuggestion.sql applied.';
GO

/* ############################## 32_OutOfOfficeAndEdit.sql ############################## */
PRINT N'Applying 32_OutOfOfficeAndEdit.sql ...';
GO
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

PRINT N'32_OutOfOfficeAndEdit.sql applied.';
GO

/* ############################## 33_OutOfOfficeDates.sql ############################## */
PRINT N'Applying 33_OutOfOfficeDates.sql ...';
GO
/* =====================================================================
   ShankhNaad round 42 (safe to run more than once; needs 32_OutOfOfficeAndEdit.sql):
     Out of office from one date to another ("24 Nov → 28 Nov"), so it can be set in advance.
     Adds StartUtc to sahyog_OutOfOffice (empty = starts now) and updates the two procedures.
     Nothing is removed; an Out of office already set keeps working.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_OutOfOffice', N'StartUtc') IS NULL
    ALTER TABLE dbo.sahyog_OutOfOffice ADD StartUtc DATETIME2(3) NULL;   -- NULL = from when it was set
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Ooo_Set
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Message NVARCHAR(500), @UntilUtc DATETIME2(3),
    @StartUtc DATETIME2(3) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId) RETURN;
    MERGE dbo.sahyog_OutOfOffice AS t
    USING (SELECT @UserId AS UserId) AS s ON t.UserId = s.UserId
    WHEN MATCHED THEN UPDATE SET Message = NULLIF(@Message, N''), UntilUtc = @UntilUtc, StartUtc = @StartUtc, SinceUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (UserId, TenantId, Message, UntilUtc, StartUtc) VALUES (@UserId, @TenantId, NULLIF(@Message, N''), @UntilUtc, @StartUtc);
END
GO

/* everyone out of office now or later (ended ones are tidied away) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Ooo_List @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_OutOfOffice WHERE TenantId = @TenantId AND UntilUtc IS NOT NULL AND UntilUtc <= SYSUTCDATETIME();
    SELECT o.UserId, o.Message, o.UntilUtc, o.SinceUtc, o.StartUtc
    FROM dbo.sahyog_OutOfOffice o
    JOIN dbo.sahyog_Users u ON u.UserId = o.UserId AND u.TenantId = @TenantId AND u.IsActive = 1
    WHERE o.TenantId = @TenantId;
END
GO

PRINT N'33_OutOfOfficeDates.sql applied.';
GO

/* =====================================================================
   ShankhNaad round 43 (safe to run more than once; needs 06_CustomRepeat.sql):
     Cancel a meeting (a repeating series is cancelled all together).
       - sahyog_Meetings gets CancelledUtc / CancelledById / CancelNote: a cancelled meeting stays on
         everyone's calendar, marked "Cancelled", instead of disappearing.
       - sahyog_MeetingHidden: each person can remove a cancelled meeting from their own calendar.
     The calendar list and meeting procedures now return who cancelled it and why, and leave out
     meetings the person removed. The guest link of a cancelled meeting stops working.
     Nothing is removed; existing meetings keep working.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_Meetings', N'CancelledUtc') IS NULL
    ALTER TABLE dbo.sahyog_Meetings ADD CancelledUtc DATETIME2(0) NULL;          -- NULL = not cancelled
IF COL_LENGTH(N'dbo.sahyog_Meetings', N'CancelledById') IS NULL
    ALTER TABLE dbo.sahyog_Meetings ADD CancelledById UNIQUEIDENTIFIER NULL;
IF COL_LENGTH(N'dbo.sahyog_Meetings', N'CancelNote') IS NULL
    ALTER TABLE dbo.sahyog_Meetings ADD CancelNote NVARCHAR(500) NULL;
GO

/* a person removed this (cancelled) meeting from their own calendar */
IF OBJECT_ID(N'dbo.sahyog_MeetingHidden', N'U') IS NULL
CREATE TABLE dbo.sahyog_MeetingHidden
(
    MeetingId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_MeetingHidden_Meetings REFERENCES dbo.sahyog_Meetings(MeetingId) ON DELETE CASCADE,
    UserId      UNIQUEIDENTIFIER NOT NULL,
    HiddenUtc   DATETIME2(0)     NOT NULL CONSTRAINT DF_sahyog_MeetingHidden_Utc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sahyog_MeetingHidden PRIMARY KEY (UserId, MeetingId)
);
GO

/* the calendar: as before, plus who cancelled and why; minus meetings this person removed */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_ListForUser
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @FromUtc DATETIME2(0), @ToUtc DATETIME2(0)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT m.MeetingId, m.Title, m.Agenda, m.StartUtc, m.DurationMinutes, m.Recurrence, m.RoomName, m.GuestCode,
           m.HostId, h.DisplayName AS HostName, h.AvatarTone AS HostTone, m.ChannelId, m.IsInstant,
           m.GuestLinkEnabled, m.LobbyEnabled, m.CaptionsOn, m.IsAllDay, m.ShowAsFree,
           m.RepeatDays, m.RepeatUntilUtc,
           m.CancelledUtc, m.CancelNote, cb.DisplayName AS CancelledByName
    INTO #m
    FROM dbo.sahyog_Meetings m
    JOIN dbo.sahyog_Users h ON h.UserId = m.HostId
    LEFT JOIN dbo.sahyog_Users cb ON cb.UserId = m.CancelledById
    WHERE m.TenantId = @TenantId
      AND m.StartUtc < @ToUtc
      AND (   (m.Recurrence <> 0 AND (m.RepeatUntilUtc IS NULL OR m.RepeatUntilUtc >= DATEADD(DAY, -1, @FromUtc)))
           OR m.StartUtc >= DATEADD(DAY, -1, @FromUtc))
      AND (m.HostId = @UserId
           OR EXISTS (SELECT 1 FROM dbo.sahyog_MeetingInvitees i WHERE i.MeetingId = m.MeetingId AND i.UserId = @UserId))
      AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_MeetingHidden x WHERE x.UserId = @UserId AND x.MeetingId = m.MeetingId);

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
           m.RepeatDays, m.RepeatUntilUtc,
           m.CancelledUtc, m.CancelNote, cb.DisplayName AS CancelledByName,
           c.Name AS ChannelName, c.IsDirect AS ChannelIsDirect
    FROM dbo.sahyog_Meetings m
    JOIN dbo.sahyog_Users h ON h.UserId = m.HostId
    LEFT JOIN dbo.sahyog_Users cb ON cb.UserId = m.CancelledById
    LEFT JOIN dbo.sahyog_Channels c ON c.ChannelId = m.ChannelId
    WHERE m.TenantId = @TenantId AND m.MeetingId = @MeetingId;
END
GO

/* Cancel a meeting (a repeating meeting: the whole series). Only the host or a workspace admin.
   @Result: 0 cancelled, 1 not found, 2 not allowed, 3 already cancelled */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_Cancel
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT,
    @Note NVARCHAR(500) = NULL, @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @HostId UNIQUEIDENTIFIER, @Cancelled DATETIME2(0);
    SELECT @HostId = HostId, @Cancelled = CancelledUtc FROM dbo.sahyog_Meetings WHERE TenantId = @TenantId AND MeetingId = @MeetingId;

    IF @HostId IS NULL BEGIN SET @Result = 1; RETURN; END
    IF @HostId <> @UserId AND @IsAdmin = 0 BEGIN SET @Result = 2; RETURN; END
    IF @Cancelled IS NOT NULL BEGIN SET @Result = 3; RETURN; END

    UPDATE dbo.sahyog_Meetings
    SET CancelledUtc = SYSUTCDATETIME(), CancelledById = @UserId, CancelNote = NULLIF(LTRIM(RTRIM(@Note)), N'')
    WHERE TenantId = @TenantId AND MeetingId = @MeetingId;
    SET @Result = 0;
END
GO

/* Remove a cancelled meeting from my own calendar (the host and everyone invited can).
   @Result: 0 removed, 1 not found / not mine, 2 not cancelled (only cancelled meetings can be removed this way) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_Hide
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @HostId UNIQUEIDENTIFIER, @Cancelled DATETIME2(0);
    SELECT @HostId = HostId, @Cancelled = CancelledUtc FROM dbo.sahyog_Meetings WHERE TenantId = @TenantId AND MeetingId = @MeetingId;

    IF @HostId IS NULL
       OR (@HostId <> @UserId AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_MeetingInvitees WHERE MeetingId = @MeetingId AND UserId = @UserId))
    BEGIN SET @Result = 1; RETURN; END
    IF @Cancelled IS NULL BEGIN SET @Result = 2; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_MeetingHidden WHERE UserId = @UserId AND MeetingId = @MeetingId)
        INSERT dbo.sahyog_MeetingHidden (MeetingId, UserId) VALUES (@MeetingId, @UserId);
    SET @Result = 0;
END
GO

/* the guest link of a cancelled meeting no longer opens it */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_GetByGuestCode
    @GuestCode NVARCHAR(16)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT m.MeetingId, m.TenantId, m.Title, m.StartUtc, m.DurationMinutes, m.RoomName, m.LobbyEnabled, m.CaptionsOn,
           h.DisplayName AS HostName, t.Name AS TenantName, t.TimeZoneId, t.IsActive AS TenantActive
    FROM dbo.sahyog_Meetings m
    JOIN dbo.sahyog_Users h ON h.UserId = m.HostId
    JOIN dbo.sahyog_Tenants t ON t.TenantId = m.TenantId
    WHERE m.GuestCode = @GuestCode AND m.GuestLinkEnabled = 1 AND m.CancelledUtc IS NULL;
END
GO

PRINT N'34_MeetingCancel.sql applied.';
GO

/* =====================================================================
   ShankhNaad round 44 (safe to run more than once; needs 34_MeetingCancel.sql):
     Changing meetings after they're scheduled.
       - sahyog_MeetingExceptions: one date of a repeating meeting is cancelled, or moved to another
         time / day (drag and drop on the calendar, or Edit → "Only this meeting").
       - sahyog_Meeting_Update: edit a meeting (a repeating one: the whole series): title, agenda,
         first date / start time, duration.
     Nothing is removed; existing meetings keep working.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_MeetingExceptions', N'U') IS NULL
CREATE TABLE dbo.sahyog_MeetingExceptions
(
    MeetingId           UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_MeetingExceptions_Meetings REFERENCES dbo.sahyog_Meetings(MeetingId) ON DELETE CASCADE,
    OccurrenceDate      DATE             NOT NULL,   -- the date it was planned for (workspace time)
    IsCancelled         BIT              NOT NULL CONSTRAINT DF_sahyog_MeetingExceptions_Cancelled DEFAULT (0),
    NewStartUtc         DATETIME2(0)     NULL,       -- moved: the new start
    NewDurationMinutes  INT              NULL,       -- moved: the new length (NULL = as the series)
    ChangedById         UNIQUEIDENTIFIER NOT NULL,
    ChangedUtc          DATETIME2(0)     NOT NULL CONSTRAINT DF_sahyog_MeetingExceptions_Changed DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sahyog_MeetingExceptions PRIMARY KEY (MeetingId, OccurrenceDate)
);
GO

/* the changed dates of some meetings (@MeetingIds: comma-separated ids) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_ListExceptions
    @TenantId UNIQUEIDENTIFIER, @MeetingIds NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT x.MeetingId, x.OccurrenceDate, x.IsCancelled, x.NewStartUtc, x.NewDurationMinutes
    FROM dbo.sahyog_MeetingExceptions x
    JOIN dbo.sahyog_Meetings m ON m.MeetingId = x.MeetingId AND m.TenantId = @TenantId
    WHERE x.MeetingId IN (SELECT TRY_CAST(LTRIM(RTRIM(value)) AS UNIQUEIDENTIFIER) FROM STRING_SPLIT(ISNULL(@MeetingIds, N''), N','));
END
GO

/* Cancel or move one date of a repeating meeting. Only the host or a workspace admin.
   @IsCancelled = 1: that date is cancelled.  Otherwise @NewStartUtc (+ @NewDurationMinutes) moves it.
   @Result: 0 done, 1 not found, 2 not allowed, 3 the meeting is cancelled, 4 not a repeating meeting */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_SetException
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT,
    @OccurrenceDate DATE, @IsCancelled BIT, @NewStartUtc DATETIME2(0) = NULL, @NewDurationMinutes INT = NULL,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @HostId UNIQUEIDENTIFIER, @Cancelled DATETIME2(0), @Recurrence TINYINT;
    SELECT @HostId = HostId, @Cancelled = CancelledUtc, @Recurrence = Recurrence
    FROM dbo.sahyog_Meetings WHERE TenantId = @TenantId AND MeetingId = @MeetingId;

    IF @HostId IS NULL BEGIN SET @Result = 1; RETURN; END
    IF @HostId <> @UserId AND @IsAdmin = 0 BEGIN SET @Result = 2; RETURN; END
    IF @Cancelled IS NOT NULL BEGIN SET @Result = 3; RETURN; END
    IF @Recurrence = 0 BEGIN SET @Result = 4; RETURN; END

    MERGE dbo.sahyog_MeetingExceptions AS t
    USING (SELECT @MeetingId AS MeetingId, @OccurrenceDate AS OccurrenceDate) AS s
       ON t.MeetingId = s.MeetingId AND t.OccurrenceDate = s.OccurrenceDate
    WHEN MATCHED THEN UPDATE SET IsCancelled = @IsCancelled,
                                 NewStartUtc = CASE WHEN @IsCancelled = 1 THEN NULL ELSE @NewStartUtc END,
                                 NewDurationMinutes = CASE WHEN @IsCancelled = 1 THEN NULL ELSE @NewDurationMinutes END,
                                 ChangedById = @UserId, ChangedUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (MeetingId, OccurrenceDate, IsCancelled, NewStartUtc, NewDurationMinutes, ChangedById)
                          VALUES (@MeetingId, @OccurrenceDate, @IsCancelled,
                                  CASE WHEN @IsCancelled = 1 THEN NULL ELSE @NewStartUtc END,
                                  CASE WHEN @IsCancelled = 1 THEN NULL ELSE @NewDurationMinutes END, @UserId);
    SET @Result = 0;
END
GO

/* Edit a meeting (a repeating meeting: the whole series). Only the host or a workspace admin.
   When the start changes, single dates that were moved go back to the series time (@KeepCancelledDates = 1 keeps
   the cancelled dates; 0 drops every change, used when the series moves to another weekday).
   @Result: 0 done, 1 not found, 2 not allowed, 3 the meeting is cancelled */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_Update
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT,
    @Title NVARCHAR(150), @Agenda NVARCHAR(2000) = NULL, @StartUtc DATETIME2(0), @DurationMinutes INT,
    @KeepCancelledDates BIT = 1, @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @HostId UNIQUEIDENTIFIER, @Cancelled DATETIME2(0), @OldStart DATETIME2(0);
    SELECT @HostId = HostId, @Cancelled = CancelledUtc, @OldStart = StartUtc
    FROM dbo.sahyog_Meetings WHERE TenantId = @TenantId AND MeetingId = @MeetingId;

    IF @HostId IS NULL BEGIN SET @Result = 1; RETURN; END
    IF @HostId <> @UserId AND @IsAdmin = 0 BEGIN SET @Result = 2; RETURN; END
    IF @Cancelled IS NOT NULL BEGIN SET @Result = 3; RETURN; END

    BEGIN TRANSACTION;
        UPDATE dbo.sahyog_Meetings
        SET Title = @Title, Agenda = NULLIF(LTRIM(RTRIM(@Agenda)), N''), StartUtc = @StartUtc, DurationMinutes = @DurationMinutes
        WHERE TenantId = @TenantId AND MeetingId = @MeetingId;

        IF @OldStart <> @StartUtc
            DELETE dbo.sahyog_MeetingExceptions
            WHERE MeetingId = @MeetingId AND (@KeepCancelledDates = 0 OR IsCancelled = 0);
    COMMIT;
    SET @Result = 0;
END
GO

PRINT N'35_MeetingChanges.sql applied.';
GO

/* =====================================================================
   ShankhNaad round 45 (safe to run more than once; needs 35_MeetingChanges.sql):
     Accept / Maybe / Decline for meetings.
       - sahyog_MeetingResponses: each invited person's answer (team members by UserId, guests by email).
         OccurrenceDate 1900-01-01 = the answer for the whole meeting / series; another date = only that date
         of a repeating meeting (it wins over the series answer for that date).
     Nothing is removed; existing meetings keep working.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_MeetingResponses', N'U') IS NULL
CREATE TABLE dbo.sahyog_MeetingResponses
(
    MeetingId       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_MeetingResponses_Meetings REFERENCES dbo.sahyog_Meetings(MeetingId) ON DELETE CASCADE,
    PersonKey       NVARCHAR(300)    NOT NULL,   -- a team member's UserId (lower case), or "g:" + a guest's email (lower case)
    OccurrenceDate  DATE             NOT NULL CONSTRAINT DF_sahyog_MeetingResponses_Date DEFAULT ('19000101'),
    Response        TINYINT          NOT NULL,   -- 1 accepted, 2 maybe, 3 declined
    Note            NVARCHAR(300)    NULL,
    RespondedUtc    DATETIME2(0)     NOT NULL CONSTRAINT DF_sahyog_MeetingResponses_Utc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sahyog_MeetingResponses PRIMARY KEY (MeetingId, PersonKey, OccurrenceDate),
    CONSTRAINT CK_sahyog_MeetingResponses_Response CHECK (Response IN (1, 2, 3))
);
GO

/* Save an answer. @UserId (a team member) or @GuestEmail (a guest). @OccurrenceDate NULL = the whole meeting / series:
   that replaces the person's earlier answers for single dates.
   @Result: 0 saved, 1 meeting not found, 2 not invited */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_SetResponse
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER = NULL, @GuestEmail NVARCHAR(256) = NULL,
    @OccurrenceDate DATE = NULL, @Response TINYINT, @Note NVARCHAR(300) = NULL, @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @HostId UNIQUEIDENTIFIER;
    SELECT @HostId = HostId FROM dbo.sahyog_Meetings WHERE TenantId = @TenantId AND MeetingId = @MeetingId;
    IF @HostId IS NULL BEGIN SET @Result = 1; RETURN; END

    DECLARE @Key NVARCHAR(300);
    IF @UserId IS NOT NULL
    BEGIN
        IF @UserId <> @HostId AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_MeetingInvitees WHERE MeetingId = @MeetingId AND UserId = @UserId)
        BEGIN SET @Result = 2; RETURN; END
        SET @Key = LOWER(CONVERT(NVARCHAR(36), @UserId));
    END
    ELSE
    BEGIN
        IF @GuestEmail IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_MeetingInvitees WHERE MeetingId = @MeetingId AND GuestEmail = @GuestEmail)
        BEGIN SET @Result = 2; RETURN; END
        SET @Key = N'g:' + LOWER(LTRIM(RTRIM(@GuestEmail)));
    END

    DECLARE @Date DATE = ISNULL(@OccurrenceDate, '19000101');
    BEGIN TRANSACTION;
        IF @OccurrenceDate IS NULL
            DELETE dbo.sahyog_MeetingResponses WHERE MeetingId = @MeetingId AND PersonKey = @Key AND OccurrenceDate <> '19000101';
        MERGE dbo.sahyog_MeetingResponses AS t
        USING (SELECT @MeetingId AS MeetingId, @Key AS PersonKey, @Date AS OccurrenceDate) AS s
           ON t.MeetingId = s.MeetingId AND t.PersonKey = s.PersonKey AND t.OccurrenceDate = s.OccurrenceDate
        WHEN MATCHED THEN UPDATE SET Response = @Response, Note = NULLIF(LTRIM(RTRIM(@Note)), N''), RespondedUtc = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (MeetingId, PersonKey, OccurrenceDate, Response, Note)
                              VALUES (@MeetingId, @Key, @Date, @Response, NULLIF(LTRIM(RTRIM(@Note)), N''));
    COMMIT;
    SET @Result = 0;
END
GO

/* the answers for some meetings (@MeetingIds: comma-separated ids) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_ListResponses
    @TenantId UNIQUEIDENTIFIER, @MeetingIds NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT r.MeetingId, r.PersonKey, r.OccurrenceDate, r.Response, r.Note, r.RespondedUtc
    FROM dbo.sahyog_MeetingResponses r
    JOIN dbo.sahyog_Meetings m ON m.MeetingId = r.MeetingId AND m.TenantId = @TenantId
    WHERE r.MeetingId IN (SELECT TRY_CAST(LTRIM(RTRIM(value)) AS UNIQUEIDENTIFIER) FROM STRING_SPLIT(ISNULL(@MeetingIds, N''), N','));
END
GO

PRINT N'36_MeetingResponses.sql applied.';
GO

/* =====================================================================
   ShankhNaad round 47 (safe to run more than once; needs 26_MessageReactions.sql):
     Reactions with any emoji (the new emoji panel has all of them).
       - sahyog_MessageReactions.Emoji compares exactly (binary). With the database's normal text rules many
         emoji count as "the same" (e.g. 😀 and 🚀), so reacting with one could take back another.
     Nothing is removed; existing reactions stay.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_MessageReactions', N'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID(N'dbo.sahyog_MessageReactions') AND name = N'Emoji'
                 AND ISNULL(collation_name, N'') <> N'Latin1_General_100_BIN2')
BEGIN
    BEGIN TRANSACTION;
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'PK_sahyog_MessageReactions' AND parent_object_id = OBJECT_ID(N'dbo.sahyog_MessageReactions'))
        ALTER TABLE dbo.sahyog_MessageReactions DROP CONSTRAINT PK_sahyog_MessageReactions;
    ALTER TABLE dbo.sahyog_MessageReactions ALTER COLUMN Emoji NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL;
    ALTER TABLE dbo.sahyog_MessageReactions ADD CONSTRAINT PK_sahyog_MessageReactions PRIMARY KEY (MessageId, UserId, Emoji);
    COMMIT;
END
GO

PRINT N'38_EmojiReactionsAnyEmoji.sql applied.';
GO

/* ===================== 39_GroupHistoryShare.sql ===================== */
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

PRINT N'39_GroupHistoryShare.sql applied.';
GO

/* ===================== 40_OrgStructure.sql ===================== */
/* =====================================================================
   40_OrgStructure.sql  —  Organization structure (Org page)
   - Departments per workspace (name, head)
   - Each person: job title, department, manager (reports to), phone,
     employee ID, joined date
   Safe to run more than once.
   ===================================================================== */
SET NOCOUNT ON;
GO

/* ---------- departments ---------- */
IF OBJECT_ID(N'dbo.sahyog_Departments', N'U') IS NULL
CREATE TABLE dbo.sahyog_Departments
(
    DepartmentId    UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_Departments PRIMARY KEY,
    TenantId        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Departments_Tenants REFERENCES dbo.sahyog_Tenants(TenantId),
    Name            NVARCHAR(100)    NOT NULL,
    HeadUserId      UNIQUEIDENTIFIER NULL,
    ParentId        UNIQUEIDENTIFIER NULL,
    CreatedUtc      DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Departments_Created DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_sahyog_Departments_Name')
    CREATE UNIQUE INDEX UX_sahyog_Departments_Name ON dbo.sahyog_Departments(TenantId, Name);
GO

/* ---------- org fields on people ---------- */
IF COL_LENGTH(N'dbo.sahyog_Users', N'JobTitle') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD JobTitle NVARCHAR(100) NULL;
IF COL_LENGTH(N'dbo.sahyog_Users', N'DepartmentId') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD DepartmentId UNIQUEIDENTIFIER NULL;
IF COL_LENGTH(N'dbo.sahyog_Users', N'ManagerId') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD ManagerId UNIQUEIDENTIFIER NULL;
IF COL_LENGTH(N'dbo.sahyog_Users', N'Phone') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD Phone NVARCHAR(40) NULL;
IF COL_LENGTH(N'dbo.sahyog_Users', N'EmployeeCode') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD EmployeeCode NVARCHAR(40) NULL;
IF COL_LENGTH(N'dbo.sahyog_Users', N'JoinedOn') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD JoinedOn DATE NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Users_Manager')
    CREATE INDEX IX_sahyog_Users_Manager ON dbo.sahyog_Users(TenantId, ManagerId);
GO

/* ---------- everyone active in the workspace, with their org fields ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Org_ListPeople
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.UserId, u.DisplayName, u.Email, u.Role, u.AvatarTone,
           u.JobTitle, u.DepartmentId, d.Name AS DepartmentName,
           -- a manager who left (inactive) no longer counts
           CASE WHEN m.IsActive = 1 THEN u.ManagerId END AS ManagerId,
           u.Phone, u.EmployeeCode, u.JoinedOn
    FROM dbo.sahyog_Users u
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = u.DepartmentId AND d.TenantId = u.TenantId
    LEFT JOIN dbo.sahyog_Users m ON m.UserId = u.ManagerId AND m.TenantId = u.TenantId
    WHERE u.TenantId = @TenantId AND u.IsActive = 1
    ORDER BY u.DisplayName;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Org_ListDepartments
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT d.DepartmentId, d.Name, d.HeadUserId, h.DisplayName AS HeadName,
           (SELECT COUNT(*) FROM dbo.sahyog_Users u WHERE u.TenantId = d.TenantId AND u.DepartmentId = d.DepartmentId AND u.IsActive = 1) AS People
    FROM dbo.sahyog_Departments d
    LEFT JOIN dbo.sahyog_Users h ON h.UserId = d.HeadUserId AND h.TenantId = d.TenantId AND h.IsActive = 1
    WHERE d.TenantId = @TenantId
    ORDER BY d.Name;
END
GO

/* Create (DepartmentId NULL) or rename / change head.
   Result: 0 saved, 1 that name is taken, 2 not found, 3 head isn't in this workspace, 4 name empty */
CREATE OR ALTER PROCEDURE dbo.sahyog_Org_SaveDepartment
    @TenantId     UNIQUEIDENTIFIER,
    @DepartmentId UNIQUEIDENTIFIER = NULL,
    @Name         NVARCHAR(100),
    @HeadUserId   UNIQUEIDENTIFIER = NULL,
    @Result       INT OUTPUT,
    @NewId        UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Name = LTRIM(RTRIM(ISNULL(@Name, N'')));
    SET @NewId = @DepartmentId;
    IF @Name = N'' BEGIN SET @Result = 4; RETURN; END
    IF @HeadUserId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @HeadUserId AND TenantId = @TenantId AND IsActive = 1)
        BEGIN SET @Result = 3; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Departments WHERE TenantId = @TenantId AND Name = @Name
               AND (@DepartmentId IS NULL OR DepartmentId <> @DepartmentId))
        BEGIN SET @Result = 1; RETURN; END

    IF @DepartmentId IS NULL
    BEGIN
        SET @NewId = NEWID();
        INSERT dbo.sahyog_Departments (DepartmentId, TenantId, Name, HeadUserId) VALUES (@NewId, @TenantId, @Name, @HeadUserId);
    END
    ELSE
    BEGIN
        UPDATE dbo.sahyog_Departments SET Name = @Name, HeadUserId = @HeadUserId
        WHERE DepartmentId = @DepartmentId AND TenantId = @TenantId;
        IF @@ROWCOUNT = 0 BEGIN SET @Result = 2; RETURN; END
    END
    -- the head belongs to the department
    IF @HeadUserId IS NOT NULL
        UPDATE dbo.sahyog_Users SET DepartmentId = @NewId WHERE UserId = @HeadUserId AND TenantId = @TenantId AND DepartmentId IS NULL;
    SET @Result = 0;
END
GO

/* Deletes a department. Its people stay, without a department. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Org_DeleteDepartment
    @TenantId     UNIQUEIDENTIFIER,
    @DepartmentId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRAN;
        UPDATE dbo.sahyog_Users SET DepartmentId = NULL WHERE TenantId = @TenantId AND DepartmentId = @DepartmentId;
        UPDATE dbo.sahyog_Departments SET ParentId = NULL WHERE TenantId = @TenantId AND ParentId = @DepartmentId;
        DELETE dbo.sahyog_Departments WHERE TenantId = @TenantId AND DepartmentId = @DepartmentId;
    COMMIT;
END
GO

/* Finds a department by name, creating it when it doesn't exist yet (CSV import). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Org_EnsureDepartment
    @TenantId     UNIQUEIDENTIFIER,
    @Name         NVARCHAR(100),
    @DepartmentId UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Name = LTRIM(RTRIM(ISNULL(@Name, N'')));
    SET @DepartmentId = NULL;
    IF @Name = N'' RETURN;
    SELECT @DepartmentId = DepartmentId FROM dbo.sahyog_Departments WHERE TenantId = @TenantId AND Name = @Name;
    IF @DepartmentId IS NULL
    BEGIN
        SET @DepartmentId = NEWID();
        BEGIN TRY
            INSERT dbo.sahyog_Departments (DepartmentId, TenantId, Name) VALUES (@DepartmentId, @TenantId, @Name);
        END TRY
        BEGIN CATCH   -- created at the same moment by someone else
            SELECT @DepartmentId = DepartmentId FROM dbo.sahyog_Departments WHERE TenantId = @TenantId AND Name = @Name;
        END CATCH
    END
END
GO

/* Sets a person's org fields.
   Result: 0 saved, 1 person not found, 2 can't report to themselves,
           3 would make a loop (the manager reports to this person),
           4 manager isn't in this workspace, 5 department isn't in this workspace */
CREATE OR ALTER PROCEDURE dbo.sahyog_Org_SetPerson
    @TenantId     UNIQUEIDENTIFIER,
    @UserId       UNIQUEIDENTIFIER,
    @JobTitle     NVARCHAR(100) = NULL,
    @DepartmentId UNIQUEIDENTIFIER = NULL,
    @ManagerId    UNIQUEIDENTIFIER = NULL,
    @Phone        NVARCHAR(40) = NULL,
    @EmployeeCode NVARCHAR(40) = NULL,
    @JoinedOn     DATE = NULL,
    @Result       INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId)
        BEGIN SET @Result = 1; RETURN; END
    IF @ManagerId = @UserId BEGIN SET @Result = 2; RETURN; END
    IF @ManagerId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @ManagerId AND TenantId = @TenantId AND IsActive = 1)
        BEGIN SET @Result = 4; RETURN; END
    IF @DepartmentId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Departments WHERE DepartmentId = @DepartmentId AND TenantId = @TenantId)
        BEGIN SET @Result = 5; RETURN; END

    -- walk up from the new manager: if we reach this person, it would loop
    DECLARE @Loop INT = 0;
    IF @ManagerId IS NOT NULL
    BEGIN
        ;WITH up AS (
            SELECT UserId, ManagerId, 1 AS Depth FROM dbo.sahyog_Users WHERE UserId = @ManagerId AND TenantId = @TenantId
            UNION ALL
            SELECT u.UserId, u.ManagerId, up.Depth + 1
            FROM dbo.sahyog_Users u JOIN up ON u.UserId = up.ManagerId
            WHERE u.TenantId = @TenantId AND up.Depth < 100
        )
        SELECT @Loop = COUNT(*) FROM up WHERE UserId = @UserId OR ManagerId = @UserId
        OPTION (MAXRECURSION 200);
        IF @Loop > 0 BEGIN SET @Result = 3; RETURN; END
    END

    UPDATE dbo.sahyog_Users
    SET JobTitle     = NULLIF(LTRIM(RTRIM(@JobTitle)), N''),
        DepartmentId = @DepartmentId,
        ManagerId    = @ManagerId,
        Phone        = NULLIF(LTRIM(RTRIM(@Phone)), N''),
        EmployeeCode = NULLIF(LTRIM(RTRIM(@EmployeeCode)), N''),
        JoinedOn     = @JoinedOn
    WHERE UserId = @UserId AND TenantId = @TenantId;
    SET @Result = 0;
END
GO
PRINT N'40_OrgStructure.sql applied.';
GO

/* ===================== 41_PeoplePins.sql ===================== */
/* =====================================================================
   41_PeoplePins.sql  —  Calls page: pin people to the top of your Team panel
   Pins belong to the person who set them, so they follow you to every device.
   Safe to run more than once.
   ===================================================================== */
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.sahyog_PeoplePins', N'U') IS NULL
CREATE TABLE dbo.sahyog_PeoplePins
(
    UserId          UNIQUEIDENTIFIER NOT NULL,
    PinnedUserId    UNIQUEIDENTIFIER NOT NULL,
    PinnedUtc       DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_PeoplePins_Utc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sahyog_PeoplePins PRIMARY KEY (UserId, PinnedUserId)
);
GO

/* The people you pinned (oldest pin first). */
CREATE OR ALTER PROCEDURE dbo.sahyog_PeoplePins_List
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT PinnedUserId FROM dbo.sahyog_PeoplePins WHERE UserId = @UserId ORDER BY PinnedUtc;
END
GO

/* Pin (@Pinned = 1) or unpin someone. Result: 0 done, 1 that person isn't in your workspace. */
CREATE OR ALTER PROCEDURE dbo.sahyog_PeoplePins_Set
    @TenantId     UNIQUEIDENTIFIER,
    @UserId       UNIQUEIDENTIFIER,
    @PinnedUserId UNIQUEIDENTIFIER,
    @Pinned       BIT,
    @Result       INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF @Pinned = 0
    BEGIN
        DELETE dbo.sahyog_PeoplePins WHERE UserId = @UserId AND PinnedUserId = @PinnedUserId;
        SET @Result = 0; RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @PinnedUserId AND TenantId = @TenantId)
       OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId)
        BEGIN SET @Result = 1; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_PeoplePins WHERE UserId = @UserId AND PinnedUserId = @PinnedUserId)
        INSERT dbo.sahyog_PeoplePins (UserId, PinnedUserId) VALUES (@UserId, @PinnedUserId);
    SET @Result = 0;
END
GO
PRINT N'41_PeoplePins.sql applied.';
GO

/* ===================== 42_MeetingAttendance.sql ===================== */
/* =====================================================================
   42_MeetingAttendance.sql  —  attendance sheet for calls and meetings
   - A "session" is one sitting of a call or meeting: it starts when the first person
     joins an empty room and ends when the last person leaves (a weekly meeting gets
     one session per week).
   - One row per person per session: first joined, left, total time, how many times joined.
     Team members are recorded by the server; guests (named in the call) by the people in it.
   Safe to run more than once.
   ===================================================================== */
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.sahyog_MeetingSessions', N'U') IS NULL
CREATE TABLE dbo.sahyog_MeetingSessions
(
    SessionId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_MeetingSessions PRIMARY KEY,
    TenantId    UNIQUEIDENTIFIER NOT NULL,
    MeetingId   UNIQUEIDENTIFIER NOT NULL,
    StartedUtc  DATETIME2(3)     NOT NULL,
    EndedUtc    DATETIME2(3)     NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_MeetingSessions_Meeting')
    CREATE INDEX IX_sahyog_MeetingSessions_Meeting ON dbo.sahyog_MeetingSessions(MeetingId, StartedUtc DESC);
GO

IF OBJECT_ID(N'dbo.sahyog_MeetingAttendance', N'U') IS NULL
CREATE TABLE dbo.sahyog_MeetingAttendance
(
    AttendanceId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_MeetingAttendance PRIMARY KEY,
    SessionId    UNIQUEIDENTIFIER NOT NULL,
    UserId       UNIQUEIDENTIFIER NULL,          -- a team member
    GuestName    NVARCHAR(100)    NULL,          -- or a guest, by the name they gave
    FirstJoinUtc DATETIME2(3)     NOT NULL,
    LastJoinUtc  DATETIME2(3)     NOT NULL,      -- start of the current stay
    LastSeenUtc  DATETIME2(3)     NOT NULL,
    LeftUtc      DATETIME2(3)     NULL,          -- NULL = in the call now
    Seconds      INT              NOT NULL CONSTRAINT DF_sahyog_MeetingAttendance_Seconds DEFAULT (0),   -- finished stays
    Joins        INT              NOT NULL CONSTRAINT DF_sahyog_MeetingAttendance_Joins DEFAULT (1)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_MeetingAttendance_Session')
    CREATE INDEX IX_sahyog_MeetingAttendance_Session ON dbo.sahyog_MeetingAttendance(SessionId);
GO

/* The open session of a meeting, started now when there is none. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Attendance_OpenSession
    @TenantId  UNIQUEIDENTIFIER,
    @MeetingId UNIQUEIDENTIFIER,
    @SessionId UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME2(3) = SYSUTCDATETIME(), @LastSeen DATETIME2(3);
    SELECT TOP (1) @SessionId = SessionId FROM dbo.sahyog_MeetingSessions
    WHERE MeetingId = @MeetingId AND TenantId = @TenantId AND EndedUtc IS NULL ORDER BY StartedUtc DESC;
    -- a session nobody has been seen in for 15 minutes (e.g. the server restarted) is over
    IF @SessionId IS NOT NULL
    BEGIN
        SELECT @LastSeen = MAX(LastSeenUtc) FROM dbo.sahyog_MeetingAttendance WHERE SessionId = @SessionId;
        IF @LastSeen IS NOT NULL AND @LastSeen < DATEADD(MINUTE, -15, @Now)
        BEGIN
            UPDATE dbo.sahyog_MeetingAttendance
            SET Seconds = Seconds + DATEDIFF(SECOND, LastJoinUtc, LastSeenUtc), LeftUtc = LastSeenUtc
            WHERE SessionId = @SessionId AND LeftUtc IS NULL;
            UPDATE dbo.sahyog_MeetingSessions SET EndedUtc = @LastSeen WHERE SessionId = @SessionId;
            SET @SessionId = NULL;
        END
    END
    IF @SessionId IS NULL
    BEGIN
        SET @SessionId = NEWID();
        INSERT dbo.sahyog_MeetingSessions (SessionId, TenantId, MeetingId, StartedUtc) VALUES (@SessionId, @TenantId, @MeetingId, SYSUTCDATETIME());
    END
END
GO

/* A team member came into the call (again). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Attendance_Join
    @TenantId  UNIQUEIDENTIFIER,
    @MeetingId UNIQUEIDENTIFIER,
    @UserId    UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @SessionId UNIQUEIDENTIFIER, @Now DATETIME2(3) = SYSUTCDATETIME();
    EXEC dbo.sahyog_Attendance_OpenSession @TenantId, @MeetingId, @SessionId OUTPUT;
    UPDATE dbo.sahyog_MeetingAttendance
    SET Joins = Joins + CASE WHEN LeftUtc IS NULL THEN 0 ELSE 1 END,
        LastJoinUtc = CASE WHEN LeftUtc IS NULL THEN LastJoinUtc ELSE @Now END,
        LeftUtc = NULL, LastSeenUtc = @Now
    WHERE SessionId = @SessionId AND UserId = @UserId;
    IF @@ROWCOUNT = 0
        INSERT dbo.sahyog_MeetingAttendance (SessionId, UserId, FirstJoinUtc, LastJoinUtc, LastSeenUtc)
        VALUES (@SessionId, @UserId, @Now, @Now, @Now);
END
GO

/* A team member left. @RoomEmpty = 1: they were the last one, so the session ends (guests leave with it). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Attendance_Leave
    @TenantId  UNIQUEIDENTIFIER,
    @MeetingId UNIQUEIDENTIFIER,
    @UserId    UNIQUEIDENTIFIER,
    @RoomEmpty BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @SessionId UNIQUEIDENTIFIER, @Now DATETIME2(3) = SYSUTCDATETIME();
    SELECT TOP (1) @SessionId = SessionId FROM dbo.sahyog_MeetingSessions
    WHERE MeetingId = @MeetingId AND TenantId = @TenantId AND EndedUtc IS NULL ORDER BY StartedUtc DESC;
    IF @SessionId IS NULL RETURN;
    UPDATE dbo.sahyog_MeetingAttendance
    SET Seconds = Seconds + DATEDIFF(SECOND, LastJoinUtc, @Now), LeftUtc = @Now, LastSeenUtc = @Now
    WHERE SessionId = @SessionId AND UserId = @UserId AND LeftUtc IS NULL;
    IF @RoomEmpty = 1
    BEGIN
        UPDATE dbo.sahyog_MeetingAttendance
        SET Seconds = Seconds + DATEDIFF(SECOND, LastJoinUtc, LastSeenUtc), LeftUtc = LastSeenUtc
        WHERE SessionId = @SessionId AND LeftUtc IS NULL;
        UPDATE dbo.sahyog_MeetingSessions SET EndedUtc = @Now WHERE SessionId = @SessionId;
    END
END
GO

/* Guests in the call right now, by name (sent every minute by the people in the call, separated by |).
   A guest who is no longer in the list has left (at the time they were last seen).
   (The sheet itself needs 40_OrgStructure.sql first: it shows job titles and departments.) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Attendance_Guests
    @TenantId  UNIQUEIDENTIFIER,
    @MeetingId UNIQUEIDENTIFIER,
    @UserId    UNIQUEIDENTIFIER,     -- who sent it: they're still in the call too
    @Names     NVARCHAR(4000)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @SessionId UNIQUEIDENTIFIER, @Now DATETIME2(3) = SYSUTCDATETIME();
    SELECT TOP (1) @SessionId = SessionId FROM dbo.sahyog_MeetingSessions
    WHERE MeetingId = @MeetingId AND TenantId = @TenantId AND EndedUtc IS NULL ORDER BY StartedUtc DESC;
    IF @SessionId IS NULL RETURN;

    DECLARE @Now_In TABLE (Name NVARCHAR(100) PRIMARY KEY);
    UPDATE dbo.sahyog_MeetingAttendance SET LastSeenUtc = @Now WHERE SessionId = @SessionId AND UserId = @UserId AND LeftUtc IS NULL;

    INSERT @Now_In (Name)
    SELECT DISTINCT LEFT(LTRIM(RTRIM(value)), 100) FROM STRING_SPLIT(ISNULL(@Names, N''), N'|') WHERE LTRIM(RTRIM(value)) <> N'';

    -- still here or back again
    UPDATE a
    SET Joins = a.Joins + CASE WHEN a.LeftUtc IS NULL THEN 0 ELSE 1 END,
        LastJoinUtc = CASE WHEN a.LeftUtc IS NULL THEN a.LastJoinUtc ELSE @Now END,
        LeftUtc = NULL, LastSeenUtc = @Now
    FROM dbo.sahyog_MeetingAttendance a JOIN @Now_In n ON a.GuestName = n.Name
    WHERE a.SessionId = @SessionId AND a.UserId IS NULL;
    -- new
    INSERT dbo.sahyog_MeetingAttendance (SessionId, GuestName, FirstJoinUtc, LastJoinUtc, LastSeenUtc)
    SELECT @SessionId, n.Name, @Now, @Now, @Now FROM @Now_In n
    WHERE NOT EXISTS (SELECT 1 FROM dbo.sahyog_MeetingAttendance a WHERE a.SessionId = @SessionId AND a.UserId IS NULL AND a.GuestName = n.Name);
    -- gone
    UPDATE a
    SET Seconds = a.Seconds + DATEDIFF(SECOND, a.LastJoinUtc, a.LastSeenUtc), LeftUtc = a.LastSeenUtc
    FROM dbo.sahyog_MeetingAttendance a
    WHERE a.SessionId = @SessionId AND a.UserId IS NULL AND a.LeftUtc IS NULL
      AND NOT EXISTS (SELECT 1 FROM @Now_In n WHERE n.Name = a.GuestName);
END
GO

/* The attendance sheet of the latest (or current) session of a meeting. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Attendance_List
    @TenantId  UNIQUEIDENTIFIER,
    @MeetingId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @SessionId UNIQUEIDENTIFIER, @Started DATETIME2(3), @Ended DATETIME2(3), @Now DATETIME2(3) = SYSUTCDATETIME();
    SELECT TOP (1) @SessionId = SessionId, @Started = StartedUtc, @Ended = EndedUtc FROM dbo.sahyog_MeetingSessions
    WHERE MeetingId = @MeetingId AND TenantId = @TenantId ORDER BY StartedUtc DESC;

    SELECT @SessionId AS SessionId, @Started AS StartedUtc, @Ended AS EndedUtc;

    SELECT a.UserId, COALESCE(u.DisplayName, a.GuestName, N'Someone') AS Name, u.Email, u.AvatarTone,
           CAST(CASE WHEN a.UserId IS NULL THEN 1 ELSE 0 END AS BIT) AS IsGuest,
           u.JobTitle, d.Name AS DepartmentName,
           a.FirstJoinUtc, a.LeftUtc, a.Joins,
           a.Seconds + CASE WHEN a.LeftUtc IS NULL THEN DATEDIFF(SECOND, a.LastJoinUtc, @Now) ELSE 0 END AS Seconds,
           CAST(CASE WHEN a.LeftUtc IS NULL THEN 1 ELSE 0 END AS BIT) AS InCall
    FROM dbo.sahyog_MeetingAttendance a
    LEFT JOIN dbo.sahyog_Users u ON u.UserId = a.UserId AND u.TenantId = @TenantId
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = u.DepartmentId
    WHERE a.SessionId = @SessionId
    ORDER BY a.FirstJoinUtc;
END
GO
PRINT N'42_MeetingAttendance.sql applied.';
GO

/* ===================== 43_PeoplePinsPerPage.sql ===================== */
/* =====================================================================
   43_PeoplePinsPerPage.sql  —  pins on the Calls page and the Files page are separate
   (pinning someone in Calls no longer pins them in Files, and the other way round).
   Pins made before this keep showing on both pages. Safe to run more than once.
   ===================================================================== */
SET NOCOUNT ON;
GO

IF COL_LENGTH(N'dbo.sahyog_PeoplePins', N'Scope') IS NULL
BEGIN
    ALTER TABLE dbo.sahyog_PeoplePins ADD Scope VARCHAR(10) NOT NULL CONSTRAINT DF_sahyog_PeoplePins_Scope DEFAULT ('calls');
END
GO
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'PK_sahyog_PeoplePins'
           AND NOT EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                           WHERE ic.object_id = OBJECT_ID(N'dbo.sahyog_PeoplePins') AND ic.index_id = sys.key_constraints.unique_index_id AND c.name = N'Scope'))
BEGIN
    ALTER TABLE dbo.sahyog_PeoplePins DROP CONSTRAINT PK_sahyog_PeoplePins;
    ALTER TABLE dbo.sahyog_PeoplePins ADD CONSTRAINT PK_sahyog_PeoplePins PRIMARY KEY (UserId, Scope, PinnedUserId);
    -- pins made before were shared by both pages: keep them on the Files page too
    INSERT dbo.sahyog_PeoplePins (UserId, PinnedUserId, PinnedUtc, Scope)
    SELECT p.UserId, p.PinnedUserId, p.PinnedUtc, 'files' FROM dbo.sahyog_PeoplePins p
    WHERE p.Scope = 'calls'
      AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_PeoplePins f WHERE f.UserId = p.UserId AND f.PinnedUserId = p.PinnedUserId AND f.Scope = 'files');
END
GO

/* The people you pinned on one page ('calls' or 'files'), oldest pin first. */
CREATE OR ALTER PROCEDURE dbo.sahyog_PeoplePins_List
    @UserId UNIQUEIDENTIFIER,
    @Scope  VARCHAR(10) = 'calls'
AS
BEGIN
    SET NOCOUNT ON;
    SELECT PinnedUserId FROM dbo.sahyog_PeoplePins WHERE UserId = @UserId AND Scope = @Scope ORDER BY PinnedUtc;
END
GO

/* Pin (@Pinned = 1) or unpin someone on one page. Result: 0 done, 1 that person isn't in your workspace. */
CREATE OR ALTER PROCEDURE dbo.sahyog_PeoplePins_Set
    @TenantId     UNIQUEIDENTIFIER,
    @UserId       UNIQUEIDENTIFIER,
    @PinnedUserId UNIQUEIDENTIFIER,
    @Pinned       BIT,
    @Scope        VARCHAR(10) = 'calls',
    @Result       INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF @Scope NOT IN ('calls', 'files') SET @Scope = 'calls';
    IF @Pinned = 0
    BEGIN
        DELETE dbo.sahyog_PeoplePins WHERE UserId = @UserId AND PinnedUserId = @PinnedUserId AND Scope = @Scope;
        SET @Result = 0; RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @PinnedUserId AND TenantId = @TenantId)
       OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId)
        BEGIN SET @Result = 1; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_PeoplePins WHERE UserId = @UserId AND PinnedUserId = @PinnedUserId AND Scope = @Scope)
        INSERT dbo.sahyog_PeoplePins (UserId, PinnedUserId, Scope) VALUES (@UserId, @PinnedUserId, @Scope);
    SET @Result = 0;
END
GO
PRINT N'43_PeoplePinsPerPage.sql applied.';
GO

/* ############################## 44_LocationPrivacy.sql ############################## */
PRINT N'Applying 44_LocationPrivacy.sql ...';
GO
/* =====================================================================
   ShankhNaad round 44 (safe to run more than once; needs 30_Location.sql):
     Location privacy.
     1. A record of each person's choice: when they said yes / no and which version of the notice they saw.
     2. Automatic deletion: a workspace admin chooses how long a location is kept (7 to 365 days, 30 by default).
        A location that hasn't been refreshed for that long is erased (the app runs this every few hours).
     3. "What's stored about me": a person can read their own stored record.
   Nothing that is already stored changes, except that old locations get erased by the new clean-up.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_TenantLocation', N'RetentionDays') IS NULL
    ALTER TABLE dbo.sahyog_TenantLocation ADD RetentionDays INT NOT NULL
        CONSTRAINT DF_sahyog_TenantLocation_Retention DEFAULT (30);
GO
IF COL_LENGTH(N'dbo.sahyog_UserLocations', N'DecidedUtc') IS NULL
    ALTER TABLE dbo.sahyog_UserLocations ADD DecidedUtc DATETIME2(3) NULL;     -- when the person last said yes / no
GO
IF COL_LENGTH(N'dbo.sahyog_UserLocations', N'NoticeVersion') IS NULL
    ALTER TABLE dbo.sahyog_UserLocations ADD NoticeVersion VARCHAR(20) NULL;   -- which notice they saw when deciding
GO

/* ---------- how long a location is kept ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_GetRetention @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COALESCE(MAX(RetentionDays), 30) AS RetentionDays FROM dbo.sahyog_TenantLocation WHERE TenantId = @TenantId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Location_SetRetention @TenantId UNIQUEIDENTIFIER, @Days INT
AS
BEGIN
    SET NOCOUNT ON;
    IF @Days < 1 SET @Days = 1;
    IF @Days > 365 SET @Days = 365;
    MERGE dbo.sahyog_TenantLocation AS t
    USING (SELECT @TenantId AS TenantId) AS s ON t.TenantId = s.TenantId
    WHEN MATCHED THEN UPDATE SET RetentionDays = @Days, UpdatedUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (TenantId, Enabled, RetentionDays) VALUES (@TenantId, 0, @Days);
    SELECT @Days AS RetentionDays;
END
GO

/* ---------- yes / no, with a record of when and which notice ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_UserSetSharing2
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Sharing BIT, @NoticeVersion VARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId) RETURN;
    MERGE dbo.sahyog_UserLocations AS t
    USING (SELECT @UserId AS UserId) AS s ON t.UserId = s.UserId
    WHEN MATCHED THEN UPDATE SET Sharing = @Sharing, DecidedUtc = SYSUTCDATETIME(), NoticeVersion = @NoticeVersion
    WHEN NOT MATCHED THEN INSERT (UserId, TenantId, Sharing, DecidedUtc, NoticeVersion)
                          VALUES (@UserId, @TenantId, @Sharing, SYSUTCDATETIME(), @NoticeVersion);
    IF @Sharing = 0      -- no: erase what was stored (the yes / no record itself is kept)
        UPDATE dbo.sahyog_UserLocations
        SET InOffice = NULL, Ip = NULL, Lat = NULL, Lng = NULL, AccuracyM = NULL, Address = NULL, Area = NULL,
            City = NULL, Region = NULL, Country = NULL, PreciseUtc = NULL, SeenUtc = NULL
        WHERE UserId = @UserId;
END
GO

/* ---------- automatic deletion ----------
   @TenantId NULL = every client. A location not refreshed within the client's RetentionDays is erased;
   a map position (and its address) older than that is erased even when office / remote was refreshed. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_Purge @TenantId UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @now DATETIME2(3) = SYSUTCDATETIME(), @all INT = 0, @maps INT = 0;

    UPDATE l
    SET InOffice = NULL, Ip = NULL, Lat = NULL, Lng = NULL, AccuracyM = NULL, Address = NULL, Area = NULL,
        City = NULL, Region = NULL, Country = NULL, PreciseUtc = NULL, SeenUtc = NULL
    FROM dbo.sahyog_UserLocations l
    LEFT JOIN dbo.sahyog_TenantLocation t ON t.TenantId = l.TenantId
    WHERE (@TenantId IS NULL OR l.TenantId = @TenantId)
      AND l.SeenUtc IS NOT NULL
      AND l.SeenUtc < DATEADD(DAY, -COALESCE(t.RetentionDays, 30), @now);
    SET @all = @@ROWCOUNT;

    UPDATE l
    SET Lat = NULL, Lng = NULL, AccuracyM = NULL, Address = NULL, Area = NULL,
        City = NULL, Region = NULL, Country = NULL, PreciseUtc = NULL
    FROM dbo.sahyog_UserLocations l
    LEFT JOIN dbo.sahyog_TenantLocation t ON t.TenantId = l.TenantId
    WHERE (@TenantId IS NULL OR l.TenantId = @TenantId)
      AND l.PreciseUtc IS NOT NULL
      AND l.PreciseUtc < DATEADD(DAY, -COALESCE(t.RetentionDays, 30), @now);
    SET @maps = @@ROWCOUNT;

    SELECT @all AS Erased, @maps AS MapsErased;
END
GO

/* ---------- "What's stored about me" ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Location_Mine @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.Sharing, l.InOffice, l.Ip, l.Lat, l.Lng, l.AccuracyM, l.Address, l.Area, l.City, l.Region, l.Country,
           l.PreciseUtc, l.SeenUtc, l.DecidedUtc, l.NoticeVersion,
           COALESCE(t.RetentionDays, 30) AS RetentionDays
    FROM dbo.sahyog_UserLocations l
    LEFT JOIN dbo.sahyog_TenantLocation t ON t.TenantId = l.TenantId
    WHERE l.UserId = @UserId AND l.TenantId = @TenantId;
END
GO

PRINT N'44_LocationPrivacy.sql applied.';
GO

/* ############################## 45_Shankh.sql ############################## */
PRINT N'Applying 45_Shankh.sql ...';
GO
/* =====================================================================
   ShankhNaad round 45 (safe to run more than once; needs 01–02 and 40_OrgStructure.sql):
     Shankh: an urgent alert that rings every person's screen until they press "Seen".
     1. A workspace admin sends it to everyone, a department, or picked people.
     2. Each person's row records when they saw it.
     3. After N minutes, the managers of people who still haven't seen it get a reminder (once).
     4. The sender or an admin closes it: it stops ringing everywhere.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_ShankhAlerts', N'U') IS NULL
CREATE TABLE dbo.sahyog_ShankhAlerts
(
    AlertId         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_ShankhAlerts PRIMARY KEY,
    TenantId        UNIQUEIDENTIFIER NOT NULL
                    CONSTRAINT FK_sahyog_ShankhAlerts_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    SenderId        UNIQUEIDENTIFIER NOT NULL,
    Kind            VARCHAR(20)      NOT NULL,          -- outage · drill · client · other
    Body            NVARCHAR(1000)   NOT NULL,
    Audience        NVARCHAR(200)    NOT NULL,          -- "Everyone", "Engineering", "4 people" (shown on the board)
    RemindAfterMin  INT              NULL,              -- NULL = no reminder to managers
    SentUtc         DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_ShankhAlerts_Sent DEFAULT (SYSUTCDATETIME()),
    ClosedUtc       DATETIME2(3)     NULL,
    ClosedBy        UNIQUEIDENTIFIER NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_ShankhAlerts_Tenant')
    CREATE INDEX IX_sahyog_ShankhAlerts_Tenant ON dbo.sahyog_ShankhAlerts(TenantId, SentUtc DESC);
GO

IF OBJECT_ID(N'dbo.sahyog_ShankhRecipients', N'U') IS NULL
CREATE TABLE dbo.sahyog_ShankhRecipients
(
    AlertId         UNIQUEIDENTIFIER NOT NULL
                    CONSTRAINT FK_sahyog_ShankhRecipients_Alerts REFERENCES dbo.sahyog_ShankhAlerts(AlertId) ON DELETE CASCADE,
    UserId          UNIQUEIDENTIFIER NOT NULL,
    ManagerId       UNIQUEIDENTIFIER NULL,               -- their manager when the alert was sent (for the reminder)
    SeenUtc         DATETIME2(3)     NULL,
    RemindedUtc     DATETIME2(3)     NULL,               -- when their manager was reminded
    CONSTRAINT PK_sahyog_ShankhRecipients PRIMARY KEY (AlertId, UserId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_ShankhRecipients_User')
    CREATE INDEX IX_sahyog_ShankhRecipients_User ON dbo.sahyog_ShankhRecipients(UserId) INCLUDE (SeenUtc);
GO

/* ---------- send: the alert and one row per person (ids separated by commas) ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_Create
    @AlertId UNIQUEIDENTIFIER, @TenantId UNIQUEIDENTIFIER, @SenderId UNIQUEIDENTIFIER,
    @Kind VARCHAR(20), @Body NVARCHAR(1000), @Audience NVARCHAR(200), @RemindAfterMin INT,
    @UserIds NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.sahyog_ShankhAlerts (AlertId, TenantId, SenderId, Kind, Body, Audience, RemindAfterMin)
    VALUES (@AlertId, @TenantId, @SenderId, @Kind, @Body, @Audience, @RemindAfterMin);

    INSERT dbo.sahyog_ShankhRecipients (AlertId, UserId, ManagerId, SeenUtc)
    SELECT @AlertId, u.UserId, u.ManagerId,
           CASE WHEN u.UserId = @SenderId THEN SYSUTCDATETIME() END      -- the sender has seen it
    FROM (SELECT DISTINCT TRY_CAST(LTRIM(RTRIM(value)) AS UNIQUEIDENTIFIER) AS UserId FROM STRING_SPLIT(@UserIds, N',')) s
    JOIN dbo.sahyog_Users u ON u.UserId = s.UserId AND u.TenantId = @TenantId AND u.IsActive = 1;

    SELECT COUNT(*) AS People FROM dbo.sahyog_ShankhRecipients WHERE AlertId = @AlertId;
END
GO

/* ---------- "Seen" ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_Seen @AlertId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE r SET SeenUtc = COALESCE(r.SeenUtc, SYSUTCDATETIME())
    FROM dbo.sahyog_ShankhRecipients r
    JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId AND a.TenantId = @TenantId
    WHERE r.AlertId = @AlertId AND r.UserId = @UserId;
    SELECT r.SeenUtc, a.SenderId FROM dbo.sahyog_ShankhRecipients r JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId
    WHERE r.AlertId = @AlertId AND r.UserId = @UserId AND a.TenantId = @TenantId;
END
GO

/* ---------- my alerts still ringing (shown again on every page until I press Seen) ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_MyOpen @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT a.AlertId, a.Kind, a.Body, a.Audience, a.SentUtc, a.SenderId, s.DisplayName AS SenderName
    FROM dbo.sahyog_ShankhRecipients r
    JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId AND a.TenantId = @TenantId
    LEFT JOIN dbo.sahyog_Users s ON s.UserId = a.SenderId
    WHERE r.UserId = @UserId AND r.SeenUtc IS NULL AND a.ClosedUtc IS NULL
      AND a.SentUtc > DATEADD(HOUR, -24, SYSUTCDATETIME())               -- an old alert nobody closed stops after a day
    ORDER BY a.SentUtc DESC;
END
GO

/* ---------- the board: the alert, then everyone on it ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_Board @TenantId UNIQUEIDENTIFIER, @AlertId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT a.AlertId, a.Kind, a.Body, a.Audience, a.RemindAfterMin, a.SentUtc, a.ClosedUtc, a.SenderId,
           s.DisplayName AS SenderName
    FROM dbo.sahyog_ShankhAlerts a LEFT JOIN dbo.sahyog_Users s ON s.UserId = a.SenderId
    WHERE a.AlertId = @AlertId AND a.TenantId = @TenantId;

    SELECT r.UserId, u.DisplayName, u.AvatarTone, d.Name AS DepartmentName, r.ManagerId, m.DisplayName AS ManagerName,
           r.SeenUtc, r.RemindedUtc
    FROM dbo.sahyog_ShankhRecipients r
    JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId AND a.TenantId = @TenantId
    JOIN dbo.sahyog_Users u ON u.UserId = r.UserId
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = u.DepartmentId
    LEFT JOIN dbo.sahyog_Users m ON m.UserId = r.ManagerId
    WHERE r.AlertId = @AlertId
    ORDER BY CASE WHEN r.SeenUtc IS NULL THEN 0 ELSE 1 END, u.DisplayName;
END
GO

/* ---------- recent alerts (the admin's list) ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_Recent @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (20) a.AlertId, a.Kind, a.Body, a.Audience, a.SentUtc, a.ClosedUtc, s.DisplayName AS SenderName,
           (SELECT COUNT(*) FROM dbo.sahyog_ShankhRecipients r WHERE r.AlertId = a.AlertId) AS People,
           (SELECT COUNT(*) FROM dbo.sahyog_ShankhRecipients r WHERE r.AlertId = a.AlertId AND r.SeenUtc IS NOT NULL) AS Seen
    FROM dbo.sahyog_ShankhAlerts a LEFT JOIN dbo.sahyog_Users s ON s.UserId = a.SenderId
    WHERE a.TenantId = @TenantId
    ORDER BY a.SentUtc DESC;
END
GO

/* ---------- close: stops ringing everywhere; returns who was still ringing ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_Close @TenantId UNIQUEIDENTIFIER, @AlertId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_ShankhAlerts SET ClosedUtc = COALESCE(ClosedUtc, SYSUTCDATETIME()), ClosedBy = COALESCE(ClosedBy, @UserId)
    WHERE AlertId = @AlertId AND TenantId = @TenantId;
    SELECT r.UserId FROM dbo.sahyog_ShankhRecipients r JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId
    WHERE r.AlertId = @AlertId AND a.TenantId = @TenantId AND r.SeenUtc IS NULL;
END
GO

/* ---------- reminders due: people who haven't seen it after RemindAfterMin; each is returned once ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Shankh_TakeDueReminders
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @due TABLE (AlertId UNIQUEIDENTIFIER, UserId UNIQUEIDENTIFIER, ManagerId UNIQUEIDENTIFIER);
    UPDATE r SET RemindedUtc = SYSUTCDATETIME()
    OUTPUT inserted.AlertId, inserted.UserId, inserted.ManagerId INTO @due
    FROM dbo.sahyog_ShankhRecipients r
    JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = r.AlertId
    WHERE r.SeenUtc IS NULL AND r.RemindedUtc IS NULL AND a.ClosedUtc IS NULL AND a.RemindAfterMin IS NOT NULL
      AND a.SentUtc < DATEADD(MINUTE, -a.RemindAfterMin, SYSUTCDATETIME())
      AND a.SentUtc > DATEADD(HOUR, -24, SYSUTCDATETIME());
    SELECT d.AlertId, a.TenantId, a.Body, a.SenderId, d.UserId, u.DisplayName, d.ManagerId, m.DisplayName AS ManagerName
    FROM @due d
    JOIN dbo.sahyog_ShankhAlerts a ON a.AlertId = d.AlertId
    JOIN dbo.sahyog_Users u ON u.UserId = d.UserId
    LEFT JOIN dbo.sahyog_Users m ON m.UserId = d.ManagerId AND m.IsActive = 1;
END
GO

PRINT N'45_Shankh.sql applied.';
GO

PRINT N'45_Shankh.sql applied.';
GO

/* ############################## 46_Nirnay.sql ############################## */
PRINT N'Applying 46_Nirnay.sql ...';
GO
/* =====================================================================
   ShankhNaad round 46 (safe to run more than once; needs 01–02 and 40_OrgStructure.sql):
     Nirnay: the decision log.
     1. Any chat message can be marked as a decision (or an action item) with an owner.
     2. A meeting can end with a short list of decisions and action items.
     3. One searchable register of everything decided, with where it was decided.
   Who sees a decision: people in the chat it came from, people invited to the meeting it came from,
   its owner and the person who recorded it. Ones added straight on the register are for everyone
   in the workspace. Admins see the same as everyone else (one-to-one chats stay private).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Decisions', N'U') IS NULL
CREATE TABLE dbo.sahyog_Decisions
(
    DecisionId      INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Decisions PRIMARY KEY,
    TenantId        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Decisions_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Kind            CHAR(1)          NOT NULL CONSTRAINT DF_sahyog_Decisions_Kind DEFAULT ('D'),   -- D decision, A action item
    Title           NVARCHAR(300)    NOT NULL,
    Details         NVARCHAR(1000)   NULL,
    OwnerId         UNIQUEIDENTIFIER NULL,
    DueDate         DATE             NULL,               -- action items
    DoneUtc         DATETIME2(3)     NULL,
    DoneBy          UNIQUEIDENTIFIER NULL,
    ChannelId       UNIQUEIDENTIFIER NULL,               -- from a chat message ...
    MessageId       BIGINT           NULL,
    MeetingId       UNIQUEIDENTIFIER NULL,               -- ... or from a meeting (that date)
    MeetingDate     DATE             NULL,
    RecordedBy      UNIQUEIDENTIFIER NOT NULL,
    RecordedUtc     DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Decisions_Recorded DEFAULT (SYSUTCDATETIME()),
    IsDeleted       BIT              NOT NULL CONSTRAINT DF_sahyog_Decisions_Deleted DEFAULT (0),
    CONSTRAINT CK_sahyog_Decisions_Kind CHECK (Kind IN ('D', 'A'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Decisions_Tenant')
    CREATE INDEX IX_sahyog_Decisions_Tenant ON dbo.sahyog_Decisions(TenantId, RecordedUtc DESC) WHERE IsDeleted = 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Decisions_Message')
    CREATE INDEX IX_sahyog_Decisions_Message ON dbo.sahyog_Decisions(MessageId) WHERE MessageId IS NOT NULL AND IsDeleted = 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Decisions_Meeting')
    CREATE INDEX IX_sahyog_Decisions_Meeting ON dbo.sahyog_Decisions(MeetingId, MeetingDate) WHERE MeetingId IS NOT NULL AND IsDeleted = 0;
GO

/* ---------- can this person see this decision? (one place, used by every read) ---------- */
CREATE OR ALTER FUNCTION dbo.sahyog_Decision_CanSee
(
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER,
    @OwnerId UNIQUEIDENTIFIER, @RecordedBy UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER
)
RETURNS BIT
AS
BEGIN
    IF @OwnerId = @UserId OR @RecordedBy = @UserId RETURN 1;
    IF @ChannelId IS NULL AND @MeetingId IS NULL RETURN 1;
    IF @ChannelId IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers cm WHERE cm.ChannelId = @ChannelId AND cm.UserId = @UserId)
        RETURN 1;
    IF @MeetingId IS NOT NULL AND EXISTS (
        SELECT 1 FROM dbo.sahyog_Meetings m
        WHERE m.MeetingId = @MeetingId AND m.TenantId = @TenantId
          AND (m.HostId = @UserId
               OR EXISTS (SELECT 1 FROM dbo.sahyog_MeetingInvitees i WHERE i.MeetingId = m.MeetingId AND i.UserId = @UserId)))
        RETURN 1;
    RETURN 0;
END
GO

/* ---------- one row as the app shows it ---------- */
CREATE OR ALTER VIEW dbo.sahyog_DecisionRows
AS
SELECT d.DecisionId, d.TenantId, d.Kind, d.Title, d.Details, d.OwnerId, d.DueDate, d.DoneUtc, d.ChannelId, d.MessageId,
       d.MeetingId, d.MeetingDate, d.RecordedBy, d.RecordedUtc,
       o.DisplayName AS OwnerName, o.AvatarTone AS OwnerTone, o.DepartmentId,
       dep.Name AS DepartmentName,
       r.DisplayName AS RecordedByName,
       c.Name AS ChannelName, CAST(ISNULL(c.IsDirect, 0) AS BIT) AS ChannelIsDirect,
       mt.Title AS MeetingTitle, mt.HostId AS MeetingHostId
FROM dbo.sahyog_Decisions d
LEFT JOIN dbo.sahyog_Users o        ON o.UserId = d.OwnerId
LEFT JOIN dbo.sahyog_Departments dep ON dep.DepartmentId = o.DepartmentId
LEFT JOIN dbo.sahyog_Users r        ON r.UserId = d.RecordedBy
LEFT JOIN dbo.sahyog_Channels c     ON c.ChannelId = d.ChannelId
LEFT JOIN dbo.sahyog_Meetings mt    ON mt.MeetingId = d.MeetingId
WHERE d.IsDeleted = 0;
GO

/* ---------- add or change one ----------
   New from a message: the message must be in that chat (the app checks the person is in the chat).
   Returns the DecisionId (0 when the message isn't there). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_Save
    @DecisionId  INT = NULL,
    @TenantId    UNIQUEIDENTIFIER,
    @UserId      UNIQUEIDENTIFIER,
    @Kind        CHAR(1),
    @Title       NVARCHAR(300),
    @Details     NVARCHAR(1000) = NULL,
    @OwnerId     UNIQUEIDENTIFIER = NULL,
    @DueDate     DATE = NULL,
    @ChannelId   UNIQUEIDENTIFIER = NULL,
    @MessageId   BIGINT = NULL,
    @MeetingId   UNIQUEIDENTIFIER = NULL,
    @MeetingDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @Kind NOT IN ('D', 'A') SET @Kind = 'D';
    IF @Kind = 'D' SET @DueDate = NULL;
    -- the owner must be someone in this workspace
    IF @OwnerId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @OwnerId AND TenantId = @TenantId)
        SET @OwnerId = NULL;

    IF @DecisionId IS NULL OR @DecisionId = 0
    BEGIN
        IF @MessageId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.sahyog_Messages WHERE MessageId = @MessageId AND ChannelId = @ChannelId AND TenantId = @TenantId)
        BEGIN SELECT CAST(0 AS INT) AS DecisionId; RETURN; END;
        IF @MessageId IS NULL AND @MeetingId IS NULL SET @ChannelId = NULL;

        INSERT dbo.sahyog_Decisions (TenantId, Kind, Title, Details, OwnerId, DueDate, ChannelId, MessageId, MeetingId, MeetingDate, RecordedBy)
        VALUES (@TenantId, @Kind, @Title, @Details, @OwnerId, @DueDate, @ChannelId, @MessageId, @MeetingId, @MeetingDate, @UserId);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS DecisionId;
        RETURN;
    END;

    -- changing: only what it says and who owns it; where it came from stays
    UPDATE dbo.sahyog_Decisions
    SET Kind = @Kind, Title = @Title, Details = @Details, OwnerId = @OwnerId, DueDate = @DueDate,
        DoneUtc = CASE WHEN @Kind = 'D' THEN NULL ELSE DoneUtc END
    WHERE DecisionId = @DecisionId AND TenantId = @TenantId AND IsDeleted = 0;
    SELECT CASE WHEN @@ROWCOUNT = 1 THEN @DecisionId ELSE 0 END AS DecisionId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_Get
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @DecisionId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.* FROM dbo.sahyog_DecisionRows v
    WHERE v.DecisionId = @DecisionId AND v.TenantId = @TenantId
      AND dbo.sahyog_Decision_CanSee(@TenantId, @UserId, v.OwnerId, v.RecordedBy, v.ChannelId, v.MeetingId) = 1;
END
GO

/* ---------- the register ----------
   @Kind: NULL all, 'D', 'A';  @Open = 1: action items not done;  @Mine = 1: owned or recorded by me
   @Source: NULL any, 'chat', 'meeting', 'other';  @Search matches the text, owner, chat or meeting name */
CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_List
    @TenantId     UNIQUEIDENTIFIER,
    @UserId       UNIQUEIDENTIFIER,
    @Kind         CHAR(1) = NULL,
    @Open         BIT = 0,
    @Mine         BIT = 0,
    @Source       VARCHAR(10) = NULL,
    @DepartmentId UNIQUEIDENTIFIER = NULL,
    @FromUtc      DATETIME2(3) = NULL,
    @Search       NVARCHAR(100) = NULL,
    @Top          INT = 300
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @q NVARCHAR(110) = CASE WHEN NULLIF(LTRIM(RTRIM(@Search)), N'') IS NULL THEN NULL
                                    ELSE N'%' + REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(@Search)), N'[', N'[[]'), N'%', N'[%]'), N'_', N'[_]') + N'%' END;
    SELECT TOP (@Top) v.*
    FROM dbo.sahyog_DecisionRows v
    WHERE v.TenantId = @TenantId
      AND (@Kind IS NULL OR v.Kind = @Kind)
      AND (@Open = 0 OR (v.Kind = 'A' AND v.DoneUtc IS NULL))
      AND (@Mine = 0 OR v.OwnerId = @UserId OR v.RecordedBy = @UserId)
      AND (@Source IS NULL
           OR (@Source = 'chat' AND v.MessageId IS NOT NULL)
           OR (@Source = 'meeting' AND v.MeetingId IS NOT NULL)
           OR (@Source = 'other' AND v.MessageId IS NULL AND v.MeetingId IS NULL))
      AND (@DepartmentId IS NULL OR v.DepartmentId = @DepartmentId)
      AND (@FromUtc IS NULL OR v.RecordedUtc >= @FromUtc)
      AND (@q IS NULL OR v.Title LIKE @q OR v.Details LIKE @q OR v.OwnerName LIKE @q OR v.ChannelName LIKE @q OR v.MeetingTitle LIKE @q)
      AND dbo.sahyog_Decision_CanSee(@TenantId, @UserId, v.OwnerId, v.RecordedBy, v.ChannelId, v.MeetingId) = 1
    ORDER BY v.RecordedUtc DESC;
END
GO

/* ---------- the cards under chat messages on screen (@Ids = "1,2,3") ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_ForMessages
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Ids NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.*
    FROM dbo.sahyog_DecisionRows v
    JOIN (SELECT DISTINCT TRY_CAST(value AS BIGINT) AS Id FROM STRING_SPLIT(@Ids, ',')) x ON x.Id = v.MessageId
    WHERE v.TenantId = @TenantId
      AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers cm WHERE cm.ChannelId = v.ChannelId AND cm.UserId = @UserId)
    ORDER BY v.DecisionId;
END
GO

/* ---------- a meeting's decisions and action items (one date of a repeating meeting) ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_ForMeeting
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @MeetingDate DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.*
    FROM dbo.sahyog_DecisionRows v
    WHERE v.TenantId = @TenantId AND v.MeetingId = @MeetingId
      AND (@MeetingDate IS NULL OR v.MeetingDate = @MeetingDate OR v.MeetingDate IS NULL)
    ORDER BY v.Kind DESC, v.DecisionId;   -- decisions first, then action items
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_SetDone
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @DecisionId INT, @Done BIT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Decisions
    SET DoneUtc = CASE WHEN @Done = 1 THEN SYSUTCDATETIME() ELSE NULL END,
        DoneBy  = CASE WHEN @Done = 1 THEN @UserId ELSE NULL END
    WHERE DecisionId = @DecisionId AND TenantId = @TenantId AND Kind = 'A' AND IsDeleted = 0;
    SELECT @@ROWCOUNT AS Changed;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_Delete
    @TenantId UNIQUEIDENTIFIER, @DecisionId INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Decisions SET IsDeleted = 1 WHERE DecisionId = @DecisionId AND TenantId = @TenantId AND IsDeleted = 0;
    SELECT @@ROWCOUNT AS Changed;
END
GO

PRINT N'46_Nirnay.sql: decision log ready.';
GO

PRINT N'46_Nirnay.sql applied.';
GO

/* ############################## 47_Standup.sql ############################## */
PRINT N'Applying 47_Standup.sql ...';
GO
/* =====================================================================
   ShankhNaad round 47 (safe to run more than once; needs 01–02 and 40_OrgStructure.sql):
     Async stand-up. A team (a department, or everyone) answers three short questions on set days;
     at the set time ShankhNaad reminds whoever hasn't answered; the roll-up shows answers and blockers.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Standups', N'U') IS NULL
CREATE TABLE dbo.sahyog_Standups
(
    StandupId    INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Standups PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Standups_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Name         NVARCHAR(80)     NOT NULL,
    DepartmentId UNIQUEIDENTIFIER NULL,                -- NULL = everyone in the workspace
    Days         TINYINT          NOT NULL CONSTRAINT DF_sahyog_Standups_Days DEFAULT (31),   -- bit 0 Monday … bit 6 Sunday
    AtMinutes    SMALLINT         NOT NULL CONSTRAINT DF_sahyog_Standups_At DEFAULT (600),    -- local time, minutes after midnight
    Q1           NVARCHAR(150)    NOT NULL,
    Q2           NVARCHAR(150)    NOT NULL,
    Q3           NVARCHAR(150)    NOT NULL,
    IsActive     BIT              NOT NULL CONSTRAINT DF_sahyog_Standups_Active DEFAULT (1),
    CreatedBy    UNIQUEIDENTIFIER NOT NULL,
    CreatedUtc   DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Standups_Created DEFAULT (SYSUTCDATETIME()),
    LastRunDay   DATE             NULL                  -- the day the reminder last went out
);
GO
IF OBJECT_ID(N'dbo.sahyog_StandupAnswers', N'U') IS NULL
CREATE TABLE dbo.sahyog_StandupAnswers
(
    StandupId    INT              NOT NULL CONSTRAINT FK_sahyog_StandupAnswers_Standups REFERENCES dbo.sahyog_Standups(StandupId) ON DELETE CASCADE,
    UserId       UNIQUEIDENTIFIER NOT NULL,
    Day          DATE             NOT NULL,
    A1           NVARCHAR(1000)   NULL,
    A2           NVARCHAR(1000)   NULL,
    A3           NVARCHAR(1000)   NULL,
    HasBlocker   BIT              NOT NULL CONSTRAINT DF_sahyog_StandupAnswers_Blocker DEFAULT (0),
    AnsweredUtc  DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_StandupAnswers_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sahyog_StandupAnswers PRIMARY KEY (StandupId, Day, UserId)
);
GO

/* the people in a stand-up: its department, or everyone active */
CREATE OR ALTER FUNCTION dbo.sahyog_Standup_People (@StandupId INT)
RETURNS TABLE
AS RETURN
    SELECT u.UserId, u.DisplayName, u.AvatarTone, u.ManagerId, u.JobTitle
    FROM dbo.sahyog_Standups s
    JOIN dbo.sahyog_Users u ON u.TenantId = s.TenantId AND u.IsActive = 1
    WHERE s.StandupId = @StandupId
      AND (s.DepartmentId IS NULL OR u.DepartmentId = s.DepartmentId);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_List
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.StandupId, s.Name, s.DepartmentId, d.Name AS DepartmentName, s.Days, s.AtMinutes, s.Q1, s.Q2, s.Q3, s.IsActive,
           s.CreatedBy, c.DisplayName AS CreatedByName,
           (SELECT COUNT(*) FROM dbo.sahyog_Standup_People(s.StandupId)) AS People
    FROM dbo.sahyog_Standups s
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = s.DepartmentId
    LEFT JOIN dbo.sahyog_Users c ON c.UserId = s.CreatedBy
    WHERE s.TenantId = @TenantId
    ORDER BY s.IsActive DESC, s.Name;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_Save
    @StandupId INT = NULL, @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER,
    @Name NVARCHAR(80), @DepartmentId UNIQUEIDENTIFIER = NULL, @Days TINYINT, @AtMinutes SMALLINT,
    @Q1 NVARCHAR(150), @Q2 NVARCHAR(150), @Q3 NVARCHAR(150), @IsActive BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    IF @DepartmentId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Departments WHERE DepartmentId = @DepartmentId AND TenantId = @TenantId)
        SET @DepartmentId = NULL;
    IF @StandupId IS NULL OR @StandupId = 0
    BEGIN
        INSERT dbo.sahyog_Standups (TenantId, Name, DepartmentId, Days, AtMinutes, Q1, Q2, Q3, IsActive, CreatedBy)
        VALUES (@TenantId, @Name, @DepartmentId, @Days, @AtMinutes, @Q1, @Q2, @Q3, @IsActive, @UserId);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS StandupId;
        RETURN;
    END;
    UPDATE dbo.sahyog_Standups
    SET Name = @Name, DepartmentId = @DepartmentId, Days = @Days,
        -- a new time today: let the reminder go out again
        LastRunDay = CASE WHEN AtMinutes <> @AtMinutes THEN NULL ELSE LastRunDay END,
        AtMinutes = @AtMinutes, Q1 = @Q1, Q2 = @Q2, Q3 = @Q3, IsActive = @IsActive
    WHERE StandupId = @StandupId AND TenantId = @TenantId;
    SELECT CASE WHEN @@ROWCOUNT = 1 THEN @StandupId ELSE 0 END AS StandupId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_Delete
    @TenantId UNIQUEIDENTIFIER, @StandupId INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_Standups WHERE StandupId = @StandupId AND TenantId = @TenantId;
    SELECT @@ROWCOUNT AS Changed;
END
GO

/* my stand-ups (I'm in them), with my answer for @Day if I gave one */
CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_Mine
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Day DATE
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.StandupId, s.Name, s.Days, s.AtMinutes, s.Q1, s.Q2, s.Q3, d.Name AS DepartmentName,
           a.A1, a.A2, a.A3, a.HasBlocker, a.AnsweredUtc
    FROM dbo.sahyog_Standups s
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = s.DepartmentId
    LEFT JOIN dbo.sahyog_StandupAnswers a ON a.StandupId = s.StandupId AND a.Day = @Day AND a.UserId = @UserId
    WHERE s.TenantId = @TenantId AND s.IsActive = 1
      AND EXISTS (SELECT 1 FROM dbo.sahyog_Standup_People(s.StandupId) p WHERE p.UserId = @UserId)
    ORDER BY s.AtMinutes, s.Name;
END
GO

/* answer (or change my answer). Returns 0 when I'm not in that stand-up. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_Answer
    @TenantId UNIQUEIDENTIFIER, @StandupId INT, @UserId UNIQUEIDENTIFIER, @Day DATE,
    @A1 NVARCHAR(1000), @A2 NVARCHAR(1000), @A3 NVARCHAR(1000), @HasBlocker BIT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Standups WHERE StandupId = @StandupId AND TenantId = @TenantId)
       OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_Standup_People(@StandupId) WHERE UserId = @UserId)
    BEGIN SELECT CAST(0 AS BIT) AS Saved, CAST(0 AS BIT) AS WasBlocked; RETURN; END;

    DECLARE @was BIT = (SELECT HasBlocker FROM dbo.sahyog_StandupAnswers WHERE StandupId = @StandupId AND Day = @Day AND UserId = @UserId);
    IF @was IS NULL
        INSERT dbo.sahyog_StandupAnswers (StandupId, UserId, Day, A1, A2, A3, HasBlocker) VALUES (@StandupId, @UserId, @Day, @A1, @A2, @A3, @HasBlocker);
    ELSE
        UPDATE dbo.sahyog_StandupAnswers SET A1 = @A1, A2 = @A2, A3 = @A3, HasBlocker = @HasBlocker, AnsweredUtc = SYSUTCDATETIME()
        WHERE StandupId = @StandupId AND Day = @Day AND UserId = @UserId;

    -- who to tell about a new blocker: the person's manager and whoever set up the stand-up
    SELECT CAST(1 AS BIT) AS Saved, CAST(ISNULL(@was, 0) AS BIT) AS WasBlocked, s.Name, s.CreatedBy, u.ManagerId, u.DisplayName
    FROM dbo.sahyog_Standups s CROSS JOIN dbo.sahyog_Users u
    WHERE s.StandupId = @StandupId AND u.UserId = @UserId;
END
GO

/* the roll-up for one day: the stand-up, then everyone in it with their answer (or none) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_Rollup
    @TenantId UNIQUEIDENTIFIER, @StandupId INT, @Day DATE
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.StandupId, s.Name, s.DepartmentId, d.Name AS DepartmentName, s.Days, s.AtMinutes, s.Q1, s.Q2, s.Q3, s.IsActive, s.CreatedBy
    FROM dbo.sahyog_Standups s
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = s.DepartmentId
    WHERE s.StandupId = @StandupId AND s.TenantId = @TenantId;

    SELECT p.UserId, p.DisplayName, p.AvatarTone, p.JobTitle, a.A1, a.A2, a.A3, a.HasBlocker, a.AnsweredUtc
    FROM dbo.sahyog_Standup_People(@StandupId) p
    JOIN dbo.sahyog_Standups s ON s.StandupId = @StandupId AND s.TenantId = @TenantId
    LEFT JOIN dbo.sahyog_StandupAnswers a ON a.StandupId = @StandupId AND a.Day = @Day AND a.UserId = p.UserId
    ORDER BY CASE WHEN a.HasBlocker = 1 THEN 0 WHEN a.UserId IS NOT NULL THEN 1 ELSE 2 END, a.AnsweredUtc, p.DisplayName;
END
GO

/* the reminder job: every active stand-up, with its workspace's time zone */
CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_All
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.StandupId, s.TenantId, s.Name, s.Days, s.AtMinutes, s.LastRunDay, t.TimeZoneId
    FROM dbo.sahyog_Standups s
    JOIN dbo.sahyog_Tenants t ON t.TenantId = s.TenantId AND t.IsActive = 1
    WHERE s.IsActive = 1;
END
GO

/* marks today's reminder as sent and returns who hasn't answered yet (each stand-up once a day) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Standup_TakeRun
    @StandupId INT, @Day DATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Standups SET LastRunDay = @Day
    WHERE StandupId = @StandupId AND (LastRunDay IS NULL OR LastRunDay < @Day);
    IF @@ROWCOUNT = 0 RETURN;
    SELECT p.UserId
    FROM dbo.sahyog_Standup_People(@StandupId) p
    WHERE NOT EXISTS (SELECT 1 FROM dbo.sahyog_StandupAnswers a WHERE a.StandupId = @StandupId AND a.Day = @Day AND a.UserId = p.UserId);
END
GO

PRINT N'47_Standup.sql: async stand-up ready.';
GO

PRINT N'47_Standup.sql applied.';
GO

/* ############################## 48_StandIn.sql ############################## */
PRINT N'Applying 48_StandIn.sql ...';
GO
/* =====================================================================
   ShankhNaad round 48 (safe to run more than once; needs 32_OutOfOfficeAndEdit.sql and 46_Nirnay.sql):
     Stand-in while out of office ("Ask Neha instead") and the "While you were away" catch-up.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_StandIns', N'U') IS NULL
CREATE TABLE dbo.sahyog_StandIns
(
    UserId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_StandIns PRIMARY KEY
               CONSTRAINT FK_sahyog_StandIns_Users REFERENCES dbo.sahyog_Users(UserId) ON DELETE CASCADE,
    TenantId   UNIQUEIDENTIFIER NOT NULL,
    StandInId  UNIQUEIDENTIFIER NOT NULL,
    SetUtc     DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_StandIns_Set DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_StandIns_Tenant')
    CREATE INDEX IX_sahyog_StandIns_Tenant ON dbo.sahyog_StandIns(TenantId);
GO

/* @StandInId NULL = nobody */
CREATE OR ALTER PROCEDURE dbo.sahyog_StandIn_Set
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @StandInId UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @StandInId IS NULL OR @StandInId = @UserId
       OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @StandInId AND TenantId = @TenantId AND IsActive = 1)
    BEGIN
        DELETE dbo.sahyog_StandIns WHERE UserId = @UserId AND TenantId = @TenantId;
        SELECT CAST(NULL AS UNIQUEIDENTIFIER) AS StandInId, CAST(NULL AS NVARCHAR(100)) AS StandInName;
        RETURN;
    END;
    IF EXISTS (SELECT 1 FROM dbo.sahyog_StandIns WHERE UserId = @UserId)
        UPDATE dbo.sahyog_StandIns SET StandInId = @StandInId, SetUtc = SYSUTCDATETIME() WHERE UserId = @UserId;
    ELSE
        INSERT dbo.sahyog_StandIns (UserId, TenantId, StandInId) VALUES (@UserId, @TenantId, @StandInId);
    SELECT u.UserId AS StandInId, u.DisplayName AS StandInName FROM dbo.sahyog_Users u WHERE u.UserId = @StandInId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_StandIn_List
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.UserId, s.StandInId, u.DisplayName AS StandInName, u.AvatarTone AS StandInTone
    FROM dbo.sahyog_StandIns s
    JOIN dbo.sahyog_Users u ON u.UserId = s.StandInId AND u.IsActive = 1
    WHERE s.TenantId = @TenantId;
END
GO

/* ---------- "While you were away": what happened since @SinceUtc ----------
   1 chats with unread messages · 2 decisions in my chats/meetings · 3 open action items for me
   4 meetings I was invited to that took place · 5 what my stand-in wrote in chats we share */
CREATE OR ALTER PROCEDURE dbo.sahyog_Away_Summary
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @SinceUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @now DATETIME2(3) = SYSUTCDATETIME();

    SELECT TOP (12) c.ChannelId, c.IsDirect, cm.UnreadCount, c.LastMessageUtc,
           CASE WHEN c.IsDirect = 1 THEN o.DisplayName ELSE c.Name END AS Name,
           CASE WHEN c.IsDirect = 1 THEN o.AvatarTone ELSE 0 END AS Tone
    FROM dbo.sahyog_ChannelMembers cm
    JOIN dbo.sahyog_Channels c ON c.ChannelId = cm.ChannelId
    OUTER APPLY (SELECT TOP (1) u.DisplayName, u.AvatarTone FROM dbo.sahyog_ChannelMembers x JOIN dbo.sahyog_Users u ON u.UserId = x.UserId
                 WHERE x.ChannelId = c.ChannelId AND x.UserId <> @UserId) o
    WHERE cm.UserId = @UserId AND cm.TenantId = @TenantId AND cm.UnreadCount > 0
    ORDER BY cm.UnreadCount DESC, c.LastMessageUtc DESC;

    IF OBJECT_ID(N'dbo.sahyog_DecisionRows', N'V') IS NOT NULL
    BEGIN
        SELECT TOP (10) v.DecisionId, v.Kind, v.Title, v.OwnerName, v.ChannelId, v.MessageId, v.ChannelName, v.ChannelIsDirect,
               v.MeetingId, v.MeetingTitle, v.RecordedUtc
        FROM dbo.sahyog_DecisionRows v
        WHERE v.TenantId = @TenantId AND v.Kind = 'D' AND v.RecordedUtc >= @SinceUtc
          AND dbo.sahyog_Decision_CanSee(@TenantId, @UserId, v.OwnerId, v.RecordedBy, v.ChannelId, v.MeetingId) = 1
        ORDER BY v.RecordedUtc DESC;

        SELECT TOP (10) v.DecisionId, v.Title, v.DueDate, v.RecordedByName, v.RecordedUtc
        FROM dbo.sahyog_DecisionRows v
        WHERE v.TenantId = @TenantId AND v.Kind = 'A' AND v.DoneUtc IS NULL AND v.OwnerId = @UserId
        ORDER BY CASE WHEN v.DueDate IS NULL THEN 1 ELSE 0 END, v.DueDate, v.RecordedUtc DESC;
    END
    ELSE
    BEGIN
        SELECT CAST(NULL AS INT) AS DecisionId WHERE 1 = 0;
        SELECT CAST(NULL AS INT) AS DecisionId WHERE 1 = 0;
    END;

    SELECT TOP (10) m.MeetingId, m.Title, m.StartUtc, m.DurationMinutes, h.DisplayName AS HostName
    FROM dbo.sahyog_Meetings m
    JOIN dbo.sahyog_Users h ON h.UserId = m.HostId
    WHERE m.TenantId = @TenantId AND m.IsInstant = 0 AND m.Recurrence = 0
      AND m.StartUtc >= @SinceUtc AND m.StartUtc < @now
      AND (m.HostId = @UserId OR EXISTS (SELECT 1 FROM dbo.sahyog_MeetingInvitees i WHERE i.MeetingId = m.MeetingId AND i.UserId = @UserId))
    ORDER BY m.StartUtc DESC;

    -- my stand-in's messages in chats we are both in, while I was away
    SELECT TOP (1) s.StandInId, u.DisplayName AS StandInName,
           (SELECT COUNT(*) FROM dbo.sahyog_Messages msg
            WHERE msg.TenantId = @TenantId AND msg.SenderId = s.StandInId AND msg.SentUtc >= @SinceUtc
              AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers a WHERE a.ChannelId = msg.ChannelId AND a.UserId = @UserId)) AS Messages
    FROM dbo.sahyog_StandIns s
    JOIN dbo.sahyog_Users u ON u.UserId = s.StandInId
    WHERE s.UserId = @UserId AND s.TenantId = @TenantId;
END
GO

PRINT N'48_StandIn.sql: stand-in and catch-up ready.';
GO

PRINT N'48_StandIn.sql applied.';
GO

/* ############################## 49_Roles.sql ############################## */
PRINT N'Applying 49_Roles.sql ...';
GO
/* =====================================================================
   ShankhNaad round 49 (safe to run more than once; needs 01–02 and 40_OrgStructure.sql):
     Message a role. Write to "IT help desk" or "Head of HR" instead of a person; ShankhNaad picks who
     is in and free, opens a chat with them, and escalates when nobody replies in time.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Roles', N'U') IS NULL
CREATE TABLE dbo.sahyog_Roles
(
    RoleId       INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Roles PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Roles_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Name         NVARCHAR(80)     NOT NULL,
    Description  NVARCHAR(200)    NULL,
    Icon         NVARCHAR(30)     NULL,               -- a Font Awesome name, e.g. "life-ring"
    EscalateMin  INT              NOT NULL CONSTRAINT DF_sahyog_Roles_Esc DEFAULT (15),   -- 0 = never
    CreatedUtc   DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Roles_Created DEFAULT (SYSUTCDATETIME())
);
GO
IF OBJECT_ID(N'dbo.sahyog_RoleMembers', N'U') IS NULL
CREATE TABLE dbo.sahyog_RoleMembers
(
    RoleId   INT              NOT NULL CONSTRAINT FK_sahyog_RoleMembers_Roles REFERENCES dbo.sahyog_Roles(RoleId) ON DELETE CASCADE,
    UserId   UNIQUEIDENTIFIER NOT NULL,
    Sort     INT              NOT NULL CONSTRAINT DF_sahyog_RoleMembers_Sort DEFAULT (0),     -- 0 = first to be asked
    CONSTRAINT PK_sahyog_RoleMembers PRIMARY KEY (RoleId, UserId)
);
GO
IF OBJECT_ID(N'dbo.sahyog_RoleRequests', N'U') IS NULL
CREATE TABLE dbo.sahyog_RoleRequests
(
    RequestId    INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_RoleRequests PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL,
    RoleId       INT              NOT NULL CONSTRAINT FK_sahyog_RoleRequests_Roles REFERENCES dbo.sahyog_Roles(RoleId) ON DELETE CASCADE,
    FromUserId   UNIQUEIDENTIFIER NOT NULL,
    Body         NVARCHAR(1000)   NOT NULL,
    AssignedTo   UNIQUEIDENTIFIER NOT NULL,
    ChannelId    UNIQUEIDENTIFIER NOT NULL,
    CreatedUtc   DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_RoleRequests_Created DEFAULT (SYSUTCDATETIME()),
    AnsweredUtc  DATETIME2(3)     NULL,
    EscalatedUtc DATETIME2(3)     NULL,
    EscalatedTo  UNIQUEIDENTIFIER NULL,
    EscChannelId UNIQUEIDENTIFIER NULL,               -- the chat with the person it was escalated to
    ClosedUtc    DATETIME2(3)     NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_RoleRequests_Open')
    CREATE INDEX IX_sahyog_RoleRequests_Open ON dbo.sahyog_RoleRequests(CreatedUtc) WHERE AnsweredUtc IS NULL AND EscalatedUtc IS NULL AND ClosedUtc IS NULL;
GO

/* roles, then their people (in order) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Role_List
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT r.RoleId, r.Name, r.Description, r.Icon, r.EscalateMin,
           (SELECT COUNT(*) FROM dbo.sahyog_RoleRequests q WHERE q.RoleId = r.RoleId AND q.AnsweredUtc IS NULL AND q.ClosedUtc IS NULL) AS Waiting
    FROM dbo.sahyog_Roles r WHERE r.TenantId = @TenantId ORDER BY r.Name;

    SELECT m.RoleId, m.UserId, m.Sort, u.DisplayName, u.AvatarTone, u.JobTitle, u.ManagerId
    FROM dbo.sahyog_RoleMembers m
    JOIN dbo.sahyog_Roles r ON r.RoleId = m.RoleId AND r.TenantId = @TenantId
    JOIN dbo.sahyog_Users u ON u.UserId = m.UserId AND u.IsActive = 1
    ORDER BY m.RoleId, m.Sort, u.DisplayName;
END
GO

/* add or change a role; @MemberIds = a JSON array of ids, in the order they are asked: ["id","id"] */
CREATE OR ALTER PROCEDURE dbo.sahyog_Role_Save
    @RoleId INT = NULL, @TenantId UNIQUEIDENTIFIER, @Name NVARCHAR(80), @Description NVARCHAR(200) = NULL,
    @Icon NVARCHAR(30) = NULL, @EscalateMin INT = 15, @MemberIds NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;
    IF @RoleId IS NULL OR @RoleId = 0
    BEGIN
        INSERT dbo.sahyog_Roles (TenantId, Name, Description, Icon, EscalateMin) VALUES (@TenantId, @Name, @Description, @Icon, @EscalateMin);
        SET @RoleId = CAST(SCOPE_IDENTITY() AS INT);
    END
    ELSE
    BEGIN
        UPDATE dbo.sahyog_Roles SET Name = @Name, Description = @Description, Icon = @Icon, EscalateMin = @EscalateMin
        WHERE RoleId = @RoleId AND TenantId = @TenantId;
        IF @@ROWCOUNT = 0 BEGIN ROLLBACK; SELECT CAST(0 AS INT) AS RoleId; RETURN; END;
        DELETE dbo.sahyog_RoleMembers WHERE RoleId = @RoleId;
    END;
    INSERT dbo.sahyog_RoleMembers (RoleId, UserId, Sort)
    SELECT @RoleId, u.UserId, MIN(x.ordinal)
    FROM (SELECT TRY_CAST(j.[value] AS UNIQUEIDENTIFIER) AS Id, CAST(j.[key] AS INT) AS ordinal
          FROM OPENJSON(@MemberIds) j) x
    JOIN dbo.sahyog_Users u ON u.UserId = x.Id AND u.TenantId = @TenantId AND u.IsActive = 1
    GROUP BY u.UserId;
    COMMIT;
    SELECT @RoleId AS RoleId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Role_Delete
    @TenantId UNIQUEIDENTIFIER, @RoleId INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_Roles WHERE RoleId = @RoleId AND TenantId = @TenantId;
    SELECT @@ROWCOUNT AS Changed;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_RoleRequest_Create
    @TenantId UNIQUEIDENTIFIER, @RoleId INT, @FromUserId UNIQUEIDENTIFIER, @Body NVARCHAR(1000),
    @AssignedTo UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Roles WHERE RoleId = @RoleId AND TenantId = @TenantId)
    BEGIN SELECT CAST(0 AS INT) AS RequestId; RETURN; END;
    INSERT dbo.sahyog_RoleRequests (TenantId, RoleId, FromUserId, Body, AssignedTo, ChannelId)
    VALUES (@TenantId, @RoleId, @FromUserId, @Body, @AssignedTo, @ChannelId);
    SELECT CAST(SCOPE_IDENTITY() AS INT) AS RequestId;
END
GO

/* requests I sent, and requests to roles I'm in (latest 60) */
CREATE OR ALTER PROCEDURE dbo.sahyog_RoleRequest_Mine
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    -- first: notice replies (from the person asked in that chat, or from the person it was escalated to in theirs)
    UPDATE q SET AnsweredUtc = SYSUTCDATETIME()
    FROM dbo.sahyog_RoleRequests q
    WHERE q.TenantId = @TenantId AND q.AnsweredUtc IS NULL AND q.ClosedUtc IS NULL
      AND (EXISTS (SELECT 1 FROM dbo.sahyog_Messages m WHERE m.ChannelId = q.ChannelId AND m.SentUtc > q.CreatedUtc AND m.SenderId = q.AssignedTo)
        OR EXISTS (SELECT 1 FROM dbo.sahyog_Messages m WHERE m.ChannelId = q.EscChannelId AND m.SentUtc > q.EscalatedUtc AND m.SenderId = q.EscalatedTo));

    SELECT TOP (60) q.RequestId, q.RoleId, q.EscChannelId, r.Name AS RoleName, r.Icon, q.Body, q.CreatedUtc, q.AnsweredUtc, q.EscalatedUtc, q.ClosedUtc, q.ChannelId,
           q.FromUserId, f.DisplayName AS FromName, f.AvatarTone AS FromTone,
           q.AssignedTo, a.DisplayName AS AssignedName, q.EscalatedTo, e.DisplayName AS EscalatedName,
           CAST(CASE WHEN q.FromUserId = @UserId THEN 1 ELSE 0 END AS BIT) AS Sent
    FROM dbo.sahyog_RoleRequests q
    JOIN dbo.sahyog_Roles r ON r.RoleId = q.RoleId
    JOIN dbo.sahyog_Users f ON f.UserId = q.FromUserId
    JOIN dbo.sahyog_Users a ON a.UserId = q.AssignedTo
    LEFT JOIN dbo.sahyog_Users e ON e.UserId = q.EscalatedTo
    WHERE q.TenantId = @TenantId
      AND (q.FromUserId = @UserId OR q.AssignedTo = @UserId OR q.EscalatedTo = @UserId
           OR EXISTS (SELECT 1 FROM dbo.sahyog_RoleMembers rm WHERE rm.RoleId = q.RoleId AND rm.UserId = @UserId))
    ORDER BY CASE WHEN q.AnsweredUtc IS NULL AND q.ClosedUtc IS NULL THEN 0 ELSE 1 END, q.CreatedUtc DESC;
END
GO

/* close: the person who asked, or anyone in the role */
CREATE OR ALTER PROCEDURE dbo.sahyog_RoleRequest_Close
    @TenantId UNIQUEIDENTIFIER, @RequestId INT, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE q SET ClosedUtc = SYSUTCDATETIME()
    FROM dbo.sahyog_RoleRequests q
    WHERE q.RequestId = @RequestId AND q.TenantId = @TenantId AND q.ClosedUtc IS NULL
      AND (q.FromUserId = @UserId OR q.AssignedTo = @UserId OR q.EscalatedTo = @UserId
           OR EXISTS (SELECT 1 FROM dbo.sahyog_RoleMembers rm WHERE rm.RoleId = q.RoleId AND rm.UserId = @UserId));
    SELECT @@ROWCOUNT AS Changed;
END
GO

/* the escalation job: marks replies, then takes requests still unanswered after the role's minutes (each once) */
CREATE OR ALTER PROCEDURE dbo.sahyog_RoleRequest_TakeDue
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE q SET AnsweredUtc = SYSUTCDATETIME()
    FROM dbo.sahyog_RoleRequests q
    WHERE q.AnsweredUtc IS NULL AND q.ClosedUtc IS NULL AND q.EscalatedUtc IS NULL
      AND EXISTS (SELECT 1 FROM dbo.sahyog_Messages m WHERE m.ChannelId = q.ChannelId AND m.SentUtc > q.CreatedUtc AND m.SenderId = q.AssignedTo);

    DECLARE @due TABLE (RequestId INT);
    UPDATE q SET EscalatedUtc = SYSUTCDATETIME()
    OUTPUT inserted.RequestId INTO @due
    FROM dbo.sahyog_RoleRequests q
    JOIN dbo.sahyog_Roles r ON r.RoleId = q.RoleId
    WHERE q.AnsweredUtc IS NULL AND q.ClosedUtc IS NULL AND q.EscalatedUtc IS NULL
      AND r.EscalateMin > 0 AND q.CreatedUtc <= DATEADD(MINUTE, -r.EscalateMin, SYSUTCDATETIME());

    SELECT q.RequestId, q.TenantId, q.RoleId, r.Name AS RoleName, r.EscalateMin, q.Body, q.FromUserId, f.DisplayName AS FromName,
           q.AssignedTo, a.DisplayName AS AssignedName, a.ManagerId
    FROM @due d
    JOIN dbo.sahyog_RoleRequests q ON q.RequestId = d.RequestId
    JOIN dbo.sahyog_Roles r ON r.RoleId = q.RoleId
    JOIN dbo.sahyog_Users f ON f.UserId = q.FromUserId
    JOIN dbo.sahyog_Users a ON a.UserId = q.AssignedTo;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_RoleRequest_SetEscalated
    @RequestId INT, @EscalatedTo UNIQUEIDENTIFIER, @EscChannelId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_RoleRequests SET EscalatedTo = @EscalatedTo, EscChannelId = @EscChannelId WHERE RequestId = @RequestId;
END
GO

PRINT N'49_Roles.sql: message a role ready.';
GO

PRINT N'49_Roles.sql applied.';
GO

/* ############################## 50_Scheduling.sql ############################## */
PRINT N'Applying 50_Scheduling.sql ...';
GO
/* =====================================================================
   ShankhNaad round 50 (safe to run more than once; needs 01–02):
     Smart scheduling: the workspace's holidays (suggested meeting times skip them).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Holidays', N'U') IS NULL
CREATE TABLE dbo.sahyog_Holidays
(
    HolidayId  INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Holidays PRIMARY KEY,
    TenantId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Holidays_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Day        DATE             NOT NULL,
    Name       NVARCHAR(100)    NOT NULL,
    CONSTRAINT UX_sahyog_Holidays_Day UNIQUE (TenantId, Day)
);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Holiday_List
    @TenantId UNIQUEIDENTIFIER, @From DATE = NULL, @To DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT HolidayId, Day, Name FROM dbo.sahyog_Holidays
    WHERE TenantId = @TenantId AND (@From IS NULL OR Day >= @From) AND (@To IS NULL OR Day <= @To)
    ORDER BY Day;
END
GO

/* add, or rename the holiday on that day */
CREATE OR ALTER PROCEDURE dbo.sahyog_Holiday_Save
    @TenantId UNIQUEIDENTIFIER, @Day DATE, @Name NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Holidays WHERE TenantId = @TenantId AND Day = @Day)
        UPDATE dbo.sahyog_Holidays SET Name = @Name WHERE TenantId = @TenantId AND Day = @Day;
    ELSE
        INSERT dbo.sahyog_Holidays (TenantId, Day, Name) VALUES (@TenantId, @Day, @Name);
    SELECT HolidayId, Day, Name FROM dbo.sahyog_Holidays WHERE TenantId = @TenantId AND Day = @Day;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Holiday_Delete
    @TenantId UNIQUEIDENTIFIER, @HolidayId INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_Holidays WHERE TenantId = @TenantId AND HolidayId = @HolidayId;
    SELECT @@ROWCOUNT AS Changed;
END
GO

PRINT N'50_Scheduling.sql: holidays ready.';
GO

PRINT N'50_Scheduling.sql applied.';
GO

/* ############################## 51_Visitors.sql ############################## */
PRINT N'Applying 51_Visitors.sql ...';
GO
/* =====================================================================
   ShankhNaad round 51 (safe to run more than once; needs 01–02 and 40_OrgStructure.sql):
     Visitor lobby. A reception tablet (a secret link, no sign-in) where visitors sign in and pick who
     they are meeting; the host gets a card in ShankhNaad and answers "Coming" or "Please wait".
     Staff can expect visitors ahead of time; the day's visitor list is on Work → Visitors.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Lobby', N'U') IS NULL
CREATE TABLE dbo.sahyog_Lobby
(
    TenantId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_Lobby PRIMARY KEY
               CONSTRAINT FK_sahyog_Lobby_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    KioskCode  NVARCHAR(24)     NOT NULL CONSTRAINT UX_sahyog_Lobby_Code UNIQUE,
    Enabled    BIT              NOT NULL CONSTRAINT DF_sahyog_Lobby_Enabled DEFAULT (1),
    Welcome    NVARCHAR(200)    NULL
);
GO
IF OBJECT_ID(N'dbo.sahyog_Visitors', N'U') IS NULL
CREATE TABLE dbo.sahyog_Visitors
(
    VisitorId    INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Visitors PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Visitors_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Name         NVARCHAR(100)    NOT NULL,
    Phone        NVARCHAR(30)     NULL,
    Company      NVARCHAR(100)    NULL,
    Purpose      NVARCHAR(200)    NULL,
    HostId       UNIQUEIDENTIFIER NULL,
    ExpectedUtc  DATETIME2(3)     NULL,             -- set when someone expects them
    ArrivedUtc   DATETIME2(3)     NULL,
    LeftUtc      DATETIME2(3)     NULL,
    HostReply    NVARCHAR(20)     NULL,             -- coming | wait
    HostReplyUtc DATETIME2(3)     NULL,
    KioskToken   NVARCHAR(32)     NULL,             -- lets the tablet see the host's answer
    CreatedBy    UNIQUEIDENTIFIER NULL,             -- NULL = signed in at the tablet
    CreatedUtc   DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Visitors_Created DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Visitors_Day')
    CREATE INDEX IX_sahyog_Visitors_Day ON dbo.sahyog_Visitors(TenantId, CreatedUtc);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Lobby_Get
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TenantId, KioskCode, Enabled, Welcome FROM dbo.sahyog_Lobby WHERE TenantId = @TenantId;
END
GO

/* @NewCode: set (first time, or "make a new link" so the old one stops working) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Lobby_Save
    @TenantId UNIQUEIDENTIFIER, @Enabled BIT, @Welcome NVARCHAR(200) = NULL, @NewCode NVARCHAR(24) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Lobby WHERE TenantId = @TenantId)
        UPDATE dbo.sahyog_Lobby SET Enabled = @Enabled, Welcome = @Welcome, KioskCode = ISNULL(@NewCode, KioskCode) WHERE TenantId = @TenantId;
    ELSE IF @NewCode IS NOT NULL
        INSERT dbo.sahyog_Lobby (TenantId, KioskCode, Enabled, Welcome) VALUES (@TenantId, @NewCode, @Enabled, @Welcome);
    SELECT TenantId, KioskCode, Enabled, Welcome FROM dbo.sahyog_Lobby WHERE TenantId = @TenantId;
END
GO

/* the tablet: which workspace this link belongs to */
CREATE OR ALTER PROCEDURE dbo.sahyog_Lobby_ByCode
    @Code NVARCHAR(24)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.TenantId, l.Welcome, t.Name AS TenantName, t.TimeZoneId
    FROM dbo.sahyog_Lobby l JOIN dbo.sahyog_Tenants t ON t.TenantId = l.TenantId AND t.IsActive = 1
    WHERE l.KioskCode = @Code AND l.Enabled = 1;
END
GO

/* people a visitor can pick at the tablet */
CREATE OR ALTER PROCEDURE dbo.sahyog_Lobby_Hosts
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.UserId, u.DisplayName, u.AvatarTone, u.JobTitle, d.Name AS DepartmentName
    FROM dbo.sahyog_Users u LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = u.DepartmentId
    WHERE u.TenantId = @TenantId AND u.IsActive = 1
    ORDER BY u.DisplayName;
END
GO

/* someone arrives at the tablet: if they were expected today (same phone), check that visit in; otherwise a new one */
CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_KioskArrive
    @TenantId UNIQUEIDENTIFIER, @Name NVARCHAR(100), @Phone NVARCHAR(30) = NULL, @Company NVARCHAR(100) = NULL,
    @Purpose NVARCHAR(200) = NULL, @HostId UNIQUEIDENTIFIER = NULL, @Token NVARCHAR(32), @DayStartUtc DATETIME2(3), @DayEndUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    IF @HostId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @HostId AND TenantId = @TenantId AND IsActive = 1)
        SET @HostId = NULL;
    DECLARE @id INT = NULL;
    IF NULLIF(@Phone, N'') IS NOT NULL
        SELECT TOP (1) @id = VisitorId FROM dbo.sahyog_Visitors
        WHERE TenantId = @TenantId AND Phone = @Phone AND ArrivedUtc IS NULL
          AND ExpectedUtc >= @DayStartUtc AND ExpectedUtc < @DayEndUtc
        ORDER BY ExpectedUtc;
    IF @id IS NOT NULL
        UPDATE dbo.sahyog_Visitors
        SET ArrivedUtc = SYSUTCDATETIME(), KioskToken = @Token, HostId = ISNULL(@HostId, HostId),
            Company = ISNULL(NULLIF(@Company, N''), Company), Purpose = ISNULL(NULLIF(@Purpose, N''), Purpose)
        WHERE VisitorId = @id;
    ELSE
    BEGIN
        INSERT dbo.sahyog_Visitors (TenantId, Name, Phone, Company, Purpose, HostId, ArrivedUtc, KioskToken)
        VALUES (@TenantId, @Name, NULLIF(@Phone, N''), NULLIF(@Company, N''), NULLIF(@Purpose, N''), @HostId, SYSUTCDATETIME(), @Token);
        SET @id = CAST(SCOPE_IDENTITY() AS INT);
    END;
    EXEC dbo.sahyog_Visitor_Get @TenantId = @TenantId, @VisitorId = @id;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_Get
    @TenantId UNIQUEIDENTIFIER, @VisitorId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.VisitorId, v.Name, v.Phone, v.Company, v.Purpose, v.HostId, h.DisplayName AS HostName, h.AvatarTone AS HostTone,
           v.ExpectedUtc, v.ArrivedUtc, v.LeftUtc, v.HostReply, v.HostReplyUtc, v.KioskToken, v.CreatedBy, c.DisplayName AS CreatedByName, v.CreatedUtc
    FROM dbo.sahyog_Visitors v
    LEFT JOIN dbo.sahyog_Users h ON h.UserId = v.HostId
    LEFT JOIN dbo.sahyog_Users c ON c.UserId = v.CreatedBy
    WHERE v.VisitorId = @VisitorId AND v.TenantId = @TenantId;
END
GO

/* a member expects a visitor (@Arrived = 1: a walk-in checked in by staff) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_Expect
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Name NVARCHAR(100), @Phone NVARCHAR(30) = NULL, @Company NVARCHAR(100) = NULL,
    @Purpose NVARCHAR(200) = NULL, @HostId UNIQUEIDENTIFIER = NULL, @ExpectedUtc DATETIME2(3) = NULL, @Arrived BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @HostId IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @HostId AND TenantId = @TenantId AND IsActive = 1)
        SET @HostId = @UserId;
    INSERT dbo.sahyog_Visitors (TenantId, Name, Phone, Company, Purpose, HostId, ExpectedUtc, ArrivedUtc, CreatedBy)
    VALUES (@TenantId, @Name, NULLIF(@Phone, N''), NULLIF(@Company, N''), NULLIF(@Purpose, N''), @HostId,
            ISNULL(@ExpectedUtc, SYSUTCDATETIME()), CASE WHEN @Arrived = 1 THEN SYSUTCDATETIME() END, @UserId);
    DECLARE @id INT = CAST(SCOPE_IDENTITY() AS INT);
    EXEC dbo.sahyog_Visitor_Get @TenantId = @TenantId, @VisitorId = @id;
END
GO

/* what = arrive | leave | coming | wait | delete */
CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_Update
    @TenantId UNIQUEIDENTIFIER, @VisitorId INT, @What NVARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;
    IF @What = N'delete'
    BEGIN
        DELETE dbo.sahyog_Visitors WHERE VisitorId = @VisitorId AND TenantId = @TenantId;
        SELECT CAST(NULL AS INT) AS VisitorId WHERE 1 = 0;
        RETURN;
    END;
    UPDATE dbo.sahyog_Visitors
    SET ArrivedUtc   = CASE WHEN @What = N'arrive' THEN ISNULL(ArrivedUtc, SYSUTCDATETIME()) ELSE ArrivedUtc END,
        LeftUtc      = CASE WHEN @What = N'leave' THEN SYSUTCDATETIME() ELSE LeftUtc END,
        HostReply    = CASE WHEN @What IN (N'coming', N'wait') THEN @What ELSE HostReply END,
        HostReplyUtc = CASE WHEN @What IN (N'coming', N'wait') THEN SYSUTCDATETIME() ELSE HostReplyUtc END
    WHERE VisitorId = @VisitorId AND TenantId = @TenantId;
    EXEC dbo.sahyog_Visitor_Get @TenantId = @TenantId, @VisitorId = @VisitorId;
END
GO

/* one day's visitors (expected or arrived that day, or still in the building) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_Day
    @TenantId UNIQUEIDENTIFIER, @FromUtc DATETIME2(3), @ToUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.VisitorId, v.Name, v.Phone, v.Company, v.Purpose, v.HostId, h.DisplayName AS HostName, h.AvatarTone AS HostTone,
           v.ExpectedUtc, v.ArrivedUtc, v.LeftUtc, v.HostReply, v.HostReplyUtc, v.CreatedBy, c.DisplayName AS CreatedByName, v.CreatedUtc
    FROM dbo.sahyog_Visitors v
    LEFT JOIN dbo.sahyog_Users h ON h.UserId = v.HostId
    LEFT JOIN dbo.sahyog_Users c ON c.UserId = v.CreatedBy
    WHERE v.TenantId = @TenantId
      AND (   (v.ArrivedUtc >= @FromUtc AND v.ArrivedUtc < @ToUtc)
           OR (v.ArrivedUtc IS NULL AND v.ExpectedUtc >= @FromUtc AND v.ExpectedUtc < @ToUtc)
           OR (v.ArrivedUtc < @FromUtc AND v.LeftUtc IS NULL AND @ToUtc > SYSUTCDATETIME()))
    ORDER BY ISNULL(v.ArrivedUtc, v.ExpectedUtc);
END
GO

/* the tablet asks how the host answered */
CREATE OR ALTER PROCEDURE dbo.sahyog_Visitor_KioskStatus
    @TenantId UNIQUEIDENTIFIER, @VisitorId INT, @Token NVARCHAR(32)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.HostReply, v.HostReplyUtc, h.DisplayName AS HostName
    FROM dbo.sahyog_Visitors v LEFT JOIN dbo.sahyog_Users h ON h.UserId = v.HostId
    WHERE v.VisitorId = @VisitorId AND v.TenantId = @TenantId AND v.KioskToken = @Token
      AND v.ArrivedUtc > DATEADD(HOUR, -2, SYSUTCDATETIME());
END
GO

PRINT N'51_Visitors.sql: visitor lobby ready.';
GO

PRINT N'51_Visitors.sql applied.';
GO

/* ############################## 52_Approvals.sql ############################## */
PRINT N'Applying 52_Approvals.sql ...';
GO
/* =====================================================================
   ShankhNaad round 52 (safe to run more than once; needs 01–02 and 40_OrgStructure.sql):
     Approvals in chat. Leave, expense, purchase and other requests go up the reporting line
     (the manager; big amounts also to the manager's manager). Approvers press Approve or Reject on the
     card in their chat; approved leave turns on out of office for those days.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Approvals', N'U') IS NULL
CREATE TABLE dbo.sahyog_Approvals
(
    ApprovalId   INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Approvals PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Approvals_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Kind         VARCHAR(10)      NOT NULL,          -- leave | expense | purchase | other
    Title        NVARCHAR(150)    NOT NULL,
    Details      NVARCHAR(1000)   NULL,
    Amount       DECIMAL(14,2)    NULL,
    FromDate     DATE             NULL,
    ToDate       DATE             NULL,
    RequesterId  UNIQUEIDENTIFIER NOT NULL,
    Status       VARCHAR(10)      NOT NULL CONSTRAINT DF_sahyog_Approvals_Status DEFAULT ('pending'),   -- pending | approved | rejected | cancelled
    Step         INT              NOT NULL CONSTRAINT DF_sahyog_Approvals_Step DEFAULT (1),
    CreatedUtc   DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Approvals_Created DEFAULT (SYSUTCDATETIME()),
    DecidedUtc   DATETIME2(3)     NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Approvals_Requester')
    CREATE INDEX IX_sahyog_Approvals_Requester ON dbo.sahyog_Approvals(TenantId, RequesterId, CreatedUtc DESC);
GO
IF OBJECT_ID(N'dbo.sahyog_ApprovalSteps', N'U') IS NULL
CREATE TABLE dbo.sahyog_ApprovalSteps
(
    ApprovalId  INT              NOT NULL CONSTRAINT FK_sahyog_ApprovalSteps_Approvals REFERENCES dbo.sahyog_Approvals(ApprovalId) ON DELETE CASCADE,
    Step        INT              NOT NULL,
    ApproverId  UNIQUEIDENTIFIER NOT NULL,
    Decision    VARCHAR(10)      NULL,               -- approved | rejected
    Note        NVARCHAR(300)    NULL,
    DecidedUtc  DATETIME2(3)     NULL,
    ChannelId   UNIQUEIDENTIFIER NULL,               -- the chat the card was posted in
    MessageId   BIGINT           NULL,
    CONSTRAINT PK_sahyog_ApprovalSteps PRIMARY KEY (ApprovalId, Step)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_ApprovalSteps_Approver')
    CREATE INDEX IX_sahyog_ApprovalSteps_Approver ON dbo.sahyog_ApprovalSteps(ApproverId);
GO
IF OBJECT_ID(N'dbo.sahyog_ApprovalRules', N'U') IS NULL
CREATE TABLE dbo.sahyog_ApprovalRules
(
    TenantId          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_ApprovalRules PRIMARY KEY
                      CONSTRAINT FK_sahyog_ApprovalRules_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    SecondLevelAmount DECIMAL(14,2)    NULL,         -- expenses / purchases from this amount also go to the manager's manager
    FallbackApprover  UNIQUEIDENTIFIER NULL,         -- for people with no manager
    Currency          NVARCHAR(8)      NOT NULL CONSTRAINT DF_sahyog_ApprovalRules_Cur DEFAULT (NCHAR(8377))
);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_ApprovalRules_Get
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT ISNULL(r.SecondLevelAmount, 50000) AS SecondLevelAmount, r.FallbackApprover, u.DisplayName AS FallbackName, ISNULL(r.Currency, NCHAR(8377)) AS Currency
    FROM (SELECT @TenantId AS TenantId) t
    LEFT JOIN dbo.sahyog_ApprovalRules r ON r.TenantId = t.TenantId
    LEFT JOIN dbo.sahyog_Users u ON u.UserId = r.FallbackApprover;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_ApprovalRules_Save
    @TenantId UNIQUEIDENTIFIER, @SecondLevelAmount DECIMAL(14,2) = NULL, @FallbackApprover UNIQUEIDENTIFIER = NULL, @Currency NVARCHAR(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @Currency = ISNULL(NULLIF(@Currency, N''), NCHAR(8377));
    IF @FallbackApprover IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @FallbackApprover AND TenantId = @TenantId)
        SET @FallbackApprover = NULL;
    IF EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalRules WHERE TenantId = @TenantId)
        UPDATE dbo.sahyog_ApprovalRules SET SecondLevelAmount = @SecondLevelAmount, FallbackApprover = @FallbackApprover, Currency = @Currency WHERE TenantId = @TenantId;
    ELSE
        INSERT dbo.sahyog_ApprovalRules (TenantId, SecondLevelAmount, FallbackApprover, Currency) VALUES (@TenantId, @SecondLevelAmount, @FallbackApprover, @Currency);
    EXEC dbo.sahyog_ApprovalRules_Get @TenantId = @TenantId;
END
GO

/* @Approvers = a JSON array of ids in order (step 1, step 2): ["id","id"] */
CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_Create
    @TenantId UNIQUEIDENTIFIER, @RequesterId UNIQUEIDENTIFIER, @Kind VARCHAR(10), @Title NVARCHAR(150), @Details NVARCHAR(1000) = NULL,
    @Amount DECIMAL(14,2) = NULL, @FromDate DATE = NULL, @ToDate DATE = NULL, @Approvers NVARCHAR(400)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;
    INSERT dbo.sahyog_Approvals (TenantId, Kind, Title, Details, Amount, FromDate, ToDate, RequesterId)
    VALUES (@TenantId, @Kind, @Title, @Details, @Amount, @FromDate, @ToDate, @RequesterId);
    DECLARE @id INT = CAST(SCOPE_IDENTITY() AS INT);
    INSERT dbo.sahyog_ApprovalSteps (ApprovalId, Step, ApproverId)
    SELECT @id, CAST(x.[key] AS INT) + 1, u.UserId
    FROM OPENJSON(@Approvers) x
    JOIN dbo.sahyog_Users u ON u.UserId = TRY_CAST(x.[value] AS UNIQUEIDENTIFIER) AND u.TenantId = @TenantId;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalSteps WHERE ApprovalId = @id)
    BEGIN ROLLBACK; SELECT CAST(0 AS INT) AS ApprovalId; RETURN; END;
    -- steps numbered 1, 2 … even if a name was skipped
    ;WITH s AS (SELECT Step, ROW_NUMBER() OVER (ORDER BY Step) AS n FROM dbo.sahyog_ApprovalSteps WHERE ApprovalId = @id)
    UPDATE s SET Step = n WHERE Step <> n;
    COMMIT;
    SELECT @id AS ApprovalId;
END
GO

/* the request, then its steps. Empty when this person may not see it (requester, an approver, or an admin: @IsAdmin) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_Get
    @TenantId UNIQUEIDENTIFIER, @ApprovalId INT, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT a.ApprovalId, a.Kind, a.Title, a.Details, a.Amount, a.FromDate, a.ToDate, a.RequesterId, r.DisplayName AS RequesterName,
           r.AvatarTone AS RequesterTone, a.Status, a.Step, a.CreatedUtc, a.DecidedUtc,
           (SELECT ApproverId FROM dbo.sahyog_ApprovalSteps s WHERE s.ApprovalId = a.ApprovalId AND s.Step = a.Step) AS CurrentApproverId
    FROM dbo.sahyog_Approvals a
    JOIN dbo.sahyog_Users r ON r.UserId = a.RequesterId
    WHERE a.ApprovalId = @ApprovalId AND a.TenantId = @TenantId
      AND (@IsAdmin = 1 OR a.RequesterId = @UserId OR EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalSteps s WHERE s.ApprovalId = a.ApprovalId AND s.ApproverId = @UserId));

    SELECT s.Step, s.ApproverId, u.DisplayName AS ApproverName, u.AvatarTone AS ApproverTone, u.JobTitle AS ApproverTitle,
           s.Decision, s.Note, s.DecidedUtc, s.ChannelId, s.MessageId
    FROM dbo.sahyog_ApprovalSteps s
    JOIN dbo.sahyog_Approvals a ON a.ApprovalId = s.ApprovalId AND a.TenantId = @TenantId
    JOIN dbo.sahyog_Users u ON u.UserId = s.ApproverId
    WHERE s.ApprovalId = @ApprovalId
      AND (@IsAdmin = 1 OR a.RequesterId = @UserId OR EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalSteps x WHERE x.ApprovalId = a.ApprovalId AND x.ApproverId = @UserId))
    ORDER BY s.Step;
END
GO

/* @Box: mine (I asked) | todo (waiting for me now) | done (I decided) | all (admins) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_List
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Box VARCHAR(10), @IsAdmin BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (300) a.ApprovalId, a.Kind, a.Title, a.Details, a.Amount, a.FromDate, a.ToDate, a.RequesterId, r.DisplayName AS RequesterName,
           r.AvatarTone AS RequesterTone, a.Status, a.Step, a.CreatedUtc, a.DecidedUtc,
           cur.ApproverId AS CurrentApproverId, cu.DisplayName AS CurrentApproverName,
           (SELECT COUNT(*) FROM dbo.sahyog_ApprovalSteps s WHERE s.ApprovalId = a.ApprovalId) AS Steps
    FROM dbo.sahyog_Approvals a
    JOIN dbo.sahyog_Users r ON r.UserId = a.RequesterId
    LEFT JOIN dbo.sahyog_ApprovalSteps cur ON cur.ApprovalId = a.ApprovalId AND cur.Step = a.Step
    LEFT JOIN dbo.sahyog_Users cu ON cu.UserId = cur.ApproverId
    WHERE a.TenantId = @TenantId
      AND (   (@Box = 'mine' AND a.RequesterId = @UserId)
           OR (@Box = 'todo' AND a.Status = 'pending' AND cur.ApproverId = @UserId)
           OR (@Box = 'done' AND EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalSteps s WHERE s.ApprovalId = a.ApprovalId AND s.ApproverId = @UserId AND s.Decision IS NOT NULL))
           OR (@Box = 'all' AND @IsAdmin = 1))
    ORDER BY CASE WHEN a.Status = 'pending' THEN 0 ELSE 1 END, a.CreatedUtc DESC;
END
GO

/* the approver of the current step decides. Returns the new status and, when approved with more steps, the next approver. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_Decide
    @TenantId UNIQUEIDENTIFIER, @ApprovalId INT, @UserId UNIQUEIDENTIFIER, @Decision VARCHAR(10), @Note NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;
    DECLARE @step INT, @status VARCHAR(10);
    SELECT @step = a.Step, @status = a.Status FROM dbo.sahyog_Approvals a WITH (UPDLOCK)
    WHERE a.ApprovalId = @ApprovalId AND a.TenantId = @TenantId;
    IF @status IS NULL OR @status <> 'pending'
       OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalSteps WHERE ApprovalId = @ApprovalId AND Step = @step AND ApproverId = @UserId)
    BEGIN ROLLBACK; SELECT CAST(0 AS BIT) AS Ok, @status AS Status, CAST(NULL AS UNIQUEIDENTIFIER) AS NextApproverId; RETURN; END;

    UPDATE dbo.sahyog_ApprovalSteps SET Decision = @Decision, Note = @Note, DecidedUtc = SYSUTCDATETIME()
    WHERE ApprovalId = @ApprovalId AND Step = @step;

    DECLARE @next UNIQUEIDENTIFIER = (SELECT ApproverId FROM dbo.sahyog_ApprovalSteps WHERE ApprovalId = @ApprovalId AND Step = @step + 1);
    IF @Decision = 'rejected'
        UPDATE dbo.sahyog_Approvals SET Status = 'rejected', DecidedUtc = SYSUTCDATETIME() WHERE ApprovalId = @ApprovalId;
    ELSE IF @next IS NOT NULL
        UPDATE dbo.sahyog_Approvals SET Step = @step + 1 WHERE ApprovalId = @ApprovalId;
    ELSE
        UPDATE dbo.sahyog_Approvals SET Status = 'approved', DecidedUtc = SYSUTCDATETIME() WHERE ApprovalId = @ApprovalId;
    COMMIT;
    SELECT CAST(1 AS BIT) AS Ok, Status, CASE WHEN @Decision = 'approved' THEN @next END AS NextApproverId
    FROM dbo.sahyog_Approvals WHERE ApprovalId = @ApprovalId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_Cancel
    @TenantId UNIQUEIDENTIFIER, @ApprovalId INT, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Approvals SET Status = 'cancelled', DecidedUtc = SYSUTCDATETIME()
    WHERE ApprovalId = @ApprovalId AND TenantId = @TenantId AND RequesterId = @UserId AND Status = 'pending';
    SELECT @@ROWCOUNT AS Changed;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_SetMessage
    @ApprovalId INT, @Step INT, @ChannelId UNIQUEIDENTIFIER, @MessageId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_ApprovalSteps SET ChannelId = @ChannelId, MessageId = @MessageId WHERE ApprovalId = @ApprovalId AND Step = @Step;
END
GO

PRINT N'52_Approvals.sql: approvals ready.';
GO

PRINT N'52_Approvals.sql applied.';
GO

/* ############################## 54_RemoveLanguages.sql ############################## */
PRINT N'Applying 54_RemoveLanguages.sql ...';
GO
/* =====================================================================
   ShankhNaad round 54 (safe to run more than once): the Languages feature is removed.
     Drops what 53_Languages.sql created: the saved translations and voice-note transcripts and the four
     procedures that used them. Nothing else in ShankhNaad uses these. If 53 was never run, this does nothing.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

DROP PROCEDURE IF EXISTS dbo.sahyog_Lang_Message;
DROP PROCEDURE IF EXISTS dbo.sahyog_Lang_SaveTranslation;
DROP PROCEDURE IF EXISTS dbo.sahyog_Lang_GetTranscript;
DROP PROCEDURE IF EXISTS dbo.sahyog_Lang_SaveTranscript;
GO

DROP TABLE IF EXISTS dbo.sahyog_Translations;
DROP TABLE IF EXISTS dbo.sahyog_Transcripts;
GO

PRINT N'54_RemoveLanguages.sql: the Languages feature is removed from the database.';
GO

PRINT N'54_RemoveLanguages.sql applied.';
GO

/* ############################## 55_DecisionOwners.sql ############################## */
PRINT N'Applying 55_DecisionOwners.sql ...';
GO
/* =====================================================================
   ShankhNaad round 55 (safe to run more than once; needs 46_Nirnay.sql and 40_OrgStructure.sql):
     Who can be made the owner of a decision or action item.
     1. You can make yourself, or anyone below you (your reporting line on the Org page, or a department you head),
        the owner straight away. Admins can make anyone the owner.
     2. Anyone else (your manager, the CEO, a colleague in another team) is ASKED: the item stays with you and
        shows "waiting for <name>" until they press Accept (they become the owner) or Decline (it stays with you).
     3. An owner can always press "Not mine": the item goes back to the person who recorded it.
   The app (Controllers/DecisionsController.cs) decides who is "below you"; the database keeps the state.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_Decisions', N'AskedOwnerId') IS NULL
    ALTER TABLE dbo.sahyog_Decisions ADD AskedOwnerId UNIQUEIDENTIFIER NULL;   -- asked to own it, not answered yet
GO
IF COL_LENGTH(N'dbo.sahyog_Decisions', N'AskedUtc') IS NULL
    ALTER TABLE dbo.sahyog_Decisions ADD AskedUtc DATETIME2(3) NULL;
GO
IF COL_LENGTH(N'dbo.sahyog_Decisions', N'DeclinedBy') IS NULL
    ALTER TABLE dbo.sahyog_Decisions ADD DeclinedBy UNIQUEIDENTIFIER NULL;     -- said no to owning it, or handed it back
GO
IF COL_LENGTH(N'dbo.sahyog_Decisions', N'DeclinedUtc') IS NULL
    ALTER TABLE dbo.sahyog_Decisions ADD DeclinedUtc DATETIME2(3) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Decisions_Asked')
    CREATE INDEX IX_sahyog_Decisions_Asked ON dbo.sahyog_Decisions(TenantId, AskedOwnerId) WHERE AskedOwnerId IS NOT NULL AND IsDeleted = 0;
GO

/* ---------- one row as the app shows it (46 + who was asked, who declined) ---------- */
CREATE OR ALTER VIEW dbo.sahyog_DecisionRows
AS
SELECT d.DecisionId, d.TenantId, d.Kind, d.Title, d.Details, d.OwnerId, d.DueDate, d.DoneUtc, d.ChannelId, d.MessageId,
       d.MeetingId, d.MeetingDate, d.RecordedBy, d.RecordedUtc,
       o.DisplayName AS OwnerName, o.AvatarTone AS OwnerTone, o.DepartmentId,
       dep.Name AS DepartmentName,
       r.DisplayName AS RecordedByName,
       c.Name AS ChannelName, CAST(ISNULL(c.IsDirect, 0) AS BIT) AS ChannelIsDirect,
       mt.Title AS MeetingTitle, mt.HostId AS MeetingHostId,
       d.AskedOwnerId, a.DisplayName AS AskedOwnerName, a.AvatarTone AS AskedOwnerTone, d.AskedUtc,
       d.DeclinedBy, x.DisplayName AS DeclinedByName, d.DeclinedUtc
FROM dbo.sahyog_Decisions d
LEFT JOIN dbo.sahyog_Users o        ON o.UserId = d.OwnerId
LEFT JOIN dbo.sahyog_Departments dep ON dep.DepartmentId = o.DepartmentId
LEFT JOIN dbo.sahyog_Users r        ON r.UserId = d.RecordedBy
LEFT JOIN dbo.sahyog_Channels c     ON c.ChannelId = d.ChannelId
LEFT JOIN dbo.sahyog_Meetings mt    ON mt.MeetingId = d.MeetingId
LEFT JOIN dbo.sahyog_Users a        ON a.UserId = d.AskedOwnerId
LEFT JOIN dbo.sahyog_Users x        ON x.UserId = d.DeclinedBy
WHERE d.IsDeleted = 0;
GO

/* ---------- add or change one ----------
   @OwnerId: the owner now. @AskedOwnerId: someone asked to take it over (NULL = nobody, or the ask is withdrawn).
   The app has already checked who may be made the owner straight away. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_Save
    @DecisionId   INT = NULL,
    @TenantId     UNIQUEIDENTIFIER,
    @UserId       UNIQUEIDENTIFIER,
    @Kind         CHAR(1),
    @Title        NVARCHAR(300),
    @Details      NVARCHAR(1000) = NULL,
    @OwnerId      UNIQUEIDENTIFIER = NULL,
    @DueDate      DATE = NULL,
    @ChannelId    UNIQUEIDENTIFIER = NULL,
    @MessageId    BIGINT = NULL,
    @MeetingId    UNIQUEIDENTIFIER = NULL,
    @MeetingDate  DATE = NULL,
    @AskedOwnerId UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @Kind NOT IN ('D', 'A') SET @Kind = 'D';
    IF @Kind = 'D' SET @DueDate = NULL;
    -- the owner and the person asked must be active people in this workspace
    IF @OwnerId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @OwnerId AND TenantId = @TenantId)
        SET @OwnerId = NULL;
    IF @AskedOwnerId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @AskedOwnerId AND TenantId = @TenantId AND IsActive = 1)
        SET @AskedOwnerId = NULL;
    IF @AskedOwnerId = @OwnerId SET @AskedOwnerId = NULL;

    IF @DecisionId IS NULL OR @DecisionId = 0
    BEGIN
        IF @MessageId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.sahyog_Messages WHERE MessageId = @MessageId AND ChannelId = @ChannelId AND TenantId = @TenantId)
        BEGIN SELECT CAST(0 AS INT) AS DecisionId; RETURN; END;
        IF @MessageId IS NULL AND @MeetingId IS NULL SET @ChannelId = NULL;

        INSERT dbo.sahyog_Decisions (TenantId, Kind, Title, Details, OwnerId, DueDate, ChannelId, MessageId, MeetingId, MeetingDate, RecordedBy,
                                     AskedOwnerId, AskedUtc)
        VALUES (@TenantId, @Kind, @Title, @Details, @OwnerId, @DueDate, @ChannelId, @MessageId, @MeetingId, @MeetingDate, @UserId,
                @AskedOwnerId, CASE WHEN @AskedOwnerId IS NOT NULL THEN SYSUTCDATETIME() END);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS DecisionId;
        RETURN;
    END;

    -- changing: only what it says and who owns it; where it came from stays.
    -- (In an UPDATE, the columns on the right are the values before the change.)
    UPDATE dbo.sahyog_Decisions
    SET Kind = @Kind, Title = @Title, Details = @Details, OwnerId = @OwnerId, DueDate = @DueDate,
        DoneUtc = CASE WHEN @Kind = 'D' THEN NULL ELSE DoneUtc END,
        AskedUtc = CASE WHEN @AskedOwnerId IS NULL THEN NULL
                        WHEN AskedOwnerId = @AskedOwnerId THEN AskedUtc          -- the same ask: keep when it was asked
                        ELSE SYSUTCDATETIME() END,
        AskedOwnerId = @AskedOwnerId,
        -- "declined" is about the last owner or ask: forget it when someone new is asked or the owner changes
        DeclinedBy  = CASE WHEN @AskedOwnerId IS NOT NULL AND ISNULL(AskedOwnerId, '00000000-0000-0000-0000-000000000000') <> @AskedOwnerId THEN NULL
                           WHEN ISNULL(OwnerId, '00000000-0000-0000-0000-000000000000') <> ISNULL(@OwnerId, '00000000-0000-0000-0000-000000000000') THEN NULL
                           ELSE DeclinedBy END,
        DeclinedUtc = CASE WHEN @AskedOwnerId IS NOT NULL AND ISNULL(AskedOwnerId, '00000000-0000-0000-0000-000000000000') <> @AskedOwnerId THEN NULL
                           WHEN ISNULL(OwnerId, '00000000-0000-0000-0000-000000000000') <> ISNULL(@OwnerId, '00000000-0000-0000-0000-000000000000') THEN NULL
                           ELSE DeclinedUtc END
    WHERE DecisionId = @DecisionId AND TenantId = @TenantId AND IsDeleted = 0;
    SELECT CASE WHEN @@ROWCOUNT = 1 THEN @DecisionId ELSE 0 END AS DecisionId;
END
GO

/* ---------- reading: whoever was asked can see it too ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_Get
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @DecisionId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.* FROM dbo.sahyog_DecisionRows v
    WHERE v.DecisionId = @DecisionId AND v.TenantId = @TenantId
      AND (v.AskedOwnerId = @UserId
           OR dbo.sahyog_Decision_CanSee(@TenantId, @UserId, v.OwnerId, v.RecordedBy, v.ChannelId, v.MeetingId) = 1);
END
GO

/* @Mine = 1: owned, recorded or asked of me */
CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_List
    @TenantId     UNIQUEIDENTIFIER,
    @UserId       UNIQUEIDENTIFIER,
    @Kind         CHAR(1) = NULL,
    @Open         BIT = 0,
    @Mine         BIT = 0,
    @Source       VARCHAR(10) = NULL,
    @DepartmentId UNIQUEIDENTIFIER = NULL,
    @FromUtc      DATETIME2(3) = NULL,
    @Search       NVARCHAR(100) = NULL,
    @Top          INT = 300
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @q NVARCHAR(110) = CASE WHEN NULLIF(LTRIM(RTRIM(@Search)), N'') IS NULL THEN NULL
                                    ELSE N'%' + REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(@Search)), N'[', N'[[]'), N'%', N'[%]'), N'_', N'[_]') + N'%' END;
    SELECT TOP (@Top) v.*
    FROM dbo.sahyog_DecisionRows v
    WHERE v.TenantId = @TenantId
      AND (@Kind IS NULL OR v.Kind = @Kind)
      AND (@Open = 0 OR (v.Kind = 'A' AND v.DoneUtc IS NULL))
      AND (@Mine = 0 OR v.OwnerId = @UserId OR v.RecordedBy = @UserId OR v.AskedOwnerId = @UserId)
      AND (@Source IS NULL
           OR (@Source = 'chat' AND v.MessageId IS NOT NULL)
           OR (@Source = 'meeting' AND v.MeetingId IS NOT NULL)
           OR (@Source = 'other' AND v.MessageId IS NULL AND v.MeetingId IS NULL))
      AND (@DepartmentId IS NULL OR v.DepartmentId = @DepartmentId)
      AND (@FromUtc IS NULL OR v.RecordedUtc >= @FromUtc)
      AND (@q IS NULL OR v.Title LIKE @q OR v.Details LIKE @q OR v.OwnerName LIKE @q OR v.ChannelName LIKE @q OR v.MeetingTitle LIKE @q
           OR v.AskedOwnerName LIKE @q)
      AND (v.AskedOwnerId = @UserId
           OR dbo.sahyog_Decision_CanSee(@TenantId, @UserId, v.OwnerId, v.RecordedBy, v.ChannelId, v.MeetingId) = 1)
    ORDER BY v.RecordedUtc DESC;
END
GO

/* ---------- the person asked answers: Accept (they become the owner) or Decline (it stays where it was) ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_Answer
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @DecisionId INT, @Accept BIT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Decisions
    SET OwnerId     = CASE WHEN @Accept = 1 THEN @UserId ELSE OwnerId END,
        AskedOwnerId = NULL,
        AskedUtc     = NULL,
        DeclinedBy   = CASE WHEN @Accept = 1 THEN NULL ELSE @UserId END,
        DeclinedUtc  = CASE WHEN @Accept = 1 THEN NULL ELSE SYSUTCDATETIME() END
    WHERE DecisionId = @DecisionId AND TenantId = @TenantId AND IsDeleted = 0 AND AskedOwnerId = @UserId;
    SELECT @@ROWCOUNT AS Changed;
END
GO

/* ---------- "Not mine": the owner hands it back to whoever recorded it ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Decision_Release
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @DecisionId INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Decisions
    SET OwnerId = RecordedBy, DeclinedBy = @UserId, DeclinedUtc = SYSUTCDATETIME()
    WHERE DecisionId = @DecisionId AND TenantId = @TenantId AND IsDeleted = 0
      AND OwnerId = @UserId AND RecordedBy <> @UserId;
    SELECT @@ROWCOUNT AS Changed;
END
GO

PRINT N'55_DecisionOwners.sql: assign to your team, ask everyone else, Accept / Decline / Not mine ready.';
GO

PRINT N'55_DecisionOwners.sql applied.';
GO

PRINT N'ShankhNaad database is up to date.';
GO
