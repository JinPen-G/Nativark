/** Rental和既有客户端的兼容契约；公共身份/人员/设置声明来自platform-identity，原总出口继续兼容。 */

import type {
  RentalCategoryCode,
  RentalCurrency
} from "./core";
import type { SystemUserRow, SystemSecurityBaselineConfig } from "./platform-identity";
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

import type { TenantSummary } from "@rental-os/rental-core/auth-contracts";
export type { TenantContext, LoginResponse, SwitchWorkspaceRequest, SessionContextResponse, TenantSummary } from "@rental-os/rental-core/auth-contracts";

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
export type { SaveSystemUserAccessRequest } from "@rental-os/rental-core/contracts";

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
