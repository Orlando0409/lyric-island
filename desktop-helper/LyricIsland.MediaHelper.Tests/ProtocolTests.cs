using LyricIsland.MediaHelper.Media;
using LyricIsland.MediaHelper.Protocol;
using LyricIsland.MediaHelper.Shell;

namespace LyricIsland.MediaHelper.Tests;

public class ProtocolTests
{
    public static readonly Message[] ContractSamples =
    [
        new HelloMessage("0.1.0", "10.0.22631"),
        new TrackMessage("Spotify.exe", "Bohemian Rhapsody", "Queen", "A Night at the Opera", 354000, "9f2c", "iVBORw0KGgo="),
        new TrackMessage("chrome.exe", "Canción “rara” ñ 日本", "Artista", null, null, null, null),
        new TimelineMessage(83120, 1761340000123, 1.0, "playing"),
        new TimelineMessage(0, 1761340000123, 0, "paused"),
        new ClearedMessage(),
        new FullscreenMessage(true),
        new LogMessage("warn", "Thumbnail read failed: ..."),
    ];

    [Fact]
    public void SerializacionExacta_Golden()
    {
        Assert.Equal(
            """{"v":1,"type":"track","sourceAppId":"Spotify.exe","title":"Bohemian Rhapsody","artist":"Queen","album":"A Night at the Opera","durationMs":354000,"artworkHash":"9f2c","artworkPngBase64":"iVBORw0KGgo="}""",
            ProtocolJson.Serialize(ContractSamples[1]));
        Assert.Equal(
            """{"v":1,"type":"track","sourceAppId":"chrome.exe","title":"Canción “rara” ñ 日本","artist":"Artista","album":null,"durationMs":null,"artworkHash":null}""",
            ProtocolJson.Serialize(ContractSamples[2]));
        Assert.Equal("""{"v":1,"type":"timeline","positionMs":83120,"updatedAtMs":1761340000123,"rate":1,"status":"playing"}""", ProtocolJson.Serialize(ContractSamples[3]));
        Assert.Equal("""{"v":1,"type":"cleared"}""", ProtocolJson.Serialize(ContractSamples[5]));
        Assert.Equal("""{"v":1,"type":"fullscreen","active":true}""", ProtocolJson.Serialize(ContractSamples[6]));
        Assert.Equal("""{"v":1,"type":"hello","helperVersion":"0.1.0","os":"10.0.22631"}""", ProtocolJson.Serialize(ContractSamples[0]));
    }

    /// <summary>
    /// Contrato C# ↔ zod: escribe los mensajes en shared/fixtures/expected/protocol-from-csharp.ndjson;
    /// el test de Vitest los valida con los esquemas zod y falla si hay diferencias.
    /// </summary>
    [Fact]
    public void GeneraMuestrasDelContrato()
    {
        var dir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "shared", "fixtures", "expected"));
        Directory.CreateDirectory(dir);
        var lines = ContractSamples.Select(ProtocolJson.Serialize);
        File.WriteAllText(Path.Combine(dir, "protocol-from-csharp.ndjson"), string.Join('\n', lines) + "\n");
    }

    [Theory]
    [InlineData("""{"cmd":"requestSnapshot"}""", "requestSnapshot")]
    [InlineData("""{"cmd":"setFilter","mode":"allow","apps":["Spotify.exe","chrome.exe"]}""", "setFilter")]
    [InlineData("""{"cmd":"shutdown"}""", "shutdown")]
    public void ParseaComandos(string json, string cmd) => Assert.Equal(cmd, ProtocolJson.ParseCommand(json)?.Cmd);

    [Theory]
    [InlineData("no json")]
    [InlineData("{}")]
    [InlineData("""{"cmd":""}""")]
    [InlineData("[1,2]")]
    public void ComandosInvalidos(string json) => Assert.Null(ProtocolJson.ParseCommand(json));

    [Fact]
    public void Writer_UnaLineaPorMensajeSinEntrelazar()
    {
        var sw = new StringWriter();
        using (var w = new NdjsonWriter(sw))
        {
            Parallel.For(0, 200, i => w.Send(new LogMessage("info", $"m{i}")));
        }
        var lines = sw.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(200, lines.Length);
        Assert.All(lines, l => Assert.StartsWith("""{"v":1,"type":"log",""", l));
    }

    [Fact]
    public async Task CommandLoop_ProcesaYTermina()
    {
        var src = new FakeMediaSessionSource();
        src.Sessions.Add(new FakeSession("chrome.exe") { Playback = new(PlaybackState.Playing, 1.0) });
        var sink = new CollectingSink();
        using var tracker = new MediaTracker(src, sink);
        await tracker.StartAsync();
        var loop = new CommandLoop(tracker, sink);

        var input = new StringReader(string.Join('\n',
            "",
            "basura",
            """{"cmd":"nope"}""",
            """{"cmd":"setFilter","mode":"raro"}""",
            """{"cmd":"setFilter","mode":"deny","apps":["chrome"]}""",
            """{"cmd":"requestSnapshot"}""",
            """{"cmd":"shutdown"}""",
            """{"cmd":"requestSnapshot"}"""));
        await loop.RunAsync(input, CancellationToken.None);

        Assert.Null(tracker.Active);
        Assert.Equal(3, sink.Of<LogMessage>().Count());
        Assert.Equal(2, sink.Of<ClearedMessage>().Count()); // filtro + snapshot; nada después de shutdown
        Assert.True(await loop.HandleAsync("""{"cmd":"setFilter","mode":"allow"}"""));
        Assert.NotNull(tracker.Active);
    }

    [Fact]
    public async Task CommandLoop_SetStartup_SinPaquete_AvisaYSigue()
    {
        // Fuera del MSIX no hay identidad de paquete: StartupTask falla, se avisa por log y el helper sigue vivo.
        var sink = new CollectingSink();
        var loop = new CommandLoop(new MediaTracker(new FakeMediaSessionSource(), sink), sink);
        Assert.True(await loop.HandleAsync("""{"cmd":"setStartup","enabled":true}"""));
        Assert.Contains(sink.Of<LogMessage>(), m => m.Level == "warn" && m.Msg.Contains("inicio con Windows"));
    }

    [Fact]
    public async Task CommandLoop_FinDeEntrada()
    {
        var loop = new CommandLoop(new MediaTracker(new FakeMediaSessionSource(), new CollectingSink()), new CollectingSink());
        await loop.RunAsync(new StringReader(""), CancellationToken.None);
    }
}

public class SessionSelectorTests
{
    private sealed record S(string App, PlaybackState State, long Tick);

    private static S? Pick(AppFilter f, S? current, params S[] all) =>
        SessionSelector.Select(all, s => s.App, s => s.State, s => s.Tick, current, f);

    [Fact]
    public void Casos()
    {
        var a = new S("Spotify.exe", PlaybackState.Playing, 1);
        var b = new S("chrome.exe", PlaybackState.Playing, 2);
        var c = new S("vlc.exe", PlaybackState.Paused, 0);
        Assert.Same(b, Pick(AppFilter.AllowAll, null, a, b, c));
        Assert.Same(a, Pick(new AppFilter(false, ["chrome"]), null, a, b, c));
        Assert.Null(Pick(new AppFilter(true, ["foobar"]), null, a, b, c));
        Assert.Same(c, Pick(AppFilter.AllowAll, null, c));
        Assert.Same(c, Pick(AppFilter.AllowAll, c, new S("x", PlaybackState.Unknown, 0), c));
        Assert.Null(Pick(AppFilter.AllowAll, null));
        var stopped = new S("x", PlaybackState.Stopped, 0);
        Assert.Same(stopped, Pick(AppFilter.AllowAll, null, stopped));
    }

    [Theory]
    [InlineData(true, new string[0], "x", true)]
    [InlineData(true, new[] { "spot" }, "Spotify.exe", true)]
    [InlineData(true, new[] { "spot" }, "vlc.exe", false)]
    [InlineData(false, new[] { " " }, "vlc.exe", true)]
    [InlineData(false, new[] { "VLC" }, "vlc.exe", false)]
    public void Filtro(bool allow, string[] apps, string id, bool expected) =>
        Assert.Equal(expected, new AppFilter(allow, apps).Allows(id));
}

public class FullscreenMonitorTests
{
    [Fact]
    public void EmiteSoloAlCambiar()
    {
        var states = new Queue<int?>([1, 1, 3, 3, null, 2, 5, 4]);
        var sink = new CollectingSink();
        using var m = new FullscreenMonitor(sink, () => states.Dequeue(), TimeSpan.Zero);
        for (var i = 0; i < 8; i++) m.Poll();
        Assert.Equal([false, true, false, true], sink.Of<FullscreenMessage>().Select(x => x.Active).ToArray());
    }

    [Theory]
    [InlineData(2, true)]
    [InlineData(3, true)]
    [InlineData(4, true)]
    [InlineData(1, false)]
    [InlineData(5, false)]
    public void Estados(int s, bool expected) => Assert.Equal(expected, FullscreenMonitor.IsFullscreenState(s));
}
