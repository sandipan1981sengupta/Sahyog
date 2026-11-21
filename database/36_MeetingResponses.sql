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
