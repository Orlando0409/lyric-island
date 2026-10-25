import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDocument, estimateLastLineMs, estimatePlainLines, fractionToMs, parseLrc } from '../../src/core/lrc';
import { simulateWords, singEstimateMs, tokenize, wordWeight } from '../../src/core/words';

const FIX = join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'lrc');
const lrc = (name: string) => readFileSync(join(FIX, name), 'utf8');

describe('fractionToMs', () => {
  it('normaliza fracciones de 1, 2 y 3 dígitos', () => {
    expect(fractionToMs('5')).toBe(500);
    expect(fractionToMs('34')).toBe(340);
    expect(fractionToMs('123')).toBe(123);
    expect(fractionToMs(undefined)).toBe(0);
  });
});

describe('parseLrc', () => {
  it('parsea un LRC básico con metadatos', () => {
    const p = parseLrc(lrc('basic.lrc'));
    expect(p.meta).toMatchObject({ ar: 'Los Fixtures', ti: 'Isla de Luz', al: 'Pruebas Unitarias', length: '03:30' });
    expect(p.lines.map((l) => l.startMs)).toEqual([12340, 16100, 20000, 25500]);
    expect(p.lines.map((l) => l.endMs)).toEqual([16100, 20000, 25500, 25500 + 2520]);
    expect(p.lines.every((l, i) => l.index === i)).toBe(true);
  });

  it('cubre todos los casos de la tabla 8.3', () => {
    const p = parseLrc(lrc('all-cases.lrc'));
    expect(p.offsetMs).toBe(150);
    expect(p.lines.map((l) => l.startMs)).toEqual([12340, 16100, 20000, 25500, 30123, 35000, 40000, 50000, 105000]);
    expect(p.lines[2].text).toBe(p.lines[8].text);
    expect(p.lines[6].isInterlude).toBe(true);
    expect(p.lines[6].words).toEqual([]);
    const enhanced = p.lines[7];
    expect(enhanced.text).toBe('Palabra por palabra');
    expect(enhanced.words).toEqual([
      { text: 'Palabra ', startMs: 50000, endMs: 50600, estimated: false },
      { text: 'por ', startMs: 50600, endMs: 51000, estimated: false },
      { text: 'palabra', startMs: 51000, endMs: 105000, estimated: false },
    ]);
    expect(p.lines[8].endMs).toBe(105000 + estimateLastLineMs(p.lines[8].text));
  });

  it('elimina BOM y normaliza CRLF', () => {
    const p = parseLrc(lrc('bom-crlf.lrc'));
    expect(p.meta.ti).toBe('Con BOM');
    expect(p.lines.map((l) => l.text)).toEqual(['Línea con BOM', 'Y saltos CRLF']);
  });

  it('lee offsets negativos y positivos', () => {
    expect(parseLrc(lrc('offset-negative.lrc')).offsetMs).toBe(-300);
    expect(parseLrc(lrc('offset-positive.lrc')).offsetMs).toBe(500);
  });

  it('ordena líneas desordenadas', () => {
    expect(parseLrc(lrc('unsorted.lrc')).lines.map((l) => l.text)).toEqual(['Primera', 'Segunda', 'Tercera']);
  });

  it('acepta minutos ≥ 60', () => {
    expect(parseLrc(lrc('long-minutes.lrc')).lines[1].startMs).toBe(75 * 60_000 + 10_000);
  });

  it('ignora marcas inválidas y texto suelto, registrando advertencias', () => {
    const p = parseLrc(lrc('invalid-tags.lrc'));
    expect(p.lines.map((l) => l.startMs)).toEqual([5000, 8000]);
    expect(p.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it.each(['empty.lrc', 'only-meta.lrc', 'garbage.lrc'])('no lanza con %s y no devuelve líneas', (name) => {
    expect(() => parseLrc(lrc(name))).not.toThrow();
    expect(parseLrc(lrc(name)).lines).toEqual([]);
  });

  it('acepta basura binaria arbitraria sin lanzar', () => {
    let s = '';
    for (let i = 0; i < 4000; i++) s += String.fromCharCode((i * 7919) % 65536);
    expect(() => parseLrc(s)).not.toThrow();
  });

  it('LRC mejorado: marca final sin texto cierra la última palabra', () => {
    const p = parseLrc(lrc('enhanced.lrc'));
    expect(p.lines[0].words.map((w) => [w.text, w.startMs, w.endMs])).toEqual([
      ['Cada ', 1000, 1500],
      ['palabra ', 1500, 2200],
      ['tiene ', 2200, 2800],
      ['su ', 2800, 3000],
      ['tiempo', 3000, 3600],
    ]);
    expect(p.lines[1].words.at(-1)).toMatchObject({ text: 'final', endMs: 9000, estimated: false });
    expect(p.lines[2].words.every((w) => w.estimated)).toBe(true);
  });

  it('marcas duplicadas conservan el orden original', () => {
    const p = parseLrc(lrc('duplicate-times.lrc'));
    expect(p.lines.map((l) => l.text)).toEqual(['Mismo instante A', 'Mismo instante B', 'Después']);
    expect(p.lines[0].words.every((w) => w.startMs === 5000 && w.endMs === 5000)).toBe(true);
  });

  it('acepta fracción separada por dos puntos', () => {
    expect(parseLrc(lrc('colon-fraction.lrc')).lines.map((l) => l.startMs)).toEqual([5500, 8250]);
  });

  it('recorta espacios y tabuladores', () => {
    expect(parseLrc(lrc('spaces-tabs.lrc')).lines.map((l) => l.text)).toEqual(['Espacios alrededor', 'Con tabulador']);
  });

  it('última línea limitada por la duración de la pista', () => {
    const p = parseLrc(lrc('last-line-short.lrc'), 3500);
    expect(p.lines[1].endMs).toBe(3500);
  });

  it('metadatos conocidos y desconocidos', () => {
    const p = parseLrc(lrc('unknown-meta.lrc'));
    expect(p.meta).toMatchObject({ re: 'Editor X', ve: '1.0', by: 'Alguien', au: 'Autor' });
    expect(p.warnings.some((w) => w.includes('xx'))).toBe(true);
    expect(p.lines).toHaveLength(1);
  });

  it('textos RTL, CJK, emoji y líneas largas', () => {
    expect(parseLrc(lrc('rtl-arabic.lrc')).lines[0].words.length).toBe(4);
    expect(parseLrc(lrc('rtl-hebrew.lrc')).lines[0].text).toBe('אי קטן בלילה');
    expect(parseLrc(lrc('cjk-japanese.lrc')).lines[0].words.length).toBe(6);
    expect(parseLrc(lrc('emoji.lrc')).lines[1].words[0].text).toBe('👨‍👩‍👧 ');
    expect(parseLrc(lrc('long-line.lrc')).lines[0].text.length).toBeGreaterThan(200);
  });

  it('corpus sintético: líneas ordenadas, endMs ≥ startMs, palabras dentro de la línea', () => {
    for (let i = 0; i < 22; i++) {
      const p = parseLrc(lrc(`synthetic-${String(i).padStart(2, '0')}.lrc`));
      expect(p.lines.length).toBeGreaterThan(10);
      for (const l of p.lines) {
        expect(l.endMs).toBeGreaterThanOrEqual(l.startMs);
        for (const w of l.words) {
          expect(w.startMs).toBeGreaterThanOrEqual(l.startMs);
          expect(w.endMs).toBeLessThanOrEqual(l.endMs);
        }
      }
    }
  });
});

describe('tokenize', () => {
  it('divide por palabra conservando el espacio final', () => {
    expect(tokenize('Hola  mundo cruel')).toEqual(['Hola  ', 'mundo ', 'cruel']);
  });
  it('divide CJK (japonés/chino) por carácter', () => {
    expect(tokenize('夜空に光る島')).toEqual(['夜', '空', 'に', '光', 'る', '島']);
    expect(tokenize('海上的 小岛')).toEqual(['海', '上', '的 ', '小', '岛']);
  });
  it('coreano por palabra', () => {
    expect(tokenize('밤하늘 위의 작은 섬')).toEqual(['밤하늘 ', '위의 ', '작은 ', '섬']);
  });
  it('mezcla latín y CJK', () => {
    expect(tokenize('I love 東京 city')).toEqual(['I ', 'love ', '東', '京 ', 'city']);
  });
  it('línea vacía', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('karaoke simulado', () => {
  it('la suma de duraciones no supera la línea y empieza en t0', () => {
    const words = simulateWords('Cada palabra brilla en su lugar', 1000, 5000);
    expect(words[0].startMs).toBe(1000);
    expect(words.at(-1)!.endMs).toBeLessThanOrEqual(5000);
    for (let i = 1; i < words.length; i++) expect(words[i].startMs).toBe(words[i - 1].endMs);
  });
  it('las palabras largas duran más', () => {
    const [a, b] = simulateWords('yo extraordinariamente', 0, 10000);
    expect(b.endMs - b.startMs).toBeGreaterThan(a.endMs - a.startMs);
  });
  it('huecos largos no estiran las palabras', () => {
    const words = simulateWords('Hola mundo', 0, 12000);
    expect(words.at(-1)!.endMs).toBe(990); // 9 caracteres × 110 ms
  });
  it('japonés y coreano: duración de canto por sílaba, no por letra latina (regresión)', () => {
    // 12 caracteres kana/kanji × 260 ms = 3 120 ms (antes 12 × 110 = 1 320: el relleno terminaba al 33 %).
    const ja = simulateWords('その一言で全てが分かった', 0, 4000);
    expect(ja).toHaveLength(12);
    expect(ja.at(-1)!.endMs).toBe(3120);
    // 8 sílabas hangul × 290 ms = 2 320 ms.
    expect(simulateWords('밤하늘 위의 작은 섬', 0, 4000).at(-1)!.endMs).toBe(2320);
    // Mezcla: la palabra coreana pesa por sus sílabas reales frente a la inglesa.
    const [en, ko] = simulateWords('World 거듭해서', 0, 10_000);
    expect(ko.endMs - ko.startMs).toBeGreaterThan(en.endMs - en.startMs);
    expect(singEstimateMs('Hola mundo')).toBe(990);
    expect(estimateLastLineMs('その一言で全てが分かった')).toBe(2553);
  });
  it('mínimo de 800 ms para líneas cortas', () => {
    expect(simulateWords('Sí', 0, 5000).at(-1)!.endMs).toBe(800);
  });
  it('la puntuación agrega peso', () => {
    expect(wordWeight('hola,')).toBe(5.5);
    expect(wordWeight('a')).toBe(2);
    expect(wordWeight('fin. ')).toBe(4.5);
  });
  it('una sola palabra ocupa toda la duración de canto', () => {
    expect(simulateWords('Hola', 0, 3000)).toEqual([{ text: 'Hola', startMs: 0, endMs: 800, estimated: true }]);
  });
  it('línea vacía no tiene palabras', () => {
    expect(simulateWords('', 0, 3000)).toEqual([]);
  });
});

describe('buildDocument', () => {
  const base = { durationMs: 60000, source: 'lrclib' as const, lrclibId: 1 };
  it('instrumental', () => {
    expect(buildDocument({ ...base, synced: '[00:01.00]x', plain: 'x', instrumental: true }).kind).toBe('instrumental');
  });
  it('sincronizada', () => {
    const d = buildDocument({ ...base, synced: lrc('offset-positive.lrc'), plain: null, instrumental: false });
    expect(d.kind).toBe('synced');
    expect(d.offsetMs).toBe(500);
  });
  it('LRC sin marcas válidas cae a texto plano', () => {
    expect(buildDocument({ ...base, synced: '[ar:x]\n', plain: 'hola', instrumental: false }).kind).toBe('plain');
    expect(buildDocument({ ...base, synced: '[00:01.00]\n', plain: 'hola', instrumental: false }).kind).toBe('plain');
  });
  it('sin nada', () => {
    expect(buildDocument({ ...base, synced: null, plain: '  ', instrumental: false }).kind).toBe('none');
  });
});

describe('estimatePlainLines', () => {
  it('reparte entre el 8 % y el 95 % de la duración', () => {
    const lines = estimatePlainLines('uno\n\ndos\r\ntres', 100_000);
    expect(lines.map((l) => l.text)).toEqual(['uno', 'dos', 'tres']);
    expect(lines[0].startMs).toBe(8000);
    expect(lines.at(-1)!.endMs).toBe(95000);
    expect(lines[0].words[0].estimated).toBe(true);
  });
  it('vacío o duración cero', () => {
    expect(estimatePlainLines('', 1000)).toEqual([]);
    expect(estimatePlainLines('a', 0)).toEqual([]);
  });
});
