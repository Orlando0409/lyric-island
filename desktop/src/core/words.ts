// Segmentación de líneas en palabras y karaoke simulado (sección 8.5.4).
import type { LyricWord } from './types';

const PUNCT_PAUSE = new Set([',', '.', '，', '。']);

/** Rangos CJK que se dividen por carácter (japonés y chino no usan espacios). El coreano sí los usa. */
export function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0x3000 && cp <= 0x303f) || // puntuación CJK
    (cp >= 0x3040 && cp <= 0x30ff) || // hiragana + katakana
    (cp >= 0x3400 && cp <= 0x4dbf) || // Han ext. A
    (cp >= 0x4e00 && cp <= 0x9fff) || // Han
    (cp >= 0xf900 && cp <= 0xfaff) || // compatibilidad
    (cp >= 0xff00 && cp <= 0xffef) || // ancho completo
    (cp >= 0x20000 && cp <= 0x2ffff) // Han ext. B+
  );
}

const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function graphemes(text: string): string[] {
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

const isSpace = (g: string) => /^\s+$/u.test(g);

/**
 * Divide una línea en "palabras" que incluyen su espacio final.
 * Los caracteres CJK son cada uno su propia palabra.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  for (const g of graphemes(text)) {
    if (isSpace(g)) {
      if (cur !== '') cur += g;
      else if (tokens.length > 0) tokens[tokens.length - 1] += g;
    } else if (isCjkCodePoint(g.codePointAt(0)!)) {
      if (cur !== '') tokens.push(cur);
      tokens.push(g);
      cur = '';
    } else if (cur !== '' && /\s$/u.test(cur)) {
      tokens.push(cur);
      cur = g;
    } else {
      cur += g;
    }
  }
  if (cur !== '') tokens.push(cur);
  return tokens;
}

/** Letras y dígitos (por punto de código). */
export function letterCount(word: string): number {
  let n = 0;
  for (const ch of word) if (/[\p{L}\p{N}]/u.test(ch)) n++;
  return n;
}

export function nonSpaceCount(text: string): number {
  let n = 0;
  for (const ch of text) if (!/\s/u.test(ch)) n++;
  return n;
}

export function wordWeight(word: string): number {
  const trimmed = word.trimEnd();
  const last = trimmed.slice(-1);
  return Math.max(2, letterCount(trimmed)) + (PUNCT_PAUSE.has(last) ? 1.5 : 0);
}

/** Karaoke simulado: reparte la duración de canto entre las palabras según su peso. */
export function simulateWords(text: string, t0: number, t1: number): LyricWord[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  const lineDur = Math.max(0, t1 - t0);
  const singDur = Math.min(lineDur, Math.max(800, nonSpaceCount(text) * 110));
  const weights = tokens.map(wordWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  const words: LyricWord[] = [];
  let cum = 0;
  for (let i = 0; i < tokens.length; i++) {
    const startMs = t0 + Math.round((cum / total) * singDur);
    cum += weights[i];
    const endMs = t0 + Math.round((cum / total) * singDur);
    words.push({ text: tokens[i], startMs, endMs, estimated: true });
  }
  return words;
}
