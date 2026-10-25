// Preload con contextIsolation + sandbox: expone una API mínima y tipada al renderer.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type LyricIslandApi } from '../shared/ipc';

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: LyricIslandApi = {
  onTrack: (cb) => on(IPC.track, cb),
  onTimeline: (cb) => on(IPC.timeline, cb),
  onCleared: (cb) => on(IPC.cleared, cb),
  onFullscreen: (cb) => on(IPC.fullscreen, cb),
  onCommand: (cb) => on(IPC.command, cb),
  onSettings: (cb) => on(IPC.settingsChanged, cb),
  onPower: (cb) => on(IPC.power, cb),
  getLyrics: (track) => ipcRenderer.invoke(IPC.getLyrics, track),
  getOffset: (track) => ipcRenderer.invoke(IPC.getOffset, track),
  setOffset: (track, ms) => ipcRenderer.invoke(IPC.setOffset, track, ms),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  ready: () => ipcRenderer.send(IPC.ready),
  clearCache: () => ipcRenderer.invoke(IPC.clearCache),
  listOffsets: () => ipcRenderer.invoke(IPC.listOffsets),
  clearOffsets: () => ipcRenderer.invoke(IPC.clearOffsets),
  exportLogs: () => ipcRenderer.invoke(IPC.exportLogs),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
};

contextBridge.exposeInMainWorld('lyricIsland', api);
