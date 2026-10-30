using System.Text.Json;
using System.Text.Json.Serialization;

namespace LyricIsland.MediaHelper.Protocol;

// Protocolo helper → Electron: un JSON por línea en stdout.
// El orden de las propiedades es parte del contrato (los golden tests lo comparan byte a byte).

public abstract record Message([property: JsonPropertyOrder(-9)] string Type)
{
    public const int ProtocolVersion = 1;

    [JsonPropertyOrder(-10)]
    public int V => ProtocolVersion;
}

public sealed record HelloMessage(string HelperVersion, string Os) : Message("hello");

public sealed record TrackMessage(
    string SourceAppId,
    string Title,
    string Artist,
    string? Album,
    long? DurationMs,
    string? ArtworkHash,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ArtworkPngBase64) : Message("track");

public sealed record TimelineMessage(long PositionMs, long UpdatedAtMs, double Rate, string Status) : Message("timeline");

public sealed record ClearedMessage() : Message("cleared");

public sealed record FullscreenMessage(bool Active) : Message("fullscreen");

public sealed record LogMessage(string Level, string Msg) : Message("log");

/// <summary>Comandos Electron → helper.</summary>
public sealed class Command
{
    public string? Cmd { get; set; }
    public string? Mode { get; set; }
    public string[]? Apps { get; set; }
    /// <summary>"setStartup": iniciar con Windows (solo en el paquete MSIX).</summary>
    public bool? Enabled { get; set; }
}

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    WriteIndented = false)]
[JsonSerializable(typeof(HelloMessage))]
[JsonSerializable(typeof(TrackMessage))]
[JsonSerializable(typeof(TimelineMessage))]
[JsonSerializable(typeof(ClearedMessage))]
[JsonSerializable(typeof(FullscreenMessage))]
[JsonSerializable(typeof(LogMessage))]
[JsonSerializable(typeof(Command))]
internal sealed partial class ProtocolJsonContext : JsonSerializerContext;

public static class ProtocolJson
{
    private static readonly JsonSerializerOptions Options = new(ProtocolJsonContext.Default.Options)
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
    private static readonly ProtocolJsonContext Context = new(Options);

    public static string Serialize(Message m) => m switch
    {
        HelloMessage x => JsonSerializer.Serialize(x, Context.HelloMessage),
        TrackMessage x => JsonSerializer.Serialize(x, Context.TrackMessage),
        TimelineMessage x => JsonSerializer.Serialize(x, Context.TimelineMessage),
        ClearedMessage x => JsonSerializer.Serialize(x, Context.ClearedMessage),
        FullscreenMessage x => JsonSerializer.Serialize(x, Context.FullscreenMessage),
        LogMessage x => JsonSerializer.Serialize(x, Context.LogMessage),
        _ => throw new ArgumentOutOfRangeException(nameof(m)),
    };

    /// <summary>Parsea un comando; null si la línea no es JSON válido o no tiene "cmd".</summary>
    public static Command? ParseCommand(string line)
    {
        try
        {
            var c = JsonSerializer.Deserialize(line, Context.Command);
            return string.IsNullOrWhiteSpace(c?.Cmd) ? null : c;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
