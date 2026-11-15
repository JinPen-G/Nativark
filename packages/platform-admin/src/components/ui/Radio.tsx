import { ConfigProvider, Radio as AntRadio, type RadioGroupProps, type RadioChangeEvent } from "antd";
import { useState } from "react";
import { RadioGroup } from "./RadioGroup";
import { Segmented } from "./Segmented";

function Group(props: RadioGroupProps) {
  const { componentDisabled } = ConfigProvider.useConfig();
  const [internal, setInternal] = useState(props.defaultValue);
  const selected = props.value === undefined ? internal : props.value;
  const options = props.options?.map(option => typeof option === "object" ? option : { value: option, label: String(option) });
  const change = (value: unknown) => {
    if (props.disabled ?? componentDisabled) return;
    setInternal(value);
    props.onChange?.({ target: { value, checked: true, name: props.name }, stopPropagation() {}, preventDefault() {}, nativeEvent: new MouseEvent("change") } as RadioChangeEvent);
  };
  if (!options || options.some(option => typeof option.label !== "string") || props.children) return <AntRadio.Group {...props} />;
  // Preserve compact toolbars and button-group geometry rather than forcing vertical cards.
  if (props.optionType === "button" || props.size === "small") {
    return <Segmented options={options} value={selected} disabled={props.disabled ?? componentDisabled} block={props.block} size={props.size} style={props.style} className={props.className} onChange={change} />;
  }
  return <div style={props.style} className={props.className} id={props.id} onFocus={props.onFocus} onBlur={props.onBlur}>
    <RadioGroup label={props["aria-label"] ?? ""} name={props.name} value={String(selected ?? "")} disabled={props.disabled ?? componentDisabled}
      options={options.map(option => ({ value: String(option.value), label: String(option.label), disabled: option.disabled }))}
      onValueChange={key => {
        const option = options.find(item => String(item.value) === key);
        if (!option || option.disabled || (props.disabled ?? componentDisabled)) return;
        change(option.value);
      }} />
  </div>;
}
export const Radio = Object.assign((props: Parameters<typeof AntRadio>[0]) => <AntRadio {...props} />, { Group, Button: AntRadio.Button });
