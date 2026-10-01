import { Tabs as AntTabs, type TabsProps } from "antd";
import { useEffect, useState } from "react";
import { Tabs as ArcTabs, TabsList, TabsTrigger, TabsContent } from "@/registry/components/tabs/tabs";

export function Tabs(props: TabsProps) {
  const { items = [], activeKey, defaultActiveKey, onChange, className, style, destroyOnHidden } = props;
  const [internal, setInternal] = useState(defaultActiveKey ?? items.find(item => !item.disabled)?.key ?? "");
  const selected = activeKey ?? (items.some(item => item.key === internal && !item.disabled) ? internal : items.find(item => !item.disabled)?.key ?? "");
  const [visited, setVisited] = useState<Set<string>>(() => new Set([selected]));
  useEffect(() => { setVisited(previous => previous.has(selected) ? previous : new Set([...previous, selected])); }, [selected]);
  // Editable, vertical and custom tab bars keep their existing behavior until Arc provides matching capabilities.
  if (props.type === "editable-card" || props.tabPlacement && props.tabPlacement !== "top" || props.tabPosition && props.tabPosition !== "top" || props.renderTabBar || props.tabBarExtraContent || props.onTabClick) return <AntTabs {...props} />;
  const change = (key: string) => { setInternal(key); setVisited(previous => new Set([...previous, key])); onChange?.(key); };
  return <ArcTabs value={selected} onValueChange={change} className={className} style={style}>
    <TabsList aria-label={props["aria-label"] ?? "Tabs"}>{items.map(item => <TabsTrigger key={item.key} value={item.key} disabled={item.disabled}>{item.icon}{item.label}</TabsTrigger>)}</TabsList>
    {items.map(item => {
      if (item.children == null) return null;
      const destroy = item.destroyOnHidden ?? destroyOnHidden ?? false;
      if (destroy) return <TabsContent key={item.key} value={item.key}>{item.children}</TabsContent>;
      // AntD defaults to retaining visited panels. Do not reset forms or trigger new queries on each switch.
      if (item.key !== selected && !visited.has(item.key) && !item.forceRender) return null;
      return <TabsContent key={item.key} value={item.key} forceMount hidden={item.key !== selected}>{item.children}</TabsContent>;
    })}
  </ArcTabs>;
}
