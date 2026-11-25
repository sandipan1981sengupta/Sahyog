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
// CSS / JS bundles for the layouts (Infrastructure/AssetBundles.cs), served at /bundles/…
builder.Services.AddSingleton<AssetBundles>();
// our .js / .css / .svg: minified safely and compressed once at the best level, kept in memory (Infrastructure/OptimizedAssets.cs)
builder.Services.AddSingleton<OptimizedAssets>();
builder.Services.AddSingleton<ShankhNaad.Web.Infrastructure.ReverseGeocoder>();   // team location: map position → place name

// Compress CSS / JS / SVG (about 1.6 MB → about 300 KB per first visit). HTML pages are deliberately NOT
// compressed: they carry the anti-forgery token, and compressing secrets over HTTPS opens the BREACH attack.
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProvider>();
    o.Providers.Add<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProvider>();
    o.MimeTypes = new[] { "text/css", "application/javascript", "text/javascript", "image/svg+xml", "application/manifest+json" };
});
builder.Services.Configure<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Fastest);
builder.Services.Configure<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProviderOptions>(o => o.Level = System.IO.Compression.CompressionLevel.Fastest);

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
// Partial page loads (wwwroot/js/sn-nav.js) send "X-SN-Nav: 1". For those requests a redirect is
// answered as "200 + X-SN-Redirect: <address>" instead of 302, so the page script decides where to go:
// another workspace page → loaded partially; anything else (sign-in, meeting room) → a normal page load.
// (Without this the browser would follow the redirect itself and the target page would be requested twice.)
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Headers.ContainsKey("X-SN-Nav"))
    {
        ctx.Response.OnStarting(() =>
        {
            var status = ctx.Response.StatusCode;
            if (status is 301 or 302 or 303 or 307 or 308)
            {
                var location = ctx.Response.Headers.Location.ToString();
                ctx.Response.StatusCode = StatusCodes.Status200OK;
                ctx.Response.Headers.Remove("Location");
                ctx.Response.Headers["X-SN-Redirect"] = location;
            }
            ctx.Response.Headers["Cache-Control"] = "no-store";
            return Task.CompletedTask;
        });
    }
    await next();
});
// .js / .css / .svg from wwwroot: answered ready-made (minified once, Brotli / gzip once); before the compression
// below, which still handles everything else it compresses (the app manifest)
app.Use(OptimizedAssets.Middleware(app.Services.GetRequiredService<OptimizedAssets>(), contentTypes));
app.UseResponseCompression();
// Browser caching. Before this, CSS/JS/fonts were sent with no caching rule, so Safari asked the server
// again for ~40 files on every page change (Chrome/Edge hid this by fetching pages in advance).
//   - files with ?v=… (asp-append-version) change their URL whenever they change → keep for a year
//   - other files (jQuery, icons, fonts, images) → keep for a day
//   - the service worker and the app manifest → always check for a new version
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = contentTypes,
    OnPrepareResponse = ctx =>
    {
        var path = ctx.Context.Request.Path.Value ?? "";
        var headers = ctx.Context.Response.Headers;
        if (path.EndsWith("service-worker.js", StringComparison.OrdinalIgnoreCase) ||
            path.EndsWith(".webmanifest", StringComparison.OrdinalIgnoreCase))
            headers.CacheControl = "no-cache";
        else if (ctx.Context.Request.Query.ContainsKey("v"))
            headers.CacheControl = "public, max-age=31536000, immutable";
        else
            headers.CacheControl = "public, max-age=86400";
    }
});
app.UseRouting();

// The bundles: /bundles/layout.css?v=<hash> and so on. The hash changes with the content,
// so a matching ?v= is cached for a year; anything else is checked again each time.
app.MapGet("/bundles/{name}", async (string name, HttpContext ctx, AssetBundles bundles) =>
{
    if (!AssetBundles.Definitions.ContainsKey(name)) { ctx.Response.StatusCode = StatusCodes.Status404NotFound; return; }
    var (_, hash) = bundles.Get(name);
    var packed = bundles.GetPacked(name);                   // minified + Brotli / gzip, made once per change
    await OptimizedAssets.SendAsync(ctx, packed, AssetBundles.ContentType(name),
        ctx.Request.Query["v"] == hash ? "public, max-age=31536000, immutable" : "no-cache");
}).AllowAnonymous();
// get the bundles ready (minify + compress) as the app starts, so the first visitor doesn't wait for it
_ = Task.Run(() =>
{
    var bundles = app.Services.GetRequiredService<AssetBundles>();
    foreach (var name in AssetBundles.Definitions.Keys) { try { bundles.Get(name); } catch { } }
});
app.UseAuthentication();
app.UseAuthorization();

// /health: a tiny page for a keep-awake pinger (e.g. UptimeRobot every 5 minutes) and for the desktop app's
// "Connecting…" screen. It also runs one tiny query, so the database connection stays warm too.
app.MapGet("/health", async (ShankhNaad.ServiceLibrary.Data.SqlDb db, HttpContext ctx) =>
{
    ctx.Response.Headers.CacheControl = "no-store";
    var watch = System.Diagnostics.Stopwatch.StartNew();
    try
    {
        await using var conn = await db.OpenAsync(ctx.RequestAborted);
        await using var cmd = new Microsoft.Data.SqlClient.SqlCommand("SELECT 1", conn);
        await cmd.ExecuteScalarAsync(ctx.RequestAborted);
        return Results.Text($"ok {watch.ElapsedMilliseconds} ms", "text/plain");
    }
    catch
    {
        return Results.Text("database not reachable", "text/plain", statusCode: StatusCodes.Status503ServiceUnavailable);
    }
}).AllowAnonymous();

app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat");

// Start the web server first, so the browser opens even if the database is slow or unreachable.
await app.StartAsync();
app.Logger.LogInformation("ShankhNaad is running. Checking the database…");
await DatabaseSeeder.InitializeAsync(app.Services, app.Configuration, app.Logger);
await app.WaitForShutdownAsync();
