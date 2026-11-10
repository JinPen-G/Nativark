'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type MapPinnedProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    pinOutline: {},
    mapBase: {},
    pinCenter: { initial: { scale: 1 }, animate: { scale: [1, 0.7, 1], transition: { duration: 0.45, ease: 'easeInOut' } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: MapPinnedProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 01-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0112 0"} variants={variants.pinOutline} initial="initial" animate={controls} />
      <motion.path d={"M4.474 15h-.197a1 1 0 00-.969.753l-1.097 4.35a1.5 1.5 0 001.444 1.898L20.344 22a1.5 1.5 0 001.446-1.897l-1.098-4.35a1 1 0 00-.969-.753h-.197"} variants={variants.mapBase} initial="initial" animate={controls} />
      <motion.circle cx={"12"} cy={"8"} r={"2"} variants={variants.pinCenter} initial="initial" animate={controls} />
  </motion.svg>;
}
function MapPinned(props: MapPinnedProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, MapPinned, type MapPinnedProps };
