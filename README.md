# ShankhNaad — team chat & video meetings

**By CloudWheel Ltd.** Built with ASP.NET Core MVC on .NET 10, SQL Server / Azure SQL **tables and stored procedures** (plain ADO.NET, no Entity Framework), SignalR and JaaS (8x8) video.

> **Name:** the app is shown to users as **ShankhNaad**. The solution, projects, namespaces and the database (`sahyog_` tables and stored procedures) keep the name **Sahyog**, so nothing in the database changes.

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
| **Super admin** (`/admin`) | Create client workspaces, rename a client (company or workspace name), change plans, edit plan limits, pause/resume a client, delete a paused client with all its data (type the workspace name to confirm) |

---

## The screens (liquid glass + Template 1 controls)

All pages use the **Template 1 tag helpers**, copied into `src/ShankhNaad.Web/TagHelpers` (namespace `ShankhNaad.Web.TagHelpers`) and registered in `Views/_ViewImports.cshtml` with `@addTagHelper *, ShankhNaad.Web`. Their CSS is in `wwwroot/css/web-control`, their scripts in `wwwroot/js/web-control`, the offline libraries (jQuery, flatpickr, Chart.js, Font Awesome 4.7, Bootstrap Icons) in `wwwroot/lib/Mordern-Controls`.

| Page | Tag helpers used |
|---|---|
| Left menu (every page) | `report-rail` + `rail-item` |
| Sign in, Setup | `strip-header`, `tab-control`, `modern-input` (password with show/hide), `modern-checkbox` (switch) |
| Chat | `action-header` + `action-btn`, `modern-group-box` (Members, Files, Storage), `modern-input` in pop-ups |
| Meetings | `action-header`, `tab-control` (last / this / next week), `modern-table`, `modern-donut-chart`, `modern-group-box` |
| Schedule pop-up | `modern-input`, `modern-datepicker-with-label`, `modern-dropdown-with-label`, `modern-radio-group`, `modern-checkbox` |
| Team | `action-header`, `modern-table`, `modern-half-donut-chart`, `modern-group-box` |
| Clients (super admin) | `action-header`, `modern-table`, `modern-dropdown-with-label`, `modern-input`, `modern-checkbox`, `modern-group-box` |
| Confirm / info boxes | `confirmMessageBox` / `openMessageBox` from `messagebox.js` |

Every grid is a `<modern-table>` with search, **Filters** (shows or hides the per-column filter row), sorting, the **Columns** chooser and paging. Pick a row, then use the buttons in the `action-header` (Join, Cancel, Remove, Restore, Pause / Resume, Export to CSV, Print).

The meeting room keeps its own dark design (`Views/Meetings/Room.cshtml`).

**Files added for the new look**

| File | What it does |
|---|---|
| `wwwroot/css/shankhnaad.css` | Liquid glass skin: frosted panels, slowly drifting colour spheres, glass inputs, tables and pop-ups |
| `wwwroot/css/shankhnaad-auth.css` | Sign-in and setup page: the glass window with colour behind it |
| `wwwroot/js/shankhnaad.js` | `SN.*` helpers the header buttons call: selected row, confirm-then-post, export CSV, print, copy |
| `wwwroot/images/logo.svg`, `logo-white.svg`, `favicon.svg` | The conch (shankh) logo |
| `wwwroot/css/Theme/controls-theme.css` | Template 1 colours set to ShankhNaad blue `#2563EB` and pink `#DB2777` |

**Small changes to Template 1 controls (all marked "ShankhNaad" in the code)**

- `ModernCheckbox.cs`: new `value` attribute (default `true`). A ticked box posts `true`, an unticked one posts `false`, so it binds straight to a `bool`. For a list, set `value="@person.Id"`. Labels are HTML-encoded.
- `ModernInput.cs`: the value is HTML-encoded.
- `modern-datepicker-with-label.js`: inside a pop-up the calendar opens in place, so it is not hidden behind the pop-up.

---

## Top bar and the desktop app

**Top bar (every page except the meeting room).** Built with Template 1's `strip-header` in `Views/Shared/_Layout.cshtml`: workspace name on the left, a live **Connected** pill and clock on the right, then your user panel (initials, name, role). Click the user panel for:

| Menu item | What it does |
|---|---|
| About ShankhNaad | Version (from `<Version>` in `ShankhNaad.Web.csproj`), licence, workspace, signed-in user, browser or desktop app |
| Maximize / Minimize | Full screen on and off (built into `strip-header`) |
| Install desktop app | Opens the install dialog. Hidden when you are already in the desktop app |
| Log out | Signs out |

`strip-header` got three small additions (marked "ShankhNaad"): `help-text` (renames the first item), `show-install` / `install-text` (the install item) and `user-initials` (initials in the round avatar). Anything written inside `<strip-header>…</strip-header>` now shows on the right, before the user panel.

**Desktop app.** ShankhNaad is an installable web app (PWA). In Chrome or Edge, users press **Install desktop app** (or the link on the sign-in page) and it gets its own window, Start-menu and taskbar icon. No installer to build, and it updates itself from your server.

| File | Purpose |
|---|---|
| `wwwroot/manifest.webmanifest` | Name, icons, colours, shortcuts (Chat, Meetings). Uses *window controls overlay*, so the top bar becomes the window's title bar |
| `wwwroot/service-worker.js` | Makes the site installable. It caches nothing, so data is always live. Clicking a call notification brings the app window to the front |
| `wwwroot/js/pwa-install.js` | Keeps the browser's install prompt, `SN.installApp()`, and switches the page to app mode (`body.sn-app`) |
| `wwwroot/icons/*.png` | App icons (192, 512, maskable 512, Apple touch) |

Requirements: the site must run on **HTTPS** (step 4 below already sets this up; `localhost` also works for testing). A Windows `.exe` wrapper (WebView2) can be added later around the same site.

---

## 1. Open and run on your PC (Visual Studio 2026)

1. Install **Visual Studio 2026** with the **ASP.NET and web development** workload (includes the .NET 10 SDK and SQL Server LocalDB).
2. **Create the database.** In SQL Server Management Studio (or Visual Studio's **SQL Server Object Explorer**), create (or use) your database, put its connection string in `appsettings.json` under `ConnectionStrings:Default`, then run these two scripts on it, in order:
   1. `database/01_Tables.sql` — all tables, indexes, table types and the three starting plans
   2. `database/02_StoredProcedures.sql` — every stored procedure the app uses

   Both scripts are safe to run again. Run `02_StoredProcedures.sql` again whenever it changes.
3. Open `ShankhNaad.sln`. The connection string for development is in `src/ShankhNaad.Web/appsettings.Development.json`. To use your Azure SQL database instead, run the two scripts there and put its connection string in that file.
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

Sending uses **MailKit**, so both common ports work: **465** (SSL from the start, used by Plesk / MilesWeb Windows hosting) and **587** (STARTTLS, used by Gmail, Brevo, Office 365). The app picks the right mode from `Smtp:Port`. Example for a MilesWeb (Plesk) mailbox, kept in user secrets:

```json
"Smtp": { "Host": "CloudWheel.info", "Port": 465, "EnableSsl": true,
          "UserName": "no-reply@CloudWheel.info", "Password": "...",
          "FromAddress": "no-reply@CloudWheel.info", "FromName": "ShankhNaad" }
```
In Plesk, set **Mail Settings → SSL/TLS certificate for mail** to the domain's certificate, otherwise the connection fails with a certificate error.

With email set up, ShankhNaad also sends **welcome emails** (Team → Add person → "Email them an invite") and **password links** ("Forgot password?" on the sign-in page, and Team → Edit → "Email a set-password link"). Links point to `App:PublicBaseUrl`, so set it to the address people use (for example `https://sahyog.cloudwheel.com`). Run `database/11_PasswordLinks.sql` first.

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
| **ShankhNaad.DtoLibrary** | Plain data classes (DTOs): what goes into and comes out of the stored procedures, e.g. `CreateMeetingRequest`, `MessageDto`, `TenantLimitsDto`, plus roles and enums | nothing |
| **ShankhNaad.ServiceLibrary** | Every business function: services with interfaces (`ITenantService`, `IUserService`, `IChatService`, `IMeetingService`) that call the stored procedures through ADO.NET, plus email, file storage, JaaS video tokens and online-status tracking | DtoLibrary |
| **ShankhNaad.Web** | ASP.NET Core MVC: controllers, Razor views, the SignalR chat hub, the sign-in cookie | DtoLibrary, ServiceLibrary |

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
├─ ShankhNaad.DtoLibrary/
│  ├─ Common.cs                roles, claim names, MeetingRecurrence, OperationResult, Names.Initials
│  ├─ TenantDtos.cs            PlanDto, TenantLimitsDto, TenantDto, CreateTenantRequest …
│  ├─ UserDtos.cs              UserDto, LoginUserDto, CreateUserRequest, LoginStatus …
│  ├─ ChatDtos.cs              MessageDto, SendMessageRequest, SendFileRequest, CreateChannelRequest …
│  └─ MeetingDtos.cs           MeetingDto, CreateMeetingRequest, InviteeDto, GuestMeetingDto …
├─ ShankhNaad.ServiceLibrary/
│  ├─ ServiceRegistration.cs   AddSahyogServices() + DatabaseSeeder
│  ├─ Data/SqlDb.cs            runs stored procedures (with Azure SQL retry)
│  ├─ Services/                TenantService, UserService (+ password hashing), ChatService, MeetingService (+ MeetingCalendar)
│  ├─ Infrastructure/          email + .ics invites, file storage, presence & meeting trackers
│  └─ Video/                   IVideoProvider + JaaS implementation (LiveKit can be added later)
└─ ShankhNaad.Web/
   ├─ Controllers/             Account, Chat, Meetings, Guest (/join/{code}), Team, Admin — call services only
   ├─ Hubs/ChatHub.cs          real-time chat, typing, presence, calls
   ├─ Infrastructure/          sign-in cookie, helpers for the signed-in user
   ├─ Models/ViewModels.cs     page models for the Razor views
   ├─ Views/                   Razor pages in the liquid glass design
   └─ wwwroot/                 site.css, site.js, chat.js, meetings.js, room.js, logo
```

When you add a Web API or a mobile app later, it references **ShankhNaad.ServiceLibrary** and **ShankhNaad.DtoLibrary** and reuses every function as is.

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

## Themes, scheduler and page transitions

- **Light and dark theme.** Use the sun/moon button in the top bar, or **Dark theme / Light theme** in the user menu. The choice is kept in the browser (`localStorage["sn-theme"]`). Until the person picks one, the computer's setting is followed. The dark styles are the `html[data-theme="dark"]` block at the end of `wwwroot/css/shankhnaad.css`. Sign-in and setup pages stay light.
- **Meetings → Schedule / List.** Schedule (a week calendar) is the default. List is the Template 1 `modern-table`. The two views share one selection, so Join and Cancel work from either. Double-click a meeting in Schedule to join it. The view the person used last is remembered.
- **Smooth page changes.** These use cross-document view transitions (`@view-transition { navigation: auto; }`), supported in Edge and Chrome 126 or later. The rail and top bar stay put while the page content fades. Last week and Next week slide the content left or right. Other browsers get a simple fade-in.

## Meetings calendar: Day, Week, Month, List

- `/meetings?view=day|week|month|list&date=yyyy-MM-dd`. The last view used is kept in the `sn-mview` cookie, so the server opens it straight away.
- Use ‹ Today › to move by a day, a week or a month.
- Click an empty half-hour slot (Day or Week) or an empty day (Month) to open **Schedule a meeting** with that date and time filled in. Past times show a short message instead.
- Click a meeting to select it, so the Join and Cancel buttons work on it. Double-click a meeting to join.

## Delete a one-to-one chat

- In a direct chat, **Delete** in the chat header removes the conversation, its messages and its files for both people. The space is given back to the workspace storage, and the other person's page updates live.
- **Run `database/04_DeleteDirectChat.sql` once.** It adds one stored procedure, `dbo.sahyog_Chat_DeleteDirect`. No tables change.

## Round 10: all-day events, guests, message delete

- **Run `database/05_AllDayAndMessageDelete.sql` once.** It does two things:
  - It adds two columns with defaults to `sahyog_Meetings` (`IsAllDay`, `ShowAsFree`) and updates `sahyog_Meeting_Create`, `sahyog_Meeting_ListForUser` and `sahyog_Meeting_Get`.
  - It adds `sahyog_Chat_DeleteMessage`.
  - Existing meetings are not changed. Normal meetings keep working before the script is run; only all-day events and message delete need it.
- **All-day events.** Use the **All-day event** switch in Schedule a meeting.
  - **Busy** blocks the whole day: the column is striped and it counts as a clash.
  - **Free** only shows in the all-day row at the top.
  - The plan's meeting length does not apply to all-day events.
  - Longer meeting lengths (up to 12 hours) appear in Duration when the plan allows them (Admin → Plans → Meeting length).
- **People and guests in Schedule a meeting.** You can search the team and use **Select all**. Guest emails become chips: press Enter or a comma after each one. If the workspace has no one else yet, admins get **Add people to the team**, which opens `/team?add=1` with the Add person window already open.
- **Delete a message.** Hover a message and press the bin. You can delete your own messages; workspace admins can delete any. A file attached to the message is deleted too, and the storage is given back. Everyone in the chat sees it disappear live.
