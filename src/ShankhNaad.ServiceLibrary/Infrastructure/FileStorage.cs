using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace ShankhNaad.ServiceLibrary;

public sealed class StorageOptions
{
    /// <summary>
    /// "Local" (default): files on this server's disk (RootPath), as always. Also right for several web servers that
    /// share one network folder (NFS / SMB) as RootPath.
    /// "S3": an S3-style store shared by every web server (MinIO on your own server, Cloudflare R2, AWS S3, Wasabi …); see S3.
    /// </summary>
    public string Kind { get; set; } = "Local";

    /// <summary>Absolute path, or relative to the app folder. On IIS use a folder outside the site, e.g. D:\SahyogData\files.</summary>
    public string RootPath { get; set; } = "App_Data/files";
    public int MaxUploadMb { get; set; } = 50;

    /// <summary>Only for Kind = "S3".</summary>
    public S3StorageOptions S3 { get; set; } = new();
}

public sealed class S3StorageOptions
{
    /// <summary>The store's address, e.g. "https://files.yourcompany.com" (MinIO) or "https://&lt;account&gt;.r2.cloudflarestorage.com". Empty = AWS itself.</summary>
    public string ServiceUrl { get; set; } = "";
    public string Bucket { get; set; } = "";
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    /// <summary>AWS region, e.g. "ap-south-1" (Mumbai). Most other stores accept "us-east-1" or "auto".</summary>
    public string Region { get; set; } = "us-east-1";
    /// <summary>true for MinIO and most self-hosted stores (bucket in the path, not in the host name).</summary>
    public bool ForcePathStyle { get; set; } = true;
}

/// <summary>Where uploaded files live. Swap LocalFileStorage for an R2 / Azure Blob version later without touching controllers.</summary>
public interface IFileStorage
{
    Task<string> SaveAsync(Guid tenantId, Stream content, string extension, CancellationToken ct = default);
    Stream OpenRead(string storagePath);
    void Delete(string storagePath);
    /// <summary>Removes every file a client uploaded (used when a client is deleted).</summary>
    void DeleteTenant(Guid tenantId);
}

public sealed class LocalFileStorage : IFileStorage
{
    private readonly string _root;

    public LocalFileStorage(IOptions<StorageOptions> options, IHostEnvironment env)
    {
        var configured = options.Value.RootPath;
        _root = Path.GetFullPath(Path.IsPathRooted(configured) ? configured : Path.Combine(env.ContentRootPath, configured));
        Directory.CreateDirectory(_root);
    }

    public async Task<string> SaveAsync(Guid tenantId, Stream content, string extension, CancellationToken ct = default)
    {
        extension = SanitizeExtension(extension);
        var now = DateTime.UtcNow;
        // One folder per tenant: easy quotas, backups and deleting a client's data.
        var relative = Path.Combine($"tenant-{tenantId:N}", now.ToString("yyyy"), now.ToString("MM"), $"{Guid.NewGuid():N}{extension}");
        var full = Resolve(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await using var file = new FileStream(full, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
        await content.CopyToAsync(file, ct);
        return relative.Replace('\\', '/');
    }

    public Stream OpenRead(string storagePath) =>
        new FileStream(Resolve(storagePath), FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);

    public void Delete(string storagePath)
    {
        var full = Resolve(storagePath);
        if (File.Exists(full)) File.Delete(full);
    }

    public void DeleteTenant(Guid tenantId)
    {
        var folder = Resolve($"tenant-{tenantId:N}");
        if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
    }

    private string Resolve(string relative)
    {
        var full = Path.GetFullPath(Path.Combine(_root, relative));
        if (!full.StartsWith(_root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Invalid storage path.");
        return full;
    }

    private static string SanitizeExtension(string extension) => CleanExtension(extension);

    /// <summary>".pdf", ".jpg" …: letters and digits only, at most 12 characters (also used by S3FileStorage).</summary>
    internal static string CleanExtension(string extension)
    {
        if (string.IsNullOrWhiteSpace(extension)) return "";
        var clean = new string(extension.Where(c => char.IsLetterOrDigit(c) || c == '.').ToArray()).ToLowerInvariant();
        if (!clean.StartsWith('.')) clean = "." + clean;
        return clean.Length > 12 ? "" : clean;
    }
}
