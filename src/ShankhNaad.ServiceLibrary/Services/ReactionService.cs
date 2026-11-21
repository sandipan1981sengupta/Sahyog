using System.Data;
using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>The emojis people can react to a message with.</summary>
public static class ReactionEmojis
{
    /// <summary>Shown on the quick bar when you point at a message.</summary>
    public static readonly string[] Quick = { "👍", "❤️", "😂", "😮", "😢", "🙏", "👏", "🎉" };
    /// <summary>Everything in the "+" panel (and the 😊 button in the message box). Keep in step with EMOJI_GROUPS in wwwroot/js/chat.js.</summary>
    public static readonly string[] More =
    {
        // Smileys
        "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😋", "😜", "🤪", "😎", "🤓", "🥳", "😏", "😌", "😴", "🤗", "🤔", "🤭", "🤫", "😶", "😐", "😑", "😬", "🙄", "😮", "😯", "😲", "😳", "🥺", "😢", "😭", "😤", "😡", "🤯", "😱", "🤒", "🤧", "😷",
        // Hands
        "👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "👏", "🙌", "👐", "🙏", "🤝", "💪", "👋", "✋", "👊", "✊", "🫡", "👀", "🧠",
        // Hearts & fun
        "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💯", "💥", "✨", "🔥", "⭐", "🌟", "🎉", "🎊", "🎁", "🏆", "🥇",
        // Work & more
        "✅", "❌", "⚠️", "❓", "❗", "💡", "📌", "📎", "📅", "⏰", "📞", "💻", "📊", "📈", "🚀", "☕", "🍕", "🍰", "🌹", "🌞",
    };
    public static readonly HashSet<string> Allowed = new(Quick.Concat(More));

    /// <summary>
    /// Any single emoji (the emoji panel offers all of them): 1–16 UTF-16 units (the column's size), made only of
    /// emoji characters and their joiners / modifiers (no letters, digits, spaces or markup).
    /// </summary>
    public static bool IsEmoji(string? text)
    {
        if (string.IsNullOrEmpty(text) || text.Length > 16) return false;
        if (Allowed.Contains(text)) return true;
        var runes = text.EnumerateRunes().ToList();
        // keycaps: 1️⃣ #️⃣ *️⃣
        if (runes.Count is 2 or 3 && runes[0].Value is (>= 0x30 and <= 0x39) or 0x23 or 0x2A && runes[^1].Value == 0x20E3)
            return runes.Count == 2 || runes[1].Value == 0xFE0F;
        var any = false;
        foreach (var r in runes)
        {
            var v = r.Value;
            if (v is 0x200D or 0xFE0F or 0xFE0E or 0x20E3) continue;                     // joiner, emoji / text style, keycap
            if (v is >= 0x1F3FB and <= 0x1F3FF) continue;                                 // skin tones
            if (v is >= 0xE0020 and <= 0xE007F) continue;                                 // tag letters (e.g. 🏴 of England)
            if (v is 0xA9 or 0xAE or 0x203C or 0x2049 or 0x2122 or 0x2139 or 0x3030 or 0x303D or 0x3297 or 0x3299
                || v is >= 0x2190 and <= 0x21FF || v is >= 0x2300 and <= 0x23FF || v is >= 0x24C2 and <= 0x27BF
                || v is >= 0x2934 and <= 0x2935 || v is >= 0x2B05 and <= 0x2B55 || v is >= 0x1F000 and <= 0x1FAFF)
            { any = true; continue; }
            return false;
        }
        return any;
    }
}

/// <summary>Reactions on chat messages (needs 26_MessageReactions.sql).</summary>
public interface IReactionService
{
    /// <summary>Status: 0 done, 1 not allowed, 9 script not run. Returns the message's chat and its reactions now.</summary>
    Task<(int Status, Guid? ChannelId, List<ReactionDto> Reactions)> ToggleAsync(Guid tenantId, long messageId, Guid userId, string emoji);
    Task<List<ReactionDto>> GetAsync(Guid tenantId, Guid userId, IEnumerable<long> messageIds);
}

public sealed class ReactionService : IReactionService
{
    private readonly SqlDb _db;
    public ReactionService(SqlDb db) => _db = db;
    private static bool Missing(SqlException ex) => ex.Number is 208 or 2812;
    private static ReactionDto Map(SqlDataReader r) => new(Convert.ToInt64(r["MessageId"]), r.S("Emoji"), r.G("UserId"), r.S("DisplayName"));

    public async Task<(int Status, Guid? ChannelId, List<ReactionDto> Reactions)> ToggleAsync(Guid tenantId, long messageId, Guid userId, string emoji)
    {
        if (!ReactionEmojis.IsEmoji(emoji)) return (1, null, new());
        try
        {
            SqlParameter? channel = null, result = null;
            var rows = await _db.QueryAsync("dbo.sahyog_Chat_ToggleReaction", p =>
            {
                p.With("@TenantId", tenantId).With("@MessageId", messageId).With("@UserId", userId).With("@Emoji", emoji);
                channel = p.AddOutput("@ChannelId", SqlDbType.UniqueIdentifier);
                result = p.AddOutput("@Result", SqlDbType.Int);
            }, Map);
            var status = result!.OutInt();
            return (status, channel!.Value is Guid g ? g : null, rows);
        }
        catch (SqlException ex) when (Missing(ex)) { return (9, null, new()); }
    }

    public async Task<List<ReactionDto>> GetAsync(Guid tenantId, Guid userId, IEnumerable<long> messageIds)
    {
        var ids = string.Join(",", messageIds.Distinct().Take(500));
        if (ids.Length == 0) return new();
        try
        {
            return await _db.QueryAsync("dbo.sahyog_Chat_GetReactions",
                p => p.With("@TenantId", tenantId).With("@UserId", userId).With("@Ids", ids), Map);
        }
        catch (SqlException ex) when (Missing(ex)) { return new(); }
    }
}
