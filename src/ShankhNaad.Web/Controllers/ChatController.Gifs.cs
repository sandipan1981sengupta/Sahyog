using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// GIFs for chat: search / trending from GIPHY, through this server so the API key stays private.
/// Set "Gifs:GiphyApiKey" in appsettings.json (free key at developers.giphy.com). Without a key the picker says so.
/// A GIF message is sent as "[[gif:ID:WIDTHxHEIGHT]]" and shown from media.giphy.com.
/// </summary>
public sealed partial class ChatController
{
    private static readonly HttpClient GifHttp = new(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(10) })
    {
        Timeout = TimeSpan.FromSeconds(8)
    };
    // the same search (or trending page) is asked for often: keep answers 10 minutes, so a free key's hourly limit lasts
    private static readonly ConcurrentDictionary<string, (DateTime At, object Result)> GifCache = new();
    private static readonly TimeSpan GifCacheFor = TimeSpan.FromMinutes(10);
    private const int GifPageSize = 24;
    private static readonly string[] GifRatings = { "g", "pg", "pg-13", "r" };

    [HttpGet("gifs")]
    public async Task<IActionResult> Gifs(string? q, int offset, [FromServices] IConfiguration config, [FromServices] ILogger<ChatController> log)
    {
        Response.Headers.CacheControl = "no-store";
        var key = config["Gifs:GiphyApiKey"];
        if (string.IsNullOrWhiteSpace(key)) return Json(new { configured = false });
        var rating = (config["Gifs:Rating"] ?? "").Trim().ToLowerInvariant();
        if (!GifRatings.Contains(rating)) rating = "pg";

        q = (q ?? "").Trim();
        if (q.Length > 50) q = q[..50];
        offset = Math.Clamp(offset, 0, 4900);
        var cacheKey = $"{rating}|{q.ToLowerInvariant()}|{offset}";
        if (GifCache.TryGetValue(cacheKey, out var hit) && DateTime.UtcNow - hit.At < GifCacheFor) return Json(hit.Result);

        var common = $"api_key={Uri.EscapeDataString(key.Trim())}&limit={GifPageSize}&offset={offset}&rating={rating}&bundle=messaging_non_clips";
        var url = q.Length == 0
            ? $"https://api.giphy.com/v1/gifs/trending?{common}"
            : $"https://api.giphy.com/v1/gifs/search?{common}&q={Uri.EscapeDataString(q)}&lang=en";
        try
        {
            using var res = await GifHttp.GetAsync(url, HttpContext.RequestAborted);
            if (!res.IsSuccessStatusCode)
            {
                log.LogWarning("GIPHY answered {Status} for a GIF {Kind}.", (int)res.StatusCode, q.Length == 0 ? "trending list" : "search");
                return StatusCode(502, new
                {
                    error = (int)res.StatusCode switch
                    {
                        429 => "Too many GIF searches this hour. Try again in a few minutes.",
                        401 or 403 => "The GIPHY API key isn't accepted. Ask an admin to check Gifs:GiphyApiKey.",
                        _ => "GIPHY didn't answer. Try again."
                    }
                });
            }

            await using var stream = await res.Content.ReadAsStreamAsync(HttpContext.RequestAborted);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: HttpContext.RequestAborted);
            var items = new List<object>();
            if (doc.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                foreach (var g in data.EnumerateArray())
                {
                    var id = g.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    if (id is null || !GifIdPattern().IsMatch(id)) continue;
                    if (!g.TryGetProperty("images", out var images)
                        || !images.TryGetProperty("fixed_height", out var tall)
                        || !images.TryGetProperty("fixed_width", out var wide)) continue;
                    var preview = Str(wide, "webp") ?? Str(wide, "url");
                    if (preview is null || !GifMediaPattern().IsMatch(preview)) continue;   // only GIPHY's own picture servers
                    int w = Num(tall, "width"), h = Num(tall, "height"), pw = Num(wide, "width"), ph = Num(wide, "height");
                    if (w <= 0 || h <= 0) continue;
                    var title = Str(g, "title") ?? "GIF";
                    items.Add(new { id, title = title.Length > 80 ? title[..80] : title, preview, pw = pw > 0 ? pw : 200, ph = ph > 0 ? ph : 150, w, h });
                }
            }
            int total = 0, count = items.Count;
            if (doc.RootElement.TryGetProperty("pagination", out var page))
            {
                total = page.TryGetProperty("total_count", out var t) && t.TryGetInt32(out var tv) ? tv : 0;
                count = page.TryGetProperty("count", out var c) && c.TryGetInt32(out var cv) ? cv : count;
            }
            var next = offset + count;
            var result = new { configured = true, items, next, more = count > 0 && next < Math.Min(total == 0 ? next + 1 : total, 4900) };
            if (GifCache.Count > 500) GifCache.Clear();
            GifCache[cacheKey] = (DateTime.UtcNow, result);
            return Json(result);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException)
        {
            if (HttpContext.RequestAborted.IsCancellationRequested) return new EmptyResult();
            log.LogWarning(ex, "Loading GIFs from GIPHY failed.");
            return StatusCode(502, new { error = "Couldn't reach GIPHY. Check the server's internet connection and try again." });
        }

        static string? Str(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: > 0 } s ? s : null;
        // GIPHY sends sizes as strings ("200")
        static int Num(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) ? v.ValueKind switch
            {
                JsonValueKind.String => int.TryParse(v.GetString(), out var n) ? n : 0,
                JsonValueKind.Number => v.TryGetInt32(out var n2) ? n2 : 0,
                _ => 0
            } : 0;
    }

    [GeneratedRegex("^[A-Za-z0-9]{4,64}$")]
    private static partial Regex GifIdPattern();

    [GeneratedRegex(@"^https://media[0-9]*\.giphy\.com/")]
    private static partial Regex GifMediaPattern();
}
