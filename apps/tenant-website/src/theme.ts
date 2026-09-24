import type { Tenant } from './types';

export type ThemeMode = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'rental-os-theme';

/** Platform brand defaults used until a tenant supplies its own theme settings. */
export const PLATFORM_THEME = {
  primaryColor: '#007aff',
  secondaryColor: '#eaf1f9',
} as const;

export function getInitialTheme(): ThemeMode {
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyColorMode(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = mode === 'dark' ? '#000000' : '#ffffff';
}

function textOnBackground(hex: string): '#142638' | '#ffffff' {
  const normalized = hex.replace('#', '');
  if (!/^[\da-fA-F]{6}$/.test(normalized)) return '#ffffff';
  const channels = [0, 2, 4].map(index => parseInt(normalized.slice(index, index + 2), 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.38 ? '#142638' : '#ffffff';
}

export function applyTenantTheme(tenant: Tenant) {
  const root = document.documentElement;
  const primaryColor = tenant.primaryColor?.trim() || PLATFORM_THEME.primaryColor;
  // 只注入主色与其对比色；--brand-soft / --brand-soft-contrast 由 CSS 按主色派生（见 styles.css :root），
  // 这样次要色随主题色联动，不再依赖会与主题脱节的独立 secondaryColor。
  root.style.setProperty('--brand', primaryColor);
  root.style.setProperty('--brand-contrast', textOnBackground(primaryColor));
}
