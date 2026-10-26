// Letra completa (estilo Spotify): toda la letra, la línea actual con karaoke y desplazamiento automático.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { readableBackground } from '../../core/color';
import type { IslandSnapshot } from '../../core/controller';
import { romajiFill } from '../../core/romaji';
import type { LyricLine } from '../../core/types';
import { t, type StringKey } from '../../shared/i18n';
import { useIsland } from '../island/useIsland';

/** Tras desplazarse a mano, la vista vuelve sola a la línea actual pasado este tiempo. */
const FOLLOW_RESUME_MS = 5000;
/** La línea actual queda a esta altura de la ventana (fracción desde arriba). */
const FOCUS_Y = 0.38;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

function CurrentWords({ line, snap, reduced }: { line: LyricLine; snap: IslandSnapshot; reduced: boolean }) {
  const words = line.words.length > 0 ? line.words : [{ text: line.text, startMs: line.startMs, endMs: line.endMs, estimated: true }];
  return (
    <>
      {words.map((w, i) => {
        const fill = i < snap.wordIndex ? 1 : i === snap.wordIndex ? (reduced ? 1 : snap.wordProgress) : 0;
        return (
          <span key={i} className="word" style={{ '--p': `${(fill * 100).toFixed(2)}%` } as CSSProperties}>
            {w.text}
          </span>
        );
      })}
    </>
  );
}

export function LyricsView() {
  const { snap, palette, settings, artworkUrl } = useIsland({ fullView: true });
  const api = window.lyricIsland;
  const prefersReduced = usePrefersReducedMotion();
  const reduced = prefersReduced || settings.appearance.animations === 'reduced';
  const L = (k: StringKey) => t(settings.general.language, k);
  const view = settings.lyricsView;

  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [following, setFollowing] = useState(true);
  const resumeTimer = useRef<number | undefined>(undefined);

  const doc = snap.lyrics;
  const lines = doc?.kind === 'synced' ? doc.lines : [];
  const active = snap.activeLineIndex;

  // Desplazamiento automático: la línea actual queda a ~38 % de la altura.
  const scrollToActive = (smooth: boolean) => {
    const box = scrollRef.current;
    const el = lineRefs.current[Math.max(0, active)];
    if (!box || !el) return;
    const top = el.offsetTop + el.offsetHeight / 2 - box.clientHeight * FOCUS_Y;
    box.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduced ? 'smooth' : 'auto' });
  };
  useEffect(() => {
    if (following) scrollToActive(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, following, lines, view.fontScale]);

  // Al cambiar de canción se vuelve arriba y a seguir la letra.
  const trackKey = snap.track ? `${snap.track.title}␟${snap.track.artist}` : '';
  useEffect(() => {
    setFollowing(true);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [trackKey]);

  // La rueda, las teclas o arrastrar la barra pausan el seguimiento un rato.
  const pauseFollow = () => {
    setFollowing(false);
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => setFollowing(true), FOLLOW_RESUME_MS);
  };
  useEffect(() => () => window.clearTimeout(resumeTimer.current), []);

  const custom = settings.appearance.gradientSource === 'custom' && settings.appearance.backgroundStyle !== 'solid';
  const colors = useMemo(
    () =>
      custom
        ? { from: readableBackground(settings.appearance.gradientFrom), to: readableBackground(settings.appearance.gradientTo) }
        : { from: palette.background, to: palette.backgroundAlt },
    [custom, settings.appearance.gradientFrom, settings.appearance.gradientTo, palette.background, palette.backgroundAlt],
  );

  const vars = {
    '--sung': palette.textPrimary,
    '--upcoming': palette.textUpcoming,
    '--secondary': palette.textSecondary,
    '--accent': palette.accent,
    '--bg-from': colors.from,
    '--bg-to': colors.to,
    '--size': `${Math.round(30 * view.fontScale)}px`,
  } as CSSProperties;

  const setScale = (d: number) => void api.setSettings({ lyricsView: { fontScale: Math.round(Math.min(1.8, Math.max(0.7, view.fontScale + d)) * 10) / 10 } });

  let body;
  if (!snap.track) body = <p className="empty">{L('lyricsIdle')}</p>;
  else if (snap.lyricsLoading && !doc) body = <p className="empty">{L('lyricsLoading')}</p>;
  else if (doc?.kind === 'plain' && doc.plainText)
    body = (
      <>
        <p className="hint">{L('lyricsPlain')}</p>
        {doc.plainText.split('\n').map((l, i) => (
          <div key={i} className="lyric plain" dir="auto">
            {l || ' '}
          </div>
        ))}
      </>
    );
  else if (lines.length === 0) body = <p className="empty">{L('lyricsNone')}</p>;
  else
    body = lines.map((line, i) => {
      const state = i < active ? 'past' : i === active ? 'current' : 'future';
      const showRomaji = settings.lyrics.showRomaji && !!line.romaji;
      return (
        <div
          key={i}
          ref={(el) => {
            lineRefs.current[i] = el;
          }}
          className={`lyric ${state} ${line.isInterlude ? 'interlude' : ''}`}
          data-testid={state === 'current' ? 'full-current-line' : undefined}
          dir="auto"
        >
          {line.isInterlude ? (
            <span className="note">♪</span>
          ) : state === 'current' ? (
            <CurrentWords line={line} snap={snap} reduced={reduced} />
          ) : (
            line.text
          )}
          {showRomaji && (
            <div
              className="romaji"
              style={{ '--p': `${((state === 'current' ? romajiFill(line, snap.wordIndex, reduced ? 1 : snap.wordProgress) : state === 'past' ? 1 : 0) * 100).toFixed(2)}%` } as CSSProperties}
            >
              {line.romaji}
            </div>
          )}
        </div>
      );
    });

  return (
    <div className={`full ${snap.status === 'paused' ? 'paused' : ''}`} style={vars} data-testid="full-lyrics">
      <header>
        {artworkUrl ? <img className="art" src={artworkUrl} alt="" draggable={false} /> : <div className="art placeholder">♪</div>}
        <div className="meta">
          <div className="title" dir="auto">
            {snap.track?.title ?? 'LyricIsland'}
          </div>
          <div className="artist" dir="auto">
            {snap.track?.artist ?? ''}
          </div>
        </div>
        <div className="tools">
          <button title={L('lyricsSmaller')} onClick={() => setScale(-0.1)}>
            A−
          </button>
          <button title={L('lyricsBigger')} onClick={() => setScale(0.1)}>
            A+
          </button>
          <button
            title={L('lyricsPin')}
            className={view.alwaysOnTop ? 'on' : ''}
            aria-pressed={view.alwaysOnTop}
            data-testid="pin"
            onClick={() => void api.setSettings({ lyricsView: { alwaysOnTop: !view.alwaysOnTop } })}
          >
            📌
          </button>
        </div>
      </header>
      <div
        className="scroll"
        ref={scrollRef}
        onWheel={pauseFollow}
        onKeyDown={pauseFollow}
        onMouseDown={(e) => e.target === scrollRef.current && pauseFollow()}
        tabIndex={0}
      >
        <div className="pad-top" />
        {body}
        <div className="pad-bottom" />
      </div>
      {!following && lines.length > 0 && (
        <button
          className="follow"
          onClick={() => {
            window.clearTimeout(resumeTimer.current);
            setFollowing(true);
            scrollToActive(true);
          }}
        >
          {L('lyricsFollow')}
        </button>
      )}
    </div>
  );
}
