namespace ShankhNaad.DtoLibrary;

/// <summary>A person on the Org page (sahyog_Org_ListPeople; database/40_OrgStructure.sql).</summary>
public sealed record OrgPersonDto(
    Guid UserId, string DisplayName, string Email, string Role, int AvatarTone,
    string? JobTitle, Guid? DepartmentId, string? DepartmentName, Guid? ManagerId,
    string? Phone, string? EmployeeCode, DateOnly? JoinedOn)
{
    public string Id => UserId.ToString();
    public string Initials => Names.Initials(DisplayName);
}

public sealed record DepartmentDto(Guid DepartmentId, string Name, Guid? HeadUserId, string? HeadName, int People);

/// <summary>Everything the Org page needs. Ready is false until 40_OrgStructure.sql is run.</summary>
public sealed record OrgDataDto(bool Ready, List<OrgPersonDto> People, List<DepartmentDto> Departments);

/// <summary>Job and place in the organization for one person (empty strings = clear).</summary>
public sealed class OrgPersonUpdate
{
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public string? JobTitle { get; set; }
    public Guid? DepartmentId { get; set; }
    public Guid? ManagerId { get; set; }
    public string? Phone { get; set; }
    public string? EmployeeCode { get; set; }
    public DateOnly? JoinedOn { get; set; }
}

public enum OrgSaveStatus
{
    Saved = 0,
    NotFound = 1,
    SelfManager = 2,
    Loop = 3,
    ManagerNotInWorkspace = 4,
    DepartmentNotInWorkspace = 5,
    /// <summary>database/40_OrgStructure.sql hasn't been run yet.</summary>
    NeedsDatabase = 99
}

public enum DepartmentSaveStatus
{
    Saved = 0,
    NameTaken = 1,
    NotFound = 2,
    HeadNotInWorkspace = 3,
    NameEmpty = 4,
    NeedsDatabase = 99
}

/// <summary>One row of an org CSV after checking (shown in the import preview).</summary>
public sealed class OrgImportRow
{
    public int Line { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Title { get; set; } = "";
    public string Department { get; set; } = "";
    public string ManagerEmail { get; set; } = "";
    public string Phone { get; set; } = "";
    public string EmployeeId { get; set; } = "";
    public string Joined { get; set; } = "";
    /// <summary>new, update, warn (skipped), bad (skipped).</summary>
    public string Kind { get; set; } = "new";
    public string Status { get; set; } = "New";
    /// <summary>Who they report to, as shown (a name when found, else what the file said).</summary>
    public string ManagerShown { get; set; } = "";
}
