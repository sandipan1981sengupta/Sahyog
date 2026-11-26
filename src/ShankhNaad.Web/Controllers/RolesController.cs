using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.ServiceLibrary.Data;
using ShankhNaad.Web.Hubs;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Work → Roles: message a role ("IT help desk", "Head of HR") instead of a person (database/49_Roles.sql, page js/work-roles.js).
/// The request goes to the first person in the role who is online and not out of office (else the first not away,
/// else a stand-in), as a one-to-one chat message from the person asking. No reply in the role's minutes → escalated
/// by Infrastructure/WorkJobs.cs. Admins set up roles and who is in them (in the order they are asked).
/// </summary>
[Route("work/roles"), NeedsScript("49_Roles.sql")]
public sealed class RolesController : WorkControllerBase
{
    private readonly IWorkData _db;
    private readonly IOutOfOfficeService _ooo;
    private readonly PresenceTracker _presence;
    private readonly ChatPoster _poster;
    private readonly IHubContext<ChatHub> _hub;
    private readonly IUserService _users;

    public RolesController(IWorkData db, IOutOfOfficeService ooo, PresenceTracker presence, ChatPoster poster, IHubContext<ChatHub> hub, IUserService users)
    {
        _db = db;
        _ooo = ooo;
        _presence = presence;
        _poster = poster;
        _hub = hub;
        _users = users;
    }

    [HttpGet("")]
    public Task<IActionResult> Index() => WorkFormPageAsync("Roles", "Roles");

    private async Task<List<Row>> RolesAsync()
    {
        var sets = await _db.SetsAsync("dbo.sahyog_Role_List", p => p.With("@TenantId", TenantId));
        var roles = sets.Count > 0 ? sets[0] : new();
        var members = sets.Count > 1 ? sets[1] : new();
        var ooo = await _ooo.ListAsync(TenantId);
        var online = _presence.OnlineUsers(TenantId);
        foreach (var r in roles)
        {
            var list = members.Where(m => m.I("roleId") == r.I("roleId")).ToList();
            foreach (var m in list)
            {
                var id = m.G("userId").ToString();
                m["online"] = online.Contains(id);
                m["away"] = WorkHelpers.IsAway(ooo.GetValueOrDefault(id));
            }
            r["members"] = list;
        }
        return roles;
    }

    [HttpGet("data")]
    public async Task<IActionResult> Data()
    {
        var roles = await RolesAsync();
        var requests = await _db.RowsAsync("dbo.sahyog_RoleRequest_Mine", p => p.With("@TenantId", TenantId).With("@UserId", Me));
        Response.Headers.CacheControl = "no-store";
        return Json(new { roles, requests, isAdmin = IsAdmin });
    }

    public sealed class SaveInput
    {
        public int RoleId { get; set; }
        public string? Name { get; set; }
        public string? Description { get; set; }
        public string? Icon { get; set; }
        public int EscalateMin { get; set; } = 15;
        public List<Guid>? Members { get; set; }
    }

    private static readonly HashSet<string> Icons = new(StringComparer.Ordinal)
        { "life-ring", "users", "inr", "laptop", "shield", "truck", "wrench", "medkit", "bullhorn", "id-badge", "building", "graduation-cap", "balance-scale", "phone" };

    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] SaveInput input)
    {
        if (!IsAdmin) return Fail("Only an admin can set up roles.", 403);
        var name = WorkHelpers.Clip(input.Name, 80);
        if (name is null) return Fail("Give the role a name, e.g. IT help desk.");
        var members = (input.Members ?? new()).Distinct().Take(20).ToList();
        if (members.Count == 0) return Fail("Add at least one person to the role.");
        var id = (await _db.RowAsync("dbo.sahyog_Role_Save", p => p
            .With("@RoleId", input.RoleId == 0 ? null : input.RoleId).With("@TenantId", TenantId)
            .AddText("@Name", name, 80).AddText("@Description", WorkHelpers.Clip(input.Description, 200), 200)
            .AddText("@Icon", input.Icon is not null && Icons.Contains(input.Icon) ? input.Icon : "life-ring", 30)
            .With("@EscalateMin", input.EscalateMin is 0 or 5 or 10 or 15 or 30 or 60 ? input.EscalateMin : 15)
            .AddText("@MemberIds", System.Text.Json.JsonSerializer.Serialize(members), -1)))?.I("roleId") ?? 0;
        if (id == 0) return Fail("That role was deleted.", 404);
        return Json(new { roleId = id });
    }

    [HttpPost("{id:int}/delete")]
    public async Task<IActionResult> Delete(int id)
    {
        if (!IsAdmin) return Fail("Only an admin can delete roles.", 403);
        await _db.RowsAsync("dbo.sahyog_Role_Delete", p => p.With("@TenantId", TenantId).With("@RoleId", id));
        return Json(new { ok = true });
    }

    public sealed class AskInput { public string? Body { get; set; } }

    /// <summary>Sends the message to the right person in the role. Returns the chat and who got it (and why).</summary>
    [HttpPost("{id:int}/ask")]
    public async Task<IActionResult> Ask(int id, [FromBody] AskInput input)
    {
        var body = WorkHelpers.Clip(input.Body, 1000);
        if (body is null) return Fail("Write your message.");
        var role = (await RolesAsync()).FirstOrDefault(r => r.I("roleId") == id);
        if (role is null) return Fail("That role was deleted.", 404);
        var members = ((List<Row>)role["members"]!).Where(m => m.G("userId") != Me).ToList();
        if (members.Count == 0) return Fail("Nobody else is in this role yet. Ask an admin to add people.");

        var statuses = _presence.Statuses(TenantId);
        bool Free(Row m) => !(statuses.TryGetValue(m.G("userId").ToString(), out var st) && st.Manual is "dnd" or "busy" or "offline");
        var here = members.Where(m => !m.B("away")).ToList();
        Row? pick = here.FirstOrDefault(m => m.B("online") && Free(m));
        var why = pick is null ? null : $"{First(pick)} is online";
        if (pick is null && (pick = here.FirstOrDefault(m => m.B("online"))) is not null) why = $"{First(pick)} is online (busy, but the others are away or offline)";
        if (pick is null && (pick = here.FirstOrDefault()) is not null) why = $"Nobody in the role is online; {First(pick)} is first in line";
        Guid to;
        if (pick is null)
        {
            // everyone in the role is out of office: their stand-in, else the first person anyway
            List<Row> standIns;
            try { standIns = await _db.RowsAsync("dbo.sahyog_StandIn_List", p => p.With("@TenantId", TenantId)); }
            catch (Microsoft.Data.SqlClient.SqlException) { standIns = new(); }    // 48_StandIn.sql not run yet
            var cover = members.Select(m => standIns.FirstOrDefault(s => s.G("userId") == m.G("userId"))).FirstOrDefault(s => s is not null && s.G("standInId") != Me);
            to = cover?.G("standInId") ?? members[0].G("userId");
            why = cover is not null ? $"Everyone in the role is out of office; {cover.S("standInName")} is standing in" : $"Everyone in the role is out of office; it went to {First(members[0])} anyway";
        }
        else to = pick.G("userId");

        var (channel, message) = await _poster.SendDirectAsync(TenantId, Me, to, $"📨 To {role.S("name")}\n{body}");
        if (channel is not Guid ch || message is null) return Fail("Couldn't send it. Try again.");
        await _db.RowAsync("dbo.sahyog_RoleRequest_Create", p => p
            .With("@TenantId", TenantId).With("@RoleId", id).With("@FromUserId", Me).AddText("@Body", body, 1000).With("@AssignedTo", to).With("@ChannelId", ch));
        await _hub.Clients.User(to.ToString()).SendAsync("RoleRequest", role.S("name"), User.DisplayName(), $"/chat/{ch}", false);
        var toName = members.FirstOrDefault(m => m.G("userId") == to)?.S("displayName") ?? (await _users.GetByIdAsync(to))?.DisplayName ?? "them";
        return Json(new { chatUrl = $"/chat/{ch}", to = toName, why, escalateMin = role.I("escalateMin") });
    }

    private static string First(Row m) => (m.S("displayName") ?? "").Split(' ')[0];

    [HttpPost("requests/{id:int}/close")]
    public async Task<IActionResult> Close(int id)
    {
        var r = await _db.RowAsync("dbo.sahyog_RoleRequest_Close", p => p.With("@TenantId", TenantId).With("@RequestId", id).With("@UserId", Me));
        return r is not null && r.I("changed") > 0 ? Json(new { ok = true }) : Fail("Only the person who asked or someone in the role can close it.", 403);
    }
}
