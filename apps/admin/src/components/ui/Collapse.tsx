import { Collapse as AntCollapse, type CollapseProps } from "antd";
import { Accordion } from "./Accordion";
const keys = (value: CollapseProps["activeKey"]) => value === undefined ? undefined : (Array.isArray(value) ? value : [value]).map(String);
export function Collapse(props: CollapseProps) {
  if (!props.items || props.accordion || props.children || props.expandIcon || props.collapsible || props.items.some(item => item.collapsible || item.showArrow === false) || props.styles || props.classNames) return <AntCollapse {...props} />;
  return <div className={props.className} style={props.style}><Accordion items={props.items.map((item, index) => ({ key: String(item.key ?? index), title: item.label, extra: item.extra, content: item.children }))}
    value={keys(props.activeKey)} onValueChange={value => props.onChange?.(value)}
    defaultOpen={props.items.findIndex((item, index) => keys(props.defaultActiveKey)?.includes(String(item.key ?? index)))} /></div>;
}
