# ShankhNaad: all changes (20 Nov 2026)

51 files changed (10 new). **One database update** (team location): run `database/30_Location.sql`
(or `99_ApplyAllUpdates.sql`, which now includes it). No new NuGet package.
The whole solution was compiled here with the .NET 10 SDK (all C# and all Razor views; the 3 NuGet packages of
ServiceLibrary replaced by compile-only stand-ins, as nuget.org wasn't reachable), and the web app was run to test
the bundles and the partial-loading redirects for real.
Deploy:
1. SQL Server Management Studio → open `database/30_Location.sql` → pick the Sahyog database → Execute (F5).
   Safe to run more than once. It only adds two tables and their procedures; nothing existing is changed.
2. Open the solution, rebuild, publish `ShankhNaad.Web`, restart the site in IIS, then hard-refresh browsers
   (Safari ⌥⌘E then ⌘R; iPhone: Settings → Safari → Clear History and Website Data).
3. The server needs outgoing internet access to `nominatim.openstreetmap.org` (turns a map position into an address)
   and browsers to `cdnjs.cloudflare.com` and `tile.openstreetmap.org` (the map). Without them, office / remote
   and coordinates still work; only the place names / map are missing.

## A. Team location (new; per client, switched on by the super admin)
- **Super admin** (Admin → Clients): a **Team location** column (On / Off), a switch in the client's details panel and a
  **Team location** button in the toolbar. Off by default. Switching it off erases every stored location of that client.
- **Each person decides.** When it's on, everyone is asked once: *"Share your location with your team?"*
  (**Share my location / Not now / Don't share**). The user menu (top right) has **Share my location** with an on/off
  switch at any time. Nothing is stored before they say yes; saying no erases what was stored.
  Only the **latest** location is kept (no history).
- **While sharing**, the browser checks in every 10 minutes while ShankhNaad is open (once for all open tabs):
  - **In office / Remote**: from the internet address the person connects from, compared with the office address(es).
  - **Map position**: from the device, if the browser allows it (GPS on phones, Wi-Fi on laptops). Turned into an address
    (area, city, state, country) on the server, cached.
- **Workspace admins: Team → Office address**: the office's internet address(es), one per line (single addresses or
  ranges like 203.0.113.0/24). **Add this address** adds the one you're connecting from: easiest from an office PC.
  If ShankhNaad runs on a server inside the office, use the office network range (e.g. 192.168.1.0/24).
- **Team page**: a **Location** column ("In office · Bengaluru", "Remote · Pune", "Not shared") with a pin button.
  The pin, the person's photo in the row, or **Profile** in the toolbar opens their **profile card**:
  big photo, name, role, online status, email, and their location: In office / Remote, city, when they last checked in,
  and for **workspace admins (and the person themselves)** a **map** with their photo as the pin and an accuracy circle,
  the full address, area, city, state, country, accuracy, coordinates and **Open in Google Maps**.
- **No map position?** The browser first asks for a precise position, then falls back to the quicker Wi-Fi/network
  position (desktops have no GPS). If both fail, your own card and the **Update my location now** message say why and
  how to fix it: blocked for the site (lock icon → Location → Allow), or the computer's location switched off
  (Windows: Settings → Privacy & security → Location; Mac: Privacy & Security → Location Services).
  Members see In office / Remote and the city, not the map or street address. Your own card has **Share my location** /
  **Update my location now**. The map follows the theme (dark tiles in the dark themes).
- India's DPDP Act needs consent for location: this is opt-in per person, can be withdrawn any time, and keeps only the latest.
*Files: database/30_Location.sql (new), 99_ApplyAllUpdates.sql, DtoLibrary/LocationDtos.cs (new),
ServiceLibrary/Services/LocationService.cs (new) + ServiceRegistration.cs, Controllers/LocationController.cs (new),
Infrastructure/TeamLocation.cs (new: office matching, address lookup), Program.cs, Controllers/TeamController.cs,
Controllers/AdminController.cs, Models/ViewModels.cs, Views/Team/Index.cshtml, Views/Admin/Index.cshtml,
wwwroot/js/location.js (new), Infrastructure/AssetBundles.cs, wwwroot/css/shankhnaad.css.*

## B. Three themes: Light, Dark, CloudWheel
- The previous dark theme is now called **CloudWheel** (deep blue). People who had it keep exactly the same look.
- New **Dark**: very dark neutral grey with glass panels (no blue tint); text in light greys; brand colours (blue, violet,
  pink) unchanged. Safari gets its pre-frosted version (no live blur), like the other themes.
- The theme button in the top bar opens a small menu: **Light · Dark · CloudWheel** with a preview of each.
  The user menu item **Theme: …** steps through them. The choice is remembered per browser.
- How: both dark themes use the existing dark styles; Dark adds the class `sn-carbon` and `css/theme-dark.css`, which is
  generated from the dark styles with every navy / slate colour turned into a neutral grey of the same lightness.
  After changing dark styles, regenerate it with `tools/gen_dark.py` (in the zip), or edit theme-dark.css by hand.
*Files: wwwroot/css/theme-dark.css (new), wwwroot/js/shankhnaad.js, Views/Shared/_Layout.cshtml,
Infrastructure/AssetBundles.cs, wwwroot/css/shankhnaad.css.*

## C. Sign-in page and the new conch logo
- **Sign-in (layout A from the mock):** the conch logo, **SHANKHNAAD**, and right under it what it's for:
  **Team chat · Calls · Meetings**. Then "By CloudWheel Ltd", the headline, three feature cards and the Rig Veda verse.
- **Sign-in window:** "Sign in to your team's ShankhNaad workspace", **Keep me signed in** and **Forgot password?** on one
  line, "Sign in" in normal letters (not all capitals), **Install the desktop app** as a small button. The floating
  "Daily stand-up" / "3 new messages" cards sit outside the window (they no longer cover "Work email") and stay inside
  the screen at 1280–1920 px. "Run setup" moved to the bottom of the page. Phones: the same, stacked, no empty gap.
- Forgot password and Set password share the new left side.
- Headline a little smaller (28 px on computers, 15–17 px on phones); "By **CloudWheel** Ltd" in heavier type with
  CloudWheel in the brand colours. On phones the blue circle no longer sits over the headline.
- **Top bar of every page:** the company name (e.g. CloudWheel) larger and stronger (also in the dark themes), followed by a
  **Team chat · Calls · Meetings** strip: they open those pages, and the one you're on is highlighted. Icons only on
  narrower screens; hidden on phones (the bottom bar has them).
- **Conch logo everywhere:** browser tab icon (`favicon.svg`), the logo on the sign-in pages (`images/logo.svg`), the
  top bar of every page (next to the company name, in place of the building icon), the meeting room, About, and the
  install icons for the desktop app and phones (`icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`,
  `apple-touch-icon.png`). Installed apps pick up the new icon after the next update (or uninstall / install again).
*Files: Views/Account/_AuthHero.cshtml, Views/Account/Login.cshtml, Views/Shared/_Layout.cshtml, wwwroot/js/shankhnaad.js,
wwwroot/css/theme-dark.css,
wwwroot/css/shankhnaad-auth.css, wwwroot/css/shankhnaad.css, wwwroot/favicon.svg, wwwroot/images/logo.svg,
wwwroot/images/logo-white.svg, wwwroot/icons/*.png.*

## 1. Meetings: ringing and reminders (new)
- **Meeting started → participants ring.** When the first person enters a scheduled meeting, every invited
  team member (and the host) who is online and not in it gets the ringing card: "Manjunath started 'Sprint planning'",
  **Join / Not now**, 30 s. Not repeated within 2 minutes (a quick leave and rejoin doesn't ring twice).
  Missed: a toast with Join. Meet-now calls ring as before.
  *Files: Hubs/ChatHub.cs (MeetingJoined → RingMeetingStartedAsync), DtoLibrary/ChatDtos.cs (Kind, Note).*
- **Before a meeting → reminder.** On every workspace page: 5 minutes before, a "Meeting reminder" card with
  one soft chime ("Weekly review · starts in 5 minutes · hosted by Ravi", **Join / Dismiss**, 60 s). At the start
  time it rings ("starts now"), unless someone has just started it (that already rang). Each reminder shows once,
  even with several tabs open. Repeating meetings included; not shown if you're already in the meeting.
  Do not disturb / Presenting: the card shows without sound.
  *Files: Controllers/MeetingsController.cs (GET /meetings/upcoming), wwwroot/js/meeting-alerts.js (new),
  wwwroot/js/site.js (one ringing card for calls, meeting starts and reminders), _Layout.cshtml, shankhnaad.css.*

## 1b. Meeting room: Jitsi's own pop-ups and thumbnail column replaced by ShankhNaad's (new)
- Jitsi's pop-ups are off ("Sandy would like to participate · View participants", "… joined", lobby box).
  The room shows its own notices instead, in the same style as its other notices:
  - **Raised hand:** "✋ Sandy raised a hand"; in People that person moves to the top with ✋; the Raise button
    follows your real hand (Jitsi lowers it by itself when you start talking).
  - **Lobby (host):** "Ravi is waiting in the lobby" with **Admit / Deny** (Jitsi's own box is gone, so this replaces it).
  - **Joined / left the call** (not shown twice when the server also reports it with a note).
- Jitsi's column of video thumbnails is hidden (and hidden again if Jitsi brings it back).
  Click a name in People to put that person on the big video; **Grid** still shows everyone's video, you included.
*Files: wwwroot/js/room.js, wwwroot/css/site.css.*

## 1c. Meeting room: your other messages, Hold, and calls that come in during a meeting (new)
Team members only (guests see the room as before).
- **Inbox tab** in the side panel (next to People and Chat; key **M**): all your chats with unread counts, newest first.
  Open one to read the latest messages and reply, without leaving the call. "Open in Chat" opens it in a new tab.
  A message from another chat pops up in the room ("Asha: Design review moved to 4pm", **Open**) and the counts on the
  Inbox tab and the panel button go up. Nothing pops up for the chat you're reading.
  *Files: Controllers/ChatController.cs (GET /chat/inbox, GET /chat/{id}/recent), Views/Meetings/Room.cshtml.*
- **Hold** button in the controls: your microphone, camera and the call's sound go off, and the video area shows
  "Call on hold · Resume the call". **Resume** puts everything back as it was (a mic you had muted stays muted).
  The others see "Sandy put the call on hold" and **On hold** next to your name in People, then "Sandy is back".
  *Files: Hubs/ChatHub.cs (SetOnHold → ParticipantOnHold).*
- **Another call while you're in a meeting:** a ringing card at the top of the room with 3 choices:
  - **Hold & answer**: this meeting goes on hold and the new call opens in a new tab.
    When that call ends, this one offers **Resume this call**.
  - **End & answer**: you leave this meeting and go to the new call.
  - **Decline**: the caller is told, as before.
  The same card is used for "meeting started" and meeting reminders (**Hold & join / End & join / Not now**).
  Unanswered in 30 s, or the caller hangs up: "You missed a call from …", and it counts in Calls' missed list.
  While a meeting is open, the workspace tab no longer rings a second card at the same time; the meeting tab rings
  instead. It rings in the workspace tab again once the meeting is closed.
  *Files: wwwroot/js/room.js, wwwroot/js/site.js, wwwroot/css/site.css.*
- Notes: if the browser blocks the new tab, the room shows **Open the call** (allow pop-ups for the site once).
  While you're on hold, people who join are silent for you too.

## 1d. Meeting room: refined design (new)
- **Jitsi's marks removed:** the small gauge (Jitsi's video-quality badge) at the top of the video, and the "‹" arrow
  on its right edge (Jitsi's button for its thumbnail column) are switched off.
  The top bar now has its own **connection bars** next to "Encrypted" (green/amber/red, checked every 15 s; hover for the ms).
- **No tab row and no "›" button in the side panel.** The dock opens it: **People · Chat · Inbox** (with unread counts).
  The panel shows that view with a heading ("People 3 · In this call"); pressing the same button again closes it.
  Esc inside the panel closes it too; on a phone, tapping outside it does. P still shows/hides the panel, M opens Inbox.
- **Speaker tag:** bottom left of the video, the person talking with their initials and sound bars (stays while they talk).
- **Mute button:** green ring while your mic is on; it pulses while you're the one talking.
- **Your own camera:** a small bubble in a corner of the video (Jitsi's thumbnail column is gone, so you can see yourself).
  Drag it to any corner; × hides it ("Show my video" brings it back). Only when the browser has already allowed the camera
  for the site (no extra question), only while your camera is on; hidden in Grid (Jitsi shows you there) and on Hold.
- **Alone in the call:** "Ringing Meera Iyer…" with a timer (one-to-one calls) or "Waiting for others to join", with
  **Ring again** (rings the chat's people again), **Add people** and **Copy guest link**, plus a quick check:
  Mic on · Camera on · Network good. It goes as soon as someone joins.
- Grid still works: Jitsi's tiles are allowed while Grid is on, and switched off again afterwards.
*Files: Views/Meetings/Room.cshtml, wwwroot/js/room.js, wwwroot/css/site.css, Controllers/MeetingsController.cs and
Models/ViewModels.cs (who a one-to-one call is with), Hubs/ChatHub.cs (RingCallAgain).*

## 2. CSS / JS bundles (new)
The ~45 style and script tags of the layouts are now 5 bundles: `/bundles/layout.css`, `/bundles/controls.js`,
`/bundles/app.js` (workspace pages) and `/bundles/auth.css`, `/bundles/auth.js` (sign-in pages).
- Same files, same order, not minified (the server compresses them with Brotli); font/image links in CSS rewritten.
- Each URL carries a content hash (`?v=…`): cached for a year, fetched again only when a file in it changes.
  A changed file is picked up without a restart.
- Page-specific scripts (chat.js, history.js, meetings.js, Chart.js) stay separate files (partial loading needs that).
- Turn off for debugging: `"App": { "BundleAssets": false }` in appsettings serves the separate files again.
*Files: Infrastructure/AssetBundles.cs (new), Program.cs (/bundles endpoint), _Layout.cshtml, _AuthLayout.cshtml.*

## 3. Instant page changes (partial loading)
Links, rail tabs and forms load only the middle of the page (AJAX); the rail, top bar and live connection stay.
Same page animations as before (view transition in Edge/Chrome, CSS slide in Safari). Back/Forward work.
Rail pages are prefetched on hover. Each page's scripts run as on a full load, and everything they hook up
is removed when you leave the page.
*Files: wwwroot/js/sn-nav.js (new), _Layout.cshtml, _AuthLayout.cshtml, Program.cs (X-SN-Redirect),
site.js, shankhnaad.js, mobile.js, toast.js, chat.js, history.js, tab-control.js, report-sidebar.js,
modern-donut-chart.js, TagHelpers/ActionBtnTagHelper.cs.*

## 4. Safari / Mac / iPhone
- Smooth in Safari: no live blur (pre-frosted glass), still background, rounded corners kept, lighter
  meeting room effects. *safari.css, Room.cshtml*
- Pop-up windows invisible on iPhone (2 px high): fixed. *responsive.css*
- Long chat messages stay inside the bubble; reply quote shows "…". *site.css, shankhnaad.css*
- Server: CSS/JS compressed and cached by the browser. *Program.cs*

## 5. Meetings calendar
- Full day 00:00–24:00; only the calendar scrolls, header and side cards stay. *Index.cshtml, shankhnaad.css*
- Redesigned meeting cards: colour bar, title + time, Live badge, the 🗑 inside the card (centred on short
  meetings), weekend shading, current time next to the red line. Month view in the same style.
- Fixed: a second meeting on the same day showed at the wrong time (stacked under the first).
- Fixed: the red "now" line and the automatic Live / Upcoming / Ended refresh never ran (code was inside
  `<script src>`).
