using System.Data;
using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>Channels, direct messages, messages and shared files.</summary>
public interface IChatService
{
    Task<List<SidebarItemDto>> GetSidebarAsync(Guid tenantId, Guid userId);
    Task<ChannelDto?> GetChannelAsync(Guid tenantId, Guid channelId);
    /// <summary>Renames a group channel. 0 saved, 1 not found, 2 not allowed, 3 name already used.</summary>
    Task<int> UpdateChannelAsync(Guid tenantId, Guid channelId, Guid userId, bool isAdmin, string name, string? description);
    /// <summary>Deletes a group channel with its messages and files. 0 deleted, 1 not found, 4 main channel. Returns the files to remove.</summary>
    Task<(int Status, List<string> Files)> DeleteChannelAsync(Guid tenantId, Guid channelId);
    Task<bool> IsMemberAsync(Guid tenantId, Guid channelId, Guid userId);
    Task<List<Guid>> GetUserChannelIdsAsync(Guid tenantId, Guid userId);
    Task<List<MemberDto>> GetMembersAsync(Guid tenantId, Guid channelId);
    /// <summary>Newest first, up to <paramref name="take"/> messages; <paramref name="beforeId"/> for "load older".</summary>
    Task<List<MessageDto>> GetMessagesAsync(Guid tenantId, Guid channelId, long? beforeId, int take);
    Task<SendResultDto> SendMessageAsync(SendMessageRequest request);
    Task<SendResultDto> SendFileAsync(SendFileRequest request);
    /// <summary>Marks a conversation read. Returns the time it was read when something new was read (tell the senders), else null.</summary>
    Task<DateTime?> MarkReadAsync(Guid tenantId, Guid channelId, Guid userId);
    /// <summary>
    /// A person's chat: your private messages with them plus what either of you wrote in groups you share,
    /// newest first. Falls back to the private chat only until 19_PersonTimeline.sql is run.
    /// </summary>
    Task<List<MessageDto>> GetPersonTimelineAsync(Guid tenantId, Guid channelId, Guid userId, Guid otherId, long? beforeId, int take);
    /// <summary>Pins or unpins a chat for one person. False when they aren't in it.</summary>
    Task<bool> SetPinnedAsync(Guid tenantId, Guid channelId, Guid userId, bool pinned);
    /// <summary>Who has read up to when (empty until 15_ReadReceipts.sql is run).</summary>
    Task<List<ReadStateDto>> GetReadStateAsync(Guid tenantId, Guid channelId);
    Task<List<AttachmentDto>> GetRecentFilesAsync(Guid tenantId, Guid channelId, int take = 5);
    Task<AttachmentFileDto?> GetAttachmentAsync(Guid tenantId, Guid attachmentId, Guid userId);
    Task<CreateChannelResultDto> CreateChannelAsync(CreateChannelRequest request);
    /// <returns>The conversation id, or null if the other person isn't in this workspace.</returns>
    Task<Guid?> GetOrCreateDirectAsync(Guid tenantId, Guid userId, Guid otherUserId);
    /// <summary>Deletes a direct conversation (messages and files) for both people.</summary>
    /// <returns>Deleted = false when it isn't a direct chat this user is in; Files = storage paths to remove.</returns>
    Task<(bool Deleted, List<string> Files)> DeleteDirectAsync(Guid tenantId, Guid channelId, Guid userId);
    /// <summary>Adds people to a group (its creator or an admin). Status 0 ok, 1 not a group you can change (or Everyone),
    /// 2 not allowed, 3 nobody new, 9 script 29 not run. Returns who was added.</summary>
    Task<(int Status, List<Guid> Added)> AddMembersAsync(Guid tenantId, Guid channelId, Guid userId, bool isAdmin, IEnumerable<Guid> memberIds);
    /// <summary>Removes someone from a group. Status 0 ok, 1 not a group you can change, 2 not allowed, 3 not in it,
    /// 4 yourself, 5 only an admin can remove the creator, 9 script 29 not run.</summary>
    Task<int> RemoveMemberAsync(Guid tenantId, Guid channelId, Guid userId, bool isAdmin, Guid memberId);
    /// <summary>Copies a one-to-one chat's messages (since a time, or all) into a group. Null when script 29 isn't run; -1 not allowed.</summary>
    Task<int?> CopyHistoryAsync(Guid tenantId, Guid fromChannelId, Guid toChannelId, Guid userId, DateTime? sinceUtc);
    /// <summary>Deletes one message. Callers pass isAdmin = false so only the sender can delete it. Status 0 ok, 1 not found, 2 not allowed.</summary>
    Task<(int Status, Guid? ChannelId, string? FilePath)> DeleteMessageAsync(Guid tenantId, long messageId, Guid userId, bool isAdmin);
    /// <summary>Edits your own text message. Status: 0 done, 1 not found, 2 not yours, 3 can't be edited, 4 the database needs 32_OutOfOfficeAndEdit.sql.</summary>
    Task<(int Status, MessageDto? Message)> EditMessageAsync(Guid tenantId, long messageId, Guid userId, string body);
}

public sealed class ChatService : IChatService
{
    private readonly SqlDb _db;
    public ChatService(SqlDb db) => _db = db;

    /// <summary>Maps one row of dbo.sahyog_vMessages.</summary>
    private static MessageDto MapMessage(SqlDataReader r)
    {
        var attachmentId = r.GN("AttachmentId");
        var name = r.S("SenderName");
        return new MessageDto(
            r.L("MessageId"), r.G("ChannelId"), r.G("SenderId").ToString(), name, Names.Initials(name), r.I("SenderTone"),
            r.S("Body"), r.Utc("SentUtc"),
            attachmentId is Guid id
                ? new AttachmentDto(id, r.S("FileName"), r.S("ContentType"), r.L("SizeBytes"), $"/chat/file/{id}")
                : null)
        {
            FromGroup = r.Has("FromGroup") ? r.SN("FromGroup") : null,
            ReplyToId = r.Has("ReplyToId") && r["ReplyToId"] is not DBNull ? r.L("ReplyToId") : null,
            ReplyToSender = r.Has("ReplyToSenderName") ? r.SN("ReplyToSenderName") : null,
            ReplyToText = r.Has("ReplyToBody")
                ? (string.IsNullOrEmpty(r.SN("ReplyToBody")) ? r.SN("ReplyToFileName") : r.SN("ReplyToBody"))
                : null,
            IsCopied = r.Has("CopiedFromId") && r["CopiedFromId"] is not DBNull,
            EditedUtc = r.Has("EditedUtc") ? r.UtcN("EditedUtc") : null
        };
    }

    public Task<List<SidebarItemDto>> GetSidebarAsync(Guid tenantId, Guid userId) =>
        _db.QueryAsync("dbo.sahyog_Chat_GetSidebar", p => p.With("@TenantId", tenantId).With("@UserId", userId), r => new SidebarItemDto(
            r.G("ChannelId"), r.S("Name"), r.SN("Description"), r.B("IsDirect"), r.I("UnreadCount"), r.Utc("LastMessageUtc"),
            r.GN("OtherUserId"), r.SN("OtherName"), r.IN("OtherTone")) { IsPrivate = r.BOpt("IsPrivate"), IsPinned = r.BOpt("IsPinned"), PinnedUtc = r.UtcOpt("PinnedUtc") });

    public Task<ChannelDto?> GetChannelAsync(Guid tenantId, Guid channelId) =>
        _db.QueryFirstAsync("dbo.sahyog_Chat_GetChannel", p => p.With("@TenantId", tenantId).With("@ChannelId", channelId),
            r => new ChannelDto(r.G("ChannelId"), r.S("Name"), r.SN("Description"), r.B("IsDirect"))
            {
                CreatedBy = r.Has("CreatedBy") ? r.GN("CreatedBy") : null,
                IsMain = r.Has("IsMain") ? r.B("IsMain") : null
            });

    public async Task<int> UpdateChannelAsync(Guid tenantId, Guid channelId, Guid userId, bool isAdmin, string name, string? description)
    {
        SqlParameter? result = null;
        await _db.ExecAsync("dbo.sahyog_Chat_UpdateChannel", p =>
        {
            p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@UserId", userId).With("@IsAdmin", isAdmin)
             .AddText("@Name", name, 80).AddText("@Description", description, 300);
            result = p.AddOutput("@Result", SqlDbType.Int);
        });
        return result!.OutInt();
    }

    public async Task<(int Status, List<string> Files)> DeleteChannelAsync(Guid tenantId, Guid channelId)
    {
        SqlParameter? result = null;
        var files = await _db.QueryAsync("dbo.sahyog_Chat_DeleteChannel", p =>
        {
            p.With("@TenantId", tenantId).With("@ChannelId", channelId);
            result = p.AddOutput("@Result", SqlDbType.Int);
        }, r => r.S("StoragePath"));
        return (result!.OutInt(), files);
    }

    public async Task<bool> IsMemberAsync(Guid tenantId, Guid channelId, Guid userId)
    {
        var rows = await _db.QueryAsync("dbo.sahyog_Chat_IsMember",
            p => p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@UserId", userId), r => r.B("IsMember"));
        return rows.FirstOrDefault();
    }

    public Task<List<Guid>> GetUserChannelIdsAsync(Guid tenantId, Guid userId) =>
        _db.QueryAsync("dbo.sahyog_Chat_GetUserChannelIds", p => p.With("@TenantId", tenantId).With("@UserId", userId), r => r.G("ChannelId"));

    public Task<List<MemberDto>> GetMembersAsync(Guid tenantId, Guid channelId) =>
        _db.QueryAsync("dbo.sahyog_Chat_GetMembers", p => p.With("@TenantId", tenantId).With("@ChannelId", channelId),
            r => new MemberDto(r.G("UserId"), r.S("DisplayName"), r.I("AvatarTone"), r.S("Email")));

    public Task<List<MessageDto>> GetMessagesAsync(Guid tenantId, Guid channelId, long? beforeId, int take) =>
        _db.QueryAsync("dbo.sahyog_Chat_GetMessages",
            p => p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@BeforeId", beforeId).With("@Take", take),
            MapMessage);

    public async Task<SendResultDto> SendMessageAsync(SendMessageRequest request)
    {
        // a reply needs 27_MessageReplies.sql; before it's run, the message still goes, just without the quote
        var replyTo = request.ReplyToId;
        try { return await Send(replyTo); }
        catch (SqlException ex) when (replyTo is not null && ex.Number is 8144 or 207) { return await Send(null); }

        async Task<SendResultDto> Send(long? reply)
        {
            SqlParameter? result = null;
            var rows = await _db.QueryAsync("dbo.sahyog_Chat_SendMessage", p =>
            {
                p.With("@TenantId", request.TenantId).With("@ChannelId", request.ChannelId).With("@SenderId", request.SenderId)
                 .AddText("@Body", request.Body, 4000);
                result = p.AddOutput("@Result", SqlDbType.Int);
                if (reply is long id) p.With("@ReplyToId", id);
            }, MapMessage);
            return new SendResultDto((SendStatus)result!.OutInt(), rows.FirstOrDefault());
        }
    }

    public async Task<SendResultDto> SendFileAsync(SendFileRequest request)
    {
        SqlParameter? result = null;
        var rows = await _db.QueryAsync("dbo.sahyog_Chat_SendFile", p =>
        {
            p.With("@TenantId", request.TenantId).With("@ChannelId", request.ChannelId).With("@SenderId", request.SenderId)
             .With("@AttachmentId", request.AttachmentId)
             .AddText("@FileName", request.FileName, 255)
             .AddText("@ContentType", request.ContentType, 150)
             .With("@SizeBytes", request.SizeBytes)
             .AddText("@StoragePath", request.StoragePath, 400);
            result = p.AddOutput("@Result", SqlDbType.Int);
        }, MapMessage);
        return new SendResultDto((SendStatus)result!.OutInt(), rows.FirstOrDefault());
    }

    // null = not checked yet; false = 15_ReadReceipts.sql not run (use the old procedure, no ticks)
    private static bool? _readReceipts;

    public async Task<DateTime?> MarkReadAsync(Guid tenantId, Guid channelId, Guid userId)
    {
        if (_readReceipts != false)
        {
            try
            {
                SqlParameter? readUtc = null;
                await _db.ExecAsync("dbo.sahyog_Chat_MarkReadV2", p =>
                {
                    p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@UserId", userId);
                    readUtc = p.AddOutput("@ReadUtc", SqlDbType.DateTime2);
                });
                _readReceipts = true;
                return readUtc!.Value is DateTime d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null;
            }
            catch (SqlException ex) when (ex.Number == 2812) { _readReceipts = false; }
        }
        await _db.ExecAsync("dbo.sahyog_Chat_MarkRead", p => p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@UserId", userId));
        return null;
    }

    private static bool? _timeline;

    public async Task<List<MessageDto>> GetPersonTimelineAsync(Guid tenantId, Guid channelId, Guid userId, Guid otherId, long? beforeId, int take)
    {
        if (_timeline != false)
        {
            try
            {
                var rows = await _db.QueryAsync("dbo.sahyog_Chat_GetPersonTimeline", p =>
                    p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@UserId", userId).With("@OtherId", otherId)
                     .With("@BeforeId", (object?)beforeId ?? DBNull.Value).With("@Take", take), MapMessage);
                _timeline = true;
                return rows;
            }
            catch (SqlException ex) when (ex.Number == 2812) { _timeline = false; }
        }
        return await GetMessagesAsync(tenantId, channelId, beforeId, take);
    }

    public async Task<bool> SetPinnedAsync(Guid tenantId, Guid channelId, Guid userId, bool pinned)
    {
        SqlParameter? result = null;
        await _db.ExecAsync("dbo.sahyog_Chat_SetPinned", p =>
        {
            p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@UserId", userId).With("@Pinned", pinned);
            result = p.AddOutput("@Result", SqlDbType.Int);
        });
        return result!.OutInt() == 0;
    }

    public async Task<List<ReadStateDto>> GetReadStateAsync(Guid tenantId, Guid channelId)
    {
        if (_readReceipts == false) return new();
        try
        {
            var rows = await _db.QueryAsync("dbo.sahyog_Chat_GetReadState",
                p => p.With("@TenantId", tenantId).With("@ChannelId", channelId),
                r => new ReadStateDto(r.G("UserId"), r.S("DisplayName"), r.Utc("LastReadUtc")));
            _readReceipts = true;
            return rows;
        }
        catch (SqlException ex) when (ex.Number == 2812) { _readReceipts = false; return new(); }
    }

    public Task<List<AttachmentDto>> GetRecentFilesAsync(Guid tenantId, Guid channelId, int take = 5) =>
        _db.QueryAsync("dbo.sahyog_Chat_GetRecentFiles", p => p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@Take", take),
            r =>
            {
                var id = r.G("AttachmentId");
                return new AttachmentDto(id, r.S("FileName"), r.S("ContentType"), r.L("SizeBytes"), $"/chat/file/{id}");
            });

    public Task<AttachmentFileDto?> GetAttachmentAsync(Guid tenantId, Guid attachmentId, Guid userId) =>
        _db.QueryFirstAsync("dbo.sahyog_Chat_GetAttachment",
            p => p.With("@TenantId", tenantId).With("@AttachmentId", attachmentId).With("@UserId", userId),
            r => new AttachmentFileDto(r.G("AttachmentId"), r.G("ChannelId"), r.S("FileName"), r.S("ContentType"), r.L("SizeBytes"), r.S("StoragePath")));

    public async Task<CreateChannelResultDto> CreateChannelAsync(CreateChannelRequest request)
    {
        if (request.MemberIds is { } picked)
        {
            // private group: only the people picked (and you)
            SqlParameter? groupResult = null;
            var groupMembers = await _db.QueryAsync("dbo.sahyog_Chat_CreateGroup", p =>
            {
                p.With("@TenantId", request.TenantId).With("@ChannelId", request.ChannelId)
                 .AddText("@Name", request.Name, 80).AddText("@Description", request.Description, 300)
                 .With("@CreatedBy", request.CreatedBy)
                 .AddText("@MemberIds", string.Join(",", picked), -1);
                groupResult = p.AddOutput("@Result", SqlDbType.Int);
            }, r => r.G("UserId"));
            var code = groupResult!.OutInt();
            return new CreateChannelResultDto(code == 1, groupMembers) { NobodyPicked = code == 2 };
        }

        SqlParameter? result = null;
        var members = await _db.QueryAsync("dbo.sahyog_Chat_CreateChannel", p =>
        {
            p.With("@TenantId", request.TenantId).With("@ChannelId", request.ChannelId)
             .AddText("@Name", request.Name, 80).AddText("@Description", request.Description, 300)
             .With("@CreatedBy", request.CreatedBy);
            result = p.AddOutput("@Result", SqlDbType.Int);
        }, r => r.G("UserId"));
        return new CreateChannelResultDto(result!.OutInt() == 1, members);
    }

    public async Task<Guid?> GetOrCreateDirectAsync(Guid tenantId, Guid userId, Guid otherUserId)
    {
        var a = userId.ToString();
        var b = otherUserId.ToString();
        var key = string.CompareOrdinal(a, b) < 0 ? $"{a}:{b}" : $"{b}:{a}";
        SqlParameter? channel = null;
        await _db.ExecAsync("dbo.sahyog_Chat_GetOrCreateDirect", p =>
        {
            p.With("@TenantId", tenantId).With("@UserId", userId).With("@OtherUserId", otherUserId).AddText("@DirectKey", key, 80);
            channel = p.AddOutput("@ChannelId", SqlDbType.UniqueIdentifier);
        });
        return channel!.Value is Guid g ? g : null;
    }

    public async Task<(int Status, List<Guid> Added)> AddMembersAsync(Guid tenantId, Guid channelId, Guid userId, bool isAdmin, IEnumerable<Guid> memberIds)
    {
        try
        {
            SqlParameter? result = null;
            var added = await _db.QueryAsync("dbo.sahyog_Chat_AddMembers", p =>
            {
                p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@UserId", userId).With("@IsAdmin", isAdmin)
                 .AddText("@MemberIds", string.Join(",", memberIds), -1);
                result = p.AddOutput("@Result", SqlDbType.Int);
            }, r => r.G("UserId"));
            return (result!.OutInt(), added);
        }
        catch (SqlException ex) when (ex.Number == 2812) { return (9, new()); }
    }

    public async Task<int> RemoveMemberAsync(Guid tenantId, Guid channelId, Guid userId, bool isAdmin, Guid memberId)
    {
        try
        {
            SqlParameter? result = null;
            await _db.ExecAsync("dbo.sahyog_Chat_RemoveMember", p =>
            {
                p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@UserId", userId).With("@IsAdmin", isAdmin)
                 .With("@MemberId", memberId);
                result = p.AddOutput("@Result", SqlDbType.Int);
            });
            return result!.OutInt();
        }
        catch (SqlException ex) when (ex.Number == 2812) { return 9; }
    }

    public async Task<int?> CopyHistoryAsync(Guid tenantId, Guid fromChannelId, Guid toChannelId, Guid userId, DateTime? sinceUtc)
    {
        try
        {
            SqlParameter? result = null;
            var rows = await _db.QueryAsync("dbo.sahyog_Chat_CopyHistory", p =>
            {
                p.With("@TenantId", tenantId).With("@FromChannelId", fromChannelId).With("@ToChannelId", toChannelId)
                 .With("@UserId", userId).AddDateTime2("@SinceUtc", sinceUtc);
                result = p.AddOutput("@Result", SqlDbType.Int);
            }, r => r.I("Copied"));
            return result!.OutInt() == 0 ? rows.FirstOrDefault() : -1;
        }
        catch (SqlException ex) when (ex.Number == 2812) { return null; }
    }

    public async Task<(bool Deleted, List<string> Files)> DeleteDirectAsync(Guid tenantId, Guid channelId, Guid userId)
    {
        SqlParameter? result = null;
        var files = await _db.QueryAsync("dbo.sahyog_Chat_DeleteDirect", p =>
        {
            p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@UserId", userId);
            result = p.AddOutput("@Result", SqlDbType.Int);
        }, r => r.S("StoragePath"));
        return (result!.OutInt() == 1, files);
    }

    public async Task<(int Status, MessageDto? Message)> EditMessageAsync(Guid tenantId, long messageId, Guid userId, string body)
    {
        SqlParameter? result = null;
        List<MessageDto> rows;
        try
        {
            rows = await _db.QueryAsync("dbo.sahyog_Chat_EditMessage", p =>
            {
                p.With("@TenantId", tenantId).With("@MessageId", messageId).With("@UserId", userId).AddText("@Body", body, 4000);
                result = p.AddOutput("@Result", SqlDbType.Int);
            }, MapMessage);
        }
        catch (SqlException ex) when (ex.Number == 2812) { return (4, null); }      // procedure not there yet
        var status = result!.OutInt();
        return status == 0 && rows.Count > 0 ? (0, rows[0]) : (status == 0 ? 1 : status, null);
    }

    public async Task<(int Status, Guid? ChannelId, string? FilePath)> DeleteMessageAsync(Guid tenantId, long messageId, Guid userId, bool isAdmin)
    {
        SqlParameter? result = null;
        var rows = await _db.QueryAsync("dbo.sahyog_Chat_DeleteMessage", p =>
        {
            p.With("@TenantId", tenantId).With("@MessageId", messageId).With("@UserId", userId).With("@IsAdmin", isAdmin);
            result = p.AddOutput("@Result", SqlDbType.Int);
        }, r => (r.G("ChannelId"), r.SN("StoragePath")));
        var status = result!.OutInt();
        if (status != 0 || rows.Count == 0) return (status == 0 ? 1 : status, null, null);
        return (0, rows[0].Item1, rows[0].Item2);
    }
}
