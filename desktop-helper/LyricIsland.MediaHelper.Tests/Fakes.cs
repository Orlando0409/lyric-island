using LyricIsland.MediaHelper.Media;
using LyricIsland.MediaHelper.Protocol;

namespace LyricIsland.MediaHelper.Tests;

public sealed class CollectingSink : IMessageSink
{
    private readonly List<Message> _messages = [];
    public IReadOnlyList<Message> Messages
    {
        get
        {
            lock (_messages) return _messages.ToList();
        }
    }

    public void Send(Message message)
    {
        lock (_messages) _messages.Add(message);
    }

    public void Clear()
    {
        lock (_messages) _messages.Clear();
    }

    public IEnumerable<T> Of<T>() where T : Message => Messages.OfType<T>();
}

public sealed class FakeSession(string appId) : IMediaSession
{
    public string SourceAppId { get; } = appId;
    public MediaProps? Props { get; set; } = new("Canción", "Artista", "Álbum");
    public byte[]? Artwork { get; set; }
    public bool ThrowOnArtwork { get; set; }
    public TimelineSnapshot Timeline { get; set; } =
        new(TimeSpan.FromSeconds(10), TimeSpan.Zero, TimeSpan.FromSeconds(200), new DateTimeOffset(2026, 10, 24, 12, 0, 0, TimeSpan.Zero));
    public PlaybackSnapshot Playback { get; set; } = new(PlaybackState.Paused, 1.0);

    public Task<MediaProps?> GetPropertiesAsync() => Task.FromResult(Props);

    public Task<byte[]?> GetArtworkPngAsync() =>
        ThrowOnArtwork ? Task.FromException<byte[]?>(new InvalidOperationException("boom")) : Task.FromResult(Artwork);

    public TimelineSnapshot GetTimeline() => Timeline;
    public PlaybackSnapshot GetPlayback() => Playback;

    public event EventHandler? MediaPropertiesChanged;
    public event EventHandler? TimelinePropertiesChanged;
    public event EventHandler? PlaybackInfoChanged;

    public void RaiseMedia() => MediaPropertiesChanged?.Invoke(this, EventArgs.Empty);
    public void RaiseTimeline() => TimelinePropertiesChanged?.Invoke(this, EventArgs.Empty);

    public void SetState(PlaybackState s, double? rate = 1.0)
    {
        Playback = new PlaybackSnapshot(s, rate);
        PlaybackInfoChanged?.Invoke(this, EventArgs.Empty);
    }
}

public sealed class FakeMediaSessionSource : IMediaSessionSource
{
    public List<FakeSession> Sessions { get; } = [];
    public FakeSession? Current { get; set; }

    public IReadOnlyList<IMediaSession> GetSessions() => Sessions.ToList<IMediaSession>();
    public IMediaSession? GetCurrentSession() => Current;

    public event EventHandler? SessionsChanged;
    public event EventHandler? CurrentSessionChanged;

    public void Add(FakeSession s)
    {
        Sessions.Add(s);
        SessionsChanged?.Invoke(this, EventArgs.Empty);
    }

    public void Remove(FakeSession s)
    {
        Sessions.Remove(s);
        SessionsChanged?.Invoke(this, EventArgs.Empty);
    }

    public void RaiseCurrent() => CurrentSessionChanged?.Invoke(this, EventArgs.Empty);
}

public static class Wait
{
    /// <summary>Los eventos se procesan de forma asíncrona: espera a que se cumpla la condición.</summary>
    public static async Task Until(Func<bool> condition, int timeoutMs = 3000)
    {
        var deadline = Environment.TickCount64 + timeoutMs;
        while (!condition())
        {
            if (Environment.TickCount64 > deadline) throw new TimeoutException("La condición no se cumplió a tiempo");
            await Task.Delay(10);
        }
    }

    /// <summary>Deja correr los manejadores pendientes.</summary>
    public static Task Settle() => Task.Delay(100);
}
