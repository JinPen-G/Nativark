import { Emitter } from "./events";
import { cachedMerchant, merchantEvents } from "./merchant";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

/**
 * 客户端主题：租户主题色 + 系统深/浅色跟随（档位二）。
 *
 * 1) 主题色：app.wxss 把 `--primary / --primary-weak / --primary-dark` 定义在 page 上，
 *    主色元素都读这三个变量；用 page-meta 的 page-style 覆盖即可整体跟随租户色。
 * 2) 深浅色：app.wxss 用 `@media (prefers-color-scheme: dark)` 覆盖中性 token（背景/卡片/文字/边框），
 *    走 var(--token) 的元素自动跟随；图标颜色编在 SVG 里、媒体查询覆盖不到，改由本模块提供
 *    语义色板（semanticColor）+ 主题事件（themeEvents），ui-icon 按当前深浅解析并在切换时重渲染。
 */
const SYSTEM_PRIMARY = "#1677FF";

/* ---------------- 深/浅色（跟随系统或用户手动指定） ---------------- */
export type ThemeMode = "light" | "dark";
/** 用户在设置里的选择：system=跟随系统，light/dark=强制。默认 system。 */
export type ThemePreference = "system" | "light" | "dark";
export const THEME_PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

let systemMode: ThemeMode = "light";
let preference: ThemePreference = "system";
let started = false;
let restored = false;
/** 有效深浅色变化事件（system 或手动切换后的最终结果）。 */
export const themeEvents = new Emitter<ThemeMode>();

function readSystemTheme(): ThemeMode {
  try {
    const info = typeof wx.getAppBaseInfo === "function" ? wx.getAppBaseInfo() : (wx.getSystemInfoSync() as unknown as { theme?: string });
    return info.theme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function restorePreference(): void {
  if (restored) return;
  restored = true;
  const saved = readStorage<ThemePreference>(STORAGE_KEYS.themeMode);
  if (saved === "light" || saved === "dark" || saved === "system") preference = saved;
}

function resolvedMode(): ThemeMode {
  return preference === "system" ? systemMode : preference;
}

/** 由 app.onLaunch 调用一次：读系统主题与用户偏好，并监听系统切换（仅在 system 偏好下改变有效主题）。 */
export function startThemeWatch(): void {
  if (started) return;
  started = true;
  restorePreference();
  systemMode = readSystemTheme();
  syncNativeTheme();
  if (typeof wx.onThemeChange === "function") {
    wx.onThemeChange((res) => {
      const next: ThemeMode = res.theme === "dark" ? "dark" : "light";
      if (next === systemMode) return;
      const before = resolvedMode();
      systemMode = next;
      syncNativeTheme();
      if (preference === "system" && resolvedMode() !== before) themeEvents.emit(resolvedMode());
    });
  }
}

/** 当前有效深浅色（考虑用户偏好覆盖系统）。 */
export function currentTheme(): ThemeMode {
  if (!started) systemMode = readSystemTheme();
  restorePreference();
  return resolvedMode();
}

export function themePreference(): ThemePreference {
  restorePreference();
  return preference;
}

/** 设置页调用：保存用户偏好并广播有效主题变化（不变则不广播）。 */
export function setThemePreference(next: ThemePreference): void {
  restorePreference();
  if (next === preference) return;
  const before = resolvedMode();
  preference = next;
  writeStorage(STORAGE_KEYS.themeMode, next);
  syncNativeTheme();
  if (resolvedMode() !== before) themeEvents.emit(resolvedMode());
}

/**
 * 手动强制深浅色时，系统媒体查询 `@media (prefers-color-scheme)` 不再匹配用户意图，
 * 需要页面根用 class 兜底。返回应加到 page-style 之外的主题 class（供 <page-meta root-class> 或页面根 class 使用）。
 * system 偏好返回空串（走系统媒体查询）；强制时返回 theme-light / theme-dark。
 */
export function themeRootClass(): string {
  restorePreference();
  return preference === "system" ? "" : preference === "dark" ? "theme-dark" : "theme-light";
}

/* ---------------- 语义色板（供 ui-icon 按主题取色） ---------------- */
/**
 * 图标语义色：键是语义名，值是 [浅色, 深色] 十六进制。
 * WXML 里 <ui-icon color="text"> 用语义名；仍兼容直接传 #RRGGBB（原样使用、不随主题变）。
 * 品牌/状态色（primary/price/gold…）深浅色下保持一致，不翻转，避免丢品牌观感；
 * 只翻转中性色（文字/次要/更弱/反白）。
 */
const SEMANTIC_COLORS: Record<string, [string, string]> = {
  text: ["#1F2329", "#E6E8EB"],
  secondary: ["#8A94A6", "#8B93A1"],
  muted: ["#B4BBC8", "#5A6373"],
  primary: [SYSTEM_PRIMARY, SYSTEM_PRIMARY],
  onPrimary: ["#FFFFFF", "#FFFFFF"],
  price: ["#FF4D3A", "#FF6A5A"],
  gold: ["#F5C15C", "#F5C15C"],
  navy: ["#1E2B4F", "#C7D2E8"],
  success: ["#22A06B", "#3FBF87"],
  warning: ["#E8890C", "#F0A63C"],
  danger: ["#E5484D", "#F26F73"]
};

/** 解析图标颜色：语义名 → 按当前主题取 hex；直接传的 #RRGGBB 原样返回。 */
export function semanticColor(nameOrHex: string, mode: ThemeMode = currentTheme()): string {
  if (nameOrHex === "primary") return normalizeHex(cachedMerchant()?.themeColor) ?? SYSTEM_PRIMARY;
  const pair = SEMANTIC_COLORS[nameOrHex];
  if (pair) return mode === "dark" ? pair[1] : pair[0];
  return nameOrHex; // 兼容旧的直接 hex
}

/**
 * 同步原生底部 TabBar；页面主题由 WXSS 控制，原生 TabBar 不会继承页面 CSS 变量。
 *
 * 底栏中性色（背景/未选中/边框）优先交给 theme.json：darkmode 下微信按系统深浅自动切换，
 * 冷启动首屏即正确、切换零延迟，且不依赖 JS 执行时机。因此“跟随系统 + 租户用系统默认主色”时
 * 直接返回，让 theme.json 全权托底；只有两种情况需要 JS 用 setTabBarStyle 覆盖：
 * 1) 租户自定义了主题色（theme.json 是静态的，注入不了动态选中色）；
 * 2) 用户在设置里强制了浅/深（此时 theme.json 仍跟系统走，必须纠正）。
 */
export function syncNativeTheme(): void {
  restorePreference();
  const tenantPrimary = normalizeHex(cachedMerchant()?.themeColor);
  if (preference === "system" && (!tenantPrimary || tenantPrimary === SYSTEM_PRIMARY)) return;
  const dark = currentTheme() === "dark";
  try {
    wx.setTabBarStyle({
      color: semanticColor("secondary"),
      selectedColor: semanticColor("primary"),
      backgroundColor: dark ? "#1E2127" : "#FFFFFF",
      borderStyle: dark ? "black" : "white"
    });
  } catch {
    // TabBar 尚未初始化时由 App.onShow 或主题变化后的下一次同步重试。
  }
}

function normalizeHex(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const raw = input.trim();
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u.exec(raw);
  if (!m) return undefined;
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${hex.toUpperCase()}`;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** 把 #RRGGBB 按比例调暗（factor<1）用于 --primary-dark（按下态）。 */
function darken(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clampChannel(((n >> 16) & 0xff) * factor);
  const g = clampChannel(((n >> 8) & 0xff) * factor);
  const b = clampChannel((n & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0").toUpperCase()}`;
}

/** 生成 --primary-weak（浅底：次按钮/信息条背景），用低透明度 rgba 保证任何主色都协调。 */
function weak(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, 0.12)`;
}

/**
 * 当前租户主题色对应的 page-style 覆盖串；未设置或非法时返回空串（页面用系统默认色）。
 * 页面把它绑定到 <page-meta page-style="{{themeStyle}}">。
 */
export function themeStyle(color?: string): string {
  const hex = normalizeHex(color ?? cachedMerchant()?.themeColor);
  if (!hex || hex === SYSTEM_PRIMARY) return "";
  return `--primary: ${hex}; --primary-dark: ${darken(hex, 0.85)}; --primary-weak: ${weak(hex)};`;
}

/**
 * 页面接主题的便捷封装：立刻写入 themeStyle（租户主色覆盖）与 themeClass（强制深/浅色的根 class），
 * 并订阅商户信息与深浅色切换（任一变化即刷新）。返回取消订阅函数，页面在 onUnload 调用。
 * 页面 data 需有 themeStyle / themeClass 字段，并在 <page-meta page-style="{{themeStyle}}" root-class="{{themeClass}}">。
 */
export function bindTheme(page: { setData: (data: Record<string, unknown>) => void }): () => void {
  const apply = () => page.setData({ themeStyle: themeStyle(), themeClass: themeRootClass() });
  apply();
  const offMerchant = merchantEvents.on(() => apply());
  const offTheme = themeEvents.on(() => apply());
  return () => { offMerchant(); offTheme(); };
}
