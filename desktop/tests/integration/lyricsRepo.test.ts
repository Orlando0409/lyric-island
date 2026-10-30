import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LyricsRepository, NEGATIVE_TTL_MS, POSITIVE_TTL_MS, toCandidate, TransientLyricsError, type HttpGet } from '../../src/core/lyricsRepo';
import type { QueryTrack } from '../../src/core/matcher';
import { JsonLyricsCache } from '../../src/main/cache';
import { fixtureHttp, startFixtureServer } from '../helpers/fixtureLrclib';

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

function repo(http: HttpGet = fixtureHttp(), now = { t: 1_000_000 }) {
  const cache = new JsonLyricsCache(null);
  const sleep = vi.fn(async () => {});
  const r = new LyricsRepository({ http, cache, hash: sha1, now: () => now.t, sleep });
  return { r, cache, sleep, now };
}

const q = (title: string, artist: string, durationS: number | null = 200, album: string | null = null): QueryTrack => ({
  title,
  artist,
  album,
  durationMs: durationS === null ? null : durationS * 1000,
});

describe('LyricsRepository ↔ LRCLIB grabado', () => {
  it('/api/get exacto → letra sincronizada', async () => {
    const log: string[] = [];
    const { r } = repo(fixtureHttp(log));
    const doc = await r.get(q('Isla de Luz', 'Los Fixtures', 210, 'Pruebas Unitarias'));
    expect(doc).toMatchObject({ kind: 'synced', source: 'lrclib', lrclibId: 1001 });
    expect(doc.lines.length).toBeGreaterThan(3);
    // /get + una búsqueda de versiones con tiempos por palabra (como mucho 2 por pista nueva).
    expect(log).toHaveLength(2);
    expect(log[0]).toContain('/get?artist_name=Los%20Fixtures&track_name=Isla%20de%20Luz&album_name=Pruebas%20Unitarias&duration=210');
    expect(log[1]).toContain('/search?');
  });

  it('segunda vez sale de caché (0 peticiones)', async () => {
    const log: string[] = [];
    const { r } = repo(fixtureHttp(log));
    await r.get(q('Isla de Luz', 'Los Fixtures', 210));
    const doc = await r.get(q('Isla de Luz', 'Los Fixtures', 210));
    expect(doc.source).toBe('cache');
    expect(log).toHaveLength(2); // las 2 de la primera vez; la segunda no pide nada
  });

  it('404 → reintenta normalizado (Remastered)', async () => {
    const log: string[] = [];
    const { r } = repo(fixtureHttp(log));
    const doc = await r.get(q('Canción Vieja - Remastered 2011', 'Banda Mock', 199));
    expect(doc.lrclibId).toBe(1005);
    expect(log).toHaveLength(2);
  });

  it('404 → normalizado (feat. y varios artistas)', async () => {
    const { r } = repo();
    expect((await r.get(q('Juntos (feat. Invitada)', 'Banda Mock, Invitada', 222))).lrclibId).toBe(1006);
  });

  it('404 → /api/search elige la versión de estudio frente a la "Live"', async () => {
    const { r } = repo();
    expect((await r.get(q('Escondida', 'Banda Mock', 201))).lrclibId).toBe(2002);
  });

  it('search: prefiere la que tiene letra sincronizada', async () => {
    const { r } = repo();
    expect((await r.get(q('Faro', 'Los Fixtures', 204))).lrclibId).toBe(2007);
  });

  it('search: rechaza artista distinto con duración distinta y guarda caché negativa', async () => {
    const log: string[] = [];
    const { r, now } = repo(fixtureHttp(log));
    expect((await r.get(q('Lluvia', 'Los Fixtures', 200))).kind).toBe('none');
    const n = log.length;
    expect((await r.get(q('Lluvia', 'Los Fixtures', 200))).source).toBe('cache');
    expect(log.length).toBe(n);
    now.t += NEGATIVE_TTL_MS + 1;
    await r.get(q('Lluvia', 'Los Fixtures', 200));
    expect(log.length).toBeGreaterThan(n);
  });

  it('search: penalización por duración (> 15 s)', async () => {
    const { r } = repo();
    expect((await r.get(q('Larga Versión', 'Los Fixtures', 200))).kind).toBe('none');
  });

  it('search: ignora elementos malformados', async () => {
    const { r } = repo();
    expect((await r.get(q('Basura', 'Los Fixtures', 100))).lrclibId).toBe(2008);
  });

  it('YouTube: "Artista - Canción" con el canal como artista', async () => {
    const { r } = repo();
    expect((await r.get(q('Banda Mock - Marea Alta', 'Banda Mock', 230))).lrclibId).toBe(2009);
  });

  it('texto plano, instrumental, CJK y Unicode', async () => {
    const { r } = repo();
    expect((await r.get(q('Solo Texto', 'Los Fixtures', 200))).kind).toBe('plain');
    expect((await r.get(q('Interludio Azul', 'Cuarteto Stub', 240))).kind).toBe('instrumental');
    expect((await r.get(q('夜空の島', 'テスト', 180))).kind).toBe('synced');
    expect((await r.get(q('Corazón Áspero', 'Ñandú', 190))).lrclibId).toBe(1008);
  });

  it('tiempos por palabra: /get con lyricsfile → palabras reales (no estimadas)', async () => {
    const log: string[] = [];
    const { r } = repo(fixtureHttp(log));
    const doc = await r.get(q('Palabra Exacta', 'Los Fixtures', 40, 'Pruebas Unitarias'));
    expect(doc).toMatchObject({ kind: 'synced', lrclibId: 3001 });
    expect(doc.lines[0].words.every((w) => !w.estimated)).toBe(true);
    expect(log).toHaveLength(1); // ya trae palabras: no hace falta buscar otra versión
    // Desde la caché también se usan los tiempos por palabra.
    const cached = await r.get(q('Palabra Exacta', 'Los Fixtures', 40, 'Pruebas Unitarias'));
    expect(cached.source).toBe('cache');
    expect(cached.lines[0].words[0]).toMatchObject({ startMs: 4000, estimated: false });
  });

  it('se prefiere otra subida con tiempos por palabra si su duración coincide (±2 s)', async () => {
    const log: string[] = [];
    const { r } = repo(fixtureHttp(log));
    const doc = await r.get(q('Doble Versión', 'Banda Mock', 40, 'Kilómetro Cero'));
    expect(doc.lrclibId).toBe(3003); // 3004 tiene palabras pero dura 6 s más; 3002 (de /get) no tiene palabras
    expect(doc.lines[0].words[0].estimated).toBe(false);
    expect(log).toHaveLength(2);
  });

  it('si la búsqueda de la versión con palabras falla, se queda con la de /get', async () => {
    let calls = 0;
    const http: HttpGet = async (url, t) => {
      calls++;
      if (url.includes('/search')) throw new Error('timeout');
      return fixtureHttp()(url, t);
    };
    const { r } = repo(http);
    expect((await r.get(q('Doble Versión', 'Banda Mock', 40, 'Kilómetro Cero'))).lrclibId).toBe(3002);
    expect(calls).toBe(2);
  });

  it('lyricsfile ilegible → se usa syncedLyrics', async () => {
    const http: HttpGet = async () => ({
      status: 200,
      json: async () => ({ id: 9, trackName: 'x', artistName: 'y', duration: 30, hasWordSync: true, lyricsfile: ': : [', syncedLyrics: '[00:01.00]hola', plainLyrics: 'hola' }),
    });
    const doc = await repo(http).r.get(q('x', 'y', 30));
    expect(doc.kind).toBe('synced');
    expect(doc.lines[0].words[0].estimated).toBe(true);
  });

  it('no encontrada en ningún paso', async () => {
    const { r } = repo();
    expect((await r.get(q('No Existe', 'Nadie', 200))).kind).toBe('none');
  });

  it('429 → backoff y luego error transitorio (sin caché negativa)', async () => {
    const { r, sleep, cache } = repo();
    await expect(r.get(q('Muy Rápido', 'Los Fixtures'))).rejects.toBeInstanceOf(TransientLyricsError);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it('429 una vez y luego 200', async () => {
    let first = true;
    const http: HttpGet = async (url) => {
      if (first) {
        first = false;
        return { status: 429, json: async () => ({}) };
      }
      return fixtureHttp()(url, 5000);
    };
    const { r } = repo(http);
    expect((await r.get(q('Isla de Luz', 'Los Fixtures', 210))).kind).toBe('synced');
  });

  it('500 y timeout → error transitorio', async () => {
    const { r } = repo();
    await expect(r.get(q('Servidor Roto', 'Los Fixtures'))).rejects.toBeInstanceOf(TransientLyricsError);
    const timeout: HttpGet = () => Promise.reject(new Error('timeout'));
    await expect(repo(timeout).r.get(q('x', 'y'))).rejects.toBeInstanceOf(TransientLyricsError);
  });

  it('JSON malformado → se trata como no encontrada', async () => {
    const { r } = repo();
    expect((await r.get(q('JSON Roto', 'Los Fixtures'))).kind).toBe('none');
  });

  it('expira la caché positiva a los 30 días', async () => {
    const log: string[] = [];
    const { r, now } = repo(fixtureHttp(log));
    await r.get(q('Isla de Luz', 'Los Fixtures', 210));
    now.t += POSITIVE_TTL_MS + 1;
    await r.get(q('Isla de Luz', 'Los Fixtures', 210));
    expect(log).toHaveLength(4);
  });

  it('getById y search', async () => {
    const { r } = repo();
    expect((await r.getById(2007, null)).lrclibId).toBe(2007);
    expect((await r.getById(9999, null)).kind).toBe('none');
    expect(await r.search(q('Faro', 'Los Fixtures'))).toHaveLength(3);
  });

  it('título vacío no consulta /get', async () => {
    const log: string[] = [];
    const { r } = repo(fixtureHttp(log));
    expect((await r.get(q('', 'Alguien'))).kind).toBe('none');
    expect(log.every((u) => !u.includes('/get?'))).toBe(true);
  });

  it('toCandidate valida la forma', () => {
    expect(toCandidate(null)).toBeNull();
    expect(toCandidate({ id: 1 })).toBeNull();
    expect(toCandidate({ id: 1, name: 'x' })).toMatchObject({ trackName: 'x', artistName: '', duration: null });
  });

  it('servidor HTTP real con fetch (la ruta que usa la app)', async () => {
    const { server, baseUrl } = await startFixtureServer();
    try {
      const http: HttpGet = async (url, timeoutMs) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return { status: res.status, json: () => res.json() };
      };
      const r = new LyricsRepository({ http, cache: new JsonLyricsCache(null), hash: sha1, now: Date.now, baseUrl });
      expect((await r.get(q('Ruta Norte', 'Banda Mock', 185))).lrclibId).toBe(1002);
    } finally {
      server.close();
    }
  });
});

describe('JsonLyricsCache', () => {
  it('LRU al superar el máximo', () => {
    const c = new JsonLyricsCache(null, 3);
    for (const k of ['a', 'b', 'c']) c.set(k, { kind: 'miss', storedAt: 0, record: null });
    c.get('a'); // a pasa a ser el más reciente
    c.set('d', { kind: 'miss', storedAt: 0, record: null });
    expect(c.get('b')).toBeNull();
    expect(c.get('a')).not.toBeNull();
    expect(c.size).toBe(3);
    c.clear();
    expect(c.size).toBe(0);
  });

  it('persiste entradas y offsets (sin TTL) en disco', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'li-')), 'cache.json');
    const c = new JsonLyricsCache(file);
    c.set('k', { kind: 'miss', storedAt: 5, record: null });
    c.setOffset('k', 200);
    c.setOffset('z', 100);
    c.setOffset('z', 0);
    c.flush();
    const d = new JsonLyricsCache(file);
    expect(d.get('k')).toEqual({ kind: 'miss', storedAt: 5, record: null });
    expect(d.getOffset('k')).toBe(200);
    expect(d.listOffsets()).toEqual({ k: 200 });
    d.clearOffsets();
    expect(d.getOffset('k')).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8')).v).toBe(1);
  });

  it('archivo corrupto → empieza vacía', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'li-')), 'cache.json');
    writeFileSync(file, '{no es json');
    expect(new JsonLyricsCache(file).size).toBe(0);
  });
});
