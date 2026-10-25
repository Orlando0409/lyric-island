// Caché de letras en JSON (sección 8.4): LRU de 5 000 entradas + offsets del usuario sin TTL.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CacheEntry, LyricsCache } from '../core/lyricsRepo';

export const MAX_ENTRIES = 5000;
const SAVE_DEBOUNCE_MS = 1000;

interface FileShape {
  v: 1;
  entries: Array<[string, CacheEntry]>; // orden = uso (el último es el más reciente)
  offsets: Record<string, number>;
}

export class JsonLyricsCache implements LyricsCache {
  private entries = new Map<string, CacheEntry>();
  private offsets: Record<string, number> = {};
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly file: string | null,
    private readonly maxEntries = MAX_ENTRIES,
  ) {
    if (file) this.load();
  }

  private load(): void {
    try {
      const data = JSON.parse(readFileSync(this.file!, 'utf8')) as FileShape;
      if (data.v === 1) {
        this.entries = new Map(data.entries);
        this.offsets = data.offsets ?? {};
      }
    } catch {
      // archivo inexistente o corrupto: se empieza de cero
    }
  }

  get(key: string): CacheEntry | null {
    const e = this.entries.get(key);
    if (!e) return null;
    this.entries.delete(key); // LRU: mover al final
    this.entries.set(key, e);
    return e;
  }

  set(key: string, entry: CacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value!;
      this.entries.delete(oldest);
    }
    this.scheduleSave();
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.scheduleSave();
  }

  getOffset(key: string): number {
    return this.offsets[key] ?? 0;
  }

  setOffset(key: string, ms: number): void {
    if (ms === 0) delete this.offsets[key];
    else this.offsets[key] = ms;
    this.scheduleSave();
  }

  listOffsets(): Record<string, number> {
    return { ...this.offsets };
  }

  clearOffsets(): void {
    this.offsets = {};
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  flush(): void {
    if (!this.file) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const data: FileShape = { v: 1, entries: [...this.entries], offsets: this.offsets };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.file); // escritura atómica
  }
}
