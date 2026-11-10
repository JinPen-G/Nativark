import type { CSSProperties, ReactNode } from "react";
export interface HoloCardProps {
  front: ReactNode;
  back?: ReactNode;
  flipped?: boolean;
  defaultFlipped?: boolean;
  onFlippedChange?: (flipped: boolean) => void;
  maxTilt?: number;
  intensity?: number;
  gyroscope?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
}
export function HoloCard(props: HoloCardProps): ReactNode;
