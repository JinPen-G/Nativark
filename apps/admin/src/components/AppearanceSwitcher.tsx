import { ThemeSwitch } from "@/registry/components/theme-switch/theme-switch";
import { useLocale } from "@/app/locale";
import { DEFAULT_APPEARANCE_TRANSITION, type AppearanceTransition, useAppearance } from "@/app/theme";

/** Original UIArc icon/press motion; page sweep defaults to straight horizontal reveal. */
export function AppearanceSwitcher({ iconOnly = false, transition = DEFAULT_APPEARANCE_TRANSITION }: { iconOnly?: boolean; transition?: AppearanceTransition }) {
  const { mode, setMode } = useAppearance();
  const { t } = useLocale();
  return <span className={iconOnly ? "sider-link-switch" : "arc-theme-switch"}>
    <ThemeSwitch theme={mode === "dark" ? "dark" : "light"} variant={transition === "legacy-reveal" ? "reveal" : transition} iconOnly
      label={t("切换外观主题")}
      onThemeChange={(next, _variant, element) => setMode(next === "dark" ? "dark" : "default", { element, transition })} />
  </span>;
}
