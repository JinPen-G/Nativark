/** Rental和既有客户端的兼容契约；公共身份/人员/设置声明来自platform-identity，原总出口继续兼容。 */

import type {
  BusinessWorkspace,
  BusinessWorkspaceRunMode,
  RentalCapability,
  RentalCategoryCode,
  RentalCurrency
} from "./core";
import type { TenantIdentity, PlatformTenantSummary, AuthUser, SystemUserRow, SaveSystemUserRequest, SystemSecurityBaselineConfig, SaveWorkspaceAccessRequest } from "./platform-identity";
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

/** 原客户端渠道出口继续兼容，领域字段由Rental包单源维护。 */
export type {
  ClientChannelAgreementConfig,
  ClientChannelFaqItem,
  ClientChannelReadiness,
  ClientChannelWorkspaceOption,
  ClientChannelProfileSummary,
  SaveClientChannelProfileRequest,
  WebsiteCategoryImage,
  WebsiteAdvantage,
  WebsiteStep,
  WebsiteTestimonial,
  WebsiteChannelProfileSummary,
  SaveWebsiteChannelProfileRequest,
  MiniProgramChannelSummary,
  SaveMiniProgramChannelRequest,
  MiniProgramChannelTestResult
} from "@rental-os/rental-core/channel-contracts";
