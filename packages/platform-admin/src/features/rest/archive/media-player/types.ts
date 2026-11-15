export interface MediaTrack {
  id?: string;
  title: string;
  artist: string;
  artwork: string;
  alt?: string;
  artworkAlt?: string;
  duration?: number;
}

export type PlaybackStatus = 'ready' | 'loading' | 'error';

export interface PlaybackLabels {
  player: string;
  play: string;
  pause: string;
  previous: string;
  next: string;
  position: string;
  volume: string;
  mute: string;
  unmute: string;
  loading: string;
  error: string;
  of: string;
}

export interface PlaybackProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  status?: PlaybackStatus;
  disabled?: boolean;
  labels?: Partial<PlaybackLabels>;
  onPlayingChange?: (playing: boolean) => void;
  onSeek?: (seconds: number) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

export interface TransportProps extends PlaybackProps {
  volume: number;
  onVolumeChange?: (volume: number) => void;
  trackTitle?: string;
  className?: string;
}

export interface MediaPlayerLabels extends PlaybackLabels {
  playlist: string;
}

export interface MediaPlayerProps extends Omit<TransportProps, 'labels'> {
  track: MediaTrack;
  tracks?: readonly MediaTrack[];
  coverSlot?: ReactNode;
  onTrackChange?: (track: MediaTrack) => void;
  labels?: Partial<MediaPlayerLabels>;
}
import type { ReactNode } from 'react';
