import { Tabs as AntTabs, type TabsProps } from "antd";
import { useEffect, useId, useLayoutEffect, useState } from "react";
import { Tabs as ArcTabs, TabsList, TabsTrigger, TabsContent } from "@/registry/components/tabs/tabs";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { useLocale } from "@/app/locale";

export function Tabs(props: TabsProps) {
  const { t, locale } = useLocale();
  const listId = useId();
  const { items: originalItems = [], activeKey, defaultActiveKey, onChange, className, style, destroyOnHidden } = props;
  // Content tabs use text labels consistently; icon-only view switches remain Segmented.
  const items = originalItems.map(({ icon: _icon, ...item }) => item);
  const [internal, setInternal] = useState(defaultActiveKey ?? items.find(item => !item.disabled)?.key ?? "");
  const selected = activeKey ?? (items.some(item => item.key === internal && !item.disabled) ? internal : items.find(item => !item.disabled)?.key ?? "");
  const [visited, setVisited] = useState<Set<string>>(() => new Set([selected]));
  const hasPanels = items.some(item => item.children != null);
  const classes = ["rental-tabs", !hasPanels && "rental-tabs-navigation", className].filter(Boolean).join(" ");
  const compatible = !(props.type === "editable-card" || props.tabPlacement && props.tabPlacement !== "top" || props.tabPosition && props.tabPosition !== "top" || props.renderTabBar || props.tabBarExtraContent || props.onTabClick);
  useEffect(() => { setVisited(previous => previous.has(selected) ? previous : new Set([...previous, selected])); }, [selected]);
  useLayoutEffect(() => {
    if (!compatible) return;
    const list = document.getElementById(listId);
    const viewport = list?.parentElement;
    const shell = viewport?.parentElement;
    if (!list || !viewport || !shell?.hasAttribute("data-overflow")) return;
    let frame = 0;
    const reveal = () => {
      if (!viewport.clientWidth) return;
      const controls = Array.from(shell.children).filter((child): child is HTMLButtonElement => child instanceof HTMLButtonElement);
      controls[0]?.setAttribute("aria-label", t("向左查看页签"));
      controls[1]?.setAttribute("aria-label", t("向右查看页签"));
      const active = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!active) return;
      const bounds = viewport.getBoundingClientRect(), item = active.getBoundingClientRect();
      const inset = parseFloat(getComputedStyle(list).paddingInlineStart) || 0;
      let left = bounds.left + inset, right = bounds.right - inset;
      if (controls[0] && !controls[0].disabled) left = Math.max(left, controls[0].getBoundingClientRect().right + 1);
      if (controls[1] && !controls[1].disabled) right = Math.min(right, controls[1].getBoundingClientRect().left - 1);
      const delta = item.left < left || item.width > right - left ? item.left - left : item.right > right ? item.right - right : 0;
      // Native Tabs owns selection/focus motion. Resize only the tab strip, never the page or form.
      if (Math.abs(delta) > 1) viewport.scrollBy({ left: delta, behavior: "instant" });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reveal); };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport); observer.observe(list);
    schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [compatible, listId, locale, t]);
  // Editable, vertical and custom tab bars keep their existing behavior until Arc provides matching capabilities.
  if (!compatible) return <AntTabs {...props} items={items} className={classes} />;
  const change = (key: string) => { setInternal(key); setVisited(previous => new Set([...previous, key])); onChange?.(key); };
  return <ArcTabs value={selected} onValueChange={change} className={classes} style={style}>
    <TabsList id={listId} aria-label={props["aria-label"] ?? "Tabs"}>{items.map(item => <TabsTrigger key={item.key} value={item.key} disabled={item.disabled}>{item.label}</TabsTrigger>)}</TabsList>
    {items.map(item => {
      if (item.children == null) return null;
      const destroy = item.destroyOnHidden ?? destroyOnHidden ?? false;
      if (destroy) return <TabsContent key={item.key} value={item.key}>{item.children}</TabsContent>;
      if (item.key !== selected && !visited.has(item.key) && !item.forceRender) return null;
      // Explicit retention keeps a visited form alive without loading unseen tabs.
      // forceRender also mounts unseen content, matching its existing Ant contract.
      if (item.forceRender || item.destroyOnHidden === false || destroyOnHidden === false) return <TabsContent key={item.key} value={item.key} forceMount hidden={item.key !== selected}>
        <ContentTransition value={item.key === selected ? "active" : "inactive"}>{item.children}</ContentTransition>
      </TabsContent>;
      // Ordinary read views retain the original directional presence animation.
      return <TabsContent key={item.key} value={item.key}>{item.children}</TabsContent>;
    })}
  </ArcTabs>;
}
