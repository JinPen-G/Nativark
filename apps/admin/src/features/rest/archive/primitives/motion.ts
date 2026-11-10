import { useSyncExternalStore } from 'react';
import type { Transition } from 'motion/react';

/** Converts the source's duration/bounce model into physical spring values. */
export function springFromDuration(
  duration: number,
  bounce: number,
): Transition {
  const frequency = (2 * Math.PI) / (1.2 * duration);
  return {
    type: 'spring',
    stiffness: frequency * frequency,
    damping: 2 * (1 - bounce) * frequency,
    mass: 1,
  };
}

/** Arc UI's published motion values, expressed in seconds. */
export const motionTokens = {
  duration: {
    instant: 0.12,
    fast: 0.16,
    exit: 0.18,
    standard: 0.24,
    considered: 0.48,
  },
  ease: {
    enter: [0.16, 1, 0.3, 1],
    exit: [0.7, 0, 0.84, 0],
    standard: [0.22, 1, 0.36, 1],
    inOut: [0.65, 0, 0.35, 1],
  },
  spring: {
    responsive: { type: 'spring', stiffness: 520, damping: 44 },
    gentle: { type: 'spring', stiffness: 340, damping: 34 },
    snappy: { type: 'spring', visualDuration: 0.26, bounce: 0 },
    smooth: { type: 'spring', visualDuration: 0.4, bounce: 0 },
    morph: { type: 'spring', visualDuration: 0.42, bounce: 0 },
  },
  stagger: { char: 0.016, word: 0.04, line: 0.08, item: 0.035 },
  blur: { subtle: 2, soft: 4, text: 8 },
} as const;

const query = '(prefers-reduced-motion: reduce)';
function subscribePreference(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
/** Updates when the system preference changes and provides an SSR snapshot. */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribePreference,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
const subscribeHydration = () => () => {};
export function useHydrated() {
  return useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
}
