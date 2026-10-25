import { forwardRef, useState, type CSSProperties, type KeyboardEventHandler } from "react";
import { SearchField as ArcSearchField } from "@/registry/components/search-field/search-field";
import { ConfigProvider } from "antd";

export interface SearchFieldProps {
  id?: string;
  /** Kept visually hidden inside the source component, but remains the accessible field name. */
  label?: string;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  size?: "small" | "middle" | "large";
  className?: string;
  rootClassName?: string;
  style?: CSSProperties;
  onValueChange?: (value: string) => void;
  onSearch?: (value: string) => void;
  onClear?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/**
 * UIArc's source Search field, adapted to the app's controlled filtering contract.
 * It intentionally owns the icon, clear affordance and clear animation; callers only
 * decide when a typed value becomes an applied server-side filter.
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(props, ref) {
  const {
    label,
    placeholder,
    value,
    defaultValue = "",
    disabled,
    size,
    className,
    rootClassName,
    style,
    onValueChange,
    onSearch,
    onClear,
    onKeyDown,
    ...native
  } = props;
  const { componentSize } = ConfigProvider.useConfig();
  const controlled = Object.hasOwn(props, "value");
  const [internalValue, setInternalValue] = useState(defaultValue);
  const currentValue = controlled ? value ?? "" : internalValue;
  const update = (next: string) => {
    if (!controlled) setInternalValue(next);
    if (currentValue && !next) onClear?.();
    onValueChange?.(next);
  };
  return <div className={["arc-search-field", rootClassName, className].filter(Boolean).join(" ")} style={style} data-size={size ?? componentSize}>
    <ArcSearchField {...native} ref={ref} label={label ?? placeholder ?? "搜索"} placeholder={placeholder} value={currentValue}
      disabled={disabled} onValueChange={update}
      onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && event.key === "Enter" && !event.nativeEvent.isComposing) onSearch?.(currentValue); }} />
  </div>;
});
