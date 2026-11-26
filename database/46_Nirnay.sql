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
