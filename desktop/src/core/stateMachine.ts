// IslandStateMachine (sección 10.1): decide el modo visual a partir de los hechos actuales.
import type { IslandMode, LyricsKind, NowPlaying, PlaybackStatus } from './types';

export type PauseBehavior = 'dim' | 'compact' | 'hide';
export type NoLyricsBehavior = 'title' | 'compact' | 'hide';

export interface PlayerFilter {
  mode: 'allow' | 'deny';
  apps: string[]; // coincidencia por subcadena, sin distinguir mayúsculas ("spotify" ⊂ "Spotify.exe")
}

export interface IslandBehavior {
  pauseBehavior: PauseBehavior;
  pauseCompactDelayMs: number;
  noLyricsBehavior: NoLyricsBehavior;
  hideOnFullscreen: boolean;
  playerFilter: PlayerFilter;
  experimentalPlain: boolean;
}

export const DEFAULT_BEHAVIOR: IslandBehavior = {
  pauseBehavior: 'dim',
  pauseCompactDelayMs: 10_000,
  noLyricsBehavior: 'title',
  hideOnFullscreen: true,
  playerFilter: { mode: 'deny', apps: [] },
  experimentalPlain: false,
};

export type LyricsStatus = LyricsKind | 'loading';

export interface MachineFacts {
  track: NowPlaying | null;
  status: PlaybackStatus;
  lyrics: LyricsStatus | null;
  fullscreen: boolean;
  userHidden: boolean;
  userCompact: boolean;
  pausedSinceMs: number | null;
  isAd: boolean;
  now: number;
}

export interface Decision {
  mode: IslandMode;
  showTitle: boolean;
  /** Instante en que la decisión puede cambiar sola (temporizador de pausa), o null. */
  recheckAtMs: number | null;
}

/** Lista vacía en modo "allow" = se permite todo (si no, la isla nunca aparecería). */
export function isAppAllowed(sourceAppId: string, filter: PlayerFilter): boolean {
  const id = sourceAppId.toLowerCase();
  const hit = filter.apps.some((a) => a.trim().length > 0 && id.includes(a.trim().toLowerCase()));
  if (filter.mode === 'allow') return filter.apps.length === 0 || hit;
  return !hit;
}

export function hasTimedLines(lyrics: LyricsStatus | null, behavior: IslandBehavior): boolean {
  return lyrics === 'synced' || (lyrics === 'plain' && behavior.experimentalPlain);
}

export function decideMode(f: MachineFacts, b: IslandBehavior): Decision {
  const hidden: Decision = { mode: 'hidden', showTitle: false, recheckAtMs: null };
  if (!f.track || f.status === 'stopped') return hidden;
  if (!isAppAllowed(f.track.sourceAppId, b.playerFilter)) return hidden;
  if (f.userHidden) return hidden;
  if (f.fullscreen && b.hideOnFullscreen) return hidden;
  if (f.isAd) return { mode: 'compact', showTitle: false, recheckAtMs: null };

  const paused = f.status === 'paused';
  if (hasTimedLines(f.lyrics, b)) {
    if (f.userCompact) return paused && b.pauseBehavior === 'hide' ? hidden : { mode: 'compact', showTitle: true, recheckAtMs: null };
    if (!paused) return { mode: 'expanded', showTitle: false, recheckAtMs: null };
    if (b.pauseBehavior === 'hide') return hidden;
    if (b.pauseBehavior === 'compact') return { mode: 'compact', showTitle: true, recheckAtMs: null };
    const since = f.pausedSinceMs ?? f.now;
    const at = since + b.pauseCompactDelayMs;
    if (f.now >= at) return { mode: 'compact', showTitle: true, recheckAtMs: null };
    return { mode: 'paused', showTitle: false, recheckAtMs: at };
  }

  if (paused && b.pauseBehavior === 'hide') return hidden;
  if (f.lyrics === 'loading' || f.lyrics === null) return { mode: 'compact', showTitle: true, recheckAtMs: null };
  if (b.noLyricsBehavior === 'hide') return hidden;
  return { mode: 'compact', showTitle: b.noLyricsBehavior === 'title', recheckAtMs: null };
}
