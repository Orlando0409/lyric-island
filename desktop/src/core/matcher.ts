// TrackMatcher (sección 8.2): normalización de metadatos y puntuación de candidatos de LRCLIB.

/** Sufijos ruidosos del título. No se quitan "Live", "Acoustic" ni "Remix": cambian la letra o los tiempos. */
export const TITLE_NOISE_PATTERNS: RegExp[] = [
  /\s*-\s*(\d{4}\s*)?remaster(ed)?(\s*\d{4})?.*$/i,
  /\s*[([](feat\.?|ft\.?|with)\s+[^)\]]+[)\]]/i,
  /\s*[([](explicit|clean|radio edit|single version|album version)[)\]]/i,
  /\s*-\s*(mono|stereo)(\s+version)?$/i,
];

const ARTIST_SEPARATORS = /\s*(?:,\s|\s&\s|\sx\s|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s)/i;

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Para comparar (no para enviar): minúsculas, sin diacríticos, comillas y guiones unificados. */
export function normalizeForCompare(s: string): string {
  return collapseSpaces(
    s
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[‘’‚‛′`´]/g, "'")
      .replace(/[“”„‟″]/g, '"')
      .replace(/[‐-―−]/g, '-'),
  );
}

export function cleanTitle(title: string): string {
  let t = collapseSpaces(title);
  for (const re of TITLE_NOISE_PATTERNS) t = t.replace(re, '');
  return collapseSpaces(t);
}

export function primaryArtist(artist: string): string {
  const a = collapseSpaces(artist);
  const first = a.split(ARTIST_SEPARATORS)[0];
  return collapseSpaces(first ?? a);
}

export interface QueryTrack {
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
}

/**
 * YouTube Music en el navegador: el título a veces es "Artista - Canción" y el artista es el canal.
 * Si el artista termina en " - Topic" o coincide con lo que va antes del guion, se separa.
 */
export function splitYouTubeStyle(title: string, artist: string): { title: string; artist: string } {
  let a = collapseSpaces(artist);
  let t = collapseSpaces(title);
  const topic = / - Topic$/i;
  if (topic.test(a)) a = a.replace(topic, '').trim();
  const dash = t.indexOf(' - ');
  if (dash > 0) {
    const before = t.slice(0, dash).trim();
    const after = t.slice(dash + 3).trim();
    if (after.length > 0 && normalizeForCompare(before) === normalizeForCompare(a)) {
      t = after;
    } else if (after.length > 0 && a.length === 0) {
      a = before;
      t = after;
    }
  }
  return { title: t, artist: a };
}

export interface SearchQuery {
  title: string;
  artist: string;
}

/** Normaliza para buscar (título limpio y artista principal). */
export function normalizeQuery(track: QueryTrack): SearchQuery {
  const yt = splitYouTubeStyle(track.title, track.artist);
  return { title: cleanTitle(yt.title), artist: primaryArtist(yt.artist) };
}

// ---------- similitud ----------

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array<boolean>(la).fill(false);
  const mb = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(lb - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (!mb[j] && a[i] === b[j]) {
        ma[i] = mb[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / la + m / lb + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, la, lb) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function tokens(s: string): string[] {
  return normalizeForCompare(s)
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(' ')
    .filter((t) => t.length > 0);
}

/** Token-set ratio: compara la intersección de tokens contra cada lado (insensible al orden). */
export function tokenSetRatio(a: string, b: string): number {
  const ta = [...new Set(tokens(a))].sort();
  const tb = [...new Set(tokens(b))].sort();
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  const inter = ta.filter((t) => setB.has(t));
  const onlyA = ta.filter((t) => !setB.has(t));
  const setA = new Set(ta);
  const onlyB = tb.filter((t) => !setA.has(t));
  const i = inter.join(' ');
  const s1 = [i, onlyA.join(' ')].filter(Boolean).join(' ');
  const s2 = [i, onlyB.join(' ')].filter(Boolean).join(' ');
  if (inter.length > 0 && (onlyA.length === 0 || onlyB.length === 0)) return 1;
  return Math.max(jaroWinkler(i, s1), jaroWinkler(i, s2), jaroWinkler(s1, s2));
}

export function textSimilarity(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  return Math.max(jaroWinkler(na, nb), tokenSetRatio(a, b));
}

/** 1 si |Δ| ≤ 2 s; decae linealmente hasta 0 en |Δ| = 10 s. Sin duración conocida → 0.5. */
export function durationSimilarity(aMs: number | null, bMs: number | null): number {
  if (aMs === null || bMs === null) return 0.5;
  const d = Math.abs(aMs - bMs) / 1000;
  if (d <= 2) return 1;
  if (d >= 10) return 0;
  return 1 - (d - 2) / 8;
}

export interface Candidate {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null; // segundos
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  /** LRCLIB: la versión trae tiempos reales por palabra en `lyricsfile`. */
  hasWordSync?: boolean;
  lyricsfile?: string | null;
}

export const ACCEPT_THRESHOLD = 0.75;

export interface ScoreQuery extends SearchQuery {
  durationMs: number | null;
  album?: string | null;
}

export function scoreCandidate(query: ScoreQuery, c: Candidate): number {
  const candDurMs = c.duration === null ? null : Math.round(c.duration * 1000);
  const simTitle = Math.max(textSimilarity(query.title, c.trackName), textSimilarity(query.title, cleanTitle(c.trackName)));
  // Spike S0.1: Spotify desktop (Store) publica en SMTC el artista vacío. Sin artista, ese peso lo toma
  // la similitud de álbum; sin álbum tampoco, un 0.5 neutro.
  let simArtist: number;
  if (query.artist.trim().length > 0) {
    simArtist = Math.max(textSimilarity(query.artist, c.artistName), textSimilarity(query.artist, primaryArtist(c.artistName)));
  } else if (query.album && c.albumName) {
    simArtist = textSimilarity(query.album, c.albumName);
  } else {
    simArtist = 0.5;
  }
  let score =
    0.45 * simTitle + 0.3 * simArtist + 0.2 * durationSimilarity(query.durationMs, candDurMs) + 0.05 * (c.syncedLyrics ? 1 : 0) + 0.03 * (c.hasWordSync ? 1 : 0); // se prefieren tiempos por palabra
  if (query.durationMs !== null && candDurMs !== null && Math.abs(query.durationMs - candDurMs) > 15_000) score -= 0.3;
  return score;
}

export function pickBest(
  query: ScoreQuery,
  candidates: Candidate[],
): { candidate: Candidate; score: number } | null {
  let best: { candidate: Candidate; score: number } | null = null;
  for (const c of candidates) {
    const score = scoreCandidate(query, c);
    if (!best || score > best.score) best = { candidate: c, score };
  }
  return best && best.score >= ACCEPT_THRESHOLD ? best : null;
}

/** Texto que se hashea (sha1) como clave de caché: artistaNorm|tituloNorm|round(duración / 2 s). */
export function cacheKeySource(track: QueryTrack): string {
  const q = normalizeQuery(track);
  const bucket = track.durationMs === null ? 'na' : String(Math.round(track.durationMs / 2000));
  return `${normalizeForCompare(q.artist)}|${normalizeForCompare(q.title)}|${bucket}`;
}

/** Anuncios de Spotify Free (RF-09): "Advertisement"/"Spotify" o ≈30 s sin álbum. */
export function looksLikeAd(track: { title: string; artist: string; album: string | null; durationMs: number | null; sourceAppId: string }): boolean {
  const t = normalizeForCompare(track.title);
  const a = normalizeForCompare(track.artist);
  if (t === 'advertisement' || t === 'spotify' || a === 'spotify' || t === 'anuncio') return true;
  const isSpotify = /spotify/i.test(track.sourceAppId);
  return (
    isSpotify &&
    !track.album &&
    track.durationMs !== null &&
    track.durationMs > 0 &&
    track.durationMs >= 15_000 &&
    track.durationMs <= 31_000
  );
}
