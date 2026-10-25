// Ventanas: la isla (transparente, siempre encima, click-through) y la ventana de ajustes.
import { BrowserWindow, screen, type Display } from 'electron';
import { join } from 'node:path';
import type { Settings } from '../shared/settings';

// Tamaño FIJO máximo: la isla se anima DENTRO de la ventana (redimensionar ventanas transparentes por frame parpadea).
export const ISLAND_WIDTH = 600;
export const ISLAND_HEIGHT = 140;

const preloadPath = () => join(import.meta.dirname, '../preload/index.cjs');

function loadRenderer(win: BrowserWindow, page: 'island' | 'settings'): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(`${devUrl}/${page}.html`);
  else void win.loadFile(join(import.meta.dirname, `../renderer/${page}.html`));
}

export function pickDisplay(s: Settings): Display {
  const m = s.position.monitor;
  if (m === 'cursor') return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (typeof m === 'number') return screen.getAllDisplays().find((d) => d.id === m) ?? screen.getPrimaryDisplay();
  return screen.getPrimaryDisplay();
}

export function islandBounds(display: Pick<Display, 'workArea'>, s: Settings) {
  const { x, y, width } = display.workArea;
  return {
    x: Math.round(x + (width - ISLAND_WIDTH) / 2 + s.position.offsetX),
    y: Math.round(y + s.position.topMargin),
    width: ISLAND_WIDTH,
    height: ISLAND_HEIGHT,
  };
}

export function createIslandWindow(s: Settings): BrowserWindow {
  const island = new BrowserWindow({
    ...islandBounds(pickDisplay(s), s),
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false, // nunca roba el foco
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    title: 'LyricIsland',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  island.setAlwaysOnTop(true, 'screen-saver'); // por encima de la barra de tareas
  island.setIgnoreMouseEvents(true, { forward: true }); // click-through + mousemove (modo fantasma)
  island.setVisibleOnAllWorkspaces(true);
  island.once('ready-to-show', () => island.showInactive());
  loadRenderer(island, 'island');
  return island;
}

export function positionIsland(island: BrowserWindow, s: Settings): void {
  if (island.isDestroyed()) return;
  island.setBounds(islandBounds(pickDisplay(s), s));
}

let settingsWin: BrowserWindow | null = null;

export function openSettingsWindow(): BrowserWindow {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 760,
    minWidth: 520,
    minHeight: 480,
    title: 'LyricIsland',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#1C1C1E',
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settingsWin.once('ready-to-show', () => settingsWin?.show());
  settingsWin.on('closed', () => (settingsWin = null));
  loadRenderer(settingsWin, 'settings');
  return settingsWin;
}

export function allWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
}
