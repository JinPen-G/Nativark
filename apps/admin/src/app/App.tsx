import { App as AntdApp, ConfigProvider } from "antd";
import { Provider as AntMotionProvider } from "@rc-component/motion";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
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
import { MotionPreferenceProvider } from "./MotionPreferenceProvider";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

// Keep existing descendant routes; data router supplies supported SPA blockers.
const router = createBrowserRouter([{ path: "*", element: <AppRouter /> }]);

function ThemedApp() {
  const { mode } = useAppearance();
  const reduced = usePrefersReducedMotion();
  const { locale } = useLocale();
  const tenant = useAuthStore((state) => state.tenant);
  const user = useAuthStore((state) => state.user);
  const pathname = useSyncExternalStore(router.subscribe, () => router.state.location.pathname);
  const isLoginRoute = /^\/login(?:\/|$)/.test(pathname);
  // 后台主色跟随**登录账户**的主题色（与租户品牌色相互独立）；未设置时回退平台默认灰。
  // Public login must never inherit a cached account's accent or tenant radii.
  // Its verified public tenant preview is scoped inside LoginPage instead.
  const adminThemeColor = isLoginRoute ? undefined : user?.accountThemeColor;
  // 三组独立圆角；任一组缺省回退旧统一值 adminCornerRadius，再回退平台默认。
  const radiusGroups = useMemo(() => isLoginRoute ? {} : ({
    container: tenant?.adminContainerRadius,
    button: tenant?.adminButtonRadius,
    input: tenant?.adminInputRadius,
    legacy: tenant?.adminCornerRadius
  }), [isLoginRoute, tenant?.adminContainerRadius, tenant?.adminButtonRadius, tenant?.adminInputRadius, tenant?.adminCornerRadius]);
  const themeConfig = createThemeConfig(mode, adminThemeColor, radiusGroups);
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
      theme={themeConfig}
    >
      {/* A permanent compatibility provider avoids Ant's conditional motion
          wrapper remounting forms when its theme.motion token first changes. */}
      <AntMotionProvider motion={!reduced}>
        <QueryClientProvider client={queryClient}>
          <AntdApp>
            <FeedbackProvider>
              <GlobalInteractionSounds />
              <BrandIconProvider><RouterProvider router={router} /></BrandIconProvider>
            </FeedbackProvider>
          </AntdApp>
        </QueryClientProvider>
      </AntMotionProvider>
    </ConfigProvider>
  );
}

export function App() {
  return <MotionPreferenceProvider><LocaleProvider><AppearanceProvider><ThemedApp /></AppearanceProvider></LocaleProvider></MotionPreferenceProvider>;
}
