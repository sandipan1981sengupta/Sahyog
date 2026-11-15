namespace Sahyog.DtoLibrary;

/// <summary>A meeting (sahyog_Meeting_Get / sahyog_Meeting_ListForUser).</summary>
public sealed record MeetingDto(
    Guid MeetingId, string Title, string? Agenda, DateTime StartUtc, int DurationMinutes, MeetingRecurrence Recurrence,
    string RoomName, string GuestCode, Guid HostId, string HostName, int HostTone, Guid? ChannelId, bool IsInstant,
    bool GuestLinkEnabled, bool LobbyEnabled, bool CaptionsOn)
{
    public string? ChannelName { get; init; }
    public bool ChannelIsDirect { get; init; }
    public DateTime EndUtc => StartUtc.AddMinutes(DurationMinutes);
}

/// <summary>A team member (UserId) or an outside guest (GuestEmail) invited to a meeting.</summary>
public sealed record InviteeDto(Guid MeetingId, Guid? UserId, string? DisplayName, int? AvatarTone, string? Email, string? GuestEmail);

/// <summary>What the public guest link needs (sahyog_Meeting_GetByGuestCode).</summary>
public sealed record GuestMeetingDto(
    Guid MeetingId, Guid TenantId, string Title, DateTime StartUtc, int DurationMinutes, string RoomName,
    bool LobbyEnabled, bool CaptionsOn, string HostName, string TenantName, string TimeZoneId, bool TenantActive);

/// <summary>Input for scheduling or starting a meeting.</summary>
public sealed class CreateMeetingRequest
{
    public Guid TenantId { get; set; }
    public Guid MeetingId { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = "";
    public string? Agenda { get; set; }
    public DateTime StartUtc { get; set; }
    public int DurationMinutes { get; set; } = 30;
    public MeetingRecurrence Recurrence { get; set; }
    public string RoomName { get; set; } = "";
    public string GuestCode { get; set; } = "";
    public Guid HostId { get; set; }
    public Guid? ChannelId { get; set; }
    public bool IsInstant { get; set; }
    public bool GuestLinkEnabled { get; set; } = true;
    public bool LobbyEnabled { get; set; } = true;
    public bool CaptionsOn { get; set; }
    public List<Guid> InviteeIds { get; set; } = new();
    public List<string> GuestEmails { get; set; } = new();
}

/// <summary>One appearance of a meeting on the calendar (recurring meetings appear many times).</summary>
public sealed record MeetingOccurrenceDto(MeetingDto Meeting, DateTime StartLocal, DateTime EndLocal);

public sealed record MeetingListDto(List<MeetingDto> Meetings, List<InviteeDto> Invitees);

public enum DeleteMeetingStatus { Ok = 0, NotFound = 1, NotAllowed = 2 }

public sealed record DeleteMeetingResultDto(DeleteMeetingStatus Status, DateTime? StartUtc);
