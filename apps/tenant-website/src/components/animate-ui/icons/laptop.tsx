'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type LaptopProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    screen: { initial: { opacity: 1 }, animate: { opacity: [1, 0.45, 1], transition: { duration: 0.5, ease: 'easeInOut' } } },
    hinge: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: LaptopProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"} variants={variants.screen} initial="initial" animate={controls} />
      <motion.path d={"M20.054 15.987H3.946"} variants={variants.hinge} initial="initial" animate={controls} />
  </motion.svg>;
}
function Laptop(props: LaptopProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, Laptop, type LaptopProps };
