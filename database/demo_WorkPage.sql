/* =====================================================================
   demo_WorkPage.sql  —  DEMO DATA for the Work page: Decisions, Stand-up, Approvals, Roles, Visitors.
   - Uses the 10 demo people from demo_OrgChartTeam.sql (run that one first) and you (Sandy, the workspace admin).
     Change @MeName / @AnchorEmail / @WorkspaceName below if needed.
   - Dates are worked out from today (India time, UTC+05:30), so the pages always look "live":
       Decisions  : 4 decisions, 6 action items (one overdue, two done, two yours)
       Stand-up   : "Engineering daily" (Engineering) and "Daily check-in" (everyone), answers for today and yesterday,
                    one blocker; yours for today is left for you to answer
       Approvals  : 4 waiting for you (one is the 2nd step after Asha approved), 2 of your own, 2 you already decided
       Roles      : IT help desk (you are first in line), HR questions, Facilities; 5 requests (open, answered, escalated, closed)
       Visitors   : today (expected, in the building, waiting for host, left), tomorrow (expected) and yesterday (left)
   Needs scripts 46, 47, 49, 51 and 52 (or 99_ApplyAllUpdates.sql). Safe to run more than once: a part already added is skipped.
   To remove the demo records again: run the "CLEAN UP" block at the end (it is commented out).
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @AnchorEmail   NVARCHAR(256) = N'mba140924@gmail.com';
DECLARE @WorkspaceName NVARCHAR(200) = N'CloudWheel';
DECLARE @MeName        NVARCHAR(100) = N'Sandy';            -- "you" on the Work page
DECLARE @Domain        NVARCHAR(100) = N'@demo.shankhnaad.local';
DECLARE @TzMin         INT = 330;                           -- India Standard Time = UTC + 5:30

DECLARE @T UNIQUEIDENTIFIER = (SELECT TenantId FROM dbo.sahyog_Users WHERE Email = LOWER(@AnchorEmail));
IF @T IS NULL SET @T = (SELECT TOP (1) TenantId FROM dbo.sahyog_Tenants WHERE Name = @WorkspaceName);
IF @T IS NULL BEGIN RAISERROR(N'Workspace not found. Set @AnchorEmail to the email of someone in your workspace and run again.', 16, 1); RETURN; END

IF OBJECT_ID(N'dbo.sahyog_Decisions') IS NULL OR OBJECT_ID(N'dbo.sahyog_Standups') IS NULL OR OBJECT_ID(N'dbo.sahyog_Roles') IS NULL
   OR OBJECT_ID(N'dbo.sahyog_Visitors') IS NULL OR OBJECT_ID(N'dbo.sahyog_Approvals') IS NULL
BEGIN RAISERROR(N'Run the Work database scripts first (46, 47, 49, 51, 52 — or 99_ApplyAllUpdates.sql).', 16, 1); RETURN; END

/* ---------- people ---------- */
DECLARE @Me UNIQUEIDENTIFIER = (SELECT TOP (1) UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND IsActive = 1 AND DisplayName = @MeName);
IF @Me IS NULL SET @Me = (SELECT TOP (1) UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND IsActive = 1 AND Role = N'TenantAdmin' ORDER BY CreatedUtc);
DECLARE @Asha    UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND Email = N'asha'    + @Domain);
DECLARE @Rohan   UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND Email = N'rohan'   + @Domain);
DECLARE @Lakshmi UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND Email = N'lakshmi' + @Domain);
DECLARE @Vikram  UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND Email = N'vikram'  + @Domain);
DECLARE @Neha    UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND Email = N'neha'    + @Domain);
DECLARE @Kiran   UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND Email = N'kiran'   + @Domain);
DECLARE @Tom     UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND Email = N'tom'     + @Domain);
DECLARE @Priya   UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND Email = N'priya'   + @Domain);
DECLARE @Arjun   UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND Email = N'arjun'   + @Domain);
DECLARE @Meera   UNIQUEIDENTIFIER = (SELECT UserId FROM dbo.sahyog_Users WHERE TenantId = @T AND Email = N'meera'   + @Domain);
IF @Me IS NULL OR @Asha IS NULL OR @Rohan IS NULL OR @Lakshmi IS NULL OR @Vikram IS NULL OR @Neha IS NULL
   OR @Kiran IS NULL OR @Tom IS NULL OR @Priya IS NULL OR @Arjun IS NULL OR @Meera IS NULL
BEGIN RAISERROR(N'The demo people are missing. Run database/demo_OrgChartTeam.sql first, then this script.', 16, 1); RETURN; END

DECLARE @Eng UNIQUEIDENTIFIER = (SELECT TOP (1) DepartmentId FROM dbo.sahyog_Departments WHERE TenantId = @T AND Name = N'Engineering');

/* ---------- time ---------- */
DECLARE @Now   DATETIME2(3) = SYSUTCDATETIME();
DECLARE @Today DATE = CAST(DATEADD(MINUTE, @TzMin, @Now) AS DATE);
DECLARE @Yday  DATE = DATEADD(DAY, -1, @Today);
DECLARE @Tmrw  DATE = DATEADD(DAY, 1, @Today);
-- local clock time on a day → UTC
DECLARE @TodayUtc DATETIME2(3) = DATEADD(MINUTE, -@TzMin, CAST(@Today AS DATETIME2(3)));   -- today 00:00 local, in UTC
DECLARE @TmrwUtc  DATETIME2(3) = DATEADD(DAY, 1, @TodayUtc);
DECLARE @YdayUtc  DATETIME2(3) = DATEADD(DAY, -1, @TodayUtc);

BEGIN TRAN;

/* =====================================================================
   1. DECISIONS (on the register, so everyone in the workspace sees them)
   ===================================================================== */
IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Decisions WHERE TenantId = @T AND Title = N'Release 2.4 moves to 5 December' AND IsDeleted = 0)
BEGIN
    INSERT dbo.sahyog_Decisions (TenantId, Kind, Title, Details, OwnerId, DueDate, DoneUtc, DoneBy, RecordedBy, RecordedUtc) VALUES
     (@T, 'D', N'Release 2.4 moves to 5 December', N'QA needs one more week for the payment changes. Sales has told the two customers waiting for it.', NULL, NULL, NULL, NULL, @Asha, DATEADD(HOUR, -74, @Now)),
     (@T, 'D', N'Office closed on 25 December; Engineering keeps an on-call rota', N'One developer on call each day from 24 to 26 December. Vikram shares the rota.', NULL, NULL, NULL, NULL, @Me, DATEADD(HOUR, -146, @Now)),
     (@T, 'D', N'Sales CRM moves to the Pro plan from January', N'Needed for the WhatsApp follow-ups. Budget approved within the Q1 limit.', NULL, NULL, NULL, NULL, @Rohan, DATEADD(HOUR, -50, @Now)),
     (@T, 'D', N'Every intern gets a buddy from their team for the first month', N'HR pairs them on joining day; the buddy has 30 minutes a day blocked for it.', NULL, NULL, NULL, NULL, @Lakshmi, DATEADD(HOUR, -218, @Now)),
     (@T, 'A', N'Send the revised quote to Mehta Traders', N'With the 8% volume discount we agreed in the call.', @Priya, DATEADD(DAY, 2, @Today), NULL, NULL, @Rohan, DATEADD(HOUR, -26, @Now)),
     (@T, 'A', N'Fix the rounding in the invoice PDF', N'Totals are off by one paisa when there are more than 20 lines.', @Kiran, DATEADD(DAY, -1, @Today), NULL, NULL, @Asha, DATEADD(HOUR, -98, @Now)),
     (@T, 'A', N'Book the venue for the year-end town hall', N'About 40 people, half day, with lunch. Two quotes please.', @Me, DATEADD(DAY, 5, @Today), NULL, NULL, @Lakshmi, DATEADD(HOUR, -45, @Now)),
     (@T, 'A', N'Share the Q4 hiring plan with the department heads', NULL, @Me, @Tmrw, NULL, NULL, @Me, DATEADD(HOUR, -20, @Now)),
     (@T, 'A', N'Refresh the staging database every night', N'Copy of production with customer names masked.', @Neha, DATEADD(DAY, -3, @Today), DATEADD(HOUR, -30, @Now), @Neha, @Vikram, DATEADD(HOUR, -170, @Now)),
     (@T, 'A', N'Collect the laptops from the two leavers', NULL, @Lakshmi, DATEADD(DAY, -5, @Today), DATEADD(HOUR, -140, @Now), @Lakshmi, @Me, DATEADD(HOUR, -240, @Now));
END

/* =====================================================================
   2. STAND-UPS
   ===================================================================== */
IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Standups WHERE TenantId = @T AND Name IN (N'Engineering daily', N'Daily check-in'))
BEGIN
    DECLARE @S1 INT, @S2 INT;
    -- Engineering daily: Mon–Fri 10:00 (bits 0–4 = 31); LastRunDay = today so no reminders go out for today's demo
    INSERT dbo.sahyog_Standups (TenantId, Name, DepartmentId, Days, AtMinutes, Q1, Q2, Q3, IsActive, CreatedBy, CreatedUtc, LastRunDay)
    VALUES (@T, N'Engineering daily', @Eng, 31, 600, N'What did you finish since the last stand-up?', N'What are you working on today?', N'Anything blocking you?', 1, @Asha, DATEADD(DAY, -20, @Now), @Today);
    SET @S1 = SCOPE_IDENTITY();
    -- Daily check-in: everyone, every day 9:30 (127)
    INSERT dbo.sahyog_Standups (TenantId, Name, DepartmentId, Days, AtMinutes, Q1, Q2, Q3, IsActive, CreatedBy, CreatedUtc, LastRunDay)
    VALUES (@T, N'Daily check-in', NULL, 127, 570, N'Wins since yesterday?', N'Focus today?', N'Need help with anything?', 1, @Me, DATEADD(DAY, -14, @Now), @Today);
    SET @S2 = SCOPE_IDENTITY();

    -- answers (Day = the local date; answered times are on that day)
    INSERT dbo.sahyog_StandupAnswers (StandupId, UserId, Day, A1, A2, A3, HasBlocker, AnsweredUtc)
    SELECT x.S, x.U, x.D, x.A1, x.A2, x.A3, x.B, x.At FROM (VALUES
     -- Engineering daily, today
     (@S1, @Asha,   @Today, N'Reviewed the release 2.4 scope with Sales.', N'Planning the January sprint.', NULL, 0, DATEADD(MINUTE, 9 * 60 + 52, @TodayUtc)),
     (@S1, @Neha,   @Today, N'Regression tests for payments.', N'Retesting checkout on staging.', N'Waiting for the staging database refresh since yesterday.', 1, DATEADD(MINUTE, 10 * 60 + 4, @TodayUtc)),
     (@S1, @Kiran,  @Today, N'Found the cause of the invoice rounding.', N'Fixing the invoice PDF and adding a test.', NULL, 0, DATEADD(MINUTE, 10 * 60 + 11, @TodayUtc)),
     -- Engineering daily, yesterday
     (@S1, @Asha,   @Yday, N'Interviews for the backend role.', N'Release 2.4 scope review.', NULL, 0, DATEADD(MINUTE, 9 * 60 + 58, @YdayUtc)),
     (@S1, @Vikram, @Yday, N'Merged the new login flow.', N'Code reviews and the on-call rota.', NULL, 0, DATEADD(MINUTE, 10 * 60 + 2, @YdayUtc)),
     (@S1, @Neha,   @Yday, N'Test plan for payments.', N'Regression tests.', NULL, 0, DATEADD(MINUTE, 10 * 60 + 15, @YdayUtc)),
     (@S1, @Kiran,  @Yday, N'Export to Excel for reports.', N'Looking at the invoice rounding bug.', NULL, 0, DATEADD(MINUTE, 10 * 60 + 20, @YdayUtc)),
     (@S1, @Tom,    @Yday, N'Finished the onboarding tasks.', N'Writing unit tests with Kiran.', N'Need access to the test server.', 1, DATEADD(MINUTE, 10 * 60 + 40, @YdayUtc)),
     -- Daily check-in, today (yours is left for you)
     (@S2, @Rohan,   @Today, N'Mehta Traders agreed to the renewal.', N'Revised quote and two demos.', NULL, 0, DATEADD(MINUTE, 9 * 60 + 35, @TodayUtc)),
     (@S2, @Priya,   @Today, N'Closed two small orders.', N'Calling the Pune leads.', NULL, 0, DATEADD(MINUTE, 9 * 60 + 41, @TodayUtc)),
     (@S2, @Lakshmi, @Today, N'Payroll inputs sent.', N'Town hall venue and two joinings.', NULL, 0, DATEADD(MINUTE, 9 * 60 + 47, @TodayUtc)),
     (@S2, @Arjun,   @Today, N'New access cards printed.', N'Meeting room booking screens.', N'The 2nd floor door reader needs a technician.', 1, DATEADD(MINUTE, 10 * 60 + 5, @TodayUtc)),
     -- Daily check-in, yesterday
     (@S2, @Me,      @Yday, N'Closed the hiring plan draft.', N'Budget review with Rohan.', NULL, 0, DATEADD(MINUTE, 9 * 60 + 33, @YdayUtc)),
     (@S2, @Rohan,   @Yday, N'Two demos done.', N'Mehta Traders renewal call.', NULL, 0, DATEADD(MINUTE, 9 * 60 + 36, @YdayUtc)),
     (@S2, @Lakshmi, @Yday, N'Laptops collected from the leavers.', N'Payroll inputs.', NULL, 0, DATEADD(MINUTE, 9 * 60 + 50, @YdayUtc)),
     (@S2, @Meera,   @Yday, N'Month-end checks.', N'Vendor payments.', NULL, 0, DATEADD(MINUTE, 10 * 60 + 2, @YdayUtc))
    ) x(S, U, D, A1, A2, A3, B, At)
    WHERE EXISTS (SELECT 1 FROM dbo.sahyog_Standup_People(x.S) p WHERE p.UserId = x.U);   -- only people who are in that stand-up
END

/* =====================================================================
   3. ROLES  (requests live in the direct chat between the two people)
   ===================================================================== */
IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Roles WHERE TenantId = @T AND Name IN (N'IT help desk', N'HR questions', N'Facilities'))
BEGIN
    DECLARE @R1 INT, @R2 INT, @R3 INT;
    INSERT dbo.sahyog_Roles (TenantId, Name, Description, Icon, EscalateMin) VALUES (@T, N'IT help desk', N'Laptops, VPN, email and passwords', N'life-ring', 30);
    SET @R1 = SCOPE_IDENTITY();
    INSERT dbo.sahyog_Roles (TenantId, Name, Description, Icon, EscalateMin) VALUES (@T, N'HR questions', N'Leave, payroll and policies', N'users', 60);
    SET @R2 = SCOPE_IDENTITY();
    INSERT dbo.sahyog_Roles (TenantId, Name, Description, Icon, EscalateMin) VALUES (@T, N'Facilities', N'Desks, access cards and meeting rooms', N'building', 20);
    SET @R3 = SCOPE_IDENTITY();
    INSERT dbo.sahyog_RoleMembers (RoleId, UserId, Sort) VALUES
     (@R1, @Me, 0), (@R1, @Vikram, 1),
     (@R2, @Lakshmi, 0), (@R2, @Meera, 1),
     (@R3, @Arjun, 0), (@R3, @Me, 1);

    -- direct chats needed (same key format as the app: the two user ids, lower-case, sorted, "a:b")
    DECLARE @Pairs TABLE (A UNIQUEIDENTIFIER, B UNIQUEIDENTIFIER, K NVARCHAR(80), C UNIQUEIDENTIFIER NULL);
    INSERT @Pairs (A, B) VALUES (@Kiran, @Me), (@Priya, @Me), (@Me, @Lakshmi), (@Tom, @Arjun), (@Tom, @Me), (@Neha, @Arjun);
    UPDATE @Pairs SET K = CASE WHEN LOWER(CONVERT(NVARCHAR(36), A)) COLLATE Latin1_General_BIN2 < LOWER(CONVERT(NVARCHAR(36), B)) COLLATE Latin1_General_BIN2
                               THEN LOWER(CONVERT(NVARCHAR(36), A)) + N':' + LOWER(CONVERT(NVARCHAR(36), B))
                               ELSE LOWER(CONVERT(NVARCHAR(36), B)) + N':' + LOWER(CONVERT(NVARCHAR(36), A)) END;
    UPDATE p SET C = c.ChannelId FROM @Pairs p JOIN dbo.sahyog_Channels c ON c.TenantId = @T AND c.DirectKey = p.K;
    UPDATE @Pairs SET C = NEWID() WHERE C IS NULL AND K NOT IN (SELECT DirectKey FROM dbo.sahyog_Channels WHERE TenantId = @T AND DirectKey IS NOT NULL);
    INSERT dbo.sahyog_Channels (ChannelId, TenantId, Name, IsDirect, DirectKey, CreatedBy)
    SELECT p.C, @T, N'', 1, p.K, p.A FROM @Pairs p WHERE NOT EXISTS (SELECT 1 FROM dbo.sahyog_Channels c WHERE c.ChannelId = p.C);
    INSERT dbo.sahyog_ChannelMembers (ChannelId, UserId, TenantId)
    SELECT p.C, x.U, @T FROM @Pairs p CROSS APPLY (VALUES (p.A), (p.B)) x(U)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.sahyog_ChannelMembers m WHERE m.ChannelId = p.C AND m.UserId = x.U);

    DECLARE @cKiranMe UNIQUEIDENTIFIER = (SELECT C FROM @Pairs WHERE A = @Kiran AND B = @Me);
    DECLARE @cPriyaMe UNIQUEIDENTIFIER = (SELECT C FROM @Pairs WHERE A = @Priya AND B = @Me);
    DECLARE @cMeLak   UNIQUEIDENTIFIER = (SELECT C FROM @Pairs WHERE A = @Me AND B = @Lakshmi);
    DECLARE @cTomArj  UNIQUEIDENTIFIER = (SELECT C FROM @Pairs WHERE A = @Tom AND B = @Arjun);
    DECLARE @cTomMe   UNIQUEIDENTIFIER = (SELECT C FROM @Pairs WHERE A = @Tom AND B = @Me);
    DECLARE @cNehaArj UNIQUEIDENTIFIER = (SELECT C FROM @Pairs WHERE A = @Neha AND B = @Arjun);

    INSERT dbo.sahyog_RoleRequests (TenantId, RoleId, FromUserId, Body, AssignedTo, ChannelId, CreatedUtc, AnsweredUtc, EscalatedUtc, EscalatedTo, EscChannelId, ClosedUtc) VALUES
     -- open, waiting for you (the help desk escalates to Vikram after 30 minutes)
     (@T, @R1, @Kiran, N'VPN keeps disconnecting every 10 minutes since this morning.', @Me, @cKiranMe, DATEADD(MINUTE, -12, @Now), NULL, NULL, NULL, NULL, NULL),
     -- answered by you
     (@T, @R1, @Priya, N'Need an Excel licence on the new laptop, please.', @Me, @cPriyaMe, DATEADD(MINUTE, -190, @Now), DATEADD(MINUTE, -160, @Now), NULL, NULL, NULL, NULL),
     -- you asked HR, answered
     (@T, @R2, @Me, N'How many casual leaves do I have left this year?', @Lakshmi, @cMeLak, DATEADD(HOUR, -27, @Now), DATEADD(HOUR, -26, @Now), NULL, NULL, NULL, NULL),
     -- Arjun didn't answer in 20 minutes, so it came to you (2nd in line)
     (@T, @R3, @Tom, N'My access card doesn''t open the 2nd floor door.', @Arjun, @cTomArj, DATEADD(MINUTE, -125, @Now), NULL, DATEADD(MINUTE, -104, @Now), @Me, @cTomMe, NULL),
     -- closed yesterday
     (@T, @R3, @Neha, N'Can we get a standing desk near the QA corner?', @Arjun, @cNehaArj, DATEADD(HOUR, -30, @Now), DATEADD(HOUR, -29, @Now), NULL, NULL, NULL, DATEADD(HOUR, -22, @Now));
END

/* =====================================================================
   4. APPROVALS
   ===================================================================== */
IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Approvals WHERE TenantId = @T AND Title = N'Family function in Mysuru')
BEGIN
    DECLARE @A INT;
    -- waiting for you
    INSERT dbo.sahyog_Approvals (TenantId, Kind, Title, Details, Amount, FromDate, ToDate, RequesterId, Status, Step, CreatedUtc)
    VALUES (@T, 'leave', N'Family function in Mysuru', N'Back on Monday. Neha covers my reviews.', NULL, DATEADD(DAY, 7, @Today), DATEADD(DAY, 9, @Today), @Kiran, 'pending', 1, DATEADD(MINUTE, -65, @Now));
    SET @A = SCOPE_IDENTITY(); INSERT dbo.sahyog_ApprovalSteps (ApprovalId, Step, ApproverId) VALUES (@A, 1, @Me);

    INSERT dbo.sahyog_Approvals (TenantId, Kind, Title, Details, Amount, FromDate, ToDate, RequesterId, Status, Step, CreatedUtc)
    VALUES (@T, 'expense', N'Client visit: cab and lunch', N'Mehta Traders, Bengaluru. Bills attached in chat.', 4850, NULL, NULL, @Priya, 'pending', 1, DATEADD(MINUTE, -300, @Now));
    SET @A = SCOPE_IDENTITY(); INSERT dbo.sahyog_ApprovalSteps (ApprovalId, Step, ApproverId) VALUES (@A, 1, @Me);

    INSERT dbo.sahyog_Approvals (TenantId, Kind, Title, Details, Amount, FromDate, ToDate, RequesterId, Status, Step, CreatedUtc)
    VALUES (@T, 'purchase', N'Second monitor for QA', N'27-inch, for side-by-side test runs.', 14500, NULL, NULL, @Neha, 'pending', 1, DATEADD(HOUR, -22, @Now));
    SET @A = SCOPE_IDENTITY(); INSERT dbo.sahyog_ApprovalSteps (ApprovalId, Step, ApproverId) VALUES (@A, 1, @Me);

    -- 2 steps: Asha approved, now yours
    INSERT dbo.sahyog_Approvals (TenantId, Kind, Title, Details, Amount, FromDate, ToDate, RequesterId, Status, Step, CreatedUtc)
    VALUES (@T, 'purchase', N'Load-testing tool, yearly licence', N'For the release 2.4 performance tests and after.', 68000, NULL, NULL, @Vikram, 'pending', 2, DATEADD(HOUR, -28, @Now));
    SET @A = SCOPE_IDENTITY();
    INSERT dbo.sahyog_ApprovalSteps (ApprovalId, Step, ApproverId, Decision, Note, DecidedUtc) VALUES
     (@A, 1, @Asha, 'approved', N'Needed for 2.4.', DATEADD(HOUR, -6, @Now)), (@A, 2, @Me, NULL, NULL, NULL);

    -- your own
    INSERT dbo.sahyog_Approvals (TenantId, Kind, Title, Details, Amount, FromDate, ToDate, RequesterId, Status, Step, CreatedUtc)
    VALUES (@T, 'leave', N'Two days off for Pongal', NULL, NULL, DATEADD(DAY, 48, @Today), DATEADD(DAY, 49, @Today), @Me, 'pending', 1, DATEADD(HOUR, -3, @Now));
    SET @A = SCOPE_IDENTITY(); INSERT dbo.sahyog_ApprovalSteps (ApprovalId, Step, ApproverId) VALUES (@A, 1, @Asha);

    INSERT dbo.sahyog_Approvals (TenantId, Kind, Title, Details, Amount, FromDate, ToDate, RequesterId, Status, Step, CreatedUtc, DecidedUtc)
    VALUES (@T, 'expense', N'Team lunch after the release', N'12 people.', 6200, NULL, NULL, @Me, 'approved', 1, DATEADD(HOUR, -60, @Now), DATEADD(HOUR, -52, @Now));
    SET @A = SCOPE_IDENTITY(); INSERT dbo.sahyog_ApprovalSteps (ApprovalId, Step, ApproverId, Decision, Note, DecidedUtc) VALUES (@A, 1, @Asha, 'approved', N'Enjoy!', DATEADD(HOUR, -52, @Now));

    -- decided by you
    INSERT dbo.sahyog_Approvals (TenantId, Kind, Title, Details, Amount, FromDate, ToDate, RequesterId, Status, Step, CreatedUtc, DecidedUtc)
    VALUES (@T, 'other', N'Work from home on Fridays during exams', N'Till 20 December.', NULL, NULL, NULL, @Tom, 'approved', 1, DATEADD(HOUR, -80, @Now), DATEADD(HOUR, -75, @Now));
    SET @A = SCOPE_IDENTITY(); INSERT dbo.sahyog_ApprovalSteps (ApprovalId, Step, ApproverId, Decision, Note, DecidedUtc) VALUES (@A, 1, @Me, 'approved', N'All the best for the exams.', DATEADD(HOUR, -75, @Now));

    INSERT dbo.sahyog_Approvals (TenantId, Kind, Title, Details, Amount, FromDate, ToDate, RequesterId, Status, Step, CreatedUtc, DecidedUtc)
    VALUES (@T, 'expense', N'Conference ticket: DevSummit Bengaluru', NULL, 22000, NULL, NULL, @Arjun, 'rejected', 1, DATEADD(HOUR, -100, @Now), DATEADD(HOUR, -96, @Now));
    SET @A = SCOPE_IDENTITY(); INSERT dbo.sahyog_ApprovalSteps (ApprovalId, Step, ApproverId, Decision, Note, DecidedUtc) VALUES (@A, 1, @Me, 'rejected', N'Not this quarter, sorry. Let''s plan it for April.', DATEADD(HOUR, -96, @Now));
END

/* =====================================================================
   5. VISITORS  (demo phone numbers start with +91 90000)
   ===================================================================== */
IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Visitors WHERE TenantId = @T AND Phone LIKE N'+91 90000%')
BEGIN
    INSERT dbo.sahyog_Visitors (TenantId, Name, Phone, Company, Purpose, HostId, ExpectedUtc, ArrivedUtc, LeftUtc, HostReply, HostReplyUtc, CreatedBy, CreatedUtc) VALUES
     -- today
     (@T, N'Ravi Kumar',        N'+91 90000 11001', N'Mehta Traders', N'Quarterly review',   @Me,      DATEADD(MINUTE, 120, @Now), NULL, NULL, NULL, NULL, @Me, DATEADD(HOUR, -20, @Now)),
     (@T, N'Anita Desai',       N'+91 90000 11002', N'Desai & Co',    N'Interview',          @Asha,    DATEADD(MINUTE, -60, @Now), DATEADD(MINUTE, -50, @Now), NULL, N'coming', DATEADD(MINUTE, -48, @Now), @Lakshmi, DATEADD(HOUR, -26, @Now)),
     (@T, N'Suresh Patil',      N'+91 90000 11003', N'Patil Electricals', N'Door reader repair, 2nd floor', @Arjun, NULL, DATEADD(MINUTE, -14, @Now), NULL, NULL, NULL, NULL, DATEADD(MINUTE, -14, @Now)),
     (@T, N'Courier (BlueDart)', N'+91 90000 11004', NULL,           N'Delivery',           @Rohan,   NULL, DATEADD(MINUTE, -230, @Now), DATEADD(MINUTE, -220, @Now), N'coming', DATEADD(MINUTE, -228, @Now), NULL, DATEADD(MINUTE, -230, @Now)),
     (@T, N'Farah Khan',        N'+91 90000 11005', N'Zen Software',  N'Partnership demo',   @Rohan,   DATEADD(MINUTE, -200, @Now), DATEADD(MINUTE, -195, @Now), DATEADD(MINUTE, -110, @Now), N'coming', DATEADD(MINUTE, -193, @Now), @Rohan, DATEADD(HOUR, -48, @Now)),
     -- tomorrow
     (@T, N'Meenakshi Rao',     N'+91 90000 11006', N'KPMG',          N'Audit walk-through', @Me,      DATEADD(MINUTE, 11 * 60, @TmrwUtc), NULL, NULL, NULL, NULL, @Me, DATEADD(HOUR, -5, @Now)),
     (@T, N'Deepak Shetty',     N'+91 90000 11007', N'Shetty Interiors', N'Measure the new meeting room', @Arjun, DATEADD(MINUTE, 15 * 60 + 30, @TmrwUtc), NULL, NULL, NULL, NULL, @Arjun, DATEADD(HOUR, -3, @Now)),
     -- yesterday
     (@T, N'Harish Menon',      N'+91 90000 11008', N'Menon Logistics', N'Contract signing',  @Rohan,   DATEADD(MINUTE, 11 * 60, @YdayUtc), DATEADD(MINUTE, 11 * 60 + 5, @YdayUtc), DATEADD(MINUTE, 12 * 60 + 20, @YdayUtc), N'coming', DATEADD(MINUTE, 11 * 60 + 6, @YdayUtc), @Rohan, DATEADD(DAY, -3, @Now)),
     (@T, N'Sneha Kulkarni',    N'+91 90000 11009', NULL,             N'Interview',          @Vikram,  DATEADD(MINUTE, 15 * 60, @YdayUtc), DATEADD(MINUTE, 14 * 60 + 52, @YdayUtc), DATEADD(MINUTE, 16 * 60 + 10, @YdayUtc), N'wait', DATEADD(MINUTE, 14 * 60 + 54, @YdayUtc), @Lakshmi, DATEADD(DAY, -2, @Now));
END

COMMIT;

/* ---------- what was added ---------- */
SELECT N'Decisions' AS [Work tab], COUNT(*) AS Records FROM dbo.sahyog_Decisions WHERE TenantId = @T AND IsDeleted = 0
UNION ALL SELECT N'Stand-ups', COUNT(*) FROM dbo.sahyog_Standups WHERE TenantId = @T
UNION ALL SELECT N'Stand-up answers', COUNT(*) FROM dbo.sahyog_StandupAnswers a JOIN dbo.sahyog_Standups s ON s.StandupId = a.StandupId WHERE s.TenantId = @T
UNION ALL SELECT N'Approvals', COUNT(*) FROM dbo.sahyog_Approvals WHERE TenantId = @T
UNION ALL SELECT N'Roles', COUNT(*) FROM dbo.sahyog_Roles WHERE TenantId = @T
UNION ALL SELECT N'Role requests', COUNT(*) FROM dbo.sahyog_RoleRequests WHERE TenantId = @T
UNION ALL SELECT N'Visitors', COUNT(*) FROM dbo.sahyog_Visitors WHERE TenantId = @T;
GO

/* =====================================================================
   CLEAN UP — removes the Work demo records again (select these lines and run them).
   Change @WorkspaceName if yours is different.
   =====================================================================
DECLARE @T UNIQUEIDENTIFIER = (SELECT TOP (1) TenantId FROM dbo.sahyog_Tenants WHERE Name = N'CloudWheel');
DELETE dbo.sahyog_Decisions WHERE TenantId = @T AND Title IN (
    N'Release 2.4 moves to 5 December', N'Office closed on 25 December; Engineering keeps an on-call rota', N'Sales CRM moves to the Pro plan from January',
    N'Every intern gets a buddy from their team for the first month', N'Send the revised quote to Mehta Traders', N'Fix the rounding in the invoice PDF',
    N'Book the venue for the year-end town hall', N'Share the Q4 hiring plan with the department heads', N'Refresh the staging database every night',
    N'Collect the laptops from the two leavers');
DELETE dbo.sahyog_Standups WHERE TenantId = @T AND Name IN (N'Engineering daily', N'Daily check-in');                -- answers go with them
DELETE dbo.sahyog_Roles WHERE TenantId = @T AND Name IN (N'IT help desk', N'HR questions', N'Facilities');           -- members and requests go with them
DELETE dbo.sahyog_Approvals WHERE TenantId = @T AND Title IN (
    N'Family function in Mysuru', N'Client visit: cab and lunch', N'Second monitor for QA', N'Load-testing tool, yearly licence',
    N'Two days off for Pongal', N'Team lunch after the release', N'Work from home on Fridays during exams', N'Conference ticket: DevSummit Bengaluru');   -- steps go with them
DELETE dbo.sahyog_Visitors WHERE TenantId = @T AND Phone LIKE N'+91 90000%';
*/
