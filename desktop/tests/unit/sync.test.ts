import { describe, expect, it } from 'vitest';
import { parseLrc } from '../../src/core/lrc';
import { computeFrame, findActiveLine, interpolate, PositionTracker, SyncEngine, sungEndMs } from '../../src/core/sync';
import type { Timeline } from '../../src/core/types';

class FakeClock {
  t = 1_000_000;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

const tl = (positionMs: number, updatedAtMs: number, status: Timeline['status'] = 'playing', rate = 1): Timeline => ({
  positionMs,
  updatedAtMs,
  rate,
  status,
});

const LRC = `[00:05.00]Primera línea de la canción
[00:10.00]Segunda línea
[00:12.00]
[00:30.00]Después del solo largo
[00:34.00]Final`;
const lines = parseLrc(LRC).lines;

describe('interpolate', () => {
  it('avanza con el reloj al reproducir', () => {
    expect(interpolate(tl(1000, 0), 500)).toBe(1500);
  });
  it('no avanza en pausa', () => {
    expect(interpolate(tl(1000, 0, 'paused'), 5000)).toBe(1000);
  });
  it('respeta la velocidad', () => {
    expect(interpolate(tl(0, 0, 'playing', 1.5), 2000)).toBe(3000);
  });
  it('updatedAtMs en el futuro no retrocede', () => {
    expect(interpolate(tl(5000, 10_000), 0)).toBe(5000);
  });
});

describe('PositionTracker', () => {
  it('init, deriva suave y seek', () => {
    const c = new FakeClock();
    const p = new PositionTracker(c);
    expect(p.rawPosition()).toBe(0);
    expect(p.update(tl(0, c.t))).toBe('init');
    c.advance(10_000);
    expect(p.rawPosition()).toBe(10_000);
    // el SO reporta 10 120: diferencia de 120 ms → corrección suave, sin salto visible
    expect(p.update(tl(10_120, c.t))).toBe('drift');
    expect(p.rawPosition()).toBe(10_000);
    c.advance(150);
    expect(p.rawPosition()).toBeCloseTo(10_120 + 150 - 60, 5);
    c.advance(150);
    expect(p.rawPosition()).toBe(10_420);
    // salto de 20 s → seek directo
    expect(p.update(tl(30_000, c.t))).toBe('seek');
    expect(p.rawPosition()).toBe(30_000);
  });

  it('cambio de estado sin corrección', () => {
    const c = new FakeClock();
    const p = new PositionTracker(c);
    p.update(tl(0, c.t));
    c.advance(5000);
    expect(p.update(tl(5010, c.t, 'paused'))).toBe('status');
    c.advance(5000);
    expect(p.rawPosition()).toBe(5010);
    expect(p.timeline?.status).toBe('paused');
    p.reset();
    expect(p.timeline).toBeNull();
  });

  it('repetir una canción se detecta como seek hacia atrás', () => {
    const c = new FakeClock();
    const p = new PositionTracker(c);
    p.update(tl(39_000, c.t));
    c.advance(1000);
    expect(p.update(tl(0, c.t))).toBe('seek');
  });
});

describe('findActiveLine', () => {
  it('antes de la primera línea → -1', () => {
    expect(findActiveLine(lines, 0)).toBe(-1);
    expect(findActiveLine([], 100)).toBe(-1);
  });
  it('búsqueda binaria y por pista', () => {
    expect(findActiveLine(lines, 10_500)).toBe(1);
    expect(findActiveLine(lines, 10_500, 1)).toBe(1);
    expect(findActiveLine(lines, 10_500, 0)).toBe(1);
    expect(findActiveLine(lines, 31_000, 0)).toBe(3);
    expect(findActiveLine(lines, 99_000)).toBe(4);
    expect(findActiveLine(lines, 5000)).toBe(0);
  });
  it('coincide con una búsqueda lineal en todo el rango', () => {
    for (let pos = -100; pos < 40_000; pos += 37) {
      let expected = -1;
      for (let i = 0; i < lines.length; i++) if (lines[i].startMs <= pos) expected = i;
      expect(findActiveLine(lines, pos, (pos * 7) % 5)).toBe(expected);
    }
  });
});

describe('computeFrame', () => {
  it('intro larga (> 3 s) muestra interludio con cuenta regresiva', () => {
    const f = computeFrame(lines, 2500);
    expect(f.activeLineIndex).toBe(-1);
    expect(f.interlude).toEqual({ progress: 0.5, beforeFirst: true });
  });
  it('intro corta no muestra interludio', () => {
    const short = parseLrc('[00:02.00]Hola').lines;
    expect(computeFrame(short, 1000).interlude).toBeNull();
  });
  it('progreso de línea y palabra', () => {
    const f = computeFrame(lines, 5000);
    expect(f).toMatchObject({ activeLineIndex: 0, lineProgress: 0, wordIndex: 0, wordProgress: 0, interlude: null });
    const l0 = lines[0];
    const w1 = l0.words[1];
    const mid = (w1.startMs + w1.endMs) / 2;
    const g = computeFrame(lines, mid);
    expect(g.wordIndex).toBe(1);
    expect(g.wordProgress).toBeCloseTo(0.5, 2);
  });
  it('hueco ≥ 5 s tras la parte cantada → interludio', () => {
    // la línea vacía de 00:12 dura hasta 00:30
    const f = computeFrame(lines, 21_000);
    expect(f.activeLineIndex).toBe(2);
    expect(f.interlude).toEqual({ progress: 0.5, beforeFirst: false });
    expect(sungEndMs(lines[2])).toBe(12_000);
  });
  it('línea con palabras de duración cero', () => {
    const dup = parseLrc('[00:05.00]A\n[00:05.00]B\n[00:09.00]C').lines;
    const f = computeFrame(dup, 5000);
    expect(f.activeLineIndex).toBe(1);
    expect(computeFrame(dup, 5000, -1).lineProgress).toBeGreaterThanOrEqual(0);
    expect(computeFrame([{ ...dup[0], endMs: dup[0].startMs, words: [{ text: 'A', startMs: 5000, endMs: 5000, estimated: true }] }], 5000)).toMatchObject({
      lineProgress: 1,
      wordProgress: 1,
    });
  });
  it('después de la última línea', () => {
    const f = computeFrame(lines, 99_000);
    expect(f.activeLineIndex).toBe(4);
    expect(f.lineProgress).toBe(1);
    expect(f.interlude).toBeNull();
  });
});

describe('SyncEngine', () => {
  it('aplica offsets LRC + usuario y limita a la duración', () => {
    const c = new FakeClock();
    const s = new SyncEngine(c);
    s.resetTrack(40_000);
    s.setLyrics(lines, 150);
    s.userOffsetMs = 100;
    s.update(tl(4800, c.t));
    expect(s.position()).toBe(5050);
    expect(s.frame().activeLineIndex).toBe(0);
    c.advance(60_000);
    expect(s.position()).toBe(40_000);
  });
  it('no baja de 0 con offset negativo', () => {
    const c = new FakeClock();
    const s = new SyncEngine(c);
    s.setLyrics(lines, -500);
    s.update(tl(100, c.t));
    expect(s.position()).toBe(0);
  });
  it('pausa: la posición no avanza; seek reinicia la pista', () => {
    const c = new FakeClock();
    const s = new SyncEngine(c);
    s.setLyrics(lines, 0);
    s.update(tl(10_000, c.t));
    expect(s.frame().activeLineIndex).toBe(1);
    expect(s.update(tl(10_000, c.t, 'paused'))).toBe('status');
    c.advance(30_000);
    expect(s.frame().activeLineIndex).toBe(1);
    expect(s.update(tl(31_000, c.t))).toBe('seek');
    expect(s.frame().activeLineIndex).toBe(3);
    expect(s.update(tl(1_000, c.t))).toBe('seek');
    expect(s.frame().activeLineIndex).toBe(-1);
  });
  it('cambio de pista a mitad de línea reinicia todo', () => {
    const c = new FakeClock();
    const s = new SyncEngine(c);
    s.setLyrics(lines, 0);
    s.update(tl(10_500, c.t));
    s.frame();
    s.resetTrack(null);
    expect(s.lines).toEqual([]);
    expect(s.update(tl(0, c.t))).toBe('init');
    expect(s.frame().activeLineIndex).toBe(-1);
  });
  it('velocidad 1.5×', () => {
    const c = new FakeClock();
    const s = new SyncEngine(c);
    s.setLyrics(lines, 0);
    s.update(tl(0, c.t, 'playing', 1.5));
    c.advance(10_000);
    expect(s.position()).toBe(15_000);
  });
});
