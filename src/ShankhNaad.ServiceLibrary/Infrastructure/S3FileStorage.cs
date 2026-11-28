using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace ShankhNaad.ServiceLibrary;

/// <summary>
/// Uploaded files in an S3-style store (Storage:Kind = "S3"), so several web servers see the same files.
/// Same paths as LocalFileStorage ("tenant-…/yyyy/MM/name.ext"), so existing files can be copied over as they are
/// (e.g. "mc mirror App_Data/files minio/bucket" or "aws s3 sync").
/// Reading gives a seekable stream that fetches 1 MB pieces on demand, so videos can still be jumped through.
/// </summary>
public sealed class S3FileStorage : IFileStorage, IDisposable
{
    private readonly AmazonS3Client _s3;
    private readonly string _bucket;

    public S3FileStorage(IOptions<StorageOptions> options)
    {
        var o = options.Value.S3;
        if (string.IsNullOrWhiteSpace(o.Bucket) || string.IsNullOrWhiteSpace(o.AccessKey) || string.IsNullOrWhiteSpace(o.SecretKey))
            throw new InvalidOperationException("Storage:Kind is S3: fill in Storage:S3:Bucket, AccessKey and SecretKey.");
        var config = new AmazonS3Config { ForcePathStyle = o.ForcePathStyle, AuthenticationRegion = string.IsNullOrWhiteSpace(o.Region) ? "us-east-1" : o.Region };
        if (!string.IsNullOrWhiteSpace(o.ServiceUrl)) config.ServiceURL = o.ServiceUrl.Trim();
        else config.RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(config.AuthenticationRegion);
        _s3 = new AmazonS3Client(new BasicAWSCredentials(o.AccessKey, o.SecretKey), config);
        _bucket = o.Bucket.Trim();
    }

    public async Task<string> SaveAsync(Guid tenantId, Stream content, string extension, CancellationToken ct = default)
    {
        extension = LocalFileStorage.CleanExtension(extension);
        var now = DateTime.UtcNow;
        var key = $"tenant-{tenantId:N}/{now:yyyy}/{now:MM}/{Guid.NewGuid():N}{extension}";
        // the upload stream may not be seekable or have a length: copy it to a temporary file first (uploads are ≤ 200 MB)
        var temp = Path.GetTempFileName();
        try
        {
            await using (var file = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
                await content.CopyToAsync(file, ct);
            await _s3.PutObjectAsync(new PutObjectRequest { BucketName = _bucket, Key = key, FilePath = temp, UseChunkEncoding = false }, ct);
        }
        finally { try { File.Delete(temp); } catch { /* temp folder is cleaned by the system anyway */ } }
        return key;
    }

    public Stream OpenRead(string storagePath)
    {
        var key = CheckKey(storagePath);
        try
        {
            var head = _s3.GetObjectMetadataAsync(_bucket, key).GetAwaiter().GetResult();
            return new S3ReadStream(_s3, _bucket, key, head.ContentLength);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            throw new FileNotFoundException("Not in the file store.", storagePath);   // shows the normal "file not found" page
        }
    }

    public void Delete(string storagePath) =>
        _s3.DeleteObjectAsync(_bucket, CheckKey(storagePath)).GetAwaiter().GetResult();

    public void DeleteTenant(Guid tenantId)
    {
        var prefix = $"tenant-{tenantId:N}/";
        string? token = null;
        do
        {
            var page = _s3.ListObjectsV2Async(new ListObjectsV2Request { BucketName = _bucket, Prefix = prefix, ContinuationToken = token }).GetAwaiter().GetResult();
            var keys = (page.S3Objects ?? new List<S3Object>()).Select(o => new KeyVersion { Key = o.Key }).ToList();
            if (keys.Count > 0)
                _s3.DeleteObjectsAsync(new DeleteObjectsRequest { BucketName = _bucket, Objects = keys }).GetAwaiter().GetResult();
            token = page.IsTruncated == true ? page.NextContinuationToken : null;
        } while (token is not null);
    }

    private static string CheckKey(string storagePath)
    {
        var key = (storagePath ?? "").Replace('\\', '/').TrimStart('/');
        if (key.Length == 0 || key.Contains("..")) throw new InvalidOperationException("Invalid storage path.");
        return key;
    }

    public void Dispose() => _s3.Dispose();

    /// <summary>Read-only, seekable: fetches the object in 1 MB pieces as they are read (range requests).</summary>
    private sealed class S3ReadStream : Stream
    {
        private const int Piece = 1024 * 1024;
        private readonly AmazonS3Client _s3;
        private readonly string _bucket, _key;
        private readonly long _length;
        private long _pos;
        private byte[] _buf = Array.Empty<byte>();
        private long _bufStart = -1;

        public S3ReadStream(AmazonS3Client s3, string bucket, string key, long length) { _s3 = s3; _bucket = bucket; _key = key; _length = length; }

        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => _length;
        public override long Position { get => _pos; set => _pos = Math.Clamp(value, 0, _length); }

        public override int Read(byte[] buffer, int offset, int count) => ReadAsync(buffer, offset, count).GetAwaiter().GetResult();

        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct = default) =>
            await ReadAsync(buffer.AsMemory(offset, count), ct);

        public override async ValueTask<int> ReadAsync(Memory<byte> destination, CancellationToken ct = default)
        {
            if (_pos >= _length || destination.Length == 0) return 0;
            if (_bufStart < 0 || _pos < _bufStart || _pos >= _bufStart + _buf.Length)
            {
                var end = Math.Min(_length, _pos + Piece) - 1;
                using var r = await _s3.GetObjectAsync(new GetObjectRequest { BucketName = _bucket, Key = _key, ByteRange = new ByteRange(_pos, end) }, ct);
                var data = new byte[end - _pos + 1];
                var read = 0;
                while (read < data.Length)
                {
                    var n = await r.ResponseStream.ReadAsync(data.AsMemory(read), ct);
                    if (n == 0) break;
                    read += n;
                }
                _buf = read == data.Length ? data : data[..read];
                _bufStart = _pos;
                if (_buf.Length == 0) return 0;
            }
            var from = (int)(_pos - _bufStart);
            var take = Math.Min(destination.Length, _buf.Length - from);
            _buf.AsMemory(from, take).CopyTo(destination);
            _pos += take;
            return take;
        }

        public override long Seek(long offset, SeekOrigin origin) =>
            Position = origin switch { SeekOrigin.Begin => offset, SeekOrigin.Current => _pos + offset, _ => _length + offset };

        public override void Flush() { }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
