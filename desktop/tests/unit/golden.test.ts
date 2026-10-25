// Golden files compartidos con Kotlin (sección 13.2). Regenerar: pnpm golden
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vibrant } from 'node-vibrant/node';
import { describe, expect, it } from 'vitest';
import { buildPalette, toSwatches } from '../../src/core/color';
import { IslandController } from '../../src/core/controller';
import { parseLrc } from '../../src/core/lrc';
import { parseLyricsfile } from '../../src/core/lyricsfile';
import { LyricsRepository } from '../../src/core/lyricsRepo';
import { cacheKeySource, normalizeQuery, scoreCandidate, type Candidate } from '../../src/core/matcher';
import { computeFrame } from '../../src/core/sync';
import type { LyricLine, NowPlaying, Timeline } from '../../src/core/types';
import { JsonLyricsCache } from '../../src/main/cache';
import { fixtureHttp, FIXTURES } from '../helpers/fixtureLrclib';

const UPDATE = process.env.UPDATE_GOLDEN === '1';
const EXPECTED = join(FIXTURES, 'expected');
const r4 = (n: number) => Math.round(n * 10000) / 10000;

function golden(rel: string, actual: unknown) {
  const file = join(EXPECTED, rel);
  const text = JSON.stringify(actual, null, 1) + '\n';
  if (UPDATE || !existsSync(file)) {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  }
  expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

export function lrcProbes(lines: LyricLine[]): number[] {
  const set = new Set<number>([0]);
  for (const l of lines) {
    set.add(Math.max(0, l.startMs - 1));
    set.add(l.startMs);
    set.add(l.startMs + Math.floor((l.endMs - l.startMs) / 2));
  }
  if (lines.length) set.add(lines[lines.length - 1].endMs + 1000);
  return [...set].sort((a, b) => a - b);
}

describe('golden: LRC', () => {
  const files = readdirSync(join(FIXTURES, 'lrc')).filter((f) => f.endsWith('.lrc'));
  it('corpus ≥ 40 archivos', () => expect(files.length).toBeGreaterThanOrEqual(40));
  it.each(files)('%s', (f) => {
    const p = parseLrc(readFileSync(join(FIXTURES, 'lrc', f), 'utf8'), f === 'last-line-short.lrc' ? 3500 : null);
    golden(`lrc/${f.replace(/\.lrc$/, '.json')}`, {
      offsetMs: p.offsetMs,
      meta: p.meta,
      lines: p.lines.map((l) => ({
        startMs: l.startMs,
        endMs: l.endMs,
        text: l.text,
        isInterlude: l.isInterlude,
        words: l.words.map((w) => [w.text, w.startMs, w.endMs, w.estimated]),
      })),
      probes: lrcProbes(p.lines).map((pos) => {
        const fr = computeFrame(p.lines, pos);
        return {
          pos,
          line: fr.activeLineIndex,
          lineProgress: r4(fr.lineProgress),
          word: fr.wordIndex,
          wordProgress: r4(fr.wordProgress),
          interlude: fr.interlude ? { progress: r4(fr.interlude.progress), beforeFirst: fr.interlude.beforeFirst } : null,
        };
      }),
    });
  });
});

describe('golden: lyricsfile (tiempos por palabra)', () => {
  const files = readdirSync(join(FIXTURES, 'lyricsfile')).filter((f) => f.endsWith('.yaml'));
  it.each(files)('%s', (f) => {
    const lines = parseLyricsfile(readFileSync(join(FIXTURES, 'lyricsfile', f), 'utf8'), null);
    golden(`lyricsfile/${f.replace(/\.yaml$/, '.json')}`, {
      lines:
        lines?.map((l) => ({
          startMs: l.startMs,
          endMs: l.endMs,
          text: l.text,
          isInterlude: l.isInterlude,
          words: l.words.map((w) => [w.text, w.startMs, w.endMs, w.estimated]),
        })) ?? null,
    });
  });
});

describe('golden: matcher', () => {
  it('normalización, claves de caché y puntuaciones', () => {
    const titles: Array<{ title: string; artist: string }> = JSON.parse(readFileSync(join(FIXTURES, 'matcher', 'titles.json'), 'utf8'));
    const keys = titles.map((t, i) => {
      const track = { title: t.title, artist: t.artist, album: null, durationMs: 180_000 + i * 1000 };
      return { ...normalizeQuery(track), cacheKeySource: cacheKeySource(track) };
    });
    const scores: Array<{ file: string; id: number; score: number }> = [];
    for (const f of readdirSync(join(FIXTURES, 'lrclib-responses')).filter((x) => x.startsWith('search-'))) {
      const fx = JSON.parse(readFileSync(join(FIXTURES, 'lrclib-responses', f), 'utf8'));
      const query = { title: fx.match.track_name, artist: 'Los Fixtures', durationMs: 205_000 };
      for (const c of fx.body as Candidate[]) {
        if (c && typeof c === 'object' && typeof c.id === 'number' && typeof c.trackName === 'string')
          scores.push({ file: f, id: c.id, score: r4(scoreCandidate(query, c)) });
      }
    }
    golden('matcher.json', { keys, scores });
  });
});

describe('golden: paletas de las 200 carátulas', () => {
  it('swatches de node-vibrant → paleta', async () => {
    const files = readdirSync(join(FIXTURES, 'artwork')).filter((f) => f.endsWith('.png'));
    const out = [];
    for (const f of files) {
      const swatches = toSwatches(await Vibrant.from(join(FIXTURES, 'artwork', f)).getPalette());
      out.push({ file: f, swatches, palette: buildPalette(swatches) });
    }
    golden('palettes.json', out);
  }, 60_000);
});

// ---------- sesiones grabadas → estados de la isla ----------

interface SessionEvent {
  at: number;
  msg: { type: string } & Record<string, unknown>;
}

const T0 = 1761340000000;

export async function replaySession(events: SessionEvent[], stepMs = 250, sampleEveryMs = 1000, tailMs = 20_000) {
  let now = T0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const repo = new LyricsRepository({
    http: fixtureHttp(),
    cache: new JsonLyricsCache(null),
    hash: (s) => createHash('sha1').update(s).digest('hex'),
    now: () => now,
    sleep: async () => {},
  });
  const c = new IslandController({
    clock: { now: () => now },
    scheduler: {
      setTimeout: (fn, ms) => {
        timers.push({ at: now + ms, fn, id: nextId });
        return nextId++;
      },
      clearTimeout: (h) => {
        const i = timers.findIndex((t) => t.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
    },
    fetchLyrics: (t) => repo.get(t),
  });
  const end = Math.max(...events.map((e) => e.at)) + tailMs;
  const samples = [];
  let ei = 0;
  for (let t = 0; t <= end; t += stepMs) {
    now = T0 + t;
    while (ei < events.length && events[ei].at <= t) {
      const m = events[ei++].msg;
      if (m.type === 'track') c.onTrack(m as unknown as NowPlaying);
      else if (m.type === 'timeline') c.onTimeline(m as unknown as Timeline);
      else if (m.type === 'cleared') c.onCleared();
      else if (m.type === 'fullscreen') c.onFullscreen(m.active === true);
    }
    timers.sort((a, b) => a.at - b.at);
    while (timers.length && timers[0].at <= now) timers.shift()!.fn();
    await flush();
    if (t % sampleEveryMs === 0) {
      const s = c.snapshot();
      samples.push({ t, mode: s.mode, title: s.track?.title ?? null, kind: s.lyrics?.kind ?? null, line: s.activeLineIndex, word: s.wordIndex, pos: Math.round(s.positionMs) });
    }
  }
  c.dispose();
  return samples;
}

describe('golden: sesiones grabadas', () => {
  const files = readdirSync(join(FIXTURES, 'sessions')).filter((f) => f.endsWith('.ndjson'));
  it('≥ 10 sesiones', () => expect(files.length).toBeGreaterThanOrEqual(10));
  it.each(files)('%s', async (f) => {
    const events: SessionEvent[] = readFileSync(join(FIXTURES, 'sessions', f), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    golden(`sessions/${f.replace(/\.ndjson$/, '.json')}`, await replaySession(events));
  });
});
