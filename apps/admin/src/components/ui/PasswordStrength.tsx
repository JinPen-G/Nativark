import { ConfigProvider } from "antd";
import { PasswordStrength as ArcPasswordStrength, type PasswordStrengthProps } from "@/registry/components/password-strength/password-strength";
import { ArcLocale } from "./ArcLocale";
import { useLocale } from "@/app/locale";

/** Keep the existing password policy; the upstream default twelve-character rule is only a demo. */
export function PasswordStrength(props: PasswordStrengthProps) {
  const { componentDisabled } = ConfigProvider.useConfig();
  const { t } = useLocale();
  const rules = [
    { id: "length", label: t("至少 8 个字符"), test: (value: string) => value.length >= 8, remaining: (value: string) => Math.max(0, 8 - value.length) },
    { id: "letter", label: t("至少一个字母"), test: (value: string) => /[a-z]/i.test(value) },
    { id: "number", label: t("至少一个数字"), test: (value: string) => /\d/.test(value) },
    { id: "symbol", label: t("至少一个特殊字符"), test: (value: string) => /[^a-z0-9]/i.test(value) },
  ];
  return <span className="arc-form-field arc-password-strength"><ArcLocale><ArcPasswordStrength rules={rules} {...props} disabled={props.disabled ?? componentDisabled} /></ArcLocale></span>;
}
