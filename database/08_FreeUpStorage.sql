/* =====================================================================
   ShankhNaad round 13 (safe to run more than once; needs 01–04):
     Super admin "Free up space" for a client.
       sahyog_Tenant_FilesSummary  how many chat files (and bytes) are older than a date (NULL = all files)
       sahyog_Tenant_PurgeFiles    removes those files: the chat message stays and says the file was removed,
                                   the file row goes, and the client's storage figure is recounted from what's left.
                                   Returns one row per removed file (StoragePath, SizeBytes) so the app deletes them from disk.
   Only chat file uploads use storage. Message text, meetings and video recordings (kept by JaaS) do not.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_FilesSummary
    @TenantId UNIQUEIDENTIFIER, @OlderThanUtc DATETIME2(3) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) AS Files, CAST(ISNULL(SUM(SizeBytes), 0) AS BIGINT) AS Bytes
    FROM dbo.sahyog_Attachments
    WHERE TenantId = @TenantId AND (@OlderThanUtc IS NULL OR UploadedUtc < @OlderThanUtc);
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_PurgeFiles
    @TenantId UNIQUEIDENTIFIER, @OlderThanUtc DATETIME2(3) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SELECT AttachmentId, FileName, StoragePath, SizeBytes
    INTO #gone
    FROM dbo.sahyog_Attachments
    WHERE TenantId = @TenantId AND (@OlderThanUtc IS NULL OR UploadedUtc < @OlderThanUtc);

    BEGIN TRANSACTION;
        -- keep the conversation readable: the message stays and says what was there
        UPDATE m
        SET m.AttachmentId = NULL,
            m.Body = LEFT(CASE WHEN m.Body = N'' THEN N'' ELSE m.Body + NCHAR(10) END
                          + N'[File removed to free up space: ' + g.FileName + N']', 4000)
        FROM dbo.sahyog_Messages m
        JOIN #gone g ON g.AttachmentId = m.AttachmentId
        WHERE m.TenantId = @TenantId;

        DELETE a FROM dbo.sahyog_Attachments a JOIN #gone g ON g.AttachmentId = a.AttachmentId;

        -- recount from what's left (also corrects any drift in the stored figure)
        UPDATE dbo.sahyog_Tenants
        SET StorageUsedBytes = (SELECT CAST(ISNULL(SUM(SizeBytes), 0) AS BIGINT) FROM dbo.sahyog_Attachments WHERE TenantId = @TenantId)
        WHERE TenantId = @TenantId;
    COMMIT;

    SELECT StoragePath, SizeBytes FROM #gone;
END
GO
