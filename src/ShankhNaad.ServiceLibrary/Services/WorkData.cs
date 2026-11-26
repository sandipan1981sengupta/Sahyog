using System.Data;
using System.Globalization;
using Microsoft.Data.SqlClient;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>
/// One row from a stored procedure, ready to send to the browser as JSON: camelCase names,
/// NULL → null, DATE → "yyyy-MM-dd", *Utc columns marked as UTC. Used by the Work features
/// (stand-up, roles, visitors, approvals, holidays, languages: database 47–53).
/// </summary>
public sealed class Row : Dictionary<string, object?>
{
    public Row() : base(StringComparer.OrdinalIgnoreCase) { }

    public Guid G(string key) => this.TryGetValue(key, out var v) && v is Guid g ? g : Guid.Empty;
    public Guid? GN(string key) => this.TryGetValue(key, out var v) && v is Guid g ? g : null;
    public string? S(string key) => this.TryGetValue(key, out var v) && v is not null ? Convert.ToString(v, CultureInfo.InvariantCulture) : null;
    public int I(string key) => this.TryGetValue(key, out var v) && v is not null ? Convert.ToInt32(v, CultureInfo.InvariantCulture) : 0;
    public long L(string key) => this.TryGetValue(key, out var v) && v is not null ? Convert.ToInt64(v, CultureInfo.InvariantCulture) : 0;
    public bool B(string key) => this.TryGetValue(key, out var v) && v is not null && Convert.ToBoolean(v, CultureInfo.InvariantCulture);
    public decimal? M(string key) => this.TryGetValue(key, out var v) && v is not null ? Convert.ToDecimal(v, CultureInfo.InvariantCulture) : null;
    public DateTime? Utc(string key) => this.TryGetValue(key, out var v) && v is DateTime d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null;
    public DateOnly? Day(string key) => this.TryGetValue(key, out var v) && v is string s
        && DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
}

public interface IWorkData
{
    /// <summary>Every result set of the procedure.</summary>
    Task<List<List<Row>>> SetsAsync(string procedure, Action<SqlParameterCollection>? parameters = null);
    /// <summary>The first result set.</summary>
    Task<List<Row>> RowsAsync(string procedure, Action<SqlParameterCollection>? parameters = null);
    /// <summary>The first row of the first result set, or null.</summary>
    Task<Row?> RowAsync(string procedure, Action<SqlParameterCollection>? parameters = null);
    Task ExecAsync(string procedure, Action<SqlParameterCollection>? parameters = null);
}

public sealed class WorkData : IWorkData
{
    private readonly SqlDb _db;
    public WorkData(SqlDb db) => _db = db;

    private static string Camel(string name) => name.Length == 0 ? name : char.ToLowerInvariant(name[0]) + name[1..];

    private static Row Read(SqlDataReader r)
    {
        var row = new Row();
        for (var i = 0; i < r.FieldCount; i++)
        {
            var name = Camel(r.GetName(i));
            if (r.IsDBNull(i)) { row[name] = null; continue; }
            var type = r.GetDataTypeName(i);
            var v = r.GetValue(i);
            row[name] = v switch
            {
                DateTime d when type.Equals("date", StringComparison.OrdinalIgnoreCase) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                DateTime d => DateTime.SpecifyKind(d, DateTimeKind.Utc),
                TimeSpan t => t.ToString(@"hh\:mm", CultureInfo.InvariantCulture),
                byte b => (int)b,
                short s => (int)s,
                _ => v
            };
        }
        return row;
    }

    public async Task<List<List<Row>>> SetsAsync(string procedure, Action<SqlParameterCollection>? parameters = null)
    {
        await using var connection = await _db.OpenAsync();
        await using var command = new SqlCommand(procedure, connection) { CommandType = CommandType.StoredProcedure, CommandTimeout = 30 };
        parameters?.Invoke(command.Parameters);
        var sets = new List<List<Row>>();
        await using var reader = await command.ExecuteReaderAsync();
        do
        {
            var rows = new List<Row>();
            while (await reader.ReadAsync()) rows.Add(Read(reader));
            sets.Add(rows);
        } while (await reader.NextResultAsync());
        return sets;
    }

    public async Task<List<Row>> RowsAsync(string procedure, Action<SqlParameterCollection>? parameters = null)
    {
        var sets = await SetsAsync(procedure, parameters);
        return sets.Count > 0 ? sets[0] : new();
    }

    public async Task<Row?> RowAsync(string procedure, Action<SqlParameterCollection>? parameters = null)
    {
        var rows = await RowsAsync(procedure, parameters);
        return rows.Count > 0 ? rows[0] : null;
    }

    public Task ExecAsync(string procedure, Action<SqlParameterCollection>? parameters = null) => _db.ExecAsync(procedure, parameters);
}
