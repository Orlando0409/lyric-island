// Protocolo Helper C# → Electron (sección 7.3), validado con zod. Mensajes inválidos se descartan sin crash.
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

const base = { v: z.literal(PROTOCOL_VERSION) };

export const HelloMsg = z.object({ ...base, type: z.literal('hello'), helperVersion: z.string(), os: z.string() });
export const TrackMsg = z.object({
  ...base,
  type: z.literal('track'),
  sourceAppId: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  artworkHash: z.string().nullable(),
  artworkPngBase64: z.string().optional(),
});
export const TimelineMsg = z.object({
  ...base,
  type: z.literal('timeline'),
  positionMs: z.number().nonnegative(),
  updatedAtMs: z.number(),
  rate: z.number().nonnegative(),
  status: z.enum(['playing', 'paused', 'stopped', 'unknown']),
});
export const ClearedMsg = z.object({ ...base, type: z.literal('cleared') });
export const FullscreenMsg = z.object({ ...base, type: z.literal('fullscreen'), active: z.boolean() });
export const LogMsg = z.object({ ...base, type: z.literal('log'), level: z.enum(['debug', 'info', 'warn', 'error']), msg: z.string() });

export const HelperMessage = z.discriminatedUnion('type', [HelloMsg, TrackMsg, TimelineMsg, ClearedMsg, FullscreenMsg, LogMsg]);
export type HelperMessage = z.infer<typeof HelperMessage>;
export type TrackMsg = z.infer<typeof TrackMsg>;
export type TimelineMsg = z.infer<typeof TimelineMsg>;

export type ParseResult = { ok: true; msg: HelperMessage } | { ok: false; error: string; versionMismatch: boolean };

/** Parsea una línea NDJSON. Nunca lanza. */
export function parseHelperLine(line: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { ok: false, error: `JSON inválido: ${line.slice(0, 80)}`, versionMismatch: false };
  }
  if (json && typeof json === 'object' && 'v' in json && (json as { v: unknown }).v !== PROTOCOL_VERSION) {
    return { ok: false, error: `versión de protocolo ${(json as { v: unknown }).v} ≠ ${PROTOCOL_VERSION}`, versionMismatch: true };
  }
  const r = HelperMessage.safeParse(json);
  if (!r.success) return { ok: false, error: `mensaje inválido: ${r.error.issues[0]?.message ?? '?'}`, versionMismatch: false };
  return { ok: true, msg: r.data };
}

export type HelperCommand =
  | { cmd: 'setFilter'; mode: 'allow' | 'deny'; apps: string[] }
  | { cmd: 'requestSnapshot' }
  | { cmd: 'shutdown' };
