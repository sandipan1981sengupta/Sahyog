using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace Sahyog.ServiceLibrary.Video;

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
/// The app talks only to this interface. JaaS today; a LiveKit implementation can be added for
/// 500-person clients later, selected per plan, without changing controllers or views.
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
        ?? throw new NotSupportedException($"Video provider '{providerName}' is not installed. Set the plan's provider to JaaS.");
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

    public JaasVideoProvider(IOptions<JaasOptions> options, IHostEnvironment env)
    {
        _o = options.Value;
        _rsa = new Lazy<RSA>(() =>
        {
            var path = Path.IsPathRooted(_o.PrivateKeyPath) ? _o.PrivateKeyPath : Path.Combine(env.ContentRootPath, _o.PrivateKeyPath);
            var rsa = RSA.Create();
            rsa.ImportFromPem(File.ReadAllText(path));
            return rsa;
        });
    }

    public string Name => "JaaS";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_o.AppId) && !string.IsNullOrWhiteSpace(_o.ApiKeyId) && !string.IsNullOrWhiteSpace(_o.PrivateKeyPath);

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
                    ["recording"] = r.RecordingAllowed && r.IsModerator ? "true" : "false",
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
