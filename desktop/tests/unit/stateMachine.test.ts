import { describe, expect, it } from 'vitest';
import { DEFAULT_BEHAVIOR, decideMode, isAppAllowed, type IslandBehavior, type MachineFacts } from '../../src/core/stateMachine';

const track = { sourceAppId: 'Spotify.exe', title: 'T', artist: 'A', album: 'B', durationMs: 200_000, artworkHash: null };
const facts = (over: Partial<MachineFacts> = {}): MachineFacts => ({
  track,
  status: 'playing',
  lyrics: 'synced',
  fullscreen: false,
  userHidden: false,
  userCompact: false,
  pausedSinceMs: null,
  isAd: false,
  now: 100_000,
  ...over,
});
const B = (over: Partial<IslandBehavior> = {}): IslandBehavior => ({ ...DEFAULT_BEHAVIOR, ...over });

describe('isAppAllowed', () => {
  it('deny vacío permite todo; deny bloquea por subcadena', () => {
    expect(isAppAllowed('Spotify.exe', { mode: 'deny', apps: [] })).toBe(true);
    expect(isAppAllowed('chrome.exe', { mode: 'deny', apps: ['Chrome'] })).toBe(false);
  });
  it('allow vacío permite todo; allow restringe', () => {
    expect(isAppAllowed('vlc.exe', { mode: 'allow', apps: [] })).toBe(true);
    expect(isAppAllowed('vlc.exe', { mode: 'allow', apps: ['spotify', ' '] })).toBe(false);
    expect(isAppAllowed('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify', { mode: 'allow', apps: ['spotify'] })).toBe(true);
  });
});

describe('decideMode', () => {
  it('HIDDEN: sin sesión, detenida, filtro, usuario, pantalla completa', () => {
    expect(decideMode(facts({ track: null }), B()).mode).toBe('hidden');
    expect(decideMode(facts({ status: 'stopped' }), B()).mode).toBe('hidden');
    expect(decideMode(facts(), B({ playerFilter: { mode: 'deny', apps: ['spotify'] } })).mode).toBe('hidden');
    expect(decideMode(facts({ userHidden: true }), B()).mode).toBe('hidden');
    expect(decideMode(facts({ fullscreen: true }), B()).mode).toBe('hidden');
    expect(decideMode(facts({ fullscreen: true }), B({ hideOnFullscreen: false })).mode).toBe('expanded');
  });
  it('EXPANDED con letra sincronizada reproduciendo', () => {
    expect(decideMode(facts(), B())).toEqual({ mode: 'expanded', showTitle: false, recheckAtMs: null });
  });
  it('PAUSED y, tras 10 s, COMPACT', () => {
    expect(decideMode(facts({ status: 'paused', pausedSinceMs: 95_000 }), B())).toEqual({ mode: 'paused', showTitle: false, recheckAtMs: 105_000 });
    expect(decideMode(facts({ status: 'paused', pausedSinceMs: 90_000 }), B()).mode).toBe('compact');
    expect(decideMode(facts({ status: 'paused' }), B()).mode).toBe('paused');
  });
  it('comportamiento en pausa: compactar u ocultar', () => {
    expect(decideMode(facts({ status: 'paused' }), B({ pauseBehavior: 'compact' })).mode).toBe('compact');
    expect(decideMode(facts({ status: 'paused' }), B({ pauseBehavior: 'hide' })).mode).toBe('hidden');
    expect(decideMode(facts({ status: 'paused', lyrics: 'none' }), B({ pauseBehavior: 'hide' })).mode).toBe('hidden');
  });
  it('compacta forzada por el usuario', () => {
    expect(decideMode(facts({ userCompact: true }), B())).toMatchObject({ mode: 'compact', showTitle: true });
    expect(decideMode(facts({ userCompact: true, status: 'paused' }), B({ pauseBehavior: 'hide' })).mode).toBe('hidden');
  });
  it('COMPACT sin letra según configuración', () => {
    expect(decideMode(facts({ lyrics: 'loading' }), B())).toMatchObject({ mode: 'compact', showTitle: true });
    expect(decideMode(facts({ lyrics: null }), B())).toMatchObject({ mode: 'compact', showTitle: true });
    expect(decideMode(facts({ lyrics: 'none' }), B())).toMatchObject({ mode: 'compact', showTitle: true });
    expect(decideMode(facts({ lyrics: 'instrumental' }), B({ noLyricsBehavior: 'compact' }))).toMatchObject({ mode: 'compact', showTitle: false });
    expect(decideMode(facts({ lyrics: 'plain' }), B({ noLyricsBehavior: 'hide' })).mode).toBe('hidden');
  });
  it('letra plana experimental se expande', () => {
    expect(decideMode(facts({ lyrics: 'plain' }), B({ experimentalPlain: true })).mode).toBe('expanded');
  });
  it('anuncios: compacta sin título', () => {
    expect(decideMode(facts({ isAd: true }), B())).toMatchObject({ mode: 'compact', showTitle: false });
  });
});
