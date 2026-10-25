using System.Reflection;
using System.Text;
using LyricIsland.MediaHelper.Media;
using LyricIsland.MediaHelper.Protocol;
using LyricIsland.MediaHelper.Shell;

// LyricIsland.MediaHelper: lee la sesión multimedia de Windows (SMTC) y la publica como NDJSON en stdout.
// Se puede correr a mano en una terminal para ver los mensajes mientras suena Spotify.

Console.OutputEncoding = new UTF8Encoding(false);
Console.InputEncoding = new UTF8Encoding(false);

using var writer = new NdjsonWriter(Console.Out);
var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";
writer.Send(new HelloMessage(version, Environment.OSVersion.Version.ToString()));

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};
AppDomain.CurrentDomain.UnhandledException += (_, e) =>
    writer.Send(new LogMessage("error", $"Unhandled: {e.ExceptionObject}"));
TaskScheduler.UnobservedTaskException += (_, e) =>
{
    writer.Send(new LogMessage("error", $"Unobserved: {e.Exception.GetBaseException().Message}"));
    e.SetObserved();
};

try
{
    var source = await SmtcMediaSessionSource.CreateAsync();
    using var tracker = new MediaTracker(source, writer);
    await tracker.StartAsync();
    using var fullscreen = new FullscreenMonitor(writer);
    var commands = new CommandLoop(tracker, writer);
    await commands.RunAsync(Console.In, cts.Token);
}
catch (OperationCanceledException)
{
    // Ctrl+C
}
catch (Exception ex)
{
    writer.Send(new LogMessage("error", $"Fatal: {ex.GetType().Name}: {ex.Message}"));
    return 1;
}
return 0;
