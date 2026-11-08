import { ConfigProvider, Input as AntInput, type InputProps, type InputRef } from "antd";
import { forwardRef, useContext, useImperativeHandle, useRef, useState, type ComponentProps, type InputHTMLAttributes } from "react";
import { NativeFieldFeedbackContext, useFormFeedback } from "./Form";
import { Input as ArcInput } from "@/registry/components/input/input";
import { Textarea as ArcTextarea } from "@/registry/components/textarea/textarea";
import { PasswordField as ArcPasswordField } from "@/registry/components/password-field/password-field";
import { ArcLocale } from "./ArcLocale";
import type { TextAreaRef } from "antd/es/input/TextArea";

const BaseInput = forwardRef<InputRef, InputProps>(function Input(props, ref) {
  const { componentDisabled, componentSize } = ConfigProvider.useConfig();
  const feedback = useFormFeedback();
  const nativeFeedback = useContext(NativeFieldFeedbackContext);
  const error = nativeFeedback && feedback.errors.length && feedback.errors.every(item => typeof item === "string") && !feedback.warnings.length
    ? feedback.errors.join(" · ") : undefined;
  const [internal, setInternal] = useState(props.defaultValue == null ? "" : String(props.defaultValue));
  const nativeRef = useRef<HTMLInputElement>(null);
  const fallbackRef = useRef<InputRef>(null);
  useImperativeHandle(ref, () => fallbackRef.current ?? ({
    input: nativeRef.current, nativeElement: nativeRef.current!,
    focus: (options) => {
      const node = nativeRef.current; node?.focus(options);
      if (options?.cursor === "all") node?.select();
      if (options?.cursor === "start") node?.setSelectionRange(0, 0);
      if (options?.cursor === "end") node?.setSelectionRange(node.value.length, node.value.length);
    },
    blur: () => nativeRef.current?.blur(), select: () => nativeRef.current?.select(),
    setSelectionRange: (start, end, direction) => nativeRef.current?.setSelectionRange(start, end, direction)
  } satisfies InputRef));
  const { prefix, suffix, addonBefore, addonAfter, allowClear, showCount, count, styles, classNames,
    size = componentSize, variant, bordered, rootClassName, status, onPressEnter, onClear, value, defaultValue, ...native } = props;
  // Affixes, clear/count and semantic styles retain their existing editing contract.
  if (prefix || suffix || addonBefore || addonAfter || allowClear || showCount || count || styles || classNames ||
    bordered === false || variant && variant !== "outlined") return <AntInput {...props} ref={fallbackRef} />;
  return <span className={["arc-form-field", error && "arc-native-feedback", rootClassName].filter(Boolean).join(" ")} data-size={size}>
    <ArcInput {...native as InputHTMLAttributes<HTMLInputElement>} ref={nativeRef} label=""
      error={error}
      value={Object.hasOwn(props, "value") ? String(value ?? "") : internal}
      onChange={event => { setInternal(event.target.value); props.onChange?.(event); }}
      disabled={props.disabled ?? componentDisabled}
      aria-invalid={status === "error" || props["aria-invalid"]}
      onKeyDown={event => { props.onKeyDown?.(event); if (event.key === "Enter" && !event.nativeEvent.isComposing) onPressEnter?.(event); }} />
  </span>;
});

type TextareaProps = ComponentProps<typeof AntInput.TextArea>;
const TextArea = forwardRef<TextAreaRef, TextareaProps>(function TextArea(props, ref) {
  const { componentDisabled } = ConfigProvider.useConfig();
  const feedback = useFormFeedback();
  const nativeFeedback = useContext(NativeFieldFeedbackContext);
  const error = nativeFeedback && feedback.errors.length && feedback.errors.every(item => typeof item === "string") && !feedback.warnings.length
    ? feedback.errors.join(" · ") : undefined;
  const nativeRef = useRef<HTMLTextAreaElement>(null);
  const fallbackRef = useRef<TextAreaRef>(null);
  useImperativeHandle(ref, () => ({
    focus: options => {
      if (fallbackRef.current) { fallbackRef.current.focus(options); return; }
      const node = nativeRef.current; node?.focus(options);
      if (options?.cursor === "all") node?.select();
      if (options?.cursor === "start") node?.setSelectionRange(0, 0);
      if (options?.cursor === "end") node?.setSelectionRange(node.value.length, node.value.length);
    },
    blur: () => fallbackRef.current ? fallbackRef.current.blur() : nativeRef.current?.blur(),
    get nativeElement() { return fallbackRef.current?.nativeElement ?? nativeRef.current; },
    get resizableTextArea() { return fallbackRef.current?.resizableTextArea ?? (nativeRef.current ? { textArea: nativeRef.current } : undefined); },
  }));
  const [internal, setInternal] = useState(props.defaultValue == null ? "" : String(props.defaultValue));
  const { autoSize, allowClear, showCount, count, styles, classNames, size, variant, bordered,
    rootClassName, status, onPressEnter, value, defaultValue, ...native } = props;
  if (autoSize || allowClear || showCount || count || styles || classNames || props.onResize ||
    bordered === false || variant && variant !== "outlined") return <AntInput.TextArea {...props} ref={fallbackRef} />;
  return <span className={["arc-form-field", error && "arc-native-feedback", rootClassName].filter(Boolean).join(" ")} data-size={size}>
    <ArcTextarea {...native} ref={nativeRef} label="" error={error} value={Object.hasOwn(props, "value") ? String(value ?? "") : internal}
      onChange={event => { setInternal(event.target.value); props.onChange?.(event); }} disabled={props.disabled ?? componentDisabled}
      aria-invalid={status === "error" || props["aria-invalid"]}
      onKeyDown={event => { props.onKeyDown?.(event); if (event.key === "Enter" && !event.nativeEvent.isComposing) onPressEnter?.(event); }} />
  </span>;
});

type PasswordProps = ComponentProps<typeof AntInput.Password>;
const Password = forwardRef<InputRef, PasswordProps>(function Password(props, ref) {
  const { componentDisabled, componentSize } = ConfigProvider.useConfig();
  const feedback = useFormFeedback();
  const [internal, setInternal] = useState(props.defaultValue == null ? "" : String(props.defaultValue));
  const node = useRef<HTMLInputElement>(null);
  const fallback = useRef<InputRef>(null);
  useImperativeHandle(ref, () => ({
    get input() { return fallback.current?.input ?? node.current; },
    get nativeElement() { return fallback.current?.nativeElement ?? node.current!; },
    focus: options => {
      if (fallback.current) { fallback.current.focus(options); return; }
      node.current?.focus(options);
      if (options?.cursor === "all") node.current?.select();
      if (options?.cursor === "start") node.current?.setSelectionRange(0, 0);
      if (options?.cursor === "end" && node.current) node.current.setSelectionRange(node.current.value.length, node.current.value.length);
    },
    blur: () => fallback.current ? fallback.current.blur() : node.current?.blur(),
    select: () => fallback.current ? fallback.current.select() : node.current?.select(),
    setSelectionRange: (start, end, direction) => fallback.current ? fallback.current.setSelectionRange(start, end, direction) : node.current?.setSelectionRange(start, end, direction),
  }));
  const { prefix, suffix, addonBefore, addonAfter, allowClear, showCount, count, styles, classNames, size = componentSize, variant, bordered,
    rootClassName, status, onPressEnter, onClear, value, defaultValue, visibilityToggle, iconRender, action, inputPrefixCls, type, ...native } = props;
  if (prefix || suffix || addonBefore || addonAfter || allowClear || showCount || count || styles || classNames || iconRender ||
    visibilityToggle !== undefined || action && action !== "click" || inputPrefixCls || bordered === false || variant && variant !== "outlined") return <AntInput.Password {...props} ref={fallback} />;
  const disabled = props.disabled ?? componentDisabled;
  return <span className={["arc-form-field", "arc-password-field", rootClassName].filter(Boolean).join(" ")} data-size={size}
    data-status={status ?? feedback.status} inert={disabled || undefined}>
    <ArcLocale><ArcPasswordField {...native} ref={node} label="" disabled={disabled}
      value={Object.hasOwn(props, "value") ? String(value ?? "") : internal}
      onChange={event => { setInternal(event.target.value); props.onChange?.(event); }}
      aria-invalid={(status ?? feedback.status) === "error" || props["aria-invalid"]}
      onKeyDown={event => { props.onKeyDown?.(event); if (event.key === "Enter" && !event.nativeEvent.isComposing) onPressEnter?.(event); }} /></ArcLocale>
  </span>;
});

/** Search/OTP retain their richer contracts; ordinary passwords use native Arc. */
export const Input = Object.assign(BaseInput, { TextArea, Search: AntInput.Search, Password, OTP: AntInput.OTP });
