/** 公共SaaS身份、人员及设置契约。
 * 可从@rental-os/shared/platform独立消费，不依赖业务Core、行业实体或框架。
 * Rental会话的空间/品类字段由原兼容契约扩展，本文件只维护唯一公共声明。 */

export enum TenantStatus {
  Active = "active",
  Frozen = "frozen",
  Disabled = "disabled"
}

export enum OrganizationType {
  Operator = "operator",
  CarShop = "car_shop",
  Store = "store",
  Station = "station"
}

export enum RoleScope {
  Operator = "operator",
  CarShop = "car_shop",
  Store = "store",
  Station = "station"
}

export enum ConfigStatus {
  Draft = "draft",
  Effective = "effective",
  Archived = "archived"
}

export interface TenantIdentity {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  /** SaaS管理员设置的后台营运商简称；省略时继续使用tenantName，不替代对客brandName。 */
  operatorShortName?: string;
  tenantStatus: TenantStatus;
  /** 租户客户端渠道配置的品牌展示名；未设置时回退 tenantName。 */
  brandName?: string;
  /** 租户品牌横版 Logo 地址；管理后台仅作展示，不承载凭证。 */
  brandLogoUrl?: string;
  /** 租户浏览器图标地址；未设置时回退平台图标。 */
  faviconUrl?: string;
  /** 租户通用客户端配置的主题色；未设置时管理端与客户端各自回退默认色。 */
  themeColor?: string;
  /** 管理后台基础控件圆角（px，旧字段/回退基准）；由租户在受限范围内配置，未设置时使用平台默认值。 */
  adminCornerRadius?: number;
  /** 容器（卡片/弹窗/抽屉/表格）圆角（px）；未设置时回退 adminCornerRadius 再回退平台默认。 */
  adminContainerRadius?: number;
  /** 按钮/分段/选中菜单圆角（px）；未设置时回退 adminCornerRadius 再回退平台默认。 */
  adminButtonRadius?: number;
  /** 输入/选择/日期等录入控件圆角（px）；未设置时回退 adminCornerRadius 再回退平台默认。 */
  adminInputRadius?: number;
}

/** 管理后台普通圆角：容器 4–20px，按钮/输入 4–16px；头像、圆形图标与开关保留原形。 */
export const ADMIN_UI_CORNER_RADIUS_MIN = 4;

export const ADMIN_UI_CORNER_RADIUS_MAX = 20;

export const ADMIN_UI_CORNER_RADIUS_CONTROL_MAX = 16;

export const ADMIN_UI_CORNER_RADIUS_DEFAULT = 12;

/** UIArc Metrics Dashboard / Product listing Screen 的角色默认值。 */
export const ADMIN_UI_CORNER_RADIUS_DEFAULTS = { container: 12, button: 8, input: 8 } as const;

/** @deprecated 仅标识历史存量；新保存请求不接受此值，也不提供对应档位。 */
export const ADMIN_UI_CORNER_RADIUS_FULL = 999;

export interface AuthUser {
  id: string;
  tenantId: string;
  account: string;
  displayName: string;
  roleNames: string[];
  roleIds?: string[];
  scope: RoleScope;
  dataScope?: SystemDataScope;
  /** 当前会话的履约地点数据范围；用于隐藏越权的组织映射入口，服务端仍会独立校验。 */
  locationScope?: { mode: "all" | "selected"; locationIds: string[] };
  organizationId?: string;
  organizationName?: string;
  isPlatformAdmin?: boolean;
  isSaasAdmin?: boolean;
  mustChangePassword?: boolean;
  permissions?: string[];
  /** 账户级管理后台主题色（#RRGGBB），跟随登录账户、与租户品牌色（TenantContext.themeColor）相互独立；未设置时管理后台主色回退平台默认色。 */
  accountThemeColor?: string;
  tenantMembership?: {
    permissions: string[];
    dataScope: SystemDataScope;
    isTenantAdmin: boolean;
  };
}

export interface LoginRequest {
  tenantCode: string;
  account: string;
  password: string;
}

/** 仅本机开发环境可用：提交后服务端只存哈希，不返回密码。 */
export interface ResetLocalDemoPasswordRequest {
  password: string;
}

export interface ResetLocalDemoPasswordResult {
  reset: true;
  accounts: string[];
}

export interface RefreshSessionRequest {
  refreshToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface PlatformTenantSummary {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  operatorShortName?: string;
  tenantStatus: TenantStatus;
  enabledBusinessLines: string[];
  userCount?: number;
  organizationCount?: number;
  statusReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ResetUserPasswordResult {
  userId: string;
  account: string;
  temporaryPassword: string;
  message: string;
}

export interface UpdateTenantRequest {
  tenantName: string;
  /** 省略保持原值，null或空字符串清空并回到全称展示。 */
  operatorShortName?: string | null;
}

export interface UpdateTenantStatusRequest {
  status: TenantStatus;
  reason: string;
}

export interface OrganizationSummary {
  id: string;
  tenantId: string;
  parentId?: string;
  type: RoleScope;
  code: string;
  name: string;
  status: "enabled" | "disabled";
}

export interface SaveOrganizationRequest {
  id?: string;
  tenantId: string;
  parentId?: string;
  type: RoleScope;
  code: string;
  name: string;
  status: "enabled" | "disabled";
  operator?: string;
}

export interface PermissionLeaf {
  code: string;
  name: string;
  description?: string;
}

export interface PermissionModule {
  code: string;
  name: string;
  children: PermissionLeaf[];
}

export type SystemDataScope = "all" | "organization" | "store" | "own";

export interface SystemRoleRow {
  id: string;
  tenantId?: string;
  code: string;
  name: string;
  description?: string;
  scope: RoleScope;
  fixedAllPermissions: boolean;
  enabledBusinessScopes: string[];
  isActive: boolean;
  permissions: string[];
  buttonPermissions: string[];
  dataScope: SystemDataScope;
}

export interface SaveSystemRoleRequest {
  id?: string;
  tenantId?: string;
  code: string;
  name: string;
  description?: string;
  scope: RoleScope;
  enabledBusinessScopes: string[];
  permissions: string[];
  buttonPermissions?: string[];
  dataScope?: SystemDataScope;
  isActive: boolean;
}

export interface SystemUserRow {
  id: string;
  tenantId: string;
  account: string;
  displayName: string;
  phone?: string;
  organizationId?: string;
  organizationName?: string;
  roleIds: string[];
  roleNames: string[];
  scope: RoleScope;
  isPlatformAdmin: boolean;
  isSaasAdmin?: boolean;
  mustChangePassword?: boolean;
  temporaryPassword?: string;
  isActive: boolean;
  permissions: string[];
  dataScope: SystemDataScope;
  /** 员工小程序专用的履约地点范围；不改变 Web 后台原有空间可见口径。 */
  locationScope?: { mode: "all" | "selected"; locationIds: string[] };
}

export interface SaveSystemUserRequest {
  id?: string;
  /** SaaS 管理员可指定；租户内管理员省略时由当前会话租户补齐。 */
  tenantId?: string;
  account: string;
  displayName: string;
  phone?: string;
  organizationId?: string;
  roleIds: string[];
  isPlatformAdmin?: boolean;
  isSaasAdmin?: boolean;
  isActive: boolean;
}

export interface SystemSecurityBaselineConfig {
  loginRateLimit: {
    enabled: boolean;
    maxFailures: number;
    windowMinutes: number;
    lockMinutes: number;
  };
  passwordPolicy: {
    minLength: number;
    requireLetter: boolean;
    requireNumber: boolean;
    disallowDefaultPassword: boolean;
    expireDays: number;
  };
  masking: {
    phone: boolean;
    identityNo: boolean;
    driverLicenseNo: boolean;
    email: boolean;
    apiKey: boolean;
  };
  secondConfirmation: {
    enabled: boolean;
    actions: string[];
  };
}

export interface PlatformAuditLogRow {
  id: string;
  tenantId: string;
  /** 经营域审计必填；平台域动作不属于任何经营空间时为空。 */
  workspaceId?: string;
  action: string;
  operator: string;
  targetType: string;
  targetId?: string;
  detail: string;
  createdAt: string;
}

export interface PlatformAuditLogQuery {
  tenantId?: string;
  action?: string;
  operator?: string;
  targetType?: string;
  limit?: number;
}

export interface PlatformAuditResult {
  rows: PlatformAuditLogRow[];
  total: number;
}

export interface PlatformDictionaryItem {
  code: string;
  label: string;
  value: string;
  sortNo: number;
  enabled: boolean;
  remark?: string;
}

export interface PlatformDictionaryGroup {
  code: string;
  name: string;
  module: string;
  description?: string;
  items: PlatformDictionaryItem[];
  updatedAt: string;
  updatedBy: string;
}

export interface SavePlatformDictionaryGroupRequest {
  code: string;
  name: string;
  module: string;
  description?: string;
  items: PlatformDictionaryItem[];
  operator: string;
}

export interface PlatformNumberRule {
  code: string;
  name: string;
  module: string;
  prefix: string;
  datePattern: "yyyyMMdd" | "yyyyMM" | "yyMMdd" | "none";
  sequenceLength: number;
  currentSequence: number;
  resetCycle: "daily" | "monthly" | "yearly" | "never";
  enabled: boolean;
  sample: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SavePlatformNumberRuleRequest {
  code: string;
  name: string;
  module: string;
  prefix: string;
  datePattern: PlatformNumberRule["datePattern"];
  sequenceLength: number;
  currentSequence?: number;
  resetCycle: PlatformNumberRule["resetCycle"];
  enabled: boolean;
  operator: string;
}

export interface GeneratePlatformNumberRequest {
  code: string;
  operator: string;
}

export interface GeneratePlatformNumberResult {
  code: string;
  generatedNo: string;
  nextSequence: number;
}

export type PlatformFilterPresetScope =
  | "rental-os.orders"
  | "rental-os.vehicles"
  | "rental-os.members"
  | "rental-os.corporates"
  | "rental-os.stations"
  | "rental-os.vehicle-transfer"
  | "rental-os.contracts";

export interface PlatformFilterPreset {
  id: string;
  tenantId: string;
  scopeKey: PlatformFilterPresetScope;
  name: string;
  description?: string;
  filters: Record<string, unknown>;
  isDefault: boolean;
  isSystem: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface PlatformFilterPresetQuery {
  tenantId?: string;
  scopeKey?: PlatformFilterPresetScope;
}

export interface SavePlatformFilterPresetRequest {
  id?: string;
  tenantId?: string;
  scopeKey: PlatformFilterPresetScope;
  name: string;
  description?: string;
  filters: Record<string, unknown>;
  isDefault?: boolean;
  operator?: string;
}

export interface SetPlatformFilterPresetDefaultRequest {
  operator?: string;
}

export interface DeletePlatformFilterPresetResult {
  id: string;
  deleted: boolean;
}

/**
 * 品牌与外观（管理后台 UI 身份）——从客户端渠道配置中拆出的独立领域。
 * 覆盖品牌标识（名称/Logo/Favicon）、主题色与四个圆角分组；主题色同时作用于客户端与管理后台，
 * 圆角作用于管理后台。数据独立存于 tenant_appearance_profiles，与客户端渠道内容分离。
 */
export interface TenantAppearanceProfile {
  brandName?: string;
  brandLogoUrl?: string;
  faviconUrl?: string;
  /** 客户端与管理后台主色（#RRGGBB）；未设置各端回退系统默认色。 */
  themeColor?: string;
  /** 旧的统一圆角回退基准；读取保留历史 24/40/999，显示时按角色上限收敛，不在读取时改库。 */
  adminCornerRadius?: number;
  /** 容器（卡片/弹窗/抽屉/表格）圆角。 */
  adminContainerRadius?: number;
  /** 按钮/分段/页签/选中菜单圆角。 */
  adminButtonRadius?: number;
  /** 输入/选择/日期等录入控件圆角。 */
  adminInputRadius?: number;
  /** 乐观锁修订号。 */
  revision: number;
  updatedAt?: string;
}

/** 保存品牌与外观。expectedRevision 保留原乐观并发；省略圆角字段保持原值，显式 null 清除该覆盖。 */
export interface SaveTenantAppearanceRequest {
  expectedRevision?: number;
  brandName?: string;
  brandLogoUrl?: string;
  faviconUrl?: string;
  themeColor?: string;
  /** 旧统一基准及容器只接受 4–20px 整数，不接受历史极值重新写入。 */
  adminCornerRadius?: number | null;
  adminContainerRadius?: number | null;
  /** 按钮与输入只接受 4–16px 整数。 */
  adminButtonRadius?: number | null;
  adminInputRadius?: number | null;
}

/** 账户级外观（跟随登录账户，与租户品牌色相互独立）。目前仅管理后台主题色。 */
export interface AccountAppearanceProfile {
  /** 该账户的管理后台主题色（#RRGGBB）；未设置时管理后台主色回退平台默认色。 */
  themeColor?: string;
  updatedAt?: string;
}

/** 保存账户级外观（管理后台「外观与音效」页）。留空=清除→回退平台默认色。 */
export interface SaveAccountAppearanceRequest {
  themeColor?: string;
}

export interface AdminLoginBranding {
  /** Defaults to visible. Explicit false hides the section without restoring default text. */
  showTitle?: boolean;
  showDescription?: boolean;
  showHighlights?: boolean;
  showFooter?: boolean;
  backgroundImageUrl?: string;
  title?: string;
  description?: string;
  highlights?: Array<{ title?: string; description?: string }>;
  footerText?: string;
}

export interface PlatformLoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tenant: TenantIdentity;
  user: AuthUser;
  needsTenantOnboarding?: boolean;
}

export interface PlatformSessionContextResponse {
  tenant: TenantIdentity;
  user: AuthUser;
}
