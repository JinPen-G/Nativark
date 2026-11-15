/** Controlled Arc UI transport surfaces. The host owns media playback and time. */
import { useEffect, useRef, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { motionTokens, useReducedMotion } from '../primitives/motion';
import {
  boundedValue,
  formatTime,
  playbackLabels,
  positiveDuration,
} from './playback';
import type { PlaybackProps, TransportProps } from './types';
import styles from './styles.module.css';

type FillStyle = CSSProperties & { '--fill': string };

export function PlaybackButtons(props: PlaybackProps) {
  const {
    playing,
    onPlayingChange,
    onPrevious,
    onNext,
    status = 'ready',
    disabled = false,
  } = props;
  const labels = { ...playbackLabels, ...props.labels };
  const reduced = useReducedMotion();
  const unavailable = disabled || status !== 'ready';

  return (
    <div className={styles.transport}>
      <button
        type="button"
        aria-label={labels.previous}
        disabled={unavailable || !onPrevious}
        onClick={onPrevious}
      >
        <SkipBack size={18} fill="currentColor" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.playButton}
        aria-label={playing ? labels.pause : labels.play}
        aria-busy={status === 'loading' || undefined}
        disabled={unavailable || !onPlayingChange}
        onClick={() => onPlayingChange?.(!playing)}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={playing ? 'pause' : 'play'}
            className={styles.playIcon}
            initial={{
              opacity: 0,
              scale: reduced ? 1 : 0.8,
              filter: reduced ? 'none' : 'blur(2px)',
            }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{
              opacity: 0,
              scale: reduced ? 1 : 0.8,
              filter: reduced ? 'none' : 'blur(2px)',
            }}
            transition={{ duration: reduced ? 0 : motionTokens.duration.fast }}
          >
            {playing ? (
              <Pause size={20} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={20} fill="currentColor" aria-hidden="true" />
            )}
          </motion.span>
        </AnimatePresence>
      </button>
      <button
        type="button"
        aria-label={labels.next}
        disabled={unavailable || !onNext}
        onClick={onNext}
      >
        <SkipForward size={18} fill="currentColor" aria-hidden="true" />
      </button>
    </div>
  );
}

export function Timeline(props: PlaybackProps & { trackTitle?: string }) {
  const labels = { ...playbackLabels, ...props.labels };
  const duration = positiveDuration(props.duration);
  const time = boundedValue(props.currentTime, duration);
  const unavailable =
    props.disabled ||
    (props.status ?? 'ready') !== 'ready' ||
    !duration ||
    !props.onSeek;
  const fill = {
    '--fill': `${duration ? (time / duration) * 100 : 0}%`,
  } as FillStyle;

  return (
    <div className={styles.timeline}>
      <span aria-hidden="true">{formatTime(time)}</span>
      <input
        type="range"
        className={styles.range}
        min={0}
        max={duration}
        step={0.1}
        value={time}
        style={fill}
        aria-label={
          props.labels?.position ??
          (props.trackTitle ? `Seek ${props.trackTitle}` : labels.position)
        }
        aria-valuetext={`${formatTime(time)} ${labels.of} ${formatTime(duration)}`}
        disabled={unavailable}
        onChange={(event) =>
          props.onSeek?.(
            boundedValue(event.currentTarget.valueAsNumber, duration),
          )
        }
      />
      <span aria-hidden="true">{formatTime(duration)}</span>
    </div>
  );
}

export function VolumeControl(props: TransportProps) {
  const labels = { ...playbackLabels, ...props.labels };
  const volume = boundedValue(props.volume, 1);
  const lastAudibleVolume = useRef(volume || 0.7);
  useEffect(() => {
    if (volume > 0) lastAudibleVolume.current = volume;
  }, [volume]);
  const unavailable =
    props.disabled ||
    (props.status ?? 'ready') !== 'ready' ||
    !props.onVolumeChange;

  return (
    <div className={styles.volume}>
      <button
        type="button"
        aria-label={volume === 0 ? labels.unmute : labels.mute}
        disabled={unavailable}
        onClick={() =>
          props.onVolumeChange?.(volume === 0 ? lastAudibleVolume.current : 0)
        }
      >
        {volume === 0 ? (
          <VolumeX size={16} aria-hidden="true" />
        ) : (
          <Volume2 size={16} aria-hidden="true" />
        )}
      </button>
      <input
        type="range"
        className={styles.range}
        min={0}
        max={1}
        step={0.01}
        value={volume}
        style={{ '--fill': `${volume * 100}%` } as FillStyle}
        aria-label={labels.volume}
        aria-valuetext={`${Math.round(volume * 100)}%`}
        disabled={unavailable}
        onChange={(event) =>
          props.onVolumeChange?.(
            boundedValue(event.currentTarget.valueAsNumber, 1),
          )
        }
      />
    </div>
  );
}

export function Transport({ className = '', ...props }: TransportProps) {
  const labels = { ...playbackLabels, ...props.labels };
  const reduced = useReducedMotion();
  return (
    <section
      className={`${styles.scope} ${styles.controls} ${className}`}
      data-reduced={reduced}
      aria-label={labels.player}
      aria-busy={props.status === 'loading' || undefined}
    >
      <PlaybackButtons {...props} />
      <Timeline {...props} />
      <VolumeControl {...props} />
      {props.status && props.status !== 'ready' && (
        <span className={styles.srOnly} role="status">
          {labels[props.status]}
        </span>
      )}
    </section>
  );
}
