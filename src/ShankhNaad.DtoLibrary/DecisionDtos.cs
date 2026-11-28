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

    // ---- who owns it (55_DecisionOwners.sql; empty before that script is run)
    /// <summary>Someone asked to take it over who hasn't answered yet. Until they Accept, OwnerId stays as it was.</summary>
    public Guid? AskedOwnerId { get; init; }
    public string? AskedOwnerName { get; init; }
    public int AskedOwnerTone { get; init; }
    public DateTime? AskedUtc { get; init; }
    /// <summary>The last person who declined to own it, or handed it back ("Not mine").</summary>
    public Guid? DeclinedBy { get; init; }
    public string? DeclinedByName { get; init; }
    public DateTime? DeclinedUtc { get; init; }
    /// <summary>Set by the app: the person asking was asked to own it, and may Accept or Decline.</summary>
    public bool CanAnswer { get; init; }
    /// <summary>Set by the app: the person asking owns it (and didn't record it), and may hand it back.</summary>
    public bool CanRelease { get; init; }
}

/// <summary>What the register is filtered by.</summary>
public sealed record DecisionFilter(
    string? Kind = null, bool Open = false, bool Mine = false, string? Source = null,
    Guid? DepartmentId = null, DateTime? FromUtc = null, string? Search = null, int Top = 300);

/// <summary>Add or change one. DecisionId 0 = new. AskedOwnerId: someone asked to take it over (they must Accept).</summary>
public sealed record DecisionSave(
    int DecisionId, string Kind, string Title, string? Details, Guid? OwnerId, DateOnly? DueDate,
    Guid? ChannelId = null, long? MessageId = null, Guid? MeetingId = null, DateOnly? MeetingDate = null,
    Guid? AskedOwnerId = null);
