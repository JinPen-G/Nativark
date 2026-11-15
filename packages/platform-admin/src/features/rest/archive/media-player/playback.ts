import type { PlaybackLabels } from './types';

export const playbackLabels: PlaybackLabels = {
  player: 'Audio player',
  play: 'Play',
  pause: 'Pause',
  previous: 'Previous track',
  next: 'Next track',
  position: 'Position',
  volume: 'Volume',
  mute: 'Mute audio',
  unmute: 'Unmute audio',
  loading: 'Loading audio',
  error: 'Audio unavailable',
  of: 'of',
};

export function positiveDuration(duration: number) {
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

export function boundedValue(value: number, maximum: number) {
  return Math.min(positiveDuration(maximum), positiveDuration(value));
}

export function formatTime(seconds: number) {
  const wholeSeconds = Math.floor(positiveDuration(seconds));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

export function keyboardSeek(
  key: string,
  currentTime: number,
  duration: number,
) {
  const changes: Record<string, number> = {
    ArrowLeft: -5,
    ArrowDown: -5,
    ArrowRight: 5,
    ArrowUp: 5,
    PageDown: -30,
    PageUp: 30,
  };
  if (key === 'Home') return 0;
  if (key === 'End') return positiveDuration(duration);
  const change = changes[key];
  return change === undefined
    ? undefined
    : boundedValue(currentTime + change, duration);
}
