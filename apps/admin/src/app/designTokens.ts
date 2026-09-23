/**
 * 管理后台的排版契约。
 *
 * 页面只使用语义层级，不在组件里重新决定字号和字重。Ant Design 的基础
 * token 由 theme.tsx 消费，自定义 CSS 通过同一份 token 注入 CSS 变量。
 */
export const ADMIN_FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";

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
