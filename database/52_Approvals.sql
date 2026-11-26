/* =====================================================================
   ShankhNaad round 52 (safe to run more than once; needs 01–02 and 40_OrgStructure.sql):
     Approvals in chat. Leave, expense, purchase and other requests go up the reporting line
     (the manager; big amounts also to the manager's manager). Approvers press Approve or Reject on the
     card in their chat; approved leave turns on out of office for those days.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_Approvals', N'U') IS NULL
CREATE TABLE dbo.sahyog_Approvals
(
    ApprovalId   INT              IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Approvals PRIMARY KEY,
    TenantId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Approvals_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    Kind         VARCHAR(10)      NOT NULL,          -- leave | expense | purchase | other
    Title        NVARCHAR(150)    NOT NULL,
    Details      NVARCHAR(1000)   NULL,
    Amount       DECIMAL(14,2)    NULL,
    FromDate     DATE             NULL,
    ToDate       DATE             NULL,
    RequesterId  UNIQUEIDENTIFIER NOT NULL,
    Status       VARCHAR(10)      NOT NULL CONSTRAINT DF_sahyog_Approvals_Status DEFAULT ('pending'),   -- pending | approved | rejected | cancelled
    Step         INT              NOT NULL CONSTRAINT DF_sahyog_Approvals_Step DEFAULT (1),
    CreatedUtc   DATETIME2(3)     NOT NULL CONSTRAINT DF_sahyog_Approvals_Created DEFAULT (SYSUTCDATETIME()),
    DecidedUtc   DATETIME2(3)     NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Approvals_Requester')
    CREATE INDEX IX_sahyog_Approvals_Requester ON dbo.sahyog_Approvals(TenantId, RequesterId, CreatedUtc DESC);
GO
IF OBJECT_ID(N'dbo.sahyog_ApprovalSteps', N'U') IS NULL
CREATE TABLE dbo.sahyog_ApprovalSteps
(
    ApprovalId  INT              NOT NULL CONSTRAINT FK_sahyog_ApprovalSteps_Approvals REFERENCES dbo.sahyog_Approvals(ApprovalId) ON DELETE CASCADE,
    Step        INT              NOT NULL,
    ApproverId  UNIQUEIDENTIFIER NOT NULL,
    Decision    VARCHAR(10)      NULL,               -- approved | rejected
    Note        NVARCHAR(300)    NULL,
    DecidedUtc  DATETIME2(3)     NULL,
    ChannelId   UNIQUEIDENTIFIER NULL,               -- the chat the card was posted in
    MessageId   BIGINT           NULL,
    CONSTRAINT PK_sahyog_ApprovalSteps PRIMARY KEY (ApprovalId, Step)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_ApprovalSteps_Approver')
    CREATE INDEX IX_sahyog_ApprovalSteps_Approver ON dbo.sahyog_ApprovalSteps(ApproverId);
GO
IF OBJECT_ID(N'dbo.sahyog_ApprovalRules', N'U') IS NULL
CREATE TABLE dbo.sahyog_ApprovalRules
(
    TenantId          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_ApprovalRules PRIMARY KEY
                      CONSTRAINT FK_sahyog_ApprovalRules_Tenants REFERENCES dbo.sahyog_Tenants(TenantId) ON DELETE CASCADE,
    SecondLevelAmount DECIMAL(14,2)    NULL,         -- expenses / purchases from this amount also go to the manager's manager
    FallbackApprover  UNIQUEIDENTIFIER NULL,         -- for people with no manager
    Currency          NVARCHAR(8)      NOT NULL CONSTRAINT DF_sahyog_ApprovalRules_Cur DEFAULT (NCHAR(8377))
);
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_ApprovalRules_Get
    @TenantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT ISNULL(r.SecondLevelAmount, 50000) AS SecondLevelAmount, r.FallbackApprover, u.DisplayName AS FallbackName, ISNULL(r.Currency, NCHAR(8377)) AS Currency
    FROM (SELECT @TenantId AS TenantId) t
    LEFT JOIN dbo.sahyog_ApprovalRules r ON r.TenantId = t.TenantId
    LEFT JOIN dbo.sahyog_Users u ON u.UserId = r.FallbackApprover;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_ApprovalRules_Save
    @TenantId UNIQUEIDENTIFIER, @SecondLevelAmount DECIMAL(14,2) = NULL, @FallbackApprover UNIQUEIDENTIFIER = NULL, @Currency NVARCHAR(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @Currency = ISNULL(NULLIF(@Currency, N''), NCHAR(8377));
    IF @FallbackApprover IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.sahyog_Users WHERE UserId = @FallbackApprover AND TenantId = @TenantId)
        SET @FallbackApprover = NULL;
    IF EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalRules WHERE TenantId = @TenantId)
        UPDATE dbo.sahyog_ApprovalRules SET SecondLevelAmount = @SecondLevelAmount, FallbackApprover = @FallbackApprover, Currency = @Currency WHERE TenantId = @TenantId;
    ELSE
        INSERT dbo.sahyog_ApprovalRules (TenantId, SecondLevelAmount, FallbackApprover, Currency) VALUES (@TenantId, @SecondLevelAmount, @FallbackApprover, @Currency);
    EXEC dbo.sahyog_ApprovalRules_Get @TenantId = @TenantId;
END
GO

/* @Approvers = a JSON array of ids in order (step 1, step 2): ["id","id"] */
CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_Create
    @TenantId UNIQUEIDENTIFIER, @RequesterId UNIQUEIDENTIFIER, @Kind VARCHAR(10), @Title NVARCHAR(150), @Details NVARCHAR(1000) = NULL,
    @Amount DECIMAL(14,2) = NULL, @FromDate DATE = NULL, @ToDate DATE = NULL, @Approvers NVARCHAR(400)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;
    INSERT dbo.sahyog_Approvals (TenantId, Kind, Title, Details, Amount, FromDate, ToDate, RequesterId)
    VALUES (@TenantId, @Kind, @Title, @Details, @Amount, @FromDate, @ToDate, @RequesterId);
    DECLARE @id INT = CAST(SCOPE_IDENTITY() AS INT);
    INSERT dbo.sahyog_ApprovalSteps (ApprovalId, Step, ApproverId)
    SELECT @id, CAST(x.[key] AS INT) + 1, u.UserId
    FROM OPENJSON(@Approvers) x
    JOIN dbo.sahyog_Users u ON u.UserId = TRY_CAST(x.[value] AS UNIQUEIDENTIFIER) AND u.TenantId = @TenantId;
    IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalSteps WHERE ApprovalId = @id)
    BEGIN ROLLBACK; SELECT CAST(0 AS INT) AS ApprovalId; RETURN; END;
    -- steps numbered 1, 2 … even if a name was skipped
    ;WITH s AS (SELECT Step, ROW_NUMBER() OVER (ORDER BY Step) AS n FROM dbo.sahyog_ApprovalSteps WHERE ApprovalId = @id)
    UPDATE s SET Step = n WHERE Step <> n;
    COMMIT;
    SELECT @id AS ApprovalId;
END
GO

/* the request, then its steps. Empty when this person may not see it (requester, an approver, or an admin: @IsAdmin) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_Get
    @TenantId UNIQUEIDENTIFIER, @ApprovalId INT, @UserId UNIQUEIDENTIFIER, @IsAdmin BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT a.ApprovalId, a.Kind, a.Title, a.Details, a.Amount, a.FromDate, a.ToDate, a.RequesterId, r.DisplayName AS RequesterName,
           r.AvatarTone AS RequesterTone, a.Status, a.Step, a.CreatedUtc, a.DecidedUtc,
           (SELECT ApproverId FROM dbo.sahyog_ApprovalSteps s WHERE s.ApprovalId = a.ApprovalId AND s.Step = a.Step) AS CurrentApproverId
    FROM dbo.sahyog_Approvals a
    JOIN dbo.sahyog_Users r ON r.UserId = a.RequesterId
    WHERE a.ApprovalId = @ApprovalId AND a.TenantId = @TenantId
      AND (@IsAdmin = 1 OR a.RequesterId = @UserId OR EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalSteps s WHERE s.ApprovalId = a.ApprovalId AND s.ApproverId = @UserId));

    SELECT s.Step, s.ApproverId, u.DisplayName AS ApproverName, u.AvatarTone AS ApproverTone, u.JobTitle AS ApproverTitle,
           s.Decision, s.Note, s.DecidedUtc, s.ChannelId, s.MessageId
    FROM dbo.sahyog_ApprovalSteps s
    JOIN dbo.sahyog_Approvals a ON a.ApprovalId = s.ApprovalId AND a.TenantId = @TenantId
    JOIN dbo.sahyog_Users u ON u.UserId = s.ApproverId
    WHERE s.ApprovalId = @ApprovalId
      AND (@IsAdmin = 1 OR a.RequesterId = @UserId OR EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalSteps x WHERE x.ApprovalId = a.ApprovalId AND x.ApproverId = @UserId))
    ORDER BY s.Step;
END
GO

/* @Box: mine (I asked) | todo (waiting for me now) | done (I decided) | all (admins) */
CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_List
    @TenantId UNIQUEIDENTIFIER, @UserId UNIQUEIDENTIFIER, @Box VARCHAR(10), @IsAdmin BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (300) a.ApprovalId, a.Kind, a.Title, a.Details, a.Amount, a.FromDate, a.ToDate, a.RequesterId, r.DisplayName AS RequesterName,
           r.AvatarTone AS RequesterTone, a.Status, a.Step, a.CreatedUtc, a.DecidedUtc,
           cur.ApproverId AS CurrentApproverId, cu.DisplayName AS CurrentApproverName,
           (SELECT COUNT(*) FROM dbo.sahyog_ApprovalSteps s WHERE s.ApprovalId = a.ApprovalId) AS Steps
    FROM dbo.sahyog_Approvals a
    JOIN dbo.sahyog_Users r ON r.UserId = a.RequesterId
    LEFT JOIN dbo.sahyog_ApprovalSteps cur ON cur.ApprovalId = a.ApprovalId AND cur.Step = a.Step
    LEFT JOIN dbo.sahyog_Users cu ON cu.UserId = cur.ApproverId
    WHERE a.TenantId = @TenantId
      AND (   (@Box = 'mine' AND a.RequesterId = @UserId)
           OR (@Box = 'todo' AND a.Status = 'pending' AND cur.ApproverId = @UserId)
           OR (@Box = 'done' AND EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalSteps s WHERE s.ApprovalId = a.ApprovalId AND s.ApproverId = @UserId AND s.Decision IS NOT NULL))
           OR (@Box = 'all' AND @IsAdmin = 1))
    ORDER BY CASE WHEN a.Status = 'pending' THEN 0 ELSE 1 END, a.CreatedUtc DESC;
END
GO

/* the approver of the current step decides. Returns the new status and, when approved with more steps, the next approver. */
CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_Decide
    @TenantId UNIQUEIDENTIFIER, @ApprovalId INT, @UserId UNIQUEIDENTIFIER, @Decision VARCHAR(10), @Note NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;
    DECLARE @step INT, @status VARCHAR(10);
    SELECT @step = a.Step, @status = a.Status FROM dbo.sahyog_Approvals a WITH (UPDLOCK)
    WHERE a.ApprovalId = @ApprovalId AND a.TenantId = @TenantId;
    IF @status IS NULL OR @status <> 'pending'
       OR NOT EXISTS (SELECT 1 FROM dbo.sahyog_ApprovalSteps WHERE ApprovalId = @ApprovalId AND Step = @step AND ApproverId = @UserId)
    BEGIN ROLLBACK; SELECT CAST(0 AS BIT) AS Ok, @status AS Status, CAST(NULL AS UNIQUEIDENTIFIER) AS NextApproverId; RETURN; END;

    UPDATE dbo.sahyog_ApprovalSteps SET Decision = @Decision, Note = @Note, DecidedUtc = SYSUTCDATETIME()
    WHERE ApprovalId = @ApprovalId AND Step = @step;

    DECLARE @next UNIQUEIDENTIFIER = (SELECT ApproverId FROM dbo.sahyog_ApprovalSteps WHERE ApprovalId = @ApprovalId AND Step = @step + 1);
    IF @Decision = 'rejected'
        UPDATE dbo.sahyog_Approvals SET Status = 'rejected', DecidedUtc = SYSUTCDATETIME() WHERE ApprovalId = @ApprovalId;
    ELSE IF @next IS NOT NULL
        UPDATE dbo.sahyog_Approvals SET Step = @step + 1 WHERE ApprovalId = @ApprovalId;
    ELSE
        UPDATE dbo.sahyog_Approvals SET Status = 'approved', DecidedUtc = SYSUTCDATETIME() WHERE ApprovalId = @ApprovalId;
    COMMIT;
    SELECT CAST(1 AS BIT) AS Ok, Status, CASE WHEN @Decision = 'approved' THEN @next END AS NextApproverId
    FROM dbo.sahyog_Approvals WHERE ApprovalId = @ApprovalId;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_Cancel
    @TenantId UNIQUEIDENTIFIER, @ApprovalId INT, @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_Approvals SET Status = 'cancelled', DecidedUtc = SYSUTCDATETIME()
    WHERE ApprovalId = @ApprovalId AND TenantId = @TenantId AND RequesterId = @UserId AND Status = 'pending';
    SELECT @@ROWCOUNT AS Changed;
END
GO

CREATE OR ALTER PROCEDURE dbo.sahyog_Approval_SetMessage
    @ApprovalId INT, @Step INT, @ChannelId UNIQUEIDENTIFIER, @MessageId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.sahyog_ApprovalSteps SET ChannelId = @ChannelId, MessageId = @MessageId WHERE ApprovalId = @ApprovalId AND Step = @Step;
END
GO

PRINT N'52_Approvals.sql: approvals ready.';
GO
