/** 原租户与首个Rental空间初始化合同；公共身份沿底座复用，业务品类、币种及历史模板归Rental。
 * 这些声明不初始化数据、不授予Core或成员权限，兼容shared只再导出同一类型。 */
import type { SystemUserRow, SystemSecurityBaselineConfig } from "@rental-os/platform-contracts";
import type { RentalCategoryCode, RentalCurrency } from "./contracts";
import type { TenantSummary } from "./auth-contracts";

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
