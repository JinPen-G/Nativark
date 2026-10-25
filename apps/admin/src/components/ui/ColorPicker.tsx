import { ConfigProvider } from "antd";
import { useRef } from "react";
import { ColorPicker as ArcColorPicker } from "@/registry/components/color-picker/color-picker";
import { ADMIN_DEFAULT_PRIMARY_COLOR } from "@/app/designTokens";
import { useLocale } from "@/app/locale";
import { Button } from "./Button";
import { ArcLocale } from "./ArcLocale";
import { useInputRadiusClip } from "./useInputRadiusClip";

export function ColorPicker({ value, onChange, disabled, id, label }: { value?: string; onChange?: (value: string) => void; disabled?: boolean; id?: string; label?: string }) {
  const { t } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  useInputRadiusClip(root);
  const { componentDisabled: formDisabled } = ConfigProvider.useConfig();
  const off = disabled ?? formDisabled;
  return <div ref={root} id={id} className="arc-color-field" inert={off || undefined} aria-disabled={off}>
    <ArcLocale><ArcColorPicker label={label ?? t("主题色")} value={value || ADMIN_DEFAULT_PRIMARY_COLOR} onValueChange={hex => { if (!off) onChange?.(hex.slice(0, 7).toUpperCase()); }} /></ArcLocale>
    {value && <Button size="small" onClick={() => onChange?.("")}>{t("恢复系统色")}</Button>}
    <span className="text-meta">{t("颜色不使用透明度")}</span>
  </div>;
}
