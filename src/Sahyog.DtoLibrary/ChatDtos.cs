namespace Sahyog.DtoLibrary;

/// <summary>One line in the chat sidebar (sahyog_Chat_GetSidebar). For DMs, Other* is the other person.</summary>
public sealed record SidebarItemDto(
    Guid ChannelId, string Name, string? Description, bool IsDirect, int UnreadCount, DateTime LastMessageUtc,
    Guid? OtherUserId, string? OtherName, int? OtherTone);

public sealed record ChannelDto(Guid ChannelId, string Name, string? Description, bool IsDirect);

public sealed record MemberDto(Guid UserId, string DisplayName, int AvatarTone, string Email)
{
    public string Id => UserId.ToString();
    public string Initials => Names.Initials(DisplayName);
}

/// <summary>File info sent to the browser.</summary>
public sealed record AttachmentDto(Guid Id, string FileName, string ContentType, long SizeBytes, string Url);

/// <summary>File info including where it is stored on disk (server side only).</summary>
public sealed record AttachmentFileDto(Guid AttachmentId, Guid ChannelId, string FileName, string ContentType, long SizeBytes, string StoragePath);

/// <summary>A chat message as the browser receives it (from sahyog_vMessages).</summary>
public sealed record MessageDto(
    long Id,
    Guid ChannelId,
    string SenderId,
    string SenderName,
    string SenderInitials,
    int SenderTone,
    string Body,
    DateTime SentUtc,
    AttachmentDto? Attachment);

public sealed record SendMessageRequest(Guid TenantId, Guid ChannelId, Guid SenderId, string Body);

public sealed record SendFileRequest(
    Guid TenantId, Guid ChannelId, Guid SenderId, Guid AttachmentId,
    string FileName, string ContentType, long SizeBytes, string StoragePath);

public enum SendStatus { Ok = 0, NotMember = 1, StorageFull = 2 }

public sealed record SendResultDto(SendStatus Status, MessageDto? Message);

public sealed record CreateChannelRequest(Guid TenantId, Guid ChannelId, string Name, string? Description, Guid CreatedBy);

public sealed record CreateChannelResultDto(bool NameTaken, List<Guid> MemberIds);

/// <summary>Sent over SignalR to ring someone's screen.</summary>
public sealed record IncomingCallDto(Guid MeetingId, string Title, string CallerName, string CallerInitials, int CallerTone, string RoomUrl);
