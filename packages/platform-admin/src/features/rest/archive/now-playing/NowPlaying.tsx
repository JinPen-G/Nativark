/** Continuous Arc UI player morph. Playback, seeking and expansion belong to the host. */
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
} from 'motion/react';
import { ChevronDown, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { motionTokens, useReducedMotion } from '../primitives/motion';
import {
  boundedValue,
  playbackLabels,
  positiveDuration,
} from '../media-player/playback';
import { Waveform, waveformLevels } from './Waveform';
import type { NowPlayingProps } from './types';
import styles from './styles.module.css';

export function NowPlayingLevels({
  playing,
  className = '',
}: {
  playing: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <span
      className={`${styles.levels} ${className}`}
      data-playing={playing || undefined}
      data-reduced={reduced}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
    </span>
  );
}

export function NowPlaying({
  track,
  expanded,
  className = '',
  ...props
}: NowPlayingProps) {
  const reduced = useReducedMotion();
  const group = useId();
  const statusId = useId();
  const contentId = useId();
  const labels = {
    ...playbackLabels,
    player: 'Now playing',
    expand: `Expand player, ${track.title} by ${track.artist}`,
    collapse: 'Collapse player',
    by: 'by',
    playing: 'playing',
    paused: 'paused',
    ...props.labels,
  };
  const duration = positiveDuration(props.duration);
  const time = boundedValue(props.currentTime, duration);
  const unavailable = props.disabled || (props.status ?? 'ready') !== 'ready';
  const identity =
    track.id ?? `${track.title}-${track.artist}-${track.artwork}`;
  const levels = useMemo(
    () => (track.waveform?.length ? track.waveform : waveformLevels(identity)),
    [track.waveform, identity],
  );
  const previousIdentity = useRef(identity);
  const direction = useRef(1);
  const content = useRef<HTMLDivElement>(null);
  const miniButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const previousExpanded = useRef(expanded);
  const [height, setHeight] = useState(expanded ? 411 : 64);
  const spring = reduced ? { duration: 0 } : motionTokens.spring.morph;
  const fade = {
    duration: reduced ? 0 : motionTokens.duration.fast,
    ease: motionTokens.ease.standard,
  };
  const restart = time > 3 && !!props.onSeek;

  useLayoutEffect(() => {
    const inner = content.current;
    if (!inner) return;
    const measure = () => setHeight(expanded ? inner.offsetHeight : 64);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [expanded]);

  useLayoutEffect(() => {
    if (previousExpanded.current !== expanded) {
      (expanded ? collapseButton.current : miniButton.current)?.focus({
        preventScroll: true,
      });
      previousExpanded.current = expanded;
    }
  }, [expanded]);

  useLayoutEffect(() => {
    previousIdentity.current = identity;
  }, [identity]);

  function previousTrack() {
    direction.current = -1;
    if (restart) props.onSeek?.(0);
    else props.onPrevious?.();
  }

  function nextTrack() {
    direction.current = 1;
    props.onNext?.();
  }

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <LayoutGroup id={group}>
        <section
          className={`${styles.root} ${className}`}
          aria-label={labels.player}
          aria-describedby={statusId}
          aria-busy={props.status === 'loading' || undefined}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && expanded && props.onExpandedChange) {
              event.preventDefault();
              props.onExpandedChange(false);
            }
          }}
        >
          <p id={statusId} className={styles.srOnly} aria-live="polite">
            {track.title} {labels.by} {track.artist},{' '}
            {props.status && props.status !== 'ready'
              ? labels[props.status]
              : props.playing
                ? labels.playing
                : labels.paused}
          </p>
          <motion.div
            className={styles.shell}
            data-expanded={expanded || undefined}
            animate={{ height, borderRadius: expanded ? 30 : 22 }}
            transition={spring}
          >
            <div ref={content} id={contentId} className={styles.inner}>
              <motion.div
                className={styles.art}
                layout
                style={{ borderRadius: expanded ? 20 : 12 }}
                transition={spring}
                drag={
                  expanded && !!props.onExpandedChange && !reduced ? 'y' : false
                }
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.08, bottom: 0.55 }}
                onDragEnd={(_, gesture) => {
                  if (
                    gesture.offset.y > 70 ||
                    (gesture.offset.y > 8 && gesture.velocity.y > 500)
                  )
                    props.onExpandedChange?.(false);
                }}
              >
                <motion.div
                  className={styles.artSquare}
                  layout="preserve-aspect"
                  transition={spring}
                >
                  <AnimatePresence initial={false} custom={direction.current}>
                    <motion.img
                      key={identity}
                      className={styles.artImage}
                      src={track.artwork}
                      alt={track.artworkAlt ?? track.alt ?? ''}
                      draggable={false}
                      decoding="async"
                      custom={direction.current}
                      variants={{
                        enter: (skip: number) => ({
                          opacity: 0,
                          x: reduced ? 0 : skip * 26,
                          filter: reduced ? 'none' : 'blur(4px)',
                        }),
                        settle: { opacity: 1, x: 0, filter: 'blur(0px)' },
                        leave: (skip: number) => ({
                          opacity: 0,
                          x: reduced ? 0 : -skip * 26,
                          filter: reduced ? 'none' : 'blur(4px)',
                        }),
                      }}
                      initial="enter"
                      animate="settle"
                      exit="leave"
                      transition={{
                        ...fade,
                        duration: reduced ? 0 : motionTokens.duration.standard,
                      }}
                    />
                  </AnimatePresence>
                </motion.div>
                {expanded && (
                  <motion.button
                    ref={collapseButton}
                    type="button"
                    className={styles.collapse}
                    aria-label={labels.collapse}
                    aria-expanded
                    aria-controls={contentId}
                    disabled={!props.onExpandedChange}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={fade}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onExpandedChange?.(false)}
                  >
                    <ChevronDown
                      size={18}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </motion.button>
                )}
              </motion.div>
              <motion.button
                ref={miniButton}
                type="button"
                className={styles.miniMain}
                aria-label={labels.expand}
                aria-expanded={expanded}
                aria-controls={contentId}
                inert={expanded}
                tabIndex={expanded ? -1 : 0}
                disabled={!props.onExpandedChange}
                animate={{
                  opacity: expanded ? 0 : 1,
                  filter: expanded && !reduced ? 'blur(2px)' : 'blur(0px)',
                }}
                transition={fade}
                onClick={() => props.onExpandedChange?.(true)}
              >
                <span className={styles.miniText}>
                  <span className={styles.miniTitle}>{track.title}</span>
                  <span className={styles.miniArtist}>{track.artist}</span>
                </span>
              </motion.button>
              <motion.span
                className={styles.levelsArea}
                animate={{ opacity: expanded ? 0 : 1 }}
                transition={fade}
                aria-hidden="true"
              >
                <NowPlayingLevels playing={props.playing && !unavailable} />
              </motion.span>
              <motion.span
                className={styles.miniProgressTrack}
                animate={{ opacity: expanded ? 0 : 1 }}
                transition={fade}
                aria-hidden="true"
              >
                <span
                  className={styles.miniProgress}
                  style={{
                    transform: `scaleX(${duration ? time / duration : 0})`,
                  }}
                />
              </motion.span>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div
                    key="info"
                    className={styles.info}
                    initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={fade}
                  >
                    <motion.div
                      key={identity}
                      className={styles.infoText}
                      initial={{
                        opacity: previousIdentity.current === identity ? 1 : 0,
                      }}
                      animate={{ opacity: 1 }}
                      transition={fade}
                    >
                      <h3 className={styles.titleLarge}>{track.title}</h3>
                      <p className={styles.artistLarge}>{track.artist}</p>
                    </motion.div>
                  </motion.div>
                )}
                {expanded && (
                  <motion.div
                    key="wave"
                    className={styles.waveArea}
                    initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={fade}
                  >
                    <Waveform {...props} identity={identity} levels={levels} />
                  </motion.div>
                )}
                {expanded && (
                  <motion.button
                    key="previous"
                    type="button"
                    className={styles.prev}
                    aria-label={labels.previous}
                    disabled={unavailable || (!restart && !props.onPrevious)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={fade}
                    onClick={previousTrack}
                  >
                    <SkipBack
                      size={20}
                      fill="currentColor"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </motion.button>
                )}
              </AnimatePresence>
              <motion.button
                layout
                type="button"
                className={styles.play}
                aria-label={
                  props.labels?.[props.playing ? 'pause' : 'play'] ??
                  `${props.playing ? labels.pause : labels.play} ${track.title}`
                }
                aria-busy={props.status === 'loading' || undefined}
                disabled={unavailable || !props.onPlayingChange}
                transition={spring}
                onClick={() => props.onPlayingChange?.(!props.playing)}
              >
                <span
                  className={styles.playGlyph}
                  style={{
                    width: expanded ? 24 : 18,
                    height: expanded ? 24 : 18,
                  }}
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.span
                      key={props.playing ? 'pause' : 'play'}
                      className={styles.playPhase}
                      data-icon={props.playing ? 'pause' : 'play'}
                      initial={{
                        opacity: 0,
                        scale: reduced ? 1 : 0.8,
                        filter: reduced ? 'none' : 'blur(2px)',
                      }}
                      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, scale: reduced ? 1 : 0.8 }}
                      transition={fade}
                    >
                      {props.playing ? (
                        <Pause
                          size={expanded ? 24 : 18}
                          fill="currentColor"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      ) : (
                        <Play
                          size={expanded ? 24 : 18}
                          fill="currentColor"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      )}
                    </motion.span>
                  </AnimatePresence>
                </span>
              </motion.button>
              <motion.button
                layout
                type="button"
                className={styles.next}
                aria-label={labels.next}
                disabled={unavailable || !props.onNext}
                transition={spring}
                onClick={nextTrack}
              >
                <SkipForward
                  size={expanded ? 20 : 18}
                  fill="currentColor"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </motion.button>
            </div>
          </motion.div>
        </section>
      </LayoutGroup>
    </MotionConfig>
  );
}

export default NowPlaying;
