import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { theme, type ThemeConfig } from "antd";
import { ADMIN_FONT_FAMILY, ADMIN_TYPOGRAPHY, applyAdminTypographyTokens, resolveAdminCornerRadius, resolveAdminPrimaryColor } from "@/app/designTokens";

export type AppearanceMode = "default" | "dark" | "compact";

/** 切换时的揭示圆心：传触发控件，圆从它中心扩散；缺省取视口中心。 */
interface AppearanceOrigin {
  element?: HTMLElement | null;
}

interface AppearanceContextValue {
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode, origin?: AppearanceOrigin) => void;
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

/**
 * 圆形揭示（BoardUI 同款）。
 *
 * 用 View Transitions 把新旧两帧各拍一张快照，再给新帧挂一张**软边圆形遮罩**，
 * 让它从触发控件的位置扩散到覆盖全屏，而不是整屏一起变色。
 *
 * 遮罩是一张内联 SVG：白色实心圆 r=42 叠 2px 高斯模糊，模糊是为了让圆边不出现硬描边。
 * 圆在 100×100 的 viewBox 里，所以遮罩尺寸放大到 2.5R 时，实际圆半径约 1.05R——
 * 比"到最远角"的 R 多 5%，保证扩散结束时四角都已覆盖，不会留白边。
 */
const THEME_REVEAL_MS = 820;
const THEME_REVEAL_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const THEME_REVEAL_STYLE_ID = "rental-theme-reveal";
const THEME_REVEAL_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" /></filter></defs><circle cx="50" cy="50" r="42" fill="white" filter="url(#blur)" /></svg>'
)}")`;

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppearanceMode>(readInitialMode);
  const revealTimer = useRef<number>(0);
  const revealing = useRef(false);

  const setMode = useCallback((next: AppearanceMode, origin?: AppearanceOrigin) => {
    const root = document.documentElement;

    /**
     * 无 View Transitions 或用户要求减少动效时，退回原来的即时切换。
     *
     * 因此这条路径的行为与本文件原有的实现完全一致：只在变量落地那几帧关过渡。
     */
    if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.dataset.themeSwitching = "";
      window.clearTimeout(revealTimer.current);
      revealTimer.current = window.setTimeout(() => { delete root.dataset.themeSwitching; }, THEME_SWITCH_MS);
      setModeState(next);
      return;
    }

    // 一次只放一个揭示：动画期间重复点击直接丢弃，否则两张快照会互相打架。
    if (revealing.current) return;
    revealing.current = true;

    // 圆心取触发控件中点并夹进视口；半径取圆心到视口最远角的距离。
    const rect = origin?.element?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const x = Math.min(Math.max(centerX, 0), window.innerWidth);
    const y = Math.min(Math.max(centerY, 0), window.innerHeight);
    const size = 2.5 * Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const offsetX = x - size / 2;
    const offsetY = y - size / 2;

    /**
     * 揭示期间同样关掉全局过渡：否则变量落地那几帧里，有过渡的元素还在慢慢染色，
     * 会被拍进"新帧"快照，跟圆形遮罩叠成两层动画。
     */
    root.dataset.themeSwitching = "";
    window.clearTimeout(revealTimer.current);

    const revealStyle = document.createElement("style");
    revealStyle.id = THEME_REVEAL_STYLE_ID;
    revealStyle.textContent = `
      ::view-transition-new(root) {
        -webkit-mask-image: ${THEME_REVEAL_MASK};
        mask-image: ${THEME_REVEAL_MASK};
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        animation: rental-theme-reveal ${THEME_REVEAL_MS}ms ${THEME_REVEAL_EASING} both;
      }
      @keyframes rental-theme-reveal {
        from {
          -webkit-mask-position: ${x}px ${y}px;
          mask-position: ${x}px ${y}px;
          -webkit-mask-size: 0px 0px;
          mask-size: 0px 0px;
        }
        to {
          -webkit-mask-position: ${offsetX}px ${offsetY}px;
          mask-position: ${offsetX}px ${offsetY}px;
          -webkit-mask-size: ${size}px ${size}px;
          mask-size: ${size}px ${size}px;
        }
      }
    `;
    document.head.appendChild(revealStyle);

    /**
     * 必须用 flushSync：React 默认把这次 setState 排进下一批，等内容提交时
     * 快照早已拍完，新帧还是旧主题，揭示出来等于没换。flushSync 让 DOM 在
     * 回调内同步落地，View Transitions 才能拍到真正的"新"帧。
     */
    const transition = document.startViewTransition(() => {
      flushSync(() => setModeState(next));
    });

    const finish = () => {
      revealStyle.remove();
      delete root.dataset.themeSwitching;
      revealing.current = false;
    };
    // finished 在过渡被跳过时会 reject，因此两个分支都要收尾，不能只挂 then。
    void transition.finished.then(finish, finish);
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

  useLayoutEffect(() => {
    applyAdminTypographyTokens(document.documentElement);
  }, []);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("useAppearance must be used inside AppearanceProvider");
  return context;
}

export function createThemeConfig(mode: AppearanceMode, tenantThemeColor?: string | null, tenantCornerRadius?: number | null): ThemeConfig {
  const light = mode !== "dark";
  const primaryColor = resolveAdminPrimaryColor(tenantThemeColor);
  const radius = resolveAdminCornerRadius(tenantCornerRadius);
  const radiusXs = Math.max(4, Math.round(radius * 0.5));
  const radiusSm = Math.max(4, Math.round(radius * 0.75));
  const radiusLg = Math.min(24, Math.round(radius * 1.33));
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
      colorPrimary: primaryColor,
      colorInfo: primaryColor,
      // Link、文字按钮和主按钮必须使用同一品牌色；hover/active 色阶交给
      // antd 根据这个主色生成，保留深浅主题下的可见反馈。
      colorLink: primaryColor,
      colorSuccess: "#52c41a",
      colorWarning: "#faad14",
      colorError: "#ff4d4f",
      ...(light ? { colorBgLayout: "#f5f8ff" } : {}),
      borderRadius: radius,
      borderRadiusXS: radiusXs,
      borderRadiusSM: radiusSm,
      borderRadiusLG: radiusLg,
      fontFamily: ADMIN_FONT_FAMILY,
      fontSize: ADMIN_TYPOGRAPHY.body.size,
      lineHeight: ADMIN_TYPOGRAPHY.body.lineHeight / ADMIN_TYPOGRAPHY.body.size,
      fontWeightStrong: ADMIN_TYPOGRAPHY.sectionTitle.weight
    },
    components: {
      Layout: {
        ...(light ? {
          bodyBg: "#f5f8ff",
          footerBg: "#f5f8ff",
          // 侧栏底色由 SIDER_BG 经 --app-sider-bg 统一给出（常驻侧栏与窄屏抽屉共用一处），
          // 这里保留 transparent 只是兜住变量落地前的那一帧。顶栏已取消，headerBg/headerHeight 不再使用。
          siderBg: "transparent",
          triggerBg: "var(--rental-color-primary-bg)",
          triggerColor: "var(--rental-color-text)"
        } : { siderBg: "transparent" })
      },
      Menu: {
        activeBarBorderWidth: 0,
        itemBg: "transparent",
        subMenuItemBg: "transparent",
        // 二级全部常显后侧栏很长，行高压到 36 让首屏多放两三项；
        // 选中态的白卡在 .sider-nav 里用 inset 阴影画，不靠 itemSelectedBg。
        itemHeight: 36,
        itemBorderRadius: radius,
        subMenuItemBorderRadius: radius,
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
        headerBorderRadius: radiusSm,
        // 表格悬停是交互反馈，不应永远显示系统默认蓝灰色。
        rowHoverBg: "var(--rental-color-primary-bg)"
      },
      Tabs: { horizontalItemGutter: 24 },
      Progress: {
        circleTextColor: "var(--rental-color-text)",
        defaultColor: primaryColor,
        remainingColor: "var(--rental-color-fill-secondary)"
      }
    }
  };
}
