namespace ShankhNaad.DtoLibrary;

/// <summary>Shankh: an urgent alert that rings until each person presses Seen (45_Shankh.sql).</summary>
public sealed record ShankhAlertDto(
    Guid AlertId, string Kind, string Body, string Audience, DateTime SentUtc,
    Guid SenderId, string SenderName, DateTime? ClosedUtc = null, int? RemindAfterMin = null);

/// <summary>One person on an alert's board.</summary>
public sealed record ShankhRecipientDto(
    Guid UserId, string DisplayName, int AvatarTone, string? DepartmentName,
    Guid? ManagerId, string? ManagerName, DateTime? SeenUtc, DateTime? RemindedUtc)
{
    public string Initials => Names.Initials(DisplayName);
}

/// <summary>A line in the admin's list of recent alerts.</summary>
public sealed record ShankhSummaryDto(
    Guid AlertId, string Kind, string Body, string Audience, DateTime SentUtc, DateTime? ClosedUtc,
    string SenderName, int People, int Seen);

/// <summary>A reminder that's due: this person hasn't seen the alert; tell their manager.</summary>
public sealed record ShankhReminderDto(
    Guid AlertId, Guid TenantId, string Body, Guid SenderId,
    Guid UserId, string DisplayName, Guid? ManagerId, string? ManagerName);
