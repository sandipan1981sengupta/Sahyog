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
