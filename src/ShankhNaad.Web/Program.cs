using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using ShankhNaad.ServiceLibrary;
using ShankhNaad.Web.Hubs;
using ShankhNaad.Web.Infrastructure;

var builder = WebApplication.CreateBuilder(args);
// always-on log file: App_Data/logs/app-yyyyMMdd.log (emails sent/failed, Forgot password, errors)
builder.Logging.AddProvider(new ShankhNaad.Web.Infrastructure.FileLogProvider(builder.Environment.ContentRootPath));
var config = builder.Configuration;

// ---------- All business functions (stored procedure calls, meetings, email, files, video) ----------
builder.Services.AddShankhNaadServices(config);

// ---------- Login: cookie; people are in sahyog_Users ----------
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.LoginPath = "/account/login";
        o.LogoutPath = "/account/logout";
        o.AccessDeniedPath = "/account/denied";
        o.Cookie.Name = "sahyog.auth";
        o.Cookie.HttpOnly = true;
        o.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.ExpireTimeSpan = TimeSpan.FromDays(14);
        o.SlidingExpiration = true;
        o.Events.OnValidatePrincipal = CookieAuth.ValidatePrincipalAsync;
    });
builder.Services.AddAuthorization();

// On IIS, keep the cookie-encryption keys in a fixed folder so users stay signed in after app pool recycles.
var keysPath = config["App:DataProtectionKeysPath"];
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("Sahyog");   // keep "Sahyog": changing it would sign everyone out and break saved keys
if (!string.IsNullOrWhiteSpace(keysPath))
    dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keysPath));

builder.Services.AddControllersWithViews(o => o.Filters.Add(new AutoValidateAntiforgeryTokenAttribute()));
builder.Services.AddSignalR(o => o.MaximumReceiveMessageSize = 64 * 1024);

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/error");
    app.UseHsts();
}

app.UseHttpsRedirection();
// Static files. ".webmanifest" is listed explicitly so the desktop-app manifest is always served.
var contentTypes = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
contentTypes.Mappings[".webmanifest"] = "application/manifest+json";
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = contentTypes });
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat");

// Start the web server first, so the browser opens even if the database is slow or unreachable.
await app.StartAsync();
app.Logger.LogInformation("ShankhNaad is running. Checking the database…");
await DatabaseSeeder.InitializeAsync(app.Services, app.Configuration, app.Logger);
await app.WaitForShutdownAsync();
