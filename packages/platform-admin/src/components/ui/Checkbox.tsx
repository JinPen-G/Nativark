import { Checkbox as AntCheckbox, ConfigProvider, type CheckboxProps } from "antd";
import type { CheckboxRef } from "antd/es/checkbox";
import { createContext, forwardRef, useContext, useImperativeHandle, useRef, useState, type ComponentProps, type MouseEvent } from "react";
import { Checkbox as ArcCheckbox } from "@/registry/components/checkbox/checkbox";

// Ant groups own value propagation; do not silently detach their children.
const AntGroupContext = createContext(false);
function Group(props: ComponentProps<typeof AntCheckbox.Group>) {
  return <AntGroupContext.Provider value><AntCheckbox.Group {...props} /></AntGroupContext.Provider>;
}
const Control = forwardRef<CheckboxRef, CheckboxProps>(function Checkbox(props, ref) {
  const group = useContext(AntGroupContext);
  const { componentDisabled } = ConfigProvider.useConfig();
  const [internal, setInternal] = useState(props.defaultChecked ?? false);
  const eventRef = useRef<MouseEvent<HTMLButtonElement> | null>(null);
  const node = useRef<HTMLButtonElement>(null);
  const ant = useRef<CheckboxRef>(null);
  useImperativeHandle(ref, () => ({
    focus: options => ant.current ? ant.current.focus(options) : node.current?.focus(options),
    blur: () => ant.current ? ant.current.blur() : node.current?.blur(),
    get nativeElement() { return ant.current?.nativeElement ?? node.current; },
    get input() { return ant.current?.input ?? node.current?.parentElement?.querySelector("input") ?? null; },
  }));
  if (group || props.autoFocus || props.onBlur || props.onFocus || props.onClick || props.onKeyDown || props.classNames || props.styles || props.skipGroup ||
    props.children != null && typeof props.children !== "string") return <AntCheckbox {...props} ref={ant} />;
  const controlled = Object.hasOwn(props, "checked");
  const checked = controlled ? Boolean(props.checked) : internal;
  return <span className={["arc-checkbox-field", props.rootClassName, props.className].filter(Boolean).join(" ")} style={props.style}>
    <ArcCheckbox ref={node} id={props.id} name={props.name} value={props.value} title={props.title} label={typeof props.children === "string" ? props.children : undefined}
      disabled={props.disabled ?? componentDisabled} checked={props.indeterminate ? "indeterminate" : checked}
      onClickCapture={event => { eventRef.current = event; }} onCheckedChange={next => {
        const event = eventRef.current;
        if (!event) return;
        const on = next === true;
        if (!controlled) setInternal(on);
        props.onChange?.({ target: { ...props, checked: on }, nativeEvent: event.nativeEvent,
          stopPropagation: () => event.stopPropagation(), preventDefault: () => event.preventDefault() });
      }} />
  </span>;
});
export const Checkbox = Object.assign(Control, { Group });
