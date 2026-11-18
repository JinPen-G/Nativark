import type { ComponentType } from 'react';
export const AnimatedCounter: ComponentType<{
  value: number;
  label?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  animateOnView?: boolean;
  locale?: string;
}>;
