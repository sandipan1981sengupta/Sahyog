using System.Globalization;
using System.Net.Mail;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using ShankhNaad.DtoLibrary;
using ShankhNaad.Web.Hubs;
using ShankhNaad.Web.Infrastructure;
using ShankhNaad.Web.Models;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.ServiceLibrary.Video;

namespace ShankhNaad.Web.Controllers;

[Authorize, Route("meetings")]
public sealed class MeetingsController : Controller
{
    private readonly IMeetingService _meetings;
    private readonly IChatService _chat;
    private readonly ITenantService _tenants;
    private readonly IUserService _users;
    private readonly MeetingRoomTracker _rooms;
    private readonly IVideoProviderFactory _video;
    private readonly IHubContext<ChatHub> _hub;
    private readonly PresenceTracker _presence;
    private readonly ICallLogService _calls;

    public MeetingsController(IMeetingService meetings, IChatService chat, ITenantService tenants, IUserService users,
        MeetingRoomTracker rooms, IVideoProviderFactory video, IHubContext<ChatHub> hub, PresenceTracker presence, ICallLogService calls)
    {
        _calls = calls;
        _meetings = meetings;
        _chat = chat;
        _tenants = tenants;
        _users = users;
        _rooms = rooms;
        _video = video;
        _hub = hub;
        _presence = presence;
    }

    private Guid Me => User.UserGuid();

    private static readonly string[] Views = { "day", "week", "month", "agenda", "list" };

    /// <summary>How many days the Agenda page shows, starting from the chosen day.</summary>
    public const int AgendaDays = 7;

    /// <summary>
    /// Meetings page. view = day | week | month | list (the last one used is kept in the "sn-mview" cookie);
    /// date = any day inside the period to show. "week" is still accepted for older links.
    /// </summary>
    [HttpGet("")]
    public async Task<IActionResult> Index(DateOnly? week, DateOnly? date, string? view)
    {
        if (User.TenantId() is not Guid tenantId) return Redirect("/");
        return View(await BuildIndexAsync(tenantId, date ?? week, null, CurrentView(view)));
    }

    private string CurrentView(string? view = null)
    {
        var v = (view ?? Request.Cookies["sn-mview"] ?? "week").Trim().ToLowerInvariant();
        return Views.Contains(v) ? v : "week";
    }

    [HttpPost("schedule")]
    public async Task<IActionResult> Schedule([Bind(Prefix = "Form")] ScheduleMeetingInput input, [FromServices] IOutOfOfficeService ooo)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var zone = MeetingCalendar.FindZone(limits.TimeZoneId);
        var nowLocal = MeetingCalendar.ToLocal(DateTime.UtcNow, zone);

        // ---- repeat: which days, and until when ----
        byte repeatDays = 0;
        if (input.Recurrence == MeetingRecurrence.Custom)
        {
            foreach (var d in input.RepeatDays.Where(d => d is >= 0 and <= 6).Distinct())
                repeatDays |= MeetingCalendar.DayBit((DayOfWeek)d);
            if (repeatDays == 0)
                ModelState.AddModelError("Form.RepeatDays", "Pick at least one day to repeat on.");
        }
        // The first meeting is the first picked day on or after the chosen date
        // (e.g. date 1 Jan 2027 + Mon/Wed/Fri → Fri 1 Jan; date Sat 2 Jan → Mon 4 Jan).
        var firstDate = input.Date;
        if (input.Recurrence is MeetingRecurrence.Daily || repeatDays != 0)
        {
            for (var i = 0; i < 7 && !MeetingCalendar.Occurs(input.Recurrence, repeatDays, firstDate.DayOfWeek, firstDate.DayOfWeek); i++)
                firstDate = firstDate.AddDays(1);
        }
        DateOnly? lastDate = null;
        if (input.Recurrence != MeetingRecurrence.None && input.RepeatEnds)
        {
            if (input.RepeatUntil is not DateOnly until)
                ModelState.AddModelError("Form.RepeatUntilText", "Pick the last day the meeting repeats.");
            else if (until < firstDate)
                ModelState.AddModelError("Form.RepeatUntilText", $"The last day must be on or after the first meeting ({firstDate:d MMM yyyy}).");
            else if (until > firstDate.AddYears(1))
                ModelState.AddModelError("Form.RepeatUntilText", "A meeting can repeat for up to one year. Schedule it again for the next year.");
            else
                lastDate = until;
        }

        var startLocal = input.AllDay ? firstDate.ToDateTime(TimeOnly.MinValue) : firstDate.ToDateTime(input.Time);
        var duration = input.AllDay ? 24 * 60 : input.DurationMinutes;

        if (input.AllDay)
        {
            // an all-day block is a calendar entry, so the plan's meeting length does not apply to it
            if (firstDate < DateOnly.FromDateTime(nowLocal))
                ModelState.AddModelError("Form.DateText", "That day has already passed.");
            ModelState.Remove("Form.Time");
            ModelState.Remove("Form.DurationMinutes");
        }
        else
        {
            if (input.DurationMinutes > limits.MaxMeetingMinutes)
                ModelState.AddModelError("Form.DurationMinutes", $"Your {limits.PlanName} plan allows meetings up to {limits.MaxMeetingMinutes} minutes. Choose All day, or ask your admin for a bigger plan.");
            if (startLocal < nowLocal.AddMinutes(-5))
                ModelState.AddModelError("Form.Time", "That time has already passed.");
        }

        // you can't book yourself while you're out of office (whole days, or hours such as 4:00 pm – 5:00 pm)
        if ((await ooo.ListAsync(tenantId)).TryGetValue(Me.ToString(), out var away))
        {
            var meetStartUtc = MeetingCalendar.ToUtc(startLocal, zone);
            var meetEndUtc = meetStartUtc.AddMinutes(duration);
            var awayFrom = away.StartUtc ?? away.SinceUtc;
            if (awayFrom < meetEndUtc && (away.UntilUtc is null || away.UntilUtc > meetStartUtc))
                ModelState.AddModelError(input.AllDay ? "Form.DateText" : "Form.Time",
                    "You're out of office at this time. Pick another time, or change or turn off your out of office first.");
        }

        var guestEmails = new List<string>();
        foreach (var raw in (input.GuestEmails ?? "").Split(new[] { ',', ';', ' ', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries))
        {
            if (MailAddress.TryCreate(raw.Trim(), out var address)) guestEmails.Add(address.Address.ToLowerInvariant());
            else ModelState.AddModelError("Form.GuestEmails", $"'{raw}' is not a valid email address.");
        }
        if (guestEmails.Count > 25)
            ModelState.AddModelError("Form.GuestEmails", "Invite up to 25 guests per meeting.");

        if (!ModelState.IsValid)
            return View(nameof(Index), await BuildIndexAsync(tenantId, input.Date, input, CurrentView()));

        var meeting = new CreateMeetingRequest
        {
            TenantId = tenantId,
            Title = input.Title.Trim(),
            Agenda = input.Agenda?.Trim(),
            StartUtc = MeetingCalendar.ToUtc(startLocal, zone),
            DurationMinutes = duration,
            IsAllDay = input.AllDay,
            ShowAsFree = input.AllDay && string.Equals(input.ShowAs, "free", StringComparison.OrdinalIgnoreCase),
            Recurrence = input.Recurrence,
            RepeatDays = repeatDays,
            RepeatUntilUtc = lastDate is DateOnly last
                ? MeetingCalendar.ToUtc(input.AllDay ? last.ToDateTime(TimeOnly.MinValue) : last.ToDateTime(input.Time), zone)
                : null,
            RoomName = MeetingCalendar.NewRoomName(),
            GuestCode = MeetingCalendar.NewGuestCode(),
            HostId = Me,
            GuestLinkEnabled = input.GuestLinkEnabled,
            LobbyEnabled = input.LobbyEnabled,
            CaptionsOn = input.CaptionsOn,
            InviteeIds = input.InviteeIds.Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToList(),
            GuestEmails = guestEmails.Distinct().ToList()
        };
        await _meetings.CreateAsync(meeting);

        if (input.SendEmail)
        {
            var saved = await _meetings.GetAsync(tenantId, meeting.MeetingId);
            var invitees = await _meetings.GetInviteesAsync(tenantId, meeting.MeetingId);
            var host = await _users.GetByIdAsync(Me);
            if (saved is not null && host is not null)
                await _meetings.SendInvitesAsync(saved, invitees, host.DisplayName, host.Email, zone,
                    i => RespondUrl(tenantId, saved.MeetingId, i));   // each person gets their own Accept / Maybe / Decline buttons
        }

        TempData["ScheduledId"] = meeting.MeetingId.ToString();
        return RedirectToAction(nameof(Index), new { date = firstDate.ToString("yyyy-MM-dd") });
    }

    /// <summary>"Meet now" from a channel or DM: creates the meeting and rings everyone in it.</summary>
    [HttpPost("instant")]
    public async Task<IActionResult> Instant(Guid? channelId, Guid? userId)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        // "Call" next to a person in Chat: use (or create) your one-to-one chat with them
        if (channelId is null && userId is Guid other && other != Me)
            channelId = await _chat.GetOrCreateDirectAsync(tenantId, Me, other);
        var limits = (await _tenants.GetLimitsAsync(tenantId))!;

        var title = "Meeting";
        var others = new List<Guid>();
        if (channelId is Guid cid)
        {
            var channel = await _chat.GetChannelAsync(tenantId, cid);
            var members = await _chat.GetMembersAsync(tenantId, cid);
            if (channel is null || members.All(m => m.UserId != Me)) return Forbid();
            others = members.Where(m => m.UserId != Me).Select(m => m.UserId).ToList();
            // nobody to ring: tell the caller in the call ("Sandy isn't online right now…")
            var online = _presence.OnlineUsers(tenantId);
            var away = members.Where(m => m.UserId != Me && !online.Contains(m.UserId.ToString())).Select(m => m.DisplayName).ToList();
            if (away.Count > 0 && away.Count == others.Count)
                TempData["CallOffline"] = away.Count == 1 ? $"{away[0]} isn't online right now, so it won't ring. They'll see a missed call."
                                                          : "Nobody else is online right now, so it won't ring. They'll see a missed call.";
            title = channel.IsDirect
                ? $"Call with {members.FirstOrDefault(m => m.UserId != Me)?.DisplayName ?? "teammate"}"
                : $"{channel.Name} meeting";
        }

        // Call pressed again while this chat's call is still ringing or going on: ring the same call
        // again (no second card in the chat) and go back into it.
        if (channelId is Guid openIn && await _calls.GetOpenAsync(tenantId, openIn) is { } open
            && (open.Outcome == 0 || _rooms.Count(open.MeetingId) > 0))
        {
            if (open.Outcome == 0) await RingAsync(open.MeetingId, title, others);
            return RedirectToAction(nameof(Room), new { id = open.MeetingId });
        }

        var meeting = new CreateMeetingRequest
        {
            TenantId = tenantId,
            Title = title,
            StartUtc = DateTime.UtcNow,
            DurationMinutes = Math.Min(60, limits.MaxMeetingMinutes),
            RoomName = MeetingCalendar.NewRoomName(),
            GuestCode = MeetingCalendar.NewGuestCode(),
            HostId = Me,
            ChannelId = channelId,
            IsInstant = true,
            // a call between workspace members: no lobby, the person you call joins straight in
            LobbyEnabled = false,
            InviteeIds = others
        };
        await _meetings.CreateAsync(meeting);

        await _calls.StartAsync(tenantId, meeting.MeetingId, channelId, Me);

        if (channelId is Guid chan)
        {
            // shown in the chat as ONE call card that changes: Calling… → In progress · Join → Call ended · 4m 12s / Missed call
            var (status, posted) = await _chat.SendMessageAsync(new SendMessageRequest(tenantId, chan, Me, $"[[call:{meeting.MeetingId}]]"));
            if (status == SendStatus.Ok && posted is not null)
                await _hub.Clients.Group(ChatHub.ChannelGroup(chan)).SendAsync("MessageReceived", posted);
        }

        await RingAsync(meeting.MeetingId, title, others);
        return RedirectToAction(nameof(Room), new { id = meeting.MeetingId });
    }

    /// <summary>Shows the ringing card (with the ringtone) on every device of the people being called.</summary>
    private async Task RingAsync(Guid meetingId, string title, List<Guid> others)
    {
        if (others.Count == 0) return;
        var call = new IncomingCallDto(meetingId, title, User.DisplayName(), User.Initials(), User.AvatarTone(),
            Url.Action(nameof(Room), new { id = meetingId })!)
        {
            CallerId = Me.ToString()
        };
        await _hub.Clients.Users(others.Select(o => o.ToString()).ToList()).SendAsync("IncomingCall", call);
    }

    /// <summary>
    /// My meetings in the next 26 hours, for the reminders every page shows (js/meeting-alerts.js):
    /// a card with a chime 5 minutes before, and a ring when the meeting starts. Times are UTC (ISO).
    /// Meet-now calls and all-day entries are left out; "inIt" = I'm in that meeting right now.
    /// </summary>
    [HttpGet("upcoming")]
    public async Task<IActionResult> Upcoming()
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var zone = MeetingCalendar.FindZone(limits.TimeZoneId);
        var nowUtc = DateTime.UtcNow;
        var nowLocal = MeetingCalendar.ToLocal(nowUtc, zone);
        var (meetings, _) = await _meetings.ListForUserAsync(tenantId, Me, nowUtc.AddHours(-1), nowUtc.AddHours(26));
        meetings = await _meetings.WithExceptionsAsync(tenantId, meetings);     // moved / cancelled single dates
        var me = Me.ToString();
        var list = MeetingCalendar.Expand(meetings.Where(m => !m.IsInstant && !m.IsAllDay && !m.IsCancelled), nowLocal.AddMinutes(-10), nowLocal.AddHours(26), zone)
            .Where(o => o.EndLocal > nowLocal)
            .OrderBy(o => o.StartLocal)
            .Take(50)
            .Select(o => new
            {
                id = o.Meeting.MeetingId,
                title = o.Meeting.Title,
                startUtc = DateTime.SpecifyKind(MeetingCalendar.ToUtc(o.StartLocal, zone), DateTimeKind.Utc),
                endUtc = DateTime.SpecifyKind(MeetingCalendar.ToUtc(o.EndLocal, zone), DateTimeKind.Utc),
                host = o.Meeting.HostName,
                hostId = o.Meeting.HostId,
                hostInitials = Names.Initials(o.Meeting.HostName),
                hostTone = o.Meeting.HostTone,
                isHost = o.Meeting.HostId == Me,
                live = _rooms.Count(o.Meeting.MeetingId) > 0,
                inIt = _rooms.Contains(o.Meeting.MeetingId, me),
                roomUrl = $"/meetings/room/{o.Meeting.MeetingId}"
            });
        Response.Headers.CacheControl = "no-store";
        return Json(new { nowUtc = DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc), meetings = list });
    }

    /// <summary>The state of the calls behind call cards in a chat: /meetings/calls?ids=a,b,c</summary>
    [HttpGet("calls")]
    public async Task<IActionResult> Calls(string? ids)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var list = (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToList();
        var calls = await _calls.GetAsync(tenantId, list);
        // only calls in chats this person is in
        var mine = (await _chat.GetUserChannelIdsAsync(tenantId, Me)).ToHashSet();
        return Json(calls.Where(c => c.ChannelId is Guid ch && mine.Contains(ch)));
    }

    [HttpGet("room/{id:guid}")]
    public async Task<IActionResult> Room(Guid id)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var meeting = await _meetings.GetAsync(tenantId, id);
        if (meeting is null) return NotFound();
        if (meeting.IsCancelled)
        {
            TempData["MeetingError"] = $"“{meeting.Title}” was cancelled{(meeting.CancelledByName is null ? "" : " by " + meeting.CancelledByName)}, so it can't be joined.";
            return RedirectToAction(nameof(Index));
        }

        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        if (_rooms.Count(id) >= limits.MaxMeetingParticipants && !_rooms.Contains(id, Me.ToString()))
            return View("Full", limits);

        var provider = _video.Get(limits.VideoProvider);
        if (!provider.IsConfigured) { ViewData["Provider"] = provider.Name; return View("VideoNotConfigured"); }

        var isModerator = meeting.HostId == Me || User.IsInRole(AppRoles.TenantAdmin);
        var email = User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value;
        var join = provider.CreateJoin(new VideoJoinRequest(meeting.RoomName, Me.ToString(), User.DisplayName(), email, isModerator, limits.RecordingEnabled));
        var oneToOne = meeting.IsInstant && meeting.ChannelId is Guid callChat
            && await _chat.GetChannelAsync(tenantId, callChat) is { IsDirect: true };
        // who the one-to-one call is with (for "Ringing Sandy…" while you wait)
        var other = oneToOne ? (await _chat.GetMembersAsync(tenantId, meeting.ChannelId!.Value)).FirstOrDefault(m => m.UserId != Me) : null;

        return View(new RoomViewModel
        {
            MeetingId = meeting.MeetingId,
            Title = meeting.Title,
            Join = join,
            DisplayName = User.DisplayName(),
            Initials = User.Initials(),
            Tone = User.AvatarTone(),
            IsModerator = isModerator,
            IsGuest = false,
            LobbyEnabled = meeting.LobbyEnabled && !meeting.IsInstant,   // calls from Chat never use the lobby
            CaptionsOn = meeting.CaptionsOn,
            MaxVideoHeight = limits.MaxVideoHeight,
            MaxParticipants = limits.MaxMeetingParticipants,
            OneToOne = oneToOne,
            OfflineNote = TempData["CallOffline"] as string,
            LeaveUrl = meeting.ChannelId is Guid ch ? Url.Action("Index", "Chat", new { id = ch })! : Url.Action(nameof(Index))!,
            GuestUrl = meeting.GuestLinkEnabled ? _meetings.GuestUrl(meeting.GuestCode) : null,
            ChannelName = meeting.ChannelId is not null && !meeting.ChannelIsDirect ? meeting.ChannelName : null,
            ChatChannelId = meeting.ChannelId,
            CallWithName = other?.DisplayName,
            CallWithInitials = other?.Initials,
            CallWithTone = other?.AvatarTone ?? 0
        });
    }

    [HttpPost("{id:guid}/delete")]
    public async Task<IActionResult> Delete(Guid id, string? returnUrl)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var (status, startUtc) = await _meetings.DeleteAsync(tenantId, id, Me, User.IsInRole(AppRoles.TenantAdmin));
        if (status == DeleteMeetingStatus.NotFound) { TempData["MeetingMsg"] = "That meeting was already deleted."; return Redirect(SafeReturn(returnUrl)); }
        if (status == DeleteMeetingStatus.NotAllowed)
        {
            TempData["MeetingError"] = "Only the person who set up the meeting (or a workspace admin) can delete it.";
            return Redirect(SafeReturn(returnUrl));
        }
        TempData["MeetingMsg"] = "Meeting deleted.";
        if (!string.IsNullOrEmpty(returnUrl)) return Redirect(SafeReturn(returnUrl));

        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var local = MeetingCalendar.ToLocal(startUtc ?? DateTime.UtcNow, MeetingCalendar.FindZone(limits.TimeZoneId));
        return RedirectToAction(nameof(Index), new { week = WeekOf(DateOnly.FromDateTime(local)).ToString("yyyy-MM-dd") });
    }

    /// <summary>
    /// Cancels a meeting (a repeating meeting: every meeting in the series). It stays on everyone's calendar, marked
    /// cancelled, and everyone invited (team and guests) gets an email with a calendar cancellation.
    /// </summary>
    [HttpPost("{id:guid}/cancel")]
    public async Task<IActionResult> Cancel(Guid id, string? note, bool? sendEmail, string? returnUrl)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        note = (note ?? "").Trim();
        if (note.Length > 500) note = note[..500];
        var status = await _meetings.CancelAsync(tenantId, id, Me, User.IsInRole(AppRoles.TenantAdmin), note);
        switch (status)
        {
            case CancelMeetingStatus.NotFound: TempData["MeetingMsg"] = "That meeting was already deleted."; return Redirect(SafeReturn(returnUrl));
            case CancelMeetingStatus.NotAllowed: TempData["MeetingError"] = "Only the person who set up the meeting (or a workspace admin) can cancel it."; return Redirect(SafeReturn(returnUrl));
            case CancelMeetingStatus.AlreadyCancelled: TempData["MeetingMsg"] = "That meeting is already cancelled."; return Redirect(SafeReturn(returnUrl));
            case CancelMeetingStatus.NeedsDatabase: TempData["MeetingError"] = "Cancelling meetings needs a database update (34_MeetingCancel.sql). Ask your administrator."; return Redirect(SafeReturn(returnUrl));
        }

        var meeting = await _meetings.GetAsync(tenantId, id);
        var series = meeting is not null && meeting.Recurrence != MeetingRecurrence.None;
        var mailed = 0;
        if (meeting is not null && sendEmail != false)
        {
            var limits = (await _tenants.GetLimitsAsync(tenantId))!;
            var invitees = await _meetings.GetInviteesAsync(tenantId, id);
            var me = await _users.GetByIdAsync(Me);
            var host = meeting.HostId == Me ? me : await _users.GetByIdAsync(meeting.HostId);
            mailed = await _meetings.SendCancellationAsync(meeting, invitees, me?.DisplayName ?? User.DisplayName(), host?.Email ?? "",
                MeetingCalendar.FindZone(limits.TimeZoneId), note.Length == 0 ? null : note);
        }
        // calendars that are open refresh themselves
        await _hub.Clients.Group(ChatHub.TenantGroup(tenantId)).SendAsync("MeetingsChanged", id.ToString());

        TempData["MeetingMsg"] = (series ? "The meeting series is cancelled (every meeting in it)." : "Meeting cancelled.")
            + (mailed > 0 ? $" {mailed} {(mailed == 1 ? "person was" : "people were")} emailed." : "")
            + " It stays on calendars marked as cancelled until each person removes it.";
        return Redirect(SafeReturn(returnUrl));
    }

    /// <summary>Removes a cancelled meeting from my own calendar (anyone invited, or the host).</summary>
    [HttpPost("{id:guid}/hide")]
    public async Task<IActionResult> Hide(Guid id, string? returnUrl)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var status = await _meetings.HideAsync(tenantId, id, Me);
        TempData[status == HideMeetingStatus.Ok ? "MeetingMsg" : "MeetingError"] = status switch
        {
            HideMeetingStatus.Ok => "Removed from your calendar.",
            HideMeetingStatus.NotCancelled => "Only cancelled meetings can be removed from your calendar. Ask the host to cancel it.",
            HideMeetingStatus.NeedsDatabase => "This needs a database update (34_MeetingCancel.sql). Ask your administrator.",
            _ => "That meeting isn't on your calendar any more."
        };
        return Redirect(SafeReturn(returnUrl));
    }

    // ---------- changing a meeting after it's scheduled: cancel one date · move (drag and drop) · edit ----------

    // "2026-11-23" (links, the calendar) or "23-11-2026" (the date picker)
    private static readonly string[] DayFormats = { "yyyy-MM-dd", "dd-MM-yyyy" };
    private static DateOnly? ParseIsoDay(string? s) =>
        DateOnly.TryParseExact((s ?? "").Trim(), DayFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    private static TimeOnly? ParseTime(string? s) =>
        TimeOnly.TryParseExact((s ?? "").Trim(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t) ? t : null;

    /// <summary>Where one date of a meeting is now: its planned start, or where it was moved to.</summary>
    private static (DateTime StartLocal, int Minutes) CurrentDate(MeetingDto m, DateOnly date, TimeZoneInfo zone)
    {
        var x = m.Exceptions.FirstOrDefault(e => e.OccurrenceDate == date);
        if (x?.NewStartUtc is DateTime moved) return (MeetingCalendar.ToLocal(moved, zone), x.NewDurationMinutes ?? m.DurationMinutes);
        var first = MeetingCalendar.ToLocal(m.StartUtc, zone);
        return (date.ToDateTime(TimeOnly.FromTimeSpan(first.TimeOfDay)), m.DurationMinutes);
    }

    private string? ChangeError(MeetingChangeStatus status) => status switch
    {
        MeetingChangeStatus.Ok => null,
        MeetingChangeStatus.NotFound => "That meeting was deleted.",
        MeetingChangeStatus.NotAllowed => "Only the person who set up the meeting (or a workspace admin) can change it.",
        MeetingChangeStatus.Cancelled => "That meeting is cancelled, so it can't be changed.",
        MeetingChangeStatus.NotRepeating => "That isn't a repeating meeting.",
        _ => "Changing meetings needs a database update (35_MeetingChanges.sql). Ask your administrator."
    };

    /// <summary>The changed meeting, its people and the emails. Everyone's open calendar refreshes.</summary>
    private async Task<int> AfterChangeAsync(Guid tenantId, Guid id, TimeZoneInfo zone, bool sendEmail, MeetingChangeKind kind,
        DateTime oldStart, int oldMinutes, DateTime newStart, int newMinutes, DateOnly? date, string? note)
    {
        var mailed = 0;
        var meeting = await _meetings.GetAsync(tenantId, id);
        if (meeting is not null && sendEmail)
        {
            var invitees = await _meetings.GetInviteesAsync(tenantId, id);
            var me = await _users.GetByIdAsync(Me);
            var host = meeting.HostId == Me ? me : await _users.GetByIdAsync(meeting.HostId);
            mailed = await _meetings.SendChangeAsync(meeting, invitees, me?.DisplayName ?? User.DisplayName(), host?.Email ?? "", zone,
                kind, oldStart, oldMinutes, newStart, newMinutes, date, string.IsNullOrWhiteSpace(note) ? null : note.Trim());
        }
        await _hub.Clients.Group(ChatHub.TenantGroup(tenantId)).SendAsync("MeetingsChanged", id.ToString());
        return mailed;
    }

    private static string Mailed(int n) => n > 0 ? $" {n} {(n == 1 ? "person was" : "people were")} emailed." : "";

    /// <summary>Cancels one date of a repeating meeting (it disappears from everyone's calendar; everyone invited is emailed).</summary>
    [HttpPost("{id:guid}/occurrence/cancel")]
    public async Task<IActionResult> CancelDate(Guid id, string? date, string? note, bool? sendEmail, string? returnUrl)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var meeting = await _meetings.GetAsync(tenantId, id);
        if (meeting is null) { TempData["MeetingMsg"] = "That meeting was already deleted."; return Redirect(SafeReturn(returnUrl)); }
        if (meeting.Recurrence == MeetingRecurrence.None) return await Cancel(id, note, sendEmail, returnUrl);   // a one-off meeting: cancel it

        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var zone = MeetingCalendar.FindZone(limits.TimeZoneId);
        meeting = (await _meetings.WithExceptionsAsync(tenantId, new[] { meeting }))[0];
        if (ParseIsoDay(date) is not DateOnly day || !MeetingCalendar.IsOccurrenceDate(meeting, day, zone))
        {
            TempData["MeetingError"] = "That date isn't one of this meeting's dates.";
            return Redirect(SafeReturn(returnUrl));
        }
        var (start, minutes) = CurrentDate(meeting, day, zone);
        var status = await _meetings.SetExceptionAsync(tenantId, id, Me, User.IsInRole(AppRoles.TenantAdmin), day, true, null, null);
        if (ChangeError(status) is string err) { TempData["MeetingError"] = err; return Redirect(SafeReturn(returnUrl)); }

        var mailed = await AfterChangeAsync(tenantId, id, zone, sendEmail != false, MeetingChangeKind.DateCancelled, start, minutes, start, minutes, day, note);
        TempData["MeetingMsg"] = $"“{meeting.Title}” on {start:ddd d MMM} is cancelled. The rest of the series stays." + Mailed(mailed);
        return Redirect(SafeReturn(returnUrl));
    }

    /// <summary>
    /// Moves a meeting (drag and drop on the calendar). A repeating meeting: only that date moves.
    /// start = the new local start "yyyy-MM-ddTHH:mm"; date = the date it was planned for (repeating meetings).
    /// </summary>
    [HttpPost("{id:guid}/move")]
    public async Task<IActionResult> Move(Guid id, string? date, string? start, int? minutes, bool? sendEmail, string? note,
        [FromServices] IOutOfOfficeService ooo)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var meeting = await _meetings.GetAsync(tenantId, id);
        if (meeting is null) return NotFound(new { error = "That meeting was deleted." });
        if (meeting.IsCancelled) return BadRequest(new { error = "That meeting is cancelled, so it can't be moved." });
        if (meeting.HostId != Me && !User.IsInRole(AppRoles.TenantAdmin)) return BadRequest(new { error = "Only the person who set up the meeting (or a workspace admin) can move it." });

        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var zone = MeetingCalendar.FindZone(limits.TimeZoneId);
        meeting = (await _meetings.WithExceptionsAsync(tenantId, new[] { meeting }))[0];
        if (!DateTime.TryParseExact((start ?? "").Trim(), "yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var newStart))
            return BadRequest(new { error = "Pick where to move it." });

        var series = meeting.Recurrence != MeetingRecurrence.None;
        var day = series ? ParseIsoDay(date) : DateOnly.FromDateTime(MeetingCalendar.ToLocal(meeting.StartUtc, zone));
        if (day is not DateOnly occ || !MeetingCalendar.IsOccurrenceDate(meeting, occ, zone)) return BadRequest(new { error = "That date isn't one of this meeting's dates." });
        var (oldStart, oldMinutes) = CurrentDate(meeting, occ, zone);
        var newMinutes = Math.Clamp(minutes ?? oldMinutes, 15, meeting.IsAllDay ? 1440 : limits.MaxMeetingMinutes);
        if (meeting.IsAllDay) { newStart = newStart.Date; newMinutes = 1440; }        // an all-day meeting moves to another day

        var nowLocal = MeetingCalendar.ToLocal(DateTime.UtcNow, zone);
        if (newStart == oldStart && newMinutes == oldMinutes) return Json(new { ok = true, message = "Nothing changed." });
        if ((meeting.IsAllDay ? newStart.AddDays(1) : newStart) < nowLocal.AddMinutes(-1)) return BadRequest(new { error = "That time has already passed. Drop it on a time from now on." });

        var newStartUtc = MeetingCalendar.ToUtc(newStart, zone);
        if ((await ooo.ListAsync(tenantId)).TryGetValue(Me.ToString(), out var away))
        {
            var awayFrom = away.StartUtc ?? away.SinceUtc;
            if (awayFrom < newStartUtc.AddMinutes(newMinutes) && (away.UntilUtc is null || away.UntilUtc > newStartUtc))
                return BadRequest(new { error = "You're out of office then. Pick another time, or change your out of office first." });
        }

        var isAdmin = User.IsInRole(AppRoles.TenantAdmin);
        var status = series
            ? await _meetings.SetExceptionAsync(tenantId, id, Me, isAdmin, occ, false, newStartUtc, newMinutes == meeting.DurationMinutes ? null : newMinutes)
            : await _meetings.UpdateAsync(tenantId, id, Me, isAdmin, meeting.Title, meeting.Agenda, newStartUtc, newMinutes, true);
        if (ChangeError(status) is string err) return BadRequest(new { error = err });

        var mailed = await AfterChangeAsync(tenantId, id, zone, sendEmail != false, series ? MeetingChangeKind.DateMoved : MeetingChangeKind.Moved,
            oldStart, oldMinutes, newStart, newMinutes, occ, note);
        var msg = $"“{meeting.Title}” moved to {newStart:ddd d MMM}{(meeting.IsAllDay ? "" : $", {newStart:HH:mm}")}{(series ? " (only this date)" : "")}." + Mailed(mailed);
        TempData["MeetingMsg"] = msg;
        return Json(new { ok = true, message = msg });
    }

    /// <summary>
    /// Edits a meeting. scope "series": title, agenda, first date, start time, length of the meeting (every date of a repeating one).
    /// scope "date": only one date of a repeating meeting moves (date = the date it was planned for).
    /// </summary>
    [HttpPost("{id:guid}/edit")]
    public async Task<IActionResult> Edit(Guid id, string? scope, string? date, string? title, string? agenda, string? day, string? time, int? minutes,
        bool? sendEmail, string? note, string? returnUrl, [FromServices] IOutOfOfficeService ooo)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        IActionResult Fail(string error) { TempData["MeetingError"] = error; return Redirect(SafeReturn(returnUrl)); }

        var meeting = await _meetings.GetAsync(tenantId, id);
        if (meeting is null) return Fail("That meeting was deleted.");
        if (meeting.IsCancelled) return Fail("That meeting is cancelled, so it can't be changed.");
        var series = meeting.Recurrence != MeetingRecurrence.None;
        var onlyDate = series && scope == "date";
        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var zone = MeetingCalendar.FindZone(limits.TimeZoneId);
        meeting = (await _meetings.WithExceptionsAsync(tenantId, new[] { meeting }))[0];

        if (ParseIsoDay(day) is not DateOnly newDay) return Fail("Pick a date.");
        var newTime = meeting.IsAllDay ? TimeOnly.MinValue : ParseTime(time);
        if (newTime is null) return Fail("Pick a start time.");
        var newMinutes = meeting.IsAllDay ? 1440 : minutes ?? meeting.DurationMinutes;
        if (newMinutes < 15) return Fail("A meeting is at least 15 minutes.");
        if (newMinutes > limits.MaxMeetingMinutes && !meeting.IsAllDay)
            return Fail($"Your {limits.PlanName} plan allows meetings up to {limits.MaxMeetingMinutes} minutes.");
        var newStart = newDay.ToDateTime(newTime.Value);
        var nowLocal = MeetingCalendar.ToLocal(DateTime.UtcNow, zone);
        var newStartUtc = MeetingCalendar.ToUtc(newStart, zone);

        DateTime oldStart; int oldMinutes; DateOnly? occ = null;
        if (onlyDate)
        {
            if (ParseIsoDay(date) is not DateOnly d || !MeetingCalendar.IsOccurrenceDate(meeting, d, zone)) return Fail("That date isn't one of this meeting's dates.");
            occ = d;
            (oldStart, oldMinutes) = CurrentDate(meeting, d, zone);
        }
        else
        {
            oldStart = MeetingCalendar.ToLocal(meeting.StartUtc, zone);
            oldMinutes = meeting.DurationMinutes;
        }
        var timeChanged = newStart != oldStart || newMinutes != oldMinutes;
        // a single meeting (or one date) can't move into the past; a series may keep a first date that has passed
        if (timeChanged && (!series || onlyDate) && newStart < nowLocal.AddMinutes(-1)) return Fail("That time has already passed. Pick a time from now on.");
        if (timeChanged && (await ooo.ListAsync(tenantId)).TryGetValue(Me.ToString(), out var away) && (!series || onlyDate))
        {
            var awayFrom = away.StartUtc ?? away.SinceUtc;
            if (awayFrom < newStartUtc.AddMinutes(newMinutes) && (away.UntilUtc is null || away.UntilUtc > newStartUtc))
                return Fail("You're out of office then. Pick another time, or change your out of office first.");
        }

        var isAdmin = User.IsInRole(AppRoles.TenantAdmin);
        MeetingChangeStatus status;
        if (onlyDate)
            status = await _meetings.SetExceptionAsync(tenantId, id, Me, isAdmin, occ!.Value, false, newStartUtc, newMinutes == meeting.DurationMinutes ? null : newMinutes);
        else
        {
            var cleanTitle = (title ?? "").Trim();
            if (cleanTitle.Length == 0) return Fail("Give the meeting a title.");
            if (cleanTitle.Length > 150) cleanTitle = cleanTitle[..150];
            var cleanAgenda = (agenda ?? "").Trim();
            if (cleanAgenda.Length > 2000) cleanAgenda = cleanAgenda[..2000];
            // moved to another weekday: the single-date changes no longer line up, so they're all cleared
            status = await _meetings.UpdateAsync(tenantId, id, Me, isAdmin, cleanTitle, cleanAgenda, newStartUtc, newMinutes, newStart.DayOfWeek == oldStart.DayOfWeek);
        }
        if (ChangeError(status) is string err) return Fail(err);

        var kind = onlyDate ? MeetingChangeKind.DateMoved : MeetingChangeKind.Edited;
        var mailed = await AfterChangeAsync(tenantId, id, zone, sendEmail != false, kind, oldStart, oldMinutes, newStart, newMinutes, occ, note);
        TempData["MeetingMsg"] = (onlyDate ? $"“{meeting.Title}” on {oldStart:ddd d MMM} moved to {newStart:ddd d MMM, HH:mm} (only this date)."
            : series ? "The whole series is updated." + (timeChanged ? " Dates that had been moved one by one are back on the series time." : "")
            : "Meeting updated.") + Mailed(mailed);
        return Redirect(SafeReturn(returnUrl));
    }

    // ---------- who's coming: the details window, and Accept / Maybe / Decline ----------

    private IDataProtector RsvpProtector =>
        HttpContext.RequestServices.GetRequiredService<IDataProtectionProvider>().CreateProtector("ShankhNaad.MeetingResponse.v1");

    /// <summary>A person's own answer link for emails (works without signing in): /meetings/respond/{token}.</summary>
    private string? RespondUrl(Guid tenantId, Guid meetingId, InviteeDto i)
    {
        var key = i.UserId is Guid u ? MeetingResponseDto.KeyOf(u) : string.IsNullOrWhiteSpace(i.GuestEmail) ? null : MeetingResponseDto.KeyOf(i.GuestEmail);
        if (key is null) return null;
        var token = RsvpProtector.Protect($"{tenantId:N}|{meetingId:N}|{key}");
        var root = (HttpContext.RequestServices.GetRequiredService<IOptions<AppOptions>>().Value.PublicBaseUrl ?? "").TrimEnd('/');
        if (root.Length == 0) root = $"{Request.Scheme}://{Request.Host}";
        return $"{root}/meetings/respond/{token}";
    }

    private static MeetingResponse ParseAnswer(string? r) => (r ?? "").Trim().ToLowerInvariant() switch
    {
        "yes" or "accept" or "accepted" or "1" => MeetingResponse.Accepted,
        "maybe" or "tentative" or "2" => MeetingResponse.Maybe,
        "no" or "decline" or "declined" or "3" => MeetingResponse.Declined,
        _ => MeetingResponse.None
    };

    /// <summary>Everything the details window shows for one date of a meeting (date null: a one-off meeting, or the next date of a series).</summary>
    private async Task<MeetingDetailsVm?> BuildDetailsAsync(Guid tenantId, Guid id, string? date, bool fullPage)
    {
        var meeting = await _meetings.GetAsync(tenantId, id);
        if (meeting is null) return null;
        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var zone = MeetingCalendar.FindZone(limits.TimeZoneId);
        meeting = (await _meetings.WithExceptionsAsync(tenantId, new[] { meeting }))[0];
        var nowLocal = MeetingCalendar.ToLocal(DateTime.UtcNow, zone);
        var series = meeting.Recurrence != MeetingRecurrence.None;

        DateOnly occ;
        if (ParseIsoDay(date) is DateOnly asked && MeetingCalendar.IsOccurrenceDate(meeting, asked, zone)) occ = asked;
        else if (!series) occ = DateOnly.FromDateTime(MeetingCalendar.ToLocal(meeting.StartUtc, zone));
        else
        {
            // a series: the next date that isn't over yet (or its first date)
            var next = MeetingCalendar.Expand(new[] { meeting }, nowLocal.Date, nowLocal.Date.AddDays(400), zone)
                .Where(o => o.EndLocal > nowLocal).OrderBy(o => o.StartLocal).FirstOrDefault();
            occ = next?.OccurrenceDate ?? DateOnly.FromDateTime(MeetingCalendar.ToLocal(meeting.StartUtc, zone));
        }
        var (start, minutes) = CurrentDate(meeting, occ, zone);
        var end = start.AddMinutes(minutes);
        var dateCancelled = meeting.Exceptions.Any(x => x.OccurrenceDate == occ && x.IsCancelled);

        var invitees = await _meetings.GetInviteesAsync(tenantId, id);
        var answers = await _meetings.GetResponsesAsync(tenantId, new[] { id });
        var online = _presence.OnlineUsers(tenantId);
        var people = new List<MeetingPersonVm>
        {
            new(MeetingResponseDto.KeyOf(meeting.HostId), meeting.HostName, Names.Initials(meeting.HostName), meeting.HostTone, false, true,
                online.Contains(meeting.HostId.ToString()), MeetingResponse.Accepted, null, null)
        };
        foreach (var i in invitees)
        {
            if (i.UserId is Guid u)
            {
                if (u == meeting.HostId) continue;
                var key = MeetingResponseDto.KeyOf(u);
                var a = MeetingResponseDto.For(answers, key, occ);
                var name = i.DisplayName ?? "Team member";
                people.Add(new(key, name, Names.Initials(name), i.AvatarTone ?? 0, false, false, online.Contains(u.ToString()),
                    a?.Response ?? MeetingResponse.None, a?.Note, a?.RespondedUtc));
            }
            else if (!string.IsNullOrWhiteSpace(i.GuestEmail))
            {
                var key = MeetingResponseDto.KeyOf(i.GuestEmail);
                var a = MeetingResponseDto.For(answers, key, occ);
                people.Add(new(key, i.GuestEmail, Names.Initials(i.GuestEmail), 7, true, false, false, a?.Response ?? MeetingResponse.None, a?.Note, a?.RespondedUtc));
            }
        }
        var me = MeetingResponseDto.KeyOf(Me);
        var isHost = meeting.HostId == Me;
        var invited = people.Any(p => p.Key == me && !p.IsHost);
        var status = meeting.IsCancelled || dateCancelled ? "Cancelled" : end <= nowLocal ? "Ended" : start <= nowLocal || _rooms.Count(id) > 0 ? "Live" : "Upcoming";
        return new MeetingDetailsVm
        {
            MeetingId = id,
            Title = meeting.Title,
            Agenda = meeting.Agenda,
            OccurrenceDate = occ,
            StartLocal = start,
            EndLocal = end,
            IsAllDay = meeting.IsAllDay,
            Repeat = MeetingCalendar.DescribeRepeat(meeting, zone),
            IsMoved = meeting.Exceptions.Any(x => x.OccurrenceDate == occ && x.NewStartUtc is not null),
            DateCancelled = dateCancelled,
            IsCancelled = meeting.IsCancelled,
            CancelledBy = meeting.CancelledByName,
            CancelNote = meeting.CancelNote,
            HostName = meeting.HostName,
            IsHost = isHost,
            CanManage = (isHost || User.IsInRole(AppRoles.TenantAdmin)) && !meeting.IsCancelled && end > nowLocal,
            Status = status,
            InRoom = _rooms.Count(id),
            MyResponse = people.FirstOrDefault(p => p.Key == me && !p.IsHost)?.Response ?? MeetingResponse.None,
            MyNote = people.FirstOrDefault(p => p.Key == me && !p.IsHost)?.Note,
            CanRespond = invited && !meeting.IsCancelled && !dateCancelled && end > nowLocal,
            People = people,
            FullPage = fullPage
        };
    }

    /// <summary>The details window (the calendar loads it when you click a meeting).</summary>
    [HttpGet("{id:guid}/details")]
    public async Task<IActionResult> Details(Guid id, string? date)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var vm = await BuildDetailsAsync(tenantId, id, date, false);
        if (vm is null) return Content("<p class=\"muted\" style=\"padding:24px\">That meeting was deleted.</p>", "text/html");
        Response.Headers.CacheControl = "no-store";
        return PartialView("_MeetingDetails", vm);
    }

    /// <summary>The same details as a page of its own (e.g. a link from an email).</summary>
    [HttpGet("{id:guid}/view")]
    public async Task<IActionResult> ViewPage(Guid id, string? date)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var vm = await BuildDetailsAsync(tenantId, id, date, true);
        if (vm is null) { TempData["MeetingError"] = "That meeting was deleted."; return RedirectToAction(nameof(Index)); }
        ViewData["Section"] = "meetings";
        ViewData["Title"] = vm.Title;
        return View("Details", vm);
    }

    /// <summary>My answer from the app. scope "date" (only that date of a series) or "all".</summary>
    [HttpPost("{id:guid}/respond")]
    public async Task<IActionResult> Respond(Guid id, string? response, string? date, string? scope, string? note)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var answer = ParseAnswer(response);
        if (answer == MeetingResponse.None) return BadRequest(new { error = "Pick Accept, Maybe or Decline." });
        var meeting = await _meetings.GetAsync(tenantId, id);
        if (meeting is null) return BadRequest(new { error = "That meeting was deleted." });
        DateOnly? day = meeting.Recurrence != MeetingRecurrence.None && scope == "date" ? ParseIsoDay(date) : null;
        var status = await _meetings.SetResponseAsync(tenantId, id, Me, null, day, answer, note);
        if (status != RespondStatus.Ok)
            return BadRequest(new { error = status switch
            {
                RespondStatus.NotInvited => "You're not invited to this meeting.",
                RespondStatus.NeedsDatabase => "Answers need a database update (36_MeetingResponses.sql). Ask your administrator.",
                _ => "That meeting was deleted."
            } });
        // the organizer sees it straight away, with the reason (a pop-up, and their calendar / details refresh)
        var reason = string.IsNullOrWhiteSpace(note) ? "" : note.Trim();
        if (reason.Length > 300) reason = reason[..300];
        await _hub.Clients.User(meeting.HostId.ToString()).SendAsync("MeetingResponse", id.ToString(), User.DisplayName(), (int)answer,
            reason, meeting.Title, day is DateOnly forDay ? forDay.ToString("ddd d MMM", CultureInfo.InvariantCulture) : meeting.Recurrence != MeetingRecurrence.None ? "every date" : "");
        await _hub.Clients.Group(ChatHub.TenantGroup(tenantId)).SendAsync("MeetingsChanged", id.ToString());
        var word = answer switch { MeetingResponse.Accepted => "accepted", MeetingResponse.Maybe => "said maybe to", _ => "declined" };
        return Json(new { ok = true, message = $"You {word} “{meeting.Title}”{(day is DateOnly d ? $" on {d:ddd d MMM}" : meeting.Recurrence != MeetingRecurrence.None ? " (every date)" : "")}." });
    }

    /// <summary>
    /// Accept / Maybe / Decline from an invite email (no sign-in: the link carries a signed token).
    /// The page saves the answer with a small form post (so link checkers that only open links don't answer for you).
    /// </summary>
    [AllowAnonymous, HttpGet("respond/{token}")]
    public async Task<IActionResult> RespondLink(string token, string? r) => View("Respond", await RespondVmAsync(token, ParseAnswer(r), false));

    [AllowAnonymous, HttpPost("respond/{token}"), ValidateAntiForgeryToken]
    public async Task<IActionResult> RespondLinkSave(string token, string? r) => View("Respond", await RespondVmAsync(token, ParseAnswer(r), true));

    private async Task<MeetingRespondVm> RespondVmAsync(string token, MeetingResponse chosen, bool save)
    {
        string[] parts;
        try { parts = RsvpProtector.Unprotect(token).Split('|', 3); }
        catch { return new MeetingRespondVm { Token = token, Error = "This answer link isn't valid. Ask the person who invited you for a new invitation." }; }
        if (parts.Length != 3 || !Guid.TryParse(parts[0], out var tenantId) || !Guid.TryParse(parts[1], out var meetingId))
            return new MeetingRespondVm { Token = token, Error = "This answer link isn't valid." };
        var key = parts[2];
        var meeting = await _meetings.GetAsync(tenantId, meetingId);
        if (meeting is null) return new MeetingRespondVm { Token = token, Error = "This meeting was deleted." };
        if (meeting.IsCancelled) return new MeetingRespondVm { Token = token, Title = meeting.Title, HostName = meeting.HostName, Error = "This meeting was cancelled." };

        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var zone = MeetingCalendar.FindZone(limits.TimeZoneId);
        var startLocal = MeetingCalendar.ToLocal(meeting.StartUtc, zone);
        var repeat = MeetingCalendar.DescribeRepeat(meeting, zone);
        var when = (meeting.IsAllDay ? $"{startLocal:dddd, d MMMM yyyy} · All day" : $"{startLocal:dddd, d MMMM yyyy} · {startLocal:h:mm tt} – {startLocal.AddMinutes(meeting.DurationMinutes):h:mm tt}")
                   + (repeat is null ? "" : " · " + repeat);
        Guid? userId = key.StartsWith("g:", StringComparison.Ordinal) ? null : Guid.TryParse(key, out var u) ? u : null;
        var guest = userId is null && key.StartsWith("g:", StringComparison.Ordinal) ? key[2..] : null;
        var invitees = await _meetings.GetInviteesAsync(tenantId, meetingId);
        var person = userId is Guid uid ? invitees.FirstOrDefault(i => i.UserId == uid)?.DisplayName : guest;

        var saved = false;
        string? error = null;
        if (save && chosen != MeetingResponse.None)
        {
            var status = await _meetings.SetResponseAsync(tenantId, meetingId, userId, guest, null, chosen, null);
            saved = status == RespondStatus.Ok;
            if (!saved) error = status == RespondStatus.NotInvited ? "You're no longer invited to this meeting." : "Your answer couldn't be saved. Try again later.";
            if (saved)
            {
                await _hub.Clients.User(meeting.HostId.ToString()).SendAsync("MeetingResponse", meetingId.ToString(), person ?? "Someone", (int)chosen,
                    "", meeting.Title, repeat is null ? "" : "every date");
                await _hub.Clients.Group(ChatHub.TenantGroup(tenantId)).SendAsync("MeetingsChanged", meetingId.ToString());
            }
        }
        var current = MeetingResponseDto.For(await _meetings.GetResponsesAsync(tenantId, new[] { meetingId }), key, null)?.Response ?? MeetingResponse.None;
        return new MeetingRespondVm
        {
            Token = token,
            Title = meeting.Title,
            When = when,
            HostName = meeting.HostName,
            PersonName = person ?? "",
            IsSeries = repeat is not null,
            Current = current,
            Chosen = chosen,
            Saved = saved,
            Error = error,
            JoinUrl = userId is not null ? _meetings.RoomUrl(meetingId) : meeting.GuestLinkEnabled ? _meetings.GuestUrl(meeting.GuestCode) : null
        };
    }

    // ---------- files shared in a call's chat ----------

    /// <summary>Shares a file in the call's chat (everyone in the call sees it; it counts toward storage).</summary>
    [HttpPost("{id:guid}/chat/file")]
    [RequestSizeLimit(200L * 1024 * 1024)]
    public async Task<IActionResult> CallChatFile(Guid id, IFormFile file,
        [FromServices] ICallChatService callChat, [FromServices] IFileStorage files, [FromServices] Microsoft.Extensions.Options.IOptions<StorageOptions> storage)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        if (file is null || file.Length == 0) return BadRequest(new { error = "Choose a file to share." });
        var maxMb = storage.Value.MaxUploadMb;
        if (file.Length > maxMb * 1024L * 1024L) return BadRequest(new { error = $"Files can be up to {maxMb} MB." });
        if (!_rooms.Contains(id, Me.ToString())) return BadRequest(new { error = "Join the call to share files." });

        string path;
        await using (var stream = file.OpenReadStream())
            path = await files.SaveAsync(tenantId, stream, Path.GetExtension(file.FileName), HttpContext.RequestAborted);
        var contentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType;
        var (status, message) = await callChat.AddAsync(tenantId, id, Me, User.DisplayName(), User.AvatarTone(), null,
            Guid.NewGuid(), Path.GetFileName(file.FileName), contentType, file.Length, path);
        if (status != 0 || message is null)
        {
            files.Delete(path);
            return BadRequest(new { error = status switch
            {
                2 => "Storage full. Ask your admin to upgrade the plan.",
                9 => "Run database/25_CallChat.sql (or 99_ApplyAllUpdates.sql) to share files in calls.",
                _ => "Couldn't share the file."
            } });
        }
        await _hub.Clients.Group(ChatHub.MeetingGroup(id)).SendAsync("CallChat", message);
        return Json(message);
    }

    /// <summary>Downloads (or shows) a file shared in a call. Anyone in the workspace who was given the link.</summary>
    [HttpGet("chat/file/{fileId:guid}")]
    public async Task<IActionResult> CallChatDownload(Guid fileId, [FromServices] ICallChatService callChat, [FromServices] IFileStorage files, [FromServices] ILogger<MeetingsController> log)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var f = await callChat.GetFileAsync(tenantId, fileId);
        if (f is null) return NotFound();
        var inline = f.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) || f.ContentType == "application/pdf";
        Stream stream;
        try { stream = files.OpenRead(f.StoragePath); }
        catch (Exception ex) when (MissingFile.Is(ex)) { return MissingFile.Page(f.FileName, log, f.StoragePath); }
        return inline ? File(stream, f.ContentType, enableRangeProcessing: true)
                      : File(stream, f.ContentType, f.FileName, enableRangeProcessing: true);
    }

    private string SafeReturn(string? url) => !string.IsNullOrEmpty(url) && Url.IsLocalUrl(url) && url.StartsWith("/meetings") ? url : "/meetings";

    /// <summary>Deletes several meetings at once (e.g. "Delete ended"). Only yours, unless you're a workspace admin.</summary>
    [HttpPost("delete-many")]
    public async Task<IActionResult> DeleteMany(string? ids, string? returnUrl)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var list = (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).Distinct().Take(500).ToList();
        int done = 0, refused = 0;
        foreach (var id in list)
        {
            var (status, _) = await _meetings.DeleteAsync(tenantId, id, Me, User.IsInRole(AppRoles.TenantAdmin));
            if (status == DeleteMeetingStatus.Ok) done++;
            else if (status == DeleteMeetingStatus.NotAllowed) refused++;
        }
        TempData[done > 0 ? "MeetingMsg" : "MeetingError"] = done > 0
            ? $"{(done == 1 ? "1 meeting" : $"{done} meetings")} deleted." + (refused > 0 ? $" {refused} set up by someone else stayed." : "")
            : refused > 0 ? "Only the person who set up a meeting (or a workspace admin) can delete it." : "Nothing to delete.";
        return Redirect(SafeReturn(returnUrl));
    }

    private static DateOnly WeekOf(DateOnly date) => MeetingCalendar.WeekOf(date);

    private async Task<MeetingsViewModel> BuildIndexAsync(Guid tenantId, DateOnly? anchorDate, ScheduleMeetingInput? form, string view = "week")
    {
        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var zone = MeetingCalendar.FindZone(limits.TimeZoneId);
        var nowUtc = DateTime.UtcNow;
        var nowLocal = MeetingCalendar.ToLocal(nowUtc, zone);
        var today = DateOnly.FromDateTime(nowLocal);

        var anchor = anchorDate ?? today;
        var weekStart = WeekOf(anchor);
        // the period on screen: one day, one week, or the full weeks that cover the month
        DateOnly rangeStart;
        int rangeDays;
        switch (view)
        {
            case "day":
                rangeStart = anchor; rangeDays = 1; break;
            case "agenda":
                rangeStart = anchor; rangeDays = AgendaDays; break;
            case "month":
                var first = new DateOnly(anchor.Year, anchor.Month, 1);
                rangeStart = WeekOf(first);
                var afterLast = WeekOf(first.AddMonths(1).AddDays(-1)).AddDays(7);
                rangeDays = afterLast.DayNumber - rangeStart.DayNumber;
                break;
            default:
                rangeStart = weekStart; rangeDays = 7; break;
        }
        var fromLocal = rangeStart.ToDateTime(TimeOnly.MinValue);
        var toLocal = fromLocal.AddDays(rangeDays);

        Guid? justId = Guid.TryParse(TempData["ScheduledId"] as string, out var g) ? g : null;
        var online = _presence.OnlineUsers(tenantId);
        var me = Me;

        // One call covers this week AND the next 24 hours (for "Up next").
        var rangeFromUtc = MeetingCalendar.ToUtc(fromLocal < nowLocal.AddHours(-2) ? fromLocal : nowLocal.AddHours(-2), zone);
        var rangeToUtc = MeetingCalendar.ToUtc(toLocal > nowLocal.AddDays(1) ? toLocal : nowLocal.AddDays(1), zone);
        var (meetings, invitees) = await _meetings.ListForUserAsync(tenantId, me, rangeFromUtc, rangeToUtc);
        meetings = await _meetings.WithExceptionsAsync(tenantId, meetings);     // moved / cancelled single dates
        var answers = await _meetings.GetResponsesAsync(tenantId, meetings.Select(m => m.MeetingId));   // Accept / Maybe / Decline
        var inviteesByMeeting = invitees.ToLookup(i => i.MeetingId);   // (replaced below if the "next meeting" hint needs a later period)
        // calls and "Meet now" meetings are on the Calls page; the calendar shows them only while someone is in them
        meetings = meetings.Where(m => !m.IsInstant || _rooms.Count(m.MeetingId) > 0).ToList();
        // a "Meet now" meeting is live only while someone is in it; once everyone has left it has ended
        bool InstantOver(MeetingDto m, DateTime startLocal) => m.IsInstant && startLocal <= nowLocal && _rooms.Count(m.MeetingId) == 0;

        CalendarEventVm ToVm(MeetingOccurrenceDto o)
        {
            var m = o.Meeting;
            var people = new List<PersonVm> { new(m.HostId.ToString(), m.HostName, Names.Initials(m.HostName), m.HostTone, online.Contains(m.HostId.ToString())) };
            foreach (var i in inviteesByMeeting[m.MeetingId])
            {
                people.Add(i.UserId is Guid uid
                    ? new PersonVm(uid.ToString(), i.DisplayName ?? "", Names.Initials(i.DisplayName), i.AvatarTone ?? 0, online.Contains(uid.ToString()))
                    : new PersonVm("guest", "Guest", "G", 3, false));
            }
            var tone = m.IsInstant ? "slate" : m.HostId == me ? "blue" : "pink";
            var endLocal = InstantOver(m, o.StartLocal) && o.EndLocal > nowLocal ? nowLocal : o.EndLocal;

            // everyone's answer for this date (a date's own answer wins over the series answer)
            var occ = o.OccurrenceDate ?? DateOnly.FromDateTime(o.StartLocal);
            int yes = 0, maybe = 0, no = 0, waiting = 0;
            var notes = new List<AnswerNoteVm>();
            var mine = MeetingResponse.None;
            foreach (var i in inviteesByMeeting[m.MeetingId])
            {
                if (i.UserId == m.HostId) continue;
                var key = i.UserId is Guid u ? MeetingResponseDto.KeyOf(u) : string.IsNullOrWhiteSpace(i.GuestEmail) ? null : MeetingResponseDto.KeyOf(i.GuestEmail);
                if (key is null) continue;
                var a = MeetingResponseDto.For(answers, key, occ);
                var r = a?.Response ?? MeetingResponse.None;
                if (r == MeetingResponse.Accepted) yes++;
                else if (r == MeetingResponse.Maybe) maybe++;
                else if (r == MeetingResponse.Declined) no++;
                else waiting++;
                if (r is MeetingResponse.Maybe or MeetingResponse.Declined)
                    notes.Add(new AnswerNoteVm(i.UserId is not null ? i.DisplayName ?? "Team member" : i.GuestEmail ?? "Guest", r, a?.Note));
                if (i.UserId == me) mine = r;
            }
            return new CalendarEventVm(m.MeetingId, m.Title, o.StartLocal, endLocal, m.IsCancelled ? "cancelled" : tone, m.HostId == me, people, m.MeetingId == justId)
            {
                IsAllDay = m.IsAllDay,
                ShowAsFree = m.ShowAsFree,
                HostName = m.HostName,
                Agenda = m.Agenda,
                Repeat = MeetingCalendar.DescribeRepeat(m, zone),
                IsCancelled = m.IsCancelled,
                CancelledBy = m.CancelledByName,
                CancelNote = m.CancelNote,
                OccurrenceDate = o.OccurrenceDate ?? DateOnly.FromDateTime(o.StartLocal),
                IsMoved = o.IsMoved,
                SeriesStartLocal = MeetingCalendar.ToLocal(m.StartUtc, zone),
                SeriesMinutes = m.DurationMinutes,
                Accepted = yes,
                Maybe = maybe,
                Declined = no,
                Waiting = waiting,
                Answers = notes.OrderByDescending(x => x.Response).ThenBy(x => x.Name).ToList(),
                MyResponse = mine
            };
        }

        var occurrences = MeetingCalendar.Expand(meetings, fromLocal, toLocal, zone).ToList();
        var days = Enumerable.Range(0, rangeDays)
            .Select(i => rangeStart.AddDays(i))
            .Select(d => new CalendarDayVm(d, d == today,
                occurrences.Where(o => DateOnly.FromDateTime(o.StartLocal) == d).OrderBy(o => o.StartLocal).Select(ToVm).ToList()))
            .ToList();

        // List / Agenda with nothing in the period: find the next meeting after it (up to six months on), for a "Next: …" hint
        CalendarEventVm? nextAfter = null;
        if (view is "list" or "agenda" && !occurrences.Any(o => !o.Meeting.IsCancelled))
        {
            var afterFrom = toLocal > nowLocal ? toLocal : nowLocal;
            var (later, laterInvitees) = await _meetings.ListForUserAsync(tenantId, me, MeetingCalendar.ToUtc(afterFrom, zone), MeetingCalendar.ToUtc(afterFrom.AddDays(183), zone));
            later = await _meetings.WithExceptionsAsync(tenantId, later);
            var laterOcc = MeetingCalendar.Expand(later.Where(m => !m.IsCancelled && (!m.IsInstant || _rooms.Count(m.MeetingId) > 0)), afterFrom, afterFrom.AddDays(183), zone)
                .Where(o => o.StartLocal >= afterFrom).OrderBy(o => o.StartLocal).FirstOrDefault();
            if (laterOcc is not null)
            {
                // add the later meetings' people without changing the ones already on screen (Up next uses them too)
                var known = invitees.Select(i => i.MeetingId).ToHashSet();
                inviteesByMeeting = invitees.Concat(laterInvitees.Where(i => !known.Contains(i.MeetingId))).ToLookup(i => i.MeetingId);
                nextAfter = ToVm(laterOcc);
            }
        }

        var next = MeetingCalendar.Expand(meetings, nowLocal.AddHours(-2), nowLocal.AddDays(1), zone)
            .Where(o => o.EndLocal > nowLocal && !o.Meeting.IsAllDay && !o.Meeting.IsCancelled && !InstantOver(o.Meeting, o.StartLocal))
            .OrderBy(o => o.StartLocal)
            .FirstOrDefault();

        var meText = me.ToString();
        var team = (await _users.ListByTenantAsync(tenantId))
            .Where(u => u.IsActive && u.Id != meText)
            .Select(u => new PersonVm(u.Id, u.DisplayName, u.Initials, u.AvatarTone, online.Contains(u.Id)))
            .ToList();

        if (form is null)
        {
            var date = weekStart > today ? weekStart : today;
            var time = new TimeOnly(10, 0);
            if (date == today)
            {
                var next30 = nowLocal.AddMinutes(30 - nowLocal.Minute % 30);
                if (next30.Hour < 18) time = new TimeOnly(next30.Hour, next30.Minute);
                else date = date.AddDays(1);
            }
            form = new ScheduleMeetingInput { Date = date, Time = time, DurationMinutes = Math.Min(30, limits.MaxMeetingMinutes) };
        }

        var just = justId is Guid jid ? await _meetings.GetAsync(tenantId, jid) : null;

        // calls in the same period (local time), for the Calls card next to the Meetings card
        var allCalls = await _calls.ListForUserAsync(tenantId, me, 500);
        var periodCalls = allCalls?.Where(c =>
        {
            var local = MeetingCalendar.ToLocal(c.StartedUtc, zone);
            return local >= fromLocal && local < toLocal;
        }).ToList();

        return new MeetingsViewModel
        {
            PeriodCalls = periodCalls,
            WeekStart = weekStart,
            Days = days,
            UpNext = next is null ? null : ToVm(next),
            NextAfter = nextAfter,
            UpNextMinutes = next is null ? 0 : (int)Math.Ceiling((next.StartLocal - nowLocal).TotalMinutes),
            Team = team,
            Form = form,
            Limits = limits,
            JustScheduled = just,
            JustScheduledGuestUrl = just is { GuestLinkEnabled: true } ? _meetings.GuestUrl(just.GuestCode) : null,
            NowHour = rangeStart <= today && today < rangeStart.AddDays(rangeDays) ? nowLocal.Hour + nowLocal.Minute / 60.0 : -1,
            NowLocal = nowLocal,
            View = view,
            Anchor = anchor,
            RangeStart = rangeStart
        };
    }
}
