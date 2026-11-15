# Sahyog — team chat & video meetings

**By CloudWheel Ltd.** Built with ASP.NET Core MVC on .NET 10, SQL Server / Azure SQL **tables and stored procedures** (plain ADO.NET, no Entity Framework), SignalR and JaaS (8x8) video.

One codebase serves many client companies (tenants). Each client is on a plan (Small / Medium / Large) that sets its limits: users, people per meeting, storage, video quality, recording and meeting length. The app enforces those limits by itself.

---

## What's in this first version

| Area | Features |
|---|---|
| **Sign-in** | Workspace + email + password, lockout after 5 wrong tries, 14-day "keep me signed in" |
| **Chat** | Channels, direct messages, real-time delivery (SignalR), typing indicator, online dots, unread badges, file sharing with storage quota, load older messages (50 at a time) |
| **Meetings** | Week calendar, schedule form with an "are you free?" check, recurring meetings (weekly / weekdays), email + calendar invites (.ics for Outlook/Google), guest links with a lobby, **Meet now** from any channel or DM |
| **Calling** | Incoming-call pop-up with ringtone (Accept/Decline), desktop notification when the tab is in the background, missed-call notice |
| **Video room** | Live video through JaaS, Sahyog's own glass controls: mute, camera, **screen share**, raise hand, captions, grid view, people list, leave. Per-plan participant limit and video quality |
| **Workspace admin** (`/team`) | Add/remove people within the plan's user limit |
| **Super admin** (`/admin`) | Create client workspaces, change plans, edit plan limits, pause/resume a client |

---

## 1. Open and run on your PC (Visual Studio 2026)

1. Install **Visual Studio 2026** with the **ASP.NET and web development** workload (includes the .NET 10 SDK and SQL Server LocalDB).
2. **Create the database.** In SQL Server Management Studio (or Visual Studio's **SQL Server Object Explorer**), create (or use) your database, put its connection string in `appsettings.json` under `ConnectionStrings:Default`, then run these two scripts on it, in order:
   1. `database/01_Tables.sql` — all tables, indexes, table types and the three starting plans
   2. `database/02_StoredProcedures.sql` — every stored procedure the app uses

   Both scripts are safe to run again. Run `02_StoredProcedures.sql` again whenever it changes.
3. Open `Sahyog.sln`. The connection string for development is in `src/Sahyog.Web/appsettings.Development.json`. To use your Azure SQL database instead, run the two scripts there and put its connection string in that file.
4. Add the first logins as **user secrets**, so no password sits in a file. Right-click the project → **Manage User Secrets** and paste:

   ```json
   {
     "Seed": {
       "SuperAdminEmail": "admin@cloudwheel.com",
       "SuperAdminPassword": "Choose-A-Strong-Password-1",
       "CreateDemoTenant": true,
       "DemoTenantAdminEmail": "admin@acme.test",
       "DemoTenantAdminPassword": "Choose-Another-Password-2"
     }
   }
   ```

   On start, the app creates these logins by calling the stored procedures. Passwords are stored only as hashes.
5. Press **F5**. Sign in:
   - **Super admin:** leave *Workspace* empty, use the SuperAdmin email/password.
   - **Demo client:** workspace `acme`, use the DemoTenantAdmin email/password. Add teammates at **Team**.

Chat works straight away. Video needs step 2.

---

## 2. Turn on video (JaaS by 8x8 — free up to 25 users a month)

1. Sign up at **jaas.8x8.vc** (Developer plan).
2. In the JaaS console copy your **App ID** (`vpaas-magic-cookie-…`).
3. Go to **API Keys → Add API key**, generate a key pair and **download the private key** file.
4. Save the key file outside the website folder, for example `D:\SahyogSecrets\jaas.pk`.
5. Fill in the `Jaas` section (user secrets on your PC, `appsettings.Production.json` on the server):

   ```json
   "Jaas": {
     "AppId": "vpaas-magic-cookie-xxxxxxxx",
     "ApiKeyId": "vpaas-magic-cookie-xxxxxxxx/abc123",
     "PrivateKeyPath": "D:\\SahyogSecrets\\jaas.pk"
   }
   ```

   `ApiKeyId` is the full key ID shown on the API Keys page.

Before using the free Developer plan for a paying client, confirm with 8x8 that it's allowed in production.

---

## 3. Email invites (optional)

Fill in `Smtp` with any SMTP service (Office 365, Google Workspace, Brevo…). If `Smtp:Host` is empty, the app only logs the emails it would have sent. Scheduling still works.

---

## 4. Put it on your Windows Server (IIS) with Azure SQL

1. On the server, install the **ASP.NET Core 10 Hosting Bundle** from Microsoft, then restart IIS (`iisreset`).
2. **Server Manager → Add Roles and Features → Web Server (IIS) → Application Development → WebSocket Protocol.** Chat needs it.
3. In Visual Studio: right-click the project → **Publish → Folder**. Copy the output to the server, e.g. `D:\Sites\Sahyog`.
4. In IIS: **Add Website** pointing to that folder. Set its app pool to **No Managed Code**.
5. Create these folders and give the app pool identity (`IIS AppPool\<pool name>`) **Modify** permission:
   - `D:\SahyogData\files` — uploaded files
   - `D:\SahyogData\keys` — sign-in cookie keys
6. Create `appsettings.Production.json` next to the app (never commit it):

   ```json
   {
     "ConnectionStrings": { "Default": "Server=tcp:YOUR.database.windows.net,1433;Initial Catalog=Sahyog;User ID=...;Password=...;Encrypt=True;" },
     "App": {
       "PublicBaseUrl": "https://sahyog.cloudwheel.com",
       "DataProtectionKeysPath": "D:\\SahyogData\\keys"
     },
     "Storage": { "RootPath": "D:\\SahyogData\\files" },
     "Jaas": { "AppId": "...", "ApiKeyId": "...", "PrivateKeyPath": "D:\\SahyogSecrets\\jaas.pk" },
     "Seed": { "SuperAdminEmail": "admin@cloudwheel.com", "SuperAdminPassword": "..." }
   }
   ```

7. **Azure SQL:** run `database/01_Tables.sql` and `database/02_StoredProcedures.sql` on your Azure SQL database (SSMS or Azure Data Studio), and in the Azure portal allow your Windows Server's public IP in the firewall.
8. **HTTPS (required for camera, mic and notifications):** run the free **win-acme** tool on the server and pick your IIS site. It installs a Let's Encrypt certificate and renews it automatically.
9. Open the site. On first start it creates the super admin. After the first successful sign-in, you can remove `SuperAdminPassword` from the file.

---

## 5. Database design (SQL Server / Azure SQL)

Every table, stored procedure, view and type is named `sahyog_…`, so Sahyog sits safely in a database next to other apps.

All data access is **stored procedures** in `database/02_StoredProcedures.sql`, called from C# with plain ADO.NET (`Microsoft.Data.SqlClient`). There is no Entity Framework and there are no ASP.NET Identity tables.

| Table | What it stores |
|---|---|
| `sahyog_Plans` | Small, Medium, Large and their limits |
| `sahyog_Tenants` | Client companies: workspace name, plan, storage used, active or paused |
| `sahyog_Users` | People: email, name, password hash, role, avatar colour, lockout, security stamp |
| `sahyog_Channels`, `sahyog_ChannelMembers` | Channels, direct conversations, members and unread counts |
| `sahyog_Messages` | Chat messages |
| `sahyog_Attachments` | File name, size and path (the file itself is on disk) |
| `sahyog_Meetings`, `sahyog_MeetingInvitees` | Scheduled and instant meetings, invited people and guest emails |

**Client separation:** every procedure that touches client data takes `@TenantId` and filters by it.
**Limits enforced inside SQL transactions:** user limit (`sahyog_User_Create`, `sahyog_User_SetActive`) and storage quota (`sahyog_Chat_SendFile`), so two requests at the same moment can't go over the limit.

**Azure SQL S0 (10 DTU):**

- Files are stored on disk, never in SQL.
- Online/offline status is kept in memory.
- Messages load 50 at a time through an index on (TenantId, ChannelId, MessageId).
- Unread counts are stored, not recalculated.
- Sending a message is one stored procedure call.

Watch **DTU percentage** in the Azure portal. If it stays above about 70–80% during work hours, move up to S1 or S2. No code changes are needed.

---

## How the code is organised

The solution has **three projects**:

| Project | What it contains | Depends on |
|---|---|---|
| **Sahyog.DtoLibrary** | Plain data classes (DTOs): what goes into and comes out of the stored procedures, e.g. `CreateMeetingRequest`, `MessageDto`, `TenantLimitsDto`, plus roles and enums | nothing |
| **Sahyog.ServiceLibrary** | Every business function: services with interfaces (`ITenantService`, `IUserService`, `IChatService`, `IMeetingService`) that call the stored procedures through ADO.NET, plus email, file storage, JaaS video tokens and online-status tracking | DtoLibrary |
| **Sahyog.Web** | ASP.NET Core MVC: controllers, Razor views, the SignalR chat hub, the sign-in cookie | DtoLibrary, ServiceLibrary |

How one request flows, using sending a message as the example:

```
Browser → ChatHub (Web) → IChatService.SendMessageAsync(SendMessageRequest)   (ServiceLibrary)
        → SqlDb → dbo.sahyog_Chat_SendMessage   (SQL Server)
        ← MessageDto (DtoLibrary) ← back to every browser in the channel
```

```
database/
├─ 01_Tables.sql               tables, indexes, table types, starting plans
└─ 02_StoredProcedures.sql     all sahyog_* procedures (CREATE OR ALTER)
src/
├─ Sahyog.DtoLibrary/
│  ├─ Common.cs                roles, claim names, MeetingRecurrence, OperationResult, Names.Initials
│  ├─ TenantDtos.cs            PlanDto, TenantLimitsDto, TenantDto, CreateTenantRequest …
│  ├─ UserDtos.cs              UserDto, LoginUserDto, CreateUserRequest, LoginStatus …
│  ├─ ChatDtos.cs              MessageDto, SendMessageRequest, SendFileRequest, CreateChannelRequest …
│  └─ MeetingDtos.cs           MeetingDto, CreateMeetingRequest, InviteeDto, GuestMeetingDto …
├─ Sahyog.ServiceLibrary/
│  ├─ ServiceRegistration.cs   AddSahyogServices() + DatabaseSeeder
│  ├─ Data/SqlDb.cs            runs stored procedures (with Azure SQL retry)
│  ├─ Services/                TenantService, UserService (+ password hashing), ChatService, MeetingService (+ MeetingCalendar)
│  ├─ Infrastructure/          email + .ics invites, file storage, presence & meeting trackers
│  └─ Video/                   IVideoProvider + JaaS implementation (LiveKit can be added later)
└─ Sahyog.Web/
   ├─ Controllers/             Account, Chat, Meetings, Guest (/join/{code}), Team, Admin — call services only
   ├─ Hubs/ChatHub.cs          real-time chat, typing, presence, calls
   ├─ Infrastructure/          sign-in cookie, helpers for the signed-in user
   ├─ Models/ViewModels.cs     page models for the Razor views
   ├─ Views/                   Razor pages in the liquid glass design
   └─ wwwroot/                 site.css, site.js, chat.js, meetings.js, room.js, logo
```

When you add a Web API or a mobile app later, it references **Sahyog.ServiceLibrary** and **Sahyog.DtoLibrary** and reuses every function as is.

**Tenant safety:** every client-owned table has a `TenantId`. The app passes the signed-in person's TenantId (from their login cookie) to every stored procedure, and each procedure filters by it. One client can never read another client's data.

**Swapping the video provider:** controllers only use `IVideoProvider`. To add LiveKit for 500-person clients, write a `LiveKitVideoProvider` in ServiceLibrary, register it in `ServiceRegistration.cs`, and set that plan's provider to `LiveKit` in the super admin page.

---

## Planned next

- Fully custom video tiles with **lib-jitsi-meet** (round bubbles, glowing speaker stage), replacing the JaaS frame inside the stage
- **Web push** notifications so calls ring even when the Sahyog tab is closed
- Meeting reminders 5 minutes before (Hangfire background jobs)
- Edit/delete messages, message search, emoji reactions
- Installable phone app (PWA), then Play Store / App Store wrapper
- LiveKit provider and Redis backplane for 500+ person clients on several servers
