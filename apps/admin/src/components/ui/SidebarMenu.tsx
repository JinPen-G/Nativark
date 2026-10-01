import { Menu, type MenuProps } from "antd";
import { LayoutGroup, motion } from "motion/react";
import { useId, useSyncExternalStore } from "react";
import { motionTokens } from "@/lib/motion-tokens";

const reducedQuery = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(notify: () => void) {
  const media = window.matchMedia(reducedQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
const readReducedMotion = () => window.matchMedia(reducedQuery).matches;

/** UIArc library-sidebar: shared layout pill + spring.morph.
 * Keep Ant's route/keyboard/submenu engine, including collapsed popup menus.
 * Each sidebar owns a layout group so drawer/desktop highlights cannot cross.
 */
export function SidebarMenu(props: MenuProps) {
  const id = useId();
  const reduce = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const decorate = (items: MenuProps["items"]): MenuProps["items"] => items?.map(item => {
    if (!item || item.type === "divider") return item;
    if ("children" in item) return { ...item, children: decorate(item.children) ?? [] };
    const active = !props.inlineCollapsed && props.selectedKeys?.includes(String(item.key));
    return {
      ...item,
      label: <>
        {active && <motion.span aria-hidden="true" className="arc-sidebar-pill"
          layoutId="sidebar-active-pill"
          transition={reduce ? { duration: 0 } : motionTokens.spring.morph} />}
        <span className="arc-sidebar-label">{item.label}</span>
      </>
    };
  });
  return <LayoutGroup id={id}>
    <Menu {...props} className={["arc-sidebar-menu", props.className].filter(Boolean).join(" ")}
      items={decorate(props.items)} />
  </LayoutGroup>;
}
