/* =====================================================================
   ShankhNaad round 12 (safe to run more than once; needs 01–04):
     Super admin can rename a client (company name + workspace name) and delete a client.
       sahyog_Tenant_Update  @Result: 0 saved, 1 workspace name taken, 2 not found
       sahyog_Tenant_Delete  @Result: 0 deleted, 1 not found, 2 typed workspace name does not match,
                                      3 client is still active (pause it first)
   Delete removes everything the client owns: meetings, messages, files (rows), channels and people.
   The app then removes the client's file folder (tenant-<id>) from disk.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_Update
    @TenantId UNIQUEIDENTIFIER, @Name NVARCHAR(120), @Slug NVARCHAR(40),
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Tenants WHERE TenantId = @TenantId) BEGIN SET @Result = 2; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Tenants WHERE Slug = @Slug AND TenantId <> @TenantId) BEGIN SET @Result = 1; RETURN; END

    UPDATE dbo.sahyog_Tenants SET Name = @Name, Slug = @Slug WHERE TenantId = @TenantId;
    SET @Result = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_Delete
    @TenantId UNIQUEIDENTIFIER, @ConfirmSlug NVARCHAR(40),
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Slug NVARCHAR(40), @IsActive BIT;
    SELECT @Slug = Slug, @IsActive = IsActive FROM dbo.sahyog_Tenants WHERE TenantId = @TenantId;

    IF @Slug IS NULL BEGIN SET @Result = 1; RETURN; END
    IF @Slug <> LOWER(LTRIM(RTRIM(@ConfirmSlug))) BEGIN SET @Result = 2; RETURN; END
    IF @IsActive = 1 BEGIN SET @Result = 3; RETURN; END

    BEGIN TRANSACTION;
        -- meetings (invitees first; they also point at people)
        DELETE i FROM dbo.sahyog_MeetingInvitees i
        JOIN dbo.sahyog_Meetings m ON m.MeetingId = i.MeetingId
        WHERE m.TenantId = @TenantId;
        DELETE dbo.sahyog_Meetings WHERE TenantId = @TenantId;

        -- chat: messages before files (a message can point at a file), then members and channels
        DELETE msg FROM dbo.sahyog_Messages msg
        JOIN dbo.sahyog_Channels c ON c.ChannelId = msg.ChannelId
        WHERE c.TenantId = @TenantId;
        DELETE a FROM dbo.sahyog_Attachments a
        JOIN dbo.sahyog_Channels c ON c.ChannelId = a.ChannelId
        WHERE c.TenantId = @TenantId;
        DELETE cm FROM dbo.sahyog_ChannelMembers cm
        JOIN dbo.sahyog_Channels c ON c.ChannelId = cm.ChannelId
        WHERE c.TenantId = @TenantId;
        DELETE dbo.sahyog_Channels WHERE TenantId = @TenantId;

        -- people, then the client itself
        DELETE dbo.sahyog_Users WHERE TenantId = @TenantId;
        DELETE dbo.sahyog_Tenants WHERE TenantId = @TenantId;
    COMMIT;

    SET @Result = 0;
END
GO
