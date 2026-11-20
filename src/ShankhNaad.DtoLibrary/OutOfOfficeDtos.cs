namespace ShankhNaad.DtoLibrary;

/// <summary>Someone who is out of office: their note and when they're back (null = until they turn it off).</summary>
public sealed record OutOfOfficeDto(string? Message, DateTime? UntilUtc, DateTime SinceUtc);
