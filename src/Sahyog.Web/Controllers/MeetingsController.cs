using System.Net.Mail;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Sahyog.DtoLibrary;
using Sahyog.Web.Hubs;
using Sahyog.Web.Infrastructure;
using Sahyog.Web.Models;
using Sahyog.ServiceLibrary;
using Sahyog.ServiceLibrary.Video;

namespace Sahyog.Web.Controllers;

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

    public MeetingsController(IMeetingService meetings, IChatService chat, ITenantService tenants, IUserService users,
        MeetingRoomTracker rooms, IVideoProviderFactory video, IHubContext<ChatHub> hub, PresenceTracker presence)
    {
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

    [HttpGet("")]
    public async Task<IActionResult> Index(DateOnly? week)
    {
        if (User.TenantId() is not Guid tenantId) return Redirect("/");
        return View(await BuildIndexAsync(tenantId, week, null));
    }

    [HttpPost("schedule")]
    public async Task<IActionResult> Schedule([Bind(Prefix = "Form")] ScheduleMeetingInput input)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var zone = MeetingCalendar.FindZone(limits.TimeZoneId);
        var nowLocal = MeetingCalendar.ToLocal(DateTime.UtcNow, zone);
        var startLocal = input.Date.ToDateTime(input.Time);

        if (input.DurationMinutes > limits.MaxMeetingMinutes)
            ModelState.AddModelError("Form.DurationMinutes", $"Your {limits.PlanName} plan allows meetings up to {limits.MaxMeetingMinutes} minutes.");
        if (startLocal < nowLocal.AddMinutes(-5))
            ModelState.AddModelError("Form.Time", "That time has already passed.");

        var guestEmails = new List<string>();
        foreach (var raw in (input.GuestEmails ?? "").Split(new[] { ',', ';', ' ', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries))
        {
            if (MailAddress.TryCreate(raw.Trim(), out var address)) guestEmails.Add(address.Address.ToLowerInvariant());
            else ModelState.AddModelError("Form.GuestEmails", $"'{raw}' is not a valid email address.");
        }
        if (guestEmails.Count > 25)
            ModelState.AddModelError("Form.GuestEmails", "Invite up to 25 guests per meeting.");

        if (!ModelState.IsValid)
            return View(nameof(Index), await BuildIndexAsync(tenantId, WeekOf(input.Date), input));

        var meeting = new CreateMeetingRequest
        {
            TenantId = tenantId,
            Title = input.Title.Trim(),
            Agenda = input.Agenda?.Trim(),
            StartUtc = MeetingCalendar.ToUtc(startLocal, zone),
            DurationMinutes = input.DurationMinutes,
            Recurrence = input.Recurrence,
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
        return RedirectToAction(nameof(Index), new { week = WeekOf(input.Date).ToString("yyyy-MM-dd") });
    }

    /// <summary>"Meet now" from a channel or DM: creates the meeting and rings everyone in it.</summary>
    [HttpPost("instant")]
    public async Task<IActionResult> Instant(Guid? channelId)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
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
                : $"#{channel.Name} meeting";
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
            InviteeIds = others
        };
        await _meetings.CreateAsync(meeting);

        if (channelId is Guid chan)
        {
            var (status, posted) = await _chat.SendMessageAsync(new SendMessageRequest(tenantId, chan, Me, $"Started a video meeting. Join: {_meetings.RoomUrl(meeting.MeetingId)}"));
            if (status == SendStatus.Ok && posted is not null)
                await _hub.Clients.Group(ChatHub.ChannelGroup(chan)).SendAsync("MessageReceived", posted);
        }

        if (others.Count > 0)
        {
            var call = new IncomingCallDto(meeting.MeetingId, title, User.DisplayName(), User.Initials(), User.AvatarTone(),
                Url.Action(nameof(Room), new { id = meeting.MeetingId })!);
            await _hub.Clients.Users(others.Select(o => o.ToString()).ToList()).SendAsync("IncomingCall", call);
        }

        return RedirectToAction(nameof(Room), new { id = meeting.MeetingId });
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
            LobbyEnabled = meeting.LobbyEnabled,
            CaptionsOn = meeting.CaptionsOn,
            MaxVideoHeight = limits.MaxVideoHeight,
            MaxParticipants = limits.MaxMeetingParticipants,
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

    private async Task<MeetingsViewModel> BuildIndexAsync(Guid tenantId, DateOnly? week, ScheduleMeetingInput? form)
    {
        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var zone = MeetingCalendar.FindZone(limits.TimeZoneId);
        var nowUtc = DateTime.UtcNow;
        var nowLocal = MeetingCalendar.ToLocal(nowUtc, zone);
        var today = DateOnly.FromDateTime(nowLocal);

        var weekStart = WeekOf(week ?? today);
        var fromLocal = weekStart.ToDateTime(TimeOnly.MinValue);
        var toLocal = fromLocal.AddDays(7);

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
            return new CalendarEventVm(m.MeetingId, m.Title, o.StartLocal, o.EndLocal, tone, m.HostId == me, people, m.MeetingId == justId);
        }

        var occurrences = MeetingCalendar.Expand(meetings, fromLocal, toLocal, zone).ToList();
        var days = Enumerable.Range(0, 7)
            .Select(i => weekStart.AddDays(i))
            .Select(d => new CalendarDayVm(d, d == today,
                occurrences.Where(o => DateOnly.FromDateTime(o.StartLocal) == d).OrderBy(o => o.StartLocal).Select(ToVm).ToList()))
            .ToList();

        var next = MeetingCalendar.Expand(meetings, nowLocal.AddHours(-2), nowLocal.AddDays(1), zone)
            .Where(o => o.EndLocal > nowLocal)
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
            NowHour = weekStart <= today && today < weekStart.AddDays(7) ? nowLocal.Hour + nowLocal.Minute / 60.0 : -1
        };
    }
}
