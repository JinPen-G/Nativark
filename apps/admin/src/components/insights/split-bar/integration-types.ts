import type { CSSProperties } from 'react';
import type { MotionStyle, MotionValue } from 'motion/react';
export type CSSVariables = CSSProperties & {
  [name: `--${string}`]: string | number | undefined;
};
export type MotionVariables = MotionStyle & {
  [name: `--${string}`]:
    | string
    | number
    | MotionValue<string>
    | MotionValue<number>;
};
