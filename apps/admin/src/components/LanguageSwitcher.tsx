import { Tooltip } from "@/components/ui";
import { useLocale, type AdminLocale } from "@/app/locale";

/** 左下角语言切换：展开时显示中/EN，收起侧栏时保留一个可点击的目标语言。 */
export function LanguageSwitcher({ iconOnly = false }: { iconOnly?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  const nextLocale: AdminLocale = locale === "zh-CN" ? "en-US" : "zh-CN";

  if (iconOnly) {
    return (
      <Tooltip title={t("切换语言")} placement="right">
        <button
          type="button"
          className="language-toggle-compact"
          aria-label={`${t("切换语言")} (${nextLocale === "en-US" ? "English" : "中文"})`}
          onClick={() => setLocale(nextLocale)}
        >
          {nextLocale === "en-US" ? "EN" : "中"}
        </button>
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
