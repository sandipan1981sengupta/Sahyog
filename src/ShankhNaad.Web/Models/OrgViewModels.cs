using ShankhNaad.DtoLibrary;

namespace ShankhNaad.Web.Models;

/// <summary>Org page: the chart, departments and the admin dialogs.</summary>
public sealed class OrgViewModel
{
    /// <summary>False until database/40_OrgStructure.sql is run.</summary>
    public bool Ready { get; init; }
    public string TenantName { get; init; } = "";
    public List<OrgPersonDto> People { get; init; } = new();
    public List<DepartmentDto> Departments { get; init; } = new();
    public HashSet<string> Online { get; init; } = new();
    public bool IsAdmin { get; init; }
    public bool CanEmail { get; init; }
    public int MaxUsers { get; init; }
    public int ActiveUsers { get; init; }
    /// <summary>Person to select when the page opens (after saving them).</summary>
    public string? Select { get; init; }
    public string? Message { get; init; }
    public string? Error { get; init; }
}
