import { ConfigProvider, Form as AntForm, Select as AntSelect, type SelectProps as AntSelectProps } from "antd";
import type { BaseOptionType, DefaultOptionType } from "antd/es/select";
import { useState } from "react";
import { X } from "lucide-react";
import { Select as ArcSelect } from "@/registry/components/select/select";
import { MultiSelect as ArcMultiSelect } from "@/registry/components/multi-select/multi-select";
import { ArcLocale } from "./ArcLocale";
import { Combobox as ArcCombobox } from "@/registry/components/combobox/combobox";
import { useLocale } from "@/app/locale";

type ArcValue = string | number | boolean;
type BasicOption = { value: ArcValue; label: string; disabled?: boolean };

const keyFor = (value: ArcValue) => `${typeof value}:${String(value)}`;
const isArcValue = (value: unknown): value is ArcValue => typeof value === "string" || typeof value === "number" || typeof value === "boolean";
const isBasicOption = (value: unknown): value is BasicOption => {
  if (!value || typeof value !== "object") return false;
  const option = value as Partial<BasicOption>;
  return isArcValue(option.value) && typeof option.label === "string";
};

/**
 * Use original Select/MultiSelect/Combobox for compatible choices. Ant remains
 * the deliberate compatibility implementation for advanced
 * contracts such as custom filtering/options, async loading and
 * controlled popup behavior. This keeps every current business form functional
 * while new/simple fields automatically get UIArc's value-roll and menu motion.
 */
// Keep Ant's generic inference: some existing forms use boolean option values.
// Runtime still narrows to ArcValue before selecting the UIArc implementation.
export function Select<ValueType = any, OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType>(props: AntSelectProps<ValueType, OptionType>) {
  const { componentDisabled } = ConfigProvider.useConfig();
  const { t } = useLocale();
  const feedback = AntForm.Item.useStatus();
  const status = props.status ?? feedback.status;
  // Keep hooks unconditional: a field can legitimately gain an advanced prop
  // after first render and then fall back to Ant without violating hook order.
  const [internalValue, setInternalValue] = useState<ArcValue | ArcValue[] | undefined>(props.defaultValue as ArcValue | ArcValue[] | undefined);
  const options = props.options as unknown[] | undefined;
  const sourceOptions: BasicOption[] | undefined = Array.isArray(options) && options.every(isBasicOption) ? options : undefined;
  const multiple = props.mode === "multiple";
  const searchConfig = props.showSearch;
  const basicSearch = !multiple && (searchConfig === true && props.optionFilterProp === "label" ||
    typeof searchConfig === "object" && searchConfig.optionFilterProp === "label" && Object.keys(searchConfig).every(key => key === "optionFilterProp"));
  const validValue = (value: unknown) => value === undefined || (multiple ? Array.isArray(value) && value.every(isArcValue) : isArcValue(value));
  const unsupported = Boolean(
    props.mode && !multiple || multiple && props.showSearch !== false || props.showSearch && !basicSearch || props.searchValue !== undefined || props.autoClearSearchValue !== undefined || props.labelInValue || props.loading || props.loadingIcon || props.open !== undefined || props.defaultOpen !== undefined ||
    props.defaultActiveFirstOption !== undefined || props.placement || props.showArrow !== undefined || props.onOpenChange || props.onDropdownVisibleChange || props.onSearch || props.onSelect || props.onDeselect || props.onPopupScroll ||
    props.onActive || props.onBlur || props.onFocus || props.onInputKeyDown ||
    props.optionRender || props.popupRender || props.dropdownRender || props.tagRender || props.labelRender || props.fieldNames ||
    props.filterOption !== undefined || props.filterSort || props.optionFilterProp && !basicSearch || props.optionLabelProp || props.tokenSeparators ||
    props.maxCount !== undefined || props.maxTagCount !== undefined || props.maxTagPlaceholder || props.maxTagTextLength !== undefined || props.menuItemSelectedIcon ||
    props.removeIcon || props.suffixIcon || props.prefix || props.size || props.variant || props.bordered === false || typeof props.allowClear === "object" || props.classNames ||
    props.styles || props.popupClassName || props.popupStyle || props.dropdownClassName || props.dropdownStyle || props.popupMatchSelectWidth !== undefined || props.getPopupContainer ||
    props.virtual === false || props.listHeight || props.listItemHeight || props.notFoundContent || !sourceOptions || sourceOptions.length === 0 ||
    !validValue(props.value) || !validValue(props.defaultValue) || props.autoFocus || props.children || multiple && Boolean(props.onClear) ||
    typeof props.placeholder !== "string" && props.placeholder !== undefined,
  );
  if (unsupported) return <AntSelect {...props} />;

  const controlled = Object.hasOwn(props, "value");
  const currentValue = controlled ? props.value as ArcValue | ArcValue[] | undefined : internalValue;
  if (multiple) {
    const selected = Array.isArray(currentValue) ? currentValue : [];
    if (selected.some(value => !sourceOptions!.some(option => Object.is(option.value, value)))) return <AntSelect {...props} />;
    return <div className={["arc-select-field", !props.allowClear && "arc-multi-no-clear", props.rootClassName, props.className].filter(Boolean).join(" ")} style={props.style} data-status={status} id={props.id}>
      <ArcLocale><ArcMultiSelect label={typeof props["aria-label"] === "string" ? props["aria-label"] : typeof props.placeholder === "string" ? props.placeholder : t("选择选项")}
        options={sourceOptions!.map(option => ({ ...option, value: keyFor(option.value) }))}
        value={selected.map(keyFor)} disabled={props.disabled ?? componentDisabled} placeholder={typeof props.placeholder === "string" ? props.placeholder : undefined}
        onValueChange={keys => {
          const nextOptions = keys.map(key => sourceOptions!.find(option => keyFor(option.value) === key)).filter((option): option is BasicOption => Boolean(option));
          const next = nextOptions.map(option => option.value);
          if (!controlled) setInternalValue(next);
          props.onChange?.(next as never, nextOptions as never);
        }} /></ArcLocale>
    </div>;
  }
  const currentKey = currentValue === undefined ? "" : keyFor(currentValue as ArcValue);
  const clearable = Boolean(props.allowClear && currentValue !== undefined && currentValue !== "");
  const disabled = props.disabled ?? componentDisabled;
  const usableOptions = sourceOptions ?? [];
  // Ant keeps a stored selection visible even when a later catalog no longer contains it.
  if (currentValue !== undefined && !usableOptions.some(option => Object.is(option.value, currentValue))) return <AntSelect {...props} />;
  const sourceLabel = typeof props["aria-label"] === "string" ? props["aria-label"] : typeof props.placeholder === "string" ? props.placeholder : t("选择选项");
  const sourcePlaceholder = typeof props.placeholder === "string" ? props.placeholder : undefined;
  const update = (nextKey: string) => {
    const option = usableOptions.find(item => keyFor(item.value) === nextKey);
    if (!option) return;
    if (!controlled) setInternalValue(option.value);
    // Ant callers primarily consume the first value; the matching simple option
    // remains available as the second argument too.
    props.onChange?.(option.value as never, option as never);
  };
  const clear = () => {
    if (disabled || currentValue === undefined) return;
    if (!controlled) setInternalValue(undefined);
    props.onClear?.();
    props.onChange?.(undefined as never, undefined as never);
  };
  if (basicSearch) return <div className={["arc-select-field", !props.allowClear && "arc-multi-no-clear", props.rootClassName, props.className].filter(Boolean).join(" ")} style={props.style} data-status={status}>
    <ArcLocale><ArcCombobox id={props.id} label={sourceLabel} options={usableOptions.map(option => ({ ...option, value: keyFor(option.value) }))}
      value={currentKey} disabled={disabled} placeholder={sourcePlaceholder} emptyMessage={t("暂无数据")}
      onValueChange={key => key === "" ? clear() : update(key)} /></ArcLocale>
  </div>;
  return <div className={["arc-select-field", props.rootClassName, props.className].filter(Boolean).join(" ")} style={props.style} data-status={status}
    title={usableOptions.find(option => Object.is(option.value, currentValue))?.label}>
    <ArcSelect id={props.id} label={sourceLabel} placeholder={sourcePlaceholder} options={usableOptions.map(option => ({ ...option, value: keyFor(option.value) }))}
      value={currentKey} disabled={disabled} onValueChange={update} className={clearable ? "arc-select-trigger-with-clear" : undefined} />
    {clearable && <button type="button" className="arc-select-clear" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={clear} aria-label={t("清空选择")}><X size={14} aria-hidden="true" /></button>}
  </div>;
}
