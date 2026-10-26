using LyricIsland.MediaHelper.Protocol;
using Windows.ApplicationModel;

namespace LyricIsland.MediaHelper.Shell;

/// <summary>
/// "Iniciar con Windows" en el paquete MSIX (Store): la extensión StartupTask del manifiesto
/// (build/appx/extensions.xml). El helper corre dentro del paquete, así que tiene su identidad.
/// En el instalador NSIS no hay identidad de paquete: ahí lo maneja Electron (setLoginItemSettings).
/// </summary>
public static class StartupToggle
{
    public const string TaskId = "LyricIslandStartup";

    public static async Task SetAsync(bool enabled, IMessageSink sink)
    {
        try
        {
            var task = await StartupTask.GetAsync(TaskId);
            if (!enabled)
            {
                task.Disable();
                return;
            }
            var state = await task.RequestEnableAsync();
            // Si el usuario lo apagó en Configuración de Windows, solo se puede volver a encender desde ahí.
            if (state is not (StartupTaskState.Enabled or StartupTaskState.EnabledByPolicy))
                sink.Send(new LogMessage("warn", $"inicio con Windows: {state}"));
        }
        catch (Exception e)
        {
            sink.Send(new LogMessage("warn", $"inicio con Windows no disponible: {e.Message}"));
        }
    }
}
