import { App as AntdApp, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { AppRouter } from "./AppRouter";
import { LocaleProvider, useLocale } from "./locale";
import { queryClient } from "./queryClient";
import { AppearanceProvider, createThemeConfig, useAppearance } from "./theme";
import { useAuthStore } from "@/features/auth/authStore";
import { applyAdminFavicon } from "./branding";
import { applyAdminRadiusTokens, resolveAdminPrimaryColor } from "./designTokens";

function ThemedApp() {
  const { mode } = useAppearance();
  const { locale } = useLocale();
  const tenant = useAuthStore((state) => state.tenant);
  const user = useAuthStore((state) => state.user);
  const tenantThemeColor = tenant?.themeColor;
  // 三组独立圆角；任一组缺省回退旧统一值 adminCornerRadius，再回退平台默认。
  const radiusGroups = useMemo(() => ({
    container: tenant?.adminContainerRadius,
    button: tenant?.adminButtonRadius,
    input: tenant?.adminInputRadius,
    legacy: tenant?.adminCornerRadius
  }), [tenant?.adminContainerRadius, tenant?.adminButtonRadius, tenant?.adminInputRadius, tenant?.adminCornerRadius]);
  useLayoutEffect(() => {
    applyAdminRadiusTokens(document.documentElement, radiusGroups);
  }, [radiusGroups]);
  useEffect(() => {
    applyAdminFavicon();
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = resolveAdminPrimaryColor(tenantThemeColor);
  }, [tenant, tenantThemeColor, user]);
  return (
    <ConfigProvider
      locale={locale === "en-US" ? enUS : zhCN}
      variant="outlined"
      theme={createThemeConfig(mode, tenantThemeColor, radiusGroups)}
    >
      <QueryClientProvider client={queryClient}>
        <AntdApp>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </AntdApp>
      </QueryClientProvider>
    </ConfigProvider>
  );
}

export function App() {
  return <LocaleProvider><AppearanceProvider><ThemedApp /></AppearanceProvider></LocaleProvider>;
}
