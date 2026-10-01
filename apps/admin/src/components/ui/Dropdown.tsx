import { Dropdown as AntDropdown, type DropdownProps } from "antd";
import * as Primitive from "@radix-ui/react-dropdown-menu";
import { Fragment, isValidElement, useEffect, useRef, useState, type CSSProperties, type FocusEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "@/registry/components/dropdown-menu/dropdown-menu.module.css";

/** Arc's menu styles and highlight motion, with the platform's existing trigger and action keys. */
export function Dropdown(props: DropdownProps) {
  const reduced = useReducedMotion();
  const [highlight, setHighlight] = useState<{ top: number; height: number; danger: boolean; glide: boolean } | null>(null);
  const pointer = useRef(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const menu = props.menu;
  if (!isValidElement(props.children) || !menu?.items || props.popupRender || props.dropdownRender || props.trigger?.some(trigger => trigger !== "click") || menu.items.some(item => item && ("children" in item || item.type === "group"))) return <AntDropdown {...props} />;
  const focus = (event: FocusEvent<HTMLDivElement>) => {
    const item = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="menuitem"]') : null;
    window.clearTimeout(timer.current);
    if (!item) { timer.current = window.setTimeout(() => setHighlight(null), pointer.current ? 70 : 0); return; }
    setHighlight(current => ({ top: item.offsetTop, height: item.offsetHeight, danger: item.dataset.tone === "danger", glide: pointer.current && current !== null }));
  };
  const placement = props.placement ?? "bottomLeft";
  return <Primitive.Root open={props.open} onOpenChange={open => { if (open) { window.clearTimeout(timer.current); setHighlight(null); } props.onOpenChange?.(open, { source: "trigger" }); }}>
    <Primitive.Trigger asChild disabled={props.disabled}>{props.children}</Primitive.Trigger>
    <Primitive.Portal><Primitive.Content className={styles.menu} style={{ zIndex: 1200 }} side={placement.startsWith("top") ? "top" : "bottom"} align={placement.endsWith("Right") ? "end" : "start"} sideOffset={6} collisionPadding={12} loop onFocus={focus} onPointerMoveCapture={() => { pointer.current = true; }} onKeyDownCapture={() => { pointer.current = false; }}>
      <motion.span className={styles.highlight} data-tone={highlight?.danger ? "danger" : undefined} aria-hidden="true" initial={false} animate={highlight ? { y: highlight.top, height: highlight.height, opacity: 1 } : { opacity: 0 }} transition={{ default: highlight?.glide && !reduced ? motionTokens.spring.snappy : { duration: 0 }, opacity: { duration: reduced ? 0 : .08 } }} />
      {menu.items.map((item, index) => {
        if (!item) return null;
        if (item.type === "divider") return <Primitive.Separator key={item.key ?? index} className={styles.separator} />;
        if (!("label" in item) || "children" in item || item.type === "group") return null;
        const key = String(item.key ?? index);
        return <Fragment key={key}><Primitive.Item className={[styles.item, item.danger ? styles.destructive : ""].join(" ")} data-tone={item.danger ? "danger" : undefined} data-selected={menu.selectedKeys?.includes(key) || undefined} style={{ "--i": index } as CSSProperties} disabled={item.disabled}
          onSelect={event => { const info = { key, keyPath: [key], domEvent: event } as unknown as Parameters<NonNullable<typeof menu.onClick>>[0]; item.onClick?.(info); menu.onClick?.(info); }}>
          {item.icon && <span className={styles.icon} aria-hidden="true">{item.icon}</span>}{item.label}
        </Primitive.Item></Fragment>;
      })}
    </Primitive.Content></Primitive.Portal>
  </Primitive.Root>;
}
