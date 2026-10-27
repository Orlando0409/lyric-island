// IslandView (sección 10): estados, karaoke, interludios, ecualizador y modo fantasma.
import { AnimatePresence, motion, type Transition } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { readableBackground } from '../../core/color';
import type { IslandSnapshot } from '../../core/controller';
import { romajiFill } from '../../core/romaji';
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
  if (i < snap.wordIndex) return 1;
  if (i === snap.wordIndex) return reducedKaraoke ? 1 : snap.wordProgress; // movimiento reducido: palabras enteras, sin barrido
  return 0;
}

/**
 * Romaji debajo de la línea japonesa, rellenado al mismo punto que lo cantado del original (romajiFill).
 * El degradado cubre solo el texto; si no entra, se desplaza siguiendo al relleno.
 */
function RomajiLine({ text, fill }: { text: string; fill: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState({ width: 0, natural: 0 });
  useLayoutEffect(() => {
    const boxEl = boxRef.current;
    const t = textRef.current;
    if (!boxEl || !t) return;
    const measure = () => setBox({ width: boxEl.clientWidth, natural: t.offsetWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(boxEl);
    return () => ro.disconnect();
  }, [text]);
  const overflow = Math.max(0, box.natural - box.width);
  const shift = Math.min(overflow, Math.max(0, box.natural * fill - box.width * 0.35));
  return (
    <div className="line next romaji" ref={boxRef} data-testid="romaji-line">
      <span
        className="romaji-text"
        ref={textRef}
        style={{ '--p': `${(fill * 100).toFixed(2)}%`, transform: shift ? `translateX(${-shift}px)` : undefined } as CSSProperties}
      >
        {text}
      </span>
    </div>
  );
}

/** Cómo entra una línea: en un renglón, partida en dos (letra algo menor) o desplazándose (RF-31). */
type LineFit = 'single' | 'wrap' | 'scroll';
const WRAP_FONT_RATIO = 16 / 18;

function KaraokeLine({ line, snap, reduced }: { line: LyricLine; snap: IslandSnapshot; reduced: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [fit, setFit] = useState<LineFit>('single');
  const [box, setBox] = useState({ width: 0, overflow: 0 });
  useLayoutEffect(() => {
    const boxEl = boxRef.current;
    const m = measureRef.current;
    if (!boxEl || !m) return;
    // Se re-mide cuando la isla termina de crecer (spring) o cambia la fuente.
    const measure = () => {
      const width = boxEl.clientWidth;
      const natural = m.scrollWidth; // ancho en un solo renglón con la fuente normal
      if (natural <= width) setFit('single');
      else if (natural * WRAP_FONT_RATIO <= width * 2 * 0.92) setFit('wrap');
      else setFit('scroll');
      setBox({ width, overflow: Math.max(0, natural - width) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(boxEl);
    return () => ro.disconnect();
  }, [line.text]);

  // Líneas larguísimas: el desplazamiento sigue a la palabra que se está cantando (siempre visible).
  let shift = 0;
  if (fit === 'scroll') {
    const span = wordRefs.current[snap.wordIndex];
    if (span) {
      const sungX = span.offsetLeft + span.offsetWidth * (reduced ? 1 : snap.wordProgress);
      shift = Math.min(box.overflow, Math.max(0, sungX - box.width * 0.35));
    } else if (snap.wordIndex >= line.words.length - 1 && snap.lineProgress >= 1) shift = box.overflow;
  }
  const words = line.words.length > 0 ? line.words : [{ text: line.text, startMs: line.startMs, endMs: line.endMs, estimated: true }];
  return (
    <div className="line-box" ref={boxRef}>
      <span className="line current measure" aria-hidden ref={measureRef}>
        {line.text}
      </span>
      <div
        className={`line current ${fit === 'wrap' ? 'wrap' : ''}`}
        dir="auto"
        style={{ transform: shift ? `translateX(${-shift}px)` : undefined }}
        data-testid="current-line"
        data-fit={fit}
      >
        {words.map((w, i) => (
          <span
            key={i}
            ref={(el) => {
              wordRefs.current[i] = el;
            }}
            className="word"
            style={{ '--p': `${(wordFill(i, snap, reduced) * 100).toFixed(2)}%` } as CSSProperties}
          >
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

function Background({ appearance: a, palette, artworkUrl, reduced }: { appearance: Settings['appearance']; palette: Palette; artworkUrl: string | null; reduced: boolean }) {
  const style = a.backgroundStyle;
  // Colores personalizados del degradado, oscurecidos si hace falta para que la letra blanca se lea.
  const custom = useMemo(
    () => (a.gradientSource === 'custom' ? { from: readableBackground(a.gradientFrom), to: readableBackground(a.gradientTo) } : null),
    [a.gradientSource, a.gradientFrom, a.gradientTo],
  );
  if (style === 'blur' && artworkUrl)
    return (
      <div className="bg">
        <img className="bg-blur" src={artworkUrl} alt="" />
        <div className="bg-dim" />
      </div>
    );
  const cls = style === 'live' && !reduced ? 'bg live' : style === 'solid' ? 'bg solid' : 'bg gradient';
  const vars = {
    '--bg': style !== 'solid' && custom ? custom.from : palette.background,
    '--bg-alt': style !== 'solid' && custom ? custom.to : palette.backgroundAlt,
    '--bg-angle': `${a.gradientAngle}deg`,
  } as CSSProperties;
  return <div className={cls} style={vars} data-testid="island-bg" />;
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
  const opacity = mode === 'hidden' ? 0 : ghost ? settings.appearance.ghostOpacity : settings.appearance.maxOpacity;
  const ghostFade = settings.appearance.ghostFadeMs / 1000;

  const lines = snap.lyrics?.lines ?? [];
  const active = snap.activeLineIndex >= 0 ? lines[snap.activeLineIndex] : null;
  const showInterlude = !!snap.interlude || (active?.isInterlude ?? false);
  const next = lines[snap.activeLineIndex + 1] ?? null;
  const current = active && !active.isInterlude ? active : null;
  // Línea que se ve arriba (la actual o, antes de empezar, la primera) y su romaji si la canción es japonesa.
  const topLine = showInterlude ? null : (current ?? (snap.activeLineIndex < 0 ? (lines.find((l) => !l.isInterlude) ?? null) : null));
  const romajiLine = settings.lyrics.showRomaji && topLine?.romaji ? topLine : null;
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
        transition={reduced ? INSTANT : { ...SPRING, opacity: { duration: ghost ? ghostFade : Math.max(0.2, ghostFade) }, scale: { duration: 0.2 } }}
      >
        <Background appearance={settings.appearance} palette={palette} artworkUrl={artworkUrl} reduced={reduced} />
        {expanded ? (
          <div className={`content expanded ${mode === 'paused' ? 'dimmed' : ''}`}>
            <Artwork url={artworkUrl} size={32} show={settings.appearance.showArtwork} />
            <div className="lines">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={`c${snap.activeLineIndex}${showInterlude ? 'i' : ''}`}
                  initial={reduced ? false : { y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  // La que sale se va rápido: una línea larga (dos renglones) se montaba sobre la que entra.
                  exit={reduced ? undefined : { y: -6, opacity: 0, transition: { duration: 0.1 } }}
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
              {romajiLine ? (
                // Canción en japonés: romaji de la línea de arriba, rellenado al mismo ritmo que la línea original.
                <RomajiLine
                  text={romajiLine.romaji ?? ''}
                  fill={romajiLine === current ? romajiFill(current, snap.wordIndex, reduced ? 1 : snap.wordProgress) : 0}
                />
              ) : settings.appearance.showNextLine && (
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
