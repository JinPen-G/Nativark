// UIArc MIT integration: multiple/controlled business panels and header actions; source motion/CSS unchanged.
"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { TargetAndTransition, Variants } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "@/registry/components/accordion/accordion.module.css";

export interface AccordionItem { key: string; title: ReactNode; extra?: ReactNode; content: ReactNode; }
export interface AccordionProps {
  items: AccordionItem[];
  defaultOpen?: number;
  value?: string[];
  onValueChange?: (value: string[]) => void;
  /** "lg" suits page-level FAQs: questions at the large text size, answers at body size. */
  size?: "md" | "lg";
}

/** Height follows the content on a spring that never overshoots; closed panels leave the accessibility tree once they finish collapsing. */
const panelOpen: TargetAndTransition = { height: "auto", opacity: 1, visibility: "visible" };
const panelClosed: TargetAndTransition = { height: 0, opacity: 0, transitionEnd: { visibility: "hidden" } };
/** The answer settles down into place with a brief focus pull as the panel opens. */
const contentOpen: TargetAndTransition = { y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } };
const contentClosed: TargetAndTransition = { y: -6, filter: `blur(${motionTokens.blur.subtle}px)` };
const panelMotion: Variants = {
  open: { ...panelOpen, transition: { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } } },
  closed: { ...panelClosed, transition: { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } } },
};
const contentMotion: Variants = {
  open: { ...contentOpen, transition: { y: motionTokens.spring.smooth, filter: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } } },
  closed: { ...contentClosed, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } },
};
/** Reduced motion: same end states in one step, so server and client render identical styles. */
const panelStill: Variants = { open: { ...panelOpen, transition: { duration: 0 } }, closed: { ...panelClosed, transition: { duration: 0 } } };
const contentStill: Variants = { open: { ...contentOpen, transition: { duration: 0 } }, closed: { ...contentClosed, transition: { duration: 0 } } };

export function Accordion({ items, defaultOpen = -1, size = "md", value, onValueChange }: AccordionProps) {
  const initialValue = defaultOpen >= 0 && defaultOpen < items.length ? items[defaultOpen].key : "";
  const [openValue, setOpenValue] = useState<string[]>(initialValue ? [initialValue] : []);
  const reduced = useReducedMotion();
  return <AccordionPrimitive.Root className={[styles.accordion, size === "lg" ? styles.lg : ""].filter(Boolean).join(" ")} type="multiple" value={value ?? openValue} onValueChange={next => { setOpenValue(next); onValueChange?.(next); }}>
    {items.map((item, index) => { const open = (value ?? openValue).includes(item.key); return <AccordionPrimitive.Item className={styles.item} value={item.key} key={item.key}>
      <AccordionPrimitive.Header className={`${styles.header} arc-collapse-header`}>
        <AccordionPrimitive.Trigger className={styles.trigger}>
          <span>{item.title}</span><motion.span className={styles.icon} initial={false} animate={{ rotate: open ? 180 : 0 }} transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}><ChevronDown width={17} height={17} aria-hidden="true" /></motion.span>
        </AccordionPrimitive.Trigger>{item.extra && <span className="arc-collapse-extra">{item.extra}</span>}
      </AccordionPrimitive.Header>
      {/* Radix keeps semantics and ids; motion owns the height so a toggle mid-flight retargets instead of restarting. */}
      <AccordionPrimitive.Content forceMount asChild>
        <motion.div className={styles.panel} initial={false} animate={open ? "open" : "closed"} variants={reduced ? panelStill : panelMotion}>
          <motion.div className={styles.panelInner} variants={reduced ? contentStill : contentMotion}>{item.content}</motion.div>
        </motion.div>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>; })}
  </AccordionPrimitive.Root>;
}

export default Accordion;
