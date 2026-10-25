using LyricIsland.MediaHelper.Media;
using LyricIsland.MediaHelper.Protocol;

namespace LyricIsland.MediaHelper.Shell;

/// <summary>Lee comandos de stdin (un JSON por línea) en un hilo aparte (11.2, paso 7).</summary>
public sealed class CommandLoop
{
    private readonly MediaTracker _tracker;
    private readonly IMessageSink _sink;

    public CommandLoop(MediaTracker tracker, IMessageSink sink)
    {
        _tracker = tracker;
        _sink = sink;
    }

    /// <summary>Procesa una línea. Devuelve false si se pidió "shutdown".</summary>
    public async Task<bool> HandleAsync(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return true;
        var cmd = ProtocolJson.ParseCommand(line);
        if (cmd is null)
        {
            _sink.Send(new LogMessage("warn", $"Comando inválido: {Truncate(line)}"));
            return true;
        }
        switch (cmd.Cmd)
        {
            case "setFilter":
                var allow = string.Equals(cmd.Mode, "allow", StringComparison.OrdinalIgnoreCase);
                if (!allow && !string.Equals(cmd.Mode, "deny", StringComparison.OrdinalIgnoreCase))
                {
                    _sink.Send(new LogMessage("warn", $"setFilter con modo desconocido: {cmd.Mode}"));
                    return true;
                }
                await _tracker.SetFilterAsync(new AppFilter(allow, cmd.Apps ?? []));
                return true;
            case "requestSnapshot":
                await _tracker.RequestSnapshotAsync();
                return true;
            case "shutdown":
                return false;
            default:
                _sink.Send(new LogMessage("warn", $"Comando desconocido: {cmd.Cmd}"));
                return true;
        }
    }

    public async Task RunAsync(TextReader input, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var line = await input.ReadLineAsync(ct);
            if (line is null) return; // Electron cerró stdin → salir
            if (!await HandleAsync(line)) return;
        }
    }

    private static string Truncate(string s) => s.Length <= 80 ? s : s[..80] + "…";
}
