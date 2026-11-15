/* =====================================================================
   Sahyog · 03_Setup.sql
   Run this once if you already ran 02_StoredProcedures.sql before the /setup page existed.
   (Running the whole 02_StoredProcedures.sql again does the same thing.)
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sahyog_User_SuperAdminExists
AS
BEGIN
    SET NOCOUNT ON;
    SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE Role = N'SuperAdmin') THEN 1 ELSE 0 END AS BIT) AS AnyExists;
END
GO
