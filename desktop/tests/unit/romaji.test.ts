import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDocument } from '../../src/core/lrc';
import { isJapaneseLyrics, kanaToRomaji, romanizeDocument, tokensToRomaji, type JaToken } from '../../src/core/romaji';

// Casos escritos a mano (romaji correcto), compartidos con android/core.
const cases = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'romaji', 'cases.json'), 'utf8')) as {
  kana: [string, string][];
  tokens: { tokens: [string, string | null, string, string][]; romaji: string }[];
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
