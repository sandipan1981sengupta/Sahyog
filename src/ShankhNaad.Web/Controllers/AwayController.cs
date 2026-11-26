using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.ServiceLibrary.Data;
using ShankhNaad.Web.Hubs;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Stand-in while out of office ("Neha is covering for Asha": a bar in Asha's chat, with "Message Neha"),
/// and "While you were away" (unread chats, decisions, your action items, meetings, what your stand-in did).
/// Database: 48_StandIn.sql. Page script: js/away.js (in the app bundle). Live: "StandIn" to the workspace.
/// </summary>
[Route("away"), NeedsScript("48_StandIn.sql")]
public sealed class AwayController : WorkControllerBase
{
    private readonly IWorkData _db;
    private readonly IHubContext<ChatHub> _hub;

    public AwayController(IWorkData db, IHubContext<ChatHub> hub)
    {
        _db = db;
        _hub = hub;
    }

    [HttpGet("standins")]
    public async Task<IActionResult> StandIns() =>
        Json(await _db.RowsAsync("dbo.sahyog_StandIn_List", p => p.With("@TenantId", TenantId)));

    public sealed class StandInInput { public Guid? StandInId { get; set; } }

    [HttpPost("standin")]
    public async Task<IActionResult> SetStandIn([FromBody] StandInInput input)
    {
        var r = await _db.RowAsync("dbo.sahyog_StandIn_Set", p => p.With("@TenantId", TenantId).With("@UserId", Me).With("@StandInId", input.StandInId));
        var id = r?.GN("standInId");
        await _hub.Clients.Group(ChatHub.TenantGroup(TenantId)).SendAsync("StandIn", Me.ToString(), id?.ToString(), r?.S("standInName"));
        return Json(new { standInId = id, standInName = r?.S("standInName") });
    }

    /// <summary>What happened since <paramref name="since"/> (ISO time, at most 60 days back).</summary>
    [HttpGet("summary")]
    public async Task<IActionResult> Summary(DateTime? since)
    {
        var from = since?.ToUniversalTime() ?? DateTime.UtcNow.AddDays(-1);
        if (from < DateTime.UtcNow.AddDays(-60)) from = DateTime.UtcNow.AddDays(-60);
        var sets = await _db.SetsAsync("dbo.sahyog_Away_Summary", p => p.With("@TenantId", TenantId).With("@UserId", Me).AddDateTime2("@SinceUtc", from));
        List<Row> Set(int i) => sets.Count > i ? sets[i] : new();
        Response.Headers.CacheControl = "no-store";
        return Json(new
        {
            since = DateTime.SpecifyKind(from, DateTimeKind.Utc),
            chats = Set(0), decisions = Set(1), actions = Set(2), meetings = Set(3),
            standIn = Set(4).FirstOrDefault()
        });
    }
}
