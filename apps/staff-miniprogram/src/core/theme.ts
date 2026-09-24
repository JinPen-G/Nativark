import { Emitter } from "./events";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

/**
 * 员工端主题：系统深/浅色跟随 + 用户手动指定。员工端是平台工具，不套租户品牌色，主色固定为系统蓝。
 *
 * app.wxss 用 `@media (prefers-color-scheme: dark)` 覆盖中性 token；走 var(--token) 的元素自动跟随。
 * 图标颜色编在 SVG 里、媒体查询覆盖不到，由本模块提供语义色板（semanticColor）+ 主题事件（themeEvents），
 * ui-icon 按当前深浅解析并在切换时重渲染。
 */
const SYSTEM_PRIMARY = "#1677FF";

export type ThemeMode = "light" | "dark";
export type ThemePreference = "system" | "light" | "dark";
export const THEME_PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

let systemMode: ThemeMode = "light";
let preference: ThemePreference = "system";
let started = false;
let restored = false;
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

export function currentTheme(): ThemeMode {
  if (!started) systemMode = readSystemTheme();
  restorePreference();
  return resolvedMode();
}

export function themePreference(): ThemePreference {
  restorePreference();
  return preference;
}

export function setThemePreference(next: ThemePreference): void {
  restorePreference();
  if (next === preference) return;
  const before = resolvedMode();
  preference = next;
  writeStorage(STORAGE_KEYS.themeMode, next);
  syncNativeTheme();
  if (resolvedMode() !== before) themeEvents.emit(resolvedMode());
}

/** 强制深浅色时页面根 class；system 偏好返回空串（走系统媒体查询）。 */
export function themeRootClass(): string {
  restorePreference();
  return preference === "system" ? "" : preference === "dark" ? "theme-dark" : "theme-light";
}

const SEMANTIC_COLORS: Record<string, [string, string]> = {
  text: ["#1F2329", "#E6E8EB"],
  secondary: ["#8A94A6", "#9AA3B2"],
  muted: ["#B4BBC8", "#5A6373"],
  primary: [SYSTEM_PRIMARY, SYSTEM_PRIMARY],
  onPrimary: ["#FFFFFF", "#FFFFFF"],
  price: ["#FF4D3A", "#FF6A5A"],
  gold: ["#F5C15C", "#F5C15C"],
  navy: ["#1E2B4F", "#C7D2E8"],
  success: ["#22A06B", "#3FBF87"],
  warning: ["#E8890C", "#F0A63C"],
  danger: ["#E5484D", "#F26F73"],
  purple: ["#7C5CFF", "#9B84FF"],
  teal: ["#0FA3B1", "#3CC4D0"]
};

export function semanticColor(nameOrHex: string, mode: ThemeMode = currentTheme()): string {
  const pair = SEMANTIC_COLORS[nameOrHex];
  if (pair) return mode === "dark" ? pair[1] : pair[0];
  return nameOrHex;
}

/** 原生底栏跟随：仅在用户强制深浅色（theme.json 只跟系统）时用 JS 覆盖。 */
export function syncNativeTheme(): void {
  restorePreference();
  if (preference === "system") return;
  const dark = currentTheme() === "dark";
  try {
    wx.setTabBarStyle({
      color: semanticColor("secondary"),
      selectedColor: SYSTEM_PRIMARY,
      backgroundColor: dark ? "#1E2127" : "#FFFFFF",
      borderStyle: dark ? "black" : "white"
    });
  } catch {
    // TabBar 尚未初始化时由下一次同步重试。
  }
}

/** 员工端不套租户色，page-style 恒为空串；保留函数以复用 theme-behavior。 */
export function themeStyle(): string {
  return "";
}

export function bindTheme(page: { setData: (data: Record<string, unknown>) => void }): () => void {
  const apply = () => page.setData({ themeStyle: themeStyle(), themeClass: themeRootClass() });
  apply();
  return themeEvents.on(() => apply());
}
