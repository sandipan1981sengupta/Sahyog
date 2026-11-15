using System.ComponentModel.DataAnnotations;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary;
using Sahyog.ServiceLibrary.Video;

namespace Sahyog.Web.Models;

// ---------- Account ----------

public sealed class LoginViewModel
{
    [Display(Name = "Workspace")]
    [MaxLength(40)]
    public string? Workspace { get; set; }

    [Required, EmailAddress]
    public string Email { get; set; } = "";

    [Required, DataType(DataType.Password)]
    public string Password { get; set; } = "";

    public bool RememberMe { get; set; } = true;

    public string? ReturnUrl { get; set; }
}

// ---------- Chat ----------

public sealed record PersonVm(string Id, string Name, string Initials, int Tone, bool Online, string? Role = null);

public sealed record ChannelVm(Guid Id, string Name, bool IsDirect, int Unread, PersonVm? DirectWith);

public sealed class ChatViewModel
{
    public required TenantLimitsDto Limits { get; init; }
    public required List<ChannelVm> Channels { get; init; }
    public required List<ChannelVm> Directs { get; init; }
    public ChannelVm? Current { get; init; }
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
    bool IsNew);

public sealed record CalendarDayVm(DateOnly Date, bool IsToday, List<CalendarEventVm> Events);

public sealed class ScheduleMeetingInput
{
    [Required, MaxLength(150)]
    public string Title { get; set; } = "";

    [MaxLength(2000)]
    public string? Agenda { get; set; }

    [Required]
    public DateOnly Date { get; set; }

    [Required]
    public TimeOnly Time { get; set; } = new(10, 0);

    [Range(15, 1440)]
    public int DurationMinutes { get; set; } = 30;

    public MeetingRecurrence Recurrence { get; set; }

    public List<string> InviteeIds { get; set; } = new();

    /// <summary>Comma or newline separated.</summary>
    [MaxLength(2000)]
    public string? GuestEmails { get; set; }

    public bool GuestLinkEnabled { get; set; } = true;
    public bool LobbyEnabled { get; set; } = true;
    public bool SendEmail { get; set; } = true;
    public bool CaptionsOn { get; set; }
}

public sealed class MeetingsViewModel
{
    public required DateOnly WeekStart { get; init; }
    public required List<CalendarDayVm> Days { get; init; }
    public CalendarEventVm? UpNext { get; init; }
    public int UpNextMinutes { get; init; }
    public required List<PersonVm> Team { get; init; }
    public required ScheduleMeetingInput Form { get; init; }
    public required TenantLimitsDto Limits { get; init; }
    public MeetingDto? JustScheduled { get; init; }
    public string? JustScheduledGuestUrl { get; init; }
    public double NowHour { get; init; }
    public int StartHour { get; init; } = 8;
    public int EndHour { get; init; } = 19;
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
    public string? GuestUrl { get; init; }
    public string? ChannelName { get; init; }
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

public sealed record TenantRowVm(Guid Id, string Name, string Slug, string Plan, int Users, int MaxUsers, long StorageUsed, long StorageQuota, string Provider, bool IsActive, DateTime CreatedUtc);

public sealed class CreateTenantInput
{
    [Required, MaxLength(120)]
    public string Name { get; set; } = "";

    [Required, MaxLength(40), RegularExpression("^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$", ErrorMessage = "Use 3–40 lowercase letters, numbers or hyphens.")]
    public string Slug { get; set; } = "";

    [Required]
    public int PlanId { get; set; }

    [Required, MaxLength(100)]
    public string AdminName { get; set; } = "";

    [Required, EmailAddress]
    public string AdminEmail { get; set; } = "";

    [Required, MinLength(8), DataType(DataType.Password)]
    public string AdminPassword { get; set; } = "";
}

public sealed class AdminViewModel
{
    public required List<TenantRowVm> Tenants { get; init; }
    public required List<PlanDto> Plans { get; init; }
    public required CreateTenantInput NewTenant { get; init; }
    public string? Message { get; init; }
    public string? Error { get; init; }
}

public sealed class AddMemberInput
{
    [Required, MaxLength(100)]
    public string DisplayName { get; set; } = "";

    [Required, EmailAddress]
    public string Email { get; set; } = "";

    [Required, MinLength(8), DataType(DataType.Password)]
    public string TemporaryPassword { get; set; } = "";

    public bool MakeAdmin { get; set; }
}

public sealed class TeamViewModel
{
    public required TenantLimitsDto Limits { get; init; }
    public required int ActiveUsers { get; init; }
    public required List<PersonVm> People { get; init; }
    public required List<PersonVm> Inactive { get; init; }
    public required AddMemberInput NewMember { get; init; }
    public string? Message { get; init; }
    public string? Error { get; init; }
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

    [MaxLength(40), RegularExpression("^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$", ErrorMessage = "Workspace: 3–40 lowercase letters, numbers or hyphens.")]
    public string? Workspace { get; set; }

    [MaxLength(100), Display(Name = "Client admin name")]
    public string? ClientAdminName { get; set; }

    [EmailAddress, Display(Name = "Client admin email")]
    public string? ClientAdminEmail { get; set; }

    [MinLength(8), DataType(DataType.Password), Display(Name = "Client admin password")]
    public string? ClientAdminPassword { get; set; }

    public int PlanId { get; set; }
}
