/** Rental和既有客户端的兼容契约；公共身份/人员/设置声明来自platform-identity，原总出口继续兼容。 */

import type {
  BusinessWorkspace,
  BusinessWorkspaceRunMode,
  RentalCapability,
  RentalCategoryCode,
  RentalCurrency
} from "./core";
import type { TenantIdentity, PlatformTenantSummary, AuthUser, SystemDataScope, SystemUserRow, SaveSystemUserRequest, SystemSecurityBaselineConfig, AdminLoginBranding } from "./platform-identity";
export * from "./platform-identity";

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

export interface TenantContext extends TenantIdentity {
  categoryCode?: RentalCategoryCode;
  categoryName?: string;
  capabilities?: RentalCapability[];
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

export interface TenantSummary extends PlatformTenantSummary {
  categoryCode?: RentalCategoryCode;
  categoryName?: string;
  capabilities?: RentalCapability[];
  /** Rental经营空间是品类事实源，业务汇总由Rental适配提供。 */
  workspaceCount?: number;
  workspaceCategoryCodes?: RentalCategoryCode[];
  orderCount?: number;
}

/** 后台简称的输入边界；省略保留、空值清除，前后端使用同一归一规则。 */
export function normalizeOperatorShortName(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.length > 64 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value))
    throw new Error("营运商简称必须是单行文字");
  return value.trim().normalize("NFC") || null;
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

export interface TenantBootstrapRequest {
  tenantCode: string;
  tenantName: string;
  /** 独立后台简称；省略/null/空字符串表示未设置。 */
  operatorShortName?: string | null;
  categoryCode: RentalCategoryCode;
  /** Rental's first space may explicitly select any currently eligible published version. */
  categoryVersionId?: string;
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
  /** 纯文本或 CLIENT_RICH_TEXT_PREFIX + 安全文档节点 JSON；用 parseClientRichText 识别。不可直接作为 HTML 执行；总长度含格式标记不超过 20000 字符。 */
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
  adminLogin?: AdminLoginBranding;
  /** 客户端与管理后台主题色（#RRGGBB）；未设置时各端用系统默认色。 */
  themeColor?: string;
  /** 管理后台基础控件圆角（px，旧字段/回退基准）；胶囊页签与圆形图标按钮不受此值强行变形。 */
  adminCornerRadius: number;
  /** 容器（卡片/弹窗/抽屉/表格）圆角（px）；未设置时回退 adminCornerRadius。 */
  adminContainerRadius?: number;
  /** 按钮/分段/选中菜单圆角（px）；未设置时回退 adminCornerRadius。 */
  adminButtonRadius?: number;
  /** 输入/选择/日期等录入控件圆角（px）；未设置时回退 adminCornerRadius。 */
  adminInputRadius?: number;
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
  adminLogin?: AdminLoginBranding;
  /** 客户端与管理后台主题色（#RRGGBB）；留空表示回退系统默认色。 */
  themeColor?: string;
  /** 旧统一圆角（4–20px）；省略保留存量，显式 null 清除覆盖；新请求不接受历史极值。 */
  adminCornerRadius?: number | null;
  /** 容器圆角（4–20px）；省略保留，显式 null 回退旧统一值或角色默认值。 */
  adminContainerRadius?: number | null;
  /** 按钮/分段/选中菜单圆角（4–16px）；省略保留，显式 null 回退。 */
  adminButtonRadius?: number | null;
  /** 输入/选择/日期等录入圆角（4–16px）；省略保留，显式 null 回退。 */
  adminInputRadius?: number | null;
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
