using System.Runtime.InteropServices;
using LyricIsland.MediaHelper.Protocol;

namespace LyricIsland.MediaHelper.Shell;

/// <summary>
/// Cada 2 s consulta SHQueryUserNotificationState y emite "fullscreen" solo cuando cambia.
/// </summary>
public sealed partial class FullscreenMonitor : IDisposable
{
    // QUERY_USER_NOTIFICATION_STATE
    public const int QUNS_BUSY = 2;
    public const int QUNS_RUNNING_D3D_FULL_SCREEN = 3;
    public const int QUNS_PRESENTATION_MODE = 4;

    private readonly Func<int?> _query;
    private readonly IMessageSink _sink;
    private readonly Timer? _timer;
    private bool? _last;

    public FullscreenMonitor(IMessageSink sink, Func<int?>? query = null, TimeSpan? interval = null)
    {
        _sink = sink;
        _query = query ?? QueryShell;
        if (interval != TimeSpan.Zero)
            _timer = new Timer(_ => Poll(), null, TimeSpan.Zero, interval ?? TimeSpan.FromSeconds(2));
    }

    public static bool IsFullscreenState(int state) =>
        state is QUNS_BUSY or QUNS_RUNNING_D3D_FULL_SCREEN or QUNS_PRESENTATION_MODE;

    public void Poll()
    {
        var state = _query();
        if (state is null) return;
        var active = IsFullscreenState(state.Value);
        if (active == _last) return;
        _last = active;
        _sink.Send(new FullscreenMessage(active));
    }

    [LibraryImport("shell32.dll")]
    private static partial int SHQueryUserNotificationState(out int state);

    private static int? QueryShell()
    {
        try
        {
            return SHQueryUserNotificationState(out var s) == 0 ? s : null;
        }
        catch
        {
            return null;
        }
    }

    public void Dispose() => _timer?.Dispose();
}
