'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type TentProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    poleLeft: { initial: { rotate: 0 }, animate: { rotate: [0, 1.5, -1, 0], transformOrigin: 'bottom center', transition: { duration: 0.65, ease: 'easeInOut' } } },
    poleRight: { initial: { rotate: 0 }, animate: { rotate: [0, 1.5, -1, 0], transformOrigin: 'bottom center', transition: { duration: 0.65, ease: 'easeInOut' } } },
    opening: {},
    ground: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: TentProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"M3.5 21 14 3"} variants={variants.poleLeft} initial="initial" animate={controls} />
      <motion.path d={"M20.5 21 10 3"} variants={variants.poleRight} initial="initial" animate={controls} />
      <motion.path d={"M15.5 21 12 15l-3.5 6"} variants={variants.opening} initial="initial" animate={controls} />
      <motion.path d={"M2 21h20"} variants={variants.ground} initial="initial" animate={controls} />
  </motion.svg>;
}
function Tent(props: TentProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, Tent, type TentProps };
