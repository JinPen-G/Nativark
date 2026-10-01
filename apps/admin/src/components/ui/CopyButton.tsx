import { ConfigProvider } from "antd";
import { CopyButton as ArcCopyButton, type CopyButtonProps } from "@/registry/components/copy-button/copy-button";
import { useLocale } from "@/app/locale";

/** Keep Arc's clipboard result animation; icon-only avoids untranslated upstream result text. */
export function CopyButton({ disabled, label, iconOnly = true, ...props }: CopyButtonProps) {
  const { componentDisabled } = ConfigProvider.useConfig();
  const { t } = useLocale();
  return <span className="arc-copy-action"><ArcCopyButton {...props} label={label ?? t("复制")}
    iconOnly={iconOnly} disabled={disabled ?? componentDisabled} /></span>;
}
