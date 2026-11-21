using System.Collections.Concurrent;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// Our .js / .css / .svg files, ready to send: minified once (<see cref="AssetMinifier"/>, our own files only) and
/// compressed once at the best level (Brotli 11 and gzip), then kept in memory until the file changes.
///
/// Before, every request compressed the file again at the fastest (weakest) level. Now the work is done once,
/// and the files are about a quarter smaller on the wire on top of that, plus the minifying.
///
/// "App:MinifyAssets": false sends the files exactly as they are in wwwroot (still compressed).
/// </summary>
public sealed class OptimizedAssets
{
    public sealed record Item(byte[] Plain, byte[] Brotli, byte[] Gzip, string ETag, DateTime Stamp, long SourceLength);

    private readonly IWebHostEnvironment _env;
    private readonly ConcurrentDictionary<string, Item> _items = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, object> _locks = new(StringComparer.OrdinalIgnoreCase);
    public bool Minify { get; }

    public OptimizedAssets(IWebHostEnvironment env, IConfiguration config)
    {
        _env = env;
        Minify = config.GetValue("App:MinifyAssets", true);
    }

    public static bool Handles(string path) =>
        path.EndsWith(".js", StringComparison.OrdinalIgnoreCase) ||
        path.EndsWith(".css", StringComparison.OrdinalIgnoreCase) ||
        path.EndsWith(".svg", StringComparison.OrdinalIgnoreCase);

    /// <summary>The file at this request path (e.g. "/js/room.js"), or null if there is no such file.</summary>
    public Item? Get(string requestPath)
    {
        var info = _env.WebRootFileProvider.GetFileInfo(requestPath);   // refuses "..", paths outside wwwroot
        if (!info.Exists || info.IsDirectory || info.PhysicalPath is null) return null;
        var stamp = info.LastModified.UtcDateTime;
        if (_items.TryGetValue(requestPath, out var have) && have.Stamp == stamp && have.SourceLength == info.Length) return have;
        lock (_locks.GetOrAdd(requestPath, _ => new object()))
        {
            if (_items.TryGetValue(requestPath, out have) && have.Stamp == stamp && have.SourceLength == info.Length) return have;
            var raw = File.ReadAllBytes(info.PhysicalPath);
            var plain = raw;
            if (Minify && AssetMinifier.ShouldMinify(requestPath))
            {
                var text = new UTF8Encoding(false).GetString(raw);
                if (text.Length > 0 && text[0] == '﻿') text = text[1..];
                plain = new UTF8Encoding(false).GetBytes(AssetMinifier.Minify(requestPath, text));
            }
            var item = Pack(plain, stamp, info.Length);
            _items[requestPath] = item;
            return item;
        }
    }

    /// <summary>Brotli (best), gzip (best) and an ETag for some bytes.</summary>
    public static Item Pack(byte[] plain, DateTime stamp, long sourceLength)
    {
        var etag = "\"" + Convert.ToHexString(SHA256.HashData(plain))[..16].ToLowerInvariant() + "\"";
        return new Item(plain, Brotli(plain), Gzip(plain), etag, stamp, sourceLength);
    }

    private static byte[] Brotli(byte[] data)
    {
        var buffer = new byte[BrotliEncoder.GetMaxCompressedLength(data.Length)];
        return BrotliEncoder.TryCompress(data, buffer, out var written, quality: 11, window: 22) ? buffer[..written] : data;
    }

    private static byte[] Gzip(byte[] data)
    {
        using var ms = new MemoryStream();
        using (var gz = new GZipStream(ms, CompressionLevel.SmallestSize, leaveOpen: true)) gz.Write(data);
        return ms.ToArray();
    }

    /// <summary>Sends an item: 304 if the browser has it, else Brotli / gzip / plain, whichever the browser takes.</summary>
    public static async Task SendAsync(HttpContext ctx, Item item, string contentType, string cacheControl)
    {
        var res = ctx.Response;
        res.Headers.CacheControl = cacheControl;
        res.Headers.ETag = item.ETag;
        res.Headers.Vary = "Accept-Encoding";
        res.Headers.LastModified = item.Stamp.ToString("R");
        if (ctx.Request.Headers.IfNoneMatch.ToString().Contains(item.ETag, StringComparison.Ordinal))
        {
            res.StatusCode = StatusCodes.Status304NotModified;
            return;
        }
        var accept = ctx.Request.Headers.AcceptEncoding.ToString();
        byte[] body = item.Plain;
        if (accept.Contains("br", StringComparison.OrdinalIgnoreCase) && item.Brotli.Length < item.Plain.Length)
        { body = item.Brotli; res.Headers.ContentEncoding = "br"; }
        else if (accept.Contains("gzip", StringComparison.OrdinalIgnoreCase) && item.Gzip.Length < item.Plain.Length)
        { body = item.Gzip; res.Headers.ContentEncoding = "gzip"; }
        res.ContentType = contentType;
        res.ContentLength = body.Length;
        if (HttpMethods.IsHead(ctx.Request.Method)) return;
        await res.Body.WriteAsync(body);
    }

    /// <summary>
    /// The middleware: GET/HEAD of a .js, .css or .svg file in wwwroot is answered from here, with the same
    /// caching rules as the other static files (?v=… → a year; service worker → always check; else a day).
    /// Put it before UseResponseCompression (it compresses by itself) and before UseStaticFiles.
    /// </summary>
    public static Func<HttpContext, Func<Task>, Task> Middleware(OptimizedAssets assets, IContentTypeProvider types) => async (ctx, next) =>
    {
        var path = ctx.Request.Path.Value ?? "";
        if ((HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method)) && Handles(path)
            && !path.StartsWith("/bundles/", StringComparison.OrdinalIgnoreCase)
            && !ctx.Request.Headers.ContainsKey(HeaderNames.Range))
        {
            Item? item = null;
            try { item = assets.Get(path); } catch { item = null; }
            if (item is not null)
            {
                if (!types.TryGetContentType(path, out var type)) type = "application/octet-stream";
                if (type.StartsWith("text/", StringComparison.OrdinalIgnoreCase) && !type.Contains("charset", StringComparison.OrdinalIgnoreCase)) type += "; charset=utf-8";
                var cache = path.EndsWith("service-worker.js", StringComparison.OrdinalIgnoreCase) ? "no-cache"
                    : ctx.Request.Query.ContainsKey("v") ? "public, max-age=31536000, immutable"
                    : "public, max-age=86400";
                await SendAsync(ctx, item, type, cache);
                return;
            }
        }
        await next();
    };
}
