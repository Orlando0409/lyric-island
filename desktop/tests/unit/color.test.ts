import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vibrant } from 'node-vibrant/node';
import { describe, expect, it } from 'vitest';
import {
  buildPalette,
  contrastRatio,
  hexToOklch,
  hexToRgb,
  mixOklch,
  mixPalette,
  NEUTRAL_PALETTE,
  oklchToHex,
  readableBackground,
  rgbToHex,
  toSwatches,
  validSwatches,
  BG_C_MAX,
  BG_L_MAX,
  BG_L_MIN,
} from '../../src/core/color';

const ART = join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'artwork');

describe('conversiones', () => {
  it('hex ↔ rgb', () => {
    expect(hexToRgb('#1c1c1e')).toEqual([28, 28, 30]);
    expect(hexToRgb('FFFFFF80')).toEqual([255, 255, 255]);
    expect(rgbToHex(255, 0, 300)).toBe('#FF00FF');
    expect(() => hexToRgb('rojo')).toThrow();
  });
  it('OKLCH ida y vuelta conserva el color', () => {
    for (const hex of ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#1C1C1E', '#7F3FBF', '#C0FFEE']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });
  it('valores OKLCH de referencia', () => {
    const red = hexToOklch('#FF0000');
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
    expect(hexToOklch('#FFFFFF').l).toBeCloseTo(1, 4);
  });
  it('fuera de gama reduce el croma', () => {
    const hex = oklchToHex({ l: 0.5, c: 0.5, h: 140 });
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(hexToOklch(hex).c).toBeLessThan(0.5);
  });
  it('contraste WCAG', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
});

describe('buildPalette', () => {
  it('sin carátula → paleta neutra', () => {
    expect(buildPalette(null)).toEqual(NEUTRAL_PALETTE);
    expect(buildPalette({})).toEqual(NEUTRAL_PALETTE);
    expect(buildPalette({ Vibrant: { hex: '#FF0000', population: 0 } })).toEqual(NEUTRAL_PALETTE);
  });
  it('descarta swatches con población < 2 %', () => {
    const s = { Vibrant: { hex: '#FF0000', population: 1 }, Muted: { hex: '#336699', population: 99 } };
    expect(validSwatches(s)).toEqual(['Muted']);
  });
  it('prefiere DarkVibrant y ajusta L y C', () => {
    const p = buildPalette({
      DarkVibrant: { hex: '#0A6E2E', population: 50 },
      Vibrant: { hex: '#FF2D55', population: 50 },
      LightVibrant: { hex: '#ffd1dc', population: 20 },
    });
    const bg = hexToOklch(p.background);
    expect(bg.l).toBeGreaterThanOrEqual(BG_L_MIN - 0.01);
    expect(bg.l).toBeLessThanOrEqual(BG_L_MAX + 0.01);
    expect(bg.c).toBeLessThanOrEqual(BG_C_MAX + 0.01);
    expect(Math.abs(bg.h - hexToOklch('#0A6E2E').h)).toBeLessThan(3);
    expect(p.accent).toBe('#FFD1DC');
    expect(p.textUpcoming).toBe('#FFFFFF73');
  });
  it('un solo swatch → alt = mismo color con L − 0.06; accent derivado', () => {
    const p = buildPalette({ Muted: { hex: '#556677', population: 10 } });
    expect(hexToOklch(p.backgroundAlt).l).toBeCloseTo(hexToOklch(p.background).l - 0.06, 2);
    expect(hexToOklch(p.accent).l).toBeCloseTo(0.75, 2);
  });
  it('accent desde Vibrant con L = 0.75', () => {
    const p = buildPalette({ Vibrant: { hex: '#3355FF', population: 10 } });
    expect(hexToOklch(p.accent).l).toBeCloseTo(0.75, 2);
  });
  it('carátulas casi blancas, casi negras y monocromas', () => {
    for (const hex of ['#FAFAFA', '#FFFFFF', '#050505', '#000000', '#808080']) {
      const p = buildPalette({ Dominant: { hex, population: 100 } });
      expect(contrastRatio(p.textPrimary, p.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.textPrimary, p.backgroundAlt)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('toSwatches adapta la salida de vibrant', () => {
    expect(toSwatches({ Vibrant: { hex: '#abcdef', population: 3 }, Muted: null })).toEqual({ Vibrant: { hex: '#ABCDEF', population: 3 } });
  });
});

describe('degradado personalizado (readableBackground)', () => {
  const golden = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'expected', 'readable-backgrounds.json'), 'utf8')) as { input: string; output: string }[];
  it.each(golden.map((g) => [g.input, g.output] as const))('%s → %s, texto blanco legible', (input, output) => {
    const out = readableBackground(input);
    expect(out).toBe(output);
    expect(contrastRatio('#FFFFFF', out)).toBeGreaterThanOrEqual(4.5);
  });
  it('mantiene el tono y no toca colores ya legibles', () => {
    expect(readableBackground('#6a3de8')).toBe('#6A3DE8');
    expect(Math.abs(hexToOklch(readableBackground('#FFD60A')).h - hexToOklch('#FFD60A').h)).toBeLessThan(3);
  });
});

describe('transiciones OKLCH', () => {
  it('extremos y punto medio', () => {
    expect(mixOklch('#FF0000', '#0000FF', 0)).toBe('#FF0000');
    expect(mixOklch('#FF0000', '#0000FF', 1)).toBe('#0000FF');
    expect(mixOklch('#808080', '#FF0000', 0.5)).toMatch(/^#[0-9A-F]{6}$/);
    expect(mixOklch('#FF0000', '#FF00FF', 0.5)).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('mixPalette conserva los textos del destino', () => {
    const p = mixPalette(NEUTRAL_PALETTE, { ...NEUTRAL_PALETTE, background: '#003366' }, 1);
    expect(p.background).toBe('#003366');
    expect(p.textPrimary).toBe('#FFFFFF');
  });
});

describe('corpus de 200 carátulas (node-vibrant → paleta)', () => {
  const files = readdirSync(ART).filter((f) => f.endsWith('.png'));
  it('hay 200 carátulas', () => expect(files.length).toBe(200));
  it('contraste ≥ 4.5 en el 100 % de los casos', async () => {
    const failures: string[] = [];
    for (const f of files) {
      const palette = await Vibrant.from(join(ART, f)).getPalette();
      const p = buildPalette(toSwatches(palette));
      if (contrastRatio(p.textPrimary, p.background) < 4.5 || contrastRatio(p.textPrimary, p.backgroundAlt) < 4.5) failures.push(f);
    }
    expect(failures).toEqual([]);
  }, 60_000);
});
