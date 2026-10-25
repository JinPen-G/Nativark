/**
 * SUB-02/03 订阅页的展示映射与金额格式化（管理端本地表现层）。
 *
 * 枚举与数据形状来自 `@rental-os/shared`（总控 SUB-01 契约）；这里只把枚举翻成中文文案、
 * 把结构化金额渲染成字符串。返回中文原文，组件再过 `t()`（与全站一致）。
 * §14.2：金额为 null/缺失时渲染"待确认/价格待公布"，绝不显示 0。
 */
import {
  FeatureEntitlementSource,
  FeatureReleaseStatus,
  SubscriptionPlan,
  SubscriptionRequestStatus,
  SubscriptionRequestType,
  SubscriptionServiceStatus,
  type SubscriptionMoney
} from "@rental-os/shared";

import { serviceLocalTime } from "./subscriptionOperations";

/** Accurate time + service zone. Missing zone is labelled UTC rather than silently using the device zone. */
export function formatSubscriptionDate(value?: string | null, timeZone?: string, translate: (text: string) => string = text => text): string {
  if (!value || !Number.isFinite(Date.parse(value))) return translate("待平台确认");
  const zone = timeZone || "UTC";
  try { return `${serviceLocalTime(value, zone).replace("T", " ")}（${zone}）`; }
  catch { return `${new Date(value).toISOString()}（${translate("服务时区待确认")}）`; }
}

export const PLAN_LABEL: Record<SubscriptionPlan, string> = {
  [SubscriptionPlan.Standard]: "基础版",
  [SubscriptionPlan.Pro]: "PRO"
};

export const SERVICE_STATUS_LABEL: Record<SubscriptionServiceStatus, string> = {
  [SubscriptionServiceStatus.PendingActivation]: "待生效",
  [SubscriptionServiceStatus.Active]: "有效",
  [SubscriptionServiceStatus.Expiring]: "即将到期",
  [SubscriptionServiceStatus.Expired]: "已到期",
  [SubscriptionServiceStatus.Unconfigured]: "尚未配置"
};

export const RELEASE_STATUS_LABEL: Record<FeatureReleaseStatus, string> = {
  [FeatureReleaseStatus.Planned]: "规划中",
  [FeatureReleaseStatus.Pilot]: "受控试点",
  [FeatureReleaseStatus.Released]: "已上线",
  [FeatureReleaseStatus.Paused]: "暂停新启用",
  [FeatureReleaseStatus.Retired]: "已停止新使用"
};

export const ENTITLEMENT_SOURCE_LABEL: Record<FeatureEntitlementSource, string> = {
  [FeatureEntitlementSource.StandardPublic]: "基础版公共",
  [FeatureEntitlementSource.TenantGrant]: "额外授权",
  [FeatureEntitlementSource.Pro]: "PRO 权益",
  [FeatureEntitlementSource.NeedsUpgrade]: "仍需升级"
};

export const REQUEST_TYPE_LABEL: Record<SubscriptionRequestType, string> = {
  [SubscriptionRequestType.UpgradePro]: "升级 PRO",
  [SubscriptionRequestType.RenewStandard]: "续购基础版",
  [SubscriptionRequestType.RenewPro]: "续购 PRO",
  [SubscriptionRequestType.UpgradeConsult]: "升级咨询",
  [SubscriptionRequestType.NextStandard]: "申请下期基础版",
  [SubscriptionRequestType.NoRenew]: "到期不续费"
};

export const REQUEST_STATUS_LABEL: Record<SubscriptionRequestStatus, string> = {
  [SubscriptionRequestStatus.Pending]: "待处理",
  [SubscriptionRequestStatus.Processed]: "已办理",
  [SubscriptionRequestStatus.Rejected]: "已拒绝",
  [SubscriptionRequestStatus.Cancelled]: "已撤销"
};

/** 申请/服务状态到 antd Tag 颜色的映射（缺省 default）。 */
export const REQUEST_STATUS_TONE: Partial<Record<SubscriptionRequestStatus, string>> = {
  [SubscriptionRequestStatus.Pending]: "processing",
  [SubscriptionRequestStatus.Processed]: "success",
  [SubscriptionRequestStatus.Rejected]: "error"
};

/**
 * 结构化金额 → 展示字符串。null/缺失返回占位（默认"待确认"，价格场景传"价格待公布"）；
 * 永远带币种，绝不返回 0（§14.2）。返回中文原文由调用方 t()。
 */
export function formatMoney(money: SubscriptionMoney | null | undefined, pendingLabel = "待确认"): string {
  if (!money) return pendingLabel;
  const tax = money.taxInclusive === true ? "（含税）" : money.taxInclusive === false ? "（未税）" : "";
  return `${money.currency} ${money.amount}${tax}`;
}
