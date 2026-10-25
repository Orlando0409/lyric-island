// IslandView (sección 10): estados, karaoke, interludios, ecualizador y modo fantasma.
import { AnimatePresence, motion, type Transition } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { IslandSnapshot } from '../../core/controller';
import type { LyricLine, Palette } from '../../core/types';
import type { Settings } from '../../shared/settings';
import { useIsland } from './useIsland';

const SPRING: Transition = { type: 'spring', stiffness: 380, damping: 30 };
const INSTANT: Transition = { duration: 0 };

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

/** Modo fantasma (RF-34): con el cursor encima la isla se vuelve casi transparente. */
function useGhost(enabled: boolean, ref: React.RefObject<HTMLElement | null>): boolean {
  const [ghost, setGhost] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setGhost(false);
      return;
    }
    const move = (e: MouseEvent) => setGhost(!!ref.current?.contains(e.target as Node));
    const leave = () => setGhost(false);
    document.addEventListener('mousemove', move);
    document.documentElement.addEventListener('mouseleave', leave);
    window.addEventListener('blur', leave);
    return () => {
      document.removeEventListener('mousemove', move);
      document.documentElement.removeEventListener('mouseleave', leave);
      window.removeEventListener('blur', leave);
    };
  }, [enabled, ref]);
  return ghost;
}

function wordFill(i: number, snap: IslandSnapshot, reducedKaraoke: boolean): number {
  if (reducedKaraoke) return 1; // relleno por línea
  if (i < snap.wordIndex) return 1;
  if (i === snap.wordIndex) return snap.wordProgress;
  return 0;
}

function KaraokeLine({ line, snap, reduced }: { line: LyricLine; snap: IslandSnapshot; reduced: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(0);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    // Se re-mide cuando la isla termina de crecer (spring) o cambia la fuente.
    const measure = () => setOverflow(Math.max(0, text.scrollWidth - box.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [line.text]);
  // Marquee (RF-31): el desplazamiento sigue el progreso del canto.
  const k = Math.min(1, Math.max(0, (snap.lineProgress - 0.1) / 0.75));
  const words = line.words.length > 0 ? line.words : [{ text: line.text, startMs: line.startMs, endMs: line.endMs, estimated: true }];
  return (
    <div className="line-box" ref={boxRef}>
      <div className="line current" dir="auto" ref={textRef} style={{ transform: overflow ? `translateX(${-overflow * k}px)` : undefined }} data-testid="current-line">
        {words.map((w, i) => (
          <span key={i} className="word" style={{ '--p': `${(wordFill(i, snap, reduced) * 100).toFixed(2)}%` } as CSSProperties}>
            {w.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function Interlude({ progress, title }: { progress: number; title: string | null }) {
  const dots = [0, 1, 2].map((i) => Math.min(1, Math.max(0, progress * 3 - i)));
  return (
    <div className="line current interlude" data-testid="interlude">
      <span className="note">♪</span>
      {dots.map((d, i) => (
        <span key={i} className="dot" style={{ opacity: 0.25 + 0.75 * d, transform: `scale(${0.8 + 0.3 * d})` }}>
          •
        </span>
      ))}
      {title && <span className="interlude-title">{title}</span>}
    </div>
  );
}

function Equalizer({ playing }: { playing: boolean }) {
  return (
    <div className={`eq ${playing ? '' : 'frozen'}`} aria-hidden>
      <span />
      <span />
      <span />
    </div>
  );
}

function Artwork({ url, size, show }: { url: string | null; size: number; show: boolean }) {
  if (!show) return null;
  return url ? (
    <img className="art" src={url} width={size} height={size} alt="" draggable={false} />
  ) : (
    <div className="art placeholder" style={{ width: size, height: size }}>
      ♪
    </div>
  );
}

function Background({ style, palette, artworkUrl, reduced }: { style: Settings['appearance']['backgroundStyle']; palette: Palette; artworkUrl: string | null; reduced: boolean }) {
  if (style === 'blur' && artworkUrl)
    return (
      <div className="bg">
        <img className="bg-blur" src={artworkUrl} alt="" />
        <div className="bg-dim" />
      </div>
    );
  const cls = style === 'live' && !reduced ? 'bg live' : style === 'solid' ? 'bg solid' : 'bg gradient';
  return <div className={cls} style={{ '--bg': palette.background, '--bg-alt': palette.backgroundAlt } as CSSProperties} />;
}

export function Island() {
  const { snap, palette, settings, artworkUrl } = useIsland();
  const islandRef = useRef<HTMLDivElement>(null);
  const prefersReduced = usePrefersReducedMotion();
  const reduced = prefersReduced || settings.appearance.animations === 'reduced';
  const ghost = useGhost(settings.appearance.ghostMode, islandRef);
  const fs = settings.appearance.fontScale;

  const mode = snap.mode;
  const expanded = mode === 'expanded' || mode === 'paused';
  const size = expanded
    ? { width: 560, height: Math.round(84 * Math.min(fs, 1.45)), borderRadius: 28 }
    : { width: 240, height: Math.round(38 * Math.min(fs, 1.3)), borderRadius: 19 };
  const opacity = mode === 'hidden' ? 0 : ghost ? 0.15 : settings.appearance.maxOpacity;

  const lines = snap.lyrics?.lines ?? [];
  const active = snap.activeLineIndex >= 0 ? lines[snap.activeLineIndex] : null;
  const showInterlude = !!snap.interlude || (active?.isInterlude ?? false);
  const next = lines[snap.activeLineIndex + 1] ?? null;
  const current = active && !active.isInterlude ? active : null;
  const title = snap.track ? [snap.track.title, snap.track.artist].filter(Boolean).join(' — ') : '';

  const vars = {
    '--sung': palette.textPrimary,
    '--upcoming': palette.textUpcoming,
    '--secondary': palette.textSecondary,
    '--accent': palette.accent,
    '--fs': fs,
  } as CSSProperties;

  return (
    <div className="stage" style={vars}>
      <motion.div
        ref={islandRef}
        className={`island mode-${mode}`}
        data-testid="island"
        data-mode={mode}
        initial={false}
        animate={{ ...size, opacity, scale: mode === 'hidden' ? 0.85 : 1 }}
        transition={reduced ? INSTANT : { ...SPRING, opacity: { duration: ghost ? 0.15 : 0.2 }, scale: { duration: 0.2 } }}
      >
        <Background style={settings.appearance.backgroundStyle} palette={palette} artworkUrl={artworkUrl} reduced={reduced} />
        {expanded ? (
          <div className={`content expanded ${mode === 'paused' ? 'dimmed' : ''}`}>
            <Artwork url={artworkUrl} size={32} show={settings.appearance.showArtwork} />
            <div className="lines">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={`c${snap.activeLineIndex}${showInterlude ? 'i' : ''}`}
                  initial={reduced ? false : { y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={reduced ? undefined : { y: -8, opacity: 0, transition: { duration: 0.18 } }}
                  transition={{ duration: 0.22 }}
                >
                  {showInterlude ? (
                    <Interlude progress={snap.interlude?.progress ?? 0} title={snap.interlude?.beforeFirst ? (snap.track?.title ?? null) : null} />
                  ) : current ? (
                    <KaraokeLine line={current} snap={snap} reduced={reduced} />
                  ) : (
                    <div className="line current upcoming" dir="auto">
                      {lines.find((l) => !l.isInterlude)?.text ?? title}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
              {settings.appearance.showNextLine && (
                <div className="line next" dir="auto" data-testid="next-line">
                  {/* Antes de la primera línea: con interludio la siguiente es la 1.ª; sin él, la 1.ª ya está arriba. */}
                  {(snap.activeLineIndex < 0 ? lines.filter((l) => !l.isInterlude)[showInterlude ? 0 : 1] : next)?.text ?? ''}
                </div>
              )}
            </div>
            {mode === 'paused' && <div className="badge pause">❚❚</div>}
            {snap.estimatedLines && <div className="badge approx" title="Tiempos estimados">≈</div>}
          </div>
        ) : (
          <div className="content compact">
            <Artwork url={artworkUrl} size={24} show={settings.appearance.showArtwork} />
            <div className="title-box">
              {snap.showTitle && (
                <div className={`title ${title.length > 28 ? 'marquee' : ''}`} dir="auto" data-testid="title">
                  {title}
                </div>
              )}
            </div>
            <Equalizer playing={snap.status === 'playing' && !reduced} />
          </div>
        )}
        {snap.offsetFlash && (
          <div className="badge offset" data-testid="offset-flash">
            {snap.offsetFlash}
          </div>
        )}
      </motion.div>
    </div>
  );
}
