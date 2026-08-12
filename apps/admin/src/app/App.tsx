import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AppRouter } from "./AppRouter";
import { AppearanceProvider, createThemeConfig, useAppearance } from "./theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000
    },
    mutations: { retry: false }
  }
});

function ThemedApp() {
  const { mode } = useAppearance();
  return (
    <ConfigProvider
      locale={zhCN}
      variant="outlined"
      theme={createThemeConfig(mode)}
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
  return <AppearanceProvider><ThemedApp /></AppearanceProvider>;
}
