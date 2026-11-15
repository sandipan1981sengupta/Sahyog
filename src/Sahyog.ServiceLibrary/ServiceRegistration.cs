using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Sahyog.DtoLibrary;
using Sahyog.ServiceLibrary.Data;
using Sahyog.ServiceLibrary.Video;

namespace Sahyog.ServiceLibrary;

/// <summary>Settings from appsettings.json "App".</summary>
public sealed class AppOptions
{
    public string PublicBaseUrl { get; set; } = "";
    public string DefaultTimeZone { get; set; } = "Asia/Kolkata";
    public string DataProtectionKeysPath { get; set; } = "";
}

public static class ServiceRegistration
{
    /// <summary>Registers every Sahyog service. Call once from Program.cs: builder.Services.AddSahyogServices(builder.Configuration).</summary>
    public static IServiceCollection AddSahyogServices(this IServiceCollection services, IConfiguration config)
    {
        services.Configure<AppOptions>(config.GetSection("App"));
        services.Configure<StorageOptions>(config.GetSection("Storage"));
        services.Configure<JaasOptions>(config.GetSection("Jaas"));
        services.Configure<SmtpOptions>(config.GetSection("Smtp"));

        services.AddSingleton<SqlDb>();
        services.AddScoped<ITenantService, TenantService>();
        services.AddScoped<IUserService, UserService>();
        services.AddScoped<IChatService, ChatService>();
        services.AddScoped<IMeetingService, MeetingService>();
        services.AddScoped<IAppEmailSender, SmtpEmailSender>();

        services.AddSingleton<PresenceTracker>();
        services.AddSingleton<MeetingRoomTracker>();
        services.AddSingleton<IFileStorage, LocalFileStorage>();
        services.AddSingleton<IVideoProvider, JaasVideoProvider>();
        services.AddSingleton<IVideoProviderFactory, VideoProviderFactory>();
        return services;
    }
}

/// <summary>
/// On start-up: checks the SQL scripts have been run, then creates the CloudWheel super admin and
/// (for development) a demo "acme" workspace from configuration. Tables and procedures are created
/// by /database/01_Tables.sql and 02_StoredProcedures.sql, not here.
/// </summary>
public static class DatabaseSeeder
{
    public static async Task InitializeAsync(IServiceProvider services, IConfiguration config, ILogger logger)
    {
        using var scope = services.CreateScope();
        var tenants = scope.ServiceProvider.GetRequiredService<ITenantService>();
        var users = scope.ServiceProvider.GetRequiredService<IUserService>();

        List<PlanDto> plans;
        try
        {
            plans = await tenants.GetPlansAsync();
            logger.LogInformation("Database connected. {Count} plans found.", plans.Count);
        }
        catch (Exception ex) when (ex is SqlException || ex is AggregateException)
        {
            logger.LogError(ex, "Cannot use the Sahyog database (SQL error {Number}). Check the connection string, the SQL login, the Azure SQL firewall, " +
                "and that database/01_Tables.sql and 02_StoredProcedures.sql were run on that database.", (ex as SqlException)?.Number ?? (ex.InnerException as SqlException)?.Number);
            return;
        }

        var superEmail = config["Seed:SuperAdminEmail"];
        var superPassword = config["Seed:SuperAdminPassword"];
        if (!string.IsNullOrWhiteSpace(superEmail) && !string.IsNullOrWhiteSpace(superPassword))
        {
            var result = await users.CreateAsync(new CreateUserRequest
            {
                TenantId = null,
                DisplayName = "CloudWheel Admin",
                Email = superEmail,
                Password = superPassword,
                Role = AppRoles.SuperAdmin,
                EnforceLimit = false
            });
            if (result.Succeeded) logger.LogInformation("Super admin {Email} created.", superEmail);
            else logger.LogInformation("Super admin not created: {Error}", result.Error);
        }
        else
        {
            logger.LogWarning("Seed:SuperAdminEmail / Seed:SuperAdminPassword are empty. Open /setup in the browser to create the first admin.");
        }

        logger.LogInformation("Seed:CreateDemoTenant = {Value}", config.GetValue<bool>("Seed:CreateDemoTenant"));
        if (config.GetValue<bool>("Seed:CreateDemoTenant"))
        {
            var email = config["Seed:DemoTenantAdminEmail"];
            var password = config["Seed:DemoTenantAdminPassword"];
            var small = plans.FirstOrDefault(p => p.Name == "Small") ?? plans.FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(email) && !string.IsNullOrWhiteSpace(password) && small is not null
                && await tenants.GetBySlugAsync("acme") is null)
            {
                var result = await tenants.CreateAsync(new CreateTenantRequest
                {
                    Name = "Acme Corp",
                    Slug = "acme",
                    PlanId = small.PlanId,
                    AdminName = "Acme Admin",
                    AdminEmail = email,
                    AdminPassword = password
                });
                if (result.Succeeded) logger.LogInformation("Demo workspace 'acme' created. Sign in with {Email}.", email);
                else logger.LogWarning("Demo workspace not created: {Error}", result.Error);
            }
        }
    }
}
