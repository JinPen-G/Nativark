'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type TruckProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    cargo: { initial: { y: 0 }, animate: { y: [0, -0.5, 0, -0.2, 0], transition: { duration: 0.6, ease: 'easeInOut' } } },
    chassis: { initial: { y: 0 }, animate: { y: [0, -0.5, 0, -0.2, 0], transition: { duration: 0.6, ease: 'easeInOut' } } },
    cab: { initial: { y: 0 }, animate: { y: [0, -0.5, 0, -0.2, 0], transition: { duration: 0.6, ease: 'easeInOut' } } },
    frontWheel: {},
    rearWheel: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: TruckProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"} variants={variants.cargo} initial="initial" animate={controls} />
      <motion.path d={"M15 18H9"} variants={variants.chassis} initial="initial" animate={controls} />
      <motion.path d={"M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"} variants={variants.cab} initial="initial" animate={controls} />
      <motion.circle cx={"17"} cy={"18"} r={"2"} variants={variants.frontWheel} initial="initial" animate={controls} />
      <motion.circle cx={"7"} cy={"18"} r={"2"} variants={variants.rearWheel} initial="initial" animate={controls} />
  </motion.svg>;
}
function Truck(props: TruckProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, Truck, type TruckProps };
