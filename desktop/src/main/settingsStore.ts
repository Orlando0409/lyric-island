// SettingsStore: JSON validado con zod en userData/settings.json.
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mergeSettings, parseSettings, type DeepPartial, type Settings } from '../shared/settings';

export class SettingsStore extends EventEmitter<{ change: [Settings] }> {
  private value: Settings;

  constructor(private readonly file: string | null) {
    super();
    let raw: unknown = {};
    if (file) {
      try {
        raw = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        raw = {};
      }
    }
    this.value = parseSettings(raw);
  }

  get(): Settings {
    return this.value;
  }

  update(patch: DeepPartial<Settings>): Settings {
    this.value = mergeSettings(this.value, patch);
    this.save();
    this.emit('change', this.value);
    return this.value;
  }

  /** Registra apps vistas (para la lista "Detectadas" de los ajustes). */
  noteDetected(appId: string): void {
    if (this.value.players.detected.includes(appId)) return;
    this.update({ players: { detected: [...this.value.players.detected, appId].slice(-30) } });
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.value, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }
}
