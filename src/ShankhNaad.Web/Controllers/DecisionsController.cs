using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Hubs;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>The Work page (rail "Work"): Decisions now; stand-ups, approvals and visitors join it later.</summary>
[Authorize(Roles = AppRoles.TenantAdmin + "," + AppRoles.Member), Route("work")]
public sealed class WorkController : Controller
{
    [HttpGet("")]
    public IActionResult Index() => Redirect("/work/decisions");
}

/// <summary>
/// Nirnay, the decision log (database/46_Nirnay.sql).
/// "Mark as decision" on a chat message, "Decisions and action items" at the end of a meeting,
/// and one searchable register. Real-time: "Decision" (added or changed) and "DecisionDeleted" go to the chat it came from.
/// Who sees what is decided in the database (sahyog_Decision_CanSee): the chat's people, the meeting's people,
/// the owner and whoever recorded it; ones added on the register are for the whole workspace.
/// </summary>
[Route("work/decisions")]
public sealed class DecisionsController : WorkControllerBase
{
    private const string NeedsDatabase = "Decisions need the database update database/46_Nirnay.sql (or 99_ApplyAllUpdates.sql). Ask CloudWheel to run it.";
    private const string NeedsOwnersScript = "Asking someone to own it needs the database update database/55_DecisionOwners.sql (or 99_ApplyAllUpdates.sql). Ask CloudWheel to run it.";

    private readonly IDecisionService _decisions;
    private readonly IChatService _chat;
    private readonly IMeetingService _meetings;
    private readonly IOrgService _org;
    private readonly IUserService _users;
    private readonly ITenantService _tenants;
    private readonly IHubContext<ChatHub> _hub;

    public DecisionsController(IDecisionService decisions, IChatService chat, IMeetingService meetings, IOrgService org,
        IUserService users, ITenantService tenants, IHubContext<ChatHub> hub)
    {
        _decisions = decisions;
        _chat = chat;
        _meetings = meetings;
        _org = org;
        _users = users;
        _tenants = tenants;
        _hub = hub;
    }


    // ------------------------------------------------------------------ the page

    [HttpGet("")]
    public Task<IActionResult> Index() => WorkFormPageAsync("Decisions", "Decisions");

    /// <summary>The "Record a decision" window (Views/Work/_DecisionDialog.cshtml, tag-helper controls).
    /// js/nirnay.js loads it once per page, the first time it's needed (chat, meetings, this page).</summary>
    [HttpGet("dialog")]
    public async Task<IActionResult> Dialog()
    {
        await LoadPickListsAsync();
        // people who can't be made the owner straight away are marked: they will be asked
        var rules = await OwnerRulesAsync();
        if (ViewData["People"] is List<(string Value, string Text)> people)
            ViewData["People"] = people.Select(p => Guid.TryParse(p.Value, out var id) && !rules.CanAssign(id) ? (p.Value, p.Text + " · will be asked") : p).ToList();
        Response.Headers.CacheControl = "no-store";
        return PartialView("~/Views/Work/_DecisionDialog.cshtml");
    }

    /// <summary>
    /// Who this person may make the owner straight away (database/55_DecisionOwners.sql):
    /// themselves, anyone below them in the reporting line (Org page: manager → manager → … → them), anyone in a
    /// department they head, and, for admins, anyone. Everyone else is asked and becomes the owner only when they Accept.
    /// </summary>
    private sealed record OwnerRules(Func<Guid, bool> CanAssign, Func<Guid, string?> Name);

    private async Task<OwnerRules> OwnerRulesAsync()
    {
        var org = await _org.GetAsync(TenantId);
        var names = org.People.Count > 0
            ? org.People.GroupBy(p => p.UserId).ToDictionary(g => g.Key, g => g.First().DisplayName)
            : (await _users.ListByTenantAsync(TenantId)).GroupBy(u => u.UserId).ToDictionary(g => g.Key, g => g.First().DisplayName);
        string? Name(Guid id) => names.TryGetValue(id, out var n) ? n : null;
        var me = Me;
        if (IsAdmin) return new(_ => true, Name);
        var manager = org.People.GroupBy(p => p.UserId).ToDictionary(g => g.Key, g => g.First().ManagerId);
        var dept = org.People.GroupBy(p => p.UserId).ToDictionary(g => g.Key, g => g.First().DepartmentId);
        var headOf = org.Departments.Where(d => d.HeadUserId == me).Select(d => d.DepartmentId).ToHashSet();
        bool Below(Guid person)
        {
            var seen = new HashSet<Guid>();          // a loop in the org chart can't hang this
            var up = manager.GetValueOrDefault(person);
            while (up is Guid m && seen.Add(m))
            {
                if (m == me) return true;
                up = manager.GetValueOrDefault(m);
            }
            return false;
        }
        return new(person => person == me || Below(person) || (dept.GetValueOrDefault(person) is Guid d && headOf.Contains(d)), Name);
    }

    /// <summary>Everyone active (owner pickers). From the org chart, or just names when it isn't set up.
    /// assign = may be made the owner straight away; otherwise they are asked and must accept.</summary>
    private async Task<List<object>> PeopleAsync()
    {
        var rules = await OwnerRulesAsync();
        var org = await _org.GetAsync(TenantId);
        if (org.People.Count > 0)
            return org.People.OrderBy(p => p.DisplayName, StringComparer.OrdinalIgnoreCase)
                .Select(p => (object)new { id = p.UserId, name = p.DisplayName, dept = p.DepartmentName, title = p.JobTitle, tone = p.AvatarTone, assign = rules.CanAssign(p.UserId) }).ToList();
        return (await _users.ListByTenantAsync(TenantId)).Where(u => u.IsActive).OrderBy(u => u.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(u => (object)new { id = u.UserId, name = u.DisplayName, dept = (string?)null, title = (string?)null, tone = u.AvatarTone, assign = rules.CanAssign(u.UserId) }).ToList();
    }

    [HttpGet("people")]
    public async Task<IActionResult> People() => Json(await PeopleAsync());

    // ------------------------------------------------------------------ reading

    private DecisionDto WithRights(DecisionDto d) => d with
    {
        CanEdit = IsAdmin || d.RecordedBy == Me || d.OwnerId == Me || (d.MeetingHostId is Guid h && h == Me),
        CanAnswer = d.AskedOwnerId == Me,
        CanRelease = d.OwnerId == Me && d.RecordedBy != Me
    };

    private static DecisionFilter Filter(string? kind, bool open, bool mine, string? source, Guid? dept, string? period, string? q, int top) =>
        new(kind is "A" or "D" ? kind : null, open, mine, source, dept,
            period switch
            {
                "7" => DateTime.UtcNow.AddDays(-7),
                "30" => DateTime.UtcNow.AddDays(-30),
                "90" => DateTime.UtcNow.AddDays(-90),
                "365" => DateTime.UtcNow.AddDays(-365),
                _ => null
            }, q, top);

    /// <summary>The register: /work/decisions/list?kind=D|A&amp;open=true&amp;mine=true&amp;source=chat|meeting|other&amp;dept=…&amp;period=30&amp;q=…</summary>
    [HttpGet("list")]
    public async Task<IActionResult> List(string? kind, bool open, bool mine, string? source, Guid? dept, string? period, string? q)
    {
        var rows = await _decisions.ListAsync(TenantId, Me, Filter(kind, open, mine, source, dept, period, q, 300));
        Response.Headers.CacheControl = "no-store";
        return Json(rows.Select(WithRights));
    }

    /// <summary>The same list as a CSV file (opens in Excel).</summary>
    [HttpGet("export")]
    public async Task<IActionResult> Export(string? kind, bool open, bool mine, string? source, Guid? dept, string? period, string? q)
    {
        var rows = await _decisions.ListAsync(TenantId, Me, Filter(kind, open, mine, source, dept, period, q, 1000));
        var limits = await _tenants.GetLimitsAsync(TenantId);
        var zone = MeetingCalendar.FindZone(limits?.TimeZoneId);
        var sb = new StringBuilder();
        sb.AppendLine("Type,Decision or action,Details,Owner,Waiting for,Team,Due,Done,Where,Recorded by,Recorded on");
        foreach (var d in rows)
        {
            var where = d.MessageId is not null ? (d.ChannelIsDirect ? "One-to-one chat" : $"Chat: {d.ChannelName}")
                : d.MeetingId is not null ? $"Meeting: {d.MeetingTitle}" : "Added on the register";
            sb.AppendLine(string.Join(",", new[]
            {
                d.IsAction ? "Action item" : "Decision", d.Title, d.Details, d.OwnerName, d.AskedOwnerName, d.DepartmentName,
                d.DueDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                d.IsAction ? (d.DoneUtc is null ? "Open" : "Done") : "",
                where, d.RecordedByName,
                MeetingCalendar.ToLocal(d.RecordedUtc, zone).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)
            }.Select(Csv)));
        }
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        return File(bytes, "text/csv", $"decisions-{DateTime.UtcNow:yyyy-MM-dd}.csv");
    }

    /// <summary>One CSV cell; a cell that starts like a formula is kept as text (Excel won't run it).</summary>
    private static string Csv(string? v)
    {
        v ??= "";
        if (v.Length > 0 && "=+-@\t\r".Contains(v[0])) v = "'" + v;
        return v.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v;
    }

    /// <summary>The cards under the chat messages on screen: /work/decisions/messages?ids=1,2,3</summary>
    [HttpGet("messages")]
    public async Task<IActionResult> ForMessages(string? ids)
    {
        var list = (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => long.TryParse(x, out var n) ? n : 0).Where(n => n > 0);
        var rows = await _decisions.ForMessagesAsync(TenantId, Me, list);
        return Json(rows.Select(WithRights));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var d = await _decisions.GetAsync(TenantId, Me, id);
        return d is null ? NotFound(new { error = "That decision was deleted, or it isn't shared with you." }) : Json(WithRights(d));
    }

    // ------------------------------------------------------------------ changing

    public sealed class SaveInput
    {
        public int DecisionId { get; set; }
        public string? Kind { get; set; }
        public string? Title { get; set; }
        public string? Details { get; set; }
        public Guid? OwnerId { get; set; }
        public string? DueDate { get; set; }
        public Guid? ChannelId { get; set; }
        public long? MessageId { get; set; }
        public Guid? MeetingId { get; set; }
        public string? MeetingDate { get; set; }
    }

    private static DateOnly? Day(string? s) =>
        DateOnly.TryParseExact(s ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    private static string Clip(string? s, int max)
    {
        s = (s ?? "").Trim();
        return s.Length > max ? s[..max] : s;
    }

    /// <summary>May this person add decisions to this meeting? (the organizer, anyone invited, or an admin)</summary>
    private async Task<(bool Ok, MeetingDto? Meeting)> CanUseMeetingAsync(Guid meetingId)
    {
        var meeting = await _meetings.GetAsync(TenantId, meetingId);
        if (meeting is null) return (false, null);
        if (IsAdmin || meeting.HostId == Me) return (true, meeting);
        var invitees = await _meetings.GetInviteesAsync(TenantId, meetingId);
        return (invitees.Any(i => i.UserId == Me), meeting);
    }

    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] SaveInput input)
    {
        var title = Clip(input.Title, 300);
        if (title.Length == 0) return BadRequest(new { error = "Write what was decided." });
        var kind = input.Kind == "A" ? "A" : "D";
        var details = Clip(input.Details, 1000);
        var due = kind == "A" ? Day(input.DueDate) : null;

        DecisionDto? before = null;
        if (input.DecisionId > 0)
        {
            before = await _decisions.GetAsync(TenantId, Me, input.DecisionId);
            if (before is null) return NotFound(new { error = "That decision was deleted." });
            if (!WithRights(before).CanEdit) return StatusCode(403, new { error = "Only the person who recorded it, its owner or an admin can change it." });
        }
        else if (input.MessageId is long)
        {
            if (input.ChannelId is not Guid ch || !await _chat.IsMemberAsync(TenantId, ch, Me))
                return StatusCode(403, new { error = "You're not in that chat." });
        }
        else if (input.MeetingId is Guid mid)
        {
            if (!(await CanUseMeetingAsync(mid)).Ok) return StatusCode(403, new { error = "Only people invited to that meeting can add its decisions." });
        }

        // Who owns it (55_DecisionOwners.sql): you can make yourself or someone below you the owner straight away;
        // anyone else is asked, and until they accept it stays with its current owner (a new one: with you).
        var rules = await OwnerRulesAsync();
        Guid? owner = input.OwnerId, asked = null;
        if (before is not null && owner == before.OwnerId)
            asked = before.AskedOwnerId;                                          // owner not changed: a pending ask stays
        else if (before is not null && owner is Guid same && same == before.AskedOwnerId)
            (owner, asked) = (before.OwnerId, same);                              // still waiting for the same person
        else if (owner is Guid o && !rules.CanAssign(o))
            (owner, asked) = (before is null ? Me : before.OwnerId ?? Me, o);     // ask them
        int id;
        try
        {
            id = await _decisions.SaveAsync(TenantId, Me, new DecisionSave(
                input.DecisionId, kind, title, details.Length == 0 ? null : details, owner, due,
                input.MessageId is null ? null : input.ChannelId, input.MessageId, input.MeetingId, Day(input.MeetingDate), asked));
        }
        catch (Microsoft.Data.SqlClient.SqlException)
        {
            return StatusCode(503, new { error = asked is null ? NeedsDatabase : NeedsOwnersScript });
        }
        if (id == 0) return NotFound(new { error = "That message was deleted." });

        var saved = await _decisions.GetAsync(TenantId, Me, id);
        if (saved is null) return Json(new { decisionId = id });
        if (saved.ChannelId is Guid channel && saved.MessageId is not null)
            await _hub.Clients.Group(ChatHub.ChannelGroup(channel)).SendAsync("Decision", saved);
        // a new ask: the person asked gets a note on screen (and finds it under "Waiting for your answer")
        if (saved.AskedOwnerId is Guid who && who != before?.AskedOwnerId)
            await _hub.Clients.User(who.ToString()).SendAsync("DecisionAsked",
                new { decisionId = id, title = saved.Title, isAction = saved.IsAction, by = rules.Name(Me) ?? "Someone" });
        return Json(WithRights(saved));
    }

    public sealed class DoneInput { public bool Done { get; set; } }

    /// <summary>An action item is done (or not). Anyone who can see it may tick it.</summary>
    [HttpPost("{id:int}/done")]
    public async Task<IActionResult> Done(int id, [FromBody] DoneInput input)
    {
        var d = await _decisions.GetAsync(TenantId, Me, id);
        if (d is null) return NotFound(new { error = "That action item was deleted." });
        if (!await _decisions.SetDoneAsync(TenantId, Me, id, input.Done)) return BadRequest(new { error = "Only action items can be ticked." });
        var saved = await _decisions.GetAsync(TenantId, Me, id);
        if (saved?.ChannelId is Guid channel && saved.MessageId is not null)
            await _hub.Clients.Group(ChatHub.ChannelGroup(channel)).SendAsync("Decision", saved);
        return Json(saved is null ? null : WithRights(saved));
    }

    public sealed class AnswerInput { public bool Accept { get; set; } }

    /// <summary>The person asked to own it answers. Accept: they become the owner. Decline: it stays with whoever had it.</summary>
    [HttpPost("{id:int}/answer")]
    public async Task<IActionResult> Answer(int id, [FromBody] AnswerInput input)
    {
        var d = await _decisions.GetAsync(TenantId, Me, id);
        if (d is null) return NotFound(new { error = "That decision was deleted." });
        if (d.AskedOwnerId != Me) return StatusCode(409, new { error = "This isn't waiting for your answer any more." });
        bool ok;
        try { ok = await _decisions.AnswerAsync(TenantId, Me, id, input.Accept); }
        catch (Microsoft.Data.SqlClient.SqlException) { return StatusCode(503, new { error = NeedsOwnersScript }); }
        if (!ok) return StatusCode(409, new { error = "This isn't waiting for your answer any more." });
        var rules = await OwnerRulesAsync();
        var note = new { decisionId = id, title = d.Title, isAction = d.IsAction, accepted = input.Accept, handedBack = false, by = rules.Name(Me) ?? "Someone" };
        foreach (var who in new[] { d.OwnerId, (Guid?)d.RecordedBy }.OfType<Guid>().Where(u => u != Me).Distinct())
            await _hub.Clients.User(who.ToString()).SendAsync("DecisionAnswered", note);
        var saved = await _decisions.GetAsync(TenantId, Me, id);        // after Decline you may not see it any more
        if (saved?.ChannelId is Guid channel && saved.MessageId is not null)
            await _hub.Clients.Group(ChatHub.ChannelGroup(channel)).SendAsync("Decision", saved);
        return saved is null ? Json(new { decisionId = id, gone = true }) : Json(WithRights(saved));
    }

    /// <summary>"Not mine": the owner hands it back to whoever recorded it (who is told).</summary>
    [HttpPost("{id:int}/release")]
    public async Task<IActionResult> Release(int id)
    {
        var d = await _decisions.GetAsync(TenantId, Me, id);
        if (d is null) return NotFound(new { error = "That decision was deleted." });
        if (d.OwnerId != Me || d.RecordedBy == Me) return StatusCode(409, new { error = "Only its owner can hand it back, and not to themselves." });
        bool ok;
        try { ok = await _decisions.ReleaseAsync(TenantId, Me, id); }
        catch (Microsoft.Data.SqlClient.SqlException) { return StatusCode(503, new { error = NeedsOwnersScript }); }
        if (!ok) return StatusCode(409, new { error = "It changed in the meantime. Open it again." });
        var rules = await OwnerRulesAsync();
        await _hub.Clients.User(d.RecordedBy.ToString()).SendAsync("DecisionAnswered",
            new { decisionId = id, title = d.Title, isAction = d.IsAction, accepted = false, handedBack = true, by = rules.Name(Me) ?? "Someone" });
        var saved = await _decisions.GetAsync(TenantId, Me, id);
        if (saved?.ChannelId is Guid channel && saved.MessageId is not null)
            await _hub.Clients.Group(ChatHub.ChannelGroup(channel)).SendAsync("Decision", saved);
        return saved is null ? Json(new { decisionId = id, gone = true }) : Json(WithRights(saved));
    }

    [HttpPost("{id:int}/delete")]
    public async Task<IActionResult> Delete(int id)
    {
        var d = await _decisions.GetAsync(TenantId, Me, id);
        if (d is null) return Json(new { ok = true });
        if (!WithRights(d).CanEdit) return StatusCode(403, new { error = "Only the person who recorded it, its owner or an admin can delete it." });
        await _decisions.DeleteAsync(TenantId, id);
        if (d.ChannelId is Guid channel && d.MessageId is long mid)
            await _hub.Clients.Group(ChatHub.ChannelGroup(channel)).SendAsync("DecisionDeleted", id, mid);
        return Json(new { ok = true });
    }

    // ------------------------------------------------------------------ a meeting's decisions and action items

    private async Task<DateOnly> MeetingDayAsync(string? date)
    {
        if (Day(date) is DateOnly d) return d;
        var limits = await _tenants.GetLimitsAsync(TenantId);
        return DateOnly.FromDateTime(MeetingCalendar.ToLocal(DateTime.UtcNow, MeetingCalendar.FindZone(limits?.TimeZoneId)));
    }

    /// <summary>/work/decisions/meeting/{id}?date=yyyy-MM-dd : the list for the "Decisions and action items" window.</summary>
    [HttpGet("meeting/{id:guid}")]
    public async Task<IActionResult> Meeting(Guid id, string? date)
    {
        var (ok, meeting) = await CanUseMeetingAsync(id);
        if (meeting is null) return NotFound(new { error = "That meeting was deleted." });
        if (!ok) return StatusCode(403, new { error = "Only people invited to that meeting can see its decisions." });
        var day = await MeetingDayAsync(date);
        var items = await _decisions.ForMeetingAsync(TenantId, id, day);
        var canPost = meeting.ChannelId is Guid ch && await _chat.IsMemberAsync(TenantId, ch, Me);
        Response.Headers.CacheControl = "no-store";
        return Json(new
        {
            meetingId = id,
            title = meeting.Title,
            date = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            isHost = meeting.HostId == Me,
            chatName = canPost ? (meeting.ChannelIsDirect ? "the chat" : meeting.ChannelName) : null,
            items = items.Select(WithRights)
        });
    }

    /// <summary>Posts the meeting's decisions and action items into its chat, as one message from you.</summary>
    [HttpPost("meeting/{id:guid}/post")]
    public async Task<IActionResult> PostToChat(Guid id, string? date)
    {
        var (ok, meeting) = await CanUseMeetingAsync(id);
        if (!ok || meeting is null) return StatusCode(403, new { error = "Only people invited to that meeting can do this." });
        if (meeting.ChannelId is not Guid ch || !await _chat.IsMemberAsync(TenantId, ch, Me))
            return BadRequest(new { error = "This meeting has no chat to post in." });
        var day = await MeetingDayAsync(date);
        var items = await _decisions.ForMeetingAsync(TenantId, id, day);
        if (items.Count == 0) return BadRequest(new { error = "Add a decision or an action item first." });

        var sb = new StringBuilder();
        sb.Append("⚖ Decisions and action items · ").Append(meeting.Title).Append(" · ")
          .Append(day.ToString("ddd d MMM", CultureInfo.InvariantCulture)).Append('\n');
        var dec = items.Where(i => !i.IsAction).ToList();
        var act = items.Where(i => i.IsAction).ToList();
        if (dec.Count > 0)
        {
            sb.Append("\nDecisions\n");
            foreach (var d in dec) sb.Append("• ").Append(d.Title).Append(d.OwnerName is null ? "" : $" (owner: {d.OwnerName})")
                                     .Append(d.AskedOwnerName is null ? "" : $" (asked {d.AskedOwnerName})").Append('\n');
        }
        if (act.Count > 0)
        {
            sb.Append("\nAction items\n");
            foreach (var a in act)
                sb.Append(a.DoneUtc is null ? "☐ " : "☑ ").Append(a.Title)
                  .Append(a.OwnerName is null ? "" : $" · {a.OwnerName}")
                  .Append(a.AskedOwnerName is null ? "" : $" (asked {a.AskedOwnerName})")
                  .Append(a.DueDate is DateOnly due ? $" · by {due.ToString("ddd d MMM", CultureInfo.InvariantCulture)}" : "").Append('\n');
        }
        var body = sb.ToString().TrimEnd();
        if (body.Length > 3900) body = body[..3900] + "…";

        var (status, message) = await _chat.SendMessageAsync(new SendMessageRequest(TenantId, ch, Me, body));
        if (status != SendStatus.Ok || message is null) return BadRequest(new { error = "Couldn't post in the chat." });
        if (await _chat.GetChannelAsync(TenantId, ch) is { IsDirect: false } group)
            message = message with { FromGroup = group.Name };
        await _hub.Clients.Group(ChatHub.ChannelGroup(ch)).SendAsync("MessageReceived", message);
        return Json(new { ok = true, chatId = ch });
    }
}
