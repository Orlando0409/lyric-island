import { describe, expect, it, vi } from 'vitest';
import { NEUTRAL_PALETTE } from '../../src/core/color';
import { formatOffset, IslandController, LYRICS_RETRY_MS, TRACK_DEBOUNCE_MS, trackKey } from '../../src/core/controller';
import { buildDocument } from '../../src/core/lrc';
import { DEFAULT_BEHAVIOR } from '../../src/core/stateMachine';
import type { LyricsDocument, NowPlaying } from '../../src/core/types';

/** Reloj y temporizadores falsos y deterministas. */
class FakeTime {
  t = 1_000_000;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private next = 1;
  clock = { now: () => this.t };
  scheduler = {
    setTimeout: (fn: () => void, ms: number) => {
      const id = this.next++;
      this.timers.push({ at: this.t + ms, fn, id });
      return id;
    },
    clearTimeout: (h: unknown) => {
      this.timers = this.timers.filter((x) => x.id !== h);
    },
  };
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const due = this.timers[0];
      if (!due || due.at > end) break;
      this.timers.shift();
      this.t = due.at;
      due.fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.t = end;
    await new Promise((r) => setTimeout(r, 0));
  }
}

const track = (title = 'Isla de Luz'): NowPlaying => ({
  sourceAppId: 'Spotify.exe',
  title,
  artist: 'Los Fixtures',
  album: 'Pruebas',
  durationMs: 60_000,
  artworkHash: null,
});

const synced = (): LyricsDocument =>
  buildDocument({
    synced: '[00:01.00]Uno dos tres\n[00:05.00]Cuatro cinco\n[00:09.00]Seis',
    plain: 'Uno dos tres\nCuatro cinco\nSeis',
    instrumental: false,
    durationMs: 60_000,
    source: 'lrclib',
    lrclibId: 1,
  });

function setup(fetchLyrics = vi.fn(async (_t: NowPlaying) => synced())) {
  const time = new FakeTime();
  const saved: number[] = [];
  const c = new IslandController({
    clock: time.clock,
    scheduler: time.scheduler,
    fetchLyrics,
    loadUserOffset: () => 0,
    saveUserOffset: (_t, ms) => saved.push(ms),
  });
  return { time, c, fetchLyrics, saved };
}

const playing = (positionMs: number, at: number) => ({ positionMs, updatedAtMs: at, rate: 1, status: 'playing' as const });

describe('IslandController', () => {
  it('flujo completo: compacta cargando → expandida con letra → línea activa', async () => {
    const { time, c, fetchLyrics } = setup();
    const listener = vi.fn();
    c.subscribe(listener);
    expect(c.snapshot().mode).toBe('hidden');
    c.onTrack(track());
    c.onTimeline(playing(0, time.t));
    expect(c.snapshot()).toMatchObject({ mode: 'compact', showTitle: true, lyricsLoading: true });
    expect(fetchLyrics).not.toHaveBeenCalled();
    await time.advance(TRACK_DEBOUNCE_MS);
    expect(fetchLyrics).toHaveBeenCalledTimes(1);
    expect(c.snapshot().mode).toBe('expanded');
    await time.advance(1600);
    const s = c.snapshot();
    expect(s.activeLineIndex).toBe(0);
    expect(s.wordIndex).toBeGreaterThanOrEqual(0);
    expect(c.needsAnimation()).toBe(true);
    expect(listener).toHaveBeenCalled();
  });

  it('debounce: saltar canciones rápido solo busca la última', async () => {
    const { time, c, fetchLyrics } = setup();
    c.onTrack(track('A'));
    await time.advance(100);
    c.onTrack(track('B'));
    await time.advance(100);
    c.onTrack(track('C'));
    await time.advance(TRACK_DEBOUNCE_MS);
    expect(fetchLyrics).toHaveBeenCalledTimes(1);
    expect(fetchLyrics.mock.calls[0][0].title).toBe('C');
  });

  it('descarta respuestas de una pista anterior', async () => {
    let resolveA: (d: LyricsDocument) => void = () => {};
    const fetchLyrics = vi.fn((t: NowPlaying) =>
      t.title === 'A' ? new Promise<LyricsDocument>((r) => (resolveA = r)) : Promise.resolve(buildDocument({ synced: null, plain: null, instrumental: true, durationMs: null, source: 'lrclib', lrclibId: 2 })),
    );
    const { time, c } = setup(fetchLyrics);
    c.onTrack(track('A'));
    c.onTimeline(playing(0, time.t));
    await time.advance(TRACK_DEBOUNCE_MS);
    c.onTrack(track('B'));
    await time.advance(TRACK_DEBOUNCE_MS);
    resolveA(synced());
    await time.advance(1);
    expect(c.snapshot().lyrics?.kind).toBe('instrumental');
    expect(c.snapshot().track?.title).toBe('B');
  });

  it('la misma pista (p. ej. llega la carátula) no vuelve a buscar', async () => {
    const { time, c, fetchLyrics } = setup();
    c.onTrack(track());
    await time.advance(TRACK_DEBOUNCE_MS);
    c.onTrack({ ...track(), artworkHash: 'abc' });
    await time.advance(TRACK_DEBOUNCE_MS);
    expect(fetchLyrics).toHaveBeenCalledTimes(1);
    expect(c.snapshot().track?.artworkHash).toBe('abc');
  });

  it('pausa → atenuada → compacta a los 10 s → expandida al reanudar', async () => {
    const { time, c } = setup();
    c.onTrack(track());
    c.onTimeline(playing(0, time.t));
    await time.advance(TRACK_DEBOUNCE_MS);
    c.onTimeline({ positionMs: 3000, updatedAtMs: time.t, rate: 0, status: 'paused' });
    expect(c.snapshot().mode).toBe('paused');
    expect(c.needsAnimation()).toBe(false);
    const listener = vi.fn();
    c.subscribe(listener);
    await time.advance(10_000);
    expect(listener).toHaveBeenCalled(); // re-evaluación automática
    expect(c.snapshot().mode).toBe('compact');
    c.onTimeline(playing(3000, time.t));
    expect(c.snapshot().mode).toBe('expanded');
  });

  it('error de red: modo título y un único reintento a los 10 s', async () => {
    const fetchLyrics = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(synced());
    const { time, c } = setup(fetchLyrics);
    c.onTrack(track());
    c.onTimeline(playing(0, time.t));
    await time.advance(TRACK_DEBOUNCE_MS);
    expect(c.snapshot()).toMatchObject({ mode: 'compact', showTitle: true });
    await time.advance(LYRICS_RETRY_MS);
    expect(fetchLyrics).toHaveBeenCalledTimes(2);
    expect(c.snapshot().mode).toBe('expanded');
  });

  it('offset manual: ajusta, guarda, muestra el aviso 1.5 s y se reinicia', async () => {
    const { time, c, saved } = setup();
    c.onTrack(track());
    c.onTimeline(playing(1000, time.t));
    await time.advance(TRACK_DEBOUNCE_MS);
    const before = c.snapshot().positionMs;
    c.adjustOffset(100);
    c.adjustOffset(100);
    const s = c.snapshot();
    expect(s.userOffsetMs).toBe(200);
    expect(s.positionMs).toBe(before + 200);
    expect(s.offsetFlash).toBe('+200 ms');
    await time.advance(1600);
    expect(c.snapshot().offsetFlash).toBeNull();
    c.resetOffset();
    expect(saved).toEqual([100, 200, 0]);
  });

  it('ocultar, compactar, pantalla completa y cleared', async () => {
    const { time, c } = setup();
    c.onTrack(track());
    c.onTimeline(playing(0, time.t));
    await time.advance(TRACK_DEBOUNCE_MS);
    c.toggleHidden();
    expect(c.snapshot().mode).toBe('hidden');
    c.setHidden(false);
    c.toggleCompact();
    expect(c.snapshot().mode).toBe('compact');
    c.toggleCompact();
    c.onFullscreen(true);
    expect(c.snapshot().mode).toBe('hidden');
    c.onFullscreen(false);
    expect(c.snapshot().mode).toBe('expanded');
    c.setPalette({ ...NEUTRAL_PALETTE, background: '#112233' });
    expect(c.snapshot().palette.background).toBe('#112233');
    c.onCleared();
    expect(c.snapshot()).toMatchObject({ mode: 'hidden', track: null, status: 'stopped' });
    expect(c.snapshot().palette).toEqual(NEUTRAL_PALETTE);
    c.dispose();
  });

  it('letra plana experimental reparte líneas estimadas', async () => {
    const fetchLyrics = vi.fn(async () =>
      buildDocument({ synced: null, plain: 'uno\ndos\ntres', instrumental: false, durationMs: 60_000, source: 'lrclib', lrclibId: 3 }),
    );
    const { time, c } = setup(fetchLyrics);
    c.onTrack(track());
    c.onTimeline(playing(30_000, time.t));
    await time.advance(TRACK_DEBOUNCE_MS);
    expect(c.snapshot().mode).toBe('compact');
    c.setBehavior({ ...DEFAULT_BEHAVIOR, experimentalPlain: true });
    const s = c.snapshot();
    expect(s.mode).toBe('expanded');
    expect(s.estimatedLines).toBe(true);
    expect(s.lyrics?.lines).toHaveLength(3);
  });

  it('helpers', () => {
    expect(formatOffset(200)).toBe('+200 ms');
    expect(formatOffset(-100)).toBe('−100 ms');
    expect(formatOffset(0)).toBe('±0 ms');
    expect(trackKey(track())).toContain('Isla de Luz');
  });
});
