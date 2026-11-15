using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using Sahyog.DtoLibrary;
using Sahyog.Web.Hubs;
using Sahyog.Web.Infrastructure;
using Sahyog.Web.Models;
using Sahyog.ServiceLibrary;

namespace Sahyog.Web.Controllers;

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

    [HttpGet("")]
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Index(Guid? id)
    {
        if (User.TenantId() is not Guid tenantId)
            return User.IsInRole(AppRoles.SuperAdmin) ? RedirectToAction("Index", "Admin") : Forbid();

        var online = _presence.OnlineUsers(tenantId);
        var limits = (await _tenants.GetLimitsAsync(tenantId))!;
        var sidebar = await _chat.GetSidebarAsync(tenantId, Me);

        var channels = sidebar.Where(s => !s.IsDirect)
            .OrderBy(s => s.Name)
            .Select(s => new ChannelVm(s.ChannelId, s.Name, false, s.UnreadCount, null))
            .ToList();
        var directs = sidebar.Where(s => s.IsDirect && s.OtherUserId is not null)
            .OrderByDescending(s => s.LastMessageUtc)
            .Select(s =>
            {
                var otherId = s.OtherUserId!.Value.ToString();
                var person = new PersonVm(otherId, s.OtherName ?? "", Names.Initials(s.OtherName), s.OtherTone ?? 0, online.Contains(otherId));
                return new ChannelVm(s.ChannelId, person.Name, true, s.UnreadCount, person);
            })
            .ToList();

        var current = channels.Concat(directs).FirstOrDefault(c => c.Id == id)
                      ?? channels.FirstOrDefault(c => c.Name == "general")
                      ?? channels.FirstOrDefault()
                      ?? directs.FirstOrDefault();

        var messages = new List<MessageDto>();
        var members = new List<PersonVm>();
        var files = new List<AttachmentDto>();
        var hasOlder = false;

        if (current is not null)
        {
            var page = await _chat.GetMessagesAsync(tenantId, current.Id, null, PageSize + 1);
            hasOlder = page.Count > PageSize;
            messages = page.Take(PageSize).Reverse().ToList();

            members = (await _chat.GetMembersAsync(tenantId, current.Id))
                .Select(m => new PersonVm(m.Id, m.DisplayName, m.Initials, m.AvatarTone, online.Contains(m.Id)))
                .OrderByDescending(p => p.Online).ThenBy(p => p.Name)
                .ToList();

            files = await _chat.GetRecentFilesAsync(tenantId, current.Id);

            await _chat.MarkReadAsync(tenantId, current.Id, Me);
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
            CurrentDescription = sidebar.FirstOrDefault(s => s.ChannelId == current?.Id)?.Description,
            Messages = messages,
            Members = members,
            Team = team,
            RecentFiles = files,
            HasOlder = hasOlder,
            MaxUploadMb = _storage.MaxUploadMb
        });
    }

    /// <summary>Older messages, 50 at a time, for "load older messages".</summary>
    [HttpGet("{id:guid}/messages")]
    public async Task<IActionResult> Messages(Guid id, long before)
    {
        if (User.TenantId() is not Guid tenantId || !await _chat.IsMemberAsync(tenantId, id, Me)) return Forbid();
        var page = await _chat.GetMessagesAsync(tenantId, id, before, PageSize + 1);
        return Json(new
        {
            hasOlder = page.Count > PageSize,
            messages = page.Take(PageSize).Reverse()
        });
    }

    [GeneratedRegex("[^a-z0-9-]+")]
    private static partial Regex NonSlug();

    [HttpPost("channels")]
    public async Task<IActionResult> CreateChannel(string name, string? description)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var clean = NonSlug().Replace((name ?? "").Trim().ToLowerInvariant().Replace(' ', '-'), "").Trim('-');
        if (clean.Length is < 2 or > 60)
        {
            TempData["Error"] = "Channel name must be 2–60 letters or numbers.";
            return RedirectToAction(nameof(Index));
        }

        var channelId = Guid.NewGuid();
        var (nameTaken, memberIds) = await _chat.CreateChannelAsync(new CreateChannelRequest(tenantId, channelId, clean, description?.Trim(), Me));
        if (nameTaken)
        {
            TempData["Error"] = $"#{clean} already exists.";
            return RedirectToAction(nameof(Index));
        }

        await AddConnectionsToGroupAsync(channelId, memberIds.Select(m => m.ToString()));
        await _hub.Clients.Group(ChatHub.TenantGroup(tenantId)).SendAsync("ChannelCreated", channelId, clean);
        return RedirectToAction(nameof(Index), new { id = channelId });
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

        await _hub.Clients.Group(ChatHub.ChannelGroup(id)).SendAsync("MessageReceived", message);
        return Json(message);
    }

    [HttpGet("file/{id:guid}")]
    public async Task<IActionResult> Download(Guid id)
    {
        if (User.TenantId() is not Guid tenantId) return Forbid();
        var attachment = await _chat.GetAttachmentAsync(tenantId, id, Me);
        if (attachment is null) return NotFound();

        var inline = attachment.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                     || attachment.ContentType == "application/pdf";
        var stream = _files.OpenRead(attachment.StoragePath);
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
