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
