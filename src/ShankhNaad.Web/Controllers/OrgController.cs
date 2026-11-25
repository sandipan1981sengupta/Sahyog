using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Infrastructure;
using ShankhNaad.Web.Models;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Org page: who reports to whom, departments, job titles. Everyone can look;
/// workspace admins edit people, departments and import a CSV (database/40_OrgStructure.sql).
/// </summary>
[Authorize(Roles = AppRoles.TenantAdmin + "," + AppRoles.Member), Route("org")]
public sealed class OrgController : Controller
{
    private readonly IOrgService _org;
    private readonly IUserService _users;
    private readonly ITenantService _tenants;
    private readonly PresenceTracker _presence;
    private readonly IAccountEmailService _mail;
    private readonly IEmailDomainCheck _emailCheck;
    private readonly AppOptions _app;

    public OrgController(IOrgService org, IUserService users, ITenantService tenants, PresenceTracker presence,
        IAccountEmailService mail, IEmailDomainCheck emailCheck, IOptions<AppOptions> app)
    {
        _org = org;
        _users = users;
        _tenants = tenants;
        _presence = presence;
        _mail = mail;
        _emailCheck = emailCheck;
        _app = app.Value;
    }

    private Guid TenantId => User.TenantId()!.Value;
    private const int WelcomeLinkDays = 7;
    private const int MaxCsvRows = 500;
    private const long MaxCsvBytes = 1024 * 1024;
    private const string NeedsDatabase = "The organization chart needs the database update database/40_OrgStructure.sql. Ask CloudWheel to run it.";

    [HttpGet("")]
    public async Task<IActionResult> Index(string? p)
    {
        var data = await _org.GetAsync(TenantId);
        var limits = await _tenants.GetLimitsAsync(TenantId);
        var all = await _users.ListByTenantAsync(TenantId);
        return View(new OrgViewModel
        {
            Ready = data.Ready,
            TenantName = limits?.TenantName ?? User.TenantName() ?? "",
            People = data.People,
            Departments = data.Departments,
            Online = _presence.OnlineUsers(TenantId),
            IsAdmin = User.IsInRole(AppRoles.TenantAdmin),
            CanEmail = _mail.CanSend,
            MaxUsers = limits?.MaxUsers ?? 0,
            ActiveUsers = all.Count(u => u.IsActive),
            Select = p,
            Message = TempData["Message"] as string,
            Error = TempData["Error"] as string
        });
    }

    /// <summary>
    /// The organization chart pop-up (Chat, Calls, Files): one person with who they report to,
    /// who shares their manager, and who reports to them. Works before 40_OrgStructure.sql (no managers then).
    /// </summary>
    [HttpGet("card/{id:guid}")]
    public async Task<IActionResult> Card(Guid id)
    {
        var data = await _org.GetAsync(TenantId);
        var online = _presence.OnlineUsers(TenantId);
        List<OrgPersonDto> people = data.People;
        if (!data.Ready)   // no org fields yet: still show the person
            people = (await _users.ListByTenantAsync(TenantId)).Where(u => u.IsActive)
                .Select(u => new OrgPersonDto(u.UserId, u.DisplayName, u.Email, u.Role, u.AvatarTone, null, null, null, null, null, null, null)).ToList();
        var byId = people.ToDictionary(p => p.UserId);
        if (!byId.TryGetValue(id, out var me)) return NotFound();
        var inv = CultureInfo.InvariantCulture;
        object Mini(OrgPersonDto p) => new
        {
            id = p.Id, n = p.DisplayName, i = p.Initials, t = p.AvatarTone, title = p.JobTitle ?? "", dept = p.DepartmentName ?? "",
            on = online.Contains(p.Id)
        };
        var chain = new List<object>();
        var seen = new HashSet<Guid> { id };
        var up = me.ManagerId;
        while (up is Guid g && seen.Add(g) && chain.Count < 20 && byId.TryGetValue(g, out var boss))
        {
            chain.Insert(0, Mini(boss));
            up = boss.ManagerId;
        }
        var peers = me.ManagerId is Guid mg ? people.Where(p => p.ManagerId == mg && p.UserId != id).OrderBy(p => p.DisplayName).Select(Mini).ToList() : new List<object>();
        var reports = people.Where(p => p.ManagerId == id).OrderBy(p => p.DisplayName).Select(Mini).ToList();
        return Json(new
        {
            ready = data.Ready,
            me = id == User.UserGuid(),
            person = Mini(me),
            email = me.Email, phone = me.Phone ?? "", emp = me.EmployeeCode ?? "",
            joined = me.JoinedOn?.ToString("d MMM yyyy", inv) ?? "",
            chain, peers, reports
        });
    }

    // ---------------- one person ----------------

    /// <summary>Edit person (Org page): name, email, admin role, job, department, manager, phone, employee ID, joined.</summary>
    [HttpPost("person/{id:guid}")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> SavePerson(Guid id, string? displayName, string? email, bool makeAdmin,
        string? jobTitle, string? departmentId, string? managerId, string? phone, string? employeeCode, string? joined)
    {
        var before = (await _users.ListByTenantAsync(TenantId)).FirstOrDefault(u => u.UserId == id && u.IsActive);
        if (before is null) { TempData["Error"] = "That person wasn't found."; return Back(); }

        var self = id == User.UserGuid();
        var name = (displayName ?? "").Trim();
        var mail = (email ?? "").Trim();
        if (name.Length == 0 || mail.Length == 0) { TempData["Error"] = "Name and email are needed. Nothing was changed."; return Back(id); }

        DateOnly? joinedOn = null;
        if (!string.IsNullOrWhiteSpace(joined))
        {
            joinedOn = ParseDay(joined);
            if (joinedOn is null) { TempData["Error"] = "The joined date wasn't understood. Pick it from the calendar."; return Back(id); }
        }

        // 1) name, email, role: only when something changed (changing them signs the person out)
        var role = self || makeAdmin ? AppRoles.TenantAdmin : AppRoles.Member;
        if (name != before.DisplayName || !string.Equals(mail, before.Email, StringComparison.OrdinalIgnoreCase) || role != before.Role)
        {
            if (!string.Equals(mail, before.Email, StringComparison.OrdinalIgnoreCase))
            {
                var check = await _emailCheck.CheckAsync(mail, await KnownDomainsAsync());
                if (check.Status is EmailDomainStatus.NoMail or EmailDomainStatus.Invalid)
                {
                    TempData["Error"] = check.Message + " Nothing was changed.";
                    return Back(id);
                }
            }
            var update = await _users.UpdateAsync(new UpdateUserRequest
            {
                TenantId = TenantId, UserId = id, DisplayName = name, Email = mail, Role = role
            });
            if (!update.Result.Succeeded) { TempData["Error"] = update.Result.Error; return Back(id); }
            if (self && update.NewStamp is Guid stamp)
                await CookieAuth.RefreshSelfAsync(HttpContext, name, mail.ToLowerInvariant(), stamp);
        }

        // 2) place in the organization
        var status = await _org.SetPersonAsync(new OrgPersonUpdate
        {
            TenantId = TenantId,
            UserId = id,
            JobTitle = jobTitle,
            DepartmentId = Guid.TryParse(departmentId, out var d) ? d : null,
            ManagerId = Guid.TryParse(managerId, out var m) ? m : null,
            Phone = phone,
            EmployeeCode = employeeCode,
            JoinedOn = joinedOn
        });
        if (status == OrgSaveStatus.Saved) TempData["Message"] = $"{name} is saved.";
        else TempData["Error"] = OrgError(status, name);
        return Back(id);
    }

    private static string OrgError(OrgSaveStatus status, string name) => status switch
    {
        OrgSaveStatus.SelfManager => $"{name} can't report to themselves. Pick someone else as the manager.",
        OrgSaveStatus.Loop => $"That manager already reports to {name} (directly or further down), so the chart would go round in a circle. Pick someone above {name} instead.",
        OrgSaveStatus.ManagerNotInWorkspace => "That manager isn't an active person in this workspace.",
        OrgSaveStatus.DepartmentNotInWorkspace => "That department no longer exists. Refresh the page and try again.",
        OrgSaveStatus.NotFound => "That person wasn't found.",
        OrgSaveStatus.NeedsDatabase => NeedsDatabase,
        _ => "Could not save."
    };

    private IActionResult Back(Guid? person = null) =>
        person is Guid g ? Redirect($"/org?p={g}") : Redirect("/org");

    // ---------------- departments ----------------

    [HttpPost("departments")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> SaveDepartment(string? id, string? name, string? headUserId)
    {
        var deptId = Guid.TryParse(id, out var g) ? g : (Guid?)null;
        var head = Guid.TryParse(headUserId, out var h) ? h : (Guid?)null;
        var clean = (name ?? "").Trim();
        var (status, _) = await _org.SaveDepartmentAsync(TenantId, deptId, clean, head);
        if (status == DepartmentSaveStatus.Saved)
            TempData["Message"] = deptId is null ? $"Department \"{clean}\" is added." : $"Department \"{clean}\" is saved.";
        else
            TempData["Error"] = status switch
            {
                DepartmentSaveStatus.NameTaken => $"There's already a department called \"{clean}\".",
                DepartmentSaveStatus.NameEmpty => "Give the department a name.",
                DepartmentSaveStatus.HeadNotInWorkspace => "The head must be an active person in this workspace.",
                DepartmentSaveStatus.NotFound => "That department no longer exists.",
                DepartmentSaveStatus.NeedsDatabase => NeedsDatabase,
                _ => "Could not save the department."
            };
        return Redirect("/org?view=dept");
    }

    [HttpPost("departments/{id:guid}/delete")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> DeleteDepartment(Guid id)
    {
        var dept = (await _org.GetAsync(TenantId)).Departments.FirstOrDefault(x => x.DepartmentId == id);
        if (dept is null) { TempData["Error"] = "That department no longer exists."; return Redirect("/org?view=dept"); }
        await _org.DeleteDepartmentAsync(TenantId, id);
        TempData["Message"] = dept.People > 0
            ? $"Department \"{dept.Name}\" is deleted. Its {dept.People} {(dept.People == 1 ? "person stays" : "people stay")} in the workspace, without a department."
            : $"Department \"{dept.Name}\" is deleted.";
        return Redirect("/org?view=dept");
    }

    // ---------------- CSV import ----------------

    /// <summary>An example file with the columns the import understands.</summary>
    [HttpGet("import/template.csv")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public IActionResult Template()
    {
        var csv = "name,email,title,department,manager_email,phone,employee_id,joined\r\n" +
                  "Asha Menon,asha@yourcompany.com,Head of Engineering,Engineering,,+91 98000 00001,EMP-0001,01-04-2023\r\n" +
                  "Ravi Kumar,ravi@yourcompany.com,Developer,Engineering,asha@yourcompany.com,,EMP-0002,15-06-2024\r\n";
        return File(new UTF8Encoding(true).GetBytes(csv), "text/csv", "org-import-template.csv");
    }

    /// <summary>Step 2 (Check): reads the file and says what would happen to each row. Changes nothing.</summary>
    [HttpPost("import/check")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> ImportCheck(IFormFile? file)
    {
        var (plan, error) = await PlanAsync(file);
        if (plan is null) return Json(new { ok = false, error });
        return Json(new
        {
            ok = true,
            file = file!.FileName,
            columns = plan.Columns,
            total = plan.Rows.Count,
            rows = plan.Rows,
            counts = new
            {
                @new = plan.Rows.Count(r => r.Kind == "new"),
                update = plan.Rows.Count(r => r.Kind == "update"),
                warn = plan.Rows.Count(r => r.Kind == "warn"),
                bad = plan.Rows.Count(r => r.Kind == "bad")
            },
            seatsAfter = plan.ActiveUsers + plan.Rows.Count(r => r.Kind == "new"),
            maxUsers = plan.MaxUsers,
            canEmail = _mail.CanSend
        });
    }

    /// <summary>Step 3 (Import): adds the new people, updates the others, skips problem rows.</summary>
    [HttpPost("import/run")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> ImportRun(IFormFile? file, bool sendInvites = true)
    {
        var (plan, error) = await PlanAsync(file);
        if (plan is null) return Json(new { ok = false, error });

        var tenantId = TenantId;
        var problems = new List<string>();
        var added = new List<OrgImportRow>();
        // email → user id, for everyone who can be a manager (already here + added now)
        var ids = plan.Existing.ToDictionary(kv => kv.Key, kv => kv.Value.UserId, StringComparer.OrdinalIgnoreCase);

        // pass 1: add new people
        foreach (var row in plan.Rows.Where(r => r.Kind == "new"))
        {
            var result = await _users.CreateAsync(new CreateUserRequest
            {
                TenantId = tenantId,
                DisplayName = row.Name,
                Email = row.Email,
                Password = Convert.ToBase64String(RandomNumberGenerator.GetBytes(36)),
                Role = AppRoles.Member
            });
            if (result.Succeeded && result.Id is Guid newId) { ids[row.Email] = newId; added.Add(row); }
            else { row.Kind = "bad"; row.Status = result.Error ?? "Could not add"; problems.Add($"Line {row.Line}: {row.Email}: {row.Status}"); }
        }

        // pass 2: departments, titles and managers (managers can be people added in pass 1)
        var org = (await _org.GetAsync(tenantId)).People.ToDictionary(p => p.UserId);
        var deptCache = new Dictionary<string, Guid?>(StringComparer.OrdinalIgnoreCase);
        var updated = 0;
        foreach (var row in plan.Rows.Where(r => r.Kind is "new" or "update"))
        {
            if (!ids.TryGetValue(row.Email, out var userId)) continue;
            org.TryGetValue(userId, out var now);   // what they have today: empty cells keep it

            Guid? dept = now?.DepartmentId;
            if (row.Department.Length > 0)
            {
                if (!deptCache.TryGetValue(row.Department, out dept))
                    deptCache[row.Department] = dept = await _org.EnsureDepartmentAsync(tenantId, row.Department);
            }
            Guid? manager = now?.ManagerId;
            if (row.ManagerEmail.Length > 0 && plan.ManagerEmailFor.TryGetValue(row.Line, out var managerEmail)
                && ids.TryGetValue(managerEmail, out var mid))
                manager = mid;

            var status = await _org.SetPersonAsync(new OrgPersonUpdate
            {
                TenantId = tenantId,
                UserId = userId,
                JobTitle = row.Title.Length > 0 ? row.Title : now?.JobTitle,
                DepartmentId = dept,
                ManagerId = manager,
                Phone = row.Phone.Length > 0 ? row.Phone : now?.Phone,
                EmployeeCode = row.EmployeeId.Length > 0 ? row.EmployeeId : now?.EmployeeCode,
                JoinedOn = ParseDay(row.Joined) ?? now?.JoinedOn
            });
            if (status != OrgSaveStatus.Saved)
                problems.Add($"Line {row.Line}: {row.Email}: {OrgError(status, row.Name.Length > 0 ? row.Name : row.Email)}");
            else if (row.Kind == "update") updated++;
        }

        // pass 3: welcome emails so they set their own password
        var emailed = 0;
        if (sendInvites && _mail.CanSend)
            foreach (var row in added)
            {
                var problem = await EmailWelcomeAsync(row.Email);
                if (problem is null) emailed++;
                else problems.Add($"{row.Email}: welcome email not sent: {problem}");
            }

        var skipped = plan.Rows.Count(r => r.Kind is "warn" or "bad");
        var summary = $"{added.Count} added, {updated} updated" + (skipped > 0 ? $", {skipped} skipped" : "") +
                      (added.Count > 0 ? (emailed > 0 ? $". {emailed} welcome email{(emailed == 1 ? "" : "s")} sent." : ". No welcome emails were sent: use Team → Resend invite.") : ".");
        TempData[problems.Count == 0 ? "Message" : "Error"] = problems.Count == 0
            ? "Import finished: " + summary
            : "Import finished: " + summary + " Some rows had problems: " + string.Join(" · ", problems.Take(5)) + (problems.Count > 5 ? $" · and {problems.Count - 5} more." : "");
        return Json(new { ok = true, added = added.Count, updated, skipped, emailed, problems });
    }

    private sealed class ImportPlan
    {
        public List<OrgImportRow> Rows { get; } = new();
        public List<string> Columns { get; } = new();
        public Dictionary<string, UserDto> Existing { get; set; } = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>Line → the manager's email, once the manager column (an email or a name) is matched.</summary>
        public Dictionary<int, string> ManagerEmailFor { get; } = new();
        public int ActiveUsers { get; set; }
        public int MaxUsers { get; set; }
    }

    private static readonly Dictionary<string, string> HeaderNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["name"] = "name", ["full name"] = "name", ["fullname"] = "name", ["display name"] = "name", ["displayname"] = "name",
        ["email"] = "email", ["e-mail"] = "email", ["mail"] = "email", ["email address"] = "email", ["work email"] = "email",
        ["title"] = "title", ["job title"] = "title", ["jobtitle"] = "title", ["job_title"] = "title", ["designation"] = "title", ["role"] = "title",
        ["department"] = "department", ["dept"] = "department", ["team"] = "department",
        ["manager_email"] = "manager", ["manager email"] = "manager", ["manager"] = "manager", ["reports to"] = "manager", ["reports_to"] = "manager", ["reportsto"] = "manager",
        ["phone"] = "phone", ["mobile"] = "phone", ["phone number"] = "phone", ["contact"] = "phone",
        ["employee_id"] = "employee_id", ["employee id"] = "employee_id", ["employeeid"] = "employee_id", ["emp id"] = "employee_id", ["emp_id"] = "employee_id", ["employee code"] = "employee_id",
        ["joined"] = "joined", ["joined on"] = "joined", ["joining date"] = "joined", ["date of joining"] = "joined", ["doj"] = "joined", ["start date"] = "joined"
    };

    /// <summary>Reads the CSV and decides, row by row, what the import would do.</summary>
    private async Task<(ImportPlan? Plan, string? Error)> PlanAsync(IFormFile? file)
    {
        if (!(await _org.GetAsync(TenantId)).Ready) return (null, NeedsDatabase);
        if (file is null || file.Length == 0) return (null, "Choose a CSV file first.");
        if (file.Length > MaxCsvBytes) return (null, "That file is bigger than 1 MB. Split it into smaller files.");

        string text;
        using (var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8, detectEncodingFromByteOrderMarks: true))
            text = await reader.ReadToEndAsync();
        var table = Csv.Parse(text);
        if (table.Count < 2) return (null, "The file has no rows under the heading line.");
        if (table.Count - 1 > MaxCsvRows) return (null, $"The file has {table.Count - 1} rows. Import at most {MaxCsvRows} at a time.");

        var plan = new ImportPlan();
        var map = new Dictionary<string, int>();
        for (var i = 0; i < table[0].Count; i++)
            if (HeaderNames.TryGetValue(table[0][i].Trim(), out var key) && !map.ContainsKey(key)) { map[key] = i; plan.Columns.Add(key); }
        if (!map.ContainsKey("email")) return (null, "The heading line needs an \"email\" column. Download the template to see the columns.");

        var all = await _users.ListByTenantAsync(TenantId);
        var limits = await _tenants.GetLimitsAsync(TenantId);
        plan.ActiveUsers = all.Count(u => u.IsActive);
        plan.MaxUsers = limits?.MaxUsers ?? 0;
        plan.Existing = all.Where(u => u.IsActive).ToDictionary(u => u.Email, u => u, StringComparer.OrdinalIgnoreCase);
        var inactive = all.Where(u => !u.IsActive).Select(u => u.Email).ToHashSet(StringComparer.OrdinalIgnoreCase);

        string Cell(List<string> row, string key) => map.TryGetValue(key, out var i) && i < row.Count ? row[i].Trim() : "";

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var n = 1; n < table.Count; n++)
        {
            var cells = table[n];
            if (cells.All(string.IsNullOrWhiteSpace)) continue;
            var row = new OrgImportRow
            {
                Line = n + 1,
                Name = Cell(cells, "name"),
                Email = Cell(cells, "email").ToLowerInvariant(),
                Title = Cell(cells, "title"),
                Department = Cell(cells, "department"),
                ManagerEmail = Cell(cells, "manager"),
                Phone = Cell(cells, "phone"),
                EmployeeId = Cell(cells, "employee_id"),
                Joined = Cell(cells, "joined")
            };
            plan.Rows.Add(row);

            if (row.Email.Length == 0) { Bad(row, "Email missing"); continue; }
            if (!LooksLikeEmail(row.Email)) { Bad(row, "Email not valid"); continue; }
            if (!seen.Add(row.Email)) { Bad(row, "Listed twice in the file"); continue; }
            if (plan.Existing.TryGetValue(row.Email, out var here))
            {
                row.Kind = "update"; row.Status = "Update";
                if (row.Name.Length == 0) row.Name = here.DisplayName;
            }
            else if (inactive.Contains(row.Email)) { Bad(row, "Inactive: activate them on the Team page"); continue; }
            else
            {
                if (row.Name.Length == 0) { Bad(row, "Name missing"); continue; }
                var elsewhere = await _users.FindByEmailAsync(row.Email);
                if (elsewhere is not null) { Bad(row, "Email is used in another workspace"); continue; }
                row.Kind = "new"; row.Status = "New";
            }
            if (row.Joined.Length > 0 && ParseDay(row.Joined) is null) { Warn(row, "Joined date not understood"); continue; }
        }

        // seats: new people beyond the plan's limit can't be added
        var free = Math.Max(0, plan.MaxUsers - plan.ActiveUsers);
        foreach (var r in plan.Rows.Where(r => r.Kind == "new").Skip(free).ToList())
            Bad(r, "No seat left on the plan");

        // managers: an email (or a name) of someone already here or added by this file
        var fileOk = plan.Rows.Where(r => r.Kind is "new" or "update").ToList();
        var byEmail = plan.Existing.ToDictionary(kv => kv.Key, kv => kv.Value.DisplayName, StringComparer.OrdinalIgnoreCase);
        foreach (var r in fileOk) byEmail[r.Email] = r.Name;
        var byName = byEmail.GroupBy(kv => kv.Value.Trim(), StringComparer.OrdinalIgnoreCase)
                            .Where(g => g.Count() == 1).ToDictionary(g => g.Key, g => g.First().Key, StringComparer.OrdinalIgnoreCase);
        foreach (var r in fileOk)
        {
            if (r.ManagerEmail.Length == 0) { r.ManagerShown = ""; continue; }
            var key = r.ManagerEmail.Trim();
            string? managerEmail = byEmail.ContainsKey(key) ? key : byName.TryGetValue(key, out var e) ? e : null;
            if (managerEmail is null) { r.ManagerShown = key; Warn(r, "Manager not found"); continue; }
            if (string.Equals(managerEmail, r.Email, StringComparison.OrdinalIgnoreCase)) { r.ManagerShown = key; Warn(r, "Reports to themselves"); continue; }
            plan.ManagerEmailFor[r.Line] = managerEmail.ToLowerInvariant();
            r.ManagerShown = byEmail[managerEmail];
        }
        // a manager row that is itself skipped can't be used
        foreach (var r in plan.Rows.Where(r => r.Kind is "new" or "update" && plan.ManagerEmailFor.ContainsKey(r.Line)))
        {
            var me = plan.ManagerEmailFor[r.Line];
            if (!plan.Existing.ContainsKey(me) && !plan.Rows.Any(x => x.Kind is "new" or "update" && string.Equals(x.Email, me, StringComparison.OrdinalIgnoreCase)))
                Warn(r, "Manager's row is skipped");
        }

        return (plan, null);

        static void Bad(OrgImportRow r, string why) { r.Kind = "bad"; r.Status = why; }
        static void Warn(OrgImportRow r, string why) { r.Kind = "warn"; r.Status = why; }
    }

    private static bool LooksLikeEmail(string s)
    {
        var at = s.IndexOf('@');
        return at > 0 && at == s.LastIndexOf('@') && s.IndexOf('.', at) > at + 1 && !s.EndsWith('.') && !s.Contains(' ');
    }

    private static readonly string[] DayFormats =
        { "dd-MM-yyyy", "d-M-yyyy", "yyyy-MM-dd", "dd/MM/yyyy", "d/M/yyyy", "dd.MM.yyyy", "d MMM yyyy", "dd MMM yyyy", "d MMMM yyyy" };

    private static DateOnly? ParseDay(string? s) =>
        DateOnly.TryParseExact((s ?? "").Trim(), DayFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    private async Task<List<string>> KnownDomainsAsync() =>
        (await _users.ListByTenantAsync(TenantId))
            .Select(u => u.Email.Contains('@') ? u.Email[(u.Email.LastIndexOf('@') + 1)..] : "")
            .Where(x => x.Length > 0).Distinct().ToList();

    /// <summary>Welcome email with a set-password link (same as Team → Add person). Null when sent.</summary>
    private async Task<string?> EmailWelcomeAsync(string email)
    {
        var person = await _users.FindByEmailAsync(email);
        if (person is null || person.TenantId != TenantId) return "not found";
        var (token, error) = await _users.CreatePasswordLinkAsync(person.UserId, PasswordLinkPurpose.Welcome, TimeSpan.FromDays(WelcomeLinkDays));
        if (token is null) return error;
        var url = PasswordLinks.Url(_app, Request, token);
        var sent = await _mail.SendWelcomeAsync(person.Email, person.DisplayName, person.TenantSlug ?? "", person.TenantName ?? "",
            User.DisplayName(), url, WelcomeLinkDays);
        return sent ? null : "the mail server didn't accept it";
    }
}

/// <summary>Small CSV reader: commas (or semicolons), quotes, "" inside quotes, line breaks inside quotes.</summary>
internal static class Csv
{
    public static List<List<string>> Parse(string text)
    {
        var rows = new List<List<string>>();
        if (string.IsNullOrEmpty(text)) return rows;
        text = text.TrimStart('﻿');
        var firstLine = text.Split('\n')[0];
        var sep = firstLine.Count(c => c == ';') > firstLine.Count(c => c == ',') ? ';' : ',';

        var row = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quoted)
            {
                if (c == '"')
                {
                    if (i + 1 < text.Length && text[i + 1] == '"') { cell.Append('"'); i++; }
                    else quoted = false;
                }
                else cell.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c == sep) { row.Add(cell.ToString()); cell.Clear(); }
            else if (c == '\r') { }
            else if (c == '\n') { row.Add(cell.ToString()); cell.Clear(); rows.Add(row); row = new List<string>(); }
            else cell.Append(c);
        }
        if (cell.Length > 0 || row.Count > 0) { row.Add(cell.ToString()); rows.Add(row); }
        return rows;
    }
}
