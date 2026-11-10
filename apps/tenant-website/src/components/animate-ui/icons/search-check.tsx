'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type SearchCheckProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    check: { initial: { pathLength: 1 }, animate: { pathLength: [0.1, 1], transition: { duration: 0.4, ease: 'easeOut' } } },
    lens: {},
    handle: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: SearchCheckProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"m8 11 2 2 4-4"} variants={variants.check} initial="initial" animate={controls} />
      <motion.circle cx={"11"} cy={"11"} r={"8"} variants={variants.lens} initial="initial" animate={controls} />
      <motion.path d={"m21 21-4.3-4.3"} variants={variants.handle} initial="initial" animate={controls} />
  </motion.svg>;
}
function SearchCheck(props: SearchCheckProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, SearchCheck, type SearchCheckProps };
