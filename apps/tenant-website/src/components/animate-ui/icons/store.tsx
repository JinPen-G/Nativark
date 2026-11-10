'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type StoreProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    door: {},
    awning: { initial: { y: 0 }, animate: { y: [0, -0.7, 0], transition: { duration: 0.45, ease: 'easeInOut' } } },
    building: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: StoreProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"} variants={variants.door} initial="initial" animate={controls} />
      <motion.path d={"M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"} variants={variants.awning} initial="initial" animate={controls} />
      <motion.path d={"M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"} variants={variants.building} initial="initial" animate={controls} />
  </motion.svg>;
}
function Store(props: StoreProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, Store, type StoreProps };
