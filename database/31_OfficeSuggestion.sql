/* =====================================================================
   ShankhNaad round 40 (safe to run more than once; needs 30_Location.sql):
     "4 people are connecting from 49.205.32.120. Is this your office?"
     How many people (who share their location) connected from each internet address recently.
     Read-only: nothing is stored or changed by this script except the new procedure.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Location_IpCounts @TenantId UNIQUEIDENTIFIER, @SinceUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.Ip, COUNT(DISTINCT l.UserId) AS People
    FROM dbo.sahyog_UserLocations l
    JOIN dbo.sahyog_Users u ON u.UserId = l.UserId AND u.TenantId = @TenantId AND u.IsActive = 1
    WHERE l.TenantId = @TenantId AND l.Sharing = 1 AND l.Ip IS NOT NULL AND l.SeenUtc >= @SinceUtc
    GROUP BY l.Ip
    ORDER BY COUNT(DISTINCT l.UserId) DESC;
END
GO

PRINT N'31_OfficeSuggestion.sql applied.';
GO
