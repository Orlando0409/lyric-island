// Orquestador (sección 6.3): une sesión multimedia, letras, sincronía, color y estados.
// Puro: el reloj, los temporizadores y la obtención de letras se inyectan.
import { NEUTRAL_PALETTE } from './color';
import { estimatePlainLines } from './lrc';
import { looksLikeAd } from './matcher';
import { DEFAULT_BEHAVIOR, decideMode, hasTimedLines, type IslandBehavior } from './stateMachine';
import { SyncEngine, type Clock, type Interlude } from './sync';
import type { IslandState, LyricLine, LyricsDocument, NowPlaying, Palette, PlaybackStatus, Timeline } from './types';

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ControllerDeps {
  clock: Clock;
  scheduler: Scheduler;
  fetchLyrics: (track: NowPlaying) => Promise<LyricsDocument>;
  loadUserOffset?: (track: NowPlaying) => Promise<number> | number;
  saveUserOffset?: (track: NowPlaying, offsetMs: number) => void;
  behavior?: IslandBehavior;
}

export interface IslandSnapshot extends IslandState {
  showTitle: boolean;
  positionMs: number;
  interlude: Interlude | null;
  lyricsLoading: boolean;
  userOffsetMs: number;
  offsetFlash: string | null; // "+200 ms" durante 1.5 s tras ajustar
  status: PlaybackStatus;
  estimatedLines: boolean; // letra plana repartida (ícono "≈")
}

export const TRACK_DEBOUNCE_MS = 400;
export const OFFSET_STEP_MS = 100;
export const OFFSET_FLASH_MS = 1500;
export const LYRICS_RETRY_MS = 10_000;

export function trackKey(t: NowPlaying): string {
  return [t.sourceAppId, t.title, t.artist, t.album ?? '', t.durationMs ?? ''].join('␟');
}

export function formatOffset(ms: number): string {
  return `${ms > 0 ? '+' : ms < 0 ? '−' : '±'}${Math.abs(ms)} ms`;
}

export class IslandController {
  private track: NowPlaying | null = null;
  private key: string | null = null;
  private lyrics: LyricsDocument | null = null;
  private lines: LyricLine[] = [];
  private loading = false;
  private status: PlaybackStatus = 'unknown';
  private pausedSince: number | null = null;
  private fullscreen = false;
  private userHidden = false;
  private userCompact = false;
  private userOffset = 0;
  private flashUntil = 0;
  private palette: Palette = { ...NEUTRAL_PALETTE };
  private behavior: IslandBehavior;
  private debounce: unknown = null;
  private recheck: unknown = null;
  private generation = 0;
  private listeners = new Set<() => void>();
  readonly sync: SyncEngine;

  constructor(private readonly deps: ControllerDeps) {
    this.behavior = deps.behavior ?? DEFAULT_BEHAVIOR;
    this.sync = new SyncEngine(deps.clock);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.scheduleRecheck();
    for (const fn of this.listeners) fn();
  }

  /** Re-emite cuando la decisión cambie sola (p. ej. pausa → compacta a los 10 s). */
  private scheduleRecheck(): void {
    if (this.recheck !== null) this.deps.scheduler.clearTimeout(this.recheck);
    this.recheck = null;
    const at = this.decision().recheckAtMs;
    if (at === null) return;
    const ms = Math.max(0, at - this.deps.clock.now());
    this.recheck = this.deps.scheduler.setTimeout(() => {
      this.recheck = null;
      this.emit();
    }, ms);
  }

  setBehavior(b: IslandBehavior): void {
    this.behavior = b;
    this.rebuildLines();
    this.emit();
  }

  setPalette(p: Palette): void {
    this.palette = p;
    this.emit();
  }

  onTrack(t: NowPlaying): void {
    const key = trackKey(t);
    if (key === this.key) {
      this.track = t; // p. ej. llegó la carátula
      this.emit();
      return;
    }
    this.track = t;
    this.key = key;
    this.lyrics = null;
    this.lines = [];
    this.loading = true;
    this.userOffset = 0;
    this.sync.resetTrack(t.durationMs);
    this.sync.userOffsetMs = 0;
    const gen = ++this.generation;
    if (this.debounce !== null) this.deps.scheduler.clearTimeout(this.debounce);
    this.debounce = this.deps.scheduler.setTimeout(() => {
      this.debounce = null;
      void this.load(t, gen);
    }, TRACK_DEBOUNCE_MS);
    this.emit();
  }

  private async load(t: NowPlaying, gen: number, attempt = 0): Promise<void> {
    let doc: LyricsDocument;
    let offset = 0;
    let failed = false;
    try {
      [doc, offset] = await Promise.all([
        this.deps.fetchLyrics(t),
        Promise.resolve(this.deps.loadUserOffset?.(t) ?? 0),
      ]);
    } catch {
      failed = true;
      doc = { kind: 'none', lines: [], plainText: null, offsetMs: 0, source: 'lrclib', lrclibId: null };
    }
    if (gen !== this.generation) return; // la pista cambió mientras se buscaba
    if (failed && attempt === 0) {
      // Timeout o error de red: modo título y un único reintento a los 10 s (8.1).
      this.deps.scheduler.setTimeout(() => {
        if (gen === this.generation) void this.load(t, gen, 1);
      }, LYRICS_RETRY_MS);
    }
    this.lyrics = doc;
    this.loading = false;
    this.userOffset = offset;
    this.sync.userOffsetMs = offset;
    this.rebuildLines();
    this.emit();
  }

  private rebuildLines(): void {
    const doc = this.lyrics;
    if (!doc) this.lines = [];
    else if (doc.kind === 'synced') this.lines = doc.lines;
    else if (doc.kind === 'plain' && this.behavior.experimentalPlain && doc.plainText && this.track?.durationMs)
      this.lines = estimatePlainLines(doc.plainText, this.track.durationMs);
    else this.lines = [];
    this.sync.setLyrics(this.lines, doc?.kind === 'synced' ? doc.offsetMs : 0);
  }

  onTimeline(tl: Timeline): void {
    const prev = this.status;
    this.status = tl.status;
    if (tl.status === 'paused' && prev !== 'paused') this.pausedSince = this.deps.clock.now();
    if (tl.status !== 'paused') this.pausedSince = null;
    this.sync.update(tl);
    this.emit();
  }

  onCleared(): void {
    this.generation++;
    if (this.debounce !== null) this.deps.scheduler.clearTimeout(this.debounce);
    this.debounce = null;
    this.track = null;
    this.key = null;
    this.lyrics = null;
    this.lines = [];
    this.loading = false;
    this.status = 'stopped';
    this.pausedSince = null;
    this.sync.resetTrack(null);
    this.palette = { ...NEUTRAL_PALETTE };
    this.emit();
  }

  onFullscreen(active: boolean): void {
    this.fullscreen = active;
    this.emit();
  }

  toggleHidden(): void {
    this.userHidden = !this.userHidden;
    this.emit();
  }

  setHidden(hidden: boolean): void {
    this.userHidden = hidden;
    this.emit();
  }

  toggleCompact(): void {
    this.userCompact = !this.userCompact;
    this.emit();
  }

  adjustOffset(deltaMs: number): void {
    this.setOffset(this.userOffset + deltaMs);
  }

  resetOffset(): void {
    this.setOffset(0);
  }

  private setOffset(ms: number): void {
    this.userOffset = ms;
    this.sync.userOffsetMs = ms;
    this.flashUntil = this.deps.clock.now() + OFFSET_FLASH_MS;
    if (this.track) this.deps.saveUserOffset?.(this.track, ms);
    this.emit();
    this.deps.scheduler.setTimeout(() => this.emit(), OFFSET_FLASH_MS + 10);
  }

  private decision(now = this.deps.clock.now()) {
    const kind = this.loading ? 'loading' : (this.lyrics?.kind ?? null);
    return decideMode(
      {
        track: this.track,
        status: this.track ? this.status : 'stopped',
        lyrics: kind,
        fullscreen: this.fullscreen,
        userHidden: this.userHidden,
        userCompact: this.userCompact,
        pausedSinceMs: this.pausedSince,
        isAd: this.track ? looksLikeAd(this.track) : false,
        now,
      },
      this.behavior,
    );
  }

  /** Estado completo para pintar un frame. Barato: se puede llamar en cada requestAnimationFrame. */
  snapshot(now = this.deps.clock.now()): IslandSnapshot {
    const d = this.decision(now);
    const timed = hasTimedLines(this.loading ? 'loading' : (this.lyrics?.kind ?? null), this.behavior) && this.lines.length > 0;
    const f = timed ? this.sync.frame(now) : null;
    return {
      mode: d.mode,
      showTitle: d.showTitle,
      track: this.track,
      lyrics: this.lyrics ? { ...this.lyrics, lines: this.lines } : null,
      activeLineIndex: f?.activeLineIndex ?? -1,
      lineProgress: f?.lineProgress ?? 0,
      wordIndex: f?.wordIndex ?? -1,
      wordProgress: f?.wordProgress ?? 0,
      interlude: f?.interlude ?? null,
      positionMs: f?.positionMs ?? this.sync.position(now),
      palette: this.palette,
      lyricsLoading: this.loading,
      userOffsetMs: this.userOffset,
      offsetFlash: now < this.flashUntil ? formatOffset(this.userOffset) : null,
      status: this.track ? this.status : 'stopped',
      estimatedLines: timed && this.lyrics?.kind === 'plain',
    };
  }

  /** ¿Hace falta animar por frame? (solo reproduciendo y visible: en pausa 0 % de CPU). */
  needsAnimation(now = this.deps.clock.now()): boolean {
    const m = this.decision(now).mode;
    return this.status === 'playing' && (m === 'expanded' || m === 'compact');
  }

  dispose(): void {
    if (this.debounce !== null) this.deps.scheduler.clearTimeout(this.debounce);
    if (this.recheck !== null) this.deps.scheduler.clearTimeout(this.recheck);
    this.listeners.clear();
  }
}
