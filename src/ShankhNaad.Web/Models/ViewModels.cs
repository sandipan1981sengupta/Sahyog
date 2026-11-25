using System.ComponentModel.DataAnnotations;
using System.Globalization;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.ServiceLibrary.Video;

namespace ShankhNaad.Web.Models;

// ---------- Account ----------

public sealed class LoginViewModel
{
    [Display(Name = "Workspace")]
    [MaxLength(40)]
    public string? Workspace { get => _workspace; set => _workspace = value?.Trim().ToLowerInvariant(); }
    private string? _workspace;

    [Required, EmailAddress]
    public string Email { get; set; } = "";

    [Required, DataType(DataType.Password)]
    public string Password { get; set; } = "";

    public bool RememberMe { get; set; } = true;

    public string? ReturnUrl { get; set; }
}

/// <summary>"Forgot password?" page.</summary>
public sealed class ForgotPasswordViewModel
{
    [Required, EmailAddress, MaxLength(200)]
    public string Email { get; set; } = "";
    /// <summary>True after the form is sent: the page then shows the same "check your email" note for any address.</summary>
    public bool Sent { get; set; }
    /// <summary>False when this server can't send email yet (Smtp:Host empty).</summary>
    public bool CanEmail { get; set; } = true;
}

/// <summary>"Set your password" page, opened from a welcome or reset email.</summary>
public sealed class SetPasswordViewModel
{
    public string Token { get; set; } = "";
    public PasswordLinkInfo? Link { get; set; }

    [Required, MinLength(8), DataType(DataType.Password)]
    public string NewPassword { get; set; } = "";

    [Required, DataType(DataType.Password), Compare(nameof(NewPassword), ErrorMessage = "The two passwords don't match.")]
    public string ConfirmPassword { get; set; } = "";
}

// ---------- Chat ----------

public sealed record PersonVm(string Id, string Name, string Initials, int Tone, bool Online, string? Role = null, bool Pending = false);

public sealed record ChannelVm(Guid Id, string Name, bool IsDirect, int Unread, PersonVm? DirectWith, bool IsPrivate = false,
    bool IsPinned = false, DateTime LastUtc = default)
{
    /// <summary>The workspace-wide group everybody is in (was #general).</summary>
    public bool IsEveryone => !IsDirect && !IsPrivate;
}

/// <summary>The shared people picker (Views/Shared/_PeoplePicker.cshtml + wwwroot/js/people-picker.js):
/// New group, Add people to a group, and Schedule a meeting.</summary>
public sealed class PeoplePickerVm
{
    /// <summary>Element id of the picker (the script finds it by this).</summary>
    public required string Id { get; init; }
    public required IReadOnlyList<PersonVm> People { get; init; }
    /// <summary>Name the ticked ids are posted as ("members", "Form.InviteeIds", …).</summary>
    public string FieldName { get; init; } = "members";
    /// <summary>Ids that start ticked (e.g. a meeting being edited, or a form shown again after an error).</summary>
    public IReadOnlyCollection<string> Picked { get; init; } = Array.Empty<string>();
    public string Title { get; init; } = "People";
    public string EmptyText { get; init; } = "No one to pick yet.";
    /// <summary>A small note under the list (null = none).</summary>
    public string? Hint { get; init; }
    /// <summary>Extra class on the picker, e.g. "sn-pp-compact" for a shorter list.</summary>
    public string? CssClass { get; init; }
    /// <summary>People already in the group (Add people): shown as a row of faces with "+N" and "See who".</summary>
    public IReadOnlyList<PersonVm>? Already { get; init; }
    /// <summary>Name of the group they're already in ("18 people already in Project Alpha").</summary>
    public string? AlreadyIn { get; init; }
    /// <summary>Word in front of the picked names in the wide pop-ups ("To", "Add", "Invite").</summary>
    public string ToLabel { get; init; } = "To";
}

public sealed class ChatViewModel
{
    public required TenantLimitsDto Limits { get; init; }
    public required List<ChannelVm> Channels { get; init; }
    public required List<ChannelVm> Directs { get; init; }
    public ChannelVm? Current { get; init; }
    /// <summary>Workspace admins, and the person who created the channel, can rename it.</summary>
    public bool CanEditChannel { get; init; }
    /// <summary>Only workspace admins, and never the main channel (#general).</summary>
    public bool CanDeleteChannel { get; init; }
    public bool CurrentIsMain { get; init; }
    /// <summary>Add / remove people: a private group, and you created it or are a workspace admin.</summary>
    public bool CanManageMembers { get; init; }
    /// <summary>Who created the current group (they can only be removed by an admin).</summary>
    public string? CurrentCreatedBy { get; init; }
    /// <summary>Who has read up to when in this conversation (for ✓✓ read ticks).</summary>
    public List<ReadStateDto> ReadState { get; init; } = new();
    public string? CurrentDescription { get; init; }
    public required List<MessageDto> Messages { get; init; }
    public required List<PersonVm> Members { get; init; }
    public required List<PersonVm> Team { get; init; }
    public required List<AttachmentDto> RecentFiles { get; init; }
    public bool HasOlder { get; init; }
    public int MaxUploadMb { get; init; }
}

// ---------- Meetings ----------

public sealed record CalendarEventVm(
    Guid MeetingId,
    string Title,
    DateTime StartLocal,
    DateTime EndLocal,
    string Tone,
    bool IsHost,
    List<PersonVm> People,
    bool IsNew)
{
    public bool IsAllDay { get; init; }
    public bool ShowAsFree { get; init; }
    /// <summary>Who set the meeting up.</summary>
    public string HostName { get; init; } = "";
    public string? Agenda { get; init; }
    /// <summary>"Every Monday", "Every weekday" … null = once.</summary>
    public string? Repeat { get; init; }
    /// <summary>Cancelled (a repeating meeting: the whole series). Stays on the calendar, struck through.</summary>
    public bool IsCancelled { get; init; }
    public string? CancelledBy { get; init; }
    public string? CancelNote { get; init; }
    /// <summary>The date this meeting was planned for: identifies one date of a repeating meeting (for move / cancel this date).</summary>
    public DateOnly OccurrenceDate { get; init; }
    /// <summary>This date of a repeating meeting was moved to another time.</summary>
    public bool IsMoved { get; init; }
    /// <summary>The series' own first start (for "Edit the whole series").</summary>
    public DateTime SeriesStartLocal { get; init; }
    public int SeriesMinutes { get; init; }
    // answers for this date (the organizer isn't counted): ✓ accepted · ? maybe · ✕ declined · no response yet
    public int Accepted { get; init; }
    public int Maybe { get; init; }
    public int Declined { get; init; }
    public int Waiting { get; init; }
    /// <summary>Who said Maybe / Declined, and why.</summary>
    public List<AnswerNoteVm> Answers { get; init; } = new();
    /// <summary>My own answer (when I'm invited).</summary>
    public ShankhNaad.DtoLibrary.MeetingResponse MyResponse { get; init; }
}

/// <summary>Someone's Maybe / Decline and the reason they gave.</summary>
public sealed record AnswerNoteVm(string Name, ShankhNaad.DtoLibrary.MeetingResponse Response, string? Note);

public sealed record CalendarDayVm(DateOnly Date, bool IsToday, List<CalendarEventVm> Events);

public sealed class ScheduleMeetingInput
{
    [Required, MaxLength(150)]
    public string Title { get; set; } = "";

    [MaxLength(2000)]
    public string? Agenda { get; set; }

    [Required]
    public DateOnly Date { get; set; }

    /// <summary>
    /// The date as the Template 1 date picker posts it (dd-MM-yyyy). Setting it fills <see cref="Date"/>.
    /// </summary>
    public string DateText
    {
        get => Date.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture);
        set
        {
            if (DateOnly.TryParseExact(value?.Trim(), new[] { "dd-MM-yyyy", "d-M-yyyy", "yyyy-MM-dd" }, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                Date = d;
        }
    }

    [Required]
    public TimeOnly Time { get; set; } = new(10, 0);

    [Range(15, 1440)]
    public int DurationMinutes { get; set; } = 30;

    public MeetingRecurrence Recurrence { get; set; }

    /// <summary>For Repeat = Custom: the picked days as DayOfWeek numbers (0 = Sun … 6 = Sat).</summary>
    public List<int> RepeatDays { get; set; } = new();

    /// <summary>Stop repeating after <see cref="RepeatUntil"/>; off = repeats with no end.</summary>
    public bool RepeatEnds { get; set; }

    /// <summary>The last day a repeating meeting can happen (inclusive).</summary>
    public DateOnly? RepeatUntil { get; set; }

    /// <summary>The last day as the date picker posts it (dd-MM-yyyy). Empty clears it.</summary>
    public string RepeatUntilText
    {
        get => RepeatUntil?.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture) ?? "";
        set => RepeatUntil = DateOnly.TryParseExact(value?.Trim(), new[] { "dd-MM-yyyy", "d-M-yyyy", "yyyy-MM-dd" }, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            ? d : null;
    }

    public List<string> InviteeIds { get; set; } = new();

    /// <summary>Comma or newline separated.</summary>
    [MaxLength(2000)]
    public string? GuestEmails { get; set; }

    public bool GuestLinkEnabled { get; set; } = true;
    public bool LobbyEnabled { get; set; } = true;
    public bool SendEmail { get; set; } = true;
    public bool CaptionsOn { get; set; }

    /// <summary>Takes the whole day; Time and DurationMinutes are ignored.</summary>
    public bool AllDay { get; set; }

    /// <summary>For all-day events: "busy" blocks the day, "free" only shows it at the top of the day.</summary>
    public string ShowAs { get; set; } = "busy";
}

public sealed class MeetingsViewModel
{
    /// <summary>Calls (from Chat) in the period on screen, for the Calls card. Null = 23_CallsAndFiles.sql not run.</summary>
    public List<CallHistoryDto>? PeriodCalls { get; init; }
    public required DateOnly WeekStart { get; init; }
    public required List<CalendarDayVm> Days { get; init; }
    public CalendarEventVm? UpNext { get; init; }
    /// <summary>List / Agenda with no meetings in the period: the next one after it (for "Next: Mon 23 Nov, 18:00 …").</summary>
    public CalendarEventVm? NextAfter { get; init; }
    public int UpNextMinutes { get; init; }
    public required List<PersonVm> Team { get; init; }
    public required ScheduleMeetingInput Form { get; init; }
    public required TenantLimitsDto Limits { get; init; }
    public MeetingDto? JustScheduled { get; init; }
    public string? JustScheduledGuestUrl { get; init; }
    public double NowHour { get; init; }
    /// <summary>Current time in the workspace's time zone (used for Live / Ended badges).</summary>
    public DateTime NowLocal { get; init; }
    public int StartHour { get; init; } = 8;
    public int EndHour { get; init; } = 19;
    /// <summary>day | week | month | list</summary>
    public string View { get; init; } = "week";
    /// <summary>The day the person is looking at (any day inside the period).</summary>
    public DateOnly Anchor { get; init; }
    /// <summary>First day shown (Monday for week and month).</summary>
    public DateOnly RangeStart { get; init; }
}

public sealed class RoomViewModel
{
    public required Guid MeetingId { get; init; }
    public required string Title { get; init; }
    public required VideoJoinInfo Join { get; init; }
    public required string DisplayName { get; init; }
    public required string Initials { get; init; }
    public required int Tone { get; init; }
    public required bool IsModerator { get; init; }
    public required bool IsGuest { get; init; }
    public required bool LobbyEnabled { get; init; }
    public required bool CaptionsOn { get; init; }
    public required int MaxVideoHeight { get; init; }
    public required int MaxParticipants { get; init; }
    public required string LeaveUrl { get; init; }
    /// <summary>A call between two people from Chat: it ends for both when one hangs up or declines.</summary>
    /// <summary>Calls start with the camera off (sound only); people turn video on when they want. Scheduled meetings start with video.</summary>
    public bool StartCameraOff { get; init; }
    public bool OneToOne { get; init; }
    /// <summary>"Sandy isn't online right now…" when nobody could be rung.</summary>
    public string? OfflineNote { get; init; }
    public string? GuestUrl { get; init; }
    /// <summary>The chat this call was started from (its messages open from the call's Chat panel). Null = a scheduled meeting.</summary>
    public Guid? ChatChannelId { get; init; }
    public string? ChannelName { get; init; }
    /// <summary>A one-to-one call: the other person (the room shows "Ringing Sandy…" until they join).</summary>
    public string? CallWithName { get; init; }
    public string? CallWithInitials { get; init; }
    public int CallWithTone { get; init; }
}

public sealed class GuestJoinViewModel
{
    public required string Code { get; init; }
    public required string Title { get; init; }
    public required string HostName { get; init; }
    public required string WorkspaceName { get; init; }
    public required string When { get; init; }

    [Required, MaxLength(60)]
    public string Name { get; set; } = "";

    public string? Error { get; set; }
}

// ---------- Admin ----------

public sealed record TenantRowVm(Guid Id, string Name, string Slug, string Plan, int Users, int MaxUsers, long StorageUsed, long StorageQuota, string Provider, bool IsActive, DateTime CreatedUtc, bool LocationOn = false);

public sealed class CreateTenantInput
{
    [Required, MaxLength(120)]
    public string Name { get; set; } = "";

    [Required, MaxLength(40), RegularExpression("^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$", ErrorMessage = "Use 3–40 letters, numbers or hyphens (no spaces).")]
    public string Slug { get => _slug; set => _slug = (value ?? "").Trim().ToLowerInvariant(); }
    private string _slug = "";

    [Required]
    public int PlanId { get; set; }

    [Required, MaxLength(100)]
    public string AdminName { get; set; } = "";

    [Required, EmailAddress]
    public string AdminEmail { get; set; } = "";

    [Required, MinLength(8), DataType(DataType.Password)]
    public string AdminPassword { get; set; } = "";

    /// <summary>Email the client admin a link to set their own password (the temporary password keeps working until they do).</summary>
    public bool SendInvite { get; set; } = true;
}

public sealed class AdminViewModel
{
    public required List<TenantRowVm> Tenants { get; init; }
    public required List<PlanDto> Plans { get; init; }
    public required CreateTenantInput NewTenant { get; init; }
    /// <summary>False when Smtp isn't set up: no invite emails can be sent.</summary>
    public bool CanEmail { get; init; }
    public string? Message { get; init; }
    public string? Error { get; init; }
}

public sealed class AddMemberInput
{
    [Required, MaxLength(100)]
    public string DisplayName { get; set; } = "";

    [Required, EmailAddress]
    public string Email { get; set; } = "";

    /// <summary>Needed only when SendInvite is off (or email isn't set up).</summary>
    [MinLength(8), DataType(DataType.Password)]
    public string? TemporaryPassword { get; set; }

    public bool MakeAdmin { get; set; }

    /// <summary>Email them a welcome link to set their own password (instead of a temporary password).</summary>
    public bool SendInvite { get; set; } = true;
}

public sealed class TeamViewModel
{
    public required TenantLimitsDto Limits { get; init; }
    public required int ActiveUsers { get; init; }
    public required List<PersonVm> People { get; init; }
    public required List<PersonVm> Inactive { get; init; }
    public required AddMemberInput NewMember { get; init; }
    /// <summary>Email per user id (for the people grid).</summary>
    public Dictionary<string, string> Emails { get; init; } = new();
    public string? Message { get; init; }
    public string? Error { get; init; }
    /// <summary>True when this server can send email (welcome and set-password links).</summary>
    public bool CanEmail { get; init; }
    /// <summary>Team location is switched on for this client (by the super admin).</summary>
    public bool LocationEnabled { get; init; }
    /// <summary>Latest location per user id (only people who share).</summary>
    public Dictionary<string, UserLocationDto> Locations { get; init; } = new();
}

// ---------- First-time setup ----------

public sealed class SetupInput
{
    [Required, MaxLength(100), Display(Name = "Your name")]
    public string AdminName { get; set; } = "CloudWheel Admin";

    [Required, EmailAddress, Display(Name = "Email")]
    public string AdminEmail { get; set; } = "";

    [Required, MinLength(8), DataType(DataType.Password), Display(Name = "Password")]
    public string AdminPassword { get; set; } = "";

    [Required, DataType(DataType.Password), Display(Name = "Confirm password")]
    public string ConfirmPassword { get; set; } = "";

    public bool CreateWorkspace { get; set; } = true;

    [MaxLength(120), Display(Name = "Client company name")]
    public string? CompanyName { get; set; }

    [MaxLength(40), RegularExpression("^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$", ErrorMessage = "Workspace: 3–40 letters, numbers or hyphens (no spaces).")]
    public string? Workspace { get => _workspace; set => _workspace = value?.Trim().ToLowerInvariant(); }
    private string? _workspace;

    [MaxLength(100), Display(Name = "Client admin name")]
    public string? ClientAdminName { get; set; }

    [EmailAddress, Display(Name = "Client admin email")]
    public string? ClientAdminEmail { get; set; }

    [MinLength(8), DataType(DataType.Password), Display(Name = "Client admin password")]
    public string? ClientAdminPassword { get; set; }

    public int PlanId { get; set; }
}

public sealed class CallsViewModel
{
    public required List<CallHistoryDto> Calls { get; init; }
    /// <summary>23_CallsAndFiles.sql hasn't been run yet.</summary>
    public bool NeedsSql { get; init; }
    public required HashSet<string> Online { get; init; }
    /// <summary>Everyone else in the workspace, for the Team panel (call or chat in one click).</summary>
    public List<PersonVm> Team { get; init; } = new();
    /// <summary>Ids of the people you pinned, in the order you pinned them.</summary>
    public List<string> Pinned { get; init; } = new();
    /// <summary>Job titles from the Org page (user id → title).</summary>
    public Dictionary<string, string> Titles { get; init; } = new();
}

public sealed class FilesViewModel
{
    public required List<SharedFileDto> Files { get; init; }
    /// <summary>23_CallsAndFiles.sql hasn't been run yet.</summary>
    public bool NeedsSql { get; init; }
    public required HashSet<string> Online { get; init; }
    /// <summary>The Team panel: share a file with someone straight from here.</summary>
    public TeamPanelVm TeamPanel { get; init; } = new();
}

/// <summary>One person on a meeting's details: the host, a team member or a guest, with their answer.</summary>
public sealed record MeetingPersonVm(string Key, string Name, string Initials, int Tone, bool IsGuest, bool IsHost, bool Online,
    ShankhNaad.DtoLibrary.MeetingResponse Response, string? Note, DateTime? RespondedUtc);

/// <summary>A meeting's details (the window that opens when you click a meeting, and /meetings/{id}/view).</summary>
public sealed class MeetingDetailsVm
{
    public Guid MeetingId { get; init; }
    public string Title { get; init; } = "";
    public string? Agenda { get; init; }
    public DateOnly OccurrenceDate { get; init; }
    public DateTime StartLocal { get; init; }
    public DateTime EndLocal { get; init; }
    public bool IsAllDay { get; init; }
    public string? Repeat { get; init; }
    public bool IsMoved { get; init; }
    /// <summary>This one date of a repeating meeting was cancelled.</summary>
    public bool DateCancelled { get; init; }
    public bool IsCancelled { get; init; }
    public string? CancelledBy { get; init; }
    public string? CancelNote { get; init; }
    public string HostName { get; init; } = "";
    public bool IsHost { get; init; }
    public bool CanManage { get; init; }
    /// <summary>Live · Upcoming · Ended · Cancelled</summary>
    public string Status { get; init; } = "";
    public int InRoom { get; init; }
    /// <summary>My own answer (None for the host, who doesn't answer their own meeting).</summary>
    public ShankhNaad.DtoLibrary.MeetingResponse MyResponse { get; init; }
    /// <summary>The reason I gave with Maybe / Decline.</summary>
    public string? MyNote { get; init; }
    public bool CanRespond { get; init; }
    /// <summary>36_MeetingResponses.sql has been run (answers can be saved).</summary>
    public bool ResponsesReady { get; init; } = true;
    public List<MeetingPersonVm> People { get; init; } = new();
    /// <summary>Shown as a full page (from an email link) rather than in the calendar's window.</summary>
    public bool FullPage { get; init; }
}

/// <summary>The page a person sees after pressing Accept / Maybe / Decline in an invite email (no sign-in).</summary>
public sealed class MeetingRespondVm
{
    public string Token { get; init; } = "";
    public string Title { get; init; } = "";
    public string When { get; init; } = "";
    public string HostName { get; init; } = "";
    public string PersonName { get; init; } = "";
    public bool IsSeries { get; init; }
    public ShankhNaad.DtoLibrary.MeetingResponse Current { get; init; }
    /// <summary>The answer chosen in the email, saved when the page opens (unless it's already the current one).</summary>
    public ShankhNaad.DtoLibrary.MeetingResponse Chosen { get; init; }
    public bool Saved { get; init; }
    public string? Error { get; init; }
    public string? JoinUrl { get; init; }
}

/// <summary>
/// The Team panel on the Calls and Files pages (Views/Shared/_TeamPanel.cshtml): search, pins,
/// and for each person Call / Chat (Calls) or Share / Chat (Files), plus a ⋯ menu (wwwroot/js/people-actions.js).
/// </summary>
public sealed class TeamPanelVm
{
    public List<PersonVm> Team { get; init; } = new();
    /// <summary>Ids of the people you pinned, in pin order.</summary>
    public List<string> Pinned { get; init; } = new();
    /// <summary>Job titles from the Org page (user id → title).</summary>
    public Dictionary<string, string> Titles { get; init; } = new();
    /// <summary>Files page: a Share button on each person, and files can be dropped on a name.</summary>
    public bool Share { get; init; }
}
