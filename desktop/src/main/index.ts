// Proceso main de Electron (sección 11.3).
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray } from 'electron';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NowPlaying } from '../core/types';
import { t } from '../shared/i18n';
import { IPC, type IslandCommand, type TrackPayload } from '../shared/ipc';
import type { DeepPartial, Settings } from '../shared/settings';
import { dumpLogs, log } from './logger';
import { FakeHelper, HelperProcess, type MediaSource } from './mediaBridge';
import { LyricsService } from './lyricsService';
import type { HelperMessage } from './protocol';
import { SettingsStore } from './settingsStore';
import { allWindows, createIslandWindow, openSettingsWindow, positionIsland } from './windows';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const userData = process.env.LYRICISLAND_USER_DATA;
if (userData) app.setPath('userData', resolve(userData)); // aislamiento en E2E

let island: BrowserWindow | null = null;
let tray: Tray | null = null;
let media: MediaSource | null = null;
let settings: SettingsStore;
let lyrics: LyricsService;
let islandHidden = false;
let lastTrack: TrackPayload | null = null;
let lastTimeline: HelperMessage | null = null;
const artworkByHash = new Map<string, string>();

const resourcesDir = () => (app.isPackaged ? process.resourcesPath : join(import.meta.dirname, '../../resources'));

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of allWindows()) w.webContents.send(channel, ...args);
}

function sendIsland(channel: string, ...args: unknown[]): void {
  if (island && !island.isDestroyed()) island.webContents.send(channel, ...args);
}

function command(c: IslandCommand): void {
  if (c.type === 'toggleHidden') {
    islandHidden = !islandHidden;
    sendIsland(IPC.command, { type: 'setHidden', hidden: islandHidden } satisfies IslandCommand);
    rebuildTrayMenu();
    return;
  }
  sendIsland(IPC.command, c);
}

function onHelperMessage(m: HelperMessage): void {
  switch (m.type) {
    case 'track': {
      settings.noteDetected(m.sourceAppId);
      if (m.artworkHash && m.artworkPngBase64) {
        artworkByHash.set(m.artworkHash, `data:image/png;base64,${m.artworkPngBase64}`);
        if (artworkByHash.size > 20) artworkByHash.delete(artworkByHash.keys().next().value!);
      }
      const track: NowPlaying = {
        sourceAppId: m.sourceAppId,
        title: m.title,
        artist: m.artist,
        album: m.album,
        durationMs: m.durationMs,
        artworkHash: m.artworkHash,
      };
      lastTrack = { track, artworkDataUrl: m.artworkHash ? (artworkByHash.get(m.artworkHash) ?? null) : null };
      sendIsland(IPC.track, lastTrack);
      break;
    }
    case 'timeline':
      lastTimeline = m;
      sendIsland(IPC.timeline, { positionMs: m.positionMs, updatedAtMs: m.updatedAtMs, rate: m.rate, status: m.status });
      break;
    case 'cleared':
      lastTrack = null;
      lastTimeline = null;
      sendIsland(IPC.cleared);
      break;
    case 'fullscreen':
      sendIsland(IPC.fullscreen, m.active);
      break;
    default:
      break;
  }
}

function startMedia(): void {
  const fake = process.env.LYRICISLAND_FAKE_HELPER;
  if (fake) {
    media = new FakeHelper(resolve(fake), process.env.LYRICISLAND_FAKE_LOOP !== '0');
  } else {
    const exe = process.env.LYRICISLAND_HELPER_PATH ?? join(resourcesDir(), 'helper', 'LyricIsland.MediaHelper.exe');
    if (!existsSync(exe)) {
      log('error', 'main', `helper no encontrado: ${exe}. Ejecutá "pnpm helper:build".`);
      dialog.showErrorBox('LyricIsland', `No se encontró el helper multimedia:\n${exe}\n\nEjecutá "pnpm helper:build".`);
    }
    media = new HelperProcess(exe);
  }
  media.on('message', onHelperMessage);
  media.on('protocolError', (e) => dialog.showErrorBox('LyricIsland', `Versión del helper incompatible: ${e}`));
  media.start();
  applyFilter(settings.get());
}

function applyFilter(s: Settings): void {
  media?.send({ cmd: 'setFilter', mode: s.players.mode, apps: s.players.apps });
}

function registerShortcuts(s: Settings): void {
  globalShortcut.unregisterAll();
  const map: Array<[string, () => void]> = [
    [s.shortcuts.toggleVisible, () => command({ type: 'toggleHidden' })],
    [s.shortcuts.toggleExpand, () => command({ type: 'toggleCompact' })],
    [s.shortcuts.offsetPlus, () => command({ type: 'offset', deltaMs: 100 })],
    [s.shortcuts.offsetMinus, () => command({ type: 'offset', deltaMs: -100 })],
    [s.shortcuts.offsetReset, () => command({ type: 'offsetReset' })],
  ];
  for (const [accel, fn] of map) {
    try {
      if (accel && !globalShortcut.register(accel, fn)) log('warn', 'shortcuts', `atajo ocupado: ${accel}`);
    } catch (e) {
      log('warn', 'shortcuts', `atajo inválido ${accel}: ${String(e)}`);
    }
  }
}

function trayIcon() {
  const file = join(resourcesDir(), 'tray.png');
  return existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const lang = settings.get().general.language;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t(lang, islandHidden ? 'trayShow' : 'trayHide'), click: () => command({ type: 'toggleHidden' }) },
      { label: t(lang, 'trayExpand'), click: () => command({ type: 'toggleCompact' }) },
      { type: 'separator' },
      { label: t(lang, 'traySettings'), click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: t(lang, 'trayQuit'), click: () => app.quit() },
    ]),
  );
}

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip('LyricIsland');
  tray.on('double-click', () => openSettingsWindow());
  rebuildTrayMenu();
}

function applyLoginItem(s: Settings): void {
  if (!app.isPackaged) return; // en desarrollo no se registra el autostart
  // NSIS: registro de inicio de sesión. MSIX usa la extensión StartupTask del manifiesto.
  if (!process.windowsStore) app.setLoginItemSettings({ openAtLogin: s.general.launchAtLogin });
}

function registerIpc(): void {
  ipcMain.handle(IPC.getLyrics, (_e, track: NowPlaying) => lyrics.get(track));
  ipcMain.handle(IPC.getOffset, (_e, track: NowPlaying) => lyrics.getOffset(track));
  ipcMain.handle(IPC.setOffset, (_e, track: NowPlaying, ms: number) => lyrics.setOffset(track, ms));
  ipcMain.handle(IPC.getSettings, () => settings.get());
  ipcMain.handle(IPC.setSettings, (_e, patch: DeepPartial<Settings>) => settings.update(patch));
  ipcMain.handle(IPC.clearCache, () => lyrics.cache.clear());
  ipcMain.handle(IPC.listOffsets, () => lyrics.cache.listOffsets());
  ipcMain.handle(IPC.clearOffsets, () => lyrics.cache.clearOffsets());
  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion(), helper: media?.helperVersion ?? null }));
  ipcMain.handle(IPC.exportLogs, async () => {
    const r = await dialog.showSaveDialog({ defaultPath: `lyricisland-logs-${Date.now()}.txt`, filters: [{ name: 'Texto', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, dumpLogs());
    return r.filePath;
  });
  // La isla terminó de cargar: se reenvía el estado actual (por si llegó antes que el renderer).
  ipcMain.on(IPC.ready, (e) => {
    if (!island || e.sender !== island.webContents) return;
    sendIsland(IPC.settingsChanged, settings.get());
    sendIsland(IPC.power, powerMonitor.isOnBatteryPower());
    if (islandHidden) sendIsland(IPC.command, { type: 'setHidden', hidden: true } satisfies IslandCommand);
    if (lastTrack) sendIsland(IPC.track, lastTrack);
    if (lastTimeline?.type === 'timeline') onHelperMessage(lastTimeline);
    media?.send({ cmd: 'requestSnapshot' });
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.lyricisland.desktop');
  settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  lyrics = new LyricsService(join(app.getPath('userData'), 'lyrics-cache', 'cache.json'), process.env.LYRICISLAND_LRCLIB_BASE);

  registerIpc();
  island = createIslandWindow(settings.get());
  createTray();
  registerShortcuts(settings.get());
  applyLoginItem(settings.get());
  startMedia();

  settings.on('change', (s) => {
    broadcast(IPC.settingsChanged, s);
    applyFilter(s);
    registerShortcuts(s);
    applyLoginItem(s);
    rebuildTrayMenu();
    if (island) positionIsland(island, s);
  });

  const reposition = () => island && positionIsland(island, settings.get());
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  powerMonitor.on('on-battery', () => sendIsland(IPC.power, true));
  powerMonitor.on('on-ac', () => sendIsland(IPC.power, false));
  powerMonitor.on('resume', () => media?.send({ cmd: 'requestSnapshot' }));

  if (process.env.LYRICISLAND_OPEN_SETTINGS === '1') openSettingsWindow();
});

app.on('second-instance', () => openSettingsWindow());
app.on('window-all-closed', () => {
  // La app vive en la bandeja: cerrar los ajustes no la termina.
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  media?.stop();
  lyrics?.cache.flush();
});
