using Microsoft.AspNetCore.Mvc;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.ServiceLibrary.Data;
using ShankhNaad.Web.Infrastructure;

namespace ShankhNaad.Web.Controllers;

/// <summary>
/// Languages (js/lang.js): translate a chat message into the language you picked, and a voice note into text.
/// Off until "Languages" keys are in appsettings.json (Infrastructure/LanguageService.cs). Saved: database/53_Languages.sql.
/// </summary>
[Route("lang"), NeedsScript("53_Languages.sql")]
public sealed class LanguageController : WorkControllerBase
{
    private const long MaxAudioBytes = 25 * 1024 * 1024;

    private readonly LanguageService _lang;
    private readonly IWorkData _db;
    private readonly IChatService _chat;
    private readonly IFileStorage _files;

    public LanguageController(LanguageService lang, IWorkData db, IChatService chat, IFileStorage files)
    {
        _lang = lang;
        _db = db;
        _chat = chat;
        _files = files;
    }

    /// <summary>A stable number for a text (string.GetHashCode changes every time the app starts).</summary>
    private static int Hash(string s)
    {
        unchecked
        {
            var h = (int)2166136261;
            foreach (var c in s) h = (h ^ c) * 16777619;
            return h;
        }
    }

    public sealed class TranslateInput { public long MessageId { get; set; } public string? To { get; set; } }

    [HttpPost("translate")]
    public async Task<IActionResult> Translate([FromBody] TranslateInput input)
    {
        if (!_lang.TranslateOn) return Fail("Translation isn't set up on this server yet.", 501);
        var to = input.To ?? "";
        if (!LanguageService.Languages.ContainsKey(to)) return Fail("Pick a language.");
        var m = await _db.RowAsync("dbo.sahyog_Lang_Message", p => p.With("@TenantId", TenantId).With("@UserId", Me).With("@MessageId", input.MessageId).AddText("@Lang", to, 10));
        if (m is null) return Fail("That message was deleted.", 404);
        var body = m.S("body") ?? "";
        // forwarded messages: translate the text, not the "[[fwd:…]]" header; cards and GIFs have nothing to translate
        body = System.Text.RegularExpressions.Regex.Replace(body, @"^\[\[fwd:[^\]\r\n]*\]\]\n?", "");
        if (body.Length == 0 || body.StartsWith("[[")) return Fail("There's no text to translate.");
        var hash = Hash(body);
        if (m.S("translated") is string saved && m.I("textHash") == hash)
            return Json(new { text = saved, from = m.S("fromLang"), to });
        var r = await _lang.TranslateAsync(body, to);
        if (r is null) return Fail("Translation didn't work just now. Try again in a minute.", 502);
        await _db.ExecAsync("dbo.sahyog_Lang_SaveTranslation", p => p.With("@MessageId", input.MessageId).AddText("@Lang", to, 10)
            .With("@TextHash", hash).AddText("@Translated", r.Value.Text, -1).AddText("@FromLang", r.Value.From, 10));
        return Json(new { text = r.Value.Text, from = r.Value.From, to });
    }

    public sealed class TranscribeInput { public Guid AttachmentId { get; set; } }

    [HttpPost("transcribe")]
    public async Task<IActionResult> Transcribe([FromBody] TranscribeInput input)
    {
        if (!_lang.TranscribeOn) return Fail("Voice-note transcripts aren't set up on this server yet.", 501);
        var file = await _chat.GetAttachmentAsync(TenantId, input.AttachmentId, Me);      // only for people who can see the file
        if (file is null) return Fail("That file was deleted.", 404);
        if (!file.ContentType.StartsWith("audio/", StringComparison.OrdinalIgnoreCase) && !file.ContentType.Equals("video/webm", StringComparison.OrdinalIgnoreCase))
            return Fail("Only voice notes and audio files can be turned into text.");
        var saved = await _db.RowAsync("dbo.sahyog_Lang_GetTranscript", p => p.With("@AttachmentId", input.AttachmentId));
        if (saved?.S("transcript") is string t) return Json(new { text = t });
        if (file.SizeBytes > MaxAudioBytes) return Fail("That recording is too long to turn into text (25 MB at most).");
        string? text;
        try
        {
            await using var stream = _files.OpenRead(file.StoragePath);
            text = await _lang.TranscribeAsync(stream, file.FileName, file.ContentType);
        }
        catch (Exception ex) when (MissingFile.Is(ex)) { return Fail("The recording file is missing on the server.", 404); }
        if (text is null) return Fail("Couldn't turn it into text just now. Try again in a minute.", 502);
        if (text.Length == 0) text = "(No speech was heard.)";
        await _db.ExecAsync("dbo.sahyog_Lang_SaveTranscript", p => p.With("@AttachmentId", input.AttachmentId).AddText("@Transcript", text, -1));
        return Json(new { text });
    }
}
