/** Typed adapters of the archived Pro toggle and group-presence controls; source and motion provenance live in roles-source/SOURCE.md. */
import type { CSSProperties, ButtonHTMLAttributes, ReactNode } from "react";
import { AnimatePresence, motion, useAnimate, useIsPresent } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import classes from "./roles-source/classes.json";

export function PermissionToggle({ state, label, locked, disabled, dirty, delay = 0, onToggle, ...navigation }: {
  state: "on" | "off" | "mixed"; label: string; locked?: boolean; disabled?: boolean; dirty?: boolean; delay?: number; onToggle: () => void;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "aria-label" | "disabled">) {
  const reduced = usePrefersReducedMotion();
  const [box, animate] = useAnimate();
  const wait = reduced ? 0 : delay;
  const markTransition = reduced ? { duration: 0 } : {
    pathLength: { duration: motionTokens.duration.fast, ease: motionTokens.ease.enter, delay: wait },
    opacity: { duration: motionTokens.duration.instant, delay: wait },
  };
  // The source's locked-owner style implies a grant. A temporarily disabled
  // peer role must keep its actual checked, unchecked or mixed appearance.
  return <button {...navigation} type="button" role={navigation.role ?? "switch"} aria-checked={state === "mixed" ? "mixed" : state === "on"}
    aria-label={label} aria-disabled={locked || disabled || undefined} className={classes.toggle} data-state={state}
    data-locked={locked || undefined} data-disabled={!locked && disabled || undefined}
    style={{ "--delay": `${wait}s` } as CSSProperties} onClick={() => {
      if (locked || disabled) {
        if (locked && !reduced && box.current) void animate(box.current, { x: [0, 3, -2, 1, 0] }, { duration: .34, ease: "easeOut" });
        return;
      }
      onToggle();
    }}>
    <span ref={box} className={classes.box}><svg className={classes.mark} viewBox="0 0 16 16" aria-hidden="true">
      <motion.path d="M4.25 8.4 6.9 10.9 11.75 5.4" initial={false} animate={{ pathLength: Number(state === "on"), opacity: Number(state === "on") }} transition={markTransition} />
      <motion.path d="M5 8h6" initial={false} animate={{ pathLength: Number(state === "mixed"), opacity: Number(state === "mixed") }} transition={markTransition} />
    </svg></span>
    <AnimatePresence initial={false}>{dirty && <motion.span className={classes.dirty} aria-hidden="true"
      initial={{ opacity: 0, scale: .3 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .3 }}
      transition={reduced ? { duration: 0 } : { ...motionTokens.spring.snappy, delay: wait }} />}</AnimatePresence>
  </button>;
}

export function PermissionGroupRows({ id, children }: { id: string; children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const present = useIsPresent();
  return <motion.div id={id} role="rowgroup" className={classes.groupBody} inert={!present} aria-hidden={!present || undefined}
    initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
    transition={reduced ? { duration: 0 } : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard, ease: motionTokens.ease.standard } }}>
    {children}
  </motion.div>;
}
