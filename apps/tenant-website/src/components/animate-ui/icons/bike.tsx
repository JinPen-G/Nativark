'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type BikeProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    frontWheel: { initial: { pathLength: 1 }, animate: { pathLength: [0.35, 1], transition: { duration: 0.6, ease: 'easeInOut' } } },
    rearWheel: { initial: { pathLength: 1 }, animate: { pathLength: [0.35, 1], transition: { duration: 0.6, ease: 'easeInOut' } } },
    riderHead: {},
    rider: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: BikeProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.circle cx={"18.5"} cy={"17.5"} r={"3.5"} variants={variants.frontWheel} initial="initial" animate={controls} />
      <motion.circle cx={"5.5"} cy={"17.5"} r={"3.5"} variants={variants.rearWheel} initial="initial" animate={controls} />
      <motion.circle cx={"15"} cy={"5"} r={"1"} variants={variants.riderHead} initial="initial" animate={controls} />
      <motion.path d={"M12 17.5V14l-3-3 4-3 2 3h2"} variants={variants.rider} initial="initial" animate={controls} />
  </motion.svg>;
}
function Bike(props: BikeProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, Bike, type BikeProps };
