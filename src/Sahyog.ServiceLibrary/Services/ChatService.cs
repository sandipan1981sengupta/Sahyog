using System.Data;
using Microsoft.Data.SqlClient;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary.Data;

namespace Sahyog.ServiceLibrary;

/// <summary>Channels, direct messages, messages and shared files.</summary>
public interface IChatService
{
    Task<List<SidebarItemDto>> GetSidebarAsync(Guid tenantId, Guid userId);
    Task<ChannelDto?> GetChannelAsync(Guid tenantId, Guid channelId);
    Task<bool> IsMemberAsync(Guid tenantId, Guid channelId, Guid userId);
    Task<List<Guid>> GetUserChannelIdsAsync(Guid tenantId, Guid userId);
    Task<List<MemberDto>> GetMembersAsync(Guid tenantId, Guid channelId);
    /// <summary>Newest first, up to <paramref name="take"/> messages; <paramref name="beforeId"/> for "load older".</summary>
    Task<List<MessageDto>> GetMessagesAsync(Guid tenantId, Guid channelId, long? beforeId, int take);
    Task<SendResultDto> SendMessageAsync(SendMessageRequest request);
    Task<SendResultDto> SendFileAsync(SendFileRequest request);
    Task MarkReadAsync(Guid tenantId, Guid channelId, Guid userId);
    Task<List<AttachmentDto>> GetRecentFilesAsync(Guid tenantId, Guid channelId, int take = 5);
    Task<AttachmentFileDto?> GetAttachmentAsync(Guid tenantId, Guid attachmentId, Guid userId);
    Task<CreateChannelResultDto> CreateChannelAsync(CreateChannelRequest request);
    /// <returns>The conversation id, or null if the other person isn't in this workspace.</returns>
    Task<Guid?> GetOrCreateDirectAsync(Guid tenantId, Guid userId, Guid otherUserId);
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
                : null);
    }

    public Task<List<SidebarItemDto>> GetSidebarAsync(Guid tenantId, Guid userId) =>
        _db.QueryAsync("dbo.sahyog_Chat_GetSidebar", p => p.With("@TenantId", tenantId).With("@UserId", userId), r => new SidebarItemDto(
            r.G("ChannelId"), r.S("Name"), r.SN("Description"), r.B("IsDirect"), r.I("UnreadCount"), r.Utc("LastMessageUtc"),
            r.GN("OtherUserId"), r.SN("OtherName"), r.IN("OtherTone")));

    public Task<ChannelDto?> GetChannelAsync(Guid tenantId, Guid channelId) =>
        _db.QueryFirstAsync("dbo.sahyog_Chat_GetChannel", p => p.With("@TenantId", tenantId).With("@ChannelId", channelId),
            r => new ChannelDto(r.G("ChannelId"), r.S("Name"), r.SN("Description"), r.B("IsDirect")));

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
        SqlParameter? result = null;
        var rows = await _db.QueryAsync("dbo.sahyog_Chat_SendMessage", p =>
        {
            p.With("@TenantId", request.TenantId).With("@ChannelId", request.ChannelId).With("@SenderId", request.SenderId)
             .AddText("@Body", request.Body, 4000);
            result = p.AddOutput("@Result", SqlDbType.Int);
        }, MapMessage);
        return new SendResultDto((SendStatus)result!.OutInt(), rows.FirstOrDefault());
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

    public Task MarkReadAsync(Guid tenantId, Guid channelId, Guid userId) =>
        _db.ExecAsync("dbo.sahyog_Chat_MarkRead", p => p.With("@TenantId", tenantId).With("@ChannelId", channelId).With("@UserId", userId));

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
}
