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
