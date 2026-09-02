import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { theme, type ThemeConfig } from "antd";

export type AppearanceMode = "default" | "dark" | "compact";

interface AppearanceContextValue {
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
}

const STORAGE_KEY = "rental_admin_appearance";
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function readInitialMode(): AppearanceMode {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "dark" || stored === "compact" || stored === "default" ? stored : "default";
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppearanceMode>(readInitialMode);

  useEffect(() => {
    document.documentElement.dataset.appearance = mode;
    document.documentElement.style.colorScheme = mode === "dark" ? "dark" : "light";
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const value = useMemo(() => ({ mode, setMode: setModeState }), [mode]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("useAppearance must be used inside AppearanceProvider");
  return context;
}

export function createThemeConfig(mode: AppearanceMode): ThemeConfig {
  const light = mode !== "dark";
  const algorithm = mode === "dark"
    ? theme.darkAlgorithm
    : mode === "compact"
      ? [theme.defaultAlgorithm, theme.compactAlgorithm]
      : theme.defaultAlgorithm;

  return {
    algorithm,
    cssVar: { key: `rental-os-${mode}`, prefix: "rental" },
    token: {
      colorPrimary: "#1677ff",
      colorInfo: "#1677ff",
      colorSuccess: "#52c41a",
      colorWarning: "#faad14",
      colorError: "#ff4d4f",
      ...(light ? { colorBgLayout: "#f5f8ff" } : {}),
      borderRadius: 6,
      fontSize: 14,
      fontWeightStrong: 600
    },
    components: {
      Layout: {
        ...(light ? {
          bodyBg: "#f5f8ff",
          footerBg: "#f5f8ff",
          // 侧栏与外框同底：侧栏不再是白色面板，白色留给内容区，
          // 两者靠间隙与描边区分（顶栏已取消，headerBg/headerHeight 不再使用）。
          siderBg: "transparent",
          triggerBg: "#f0f5ff",
          triggerColor: "rgba(0, 0, 0, 0.88)"
        } : { siderBg: "transparent" })
      },
      Menu: {
        activeBarBorderWidth: 0,
        itemBg: "transparent",
        subMenuItemBg: "transparent",
        // 二级全部常显后侧栏很长，行高压到 36 让首屏多放两三项；
        // 选中态的白卡在 .sider-nav 里用 inset 阴影画，不靠 itemSelectedBg。
        itemHeight: 36,
        itemBorderRadius: 8,
        subMenuItemBorderRadius: 8,
        itemMarginInline: 0
      },
      Card: {
        headerHeight: 56,
        bodyPadding: 24
      },
      Table: {
        cellPaddingBlock: 12,
        cellPaddingInline: 8,
        headerBg: light ? "#fafafa" : undefined,
        headerBorderRadius: 8,
        rowHoverBg: light ? "#f5f8ff" : undefined
      },
      Tabs: { horizontalItemGutter: 24 },
      Progress: light ? {
        circleTextColor: "rgba(0, 0, 0, 0.88)",
        defaultColor: "#1677ff",
        remainingColor: "rgba(0, 0, 0, 0.06)"
      } : {}
    }
  };
}
