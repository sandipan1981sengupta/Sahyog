using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// Languages: translate a chat message (Azure AI Translator) and turn a voice note into text (Azure AI Speech, fast transcription).
/// Both are OFF until their keys are in appsettings.json:
///   "Languages": {
///     "TranslatorKey": "…", "TranslatorRegion": "centralindia",      (Translator resource; region of a regional/multi-service resource)
///     "SpeechKey": "…",     "SpeechRegion": "centralindia",          (Speech resource)
///     "SpeechLocales": "en-IN,hi-IN"                                  (optional: languages people speak in voice notes)
///   }
/// Each translation / transcript is saved (53_Languages.sql), so the same message is paid for once.
/// </summary>
public sealed class LanguageService
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(90) };
    private readonly string? _trKey, _trRegion, _trEndpoint, _spKey, _spRegion;
    private readonly string[] _locales;
    private readonly ILogger<LanguageService> _log;

    /// <summary>The languages people can pick (code → name in that language).</summary>
    public static readonly IReadOnlyDictionary<string, string> Languages = new Dictionary<string, string>
    {
        ["en"] = "English", ["hi"] = "हिन्दी", ["kn"] = "ಕನ್ನಡ", ["ta"] = "தமிழ்", ["te"] = "తెలుగు", ["mr"] = "मराठी",
        ["bn"] = "বাংলা", ["gu"] = "ગુજરાતી", ["ml"] = "മലയാളം", ["pa"] = "ਪੰਜਾਬੀ", ["or"] = "ଓଡ଼ିଆ", ["ur"] = "اردو"
    };

    public LanguageService(IConfiguration config, ILogger<LanguageService> log)
    {
        var s = config.GetSection("Languages");
        _trKey = Blank(s["TranslatorKey"]);
        _trRegion = Blank(s["TranslatorRegion"]);
        _trEndpoint = (Blank(s["TranslatorEndpoint"]) ?? "https://api.cognitive.microsofttranslator.com").TrimEnd('/');
        _spKey = Blank(s["SpeechKey"]);
        _spRegion = Blank(s["SpeechRegion"]);
        _locales = (Blank(s["SpeechLocales"]) ?? "en-IN,hi-IN").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        _log = log;
    }

    private static string? Blank(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    public bool TranslateOn => _trKey is not null;
    public bool TranscribeOn => _spKey is not null && _spRegion is not null;

    /// <summary>The text in language <paramref name="to"/>, and the language it was written in. Null when it failed.</summary>
    public async Task<(string Text, string? From)?> TranslateAsync(string text, string to, CancellationToken ct = default)
    {
        if (!TranslateOn || !Languages.ContainsKey(to)) return null;
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_trEndpoint}/translate?api-version=3.0&to={Uri.EscapeDataString(to)}");
        req.Headers.Add("Ocp-Apim-Subscription-Key", _trKey);
        if (_trRegion is not null) req.Headers.Add("Ocp-Apim-Subscription-Region", _trRegion);
        req.Content = new StringContent(JsonSerializer.Serialize(new[] { new { Text = text } }), Encoding.UTF8, "application/json");
        try
        {
            using var res = await Http.SendAsync(req, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode) { _log.LogWarning("Translator answered {Status}: {Body}", (int)res.StatusCode, body.Length > 300 ? body[..300] : body); return null; }
            using var doc = JsonDocument.Parse(body);
            var first = doc.RootElement[0];
            var outText = first.GetProperty("translations")[0].GetProperty("text").GetString() ?? "";
            string? from = first.TryGetProperty("detectedLanguage", out var dl) && dl.TryGetProperty("language", out var l) ? l.GetString() : null;
            return (outText, from);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException or InvalidOperationException)
        {
            _log.LogWarning(ex, "Translation failed.");
            return null;
        }
    }

    /// <summary>The words spoken in an audio file (WAV, MP3, OGG/Opus, WebM, M4A, AMR …). Null when it failed.</summary>
    public async Task<string?> TranscribeAsync(Stream audio, string fileName, string contentType, CancellationToken ct = default)
    {
        if (!TranscribeOn) return null;
        var url = $"https://{_spRegion}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        req.Headers.Add("Ocp-Apim-Subscription-Key", _spKey);
        using var form = new MultipartFormDataContent();
        var file = new StreamContent(audio);
        file.Headers.ContentType = MediaTypeHeaderValue.TryParse(contentType, out var ctype) ? ctype : new MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "audio", fileName);
        form.Add(new StringContent(JsonSerializer.Serialize(new { locales = _locales }), Encoding.UTF8, "application/json"), "definition");
        req.Content = form;
        try
        {
            using var res = await Http.SendAsync(req, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode) { _log.LogWarning("Speech answered {Status}: {Body}", (int)res.StatusCode, body.Length > 300 ? body[..300] : body); return null; }
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("combinedPhrases", out var phrases)) return "";
            return string.Join("\n", phrases.EnumerateArray().Select(p => p.TryGetProperty("text", out var t) ? t.GetString() : null).Where(t => !string.IsNullOrWhiteSpace(t))).Trim();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException)
        {
            _log.LogWarning(ex, "Transcription failed.");
            return null;
        }
    }
}
