import type { Tenant } from "./types";

export type ThemeMode = "light" | "dark";
export const THEME_STORAGE_KEY = "rental-os-theme";

/** Platform brand defaults used until a tenant supplies its own theme settings. */
export const PLATFORM_THEME = {
  primaryColor: "#000000",
  secondaryColor: "#ffffff",
} as const;

export function getInitialTheme(): ThemeMode {
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function applyColorMode(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  const themeColor = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (themeColor) themeColor.content = mode === "dark" ? "#000000" : "#ffffff";
}

/** 页签沿用当前租户身份，内置演示标志随明暗模式切换。 */
export function applyTenantFavicon(tenant: Tenant, mode: ThemeMode) {
  const icon = document.querySelector<HTMLLinkElement>("#site-favicon");
  if (!icon) return;
  const defaults = new Set(["/brand/yicheng.svg", "/brand/yicheng-dark.svg"]);
  const custom = tenant.logoCompact && !defaults.has(tenant.logoCompact);
  icon.href = custom
    ? tenant.logoCompact
    : mode === "dark"
      ? "/brand/yicheng-dark.svg"
      : "/brand/yicheng.svg";
  if (custom) icon.removeAttribute("type");
  else icon.type = "image/svg+xml";
}

function textOnBackground(hex: string): "#000000" | "#ffffff" {
  const normalized = hex.replace("#", "");
  if (!/^[\da-fA-F]{6}$/.test(normalized)) return "#ffffff";
  const channels = [0, 2, 4].map(
    (index) => parseInt(normalized.slice(index, index + 2), 16) / 255,
  );
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  const luminance =
    linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

export function applyTenantTheme(tenant: Tenant) {
  const root = document.documentElement;
  const primaryColor =
    tenant.primaryColor?.trim() || PLATFORM_THEME.primaryColor;
  // 主色来自当前租户配置，按钮文字按亮度选取可读的对比色。
  root.style.setProperty("--brand", primaryColor);
  root.style.setProperty("--brand-contrast", textOnBackground(primaryColor));
}
