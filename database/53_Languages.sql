/* =====================================================================
   ShankhNaad round 53 (safe to run more than once; needs 01–02):
     Languages: translated chat messages and voice-note transcripts are kept, so each one is paid for once.
     (The translation and speech services are set in appsettings.json → "Languages"; off until keys are added.)
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Translations', N'U') IS NULL
CREATE TABLE dbo.sahyog_Translations
(
    MessageId   BIGINT        NOT NULL,
    Lang        VARCHAR(10)   NOT NULL,
    TextHash    INT           NOT NULL,              -- the message text it was made from (an edit makes a new one)
    Translated  NVARCHAR(MAX) NOT NULL,
    FromLang    VARCHAR(10)   NULL,
    CreatedUtc  DATETIME2(3)  NOT NULL CONSTRAINT DF_sahyog_Translations_Created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sahyog_Translations PRIMARY KEY (MessageId, Lang)
);
GO
IF OBJECT_ID(N'dbo.sahyog_Transcripts', N'U') IS NULL
CREATE TABLE dbo.sahyog_Transcripts
(
    AttachmentId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_Transcripts PRIMARY KEY,
    Transcript   NVARCHAR(MAX)    NOT NULL,
    CreatedUtc   DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Transcripts_Created DEFAULT (SYSUTCDATETIME())
);
GO

/* a message's text, only for someone in its chat; with a saved translation if there is one */
CREATE OR ALTER PROCEDURE dbo.sahyog_Lang_Message
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @MessageId BIGINT, @Lang VARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT m.Body, t.TextHash, t.Translated, t.FromLang
    FROM dbo.sahyog_Messages m
    LEFT JOIN dbo.sahyog_Translations t ON t.MessageId = m.MessageId AND t.Lang = @Lang
    WHERE m.MessageId = @MessageId AND m.TenantId = @TenantId
      AND EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers cm WHERE cm.ChannelId = m.ChannelId AND cm.UserId = @UserId);
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Lang_SaveTranslation
    @MessageId BIGINT, @Lang VARCHAR(10), @TextHash INT, @Translated NVARCHAR(MAX), @FromLang VARCHAR(10) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Translations WHERE MessageId = @MessageId AND Lang = @Lang)
        UPDATE dbo.sahyog_Translations SET TextHash = @TextHash, Translated = @Translated, FromLang = @FromLang, CreatedUtc = SYSUTCDATETIME()
        WHERE MessageId = @MessageId AND Lang = @Lang;
    ELSE
        INSERT dbo.sahyog_Translations (MessageId, Lang, TextHash, Translated, FromLang) VALUES (@MessageId, @Lang, @TextHash, @Translated, @FromLang);
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Lang_GetTranscript
    @AttachmentId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Transcript FROM dbo.sahyog_Transcripts WHERE AttachmentId = @AttachmentId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Lang_SaveTranscript
    @AttachmentId UNIQUEIDENTIFIER, @Transcript NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Transcripts WHERE AttachmentId = @AttachmentId)
        INSERT dbo.sahyog_Transcripts (AttachmentId, Transcript) VALUES (@AttachmentId, @Transcript);
END
GO

PRINT N'53_Languages.sql: translations and transcripts ready.';
GO
