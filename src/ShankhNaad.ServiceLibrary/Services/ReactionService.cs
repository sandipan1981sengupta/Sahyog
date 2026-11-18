using System.Data;
using Microsoft.Data.SqlClient;
using ShankhNaad.DtoLibrary;
using ShankhNaad.ServiceLibrary.Data;

namespace ShankhNaad.ServiceLibrary;

/// <summary>The emojis people can react to a message with.</summary>
public static class ReactionEmojis
{
    public static readonly string[] Allowed = { "👍", "❤️", "😂", "😮", "😢", "🙏", "👏", "🎉" };
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
        if (!ReactionEmojis.Allowed.Contains(emoji)) return (1, null, new());
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
