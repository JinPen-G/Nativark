import { useEffect, useRef, useState } from 'react';
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { motionTokens } from './motion';
import { styles } from './styles';

const digits = Array.from({ length: 10 }, (_, digit) => digit);
const widthVariants = {
  initial: { width: 0, opacity: 0 },
  animate: { width: 'auto', opacity: 1 },
  exit: { width: 0, opacity: 0 },
};
type Part = { key: string; digit: number } | { key: string; text: string };
function numberParts(formatter: Intl.NumberFormat, value: number): Part[] {
  const parts = formatter.formatToParts(value);
  let integers = parts.reduce(
      (length, part) =>
        length + (part.type === 'integer' ? part.value.length : 0),
      0,
    ),
    fractions = 0;
  return parts.flatMap<Part>((part, index) =>
    part.type === 'integer'
      ? [...part.value].map((digit) => ({
          key: `i${--integers}`,
          digit: Number(digit),
        }))
      : part.type === 'fraction'
        ? [...part.value].map((digit) => ({
            key: `f${fractions++}`,
            digit: Number(digit),
          }))
        : [
            {
              key:
                part.type === 'group'
                  ? `g${integers}`
                  : part.type === 'literal'
                    ? `l${index}`
                    : part.type,
              text: part.value,
            },
          ],
  );
}
function DigitGlyph({
  position,
  digit,
}: {
  position: MotionValue<number>;
  digit: number;
}) {
  const offset = useTransform(
    position,
    (value) => ((((digit - value) % 10) + 15) % 10) - 5,
  );
  const y = useTransform(offset, (value) => `${value}em`);
  const opacity = useTransform(offset, (value) =>
    Math.max(0, 1 - 1.2 * Math.abs(value)),
  );
  return (
    <motion.span className={styles.glyph} style={{ y, opacity }}>
      {digit}
    </motion.span>
  );
}
function DigitWheel({
  digit,
  direction,
  reduced,
}: {
  digit: number;
  direction: number;
  reduced: boolean;
}) {
  const position = useMotionValue(digit);
  const previous = useRef({ digit, target: digit });
  useEffect(() => {
    const state = previous.current;
    if (state.digit === digit) return;
    state.target +=
      direction < 0
        ? -((state.digit - digit + 10) % 10)
        : (digit - state.digit + 10) % 10;
    state.digit = digit;
    if (reduced) {
      position.jump(state.target);
      return;
    }
    const animation = animate(
      position,
      state.target,
      motionTokens.spring.smooth,
    );
    return () => animation.stop();
  }, [digit, direction, position, reduced]);
  return (
    <span className={styles.wheel}>
      <span className={styles.sizer}>0</span>
      {digits.map((value) => (
        <DigitGlyph key={value} position={position} digit={value} />
      ))}
    </span>
  );
}
export function FormattedNumber({
  value,
  formatter,
  reduced,
}: {
  value: number;
  formatter: Intl.NumberFormat;
  reduced: boolean;
}) {
  const [previous, setPrevious] = useState({ value, direction: 1 });
  if (previous.value !== value)
    setPrevious({ value, direction: value >= previous.value ? 1 : -1 });
  const transition = reduced ? { duration: 0 } : motionTokens.spring.morph;
  return (
    <span className={styles.number} aria-hidden="true">
      <AnimatePresence initial={false}>
        {numberParts(formatter, value).map((part) =>
          'digit' in part ? (
            <motion.span
              key={part.key}
              className={styles.column}
              {...widthVariants}
              transition={transition}
            >
              <DigitWheel
                digit={part.digit}
                direction={previous.direction}
                reduced={reduced}
              />
            </motion.span>
          ) : (
            <motion.span
              key={part.key}
              className={styles.symbol}
              {...widthVariants}
              transition={transition}
            >
              {part.text}
            </motion.span>
          ),
        )}
      </AnimatePresence>
    </span>
  );
}
