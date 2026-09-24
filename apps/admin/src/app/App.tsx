import { App as AntdApp, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { useEffect } from "react";
import { AppRouter } from "./AppRouter";
import { LocaleProvider, useLocale } from "./locale";
import { queryClient } from "./queryClient";
import { AppearanceProvider, createThemeConfig, useAppearance } from "./theme";
import { useAuthStore } from "@/features/auth/authStore";
import { applyAdminFavicon, resolveAdminFavicon } from "./branding";

function ThemedApp() {
  const { mode } = useAppearance();
  const { locale } = useLocale();
  const tenant = useAuthStore((state) => state.tenant);
  const user = useAuthStore((state) => state.user);
  const tenantThemeColor = tenant?.themeColor;
  useEffect(() => {
    applyAdminFavicon(resolveAdminFavicon(tenant, user));
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = tenantThemeColor || "#1677FF";
  }, [tenant, tenantThemeColor, user]);
  return (
    <ConfigProvider
      locale={locale === "en-US" ? enUS : zhCN}
      variant="outlined"
      theme={createThemeConfig(mode, tenantThemeColor)}
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
