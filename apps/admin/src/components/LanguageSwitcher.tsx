import { Button, Tooltip } from "@/components/ui";
import { AnimatedIcon } from "@/components/ui/AnimatedIcon";
import { useLocale, type AdminLocale } from "@/app/locale";

/** Shared language preference; icon mode switches to the other supported locale. */
export function LanguageSwitcher({ iconOnly = false }: { iconOnly?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  const nextLocale: AdminLocale = locale === "zh-CN" ? "en-US" : "zh-CN";

  if (iconOnly) {
    return (
      <Tooltip title={`${t("切换语言")} · ${nextLocale === "en-US" ? "English" : "中文"}`} placement="bottom">
        <Button
          htmlType="button"
          type="text"
          className="language-toggle-compact"
          aria-label={`${t("切换语言")} (${nextLocale === "en-US" ? "English" : "中文"})`}
          icon={<AnimatedIcon name="globe" style={{ fontSize: "var(--rental-icon-control-size, 16px)" }} />}
          onClick={() => setLocale(nextLocale)}
        />
      </Tooltip>
    );
  }

  return (
    <div className="language-toggle" role="group" aria-label={t("切换语言")}>
      <button type="button" aria-pressed={locale === "zh-CN"} onClick={() => setLocale("zh-CN")}>中</button>
      <button type="button" aria-pressed={locale === "en-US"} onClick={() => setLocale("en-US")}>EN</button>
    </div>
  );
}
