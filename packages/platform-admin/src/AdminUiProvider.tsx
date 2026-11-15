/** 同一 React/UIArc 主题、Portal、反馈与查询上下文；宿主负责当前账号和缓存。
 * 公共登录不继承已缓存账号颜色，业务 Core 无须另建这些 Provider。 */
import { App as AntdApp, ConfigProvider } from "antd";
import { Provider as AntMotionProvider } from "@rc-component/motion";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useLayoutEffect, type ReactNode } from "react";
import { LocaleProvider, useLocale, type AdminMessages } from "./app/locale";
import { AppearanceProvider, createThemeConfig, useAppearance } from "./app/theme";
import { MotionPreferenceProvider } from "./app/MotionPreferenceProvider";
import { applyAdminRadiusTokens, type AdminRadiusGroups } from "./app/designTokens";
import { applyArcThemeTokens } from "./app/arcTokens";
import { FeedbackProvider } from "./components/ui/Feedback";
import { BusinessUiScopeProvider, type BusinessUiScope } from "./components/ui/BusinessUiScope";
import { GlobalInteractionSounds } from "./features/sound/GlobalInteractionSounds";
import type { SoundScope } from "./features/sound/soundService";
import { usePrefersReducedMotion } from "./lib/usePrefersReducedMotion";

interface Props {
  children: ReactNode;
  queryClient: QueryClient;
  scope: BusinessUiScope;
  soundScope: SoundScope | null;
  accountThemeColor?: string;
  radii?: AdminRadiusGroups;
  messages?: AdminMessages;
}

export function AdminUiProvider(props: Props) {
  return <MotionPreferenceProvider><LocaleProvider messages={props.messages}><AppearanceProvider>
    <ThemedAdmin {...props} />
  </AppearanceProvider></LocaleProvider></MotionPreferenceProvider>;
}

function ThemedAdmin({ children, queryClient, scope, soundScope, accountThemeColor, radii }: Props) {
  const { mode } = useAppearance(), { locale } = useLocale(), reduced = usePrefersReducedMotion();
  useLayoutEffect(() => {
    applyAdminRadiusTokens(document.documentElement, radii);
    applyArcThemeTokens(document.documentElement, mode === "dark", accountThemeColor);
  }, [radii, mode, accountThemeColor]);
  return <ConfigProvider locale={locale === "en-US" ? enUS : zhCN} variant="outlined"
    getPopupContainer={trigger => {
      if (trigger) return trigger.closest<HTMLElement>("[data-rental-arc-drawer]") ?? document.body;
      const drawers = document.querySelectorAll<HTMLElement>('[data-rental-arc-drawer][data-state="open"]');
      return drawers.item(drawers.length - 1) ?? document.body;
    }} theme={createThemeConfig(mode, accountThemeColor, radii)}>
    <AntMotionProvider motion={!reduced}><QueryClientProvider client={queryClient}><AntdApp><FeedbackProvider>
      <GlobalInteractionSounds scope={soundScope} /><BusinessUiScopeProvider value={scope}>{children}</BusinessUiScopeProvider>
    </FeedbackProvider></AntdApp></QueryClientProvider></AntMotionProvider>
  </ConfigProvider>;
}
