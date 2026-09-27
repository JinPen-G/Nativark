/**
 * 管理后台的排版契约。
 *
 * 页面只使用语义层级，不在组件里重新决定字号和字重。Ant Design 的基础
 * token 由 theme.tsx 消费，自定义 CSS 通过同一份 token 注入 CSS 变量。
 */
import { ADMIN_UI_CORNER_RADIUS_DEFAULT, ADMIN_UI_CORNER_RADIUS_FULL, ADMIN_UI_CORNER_RADIUS_MAX, ADMIN_UI_CORNER_RADIUS_MIN } from "@rental-os/shared";

export const ADMIN_FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";

export const ADMIN_DEFAULT_PRIMARY_COLOR = "#1677FF";

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u;

/** 只接受服务端约束的十六进制颜色，避免把租户输入直接写入 CSS。 */
export function resolveAdminPrimaryColor(value?: string | null) {
  const raw = value?.trim() ?? "";
  if (!HEX_COLOR_PATTERN.test(raw)) return ADMIN_DEFAULT_PRIMARY_COLOR;
  const hex = raw.slice(1);
  const expanded = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
  return `#${expanded.toUpperCase()}`;
}

/**
 * 租户可配置的后台基础圆角。这里只接受平台规定的整数范围，
 * 旧会话或异常数据也会在前端安全回退，不把任意值写进 CSS。
 */
export function resolveAdminCornerRadius(value?: number | null) {
  if (!Number.isInteger(value)) return ADMIN_UI_CORNER_RADIUS_DEFAULT;
  // 「极致圆角」是离散档，直接放行，不参与 8-20 的区间夹取。
  if (value === ADMIN_UI_CORNER_RADIUS_FULL) return ADMIN_UI_CORNER_RADIUS_FULL;
  return Math.min(ADMIN_UI_CORNER_RADIUS_MAX, Math.max(ADMIN_UI_CORNER_RADIUS_MIN, value as number));
}

export const ADMIN_TYPOGRAPHY = {
  body: { size: 14, lineHeight: 22, weight: 400 },
  pageTitle: { size: 20, lineHeight: 28, weight: 600 },
  pageSubtitle: { size: 13, lineHeight: 20, weight: 400 },
  sectionTitle: { size: 16, lineHeight: 24, weight: 600 },
  panelTitle: { size: 14, lineHeight: 22, weight: 600 },
  label: { size: 14, lineHeight: 22, weight: 400 },
  meta: { size: 12, lineHeight: 20, weight: 400 },
  metric: { size: 24, lineHeight: 32, weight: 600 },
  loginTitle: { size: 24, lineHeight: 32, weight: 600 }
} as const;

const px = (value: number) => `${value}px`;

/** 将圆角语义 token 注入 CSS；Tabs、选中菜单和普通按钮共用 control 圆角。 */
export function applyAdminRadiusTokens(root: HTMLElement, value?: number | null) {
  const control = resolveAdminCornerRadius(value);
  const small = Math.max(4, Math.round(control * 0.75));
  const large = Math.min(24, Math.round(control * 1.33));
  const values: Record<string, string> = {
    "--rental-ui-radius-control": px(control),
    "--rental-ui-radius-sm": px(small),
    "--rental-ui-radius-lg": px(large),
    "--rental-ui-radius-pill": "9999px"
  };
  for (const [name, tokenValue] of Object.entries(values)) root.style.setProperty(name, tokenValue);
}

/** 将语义 token 注入 CSS，避免自定义样式散落魔法数字。 */
export function applyAdminTypographyTokens(root: HTMLElement) {
  const values: Record<string, string> = {
    "--rental-typography-font-family": ADMIN_FONT_FAMILY,
    "--rental-typography-body-size": px(ADMIN_TYPOGRAPHY.body.size),
    "--rental-typography-body-line-height": px(ADMIN_TYPOGRAPHY.body.lineHeight),
    "--rental-typography-body-weight": String(ADMIN_TYPOGRAPHY.body.weight),
    "--rental-typography-page-title-size": px(ADMIN_TYPOGRAPHY.pageTitle.size),
    "--rental-typography-page-title-line-height": px(ADMIN_TYPOGRAPHY.pageTitle.lineHeight),
    "--rental-typography-page-title-weight": String(ADMIN_TYPOGRAPHY.pageTitle.weight),
    "--rental-typography-page-subtitle-size": px(ADMIN_TYPOGRAPHY.pageSubtitle.size),
    "--rental-typography-page-subtitle-line-height": px(ADMIN_TYPOGRAPHY.pageSubtitle.lineHeight),
    "--rental-typography-page-subtitle-weight": String(ADMIN_TYPOGRAPHY.pageSubtitle.weight),
    "--rental-typography-section-title-size": px(ADMIN_TYPOGRAPHY.sectionTitle.size),
    "--rental-typography-section-title-line-height": px(ADMIN_TYPOGRAPHY.sectionTitle.lineHeight),
    "--rental-typography-section-title-weight": String(ADMIN_TYPOGRAPHY.sectionTitle.weight),
    "--rental-typography-panel-title-size": px(ADMIN_TYPOGRAPHY.panelTitle.size),
    "--rental-typography-panel-title-line-height": px(ADMIN_TYPOGRAPHY.panelTitle.lineHeight),
    "--rental-typography-panel-title-weight": String(ADMIN_TYPOGRAPHY.panelTitle.weight),
    "--rental-typography-label-size": px(ADMIN_TYPOGRAPHY.label.size),
    "--rental-typography-label-line-height": px(ADMIN_TYPOGRAPHY.label.lineHeight),
    "--rental-typography-label-weight": String(ADMIN_TYPOGRAPHY.label.weight),
    "--rental-typography-meta-size": px(ADMIN_TYPOGRAPHY.meta.size),
    "--rental-typography-meta-line-height": px(ADMIN_TYPOGRAPHY.meta.lineHeight),
    "--rental-typography-meta-weight": String(ADMIN_TYPOGRAPHY.meta.weight),
    "--rental-typography-metric-size": px(ADMIN_TYPOGRAPHY.metric.size),
    "--rental-typography-metric-line-height": px(ADMIN_TYPOGRAPHY.metric.lineHeight),
    "--rental-typography-metric-weight": String(ADMIN_TYPOGRAPHY.metric.weight),
    "--rental-typography-login-title-size": px(ADMIN_TYPOGRAPHY.loginTitle.size),
    "--rental-typography-login-title-line-height": px(ADMIN_TYPOGRAPHY.loginTitle.lineHeight),
    "--rental-typography-login-title-weight": String(ADMIN_TYPOGRAPHY.loginTitle.weight)
  };

  for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value);
}
