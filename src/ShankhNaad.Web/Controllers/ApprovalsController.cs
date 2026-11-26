using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.ServiceLibrary.Data;
using ShankhNaad.Web.Hubs;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Work → Approvals (database/52_Approvals.sql, page js/work-approvals.js, chat card js/work-live.js).
/// A request goes to the requester's manager; expenses and purchases from the workspace's amount also to the manager's manager.
/// No manager: the workspace's fallback approver (or an admin). Each approver gets a card in their one-to-one chat with
/// the requester ("[[approval:ID]]") with Approve / Reject. Approved leave turns on out of office for those days.
/// Live: "Approval"(id, status) to everyone involved.
/// </summary>
[Route("work/approvals"), NeedsScript("52_Approvals.sql")]
public sealed class ApprovalsController : WorkControllerBase
{
    private static readonly string[] Kinds = { "leave", "expense", "purchase", "other" };

    private readonly IWorkData _db;
    private readonly IOrgService _org;
    private readonly IUserService _users;
    private readonly ITenantService _tenants;
    private readonly IOutOfOfficeService _ooo;
    private readonly ChatPoster _poster;
    private readonly IHubContext<ChatHub> _hub;

    public ApprovalsController(IWorkData db, IOrgService org, IUserService users, ITenantService tenants, IOutOfOfficeService ooo, ChatPoster poster, IHubContext<ChatHub> hub)
    {
        _db = db;
        _org = org;
        _users = users;
        _tenants = tenants;
        _ooo = ooo;
        _poster = poster;
        _hub = hub;
    }

    [HttpGet("")]
    public Task<IActionResult> Index() => WorkFormPageAsync("Approvals", "Approvals");

    private Task<Row?> RulesAsync() => _db.RowAsync("dbo.sahyog_ApprovalRules_Get", p => p.With("@TenantId", TenantId));

    /// <summary>Who approves, in order, with why ("your manager").</summary>
    private async Task<List<(Guid Id, string Name, string Why)>> RouteAsync(Guid requester, string kind, decimal? amount)
    {
        var org = await _org.GetAsync(TenantId);
        var people = org.People.ToDictionary(p => p.UserId);
        var users = (await _users.ListByTenantAsync(TenantId)).Where(u => u.IsActive).ToDictionary(u => u.UserId);
        string Name(Guid g) => users.TryGetValue(g, out var u) ? u.DisplayName : people.TryGetValue(g, out var p) ? p.DisplayName : "Someone";
        var rules = await RulesAsync();
        var steps = new List<(Guid, string, string)>();
        Guid? Manager(Guid g) => people.TryGetValue(g, out var p) && p.ManagerId is Guid m && m != g && users.ContainsKey(m) ? m : null;

        var first = Manager(requester);
        if (first is Guid m1) steps.Add((m1, Name(m1), "your manager"));
        else
        {
            var fb = rules?.GN("fallbackApprover") is Guid f && f != requester && users.ContainsKey(f) ? f
                   : users.Values.Where(u => u.Role == AppRoles.TenantAdmin && u.UserId != requester).Select(u => (Guid?)u.UserId).FirstOrDefault();
            if (fb is Guid g) steps.Add((g, Name(g), "you have no manager in the org chart, so it goes to " + (rules?.GN("fallbackApprover") == g ? "the approver set by your admin" : "an admin")));
        }
        var threshold = rules?.M("secondLevelAmount") ?? 50000m;
        if (kind is "expense" or "purchase" && amount >= threshold && steps.Count == 1 && Manager(steps[0].Item1) is Guid m2 && m2 != requester)
            steps.Add((m2, Name(m2), $"amounts from {rules?.S("currency") ?? "₹"}{threshold:N0} also need your manager's manager"));
        return steps;
    }

    [HttpGet("route")]
    public async Task<IActionResult> RouteFor(string? kind, decimal? amount)
    {
        var steps = await RouteAsync(Me, Kinds.Contains(kind) ? kind! : "other", amount);
        var rules = await RulesAsync();
        return Json(new { approvers = steps.Select(s => new { id = s.Id, name = s.Name, why = s.Why }), currency = rules?.S("currency") ?? "₹", secondLevelAmount = rules?.M("secondLevelAmount") ?? 50000m });
    }

    [HttpGet("data")]
    public async Task<IActionResult> Data(string? box)
    {
        box = box is "mine" or "todo" or "done" or "all" ? box : "todo";
        if (box == "all" && !IsAdmin) box = "todo";
        var items = await _db.RowsAsync("dbo.sahyog_Approval_List", p => p.With("@TenantId", TenantId).With("@UserId", Me).AddText("@Box", box, 10).With("@IsAdmin", IsAdmin));
        var todo = box == "todo" ? items.Count : (await _db.RowsAsync("dbo.sahyog_Approval_List", p => p.With("@TenantId", TenantId).With("@UserId", Me).AddText("@Box", "todo", 10).With("@IsAdmin", IsAdmin))).Count;
        Response.Headers.CacheControl = "no-store";
        return Json(new { box, items, todo, isAdmin = IsAdmin, rules = await RulesAsync() });
    }

    private async Task<(Row? A, List<Row> Steps)> GetAsync(int id)
    {
        var sets = await _db.SetsAsync("dbo.sahyog_Approval_Get", p => p.With("@TenantId", TenantId).With("@ApprovalId", id).With("@UserId", Me).With("@IsAdmin", IsAdmin));
        var a = sets.Count > 0 && sets[0].Count > 0 ? sets[0][0] : null;
        return (a, sets.Count > 1 ? sets[1] : new());
    }

    private object Shape(Row a, List<Row> steps) => new
    {
        approval = a, steps,
        canDecide = a.S("status") == "pending" && a.GN("currentApproverId") == Me,
        canCancel = a.S("status") == "pending" && a.G("requesterId") == Me
    };

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var (a, steps) = await GetAsync(id);
        return a is null ? Fail("This request was removed, or it isn't yours to see.", 404) : Json(Shape(a, steps));
    }

    /// <summary>The cards in a chat: /work/approvals/cards?ids=1,2</summary>
    [HttpGet("cards")]
    public async Task<IActionResult> Cards(string? ids)
    {
        var list = new List<object>();
        foreach (var part in (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Take(20))
            if (int.TryParse(part, out var id))
            {
                var (a, steps) = await GetAsync(id);
                list.Add(a is null ? new { approval = (object)new { approvalId = id, hidden = true } } : Shape(a, steps));
            }
        return Json(list);
    }

    public sealed class CreateInput
    {
        public string? Kind { get; set; }
        public string? Title { get; set; }
        public string? Details { get; set; }
        public decimal? Amount { get; set; }
        public string? From { get; set; }
        public string? To { get; set; }
    }

    [HttpPost("create")]
    public async Task<IActionResult> Create([FromBody] CreateInput input)
    {
        var kind = Kinds.Contains(input.Kind) ? input.Kind! : "other";
        DateOnly? from = null, to = null;
        if (kind == "leave")
        {
            from = WorkHelpers.Day(input.From);
            to = WorkHelpers.Day(input.To) ?? from;
            if (from is null) return Fail("Pick the first day of leave.");
            if (to < from) return Fail("The last day can't be before the first day.");
            if (to!.Value.DayNumber - from.Value.DayNumber > 365) return Fail("Leave can be at most a year.");
        }
        decimal? amount = null;
        if (kind is "expense" or "purchase")
        {
            if (input.Amount is not decimal a || a <= 0 || a > 999_999_999) return Fail("Write the amount.");
            amount = Math.Round(a, 2);
        }
        var title = WorkHelpers.Clip(input.Title, 150) ?? (kind == "leave" ? "Leave" : null);
        if (title is null) return Fail("Write what it's for.");
        var steps = await RouteAsync(Me, kind, amount);
        if (steps.Count == 0) return Fail("There's nobody to approve this: add your manager on the Org page, or ask an admin to set an approver.");

        var id = (await _db.RowAsync("dbo.sahyog_Approval_Create", p => p.With("@TenantId", TenantId).With("@RequesterId", Me)
            .AddText("@Kind", kind, 10).AddText("@Title", title, 150).AddText("@Details", WorkHelpers.Clip(input.Details, 1000), 1000)
            .With("@Amount", amount).With("@FromDate", from?.ToDateTime(TimeOnly.MinValue)).With("@ToDate", to?.ToDateTime(TimeOnly.MinValue))
            .AddText("@Approvers", System.Text.Json.JsonSerializer.Serialize(steps.Select(s => s.Id)), 400)))?.I("approvalId") ?? 0;
        if (id == 0) return Fail("Couldn't send the request. Try again.");
        await SendCardAsync(id, 1, Me, steps[0].Id);
        return Json(new { approvalId = id, to = steps[0].Name, steps = steps.Count });
    }

    /// <summary>The card goes into the one-to-one chat between the requester and this step's approver.</summary>
    private async Task SendCardAsync(int id, int step, Guid requester, Guid approver)
    {
        var (channel, message) = await _poster.SendDirectAsync(TenantId, requester, approver, $"[[approval:{id}]]");
        if (channel is Guid ch && message is not null)
            await _db.ExecAsync("dbo.sahyog_Approval_SetMessage", p => p.With("@ApprovalId", id).With("@Step", step).With("@ChannelId", ch).With("@MessageId", message.Id));
        await _hub.Clients.User(approver.ToString()).SendAsync("Approval", id, "todo", User.DisplayName(), Me.ToString());
    }

    public sealed class DecideInput { public string? Decision { get; set; } public string? Note { get; set; } }

    [HttpPost("{id:int}/decide")]
    public async Task<IActionResult> Decide(int id, [FromBody] DecideInput input)
    {
        var decision = input.Decision == "approved" ? "approved" : input.Decision == "rejected" ? "rejected" : null;
        if (decision is null) return Fail("Approve or reject.");
        var r = await _db.RowAsync("dbo.sahyog_Approval_Decide", p => p.With("@TenantId", TenantId).With("@ApprovalId", id).With("@UserId", Me)
            .AddText("@Decision", decision, 10).AddText("@Note", WorkHelpers.Clip(input.Note, 300), 300));
        if (r is null || !r.B("ok")) return Fail(r?.S("status") is "approved" or "rejected" or "cancelled" ? "This request was already decided." : "It's not waiting for you.", 409);
        var (a, steps) = await GetAsync(id);
        if (a is null) return Json(new { ok = true });
        var requester = a.G("requesterId");
        var status = r.S("status") ?? "pending";

        if (r.GN("nextApproverId") is Guid next)
            await SendCardAsync(id, a.I("step"), requester, next);
        else if (status == "approved" && a.S("kind") == "leave" && a.Day("fromDate") is DateOnly f)
        {
            // approved leave: out of office for those days (from the start of the first day to the end of the last)
            var zone = await _tenants.ZoneAsync(TenantId);
            var last = a.Day("toDate") ?? f;
            var startUtc = MeetingCalendar.ToUtc(f.ToDateTime(TimeOnly.MinValue), zone);
            var untilUtc = MeetingCalendar.ToUtc(last.AddDays(1).ToDateTime(TimeOnly.MinValue), zone);
            if (untilUtc > DateTime.UtcNow)
            {
                var note = $"On leave ({a.S("title")})";
                var saved = await _ooo.SetRangeAsync(TenantId, requester, note, startUtc > DateTime.UtcNow ? startUtc : null, untilUtc);
                if (saved == OooSaveStatus.Saved)
                    await _hub.Clients.Group(ChatHub.TenantGroup(TenantId)).SendAsync("OooChanged", requester.ToString(),
                        new OutOfOfficeDto(note, untilUtc, DateTime.UtcNow, startUtc > DateTime.UtcNow ? startUtc : null));
            }
        }
        var involved = steps.Select(s => s.G("approverId").ToString()).Append(requester.ToString()).Distinct().ToList();
        await _hub.Clients.Users(involved).SendAsync("Approval", id, status, User.DisplayName(), Me.ToString());
        return Json(Shape(a, steps));
    }

    [HttpPost("{id:int}/cancel")]
    public async Task<IActionResult> Cancel(int id)
    {
        var r = await _db.RowAsync("dbo.sahyog_Approval_Cancel", p => p.With("@TenantId", TenantId).With("@ApprovalId", id).With("@UserId", Me));
        if (r is null || r.I("changed") == 0) return Fail("Only a request of yours that is still waiting can be withdrawn.", 409);
        var (a, steps) = await GetAsync(id);
        var involved = steps.Select(s => s.G("approverId").ToString()).Append(Me.ToString()).Distinct().ToList();
        await _hub.Clients.Users(involved).SendAsync("Approval", id, "cancelled", User.DisplayName(), Me.ToString());
        return Json(new { ok = true });
    }

    public sealed class RulesInput { public decimal? SecondLevelAmount { get; set; } public Guid? FallbackApprover { get; set; } public string? Currency { get; set; } }

    [HttpPost("rules")]
    public async Task<IActionResult> SaveRules([FromBody] RulesInput input)
    {
        if (!IsAdmin) return Fail("Only an admin can change approval rules.", 403);
        var r = await _db.RowAsync("dbo.sahyog_ApprovalRules_Save", p => p.With("@TenantId", TenantId)
            .With("@SecondLevelAmount", input.SecondLevelAmount is > 0 ? Math.Round(input.SecondLevelAmount.Value, 2) : null)
            .With("@FallbackApprover", input.FallbackApprover).AddText("@Currency", WorkHelpers.Clip(input.Currency, 8), 8));
        return Json(r);
    }
}
