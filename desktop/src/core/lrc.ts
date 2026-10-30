// Parser LRC. Nunca lanza excepciones: ante basura devuelve kind 'none'.
import type { LyricLine, LyricWord, LyricsDocument } from './types';
import { simulateWords, singEstimateMs, songTempo } from './words';

export interface ParsedLrc {
  lines: LyricLine[];
  offsetMs: number;
  meta: Record<string, string>;
  warnings: string[];
}

const TIME_TAG = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const META_TAG = /^\[([a-zA-Z#]+):([^\]]*)\]\s*$/;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const KNOWN_META = new Set(['ar', 'ti', 'al', 'au', 'by', 'length', 're', 've', 'offset', '#']);

/** Fracción de 1, 2 o 3 dígitos → ms: ".5" = 500, ".34" = 340, ".123" = 123. */
export function fractionToMs(frac: string | undefined): number {
  if (!frac) return 0;
  if (frac.length === 1) return Number(frac) * 100;
  if (frac.length === 2) return Number(frac) * 10;
  return Number(frac);
}

function tagToMs(min: string, sec: string, frac: string | undefined): number | null {
  const s = Number(sec);
  if (s >= 60) return null;
  return Number(min) * 60_000 + s * 1000 + fractionToMs(frac);
}

/** Duración estimada de la última línea: clamp(canto estimado × 9/11, 2 s, 6 s) (90 ms por letra latina). */
export function estimateLastLineMs(text: string): number {
  return Math.min(6000, Math.max(2000, Math.round((singEstimateMs(text) * 9) / 11)));
}

interface RawWord {
  text: string;
  startMs: number;
}

interface RawLine {
  startMs: number;
  text: string;
  words: RawWord[] | null; // marcas por palabra (LRC mejorado)
  order: number;
}

function parseEnhanced(rest: string, lineStart: number): { text: string; words: RawWord[] | null; endTag: number | null } {
  WORD_TAG.lastIndex = 0;
  if (!WORD_TAG.test(rest)) return { text: rest, words: null, endTag: null };
  WORD_TAG.lastIndex = 0;
  const words: RawWord[] = [];
  let endTag: number | null = null;
  let lastIndex = 0;
  let pendingStart: number | null = null;
  let m: RegExpExecArray | null;
  const flush = (segment: string, start: number) => {
    if (segment.length > 0) words.push({ text: segment, startMs: start });
  };
  while ((m = WORD_TAG.exec(rest)) !== null) {
    const segment = rest.slice(lastIndex, m.index);
    if (pendingStart !== null) flush(segment, pendingStart);
    else if (segment.trim().length > 0) flush(segment, lineStart);
    const t = tagToMs(m[1], m[2], m[3]);
    pendingStart = t ?? pendingStart ?? lineStart;
    lastIndex = WORD_TAG.lastIndex;
  }
  const tail = rest.slice(lastIndex);
  if (tail.length > 0) flush(tail, pendingStart ?? lineStart);
  else endTag = pendingStart; // "<mm:ss>" final sin texto = fin de la última palabra
  const text = words.map((w) => w.text).join('');
  return { text, words: words.length > 0 ? words : null, endTag };
}

/** Tiene letras que no son del alfabeto latino (japonés, coreano, cirílico…): es el verso original, no su romanización. */
export function hasNonLatinLetters(text: string): boolean {
  for (const ch of text) if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) return true;
  return false;
}

/** Fracción de versos con texto que comparten tiempo con otro a partir de la cual la letra se trata como "doble". */
export const DOUBLED_SHARE = 0.3;
/** …y al menos tantos instantes repetidos (un par de líneas a la vez, como en un dúo, no es una letra doble). */
export const DOUBLED_MIN_TIMES = 3;

/**
 * Letras "dobles": algunas versiones de LRCLIB traen la letra entera dos veces con los mismos tiempos (el original y
 * después el romaji o una traducción). Con dos versos en el mismo instante se mostraba el último y el original quedaba
 * con duración cero. Si al menos el 30 % de los versos (y 3 instantes) comparte tiempo, se deja uno por tiempo: el que tiene letras no
 * latinas (el original) o, si no hay, el primero del archivo. Recibe y devuelve las líneas ordenadas por tiempo.
 */
function dropDoubledLyrics<T extends { startMs: number; text: string }>(sorted: T[]): T[] {
  const withText = sorted.filter((r) => r.text.length > 0);
  const count = new Map<number, number>();
  for (const r of withText) count.set(r.startMs, (count.get(r.startMs) ?? 0) + 1);
  const shared = withText.filter((r) => (count.get(r.startMs) ?? 0) > 1).length;
  const sharedTimes = [...count.values()].filter((n) => n > 1).length;
  if (withText.length === 0 || shared / withText.length < DOUBLED_SHARE || sharedTimes < DOUBLED_MIN_TIMES) return sorted;
  const out: T[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].startMs === sorted[i].startMs) j++;
    const group = sorted.slice(i, j);
    const texts = group.filter((r) => r.text.length > 0);
    out.push(texts.find((r) => hasNonLatinLetters(r.text)) ?? texts[0] ?? group[0]);
    i = j;
  }
  return out;
}

export function parseLrc(input: string, durationMs: number | null = null): ParsedLrc {
  const result: ParsedLrc = { lines: [], offsetMs: 0, meta: {}, warnings: [] };
  try {
    const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const raw: (RawLine & { endTag: number | null })[] = [];
    let order = 0;
    for (const sourceLine of text.split('\n')) {
      let rest = sourceLine.trim();
      if (rest.length === 0) continue;
      const times: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = TIME_TAG.exec(rest)) !== null) {
        const t = tagToMs(m[1], m[2], m[3]);
        if (t === null) {
          times.length = 0;
          result.warnings.push(`marca inválida: ${sourceLine.slice(0, 40)}`);
          rest = '';
          break;
        }
        times.push(t);
        rest = rest.slice(m[0].length).trimStart();
      }
      if (times.length === 0) {
        const meta = META_TAG.exec(sourceLine.trim());
        if (meta) {
          const key = meta[1].toLowerCase();
          const value = meta[2].trim();
          if (KNOWN_META.has(key)) {
            result.meta[key] = value;
            if (key === 'offset') {
              const n = Number.parseInt(value.replace(/^\+/, ''), 10);
              if (Number.isFinite(n)) result.offsetMs = n;
            }
          } else {
            result.warnings.push(`etiqueta desconocida: [${meta[1]}:]`);
          }
        } else if (rest.startsWith('[')) {
          result.warnings.push(`marca inválida: ${sourceLine.slice(0, 40)}`);
        }
        continue; // texto suelto sin marca: se ignora en modo sincronizado
      }
      const firstTime = times[0];
      const enhanced = parseEnhanced(rest, firstTime);
      for (const t of times) {
        const delta = t - firstTime;
        raw.push({
          startMs: t,
          text: enhanced.text.trim(),
          words: enhanced.words?.map((w) => ({ text: w.text, startMs: w.startMs + delta })) ?? null,
          endTag: enhanced.endTag === null ? null : enhanced.endTag + delta,
          order: order++,
        });
      }
    }

    raw.sort((a, b) => a.startMs - b.startMs || a.order - b.order);
    const kept = dropDoubledLyrics(raw);
    if (kept.length < raw.length) result.warnings.push(`letra doble: ${raw.length - kept.length} versos repetidos con el mismo tiempo`);

    const tempo = songTempo(kept);
    result.lines = kept.map((r, i): LyricLine => {
      const next = kept[i + 1];
      let endMs: number;
      if (next) endMs = next.startMs;
      else {
        endMs = r.startMs + estimateLastLineMs(r.text);
        if (durationMs !== null && durationMs > r.startMs) endMs = Math.min(endMs, durationMs);
      }
      const isInterlude = r.text.length === 0;
      let words: LyricWord[];
      if (isInterlude) words = [];
      else if (r.words) {
        const wordEnd = r.endTag !== null ? Math.min(r.endTag, endMs) : endMs;
        words = r.words.map((w, j) => {
          const nextWord = r.words![j + 1];
          return {
            text: j === 0 ? w.text.trimStart() : w.text,
            startMs: w.startMs,
            endMs: Math.max(w.startMs, nextWord ? nextWord.startMs : wordEnd),
            estimated: false,
          };
        });
      } else words = simulateWords(r.text, r.startMs, endMs, tempo);
      return { index: i, startMs: r.startMs, endMs, text: r.text, words, isInterlude };
    });
  } catch (e) {
    result.lines = [];
    result.warnings.push(`error de parseo: ${String(e)}`);
  }
  return result;
}

/** Construye el documento final a partir de la respuesta (synced y/o plain). */
export function buildDocument(opts: {
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
  durationMs: number | null;
  source: LyricsDocument['source'];
  lrclibId: number | null;
}): LyricsDocument {
  const base = { source: opts.source, lrclibId: opts.lrclibId };
  if (opts.instrumental) return { ...base, kind: 'instrumental', lines: [], plainText: null, offsetMs: 0 };
  if (opts.synced && opts.synced.trim().length > 0) {
    const parsed = parseLrc(opts.synced, opts.durationMs);
    if (parsed.lines.some((l) => !l.isInterlude)) {
      return { ...base, kind: 'synced', lines: parsed.lines, plainText: opts.plain, offsetMs: parsed.offsetMs };
    }
  }
  if (opts.plain && opts.plain.trim().length > 0) {
    return { ...base, kind: 'plain', lines: [], plainText: opts.plain, offsetMs: 0 };
  }
  return { ...base, kind: 'none', lines: [], plainText: null, offsetMs: 0 };
}

/**
 * Modo experimental de letra plana (8.5.6 B): reparte las líneas uniformemente
 * entre el 8 % y el 95 % de la duración. Las palabras quedan marcadas como estimadas.
 */
export function estimatePlainLines(plainText: string, durationMs: number): LyricLine[] {
  const texts = plainText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (texts.length === 0 || durationMs <= 0) return [];
  const from = durationMs * 0.08;
  const span = durationMs * 0.95 - from;
  const step = span / texts.length;
  return texts.map((text, i) => {
    const startMs = Math.round(from + i * step);
    const endMs = Math.round(from + (i + 1) * step);
    return { index: i, startMs, endMs, text, words: simulateWords(text, startMs, endMs), isInterlude: false };
  });
}
