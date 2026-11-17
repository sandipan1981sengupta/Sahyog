using ShankhNaad.ServiceLibrary;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>Builds the address of the "Set your password" page for an emailed link.</summary>
public static class PasswordLinks
{
    /// <summary>Uses App:PublicBaseUrl (the address people use), or this request's address when it isn't set.</summary>
    public static string Url(AppOptions app, HttpRequest request, string token)
    {
        var baseUrl = string.IsNullOrWhiteSpace(app.PublicBaseUrl)
            ? $"{request.Scheme}://{request.Host}"
            : app.PublicBaseUrl.TrimEnd('/');
        return $"{baseUrl}/account/set-password?token={Uri.EscapeDataString(token)}";
    }
}
