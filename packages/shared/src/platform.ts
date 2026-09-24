/**
 * 平台与系统域契约：租户、会话、组织、账号角色、系统规则、字典与编号规则。
 *
 * 从原 8683 行单文件拆出。拆分只按依赖方向切，不改任何声明——`index.ts` 仍然
 * 整体再导出，因此上百个引用方一行都不用改。
 */

import type {
  BusinessWorkspace,
  BusinessWorkspaceRunMode,
  RentalCapability,
  RentalCategoryCode,
  RentalCurrency
} from "./core";

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

export enum RentalMode {
  Rental = "rental_os",
  SelfService24h = "self_service_24h"
}

export enum OrderMainStatus {
  PendingPayment = "pending_payment",
  Reserved = "reserved",
  PickupOverdue = "pickup_overdue",
  Inspecting = "inspecting",
  Renting = "renting",
  Renewing = "renewing",
  Overdue = "overdue",
  AccidentProcessing = "accident_processing",
  SettlementPending = "settlement_pending",
  PaymentDue = "payment_due",
  RefundPending = "refund_pending",
  Completed = "completed",
  Cancelled = "cancelled",
  NoShow = "no_show",
  Rejected = "rejected",
  Closed = "closed"
}

/**
 * 车辆兼容域订单主状态的合法转移表。
 *
 * 这是该状态机唯一的成文规格：生产代码把转移规则分散在
 * `rental-os.service.ts` 的各个 action 处理器里，没有集中定义。
 * 本表由已隔离的 `tests/e2e-order-flow.test.cjs` 提炼而来，键集与
 * `OrderMainStatus` 完全一致，可供 ORDER-01 在服务端集中校验非法转移时引用。
 *
 * 空数组表示终态。
 */
export const ORDER_MAIN_STATUS_TRANSITIONS: Record<OrderMainStatus, OrderMainStatus[]> = {
  [OrderMainStatus.PendingPayment]: [OrderMainStatus.Reserved, OrderMainStatus.Cancelled],
  [OrderMainStatus.Reserved]: [
    OrderMainStatus.PickupOverdue,
    OrderMainStatus.Inspecting,
    OrderMainStatus.Cancelled,
    OrderMainStatus.NoShow
  ],
  [OrderMainStatus.PickupOverdue]: [OrderMainStatus.Cancelled, OrderMainStatus.NoShow],
  [OrderMainStatus.Inspecting]: [OrderMainStatus.Renting, OrderMainStatus.Rejected],
  [OrderMainStatus.Renting]: [
    OrderMainStatus.Renewing,
    OrderMainStatus.Overdue,
    OrderMainStatus.AccidentProcessing,
    OrderMainStatus.SettlementPending,
    OrderMainStatus.Completed
  ],
  [OrderMainStatus.Renewing]: [
    OrderMainStatus.Renting,
    OrderMainStatus.Overdue,
    OrderMainStatus.SettlementPending,
    OrderMainStatus.Completed
  ],
  [OrderMainStatus.Overdue]: [
    OrderMainStatus.SettlementPending,
    OrderMainStatus.Completed,
    OrderMainStatus.AccidentProcessing
  ],
  [OrderMainStatus.AccidentProcessing]: [OrderMainStatus.SettlementPending, OrderMainStatus.Completed],
  [OrderMainStatus.SettlementPending]: [
    OrderMainStatus.PaymentDue,
    OrderMainStatus.RefundPending,
    OrderMainStatus.Completed
  ],
  [OrderMainStatus.PaymentDue]: [OrderMainStatus.Completed, OrderMainStatus.RefundPending],
  [OrderMainStatus.RefundPending]: [OrderMainStatus.Completed, OrderMainStatus.Closed],
  [OrderMainStatus.Completed]: [],
  [OrderMainStatus.Cancelled]: [],
  [OrderMainStatus.NoShow]: [],
  [OrderMainStatus.Rejected]: [],
  [OrderMainStatus.Closed]: []
};

export enum DispatchStatus {
  Pending = "pending",
  PreAssigned = "pre_assigned",
  Locked = "locked",
  ManualReassigned = "manual_reassigned",
  Upgraded = "upgraded",
  ManualRequired = "dispatch_manual_required"
}

export enum OperationLockStatus {
  Active = "active",
  Interrupted = "interrupted",
  Expired = "expired",
  Released = "released"
}

export enum PaymentStatus {
  Unpaid = "unpaid",
  DepositPaid = "deposit_paid",
  MonthlyBilling = "monthly_billing",
  PartialPaid = "partial_paid",
  Paid = "paid",
  PaymentDue = "payment_due",
  RefundPending = "refund_pending",
  Refunded = "refunded"
}

export enum BillingMode {
  CustomerPay = "customer_pay",
  Monthly = "monthly"
}

export enum ConfigStatus {
  Draft = "draft",
  Effective = "effective",
  Archived = "archived"
}

export interface TenantContext {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  /** 租户客户端渠道配置的品牌展示名；未设置时回退 tenantName。 */
  brandName?: string;
  /** 租户品牌横版 Logo 地址；管理后台仅作展示，不承载凭证。 */
  brandLogoUrl?: string;
  /** 租户浏览器图标地址；未设置时回退平台图标。 */
  faviconUrl?: string;
  /** 租户通用客户端配置的主题色；未设置时管理端与客户端各自回退默认色。 */
  themeColor?: string;
  categoryCode?: RentalCategoryCode;
  categoryName?: string;
  capabilities?: RentalCapability[];
}

export interface AuthUser {
  id: string;
  tenantId: string;
  account: string;
  displayName: string;
  roleNames: string[];
  roleIds?: string[];
  scope: RoleScope;
  dataScope?: SystemDataScope;
  organizationId?: string;
  organizationName?: string;
  isPlatformAdmin?: boolean;
  isSaasAdmin?: boolean;
  mustChangePassword?: boolean;
  permissions?: string[];
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

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tenant: TenantContext;
  user: AuthUser;
  /** 新租户初始化管理员首次登录且已进入品类空间时，前端应打开开业配置。 */
  needsTenantOnboarding?: boolean;
  /**
   * SPACE-02：该账号可进入的经营空间（成员关系启用且空间启用）。
   * 切换空间时 refreshToken 不变，因此切换响应里它为空串。
   */
  workspaces?: BusinessWorkspace[];
  /** 当前经营空间。平台管理租户没有经营空间时为空。 */
  currentWorkspaceId?: string;
}

export interface SwitchWorkspaceRequest {
  workspaceId: string;
}

export interface SessionContextResponse {
  tenant: TenantContext;
  user: AuthUser;
  /**
   * SPACE-05：可进入的经营空间与当前空间。
   *
   * 必须由 session-context 返回，否则刷新页面后前端只剩 token，
   * 切换器无从知道「当前在哪个空间、还能去哪些空间」，只能退化成重新登录。
   */
  workspaces?: BusinessWorkspace[];
  currentWorkspaceId?: string;
  /** STAFF-BE-01：员工会话的服务端地点授权；缺省视为全部地点，仅用于兼容旧成员。 */
  locationScope?: { mode: "all" | "selected"; locationIds: string[] };
  /**
   * CORE-EXT-02C：本空间**缺失的首期必选能力**，与生产就绪标记配套。
   *
   * 两者与 `tenant.capabilities` 是不同的东西，必须分开表示（验收明确要求
   * 「空间『可访问』与『品类能力已达到生产经营条件』分开表示」）：
   * `tenant.capabilities` 决定**入口可见性**，而这两个字段决定管理端要不要显示
   * 「该空间尚未达到生产经营条件」。开发/演示空间可以继续验证通用 Core，
   * 但不得因为能进得去就被当成已具备完整品类能力。
   */
  missingRequiredCapabilities?: RentalCapability[];
  capabilityProductionReady?: boolean;
  /**
   * 当前空间的运行模式。前端据此明确标注「非生产」，而不是只靠 productionReady 猜。
   * 服务端的经营门禁也以它为准（`production` 且缺必选能力时拒绝业务写入）。
   */
  workspaceRunMode?: BusinessWorkspaceRunMode;
}

export interface RefreshSessionRequest {
  refreshToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface TenantSummary {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  enabledBusinessLines: string[];
  categoryCode?: RentalCategoryCode;
  categoryName?: string;
  capabilities?: RentalCapability[];
  /** 经营空间才是品类事实源；以下字段供 SaaS 管理面汇总展示。 */
  workspaceCount?: number;
  workspaceCategoryCodes?: RentalCategoryCode[];
  userCount?: number;
  organizationCount?: number;
  orderCount?: number;
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

/**
 * ACCESS-01C：账号资料、租户角色和经营空间成员关系的一次性提交。
 *
 * 空间授权不是账号保存后的附属请求：如果一项空间授权失败，账号和其他
 * 空间授权也不能留下半套结果。因此管理端编辑账号时必须把这组关系作为
 * 同一个事务边界提交。
 */
export interface SaveWorkspaceAccessRequest {
  workspaceId: string;
  roleId?: string;
  dataScope?: SystemDataScope;
  locationScope?: { mode: "all" | "selected"; locationIds: string[] };
  isActive: boolean;
}

export interface SaveSystemUserAccessRequest extends SaveSystemUserRequest {
  workspaceAccesses: SaveWorkspaceAccessRequest[];
}

export interface SystemRuleGiftConfig {
  enabled: boolean;
  trigger: string;
  amount: number;
  validity: number;
}

export interface SystemRuleWeeklyDay {
  id: number;
  name: string;
  isHoliday: boolean;
  isFullDay: boolean;
  startTime: string;
}

export interface SystemRuleSpecialDate {
  range: [string, string];
  type: "HOLIDAY" | "WORKDAY";
  name: string;
}

export interface SystemPushRule {
  id: string;
  category: "系统" | "订单" | "营销" | string;
  title: string;
  content: string;
  trigger: string;
  channels: Array<"APP" | "SMS" | "EMAIL">;
  enabled: boolean;
}

export interface SystemAiGuardrail {
  title: string;
  desc: string;
}

export interface SystemAiCallLog {
  time: string;
  analysisId: string;
  operator: string;
  model: string;
  promptSourceText: string;
  promptVersion: string;
  promptHash: string;
  filteredCount: number;
  status: "成功" | "失败" | "处理中" | string;
  promptText: string;
  requestPayload: string;
  responsePayload: string;
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

export interface SystemRulesConfig {
  member: {
    accountType: "MOBILE" | "ID_CARD";
    auditRequired: boolean;
    welcomeGift: SystemRuleGiftConfig;
    referralGift: SystemRuleGiftConfig;
  };
  fleet: {
    maintenance: {
      thresholdMileage: number;
      thresholdMonths: number;
      advanceKm: number;
      advanceDays: number;
    };
    cleaning: {
      thresholdCount: number;
      thresholdDays: number;
      advanceCount: number;
      advanceDays: number;
    };
  };
  calendar: {
    weekly: SystemRuleWeeklyDay[];
    specialDates: SystemRuleSpecialDate[];
  };
  push: {
    list: SystemPushRule[];
  };
  aiModel: {
    enabled: boolean;
    provider: "OPENAI" | "GEMINI" | "OPENAI_COMPATIBLE";
    baseUrl?: string;
    modelName: string;
    apiKeyMasked: string;
    promptSourceText: string;
    promptConfigVersion: string;
    promptVersion: string;
    promptHash: string;
    lastTestStatus: string;
    lastTestTime: string;
    guardrails: SystemAiGuardrail[];
    logs: SystemAiCallLog[];
  };
  security: SystemSecurityBaselineConfig;
  updatedAt: string;
  updatedBy: string;
}

export interface SaveSystemRuleSectionRequest {
  sectionKey: string;
  config: SystemRulesConfig;
  operator: string;
}

export interface SystemAiConnectionTestResult {
  status: "成功" | "失败";
  testedAt: string;
  provider: SystemRulesConfig["aiModel"]["provider"];
  modelName: string;
  message: string;
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

export interface TenantBootstrapRequest {
  tenantCode: string;
  tenantName: string;
  categoryCode: RentalCategoryCode;
  /**
   * 结算币种（需求 §948）。写进首个经营空间的业务设置，新建空间继承它，之后可按空间单独改。
   * 不填按人民币，与既有行为一致。
   */
  currency?: RentalCurrency;
  operator?: string;
  adminAccount: string;
  adminDisplayName: string;
  adminPhone?: string;
  storeName?: string;
  storeCode?: string;
}

export interface TenantBootstrapTemplateItem {
  code: string;
  name: string;
  count: number;
  reusableForGenericRental: boolean;
  remark: string;
}

export interface TenantBootstrapPreview {
  roles: Array<{ code: string; name: string; permissions: string[] }>;
  dictionaries: string[];
  numberRules: string[];
  systemRules: string[];
  templates?: TenantBootstrapTemplateItem[];
}

export interface TenantBootstrapResult {
  tenant: TenantSummary;
  adminUser: SystemUserRow;
  preview: TenantBootstrapPreview;
  templateExecution?: {
    executionId: string;
    items: TenantBootstrapTemplateItem[];
    message: string;
  };
  message: string;
  temporaryPassword?: string;
}

/* ---------- MP-01 / CLIENT-CHANNEL-01：客户端渠道配置（运营端） ---------- */

/**
 * 租户级客户端渠道配置（小程序与 APP 共用一份）：品牌、客服、协议、帮助、首页横幅、
 * 登录方式开关与发布到客户端的服务空间。渠道凭证（微信 AppID/密钥）单独保存在 MiniProgramChannelSummary。
 */
export interface ClientChannelAgreementConfig {
  /** 展示名称，如“用户服务协议”。 */
  name: string;
  /** 版本号，登录/注册留痕使用；变更须显式保存。 */
  version: string;
  /** 可选外部链接（HTTPS）。 */
  url?: string;
  /** 正文（简单富文本/纯文本），客户端内直接渲染；保存时按长度限制。 */
  body?: string;
}

export interface ClientChannelFaqItem {
  question: string;
  answer: string;
}

export interface ClientChannelReadiness {
  ready: boolean;
  /** 未完成项的可读说明，供开业配置与本页顶部提示。 */
  missing: string[];
}

/** 可发布的经营空间（当前租户全部启用空间），供后台勾选。 */
export interface ClientChannelWorkspaceOption {
  id: string;
  code: string;
  name: string;
  categoryCode: string;
  status: string;
}

export interface ClientChannelProfileSummary {
  configured: boolean;
  revision: number;
  brandName?: string;
  brandLogoUrl?: string;
  faviconUrl?: string;
  customerServicePhone?: string;
  customerServiceHours?: string;
  userAgreement?: ClientChannelAgreementConfig;
  privacyPolicy?: ClientChannelAgreementConfig;
  helpIntro?: string;
  helpFaq: ClientChannelFaqItem[];
  bannerTitle?: string;
  bannerSubtitle?: string;
  /** 客户端与管理后台主题色（#RRGGBB）；未设置时各端用系统默认色。 */
  themeColor?: string;
  smsLoginEnabled: boolean;
  passwordLoginEnabled: boolean;
  publishedWorkspaceIds: string[];
  defaultWorkspaceId?: string;
  workspaces: ClientChannelWorkspaceOption[];
  readiness: ClientChannelReadiness;
  updatedAt?: string;
}

export interface SaveClientChannelProfileRequest {
  /** 携带上次读到的修订号；不一致时拒绝保存，防止两人互相覆盖。首次保存可省略。 */
  expectedRevision?: number;
  brandName?: string;
  brandLogoUrl?: string;
  /** 浏览器标签页图标；留空回退平台默认图标。 */
  faviconUrl?: string;
  customerServicePhone?: string;
  customerServiceHours?: string;
  userAgreement?: ClientChannelAgreementConfig;
  privacyPolicy?: ClientChannelAgreementConfig;
  helpIntro?: string;
  helpFaq?: ClientChannelFaqItem[];
  bannerTitle?: string;
  bannerSubtitle?: string;
  /** 客户端与管理后台主题色（#RRGGBB）；留空表示回退系统默认色。 */
  themeColor?: string;
  smsLoginEnabled: boolean;
  passwordLoginEnabled: boolean;
  publishedWorkspaceIds: string[];
  defaultWorkspaceId?: string;
}

/**
 * web 官网渠道配置（WEBSITE-CHANNEL-01，运营端读）。只含官网特有设定项；
 * 商户名/Logo/协议/客服/帮助/发布服务仍在 ClientChannelProfileSummary。一租户一条。
 */
export interface WebsiteCategoryImage {
  /** 经营空间/服务编码（= 官网一级品类）。 */
  code: string;
  /** 品类入口图地址（HTTPS）。 */
  imageUrl: string;
}

/** 官网「为什么选择我们」卖点。icon 为可选图标键（authentic/delivery/flexible/service/quality/support…）。 */
export interface WebsiteAdvantage {
  icon?: string;
  title: string;
  description?: string;
}

/** 官网「租赁流程」步骤。 */
export interface WebsiteStep {
  title: string;
  description?: string;
}

/** 官网「用户评价 / 客户案例」。 */
export interface WebsiteTestimonial {
  name: string;
  context?: string;
  text: string;
}

export interface WebsiteChannelProfileSummary {
  configured: boolean;
  revision: number;
  /** 官网渠道是否对外启用；关闭时公开启动接口不返回官网配置。 */
  enabled: boolean;
  slogan?: string;
  heroTitle?: string;
  heroDescription?: string;
  heroImageUrl?: string;
  /** 辅助/强调色（#RRGGBB）；主色仍在通用配置的 themeColor。 */
  secondaryColor?: string;
  footerText?: string;
  contactAddress?: string;
  ctaTitle?: string;
  ctaDescription?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  showPoweredBy: boolean;
  /** 租户自定义官网域名（小写 host，不含协议/路径）；用于按 Host 反查租户。 */
  customDomain?: string;
  /** 品类入口图（按服务编码）。 */
  categoryImages: WebsiteCategoryImage[];
  /** 官网首页内容块（可编辑）；缺省时前端用通用文案 / 隐藏评价。 */
  advantages: WebsiteAdvantage[];
  steps: WebsiteStep[];
  testimonials: WebsiteTestimonial[];
  /** 可配置入口图的一级品类（当前租户已启用的经营空间）；供后台按品类填图。 */
  categories: Array<{ code: string; name: string }>;
  readiness: ClientChannelReadiness;
  updatedAt?: string;
}

export interface SaveWebsiteChannelProfileRequest {
  /** 携带上次读到的修订号；不一致时拒绝保存，防止两人互相覆盖。首次保存可省略。 */
  expectedRevision?: number;
  enabled: boolean;
  slogan?: string;
  heroTitle?: string;
  heroDescription?: string;
  /** Hero 大图地址（HTTPS，服务端做出站地址校验）。 */
  heroImageUrl?: string;
  /** 辅助/强调色（#RGB 或 #RRGGBB，留空回退默认）。 */
  secondaryColor?: string;
  footerText?: string;
  contactAddress?: string;
  ctaTitle?: string;
  ctaDescription?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  showPoweredBy: boolean;
  /** 自定义官网域名（如 www.brand.com）；留空表示不绑定。服务端归一化为小写 host。 */
  customDomain?: string;
  /** 品类入口图（按服务编码）；空 imageUrl 视为清除该品类配置。 */
  categoryImages?: WebsiteCategoryImage[];
  /** 官网首页内容块（可编辑）；空数组表示清空、回落前端通用文案。 */
  advantages?: WebsiteAdvantage[];
  steps?: WebsiteStep[];
  testimonials?: WebsiteTestimonial[];
}

/**
 * 微信小程序渠道凭证：AppID 是公开信息，AppSecret 只写不读（服务端加密保存，只返回是否已配置）。
 * 品牌/协议/发布服务已移到租户级 ClientChannelProfileSummary。
 */
export interface MiniProgramChannelSummary {
  configured: boolean;
  appId?: string;
  secretConfigured: boolean;
  enabled: boolean;
  revision: number;
  lastTestStatus: "not_tested" | "passed" | "failed";
  lastTestAt?: string;
  lastTestError?: string;
  /** 已绑定微信身份的客户数；AppID 一旦有绑定就不能再改。 */
  identityCount: number;
  updatedAt?: string;
}

export interface SaveMiniProgramChannelRequest {
  appId: string;
  /** 只在需要更换时提交；留空保留原密钥。 */
  appSecret?: string;
  enabled: boolean;
}

export interface MiniProgramChannelTestResult {
  ok: boolean;
  message: string;
  testedAt: string;
}
