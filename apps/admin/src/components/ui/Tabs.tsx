import { Tabs as AntTabs, type TabsProps } from "antd";
import { useEffect, useState } from "react";
import { Tabs as ArcTabs, TabsList, TabsTrigger, TabsContent } from "@/registry/components/tabs/tabs";
import { ContentTransition } from "@/components/workspace/ContentTransition";

export function Tabs(props: TabsProps) {
  const { items: originalItems = [], activeKey, defaultActiveKey, onChange, className, style, destroyOnHidden } = props;
  // Content tabs use text labels consistently; icon-only view switches remain Segmented.
  const items = originalItems.map(({ icon: _icon, ...item }) => item);
  const [internal, setInternal] = useState(defaultActiveKey ?? items.find(item => !item.disabled)?.key ?? "");
  const selected = activeKey ?? (items.some(item => item.key === internal && !item.disabled) ? internal : items.find(item => !item.disabled)?.key ?? "");
  const [visited, setVisited] = useState<Set<string>>(() => new Set([selected]));
  const hasPanels = items.some(item => item.children != null);
  const classes = ["rental-tabs", !hasPanels && "rental-tabs-navigation", className].filter(Boolean).join(" ");
  useEffect(() => { setVisited(previous => previous.has(selected) ? previous : new Set([...previous, selected])); }, [selected]);
  // Editable, vertical and custom tab bars keep their existing behavior until Arc provides matching capabilities.
  if (props.type === "editable-card" || props.tabPlacement && props.tabPlacement !== "top" || props.tabPosition && props.tabPosition !== "top" || props.renderTabBar || props.tabBarExtraContent || props.onTabClick) return <AntTabs {...props} items={items} className={classes} />;
  const change = (key: string) => { setInternal(key); setVisited(previous => new Set([...previous, key])); onChange?.(key); };
  return <ArcTabs value={selected} onValueChange={change} className={classes} style={style}>
    <TabsList aria-label={props["aria-label"] ?? "Tabs"}>{items.map(item => <TabsTrigger key={item.key} value={item.key} disabled={item.disabled}>{item.label}</TabsTrigger>)}</TabsList>
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
