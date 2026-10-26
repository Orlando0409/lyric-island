import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDocument } from '../../src/core/lrc';
import { alignRomaji, isJapaneseLyrics, kanaToRomaji, romajiFill, romanizeDocument, tokensToRomaji, type JaToken } from '../../src/core/romaji';

// Casos escritos a mano (romaji correcto), compartidos con android/core.
const cases = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'romaji', 'cases.json'), 'utf8')) as {
  kana: [string, string][];
  tokens: { tokens: [string, string | null, string, string][]; romaji: string }[];
  align: { text: string; tokens: number; romaji: string; marks: number[] }[];
  fill: { text: string; romaji: string; marks: number[]; words: string[]; wordIndex: number; wordProgress: number; fill: number }[];
  detect: { lines: string[]; japanese: boolean }[];
};
const toTokens = (rows: [string, string | null, string, string][]): JaToken[] =>
  rows.map(([surface, reading, pos, posDetail]) => ({ surface, reading, pos, posDetail }));

describe('kanaToRomaji (Hepburn)', () => {
  it.each(cases.kana)('%s → %s', (kana, romaji) => {
    expect(kanaToRomaji(kana)).toBe(romaji);
  });
});

describe('tokensToRomaji', () => {
  it.each(cases.tokens.map((c) => [c.romaji, c.tokens] as const))('→ %s', (romaji, rows) => {
    expect(tokensToRomaji(toTokens([...rows]))).toBe(romaji);
  });
});

describe('alignRomaji', () => {
  it.each(cases.align.map((c) => [c.romaji, c] as const))('→ %s', (_, c) => {
    expect(alignRomaji(c.text, toTokens([...cases.tokens[c.tokens].tokens]))).toEqual({ romaji: c.romaji, marks: c.marks });
  });
});

describe('romajiFill: el romaji avanza al mismo punto que lo cantado del original', () => {
  it.each(cases.fill.map((c) => [c.text, c.wordIndex, c.wordProgress, c.fill, c] as const))('%s @%i+%d → %d', (_t, _i, _p, fill, c) => {
    const line = { text: c.text, romaji: c.romaji, romajiMarks: c.marks, words: c.words.map((text) => ({ text, startMs: 0, endMs: 0, estimated: true })) };
    expect(romajiFill(line, c.wordIndex, c.wordProgress)).toBeCloseTo(fill, 9);
  });
});

describe('detección de letras en japonés', () => {
  it.each(cases.detect)('$lines → $japanese', ({ lines, japanese }) => {
    expect(isJapaneseLyrics(lines.map((text) => ({ text })))).toBe(japanese);
  });
});

describe('romanizeDocument', () => {
  const fake = (text: string): JaToken[] => [{ surface: text, reading: 'ヨゾラ', pos: '名詞', posDetail: '一般' }];
  it('agrega romaji solo a las líneas con japonés de una canción japonesa', () => {
    const doc = buildDocument({ synced: '[00:01.00]夜空に\n[00:03.00]Love\n[00:05.00]ひかり', plain: null, instrumental: false, durationMs: 10_000, source: 'lrclib', lrclibId: 1 });
    const r = romanizeDocument(doc, fake);
    expect(r.lines.map((l) => l.romaji ?? null)).toEqual(['yozora', null, 'yozora']);
  });
  it('no toca canciones que no son japonesas ni letras sin sincronizar', () => {
    const zh = buildDocument({ synced: '[00:01.00]海上的小岛', plain: null, instrumental: false, durationMs: 10_000, source: 'lrclib', lrclibId: 1 });
    expect(romanizeDocument(zh, fake)).toBe(zh);
    const plain = buildDocument({ synced: null, plain: 'ひかり', instrumental: false, durationMs: 10_000, source: 'lrclib', lrclibId: 1 });
    expect(romanizeDocument(plain, fake)).toBe(plain);
  });
});
