/** Public-preview layout reconstructed with host-controlled playback ports. */
import { useId } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { motionTokens, useReducedMotion } from '../primitives/motion';
import { formatTime, playbackLabels } from './playback';
import { PlaybackButtons, Timeline, VolumeControl } from './Transport';
import type { MediaPlayerProps } from './types';
import styles from './styles.module.css';

export function MediaPlayer({
  track,
  tracks = [],
  coverSlot,
  className = '',
  ...props
}: MediaPlayerProps) {
  const reduced = useReducedMotion();
  const group = useId();
  const labels = { ...playbackLabels, playlist: 'Playlist', ...props.labels };
  const identity =
    track.id ?? `${track.title}-${track.artist}-${track.artwork}`;

  return (
    <LayoutGroup id={group}>
      <section
        className={`${styles.scope} ${styles.player} ${className}`}
        data-reduced={reduced}
        aria-label={labels.player}
        aria-busy={props.status === 'loading' || undefined}
      >
        <div className={styles.cover}>
          {coverSlot != null ? (
            <div className={styles.coverImage}>{coverSlot}</div>
          ) : (
            <AnimatePresence initial={false}>
              <motion.div
                key={identity}
                className={styles.coverImage}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: reduced ? 0 : motionTokens.duration.standard,
                }}
              >
                <img
                  src={track.artwork}
                  alt={track.artworkAlt ?? track.alt ?? ''}
                  draggable={false}
                  decoding="async"
                />
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        <div className={styles.nowPlaying}>
          <div className={styles.titleClip}>
            <motion.div
              key={identity}
              initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduced ? 0 : motionTokens.duration.standard,
              }}
            >
              <h2>{track.title}</h2>
              <p>{track.artist}</p>
            </motion.div>
          </div>
          <PlaybackButtons {...props} />
        </div>
        <Timeline {...props} trackTitle={track.title} />
        <div className={styles.queueHead}>
          {tracks.length > 0 && <h3>{labels.playlist}</h3>}
          <VolumeControl {...props} />
        </div>
        {tracks.length > 0 && (
          <ul className={styles.queue}>
            {tracks.map((item) => {
              const itemIdentity =
                item.id ?? `${item.title}-${item.artist}-${item.artwork}`;
              const current = itemIdentity === identity;
              return (
                <li key={itemIdentity}>
                  <button
                    type="button"
                    className={styles.track}
                    data-current={current}
                    aria-current={current || undefined}
                    aria-label={`${labels.play} ${item.title}`}
                    disabled={
                      props.disabled ||
                      (props.status ?? 'ready') !== 'ready' ||
                      !props.onTrackChange
                    }
                    onClick={() => props.onTrackChange?.(item)}
                  >
                    {current && (
                      <motion.span
                        className={styles.selectionRail}
                        layoutId="selection"
                        aria-hidden="true"
                        transition={
                          reduced ? { duration: 0 } : motionTokens.spring.gentle
                        }
                      />
                    )}
                    <span className={styles.trackTitle}>{item.title}</span>
                    <span className={styles.trackStatus}>
                      {current && props.playing ? (
                        <span className={styles.bars} aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : (
                        formatTime(item.duration ?? props.duration)
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {props.status && props.status !== 'ready' && (
          <span className={styles.srOnly} role="status">
            {labels[props.status]}
          </span>
        )}
      </section>
    </LayoutGroup>
  );
}

export default MediaPlayer;
