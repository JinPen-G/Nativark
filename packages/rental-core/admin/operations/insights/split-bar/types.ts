import type { CSSProperties } from 'react';
export interface SplitSegment {
  id: string;
  label: string;
  value: number;
  color?: string;
}
export interface SplitBarProps {
  segments: readonly SplitSegment[];
  title?: string;
  description?: string;
  format?: Intl.NumberFormatOptions;
  unit?: string;
  totalLabel?: string;
  hidden?: readonly string[];
  defaultHidden?: readonly string[];
  onHiddenChange?: (hidden: string[]) => void;
  legend?: boolean;
  locale?: string;
  label?: string;
  className?: string;
  style?: CSSProperties;
}
