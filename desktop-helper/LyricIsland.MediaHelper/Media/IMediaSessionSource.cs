namespace LyricIsland.MediaHelper.Media;

// Abstracción sobre Windows.Media.Control para poder probar sin WinRT (FakeMediaSessionSource en los tests).

public enum PlaybackState
{
    Unknown,
    Playing,
    Paused,
    Stopped,
}

public sealed record MediaProps(string Title, string Artist, string? Album);

public sealed record TimelineSnapshot(TimeSpan Position, TimeSpan StartTime, TimeSpan EndTime, DateTimeOffset LastUpdatedTime);

public sealed record PlaybackSnapshot(PlaybackState State, double? Rate);

public interface IMediaSession
{
    string SourceAppId { get; }
    Task<MediaProps?> GetPropertiesAsync();

    /// <summary>Carátula ya reducida a ≤ 256 px y codificada en PNG, o null.</summary>
    Task<byte[]?> GetArtworkPngAsync();

    TimelineSnapshot GetTimeline();
    PlaybackSnapshot GetPlayback();

    event EventHandler? MediaPropertiesChanged;
    event EventHandler? TimelinePropertiesChanged;
    event EventHandler? PlaybackInfoChanged;
}

public interface IMediaSessionSource
{
    IReadOnlyList<IMediaSession> GetSessions();
    IMediaSession? GetCurrentSession();
    event EventHandler? SessionsChanged;
    event EventHandler? CurrentSessionChanged;
}
