'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type PackageOpenProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    crease: {},
    flapLeft: { initial: { y: 0 }, animate: { y: [0, -0.7, 0], transition: { duration: 0.5, ease: 'easeInOut' } } },
    box: {},
    flapRight: { initial: { y: 0 }, animate: { y: [0, -0.7, 0], transition: { duration: 0.5, ease: 'easeInOut' } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: PackageOpenProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"M12 22v-9"} variants={variants.crease} initial="initial" animate={controls} />
      <motion.path d={"M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.655 1.655 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z"} variants={variants.flapLeft} initial="initial" animate={controls} />
      <motion.path d={"M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13"} variants={variants.box} initial="initial" animate={controls} />
      <motion.path d={"M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.636 1.636 0 0 0 1.63 0z"} variants={variants.flapRight} initial="initial" animate={controls} />
  </motion.svg>;
}
function PackageOpen(props: PackageOpenProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, PackageOpen, type PackageOpenProps };
