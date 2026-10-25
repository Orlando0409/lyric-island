// "lyricsfile" de LRCLIB: YAML con tiempos por línea y, cuando hasWordSync = true, por palabra.
// Con tiempos reales por palabra el relleno karaoke sigue la voz en lugar de estimarla.
// Nunca lanza: ante un YAML inválido o sin líneas válidas devuelve null y se usa syncedLyrics.
import { parse } from 'yaml';
import { estimateLastLineMs } from './lrc';
import type { LyricLine, LyricWord } from './types';
import { simulateWords } from './words';

interface RawWord {
  text: string;
  startMs: number;
}

interface RawLine {
  text: string;
  startMs: number;
  endMs: number | null;
  words: RawWord[];
  order: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const toMs = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const toText = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

/**
 * Reparte el texto de la línea entre sus palabras para que concatenarlas reproduzca la línea
 * (las palabras del lyricsfile no traen los espacios). Si una palabra no aparece, se usa tal cual + espacio.
 */
export function alignWordTexts(lineText: string, words: string[]): string[] {
  const out: string[] = [];
  let cursor = 0;
  const positions: number[] = [];
  for (const w of words) {
    const idx = w.length > 0 ? lineText.indexOf(w, cursor) : -1;
    positions.push(idx);
    if (idx >= 0) cursor = idx + w.length;
  }
  for (let i = 0; i < words.length; i++) {
    const idx = positions[i];
    if (idx < 0) {
      out.push(i < words.length - 1 ? `${words[i]} ` : words[i]);
      continue;
    }
    let end = lineText.length;
    for (let j = i + 1; j < words.length; j++) {
      if (positions[j] >= 0) {
        end = positions[j];
        break;
      }
    }
    out.push(lineText.slice(idx, end));
  }
  return out;
}

export function parseLyricsfile(src: string, durationMs: number | null = null): LyricLine[] | null {
  let doc: unknown;
  try {
    doc = parse(src);
  } catch {
    return null;
  }
  if (!isObj(doc) || !Array.isArray(doc.lines)) return null;

  const raw: RawLine[] = [];
  doc.lines.forEach((l, order) => {
    if (!isObj(l)) return;
    const startMs = toMs(l.start_ms);
    if (startMs === null) return;
    const words: RawWord[] = [];
    if (Array.isArray(l.words)) {
      for (const w of l.words) {
        if (!isObj(w)) continue;
        const ws = toMs(w.start_ms);
        const wt = toText(w.text).trim();
        if (ws !== null && wt.length > 0) words.push({ text: wt, startMs: ws });
      }
    }
    raw.push({ text: toText(l.text).trim(), startMs, endMs: toMs(l.end_ms), words, order });
  });
  raw.sort((a, b) => a.startMs - b.startMs || a.order - b.order);

  const lines = raw.map((r, i): LyricLine => {
    const next = raw[i + 1];
    let endMs: number;
    if (next) endMs = next.startMs;
    else {
      endMs = r.endMs !== null && r.endMs > r.startMs ? r.endMs : r.startMs + estimateLastLineMs(r.text);
      if (durationMs !== null && durationMs > r.startMs) endMs = Math.min(endMs, durationMs);
    }
    // Fin de la parte cantada: end_ms del lyricsfile (sin pasar a la línea siguiente).
    const sungEnd = r.endMs !== null && r.endMs > r.startMs ? Math.min(r.endMs, endMs) : endMs;
    const isInterlude = r.text.length === 0;
    let words: LyricWord[];
    if (isInterlude) words = [];
    else if (r.words.length > 0) {
      const sorted = [...r.words].sort((a, b) => a.startMs - b.startMs);
      const texts = alignWordTexts(r.text, sorted.map((w) => w.text));
      words = sorted.map((w, j) => ({
        text: texts[j],
        startMs: w.startMs,
        endMs: Math.max(w.startMs, j + 1 < sorted.length ? sorted[j + 1].startMs : sungEnd),
        estimated: false,
      }));
    } else words = simulateWords(r.text, r.startMs, sungEnd);
    return { index: i, startMs: r.startMs, endMs, text: r.text, words, isInterlude };
  });
  return lines.some((l) => !l.isInterlude) ? lines : null;
}
