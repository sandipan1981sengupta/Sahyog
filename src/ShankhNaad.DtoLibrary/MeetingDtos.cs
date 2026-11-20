namespace ShankhNaad.DtoLibrary;

/// <summary>A meeting (sahyog_Meeting_Get / sahyog_Meeting_ListForUser).</summary>
public sealed record MeetingDto(
    Guid MeetingId, string Title, string? Agenda, DateTime StartUtc, int DurationMinutes, MeetingRecurrence Recurrence,
    string RoomName, string GuestCode, Guid HostId, string HostName, int HostTone, Guid? ChannelId, bool IsInstant,
    bool GuestLinkEnabled, bool LobbyEnabled, bool CaptionsOn)
{
    public string? ChannelName { get; init; }
    public bool ChannelIsDirect { get; init; }
    /// <summary>Takes the whole day (start = local midnight, 1440 minutes).</summary>
    public bool IsAllDay { get; init; }
    /// <summary>All-day event that does not block the day (shown in the all-day row only).</summary>
    public bool ShowAsFree { get; init; }
    /// <summary>Custom repeat days: bit (1 &lt;&lt; (int)DayOfWeek), so Sun = 1, Mon = 2 … Sat = 64.</summary>
    public byte RepeatDays { get; init; }
    /// <summary>Start of the last occurrence (UTC). Null = repeats with no end.</summary>
    public DateTime? RepeatUntilUtc { get; init; }
    /// <summary>When it was cancelled (a repeating meeting: the whole series). Null = not cancelled. Needs 34_MeetingCancel.sql.</summary>
    public DateTime? CancelledUtc { get; init; }
    /// <summary>Who cancelled it (shown on the calendar).</summary>
    public string? CancelledByName { get; init; }
    /// <summary>The reason given when cancelling (optional).</summary>
    public string? CancelNote { get; init; }
    public bool IsCancelled => CancelledUtc is not null;
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
    public bool IsAllDay { get; set; }
    public bool ShowAsFree { get; set; }
    /// <summary>Custom repeat days bit mask (see <see cref="MeetingDto.RepeatDays"/>).</summary>
    public byte RepeatDays { get; set; }
    /// <summary>Start of the last occurrence (UTC). Null = no end.</summary>
    public DateTime? RepeatUntilUtc { get; set; }
}

/// <summary>One appearance of a meeting on the calendar (recurring meetings appear many times).</summary>
public sealed record MeetingOccurrenceDto(MeetingDto Meeting, DateTime StartLocal, DateTime EndLocal);

public sealed record MeetingListDto(List<MeetingDto> Meetings, List<InviteeDto> Invitees);

public enum DeleteMeetingStatus { Ok = 0, NotFound = 1, NotAllowed = 2 }

/// <summary>Cancel a meeting (sahyog_Meeting_Cancel). NeedsDatabase = 34_MeetingCancel.sql not run yet.</summary>
public enum CancelMeetingStatus { Ok = 0, NotFound = 1, NotAllowed = 2, AlreadyCancelled = 3, NeedsDatabase = 9 }

/// <summary>Remove a cancelled meeting from my calendar (sahyog_Meeting_Hide).</summary>
public enum HideMeetingStatus { Ok = 0, NotFound = 1, NotCancelled = 2, NeedsDatabase = 9 }

public sealed record DeleteMeetingResultDto(DeleteMeetingStatus Status, DateTime? StartUtc);
