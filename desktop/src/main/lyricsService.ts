// LyricsService (11.3): vive en el main (red + caché) y expone las letras al renderer por IPC.
import { createHash } from 'node:crypto';
import { LyricsRepository, type HttpGet } from '../core/lyricsRepo';
import { cacheKeySource } from '../core/matcher';
import type { LyricsDocument, NowPlaying } from '../core/types';
import { JsonLyricsCache } from './cache';
import { log } from './logger';

// User-Agent identificable (8.1). Al publicar el repositorio, agregar su URL: "LyricIsland/x.y.z (https://github.com/<usuario>/lyric-island)".
export const USER_AGENT = `LyricIsland/${process.env.npm_package_version ?? '0.1.0'} (Windows desktop; lyrics overlay)`;

export const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

export const fetchHttp: HttpGet = async (url, timeoutMs) => {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, json: () => res.json() };
};

export class LyricsService {
  readonly cache: JsonLyricsCache;
  readonly repo: LyricsRepository;
  private inflight = new Map<string, Promise<LyricsDocument>>();

  constructor(cacheFile: string | null, baseUrl?: string, http: HttpGet = fetchHttp) {
    this.cache = new JsonLyricsCache(cacheFile);
    this.repo = new LyricsRepository({ http, cache: this.cache, hash: sha1, now: Date.now, baseUrl });
  }

  key(track: NowPlaying): string {
    return sha1(cacheKeySource(track));
  }

  /** Une peticiones simultáneas de la misma pista (como mucho una búsqueda por pista nueva, RNF-16). */
  get(track: NowPlaying): Promise<LyricsDocument> {
    const key = this.key(track);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = this.repo
      .get(track)
      .then((doc) => {
        log('info', 'lyrics', `${track.artist} — ${track.title}: ${doc.kind} (${doc.source})`);
        return doc;
      })
      .catch((e) => {
        log('warn', 'lyrics', `${track.artist} — ${track.title}: ${String(e)}`);
        throw e;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  getOffset(track: NowPlaying): number {
    return this.cache.getOffset(this.key(track));
  }

  setOffset(track: NowPlaying, ms: number): void {
    this.cache.setOffset(this.key(track), ms);
  }
}
