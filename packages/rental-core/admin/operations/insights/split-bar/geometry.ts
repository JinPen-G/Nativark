import type { SplitSegment } from './types';

export interface SegmentSlice {
  id: string;
  start: number;
  end: number;
  share: number;
  on: boolean;
  mode: 'full' | 'short' | 'outside' | 'none';
}
export interface OutsideLabel {
  id: string;
  name: string;
  anchor: number;
  width: number;
  x: number;
}
export function layoutSegments(
  segments: readonly SplitSegment[],
  shares: ReadonlyMap<string, number>,
  active: string | null,
  width: number,
  measure: (text: string) => number,
  percent: Intl.NumberFormat,
): SegmentSlice[] {
  const expanded = new Map(shares);
  if (active && width > 0) {
    const share = expanded.get(active) ?? 0;
    const segment = segments.find((segment) => segment.id === active);
    const required = segment
      ? (measure(`${segment.label} ${percent.format(share)}`) + 30) / width
      : 0;
    const growth = Math.min(
      Math.max(share + 0.045, Math.min(required, 0.42)),
      0.9,
    );
    if (growth > share && share < 1) {
      const scale = (1 - growth) / (1 - share);
      for (const [id, value] of expanded)
        expanded.set(id, id === active ? growth : value * scale);
    }
  }
  let cursor = 0;
  return segments.map((segment) => {
    const share = shares.get(segment.id) ?? 0;
    const start = cursor;
    cursor += expanded.get(segment.id) ?? 0;
    const end = Math.min(1, cursor),
      pixels = (end - start) * width;
    const on = end > start;
    const fullWidth = measure(`${segment.label} ${percent.format(share)}`) + 30;
    const shortWidth = measure(percent.format(share)) + 26;
    return {
      id: segment.id,
      start,
      end,
      share,
      on,
      mode: on
        ? pixels >= fullWidth
          ? 'full'
          : pixels >= shortWidth
            ? 'short'
            : 'outside'
        : 'none',
    };
  });
}
export function layoutOutsideLabels(
  segments: readonly SplitSegment[],
  slices: readonly SegmentSlice[],
  width: number,
  measure: (text: string) => number,
  percent: Intl.NumberFormat,
): OutsideLabel[] {
  const labels = (names: boolean): OutsideLabel[] =>
    slices
      .filter((slice) => slice.mode === 'outside')
      .map((slice) => {
        const name = names
          ? (segments.find((segment) => segment.id === slice.id)?.label ?? '')
          : '';
        const share = percent.format(slice.share);
        return {
          id: slice.id,
          name,
          anchor: ((slice.start + slice.end) / 2) * width,
          width: measure(name ? `${name} ${share}` : share) + 6,
          x: 0,
        };
      });
  let result = labels(true);
  if (
    result.reduce(
      (total, label, index) => total + label.width + (index ? 12 : 0),
      0,
    ) > width
  )
    result = labels(false);
  result.forEach((label, index) => {
    const previous = result[index - 1];
    label.x = Math.max(
      previous ? previous.x + previous.width + 12 : 0,
      label.anchor - label.width / 2,
    );
  });
  for (let index = result.length - 1; index >= 0; index--) {
    const label = result[index],
      next = result[index + 1],
      right = next ? next.x - 12 : width;
    if (label.x + label.width > right)
      label.x = Math.max(0, right - label.width);
  }
  return result;
}
