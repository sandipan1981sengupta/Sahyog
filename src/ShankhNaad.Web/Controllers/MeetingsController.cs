using System.Net.Mail;
using Microsoft.AspNetCore.Authorization;
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

    private static readonly string[] Views = { "day", "week", "month", "list" };

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
    public async Task<IActionResult> Schedule([Bind(Prefix = "Form")] ScheduleMeetingInput input)
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
                await _meetings.SendInvitesAsync(saved, invitees, host.DisplayName, host.Email, zone);
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

        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        if (_rooms.Count(id) >= limits.MaxMeetingParticipants && !_rooms.Contains(id, Me.ToString()))
            return View("Full", limits);

        var provider = _video.Get(limits.VideoProvider);
        if (!provider.IsConfigured) return View("VideoNotConfigured");

        var isModerator = meeting.HostId == Me || User.IsInRole(AppRoles.TenantAdmin);
        var email = User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value;
        var join = provider.CreateJoin(new VideoJoinRequest(meeting.RoomName, Me.ToString(), User.DisplayName(), email, isModerator, limits.RecordingEnabled));
        var oneToOne = meeting.IsInstant && meeting.ChannelId is Guid callChat
            && await _chat.GetChannelAsync(tenantId, callChat) is { IsDirect: true };

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
            LeaveUrl = meeting.ChannelId is Guid ch ? Url.Action("Index", "Chat", new { id = ch })! : Url.Action(nameof(Index))!,
            GuestUrl = meeting.GuestLinkEnabled ? _meetings.GuestUrl(meeting.GuestCode) : null,
            ChannelName = meeting.ChannelId is not null && !meeting.ChannelIsDirect ? meeting.ChannelName : null
        });
    }

    [HttpPost("{id:guid}/delete")]
    public async Task<IActionResult> Delete(Guid id)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var (status, startUtc) = await _meetings.DeleteAsync(tenantId, id, Me, User.IsInRole(AppRoles.TenantAdmin));
        if (status == DeleteMeetingStatus.NotFound) return NotFound();
        if (status == DeleteMeetingStatus.NotAllowed) return Forbid();

        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var local = MeetingCalendar.ToLocal(startUtc ?? DateTime.UtcNow, MeetingCalendar.FindZone(limits.TimeZoneId));
        return RedirectToAction(nameof(Index), new { week = WeekOf(DateOnly.FromDateTime(local)).ToString("yyyy-MM-dd") });
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
        var inviteesByMeeting = invitees.ToLookup(i => i.MeetingId);

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
            return new CalendarEventVm(m.MeetingId, m.Title, o.StartLocal, o.EndLocal, tone, m.HostId == me, people, m.MeetingId == justId)
            {
                IsAllDay = m.IsAllDay,
                ShowAsFree = m.ShowAsFree
            };
        }

        var occurrences = MeetingCalendar.Expand(meetings, fromLocal, toLocal, zone).ToList();
        var days = Enumerable.Range(0, rangeDays)
            .Select(i => rangeStart.AddDays(i))
            .Select(d => new CalendarDayVm(d, d == today,
                occurrences.Where(o => DateOnly.FromDateTime(o.StartLocal) == d).OrderBy(o => o.StartLocal).Select(ToVm).ToList()))
            .ToList();

        var next = MeetingCalendar.Expand(meetings, nowLocal.AddHours(-2), nowLocal.AddDays(1), zone)
            .Where(o => o.EndLocal > nowLocal && !o.Meeting.IsAllDay)
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

        return new MeetingsViewModel
        {
            WeekStart = weekStart,
            Days = days,
            UpNext = next is null ? null : ToVm(next),
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
