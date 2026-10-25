// Carátula → paleta (node-vibrant en el renderer, mismo algoritmo de swatches que androidx.palette).
import { Vibrant } from 'node-vibrant/browser';
import { buildPalette, NEUTRAL_PALETTE, toSwatches } from '../../core/color';
import type { Palette } from '../../core/types';

const cache = new Map<string, Palette>();

export async function paletteFromArtwork(hash: string | null, dataUrl: string | null): Promise<Palette> {
  if (!hash || !dataUrl) return NEUTRAL_PALETTE;
  const hit = cache.get(hash);
  if (hit) return hit;
  try {
    const swatches = toSwatches(await Vibrant.from(dataUrl).getPalette());
    const p = buildPalette(swatches);
    cache.set(hash, p);
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
    return p;
  } catch {
    return NEUTRAL_PALETTE; // la extracción falló → paleta neutra
  }
}
