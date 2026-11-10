'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type CarFrontProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    roof: {},
    lightLeft: {},
    lightRight: {},
    body: { initial: { y: 0 }, animate: { y: [0, -0.5, 0], transition: { duration: 0.45, ease: 'easeInOut' } } },
    wheelLeft: {},
    wheelRight: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: CarFrontProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"} variants={variants.roof} initial="initial" animate={controls} />
      <motion.path d={"M7 14h.01"} variants={variants.lightLeft} initial="initial" animate={controls} />
      <motion.path d={"M17 14h.01"} variants={variants.lightRight} initial="initial" animate={controls} />
      <motion.rect width={"18"} height={"8"} x={"3"} y={"10"} rx={"2"} variants={variants.body} initial="initial" animate={controls} />
      <motion.path d={"M5 18v2"} variants={variants.wheelLeft} initial="initial" animate={controls} />
      <motion.path d={"M19 18v2"} variants={variants.wheelRight} initial="initial" animate={controls} />
  </motion.svg>;
}
function CarFront(props: CarFrontProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, CarFront, type CarFrontProps };
