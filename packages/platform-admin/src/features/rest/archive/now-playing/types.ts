import type {
  MediaTrack,
  PlaybackLabels,
  PlaybackProps,
} from '../media-player/types';

export interface NowPlayingTrack extends MediaTrack {
  waveform?: readonly number[];
}

export interface NowPlayingLabels extends PlaybackLabels {
  expand: string;
  collapse: string;
  by: string;
  playing: string;
  paused: string;
}

export interface NowPlayingProps extends Omit<PlaybackProps, 'labels'> {
  track: NowPlayingTrack;
  expanded: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  labels?: Partial<NowPlayingLabels>;
  className?: string;
}
