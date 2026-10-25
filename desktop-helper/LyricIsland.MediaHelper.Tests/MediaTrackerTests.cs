using LyricIsland.MediaHelper.Media;
using LyricIsland.MediaHelper.Protocol;

namespace LyricIsland.MediaHelper.Tests;

public class MediaTrackerTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 24, 12, 0, 5, TimeSpan.Zero);

    private static (FakeMediaSessionSource src, CollectingSink sink, MediaTracker tracker) Create()
    {
        var src = new FakeMediaSessionSource();
        var sink = new CollectingSink();
        return (src, sink, new MediaTracker(src, sink, () => Now));
    }

    [Fact]
    public async Task SinSesiones_EmiteClearedUnaSolaVez()
    {
        var (src, sink, t) = Create();
        await t.StartAsync();
        src.RaiseCurrent();
        await Wait.Settle();
        Assert.Single(sink.Of<ClearedMessage>());
    }

    [Fact]
    public async Task SesionReproduciendo_EmiteTrackYTimeline()
    {
        var (src, sink, t) = Create();
        var s = new FakeSession("Spotify.exe") { Artwork = [1, 2, 3], Playback = new(PlaybackState.Playing, 1.0) };
        src.Sessions.Add(s);
        await t.StartAsync();

        var track = Assert.Single(sink.Of<TrackMessage>());
        Assert.Equal("Spotify.exe", track.SourceAppId);
        Assert.Equal(200_000, track.DurationMs);
        Assert.Equal(MediaTracker.Sha1Hex([1, 2, 3]), track.ArtworkHash);
        Assert.Equal(Convert.ToBase64String(new byte[] { 1, 2, 3 }), track.ArtworkPngBase64);

        var tl = Assert.Single(sink.Of<TimelineMessage>());
        Assert.Equal(10_000, tl.PositionMs);
        Assert.Equal(new DateTimeOffset(2026, 10, 24, 12, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds(), tl.UpdatedAtMs);
        Assert.Equal(1.0, tl.Rate);
        Assert.Equal("playing", tl.Status);
    }

    [Fact]
    public async Task CaratulaSoloSeReenviaSiCambiaElHash()
    {
        var (src, sink, t) = Create();
        var s = new FakeSession("Spotify.exe") { Artwork = [9, 9], Playback = new(PlaybackState.Playing, 1.0) };
        src.Sessions.Add(s);
        await t.StartAsync();
        sink.Clear();

        s.Props = new MediaProps("Otra", "Artista", null);
        s.RaiseMedia();
        await Wait.Until(() => sink.Of<TrackMessage>().Any());
        var same = sink.Of<TrackMessage>().Single();
        Assert.Null(same.ArtworkPngBase64);
        Assert.NotNull(same.ArtworkHash);
        Assert.Null(same.Album);

        sink.Clear();
        s.Artwork = [7];
        s.RaiseMedia();
        await Wait.Until(() => sink.Of<TrackMessage>().Any());
        Assert.NotNull(sink.Of<TrackMessage>().Single().ArtworkPngBase64);

        sink.Clear();
        await t.RequestSnapshotAsync();
        Assert.NotNull(sink.Of<TrackMessage>().Single().ArtworkPngBase64); // el snapshot siempre la incluye
        Assert.Single(sink.Of<TimelineMessage>());
    }

    [Fact]
    public async Task ErrorAlLeerLaMiniatura_EmiteLogYSigue()
    {
        var (src, sink, t) = Create();
        src.Sessions.Add(new FakeSession("Spotify.exe") { ThrowOnArtwork = true, Playback = new(PlaybackState.Playing, 1.0) });
        await t.StartAsync();
        Assert.Contains(sink.Of<LogMessage>(), l => l.Level == "warn" && l.Msg.StartsWith("Thumbnail read failed"));
        var track = Assert.Single(sink.Of<TrackMessage>());
        Assert.Null(track.ArtworkHash);
    }

    [Fact]
    public async Task PrioridadALaUltimaQuePasoAPlaying()
    {
        var (src, sink, t) = Create();
        var a = new FakeSession("Spotify.exe") { Playback = new(PlaybackState.Playing, 1.0) };
        var b = new FakeSession("chrome.exe");
        src.Sessions.AddRange([a, b]);
        await t.StartAsync();
        Assert.Same(a, t.Active);

        sink.Clear();
        b.SetState(PlaybackState.Playing);
        await Wait.Until(() => ReferenceEquals(t.Active, b) && sink.Of<TrackMessage>().Any());
        Assert.Equal("chrome.exe", sink.Of<TrackMessage>().Last().SourceAppId);

        // b se pausa: a sigue reproduciendo → vuelve a a
        b.SetState(PlaybackState.Paused);
        await Wait.Until(() => ReferenceEquals(t.Active, a));
    }

    [Fact]
    public async Task SinNingunaReproduciendo_QuedaLaUltimaQueReprodujo()
    {
        var (src, _, t) = Create();
        var a = new FakeSession("Spotify.exe") { Playback = new(PlaybackState.Playing, 1.0) };
        var b = new FakeSession("vlc.exe");
        src.Sessions.AddRange([a, b]);
        await t.StartAsync();
        a.SetState(PlaybackState.Paused);
        await Wait.Settle();
        Assert.Same(a, t.Active);
    }

    [Fact]
    public async Task FiltroAllowDeny()
    {
        var (src, sink, t) = Create();
        src.Sessions.Add(new FakeSession("chrome.exe") { Playback = new(PlaybackState.Playing, 1.0) });
        await t.StartAsync();
        Assert.NotNull(t.Active);

        await t.SetFilterAsync(new AppFilter(true, ["Spotify"]));
        Assert.Null(t.Active);
        Assert.Single(sink.Of<ClearedMessage>());

        await t.SetFilterAsync(new AppFilter(false, ["spotify"]));
        Assert.NotNull(t.Active);
    }

    [Fact]
    public async Task EventosDeSesionesNoActivasSeIgnoran()
    {
        var (src, sink, t) = Create();
        var a = new FakeSession("Spotify.exe") { Playback = new(PlaybackState.Playing, 1.0) };
        var b = new FakeSession("vlc.exe");
        src.Sessions.AddRange([a, b]);
        await t.StartAsync();
        sink.Clear();
        b.RaiseMedia();
        b.RaiseTimeline();
        await Wait.Settle();
        Assert.Empty(sink.Messages);
    }

    [Fact]
    public async Task TimelineEnPausa_RateCeroYSinDuplicados()
    {
        var (src, sink, t) = Create();
        var s = new FakeSession("Spotify.exe") { Playback = new(PlaybackState.Playing, 1.0) };
        src.Sessions.Add(s);
        await t.StartAsync();
        sink.Clear();

        s.SetState(PlaybackState.Paused);
        await Wait.Until(() => sink.Of<TimelineMessage>().Any());
        var tl = sink.Of<TimelineMessage>().Single();
        Assert.Equal(0, tl.Rate);
        Assert.Equal("paused", tl.Status);

        sink.Clear();
        s.RaiseTimeline(); // mismo estado → no se repite
        await Wait.Settle();
        Assert.Empty(sink.Of<TimelineMessage>());
    }

    [Fact]
    public async Task LastUpdatedTimeVacio_UsaElRelojActual()
    {
        var (src, sink, t) = Create();
        src.Sessions.Add(new FakeSession("x") { Timeline = new(TimeSpan.FromSeconds(1), TimeSpan.Zero, TimeSpan.Zero, default), Playback = new(PlaybackState.Playing, null) });
        await t.StartAsync();
        var tl = sink.Of<TimelineMessage>().Single();
        Assert.Equal(Now.ToUnixTimeMilliseconds(), tl.UpdatedAtMs);
        Assert.Equal(1.0, tl.Rate);
        Assert.Null(sink.Of<TrackMessage>().Single().DurationMs);
    }

    [Fact]
    public async Task SesionQueDesaparece_EmiteCleared()
    {
        var (src, sink, t) = Create();
        var s = new FakeSession("Spotify.exe") { Playback = new(PlaybackState.Playing, 1.0) };
        src.Sessions.Add(s);
        await t.StartAsync();
        src.Remove(s);
        await Wait.Until(() => sink.Of<ClearedMessage>().Any());
        Assert.Null(t.Active);
    }

    [Fact]
    public async Task SinPropiedades_EmiteLog()
    {
        var (src, sink, t) = Create();
        src.Sessions.Add(new FakeSession("x") { Props = null, Playback = new(PlaybackState.Playing, 1.0) });
        await t.StartAsync();
        Assert.Contains(sink.Of<LogMessage>(), l => l.Msg.Contains("Sin propiedades"));
        Assert.Empty(sink.Of<TrackMessage>());
    }

    [Theory]
    [InlineData(PlaybackState.Playing, "playing")]
    [InlineData(PlaybackState.Paused, "paused")]
    [InlineData(PlaybackState.Stopped, "stopped")]
    [InlineData(PlaybackState.Unknown, "unknown")]
    public void StatusString(PlaybackState s, string expected) => Assert.Equal(expected, MediaTracker.StatusString(s));

    [Fact]
    public void HashEstable() =>
        Assert.Equal("a9993e364706816aba3e25717850c26c9cd0d89d", MediaTracker.Sha1Hex("abc"u8.ToArray()));
}
