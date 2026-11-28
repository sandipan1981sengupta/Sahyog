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
