import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { motion } from 'motion/react';
import { motionTokens, useReducedMotion } from '../primitives/motion';
import {
  boundedValue,
  formatTime,
  keyboardSeek,
  playbackLabels,
  positiveDuration,
} from '../media-player/playback';
import type { PlaybackProps } from '../media-player/types';
import styles from './styles.module.css';

export function waveformLevels(identity: string) {
  let seed = 17;
  for (const letter of identity)
    seed = (seed * 31 + letter.charCodeAt(0)) >>> 0;
  return Array.from({ length: 54 }, (_, index) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const envelope = Math.sin((index / 53) * Math.PI);
    return 15 + (seed / 4294967296) * 28 + envelope * 52;
  });
}

interface WaveformProps extends PlaybackProps {
  levels: readonly number[];
  identity: string;
}

export function Waveform({ levels, identity, ...props }: WaveformProps) {
  const duration = positiveDuration(props.duration);
  const hostTime = boundedValue(props.currentTime, duration);
  const labels = { ...playbackLabels, ...props.labels };
  const disabled =
    props.disabled ||
    (props.status ?? 'ready') !== 'ready' ||
    !duration ||
    !props.onSeek;
  const reduced = useReducedMotion();
  const [dragTime, setDragTime] = useState<number | null>(null);
  const drag = useRef<{
    pointer: number;
    identity: string;
    time: number;
  } | null>(null);
  const time =
    disabled || drag.current?.identity !== identity
      ? hostTime
      : (dragTime ?? hostTime);
  const percent = duration ? (time / duration) * 100 : 0;

  useEffect(() => {
    drag.current = null;
    setDragTime(null);
  }, [identity, disabled, duration]);

  function timeAtPointer(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return boundedValue(
      ((event.clientX - box.left) / Math.max(1, box.width)) * duration,
      duration,
    );
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || !event.isPrimary) return;
    const time = timeAtPointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { pointer: event.pointerId, identity, time };
    setDragTime(time);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (
      drag.current?.pointer !== event.pointerId ||
      drag.current.identity !== identity ||
      disabled
    )
      return;
    drag.current.time = timeAtPointer(event);
    setDragTime(drag.current.time);
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const operation = drag.current;
    drag.current = null;
    setDragTime(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (
      commit &&
      !disabled &&
      operation?.pointer === event.pointerId &&
      operation.identity === identity
    ) {
      props.onSeek?.(timeAtPointer(event));
    }
  }

  const bars = levels.map((level, index) => (
    <span key={index} style={{ height: `${boundedValue(level, 100)}%` }} />
  ));

  return (
    <div className={styles.scrubber}>
      <motion.div
        className={styles.wave}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={labels.position}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={time}
        aria-valuetext={`${formatTime(time)} ${labels.of} ${formatTime(duration)}`}
        aria-disabled={disabled || undefined}
        animate={{ scaleX: dragTime !== null && !reduced ? 1.015 : 1 }}
        transition={reduced ? { duration: 0 } : motionTokens.spring.responsive}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={(event) => finishDrag(event, true)}
        onPointerCancel={(event) => finishDrag(event, false)}
        onLostPointerCapture={(event) => finishDrag(event, false)}
        onKeyDown={(event) => {
          if (disabled) return;
          const nextTime = keyboardSeek(event.key, hostTime, duration);
          if (nextTime === undefined) return;
          event.preventDefault();
          props.onSeek?.(nextTime);
        }}
      >
        <span className={styles.bars} aria-hidden="true">
          {bars}
        </span>
        <span
          className={styles.bars}
          data-played
          aria-hidden="true"
          style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
        >
          {bars}
        </span>
      </motion.div>
      <div className={styles.times} aria-hidden="true">
        <span>{formatTime(time)}</span>
        <span>−{formatTime(duration - time)}</span>
      </div>
    </div>
  );
}
