/* =====================================================================
   ShankhNaad round 17 (safe to run more than once; needs 01–04):
     One-time "set your password" links, used by:
       - the welcome email when an admin adds a person (Purpose 1, valid 7 days)
       - "Forgot password?" on the sign-in page and "Email a set-password link" on Team (Purpose 2)
     Only a SHA-256 hash of each link's secret is stored, so a database copy can't be used to sign in.
     A new link cancels the person's older unused links. Using a link sets the password, clears any
     lockout and signs the person out everywhere (new security stamp).

       sahyog_PasswordLink_Create  @Result: 0 created, 5 a link was created less than @MinGapSeconds ago
       sahyog_PasswordLink_Get     the link's person and state (for showing the page)
       sahyog_PasswordLink_Use     @Result: 0 password set, 1 link not valid (wrong, used or expired),
                                            2 account inactive or workspace paused
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_PasswordLinks', N'U') IS NULL
CREATE TABLE dbo.sahyog_PasswordLinks
(
    TokenHash   BINARY(32)       NOT NULL CONSTRAINT PK_sahyog_PasswordLinks PRIMARY KEY,
    UserId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_PasswordLinks_Users REFERENCES dbo.sahyog_Users(UserId) ON DELETE CASCADE,
    Purpose     TINYINT          NOT NULL,          -- 1 welcome, 2 reset
    CreatedUtc  DATETIME2(0)     NOT NULL CONSTRAINT DF_sahyog_PasswordLinks_Created DEFAULT (SYSUTCDATETIME()),
    ExpiresUtc  DATETIME2(0)     NOT NULL,
    UsedUtc     DATETIME2(0)     NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_PasswordLinks_User')
    CREATE INDEX IX_sahyog_PasswordLinks_User ON dbo.sahyog_PasswordLinks(UserId, CreatedUtc DESC);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_PasswordLink_Create
    @UserId UNIQUEIDENTIFIER, @TokenHash BINARY(32), @Purpose TINYINT, @ExpiresUtc DATETIME2(0),
    @MinGapSeconds INT = 60,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    -- one link a minute per person is plenty (stops "Forgot password" being used to flood an inbox)
    IF EXISTS (SELECT 1 FROM dbo.sahyog_PasswordLinks WITH (UPDLOCK, HOLDLOCK)
               WHERE UserId = @UserId AND CreatedUtc > DATEADD(SECOND, -@MinGapSeconds, SYSUTCDATETIME()))
    BEGIN ROLLBACK; SET @Result = 5; RETURN; END

    -- a new link replaces any older unused ones
    UPDATE dbo.sahyog_PasswordLinks SET UsedUtc = SYSUTCDATETIME()
    WHERE UserId = @UserId AND UsedUtc IS NULL;

    INSERT dbo.sahyog_PasswordLinks (TokenHash, UserId, Purpose, ExpiresUtc)
    VALUES (@TokenHash, @UserId, @Purpose, @ExpiresUtc);

    -- tidy up links that ended more than 30 days ago
    DELETE dbo.sahyog_PasswordLinks WHERE ExpiresUtc < DATEADD(DAY, -30, SYSUTCDATETIME());

    COMMIT;
    SET @Result = 0;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_PasswordLink_Get
    @TokenHash BINARY(32)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.Purpose, l.ExpiresUtc, l.UsedUtc,
           u.DisplayName, u.Email, u.IsActive,
           t.Slug AS TenantSlug, t.Name AS TenantName, CAST(ISNULL(t.IsActive, 1) AS BIT) AS TenantActive
    FROM dbo.sahyog_PasswordLinks l
    JOIN dbo.sahyog_Users u ON u.UserId = l.UserId
    LEFT JOIN dbo.sahyog_Tenants t ON t.TenantId = u.TenantId
    WHERE l.TokenHash = @TokenHash;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_PasswordLink_Use
    @TokenHash BINARY(32), @NewPasswordHash NVARCHAR(400),
    @Result INT OUTPUT, @Email NVARCHAR(256) OUTPUT, @TenantSlug NVARCHAR(40) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    DECLARE @UserId UNIQUEIDENTIFIER, @Expires DATETIME2(0), @Used DATETIME2(0);
    SELECT @UserId = UserId, @Expires = ExpiresUtc, @Used = UsedUtc
    FROM dbo.sahyog_PasswordLinks WITH (UPDLOCK, HOLDLOCK)
    WHERE TokenHash = @TokenHash;

    IF @UserId IS NULL OR @Used IS NOT NULL OR @Expires < SYSUTCDATETIME()
    BEGIN ROLLBACK; SET @Result = 1; RETURN; END

    DECLARE @Active BIT, @TenantActive BIT;
    SELECT @Active = u.IsActive, @TenantActive = CAST(ISNULL(t.IsActive, 1) AS BIT),
           @Email = u.Email, @TenantSlug = t.Slug
    FROM dbo.sahyog_Users u
    LEFT JOIN dbo.sahyog_Tenants t ON t.TenantId = u.TenantId
    WHERE u.UserId = @UserId;

    IF @Active = 0 OR @TenantActive = 0
    BEGIN ROLLBACK; SET @Result = 2; RETURN; END

    UPDATE dbo.sahyog_Users
    SET PasswordHash = @NewPasswordHash, FailedLoginCount = 0, LockoutEndUtc = NULL, SecurityStamp = NEWID()
    WHERE UserId = @UserId;

    UPDATE dbo.sahyog_PasswordLinks SET UsedUtc = SYSUTCDATETIME()
    WHERE UserId = @UserId AND UsedUtc IS NULL;

    COMMIT;
    SET @Result = 0;
END
GO
