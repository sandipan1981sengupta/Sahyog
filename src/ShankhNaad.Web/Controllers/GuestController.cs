using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ShankhNaad.DtoLibrary;
using ShankhNaad.Web.Models;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.ServiceLibrary.Video;

namespace ShankhNaad.Web.Controllers;

/// <summary>Public guest link: /join/{code}. Guests enter a name and wait in the lobby until the host lets them in.</summary>
[AllowAnonymous, Route("join")]
public sealed class GuestController : Controller
{
    private readonly IMeetingService _meetings;
    private readonly ITenantService _tenants;
    private readonly MeetingRoomTracker _rooms;
    private readonly IVideoProviderFactory _video;

    public GuestController(IMeetingService meetings, ITenantService tenants, MeetingRoomTracker rooms, IVideoProviderFactory video)
    {
        _meetings = meetings;
        _tenants = tenants;
        _rooms = rooms;
        _video = video;
    }

    [HttpGet("{code}")]
    public async Task<IActionResult> Index(string code, bool left = false)
    {
        var meeting = await _meetings.GetByGuestCodeAsync(code);
        if (meeting is null || !meeting.TenantActive) return View("NotFound");
        var vm = ToVm(code, meeting);
        if (left) vm.Error = "You left the meeting. You can join again below.";
        return View(vm);
    }

    [HttpPost("{code}")]
    public async Task<IActionResult> Index(string code, string? name)
    {
        var meeting = await _meetings.GetByGuestCodeAsync(code);
        if (meeting is null || !meeting.TenantActive) return View("NotFound");

        var vm = ToVm(code, meeting);
        name = (name ?? "").Trim();
        vm.Name = name;
        if (name.Length is < 2 or > 60)
        {
            vm.Error = "Please enter your name (2–60 characters).";
            return View(vm);
        }

        var limits = (await _tenants.GetLimitsAsync(meeting.TenantId))!;
        if (_rooms.Count(meeting.MeetingId) >= limits.MaxMeetingParticipants)
        {
            vm.Error = "This meeting is full right now. Please try again in a few minutes.";
            return View(vm);
        }

        var provider = _video.Get(limits.VideoProvider);
        if (!provider.IsConfigured) return View("~/Views/Meetings/VideoNotConfigured.cshtml");

        var join = provider.CreateJoin(new VideoJoinRequest(meeting.RoomName, $"guest-{Guid.NewGuid():N}", $"{name} (guest)", null, false, false));

        return View("~/Views/Meetings/Room.cshtml", new RoomViewModel
        {
            MeetingId = meeting.MeetingId,
            Title = meeting.Title,
            Join = join,
            DisplayName = name,
            Initials = Names.Initials(name),
            Tone = 3,
            IsModerator = false,
            IsGuest = true,
            LobbyEnabled = meeting.LobbyEnabled,
            CaptionsOn = meeting.CaptionsOn,
            MaxVideoHeight = limits.MaxVideoHeight,
            MaxParticipants = limits.MaxMeetingParticipants,
            LeaveUrl = Url.Action(nameof(Index), new { code, left = true })!
        });
    }

    private static GuestJoinViewModel ToVm(string code, GuestMeetingDto m)
    {
        var zone = MeetingCalendar.FindZone(m.TimeZoneId);
        var start = MeetingCalendar.ToLocal(m.StartUtc, zone);
        return new GuestJoinViewModel
        {
            Code = code,
            Title = m.Title,
            HostName = m.HostName,
            WorkspaceName = m.TenantName,
            When = $"{start:ddd d MMM} · {start:h:mm tt} – {start.AddMinutes(m.DurationMinutes):h:mm tt}"
        };
    }
}
