/* =====================================================================
   Sahyog by CloudWheel Ltd · 01_Tables.sql
   Creates all tables, indexes and table types. Safe to run more than once.
   Run in SSMS / Azure Data Studio against your Sahyog database.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------- Plans: Small / Medium / Large ---------- */
IF OBJECT_ID(N'dbo.sahyog_Plans', N'U') IS NULL
CREATE TABLE dbo.sahyog_Plans
(
    PlanId                  INT             IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Plans PRIMARY KEY,
    Name                    NVARCHAR(50)    NOT NULL CONSTRAINT UX_sahyog_Plans_Name UNIQUE,
    MaxUsers                INT             NOT NULL,
    MaxMeetingParticipants  INT             NOT NULL,
    StorageQuotaMb          BIGINT          NOT NULL,
    MaxVideoHeight          INT             NOT NULL CONSTRAINT DF_sahyog_Plans_MaxVideoHeight DEFAULT (720),
    RecordingEnabled        BIT             NOT NULL CONSTRAINT DF_sahyog_Plans_Recording DEFAULT (0),
    MaxMeetingMinutes       INT             NOT NULL CONSTRAINT DF_sahyog_Plans_MaxMinutes DEFAULT (60),
    VideoProvider           NVARCHAR(30)    NOT NULL CONSTRAINT DF_sahyog_Plans_Provider DEFAULT (N'JaaS')
);
GO

/* ---------- Tenants: one row per client company ---------- */
IF OBJECT_ID(N'dbo.sahyog_Tenants', N'U') IS NULL
CREATE TABLE dbo.sahyog_Tenants
(
    TenantId                UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_Tenants PRIMARY KEY,
    Name                    NVARCHAR(120)   NOT NULL,
    Slug                    NVARCHAR(40)    NOT NULL CONSTRAINT UX_sahyog_Tenants_Slug UNIQUE,
    PlanId                  INT             NOT NULL CONSTRAINT FK_sahyog_Tenants_Plans REFERENCES dbo.sahyog_Plans(PlanId),
    IsActive                BIT             NOT NULL CONSTRAINT DF_sahyog_Tenants_IsActive DEFAULT (1),
    CreatedUtc              DATETIME2(3)    NOT NULL CONSTRAINT DF_sahyog_Tenants_Created DEFAULT (SYSUTCDATETIME()),
    StorageUsedBytes        BIGINT          NOT NULL CONSTRAINT DF_sahyog_Tenants_Storage DEFAULT (0),
    MaxUsersOverride        INT             NULL,
    StorageQuotaMbOverride  BIGINT          NULL,
    TimeZoneId              NVARCHAR(64)    NOT NULL CONSTRAINT DF_sahyog_Tenants_TimeZone DEFAULT (N'Asia/Kolkata')
);
GO

/* ---------- Users (TenantId NULL = CloudWheel super admin) ---------- */
IF OBJECT_ID(N'dbo.sahyog_Users', N'U') IS NULL
CREATE TABLE dbo.sahyog_Users
(
    UserId              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_Users PRIMARY KEY,
    TenantId            UNIQUEIDENTIFIER NULL CONSTRAINT FK_sahyog_Users_Tenants REFERENCES dbo.sahyog_Tenants(TenantId),
    Email               NVARCHAR(256)   NOT NULL,          -- stored lower-case
    DisplayName         NVARCHAR(100)   NOT NULL,
    PasswordHash        NVARCHAR(400)   NOT NULL,          -- ASP.NET PasswordHasher (PBKDF2), never plain text
    Role                NVARCHAR(20)    NOT NULL CONSTRAINT CK_sahyog_Users_Role CHECK (Role IN (N'SuperAdmin', N'TenantAdmin', N'Member')),
    AvatarTone          TINYINT         NOT NULL CONSTRAINT DF_sahyog_Users_Tone DEFAULT (0),
    IsActive            BIT             NOT NULL CONSTRAINT DF_sahyog_Users_IsActive DEFAULT (1),
    SecurityStamp       UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_sahyog_Users_Stamp DEFAULT (NEWID()),  -- changes = everyone signed out
    FailedLoginCount    INT             NOT NULL CONSTRAINT DF_sahyog_Users_Failed DEFAULT (0),
    LockoutEndUtc       DATETIME2(3)    NULL,
    LastLoginUtc        DATETIME2(3)    NULL,
    CreatedUtc          DATETIME2(3)    NOT NULL CONSTRAINT DF_sahyog_Users_Created DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_sahyog_Users_Email')
    CREATE UNIQUE INDEX UX_sahyog_Users_Email ON dbo.sahyog_Users(Email);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Users_Tenant')
    CREATE INDEX IX_sahyog_Users_Tenant ON dbo.sahyog_Users(TenantId, IsActive) INCLUDE (DisplayName, AvatarTone, Role, Email);
GO

/* ---------- Channels (#general) and direct conversations ---------- */
IF OBJECT_ID(N'dbo.sahyog_Channels', N'U') IS NULL
CREATE TABLE dbo.sahyog_Channels
(
    ChannelId       UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_Channels PRIMARY KEY,
    TenantId        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Channels_Tenants REFERENCES dbo.sahyog_Tenants(TenantId),
    Name            NVARCHAR(80)    NOT NULL,
    Description     NVARCHAR(300)   NULL,
    IsDirect        BIT             NOT NULL CONSTRAINT DF_sahyog_Channels_IsDirect DEFAULT (0),
    DirectKey       NVARCHAR(80)    NULL,               -- "userA:userB" (sorted) so a pair has only one DM
    CreatedBy       UNIQUEIDENTIFIER NULL,
    CreatedUtc      DATETIME2(3)    NOT NULL CONSTRAINT DF_sahyog_Channels_Created DEFAULT (SYSUTCDATETIME()),
    LastMessageUtc  DATETIME2(3)    NOT NULL CONSTRAINT DF_sahyog_Channels_LastMsg DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_sahyog_Channels_Name')
    CREATE UNIQUE INDEX UX_sahyog_Channels_Name ON dbo.sahyog_Channels(TenantId, Name) WHERE IsDirect = 0;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_sahyog_Channels_DirectKey')
    CREATE UNIQUE INDEX UX_sahyog_Channels_DirectKey ON dbo.sahyog_Channels(TenantId, DirectKey) WHERE DirectKey IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.sahyog_ChannelMembers', N'U') IS NULL
CREATE TABLE dbo.sahyog_ChannelMembers
(
    ChannelId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_ChannelMembers_Channels REFERENCES dbo.sahyog_Channels(ChannelId) ON DELETE CASCADE,
    UserId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_ChannelMembers_Users REFERENCES dbo.sahyog_Users(UserId),
    TenantId    UNIQUEIDENTIFIER NOT NULL,
    JoinedUtc   DATETIME2(3)    NOT NULL CONSTRAINT DF_sahyog_ChannelMembers_Joined DEFAULT (SYSUTCDATETIME()),
    LastReadUtc DATETIME2(3)    NOT NULL CONSTRAINT DF_sahyog_ChannelMembers_Read DEFAULT (SYSUTCDATETIME()),
    UnreadCount INT             NOT NULL CONSTRAINT DF_sahyog_ChannelMembers_Unread DEFAULT (0),  -- stored, not recounted (cheap on 10 DTU)
    CONSTRAINT PK_sahyog_ChannelMembers PRIMARY KEY (ChannelId, UserId)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_ChannelMembers_User')
    CREATE INDEX IX_sahyog_ChannelMembers_User ON dbo.sahyog_ChannelMembers(TenantId, UserId) INCLUDE (UnreadCount);
GO

/* ---------- Files: metadata only. The file itself is on disk / R2, never in SQL ---------- */
IF OBJECT_ID(N'dbo.sahyog_Attachments', N'U') IS NULL
CREATE TABLE dbo.sahyog_Attachments
(
    AttachmentId    UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_Attachments PRIMARY KEY,
    TenantId        UNIQUEIDENTIFIER NOT NULL,
    ChannelId       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Attachments_Channels REFERENCES dbo.sahyog_Channels(ChannelId) ON DELETE CASCADE,
    UploaderId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Attachments_Users REFERENCES dbo.sahyog_Users(UserId),
    FileName        NVARCHAR(255)   NOT NULL,
    ContentType     NVARCHAR(150)   NOT NULL,
    SizeBytes       BIGINT          NOT NULL,
    StoragePath     NVARCHAR(400)   NOT NULL,
    UploadedUtc     DATETIME2(3)    NOT NULL CONSTRAINT DF_sahyog_Attachments_Uploaded DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Attachments_Channel')
    CREATE INDEX IX_sahyog_Attachments_Channel ON dbo.sahyog_Attachments(TenantId, ChannelId, UploadedUtc DESC);
GO

/* ---------- Messages ---------- */
IF OBJECT_ID(N'dbo.sahyog_Messages', N'U') IS NULL
CREATE TABLE dbo.sahyog_Messages
(
    MessageId       BIGINT          IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_Messages PRIMARY KEY,
    TenantId        UNIQUEIDENTIFIER NOT NULL,
    ChannelId       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Messages_Channels REFERENCES dbo.sahyog_Channels(ChannelId) ON DELETE CASCADE,
    SenderId        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Messages_Users REFERENCES dbo.sahyog_Users(UserId),
    Body            NVARCHAR(4000)  NOT NULL,
    SentUtc         DATETIME2(3)    NOT NULL CONSTRAINT DF_sahyog_Messages_Sent DEFAULT (SYSUTCDATETIME()),
    AttachmentId    UNIQUEIDENTIFIER NULL CONSTRAINT FK_sahyog_Messages_Attachments REFERENCES dbo.sahyog_Attachments(AttachmentId)
);
GO
-- "Last 50 messages in this channel" is a single index seek.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Messages_Channel')
    CREATE INDEX IX_sahyog_Messages_Channel ON dbo.sahyog_Messages(TenantId, ChannelId, MessageId DESC);
GO

/* ---------- Meetings ---------- */
IF OBJECT_ID(N'dbo.sahyog_Meetings', N'U') IS NULL
CREATE TABLE dbo.sahyog_Meetings
(
    MeetingId           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sahyog_Meetings PRIMARY KEY,
    TenantId            UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Meetings_Tenants REFERENCES dbo.sahyog_Tenants(TenantId),
    Title               NVARCHAR(150)   NOT NULL,
    Agenda              NVARCHAR(2000)  NULL,
    StartUtc            DATETIME2(0)    NOT NULL,
    DurationMinutes     INT             NOT NULL,
    Recurrence          TINYINT         NOT NULL CONSTRAINT DF_sahyog_Meetings_Recurrence DEFAULT (0),   -- 0 once, 1 weekly, 2 weekdays
    RoomName            NVARCHAR(80)    NOT NULL CONSTRAINT UX_sahyog_Meetings_Room UNIQUE,
    GuestCode           NVARCHAR(16)    NOT NULL CONSTRAINT UX_sahyog_Meetings_GuestCode UNIQUE,
    HostId              UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_Meetings_Users REFERENCES dbo.sahyog_Users(UserId),
    ChannelId           UNIQUEIDENTIFIER NULL CONSTRAINT FK_sahyog_Meetings_Channels REFERENCES dbo.sahyog_Channels(ChannelId),
    IsInstant           BIT             NOT NULL CONSTRAINT DF_sahyog_Meetings_Instant DEFAULT (0),
    GuestLinkEnabled    BIT             NOT NULL CONSTRAINT DF_sahyog_Meetings_GuestLink DEFAULT (1),
    LobbyEnabled        BIT             NOT NULL CONSTRAINT DF_sahyog_Meetings_Lobby DEFAULT (1),
    CaptionsOn          BIT             NOT NULL CONSTRAINT DF_sahyog_Meetings_Captions DEFAULT (0),
    CreatedUtc          DATETIME2(3)    NOT NULL CONSTRAINT DF_sahyog_Meetings_Created DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Meetings_Start')
    CREATE INDEX IX_sahyog_Meetings_Start ON dbo.sahyog_Meetings(TenantId, StartUtc) INCLUDE (HostId, Recurrence, DurationMinutes);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_Meetings_Host')
    CREATE INDEX IX_sahyog_Meetings_Host ON dbo.sahyog_Meetings(TenantId, HostId);
GO

IF OBJECT_ID(N'dbo.sahyog_MeetingInvitees', N'U') IS NULL
CREATE TABLE dbo.sahyog_MeetingInvitees
(
    MeetingInviteeId    INT             IDENTITY(1,1) NOT NULL CONSTRAINT PK_sahyog_MeetingInvitees PRIMARY KEY,
    TenantId            UNIQUEIDENTIFIER NOT NULL,
    MeetingId           UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sahyog_MeetingInvitees_Meetings REFERENCES dbo.sahyog_Meetings(MeetingId) ON DELETE CASCADE,
    UserId              UNIQUEIDENTIFIER NULL CONSTRAINT FK_sahyog_MeetingInvitees_Users REFERENCES dbo.sahyog_Users(UserId),
    GuestEmail          NVARCHAR(256)   NULL,
    CONSTRAINT CK_sahyog_MeetingInvitees_Who CHECK (UserId IS NOT NULL OR GuestEmail IS NOT NULL)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_MeetingInvitees_User')
    CREATE INDEX IX_sahyog_MeetingInvitees_User ON dbo.sahyog_MeetingInvitees(TenantId, UserId) INCLUDE (MeetingId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sahyog_MeetingInvitees_Meeting')
    CREATE INDEX IX_sahyog_MeetingInvitees_Meeting ON dbo.sahyog_MeetingInvitees(MeetingId);
GO

/* ---------- Table types for passing lists to stored procedures ---------- */
IF TYPE_ID(N'dbo.sahyog_GuidList') IS NULL
    CREATE TYPE dbo.sahyog_GuidList AS TABLE (Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY);
IF TYPE_ID(N'dbo.sahyog_EmailList') IS NULL
    CREATE TYPE dbo.sahyog_EmailList AS TABLE (Email NVARCHAR(256) NOT NULL PRIMARY KEY);
GO

/* ---------- Starting plans (edit them later in /admin) ---------- */
IF NOT EXISTS (SELECT 1 FROM dbo.sahyog_Plans)
INSERT dbo.sahyog_Plans (Name, MaxUsers, MaxMeetingParticipants, StorageQuotaMb, MaxVideoHeight, RecordingEnabled, MaxMeetingMinutes, VideoProvider)
VALUES (N'Small',   10,  10,     5120, 720, 0,   60, N'JaaS'),
       (N'Medium', 100, 100,   102400, 540, 1,  480, N'JaaS'),
       (N'Large',  500, 500,  1048576, 540, 1, 1440, N'JaaS');
GO
