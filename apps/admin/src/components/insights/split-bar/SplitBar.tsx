/** Adapted from the user-supplied Split bar Pro preview implementation. See SOURCE.md. */
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion, useMotionValue } from 'motion/react';
import './original.css';
import { splitBarCopy } from './split-bar-copy';
import { motionTokens, useReducedMotion } from './motion';
import type { CSSVariables } from './integration-types';
import type { SplitBarProps, SplitSegment } from './types';
import { FormattedNumber } from './FormattedNumber';
import { SegmentLayer } from './SegmentLayer';
import { layoutSegments, layoutOutsideLabels } from './geometry';
import { styles } from './styles';
export type { SplitBarProps, SplitSegment } from './types';
const palette = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--text-muted)',
  'var(--border-strong)',
];

export function SplitBarSurface({
  segments,
  title,
  description,
  format,
  unit,
  totalLabel = 'Total',
  hidden,
  defaultHidden = [],
  onHiddenChange,
  legend = true,
  locale = 'en-US',
  label,
  className,
  style,
}: SplitBarProps) {
  const copy = splitBarCopy(locale);
  const reduced = useReducedMotion(),
    id = useId();
  const [internalHidden, setInternalHidden] = useState(() => [
    ...defaultHidden,
  ]);
  const hiddenIds = hidden ?? internalHidden,
    hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const number = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: 0,
        ...format,
        numberingSystem: 'latn',
      }),
    [format, locale],
  );
  const percent = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
        numberingSystem: 'latn',
      }),
    [locale],
  );
  const barRef = useRef<HTMLDivElement>(null),
    probeRef = useRef<HTMLSpanElement>(null);
  const barWidth = useMotionValue(0);
  const [width, setWidth] = useState(0),
    [font, setFont] = useState('');
  const [fontVersion, setFontVersion] = useState(0);
  const [highlighted, setHighlighted] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  const [refused, setRefused] = useState<{ id: string; key: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const update = () => {
      barWidth.set(bar.clientWidth);
      setWidth(bar.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [barWidth]);
  useEffect(() => {
    let disposed = false;
    const update = () => {
      if (!disposed && probeRef.current)
        setFont(getComputedStyle(probeRef.current).font);
    };
    const refresh = () => {
      update();
      if (!disposed) setFontVersion((version) => version + 1);
    };
    update();
    void document.fonts.ready.then(refresh);
    document.fonts.addEventListener('loadingdone', refresh);
    return () => {
      disposed = true;
      document.fonts.removeEventListener('loadingdone', refresh);
    };
  }, []);
  const measure = useMemo(() => {
    const cache = new Map<string, number>();
    const canvas =
      typeof document !== 'undefined'
        ? document.createElement('canvas').getContext('2d')
        : null;
    if (canvas && font) canvas.font = font;
    return (text: string) => {
      const cached = cache.get(text);
      if (cached !== undefined) return cached;
      const value =
        canvas && font ? canvas.measureText(text).width : text.length * 7;
      cache.set(text, value);
      return value;
    };
  }, [font, fontVersion]);
  const color = (segment: SplitSegment, index: number) =>
    segment.color ?? palette[index % palette.length] ?? 'var(--text-muted)';
  const visible = segments.filter(
    (segment) => !hiddenSet.has(segment.id) && segment.value > 0,
  );
  const total = visible.reduce((sum, segment) => sum + segment.value, 0);
  const activeId =
    highlighted && visible.some((segment) => segment.id === highlighted)
      ? highlighted
      : null;
  const share = (segment: SplitSegment) =>
    total > 0 && !hiddenSet.has(segment.id)
      ? Math.max(0, segment.value) / total
      : 0;
  const shares = new Map(
    segments.map((segment) => [segment.id, share(segment)]),
  );
  const slices = layoutSegments(
    segments,
    shares,
    activeId,
    width,
    measure,
    percent,
  );
  const outside = layoutOutsideLabels(
    segments,
    slices,
    width,
    measure,
    percent,
  );
  // Reserve the largest label lane needed by the current data. Hover expansion
  // must not move the legend away from the pointer before its click arrives.
  const laneHeight = [null, ...visible.map(segment => segment.id)].some(candidate =>
    layoutOutsideLabels(segments, layoutSegments(segments, shares, candidate, width, measure, percent), width, measure, percent).length > 0,
  ) ? 40 : 0;
  const active = activeId
    ? segments.find((segment) => segment.id === activeId)
    : undefined;
  const titleLabel = label ?? title ?? copy.chart;
  const toggle = (segmentId: string) => {
    const segment = segments.find((segment) => segment.id === segmentId);
    if (!segment) return;
    if (!hiddenSet.has(segmentId) && visible.length <= 1) {
      setRefused((previous) => ({
        id: segmentId,
        key: (previous?.key ?? 0) + 1,
      }));
      setNotice(copy.keepLast(segment.label));
      return;
    }
    const next = hiddenSet.has(segmentId)
      ? hiddenIds.filter((id) => id !== segmentId)
      : [...hiddenIds, segmentId];
    if (hidden === undefined) setInternalHidden(next);
    onHiddenChange?.(next);
    setNotice(
      copy.visibility(segment.label, hiddenSet.has(segmentId)),
    );
  };
  const readout = (value: number, formatter = number) => (
    <FormattedNumber value={value} formatter={formatter} reduced={reduced} />
  );
  return (
    <figure
      className={[styles.figure, className].filter(Boolean).join(' ')}
      style={style}
      aria-labelledby={title ? id : undefined}
      aria-label={title ? undefined : titleLabel}
    >
      <span ref={probeRef} className={styles.probe} aria-hidden="true">
        0
      </span>
      <div className={styles.head}>
        {(title || description) && (
          <div className={styles.heading}>
            {title && (
              <p id={id} className={styles.title}>
                {title}
              </p>
            )}
            {description && <p className={styles.description}>{description}</p>}
          </div>
        )}
        <div className={styles.readout} aria-hidden="true">
          <AnimatePresence mode="popLayout" anchorX="right" initial={false}>
            <motion.div
              key={active?.id ?? 'total'}
              className={styles.readoutLine}
              initial={
                reduced
                  ? { opacity: 0 }
                  : {
                      opacity: 0,
                      y: 6,
                      filter: `blur(${motionTokens.blur.subtle}px)`,
                    }
              }
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={
                reduced
                  ? { opacity: 0 }
                  : {
                      opacity: 0,
                      y: -6,
                      filter: `blur(${motionTokens.blur.subtle}px)`,
                      transition: { duration: motionTokens.duration.fast },
                    }
              }
              transition={
                reduced
                  ? { duration: 0 }
                  : {
                      ...motionTokens.spring.snappy,
                      opacity: { duration: motionTokens.duration.fast },
                    }
              }
            >
              {active ? (
                <Fragment>
                  <span
                    className={styles.readoutSwatch}
                    style={
                      {
                        '--seg': color(active, segments.indexOf(active)),
                      } as CSSVariables
                    }
                  />
                  <span className={styles.readoutName}>{active.label}</span>
                  <span className={styles.readoutShare}>
                    {readout(share(active), percent)}
                  </span>
                  <span className={styles.readoutValue}>
                    {readout(active.value)}
                    {unit ? ` ${unit}` : ''}
                  </span>
                </Fragment>
              ) : (
                <Fragment>
                  <span className={styles.readoutName}>{totalLabel}</span>
                  <span className={styles.readoutShare}>{readout(total)}</span>
                  {unit && <span className={styles.readoutValue}>{unit}</span>}
                </Fragment>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div
        ref={barRef}
        className={styles.bar}
        data-active={activeId ? '' : undefined}
        tabIndex={0}
        role="group"
        aria-roledescription={copy.chart}
        aria-label={copy.group(titleLabel, visible.map(segment => `${segment.label} ${percent.format(share(segment))}`))}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect(),
            position = (event.clientX - bounds.left) / bounds.width;
          const slice = slices.find(
            (slice) =>
              slice.on && position >= slice.start && position < slice.end,
          );
          if (slice && slice.id !== highlighted) setHighlighted(slice.id);
        }}
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect(),
            position = (event.clientX - bounds.left) / bounds.width;
          const slice = slices.find(
            (slice) =>
              slice.on && position >= slice.start && position < slice.end,
          );
          if (slice) setHighlighted(slice.id);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setHighlighted(null);
        }}
        onBlur={() => setHighlighted(null)}
        onKeyDown={(event) => {
          const ids = visible.map((segment) => segment.id);
          if (!ids.length) return;
          const index = activeId ? ids.indexOf(activeId) : -1;
          const keys: Record<string, number> = {
            ArrowRight: index + 1,
            ArrowDown: index + 1,
            ArrowLeft: index <= 0 ? ids.length - 1 : index - 1,
            ArrowUp: index <= 0 ? ids.length - 1 : index - 1,
            Home: 0,
            End: ids.length - 1,
          };
          if (event.key === 'Escape') {
            setHighlighted(null);
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            if (activeId) {
              event.preventDefault();
              toggle(activeId);
            }
            return;
          }
          if (!(event.key in keys)) return;
          event.preventDefault();
          const next = ids[(keys[event.key] + ids.length) % ids.length];
          setHighlighted(next);
          const segment = segments.find((segment) => segment.id === next);
          if (segment)
            setNotice(
              `${segment.label}, ${percent.format(share(segment))}, ${number.format(segment.value)}${unit ? ` ${unit}` : ''}.`,
            );
        }}
      >
        {segments.map((segment, index) => (
          <SegmentLayer
            key={segment.id}
            slice={slices[index]}
            color={color(segment, index)}
            width={barWidth}
            active={activeId === segment.id}
            dimmed={!!activeId && activeId !== segment.id}
            label={segment.label}
            formatter={percent}
            reduced={reduced}
          />
        ))}
      </div>
      <motion.div
        className={styles.lane}
        initial={false}
        animate={{ height: laneHeight }}
        transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}
        aria-hidden="true"
      >
        <svg className={styles.leaders} width="100%" height={40}>
          <AnimatePresence initial={false}>
            {outside.map((label) => {
              const center = label.x + label.width / 2,
                path = `M${label.anchor.toFixed(1)} 0 C${label.anchor.toFixed(1)} 10 ${center.toFixed(1)} 6 ${center.toFixed(1)} 15`;
              return (
                <motion.path
                  key={label.id}
                  className={styles.leader}
                  data-dimmed={(activeId && activeId !== label.id) || undefined}
                  initial={{ opacity: 0, d: path }}
                  animate={{ opacity: 1, d: path }}
                  exit={{ opacity: 0 }}
                  transition={
                    reduced
                      ? { duration: 0 }
                      : {
                          d: motionTokens.spring.smooth,
                          opacity: { duration: motionTokens.duration.fast },
                        }
                  }
                />
              );
            })}
          </AnimatePresence>
        </svg>
        <AnimatePresence initial={false}>
          {outside.map((label) => (
            <motion.span
              key={label.id}
              className={styles.outside}
              data-dimmed={(activeId && activeId !== label.id) || undefined}
              initial={{ opacity: 0, x: label.x, y: -4 }}
              animate={{ opacity: 1, x: label.x, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={
                reduced
                  ? { duration: 0 }
                  : {
                      ...motionTokens.spring.smooth,
                      opacity: { duration: motionTokens.duration.fast },
                    }
              }
            >
              {label.name && (
                <span className={styles.outsideName}>{label.name}</span>
              )}
              {readout(
                slices.find((slice) => slice.id === label.id)?.share ?? 0,
                percent,
              )}
            </motion.span>
          ))}
        </AnimatePresence>
      </motion.div>
      {legend && (
        <ul className={styles.legend} aria-label={copy.legend(titleLabel)}>
          {segments.map((segment, index) => {
            const on = !hiddenSet.has(segment.id);
            return (
              <li key={segment.id}>
                <button
                  type="button"
                  className={styles.legendItem}
                  data-off={!on || undefined}
                  data-active={activeId === segment.id || undefined}
                  aria-pressed={on}
                  aria-label={`${segment.label}, ${on ? percent.format(share(segment)) : copy.hidden}`}
                  style={{ '--seg': color(segment, index) } as CSSVariables}
                  onClick={() => toggle(segment.id)}
                  onPointerEnter={(event) => {
                    if (event.pointerType === 'mouse' && on)
                      setHighlighted(segment.id);
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType === 'mouse') setHighlighted(null);
                  }}
                >
                  <motion.span
                    key={refused?.id === segment.id ? refused.key : 0}
                    className={styles.legendLabel}
                    initial={{ x: 0 }}
                    animate={
                      refused?.id !== segment.id || reduced
                        ? { x: 0 }
                        : { x: [0, -3, 3, -2, 0] }
                    }
                    transition={{
                      duration: 0.32,
                      ease: motionTokens.ease.standard,
                    }}
                  >
                    <span className={styles.swatch} aria-hidden="true" />
                    <span className={styles.legendName}>{segment.label}</span>
                  </motion.span>
                  <span className={styles.legendShare} aria-hidden="true">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {on ? (
                        <motion.span
                          key="on"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{
                            duration: reduced ? 0 : motionTokens.duration.fast,
                          }}
                        >
                          {readout(share(segment), percent)}
                        </motion.span>
                      ) : (
                        <motion.span
                          key="off"
                          className={styles.legendOff}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{
                            duration: reduced ? 0 : motionTokens.duration.fast,
                          }}
                        >
                          {copy.off}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p
        className={styles.srOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {notice}
      </p>
    </figure>
  );
}
export function SplitBar(props: SplitBarProps) {
  return (
    <div className="rental-split-bar">
      <SplitBarSurface {...props} />
    </div>
  );
}
export default SplitBar;
