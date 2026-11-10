'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type ArmchairProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    back: { initial: { scaleY: 1 }, animate: { scaleY: [1, 0.96, 1], transformOrigin: 'bottom center', transition: { duration: 0.5, ease: 'easeInOut' } } },
    seat: {},
    legLeft: {},
    legRight: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: ArmchairProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"} variants={variants.back} initial="initial" animate={controls} />
      <motion.path d={"M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"} variants={variants.seat} initial="initial" animate={controls} />
      <motion.path d={"M5 18v2"} variants={variants.legLeft} initial="initial" animate={controls} />
      <motion.path d={"M19 18v2"} variants={variants.legRight} initial="initial" animate={controls} />
  </motion.svg>;
}
function Armchair(props: ArmchairProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, Armchair, type ArmchairProps };
