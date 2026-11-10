'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type BabyProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    smile: { initial: { y: 0 }, animate: { y: [0, 0.5, 0], transition: { duration: 0.5, ease: 'easeInOut' } } },
    eyeRight: {},
    head: {},
    eyeLeft: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: BabyProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"} variants={variants.smile} initial="initial" animate={controls} />
      <motion.path d={"M15 12h.01"} variants={variants.eyeRight} initial="initial" animate={controls} />
      <motion.path d={"M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"} variants={variants.head} initial="initial" animate={controls} />
      <motion.path d={"M9 12h.01"} variants={variants.eyeLeft} initial="initial" animate={controls} />
  </motion.svg>;
}
function Baby(props: BabyProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, Baby, type BabyProps };
