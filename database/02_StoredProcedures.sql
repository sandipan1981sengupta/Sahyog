/* =====================================================================
   Sahyog by CloudWheel Ltd · 02_StoredProcedures.sql
   Every procedure that touches client data takes @TenantId and filters by it,
   so one client can never read another client's rows.
   CREATE OR ALTER: safe to run again after changes.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* =========================== PLANS & TENANTS =========================== */

CREATE OR ALTER PROCEDURE dbo.sahyog_Plan_List
AS
BEGIN
    SET NOCOUNT ON;
    SELECT PlanId, Name, MaxUsers, MaxMeetingParticipants, StorageQuotaMb, MaxVideoHeight,
           RecordingEnabled, MaxMeetingMinutes, VideoProvider
    FROM dbo.sahyog_Plans
    ORDER BY MaxUsers;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Plan_Update
    @PlanId INT, @MaxUsers INT, @MaxMeetingParticipants INT, @StorageQuotaMb BIGINT,
    @MaxVideoHeight INT, @RecordingEnabled BIT, @MaxMeetingMinutes INT, @VideoProvider NVARCHAR(30)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Plans
    SET MaxUsers = @MaxUsers, MaxMeetingParticipants = @MaxMeetingParticipants, StorageQuotaMb = @StorageQuotaMb,
        MaxVideoHeight = @MaxVideoHeight, RecordingEnabled = @RecordingEnabled,
        MaxMeetingMinutes = @MaxMeetingMinutes, VideoProvider = @VideoProvider
    WHERE PlanId = @PlanId;
    SELECT @@ROWCOUNT AS Affected;
END
GO

/* All limits for one client in one row: plan values with per-client overrides applied. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_GetLimits
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT t.TenantId, t.Name AS TenantName, p.Name AS PlanName,
           COALESCE(t.MaxUsersOverride, p.MaxUsers) AS MaxUsers,
           p.MaxMeetingParticipants,
           COALESCE(t.StorageQuotaMbOverride, p.StorageQuotaMb) * CAST(1048576 AS BIGINT) AS StorageQuotaBytes,
           t.StorageUsedBytes, p.MaxVideoHeight, p.MaxMeetingMinutes, p.RecordingEnabled, p.VideoProvider,
           t.TimeZoneId, t.IsActive,
           (SELECT COUNT(*) FROM dbo.sahyog_Users u WHERE u.TenantId = t.TenantId AND u.IsActive = 1) AS ActiveUsers
    FROM dbo.sahyog_Tenants t
    JOIN dbo.sahyog_Plans p ON p.PlanId = t.PlanId
    WHERE t.TenantId = @TenantId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_List
AS
BEGIN
    SET NOCOUNT ON;
    SELECT t.TenantId, t.Name, t.Slug, p.Name AS PlanName, t.PlanId, t.IsActive, t.CreatedUtc,
           t.StorageUsedBytes,
           COALESCE(t.StorageQuotaMbOverride, p.StorageQuotaMb) * CAST(1048576 AS BIGINT) AS StorageQuotaBytes,
           COALESCE(t.MaxUsersOverride, p.MaxUsers) AS MaxUsers,
           p.VideoProvider,
           (SELECT COUNT(*) FROM dbo.sahyog_Users u WHERE u.TenantId = t.TenantId AND u.IsActive = 1) AS ActiveUsers
    FROM dbo.sahyog_Tenants t
    JOIN dbo.sahyog_Plans p ON p.PlanId = t.PlanId
    ORDER BY t.Name;
END
GO

/* Creates a client workspace, its #general channel and its first admin, all-or-nothing.
   @Result: 0 ok, 1 workspace name taken, 2 email already used, 3 unknown plan. */
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
        VALUES (@GeneralId, @TenantId, N'general', N'Company-wide announcements and chat', @AdminUserId);

        INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId)
        VALUES (@GeneralId, @AdminUserId, @TenantId);
    COMMIT;

    SET @Result = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_GetBySlug
    @Slug NVARCHAR(40)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TenantId, Name, Slug, IsActive FROM dbo.sahyog_Tenants WHERE Slug = @Slug;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_SetPlan
    @TenantId UNIQUEIDENTIFIER, @PlanId INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Tenants SET PlanId = @PlanId
    WHERE TenantId = @TenantId AND EXISTS (SELECT 1 FROM dbo.sahyog_Plans WHERE PlanId = @PlanId);
    SELECT @@ROWCOUNT AS Affected;
END
GO

/* Pausing a client also signs all its users out (new security stamp). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_ToggleActive
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Tenants SET IsActive = 1 - IsActive WHERE TenantId = @TenantId;
    UPDATE dbo.sahyog_Users SET SecurityStamp = NEWID() WHERE TenantId = @TenantId;
    SELECT Name, IsActive FROM dbo.sahyog_Tenants WHERE TenantId = @TenantId;
END
GO

/* ================================ USERS ================================ */

CREATE OR ALTER PROCEDURE dbo.sahyog_Auth_GetUserByEmail
    @Email NVARCHAR(256)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.UserId, u.TenantId, u.Email, u.DisplayName, u.PasswordHash, u.Role, u.AvatarTone, u.IsActive,
           u.SecurityStamp, u.FailedLoginCount, u.LockoutEndUtc,
           t.Slug AS TenantSlug, t.Name AS TenantName, CAST(ISNULL(t.IsActive, 1) AS BIT) AS TenantActive
    FROM dbo.sahyog_Users u
    LEFT JOIN dbo.sahyog_Tenants t ON t.TenantId = u.TenantId
    WHERE u.Email = @Email;
END
GO

/* 5 wrong passwords (configurable) = locked for @LockMinutes. Returns the lockout end, if any. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Auth_LoginFailed
    @UserId UNIQUEIDENTIFIER, @MaxAttempts INT, @LockMinutes INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Users
    SET LockoutEndUtc    = CASE WHEN FailedLoginCount + 1 >= @MaxAttempts THEN DATEADD(MINUTE, @LockMinutes, SYSUTCDATETIME()) ELSE LockoutEndUtc END,
        FailedLoginCount = CASE WHEN FailedLoginCount + 1 >= @MaxAttempts THEN 0 ELSE FailedLoginCount + 1 END
    WHERE UserId = @UserId;
    SELECT LockoutEndUtc FROM dbo.sahyog_Users WHERE UserId = @UserId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Auth_LoginSucceeded
    @UserId UNIQUEIDENTIFIER, @NewPasswordHash NVARCHAR(400) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Users
    SET FailedLoginCount = 0, LockoutEndUtc = NULL, LastLoginUtc = SYSUTCDATETIME(),
        PasswordHash = COALESCE(@NewPasswordHash, PasswordHash)
    WHERE UserId = @UserId;
END
GO

/* Checked every few minutes by the login cookie: removed users / paused clients get signed out. */
CREATE OR ALTER PROCEDURE dbo.sahyog_User_GetAuthState
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.IsActive, u.SecurityStamp, CAST(ISNULL(t.IsActive, 1) AS BIT) AS TenantActive
    FROM dbo.sahyog_Users u
    LEFT JOIN dbo.sahyog_Tenants t ON t.TenantId = u.TenantId
    WHERE u.UserId = @UserId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_User_GetById
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UserId, TenantId, Email, DisplayName, Role, AvatarTone, IsActive
    FROM dbo.sahyog_Users WHERE UserId = @UserId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_User_ListByTenant
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UserId, TenantId, Email, DisplayName, Role, AvatarTone, IsActive
    FROM dbo.sahyog_Users
    WHERE TenantId = @TenantId
    ORDER BY DisplayName;
END
GO

/* Adds a person. Enforces the plan's user limit inside one transaction (no race when two admins add at once)
   and adds them to every public channel of the workspace.
   @Result: 0 ok, 1 email already used, 2 user limit reached. */
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
        WHERE c.TenantId = @TenantId AND c.IsDirect = 0;

    COMMIT;
    SET @Result = 0;
END
GO

/* Remove (IsActive = 0) or restore a person. Removing signs them out everywhere.
   @Result: 0 ok, 2 user limit reached (restore), 3 not found. */
CREATE OR ALTER PROCEDURE dbo.sahyog_User_SetActive
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @IsActive BIT, @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;
    IF @IsActive = 1
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

    UPDATE dbo.sahyog_Users SET IsActive = @IsActive, SecurityStamp = NEWID()
    WHERE TenantId = @TenantId AND UserId = @UserId;

    SET @Result = CASE WHEN @@ROWCOUNT = 0 THEN 3 ELSE 0 END;
    COMMIT;
END
GO

/* ================================ CHAT ================================ */

/* One read for the whole sidebar: channels, DMs (with the other person), unread counts. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetSidebar
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.ChannelId, c.Name, c.Description, c.IsDirect, cm.UnreadCount, c.LastMessageUtc,
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

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetChannel
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT ChannelId, Name, Description, IsDirect FROM dbo.sahyog_Channels
    WHERE TenantId = @TenantId AND ChannelId = @ChannelId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_IsMember
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT CAST(CASE WHEN EXISTS (
        SELECT 1 FROM dbo.sahyog_ChannelMembers
        WHERE TenantId = @TenantId AND ChannelId = @ChannelId AND UserId = @UserId) THEN 1 ELSE 0 END AS BIT) AS IsMember;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetUserChannelIds
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT ChannelId FROM dbo.sahyog_ChannelMembers WHERE TenantId = @TenantId AND UserId = @UserId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetMembers
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.UserId, u.DisplayName, u.AvatarTone, u.Email
    FROM dbo.sahyog_ChannelMembers m
    JOIN dbo.sahyog_Users u ON u.UserId = m.UserId
    WHERE m.TenantId = @TenantId AND m.ChannelId = @ChannelId AND u.IsActive = 1
    ORDER BY u.DisplayName;
END
GO

/* Shared message shape (sender name/colour + file details) used by the procedures below. */
CREATE OR ALTER VIEW dbo.sahyog_vMessages
AS
SELECT m.MessageId, m.TenantId, m.ChannelId, m.SenderId, u.DisplayName AS SenderName, u.AvatarTone AS SenderTone,
       m.Body, m.SentUtc, a.AttachmentId, a.FileName, a.ContentType, a.SizeBytes
FROM dbo.sahyog_Messages m
JOIN dbo.sahyog_Users u ON u.UserId = m.SenderId
LEFT JOIN dbo.sahyog_Attachments a ON a.AttachmentId = m.AttachmentId;
GO

/* Newest first. @BeforeId NULL = latest page; otherwise "load older". */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetMessages
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @BeforeId BIGINT = NULL, @Take INT = 51
AS
BEGIN
    SET NOCOUNT ON;
    IF @BeforeId IS NULL
        SELECT TOP (@Take) * FROM dbo.sahyog_vMessages
        WHERE TenantId = @TenantId AND ChannelId = @ChannelId
        ORDER BY MessageId DESC;
    ELSE
        SELECT TOP (@Take) * FROM dbo.sahyog_vMessages
        WHERE TenantId = @TenantId AND ChannelId = @ChannelId AND MessageId < @BeforeId
        ORDER BY MessageId DESC;
END
GO

/* Saves a text message, bumps the channel and everyone else's unread count, returns the saved message.
   @Result: 0 ok, 1 not a member. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_SendMessage
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @SenderId UNIQUEIDENTIFIER, @Body NVARCHAR(4000),
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers WHERE TenantId = @TenantId AND ChannelId = @ChannelId AND UserId = @SenderId)
    BEGIN SET @Result = 1; RETURN; END

    DECLARE @Id BIGINT;
    BEGIN TRANSACTION;
        INSERT dbo.sahyog_Messages (TenantId, ChannelId, SenderId, Body) VALUES (@TenantId, @ChannelId, @SenderId, @Body);
        SET @Id = SCOPE_IDENTITY();
        UPDATE dbo.sahyog_Channels SET LastMessageUtc = SYSUTCDATETIME() WHERE ChannelId = @ChannelId AND TenantId = @TenantId;
        UPDATE dbo.sahyog_ChannelMembers SET UnreadCount = UnreadCount + 1
        WHERE TenantId = @TenantId AND ChannelId = @ChannelId AND UserId <> @SenderId;
    COMMIT;

    SET @Result = 0;
    SELECT * FROM dbo.sahyog_vMessages WHERE MessageId = @Id;
END
GO

/* Saves an uploaded file + its message. Checks and reserves storage atomically.
   @Result: 0 ok, 1 not a member, 2 storage full. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_SendFile
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @SenderId UNIQUEIDENTIFIER,
    @AttachmentId UNIQUEIDENTIFIER, @FileName NVARCHAR(255), @ContentType NVARCHAR(150),
    @SizeBytes BIGINT, @StoragePath NVARCHAR(400),
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers WHERE TenantId = @TenantId AND ChannelId = @ChannelId AND UserId = @SenderId)
    BEGIN SET @Result = 1; RETURN; END

    DECLARE @Id BIGINT;
    BEGIN TRANSACTION;
        UPDATE t SET StorageUsedBytes = t.StorageUsedBytes + @SizeBytes
        FROM dbo.sahyog_Tenants t JOIN dbo.sahyog_Plans p ON p.PlanId = t.PlanId
        WHERE t.TenantId = @TenantId
          AND t.StorageUsedBytes + @SizeBytes <= COALESCE(t.StorageQuotaMbOverride, p.StorageQuotaMb) * CAST(1048576 AS BIGINT);

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK; SET @Result = 2; RETURN;
        END

        INSERT dbo.sahyog_Attachments (AttachmentId, TenantId, ChannelId, UploaderId, FileName, ContentType, SizeBytes, StoragePath)
        VALUES (@AttachmentId, @TenantId, @ChannelId, @SenderId, @FileName, @ContentType, @SizeBytes, @StoragePath);

        INSERT dbo.sahyog_Messages (TenantId, ChannelId, SenderId, Body, AttachmentId)
        VALUES (@TenantId, @ChannelId, @SenderId, N'', @AttachmentId);
        SET @Id = SCOPE_IDENTITY();

        UPDATE dbo.sahyog_Channels SET LastMessageUtc = SYSUTCDATETIME() WHERE ChannelId = @ChannelId AND TenantId = @TenantId;
        UPDATE dbo.sahyog_ChannelMembers SET UnreadCount = UnreadCount + 1
        WHERE TenantId = @TenantId AND ChannelId = @ChannelId AND UserId <> @SenderId;
    COMMIT;

    SET @Result = 0;
    SELECT * FROM dbo.sahyog_vMessages WHERE MessageId = @Id;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_MarkRead
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_ChannelMembers SET UnreadCount = 0, LastReadUtc = SYSUTCDATETIME()
    WHERE TenantId = @TenantId AND ChannelId = @ChannelId AND UserId = @UserId AND UnreadCount > 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetRecentFiles
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @Take INT = 5
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@Take) AttachmentId, FileName, ContentType, SizeBytes
    FROM dbo.sahyog_Attachments
    WHERE TenantId = @TenantId AND ChannelId = @ChannelId
    ORDER BY UploadedUtc DESC;
END
GO

/* Only returns the file if the person asking is a member of its channel. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetAttachment
    @TenantId UNIQUEIDENTIFIER, @AttachmentId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT a.AttachmentId, a.ChannelId, a.FileName, a.ContentType, a.SizeBytes, a.StoragePath
    FROM dbo.sahyog_Attachments a
    WHERE a.TenantId = @TenantId AND a.AttachmentId = @AttachmentId
      AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers m
                  WHERE m.ChannelId = a.ChannelId AND m.UserId = @UserId AND m.TenantId = @TenantId);
END
GO

/* New public channel with every active person in the workspace.
   @Result: 0 ok, 1 name taken. Returns the member ids. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_CreateChannel
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @Name NVARCHAR(80), @Description NVARCHAR(300) = NULL,
    @CreatedBy UNIQUEIDENTIFIER, @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM dbo.sahyog_Channels WHERE TenantId = @TenantId AND IsDirect = 0 AND Name = @Name)
    BEGIN SET @Result = 1; RETURN; END

    BEGIN TRANSACTION;
        INSERT dbo.sahyog_Channels (ChannelId, TenantId, Name, Description, CreatedBy)
        VALUES (@ChannelId, @TenantId, @Name, @Description, @CreatedBy);

        INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId)
        SELECT @ChannelId, u.UserId, @TenantId FROM dbo.sahyog_Users u WHERE u.TenantId = @TenantId AND u.IsActive = 1;
    COMMIT;

    SET @Result = 0;
    SELECT UserId FROM dbo.sahyog_ChannelMembers WHERE ChannelId = @ChannelId;
END
GO

/* Returns the one-to-one conversation for two people, creating it the first time.
   @ChannelId comes back NULL if the other person isn't an active member of the same workspace. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetOrCreateDirect
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @OtherUserId UNIQUEIDENTIFIER, @DirectKey NVARCHAR(80),
    @ChannelId UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @ChannelId = NULL;

    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @OtherUserId AND TenantId = @TenantId AND IsActive = 1)
        RETURN;

    SELECT @ChannelId = ChannelId FROM dbo.sahyog_Channels WHERE TenantId = @TenantId AND DirectKey = @DirectKey;
    IF @ChannelId IS NOT NULL RETURN;

    DECLARE @NewId UNIQUEIDENTIFIER = NEWID();
    BEGIN TRY
        BEGIN TRANSACTION;
            INSERT dbo.sahyog_Channels (ChannelId, TenantId, Name, IsDirect, DirectKey, CreatedBy)
            VALUES (@NewId, @TenantId, N'', 1, @DirectKey, @UserId);
            INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId)
            VALUES (@NewId, @UserId, @TenantId), (@NewId, @OtherUserId, @TenantId);
        COMMIT;
        SET @ChannelId = @NewId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        -- Both people opened the chat at the same moment: use the one that won.
        SELECT @ChannelId = ChannelId FROM dbo.sahyog_Channels WHERE TenantId = @TenantId AND DirectKey = @DirectKey;
        IF @ChannelId IS NULL THROW;
    END CATCH
END
GO

/* =============================== MEETINGS =============================== */

/* Creates a meeting with its invitees. Only active people of the same workspace are added. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_Create
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @Title NVARCHAR(150), @Agenda NVARCHAR(2000) = NULL,
    @StartUtc DATETIME2(0), @DurationMinutes INT, @Recurrence TINYINT, @RoomName NVARCHAR(80), @GuestCode NVARCHAR(16),
    @HostId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER = NULL, @IsInstant BIT,
    @GuestLinkEnabled BIT, @LobbyEnabled BIT, @CaptionsOn BIT,
    @InviteeIds dbo.sahyog_GuidList READONLY, @GuestEmails dbo.sahyog_EmailList READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;
        INSERT dbo.sahyog_Meetings (MeetingId, TenantId, Title, Agenda, StartUtc, DurationMinutes, Recurrence, RoomName, GuestCode,
                             HostId, ChannelId, IsInstant, GuestLinkEnabled, LobbyEnabled, CaptionsOn)
        VALUES (@MeetingId, @TenantId, @Title, @Agenda, @StartUtc, @DurationMinutes, @Recurrence, @RoomName, @GuestCode,
                @HostId, @ChannelId, @IsInstant, @GuestLinkEnabled, @LobbyEnabled, @CaptionsOn);

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

/* Meetings a person hosts or is invited to, for the calendar.
   Result 1 = meetings, result 2 = their invitees. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_ListForUser
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @FromUtc DATETIME2(0), @ToUtc DATETIME2(0)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT m.MeetingId, m.Title, m.Agenda, m.StartUtc, m.DurationMinutes, m.Recurrence, m.RoomName, m.GuestCode,
           m.HostId, h.DisplayName AS HostName, h.AvatarTone AS HostTone, m.ChannelId, m.IsInstant,
           m.GuestLinkEnabled, m.LobbyEnabled, m.CaptionsOn
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
           m.GuestLinkEnabled, m.LobbyEnabled, m.CaptionsOn,
           c.Name AS ChannelName, c.IsDirect AS ChannelIsDirect
    FROM dbo.sahyog_Meetings m
    JOIN dbo.sahyog_Users h ON h.UserId = m.HostId
    LEFT JOIN dbo.sahyog_Channels c ON c.ChannelId = m.ChannelId
    WHERE m.TenantId = @TenantId AND m.MeetingId = @MeetingId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_GetInvitees
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT i.MeetingId, i.UserId, u.DisplayName, u.AvatarTone, u.Email, i.GuestEmail
    FROM dbo.sahyog_MeetingInvitees i
    LEFT JOIN dbo.sahyog_Users u ON u.UserId = i.UserId
    WHERE i.TenantId = @TenantId AND i.MeetingId = @MeetingId;
END
GO

/* Host (or workspace admin) cancels a meeting. Returns its start time so the page can return to that week.
   @Result: 0 ok, 1 not found, 2 not allowed. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Meeting_Delete
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT,
    @Result INT OUTPUT, @StartUtc DATETIME2(0) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @HostId UNIQUEIDENTIFIER;
    SELECT @HostId = HostId, @StartUtc = StartUtc FROM dbo.sahyog_Meetings WHERE TenantId = @TenantId AND MeetingId = @MeetingId;

    IF @HostId IS NULL BEGIN SET @Result = 1; RETURN; END
    IF @HostId <> @UserId AND @IsAdmin = 0 BEGIN SET @Result = 2; RETURN; END

    DELETE dbo.sahyog_Meetings WHERE TenantId = @TenantId AND MeetingId = @MeetingId;
    SET @Result = 0;
END
GO

/* Public guest link /join/{code}. No tenant parameter: the code itself identifies the meeting. */
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
    WHERE m.GuestCode = @GuestCode AND m.GuestLinkEnabled = 1;
END
GO

/* =============================== FIRST-TIME SETUP =============================== */

/* Used by the one-time /setup page: it only works while no CloudWheel super admin exists. */
CREATE OR ALTER PROCEDURE dbo.sahyog_User_SuperAdminExists
AS
BEGIN
    SET NOCOUNT ON;
    SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE Role = N'SuperAdmin') THEN 1 ELSE 0 END AS BIT) AS AnyExists;
END
GO
