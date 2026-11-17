/* =====================================================================
   ShankhNaad round 16 (safe to run more than once; needs 01–04):
     Workspace admins can edit a person on the Team page: name, email, admin role,
     and optionally set a new temporary password.
       sahyog_User_Update  @Result: 0 saved, 1 email used by someone else, 3 not found,
                                    4 would leave the workspace without an admin
     Changing the email, role or password signs that person out everywhere (new security stamp),
     and a new password also clears any sign-in lockout. A name-only change keeps them signed in.
     @NewStamp returns the person's security stamp after the change (the app refreshes your own
     sign-in with it when you edit yourself).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_User_Update
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER,
    @DisplayName NVARCHAR(100), @Email NVARCHAR(256), @Role NVARCHAR(20),
    @NewPasswordHash NVARCHAR(400) = NULL,
    @Result INT OUTPUT, @NewStamp UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    DECLARE @OldEmail NVARCHAR(256), @OldRole NVARCHAR(20);
    SELECT @OldEmail = Email, @OldRole = Role
    FROM dbo.sahyog_Users WITH (UPDLOCK, HOLDLOCK)
    WHERE UserId = @UserId AND TenantId = @TenantId;

    IF @OldEmail IS NULL BEGIN ROLLBACK; SET @Result = 3; RETURN; END

    IF @Email <> @OldEmail
       AND EXISTS (SELECT 1 FROM dbo.sahyog_Users WITH (UPDLOCK, HOLDLOCK) WHERE Email = @Email AND UserId <> @UserId)
    BEGIN ROLLBACK; SET @Result = 1; RETURN; END

    -- never leave a workspace without an active admin
    IF @OldRole = N'TenantAdmin' AND @Role <> N'TenantAdmin'
       AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users
                       WHERE TenantId = @TenantId AND Role = N'TenantAdmin' AND IsActive = 1 AND UserId <> @UserId)
    BEGIN ROLLBACK; SET @Result = 4; RETURN; END

    DECLARE @SignOut BIT = CASE WHEN @Email <> @OldEmail OR @Role <> @OldRole OR @NewPasswordHash IS NOT NULL THEN 1 ELSE 0 END;

    UPDATE dbo.sahyog_Users
    SET DisplayName      = @DisplayName,
        Email            = @Email,
        Role             = @Role,
        PasswordHash     = COALESCE(@NewPasswordHash, PasswordHash),
        FailedLoginCount = CASE WHEN @NewPasswordHash IS NULL THEN FailedLoginCount ELSE 0 END,
        LockoutEndUtc    = CASE WHEN @NewPasswordHash IS NULL THEN LockoutEndUtc ELSE NULL END,
        SecurityStamp    = CASE WHEN @SignOut = 1 THEN NEWID() ELSE SecurityStamp END
    WHERE UserId = @UserId AND TenantId = @TenantId;

    SELECT @NewStamp = SecurityStamp FROM dbo.sahyog_Users WHERE UserId = @UserId;
    COMMIT;

    SET @Result = 0;
END
GO
