/* =====================================================================
   ShankhNaad round 15 (safe to run more than once):
     Recording is switched off for every plan for now.
     The app also refuses to turn it on (VideoFeatures.RecordingAvailable = false in
     ShankhNaad.ServiceLibrary/Video/VideoProviders.cs) and never puts recording in a meeting pass,
     so this script only makes the stored plans match.
   ===================================================================== */
SET NOCOUNT ON;
UPDATE dbo.sahyog_Plans SET RecordingEnabled = 0 WHERE RecordingEnabled = 1;
SELECT PlanId, Name, RecordingEnabled FROM dbo.sahyog_Plans ORDER BY PlanId;
GO
