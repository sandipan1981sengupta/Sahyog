/* =====================================================================
   ShankhNaad: every plan's video quality to 1080p (Full HD).
   A ONE-TIME script: run it once. It is not part of 99_ApplyAllUpdates.sql on purpose,
   so running the updates again never undoes a quality you later pick in Admin → Plans.

   Workspaces pick it up from their next call (people already in a call: after they rejoin).
   JaaS (8x8) doesn't charge more for 1080p; it charges by monthly active users.
   Each person needs about 2–3 Mbps upload for a sharp 1080p picture
   (JaaS lowers it by itself for anyone on a slower connection).
   ===================================================================== */
SET NOCOUNT ON;

SELECT PlanId, Name, MaxVideoHeight AS QualityBefore FROM dbo.sahyog_Plans ORDER BY PlanId;

UPDATE dbo.sahyog_Plans SET MaxVideoHeight = 1080 WHERE MaxVideoHeight <> 1080;
PRINT CONCAT(@@ROWCOUNT, N' plan(s) set to 1080p.');

-- new plans made later start at 1080p too
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_sahyog_Plans_MaxVideoHeight')
    ALTER TABLE dbo.sahyog_Plans DROP CONSTRAINT DF_sahyog_Plans_MaxVideoHeight;
ALTER TABLE dbo.sahyog_Plans ADD CONSTRAINT DF_sahyog_Plans_MaxVideoHeight DEFAULT (1080) FOR MaxVideoHeight;

SELECT PlanId, Name, MaxVideoHeight AS QualityNow FROM dbo.sahyog_Plans ORDER BY PlanId;
GO
