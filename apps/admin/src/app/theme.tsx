import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { theme, type ThemeConfig } from "antd";

export type AppearanceMode = "default" | "dark" | "compact";

interface AppearanceContextValue {
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
}

const STORAGE_KEY = "rental_admin_appearance";
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/**
 * 侧栏底色。浅色下比内容面板的白略沉——白色留给内容区，两者靠底色差与描边区分；
 * 深色下沿用外壳底色，与之前一致。
 *
 * 走 CSS 变量而不是 antd 的 `Layout.lightSiderBg`：常驻侧栏是 `Layout.Sider`，
 * 窄屏那份是 Drawer 里的普通 div，后者拿不到 Sider 的组件 token。
 * 一个变量同时管住两处，颜色仍然只写在这个文件里。
 */
const SIDER_BG: Record<AppearanceMode, string> = {
  default: "#f7f7f7",
  compact: "#f7f7f7",
  dark: "var(--rental-color-bg-layout)"
};

function readInitialMode(): AppearanceMode {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "dark" || stored === "compact" || stored === "default" ? stored : "default";
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppearanceMode>(readInitialMode);

  useEffect(() => {
    document.documentElement.dataset.appearance = mode;
    document.documentElement.style.colorScheme = mode === "dark" ? "dark" : "light";
    document.documentElement.style.setProperty("--app-sider-bg", SIDER_BG[mode]);
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
          // 侧栏底色由 SIDER_BG 经 --app-sider-bg 统一给出（常驻侧栏与窄屏抽屉共用一处），
          // 这里保留 transparent 只是兜住变量落地前的那一帧。顶栏已取消，headerBg/headerHeight 不再使用。
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
      // 工具条上的按钮偏矮，压不住 18px 的页面标题；32 → 36 只动按钮，
      // 输入框与选择器仍按全局 controlHeight，避免整站密度跟着变。
      Button: { controlHeight: 36 },
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
