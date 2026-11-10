'use client';

import { motion } from 'motion/react';
import { useShouldReduceMotion } from '@animate-ui/react/utils/motion';

export function MenuToggleIcon({ open }: { open: boolean }) {
  const reduceMotion = useShouldReduceMotion();
  const transition = { type: 'spring' as const, stiffness: 200, damping: 20 };
  const top = open ? { x1: 6, y1: 6, x2: 18, y2: 18 } : { x1: 4, y1: 6, x2: 20, y2: 6 };
  const bottom = open ? { x1: 6, y1: 18, x2: 18, y2: 6 } : { x1: 4, y1: 18, x2: 20, y2: 18 };
  return <span className="site-icon menu-toggle-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" focusable="false">
      {reduceMotion ? <>
        <line {...top} /><line x1={4} y1={12} x2={20} y2={12} opacity={open ? 0 : 1} /><line {...bottom} />
      </> : <>
        <motion.line initial={false} animate={top} transition={transition} />
        <motion.line x1={4} y1={12} x2={20} y2={12} initial={false} animate={{ opacity: open ? 0 : 1 }} transition={{ duration: 0.12 }} />
        <motion.line initial={false} animate={bottom} transition={transition} />
      </>}
    </svg>
  </span>;
}
