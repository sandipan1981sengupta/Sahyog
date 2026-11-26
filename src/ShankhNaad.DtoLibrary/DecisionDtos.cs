namespace ShankhNaad.DtoLibrary;

/// <summary>Nirnay: one decision or action item (46_Nirnay.sql).</summary>
public sealed record DecisionDto(
    int DecisionId, string Kind, string Title, string? Details,
    Guid? OwnerId, string? OwnerName, int OwnerTone, Guid? DepartmentId, string? DepartmentName,
    DateOnly? DueDate, DateTime? DoneUtc,
    Guid? ChannelId, long? MessageId, string? ChannelName, bool ChannelIsDirect,
    Guid? MeetingId, DateOnly? MeetingDate, string? MeetingTitle, Guid? MeetingHostId,
    Guid RecordedBy, string? RecordedByName, DateTime RecordedUtc)
{
    public bool IsAction => Kind == "A";
    /// <summary>Set by the app for the person asking: may they change or delete it.</summary>
    public bool CanEdit { get; init; }
}

/// <summary>What the register is filtered by.</summary>
public sealed record DecisionFilter(
    string? Kind = null, bool Open = false, bool Mine = false, string? Source = null,
    Guid? DepartmentId = null, DateTime? FromUtc = null, string? Search = null, int Top = 300);

/// <summary>Add or change one. DecisionId 0 = new.</summary>
public sealed record DecisionSave(
    int DecisionId, string Kind, string Title, string? Details, Guid? OwnerId, DateOnly? DueDate,
    Guid? ChannelId = null, long? MessageId = null, Guid? MeetingId = null, DateOnly? MeetingDate = null);
