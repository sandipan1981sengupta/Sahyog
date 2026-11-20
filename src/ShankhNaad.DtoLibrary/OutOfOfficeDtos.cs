namespace ShankhNaad.DtoLibrary;

/// <summary>
/// Someone who is out of office: their note, from when (null = from when it was set) and until when
/// (exclusive; null = until they turn it off). StartUtc in the future means it is planned, not active yet.
/// </summary>
public sealed record OutOfOfficeDto(string? Message, DateTime? UntilUtc, DateTime SinceUtc, DateTime? StartUtc = null);

public enum OooSaveStatus { Saved = 0, NeedsDatabase32 = 1, NeedsDatabase33 = 2 }
