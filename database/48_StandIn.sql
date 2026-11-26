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
