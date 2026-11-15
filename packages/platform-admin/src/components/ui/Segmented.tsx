import { ConfigProvider, Segmented as AntSegmented, type SegmentedProps } from "antd";
import { useState } from "react";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";

export function Segmented<T extends string | number = string | number>(props: SegmentedProps<T> & { iconOnly?: boolean }) {
  const { iconOnly, ...native } = props;
  const { componentDisabled } = ConfigProvider.useConfig();
  const options = props.options.map(option => typeof option === "object" ? option : { value: option, label: option });
  const [internal, setInternal] = useState(props.defaultValue ?? options[0]?.value);
  const selected = props.value ?? internal;
  if ((props.disabled ?? componentDisabled) || props.vertical || options.some(option => option.disabled)) return <AntSegmented {...native} className={["arc-segmented", iconOnly && "arc-segmented-icons", props.className].filter(Boolean).join(" ")} disabled={props.disabled ?? componentDisabled} />;
  return <div style={props.style} className={["arc-segmented", iconOnly && "arc-segmented-icons", props.block && "arc-segmented-block"].filter(Boolean).join(" ")}>
    <SegmentedControl className={props.className} label={props["aria-label"]} value={String(selected)}
      options={options.map(option => ({ value: String(option.value), label: typeof option.label === "string" ? option.label : "", accessory: <>{"icon" in option && option.icon}{typeof option.label !== "string" ? option.label : null}</> }))}
      onValueChange={key => { const option = options.find(item => String(item.value) === key); if (option) { setInternal(option.value); props.onChange?.(option.value); } }} />
  </div>;
}
