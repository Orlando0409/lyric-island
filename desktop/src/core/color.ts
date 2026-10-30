// ColorEngine: paleta a partir de los swatches de la carátula, en OKLCH, con contraste WCAG garantizado.
import type { Palette } from './types';

export type SwatchName = 'Vibrant' | 'DarkVibrant' | 'Muted' | 'DarkMuted' | 'LightVibrant' | 'LightMuted' | 'Dominant';
export interface Swatch {
  hex: string; // #RRGGBB
  population: number;
}
export type Swatches = Partial<Record<SwatchName, Swatch | null>>;

export interface Oklch {
  l: number;
  c: number;
  h: number; // grados
}

export const NEUTRAL_PALETTE: Palette = {
  background: '#1C1C1E',
  backgroundAlt: '#2C2C2E',
  textPrimary: '#FFFFFF',
  textUpcoming: '#FFFFFF73',
  textSecondary: '#FFFFFF8C',
  accent: '#A1A1A6',
};

export const BG_L_MIN = 0.22;
export const BG_L_MAX = 0.38;
export const BG_C_MAX = 0.16;
export const MIN_CONTRAST = 4.5;
export const MIN_POPULATION_SHARE = 0.02;
const BACKGROUND_ORDER: SwatchName[] = ['DarkVibrant', 'Vibrant', 'DarkMuted', 'Muted', 'Dominant'];

/** Adapta la salida de node-vibrant / androidx.palette ({hex, population} por nombre) a Swatches. */
export function toSwatches(palette: Record<string, { hex: string; population: number } | null | undefined>): Swatches {
  const out: Swatches = {};
  const names: SwatchName[] = ['Vibrant', 'DarkVibrant', 'Muted', 'DarkMuted', 'LightVibrant', 'LightMuted', 'Dominant'];
  for (const n of names) {
    const s = palette[n];
    if (s) out[n] = { hex: s.hex.toUpperCase(), population: s.population };
  }
  return out;
}

// ---------- conversiones ----------

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) throw new Error(`color inválido: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;

export function hexToOklch(hex: string): Oklch {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

/** OKLCH → sRGB lineal (puede quedar fuera de gama). */
function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: [number, number, number]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH → hex, reduciendo el croma (búsqueda binaria) hasta entrar en la gama sRGB. */
export function oklchToHex(color: Oklch): string {
  const l = Math.min(1, Math.max(0, color.l));
  let rgb = oklchToLinear({ ...color, l });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = color.c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h: color.h }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear({ l, c: lo, h: color.h });
  }
  const [r, g, b] = rgb.map((v) => fromLinear(Math.min(1, Math.max(0, v))));
  return rgbToHex(r, g, b);
}

// ---------- contraste WCAG ----------

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------- paleta ----------

function adjustBackground(c: Oklch): Oklch {
  return { l: Math.min(BG_L_MAX, Math.max(BG_L_MIN, c.l)), c: Math.min(c.c, BG_C_MAX), h: c.h };
}

export function validSwatches(swatches: Swatches | null | undefined): SwatchName[] {
  if (!swatches) return [];
  const names = Object.keys(swatches) as SwatchName[];
  const total = names.reduce((sum, n) => sum + (swatches[n]?.population ?? 0), 0);
  if (total <= 0) return [];
  return names.filter((n) => {
    const s = swatches[n];
    return !!s && /^#?[0-9a-f]{6}$/i.test(s.hex) && s.population / total >= MIN_POPULATION_SHARE;
  });
}

export function buildPalette(swatches: Swatches | null | undefined): Palette {
  const valid = new Set(validSwatches(swatches));
  const ordered = BACKGROUND_ORDER.filter((n) => valid.has(n)).map((n) => swatches![n]!.hex);
  if (ordered.length === 0) return { ...NEUTRAL_PALETTE };

  let bg = adjustBackground(hexToOklch(ordered[0]));
  const altSource = ordered.slice(1).find((hex) => hex.toUpperCase() !== ordered[0].toUpperCase());
  let alt = altSource ? adjustBackground(hexToOklch(altSource)) : { ...bg, l: Math.max(0, bg.l - 0.06) };

  const textPrimary = '#FFFFFF';
  let bgHex = oklchToHex(bg);
  let altHex = oklchToHex(alt);
  for (let step = 0; step < 10; step++) {
    const okBg = contrastRatio(textPrimary, bgHex) >= MIN_CONTRAST;
    const okAlt = contrastRatio(textPrimary, altHex) >= MIN_CONTRAST;
    if (okBg && okAlt) break;
    if (!okBg) bg = { ...bg, l: Math.max(0, bg.l - 0.02) };
    if (!okAlt) alt = { ...alt, l: Math.max(0, alt.l - 0.02) };
    bgHex = oklchToHex(bg);
    altHex = oklchToHex(alt);
  }

  let accent: string;
  if (valid.has('LightVibrant')) accent = swatches!.LightVibrant!.hex.toUpperCase();
  else if (valid.has('Vibrant')) accent = oklchToHex({ ...hexToOklch(swatches!.Vibrant!.hex), l: 0.75 });
  else accent = oklchToHex({ ...bg, l: 0.75 });

  return {
    background: bgHex,
    backgroundAlt: altHex,
    textPrimary,
    textUpcoming: '#FFFFFF73', // alfa 0.45
    textSecondary: '#FFFFFF8C', // alfa 0.55
    accent: accent.startsWith('#') ? accent : `#${accent}`,
  };
}

/**
 * Color de degradado elegido por el usuario → fondo legible: si el texto blanco no llega a contraste 4.5,
 * se oscurece en OKLCH (mismo tono) hasta llegar.
 */
export function readableBackground(hex: string): string {
  const input = rgbToHex(...hexToRgb(hex));
  if (contrastRatio('#FFFFFF', input) >= MIN_CONTRAST) return input;
  let c = hexToOklch(input);
  let out = input;
  for (let step = 0; step < 50 && contrastRatio('#FFFFFF', out) < MIN_CONTRAST; step++) {
    c = { ...c, l: Math.max(0, c.l - 0.02) };
    out = oklchToHex(c);
  }
  return out;
}

/** Interpolación en OKLCH por el camino corto del tono (transiciones de 600 ms, 9.5). */
export function mixOklch(a: string, b: string, t: number): string {
  const ca = hexToOklch(a);
  const cb = hexToOklch(b);
  let ha = ca.h;
  let hb = cb.h;
  if (ca.c < 0.002) ha = hb;
  if (cb.c < 0.002) hb = ha;
  let dh = hb - ha;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const k = Math.min(1, Math.max(0, t));
  let h = ha + dh * k;
  if (h < 0) h += 360;
  if (h >= 360) h -= 360;
  return oklchToHex({ l: ca.l + (cb.l - ca.l) * k, c: ca.c + (cb.c - ca.c) * k, h });
}

export function mixPalette(a: Palette, b: Palette, t: number): Palette {
  return {
    ...b,
    background: mixOklch(a.background, b.background, t),
    backgroundAlt: mixOklch(a.backgroundAlt, b.backgroundAlt, t),
    accent: mixOklch(a.accent, b.accent, t),
  };
}
