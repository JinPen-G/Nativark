import { useEffect } from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { motionTokens } from './motion';
import type { MotionVariables } from './integration-types';
import { FormattedNumber } from './FormattedNumber';
import type { SegmentSlice } from './geometry';
import { styles } from './styles';

export function SegmentLayer({
  slice,
  color,
  width,
  active,
  dimmed,
  label,
  formatter,
  reduced,
}: {
  slice: SegmentSlice;
  color: string;
  width: MotionValue<number>;
  active: boolean;
  dimmed: boolean;
  label: string;
  formatter: Intl.NumberFormat;
  reduced: boolean;
}) {
  const start = useMotionValue(slice.start),
    end = useMotionValue(slice.end);
  useEffect(() => {
    if (reduced) {
      start.jump(slice.start);
      end.jump(slice.end);
      return;
    }
    const left = animate(start, slice.start, motionTokens.spring.smooth),
      right = animate(end, slice.end, motionTokens.spring.smooth);
    return () => {
      left.stop();
      right.stop();
    };
  }, [start, end, reduced, slice.start, slice.end]);
  const clipPath = useTransform(
    [start, end, width],
    ([left = 0, right = 0, pixels = 0]: number[]) =>
      `inset(0 calc(${((1 - right) * 100).toFixed(3)}% + ${Math.min(1, (1 - right) * pixels).toFixed(2)}px) 0 calc(${(100 * left).toFixed(3)}% + ${Math.min(1, left * pixels).toFixed(2)}px) round 4px)`,
  );
  const capX = useTransform(
    [end, width],
    ([right = 0, pixels = 0]: number[]) =>
      right * pixels - 3 - Math.min(1, (1 - right) * pixels),
  );
  const capOpacity = useTransform(
    [start, end, width],
    ([left = 0, right = 0, pixels = 0]: number[]) =>
      Math.max(0, Math.min(1, ((right - left) * pixels - 4) / 6)),
  );
  const textX = useTransform(
    [start, width],
    ([left = 0, pixels = 0]: number[]) => left * pixels + 10,
  );
  const style: MotionVariables = { clipPath, '--seg': color };
  const inside = slice.on && (slice.mode === 'full' || slice.mode === 'short');
  return (
    <motion.span
      className={styles.segment}
      data-active={active || undefined}
      data-dimmed={dimmed || undefined}
      style={style}
      aria-hidden="true"
    >
      <motion.span
        className={styles.cap}
        style={{ x: capX, opacity: capOpacity }}
      />
      <motion.span
        className={styles.inside}
        style={{ x: textX }}
        initial={false}
        animate={{ opacity: Number(inside) }}
        transition={{ duration: reduced ? 0 : motionTokens.duration.fast }}
      >
        <motion.span
          className={styles.insideName}
          initial={false}
          animate={{
            opacity: Number(slice.mode === 'full'),
            width: slice.mode === 'full' ? 'auto' : 0,
            marginRight: slice.mode === 'full' ? 5 : 0,
          }}
          transition={reduced ? { duration: 0 } : motionTokens.spring.morph}
        >
          {label}
        </motion.span>
        <FormattedNumber
          value={slice.share}
          formatter={formatter}
          reduced={reduced}
        />
      </motion.span>
    </motion.span>
  );
}
