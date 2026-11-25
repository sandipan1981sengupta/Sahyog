/* =====================================================================
   demo_OrgChartTeam.sql  —  DEMO DATA: 10 sample people so you can see the Org chart filled in.
   - Adds 10 people to the workspace of Manjunath (mba140924@gmail.com), or of a workspace named
     'CloudWheel' if that email isn't found. Change @AnchorEmail / @WorkspaceName below if needed.
   - Places your 3 existing people (Sandy, Manjunath, Sandipan) in the chart too.
   - 6 levels deep: Sandy → Head of Engineering → Engineering Manager → Senior Developer → Developer → Intern.
   - Departments: Leadership, Engineering, Sales, HR (created if missing, with their heads).
   - The demo people can sign in with password  Demo@12345  (emails end in @demo.shankhnaad.local).
   - Uses 10 seats of the plan (3 + 10 = 13; your plan allows 15).
   Needs 40_OrgStructure.sql first. Safe to run more than once (people already added are skipped).
   To remove the demo people again: run the "CLEAN UP" block at the end (it is commented out).
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @AnchorEmail   NVARCHAR(256) = N'mba140924@gmail.com';
DECLARE @WorkspaceName NVARCHAR(200) = N'CloudWheel';
DECLARE @Domain        NVARCHAR(100) = N'@demo.shankhnaad.local';
-- password Demo@12345 (ASP.NET Identity v3 hash, same format the app uses)
DECLARE @DemoHash      NVARCHAR(400) = N'AQAAAAIAAYagAAAAEPGRtdPlNBb3N7G9hUxCexu0aAf7k+XUgHxFqlRE5S5u2sjzqQV2FS4N5t5mewJDuA==';

DECLARE @T UNIQUEIDENTIFIER = (SELECT TenantId FROM dbo.sahyog_Users WHERE Email = LOWER(@AnchorEmail));
IF @T IS NULL SET @T = (SELECT TOP (1) TenantId FROM dbo.sahyog_Tenants WHERE Name = @WorkspaceName);
IF @T IS NULL
BEGIN
    RAISERROR(N'Workspace not found. Set @AnchorEmail to the email of someone in your workspace and run again.', 16, 1);
    RETURN;
END
IF COL_LENGTH(N'dbo.sahyog_Users', N'ManagerId') IS NULL
BEGIN
    RAISERROR(N'Run database/40_OrgStructure.sql first.', 16, 1);
    RETURN;
END

BEGIN TRAN;

/* ---------- departments ---------- */
DECLARE @D TABLE (Name NVARCHAR(100) PRIMARY KEY);
INSERT @D VALUES (N'Leadership'), (N'Engineering'), (N'Sales'), (N'HR');
INSERT dbo.sahyog_Departments (DepartmentId, TenantId, Name)
SELECT NEWID(), @T, d.Name FROM @D d
WHERE NOT EXISTS (SELECT 1 FROM dbo.sahyog_Departments x WHERE x.TenantId = @T AND x.Name = d.Name);

DECLARE @Lead UNIQUEIDENTIFIER = (SELECT DepartmentId FROM dbo.sahyog_Departments WHERE TenantId = @T AND Name = N'Leadership');
DECLARE @Eng  UNIQUEIDENTIFIER = (SELECT DepartmentId FROM dbo.sahyog_Departments WHERE TenantId = @T AND Name = N'Engineering');
DECLARE @Sal  UNIQUEIDENTIFIER = (SELECT DepartmentId FROM dbo.sahyog_Departments WHERE TenantId = @T AND Name = N'Sales');
DECLARE @HR   UNIQUEIDENTIFIER = (SELECT DepartmentId FROM dbo.sahyog_Departments WHERE TenantId = @T AND Name = N'HR');

/* ---------- the 10 demo people ---------- */
DECLARE @P TABLE (Code NVARCHAR(20) PRIMARY KEY, Name NVARCHAR(100), Email NVARCHAR(256), Title NVARCHAR(100), Dept UNIQUEIDENTIFIER,
                  Tone TINYINT, Phone NVARCHAR(40), Joined DATE);
INSERT @P VALUES
 (N'EMP-0101', N'Asha Menon',    N'asha'    + @Domain, N'Head of Engineering',  @Eng, 1, N'+91 98450 10101', '2022-04-01'),
 (N'EMP-0102', N'Rohan Kapoor',  N'rohan'   + @Domain, N'Head of Sales',        @Sal, 2, N'+91 98450 10102', '2022-06-15'),
 (N'EMP-0103', N'Lakshmi Iyer',  N'lakshmi' + @Domain, N'HR Manager',           @HR,  3, N'+91 98450 10103', '2022-09-01'),
 (N'EMP-0104', N'Vikram Rao',    N'vikram'  + @Domain, N'Engineering Manager',  @Eng, 4, N'+91 98450 10104', '2023-01-09'),
 (N'EMP-0105', N'Neha Gupta',    N'neha'    + @Domain, N'Senior Developer',     @Eng, 5, N'+91 98450 10105', '2023-05-22'),
 (N'EMP-0106', N'Kiran Das',     N'kiran'   + @Domain, N'Developer',            @Eng, 0, N'+91 98450 10106', '2024-02-12'),
 (N'EMP-0107', N'Tom D''Souza',  N'tom'     + @Domain, N'Intern',               @Eng, 1, N'+91 98450 10107', '2026-07-01'),
 (N'EMP-0108', N'Priya Sharma',  N'priya'   + @Domain, N'Sales Executive',      @Sal, 2, N'+91 98450 10108', '2024-08-05'),
 (N'EMP-0109', N'Arjun Nair',    N'arjun'   + @Domain, N'Sales Executive',      @Sal, 3, N'+91 98450 10109', '2025-01-20'),
 (N'EMP-0110', N'Meera Pillai',  N'meera'   + @Domain, N'Recruiter',            @HR,  4, N'+91 98450 10110', '2025-03-03');

INSERT dbo.sahyog_Users (UserId, TenantId, Email, DisplayName, PasswordHash, Role, AvatarTone, IsActive,
                         JobTitle, DepartmentId, Phone, EmployeeCode, JoinedOn)
SELECT NEWID(), @T, LOWER(p.Email), p.Name, @DemoHash, N'Member', p.Tone, 1, p.Title, p.Dept, p.Phone, p.Code, p.Joined
FROM @P p
WHERE NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users u WHERE u.Email = LOWER(p.Email));

/* ---------- who is who (existing people found by name in this workspace) ---------- */
DECLARE @Sandy     UNIQUEIDENTIFIER = (SELECT TOP (1) UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND IsActive = 1 AND DisplayName = N'Sandy');
DECLARE @Manjunath UNIQUEIDENTIFIER = (SELECT TOP (1) UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND IsActive = 1 AND DisplayName LIKE N'Manjunath%');
DECLARE @Sandipan  UNIQUEIDENTIFIER = (SELECT TOP (1) UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND IsActive = 1 AND DisplayName LIKE N'Sandipan%');
DECLARE @Asha    UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE Email = N'asha'    + @Domain);
DECLARE @Rohan   UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE Email = N'rohan'   + @Domain);
DECLARE @Lakshmi UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE Email = N'lakshmi' + @Domain);
DECLARE @Vikram  UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE Email = N'vikram'  + @Domain);
DECLARE @Neha    UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE Email = N'neha'    + @Domain);
DECLARE @Kiran   UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE Email = N'kiran'   + @Domain);
DECLARE @Tom     UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE Email = N'tom'     + @Domain);
DECLARE @Priya   UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE Email = N'priya'   + @Domain);
DECLARE @Arjun   UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE Email = N'arjun'   + @Domain);
DECLARE @Meera   UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE Email = N'meera'   + @Domain);

/* ---------- your existing 3 people ----------
   Sandy at the top (keeps a job title already set, else "Founder & CEO");
   Manjunath under the Head of Engineering, Sandipan under Manjunath (titles kept if already set). */
UPDATE dbo.sahyog_Users SET JobTitle = COALESCE(NULLIF(JobTitle, N''), N'Founder & CEO'), DepartmentId = @Lead, ManagerId = NULL
WHERE UserId = @Sandy;
UPDATE dbo.sahyog_Users SET JobTitle = COALESCE(NULLIF(JobTitle, N''), N'QA Lead'), DepartmentId = @Eng, ManagerId = @Asha
WHERE UserId = @Manjunath;
UPDATE dbo.sahyog_Users SET JobTitle = COALESCE(NULLIF(JobTitle, N''), N'Senior Test Engineer'), DepartmentId = @Eng, ManagerId = @Manjunath
WHERE UserId = @Sandipan;

/* ---------- reporting lines of the demo people ---------- */
UPDATE dbo.sahyog_Users SET ManagerId = @Sandy   WHERE UserId IN (@Asha, @Rohan, @Lakshmi);
UPDATE dbo.sahyog_Users SET ManagerId = @Asha    WHERE UserId = @Vikram;
UPDATE dbo.sahyog_Users SET ManagerId = @Vikram  WHERE UserId = @Neha;
UPDATE dbo.sahyog_Users SET ManagerId = @Neha    WHERE UserId = @Kiran;
UPDATE dbo.sahyog_Users SET ManagerId = @Kiran   WHERE UserId = @Tom;
UPDATE dbo.sahyog_Users SET ManagerId = @Rohan   WHERE UserId IN (@Priya, @Arjun);
UPDATE dbo.sahyog_Users SET ManagerId = @Lakshmi WHERE UserId = @Meera;

/* ---------- department heads ---------- */
UPDATE dbo.sahyog_Departments SET HeadUserId = @Sandy   WHERE DepartmentId = @Lead AND @Sandy IS NOT NULL;
UPDATE dbo.sahyog_Departments SET HeadUserId = @Asha    WHERE DepartmentId = @Eng;
UPDATE dbo.sahyog_Departments SET HeadUserId = @Rohan   WHERE DepartmentId = @Sal;
UPDATE dbo.sahyog_Departments SET HeadUserId = @Lakshmi WHERE DepartmentId = @HR;

COMMIT;

SELECT u.DisplayName AS Person, u.JobTitle, d.Name AS Department, m.DisplayName AS ReportsTo, u.Email
FROM dbo.sahyog_Users u
LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = u.DepartmentId
LEFT JOIN dbo.sahyog_Users m ON m.UserId = u.ManagerId
WHERE u.TenantId = @T AND u.IsActive = 1
ORDER BY d.Name, u.DisplayName;
PRINT N'Demo team added. Open the Org page (refresh it).';
GO

/* =====================================================================
   CLEAN UP — removes the 10 demo people again (select these lines and run them).
   Your 3 people keep their place in the chart; departments stay (delete them on the Org page if you like).
   ---------------------------------------------------------------------
UPDATE dbo.sahyog_Users SET ManagerId = NULL
WHERE ManagerId IN (SELECT UserId FROM dbo.sahyog_Users WHERE Email LIKE N'%@demo.shankhnaad.local');
UPDATE dbo.sahyog_Departments SET HeadUserId = NULL
WHERE HeadUserId IN (SELECT UserId FROM dbo.sahyog_Users WHERE Email LIKE N'%@demo.shankhnaad.local');
UPDATE dbo.sahyog_Users SET IsActive = 0
WHERE Email LIKE N'%@demo.shankhnaad.local';
   (They are made inactive rather than deleted, so nothing that points at them can break.
    Inactive people don't use a seat and don't show anywhere.)
   ===================================================================== */
