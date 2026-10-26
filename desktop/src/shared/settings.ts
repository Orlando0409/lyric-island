// Ajustes del usuario (sección 10.7). Compartido por main, preload y renderer.
import { z } from 'zod';

export const ShortcutsSchema = z.object({
  toggleVisible: z.string().default('Control+Alt+L'),
  toggleExpand: z.string().default('Control+Alt+K'),
  offsetPlus: z.string().default('Control+Alt+Right'),
  offsetMinus: z.string().default('Control+Alt+Left'),
  offsetReset: z.string().default('Control+Alt+0'),
});

const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const SettingsSchema = z.object({
  general: z
    .object({
      launchAtLogin: z.boolean().default(false),
      language: z.enum(['es', 'en']).default('es'),
      showInFullscreen: z.boolean().default(false),
    })
    .prefault({}),
  appearance: z
    .object({
      backgroundStyle: z.enum(['solid', 'gradient', 'live', 'blur']).default('solid'),
      fontScale: z.number().min(0.8).max(1.5).default(1),
      maxOpacity: z.number().min(0.3).max(1).default(1),
      showNextLine: z.boolean().default(true),
      showArtwork: z.boolean().default(true),
      animations: z.enum(['full', 'reduced']).default('full'),
      ghostMode: z.boolean().default(true),
      // Modo fantasma: opacidad con el cursor encima y duración del fundido.
      ghostOpacity: z.number().min(0).max(0.6).default(0.15),
      ghostFadeMs: z.number().min(0).max(1000).default(150),
      // Degradado (estilos "gradient" y "live"): colores de la carátula o elegidos por el usuario, y ángulo.
      gradientSource: z.enum(['artwork', 'custom']).default('artwork'),
      // .catch: un color mal escrito vuelve al de por defecto sin descartar el resto de los ajustes.
      gradientFrom: HexColor.default('#6A3DE8').catch('#6A3DE8'),
      gradientTo: HexColor.default('#E83D84').catch('#E83D84'),
      gradientAngle: z.number().min(0).max(360).default(135),
    })
    .prefault({}),
  position: z
    .object({
      monitor: z.union([z.enum(['primary', 'cursor']), z.number()]).default('primary'),
      topMargin: z.number().min(0).max(400).default(8),
      offsetX: z.number().min(-2000).max(2000).default(0),
    })
    .prefault({}),
  behavior: z
    .object({
      pauseBehavior: z.enum(['dim', 'compact', 'hide']).default('dim'),
      pauseCompactDelayMs: z.number().min(0).max(120_000).default(10_000),
      noLyricsBehavior: z.enum(['title', 'compact', 'hide']).default('title'),
    })
    .prefault({}),
  players: z
    .object({
      // Por defecto se permiten Spotify y apps de música; los navegadores quedan opcionales (R12).
      mode: z.enum(['allow', 'deny']).default('deny'),
      apps: z.array(z.string()).default(['chrome', 'msedge', 'firefox', 'opera', 'brave', 'vivaldi']),
      detected: z.array(z.string()).default([]),
    })
    .prefault({}),
  lyrics: z
    .object({
      experimentalPlain: z.boolean().default(false),
      // Adelanto global (ms): compensa la animación de entrada de cada línea.
      leadMs: z.number().min(0).max(600).default(150),
      // Canciones en japonés: romaji debajo de la línea actual (en lugar de la siguiente).
      showRomaji: z.boolean().default(true),
    })
    .prefault({}),
  shortcuts: ShortcutsSchema.prefault({}),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** Valida y completa con valores por defecto; ante basura devuelve los valores por defecto. */
export function parseSettings(raw: unknown): Settings {
  const r = SettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_SETTINGS;
}

export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = (base as Record<string, unknown>)[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? { ...cur, ...v } : v;
  }
  return parseSettings(out);
}
