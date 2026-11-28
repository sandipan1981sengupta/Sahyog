using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using ShankhNaad.DtoLibrary;
using ShankhNaad.Web.Hubs;
using ShankhNaad.Web.Infrastructure;
using ShankhNaad.Web.Models;
using ShankhNaad.ServiceLibrary;

namespace ShankhNaad.Web.Controllers;

[Authorize, Route("chat")]
public sealed partial class ChatController : Controller
{
    private const int PageSize = 50;

    private readonly IChatService _chat;
    private readonly ITenantService _tenants;
    private readonly IUserService _users;
    private readonly IFileStorage _files;
    private readonly IHubContext<ChatHub> _hub;
    private readonly PresenceTracker _presence;
    private readonly StorageOptions _storage;

    public ChatController(IChatService chat, ITenantService tenants, IUserService users, IFileStorage files,
        IHubContext<ChatHub> hub, PresenceTracker presence, IOptions<StorageOptions> storage)
    {
        _chat = chat;
        _tenants = tenants;
        _users = users;
        _files = files;
        _hub = hub;
        _presence = presence;
        _storage = storage.Value;
    }

    private Guid Me => User.UserGuid();

    private const int OpenDays = 3, MinOnOpen = 30, MaxOnOpen = 100;

    [HttpGet("")]
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Index(Guid? id, bool list = false)
    {
        if (User.TenantId() is not Guid tenantId)
            return User.IsInRole(AppRoles.SuperAdmin) ? RedirectToAction("Index", "Admin") : Forbid();

        var online = _presence.OnlineUsers(tenantId);
        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var sidebar = await _chat.GetSidebarAsync(tenantId, Me);

        // "Everyone" (the workspace-wide group) isn't listed: what you and a person wrote there shows in your chat with them
        var channels = sidebar.Where(s => !s.IsDirect && s.IsPrivate)
            .OrderByDescending(s => s.LastMessageUtc)
            .Select(s => new ChannelVm(s.ChannelId, s.Name, false, s.UnreadCount, null, s.IsPrivate, s.IsPinned, s.LastMessageUtc))
            .ToList();
        var directs = sidebar.Where(s => s.IsDirect && s.OtherUserId is not null)
            .OrderByDescending(s => s.LastMessageUtc)
            .Select(s =>
            {
                var otherId = s.OtherUserId!.Value.ToString();
                var person = new PersonVm(otherId, s.OtherName ?? "", Names.Initials(s.OtherName), s.OtherTone ?? 0, online.Contains(otherId));
                return new ChannelVm(s.ChannelId, person.Name, true, s.UnreadCount, person, false, s.IsPinned, s.LastMessageUtc);
            })
            .ToList();

        // no chat picked: open a pinned one, else the most recent conversation
        var all = channels.Concat(directs).ToList();
        var current = all.FirstOrDefault(c => c.Id == id)
                      ?? all.Where(c => c.IsPinned).OrderByDescending(c => c.LastUtc).FirstOrDefault()
                      ?? all.OrderByDescending(c => c.LastUtc).FirstOrDefault();
        // "‹ back" on a phone or tablet asks for just the list (/chat?list=1): open nothing, so no chat
        // is quietly marked as read behind the list
        if (id is null && list) current = null;

        var messages = new List<MessageDto>();
        var members = new List<PersonVm>();
        var files = new List<AttachmentDto>();
        var hasOlder = false;
        bool isMain = false, canEdit = false, canDelete = false, canManage = false;
        string? createdBy = null;
        var readState = new List<ReadStateDto>();

        if (current is not null)
        {
            // the last 3 days of the conversation (at least the latest 30 messages, at most 100);
            // "Load older messages" brings earlier ones
            var page = await PageAsync(tenantId, current, null, MaxOnOpen + 1);   // newest first
            var since = DateTime.UtcNow.AddDays(-OpenDays);
            var keep = page.TakeWhile(m => m.SentUtc >= since).Count();
            keep = Math.Min(MaxOnOpen, Math.Max(keep, Math.Min(MinOnOpen, page.Count)));
            hasOlder = page.Count > keep;
            messages = page.Take(keep).Reverse().ToList();

            members = (await _chat.GetMembersAsync(tenantId, current.Id))
                .Select(m => new PersonVm(m.Id, m.DisplayName, m.Initials, m.AvatarTone, online.Contains(m.Id)))
                .OrderByDescending(p => p.Online).ThenBy(p => p.Name)
                .ToList();

            files = await _chat.GetRecentFilesAsync(tenantId, current.Id, viewerId: Me);

            if (!current.IsDirect && await _chat.GetChannelAsync(tenantId, current.Id) is ChannelDto info)
            {
                var isAdmin = User.IsInRole(AppRoles.TenantAdmin);
                isMain = info.IsMain ?? (info.Name == "general" || info.Name == "Everyone");
                // admins always see Edit / Delete (if 14_ChannelEdit.sql isn't run yet, clicking says so)
                canEdit = isAdmin || (info.CreatedBy is Guid by && by == Me);
                canDelete = isAdmin && !isMain;
                canManage = canEdit && !isMain;
                createdBy = info.CreatedBy?.ToString();
            }

            if (await _chat.MarkReadAsync(tenantId, current.Id, Me) is DateTime readUtc)
                await _hub.Clients.Group(ChatHub.ChannelGroup(current.Id)).SendAsync("ChannelRead", current.Id, Me.ToString(), readUtc);
            readState = await _chat.GetReadStateAsync(tenantId, current.Id);
            var currentId = current.Id;
            current = current with { Unread = 0 };
            channels = channels.Select(c => c.Id == currentId ? c with { Unread = 0 } : c).ToList();
            directs = directs.Select(c => c.Id == currentId ? c with { Unread = 0 } : c).ToList();
        }

        var me = Me.ToString();
        var team = (await _users.ListByTenantAsync(tenantId))
            .Where(u => u.IsActive && u.Id != me)
            .Select(u => new PersonVm(u.Id, u.DisplayName, u.Initials, u.AvatarTone, online.Contains(u.Id)))
            .ToList();

        return View(new ChatViewModel
        {
            Limits = limits,
            Channels = channels,
            Directs = directs,
            Current = current,
            CanEditChannel = canEdit,
            CanDeleteChannel = canDelete,
            CurrentIsMain = isMain,
            CanManageMembers = canManage,
            CurrentCreatedBy = createdBy,
            ReadState = readState,
            CurrentDescription = sidebar.FirstOrDefault(s => s.ChannelId == current?.Id)?.Description,
            Messages = messages,
            Members = members,
            Team = team,
            RecentFiles = files,
            HasOlder = hasOlder,
            MaxUploadMb = _storage.MaxUploadMb
        });
    }

    /// <summary>
    /// My chats for the Messages tab of the meeting room (js/room.js): same list and order as the Chat page
    /// ("Everyone" left out), newest first, with unread counts.
    /// </summary>
    [HttpGet("inbox")]
    public async Task<IActionResult> Inbox()
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var online = _presence.OnlineUsers(tenantId);
        var sidebar = await _chat.GetSidebarAsync(tenantId, Me);
        var list = sidebar
            .Where(s => s.IsDirect ? s.OtherUserId is not null : s.IsPrivate)
            .OrderByDescending(s => s.IsPinned).ThenByDescending(s => s.LastMessageUtc)
            .Take(80)
            .Select(s =>
            {
                var name = s.IsDirect ? s.OtherName ?? "" : s.Name;
                return new
                {
                    id = s.ChannelId,
                    name,
                    isDirect = s.IsDirect,
                    unread = s.UnreadCount,
                    lastUtc = DateTime.SpecifyKind(s.LastMessageUtc, DateTimeKind.Utc),
                    initials = Names.Initials(name),
                    tone = s.IsDirect ? s.OtherTone ?? 0 : 4,
                    userId = s.OtherUserId,
                    online = s.OtherUserId is Guid u && online.Contains(u.ToString()),
                    pinned = s.IsPinned
                };
            });
        Response.Headers.CacheControl = "no-store";
        return Json(list);
    }

    /// <summary>The latest messages of one chat (oldest first), for the meeting room's Messages tab.</summary>
    [HttpGet("{id:guid}/recent")]
    public async Task<IActionResult> Recent(Guid id)
    {
        if (User.TenantId() is not Guid tenantId || !await _chat.IsMemberAsync(tenantId, id, Me)) return Forbid();
        var channel = await _chat.GetChannelAsync(tenantId, id);
        Guid? other = null;
        if (channel is { IsDirect: true })
            other = (await _chat.GetMembersAsync(tenantId, id)).FirstOrDefault(m => m.UserId != Me)?.UserId;
        var page = other is Guid o
            ? await _chat.GetPersonTimelineAsync(tenantId, id, Me, o, null, PageSize + 1)
            : await _chat.GetMessagesAsync(tenantId, id, null, PageSize + 1, Me);
        Response.Headers.CacheControl = "no-store";
        return Json(new { hasOlder = page.Count > PageSize, messages = page.Take(PageSize).Reverse() });
    }

    /// <summary>Older messages, 50 at a time, for "load older messages".</summary>
    [HttpGet("{id:guid}/messages")]
    public async Task<IActionResult> Messages(Guid id, long before)
    {
        if (User.TenantId() is not Guid tenantId || !await _chat.IsMemberAsync(tenantId, id, Me)) return Forbid();
        var channel = await _chat.GetChannelAsync(tenantId, id);
        Guid? other = null;
        if (channel is { IsDirect: true })
            other = (await _chat.GetMembersAsync(tenantId, id)).FirstOrDefault(m => m.UserId != Me)?.UserId;
        var page = other is Guid o
            ? await _chat.GetPersonTimelineAsync(tenantId, id, Me, o, before, PageSize + 1)
            : await _chat.GetMessagesAsync(tenantId, id, before, PageSize + 1, Me);
        return Json(new
        {
            hasOlder = page.Count > PageSize,
            messages = page.Take(PageSize).Reverse()
        });
    }

    /// <summary>A person's chat includes what you both wrote in shared groups; a group shows its own messages.</summary>
    private Task<List<MessageDto>> PageAsync(Guid tenantId, ChannelVm chat, long? before, int take) =>
        chat.IsDirect && chat.DirectWith is { } p && Guid.TryParse(p.Id, out var otherId)
            ? _chat.GetPersonTimelineAsync(tenantId, chat.Id, Me, otherId, before, take)
            : _chat.GetMessagesAsync(tenantId, chat.Id, before, take, Me);

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();

    /// <summary>A group name as people type it ("Project Alpha"): trimmed, single spaces, no leading #.</summary>
    private static string CleanName(string? name) => Spaces().Replace((name ?? "").Trim().TrimStart('#').Trim(), " ");

    /// <summary>
    /// Creates a group with the people picked (and you). There are no workspace-wide "channels" any more:
    /// the only group everybody is in is "Everyone", made with the workspace.
    /// </summary>
    [HttpPost("channels")]
    [HttpPost("groups")]
    public async Task<IActionResult> CreateChannel(string name, string? description, List<Guid>? members = null,
        Guid? fromChat = null, string? history = null, bool shareFiles = true)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var clean = CleanName(name);
        if (clean.Length is < 2 or > 60)
        {
            TempData["Error"] = "A group name needs 2–60 characters.";
            return RedirectToAction(nameof(Index));
        }

        var channelId = Guid.NewGuid();
        var created = await _chat.CreateChannelAsync(new CreateChannelRequest(tenantId, channelId, clean, description?.Trim(), Me)
        {
            MemberIds = members ?? new List<Guid>()
        });
        var (nameTaken, memberIds) = created;
        if (nameTaken)
        {
            TempData["Error"] = $"A group called \"{clean}\" already exists. Pick another name.";
            return RedirectToAction(nameof(Index));
        }
        if (created.NobodyPicked)
        {
            TempData["Error"] = "Pick at least one person for the group.";
            return RedirectToAction(nameof(Index));
        }

        await AddConnectionsToGroupAsync(channelId, memberIds.Select(m => m.ToString()));
        // the people added get a pop-up with "Open" (their list shows the group on the next page load)
        var others = memberIds.Where(m => m != Me).Select(m => m.ToString()).ToList();
        if (others.Count > 0)
            await _hub.Clients.Users(others).SendAsync("AddedToGroup", User.DisplayName(), clean, $"/chat/{channelId}");
        // made from a one-to-one chat with "Add people": copy that chat's history in, if asked
        var historyNote = "";
        if (fromChat is Guid from && history is "1" or "7" or "all")
        {
            DateTime? since = history == "all" ? null : DateTime.UtcNow.AddDays(-int.Parse(history));
            var copied = await _chat.CopyHistoryAsync(tenantId, from, channelId, Me, since, shareFiles);
            historyNote = copied switch
            {
                null => " Chat history wasn't copied: run database/29_GroupMembers.sql first.",
                -2 => " Chat history wasn't copied: copying without files needs database/39_GroupHistoryShare.sql.",
                < 0 => " Chat history wasn't copied (that chat isn't yours).",
                0 => " There were no messages to copy for that period.",
                _ => $" {copied} earlier message{(copied == 1 ? "" : "s")} copied in{(shareFiles ? "" : ", without files")}."
            };
        }
        TempData["Message"] = $"\"{clean}\" is ready with {memberIds.Count} people. Only they can see it." + historyNote;
        return RedirectToAction(nameof(Index), new { id = channelId });
    }

    /// <summary>
    /// Adds people to a group that already exists (its creator or a workspace admin).
    /// history: "none" (only new messages), "1" / "7" (days back) or "all"; shareFiles: whether files sent before they joined come too.
    /// </summary>
    [HttpPost("{id:guid}/members/add")]
    public async Task<IActionResult> AddMembers(Guid id, List<Guid>? members, string? history = "all", bool shareFiles = true)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        DateTime? from = history switch
        {
            "none" => DateTime.UtcNow,
            "1" => DateTime.UtcNow.AddDays(-1),
            "7" => DateTime.UtcNow.AddDays(-7),
            _ => null
        };
        var (status, added) = await _chat.AddMembersAsync(tenantId, id, Me, User.IsInRole(AppRoles.TenantAdmin), members ?? new List<Guid>(), from, shareFiles);
        var olderDb = status == 8;
        if (olderDb) status = 0;
        if (status != 0)
        {
            TempData["Error"] = status switch
            {
                9 => "Adding people needs a database update: run database/29_GroupMembers.sql, then try again.",
                1 => "People can only be added to groups. Everyone is already in \"Everyone\".",
                2 => "Only the person who created this group, or a workspace admin, can add people.",
                _ => "Pick at least one person who isn't in the group yet."
            };
            return RedirectToAction(nameof(Index), new { id });
        }
        var group = await _chat.GetChannelAsync(tenantId, id);
        await AddConnectionsToGroupAsync(id, added.Select(a => a.ToString()));
        await _hub.Clients.Users(added.Select(a => a.ToString()).ToList())
            .SendAsync("AddedToGroup", User.DisplayName(), group?.Name ?? "a group", $"/chat/{id}");
        var who = $"Added {added.Count} {(added.Count == 1 ? "person" : "people")}.";
        var sees = olderDb
            ? " They can see the whole history and files: limiting it needs database/39_GroupHistoryShare.sql."
            : history switch
            {
                "none" => " They see only new messages from now on.",
                "1" => " They see the last day of messages",
                "7" => " They see the last 7 days of messages",
                _ => " They see the whole history"
            } + (history == "none" ? "" : shareFiles ? " and files." : ", without earlier files.");
        TempData["Message"] = who + sees;
        return RedirectToAction(nameof(Index), new { id });
    }

    /// <summary>Removes someone from a group (its creator or a workspace admin). Their chat list drops it straight away.</summary>
    [HttpPost("{id:guid}/members/{memberId:guid}/remove")]
    public async Task<IActionResult> RemoveMember(Guid id, Guid memberId)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var status = await _chat.RemoveMemberAsync(tenantId, id, Me, User.IsInRole(AppRoles.TenantAdmin), memberId);
        if (status != 0)
        {
            TempData["Error"] = status switch
            {
                9 => "Removing people needs a database update: run database/29_GroupMembers.sql, then try again.",
                1 => "People can only be removed from groups, not from \"Everyone\" or a one-to-one chat.",
                2 => "Only the person who created this group, or a workspace admin, can remove people.",
                4 => "You can't remove yourself here.",
                5 => "Only a workspace admin can remove the person who created the group.",
                _ => "That person isn't in the group any more."
            };
            return RedirectToAction(nameof(Index), new { id });
        }
        var group = await _chat.GetChannelAsync(tenantId, id);
        foreach (var conn in _presence.Connections(memberId.ToString()))
            await _hub.Groups.RemoveFromGroupAsync(conn, ChatHub.ChannelGroup(id));
        await _hub.Clients.User(memberId.ToString()).SendAsync("RemovedFromGroup", id, group?.Name ?? "a group");
        TempData["Message"] = "Removed from the group. They no longer see it.";
        return RedirectToAction(nameof(Index), new { id });
    }

    private const string MissingScript = "Editing groups needs a database update: run database/99_ApplyAllUpdates.sql in SQL Server Management Studio, then try again.";

    /// <summary>Renames a channel and changes its description (workspace admins, or whoever created it).</summary>
    [HttpPost("{id:guid}/edit-channel")]
    public async Task<IActionResult> EditChannel(Guid id, string name, string? description)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var clean = CleanName(name);
        if (clean.Length is < 2 or > 60)
        {
            TempData["Error"] = "A group name needs 2–60 characters.";
            return RedirectToAction(nameof(Index), new { id });
        }
        var desc = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        int status;
        try { status = await _chat.UpdateChannelAsync(tenantId, id, Me, User.IsInRole(AppRoles.TenantAdmin), clean, desc); }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 2812)   // stored procedure not found
        {
            TempData["Error"] = MissingScript;
            return RedirectToAction(nameof(Index), new { id });
        }
        switch (status)
        {
            case 1: return NotFound();
            case 2:
                TempData["Error"] = "Only workspace admins, or the person who created this group, can rename it.";
                return RedirectToAction(nameof(Index), new { id });
            case 3:
                TempData["Error"] = $"A group called \"{clean}\" already exists. Pick another name.";
                return RedirectToAction(nameof(Index), new { id });
        }
        // everyone in the workspace sees the new name straight away
        await _hub.Clients.Group(ChatHub.TenantGroup(tenantId)).SendAsync("ChannelUpdated", id, clean, desc);
        TempData["Message"] = $"Saved. The group is now \"{clean}\".";
        return RedirectToAction(nameof(Index), new { id });
    }

    /// <summary>Deletes a group channel with its messages and files (workspace admins; never #general).</summary>
    [HttpPost("{id:guid}/delete-channel")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> DeleteChannel(Guid id)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var name = (await _chat.GetChannelAsync(tenantId, id))?.Name;
        int status;
        List<string> files;
        try { (status, files) = await _chat.DeleteChannelAsync(tenantId, id); }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 2812)
        {
            TempData["Error"] = MissingScript;
            return RedirectToAction(nameof(Index), new { id });
        }
        if (status == 1) return NotFound();
        if (status == 4)
        {
            TempData["Error"] = "\"Everyone\" is the group your whole workspace is in, so it can't be deleted (you can rename it).";
            return RedirectToAction(nameof(Index), new { id });
        }
        foreach (var path in files)
        {
            try { _files.Delete(path); } catch { /* the record is gone; a stray file is harmless */ }
        }
        await _hub.Clients.Group(ChatHub.TenantGroup(tenantId)).SendAsync("ChannelDeleted", id);
        TempData["Message"] = $"\"{name}\" is deleted, with its messages and files.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Pins or unpins a chat for you (it moves to "Pinned" at the top of your list). Called from chat.js.</summary>
    [HttpPost("{id:guid}/pin")]
    public async Task<IActionResult> Pin(Guid id, bool pinned)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        try
        {
            return await _chat.SetPinnedAsync(tenantId, id, Me, pinned) ? Json(new { ok = true, pinned }) : NotFound();
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 2812)
        {
            return StatusCode(500, new { error = "Pinning needs one database update: run database/18_EveryoneAndPins.sql." });
        }
    }

    // one ping per person every 15 seconds, so nobody can be spammed
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, DateTime> LastPing = new();

    /// <summary>
    /// "Ping": a quick nudge (sound + pop-up, and a desktop alert if the tab is in the background)
    /// with a button to open your chat. Called from the hover buttons in the conversations list.
    /// </summary>
    [HttpPost("ping/{userId:guid}")]
    public async Task<IActionResult> Ping(Guid userId)
    {
        if (User.TenantId() is not Guid tenantId || userId == Me) return BadRequest();
        var key = $"{Me:N}>{userId:N}";
        if (LastPing.TryGetValue(key, out var last) && DateTime.UtcNow - last < TimeSpan.FromSeconds(15))
            return StatusCode(429, new { error = "You just pinged them. Give it a few seconds." });

        var channelId = await _chat.GetOrCreateDirectAsync(tenantId, Me, userId);   // null: not an active teammate
        if (channelId is null) return NotFound(new { error = "That person isn't in this workspace any more." });
        LastPing[key] = DateTime.UtcNow;

        await AddConnectionsToGroupAsync(channelId.Value, new[] { Me.ToString(), userId.ToString() });
        var online = _presence.OnlineUsers(tenantId).Contains(userId.ToString());
        await _hub.Clients.User(userId.ToString()).SendAsync("Pinged",
            User.DisplayName(), User.Initials(), User.AvatarTone(), $"/chat/{channelId}");
        return Json(new { ok = true, online });
    }

    /// <summary>Opens (or creates) the one-to-one conversation with another person.</summary>
    [HttpPost("direct/{userId:guid}")]
    public async Task<IActionResult> Direct(Guid userId)
    {
        if (User.TenantId() is not Guid tenantId || userId == Me) return NotFound();
        var channelId = await _chat.GetOrCreateDirectAsync(tenantId, Me, userId);
        if (channelId is null) return NotFound();

        await AddConnectionsToGroupAsync(channelId.Value, new[] { Me.ToString(), userId.ToString() });
        return RedirectToAction(nameof(Index), new { id = channelId });
    }

    /// <summary>Edits one of your own text messages; everyone in the chat sees the change at once ("Edited"). Called from chat.js.</summary>
    [HttpPost("messages/{messageId:long}/edit")]
    public async Task<IActionResult> EditMessage(long messageId, string? body)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        body = (body ?? "").Trim();
        if (body.Length == 0) return BadRequest(new { error = "A message can't be empty. To remove it, delete it." });
        if (body.Length > 4000) return BadRequest(new { error = "That's too long (4,000 characters at most)." });
        var (status, message) = await _chat.EditMessageAsync(tenantId, messageId, Me, body);
        switch (status)
        {
            case 1: return NotFound(new { error = "That message no longer exists." });
            case 2: return StatusCode(403, new { error = "You can edit only your own messages." });
            case 3: return BadRequest(new { error = "This message can't be edited." });
            case 4: return StatusCode(503, new { error = "Editing needs a database update (32_OutOfOfficeAndEdit.sql). Ask your administrator." });
        }
        await _hub.Clients.Group(ChatHub.ChannelGroup(message!.ChannelId)).SendAsync("MessageEdited", message);
        return Json(message);
    }

    /// <summary>Deletes one message: only your own (not even an admin can delete someone else's). Called from chat.js.</summary>
    [HttpPost("messages/{messageId:long}/delete")]
    public async Task<IActionResult> DeleteMessage(long messageId)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var (status, channelId, path) = await _chat.DeleteMessageAsync(tenantId, messageId, Me, isAdmin: false);
        if (status == 1) return NotFound(new { error = "That message no longer exists." });
        if (status == 2) return StatusCode(403, new { error = "You can delete only your own messages." });
        if (path is not null)
        {
            try { _files.Delete(path); } catch { /* the record is gone; a stray file is harmless */ }
        }
        await _hub.Clients.Group(ChatHub.ChannelGroup(channelId!.Value)).SendAsync("MessageDeleted", channelId.Value, messageId);
        return Json(new { ok = true });
    }

    /// <summary>Deletes a one-to-one conversation (messages and files) for both people.</summary>
    [HttpPost("{id:guid}/delete")]
    public async Task<IActionResult> DeleteDirect(Guid id)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var members = (await _chat.GetMembersAsync(tenantId, id)).Select(m => m.Id.ToString()).ToList();
        var (deleted, files) = await _chat.DeleteDirectAsync(tenantId, id, Me);
        if (!deleted)
        {
            TempData["Error"] = "Only a one-to-one chat you are part of can be deleted.";
            return RedirectToAction(nameof(Index), new { id });
        }
        foreach (var path in files)
        {
            try { _files.Delete(path); } catch { /* the record is gone; a stray file is harmless */ }
        }
        if (members.Count > 0)
            await _hub.Clients.Users(members).SendAsync("ChannelDeleted", id);
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("{id:guid}/upload")]
    [RequestSizeLimit(200L * 1024 * 1024)]
    public async Task<IActionResult> Upload(Guid id, IFormFile file)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        if (file is null || file.Length == 0) return BadRequest(new { error = "Choose a file to upload." });
        if (file.Length > _storage.MaxUploadMb * 1024L * 1024L)
            return BadRequest(new { error = $"Files can be up to {_storage.MaxUploadMb} MB." });
        if (!await _chat.IsMemberAsync(tenantId, id, Me)) return Forbid();

        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        if (limits.StorageUsedBytes + file.Length > limits.StorageQuotaBytes)
            return BadRequest(new { error = "Storage full. Ask your admin to upgrade the plan." });

        string path;
        await using (var stream = file.OpenReadStream())
            path = await _files.SaveAsync(tenantId, stream, Path.GetExtension(file.FileName), HttpContext.RequestAborted);

        var contentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType;
        var (status, message) = await _chat.SendFileAsync(new SendFileRequest(tenantId, id, Me, Guid.NewGuid(),
            Path.GetFileName(file.FileName), contentType, file.Length, path));

        if (status != SendStatus.Ok || message is null)
        {
            _files.Delete(path);   // the database said no (e.g. storage filled up meanwhile): don't keep the file
            return BadRequest(new { error = status == SendStatus.StorageFull ? "Storage full. Ask your admin to upgrade the plan." : "Upload not allowed." });
        }

        if (await _chat.GetChannelAsync(tenantId, id) is { IsDirect: false } group)
            message = message with { FromGroup = group.Name };
        await _hub.Clients.Group(ChatHub.ChannelGroup(id)).SendAsync("MessageReceived", message);
        return Json(message);
    }

    /// <summary>Reactions on the messages on screen: /chat/reactions?ids=1,2,3</summary>
    [HttpGet("reactions")]
    public async Task<IActionResult> Reactions(string? ids, [FromServices] IReactionService reactions)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var list = (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => long.TryParse(x, out var n) ? n : 0).Where(n => n > 0);
        return Json(await reactions.GetAsync(tenantId, Me, list));
    }

    [HttpGet("file/{id:guid}")]
    public async Task<IActionResult> Download(Guid id, [FromServices] ILogger<ChatController> log)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var attachment = await _chat.GetAttachmentAsync(tenantId, id, Me);
        if (attachment is null) return NotFound();

        var inline = attachment.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                     || attachment.ContentType == "application/pdf";
        Stream stream;
        try { stream = _files.OpenRead(attachment.StoragePath); }
        catch (Exception ex) when (MissingFile.Is(ex)) { return MissingFile.Page(attachment.FileName, log, attachment.StoragePath); }
        return inline
            ? File(stream, attachment.ContentType, enableRangeProcessing: true)
            : File(stream, attachment.ContentType, attachment.FileName, enableRangeProcessing: true);
    }

    private async Task AddConnectionsToGroupAsync(Guid channelId, IEnumerable<string> userIds)
    {
        foreach (var userId in userIds)
            foreach (var connectionId in _presence.Connections(userId))
                await _hub.Groups.AddToGroupAsync(connectionId, ChatHub.ChannelGroup(channelId));
    }
}
