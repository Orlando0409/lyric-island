// LyricsRepository (secciones 8.1, 8.2 y 8.4): LRCLIB + caché positiva/negativa.
// La red, la caché, el hash y la espera se inyectan para poder probarlo sin red.
import { buildDocument } from './lrc';
import { parseLyricsfile } from './lyricsfile';
import { cacheKeySource, normalizeQuery, pickBest, type Candidate, type QueryTrack } from './matcher';
import type { LyricsDocument } from './types';

export const LRCLIB_BASE = 'https://lrclib.net/api';
export const REQUEST_TIMEOUT_MS = 5000;
export const POSITIVE_TTL_MS = 30 * 24 * 3600 * 1000;
export const NEGATIVE_TTL_MS = 24 * 3600 * 1000;
export const RATE_LIMIT_BACKOFF_MS = [1000, 2000];
/** Una versión con tiempos por palabra solo reemplaza a la de /api/get si su duración coincide (±2 s). */
export const WORD_SYNC_MAX_DELTA_MS = 2000;

const withinMs = (c: Candidate, durationMs: number | null, max: number) =>
  durationMs !== null && c.duration !== null && Math.abs(c.duration * 1000 - durationMs) <= max;

export interface HttpResponse {
  status: number;
  json(): Promise<unknown>;
}
/** Debe rechazar si se agota el tiempo o falla la red. */
export type HttpGet = (url: string, timeoutMs: number) => Promise<HttpResponse>;

export interface CacheEntry {
  kind: 'hit' | 'miss';
  storedAt: number;
  record: Candidate | null;
}

export interface LyricsCache {
  get(key: string): Promise<CacheEntry | null> | CacheEntry | null;
  set(key: string, entry: CacheEntry): Promise<void> | void;
}

/** Error recuperable (timeout, 5xx, 429 persistente): no se guarda en la caché negativa. */
export class TransientLyricsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientLyricsError';
  }
}

export interface RepoDeps {
  http: HttpGet;
  cache: LyricsCache;
  hash: (s: string) => string;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Valida una respuesta de LRCLIB sin confiar en su forma. */
export function toCandidate(raw: unknown): Candidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = num(r.id);
  const trackName = str(r.trackName) ?? str(r.name);
  if (id === null || trackName === null) return null;
  return {
    id,
    trackName,
    artistName: str(r.artistName) ?? '',
    albumName: str(r.albumName),
    duration: num(r.duration),
    instrumental: r.instrumental === true,
    plainLyrics: str(r.plainLyrics),
    syncedLyrics: str(r.syncedLyrics),
    hasWordSync: r.hasWordSync === true,
    lyricsfile: str(r.lyricsfile),
  };
}

export function documentFromCandidate(c: Candidate, durationMs: number | null, source: LyricsDocument['source']): LyricsDocument {
  const dur = durationMs ?? (c.duration !== null ? Math.round(c.duration * 1000) : null);
  // Tiempos reales por palabra (lyricsfile) cuando existen; si no se pueden leer, la letra LRC de siempre.
  if (c.hasWordSync && c.lyricsfile && !c.instrumental) {
    const lines = parseLyricsfile(c.lyricsfile, dur);
    if (lines) return { kind: 'synced', lines, plainText: c.plainLyrics, offsetMs: 0, source, lrclibId: c.id };
  }
  return buildDocument({
    synced: c.syncedLyrics,
    plain: c.plainLyrics,
    instrumental: c.instrumental,
    durationMs: durationMs ?? (c.duration !== null ? Math.round(c.duration * 1000) : null),
    source,
    lrclibId: c.id,
  });
}

const NONE: LyricsDocument = { kind: 'none', lines: [], plainText: null, offsetMs: 0, source: 'lrclib', lrclibId: null };

export class LyricsRepository {
  private readonly base: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: RepoDeps) {
    this.base = deps.baseUrl ?? LRCLIB_BASE;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  cacheKey(track: QueryTrack): string {
    return this.deps.hash(cacheKeySource(track));
  }

  private async request(path: string, params: Record<string, string | number | null>): Promise<unknown | null> {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`;
    for (let attempt = 0; ; attempt++) {
      let res: HttpResponse;
      try {
        res = await this.deps.http(url, REQUEST_TIMEOUT_MS);
      } catch (e) {
        throw new TransientLyricsError(`red: ${String(e)}`);
      }
      if (res.status === 404) return null;
      // 429 (rate limit) y 503 (sobrecarga momentánea, frecuente en ráfagas de consultas): reintento con backoff.
      if (res.status === 429 || res.status === 503) {
        if (attempt < RATE_LIMIT_BACKOFF_MS.length) {
          await this.sleep(RATE_LIMIT_BACKOFF_MS[attempt]);
          continue;
        }
        throw new TransientLyricsError(`${res.status} persistente`);
      }
      if (res.status >= 500) throw new TransientLyricsError(`HTTP ${res.status}`);
      if (res.status !== 200) return null;
      try {
        return await res.json();
      } catch {
        return null; // JSON malformado: se trata como "no encontrada"
      }
    }
  }

  async getById(id: number, durationMs: number | null): Promise<LyricsDocument> {
    const c = toCandidate(await this.request(`/get/${id}`, {}));
    return c ? documentFromCandidate(c, durationMs, 'lrclib') : NONE;
  }

  /** Búsqueda libre (para "no es esta letra"). */
  async search(track: QueryTrack): Promise<Candidate[]> {
    const q = normalizeQuery(track);
    const data = await this.request('/search', { track_name: q.title, artist_name: q.artist });
    return Array.isArray(data) ? data.map(toCandidate).filter((c): c is Candidate => c !== null) : [];
  }

  /** Estrategia de 8.2: get exacto → get normalizado → search puntuado → caché negativa. */
  async get(track: QueryTrack): Promise<LyricsDocument> {
    const key = this.cacheKey(track);
    const now = this.deps.now();
    const cached = await this.deps.cache.get(key);
    if (cached) {
      const age = now - cached.storedAt;
      if (cached.kind === 'hit' && cached.record && age < POSITIVE_TTL_MS) {
        return documentFromCandidate(cached.record, track.durationMs, 'cache');
      }
      if (cached.kind === 'miss' && age < NEGATIVE_TTL_MS) return { ...NONE, source: 'cache' };
    }

    const durationS = track.durationMs === null ? null : Math.round(track.durationMs / 1000);
    const q = normalizeQuery(track);
    const attempts: Array<{ artist: string; title: string }> = [{ artist: track.artist.trim(), title: track.title.trim() }];
    if (q.artist !== attempts[0].artist || q.title !== attempts[0].title) attempts.push(q);

    let found: Candidate | null = null;
    let gets = 0;
    for (const a of attempts) {
      if (!a.title) continue;
      gets++;
      found = toCandidate(
        await this.request('/get', { artist_name: a.artist, track_name: a.title, album_name: track.album, duration: durationS }),
      );
      if (found) break;
    }
    if (!found && q.title) {
      const candidates = await this.search(track);
      found = pickBest({ ...q, durationMs: track.durationMs, album: track.album }, candidates)?.candidate ?? null;
    } else if (found && !found.hasWordSync && gets === 1 && q.title) {
      // /api/get devuelve una sola versión: si otra subida de la misma canción trae tiempos por palabra,
      // se prefiere (como mucho 2 peticiones por pista nueva). Un error aquí no afecta a la letra ya encontrada.
      try {
        const withWords = (await this.search(track)).filter(
          (c) => c.hasWordSync && c.syncedLyrics !== null && withinMs(c, track.durationMs, WORD_SYNC_MAX_DELTA_MS),
        );
        const alt = pickBest({ ...q, durationMs: track.durationMs, album: track.album }, withWords);
        if (alt) found = alt.candidate;
      } catch {
        // se queda con la versión de /api/get
      }
    }

    if (!found) {
      await this.deps.cache.set(key, { kind: 'miss', storedAt: now, record: null });
      return NONE;
    }
    await this.deps.cache.set(key, { kind: 'hit', storedAt: now, record: found });
    return documentFromCandidate(found, track.durationMs, 'lrclib');
  }
}
