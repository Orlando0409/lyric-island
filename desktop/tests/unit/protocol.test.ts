import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextBackoff, BACKOFF_MAX_MS } from '../../src/main/mediaBridge';
import { parseHelperLine } from '../../src/main/protocol';
import { DEFAULT_SETTINGS, mergeSettings, parseSettings } from '../../src/shared/settings';

const CONTRACT = join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'expected', 'protocol-from-csharp.ndjson');

describe('contrato del protocolo C# ↔ zod (15.4)', () => {
  it.skipIf(!existsSync(CONTRACT))('cada mensaje generado por el helper C# valida con los esquemas zod', () => {
    const lines = readFileSync(CONTRACT, 'utf8').split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(8);
    for (const l of lines) {
      const r = parseHelperLine(l);
      expect(r, l).toMatchObject({ ok: true });
    }
  });
});

describe('parseHelperLine', () => {
  it('acepta los ejemplos de la sección 7.3', () => {
    expect(parseHelperLine('{"v":1,"type":"hello","helperVersion":"0.1.0","os":"10.0.22631"}').ok).toBe(true);
    expect(parseHelperLine('{"v":1,"type":"timeline","positionMs":83120,"updatedAtMs":1761340000123,"rate":1.0,"status":"playing"}').ok).toBe(true);
    expect(parseHelperLine('{"v":1,"type":"fullscreen","active":true}').ok).toBe(true);
  });
  it('descarta JSON inválido, tipos desconocidos y versiones distintas sin lanzar', () => {
    expect(parseHelperLine('no json')).toMatchObject({ ok: false, versionMismatch: false });
    expect(parseHelperLine('{"v":1,"type":"nope"}')).toMatchObject({ ok: false, versionMismatch: false });
    expect(parseHelperLine('{"v":1,"type":"timeline","positionMs":-5,"updatedAtMs":0,"rate":1,"status":"playing"}').ok).toBe(false);
    expect(parseHelperLine('{"v":2,"type":"cleared"}')).toMatchObject({ ok: false, versionMismatch: true });
  });
});

describe('backoff del helper', () => {
  it('1 s, 2 s, 4 s… con tope de 30 s', () => {
    const seq = [1000];
    for (let i = 0; i < 6; i++) seq.push(nextBackoff(seq.at(-1)!));
    expect(seq).toEqual([1000, 2000, 4000, 8000, 16000, BACKOFF_MAX_MS, BACKOFF_MAX_MS]);
  });
});

describe('ajustes', () => {
  it('valores por defecto, basura y mezcla parcial', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ appearance: { fontScale: 99 } })).toEqual(DEFAULT_SETTINGS);
    const s = mergeSettings(DEFAULT_SETTINGS, { appearance: { showNextLine: false }, players: { apps: ['vlc'] } });
    expect(s.appearance.showNextLine).toBe(false);
    expect(s.appearance.fontScale).toBe(1);
    expect(s.players.apps).toEqual(['vlc']);
    expect(DEFAULT_SETTINGS.shortcuts.toggleVisible).toBe('Control+Alt+L');
  });
});
