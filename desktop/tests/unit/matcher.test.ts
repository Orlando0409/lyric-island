import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cacheKeySource,
  cleanTitle,
  durationSimilarity,
  jaroWinkler,
  looksLikeAd,
  normalizeForCompare,
  normalizeQuery,
  pickBest,
  primaryArtist,
  scoreCandidate,
  splitYouTubeStyle,
  textSimilarity,
  tokenSetRatio,
  type Candidate,
} from '../../src/core/matcher';

const titles: Array<{ title: string; artist: string; expectTitle: string; expectArtist: string }> = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'matcher', 'titles.json'), 'utf8'),
);

describe('normalización (50+ títulos reales)', () => {
  it('tiene al menos 50 casos', () => expect(titles.length).toBeGreaterThanOrEqual(50));
  it.each(titles)('$title / $artist', ({ title, artist, expectTitle, expectArtist }) => {
    expect(normalizeQuery({ title, artist, album: null, durationMs: null })).toEqual({ title: expectTitle, artist: expectArtist });
  });
});

describe('helpers', () => {
  it('normalizeForCompare quita diacríticos y unifica comillas y guiones', () => {
    expect(normalizeForCompare('  Corazón  Partío ')).toBe('corazon partio');
    expect(normalizeForCompare('Don’t “Stop” – Now')).toBe(`don't "stop" - now`);
  });
  it('cleanTitle no quita Live ni Remix', () => {
    expect(cleanTitle('Song - Live')).toBe('Song - Live');
    expect(cleanTitle('Song (Remix)')).toBe('Song (Remix)');
  });
  it('primaryArtist', () => {
    expect(primaryArtist('A, B & C')).toBe('A');
    expect(primaryArtist('Solo')).toBe('Solo');
  });
  it('splitYouTubeStyle sin guion', () => {
    expect(splitYouTubeStyle('Canción', 'Canal - Topic')).toEqual({ title: 'Canción', artist: 'Canal' });
  });
});

describe('similitud', () => {
  it('jaroWinkler', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 3);
    expect(jaroWinkler('', 'a')).toBe(0);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
    expect(jaroWinkler('igual', 'igual')).toBe(1);
  });
  it('tokenSetRatio es insensible al orden y a subconjuntos', () => {
    expect(tokenSetRatio('rhapsody bohemian', 'Bohemian Rhapsody')).toBe(1);
    expect(tokenSetRatio('Bohemian Rhapsody', 'Bohemian Rhapsody Live at Wembley')).toBe(1);
    expect(tokenSetRatio('', '')).toBe(1);
    expect(tokenSetRatio('', 'a')).toBe(0);
    expect(tokenSetRatio('uno dos', 'tres cuatro')).toBeLessThan(0.8);
  });
  it('textSimilarity', () => {
    expect(textSimilarity('Corazón', 'corazon')).toBe(1);
  });
  it('durationSimilarity decae de 2 s a 10 s', () => {
    expect(durationSimilarity(100_000, 102_000)).toBe(1);
    expect(durationSimilarity(100_000, 106_000)).toBe(0.5);
    expect(durationSimilarity(100_000, 110_000)).toBe(0);
    expect(durationSimilarity(null, 1)).toBe(0.5);
  });
});

const cand = (over: Partial<Candidate>): Candidate => ({
  id: 1,
  trackName: 'Faro',
  artistName: 'Los Fixtures',
  albumName: null,
  duration: 205,
  instrumental: false,
  plainLyrics: 'x',
  syncedLyrics: '[00:01.00]x',
  ...over,
});

describe('puntuación', () => {
  const q = { title: 'Faro', artist: 'Los Fixtures', durationMs: 205_000 };
  it('coincidencia perfecta = 1', () => {
    expect(scoreCandidate(q, cand({}))).toBeCloseTo(1, 5);
  });
  it('penaliza duración > 15 s', () => {
    expect(scoreCandidate(q, cand({ duration: 260 }))).toBeLessThan(0.75);
  });
  it('sin artista (Spotify desktop en SMTC): usa el álbum o un 0.5 neutro', () => {
    const noArtist = { title: 'Faro', artist: '', durationMs: 205_000 };
    expect(scoreCandidate(noArtist, cand({}))).toBeLessThan(0.75 + 0.15); // sin álbum: 0.5 neutro
    expect(scoreCandidate(noArtist, cand({}))).toBeGreaterThanOrEqual(0.75);
    expect(scoreCandidate({ ...noArtist, album: 'Costa' }, cand({ albumName: 'Costa' }))).toBeCloseTo(1, 5);
    expect(scoreCandidate({ ...noArtist, album: 'Costa' }, cand({ albumName: 'Otro Disco Distinto' }))).toBeLessThan(0.9);
    expect(pickBest({ ...noArtist, album: 'Costa' }, [cand({ id: 9, albumName: 'Costa' })])?.candidate.id).toBe(9);
  });
  it('elige el mejor y aplica el umbral', () => {
    const best = pickBest(q, [cand({ id: 1, syncedLyrics: null }), cand({ id: 2 }), cand({ id: 3, trackName: 'Otra Cosa', artistName: 'X' })]);
    expect(best?.candidate.id).toBe(2);
    expect(pickBest(q, [cand({ trackName: 'Nada que ver', artistName: 'Nadie', duration: 500 })])).toBeNull();
    expect(pickBest(q, [])).toBeNull();
  });
});

describe('caché y anuncios', () => {
  it('clave estable ante ruido y diacríticos', () => {
    const a = cacheKeySource({ title: 'Corazón - Remastered 2011', artist: 'Ñandú, Otro', album: null, durationMs: 200_400 });
    const b = cacheKeySource({ title: 'corazon', artist: 'nandu', album: 'X', durationMs: 199_600 });
    expect(a).toBe(b);
    expect(a).toBe('nandu|corazon|100');
    expect(cacheKeySource({ title: 'a', artist: 'b', album: null, durationMs: null })).toBe('b|a|na');
  });
  it('detecta anuncios de Spotify Free', () => {
    const base = { title: 'Canción', artist: 'Artista', album: 'Álbum', durationMs: 200_000, sourceAppId: 'Spotify.exe' };
    expect(looksLikeAd(base)).toBe(false);
    expect(looksLikeAd({ ...base, title: 'Advertisement' })).toBe(true);
    expect(looksLikeAd({ ...base, artist: 'Spotify' })).toBe(true);
    expect(looksLikeAd({ ...base, album: null, durationMs: 30_000 })).toBe(true);
    expect(looksLikeAd({ ...base, album: null, durationMs: 30_000, sourceAppId: 'vlc.exe' })).toBe(false);
  });
});
