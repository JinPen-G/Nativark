/**
 * 管理后台的排版契约。
 *
 * 页面只使用语义层级，不在组件里重新决定字号和字重。Ant Design 的基础
 * token 由 theme.tsx 消费，自定义 CSS 通过同一份 token 注入 CSS 变量。
 */
import { ADMIN_UI_CORNER_RADIUS_DEFAULT, ADMIN_UI_CORNER_RADIUS_DEFAULTS, ADMIN_UI_CORNER_RADIUS_CONTROL_MAX, ADMIN_UI_CORNER_RADIUS_MAX, ADMIN_UI_CORNER_RADIUS_MIN } from "@rental-os/shared";

export const ADMIN_FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";

export const ADMIN_DEFAULT_PRIMARY_COLOR = "#353535";
/** Neutral hierarchy follows UIArc in both themes. Status and tenant accent remain separate roles. */
export const ADMIN_CONTENT_TONES = {
  primary: "var(--foreground)",
  secondary: "var(--text-secondary)",
  quiet: "var(--text-muted)",
  divider: "var(--border-subtle)",
  hover: "var(--surface-muted)",
} as const;
/** Operating lists use compact text, not dashboard metric typography. */
export const ADMIN_LIST_TYPOGRAPHY = {
  primary: { size: 13, lineHeight: 18, weight: 500 },
  secondary: { size: 12, lineHeight: 17, weight: 400 },
  header: { size: 12, lineHeight: 18, weight: 400 },
  summary: { size: 13, lineHeight: 20, weight: 400 },
  summaryValue: { size: 13, lineHeight: 20, weight: 500 },
} as const;
export const ARC_DEFAULT_RADII = { container: 26, button: 18, input: 18 } as const;
/** Screen defaults are separate from reserved native components such as the 26px HoverCard. */
export const ADMIN_DEFAULT_RADII = ADMIN_UI_CORNER_RADIUS_DEFAULTS;
/** Idle text/search fields share the same theme-aware edge as date/select controls. */
export const ADMIN_INPUT_COLORS = { borderDefault: "var(--border)" } as const;
/** Navigation tabs and segmented criteria share neutral selection ink, never brand accent. */
export const ADMIN_CHOICE_STYLE = { text: "var(--text-muted)", selectedText: "var(--foreground)", weight: 500 } as const;
/** One density scale for UIArc and Ant compatibility; settings visibility is irrelevant. */
export const ADMIN_CONTROL_HEIGHT = { small: 32, default: 36, large: 40, toolbar: 32, filter: 36 } as const;
/** Widths express field roles, not individual pages. Forms may still fill their grid cell. */
export const ADMIN_CONTROL_WIDTH = { search: 320, searchMin: 240, select: 192, field: 240, wide: 320, number: 160, compact: 96, date: 192, dateRange: 288 } as const;
/** List queries use compact role widths; form grids retain their existing sizing. */
export const ADMIN_LIST_CONTROL_WIDTH = { ...ADMIN_CONTROL_WIDTH, search: 280, searchMin: 200, select: 160, date: 160, dateRange: 256, selectWide: 224 } as const;
export const ADMIN_CONTROL_PADDING = { small: 8, default: 12, large: 16 } as const;
/** Task surfaces: compact decisions, contextual editing, file workflows. */
export const ADMIN_OVERLAY_METRICS = { dialogWidth: 520, sideWidth: 720, bottomWidth: 720, padding: 24, viewportInset: 32 } as const;
/** Original segmented track has 3px padding plus a 1px frame on each side. */
export const ADMIN_SEGMENTED_METRICS = { frameInset: 8 } as const;
/** Original TabsList has 4px padding and a 1px frame on each side. */
export const ADMIN_TABS_METRICS = { frameInset: 10 } as const;
/** Reusable list geometry. Pages consume roles, never private field/column sizes. */
export const ADMIN_LIST_METRICS = { queryMinWidth: 760, searchWidth: ADMIN_LIST_CONTROL_WIDTH.search, searchMinWidth: ADMIN_LIST_CONTROL_WIDTH.searchMin, statusWidth: ADMIN_LIST_CONTROL_WIDTH.select, statusMinWidth: ADMIN_LIST_CONTROL_WIDTH.select, categoryInlineMinWidth: 400, compactTriggerMaxWidth: 360, moreSearchWidth: 144, moreSearchCompactWidth: 64, filterPopoverWidth: 320, adaptiveSelectMin: 76, adaptiveSelectMax: 280, adaptiveSelectInset: 56 } as const;
export const ADMIN_TABLE_COLUMN_WIDTH = {
  select: 52, identifier: 180, identity: 176, summary: 216, dateTime: 176, dateTimeWithNote: 184,
  money: 120, status: 155, actions: 208, resources: 240, location: 210, security: 190, snapshot: 210,
} as const;
/** Shared shell spacing. The first row follows UIArc Kanban's 52px row and 20/12px insets;
 * individual pages never compensate for breadcrumb/action placement. */
export const ADMIN_LAYOUT_SPACING = {
  contextHeight: 52,
  contextOpticalInset: "var(--space-1)",
  contextInlineStart: "var(--space-5)",
  contextInlineEnd: "var(--space-3)",
  pageTop: "0px",
  headerContent: "var(--space-2)",
  tabsContent: "var(--space-2)",
  listToolbar: "var(--space-2)",
  section: "var(--space-4)",
  inline: "var(--space-2)",
} as const;
/** Dense operational metrics fit the available width rather than leave an orphaned row. */
export const ADMIN_DASHBOARD_METRICS = { cardMinWidth: 200 } as const;
export const ADMIN_INSIGHT_METRICS = { gap: 20, panelPadding: 20, donutSize: 176, donutThickness: 18, contributionHeight: 300 } as const;
export const ADMIN_SETTINGS_METRICS = { navWidth: 192, compactAt: 720 } as const;
export const ADMIN_PERMISSION_MATRIX_METRICS = { labelWidth: 288, roleWidth: 184, compactLabelWidth: 164, compactRoleWidth: 172 } as const;
/** Detail pages read left to right: business context, then a compact ledger summary. */
export const ADMIN_DETAIL_LAYOUT = { summaryWidth: ADMIN_CONTROL_WIDTH.wide, accountLabelWidth: ADMIN_CONTROL_WIDTH.select } as const;
/** 52px ordinary rows; text stacks use compact lines while interactive targets retain 32px. */
export const ADMIN_TABLE_METRICS = { leadingHeight: 32, rowMinHeight: 52, cellPaddingBlock: 8, textGap: 1, listAvatarSize: 28, compactHeaderHeight: 36, statusHeight: 24, statusRadiusMax: 6, identitySize: 32, identityIconSize: 16, identityRadiusMax: 8, columnWidth: 180, actionsWidth: ADMIN_TABLE_COLUMN_WIDTH.actions, columnMinWidth: 56, contentMinWidth: 112, expandWidth: 52 } as const;
/** Structural loading geometry; controls/type/colors continue to use their existing roles. */
export const ADMIN_LOADING_METRICS = { rows: 6, rowHeight: ADMIN_TABLE_METRICS.rowMinHeight, textRadius: 4 } as const;
export const ADMIN_EMPTY_METRICS = { artWidth: 240, artCompactWidth: 144 } as const;
export const ADMIN_LIST_CAPABILITY_METRICS = { cardMinWidth: 280, bulkMaxWidth: 760, previewMaxHeight: 320 } as const;
export const ADMIN_RECORD_CARD_METRICS = { mediaHeight: 190, titleSize: 15, titleLineHeight: 21, metricSize: 22 } as const;
/** Animate UI PageTransition stack, adapted to the current router/runtime. */
export const ADMIN_NAVIGATION_MOTION = { durationMs: 500, easing: "cubic-bezier(.4, 0, .1, 1)", retreatScale: .94, retreatOpacity: .6 } as const;
/** Small live-content changes use Animate UI's fade timing; never remount forms. */
export const ADMIN_CONTENT_MOTION = { changedOpacity: .76, selectionOffset: 8 } as const;
export const ADMIN_ICON_METRICS = { controlSize: 16, controlStroke: 1.75, titleSize: 22 } as const;
/** UIArc sign-in reference roles; the operating pages keep their own density. */
export const ADMIN_LOGIN_METRICS = { titleSize: 40, titleLineHeight: 44, titleWeight: 400, compactTitleSize: 32, compactTitleLineHeight: 35.2, brandHeight: 24, providerIconSize: 17 } as const;
/** App sidebar geometry for Chinese menus; source primitives retain their original defaults. */
export const ADMIN_SIDEBAR_METRICS = { expandedWidth: 240, collapsedWidth: 48, mobileWidth: 288, menuHeight: 32, submenuHeight: 32, menuGap: 2, groupLabelHeight: 24, iconSize: 18, triggerSize: 28, avatarSize: 32, submenuMinWidth: 160 } as const;
/** Match the breadcrumb centre from the sidebar's outer inset, including the panel border. */
export const ADMIN_SHELL_METRICS = { panelInset: 8, sidebarWidth: 248, sidebarCollapsedWidth: 56, topRowHeight: ADMIN_LAYOUT_SPACING.contextHeight + 2, workspaceHeight: 48, workspaceMarkSize: 22, triggerSize: 32, accountHeight: 44, tenantNameSize: 13, tenantNameLineHeight: 18, workspaceNameSize: 12, workspaceNameLineHeight: 14 } as const;
/** UIArc screen-shell: width and submenu height share the same non-overshooting spring. */
export const ADMIN_SIDEBAR_REFERENCE_MOTION = {
  layout: { type: "spring", visualDuration: 0.3, bounce: 0 },
  label: { duration: 0.15, ease: [0.22, 1, 0.36, 1] },
  contentEnter: { duration: 0.2 },
  contentExit: { duration: 0.14 },
} as const;
/** Status ink and surface are paired independently of the tenant brand color. */
export const ADMIN_STATUS_COLORS = {
  light: { success: ["#176B45", "#EDF7F0"], warning: ["#925600", "#FFF5E3"], error: ["#B42332", "#FFF0F1"], info: ["#2359B8", "#EDF3FF"], neutral: ["#535B66", "#F1F3F5"] },
  dark: { success: ["#8DDBB3", "#1B3329"], warning: ["#F4CC86", "#3A2D1B"], error: ["#FFADB4", "#3E2329"], info: ["#A5C7FF", "#203149"], neutral: ["#C0C6CF", "#2C3037"] },
} as const;

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
 * 品牌色转 `r, g, b`（供登录页左栏渐变用 `rgba(var(--login-brand-rgb), alpha)`）。
 * 复用同一份十六进制校验，非法/缺省时回退品牌默认色，不把任意租户输入拼进 CSS。
 */
export function resolveAdminPrimaryColorRgb(value?: string | null): string {
  const hex = resolveAdminPrimaryColor(value).slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/**
 * 租户可配置的后台基础圆角。这里只接受平台规定的整数范围，
 * 旧会话或异常数据也会在前端安全回退，不把任意值写进 CSS。
 */
export function resolveAdminCornerRadius(value?: number | null, max = ADMIN_UI_CORNER_RADIUS_MAX) {
  if (!Number.isInteger(value)) return ADMIN_UI_CORNER_RADIUS_DEFAULT;
  return Math.min(max, Math.max(ADMIN_UI_CORNER_RADIUS_MIN, value as number));
}

export const ADMIN_TYPOGRAPHY = {
  body: { size: 14, lineHeight: 20, weight: 400 },
  pageTitle: { size: 18, lineHeight: 26, weight: 500 },
  pageSubtitle: { size: 13, lineHeight: 20, weight: 400 },
  sectionTitle: { size: 14, lineHeight: 20, weight: 500 },
  panelTitle: { size: 14, lineHeight: 20, weight: 500 },
  label: { size: 14, lineHeight: 22, weight: 400 },
  meta: { size: 12, lineHeight: 20, weight: 400 },
  tableMoney: { size: 13, lineHeight: 18, weight: 500 },
  metric: { size: 24, lineHeight: 32, weight: 600 },
  loginTitle: { size: 24, lineHeight: 32, weight: 600 }
} as const;

const px = (value: number) => `${value}px`;

/** 三组独立圆角（容器/按钮/输入）；任一组留空时回退旧的统一圆角，再回退平台默认。 */
export interface AdminRadiusGroups {
  container?: number | null;
  button?: number | null;
  input?: number | null;
  /** 旧的统一圆角，作为三组共同的回退基准（迁移期兼容）。 */
  legacy?: number | null;
}

/** 旧统一值保留容器倍率，但与显式分组一样受当前常用范围约束。 */
function legacyContainerRadius(unified: number) {
  return Math.min(ADMIN_UI_CORNER_RADIUS_MAX, Math.round(unified * 1.33));
}

/**
 * 解析某一组圆角：显式设了该组值就按字面像素用；否则回退旧的统一圆角——
 * 容器沿用旧倍率；各组都在显示边界截到当前上限。无分组和统一值时采用 Screen 的角色默认值。
 * 此处只解析显示，不更新服务端或缓存中的历史配置。
 */
export function resolveAdminRadiusGroup(value: number | null | undefined, legacy: number | null | undefined, kind: "container" | "button" | "input") {
  const max = kind === "container" ? ADMIN_UI_CORNER_RADIUS_MAX : ADMIN_UI_CORNER_RADIUS_CONTROL_MAX;
  if (Number.isInteger(value)) return resolveAdminCornerRadius(value, max);
  if (!Number.isInteger(legacy)) return ADMIN_DEFAULT_RADII[kind];
  const base = resolveAdminCornerRadius(legacy, max);
  return kind === "container" ? legacyContainerRadius(base) : base;
}

function toGroups(radii: AdminRadiusGroups | number | null | undefined): AdminRadiusGroups {
  return typeof radii === "number" || radii == null ? { legacy: radii ?? undefined } : radii;
}

/** 解析后的三组圆角像素值（供 CSS 变量与 antd token 共用同一口径）。 */
export function resolveAdminRadii(radii: AdminRadiusGroups | number | null | undefined) {
  const g = toGroups(radii);
  return {
    container: resolveAdminRadiusGroup(g.container, g.legacy, "container"),
    button: resolveAdminRadiusGroup(g.button, g.legacy, "button"),
    input: resolveAdminRadiusGroup(g.input, g.legacy, "input")
  };
}

/** Shared input geometry for Ant compatibility and CSS; independent of whether
 * appearance settings are exposed. Compact radii are derived only here. */
export function resolveAdminInputRadii(input: number) {
  return { borderRadius: input, borderRadiusLG: input,
    borderRadiusSM: Math.max(4, Math.round(input * 0.75)),
    borderRadiusXS: Math.max(4, Math.round(input * 0.5)) };
}

/**
 * 将三组圆角注入 CSS 变量。
 * 容器（卡片/弹窗/抽屉/表格）走 -container(=旧 -lg 别名)；按钮/分段/页签/选中菜单走 -button(=旧 -control 别名)；
 * 录入控件走 -input；胶囊 -pill 与派生小圆角 -sm 保持既有语义，圆形/头像等保形不受三档影响。
 */
export function applyAdminRadiusTokens(root: HTMLElement, radii: AdminRadiusGroups | number | null | undefined) {
  const { container, button, input } = resolveAdminRadii(radii);
  const small = Math.max(4, Math.round(button * 0.75));
  const inputRadii = resolveAdminInputRadii(input);
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(ADMIN_OVERLAY_METRICS).map(([role, value]) => [
      `--rental-overlay-${role.replace(/[A-Z]/g, part => `-${part.toLowerCase()}`)}`, px(value),
    ])),
    "--rental-ui-radius-container": px(container),
    "--rental-ui-radius-button": px(button),
    "--rental-ui-radius-input": px(input),
    "--rental-ui-radius-input-sm": px(inputRadii.borderRadiusSM),
    // 向后兼容别名：styles.css 现有选择器仍写 -lg/-control，这里让它们分别指向容器/按钮组。
    "--rental-ui-radius-lg": px(container),
    "--rental-ui-radius-control": px(button),
    "--rental-ui-radius-sm": px(small),
    "--rental-ui-radius-pill": "9999px"
  };
  for (const [name, tokenValue] of Object.entries(values)) root.style.setProperty(name, tokenValue);
}

/** 将语义 token 注入 CSS，避免自定义样式散落魔法数字。 */
export function applyAdminTypographyTokens(root: HTMLElement) {
  const values: Record<string, string> = {
    "--rental-color-input-border-default": ADMIN_INPUT_COLORS.borderDefault,
    "--rental-choice-text": ADMIN_CHOICE_STYLE.text,
    "--rental-choice-text-selected": ADMIN_CHOICE_STYLE.selectedText,
    "--rental-choice-weight": String(ADMIN_CHOICE_STYLE.weight),
    "--rental-layout-page-top-gap": ADMIN_LAYOUT_SPACING.pageTop,
    "--rental-layout-context-height": px(ADMIN_LAYOUT_SPACING.contextHeight),
    "--rental-layout-context-optical-inset": ADMIN_LAYOUT_SPACING.contextOpticalInset,
    "--rental-layout-context-inline-start": ADMIN_LAYOUT_SPACING.contextInlineStart,
    "--rental-layout-context-inline-end": ADMIN_LAYOUT_SPACING.contextInlineEnd,
    "--rental-layout-header-content-gap": ADMIN_LAYOUT_SPACING.headerContent,
    "--rental-layout-tabs-content-gap": ADMIN_LAYOUT_SPACING.tabsContent,
    "--rental-layout-list-toolbar-gap": ADMIN_LAYOUT_SPACING.listToolbar,
    "--rental-layout-section-gap": ADMIN_LAYOUT_SPACING.section,
    "--rental-layout-inline-gap": ADMIN_LAYOUT_SPACING.inline,
    "--rental-dashboard-card-min-width": px(ADMIN_DASHBOARD_METRICS.cardMinWidth),
    "--rental-insight-gap": px(ADMIN_INSIGHT_METRICS.gap),
    "--rental-insight-panel-padding": px(ADMIN_INSIGHT_METRICS.panelPadding),
    "--rental-settings-nav-width": px(ADMIN_SETTINGS_METRICS.navWidth),
    "--rental-detail-summary-width": px(ADMIN_DETAIL_LAYOUT.summaryWidth),
    "--rental-detail-account-label-width": px(ADMIN_DETAIL_LAYOUT.accountLabelWidth),
    "--rental-segmented-frame-inset": px(ADMIN_SEGMENTED_METRICS.frameInset),
    "--rental-tabs-frame-inset": px(ADMIN_TABS_METRICS.frameInset),
    ...Object.fromEntries(Object.entries(ADMIN_LOADING_METRICS).filter(([role]) => role !== "rows").map(([role, value]) => [
      `--rental-loading-${role.replace(/[A-Z]/g, part => `-${part.toLowerCase()}`)}`, px(value),
    ])),
    "--rental-control-height-toolbar": px(ADMIN_CONTROL_HEIGHT.toolbar),
    "--rental-control-height-filter": px(ADMIN_CONTROL_HEIGHT.filter),
    "--rental-control-height-small": px(ADMIN_CONTROL_HEIGHT.small),
    "--rental-control-height-default": px(ADMIN_CONTROL_HEIGHT.default),
    "--rental-control-height-large": px(ADMIN_CONTROL_HEIGHT.large),
    // Original source components consume these public geometry variables.
    "--control-height-sm": "var(--rental-control-height-small)",
    "--control-height-md": "var(--rental-control-height-default)",
    "--control-height-lg": "var(--rental-control-height-large)",
    "--rental-control-padding-small": px(ADMIN_CONTROL_PADDING.small),
    "--rental-control-padding-default": px(ADMIN_CONTROL_PADDING.default),
    "--rental-control-padding-large": px(ADMIN_CONTROL_PADDING.large),
    ...Object.fromEntries(Object.entries(ADMIN_CONTROL_WIDTH).map(([role, value]) => [
      `--rental-control-width-${role.replace(/[A-Z]/g, part => `-${part.toLowerCase()}`)}`, px(value),
    ])),
    ...Object.fromEntries(Object.entries(ADMIN_LIST_CONTROL_WIDTH).map(([role, value]) => [
      `--rental-list-control-width-${role.replace(/[A-Z]/g, part => `-${part.toLowerCase()}`)}`, px(value),
    ])),
    "--rental-list-query-min-width": px(ADMIN_LIST_METRICS.queryMinWidth),
    "--rental-list-search-width": px(ADMIN_LIST_METRICS.searchWidth),
    "--rental-list-search-min-width": px(ADMIN_LIST_METRICS.searchMinWidth),
    "--rental-list-status-width": px(ADMIN_LIST_METRICS.statusWidth),
    "--rental-list-status-min-width": px(ADMIN_LIST_METRICS.statusMinWidth),
    "--rental-list-filter-popover-width": px(ADMIN_LIST_METRICS.filterPopoverWidth),
    "--rental-table-leading-height": px(ADMIN_TABLE_METRICS.leadingHeight),
    "--rental-list-card-min-width": px(ADMIN_LIST_CAPABILITY_METRICS.cardMinWidth),
    "--rental-record-card-title-size": px(ADMIN_RECORD_CARD_METRICS.titleSize),
    "--rental-record-card-title-line-height": px(ADMIN_RECORD_CARD_METRICS.titleLineHeight),
    "--rental-record-card-metric-size": px(ADMIN_RECORD_CARD_METRICS.metricSize),
    "--rental-hover-card-native-radius": px(ARC_DEFAULT_RADII.container),
    "--rental-record-card-media-height": px(ADMIN_RECORD_CARD_METRICS.mediaHeight),
    ...Object.fromEntries(Object.entries(ADMIN_SIDEBAR_METRICS).map(([role, value]) => [
      `--rental-sidebar-${role.replace(/[A-Z]/g, part => `-${part.toLowerCase()}`)}`, px(value),
    ])),
    ...Object.fromEntries(Object.entries(ADMIN_SHELL_METRICS).map(([role, value]) => [
      `--rental-shell-${role.replace(/[A-Z]/g, part => `-${part.toLowerCase()}`)}`, px(value),
    ])),
    "--rental-navigation-duration": `${ADMIN_NAVIGATION_MOTION.durationMs}ms`,
    "--rental-navigation-easing": ADMIN_NAVIGATION_MOTION.easing,
    "--rental-navigation-retreat-scale": String(ADMIN_NAVIGATION_MOTION.retreatScale),
    "--rental-navigation-retreat-opacity": String(ADMIN_NAVIGATION_MOTION.retreatOpacity),
    "--rental-empty-art-width": px(ADMIN_EMPTY_METRICS.artWidth),
    "--rental-empty-art-compact-width": px(ADMIN_EMPTY_METRICS.artCompactWidth),
    "--rental-icon-control-size": px(ADMIN_ICON_METRICS.controlSize),
    "--rental-icon-control-stroke": String(ADMIN_ICON_METRICS.controlStroke),
    "--rental-icon-title-size": px(ADMIN_ICON_METRICS.titleSize),
    "--rental-list-bulk-max-width": px(ADMIN_LIST_CAPABILITY_METRICS.bulkMaxWidth),
    "--rental-list-preview-max-height": px(ADMIN_LIST_CAPABILITY_METRICS.previewMaxHeight),
    "--rental-table-compact-header-height": px(ADMIN_TABLE_METRICS.compactHeaderHeight),
    ...Object.fromEntries(Object.entries(ADMIN_CONTENT_TONES).map(([role, value]) => [`--rental-content-${role}`, value])),
    ...Object.fromEntries(Object.entries(ADMIN_LIST_TYPOGRAPHY).flatMap(([role, values]) =>
      Object.entries(values).map(([property, value]) => [`--rental-list-${role.replace(/[A-Z]/g, part => `-${part.toLowerCase()}`)}-${property.replace(/[A-Z]/g, part => `-${part.toLowerCase()}`)}`, property === "weight" ? String(value) : px(value)]))),
    "--rental-table-row-min-height": px(ADMIN_TABLE_METRICS.rowMinHeight),
    "--rental-table-cell-padding-block": px(ADMIN_TABLE_METRICS.cellPaddingBlock),
    "--rental-table-text-line-height": px(ADMIN_LIST_TYPOGRAPHY.primary.lineHeight),
    "--rental-table-meta-line-height": px(ADMIN_LIST_TYPOGRAPHY.secondary.lineHeight),
    "--rental-table-text-gap": px(ADMIN_TABLE_METRICS.textGap),
    "--rental-table-list-avatar-size": px(ADMIN_TABLE_METRICS.listAvatarSize),
    "--rental-table-status-height": px(ADMIN_TABLE_METRICS.statusHeight),
    "--rental-table-status-radius-max": px(ADMIN_TABLE_METRICS.statusRadiusMax),
    "--rental-table-identity-size": px(ADMIN_TABLE_METRICS.identitySize),
    "--rental-table-identity-icon-size": px(ADMIN_TABLE_METRICS.identityIconSize),
    "--rental-table-identity-radius-max": px(ADMIN_TABLE_METRICS.identityRadiusMax),
    // Decorative identity colors, not success/warning semantics. Original series tokens
    // follow the current theme; blend with foreground for readable small initials.
    "--rental-table-identity-1": "color-mix(in oklab, var(--series-1) 45%, var(--foreground))",
    "--rental-table-identity-2": "color-mix(in oklab, var(--series-2) 45%, var(--foreground))",
    "--rental-table-identity-3": "color-mix(in oklab, var(--series-3) 45%, var(--foreground))",
    "--rental-table-identity-4": "color-mix(in oklab, var(--series-4) 45%, var(--foreground))",
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
    "--rental-typography-table-money-size": px(ADMIN_TYPOGRAPHY.tableMoney.size),
    "--rental-typography-table-money-line-height": px(ADMIN_TYPOGRAPHY.tableMoney.lineHeight),
    "--rental-typography-table-money-weight": String(ADMIN_TYPOGRAPHY.tableMoney.weight),
    "--rental-typography-metric-size": px(ADMIN_TYPOGRAPHY.metric.size),
    "--rental-typography-metric-line-height": px(ADMIN_TYPOGRAPHY.metric.lineHeight),
    "--rental-typography-metric-weight": String(ADMIN_TYPOGRAPHY.metric.weight),
    "--rental-typography-login-title-size": px(ADMIN_TYPOGRAPHY.loginTitle.size),
    "--rental-typography-login-title-line-height": px(ADMIN_TYPOGRAPHY.loginTitle.lineHeight),
    "--rental-typography-login-title-weight": String(ADMIN_TYPOGRAPHY.loginTitle.weight),
    "--rental-login-title-size": px(ADMIN_LOGIN_METRICS.titleSize),
    "--rental-login-title-line-height": px(ADMIN_LOGIN_METRICS.titleLineHeight),
    "--rental-login-title-weight": String(ADMIN_LOGIN_METRICS.titleWeight),
    "--rental-login-compact-title-size": px(ADMIN_LOGIN_METRICS.compactTitleSize),
    "--rental-login-compact-title-line-height": px(ADMIN_LOGIN_METRICS.compactTitleLineHeight),
    "--rental-login-brand-height": px(ADMIN_LOGIN_METRICS.brandHeight),
    "--rental-login-provider-icon-size": px(ADMIN_LOGIN_METRICS.providerIconSize)
  };

  for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value);
}
