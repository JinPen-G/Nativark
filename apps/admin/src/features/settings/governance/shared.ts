import type {
  RentalCategoryDefinition,
  RentalDepositRule,
  RentalPreauthorizationRule,
  RentalRuleVersion,
  SaveTenantRentalBusinessSettingsRequest,
  TenantRentalBusinessSettings,
} from "@rental-os/shared";
import { useMemo } from "react";
import { useAuthStore } from "@/features/auth/authStore";

/**
 * 「品类与业务规则」各页签共用的权限判定。
 *
 * 需求 4.5.8 的角色矩阵要在界面上成立：日历编辑人员不该看到「发布」，发布人员不该
 * 看到「导入/覆盖/移除覆盖」，而且不该发出注定 403 的请求（页面会满屏报错，
 * 专门配置的日历角色拿不到一个能用的工作界面）。所有页签与外壳都从这一个对象取判定，
 * 页签清单与页签内部按钮才不会各自对不同的码。
 */
export interface GovernancePermissions {
  canManagePrice: boolean;
  canManageParams: boolean;
  /** 需求 4.6.14：编辑草稿与对客户生效是两个责任，按钮分别判权。 */
  canEditRules: boolean;
  canPublishRules: boolean;
  /** 规则读取（列表、详情、预览、审计）编辑/发布/价格任一即可，与后端 guard 同口径。 */
  canSeeRules: boolean;
  canEditCalendar: boolean;
  canPublishCalendar: boolean;
  /** 需求 4.5.8：客服或财务「查看历史版本及报价命中的日历依据，不得修改」的独立只读权限。 */
  canViewCalendarHistory: boolean;
  canSeeCalendar: boolean;
  canSeeSettings: boolean;
}

export function useGovernancePermissions(): GovernancePermissions {
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canManagePrice = hasPermission("rental-os:price:manage");
  const canManageParams = hasPermission("system:params:manage");
  const canEditRules = hasPermission("rental-os:rules:manage");
  const canPublishRules = hasPermission("rental-os:rules:publish");
  const canEditCalendar = canManagePrice || hasPermission("rental-os:calendar:edit");
  const canPublishCalendar = canManagePrice || hasPermission("rental-os:calendar:publish");
  const canViewCalendarHistory =
    canEditCalendar || canPublishCalendar || canEditRules || hasPermission("rental-os:calendar:view-history");
  return useMemo(
    () => ({
      canManagePrice,
      canManageParams,
      canEditRules,
      canPublishRules,
      canSeeRules: canEditRules || canPublishRules || canManagePrice,
      canEditCalendar,
      canPublishCalendar,
      canViewCalendarHistory,
      canSeeCalendar: canViewCalendarHistory,
      canSeeSettings: canManagePrice || canEditRules,
    }),
    [canManagePrice, canManageParams, canEditRules, canPublishRules, canEditCalendar, canPublishCalendar, canViewCalendarHistory],
  );
}

/** 外壳交给每个页签的上下文：权限、当前品类档案与已载入的租户经营设置。 */
export interface GovernanceTabContext {
  permissions: GovernancePermissions;
  category: RentalCategoryDefinition;
  settings: TenantRentalBusinessSettings;
  saveTab: (patch: Partial<SaveTenantRentalBusinessSettingsRequest>) => void;
  saving: boolean;
}

/** 规则链的冲突信息（时点重叠、已发布不可改）必须原样透出，否则用户无从改正。 */
export function errorText(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
  );
}

export const securityRuleLabels: Record<RentalDepositRule["mode"], string> = {
  none: "不需要",
  fixed: "按商品固定金额",
  price_multiple: "按商品行租金倍数",
  order_fixed: "每单固定金额",
};

export const preauthorizationRuleLabels: Record<RentalPreauthorizationRule["mode"], string> = {
  ...securityRuleLabels,
  risk_surcharge: "租金倍数 + 风险附加",
};

/** 旧规则只有 payment.depositMode；打开编辑器时显式派生为新的两组独立规则。 */
export function ruleSecurityGroups(config: RentalRuleVersion["config"]): {
  deposit: RentalDepositRule;
  preauthorization: RentalPreauthorizationRule;
} {
  const legacyMode = config.payment.depositMode;
  return {
    deposit:
      config.deposit ??
      (legacyMode === "none" || legacyMode === "preauthorization"
        ? { mode: "none" }
        : { mode: legacyMode }),
    preauthorization:
      config.preauthorization ??
      (legacyMode === "preauthorization" ? { mode: "fixed" } : { mode: "none" }),
  };
}
