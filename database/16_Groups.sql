/* =====================================================================
   ShankhNaad round 25 (safe to run more than once; needs 01–04, run after 14):
     Private groups: a group conversation with only the people you pick
     (channels stay "everyone in the workspace").
       - sahyog_Channels.IsPrivate (0 = channel for everyone, 1 = group of chosen people)
       - sahyog_Chat_CreateGroup: creates the group with you + the people picked
       - sahyog_User_Create: new people join every channel, but not private groups
       - sahyog_Chat_GetSidebar: also returns IsPrivate (group icon in the list)
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_Channels', N'IsPrivate') IS NULL
    ALTER TABLE dbo.sahyog_Channels ADD IsPrivate BIT NOT NULL CONSTRAINT DF_sahyog_Channels_IsPrivate DEFAULT (0);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_User_Create
    @UserId UNIQUEIDENTIFIER, @TenantId UNIQUEIDENTIFIER = NULL, @Email NVARCHAR(256), @DisplayName NVARCHAR(100),
    @PasswordHash NVARCHAR(400), @Role NVARCHAR(20), @AvatarTone TINYINT, @EnforceLimit BIT = 1,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    IF EXISTS (SELECT 1 FROM dbo.sahyog_Users WITH (UPDLOCK, HOLDLOCK) WHERE Email = @Email)
    BEGIN
        ROLLBACK; SET @Result = 1; RETURN;
    END

    IF @TenantId IS NOT NULL AND @EnforceLimit = 1
    BEGIN
        DECLARE @Max INT;
        SELECT @Max = COALESCE(t.MaxUsersOverride, p.MaxUsers)
        FROM dbo.sahyog_Tenants t WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.sahyog_Plans p ON p.PlanId = t.PlanId
        WHERE t.TenantId = @TenantId;

        IF (SELECT COUNT(*) FROM dbo.sahyog_Users WHERE TenantId = @TenantId AND IsActive = 1) >= @Max
        BEGIN
            ROLLBACK; SET @Result = 2; RETURN;
        END
    END

    INSERT dbo.sahyog_Users (UserId, TenantId, Email, DisplayName, PasswordHash, Role, AvatarTone)
    VALUES (@UserId, @TenantId, @Email, @DisplayName, @PasswordHash, @Role, @AvatarTone);

    IF @TenantId IS NOT NULL
        INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId)
        SELECT c.ChannelId, @UserId, @TenantId
        FROM dbo.sahyog_Channels c
        WHERE c.TenantId = @TenantId AND c.IsDirect = 0 AND c.IsPrivate = 0;   -- not into private groups

    COMMIT;
    SET @Result = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_GetSidebar
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.ChannelId, c.Name, c.Description, c.IsDirect, c.IsPrivate, cm.UnreadCount, c.LastMessageUtc,
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

/* @MemberIds: comma-separated user ids. Only active people of the same workspace are added; the creator always is.
   @Result: 0 created, 1 name already used, 2 nobody else picked. Returns the members' ids. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Chat_CreateGroup
    @TenantId UNIQUEIDENTIFIER, @ChannelId UNIQUEIDENTIFIER, @Name NVARCHAR(80), @Description NVARCHAR(300) = NULL,
    @CreatedBy UNIQUEIDENTIFIER, @MemberIds NVARCHAR(MAX), @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM dbo.sahyog_Channels WHERE TenantId = @TenantId AND IsDirect = 0 AND Name = @Name)
    BEGIN SET @Result = 1; RETURN; END

    DECLARE @Members TABLE (UserId UNIQUEIDENTIFIER PRIMARY KEY);
    INSERT @Members (UserId)
    SELECT DISTINCT u.UserId
    FROM STRING_SPLIT(ISNULL(@MemberIds, N''), N',') s
    JOIN dbo.sahyog_Users u ON u.UserId = TRY_CAST(LTRIM(RTRIM(s.value)) AS UNIQUEIDENTIFIER)
    WHERE u.TenantId = @TenantId AND u.IsActive = 1 AND u.UserId <> @CreatedBy;

    IF NOT EXISTS (SELECT 1 FROM @Members) BEGIN SET @Result = 2; RETURN; END
    INSERT @Members (UserId) VALUES (@CreatedBy);

    BEGIN TRANSACTION;
        INSERT dbo.sahyog_Channels (ChannelId, TenantId, Name, Description, CreatedBy, IsPrivate)
        VALUES (@ChannelId, @TenantId, @Name, @Description, @CreatedBy, 1);
        INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId)
        SELECT @ChannelId, UserId, @TenantId FROM @Members;
    COMMIT;

    SET @Result = 0;
    SELECT UserId FROM @Members;
END
GO
