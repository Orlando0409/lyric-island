using System.Runtime.CompilerServices;
using Windows.Media.Control;
using Windows.Storage.Streams;
using WinSession = Windows.Media.Control.GlobalSystemMediaTransportControlsSession;
using WinStatus = Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus;

namespace LyricIsland.MediaHelper.Media;

/// <summary>IMediaSessionSource real sobre GlobalSystemMediaTransportControlsSessionManager.</summary>
public sealed class SmtcMediaSessionSource : IMediaSessionSource
{
    private readonly GlobalSystemMediaTransportControlsSessionManager _manager;
    // Un envoltorio estable por sesión WinRT (CsWinRT reutiliza el mismo RCW para el mismo objeto COM).
    private readonly ConditionalWeakTable<WinSession, SmtcSession> _wrappers = new();

    private SmtcMediaSessionSource(GlobalSystemMediaTransportControlsSessionManager manager)
    {
        _manager = manager;
        _manager.SessionsChanged += (_, _) => SessionsChanged?.Invoke(this, EventArgs.Empty);
        _manager.CurrentSessionChanged += (_, _) => CurrentSessionChanged?.Invoke(this, EventArgs.Empty);
    }

    public static async Task<SmtcMediaSessionSource> CreateAsync() =>
        new(await GlobalSystemMediaTransportControlsSessionManager.RequestAsync());

    public event EventHandler? SessionsChanged;
    public event EventHandler? CurrentSessionChanged;

    private SmtcSession Wrap(WinSession s) => _wrappers.GetValue(s, x => new SmtcSession(x));

    public IReadOnlyList<IMediaSession> GetSessions() => _manager.GetSessions().Select(Wrap).ToList<IMediaSession>();

    public IMediaSession? GetCurrentSession()
    {
        var s = _manager.GetCurrentSession();
        return s is null ? null : Wrap(s);
    }
}

internal sealed class SmtcSession : IMediaSession
{
    private readonly WinSession _s;
    private IRandomAccessStreamReference? _thumbnail;

    public SmtcSession(WinSession s)
    {
        _s = s;
        _s.MediaPropertiesChanged += (_, _) => MediaPropertiesChanged?.Invoke(this, EventArgs.Empty);
        _s.TimelinePropertiesChanged += (_, _) => TimelinePropertiesChanged?.Invoke(this, EventArgs.Empty);
        _s.PlaybackInfoChanged += (_, _) => PlaybackInfoChanged?.Invoke(this, EventArgs.Empty);
    }

    public string SourceAppId => _s.SourceAppUserModelId ?? "unknown";

    public event EventHandler? MediaPropertiesChanged;
    public event EventHandler? TimelinePropertiesChanged;
    public event EventHandler? PlaybackInfoChanged;

    public async Task<MediaProps?> GetPropertiesAsync()
    {
        var p = await _s.TryGetMediaPropertiesAsync();
        if (p is null) return null;
        _thumbnail = p.Thumbnail;
        return new MediaProps(p.Title ?? "", p.Artist ?? "", p.AlbumTitle);
    }

    public async Task<byte[]?> GetArtworkPngAsync()
    {
        if (_thumbnail is null) return null;
        using var stream = await _thumbnail.OpenReadAsync();
        return await ArtworkResizer.ToPngAsync(stream);
    }

    public TimelineSnapshot GetTimeline()
    {
        var t = _s.GetTimelineProperties();
        return new TimelineSnapshot(t.Position, t.StartTime, t.EndTime, t.LastUpdatedTime);
    }

    public PlaybackSnapshot GetPlayback()
    {
        var info = _s.GetPlaybackInfo();
        var state = info.PlaybackStatus switch
        {
            WinStatus.Playing => PlaybackState.Playing,
            WinStatus.Paused => PlaybackState.Paused,
            WinStatus.Stopped or WinStatus.Closed => PlaybackState.Stopped,
            _ => PlaybackState.Unknown,
        };
        return new PlaybackSnapshot(state, info.PlaybackRate);
    }
}
