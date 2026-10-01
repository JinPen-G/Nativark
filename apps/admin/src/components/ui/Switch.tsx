import { ConfigProvider, Switch as AntSwitch, type SwitchProps } from "antd";
import { forwardRef, useImperativeHandle, useRef, useState, type ElementRef, type MouseEvent } from "react";
import { Switch as ArcSwitch } from "@/registry/components/switch/switch";

export const Switch = forwardRef<ElementRef<typeof AntSwitch>, SwitchProps>(function Switch(props, ref) {
  const { componentDisabled } = ConfigProvider.useConfig();
  const node = useRef<HTMLButtonElement>(null);
  const fallback = useRef<ElementRef<typeof AntSwitch>>(null);
  const eventRef = useRef<MouseEvent<HTMLButtonElement> | null>(null);
  const { checked, value, defaultChecked, defaultValue, onChange, onClick, checkedChildren,
    unCheckedChildren, loading, size, styles, classNames, rootClassName, ...native } = props;
  const [internal, setInternal] = useState(defaultChecked ?? defaultValue ?? false);
  const controlled = checked ?? value;
  const on = controlled ?? internal;
  useImperativeHandle(ref, () => fallback.current ?? node.current!);
  if (checkedChildren || unCheckedChildren || loading || styles || classNames || size === "small")
    return <AntSwitch {...props} ref={fallback} />;
  return <ArcSwitch {...native} ref={node} checked={on} disabled={props.disabled ?? componentDisabled}
    className={[props.className, rootClassName].filter(Boolean).join(" ")}
    onClickCapture={event => { eventRef.current = event; }}
    onClick={event => onClick?.(!on, event)}
    onCheckedChange={next => { if (controlled === undefined) setInternal(next); if (eventRef.current) onChange?.(next, eventRef.current); }} />;
});
