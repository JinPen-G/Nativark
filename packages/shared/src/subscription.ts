/**
 * SUB-01（SaaS 版本订阅与 PRO 升级专项）平台域只读契约。
 *
 * 对外只有基础版(standard)/PRO(pro) 两个版本（§2）；到期/待生效/未配置是「服务状态」，
 * 与版本名称分别展示。功能可用按「当前套餐公共权益 ∪ 租户额外授权」判定，不硬编码 PRO（§3.5/§9.1）。
 * §14.2 待定金额一律可空，页面显示"价格待公布/待确认"，不得退化为 0 元。
 * 经 index.ts 统一再导出，引用方写 `@rental-os/shared`。
 */

/** 系统版本：对外只有这两个（§2）。 */
export enum SubscriptionPlan {
  Standard = "standard",
  Pro = "pro"
}

/** 当前套餐来源（§4.1/§7.4）。 */
export enum SubscriptionSource {
  Sale = "sale",
  Pilot = "pilot",
  HistoricalRegister = "historical_register",
  TempExtension = "temp_extension"
}

/** 服务状态；与版本名称分别展示（§2/§4.2），不把版本烘进状态。 */
export enum SubscriptionServiceStatus {
  PendingActivation = "pending_activation",
  Active = "active",
  Expiring = "expiring",
  Expired = "expired",
  Unconfigured = "unconfigured"
}

/** 功能目录上线状态（§3.3）。 */
export enum FeatureReleaseStatus {
  Planned = "planned",
  Pilot = "pilot",
  Released = "released",
  Paused = "paused",
  Retired = "retired"
}

/** 到期浮窗提醒阶段（§5.4）。 */
export enum SubscriptionReminderStage {
  None = "none",
  Normal = "normal",
  Urgent = "urgent",
  Expired = "expired"
}
/** 功能默认/当前归属（§3.3）；仅用于规划与介绍，不在业务逻辑硬编码为 PRO。 */
export enum FeatureOwnership {
  Standard = "standard",
  Pro = "pro"
}

/** 当前功能对某租户的权益来源（§5.2/§3.5.9）。 */
export enum FeatureEntitlementSource {
  StandardPublic = "standard_public",
  TenantGrant = "tenant_grant",
  Pro = "pro",
  NeedsUpgrade = "needs_upgrade"
}

/** 两种功能下放范围（§3.5）。 */
export enum FeatureGrantScope {
  PublicToStandard = "public_to_standard",
  TenantSpecific = "tenant_specific"
}

/** 升级/续费申请类型（§7.2）。 */
export enum SubscriptionRequestType {
  UpgradePro = "upgrade_pro",
  RenewStandard = "renew_standard",
  RenewPro = "renew_pro",
  UpgradeConsult = "upgrade_consult",
  NextStandard = "next_standard",
  NoRenew = "no_renew"
}

/** 申请状态（§7.3）；不设报价中/等待接受等额外状态。 */
export enum SubscriptionRequestStatus {
  Pending = "pending",
  Processed = "processed",
  Rejected = "rejected",
  Cancelled = "cancelled"
}

/** 金额永远带币种（§14.2）；缺币种/未定价不构造此对象，用 null 表达"待确认/待公布"。 */
export interface SubscriptionMoney {
  amount: number;
  currency: string;
  taxInclusive?: boolean;
}
/** 当前套餐与统一期限概览（§5.2「当前版本与服务」/§4.1）。 */
export interface TenantSubscriptionOverview {
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  plan: SubscriptionPlan;
  serviceStatus: SubscriptionServiceStatus;
  source?: SubscriptionSource;
  /** 统一起止，半开区间 [startAt, endAt)（§4.1）；缺失=待平台确认，不解释为永久。 */
  startAt?: string;
  endAt?: string;
  /** 服务时区（IANA）；不随空间切换（§4.1.3）。 */
  timeZone?: string;
  /** 本期确认金额；null=待确认，不显示 0（§5.2/§14.2）。 */
  currentAmount?: SubscriptionMoney | null;
  handledAt?: string;
  /** 待生效的下一段套餐（续费/降级），无则不返回（§4.1/§4.2）。 */
  next?: { plan: SubscriptionPlan; effectiveAt?: string };
  /** 乐观锁修订号。 */
  revision: number;
}

/** 某功能对当前租户的权益（§5.2「当前功能权益」）。 */
export interface SubscriptionFeatureEntitlement {
  code: string;
  name: string;
  module: string;
  categories: string[];
  defaultOwnership: FeatureOwnership;
  currentOwnership: FeatureOwnership;
  releaseStatus: FeatureReleaseStatus;
  /** 该功能对本租户来源：公共/特批/PRO/仍需升级（§3.5.9）。 */
  source: FeatureEntitlementSource;
  /** 已上线且本租户已获、可申请启用（空间/权限/配置另判）。 */
  available: boolean;
  /** 需先配置空间/能力才能用（§5.3「去配置」）。 */
  needsConfig?: boolean;
  valueText?: string;
  /** 外部/按量费用说明；另计不自动扣费（§3.3/§14.2 S-D09）。 */
  externalFeeNote?: string;
}

/** 已发布功能目录项（PRO 介绍/版本对比用，非租户特定）（§3.3/§6）。 */
export interface SubscriptionFeatureCatalogEntry {
  code: string;
  name: string;
  module: string;
  categories: string[];
  defaultOwnership: FeatureOwnership;
  currentOwnership: FeatureOwnership;
  releaseStatus: FeatureReleaseStatus;
  valueText?: string;
  prerequisiteText?: string;
  externalFeeNote?: string;
  /** 介绍内容版本（§3.3）。 */
  contentVersion?: string;
}
/** 标准套餐年费（§5.2「标准套餐价与续费说明」）。 */
export interface StandardPlanPricing {
  plan: SubscriptionPlan;
  /** 已发布年费；null=价格待公布（§14.2 S-D01），不显示 0。 */
  annualFee?: SubscriptionMoney | null;
  /** 是否已发布正式价格；false 时页面显示"价格待公布/仅咨询"。 */
  published: boolean;
  /** 价格方案版本（§11.1）。 */
  priceVersion?: string;
  note?: string;
}

/** 升级/续费申请与办理记录（§7）。 */
export interface SubscriptionRequestRecord {
  id: string;
  type: SubscriptionRequestType;
  targetPlan?: SubscriptionPlan;
  submittedBy?: string;
  submittedAt?: string;
  status: SubscriptionRequestStatus;
  /** 实际办理金额；null/缺失=未办理或待确认，不显示 0。 */
  handledAmount?: SubscriptionMoney | null;
  /** 办理期间说明（起止）。 */
  periodText?: string;
  /** 可公开原因（拒绝/撤销等）。 */
  reason?: string;
  /** 处理过程时间线（§5.2 可查看处理过程）。 */
  timeline?: Array<{ at: string; status: SubscriptionRequestStatus; note?: string }>;
}

/** 订阅变更记录（§5.2「订阅变更记录」）。 */
export interface SubscriptionChangeLogEntry {
  id: string;
  action: string;
  effectiveAt?: string;
  beforeText?: string;
  afterText?: string;
  reason?: string;
  operatedAt?: string;
}
/** 左下角到期浮窗只读数据（§5.4）。 */
export interface SubscriptionExpiryReminder {
  plan: SubscriptionPlan;
  serviceStatus: SubscriptionServiceStatus;
  endAt?: string;
  remainingDays?: number;
  stage: SubscriptionReminderStage;
  /** 简短影响说明（如"到期停止新业务，已有订单可继续"）。 */
  message?: string;
  /** 有未关闭同类申请时，浮窗按钮显示"查看办理进度"（§5.4）。 */
  hasOpenRequest: boolean;
}

/** 租户「版本与订阅」页一次拉取的聚合只读视图（§5.2）。 */
export interface TenantSubscriptionView {
  overview: TenantSubscriptionOverview;
  entitlements: SubscriptionFeatureEntitlement[];
  /** 基础版/PRO 各一条标准价（未发布时 published=false）。 */
  standardPricing: StandardPlanPricing[];
  requests: SubscriptionRequestRecord[];
  changeLog: SubscriptionChangeLogEntry[];
  reminder: SubscriptionExpiryReminder;
}

/**
 * SUB-MP：员工小程序只读「订阅/权益」工作上下文（§4.4）。
 * 金额**结构性脱敏**——`overview` 用 Omit 去掉 currentAmount/handledAt，员工端拿不到就不可能泄漏
 * （§SUB-MP-02「员工不看内部商业明细」），而非靠运行时省略可选字段。到期提醒 stage/remainingDays 由服务端算好。
 */
export interface StaffSubscriptionContext {
  overview: Omit<TenantSubscriptionOverview, "currentAmount" | "handledAt">;
  entitlements: SubscriptionFeatureEntitlement[];
  reminder: SubscriptionExpiryReminder;
}

/* ===========================================================================
 * SUB-01 写操作请求契约（服务 + API 层）。
 *
 * 目标租户一律走**路径参数**，不放进请求体，避免"体内租户"与"路径租户"不一致。
 * 金额一律可空：缺省 = 待确认，不落 0（§14.2）。到期/时区由服务端按 §4.1 计算，
 * 租户端不能提交"已开通"或最终权限集合（§11.2）。`expectedRevision` 用于乐观并发：
 * 另一管理员已更新期限/价格时提示刷新、不覆盖新结果（§11.2 / A06）。
 * =========================================================================== */

/** 直接开通（§7.1/§8.2）。start 必填并明确时点；serviceYears 与 endAt 二选一。 */
export interface ProvisionSubscriptionRequest {
  plan: SubscriptionPlan;
  source: SubscriptionSource;
  startAt: string;
  serviceYears?: number;
  endAt?: string;
  timeZone?: string;
  amount?: number;
  currency?: string;
  taxInclusive?: boolean;
  reason?: string;
  expectedRevision?: number;
}

/** 续期（§4.4）。有效期内缺 startAt 接续当前截止；已过期须显式 startAt。 */
export interface RenewSubscriptionRequest {
  plan: SubscriptionPlan;
  source: SubscriptionSource;
  startAt?: string;
  serviceYears?: number;
  endAt?: string;
  amount?: number;
  currency?: string;
  taxInclusive?: boolean;
  reason?: string;
  expectedRevision?: number;
}

/** 升级为 PRO（§4.4）：保持原统一截止，仅记录人工补差金额。 */
export interface UpgradeSubscriptionProRequest {
  source: SubscriptionSource;
  amount?: number;
  currency?: string;
  taxInclusive?: boolean;
  reason?: string;
  expectedRevision?: number;
}
/** 租户提交升级/续费/降级/不续费/咨询申请（§7.2）。仅表达意向，不自动开通。 */
export interface SubmitSubscriptionRequestRequest {
  type: SubscriptionRequestType;
  targetPlan?: SubscriptionPlan;
  /** 意向模块/品类（多选），不保证规划项交付。 */
  moduleIntent?: string[];
  contactName?: string;
  contactPhone?: string;
  note?: string;
  /** 幂等去重键；同租户同类型未关闭申请复用同一键（§7.2）。 */
  dedupeKey: string;
}

/** 临时延长当前套餐截止（§4.4/§8.2）。须填原因；不伪造收款、不自动续费。 */
export interface ExtendSubscriptionRequest {
  /** 新截止时点（明确），晚于当前截止。 */
  endAt: string;
  reason: string;
  expectedRevision?: number;
}

/** 登记下一段套餐（续费或下期降级，§4.4）。当前付费期不提前结束，到 effectiveAt 切换。 */
export interface ScheduleNextSubscriptionRequest {
  plan: SubscriptionPlan;
  source: SubscriptionSource;
  /** 下一段开始（= 当前截止或双方确认时点）。 */
  effectiveAt: string;
  serviceYears?: number;
  endAt?: string;
  amount?: number;
  currency?: string;
  reason?: string;
}

/** SaaS 管理员办理申请（§7.3）：转已办理/已拒绝，附可公开原因；实际开通另走开通接口。 */
export interface HandleSubscriptionRequestRequest {
  status: SubscriptionRequestStatus;
  publicReason?: string;
  note?: string;
}
/** 单租户额外授权（§3.5 tenant_specific）。目标租户走路径参数。 */
export interface GrantTenantFeatureRequest {
  featureCode: string;
  reason?: string;
}

/** 撤销单租户额外授权（§3.5.8）。记录原因，保护既有承诺。 */
export interface RevokeTenantFeatureRequest {
  featureCode: string;
  reason: string;
}

/** 维护功能目录条目并设当前归属（§3.3/§8）。currentOwnership=Standard 即公共下放基础版（§3.5）。 */
export interface UpsertFeatureCatalogRequest {
  code: string;
  name: string;
  module: string;
  categories: string[];
  defaultOwnership: FeatureOwnership;
  currentOwnership: FeatureOwnership;
  releaseStatus: FeatureReleaseStatus;
  valueText?: string;
  prerequisiteText?: string;
  externalFeeNote?: string;
  contentVersion?: string;
  reason?: string;
}

/** 维护标准套餐年费（§5.2/§8）。未发布 published=false 且省略 annualFee，不落 0（§14.2）。 */
export interface SetStandardPriceRequest {
  plan: SubscriptionPlan;
  annualFee?: number;
  currency?: string;
  taxInclusive?: boolean;
  published: boolean;
  priceVersion?: string;
  note?: string;
}

