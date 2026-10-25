/// <reference types="vite/client" />
import type { LyricIslandApi } from '../shared/ipc';

declare global {
  interface Window {
    lyricIsland: LyricIslandApi;
  }
}

export {};
