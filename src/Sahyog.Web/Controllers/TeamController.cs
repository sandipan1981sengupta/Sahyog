using Microsoft.AspNetCore.Authorization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary;
using Sahyog.Web.Infrastructure;
using Sahyog.Web.Models;

namespace Sahyog.Web.Controllers;

/// <summary>
/// Team page. Everyone in the workspace can see who's in it; only workspace admins can
/// add, edit, remove or restore people (within the plan's user limit).
/// </summary>
[Authorize(Roles = AppRoles.TenantAdmin + "," + AppRoles.Member), Route("team")]
public sealed class TeamController : Controller
{
    private readonly ITenantService _tenants;
    private readonly IUserService _users;
    private readonly PresenceTracker _presence;
    private readonly IAccountEmailService _mail;
    private readonly IEmailDomainCheck _emailCheck;
    private readonly AppOptions _app;

    public TeamController(ITenantService tenants, IUserService users, PresenceTracker presence,
        IAccountEmailService mail, IEmailDomainCheck emailCheck, IOptions<AppOptions> app)
    {
        _tenants = tenants;
        _users = users;
        _presence = presence;
        _mail = mail;
        _emailCheck = emailCheck;
        _app = app.Value;
    }

    /// <summary>Domains already used in this workspace (so "cloudwhel.info" is caught as a slip of "cloudwheel.info").</summary>
    private async Task<List<string>> KnownDomainsAsync() =>
        (await _users.ListByTenantAsync(TenantId))
            .Select(u => u.Email.Contains('@') ? u.Email[(u.Email.LastIndexOf('@') + 1)..] : "")
            .Where(d => d.Length > 0).Distinct().ToList();

    /// <summary>Live check while typing an email in Add / Edit: can that domain receive mail, and is it a likely typo?</summary>
    [HttpGet("check-email")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> CheckEmail(string email, CancellationToken ct)
    {
        var r = await _emailCheck.CheckAsync(email ?? "", await KnownDomainsAsync(), ct);
        return Json(new { status = r.Status.ToString().ToLowerInvariant(), domain = r.Domain, suggestion = r.Suggestion, message = r.Message });
    }

    /// <summary>How long links emailed from the Team page work.</summary>
    private const int WelcomeLinkDays = 7;
    private const int SetPasswordLinkDays = 3;

    /// <summary>
    /// Creates a one-time link for a person and emails it (welcome or set-password).
    /// Returns null when it was sent, otherwise the reason it wasn't.
    /// </summary>
    private async Task<string?> EmailPasswordLinkAsync(string email, bool welcome)
    {
        if (!_mail.CanSend) return "Email isn't set up on this server yet.";
        var person = await _users.FindByEmailAsync(email);
        if (person is null || person.TenantId != TenantId) return "That person wasn't found.";
        if (!person.IsActive) return "They're inactive. Activate them first.";

        var days = welcome ? WelcomeLinkDays : SetPasswordLinkDays;
        var (token, error) = await _users.CreatePasswordLinkAsync(person.UserId,
            welcome ? PasswordLinkPurpose.Welcome : PasswordLinkPurpose.Reset, TimeSpan.FromDays(days));
        if (token is null) return error;

        var url = PasswordLinks.Url(_app, Request, token);
        var sent = welcome
            ? await _mail.SendWelcomeAsync(person.Email, person.DisplayName, person.TenantSlug ?? "", person.TenantName ?? "",
                User.DisplayName(), url, days)
            : await _mail.SendPasswordResetAsync(person.Email, person.DisplayName, person.TenantSlug, url, $"{days} days");
        return sent ? null : "The mail server didn't accept the email. Check the Smtp settings and the app's log.";
    }

    private Guid TenantId => User.TenantId()!.Value;

    [HttpGet("")]
    public async Task<IActionResult> Index() => View(await BuildAsync(new AddMemberInput()));

    [HttpPost("")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> Add([Bind(Prefix = "NewMember")] AddMemberInput input)
    {
        // invite by email: they choose their own password, so nobody else ever knows it
        var invite = input.SendInvite && _mail.CanSend;
        if (!invite && string.IsNullOrWhiteSpace(input.TemporaryPassword))
            ModelState.AddModelError("NewMember.TemporaryPassword", "Enter a temporary password (at least 8 characters), or turn on the email invite.");
        if (!ModelState.IsValid)
            return View(nameof(Index), await BuildAsync(input, error: "Please fix the highlighted fields."));

        // stop invites to addresses that can never receive mail (gmial.com, a missing ".com", …)
        var check = await _emailCheck.CheckAsync(input.Email, await KnownDomainsAsync());
        if (check.Status is EmailDomainStatus.NoMail or EmailDomainStatus.Invalid)
        {
            ModelState.AddModelError("NewMember.Email", check.Message!);
            return View(nameof(Index), await BuildAsync(input, error: check.Message));
        }

        var result = await _users.CreateAsync(new CreateUserRequest
        {
            TenantId = TenantId,
            DisplayName = input.DisplayName,
            Email = input.Email,
            // with an invite, the account gets a long random password nobody knows until they set their own
            Password = invite ? Convert.ToBase64String(RandomNumberGenerator.GetBytes(36)) : input.TemporaryPassword!,
            Role = input.MakeAdmin ? AppRoles.TenantAdmin : AppRoles.Member
        });
        if (!result.Succeeded)
            return View(nameof(Index), await BuildAsync(input, error: result.Error));

        if (!invite)
        {
            TempData["Message"] = $"{input.DisplayName} added. Share their email and the temporary password with them privately.";
            return RedirectToAction(nameof(Index));
        }

        var problem = await EmailPasswordLinkAsync(input.Email, welcome: true);
        if (problem is null)
            TempData["Message"] = $"{input.DisplayName} added. We emailed {input.Email.Trim()} a link to set their password (it works for {WelcomeLinkDays} days).";
        else
            TempData["Error"] = $"{input.DisplayName} was added, but the welcome email wasn't sent: {problem} Select them and use Edit → \"Email a set-password link\" to try again.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Edit a person: name, email, admin role and (optionally) a new temporary password.</summary>
    [HttpPost("{id:guid}/edit")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> Edit(Guid id, string displayName, string email, bool makeAdmin, string? newPassword)
    {
        var self = id == User.UserGuid();
        var before = (await _users.ListByTenantAsync(TenantId)).FirstOrDefault(u => u.UserId == id);
        if (before is not null && !string.Equals(before.Email, (email ?? "").Trim(), StringComparison.OrdinalIgnoreCase))
        {
            var check = await _emailCheck.CheckAsync(email ?? "", await KnownDomainsAsync());
            if (check.Status is EmailDomainStatus.NoMail or EmailDomainStatus.Invalid)
            {
                TempData["Error"] = check.Message + " Nothing was changed.";
                return RedirectToAction(nameof(Index));
            }
        }
        var update = await _users.UpdateAsync(new UpdateUserRequest
        {
            TenantId = TenantId,
            UserId = id,
            DisplayName = displayName ?? "",
            Email = email ?? "",
            // you can't take away your own admin role (you'd lose this page)
            Role = self || makeAdmin ? AppRoles.TenantAdmin : AppRoles.Member,
            NewPassword = newPassword
        });

        if (!update.Result.Succeeded)
        {
            TempData["Error"] = update.Result.Error;
            return RedirectToAction(nameof(Index));
        }

        var name = (displayName ?? "").Trim();
        if (self)
        {
            if (update.NewStamp is Guid stamp)
                await CookieAuth.RefreshSelfAsync(HttpContext, name, (email ?? "").Trim().ToLowerInvariant(), stamp);
            TempData["Message"] = string.IsNullOrWhiteSpace(newPassword)
                ? "Your details are saved."
                : "Your details and new password are saved. Use the new password next time you sign in.";
        }
        else
        {
            TempData["Message"] = string.IsNullOrWhiteSpace(newPassword)
                ? $"{name} is saved. If you corrected the email, any link sent to the old address no longer works: use Edit → \"Email a set-password link\" to send a new one."
                : $"{name} is saved with a new temporary password. Share it with them privately; they're signed out until they use it.";
        }
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Emails someone a one-time link to choose a new password (Team → Edit). Their current password keeps working until they use it.</summary>
    /// <summary>
    /// invite = true ("Resend invite"): someone who has never signed in gets a fresh welcome email (7 days).
    /// Otherwise a set-password link (3 days). Each new link cancels the earlier ones.
    /// </summary>
    [HttpPost("{id:guid}/send-link")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> SendLink(Guid id, bool invite = false)
    {
        var person = (await _users.ListByTenantAsync(TenantId)).FirstOrDefault(u => u.Id == id.ToString());
        if (person is null) return NotFound();
        var welcome = invite && person.HasSignedIn != true;
        var problem = await EmailPasswordLinkAsync(person.Email, welcome);
        if (problem is not null)
            TempData["Error"] = $"The {(welcome ? "invite" : "link")} wasn't sent: {problem}";
        else if (welcome)
            TempData["Message"] = $"We sent {person.DisplayName} a new invite at {person.Email} (it works for {WelcomeLinkDays} days). Any earlier invite link no longer works.";
        else
            TempData["Message"] = $"We emailed {person.Email} a link to set a new password (it works for {SetPasswordLinkDays} days). Their current password keeps working until they use it.";
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("{id:guid}/deactivate")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> Deactivate(Guid id)
    {
        if (id == User.UserGuid()) return BadRequest();
        if (await _users.SetActiveAsync(TenantId, id, false) == SetUserActiveStatus.NotFound) return NotFound();
        TempData["Message"] = "Done. They're now inactive: signed out, and they can't sign in until you activate them. Their messages stay.";
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("{id:guid}/activate")]
    [Authorize(Roles = AppRoles.TenantAdmin)]
    public async Task<IActionResult> Activate(Guid id)
    {
        var status = await _users.SetActiveAsync(TenantId, id, true);
        if (status == SetUserActiveStatus.NotFound) return NotFound();
        if (status == SetUserActiveStatus.LimitReached) TempData["Error"] = "Your plan's user limit is reached. Make someone inactive or upgrade the plan.";
        else TempData["Message"] = "Done. They're active again and can sign in with their current password.";
        return RedirectToAction(nameof(Index));
    }

    private async Task<TeamViewModel> BuildAsync(AddMemberInput form, string? error = null)
    {
        var limits = (await _tenants.GetLimitsAsync(TenantId))!;
        var online = _presence.OnlineUsers(TenantId);
        var all = await _users.ListByTenantAsync(TenantId);

        var me = User.UserId();
        // invited but never signed in (needs 13_InvitePending.sql; before that nobody shows as pending)
        PersonVm ToVm(UserDto u) => new(u.Id, u.DisplayName, u.Initials, u.AvatarTone, online.Contains(u.Id),
            u.Role == AppRoles.TenantAdmin ? "Admin" : "Member",
            Pending: u.IsActive && u.HasSignedIn == false && u.Id != me && !online.Contains(u.Id));

        return new TeamViewModel
        {
            Limits = limits,
            ActiveUsers = all.Count(u => u.IsActive),
            People = all.Where(u => u.IsActive).Select(ToVm).ToList(),
            // removed people are only listed for admins (they're the ones who can restore them)
            Inactive = User.IsInRole(AppRoles.TenantAdmin) ? all.Where(u => !u.IsActive).Select(ToVm).ToList() : new(),
            NewMember = form,
            Emails = all.ToDictionary(u => u.Id, u => u.Email),
            Message = TempData["Message"] as string,
            Error = error ?? TempData["Error"] as string,
            CanEmail = _mail.CanSend
        };
    }
}
