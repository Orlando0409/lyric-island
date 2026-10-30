// MediaBridge: lanza el helper C#, lee NDJSON línea por línea, valida con zod y reenvía eventos.
// Si el helper muere, se reinicia con backoff exponencial (1 s, 2 s, 4 s… tope 30 s).
// Con LYRICISLAND_FAKE_HELPER=<sesión.ndjson> reproduce una sesión grabada (E2E y desarrollo sin .NET).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { log } from './logger';
import { parseHelperLine, type HelperCommand, type HelperMessage } from './protocol';

export interface MediaBridgeEvents {
  message: [HelperMessage];
  protocolError: [string];
}

export const BACKOFF_START_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;

export function nextBackoff(current: number): number {
  return Math.min(BACKOFF_MAX_MS, current * 2);
}

export abstract class MediaSource extends EventEmitter<MediaBridgeEvents> {
  abstract start(): void;
  abstract send(cmd: HelperCommand): void;
  abstract stop(): void;
  helperVersion: string | null = null;

  protected handleLine(line: string): void {
    if (!line.trim()) return;
    const r = parseHelperLine(line);
    if (!r.ok) {
      log(r.versionMismatch ? 'error' : 'warn', 'helper', r.error);
      if (r.versionMismatch) this.emit('protocolError', r.error);
      return;
    }
    if (r.msg.type === 'hello') this.helperVersion = r.msg.helperVersion;
    if (r.msg.type === 'log') log(r.msg.level, 'helper', r.msg.msg);
    this.emit('message', r.msg);
  }
}

export class HelperProcess extends MediaSource {
  private child: ChildProcessWithoutNullStreams | null = null;
  private backoff = BACKOFF_START_MS;
  private restartTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private lastFilter: HelperCommand | null = null;
  private healthyTimer: NodeJS.Timeout | null = null;

  constructor(private readonly exePath: string) {
    super();
  }

  start(): void {
    this.stopping = false;
    this.spawnChild();
  }

  private spawnChild(): void {
    log('info', 'bridge', `lanzando helper: ${this.exePath}`);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.exePath, [], { stdio: 'pipe', windowsHide: true });
    } catch (e) {
      log('error', 'bridge', `no se pudo lanzar el helper: ${String(e)}`);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    child.stdout.setEncoding('utf8');
    createInterface({ input: child.stdout }).on('line', (l) => this.handleLine(l));
    child.stderr.on('data', (d) => log('warn', 'helper:stderr', String(d).trim()));
    child.on('error', (e) => log('error', 'bridge', `helper error: ${e.message}`));
    child.on('exit', (code) => {
      this.child = null;
      if (this.healthyTimer) clearTimeout(this.healthyTimer);
      if (this.stopping) return;
      log('warn', 'bridge', `el helper terminó (código ${code}); reinicio en ${this.backoff} ms`);
      this.emit('message', { v: 1, type: 'cleared' });
      this.scheduleRestart();
    });
    // Si sobrevive 60 s se considera sano y el backoff vuelve al inicio.
    this.healthyTimer = setTimeout(() => (this.backoff = BACKOFF_START_MS), 60_000);
    if (this.lastFilter) this.send(this.lastFilter);
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) return;
    const wait = this.backoff;
    this.backoff = nextBackoff(this.backoff);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnChild();
    }, wait);
  }

  send(cmd: HelperCommand): void {
    if (cmd.cmd === 'setFilter') this.lastFilter = cmd;
    if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(cmd) + '\n');
  }

  stop(): void {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.healthyTimer) clearTimeout(this.healthyTimer);
    const child = this.child;
    if (!child) return;
    this.send({ cmd: 'shutdown' });
    child.stdin.end();
    setTimeout(() => child.kill(), 1500).unref();
  }
}

interface SessionEvent {
  at: number;
  msg: Record<string, unknown>;
}

/** Helper falso: reproduce una sesión NDJSON grabada en tiempo real (y en bucle si loop = true). */
export class FakeHelper extends MediaSource {
  private timers: NodeJS.Timeout[] = [];
  private events: SessionEvent[];
  private lastTrack: string | null = null;
  private lastTimeline: Record<string, unknown> | null = null;
  private readonly fixturesDir: string;

  constructor(
    sessionFile: string,
    private readonly loop = true,
  ) {
    super();
    this.fixturesDir = join(dirname(sessionFile), '..');
    this.events = readFileSync(sessionFile, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as SessionEvent);
  }

  start(): void {
    this.helperVersion = 'fake';
    this.play();
  }

  private play(): void {
    const t0 = Date.now();
    const sessionStart = this.events.reduce((m, e) => {
      const u = e.msg.updatedAtMs;
      return typeof u === 'number' ? Math.min(m, u - e.at) : m;
    }, Number.POSITIVE_INFINITY);
    for (const e of this.events) {
      this.timers.push(
        setTimeout(() => {
          const msg = { ...e.msg };
          // Las sesiones guardan updatedAtMs absolutos: se re-basan al reloj actual conservando la diferencia.
          if (typeof msg.updatedAtMs === 'number' && Number.isFinite(sessionStart)) msg.updatedAtMs = t0 + (msg.updatedAtMs - sessionStart);
          this.dispatch(msg);
        }, e.at),
      );
    }
    if (this.loop) {
      const end = Math.max(...this.events.map((e) => e.at)) + 15_000;
      this.timers.push(setTimeout(() => this.play(), end));
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    if (typeof msg.artworkFile === 'string') {
      // Las sesiones pueden referenciar una carátula de shared/fixtures (relativa a la carpeta de fixtures).
      try {
        const png = readFileSync(join(this.fixturesDir, msg.artworkFile));
        msg.artworkHash = createHash('sha1').update(png).digest('hex');
        msg.artworkPngBase64 = png.toString('base64');
      } catch {
        log('warn', 'fake-helper', `carátula no encontrada: ${msg.artworkFile}`);
      }
      delete msg.artworkFile;
    }
    if (msg.type === 'track') this.lastTrack = JSON.stringify(msg);
    if (msg.type === 'timeline') this.lastTimeline = msg;
    this.handleLine(JSON.stringify(msg));
  }

  send(cmd: HelperCommand): void {
    if (cmd.cmd === 'requestSnapshot') {
      if (this.lastTrack) this.handleLine(this.lastTrack);
      if (this.lastTimeline) this.handleLine(JSON.stringify(this.lastTimeline));
    }
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
