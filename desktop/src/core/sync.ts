// Motor de sincronización: interpolación, deriva/seek, línea y palabra activas, interludios.
import type { LyricLine, Timeline } from './types';

export interface Clock {
  now(): number;
}

export const SEEK_THRESHOLD_MS = 250;
export const SMOOTH_CORRECTION_MS = 300;
export const INTERLUDE_MIN_GAP_MS = 5000;
export const INTRO_MIN_MS = 3000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Posición cruda interpolada (sin offsets). Un updatedAtMs en el futuro no hace retroceder la posición. */
export function interpolate(tl: Timeline, nowMs: number): number {
  if (tl.status !== 'playing') return tl.positionMs;
  return tl.positionMs + Math.max(0, nowMs - tl.updatedAtMs) * tl.rate;
}

export type TimelineChange = 'init' | 'drift' | 'seek' | 'status';

/** Sigue la posición de reproducción y suaviza las correcciones pequeñas. */
export class PositionTracker {
  private base: Timeline | null = null;
  private correctionMs = 0;
  private correctionAt = 0;

  constructor(private readonly clock: Clock) {}

  get timeline(): Timeline | null {
    return this.base;
  }

  reset(): void {
    this.base = null;
    this.correctionMs = 0;
  }

  update(tl: Timeline): TimelineChange {
    const now = this.clock.now();
    const prev = this.base;
    this.base = tl;
    if (!prev) {
      this.correctionMs = 0;
      return 'init';
    }
    const before = interpolate(prev, now) + this.currentCorrection(now);
    const after = interpolate(tl, now);
    const delta = before - after;
    if (Math.abs(delta) > SEEK_THRESHOLD_MS) {
      this.correctionMs = 0;
      return 'seek';
    }
    if (prev.status !== tl.status || tl.status !== 'playing') {
      this.correctionMs = 0;
      return 'status';
    }
    this.correctionMs = delta;
    this.correctionAt = now;
    return 'drift';
  }

  private currentCorrection(now: number): number {
    if (this.correctionMs === 0) return 0;
    const t = (now - this.correctionAt) / SMOOTH_CORRECTION_MS;
    if (t >= 1) return 0;
    return this.correctionMs * (1 - Math.max(0, t));
  }

  /** Posición cruda + corrección suave en curso. */
  rawPosition(now = this.clock.now()): number {
    if (!this.base) return 0;
    return interpolate(this.base, now) + this.currentCorrection(now);
  }
}

/** Busca la línea activa: revisa la pista (hint) y la siguiente; si no, búsqueda binaria. */
export function findActiveLine(lines: LyricLine[], pos: number, hint = -1): number {
  const n = lines.length;
  if (n === 0 || pos < lines[0].startMs) return -1;
  const fits = (i: number) => i >= 0 && i < n && lines[i].startMs <= pos && (i + 1 >= n || lines[i + 1].startMs > pos);
  if (fits(hint)) return hint;
  if (fits(hint + 1)) return hint + 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].startMs <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface Interlude {
  progress: number; // 0..1, cuenta regresiva hacia la siguiente línea
  beforeFirst: boolean;
}

export interface SyncFrame {
  positionMs: number;
  activeLineIndex: number;
  lineProgress: number;
  wordIndex: number;
  wordProgress: number;
  interlude: Interlude | null;
}

/** Fin de la parte cantada de una línea (última palabra) o su inicio si no tiene palabras. */
export function sungEndMs(line: LyricLine): number {
  return line.words.length > 0 ? line.words[line.words.length - 1].endMs : line.startMs;
}

export function computeFrame(lines: LyricLine[], pos: number, hint = -1): SyncFrame {
  const i = findActiveLine(lines, pos, hint);
  if (i < 0) {
    const first = lines[0];
    const interlude =
      first && first.startMs > INTRO_MIN_MS ? { progress: clamp(pos / first.startMs, 0, 1), beforeFirst: true } : null;
    return { positionMs: pos, activeLineIndex: -1, lineProgress: 0, wordIndex: -1, wordProgress: 0, interlude };
  }
  const line = lines[i];
  const span = line.endMs - line.startMs;
  const lineProgress = span > 0 ? clamp((pos - line.startMs) / span, 0, 1) : 1;

  let wordIndex = -1;
  let wordProgress = 0;
  for (let w = line.words.length - 1; w >= 0; w--) {
    if (line.words[w].startMs <= pos) {
      wordIndex = w;
      const word = line.words[w];
      const d = word.endMs - word.startMs;
      wordProgress = d > 0 ? clamp((pos - word.startMs) / d, 0, 1) : 1;
      break;
    }
  }

  let interlude: Interlude | null = null;
  const next = lines[i + 1];
  if (next) {
    const sungEnd = sungEndMs(line);
    const gap = next.startMs - sungEnd;
    if (gap >= INTERLUDE_MIN_GAP_MS && pos >= sungEnd) {
      interlude = { progress: clamp((pos - sungEnd) / gap, 0, 1), beforeFirst: false };
    }
  }
  return { positionMs: pos, activeLineIndex: i, lineProgress, wordIndex, wordProgress, interlude };
}

/** Combina el tracker de posición, los offsets y la línea activa (con pista para O en reproducción normal). */
export class SyncEngine {
  readonly tracker: PositionTracker;
  private hint = -1;
  lines: LyricLine[] = [];
  lrcOffsetMs = 0;
  userOffsetMs = 0;
  /** Adelanto global: la línea nueva tarda ~200 ms en leerse (animación de entrada), así que se muestra un poco antes. */
  leadMs = 0;
  durationMs: number | null = null;

  constructor(private readonly clock: Clock) {
    this.tracker = new PositionTracker(clock);
  }

  setLyrics(lines: LyricLine[], lrcOffsetMs: number): void {
    this.lines = lines;
    this.lrcOffsetMs = lrcOffsetMs;
    this.hint = -1;
  }

  /** Cambio de pista: reinicia todo. */
  resetTrack(durationMs: number | null): void {
    this.tracker.reset();
    this.lines = [];
    this.lrcOffsetMs = 0;
    this.hint = -1;
    this.durationMs = durationMs;
  }

  update(tl: Timeline): TimelineChange {
    const change = this.tracker.update(tl);
    if (change === 'seek') this.hint = -1; // incluye "repetir una" (salto grande hacia atrás)
    return change;
  }

  position(now = this.clock.now()): number {
    const pos = this.tracker.rawPosition(now) + this.lrcOffsetMs + this.userOffsetMs + this.leadMs;
    const max = this.durationMs ?? Number.POSITIVE_INFINITY;
    return clamp(pos, 0, max);
  }

  frame(now = this.clock.now()): SyncFrame {
    const f = computeFrame(this.lines, this.position(now), this.hint);
    this.hint = f.activeLineIndex;
    return f;
  }
}
