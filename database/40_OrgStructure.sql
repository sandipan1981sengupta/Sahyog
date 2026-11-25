/* =====================================================================
   40_OrgStructure.sql  —  Organization structure (Org page)
   - Departments per workspace (name, head)
   - Each person: job title, department, manager (reports to), phone,
     employee ID, joined date
   Safe to run more than once.
   ===================================================================== */
SET NOCOUNT ON;
GO

/* ---------- departments ---------- */
IF OBJECT_ID(N'dbo.sahyog_Departments', N'U') IS NULL
CREATE TABLE dbo.sahyog_Departments
(
    DepartmentId    UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_Departments PRIMARY KEY,
    TenantId        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Departments_Tenants REFERENCES dbo.sahyog_Tenants(TenantId),
    Name            NVARCHAR(100)    NOT NULL,
    HeadUserId      UNIQUEIDENTIFIER NULL,
    ParentId        UNIQUEIDENTIFIER NULL,
    CreatedUtc      DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Departments_Created DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_sahyog_Departments_Name')
    CREATE UNIQUE INDEX UX_sahyog_Departments_Name ON dbo.sahyog_Departments(TenantId, Name);
GO

/* ---------- org fields on people ---------- */
IF COL_LENGTH(N'dbo.sahyog_Users', N'JobTitle') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD JobTitle NVARCHAR(100) NULL;
IF COL_LENGTH(N'dbo.sahyog_Users', N'DepartmentId') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD DepartmentId UNIQUEIDENTIFIER NULL;
IF COL_LENGTH(N'dbo.sahyog_Users', N'ManagerId') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD ManagerId UNIQUEIDENTIFIER NULL;
IF COL_LENGTH(N'dbo.sahyog_Users', N'Phone') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD Phone NVARCHAR(40) NULL;
IF COL_LENGTH(N'dbo.sahyog_Users', N'EmployeeCode') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD EmployeeCode NVARCHAR(40) NULL;
IF COL_LENGTH(N'dbo.sahyog_Users', N'JoinedOn') IS NULL
    ALTER TABLE dbo.sahyog_Users ADD JoinedOn DATE NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Users_Manager')
    CREATE INDEX IX_sahyog_Users_Manager ON dbo.sahyog_Users(TenantId, ManagerId);
GO

/* ---------- everyone active in the workspace, with their org fields ---------- */
CREATE OR ALTER PROCEDURE dbo.sahyog_Org_ListPeople
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.UserId, u.DisplayName, u.Email, u.Role, u.AvatarTone,
           u.JobTitle, u.DepartmentId, d.Name AS DepartmentName,
           -- a manager who left (inactive) no longer counts
           CASE WHEN m.IsActive = 1 THEN u.ManagerId END AS ManagerId,
           u.Phone, u.EmployeeCode, u.JoinedOn
    FROM dbo.sahyog_Users u
    LEFT JOIN dbo.sahyog_Departments d ON d.DepartmentId = u.DepartmentId AND d.TenantId = u.TenantId
    LEFT JOIN dbo.sahyog_Users m ON m.UserId = u.ManagerId AND m.TenantId = u.TenantId
    WHERE u.TenantId = @TenantId AND u.IsActive = 1
    ORDER BY u.DisplayName;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Org_ListDepartments
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT d.DepartmentId, d.Name, d.HeadUserId, h.DisplayName AS HeadName,
           (SELECT COUNT(*) FROM dbo.sahyog_Users u WHERE u.TenantId = d.TenantId AND u.DepartmentId = d.DepartmentId AND u.IsActive = 1) AS People
    FROM dbo.sahyog_Departments d
    LEFT JOIN dbo.sahyog_Users h ON h.UserId = d.HeadUserId AND h.TenantId = d.TenantId AND h.IsActive = 1
    WHERE d.TenantId = @TenantId
    ORDER BY d.Name;
END
GO

/* Create (DepartmentId NULL) or rename / change head.
   Result: 0 saved, 1 that name is taken, 2 not found, 3 head isn't in this workspace, 4 name empty */
CREATE OR ALTER PROCEDURE dbo.sahyog_Org_SaveDepartment
    @TenantId     UNIQUEIDENTIFIER,
    @DepartmentId UNIQUEIDENTIFIER = NULL,
    @Name         NVARCHAR(100),
    @HeadUserId   UNIQUEIDENTIFIER = NULL,
    @Result       INT OUTPUT,
    @NewId        UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Name = LTRIM(RTRIM(ISNULL(@Name, N'')));
    SET @NewId = @DepartmentId;
    IF @Name = N'' BEGIN SET @Result = 4; RETURN; END
    IF @HeadUserId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @HeadUserId AND TenantId = @TenantId AND IsActive = 1)
        BEGIN SET @Result = 3; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.sahyog_Departments WHERE TenantId = @TenantId AND Name = @Name
               AND (@DepartmentId IS NULL OR DepartmentId <> @DepartmentId))
        BEGIN SET @Result = 1; RETURN; END

    IF @DepartmentId IS NULL
    BEGIN
        SET @NewId = NEWID();
        INSERT dbo.sahyog_Departments (DepartmentId, TenantId, Name, HeadUserId) VALUES (@NewId, @TenantId, @Name, @HeadUserId);
    END
    ELSE
    BEGIN
        UPDATE dbo.sahyog_Departments SET Name = @Name, HeadUserId = @HeadUserId
        WHERE DepartmentId = @DepartmentId AND TenantId = @TenantId;
        IF @@ROWCOUNT = 0 BEGIN SET @Result = 2; RETURN; END
    END
    -- the head belongs to the department
    IF @HeadUserId IS NOT NULL
        UPDATE dbo.sahyog_Users SET DepartmentId = @NewId WHERE UserId = @HeadUserId AND TenantId = @TenantId AND DepartmentId IS NULL;
    SET @Result = 0;
END
GO

/* Deletes a department. Its people stay, without a department. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Org_DeleteDepartment
    @TenantId     UNIQUEIDENTIFIER,
    @DepartmentId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRAN;
        UPDATE dbo.sahyog_Users SET DepartmentId = NULL WHERE TenantId = @TenantId AND DepartmentId = @DepartmentId;
        UPDATE dbo.sahyog_Departments SET ParentId = NULL WHERE TenantId = @TenantId AND ParentId = @DepartmentId;
        DELETE dbo.sahyog_Departments WHERE TenantId = @TenantId AND DepartmentId = @DepartmentId;
    COMMIT;
END
GO

/* Finds a department by name, creating it when it doesn't exist yet (CSV import). */
CREATE OR ALTER PROCEDURE dbo.sahyog_Org_EnsureDepartment
    @TenantId     UNIQUEIDENTIFIER,
    @Name         NVARCHAR(100),
    @DepartmentId UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Name = LTRIM(RTRIM(ISNULL(@Name, N'')));
    SET @DepartmentId = NULL;
    IF @Name = N'' RETURN;
    SELECT @DepartmentId = DepartmentId FROM dbo.sahyog_Departments WHERE TenantId = @TenantId AND Name = @Name;
    IF @DepartmentId IS NULL
    BEGIN
        SET @DepartmentId = NEWID();
        BEGIN TRY
            INSERT dbo.sahyog_Departments (DepartmentId, TenantId, Name) VALUES (@DepartmentId, @TenantId, @Name);
        END TRY
        BEGIN CATCH   -- created at the same moment by someone else
            SELECT @DepartmentId = DepartmentId FROM dbo.sahyog_Departments WHERE TenantId = @TenantId AND Name = @Name;
        END CATCH
    END
END
GO

/* Sets a person's org fields.
   Result: 0 saved, 1 person not found, 2 can't report to themselves,
           3 would make a loop (the manager reports to this person),
           4 manager isn't in this workspace, 5 department isn't in this workspace */
CREATE OR ALTER PROCEDURE dbo.sahyog_Org_SetPerson
    @TenantId     UNIQUEIDENTIFIER,
    @UserId       UNIQUEIDENTIFIER,
    @JobTitle     NVARCHAR(100) = NULL,
    @DepartmentId UNIQUEIDENTIFIER = NULL,
    @ManagerId    UNIQUEIDENTIFIER = NULL,
    @Phone        NVARCHAR(40) = NULL,
    @EmployeeCode NVARCHAR(40) = NULL,
    @JoinedOn     DATE = NULL,
    @Result       INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @UserId AND TenantId = @TenantId)
        BEGIN SET @Result = 1; RETURN; END
    IF @ManagerId = @UserId BEGIN SET @Result = 2; RETURN; END
    IF @ManagerId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @ManagerId AND TenantId = @TenantId AND IsActive = 1)
        BEGIN SET @Result = 4; RETURN; END
    IF @DepartmentId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Departments WHERE DepartmentId = @DepartmentId AND TenantId = @TenantId)
        BEGIN SET @Result = 5; RETURN; END

    -- walk up from the new manager: if we reach this person, it would loop
    DECLARE @Loop INT = 0;
    IF @ManagerId IS NOT NULL
    BEGIN
        ;WITH up AS (
            SELECT UserId, ManagerId, 1 AS Depth FROM dbo.sahyog_Users WHERE UserId = @ManagerId AND TenantId = @TenantId
            UNION ALL
            SELECT u.UserId, u.ManagerId, up.Depth + 1
            FROM dbo.sahyog_Users u JOIN up ON u.UserId = up.ManagerId
            WHERE u.TenantId = @TenantId AND up.Depth < 100
        )
        SELECT @Loop = COUNT(*) FROM up WHERE UserId = @UserId OR ManagerId = @UserId
        OPTION (MAXRECURSION 200);
        IF @Loop > 0 BEGIN SET @Result = 3; RETURN; END
    END

    UPDATE dbo.sahyog_Users
    SET JobTitle     = NULLIF(LTRIM(RTRIM(@JobTitle)), N''),
        DepartmentId = @DepartmentId,
        ManagerId    = @ManagerId,
        Phone        = NULLIF(LTRIM(RTRIM(@Phone)), N''),
        EmployeeCode = NULLIF(LTRIM(RTRIM(@EmployeeCode)), N''),
        JoinedOn     = @JoinedOn
    WHERE UserId = @UserId AND TenantId = @TenantId;
    SET @Result = 0;
END
GO
