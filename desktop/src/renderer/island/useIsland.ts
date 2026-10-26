// Conecta el IslandController (núcleo puro) con el IPC y el bucle de animación.
import { useEffect, useMemo, useRef, useState } from 'react';
import { mixPalette, NEUTRAL_PALETTE } from '../../core/color';
import { IslandController, type IslandSnapshot } from '../../core/controller';
import type { Palette } from '../../core/types';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { paletteFromArtwork } from './artwork';

const PALETTE_TRANSITION_MS = 600;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export interface IslandView {
  snap: IslandSnapshot;
  palette: Palette; // paleta en transición (OKLCH, 600 ms)
  settings: Settings;
  artworkUrl: string | null;
}

/**
 * `fullView`: ventana de letra completa. Usa el mismo controlador, pero nunca se oculta por pantalla completa ni por
 * pausa (la letra sigue a la vista).
 */
export function useIsland({ fullView = false }: { fullView?: boolean } = {}): IslandView {
  const api = window.lyricIsland;
  const controller = useMemo(
    () =>
      new IslandController({
        clock: { now: Date.now },
        scheduler: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (h) => window.clearTimeout(h as number) },
        fetchLyrics: (t) => api.getLyrics(t),
        loadUserOffset: (t) => api.getOffset(t),
        saveUserOffset: (t, ms) => void api.setOffset(t, ms),
      }),
    [api],
  );
  const [snap, setSnap] = useState<IslandSnapshot>(() => controller.snapshot());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [palette, setPalette] = useState<Palette>(NEUTRAL_PALETTE);
  const onBattery = useRef(false);
  const artworkByHash = useRef(new Map<string, string>());

  // Eventos del main → controlador.
  useEffect(() => {
    let lastHash: string | null | undefined;
    const offs = [
      api.onTrack(({ track, artworkDataUrl }) => {
        if (track.artworkHash && artworkDataUrl) artworkByHash.current.set(track.artworkHash, artworkDataUrl);
        const url = track.artworkHash ? (artworkByHash.current.get(track.artworkHash) ?? null) : null;
        controller.onTrack(track);
        if (track.artworkHash !== lastHash) {
          lastHash = track.artworkHash;
          setArtworkUrl(url);
          void paletteFromArtwork(track.artworkHash, url).then((p) => {
            if (lastHash === track.artworkHash) controller.setPalette(p);
          });
        }
      }),
      api.onTimeline((t) => controller.onTimeline(t)),
      api.onCleared(() => {
        lastHash = undefined;
        setArtworkUrl(null);
        controller.onCleared();
      }),
      api.onFullscreen((a) => controller.onFullscreen(a)),
      api.onCommand((c) => {
        if (c.type === 'toggleHidden') controller.toggleHidden();
        else if (c.type === 'setHidden') controller.setHidden(c.hidden);
        else if (c.type === 'toggleCompact') controller.toggleCompact();
        else if (c.type === 'offset') controller.adjustOffset(c.deltaMs);
        else if (c.type === 'offsetReset') controller.resetOffset();
      }),
      api.onSettings((s) => setSettings(s)),
      api.onPower((b) => (onBattery.current = b)),
    ];
    void api.getSettings().then(setSettings);
    api.ready();
    return () => offs.forEach((off) => off());
  }, [api, controller]);

  // Ajustes que afectan a la máquina de estados.
  useEffect(() => {
    controller.setBehavior({
      pauseBehavior: fullView ? 'dim' : settings.behavior.pauseBehavior,
      pauseCompactDelayMs: settings.behavior.pauseCompactDelayMs,
      noLyricsBehavior: fullView ? 'title' : settings.behavior.noLyricsBehavior,
      hideOnFullscreen: fullView ? false : !settings.general.showInFullscreen,
      playerFilter: { mode: settings.players.mode, apps: settings.players.apps },
      experimentalPlain: settings.lyrics.experimentalPlain,
      lyricsLeadMs: settings.lyrics.leadMs,
    });
  }, [controller, settings, fullView]);

  // Bucle de animación: solo reproduciendo y visible (en pausa, 0 % de CPU). 30 fps con batería.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const frame = (ts: number) => {
      raf = 0;
      const minGap = onBattery.current ? 33 : 0;
      if (ts - last >= minGap) {
        last = ts;
        setSnap(controller.snapshot());
      }
      if (controller.needsAnimation()) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      setSnap(controller.snapshot());
      if (!raf && controller.needsAnimation()) raf = requestAnimationFrame(frame);
    };
    const off = controller.subscribe(kick);
    kick();
    return () => {
      off();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [controller]);

  // Transición de color en OKLCH (9.5).
  const target = snap.palette;
  const fromRef = useRef<Palette>(NEUTRAL_PALETTE);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / PALETTE_TRANSITION_MS);
      const p = t >= 1 ? target : mixPalette(from, target, easeInOut(t));
      fromRef.current = p;
      setPalette(p);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return { snap, palette, settings, artworkUrl };
}
