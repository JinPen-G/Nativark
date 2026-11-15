import { ConfigProvider } from "antd";
import { useState } from "react";
import { PasswordField as ArcPasswordField, type PasswordFieldProps } from "@/registry/components/password-field/password-field";
import { ArcLocale } from "./ArcLocale";

/** Native Arc password reveal motion; Ant Form still owns value and validation. */
export function PasswordField(props: Omit<PasswordFieldProps, "label"> & { label?: string }) {
  const { label = "", disabled, value, defaultValue, onChange, ...native } = props;
  const { componentDisabled } = ConfigProvider.useConfig();
  const [internal, setInternal] = useState(defaultValue == null ? "" : String(defaultValue));
  return <span className="arc-form-field arc-password-field" inert={(disabled ?? componentDisabled) || undefined}><ArcLocale><ArcPasswordField {...native} label={label} value={Object.hasOwn(props, "value") ? String(value ?? "") : internal} onChange={event => { setInternal(event.target.value); onChange?.(event); }} disabled={disabled ?? componentDisabled} /></ArcLocale></span>;
}
