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
