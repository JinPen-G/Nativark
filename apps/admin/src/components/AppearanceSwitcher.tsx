import { ThemeSwitch } from "@/registry/components/theme-switch/theme-switch";
import { Button, Tooltip } from "@/components/ui";
import { AnimatedIcon } from "@/components/ui/AnimatedIcon";
import { useLocale } from "@/app/locale";
import { DEFAULT_APPEARANCE_TRANSITION, type AppearanceTransition, useAppearance } from "@/app/theme";

/** Original page sweep and button press; icon mode uses Animate UI's theme artwork. */
export function AppearanceSwitcher({ iconOnly = false, transition = DEFAULT_APPEARANCE_TRANSITION }: { iconOnly?: boolean; transition?: AppearanceTransition }) {
  const { mode, setMode } = useAppearance();
  const { t } = useLocale();
  if (iconOnly) return <Tooltip title={t("切换外观主题")} placement="bottom">
    <Button htmlType="button" type="text" className="appearance-toggle-compact" aria-label={t("切换外观主题")}
      aria-pressed={mode === "dark"} onClick={event => setMode(mode === "dark" ? "default" : "dark", { element: event.currentTarget, transition })}>
      <AnimatedIcon key={mode === "dark" ? "moon" : "sun"} name={mode === "dark" ? "moon" : "sun"} style={{ fontSize: "var(--rental-icon-control-size, 16px)" }} />
    </Button>
  </Tooltip>;
  return <Tooltip title={t("切换外观主题")} placement="bottom"><span className="arc-theme-switch">
    <ThemeSwitch theme={mode === "dark" ? "dark" : "light"} variant={transition === "legacy-reveal" ? "reveal" : transition} iconOnly
      label={t("切换外观主题")}
      onThemeChange={(next, _variant, element) => setMode(next === "dark" ? "dark" : "default", { element, transition })} />
  </span></Tooltip>;
}
