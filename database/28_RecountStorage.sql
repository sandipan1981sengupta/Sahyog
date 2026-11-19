/* =====================================================================
   ShankhNaad round 37 (safe to run more than once; needs 01–02, 25):
     "Storage used" is a running total kept in sahyog_Tenants.StorageUsedBytes:
     +size on every upload (chat files and files shared in calls), -size when a file is deleted.
     It counts the whole workspace (everyone's chats and calls), not the files on one server's disk.
     Some deletes never subtracted (e.g. a deleted meeting takes its call files with it), so the figure
     can drift upward. This script shows the stored figure next to the real total, then fixes it.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* Recounts one workspace (or all, when @TenantId is NULL) from the files that still exist in the database. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Tenant_RecountStorage
    @TenantId UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE t
    SET StorageUsedBytes =
          (SELECT CAST(ISNULL(SUM(a.SizeBytes), 0) AS BIGINT) FROM dbo.sahyog_Attachments a WHERE a.TenantId = t.TenantId)
        + (SELECT CAST(ISNULL(SUM(c.SizeBytes), 0) AS BIGINT) FROM dbo.sahyog_CallChat c WHERE c.TenantId = t.TenantId AND c.FileId IS NOT NULL)
    FROM dbo.sahyog_Tenants t
    WHERE @TenantId IS NULL OR t.TenantId = @TenantId;
END
GO

/* 1) Before: what is stored vs. what the files really add up to */
SELECT t.TenantId,
       t.StorageUsedBytes / 1048576.0 AS StoredMB,
       (SELECT ISNULL(SUM(a.SizeBytes), 0) FROM dbo.sahyog_Attachments a WHERE a.TenantId = t.TenantId) / 1048576.0 AS ChatFilesMB,
       (SELECT COUNT(*) FROM dbo.sahyog_Attachments a WHERE a.TenantId = t.TenantId) AS ChatFiles,
       (SELECT ISNULL(SUM(c.SizeBytes), 0) FROM dbo.sahyog_CallChat c WHERE c.TenantId = t.TenantId AND c.FileId IS NOT NULL) / 1048576.0 AS CallFilesMB,
       (SELECT COUNT(*) FROM dbo.sahyog_CallChat c WHERE c.TenantId = t.TenantId AND c.FileId IS NOT NULL) AS CallFiles
FROM dbo.sahyog_Tenants t;
GO

/* 2) Fix every workspace's figure */
EXEC dbo.sahyog_Tenant_RecountStorage;
GO

/* 3) After */
SELECT TenantId, StorageUsedBytes / 1048576.0 AS StoredMB FROM dbo.sahyog_Tenants;
GO
