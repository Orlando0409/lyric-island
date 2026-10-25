import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignWordTexts, parseLyricsfile } from '../../src/core/lyricsfile';
import { computeFrame } from '../../src/core/sync';

const FIX = join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'lyricsfile');
const yaml = (name: string) => readFileSync(join(FIX, name), 'utf8');

describe('alignWordTexts', () => {
  it('recupera los espacios y la puntuación del texto de la línea', () => {
    expect(alignWordTexts('Hola, mundo cruel', ['Hola,', 'mundo', 'cruel'])).toEqual(['Hola, ', 'mundo ', 'cruel']);
    expect(alignWordTexts('夜空に光る島', ['夜空', 'に', '光る', '島'])).toEqual(['夜空', 'に', '光る', '島']);
  });
  it('palabra que no aparece: se usa tal cual con espacio', () => {
    expect(alignWordTexts('uno tres', ['uno', 'dos', 'tres'])).toEqual(['uno ', 'dos ', 'tres']);
  });
});

describe('parseLyricsfile', () => {
  it('tiempos reales por palabra (no estimados) y fin de canto = end_ms', () => {
    const lines = parseLyricsfile(yaml('basic-words.yaml'))!;
    expect(lines.map((l) => l.startMs)).toEqual([4000, 9000, 20000]);
    expect(lines[0].endMs).toBe(9000); // la línea dura hasta la siguiente
    expect(lines[0].words.map((w) => [w.text, w.startMs, w.endMs, w.estimated])).toEqual([
      ['Se ', 4000, 4300, false],
      ['enciende ', 4300, 5100, false],
      ['la ', 5100, 5350, false],
      ['isla', 5350, 6200, false],
    ]);
    expect(lines.at(-1)!.endMs).toBe(22000);
  });

  it('el hueco entre el fin de canto y la línea siguiente es un interludio', () => {
    const lines = parseLyricsfile(yaml('basic-words.yaml'))!;
    // Línea 2 termina de cantarse a las 11.5 s y la 3 empieza a las 20 s.
    expect(computeFrame(lines, 15_000).interlude).not.toBeNull();
  });

  it('comillas, escapes y números como texto', () => {
    const lines = parseLyricsfile(yaml('quoted.yaml'))!;
    expect(lines[0].text).toBe('Dijo: "ya llegó" y se fue');
    expect(lines[0].words.map((w) => w.text).join('')).toBe(lines[0].text);
    expect(lines[1].text).toBe('Escape é y tab\tfinal');
    expect(lines[2].text).toBe('12345');
  });

  it('líneas sin palabras se simulan, vacías son interludio, última sin end_ms se estima', () => {
    const lines = parseLyricsfile(yaml('mixed.yaml'), 60_000)!;
    expect(lines[1].isInterlude).toBe(true);
    expect(lines[2].words.every((w) => w.estimated)).toBe(true);
    expect(lines[2].words.at(-1)!.endMs).toBeLessThanOrEqual(27_500);
    expect(lines[3].words.every((w) => !w.estimated)).toBe(true);
    expect(lines[3].endMs).toBeGreaterThan(30_900);
  });

  it('desordenadas, entradas inválidas y palabras vacías', () => {
    const lines = parseLyricsfile(yaml('unsorted-and-missing.yaml'))!;
    expect(lines.map((l) => l.text)).toEqual(['Primera línea fuera de orden', 'Segunda línea', 'Final con palabra vacía']);
    expect(lines[1].words.map((w) => w.text)).toEqual(['Segunda ', 'línea']);
    expect(lines[2].words).toHaveLength(1);
  });

  it('YAML inválido o sin líneas → null (se usa syncedLyrics)', () => {
    expect(parseLyricsfile(yaml('invalid.yaml'))).toBeNull();
    expect(parseLyricsfile(yaml('no-lines.yaml'))).toBeNull();
    expect(parseLyricsfile('42')).toBeNull();
    expect(parseLyricsfile('lines: 5')).toBeNull();
  });
});
