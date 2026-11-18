/* =====================================================================
   ShankhNaad round 34 (safe to run more than once; needs 01–02):
     Chat inside a call: messages and files everyone in the call sees
     (like the meeting chat in Microsoft Teams). Kept with the meeting, so
     people who join later, or rejoin, see what was said and shared.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_CallChat', N'U') IS NULL
CREATE TABLE dbo.sahyog_CallChat
(
    MessageId    BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_sahyog_CallChat PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL,
    MeetingId    UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_CallChat_Meetings REFERENCES dbo.sahyog_Meetings(MeetingId) ON DELETE CASCADE,
    SenderId     UNIQUEIDENTIFIER NULL,          -- NULL = a guest
    SenderName   NVARCHAR(120)    NOT NULL,
    SenderTone   INT              NOT NULL CONSTRAINT DF_sahyog_CallChat_Tone DEFAULT (3),
    Body         NVARCHAR(2000)   NULL,
    FileId       UNIQUEIDENTIFIER NULL,
    FileName     NVARCHAR(255)    NULL,
    ContentType  NVARCHAR(150)    NULL,
    SizeBytes    BIGINT           NULL,
    StoragePath  NVARCHAR(400)    NULL,
    SentUtc      DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_CallChat_Sent DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_CallChat_Meeting')
    CREATE INDEX IX_sahyog_CallChat_Meeting ON dbo.sahyog_CallChat(MeetingId, MessageId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_sahyog_CallChat_File')
    CREATE UNIQUE INDEX UX_sahyog_CallChat_File ON dbo.sahyog_CallChat(FileId) WHERE FileId IS NOT NULL;
GO

/* A message (text, or a file) in a call. A file counts toward the workspace's storage;
   @Result: 0 sent, 1 no such meeting, 2 storage full. */
CREATE OR ALTER PROCEDURE dbo.sahyog_CallChat_Add
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER,
    @SenderId UNIQUEIDENTIFIER = NULL, @SenderName NVARCHAR(120), @SenderTone INT = 3,
    @Body NVARCHAR(2000) = NULL,
    @FileId UNIQUEIDENTIFIER = NULL, @FileName NVARCHAR(255) = NULL, @ContentType NVARCHAR(150) = NULL,
    @SizeBytes BIGINT = NULL, @StoragePath NVARCHAR(400) = NULL,
    @Result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Meetings WHERE MeetingId = @MeetingId AND TenantId = @TenantId)
    BEGIN SET @Result = 1; RETURN; END

    DECLARE @Id BIGINT;
    BEGIN TRANSACTION;
        IF @FileId IS NOT NULL
        BEGIN
            UPDATE t SET StorageUsedBytes = t.StorageUsedBytes + @SizeBytes
            FROM dbo.sahyog_Tenants t JOIN dbo.sahyog_Plans p ON p.PlanId = t.PlanId
            WHERE t.TenantId = @TenantId
              AND t.StorageUsedBytes + @SizeBytes <= COALESCE(t.StorageQuotaMbOverride, p.StorageQuotaMb) * CAST(1048576 AS BIGINT);
            IF @@ROWCOUNT = 0 BEGIN ROLLBACK; SET @Result = 2; RETURN; END
        END

        INSERT dbo.sahyog_CallChat (TenantId, MeetingId, SenderId, SenderName, SenderTone, Body, FileId, FileName, ContentType, SizeBytes, StoragePath)
        VALUES (@TenantId, @MeetingId, @SenderId, @SenderName, @SenderTone, @Body, @FileId, @FileName, @ContentType, @SizeBytes, @StoragePath);
        SET @Id = SCOPE_IDENTITY();
    COMMIT;

    SET @Result = 0;
    SELECT MessageId, MeetingId, SenderId, SenderName, SenderTone, Body, FileId, FileName, ContentType, SizeBytes, SentUtc
    FROM dbo.sahyog_CallChat WHERE MessageId = @Id;
END
GO

/* The chat of a call, oldest first (the last @Take messages). */
CREATE OR ALTER PROCEDURE dbo.sahyog_CallChat_List
    @TenantId UNIQUEIDENTIFIER, @MeetingId UNIQUEIDENTIFIER, @Take INT = 300
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM (
        SELECT TOP (@Take) MessageId, MeetingId, SenderId, SenderName, SenderTone, Body, FileId, FileName, ContentType, SizeBytes, SentUtc
        FROM dbo.sahyog_CallChat
        WHERE TenantId = @TenantId AND MeetingId = @MeetingId
        ORDER BY MessageId DESC) x
    ORDER BY MessageId;
END
GO

/* One shared file (to download it). */
CREATE OR ALTER PROCEDURE dbo.sahyog_CallChat_GetFile
    @TenantId UNIQUEIDENTIFIER, @FileId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT MeetingId, FileName, ContentType, SizeBytes, StoragePath
    FROM dbo.sahyog_CallChat WHERE TenantId = @TenantId AND FileId = @FileId;
END
GO
