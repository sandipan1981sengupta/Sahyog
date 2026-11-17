/* =====================================================================
   ShankhNaad round 22 (safe to run more than once; needs 01–02):
     Team list also returns LastLoginUtc, so the Team page can mark people who were
     invited but have never signed in ("Invited · not joined") and offer "Resend invite".
     Until this runs, the app simply shows nobody as pending.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_User_ListByTenant
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT UserId, TenantId, Email, DisplayName, Role, AvatarTone, IsActive, LastLoginUtc
    FROM dbo.sahyog_Users
    WHERE TenantId = @TenantId
    ORDER BY DisplayName;
END
GO
