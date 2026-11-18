namespace ShankhNaad.DtoLibrary;

/// <summary>One line in the chat sidebar (sahyog_Chat_GetSidebar). For DMs, Other* is the other person.</summary>
public sealed record SidebarItemDto(
    Guid ChannelId, string Name, string? Description, bool IsDirect, int UnreadCount, DateTime LastMessageUtc,
    Guid? OtherUserId, string? OtherName, int? OtherTone)
{
    /// <summary>A group of chosen people (not the whole workspace). Needs 16_Groups.sql.</summary>
    public bool IsPrivate { get; init; }
    /// <summary>Pinned to the top of this person's list (needs 18_EveryoneAndPins.sql).</summary>
    public bool IsPinned { get; init; }
    public DateTime? PinnedUtc { get; init; }
}

public sealed record ChannelDto(Guid ChannelId, string Name, string? Description, bool IsDirect)
{
    /// <summary>Who created the channel (null for #general and before 14_ChannelEdit.sql).</summary>
    public Guid? CreatedBy { get; init; }
    /// <summary>The workspace's first channel (#general): everyone is in it, so it can't be deleted. Null before 14_ChannelEdit.sql.</summary>
    public bool? IsMain { get; init; }
}

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
    AttachmentDto? Attachment)
{
    /// <summary>In a person's chat: the group this message was written in (null = your private chat).</summary>
    public string? FromGroup { get; init; }
}

public sealed record SendMessageRequest(Guid TenantId, Guid ChannelId, Guid SenderId, string Body);

public sealed record SendFileRequest(
    Guid TenantId, Guid ChannelId, Guid SenderId, Guid AttachmentId,
    string FileName, string ContentType, long SizeBytes, string StoragePath);

public enum SendStatus { Ok = 0, NotMember = 1, StorageFull = 2 }

public sealed record SendResultDto(SendStatus Status, MessageDto? Message);

public sealed record CreateChannelRequest(Guid TenantId, Guid ChannelId, string Name, string? Description, Guid CreatedBy)
{
    /// <summary>Set for a private group: only these people (plus the creator) are added.</summary>
    public List<Guid>? MemberIds { get; init; }
}

public sealed record CreateChannelResultDto(bool NameTaken, List<Guid> MemberIds)
{
    public bool NobodyPicked { get; init; }
}

/// <summary>How far someone has read in a conversation (for the ✓✓ read ticks).</summary>
public sealed record ReadStateDto(Guid UserId, string DisplayName, DateTime LastReadUtc);

/// <summary>Sent over SignalR to ring someone's screen.</summary>
public sealed record IncomingCallDto(Guid MeetingId, string Title, string CallerName, string CallerInitials, int CallerTone, string RoomUrl)
{
    /// <summary>The caller's id, so the ringing card can show their photo.</summary>
    public string? CallerId { get; init; }
    /// <summary>"video" for a call from Chat.</summary>
    public string Kind { get; init; } = "video";
}

/// <summary>One call started from Chat. Outcome: 0 ringing, 1 in progress, 2 ended, 3 not answered, 4 declined, 5 cancelled.</summary>
public sealed record CallLogDto(Guid MeetingId, Guid? ChannelId, Guid CallerId, DateTime StartedUtc, DateTime? AnsweredUtc, DateTime? EndedUtc, int Outcome);

/// <summary>One row on the Calls page. Outcome as in <see cref="CallLogDto"/>.</summary>
public sealed record CallHistoryDto(
    Guid MeetingId, Guid ChannelId, Guid CallerId, string CallerName, int CallerTone,
    DateTime StartedUtc, DateTime? AnsweredUtc, DateTime? EndedUtc, int Outcome,
    bool IsDirect, string ChannelName, int MemberCount, Guid? OtherId, string? OtherName, int OtherTone);

/// <summary>One row on the Files page.</summary>
public sealed record SharedFileDto(
    Guid AttachmentId, string FileName, string ContentType, long SizeBytes, DateTime UploadedUtc,
    Guid UploaderId, string UploaderName, int UploaderTone,
    Guid ChannelId, bool IsDirect, string ChannelName, Guid? OtherId, string? OtherName, int OtherTone);


/// <summary>A person in the "Add people" list of a call.</summary>
public sealed record CallPersonDto(Guid UserId, string Name, string Initials, int Tone, bool Online, bool Busy, bool InCall);

/// <summary>Who was rung into a call, and who couldn't be (offline).</summary>
public sealed record RingResultDto(List<string> Rung, List<string> Offline);

/// <summary>One message in a call's chat (text or a shared file). SenderId is null for a guest.</summary>
public sealed record CallChatMessageDto(long MessageId, Guid MeetingId, Guid? SenderId, string SenderName, int SenderTone,
    string? Body, Guid? FileId, string? FileName, string? ContentType, long? SizeBytes, DateTime SentUtc);

public sealed record CallChatFileDto(Guid MeetingId, string FileName, string ContentType, long SizeBytes, string StoragePath);
