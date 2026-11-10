'use client';

import { motion, type Variants } from 'motion/react';
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from '@animate-ui/react/icons';

type TicketPercentProps = IconProps<keyof typeof animations>;
const animations = {
  default: {
    ticket: {},
    dotTop: { initial: { pathLength: 1 }, animate: { pathLength: [0.1, 1], transition: { duration: 0.5, ease: 'easeOut' } } },
    slash: { initial: { pathLength: 1 }, animate: { pathLength: [0.1, 1], transition: { duration: 0.5, ease: 'easeOut' } } },
    dotBottom: { initial: { pathLength: 1 }, animate: { pathLength: [0.1, 1], transition: { duration: 0.5, ease: 'easeOut' } } },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: TicketPercentProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);
  return <motion.svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <motion.path d={"M2 9a3 3 0 1 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 1 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"} variants={variants.ticket} initial="initial" animate={controls} />
      <motion.path d={"M9 9h.01"} variants={variants.dotTop} initial="initial" animate={controls} />
      <motion.path d={"m15 9-6 6"} variants={variants.slash} initial="initial" animate={controls} />
      <motion.path d={"M15 15h.01"} variants={variants.dotBottom} initial="initial" animate={controls} />
  </motion.svg>;
}
function TicketPercent(props: TicketPercentProps) { return <IconWrapper icon={IconComponent} {...props} />; }
export { animations, TicketPercent, type TicketPercentProps };
