using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace ShankhNaad.ServiceLibrary.Video;

public sealed record VideoJoinRequest(
    string RoomName,
    string UserId,
    string DisplayName,
    string? Email,
    bool IsModerator,
    bool RecordingAllowed);

/// <summary>Everything the browser needs to join: which script to load, which room, and a signed token.</summary>
public sealed record VideoJoinInfo(
    string Provider,
    string Domain,
    string ScriptUrl,
    string RoomName,
    string Token);

/// <summary>
/// The app talks only to this interface, and each plan picks one by name (Admin › Plans › Video):
/// "JaaS" (8x8's hosted Jitsi) or "Jitsi" (your own Jitsi Meet server). A LiveKit implementation can be
/// added later the same way, without changing controllers or views.
/// </summary>
public interface IVideoProvider
{
    string Name { get; }
    bool IsConfigured { get; }
    VideoJoinInfo CreateJoin(VideoJoinRequest request);
}

public interface IVideoProviderFactory
{
    IVideoProvider Get(string providerName);
}

public sealed class VideoProviderFactory : IVideoProviderFactory
{
    private readonly IEnumerable<IVideoProvider> _providers;

    public VideoProviderFactory(IEnumerable<IVideoProvider> providers) => _providers = providers;

    public IVideoProvider Get(string providerName) =>
        _providers.FirstOrDefault(p => string.Equals(p.Name, providerName, StringComparison.OrdinalIgnoreCase))
        ?? throw new NotSupportedException($"Video provider '{providerName}' is not installed. Set the plan's provider to JaaS or Jitsi.");
}

/// <summary>
/// App-wide video feature switches.
/// Recording is OFF for now: there is no Record button yet, and JaaS charges per recorded minute
/// and keeps recordings for only 24 hours. While false, no meeting pass allows recording and the
/// super admin cannot switch it on for any plan. Set to true when the record-and-save flow is built.
/// </summary>
public static class VideoFeatures
{
    public static readonly bool RecordingAvailable = false;
}

public sealed class JaasOptions
{
    /// <summary>"vpaas-magic-cookie-…" from the JaaS console.</summary>
    public string AppId { get; set; } = "";

    /// <summary>Full key id shown in the JaaS console API Keys page, e.g. "vpaas-magic-cookie-…/a1b2c3".</summary>
    public string ApiKeyId { get; set; } = "";

    /// <summary>Path to the private key (.pk / .pem) downloaded when you created the API key. Keep it outside wwwroot.</summary>
    public string PrivateKeyPath { get; set; } = "";

    public string Domain { get; set; } = "8x8.vc";
    public int TokenLifetimeMinutes { get; set; } = 180;
}

/// <summary>8x8 Jitsi as a Service. Signs the RS256 JWT JaaS expects, using only built-in .NET crypto.</summary>
public sealed class JaasVideoProvider : IVideoProvider, IDisposable
{
    private readonly JaasOptions _o;
    private readonly Lazy<RSA> _rsa;
    private readonly string _keyFile;

    public JaasVideoProvider(IOptions<JaasOptions> options, IHostEnvironment env)
    {
        _o = options.Value;
        _keyFile = string.IsNullOrWhiteSpace(_o.PrivateKeyPath) ? ""
            : Path.IsPathRooted(_o.PrivateKeyPath) ? _o.PrivateKeyPath : Path.Combine(env.ContentRootPath, _o.PrivateKeyPath);
        _rsa = new Lazy<RSA>(() =>
        {
            var path = _keyFile;
            var rsa = RSA.Create();
            rsa.ImportFromPem(File.ReadAllText(path));
            return rsa;
        });
    }

    public string Name => "JaaS";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_o.AppId) && !string.IsNullOrWhiteSpace(_o.ApiKeyId) && !string.IsNullOrWhiteSpace(_o.PrivateKeyPath)
        && File.Exists(_keyFile);   // the key file missing on the server shows "video isn't set up" instead of an error page

    public VideoJoinInfo CreateJoin(VideoJoinRequest r)
    {
        if (!IsConfigured)
            throw new InvalidOperationException("JaaS is not configured. Fill in Jaas:AppId, Jaas:ApiKeyId and Jaas:PrivateKeyPath.");

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        var header = new Dictionary<string, object>
        {
            ["alg"] = "RS256",
            ["kid"] = _o.ApiKeyId,
            ["typ"] = "JWT"
        };

        var payload = new Dictionary<string, object>
        {
            ["aud"] = "jitsi",
            ["iss"] = "chat",
            ["sub"] = _o.AppId,
            ["room"] = r.RoomName,          // token works for this room only
            ["iat"] = now,
            ["nbf"] = now - 10,
            ["exp"] = now + _o.TokenLifetimeMinutes * 60L,
            ["context"] = new Dictionary<string, object>
            {
                ["user"] = new Dictionary<string, object>
                {
                    ["id"] = r.UserId,
                    ["name"] = r.DisplayName,
                    ["email"] = r.Email ?? "",
                    ["avatar"] = "",
                    ["moderator"] = r.IsModerator ? "true" : "false",
                    ["hidden-from-recorder"] = "false"
                },
                ["features"] = new Dictionary<string, object>
                {
                    ["livestreaming"] = "false",
                    ["recording"] = VideoFeatures.RecordingAvailable && r.RecordingAllowed && r.IsModerator ? "true" : "false",
                    ["transcription"] = "false",
                    ["outbound-call"] = "false",
                    ["sip-outbound-call"] = "false"
                }
            }
        };

        var unsigned = $"{B64Url(JsonSerializer.SerializeToUtf8Bytes(header))}.{B64Url(JsonSerializer.SerializeToUtf8Bytes(payload))}";
        var signature = _rsa.Value.SignData(Encoding.ASCII.GetBytes(unsigned), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var token = $"{unsigned}.{B64Url(signature)}";

        return new VideoJoinInfo(
            Provider: Name,
            Domain: _o.Domain,
            ScriptUrl: $"https://{_o.Domain}/{_o.AppId}/external_api.js",
            RoomName: $"{_o.AppId}/{r.RoomName}",
            Token: token);
    }

    private static string B64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public void Dispose()
    {
        if (_rsa.IsValueCreated) _rsa.Value.Dispose();
    }
}

/// <summary>Settings for your own Jitsi Meet server (appsettings.json, section "Jitsi").</summary>
public sealed class JitsiOptions
{
    /// <summary>The server's public address, without https://, e.g. "meet.yourcompany.com".</summary>
    public string Domain { get; set; } = "";

    /// <summary>The app id set when the server was installed with token sign-in (jitsi-meet-tokens), e.g. "shankhnaad".</summary>
    public string AppId { get; set; } = "";

    /// <summary>The app secret set with it. Keep it only in appsettings.json on the server, never in the browser.</summary>
    public string AppSecret { get; set; } = "";

    /// <summary>The server's XMPP domain. On a standard Ubuntu install it is the same as Domain; leave empty for that.</summary>
    public string XmppDomain { get; set; } = "";

    public int TokenLifetimeMinutes { get; set; } = 180;
}

/// <summary>
/// Your own Jitsi Meet server (free, open source). The browser side is the same Jitsi meeting code as JaaS,
/// so the room, its controls, chat and themes work unchanged; only the address and the token differ.
/// The server checks the token with the shared app secret (HS256), so nobody can join a room
/// without signing in to ShankhNaad first.
/// </summary>
public sealed class SelfHostedJitsiVideoProvider : IVideoProvider
{
    private readonly JitsiOptions _o;

    public SelfHostedJitsiVideoProvider(IOptions<JitsiOptions> options) => _o = options.Value;

    public string Name => "Jitsi";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_o.Domain) && !string.IsNullOrWhiteSpace(_o.AppId) && !string.IsNullOrWhiteSpace(_o.AppSecret);

    public VideoJoinInfo CreateJoin(VideoJoinRequest r)
    {
        if (!IsConfigured)
            throw new InvalidOperationException("Your Jitsi server is not configured. Fill in Jitsi:Domain, Jitsi:AppId and Jitsi:AppSecret.");

        var domain = _o.Domain.Trim().Replace("https://", "").Replace("http://", "").TrimEnd('/');
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        var header = new Dictionary<string, object> { ["alg"] = "HS256", ["typ"] = "JWT" };
        var payload = new Dictionary<string, object>
        {
            ["aud"] = _o.AppId,
            ["iss"] = _o.AppId,
            ["sub"] = string.IsNullOrWhiteSpace(_o.XmppDomain) ? domain : _o.XmppDomain.Trim(),
            ["room"] = r.RoomName,          // token works for this room only
            ["iat"] = now,
            ["nbf"] = now - 10,
            ["exp"] = now + _o.TokenLifetimeMinutes * 60L,
            ["context"] = new Dictionary<string, object>
            {
                ["user"] = new Dictionary<string, object>
                {
                    ["id"] = r.UserId,
                    ["name"] = r.DisplayName,
                    ["email"] = r.Email ?? "",
                    ["avatar"] = "",
                    ["moderator"] = r.IsModerator ? "true" : "false"
                }
            }
        };

        var unsigned = $"{B64Url(JsonSerializer.SerializeToUtf8Bytes(header))}.{B64Url(JsonSerializer.SerializeToUtf8Bytes(payload))}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_o.AppSecret));
        var token = $"{unsigned}.{B64Url(hmac.ComputeHash(Encoding.ASCII.GetBytes(unsigned)))}";

        return new VideoJoinInfo(
            Provider: Name,
            Domain: domain,
            ScriptUrl: $"https://{domain}/external_api.js",
            RoomName: r.RoomName,
            Token: token);
    }

    private static string B64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
