// E2E: la app real con un helper falso (sesión grabada) y un LRCLIB falso local.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURES, startFixtureServer } from '../helpers/fixtureServer.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const MAIN = join(ROOT, 'out', 'main', 'index.js');

async function launch(session: string, extraEnv: Record<string, string> = {}) {
  const { server, baseUrl } = await startFixtureServer();
  const userData = mkdtempSync(join(tmpdir(), 'lyricisland-e2e-'));
  // LYRICISLAND_E2E_EXE=dist/win-unpacked/LyricIsland.exe prueba la app ya empaquetada (asar, diccionario incluido).
  const exe = process.env.LYRICISLAND_E2E_EXE;
  const app = await electron.launch({
    ...(exe ? { executablePath: exe } : {}),
    args: exe ? [] : [ROOT],
    env: {
      ...process.env,
      LYRICISLAND_FAKE_HELPER: join(FIXTURES, 'sessions', session),
      LYRICISLAND_FAKE_LOOP: '0',
      LYRICISLAND_LRCLIB_BASE: baseUrl,
      LYRICISLAND_USER_DATA: userData,
      ...extraEnv,
    },
  });
  return { app, server, userData };
}

async function islandPage(app: ElectronApplication): Promise<Page> {
  for (let i = 0; i < 50; i++) {
    const page = app.windows().find((w) => w.url().includes('island.html'));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('no apareció la ventana de la isla');
}

const mode = (page: Page) => page.getByTestId('island').getAttribute('data-mode');

test.beforeAll(() => {
  if (!existsSync(MAIN)) throw new Error('Falta el build: ejecutá "pnpm build" antes de "pnpm test:e2e".');
});

test('flujo completo: aparece, karaoke, color, pausa, pantalla completa y cleared', async () => {
  const { app, server } = await launch('e2e.ndjson');
  try {
    const page = await islandPage(app);

    // Ventana: siempre encima, sin foco, click-through y sin Node en el renderer.
    const props = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('island.html'))!;
      return { onTop: w.isAlwaysOnTop(), focusable: w.isFocusable(), bounds: w.getBounds() };
    });
    expect(props.onTop).toBe(true);
    expect(props.focusable).toBe(false);
    expect(props.bounds.width).toBe(600);
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
    expect(await page.evaluate(() => typeof window.lyricIsland.getLyrics)).toBe('function');

    // Se expande con la letra y la línea activa coincide en el instante esperado (posición 4.0–8.5 s).
    await expect.poll(() => mode(page), { timeout: 8000 }).toBe('expanded');
    await expect(page.getByTestId('current-line')).toContainText('la primera línea', { timeout: 6000 });
    expect(await app.evaluate(({ app: a }) => a.getVersion())).toBe(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
    await expect(page.getByTestId('next-line')).toHaveText('La isla cambia de color');

    // El fondo tomó el color de la carátula (ya no es el neutro #1C1C1E).
    await expect
      .poll(() => page.locator('.bg').evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 5000 })
      .not.toBe('rgb(28, 28, 30)');
    await page.screenshot({ path: 'test-results/island-expanded.png' });

    // Pausa → atenuada (PAUSED), con la línea fija.
    await expect.poll(() => mode(page), { timeout: 8000 }).toBe('paused');
    await expect(page.getByTestId('current-line')).toContainText('cambia de color');
    await page.waitForTimeout(700); // termina la animación
    await expect(page).toHaveScreenshot('paused.png');

    // Offset manual: aviso "+200 ms".
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('island.html'))!;
      w.webContents.send('island:command', { type: 'offset', deltaMs: 200 });
    });
    await expect(page.getByTestId('offset-flash')).toHaveText('+200 ms');

    // Reanuda, se oculta en pantalla completa y vuelve.
    await expect.poll(() => mode(page), { timeout: 6000 }).toBe('expanded');
    await expect.poll(() => mode(page), { timeout: 8000 }).toBe('hidden');
    await expect.poll(() => mode(page), { timeout: 4000 }).toBe('expanded');

    // "cleared" la oculta.
    await expect.poll(() => mode(page), { timeout: 6000 }).toBe('hidden');
  } finally {
    await app.close();
    server.close();
  }
});

test('canción en japonés: romaji debajo de la línea actual', async () => {
  const { app, server } = await launch('japanese.ndjson');
  try {
    const page = await islandPage(app);
    await expect.poll(() => mode(page), { timeout: 10_000 }).toBe('expanded');
    await expect(page.getByTestId('current-line')).toContainText('夜空に光る島', { timeout: 8000 });
    await expect(page.getByTestId('romaji-line')).toHaveText('yozora ni hikaru shima o miteita', { timeout: 8000 });
    // El romaji se rellena al ritmo de la línea original (no queda vacío ni lleno de golpe).
    const romajiFill = () => page.locator('.romaji-text').evaluate((el) => parseFloat((el as HTMLElement).style.getPropertyValue('--p')));
    await expect.poll(romajiFill, { timeout: 6000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/island-romaji.png' });
  } finally {
    await app.close();
    server.close();
  }
});

test('líneas largas: dos renglones o desplazamiento que sigue a la palabra cantada', async () => {
  const { app, server } = await launch('long-lines.ndjson');
  try {
    const page = await islandPage(app);
    const line = page.getByTestId('current-line');
    await expect.poll(() => mode(page), { timeout: 10_000 }).toBe('expanded');
    await expect(line).toContainText('bastante larga', { timeout: 8000 });
    await expect(line).toHaveAttribute('data-fit', 'wrap');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/island-long-wrap.png' });
    // Línea larguísima (00:10): se desplaza y la palabra que se canta queda dentro de la isla.
    // Durante la transición conviven la línea que sale y la que entra: se busca la nueva por su texto.
    const longest = page.getByTestId('current-line').filter({ hasText: 'larguísima' });
    await expect(longest).toHaveAttribute('data-fit', 'scroll', { timeout: 12_000 });
    await page.waitForTimeout(5000);
    const visible = await page.evaluate(() => {
      // La línea en modo desplazamiento (durante la transición puede haber otra saliendo).
      const lineEl = document.querySelector<HTMLElement>('[data-testid="current-line"][data-fit="scroll"]');
      if (!lineEl) return true;
      const box = lineEl.parentElement!.getBoundingClientRect();
      const filled = [...lineEl.querySelectorAll<HTMLElement>('.word')].filter(
        (w) => w.style.getPropertyValue('--p') !== '0.00%' && w.style.getPropertyValue('--p') !== '100.00%',
      );
      if (filled.length === 0) return true;
      const r = filled[0].getBoundingClientRect();
      // Tolerancia para la transición de 250 ms del desplazamiento.
      return r.left >= box.left - 24 && r.right <= box.right + 24;
    });
    expect(visible).toBe(true);
    await page.screenshot({ path: 'test-results/island-long-scroll.png' });
  } finally {
    await app.close();
    server.close();
  }
});

test('sin letra: compacta con título; instrumental', async () => {
  const { app, server } = await launch('instrumental.ndjson');
  try {
    const page = await islandPage(app);
    await expect.poll(() => mode(page), { timeout: 8000 }).toBe('compact');
    await expect(page.getByTestId('title')).toContainText('Interludio Azul');
    await page.screenshot({ path: 'test-results/island-compact.png' });
  } finally {
    await app.close();
    server.close();
  }
});

test('ajustes: degradado personalizado y modo fantasma', async () => {
  const { app, server, userData } = await launch('normal-play.ndjson', { LYRICISLAND_OPEN_SETTINGS: '1' });
  try {
    let settingsPage: Page | undefined;
    await expect
      .poll(() => (settingsPage = app.windows().find((w) => w.url().includes('settings.html'))), { timeout: 10_000 })
      .toBeTruthy();
    const sp = settingsPage!;
    // El fantasma ya está activo por defecto: se ven sus controles.
    await expect(sp.getByTestId('ghost-settings')).toBeVisible();
    await sp.locator('select').nth(1).selectOption('gradient');
    await expect(sp.getByTestId('gradient-settings')).toBeVisible();
    await sp.getByTestId('gradient-settings').locator('select').selectOption('custom');
    await sp.getByRole('button', { name: 'Océano' }).click();
    const file = join(userData, 'settings.json');
    await expect
      .poll(() => existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).appearance.gradientFrom, { timeout: 5000 })
      .toBe('#1A6DD1');
    const island = await islandPage(app);
    await expect.poll(() => mode(island), { timeout: 8000 }).toBe('expanded');
    // #1A6DD1 ya es legible con texto blanco (no se oscurece); #0E9F8E sí.
    const bgVar = (name: string) => island.getByTestId('island-bg').evaluate((el, n) => (el as HTMLElement).style.getPropertyValue(n), name);
    await expect.poll(() => bgVar('--bg'), { timeout: 5000 }).toBe('#1A6DD1');
    expect(await bgVar('--bg-alt')).not.toBe('#0E9F8E');
    expect(await bgVar('--bg-angle')).toBe('135deg');
    await sp.screenshot({ path: 'test-results/settings-gradient.png', fullPage: true });
    await island.screenshot({ path: 'test-results/island-gradient.png' });
  } finally {
    await app.close();
    server.close();
  }
});

test('ajustes: se guardan en disco y llegan a la isla', async () => {
  const { app, server, userData } = await launch('normal-play.ndjson', { LYRICISLAND_OPEN_SETTINGS: '1' });
  try {
    let settingsPage: Page | undefined;
    await expect
      .poll(() => (settingsPage = app.windows().find((w) => w.url().includes('settings.html'))), { timeout: 10_000 })
      .toBeTruthy();
    await settingsPage!.getByText('Mostrar la línea siguiente').click();
    const file = join(userData, 'settings.json');
    await expect.poll(() => existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).appearance.showNextLine, { timeout: 5000 }).toBe(false);
    const island = await islandPage(app);
    await expect.poll(() => mode(island), { timeout: 8000 }).toBe('expanded');
    await expect(island.getByTestId('next-line')).toHaveCount(0);
    await settingsPage!.screenshot({ path: 'test-results/settings.png', fullPage: true });
  } finally {
    await app.close();
    server.close();
  }
});

test('letra completa: toda la letra, la línea actual con karaoke y siempre encima', async () => {
  const { app, server, userData } = await launch('e2e.ndjson', { LYRICISLAND_OPEN_LYRICS: '1' });
  try {
    let page: Page | undefined;
    await expect.poll(() => (page = app.windows().find((w) => w.url().includes('lyrics.html'))), { timeout: 10_000 }).toBeTruthy();
    const full = page!;
    await expect(full.getByTestId('full-current-line')).toContainText('la primera línea', { timeout: 10_000 });
    // Todas las líneas están en la vista, no solo la actual y la siguiente.
    expect(await full.locator('.lyric').count()).toBeGreaterThan(3);
    await expect(full.locator('.lyric.future').first()).toContainText('La isla cambia de color');
    // La línea actual queda cerca de la altura de foco (no fuera de la vista).
    const box = await full.getByTestId('full-current-line').boundingBox();
    const height = await full.evaluate(() => window.innerHeight);
    expect(box!.y).toBeGreaterThan(0);
    expect(box!.y).toBeLessThan(height * 0.7);
    await full.screenshot({ path: 'test-results/full-lyrics.png' });
    // Fijar encima: se guarda y la ventana queda siempre encima.
    await full.getByTestId('pin').click();
    const file = join(userData, 'settings.json');
    await expect.poll(() => existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).lyricsView.alwaysOnTop, { timeout: 5000 }).toBe(true);
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('lyrics.html'))!.isAlwaysOnTop()))
      .toBe(true);
  } finally {
    await app.close();
    server.close();
  }
});
