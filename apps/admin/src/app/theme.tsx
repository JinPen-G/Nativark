import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { theme, type ThemeConfig } from "antd";
import { getArcPalette } from "./arcTokens";
import { ADMIN_STATUS_COLORS, ADMIN_FONT_FAMILY, ADMIN_TYPOGRAPHY, ADMIN_LIST_TYPOGRAPHY, ADMIN_TABLE_METRICS, ADMIN_CONTROL_HEIGHT, ADMIN_CONTROL_PADDING, applyAdminTypographyTokens, resolveAdminRadii, resolveAdminInputRadii, type AdminRadiusGroups } from "@/app/designTokens";
import type { ThemeSwitchVariant } from "@/registry/components/theme-switch/theme-switch";
import { isMotionReduced } from "./motionPreferences";

export type AppearanceMode = "default" | "dark" | "compact";
export type AppearancePreference = AppearanceMode | "system";
export type AppearanceTransition = Extract<ThemeSwitchVariant, "eclipse" | "rise" | "reveal"> | "legacy-reveal";

/**
 * UIArc 原站的直边横向 reveal 扫屏。`rise`（上下）和旧的 `legacy-reveal`（圆形）仍完整保留，
 * 只是不作为当前后台的默认动效；需要切换时由 AppearanceSwitcher 的 transition 指定。
 */
export const DEFAULT_APPEARANCE_TRANSITION: AppearanceTransition = "reveal";

/** 切换来源；仅旧 legacy-reveal 需要用触发控件定位圆心。 */
interface AppearanceOrigin {
  element?: HTMLElement | null;
  transition?: AppearanceTransition;
}

interface AppearanceContextValue {
  mode: AppearanceMode;
  preference: AppearancePreference;
  setMode: (mode: AppearancePreference, origin?: AppearanceOrigin) => void;
}

const STORAGE_KEY = "rental_admin_appearance";
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function readInitialMode(): AppearancePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "system" || stored === "dark" || stored === "compact" || stored === "default" ? stored : "default";
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
 * 旧圆形揭示（BoardUI 同款，保留但不默认启用）。
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

/**
 * UIArc 原站页面 CSS：/_next/static/css/35c9d8b23d654900.css，2026-10-01 核对。
 * reveal：inset(0 100% 0 0) → inset(0)，380ms；rise：inset(100% 0 0) → inset(0)，360ms。
 * 两种主题均按同一路径揭示，缓动保持 cubic-bezier(.22,1,.36,1)。
 * eclipse 是原站另外提供的居中椭圆，不作为默认策略。
 *
 * 旧圆形效果单独命名为 legacy-reveal，保留但不默认启用。
 */
function themeTransitionStyle(transition: AppearanceTransition, next: AppearanceMode, origin?: AppearanceOrigin) {
  if (transition === "reveal") {
    return `
      ::view-transition-new(root) { animation: rental-theme-wipe 380ms cubic-bezier(.22,1,.36,1) both; }
      @keyframes rental-theme-wipe {
        from { clip-path: inset(0 100% 0 0); }
        to { clip-path: inset(0); }
      }
    `;
  }
  if (transition === "eclipse") {
    return `
      ::view-transition-new(root) { animation: rental-theme-eclipse 430ms cubic-bezier(.22,1,.36,1) both; }
      @keyframes rental-theme-eclipse {
        from { clip-path: ellipse(0 110%); }
        to { clip-path: ellipse(80% 110%); }
      }
    `;
  }

  if (transition === "rise") {
    return `
      ::view-transition-new(root) { animation: rental-theme-rise 360ms cubic-bezier(.22,1,.36,1) both; }
      @keyframes rental-theme-rise {
        from { clip-path: inset(100% 0 0); }
        to { clip-path: inset(0); }
      }
    `;
  }

  // 旧圆形揭示保留为 legacy-reveal：从切换按钮中心扩散，未作为默认效果使用。
  const rect = origin?.element?.getBoundingClientRect();
  const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const x = Math.min(Math.max(centerX, 0), window.innerWidth);
  const y = Math.min(Math.max(centerY, 0), window.innerHeight);
  const size = 2.5 * Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const offsetX = x - size / 2;
  const offsetY = y - size / 2;
  return `
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
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preference, setModeState] = useState<AppearancePreference>(readInitialMode);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const mode: AppearanceMode = preference === "system" ? (systemDark ? "dark" : "default") : preference;
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const revealTimer = useRef<number>(0);
  const revealing = useRef(false);

  const setMode = useCallback((next: AppearancePreference, origin?: AppearanceOrigin) => {
    const root = document.documentElement;
    const transitionKind = origin?.transition ?? DEFAULT_APPEARANCE_TRANSITION;

    /**
     * 无 View Transitions 或用户要求减少动效时，退回原来的即时切换。
     *
     * 因此这条路径的行为与本文件原有的实现完全一致：只在变量落地那几帧关过渡。
     */
    if (!document.startViewTransition || isMotionReduced()) {
      root.dataset.themeSwitching = "";
      window.clearTimeout(revealTimer.current);
      revealTimer.current = window.setTimeout(() => { delete root.dataset.themeSwitching; }, THEME_SWITCH_MS);
      setModeState(next);
      return;
    }

    // 一次只放一个页面过渡：动画期间重复点击直接丢弃，否则两张快照会互相打架。
    if (revealing.current) return;
    revealing.current = true;

    /**
     * 页面过渡期间同样关掉全局过渡：否则变量落地那几帧里，有过渡的元素还在慢慢染色，
     * 会被拍进"新帧"快照，和横扫/升起/圆形效果叠成两层动画。
     */
    root.dataset.themeSwitching = "";
    window.clearTimeout(revealTimer.current);

    const revealStyle = document.createElement("style");
    revealStyle.id = THEME_REVEAL_STYLE_ID;
    revealStyle.textContent = themeTransitionStyle(transitionKind, next === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default") : next, origin);
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
    // Resize/hidden documents can abort snapshot creation: ready rejects separately
    // from finished, so handle both without changing the selected theme or motion.
    void transition.ready.catch(() => undefined);
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
    document.documentElement.dataset.theme = mode === "dark" ? "dark" : "light";
    document.documentElement.style.colorScheme = mode === "dark" ? "dark" : "light";
    // 常驻菜单与移动抽屉共用 UIArc 原版背景；深浅色由 foundation token 控制。
    document.documentElement.style.setProperty("--app-sider-bg", "var(--background)");
    window.localStorage.setItem(STORAGE_KEY, preference);
  }, [mode, preference]);

  const value = useMemo(() => ({ mode, preference, setMode }), [mode, preference, setMode]);

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

export function createThemeConfig(mode: AppearanceMode, tenantThemeColor?: string | null, radii?: AdminRadiusGroups | number | null): ThemeConfig {
  const light = mode !== "dark";
  const palette = getArcPalette(!light, tenantThemeColor);
  const primaryColor = palette.primary;
  // 三组独立圆角：容器（卡片/弹窗/抽屉/表格）、按钮（含分段/页签/选中菜单）、输入（录入控件）。
  // 全局基准取按钮组，容器走 borderRadiusLG，输入走各录入组件 token；圆形/胶囊保形不受此影响。
  const { container, button, input } = resolveAdminRadii(radii);
  const inputRadii = resolveAdminInputRadii(input);
  const radiusXs = Math.max(4, Math.round(button * 0.5));
  const radiusSm = Math.max(4, Math.round(button * 0.75));
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
      colorInfo: ADMIN_STATUS_COLORS[mode === "dark" ? "dark" : "light"].info[0],
      // Link、文字按钮和主按钮必须使用同一品牌色；hover/active 色阶交给
      // antd 根据这个主色生成，保留深浅主题下的可见反馈。
      colorLink: primaryColor,
      // Supply complete pairs: algorithm-derived pastel aliases can otherwise
      // turn into muddy green/grey in compatibility notices and status dots.
      ...Object.fromEntries(Object.entries({ Success: "success", Warning: "warning", Error: "error", Info: "info" } as const).flatMap(([name, tone]) => {
        const [ink, surface] = ADMIN_STATUS_COLORS[mode === "dark" ? "dark" : "light"][tone];
        return [[`color${name}`, ink], [`color${name}Text`, ink], [`color${name}TextActive`, ink], [`color${name}TextHover`, ink],
          [`color${name}Bg`, surface], [`color${name}BgHover`, surface], [`color${name}Border`, surface]];
      })),
      colorBgLayout: palette.background,
      colorBgContainer: palette.surface,
      colorBgElevated: palette.raised,
      colorText: palette.foreground,
      colorTextSecondary: palette.secondary,
      colorBorder: palette.border,
      borderRadius: button,
      borderRadiusXS: radiusXs,
      borderRadiusSM: radiusSm,
      borderRadiusLG: container,
      fontFamily: ADMIN_FONT_FAMILY,
      fontSize: ADMIN_TYPOGRAPHY.body.size,
      lineHeight: ADMIN_TYPOGRAPHY.body.lineHeight / ADMIN_TYPOGRAPHY.body.size,
      fontWeightStrong: ADMIN_TYPOGRAPHY.sectionTitle.weight,
      controlHeight: ADMIN_CONTROL_HEIGHT.default,
      controlHeightSM: ADMIN_CONTROL_HEIGHT.small,
      controlHeightLG: ADMIN_CONTROL_HEIGHT.large
    },
    components: {
      Layout: {
        ...(light ? {
          bodyBg: palette.background,
          footerBg: palette.background,
          // 侧栏底色由 UIArc --background 经 --app-sider-bg 统一给出（常驻侧栏与窄屏抽屉共用一处），
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
        itemBorderRadius: button,
        subMenuItemBorderRadius: button,
        itemMarginInline: 0
      },
      Card: {
        headerHeight: 56,
        bodyPadding: 24
      },
      // 录入控件（输入组）独立圆角：与按钮/容器分档，表单里输入框可单独设方/圆。
      Input: { ...inputRadii },
      InputNumber: { ...inputRadii },
      Select: { ...inputRadii },
      DatePicker: { ...inputRadii },
      Cascader: { ...inputRadii },
      TreeSelect: { ...inputRadii },
      Mentions: { ...inputRadii },
      // Same scale as UIArc, including explicit small/large and fallback links.
      Button: { paddingInline: ADMIN_CONTROL_PADDING.default, paddingInlineSM: ADMIN_CONTROL_PADDING.small, paddingInlineLG: ADMIN_CONTROL_PADDING.large, borderRadius: button, borderRadiusLG: button, borderRadiusSM: Math.max(4, Math.round(button * 0.75)) },
      Table: {
        cellPaddingBlock: ADMIN_TABLE_METRICS.cellPaddingBlock,
        cellPaddingInline: 8,
        cellFontSize: ADMIN_LIST_TYPOGRAPHY.primary.size,
        headerColor: palette.secondary,
        headerBg: palette.surface,
        // antd 用 headerBorderRadius 同时决定表头首尾圆角与整表外圆角(tableRadius)。
        // 容器组取 999 极致档时 borderRadiusLG≈999 会把表头背景挤成帐篷形；表格是数据密集面，
        // 表头圆角收敛到 ≤24：正常档取 radiusSm(按钮派生的小圆角)，只压掉极致档的畸形。
        headerBorderRadius: Math.min(radiusSm, 24),
        // 表格悬停是交互反馈，不应永远显示系统默认蓝灰色。
        rowHoverBg: palette.muted
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
