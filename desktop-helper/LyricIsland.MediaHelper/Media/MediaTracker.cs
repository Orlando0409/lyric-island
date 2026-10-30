using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using LyricIsland.MediaHelper.Protocol;

namespace LyricIsland.MediaHelper.Media;

/// <summary>
/// Lógica del helper: sigue las sesiones, elige la activa y emite track / timeline / cleared.
/// Todo el procesamiento pasa por un candado asíncrono porque los eventos WinRT llegan en hilos del pool.
/// </summary>
public sealed class MediaTracker : IDisposable
{
    private readonly IMediaSessionSource _source;
    private readonly IMessageSink _sink;
    private readonly Func<DateTimeOffset> _now;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConditionalWeakTable<IMediaSession, SessionInfo> _info = new();
    private readonly List<IMediaSession> _subscribed = [];
    private AppFilter _filter = AppFilter.AllowAll;
    private IMediaSession? _active;
    private bool _clearedSent;
    private string? _lastArtworkHash;
    private TimelineMessage? _lastTimeline;
    private long _tick;

    private sealed class SessionInfo
    {
        public bool WasPlaying;
        public long LastPlayingTick;
    }

    public MediaTracker(IMediaSessionSource source, IMessageSink sink, Func<DateTimeOffset>? now = null)
    {
        _source = source;
        _sink = sink;
        _now = now ?? (() => DateTimeOffset.UtcNow);
    }

    public IMediaSession? Active => _active;

    public async Task StartAsync()
    {
        _source.SessionsChanged += OnSessionsChanged;
        _source.CurrentSessionChanged += OnSessionsChanged;
        await RefreshAsync(forceTrack: false);
    }

    public Task SetFilterAsync(AppFilter filter)
    {
        _filter = filter;
        return RefreshAsync(forceTrack: false);
    }

    /// <summary>Reenvía track (con carátula) + timeline actuales, o "cleared".</summary>
    public Task RequestSnapshotAsync() => RefreshAsync(forceTrack: true);

    private void OnSessionsChanged(object? sender, EventArgs e) => _ = Guard(() => RefreshAsync(forceTrack: false));

    private void OnMediaPropertiesChanged(object? sender, EventArgs e) =>
        _ = Guard(() => Locked(async () =>
        {
            if (ReferenceEquals(sender, _active)) await EmitTrackAsync(_active!, forceArtwork: false);
        }));

    private void OnTimelineChanged(object? sender, EventArgs e) =>
        _ = Guard(() => Locked(() =>
        {
            if (ReferenceEquals(sender, _active)) EmitTimeline(_active!);
            return Task.CompletedTask;
        }));

    private void OnPlaybackChanged(object? sender, EventArgs e) =>
        _ = Guard(async () =>
        {
            await RefreshAsync(forceTrack: false);
            await Locked(() =>
            {
                if (ReferenceEquals(sender, _active)) EmitTimeline(_active!);
                return Task.CompletedTask;
            });
        });

    private async Task Locked(Func<Task> action)
    {
        await _gate.WaitAsync();
        try
        {
            await action();
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Todo error se convierte en un mensaje "log". Nunca un crash silencioso.</summary>
    private async Task Guard(Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (Exception ex)
        {
            _sink.Send(new LogMessage("error", $"{ex.GetType().Name}: {ex.Message}"));
        }
    }

    private Task RefreshAsync(bool forceTrack) => Locked(async () =>
    {
        var sessions = _source.GetSessions();
        Resubscribe(sessions);

        foreach (var s in sessions)
        {
            var info = _info.GetOrCreateValue(s);
            var playing = SafeState(s) == PlaybackState.Playing;
            if (playing && !info.WasPlaying) info.LastPlayingTick = ++_tick;
            info.WasPlaying = playing;
        }

        var selected = SessionSelector.Select(
            sessions,
            s => s.SourceAppId,
            SafeState,
            s => _info.GetOrCreateValue(s).LastPlayingTick,
            _source.GetCurrentSession(),
            _filter);

        if (selected is null)
        {
            _active = null;
            _lastArtworkHash = null;
            _lastTimeline = null;
            if (!_clearedSent || forceTrack)
            {
                _sink.Send(new ClearedMessage());
                _clearedSent = true;
            }
            return;
        }

        if (!ReferenceEquals(selected, _active) || forceTrack)
        {
            _active = selected;
            _clearedSent = false;
            _lastTimeline = null;
            await EmitTrackAsync(selected, forceArtwork: true);
            EmitTimeline(selected);
        }
    });

    private void Resubscribe(IReadOnlyList<IMediaSession> sessions)
    {
        foreach (var gone in _subscribed.Where(s => !sessions.Contains(s)).ToList())
        {
            gone.MediaPropertiesChanged -= OnMediaPropertiesChanged;
            gone.TimelinePropertiesChanged -= OnTimelineChanged;
            gone.PlaybackInfoChanged -= OnPlaybackChanged;
            _subscribed.Remove(gone);
        }
        foreach (var s in sessions.Where(s => !_subscribed.Contains(s)))
        {
            s.MediaPropertiesChanged += OnMediaPropertiesChanged;
            s.TimelinePropertiesChanged += OnTimelineChanged;
            s.PlaybackInfoChanged += OnPlaybackChanged;
            _subscribed.Add(s);
        }
    }

    private static PlaybackState SafeState(IMediaSession s)
    {
        try
        {
            return s.GetPlayback().State;
        }
        catch
        {
            return PlaybackState.Unknown;
        }
    }

    public static string StatusString(PlaybackState s) => s switch
    {
        PlaybackState.Playing => "playing",
        PlaybackState.Paused => "paused",
        PlaybackState.Stopped => "stopped",
        _ => "unknown",
    };

    public static string Sha1Hex(byte[] data) => Convert.ToHexStringLower(SHA1.HashData(data));

    private async Task EmitTrackAsync(IMediaSession s, bool forceArtwork)
    {
        var props = await s.GetPropertiesAsync();
        if (props is null)
        {
            _sink.Send(new LogMessage("warn", $"Sin propiedades multimedia para {s.SourceAppId}"));
            return;
        }

        long? durationMs = null;
        try
        {
            var tl = s.GetTimeline();
            var d = (long)(tl.EndTime - tl.StartTime).TotalMilliseconds;
            if (d > 0) durationMs = d;
        }
        catch (Exception ex)
        {
            _sink.Send(new LogMessage("warn", $"Timeline read failed: {ex.Message}"));
        }

        string? hash = null;
        string? base64 = null;
        try
        {
            var png = await s.GetArtworkPngAsync();
            if (png is { Length: > 0 })
            {
                hash = Sha1Hex(png);
                if (forceArtwork || hash != _lastArtworkHash) base64 = Convert.ToBase64String(png);
            }
        }
        catch (Exception ex)
        {
            _sink.Send(new LogMessage("warn", $"Thumbnail read failed: {ex.Message}"));
        }
        _lastArtworkHash = hash;

        _sink.Send(new TrackMessage(
            s.SourceAppId,
            props.Title.Trim(),
            props.Artist.Trim(),
            string.IsNullOrWhiteSpace(props.Album) ? null : props.Album.Trim(),
            durationMs,
            hash,
            base64));
    }

    private void EmitTimeline(IMediaSession s)
    {
        TimelineSnapshot tl;
        PlaybackSnapshot pb;
        try
        {
            tl = s.GetTimeline();
            pb = s.GetPlayback();
        }
        catch (Exception ex)
        {
            _sink.Send(new LogMessage("warn", $"Timeline read failed: {ex.Message}"));
            return;
        }

        var playing = pb.State == PlaybackState.Playing;
        // LastUpdatedTime "vacío" (año 1) o en el futuro lejano: se usa el instante actual.
        var updated = tl.LastUpdatedTime.Year < 2000 ? _now() : tl.LastUpdatedTime;
        var msg = new TimelineMessage(
            Math.Max(0, (long)tl.Position.TotalMilliseconds),
            updated.ToUnixTimeMilliseconds(),
            playing ? pb.Rate is > 0 ? pb.Rate.Value : 1.0 : 0,
            StatusString(pb.State));
        if (msg == _lastTimeline) return;
        _lastTimeline = msg;
        _sink.Send(msg);
    }

    public void Dispose()
    {
        _source.SessionsChanged -= OnSessionsChanged;
        _source.CurrentSessionChanged -= OnSessionsChanged;
        foreach (var s in _subscribed)
        {
            s.MediaPropertiesChanged -= OnMediaPropertiesChanged;
            s.TimelinePropertiesChanged -= OnTimelineChanged;
            s.PlaybackInfoChanged -= OnPlaybackChanged;
        }
        _subscribed.Clear();
        _gate.Dispose();
    }
}
