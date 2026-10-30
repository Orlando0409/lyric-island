// Logs locales en memoria (anillo). Sin telemetría: solo se exportan si el usuario lo pide.
export type Level = 'debug' | 'info' | 'warn' | 'error';

const MAX = 2000;
const ring: string[] = [];

export function log(level: Level, scope: string, msg: string): void {
  const line = `${new Date().toISOString()} [${level}] ${scope}: ${msg}`;
  ring.push(line);
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
  if (level === 'error' || level === 'warn' || process.env.LYRICISLAND_DEBUG) console.log(line);
}

export function dumpLogs(): string {
  return ring.join('\n') + '\n';
}
