# ShankhNaad · new features (rounds 45–53)

Run `database/99_ApplyAllUpdates.sql` once (it now goes 03 → 53), or the single scripts below in order.
Every feature stays quiet until its script is run: pages show "This needs the database update …".

| Script | Feature | Where people find it |
|---|---|---|
| 45_Shankh.sql | Shankh: urgent alert that rings until "Seen" | Admins: 🐚 in the top bar, or the profile menu |
| 46_Nirnay.sql | Decision log | ⚖ on a chat message · Meetings → Decisions · Work → Decisions |
| 47_Standup.sql | Async stand-up | Work → Stand-up (reminder at its time) |
| 48_StandIn.sql | Stand-in while out of office, "While you were away" | Out of office window · bar in the person's chat · window when you're back |
| 49_Roles.sql | Message a role, with escalation | Work → Roles |
| 50_Scheduling.sql | Holidays (smart scheduling) | Meetings → Schedule → under Availability |
| 51_Visitors.sql | Visitor lobby | Work → Visitors · reception tablet `/lobby/{code}` |
| 52_Approvals.sql | Approvals in chat | Work → Approvals · the card in chat |
| 53_Languages.sql | Saved translations and transcripts | 文A on a chat message · "Show text" on voice notes |

The rail has one new item, **Work**, with the sections Decisions, Stand-up, Approvals, Roles and Visitors.

## Background jobs (Program.cs)

* `ShankhReminders`: every minute, reminds managers of people who haven't pressed Seen.
* `WorkJobs`: every minute, sends stand-up reminders at each stand-up's time (the workspace's time zone), and escalates role requests nobody answered in time.

Keep the site warm (an uptime ping to `/health` every few minutes) so these jobs keep running on IIS.

## Languages: optional, costs money per use

Translation and voice-note transcripts use Azure AI services and are **off** until these keys are in `appsettings.json`:

```json
"Languages": {
  "TranslatorKey": "<Azure AI Translator key>",
  "TranslatorRegion": "centralindia",
  "SpeechKey": "<Azure AI Speech key>",
  "SpeechRegion": "centralindia",
  "SpeechLocales": "en-IN,hi-IN"
}
```

* Only the Translator keys → the 文A button appears on messages; people pick their language in the profile menu.
* Only the Speech keys → "Show text" appears under voice notes and audio files.
* Each translation and transcript is saved, so the same message is only paid for once.

## How things are routed

* **Approvals**: to the requester's manager (Org page). Expenses and purchases from the workspace amount (₹50,000 unless changed under Approvals → Rules) also go to the manager's manager. People with no manager: the approver set in Rules, else an admin. Approved leave turns on out of office for those days.
* **Roles**: to the first person in the role's list who is online and not out of office; else the first not away; else a stand-in. No reply within the role's minutes → their manager (or the next person in the role) gets it as a chat message from the person who asked.
* **Stand-up**: admins set stand-ups up for everyone or a department; a department's head can for their department. Blockers go to the person's manager and to whoever set it up.
* **Visitors**: the tablet link has a secret code (Work → Visitors → Set it up). "New link" makes the old one stop working. A visitor who was expected today and signs in with the same phone number is matched to that visit.
* **Smart scheduling**: working hours 9:30–18:30, weekdays, skipping holidays, your meetings and everyone invited's meetings and out of office.
