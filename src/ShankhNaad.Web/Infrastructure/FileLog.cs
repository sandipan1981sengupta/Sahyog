using System.Collections.Concurrent;
using System.Text;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// A small, always-on log file: everything ShankhNaad itself writes (Information and up) — emails sent or failed,
/// "Forgot password" results, errors — goes to App_Data/logs/app-yyyyMMdd.log. It works on any server, with no
/// web.config switch (the IIS stdout log can be off, buffered or overwritten). Files older than 14 days are deleted.
/// </summary>
public sealed class FileLogProvider : ILoggerProvider
{
    private readonly string _dir;
    private readonly BlockingCollection<string> _queue = new(10_000);
    private readonly Thread _writer;

    public FileLogProvider(string contentRoot)
    {
        _dir = Path.Combine(contentRoot, "App_Data", "logs");
        try { Directory.CreateDirectory(_dir); } catch { /* can't write: lines are dropped */ }
        _writer = new Thread(WriteLoop) { IsBackground = true, Name = "ShankhNaad file log" };
        _writer.Start();
    }

    public ILogger CreateLogger(string category) => new FileLogger(category, this);

    internal void Add(string line) => _queue.TryAdd(line);

    private void WriteLoop()
    {
        var lastCleanup = DateTime.MinValue;
        foreach (var line in _queue.GetConsumingEnumerable())
        {
            try
            {
                var sb = new StringBuilder(line);
                while (_queue.TryTake(out var more)) sb.Append(more);
                File.AppendAllText(Path.Combine(_dir, $"app-{DateTime.UtcNow:yyyyMMdd}.log"), sb.ToString());
                if (DateTime.UtcNow - lastCleanup > TimeSpan.FromHours(6))
                {
                    lastCleanup = DateTime.UtcNow;
                    foreach (var f in Directory.GetFiles(_dir, "app-*.log"))
                        if (File.GetLastWriteTimeUtc(f) < DateTime.UtcNow.AddDays(-14)) File.Delete(f);
                }
            }
            catch { /* never let logging break the app */ }
        }
    }

    public void Dispose() { _queue.CompleteAdding(); _writer.Join(TimeSpan.FromSeconds(2)); }

    private sealed class FileLogger(string category, FileLogProvider owner) : ILogger
    {
        // ShankhNaad's own lines, plus anything from elsewhere that is a warning or worse
        private bool Ours => category.StartsWith("ShankhNaad", StringComparison.Ordinal);

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => level != LogLevel.None && (Ours ? level >= LogLevel.Information : level >= LogLevel.Warning);

        public void Log<TState>(LogLevel level, EventId id, TState state, Exception? ex, Func<TState, Exception?, string> format)
        {
            if (!IsEnabled(level)) return;
            var tag = level switch { LogLevel.Information => "info", LogLevel.Warning => "WARN", LogLevel.Error => "FAIL", LogLevel.Critical => "CRIT", _ => level.ToString() };
            var text = $"{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC  {tag}  {category}{Environment.NewLine}    {format(state, ex)}{Environment.NewLine}";
            if (ex is not null) text += "    " + ex.ToString().Replace(Environment.NewLine, Environment.NewLine + "    ") + Environment.NewLine;
            owner.Add(text);
        }
    }
}
