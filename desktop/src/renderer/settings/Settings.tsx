// Pantalla de ajustes (sección 10.7).
import { useEffect, useState, type ReactNode } from 'react';
import { t, type StringKey } from '../../shared/i18n';
import type { DeepPartial, Settings as S } from '../../shared/settings';

const api = window.lyricIsland;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="row">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ value, onChange, testId }: { value: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />;
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [info, setInfo] = useState<{ version: string; helper: string | null } | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    void api.getSettings().then(setS);
    void api.listOffsets().then(setOffsets);
    void api.appInfo().then(setInfo);
    return api.onSettings(setS);
  }, []);

  if (!s) return null;
  const L = (k: StringKey) => t(s.general.language, k);
  const update = (patch: DeepPartial<S>) => void api.setSettings(patch).then(setS);
  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(''), 2000);
  };
  document.title = L('settingsTitle');

  return (
    <main>
      <h1>LyricIsland</h1>

      <Section title={L('general')}>
        <Row label={L('launchAtLogin')}>
          <Toggle value={s.general.launchAtLogin} onChange={(v) => update({ general: { launchAtLogin: v } })} />
        </Row>
        <Row label={L('language')}>
          <Select value={s.general.language} options={[['es', 'Español'], ['en', 'English']]} onChange={(v) => update({ general: { language: v } })} />
        </Row>
        <Row label={L('showInFullscreen')}>
          <Toggle value={s.general.showInFullscreen} onChange={(v) => update({ general: { showInFullscreen: v } })} />
        </Row>
      </Section>

      <Section title={L('appearance')}>
        <Row label={L('backgroundStyle')}>
          <Select
            value={s.appearance.backgroundStyle}
            options={[
              ['solid', L('bgSolid')],
              ['gradient', L('bgGradient')],
              ['live', L('bgLive')],
              ['blur', L('bgBlur')],
            ]}
            onChange={(v) => update({ appearance: { backgroundStyle: v } })}
          />
        </Row>
        <Row label={`${L('fontScale')}: ${Math.round(s.appearance.fontScale * 100)} %`}>
          <input type="range" min={0.8} max={1.5} step={0.05} value={s.appearance.fontScale} onChange={(e) => update({ appearance: { fontScale: Number(e.target.value) } })} />
        </Row>
        <Row label={`${L('maxOpacity')}: ${Math.round(s.appearance.maxOpacity * 100)} %`}>
          <input type="range" min={0.3} max={1} step={0.05} value={s.appearance.maxOpacity} onChange={(e) => update({ appearance: { maxOpacity: Number(e.target.value) } })} />
        </Row>
        <Row label={L('showNextLine')}>
          <Toggle value={s.appearance.showNextLine} onChange={(v) => update({ appearance: { showNextLine: v } })} />
        </Row>
        <Row label={L('showArtwork')}>
          <Toggle value={s.appearance.showArtwork} onChange={(v) => update({ appearance: { showArtwork: v } })} />
        </Row>
        <Row label={L('animations')}>
          <Select
            value={s.appearance.animations}
            options={[
              ['full', L('animFull')],
              ['reduced', L('animReduced')],
            ]}
            onChange={(v) => update({ appearance: { animations: v } })}
          />
        </Row>
        <Row label={L('ghostMode')}>
          <Toggle value={s.appearance.ghostMode} onChange={(v) => update({ appearance: { ghostMode: v } })} />
        </Row>
      </Section>

      <Section title={L('position')}>
        <Row label={L('monitor')}>
          <Select
            value={typeof s.position.monitor === 'number' ? 'primary' : s.position.monitor}
            options={[
              ['primary', L('monPrimary')],
              ['cursor', L('monCursor')],
            ]}
            onChange={(v) => update({ position: { monitor: v } })}
          />
        </Row>
        <Row label={L('topMargin')}>
          <input type="number" min={0} max={400} value={s.position.topMargin} onChange={(e) => update({ position: { topMargin: Number(e.target.value) } })} />
        </Row>
        <Row label={L('offsetX')}>
          <input type="number" min={-2000} max={2000} value={s.position.offsetX} onChange={(e) => update({ position: { offsetX: Number(e.target.value) } })} />
        </Row>
      </Section>

      <Section title={L('behavior')}>
        <Row label={L('onPause')}>
          <Select
            value={s.behavior.pauseBehavior}
            options={[
              ['dim', L('pauseDim')],
              ['compact', L('pauseCompact')],
              ['hide', L('pauseHide')],
            ]}
            onChange={(v) => update({ behavior: { pauseBehavior: v } })}
          />
        </Row>
        <Row label={L('pauseDelay')}>
          <input type="number" min={0} max={120} value={s.behavior.pauseCompactDelayMs / 1000} onChange={(e) => update({ behavior: { pauseCompactDelayMs: Number(e.target.value) * 1000 } })} />
        </Row>
        <Row label={L('noLyrics')}>
          <Select
            value={s.behavior.noLyricsBehavior}
            options={[
              ['title', L('noLyricsTitle')],
              ['compact', L('noLyricsCompact')],
              ['hide', L('noLyricsHide')],
            ]}
            onChange={(v) => update({ behavior: { noLyricsBehavior: v } })}
          />
        </Row>
      </Section>

      <Section title={L('players')}>
        <Row label={L('playersMode')}>
          <Select
            value={s.players.mode}
            options={[
              ['deny', L('modeDeny')],
              ['allow', L('modeAllow')],
            ]}
            onChange={(v) => update({ players: { mode: v } })}
          />
        </Row>
        <p className="hint">{L('playersHint')}</p>
        <textarea
          rows={5}
          defaultValue={s.players.apps.join('\n')}
          data-testid="players-apps"
          onBlur={(e) => update({ players: { apps: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) } })}
        />
        <p className="hint">
          {L('detected')}:{' '}
          {s.players.detected.length === 0
            ? L('none')
            : s.players.detected.map((id) => (
                <button
                  key={id}
                  className="chip"
                  title={id}
                  onClick={() => {
                    const apps = s.players.apps.includes(id) ? s.players.apps.filter((a) => a !== id) : [...s.players.apps, id];
                    update({ players: { apps } });
                  }}
                >
                  {s.players.apps.includes(id) ? '✓ ' : '+ '}
                  {id.length > 32 ? id.slice(0, 32) + '…' : id}
                </button>
              ))}
        </p>
      </Section>

      <Section title={L('lyrics')}>
        <Row label={`${L('leadMs')}: ${s.lyrics.leadMs} ms`}>
          <input type="range" min={0} max={600} step={25} value={s.lyrics.leadMs} onChange={(e) => update({ lyrics: { leadMs: Number(e.target.value) } })} />
        </Row>
        <p className="hint">{L('leadHint')}</p>
        <Row label={L('experimentalPlain')}>
          <Toggle value={s.lyrics.experimentalPlain} onChange={(v) => update({ lyrics: { experimentalPlain: v } })} />
        </Row>
        <div className="buttons">
          <button onClick={() => void api.clearCache().then(() => flash(L('done')))}>{L('clearCache')}</button>
          <button onClick={() => void api.clearOffsets().then(() => (setOffsets({}), flash(L('done'))))}>{L('clearOffsets')}</button>
        </div>
        <p className="hint">
          {L('savedOffsets')}: {Object.keys(offsets).length === 0 ? L('none') : `${Object.keys(offsets).length}`}
        </p>
      </Section>

      <Section title={L('shortcuts')}>
        <ul className="shortcuts">
          <li>
            <kbd>{s.shortcuts.toggleVisible}</kbd> {L('trayShow')} / {L('trayHide')}
          </li>
          <li>
            <kbd>{s.shortcuts.toggleExpand}</kbd> {L('trayExpand')}
          </li>
          <li>
            <kbd>{s.shortcuts.offsetPlus}</kbd> +100 ms · <kbd>{s.shortcuts.offsetMinus}</kbd> −100 ms · <kbd>{s.shortcuts.offsetReset}</kbd> reset
          </li>
        </ul>
      </Section>

      <Section title={L('about')}>
        <p>
          {L('version')}: {info?.version ?? '…'} · helper: {info?.helper ?? '—'}
        </p>
        <p className="hint">{L('credits')}</p>
        <p className="hint">{L('privacy')}</p>
        <button onClick={() => void api.exportLogs().then((p) => p && flash(p))}>{L('exportLogs')}</button>
      </Section>
      {note && <div className="toast">{note}</div>}
    </main>
  );
}
