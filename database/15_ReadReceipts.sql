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
