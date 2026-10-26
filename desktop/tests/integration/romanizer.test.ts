import { describe, expect, it } from 'vitest';
import { buildDocument } from '../../src/core/lrc';
import { addRomaji } from '../../src/main/romanizer';

// Integración con kuromoji real (diccionario IPADIC incluido): lecturas de kanji + Hepburn del núcleo.
describe('addRomaji (kuromoji)', () => {
  it('romaniza una canción en japonés con kanji, partículas y verbos conjugados', async () => {
    const doc = buildDocument({
      synced: '[00:01.00]夜空に光る島を見ていた\n[00:05.00]君は「さよなら」と言った\n[00:09.00]Love song',
      plain: null,
      instrumental: false,
      durationMs: 20_000,
      source: 'lrclib',
      lrclibId: 1,
    });
    const r = await addRomaji(doc);
    expect(r.lines.map((l) => l.romaji ?? null)).toEqual(['yozora ni hikaru shima o miteita', 'kimi wa "sayonara" to itta', null]);
  }, 30_000);

  it('no toca letras que no son japonesas', async () => {
    const doc = buildDocument({ synced: '[00:01.00]Hola mundo', plain: null, instrumental: false, durationMs: 5000, source: 'lrclib', lrclibId: 1 });
    expect(await addRomaji(doc)).toBe(doc);
  });
});
