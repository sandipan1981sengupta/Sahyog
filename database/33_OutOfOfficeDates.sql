/* =====================================================================
   ShankhNaad round 42 (safe to run more than once; needs 32_OutOfOfficeAndEdit.sql):
     Out of office from one date to another ("24 Nov → 28 Nov"), so it can be set in advance.
     Adds StartUtc to sahyog_OutOfOffice (empty = starts now) and updates the two procedures.
     Nothing is removed; an Out of office already set keeps working.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.sahyog_OutOfOffice', N'StartUtc') IS NULL
    ALTER TABLE dbo.sahyog_OutOfOffice ADD StartUtc DATETIME2(3) NULL;   -- NULL = from when it was set
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Ooo_Set
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Message NVARCHAR(500), @UntilUtc DATETIME2(3),
    @StartUtc DATETIME2(3) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId) RETURN;
    MERGE dbo.sahyog_OutOfOffice AS t
    USING (SELECT @UserId AS UserId) AS s ON t.UserId = s.UserId
    WHEN MATCHED THEN UPDATE SET Message = NULLIF(@Message, N''), UntilUtc = @UntilUtc, StartUtc = @StartUtc, SinceUtc = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (UserId, TenantId, Message, UntilUtc, StartUtc) VALUES (@UserId, @TenantId, NULLIF(@Message, N''), @UntilUtc, @StartUtc);
END
GO

/* everyone out of office now or later (ended ones are tidied away) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Ooo_List @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.sahyog_OutOfOffice WHERE TenantId = @TenantId AND UntilUtc IS NOT NULL AND UntilUtc <= SYSUTCDATETIME();
    SELECT o.UserId, o.Message, o.UntilUtc, o.SinceUtc, o.StartUtc
    FROM dbo.sahyog_OutOfOffice o
    JOIN dbo.sahyog_Users u ON u.UserId = o.UserId AND u.TenantId = @TenantId AND u.IsActive = 1
    WHERE o.TenantId = @TenantId;
END
GO
