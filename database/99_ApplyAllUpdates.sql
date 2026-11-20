/* =====================================================================
   ShankhNaad · 99_ApplyAllUpdates.sql
   ONE file with every database update (03 → 31), in the right order.
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

PRINT N'ShankhNaad database is up to date.';
GO
