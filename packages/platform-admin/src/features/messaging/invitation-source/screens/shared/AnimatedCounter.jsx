/** UIARC public preview port. Source and adaptations are recorded in provenance.json. */
import {
  compactMotionTokens,
  useReducedMotion,
} from '../../components/primitives/motion';
import {
  useTransform,
  motion,
  useMotionValue,
  animate,
  useInView,
  AnimatePresence,
} from 'motion/react';
import { default as styles } from './AnimatedCounter-classes.json';
import * as React from 'react';
let x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  _ = {
    hidden: {
      opacity: 0,
      y: '0.3em',
      filter: `blur(${compactMotionTokens.blur.soft}px)`,
    },
    shown: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: {
        duration: compactMotionTokens.duration.standard,
        ease: [...compactMotionTokens.ease.enter],
      },
    },
    gone: {
      opacity: 0,
      y: '-0.3em',
      filter: `blur(${compactMotionTokens.blur.subtle}px)`,
      transition: {
        duration: compactMotionTokens.duration.fast,
        ease: [...compactMotionTokens.ease.standard],
      },
    },
  },
  v = {
    hidden: { opacity: 0, y: 0, filter: 'blur(0px)' },
    shown: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: compactMotionTokens.duration.instant },
    },
    gone: {
      opacity: 0,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: compactMotionTokens.duration.instant },
    },
  },
  b = {
    ...compactMotionTokens.spring.smooth,
    visualDuration: compactMotionTokens.duration.considered,
  };
function Glyph({ position, digit }) {
  let i = useTransform(
      position,
      (value) => ((((digit - value) % 10) + 15) % 10) - 5,
    ),
    n = useTransform(i, (value) => `${value}em`),
    o = useTransform(i, (value) => Math.max(0, 1 - Math.abs(value))),
    l = useTransform(i, (value) =>
      Math.abs(value) >= 1 ? 'hidden' : 'visible',
    ),
    d = useTransform(i, (value) =>
      0.02 > Math.abs(value) || Math.abs(value) >= 1
        ? 'none'
        : `blur(${(Math.abs(value) * compactMotionTokens.blur.subtle).toFixed(2)}px)`,
    );
  return (
    <motion.span
      className={styles.glyph}
      style={{ y: n, opacity: o, filter: d, visibility: l }}
    >
      {digit}
    </motion.span>
  );
}
let y = {
  initial: { width: 0, opacity: 0 },
  animate: { width: 'auto', opacity: 1 },
  exit: { width: 0, opacity: 0 },
};
function Column({ digit, direction, armed, delay, reduceMotion }) {
  let c = useMotionValue(armed ? 0 : digit),
    u = React.useRef({
      digit: armed ? 0 : digit,
      target: armed ? 0 : digit,
      revealed: !armed,
    });
  React.useEffect(() => {
    let a = u.current;
    if (armed || a.digit === digit) {
      if (!armed) {
        a.revealed = true;
      }
      return;
    }
    a.target +=
      direction < 0 && a.revealed
        ? -((a.digit - digit + 10) % 10)
        : (digit - a.digit + 10) % 10;
    a.digit = digit;
    reduceMotion
      ? c.jump(a.target)
      : animate(
          c,
          a.target,
          a.revealed ? compactMotionTokens.spring.smooth : { ...b, delay },
        );
    a.revealed = true;
  }, [armed, delay, digit, direction, c, reduceMotion]);
  return (
    <motion.span
      className={styles.column}
      {...y}
      transition={
        reduceMotion ? { duration: 0 } : compactMotionTokens.spring.morph
      }
    >
      <span className={styles.sizer}>{'0'}</span>
      {x.map((item) => (
        <Glyph key={item} position={c} digit={item} />
      ))}
    </motion.span>
  );
}
function AnimatedCounter({
  value,
  label,
  prefix = '',
  suffix = '',
  decimals = 0,
  animateOnView = false,
  locale = 'en-US',
}) {
  let x,
    b,
    f,
    w,
    N = React.useRef(null),
    k = useInView(N, { once: true, amount: 0.6 }),
    T = !!useReducedMotion(),
    [S, A] = React.useState(value),
    [C, $] = React.useState(1);
  if (value !== S) {
    A(value);
    $(value > S ? 1 : -1);
  }
  let L =
      ((b = (x = new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        numberingSystem: 'latn',
      }).formatToParts(value)).reduce(
        (accumulator, item) =>
          accumulator + ('integer' === item.type ? item.value.length : 0),
        0,
      )),
      (f = 0),
      (w = 0),
      x.flatMap((e, t) =>
        'integer' === e.type
          ? [...e.value].map((item) => ({
              key: `i${--b}`,
              digit: Number(item),
              order: w++,
            }))
          : 'fraction' === e.type
            ? [...e.value].map((item) => ({
                key: `f${f++}`,
                digit: Number(item),
                order: w++,
              }))
            : [
                {
                  key:
                    'group' === e.type
                      ? `g${b}`
                      : 'decimal' === e.type
                        ? 'd'
                        : `${e.type}${t}`,
                  text: e.value,
                },
              ],
      )),
    P = `${prefix}${L.map((item) => ('text' in item ? item.text : item.digit)).join('')}${suffix}`,
    R = animateOnView && !k;
  return (
    <span ref={N} className={styles.counter}>
      {label && (
        <span className={styles.label}>
          <span className={styles.labelSwap}>
            <AnimatePresence mode={'popLayout'} initial={false}>
              <motion.span
                key={label}
                className={styles.labelText}
                variants={T ? v : _}
                initial={'hidden'}
                animate={'shown'}
                exit={'gone'}
              >
                {label}
              </motion.span>
            </AnimatePresence>
          </span>
        </span>
      )}
      <span className={styles.srOnly}>{P}</span>
      <span className={styles.value} aria-hidden={'true'}>
        {prefix && <span className={styles.symbol}>{prefix}</span>}
        <AnimatePresence initial={false}>
          {L.map((item) =>
            'digit' in item ? (
              <Column
                key={item.key}
                digit={item.digit}
                direction={C}
                armed={R}
                delay={Math.min(
                  item.order * compactMotionTokens.stagger.item,
                  0.25,
                )}
                reduceMotion={T}
              />
            ) : (
              <motion.span
                key={item.key}
                className={styles.symbol}
                {...y}
                transition={
                  T ? { duration: 0 } : compactMotionTokens.spring.morph
                }
              >
                {item.text}
              </motion.span>
            ),
          )}
        </AnimatePresence>
        {suffix && <span className={styles.symbol}>{suffix}</span>}
      </span>
    </span>
  );
}
export { AnimatedCounter };
