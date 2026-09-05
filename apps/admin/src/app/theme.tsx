import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

/**
 * 切换主题时短暂关掉全局过渡（见 styles.css 的 `[data-theme-switching]`）。
 *
 * 「延迟变色」不是 antd 换样式慢，而是过渡动画：我们和 antd 都在按钮、菜单项、
 * 表格行、卡片上写了 `background-color` / `color` 的 0.2~0.3s 过渡。变量一换，
 * 有过渡的元素慢慢染色、没过渡的立刻到位，同一屏就会深浅混着出现。
 * 关掉过渡后颜色直接跳到新值，切换是原来那种即时切换，不遮挡也不闪。
 *
 * 120ms 覆盖住变量落地的那几帧就够；这段时间内 hover 之类的过渡也会失效，无感。
 */
const THEME_SWITCH_MS = 120;

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppearanceMode>(readInitialMode);
  const revealTimer = useRef<number>(0);

  const setMode = useCallback((next: AppearanceMode) => {
    const root = document.documentElement;
    root.dataset.themeSwitching = "";
    window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => { delete root.dataset.themeSwitching; }, THEME_SWITCH_MS);
    setModeState(next);
  }, []);

  /**
   * 这三个 DOM 写入必须在绘制前完成，因此用 useLayoutEffect。
   *
   * 放在 useEffect 里是"渲染完 → 绘制 → 再改属性"，侧栏底色与 colorScheme 会比
   * antd 的变量晚一帧生效，切换主题时看得出分层变色。localStorage 那行不影响画面，
   * 顺带留在一起，省一个 effect。
   */
  useLayoutEffect(() => {
    document.documentElement.dataset.appearance = mode;
    document.documentElement.style.colorScheme = mode === "dark" ? "dark" : "light";
    document.documentElement.style.setProperty("--app-sider-bg", SIDER_BG[mode]);
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
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
    /**
     * cssVar 的 key 必须**固定**，不能按模式取名。
     *
     * 组件样式的选择器是被这个 key 限定的：key 一变，antd 不是改几百个变量的值，
     * 而是要为新 key 重新生成全部组件样式并换 class，于是切主题时能看到侧栏、卡片、
     * 表格分批变色。key 固定后只有变量块被重写，组件样式复用，一次提交内完成。
     */
    cssVar: { key: "rental-os", prefix: "rental" },
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
