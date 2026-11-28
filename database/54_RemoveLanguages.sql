/* =====================================================================
   ShankhNaad round 54 (safe to run more than once): the Languages feature is removed.
     Drops what 53_Languages.sql created: the saved translations and voice-note transcripts and the four
     procedures that used them. Nothing else in ShankhNaad uses these. If 53 was never run, this does nothing.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

DROP PROCEDURE IF EXISTS dbo.sahyog_Lang_Message;
DROP PROCEDURE IF EXISTS dbo.sahyog_Lang_SaveTranslation;
DROP PROCEDURE IF EXISTS dbo.sahyog_Lang_GetTranscript;
DROP PROCEDURE IF EXISTS dbo.sahyog_Lang_SaveTranscript;
GO

DROP TABLE IF EXISTS dbo.sahyog_Translations;
DROP TABLE IF EXISTS dbo.sahyog_Transcripts;
GO

PRINT N'54_RemoveLanguages.sql: the Languages feature is removed from the database.';
GO
