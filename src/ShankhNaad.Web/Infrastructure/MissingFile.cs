using System.Net;
using Microsoft.AspNetCore.Mvc;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// Shown instead of a crash when a file's record is in the database but the file itself is not on this
/// server's disk. Usual reason: the file was uploaded through another copy of the app that uses the same
/// database (e.g. the live site vs. localhost), and Storage:RootPath is a folder on that other machine.
/// </summary>
public static class MissingFile
{
    public static bool Is(Exception ex) => ex is FileNotFoundException or DirectoryNotFoundException;

    public static IActionResult Page(string fileName, ILogger log, string storagePath)
    {
        log.LogWarning("File {FileName} is in the database but not on disk at {StoragePath}", fileName, storagePath);
        var name = WebUtility.HtmlEncode(fileName);
        var html = $$"""
            <!DOCTYPE html>
            <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>File not found · ShankhNaad</title>
            <style>
              body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Roboto,Segoe UI,sans-serif;background:#0F172A;color:#E2E8F0}
              .card{max-width:440px;margin:16px;padding:28px;border-radius:22px;background:#1E293B;border:1px solid rgba(255,255,255,.08);text-align:center}
              h1{font-size:19px;margin:10px 0 8px} p{color:#94A3B8;line-height:1.5;font-size:14px;margin:0 0 18px}
              b{color:#E2E8F0;word-break:break-all} a{display:inline-block;padding:10px 18px;border-radius:12px;background:linear-gradient(135deg,#6366F1,#A855F7);color:#fff;text-decoration:none;font-weight:600}
              .ic{font-size:38px}
            </style></head>
            <body><div class="card"><div class="ic">📄</div>
              <h1>This file isn't available</h1>
              <p><b>{{name}}</b> is listed in the chat, but the file itself isn't stored on this server.
                 It may have been uploaded on another server, or removed. Ask the sender to share it again.</p>
              <a href="javascript:history.length>1?history.back():window.close()">Go back</a>
            </div></body></html>
            """;
        return new ContentResult { Content = html, ContentType = "text/html; charset=utf-8", StatusCode = 404 };
    }
}
