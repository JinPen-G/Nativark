'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type HeadsetProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    headband: {},
    microphone: { initial: { rotate: 0 }, animate: { rotate: [0, -8, 0], transformOrigin: 'top center', transition: { duration: 0.5, ease: 'easeInOut' } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: HeadsetProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"} variants={variants.headband} initial="initial" animate={controls} />
      <motion.path d={"M21 16v2a4 4 0 0 1-4 4h-5"} variants={variants.microphone} initial="initial" animate={controls} />
  </motion.svg>;
}
function Headset(props: HeadsetProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, Headset, type HeadsetProps };
