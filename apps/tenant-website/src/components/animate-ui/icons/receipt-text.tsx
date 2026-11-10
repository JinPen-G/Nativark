'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type ReceiptTextProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    rowBottom: { initial: { pathLength: 1 }, animate: { pathLength: [0.1, 1], transition: { duration: 0.5, ease: 'easeOut' } } },
    rowTop: { initial: { pathLength: 1 }, animate: { pathLength: [0.1, 1], transition: { duration: 0.5, ease: 'easeOut' } } },
    rowMiddle: { initial: { pathLength: 1 }, animate: { pathLength: [0.1, 1], transition: { duration: 0.5, ease: 'easeOut' } } },
    paper: {},
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: ReceiptTextProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"M13 16H8"} variants={variants.rowBottom} initial="initial" animate={controls} />
      <motion.path d={"M14 8H8"} variants={variants.rowTop} initial="initial" animate={controls} />
      <motion.path d={"M16 12H8"} variants={variants.rowMiddle} initial="initial" animate={controls} />
      <motion.path d={"M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"} variants={variants.paper} initial="initial" animate={controls} />
  </motion.svg>;
}
function ReceiptText(props: ReceiptTextProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, ReceiptText, type ReceiptTextProps };
