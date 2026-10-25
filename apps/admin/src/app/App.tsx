import { App as AntdApp, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { AppRouter } from "./AppRouter";
import { LocaleProvider, useLocale } from "./locale";
import { queryClient } from "./queryClient";
import { AppearanceProvider, createThemeConfig, useAppearance } from "./theme";
import { useAuthStore } from "@/features/auth/authStore";
import { BrandIconProvider } from "./BrandIconProvider";
import { applyAdminRadiusTokens, resolveAdminPrimaryColor } from "./designTokens";
import { GlobalInteractionSounds } from "@/features/sound/GlobalInteractionSounds";
import { applyArcThemeTokens } from "./arcTokens";
import { FeedbackProvider } from "@/components/ui/Feedback";

// Keep existing descendant routes; data router supplies supported SPA blockers.
const router = createBrowserRouter([{ path: "*", element: <AppRouter /> }]);

function ThemedApp() {
  const { mode } = useAppearance();
  const { locale } = useLocale();
  const tenant = useAuthStore((state) => state.tenant);
  const user = useAuthStore((state) => state.user);
  // 后台主色跟随**登录账户**的主题色（与租户品牌色相互独立）；未设置时回退平台默认灰。
  const adminThemeColor = user?.accountThemeColor;
  // 三组独立圆角；任一组缺省回退旧统一值 adminCornerRadius，再回退平台默认。
  const radiusGroups = useMemo(() => ({
    container: tenant?.adminContainerRadius,
    button: tenant?.adminButtonRadius,
    input: tenant?.adminInputRadius,
    legacy: tenant?.adminCornerRadius
  }), [tenant?.adminContainerRadius, tenant?.adminButtonRadius, tenant?.adminInputRadius, tenant?.adminCornerRadius]);
  useLayoutEffect(() => {
    applyAdminRadiusTokens(document.documentElement, radiusGroups);
    applyArcThemeTokens(document.documentElement, mode === "dark", adminThemeColor);
  }, [radiusGroups, mode, adminThemeColor]);
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = resolveAdminPrimaryColor(adminThemeColor);
  }, [tenant, adminThemeColor, user]);
  return (
    <ConfigProvider
      locale={locale === "en-US" ? enUS : zhCN}
      variant="outlined"
      getPopupContainer={trigger => {
        if (trigger) return trigger.closest<HTMLElement>("[data-rental-arc-drawer]") ?? document.body;
        const drawers = document.querySelectorAll<HTMLElement>('[data-rental-arc-drawer][data-state="open"]');
        return drawers.item(drawers.length - 1) ?? document.body;
      }}
      theme={createThemeConfig(mode, adminThemeColor, radiusGroups)}
    >
      <QueryClientProvider client={queryClient}>
        <AntdApp>
          <FeedbackProvider>
            <GlobalInteractionSounds />
            <BrandIconProvider><RouterProvider router={router} /></BrandIconProvider>
          </FeedbackProvider>
        </AntdApp>
      </QueryClientProvider>
    </ConfigProvider>
  );
}

export function App() {
  return <LocaleProvider><AppearanceProvider><ThemedApp /></AppearanceProvider></LocaleProvider>;
}
