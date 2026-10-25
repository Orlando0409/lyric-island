namespace LyricIsland.MediaHelper.Media;

public sealed record AppFilter(bool AllowMode, IReadOnlyList<string> Apps)
{
    public static readonly AppFilter AllowAll = new(false, []);

    /// <summary>Coincidencia por subcadena sin distinguir mayúsculas. Lista vacía en modo allow = todo permitido.</summary>
    public bool Allows(string sourceAppId)
    {
        var hit = Apps.Any(a => !string.IsNullOrWhiteSpace(a) &&
                                sourceAppId.Contains(a.Trim(), StringComparison.OrdinalIgnoreCase));
        return AllowMode ? Apps.Count == 0 || hit : !hit;
    }
}

/// <summary>
/// Elige la sesión "activa" (11.2, paso 3; RF-10): aplica el filtro y prioriza la que esté reproduciendo;
/// si hay varias, la última que pasó a Playing. Sin ninguna reproduciendo: la última que reprodujo,
/// y si no, la que Windows considera actual.
/// </summary>
public static class SessionSelector
{
    public static T? Select<T>(
        IEnumerable<T> sessions,
        Func<T, string> appId,
        Func<T, PlaybackState> state,
        Func<T, long> lastPlayingTick,
        T? current,
        AppFilter filter) where T : class
    {
        var allowed = sessions.Where(s => filter.Allows(appId(s))).ToList();
        if (allowed.Count == 0) return null;

        var playing = allowed.Where(s => state(s) == PlaybackState.Playing).ToList();
        if (playing.Count > 0) return playing.MaxBy(lastPlayingTick);

        var recent = allowed.Where(s => lastPlayingTick(s) > 0).MaxBy(lastPlayingTick);
        if (recent is not null) return recent;

        if (current is not null && allowed.Contains(current)) return current;
        return allowed.FirstOrDefault(s => state(s) == PlaybackState.Paused) ?? allowed[0];
    }
}
