/* =====================================================================
   ShankhNaad round 27 (safe to run more than once; run after 16):
     - No more "channels": the workspace's main channel (#general) becomes the group "Everyone"
       (everybody stays in it, new people still join it automatically, messages are kept);
       any other channel becomes a normal group with the same members.
     - New workspaces start with "Everyone" instead of "#general".
     - Pinned chats: each person can pin chats to the top of their own list.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_ChannelMembers', N'IsPinned') IS NULL
    ALTER TABLE dbo.sahyog_ChannelMembers ADD IsPinned BIT NOT NULL CONSTRAINT DF_sahyog_ChannelMembers_IsPinned DEFAULT (0);
IF COL_LENGTH(N'dbo.sahyog_ChannelMembers', N'PinnedUtc') IS NULL
    ALTER TABLE dbo.sahyog_ChannelMembers ADD PinnedUtc DATETIME2(3) NULL;
GO

-- each workspace's first channel → "Everyone" (only if it's still called general and the name is free)
;WITH main AS (
    SELECT c.ChannelId, c.TenantId, c.Name,
           ROW_NUMBER() OVER (PARTITION BY c.TenantId ORDER BY c.CreatedUtc, c.ChannelId) AS rn
    FROM dbo.sahyog_Channels c WHERE c.IsDirect = 0
)
UPDATE c SET Name = N'Everyone', Description = N'Everyone in the workspace', IsPrivate = 0
FROM dbo.sahyog_Channels c
JOIN main m ON m.ChannelId = c.ChannelId AND m.rn = 1
WHERE c.Name = N'general'
  AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Channels x WHERE x.TenantId = c.TenantId AND x.IsDirect = 0 AND x.Name = N'Everyone');
GO

-- every other channel → a group (same members, messages kept)
;WITH main AS (
    SELECT c.ChannelId, ROW_NUMBER() OVER (PARTITION BY c.TenantId ORDER BY c.CreatedUtc, c.ChannelId) AS rn
    FROM dbo.sahyog_Channels c WHERE c.IsDirect = 0
)
UPDATE c SET IsPrivate = 1
FROM dbo.sahyog_Channels c
JOIN main m ON m.ChannelId = c.ChannelId AND m.rn > 1
WHERE c.IsPrivate = 0;
GO

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
        VALUES (@GeneralId, @TenantId, N'Everyone', N'Everyone in the workspace', @AdminUserId);

        INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId)
        VALUES (@GeneralId, @AdminUserId, @TenantId);
    COMMIT;

    SET @Result = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetSidebar
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.ChannelId, c.Name, c.Description, c.IsDirect, c.IsPrivate, cm.IsPinned, cm.PinnedUtc, cm.UnreadCount, c.LastMessageUtc,
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

/* Pin or unpin a chat for one person (pins are personal). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_SetPinned
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Pinned BIT, @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_ChannelMembers
    SET IsPinned = @Pinned, PinnedUtc = CASE WHEN @Pinned = 1 THEN SYSUTCDATETIME() ELSE NULL END
    WHERE TenantId = @TenantId AND ChannelId = @ChannelId AND UserId = @UserId;
    SET @Result = CASE WHEN @@ROWCOUNT = 0 THEN 1 ELSE 0 END;
END
GO
