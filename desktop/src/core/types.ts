// Tipos del núcleo (sección 7.1 de la especificación). Iguales en ambas plataformas.

export type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'unknown';

export interface NowPlaying {
  sourceAppId: string; // "Spotify.exe", "com.spotify.music", "chrome.exe"...
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  artworkHash: string | null; // hash del PNG para detectar cambios sin reenviar la imagen
}

export interface Timeline {
  positionMs: number; // posición reportada por el SO
  updatedAtMs: number; // instante (reloj del sistema) en que se reportó esa posición
  rate: number; // 1.0 normal; 0 si está pausado
  status: PlaybackStatus;
}

export interface LyricWord {
  text: string; // incluye el espacio final si lo había
  startMs: number;
  endMs: number;
  estimated: boolean; // true si el tiempo fue simulado, no viene del LRC
}

export interface LyricLine {
  index: number;
  startMs: number;
  endMs: number; // inicio de la siguiente línea (o estimado si es la última)
  text: string;
  words: LyricWord[];
  isInterlude: boolean; // línea vacía o hueco largo → "♪ • • •"
  /** Transliteración (romaji) de las líneas en japonés; se muestra debajo de la línea actual. */
  romaji?: string | null;
  /** Alineación romaji ↔ original en pares planos [finEnOriginal, finEnRomaji, …] (ver romajiFill). */
  romajiMarks?: number[] | null;
}

export type LyricsKind = 'synced' | 'plain' | 'instrumental' | 'none';

export interface LyricsDocument {
  kind: LyricsKind;
  lines: LyricLine[]; // vacío si kind = 'none' | 'instrumental'
  plainText: string | null;
  offsetMs: number; // offset del LRC ([offset:]); el offset manual del usuario se suma en SyncEngine
  source: 'lrclib' | 'local-file' | 'cache';
  lrclibId: number | null;
}

export interface Palette {
  background: string; // #RRGGBB, ya ajustado para contraste
  backgroundAlt: string; // segundo color para el degradado
  textPrimary: string; // texto de la línea activa ya cantada
  textUpcoming: string; // texto aún no cantado (#RRGGBBAA)
  textSecondary: string; // línea siguiente (#RRGGBBAA)
  accent: string; // ecualizador, puntos del interludio
}

export type IslandMode = 'hidden' | 'compact' | 'expanded' | 'paused';

export interface IslandState {
  mode: IslandMode;
  track: NowPlaying | null;
  lyrics: LyricsDocument | null;
  activeLineIndex: number; // -1 antes de la primera línea
  lineProgress: number; // 0..1 dentro de la línea
  wordIndex: number;
  wordProgress: number; // 0..1 dentro de la palabra
  palette: Palette;
}
