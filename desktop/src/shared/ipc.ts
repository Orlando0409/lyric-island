// Contrato IPC main ↔ preload ↔ renderer.
import type { LyricsDocument, NowPlaying, Timeline } from '../core/types';
import type { DeepPartial, Settings } from './settings';

export interface TrackPayload {
  track: NowPlaying;
  /** data:image/png;base64,… cuando cambió la carátula (o en un snapshot). */
  artworkDataUrl: string | null;
}

export type IslandCommand =
  | { type: 'toggleHidden' }
  | { type: 'setHidden'; hidden: boolean }
  | { type: 'toggleCompact' }
  | { type: 'offset'; deltaMs: number }
  | { type: 'offsetReset' };

export interface LyricIslandApi {
  onTrack(cb: (p: TrackPayload) => void): () => void;
  onTimeline(cb: (t: Timeline) => void): () => void;
  onCleared(cb: () => void): () => void;
  onFullscreen(cb: (active: boolean) => void): () => void;
  onCommand(cb: (c: IslandCommand) => void): () => void;
  onSettings(cb: (s: Settings) => void): () => void;
  onPower(cb: (onBattery: boolean) => void): () => void;
  getLyrics(track: NowPlaying): Promise<LyricsDocument>;
  getOffset(track: NowPlaying): Promise<number>;
  setOffset(track: NowPlaying, ms: number): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(patch: DeepPartial<Settings>): Promise<Settings>;
  ready(): void;
  // Solo ventana de ajustes:
  clearCache(): Promise<void>;
  listOffsets(): Promise<Record<string, number>>;
  clearOffsets(): Promise<void>;
  exportLogs(): Promise<string | null>;
  appInfo(): Promise<{ version: string; helper: string | null }>;
}

export const IPC = {
  track: 'media:track',
  timeline: 'media:timeline',
  cleared: 'media:cleared',
  fullscreen: 'media:fullscreen',
  command: 'island:command',
  settingsChanged: 'settings:changed',
  power: 'power:battery',
  getLyrics: 'lyrics:get',
  getOffset: 'lyrics:getOffset',
  setOffset: 'lyrics:setOffset',
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  ready: 'island:ready',
  clearCache: 'lyrics:clearCache',
  listOffsets: 'lyrics:listOffsets',
  clearOffsets: 'lyrics:clearOffsets',
  exportLogs: 'app:exportLogs',
  appInfo: 'app:info',
} as const;
