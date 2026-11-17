using System.Net;

namespace Sahyog.ServiceLibrary;

/// <summary>
/// Emails about a person's account: the welcome email (with a "set your password" link) and
/// the password reset email. Both say only what the person needs, never a password.
/// </summary>
public interface IAccountEmailService
{
    /// <summary>False when Smtp:Host is empty (the app can't send email yet).</summary>
    bool CanSend { get; }
    Task<bool> SendWelcomeAsync(string toEmail, string personName, string workspaceSlug, string workspaceName, string invitedBy, string setPasswordUrl, int validDays);
    Task<bool> SendPasswordResetAsync(string toEmail, string personName, string? workspaceSlug, string setPasswordUrl, string validFor);
}

public sealed class AccountEmailService : IAccountEmailService
{
    private readonly IAppEmailSender _email;
    public AccountEmailService(IAppEmailSender email) => _email = email;

    public bool CanSend => _email.IsConfigured;

    private static string E(string? s) => WebUtility.HtmlEncode(s ?? "");

    /// <summary>The same card style as the meeting invite email.</summary>
    private static string Card(string eyebrow, string heading, string bodyHtml, string buttonText, string url, string footNote) => $"""
        <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:28px;border-radius:24px;background:#F8FAFC">
          <p style="margin:0 0 6px;color:#475569;font-size:13px">{eyebrow}</p>
          <h2 style="margin:0 0 14px;color:#0F172A">{heading}</h2>
          {bodyHtml}
          <a href="{url}" style="display:inline-block;margin:6px 0 4px;padding:14px 28px;border-radius:999px;background:linear-gradient(110deg,#2563EB,#DB2777);color:#fff;text-decoration:none;font-weight:600">{buttonText}</a>
          <p style="margin:14px 0 0;color:#64748B;font-size:12px;line-height:1.5">{footNote}<br>If the button doesn't work, copy this address into your browser:<br><span style="color:#2563EB;word-break:break-all">{E(url)}</span></p>
          <p style="margin:18px 0 0;color:#94A3B8;font-size:12px">ShankhNaad by CloudWheel Ltd</p>
        </div>
        """;

    public Task<bool> SendWelcomeAsync(string toEmail, string personName, string workspaceSlug, string workspaceName, string invitedBy, string setPasswordUrl, int validDays)
    {
        var body = $"""
            <p style="margin:0 0 12px;color:#334155;line-height:1.6">Hi {E(personName)}, {E(invitedBy)} added you to <b>{E(workspaceName)}</b> on ShankhNaad: chat, calls and video meetings for your team.</p>
            <p style="margin:0 0 6px;color:#334155">When you sign in, use:</p>
            <table style="margin:0 0 18px;color:#0F172A;font-size:14px;border-collapse:collapse">
              <tr><td style="padding:3px 14px 3px 0;color:#64748B">Workspace</td><td style="padding:3px 0"><b>{E(workspaceSlug)}</b></td></tr>
              <tr><td style="padding:3px 14px 3px 0;color:#64748B">Email</td><td style="padding:3px 0"><b>{E(toEmail)}</b></td></tr>
            </table>
            <p style="margin:0 0 14px;color:#334155">First, choose your own password:</p>
            """;
        var html = Card($"Welcome to {E(workspaceName)}", "You're invited to ShankhNaad", body, "Set my password", setPasswordUrl,
            $"This link works once and expires in {validDays} days. Didn't expect this email? You can ignore it.");
        return _email.SendAsync(new[] { toEmail }, $"You're invited to {workspaceName} on ShankhNaad", html);
    }

    public Task<bool> SendPasswordResetAsync(string toEmail, string personName, string? workspaceSlug, string setPasswordUrl, string validFor)
    {
        var workspaceLine = string.IsNullOrEmpty(workspaceSlug)
            ? ""
            : $"""<p style="margin:0 0 14px;color:#334155">Your workspace is <b>{E(workspaceSlug)}</b>.</p>""";
        var body = $"""
            <p style="margin:0 0 12px;color:#334155;line-height:1.6">Hi {E(personName)}, we got a request to set a new password for your ShankhNaad account ({E(toEmail)}).</p>
            {workspaceLine}
            """;
        var html = Card("ShankhNaad account", "Set a new password", body, "Choose a new password", setPasswordUrl,
            $"This link works once and expires in {validFor}. If you didn't ask for this, ignore this email: your password stays the same.");
        return _email.SendAsync(new[] { toEmail }, "Set a new password for ShankhNaad", html);
    }
}
