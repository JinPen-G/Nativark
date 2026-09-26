/**
 * SUB-02/03 版本订阅 —— 前端本地占位契约。
 *
 * TODO(SUB-01)：总控会话在 packages/shared 落定「订阅/权益/功能目录/申请」只读查询 DTO 与枚举后，
 * 用 `@rental-os/shared` 的正式类型替换本文件，并删除这里的占位。命名会与总控对齐。
 * 本文件只服务静态骨架的类型标注，不含任何金额默认值/永久授权（§14.2：待定值一律"待公布/待确认"）。
 */

/** 版本档位。 */
export type SubscriptionEdition = "basic" | "pro";

/** 页面显示用的服务状态（需求 §4.2）。 */
export type SubscriptionStatus =
  | "active_basic"        // 有效基础版
  | "active_pro"          // 有效 PRO
  | "expiring"            // 即将到期
  | "expired"             // 套餐已到期
  | "scheduled_change"    // 已安排续费/降级
  | "pending_activation"  // 待生效
  | "unconfigured";       // 尚未配置订阅

/** 功能目录上线状态（需求 §3.3）。 */
export type FeatureOnlineStatus = "planned" | "pilot" | "released" | "paused" | "retired";

/** 当前功能权益来源（需求 §5.2「当前功能权益」）。 */
export type EntitlementSource = "basic_public" | "tenant_extra" | "pro" | "needs_upgrade";

/** 申请类型（需求 §7.2）。 */
export type SubscriptionRequestType =
  | "upgrade_pro" | "renew_basic" | "renew_pro" | "upgrade_consult" | "next_basic" | "no_renew";

/** 申请状态（需求 §7.3）。 */
export type SubscriptionRequestStatus = "pending" | "processed" | "rejected" | "cancelled";

/** 当前套餐与统一期限摘要（需求 §4.1/§5.2「当前版本与服务」）。 */
export interface SubscriptionSummary {
  tenantName: string;
  tenantCode: string;
  edition: SubscriptionEdition;
  status: SubscriptionStatus;
  /** 套餐来源：正常售卖/试点/历史登记/临时延长（§4.1）。 */
  source?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  /** 剩余毫秒/天由页面按 endAt 计算，仅作辅助显示，不替代精确截止（§4.1）。 */
  currentAmountText?: string;   // 本期确认金额；无记录显示"待确认"
  handledAt?: string;
  next?: { edition: SubscriptionEdition; effectiveAt?: string };
}

/** 功能目录项（需求 §3.3/§5.2「版本功能对比」「当前功能权益」）。 */
export interface FeatureCatalogEntry {
  code: string;
  name: string;
  module: string;
  categories: string[];
  defaultEdition: SubscriptionEdition;
  entitlement: EntitlementSource;
  onlineStatus: FeatureOnlineStatus;
  valueText?: string;
}

/** 申请/办理记录（需求 §5.2/§7）。 */
export interface SubscriptionRequestRecord {
  id: string;
  type: SubscriptionRequestType;
  targetEdition?: SubscriptionEdition;
  submittedBy?: string;
  submittedAt?: string;
  status: SubscriptionRequestStatus;
  handledAmountText?: string;
  periodText?: string;
  reason?: string;
}

/** 订阅变更记录（需求 §5.2「订阅变更记录」）。 */
export interface SubscriptionChangeLog {
  id: string;
  action: string;
  effectiveAt?: string;
  beforeText?: string;
  afterText?: string;
  reason?: string;
}
