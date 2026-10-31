/**
 * Rental Core v0.1：通用租赁内核契约。
 *
 * 品类、能力、经营空间、商品与资产、报价与订单、计价与优惠、押金与资金、
 * 规则版本、日历、通知、客户主档与会员、报表口径。新业务的唯一契约来源。
 */

import type { SystemDataScope } from "./platform";

// Rental Core v0.1 ---------------------------------------------------------

export enum RentalCategoryCode {
  Vehicle = "vehicle",
  Camera = "camera",
  Camping = "camping",
  Construction = "construction"
}

export enum RentalInventoryMode {
  Serialized = "serialized",
  Quantity = "quantity",
  /** 一次性使用的库存；领取时消耗，不进入归还、周转或维修隔离。 */
  Consumable = "consumable",
  Bundle = "bundle"
}

export enum RentalAssetStatus {
  Available = "available",
  Reserved = "reserved",
  Rented = "rented",
  Inspection = "inspection",
  Maintenance = "maintenance",
  Disabled = "disabled"
}

export enum RentalReservationStatus {
  Soft = "soft",
  Confirmed = "confirmed",
  Fulfilled = "fulfilled",
  Released = "released",
  Expired = "expired",
  Cancelled = "cancelled"
}

export enum RentalCoreOrderStatus {
  Draft = "draft",
  Reserved = "reserved",
  PickupOverdue = "pickup_overdue",
  ReadyForPickup = "ready_for_pickup",
  Renting = "renting",
  ReturnInspection = "return_inspection",
  Settling = "settling",
  Completed = "completed",
  Cancelled = "cancelled",
  NoShow = "no_show"
}

export const RENTAL_CAPABILITY_CODES = [
  "serialized_inventory",
  "quantity_inventory",
  "bundle_inventory",
  "pickup",
  "return",
  "delivery",
  "locker",
  "dispatch",
  "usage_reading",
  "qualification",
  "iot",
  // CAM-01A：首个真实产品能力——摄影器材兼容性。仅摄影品类适用（applicableCategories 收口），
  // 只做兼容性判定，不代替 CAM-01 的附件清点、使用量、检查与养护。
  "camera_compatibility",
  // 各品类首期经营闭环的独立 capability。尚未接入真实模块的能力不声明
  // implementationVersion；已接入的能力必须由对应任务补齐版本化实现。
  "camera_kit_handover",
  "camping_kit_integrity",
  "camping_cleaning_turnaround",
  "inspection_care",
  "vehicle_relocation",
  "construction_transport"
] as const;

export type RentalCapability = (typeof RENTAL_CAPABILITY_CODES)[number];

/**
 * Rental Core 直接提供的跨品类基础能力。
 *
 * 这些能力随品类定义生效，不创建经营空间 capability 实例，也不由运营启停；对应规则
 * 分别在库存、履约、业务规则和检查模板中配置。其余 code 才属于可独立启停、版本化的扩展模块。
 */
export const RENTAL_CORE_CAPABILITY_CODES = [
  "serialized_inventory",
  "quantity_inventory",
  "bundle_inventory",
  "pickup",
  "return",
  "delivery",
  "usage_reading",
  "qualification",
  "inspection_care"
] as const satisfies readonly RentalCapability[];

/**
 * capability 种类（CORE-EXT-02A）。
 *
 * - `category_required` 只表示扩展模块具备成为品类必选项的资格；最终是否阻止空间进入
 *   production 仍以品类定义中的 `requiredCapabilities` 为准。通用库存、领取、归还等
 *   Rental Core 基础能力不放进该数组，也不要求运营逐项启用。
 * - `category_optional` 可选增强：启用与否都不影响该品类的生产就绪判定。
 * - `shared` 跨品类共享：多个品类都可引用的通用能力（物流、资质、IoT 等）。
 */
export type RentalCapabilityKind = "category_required" | "category_optional" | "shared";

/** capability 生命周期。`disabled` 与「从未启用」不同：前者有实例与审计，后者没有实例行。 */
export const RENTAL_CAPABILITY_LIFECYCLE_STATUSES = ["enabled", "paused", "disabled"] as const;

export type RentalCapabilityLifecycleStatus = (typeof RENTAL_CAPABILITY_LIFECYCLE_STATUSES)[number];

/** 可由运营维护、并随 capability 配置版本固化的实体引用。 */
export interface RentalCompatibilityEntityRef {
  kind: "item_group" | "asset" | "attribute";
  id?: string;
  field?: string;
  value?: string;
}

/** 商品、资产或属性值之间的结构化兼容关系事实。 */
export interface RentalCompatibilityRelation {
  id: string;
  relationType: "equipment_target" | "mount_adapter" | "battery_support" | "storage_support" | "port_support" | "model_fit";
  source: RentalCompatibilityEntityRef;
  target: RentalCompatibilityEntityRef;
  outcome: "allow" | "warn" | "block";
  sourceName: string;
  reason: string;
}

export type RentalCapabilityConfigValue = string | number | boolean | RentalCompatibilityRelation[];
export type RentalCapabilityConfig = Record<string, RentalCapabilityConfigValue>;

/**
 * capability 配置字段描述。用描述符而不是 JSON Schema 字符串：服务端要能逐字段校验并给出
 * 可读原因，管理端要能据同一份描述渲染表单——两边共用一份定义才不会各写一套校验。
 */
export interface RentalCapabilityConfigField {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum" | "compatibility_relations";
  required: boolean;
  /** `type: "enum"` 时的可选值。 */
  options?: string[];
  /** 数值下/上界，仅 `type: "number"` 使用。 */
  min?: number;
  max?: number;
  /**
   * 创建经营空间时自动启用该能力所用的默认值。
   *
   * 只有**全部必填配置项都有默认值**的必选能力才会被自动初始化；否则空间保持
   * 非生产就绪，等人补配置后再启用。给必填项编造一个值等于伪装启用。
   */
  defaultValue?: RentalCapabilityConfigValue;
  description?: string;
}

export interface RentalCapabilityModuleDefinition {
  code: RentalCapability;
  label: string;
  kind: RentalCapabilityKind;
  extensionPoints: Array<"menu" | "api" | "order_validation" | "fulfillment" | "integration">;
  /** 适用品类。`"all"` 表示跨品类共享能力对全部品类可用。 */
  applicableCategories: "all" | RentalCategoryCode[];
  /** 依赖的其他 capability：它们必须先处于 `enabled` 才允许启用本能力。 */
  dependsOn: RentalCapability[];
  /** 互斥 capability：任一处于 `enabled` 时不允许启用本能力。 */
  conflictsWith: RentalCapability[];
  /** 配置 schema。空数组表示该能力无需配置。 */
  configSchema: RentalCapabilityConfigField[];
  /**
   * 可执行模块的实现版本。**缺省即「已声明但未实现」**——只有 code 没有模块的能力
   * 不得被启用，也不得开放菜单或 API。CORE-EXT-02A 的迁移据此拒绝把旧
   * `capabilities` 数组里的 code 自动认定为已启用功能。
   */
  implementationVersion?: string;
}

/** `RentalCapabilityModuleDefinition` 的语义别名，新代码用这个名字表达"定义"。 */
export type RentalCapabilityDefinition = RentalCapabilityModuleDefinition;

/** capability 生命周期动作。`configure` 只改配置、不改状态。 */
export type RentalCapabilityAuditAction =
  | "enable"
  | "pause"
  | "disable"
  | "upgrade"
  | "configure"
  /**
   * 系统在创建经营空间时自动启用品类必选能力。
   *
   * 与 `enable` 分开是刻意的：前者是系统按品类定义做的初始化，后者是有人做的经营决策。
   * 混成一个动作会让审计里分不清「谁开的」，而「空间创建时自动开的」和
   * 「某个管理员手工开的」在追责与排查上完全不是一回事。
   */
  | "system_initialize";

/**
 * 经营空间的 capability 实例（CORE-EXT-02A）。
 *
 * 「没有实例」与「实例为 disabled」是两种不同事实：前者从未启用过，后者停用且留有审计。
 * 因此判定「是否可用」只能看 `status === "enabled"`，不能看实例是否存在。
 */
export interface WorkspaceCapabilityInstance {
  tenantId: string;
  workspaceId: string;
  code: RentalCapability;
  status: RentalCapabilityLifecycleStatus;
  /** 启用时锁定的实现版本；升级即换这个值并留审计。 */
  implementationVersion: string;
  /** 配置版本号，每次改配置递增。报价/订单快照引用它解释「当时按哪一版配置判定」。 */
  configVersion: string;
  config: RentalCapabilityConfig;
  /** 乐观并发版本号。写入以读到的值为条件，冲突返回 409。 */
  revision: number;
  enabledAt?: string;
  pausedAt?: string;
  disabledAt?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** capability 生命周期审计条目（只追加）。 */
export interface WorkspaceCapabilityAuditEvent {
  code: RentalCapability;
  action: RentalCapabilityAuditAction;
  fromStatus?: RentalCapabilityLifecycleStatus;
  toStatus: RentalCapabilityLifecycleStatus;
  implementationVersion?: string;
  configVersion?: string;
  /** 本次变更后的完整配置快照；不能只留版本号而丢失历史关系内容。 */
  configSnapshot?: RentalCapabilityConfig;
  reason: string;
  operator?: string;
  at: string;
}

/**
 * 管理端与门禁共用的**三态视图**：声明 / 已实现 / 已启用。
 *
 * 需求要求把「空间可访问」与「品类能力已达到生产经营条件」分开表示，因此这里既给出
 * 定义与实例，也直接给出派生结论，避免各端各写一套判定而口径分叉。
 */
export interface WorkspaceCapabilityView {
  definition: RentalCapabilityDefinition;
  /** true 表示由 Rental Core 内建提供，不需要经营空间另建实例或手工启用。 */
  providedByCore: boolean;
  /** 是否属于当前空间品类的必选能力；该口径优先于模块的全局 kind。 */
  requiredForCategory: boolean;
  /** 该能力是否被当前空间的品类声明（品类 defaultCapabilities 或 shared 能力）。 */
  declaredByCategory: boolean;
  /** 是否有可执行模块（注册表带 implementationVersion）。 */
  implemented: boolean;
  /** 是否适用于当前空间的品类。 */
  applicable: boolean;
  /** 实例；从未启用过时为 undefined。 */
  instance?: WorkspaceCapabilityInstance;
  /** 派生状态：`enabled` / `paused` / `disabled` / `declared_not_implemented` / `not_enabled`。 */
  state:
    | "enabled"
    | "paused"
    | "disabled"
    | "declared_not_implemented"
    | "not_enabled";
  /** 注册表当前实现版本与实例锁定版本不同时为 true，供管理端提示可升级。 */
  upgradeAvailable: boolean;
}

/** 某经营空间的能力总览与生产就绪判定。 */
export interface WorkspaceCapabilityOverview {
  tenantId: string;
  workspaceId: string;
  categoryCode: RentalCategoryCode;
  capabilities: WorkspaceCapabilityView[];
  /** 品类必选但尚未启用的能力（缺一个就不算生产就绪）。 */
  missingRequired: RentalCapability[];
  /**
   * 是否达到「具备完整品类能力、可以生产经营」。
   * 开发/演示空间可以继续验证通用 Rental Core，但这里必须如实为 false。
   */
  productionReady: boolean;
}

/** 启用/暂停/停用/改配置。原因必填：生命周期变更是经营决策，要能事后解释。 */
export interface SaveWorkspaceCapabilityRequest {
  code: RentalCapability;
  status: RentalCapabilityLifecycleStatus;
  config?: RentalCapabilityConfig;
  reason: string;
  /** 读到的 revision。提供时以它为条件写入，冲突返回 409。 */
  expectedRevision?: number;
}

/** 升级到注册表当前实现版本。原因必填，历史快照不受影响（CORE-EXT-02D 另行验收）。 */
export interface UpgradeWorkspaceCapabilityRequest {
  reason: string;
  expectedRevision?: number;
}

/**
 * CORE-EXT-02B：capability Hook 的七个触发点。
 *
 * 这个列表就是 Rental Core 愿意对外开放的**全部**扩展时机。它刻意是封闭枚举而不是
 * 任意字符串：能力模块只能挂在 Core 认得的节点上，不能自己发明一个 Core 从未调用的
 * 节点名然后声称"已接入"。值同时作为审计里的节点标识。
 */
export const RENTAL_CAPABILITY_HOOK_POINTS = [
  "item_onboarding",
  "quote_validation",
  "order_confirmation",
  "allocation_dispatch",
  "pickup_delivery",
  "return_inspection",
  "settlement"
] as const;

export type RentalCapabilityHookPoint = (typeof RENTAL_CAPABILITY_HOOK_POINTS)[number];

/**
 * Hook 判定。三值刻意不含"修改"：
 * - `allow` 放行；
 * - `warn` 放行但留提示（必须可审计）；
 * - `block` 拒绝，且必须给出原因。
 */
export type RentalCapabilityHookDecision = "allow" | "warn" | "block";

/** 阻止原因或提示。`code` 供程序判定，`message` 供人阅读，两者都要能落进审计。 */
export interface RentalCapabilityHookNotice {
  code: string;
  message: string;
  /** 触发该结论的关键输入摘要，供事后解释"当时为什么这么判"（CORE-EXT-02D 会引用）。 */
  evidence?: Record<string, string | number | boolean>;
}

/**
 * 关联任务。能力**不能**自己去建单、改库存或推状态，只能声明"这件事需要有人做"，
 * 由 Core 在自己的事务里落库。
 */
export interface RentalCapabilityLinkedTask {
  code: string;
  title: string;
  /** 建议负责人或角色；Core 不保证据此派单，只如实记录能力的建议。 */
  assigneeHint?: string;
  dueAt?: string;
  detail?: string;
}

/**
 * 费用**依据**，不是费用结果。
 *
 * 能力给出金额与计算依据，但由 Core 决定是否计入、以哪条收费行计入、记谁的版本。
 * 这条边界是刻意的：允许能力直接写 `order.totalAmount` 就等于把金额事实源交给扩展模块，
 * 那之后任何一笔账都无法只看 Core 解释清楚。
 */
/**
 * 结算币种（需求 §948：「一个订单只能属于……一个结算币种」）。
 *
 * 用联合类型而不是 `string`：币种直接决定金额的含义，打错一个字母就是一笔钱被读成
 * 另一种钱，而金额列本身看不出错。要支持新币种时在这里加一项并补 `RENTAL_CURRENCY_META`，
 * 类型会强制两处一起改。
 *
 * 刻意只收**两位小数**的币种。日元、韩元是 0 位小数，而全库金额列都是 `Decimal(12,2)`、
 * 取整也按分处理；把它们放进来会引入一个本次没有实现的精度维度。
 */
export type RentalCurrency = "CNY" | "HKD" | "MOP" | "TWD" | "SGD" | "USD" | "EUR";

/** 币种的符号与中文名。符号只用于展示，不参与任何计算。 */
export const RENTAL_CURRENCY_META: Record<RentalCurrency, { symbol: string; label: string }> = {
  CNY: { symbol: "¥", label: "人民币" },
  HKD: { symbol: "HK$", label: "港币" },
  MOP: { symbol: "MOP$", label: "澳门元" },
  TWD: { symbol: "NT$", label: "新台币" },
  SGD: { symbol: "S$", label: "新加坡元" },
  USD: { symbol: "$", label: "美元" },
  EUR: { symbol: "€", label: "欧元" }
};

export const RENTAL_CURRENCY_CODES = Object.keys(RENTAL_CURRENCY_META) as RentalCurrency[];

/**
 * 金额的统一展示。
 *
 * 存在的理由是**币种不能靠硬编码符号表达**：管理端此前有十几处写死的 `¥`，
 * 港币空间的金额会被显示成人民币。所有界面金额都走这里，币种取订单/报价上的快照。
 *
 * 未知币种（存量数据或将来新增还没登记符号的）回落成「CODE 金额」，
 * 而不是猜一个符号——猜错比不猜更危险。
 *
 * 千分位固定用 `en-US` 分组而不是运行环境默认 locale：默认 locale 依赖 Node 的 ICU
 * 数据，同一份金额在开发机与服务器上可能分组不同，那种差异只会在对账时才被发现。
 *
 * 负号排在符号**之前**（`-¥12.30` 而不是 `¥-12.30`）：退款与冲销行会出现负数，
 * 符号里夹一个减号读起来像是币种的一部分。
 */
export function formatRentalMoney(amount: number, currency?: string): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const sign = value < 0 ? "-" : "";
  const fixed = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const meta = currency ? RENTAL_CURRENCY_META[currency as RentalCurrency] : RENTAL_CURRENCY_META.CNY;
  return meta ? `${sign}${meta.symbol}${fixed}` : `${currency} ${sign}${fixed}`;
}

/** 币种符号；未登记的币种回落成币种代码本身，绝不猜符号。 */
export function rentalCurrencySymbol(currency?: string): string {
  if (!currency) return RENTAL_CURRENCY_META.CNY.symbol;
  return RENTAL_CURRENCY_META[currency as RentalCurrency]?.symbol ?? currency;
}

export interface RentalCapabilityFeeBasis {
  code: string;
  label: string;
  amount: number;
  currency: RentalCurrency;
  /** 计算依据的可读说明，必填：一笔说不出理由的费用不允许进入结算。 */
  basis: string;
  evidence?: Record<string, string | number | boolean>;
}

/** 深只读。Hook 拿到的业务对象必须是不可变视图——见 `RentalCapabilityHookContext.subject`。 */
export type RentalDeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<RentalDeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: RentalDeepReadonly<T[K]> }
    : T;

/**
 * Hook 上下文。**只读**，且刻意不含任何仓储、事务或服务句柄。
 *
 * 这是"能力不能改写 Core 事实"的结构性保证，而不是靠约定：Hook 函数签名里根本拿不到
 * 可以写库的东西，因此它**只能**通过返回值表达意见。若把 `tx` 或仓储传进来，
 * 那条禁令就退化成一句注释，任何一个能力模块都能绕过 Core 直接落库。
 */
export interface RentalCapabilityHookContext<TSubject> {
  point: RentalCapabilityHookPoint;
  tenantId: string;
  workspaceId: string;
  categoryCode: RentalCategoryCode;
  /** 操作人。部分 Core 动作（确认、配货）历史上没有操作人参数，因此可缺省。 */
  operator?: string;
  /** 判定时刻，由 Core 统一提供，能力不得自取当前时间——否则同一次判定各能力时间不一。 */
  at: string;
  /** 本次判定的业务对象只读视图。 */
  subject: RentalDeepReadonly<TSubject>;
  /** 该能力在本经营空间的实例信息，供能力按自己的配置与版本判定。 */
  capability: {
    readonly code: RentalCapability;
    readonly implementationVersion: string;
    readonly configVersion: string;
    readonly config: Readonly<RentalCapabilityConfig>;
  };
}

/**
 * Hook 结果。能力能表达的**全部**东西就是这四项。
 * `block` 必须带至少一条 `blockReasons`：拒绝而说不出理由的能力等于随机故障。
 */
export interface RentalCapabilityHookResult {
  decision: RentalCapabilityHookDecision;
  blockReasons?: RentalCapabilityHookNotice[];
  notices?: RentalCapabilityHookNotice[];
  linkedTasks?: RentalCapabilityLinkedTask[];
  feeBases?: RentalCapabilityFeeBasis[];
}

/**
 * 能力模块的 Hook 实现。一个能力可以只实现自己关心的节点。
 *
 * `implementationVersion` 是**这份实现**的版本，登记表按 `(code, implementationVersion)`
 * 而不是只按 `code` 索引。这一点是历史隔离的前提：报价与订单固化了下单当时的实现版本，
 * 运行时必须调用**那个版本的实现**。若只按 code 解析，升级后历史订单会执行新规则，
 * 而上下文里仍标着旧版本号——快照看起来对了，行为却已经被改写。
 *
 * 因此仍有在途业务引用的旧版本实现必须继续登记，不能因为发布了新版就删掉。
 *
 * `order` 是同节点内多能力之间的**确定性执行序**：Core 按 (order, code) 升序执行，
 * 不依赖注册表数组下标或 Map 插入序——那两者都会因为有人重排注册表而静默改变判定顺序。
 */
export interface RentalCapabilityHookModule {
  code: RentalCapability;
  implementationVersion: string;
  order: number;
  hooks: Partial<Record<RentalCapabilityHookPoint, RentalCapabilityHookHandler>>;
}

export type RentalCapabilityHookHandler = (
  context: RentalCapabilityHookContext<unknown>
) => RentalCapabilityHookResult | Promise<RentalCapabilityHookResult>;

/**
 * 一个节点上全部能力的合并结论，由 Core 消费。
 *
 * `blocked` 只由当前品类 `requiredCapabilities` 中的能力故障或显式 `block` 造成；
 * 可选能力的 `block` 同样阻止，但它是否必选决定了「能力自身抛异常」时的处理：
 * 必选能力异常 = fail-closed 阻止，可选能力异常 = 记录降级提示后放行。
 */
export interface RentalCapabilityHookOutcome {
  point: RentalCapabilityHookPoint;
  blocked: boolean;
  blockReasons: Array<RentalCapabilityHookNotice & { code: string; capability: RentalCapability }>;
  notices: Array<RentalCapabilityHookNotice & { capability: RentalCapability }>;
  linkedTasks: Array<RentalCapabilityLinkedTask & { capability: RentalCapability }>;
  feeBases: Array<RentalCapabilityFeeBasis & { capability: RentalCapability }>;
  /** 实际执行过的能力及其版本，供审计与 CORE-EXT-02D 快照引用。 */
  executed: Array<{
    capability: RentalCapability;
    implementationVersion: string;
    configVersion: string;
    decision: RentalCapabilityHookDecision;
    /** 能力自身抛异常时为真；必选能力此时必然 blocked。 */
    failed?: boolean;
  }>;
}

/**
 * 品类能力的统一注册表。新增专属能力时先登记扩展点，再由独立模块实现；
 * Rental Core 只识别 capability code，不在订单主流程里判断具体品类。
 */
export const RENTAL_CAPABILITY_MODULES: RentalCapabilityModuleDefinition[] = [
  // 四种库存与取还是 Rental Core 自身实现的能力，因此带 `core-1.0` 实现版本：
  // 它们确实有可执行模块（库存与履约主流程），不属于"只有 code"。
  { code: "serialized_inventory", label: "序列化库存", kind: "category_required", extensionPoints: ["order_validation", "fulfillment"], applicableCategories: "all", dependsOn: [], conflictsWith: [], configSchema: [], implementationVersion: "core-1.0" },
  { code: "quantity_inventory", label: "数量库存", kind: "category_required", extensionPoints: ["order_validation", "fulfillment"], applicableCategories: "all", dependsOn: [], conflictsWith: [], configSchema: [], implementationVersion: "core-1.0" },
  { code: "bundle_inventory", label: "套装库存", kind: "category_optional", extensionPoints: ["order_validation", "fulfillment"], applicableCategories: "all", dependsOn: ["serialized_inventory"], conflictsWith: [], configSchema: [], implementationVersion: "core-1.0" },
  { code: "pickup", label: "领取", kind: "category_required", extensionPoints: ["fulfillment"], applicableCategories: "all", dependsOn: [], conflictsWith: [], configSchema: [], implementationVersion: "core-1.0" },
  { code: "return", label: "归还", kind: "category_required", extensionPoints: ["fulfillment"], applicableCategories: "all", dependsOn: [], conflictsWith: [], configSchema: [], implementationVersion: "core-1.0" },
  // 手工配送属于通用履约链；第三方运力自动派单仍由后续 integration 扩展承接。
  {
    code: "delivery", label: "配送", kind: "shared",
    extensionPoints: ["menu", "api", "fulfillment", "integration"],
    applicableCategories: "all", dependsOn: [], conflictsWith: [],
    configSchema: [
      { key: "maxDistanceKm", label: "最大配送半径（公里）", type: "number", required: true, min: 0, max: 500 },
      { key: "requireSignature", label: "是否需要签收", type: "boolean", required: false }
    ],
    implementationVersion: "core-1.0"
  },
  {
    code: "locker", label: "智能柜", kind: "shared",
    extensionPoints: ["menu", "api", "fulfillment", "integration"],
    applicableCategories: "all", dependsOn: [], conflictsWith: [],
    configSchema: [{ key: "provider", label: "柜体服务商", type: "string", required: true }]
  },
  {
    code: "dispatch", label: "调度", kind: "category_optional",
    extensionPoints: ["menu", "api", "fulfillment"],
    applicableCategories: [RentalCategoryCode.Vehicle, RentalCategoryCode.Construction], dependsOn: ["serialized_inventory"], conflictsWith: [],
    configSchema: [],
    // `legacy-1.0` 而不是缺省：`/rental-os/dispatch/*` 在历史车辆域里确有十余个
    // 已实现端点（看板、任务领取与处理、优化、硬锁、人工改派…）。CORE-EXT-02A 起初把它
    // 记成「已声明但无可执行模块」，那与现有业务事实不符——而 CORE-EXT-02C 把 API 门禁
    // 改为只认实例后，「无模块因而永不可启用」会让所有车辆空间**永久失去**调度功能，
    // 属于无法解释的回归。标为 legacy 实现版本后，车辆空间显式启用即可继续使用，
    // 且这次启用会留下审计——这正是本任务要的「从品类声明放行改为有人明确开启」。
    implementationVersion: "legacy-1.0"
  },
  {
    code: "usage_reading", label: "使用量读数", kind: "shared",
    extensionPoints: ["order_validation", "fulfillment"],
    // 摄影按快门次数、车辆按里程、工程按工时——读数本身是通用能力，因此对全部品类适用。
    // 写成 "all" 也让新增品类不必回头修改这条定义（CORE-EXT-03 的接入约束）。
    applicableCategories: "all",
    dependsOn: [], conflictsWith: [],
    configSchema: [{ key: "metric", label: "读数指标", type: "enum", required: true, options: ["mileage", "hours", "shutter"] }],
    implementationVersion: "core-1.0"
  },
  {
    code: "qualification", label: "资质审核", kind: "shared",
    extensionPoints: ["menu", "api", "order_validation"],
    applicableCategories: "all", dependsOn: [], conflictsWith: [],
    configSchema: [{ key: "minimumValidityDays", label: "证件最短剩余有效天数", type: "number", required: true, min: 0, max: 3650 }],
    implementationVersion: "core-1.0"
  },
  {
    code: "iot", label: "IoT", kind: "shared",
    extensionPoints: ["menu", "api", "integration"],
    applicableCategories: [RentalCategoryCode.Vehicle, RentalCategoryCode.Construction], dependsOn: [], conflictsWith: [],
    configSchema: [{ key: "provider", label: "遥测服务商", type: "string", required: true }],
    // 同 dispatch：`/rental-os/tbox-devices` 在历史车辆域里已实现。
    implementationVersion: "legacy-1.0"
  },
  {
    code: "camera_kit_handover", label: "摄影套装交接与附件清点", kind: "category_required",
    extensionPoints: ["order_validation", "fulfillment"],
    applicableCategories: [RentalCategoryCode.Camera], dependsOn: ["bundle_inventory"], conflictsWith: [],
    configSchema: [], implementationVersion: "cam-kit-1.0"
  },
  {
    code: "camping_kit_integrity", label: "露营套装完整性", kind: "category_required",
    extensionPoints: ["order_validation", "fulfillment"],
    applicableCategories: [RentalCategoryCode.Camping], dependsOn: ["bundle_inventory"], conflictsWith: [],
    configSchema: [], implementationVersion: "camp-kit-1.0"
  },
  {
    code: "camping_cleaning_turnaround", label: "露营清洁周转", kind: "category_required",
    extensionPoints: ["fulfillment"],
    applicableCategories: [RentalCategoryCode.Camping], dependsOn: ["return"], conflictsWith: [],
    configSchema: [], implementationVersion: "camp-clean-1.0"
  },
  {
    code: "inspection_care", label: "检查与养护", kind: "shared",
    extensionPoints: ["fulfillment"],
    applicableCategories: [RentalCategoryCode.Camera, RentalCategoryCode.Vehicle, RentalCategoryCode.Construction],
    dependsOn: ["return"], conflictsWith: [], configSchema: [], implementationVersion: "core-1.0"
  },
  {
    code: "vehicle_relocation", label: "车辆异地还车调度", kind: "category_optional",
    extensionPoints: ["order_validation", "fulfillment"],
    applicableCategories: [RentalCategoryCode.Vehicle], dependsOn: ["dispatch"], conflictsWith: [],
    configSchema: []
  },
  {
    code: "construction_transport", label: "工程设备运输调度", kind: "category_optional",
    extensionPoints: ["order_validation", "fulfillment"],
    applicableCategories: [RentalCategoryCode.Construction], dependsOn: ["dispatch"], conflictsWith: [],
    configSchema: []
  },
  {
    // CAM-01A：首个真实运行模块。仅摄影品类适用（applicableCategories 收口，
    // 因此露营/车辆/工程既不会声明也无法启用它）。规则由 camera-compatibility 模块以
    // implementationVersion 版本化维护；配置项是可调阈值，不是规则本体。
    code: "camera_compatibility", label: "摄影器材兼容性", kind: "category_required",
    extensionPoints: ["order_validation"],
    applicableCategories: [RentalCategoryCode.Camera], dependsOn: [], conflictsWith: [],
    configSchema: [
      // 供电余量下限：机身+配件峰值功率相对供电额定的余量低于此值即判风险。
      { key: "powerMarginPercent", label: "供电余量下限(%)", type: "number", required: false, min: 0, max: 90 },
      {
        key: "relations",
        label: "商品/资产兼容关系",
        type: "compatibility_relations",
        required: false,
        defaultValue: [],
        description: "结构化关系数据；每条包含 id、关系类型、来源、目标、结论、资料来源和原因，随配置版本与审计快照固化。"
      }
    ],
    implementationVersion: "cam-1.0"
  }
];

export interface RentalCategoryTerminology {
  itemLabel: string;
  itemGroupLabel: string;
  assetLabel: string;
  fulfillmentLabel: string;
  pickupLabel: string;
  returnLabel: string;
  /** 配送/上门类履约方式的行业称呼（车辆＝送车/上门取车、物品＝配送到家）；展示层未取到时回退通用「配送」。 */
  deliveryLabel?: string;
  identifierLabel: string;
  /**
   * 序列号的行业称呼（摄影/工程=序列号、露营=批次号、车辆=车架号）。
   *
   * 与 `identifierLabel` 不同：`identifierLabel` 是资产编号（assetNo，平台内部编号）的叫法，
   * `serialLabel` 是厂商序列号（serialNo）的叫法。可选字段，向后兼容；展示层未取到时回退“序列号”。
   */
  serialLabel?: string;
  usageMetricLabel?: string;
  /**
   * UI-NAV-01：这批资产作为一个整体时的行业称呼（车辆品类叫「车队」）。
   *
   * 单独成字段而不是由 `assetLabel` 推导：中文集合名词不是后缀派生
   * （车辆→车队而非「车辆队」，飞机→机队而非「飞机队」），任何构词规则
   * 都会在下一个品类上出错。缺省表示该品类没有专门的集合说法，
   * 由展示层按「库存」表述。
   */
  assetCollectionLabel?: string;
  /**
   * UI-NAV-01：通用管理入口的完整显示文案。
   *
   * 中文管理术语不能由单数名词稳定拼接出来（例如「车型组」对应「车型管理」，
   * 「门店」对应「门店管理」）。因此精确文案随品类定义注册；未配置时展示层才按
   * 上面的基础术语生成通用兜底。新增品类只需补定义，不修改导航组件。
   */
  navigationLabels?: {
    inventoryGroup?: string;
    itemGroups?: string;
    pricingGroups?: string;
    assets?: string;
    locations?: string;
  };
}

export const RENTAL_PRICING_UNIT_CODES = ["hour", "shift", "day_24h", "calendar_day", "night", "week", "month", "usage", "package"] as const;
export type RentalPricingUnit = (typeof RENTAL_PRICING_UNIT_CODES)[number];

/**
 * 计价单位的展示文案。**唯一来源**，管理端各页面必须引用它而不是各自维护一份。
 *
 * 早前三个页面各写一份 `unitLabels`，三处都把 `month` 写成"月"。需求 4.4.5 要求
 * 「第一阶段『月』默认指 30×24 小时块，页面必须明确显示『30 日』」——文案分散在
 * 三处时，改一处就会与另两处不一致，客户看到的口径取决于他打开了哪个页面。
 *
 * 「自然月」按需求作为独立计费模型保留，不与 30 日月共用含义；启用前需单独确认
 * 跨月余量规则，因此当前没有对应的单位代码。
 */
export const RENTAL_PRICING_UNIT_LABELS: Record<RentalPricingUnit, string> = {
  hour: "小时",
  shift: "班次",
  day_24h: "24 小时",
  calendar_day: "自然日",
  night: "夜",
  week: "周",
  month: "30 日月",
  usage: "使用量",
  package: "整包"
};
/** Rental Core 履约方式的唯一取值来源；品类定义、DTO 与页面不得各自复制。 */
export const RENTAL_FULFILLMENT_MODES = [
  "store_pickup_return",
  "partner_pickup_return",
  "warehouse_pickup_return",
  "locker_pickup_return",
  "delivery",
  "onsite_delivery",
  "carrier_shipping"
] as const;
export type RentalFulfillmentMode = (typeof RENTAL_FULFILLMENT_MODES)[number];

/** 承运寄送的里程碑。实际计租从可信签收开始，到客户交承运商并留存揽收凭证结束。 */
export const RENTAL_CARRIER_SHIPMENT_EVENT_TYPES = [
  "outbound_dispatched",
  "customer_signed",
  "customer_handoff",
  "warehouse_received"
] as const;
export type RentalCarrierShipmentEventType = (typeof RENTAL_CARRIER_SHIPMENT_EVENT_TYPES)[number];

export interface RentalCarrierShipmentEvent {
  id: string;
  tenantId: string;
  workspaceId: string;
  orderId: string;
  type: RentalCarrierShipmentEventType;
  occurredAt: string;
  carrierName: string;
  trackingNumber: string;
  evidenceFileAssetIds: string[];
  recordedBy: string;
  createdAt: string;
}

export interface CreateRentalCarrierShipmentEventRequest {
  type: "outbound_dispatched" | "customer_handoff";
  occurredAt: string;
  carrierName: string;
  trackingNumber: string;
  evidenceFileAssetIds: string[];
}
/**
 * Rental Core 履约地点类型的唯一取值来源。
 *
 * 品类定义、管理端选项和 API DTO 必须共用这一组值。此前 DTO 仍接受旧的
 * pickup_point / delivery_point / parking，却拒绝品类定义真实使用的
 * station / locker / delivery_hub，导致页面能选、保存必然 400。
 */
export const RENTAL_LOCATION_TYPES = ["store", "warehouse", "station", "locker", "delivery_hub", "project_site"] as const;
export type RentalLocationType = (typeof RENTAL_LOCATION_TYPES)[number];
export type RentalSettingModule = "pricing" | "discounts" | "coupons" | "value_added_services" | "rental_rules" | "business_calendar" | "membership_rewards" | "notification_templates";
export type RentalAttributeScope = "item_group" | "asset" | "transaction";
export type RentalAttributeValueType = "string" | "number" | "boolean" | "date" | "select";

export interface RentalAttributeDefinition {
  code: string;
  label: string;
  scope: RentalAttributeScope;
  type: RentalAttributeValueType;
  required?: boolean;
  /** 当前经营空间内唯一；由服务端按字段类型归一化后校验。 */
  unique?: boolean;
  unit?: string;
  options?: string[];
}

export interface RentalInspectionFieldDefinition {
  code: string;
  label: string;
  type: "boolean" | "number" | "text" | "select" | "photo";
  required: boolean;
  unit?: string;
  options?: string[];
  /** 该数值是需在领取/归还之间计算差值的累计读数。 */
  usageMetric?: boolean;
}

/**
 * 品类给**首版规则**的缺省值。这些块只用于生成新空间的第一条规则版本
 * （`RentalRuleConfig`），不再复制进经营设置——规则版本才是报价与订单快照的事实源。
 */
export interface RentalCategoryDefaults {
  fulfillment: { allowDifferentReturnLocation: boolean };
  payment: { timing: RentalRuleConfig["payment"]["timing"] };
  overdue: Pick<RentalRuleConfig["overdue"], "graceMinutes" | "feeMode" | "feeMultiplier">;
  rules: {
    evidenceRequired: boolean;
    cancellation: Pick<RentalRuleConfig["cancellation"], "freeBeforeHours" | "lateFeeType" | "lateFeeValue" | "weatherExceptionEnabled">;
    qualificationDocumentTypes: string[];
  };
  initialSetup: {
    operatorName: string;
    locationName: string;
    locationType: RentalLocationType;
  };
  inspectionFields: RentalInspectionFieldDefinition[];
  sampleBaseAmount: number;
  sampleAmountIncrement: number;
}

export interface RentalCategoryBusinessModel {
  pricingUnits: RentalPricingUnit[];
  defaultPricingUnit: RentalPricingUnit;
  fulfillmentModes: RentalFulfillmentMode[];
  locationTypes: RentalLocationType[];
  /**
   * 配送/上门类履约（delivery、onsite_delivery）的目的地类型：
   * customer_address＝送到客户地址簿里的收货地址（摄影/露营/工程，进订单快照）；
   * tenant_location＝送到租户后台建的营业点/停车据点（车辆），仍用 fulfillmentLocationId，不收客户地址。
   * 用配置表达品类差异，避免在页面与报价里散落 categoryCode 分支。
   */
  deliveryDestination: "customer_address" | "tenant_location";
  settingModules: RentalSettingModule[];
  assetFields: RentalAttributeDefinition[];
  /**
   * 品类主档在通用管理页面中的展示约定。这里只描述文案、固定事实和摘要字段，
   * 不改变 Rental Core 的产品型号、资产或库存结构；新增品类可以通过定义扩展，
   * 无需在 React 页面散落 categoryCode 判断。
   */
  catalogPresentation?: {
    itemGroupDescription?: string;
    itemGroupCodeLabel?: string;
    itemGroupNameLabel?: string;
    itemGroupNamePlaceholder?: string;
    fixedInventoryMode?: RentalInventoryMode;
    fixedUnit?: string;
    itemGroupSummaryFields?: string[];
    assetDescription?: string;
    assetSummaryFields?: string[];
  };
  supportsHolidayPricing: boolean;
  supportsUsagePricing: boolean;
  supportsPreauthorization: boolean;
  supportsQualificationReview: boolean;
  valueAddedServicePresets: string[];
  defaults: RentalCategoryDefaults;
}

/** Controlled names, never arbitrary SVG, URLs or executable icon definitions. */
export const RENTAL_CATEGORY_ICON_CODES = ["rental", "camera", "camping", "construction", "vehicle", "clothing", "tool", "package"] as const;
export interface RentalCategoryDisplayMetadata {
  nameEn?: string;
  descriptionEn?: string;
  icon?: typeof RENTAL_CATEGORY_ICON_CODES[number];
  defaultWorkspaceName?: string;
  defaultWorkspaceNameEn?: string;
  terminologyEn?: Partial<RentalCategoryTerminology>;
}

export interface RentalCategoryDefinition {
  code: RentalCategoryCode;
  name: string;
  description: string;
  /** Optional for immutable legacy snapshots; consumers explicitly fall back to Chinese. */
  display?: RentalCategoryDisplayMetadata;
  supportedInventoryModes: RentalInventoryMode[];
  defaultCapabilities: RentalCapability[];
  /**
   * 该品类进入 production 前必须启用的扩展模块。
   * Rental Core 的库存、地点、定价、订单与履约基础能力由业务配置/数据完整性门禁负责，
   * 不在这里重复建实例；当前四个首发品类暂无强制扩展模块。
   */
  requiredCapabilities: RentalCapability[];
  terminology: RentalCategoryTerminology;
  attributeSchema: Record<string, unknown>;
  businessModel: RentalCategoryBusinessModel;
  version: string;
}

/** SPACE-01：经营空间状态。冻结可恢复，停用是终态。 */
export type BusinessWorkspaceStatus = "active" | "frozen" | "disabled";

/**
 * SPACE-01：经营空间。
 *
 * 一个 SaaS 租户可有多个空间，每个空间只经营一种品类（需求 3）。
 * 品类在创建时确定，不通过普通设置切换——变更品类必须新建空间或显式迁移，
 * 因此更新接口不接受 categoryCode。
 */
/**
 * CORE-EXT-02C：经营空间的运行模式。决定「缺必选能力」是提示还是**服务端拒绝**。
 *
 * 为什么需要它：只在页面上显示「尚未达到生产经营条件」是不够的——按钮隐藏挡不住
 * 直接调 API。但反过来，一律拒绝又会让演示与开发空间无法继续验证通用 Rental Core
 * （那是本阶段明确要保留的能力）。因此把这件事变成空间的显式属性：
 *   - `production`：正式经营。缺任一必选能力时，报价与订单推进类写入一律 fail-closed；
 *   - `demo`：演示。可以跑通用流程，但响应与页面都必须标明非生产；
 *   - `development`：开发自测，同 demo。
 *
 * 存量空间由迁移置为 `development`：它们此前从未被门禁约束过，直接标成 production
 * 会让所有缺能力的既有空间立刻停业——那是无法解释的回归。新建空间默认 `production`，
 * 因为创建时会同事务初始化品类必选能力，本来就应当达到生产条件。
 */
export type BusinessWorkspaceRunMode = "production" | "demo" | "development";

export const BUSINESS_WORKSPACE_RUN_MODES: BusinessWorkspaceRunMode[] = ["production", "demo", "development"];

export interface BusinessWorkspace {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  categoryCode: RentalCategoryCode;
  status: BusinessWorkspaceStatus;
  /** 升级兼容层：既有业务全部归属租户的默认空间。每租户至多一个。 */
  isDefault: boolean;
  runMode: BusinessWorkspaceRunMode;
  createdAt: string;
  updatedAt: string;
}

/**
 * SPACE-01：账号在某个经营空间的成员关系。
 *
 * 角色与数据范围记在成员关系上，因为同一账号可在不同空间拥有不同角色和范围
 * （需求 3）。`roleId` 为空表示沿用租户级默认角色（升级兼容），
 * `dataScope` 为空表示沿用角色自带范围。
 */
export interface WorkspaceMember {
  tenantId: string;
  workspaceId: string;
  userId: string;
  roleId?: string;
  dataScope?: SystemDataScope;
  /** STAFF-BE-01：履约地点范围；缺省/all 兼容既有成员，selected 仅允许列出的地点。 */
  locationScope?: { mode: "all" | "selected"; locationIds: string[] };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBusinessWorkspaceRequest {
  code: string;
  name: string;
  categoryCode: RentalCategoryCode;
  /** 明确采用的发布版本；省略才使用默认推荐，资格始终由服务端复核。 */
  categoryVersionId?: string;
  /** 缺省为 `development`；只有显式转正且全部品类必选能力齐备时才进入正式经营。 */
  runMode?: BusinessWorkspaceRunMode;
}

/** 不含 categoryCode：品类创建后不可通过普通设置变更（需求 3）。 */
export interface UpdateBusinessWorkspaceRequest {
  name?: string;
  status?: BusinessWorkspaceStatus;
  runMode?: BusinessWorkspaceRunMode;
}

export interface SaveWorkspaceMemberRequest {
  userId: string;
  roleId?: string;
  dataScope?: SystemDataScope;
  locationScope?: { mode: "all" | "selected"; locationIds: string[] };
  isActive?: boolean;
}

/**
 * CUSTOMER-01A：空间会员状态（需求 4.8.6 的六态）。
 *
 * 六态必须都在类型里，不能用 active/suspended 两态凑：需求给每一态定义了不同的业务含义
 * （待激活尚未完成认证、风险受限只限制部分能力、已退出是客户主动、已注销是终态），
 * 合并成两态就无法表达「为什么不能下单」，而那正是运营与客服每天要回答的问题。
 */
export const CUSTOMER_MEMBERSHIP_STATUSES = [
  "pending_activation",
  "active",
  "suspended",
  "risk_restricted",
  "exited",
  "closed"
] as const;
export type CustomerMembershipStatus = (typeof CUSTOMER_MEMBERSHIP_STATUSES)[number];

/**
 * CUSTOMER-01A：客户账号状态（需求 4.8.1 / 4.8.13）。
 *
 * 与空间会员状态**分开**：账号是「客户如何登录」，会员关系是「客户在某空间有什么资格」。
 * 停用账号阻止登录全部空间；暂停某个空间的会员关系不影响登录与其他空间业务。
 * 两者共用一个字段是本任务明确要避免的建模错误。
 */
export const CUSTOMER_ACCOUNT_STATUSES = ["active", "suspended", "closed"] as const;
export type CustomerAccountStatus = (typeof CUSTOMER_ACCOUNT_STATUSES)[number];

/** 状态变更动作。解除限制也是独立记录，不允许删除原限制事实（需求 4.8.6）。 */
export const CUSTOMER_STATUS_ACTIONS = [
  "activate",
  "suspend",
  "restrict",
  "release",
  "exit",
  "close",
  "reopen",
  "merge"
] as const;
export type CustomerStatusAction = (typeof CUSTOMER_STATUS_ACTIONS)[number];

/** 状态历史的作用域：账号级（全租户）或空间级（仅目标空间）。 */
export type CustomerStatusScope = "account" | "membership" | "workspace";

/**
 * CUSTOMER-01B：客户在某个经营空间**能否开展新业务**的判定结果。
 *
 * 为什么要把结论结构化返回，而不是返回一个布尔：被拒时业务侧要能告诉客服
 * 「是账号被停了，还是这个空间的会员被暂停了，还是风险受限」——三者的处理人
 * 和处理方式完全不同。只回 false 会把这三种情况压成同一句「不可下单」。
 */
export interface CustomerTransactability {
  allowed: boolean;
  /** account_suspended / account_closed / membership_missing / membership_* / customer_merged */
  reasonCode?: string;
  message?: string;
  accountStatus?: CustomerAccountStatus;
  membershipStatus?: CustomerMembershipStatus;
}

/**
 * CUSTOMER-01E：详情附带的登录账号摘要。
 *
 * 刻意**不复用** `CustomerAccount`：后者带 `loginPhone` 明文，那是登录凭据本身。
 * 管理端只需要判断「有没有开通、现在什么状态」，拿不到也不该拿到凭据。
 *
 * `provisioned` 单独成字段而不是用 `status` 兼表：「未开通」与「已停用」
 * 要走完全不同的入口（前者给开通按钮、后者给状态变更），
 * 用一个可空的 status 表达两者，页面迟早会把 undefined 当成正常。
 */
export interface CustomerAccountSummary {
  provisioned: boolean;
  status?: CustomerAccountStatus;
  loginPhoneMasked?: string;
  suspendedAt?: string;
  closedAt?: string;
}

/** CUSTOMER-01B：账号级状态变更请求。影响该客户在**全部**空间的登录。 */
export interface ChangeCustomerAccountStatusRequest {
  status: CustomerAccountStatus;
  reason: string;
  /**
   * CUSTOMER-01D：注销时必须显式确认那些系统无数据源、只能人工核对的项
   * （退款、押金退还、争议追偿）。缺少确认时服务端拒绝并回传待确认清单——
   * 默认放行等于把「没检查」当成「检查通过」，正是需求 4.8.13 禁止的
   * 「借注销规避欠款、追偿或风险限制」。
   */
  acknowledgedManualChecks?: boolean;
}

/** CUSTOMER-01B：空间会员状态变更请求。只影响**当前会话空间**。 */
export interface ChangeCustomerMembershipStatusRequest {
  status: CustomerMembershipStatus;
  reason: string;
  /** 目标等级（仅在恢复/激活时允许调整）。 */
  levelName?: string;
  /** 同账号注销：注销空间会员关系时也必须显式确认人工核对项（见上）。 */
  acknowledgedManualChecks?: boolean;
}

export const CUSTOMER_RISK_TYPES = [
  "overdue",
  "damage_dispute",
  "identity_anomaly",
  "payment_dispute",
  "other"
] as const;
export type CustomerRiskType = (typeof CUSTOMER_RISK_TYPES)[number];
export const CUSTOMER_RISK_LEVELS = ["low", "medium", "high"] as const;
export type CustomerRiskLevel = (typeof CUSTOMER_RISK_LEVELS)[number];
export const CUSTOMER_RISK_STATUSES = ["open", "reviewing", "closed"] as const;
export type CustomerRiskStatus = (typeof CUSTOMER_RISK_STATUSES)[number];

/** 客户风控记录。租户级记录影响全部空间；空间级记录仅影响记录所属空间。 */
export interface CustomerRiskRecordSummary {
  id: string;
  tenantId: string;
  customerId: string;
  workspaceId?: string;
  riskType: CustomerRiskType;
  level: CustomerRiskLevel;
  detail: string;
  source: string;
  status: CustomerRiskStatus;
  raisedBy?: string;
  raisedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  closeReason?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** 新建风险记录的范围由服务端当前会话解析，不接受 workspaceId。 */
export interface CreateCustomerRiskRecordRequest {
  riskType: CustomerRiskType;
  level: CustomerRiskLevel;
  detail: string;
  scope: "workspace" | "tenant";
}

/** 风险复核只能推进到复核中或关闭，不能回写/重开已关闭记录。 */
export interface ReviewCustomerRiskRecordRequest {
  status: "reviewing" | "closed";
  reason?: string;
}

/** CUSTOMER-01B：敏感资料访问审计条目。只追加。 */
export interface CustomerSensitiveAccessAuditEntry {
  id: string;
  tenantId: string;
  workspaceId?: string;
  customerId: string;
  field: string;
  action: "list" | "detail" | "export" | "reveal";
  revealed: boolean;
  operator?: string;
  permission?: string;
  reason?: string;
  at: string;
}

/** F17：客户身份核验只追加记录；证件原文不进入该记录，影像通过受限文件服务读取。 */
export type CustomerIdentityVerificationResult = "verified" | "rejected" | "revoked";

export interface CustomerIdentityVerificationSummary {
  id: string;
  tenantId: string;
  customerId: string;
  credentialType: string;
  result: CustomerIdentityVerificationResult;
  evidenceFileAssetIds: string[];
  reason: string;
  reviewerUserId: string;
  reviewerName: string;
  reviewedAt: string;
  verifiedAt?: string;
}

export interface SaveCustomerIdentityVerificationRequest {
  credentialType: string;
  result: CustomerIdentityVerificationResult;
  evidenceFileAssetIds: string[];
  reason: string;
}

/** 实名影像上传端点固定业务归属，只允许客户端提交文件元数据。 */
export interface CreateCustomerIdentityUploadRequest {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  idempotencyKey: string;
}

/** SHIP-01：承运凭证上传的归属与场景由订单专用路由固定，只提交文件元数据。 */
export interface CreateCarrierEvidenceUploadRequest {
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  sizeBytes: number;
  idempotencyKey: string;
}

/** CUSTOMER-01B：客户状态历史条目（账号级与空间级同一时间线）。 */
export interface CustomerStatusHistoryEntry {
  id: string;
  tenantId: string;
  customerId: string;
  scope: CustomerStatusScope;
  workspaceId?: string;
  action: CustomerStatusAction;
  fromStatus?: string;
  toStatus: string;
  reason: string;
  operator?: string;
  approver?: string;
  at: string;
}

/** CUSTOMER-01B：客户账号。 */
export interface CustomerAccount {
  id: string;
  tenantId: string;
  customerId: string;
  loginPhone: string;
  loginPhoneMasked: string;
  status: CustomerAccountStatus;
  suspendedAt?: string;
  closedAt?: string;
  lastReason?: string;
  lastOperator?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * CUSTOMER-01D：重复客户候选（需求 4.8.3）。
 *
 * 个人优先以**已验证手机号**识别，可结合实名证件核验；企业结合统一社会信用代码
 * 与已验证联系人识别。`matchedBy` 必须带出来——运营要知道「为什么系统认为这两个是同一人」，
 * 否则人工合并就变成盲签。
 */
export interface CustomerDuplicateCandidate {
  customerId: string;
  name: string;
  phoneMasked: string;
  customerType: "personal" | "corporate";
  /** phone / identity / uscc / contact_phone */
  matchedBy: string;
  matchedValueMasked?: string;
  /** 该候选是否已被合并进别的主档（已合并的不应再作为合并目标）。 */
  mergedIntoCustomerId?: string;
  createdAt: string;
}

/**
 * CUSTOMER-01D：合并冲突预览（需求 4.8.3「明确保留主档、字段取舍、资质处理和冲突项」）。
 *
 * 预览是**只读**的：它不做任何写入，供人工确认后再提交合并。
 */
export interface CustomerMergePreview {
  sourceCustomerId: string;
  targetCustomerId: string;
  /** 逐字段差异。`conflict` 为真表示两边都有值且不同，需要人工取舍。 */
  fieldDiff: Array<{
    field: string;
    sourceValue?: string;
    targetValue?: string;
    conflict: boolean;
  }>;
  sourceMembership?: CustomerMembership;
  targetMembership?: CustomerMembership;
  /** 被合并方将保留的历史引用数量（订单等），合并后仍指向原主档。 */
  preservedReferences: Array<{ kind: string; count: number }>;
  /** 阻止合并的原因；非空时不允许提交。 */
  blockers: Array<{ code: string; message: string }>;
}

/** CUSTOMER-01D：提交人工合并。原因与审批人必填——合并不可逆。 */
export interface MergeCustomersRequest {
  sourceCustomerId: string;
  targetCustomerId: string;
  reason: string;
  approver?: string;
  /** 人工对冲突字段的取舍结论，原样固化进合并映射，供事后解释保留了谁的值。 */
  fieldResolutions?: Record<string, string>;
}

/**
 * CUSTOMER-01D：注销前置检查（需求 4.8.13）。
 *
 * `blockers` 来自**真实存在的事实**，非空即禁止注销。
 * `manualConfirmations` 是本分支尚无数据源的类别（退款、争议、追偿、已完成订单的
 * 押金退还状态）——系统不能假装检查过，因此显式列出、要求人工签字确认后才允许继续。
 * 把它们当成「检查通过」是「借注销规避欠款」的入口。
 */
export interface CustomerClosability {
  closable: boolean;
  blockers: Array<{ code: string; message: string; count?: number }>;
  manualConfirmations: Array<{ code: string; message: string }>;
}

/**
 * CUSTOMER-01C：订单主体角色（需求 4.8.4）。
 *
 * 四个角色分开保存，不允许「只存一个联系人代替企业责任主体」：
 *   * `contract` 签约主体——合同与法律责任归属；
 *   * `payer`    付款主体——账单与收款归属，可与签约主体不同（如总部付款、分公司签约）；
 *   * `user`     使用人——实际取还与使用设备的人；
 *   * `agent`    经办人——受授权代办的人，本身不是责任主体。
 */
export type CustomerOrderSubjectRole = "contract" | "payer" | "user" | "agent";

/**
 * 下单当时的主体快照。名称与脱敏证件都固化——主体后续改名或授权到期
 * 都不得篡改历史订单。
 */
export interface CustomerOrderSubjectSnapshot {
  role: CustomerOrderSubjectRole;
  customerId?: string;
  customerType?: "personal" | "corporate";
  name: string;
  phoneMasked?: string;
  corporateName?: string;
  unifiedSocialCreditCodeMasked?: string;
  /** 经办人专用：授权范围与有效期在下单当时的取值。 */
  agentId?: string;
  authorityScope?: Record<string, boolean>;
  authorityValidFrom?: string;
  authorityValidTo?: string;
  /** 引用的企业合同与开票资料（下单当时生效的那一份）。 */
  contractId?: string;
  contractNo?: string;
  invoiceProfileId?: string;
}

/** 下单时提交的主体选择。省略时回落为「三个主体都是下单客户本人」。 */
export interface CustomerOrderSubjectInput {
  contractSubjectCustomerId?: string;
  payerSubjectCustomerId?: string;
  userSubjectCustomerId?: string;
  agentId?: string;
  contractId?: string;
  invoiceProfileId?: string;
}

/** 校验并解析后的主体集合，由订单侧原样固化。 */
export interface CustomerOrderSubjects {
  contractSubjectCustomerId: string;
  payerSubjectCustomerId: string;
  userSubjectCustomerId: string;
  agentId?: string;
  snapshot: CustomerOrderSubjectSnapshot[];
}

/** CUSTOMER-01C：企业开票资料。 */
export interface CustomerCorporateInvoiceProfile {
  id: string;
  tenantId: string;
  customerId: string;
  invoiceType: "vat_special" | "vat_normal";
  title: string;
  taxNo: string;
  registeredAddress?: string;
  bankName?: string;
  bankAccountMasked?: string;
  contactPhoneMasked?: string;
  receiveEmail?: string;
  isDefault: boolean;
  status: "active" | "disabled";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** CUSTOMER-01C：企业合同。 */
export interface CustomerCorporateContract {
  id: string;
  tenantId: string;
  customerId: string;
  contractNo: string;
  name: string;
  signedAt?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  status: "draft" | "active" | "expired" | "terminated";
  fileRef?: string;
  terminatedReason?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** CUSTOMER-01C / CORP-SETTLE-01A：企业授信与账期主档。 */
export interface CustomerCorporateCredit {
  id: string;
  tenantId: string;
  customerId: string;
  creditLimit: number;
  settlementTermDays: number;
  billingCycle: "monthly" | "semi_monthly" | "per_order";
  status: "active" | "suspended" | "revoked";
  approvedBy?: string;
  approvedAt?: string;
  reason?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveCustomerInvoiceProfileRequest {
  id?: string;
  /** 编辑时必传，用于阻止两名运营人员静默覆盖彼此的修改。 */
  expectedRevision?: number;
  invoiceType: "vat_special" | "vat_normal";
  title: string;
  taxNo: string;
  registeredAddress?: string;
  bankName?: string;
  bankAccount?: string;
  /** 编辑时显式清除已保存的银行账号掩码；两个字段都省略表示保留原值。 */
  clearBankAccount?: boolean;
  contactPhone?: string;
  /** 编辑时显式清除已保存的联系电话掩码；两个字段都省略表示保留原值。 */
  clearContactPhone?: boolean;
  receiveEmail?: string;
  isDefault?: boolean;
  status?: "active" | "disabled";
}

export interface SaveCustomerContractRequest {
  id?: string;
  /** 编辑时必传，用于乐观并发控制。 */
  expectedRevision?: number;
  contractNo: string;
  name: string;
  signedAt?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  status?: "draft" | "active" | "expired" | "terminated";
  fileRef?: string;
  terminatedReason?: string;
}

export interface SaveCustomerCreditRequest {
  /** 已存在授信记录时必传，用于乐观并发控制；首次授信省略。 */
  expectedRevision?: number;
  creditLimit: number;
  settlementTermDays: number;
  billingCycle?: "monthly" | "semi_monthly" | "per_order";
  status?: "active" | "suspended" | "revoked";
  reason: string;
}

/**
 * SPACE-04：租户级共享客户主档。
 *
 * 身份在租户内共享（同一手机号只有一份主档），而订单、优惠券、积分、
 * 会员等级和营销余额按经营空间隔离——后者不在本类型里，各由自己的事实承载。
 *
 * `qualifications` 存资质**原始事实**（如驾驶证是否已验证），不存"是否适用"的结论：
 * 驾驶证对 vehicle 空间有意义、对 camera 空间无意义，适用性由目标空间品类规则判断。
 */
export interface SharedCustomerProfile {
  id: string;
  tenantId: string;
  customerType: "personal" | "corporate";
  name: string;
  phone: string;
  phoneMasked: string;
  email?: string;
  identityVerified: boolean;
  identityNoMasked?: string;
  /** 基础画像主数据（选填）。birthday 统一为 ISO 日期串 YYYY-MM-DD。 */
  gender?: string;
  birthday?: string;
  sourceChannel?: string;
  region?: string;
  qualifications: Record<string, unknown>;
  corporateName?: string;
  corporateTaxNo?: string;
  status: "active" | "suspended";
  /** 回填来源的旧会员主键，仅用于对账追溯，不参与业务判定。 */
  sourceMemberId?: string;
  /**
   * CUSTOMER-01A：本主档已被合并进哪个主档（合并后为终态，不得再用于新业务）。
   *
   * 冗余在主档上是刻意的：合并映射表是权威事实，但「这份主档还能不能用」
   * 是每次下单、报价都要判的高频问题，若每次都去查映射表，
   * 漏查一处就会让一个已被合并的主档继续产生新业务。
   */
  mergedIntoCustomerId?: string;
  createdAt: string;
  updatedAt: string;
  membership?: CustomerMembership;
  /**
   * CUSTOMER-01E：详情接口带出的联系人与授权经办人。
   *
   * 只在**详情**里带（列表不带）：列表要的是"这个人是谁、在本空间什么状态"，
   * 把每个客户的联系人与授权都拉出来会让列表查询变成 N+1，且列表页并不展示它们。
   * 两者刻意分成两个字段而不是一个"关联人"数组——联系人只用于联系，
   * 经办人被授权代办业务，合并成一个数组会让运营把联系人误当成责任主体。
   */
  contacts?: CustomerContactSummary[];
  authorizedAgents?: CustomerAuthorizedAgentSummary[];
  /**
   * CUSTOMER-01E：登录账号摘要。**仅详情**带出，列表为 undefined。
   *
   * 详情里一定有值（`provisioned` 明确给出真假），因此页面不必把
   * "没查到" 与 "没开通" 混为一谈。
   */
  accountSummary?: CustomerAccountSummary;
}

/** 客户资料页中的配送地址摘要。电话只返回脱敏值，订单地址快照不在此处改写。 */
export interface CustomerProfileAddress {
  id: string;
  revision: number;
  recipient: string;
  phoneMasked: string;
  countryCode: string;
  province: string;
  city: string;
  district?: string;
  detail: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  isDefault: boolean;
  updatedAt: string;
}

/** 客户历史订单的轻量摘要；订单详情仍通过订单中心按权限查看。 */
export interface CustomerProfileOrder {
  id: string;
  orderNo: string;
  workspaceId: string;
  workspaceName: string;
  categoryCode: RentalCategoryCode;
  status: string;
  relation: Array<"customer" | "contract_subject" | "payer" | "user" | "booking_identity">;
  startAt: string;
  endAt: string;
  effectiveEndAt?: string;
  finalPayableAmount: number;
  currency: string;
  createdAt: string;
}

/** 积分、营销余额和奖励券按经营空间分别展示，避免把不同空间的余额误加总。 */
export interface CustomerProfileBenefitAccount {
  workspaceId: string;
  workspaceName: string;
  categoryCode: RentalCategoryCode;
  pointsBalance: number;
  marketingBalance: number;
  availableRewardCouponCount: number;
  updatedAt: string;
}

export interface CustomerProfileRewardEntry {
  id: string;
  workspaceId: string;
  workspaceName: string;
  rewardType: "points" | "balance" | "coupon" | string;
  amount: number;
  triggerType: string;
  status: "granted" | "reversed" | string;
  reason: string;
  appliedAt?: string;
  createdAt: string;
  reversedAt?: string;
}

export interface CustomerProfileCouponEntry {
  id: string;
  workspaceId: string;
  workspaceName: string;
  templateName: string;
  templateCode: string;
  templateVersion: string;
  discountType: string;
  discountValue: number;
  status: string;
  grantReason: string;
  effectiveFrom: string;
  effectiveTo: string;
  lockedOrderId?: string;
  redeemedOrderId?: string;
  lockedDiscountAmount?: number;
  createdAt: string;
}

export interface CustomerProfileMembershipAssignment {
  id: string;
  planId: string;
  planVersionId: string;
  planName: string;
  source: string;
  status: string;
  effectiveFrom: string;
  effectiveTo?: string;
  reason?: string;
  revokedAt?: string;
  revokeReason?: string;
  snapshot: Record<string, unknown>;
  createdAt: string;
}

export interface CustomerProfileCorporateRelation {
  id: string;
  corporateCustomerId: string;
  corporateName: string;
  personalCustomerId: string;
  personalCustomerName: string;
  role: string;
  department?: string;
  employeeNo?: string;
  status: string;
  effectiveFrom: string;
  effectiveTo?: string;
  reason?: string;
}

/**
 * 个人/企业客户资料页的聚合读模型。
 *
 * 主档、账号和会员关系在租户内共享；订单、地址、积分、券和奖励保留空间字段，
 * 前端必须按空间分组展示，不能为了“总览”把不同空间的资金/权益相加。
 */
export interface CustomerProfileOverview {
  profile: SharedCustomerProfile;
  addresses: CustomerProfileAddress[];
  qualificationRevisions: CustomerQualificationRevision[];
  statusHistory: CustomerStatusHistoryEntry[];
  sensitiveAccess?: CustomerSensitiveAccessAuditEntry[];
  corporateRelations: CustomerProfileCorporateRelation[];
  membershipPlanAssignments: CustomerProfileMembershipAssignment[];
  benefits: {
    accounts: CustomerProfileBenefitAccount[];
    rewards: CustomerProfileRewardEntry[];
    coupons: CustomerProfileCouponEntry[];
  };
  orders: {
    items: CustomerProfileOrder[];
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface CustomerProfileOrderQuery {
  page?: number;
  pageSize?: number;
}

/** 管理端维护客户配送地址；编辑时省略 phone 表示保留原电话。 */
export interface SaveCustomerProfileAddressRequest {
  id?: string;
  revision?: number;
  recipient: string;
  phone?: string;
  countryCode?: string;
  province: string;
  city: string;
  district?: string;
  detail: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
}

/** CUSTOMER-01E：联系人摘要。号码一律只给脱敏值。 */
export interface CustomerContactSummary {
  id: string;
  kind: "emergency" | "corporate" | "other";
  name: string;
  phoneMasked: string;
  relation?: string;
  isPrimary: boolean;
  status: string;
  /** 该联系人本身若也是本租户客户，指向其主档；仅作关联，不代表责任主体。 */
  linkedCustomerId?: string;
}

/** CUSTOMER-01E：授权经办人摘要。带授权范围与有效期，供事后判断当时是否有效。 */
export interface CustomerAuthorizedAgentSummary {
  id: string;
  agentName: string;
  agentPhoneMasked: string;
  authorityScope: Record<string, unknown>;
  validFrom: string;
  validTo?: string;
  status: string;
}

export interface CustomerMembership {
  id: string;
  tenantId: string;
  customerId: string;
  levelName: string;
  status: CustomerMembershipStatus;
  firstOrderAt?: string;
  /** 各终态/限制态的发生时间。历史必须留痕，解除时不清空原时间戳。 */
  suspendedAt?: string;
  restrictedAt?: string;
  exitedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveSharedCustomerRequest {
  customerType: "personal" | "corporate";
  name: string;
  phone: string;
  email?: string;
  identityNo?: string;
  /** 基础画像主数据（选填）。birthday 为 ISO 日期串 YYYY-MM-DD。 */
  gender?: string;
  birthday?: string;
  sourceChannel?: string;
  region?: string;
  qualifications?: Record<string, unknown>;
  corporateName?: string;
  unifiedSocialCreditCode?: string;
  registeredAddress?: string;
  legalRepName?: string;
  legalRepPhone?: string;
  industry?: string;
  scale?: CustomerCorporateScale;
  clearEmail?: boolean;
  /** @deprecated Compatibility input only; new records store this in structured corporate profile. */
  corporateTaxNo?: string;
}

/**
 * 客户基础主数据的预置下拉项（全部选填）。管理端据此渲染快速选择，
 * 服务端 DTO 用同一常量做 `@IsIn` 兜底，避免两处枚举漂移。取值仅作展示与检索，不参与业务判定。
 */
export const CUSTOMER_GENDERS = ["male", "female", "unknown"] as const;
export type CustomerGender = (typeof CUSTOMER_GENDERS)[number];
export const CUSTOMER_GENDER_LABELS: Record<CustomerGender, string> = {
  male: "男",
  female: "女",
  unknown: "未知"
};

export const CUSTOMER_SOURCE_CHANNELS = ["walk_in", "mini_program", "referral", "online_ad", "other"] as const;
export type CustomerSourceChannel = (typeof CUSTOMER_SOURCE_CHANNELS)[number];
export const CUSTOMER_SOURCE_CHANNEL_LABELS: Record<CustomerSourceChannel, string> = {
  walk_in: "到店",
  mini_program: "小程序",
  referral: "朋友推荐",
  online_ad: "线上广告",
  other: "其他"
};

export const CUSTOMER_CORPORATE_INDUSTRIES = ["media", "outdoor_tourism", "auto_service", "construction", "events", "other"] as const;
export type CustomerCorporateIndustry = (typeof CUSTOMER_CORPORATE_INDUSTRIES)[number];
export const CUSTOMER_CORPORATE_INDUSTRY_LABELS: Record<CustomerCorporateIndustry, string> = {
  media: "影视传媒",
  outdoor_tourism: "文旅户外",
  auto_service: "汽车服务",
  construction: "建筑工程",
  events: "活动会展",
  other: "其他"
};

export const CUSTOMER_CORPORATE_SCALES = ["1-10", "11-50", "51-200", "200+"] as const;
export type CustomerCorporateScale = (typeof CUSTOMER_CORPORATE_SCALES)[number];
export const CUSTOMER_CORPORATE_SCALE_LABELS: Record<CustomerCorporateScale, string> = {
  "1-10": "1-10人",
  "11-50": "11-50人",
  "51-200": "51-200人",
  "200+": "200人以上"
};

/** 租户统一注册审核模式。 */
export const CUSTOMER_MEMBERSHIP_REGISTRATION_MODES = ["automatic", "manual"] as const;
export type CustomerMembershipRegistrationMode = (typeof CUSTOMER_MEMBERSHIP_REGISTRATION_MODES)[number];

export const CUSTOMER_MEMBERSHIP_REVIEW_TYPES = ["registration", "corporate_registration", "qualification"] as const;
export type CustomerMembershipReviewType = (typeof CUSTOMER_MEMBERSHIP_REVIEW_TYPES)[number];

export const CUSTOMER_MEMBERSHIP_REVIEW_STATUSES = [
  "pending", "approved", "rejected", "supplement_required", "cancelled"
] as const;
export type CustomerMembershipReviewStatus = (typeof CUSTOMER_MEMBERSHIP_REVIEW_STATUSES)[number];

export const CUSTOMER_QUALIFICATION_STATUSES = [
  "not_submitted", "pending", "approved", "rejected", "expired", "revoked"
] as const;
export type CustomerQualificationStatus = (typeof CUSTOMER_QUALIFICATION_STATUSES)[number];

export interface CustomerMembershipRegistrationSettings {
  registrationMode: CustomerMembershipRegistrationMode;
  updatedAt?: string;
  /** Compatibility signal only; permissions still come from the original server guard. */
  supportsOnlyNewImport?: boolean;
}

export interface UpdateCustomerMembershipRegistrationSettingsRequest {
  registrationMode: CustomerMembershipRegistrationMode;
}

/** APP 和后台均使用这份注册契约；workspaceId 永远从服务端会话解析。 */
export interface RegisterPersonalMembershipRequest {
  /** 后台资料导入：已存在会员只返回 skipped，不激活、不改资料、不重置账号。 */
  onlyNew?: boolean;
  name: string;
  phone: string;
  email?: string;
  identityNo?: string;
  /** 基础画像主数据（选填）。birthday 为 ISO 日期串 YYYY-MM-DD。 */
  gender?: string;
  birthday?: string;
  sourceChannel?: string;
  region?: string;
  /** admin / app。客户端不得伪造后台直通过标记。 */
  channel: "admin" | "app";
  /** 管理端仅能设置一次性临时密码；服务端只保存哈希。 */
  temporaryPassword?: string;
  /** 后台有审核权限时可直接通过；APP 请求永远忽略它。 */
  directApprove?: boolean;
  /** 客户端重试键。服务端以客户主档和空间关系保证最终幂等。 */
  idempotencyKey?: string;
}

/** 管理端编辑个人会员主档；证件号只接收一次并以脱敏形式保存。 */
export interface SavePersonalMembershipRequest {
  name: string;
  /** 留空则保留现有手机号；变更时只保存新的掩码展示值。 */
  phone?: string;
  email?: string;
  identityNo?: string;
  /** 基础画像主数据（选填）。birthday 为 ISO 日期串 YYYY-MM-DD。 */
  gender?: string;
  birthday?: string;
  sourceChannel?: string;
  region?: string;
}

/** 企业会员主档。企业管理员、员工均通过 CustomerCorporateMembership 另行关联个人会员。 */
export interface SaveCorporateMembershipRequest {
  id?: string;
  name: string;
  /** 新建企业必填；编辑留空则保留现有手机号。 */
  phone?: string;
  /** 编辑时省略则保留已有邮箱；clearEmail 才会显式清除。 */
  email?: string;
  clearEmail?: boolean;
  corporateName: string;
  /** 新建企业必填；编辑留空则保留现有法定代码。接口只返回掩码。 */
  unifiedSocialCreditCode?: string;
  registeredAddress?: string;
  legalRepName?: string;
  /** 原文仅用于首次写入，数据库/API 只保留掩码。编辑省略即保留。 */
  legalRepPhone?: string;
  industry?: string;
  scale?: CustomerCorporateScale;
  /** @deprecated 仅供旧后台请求迁移期兼容；不再写入 CustomerProfile。 */
  corporateTaxNo?: string;
}

export interface CustomerCorporateProfileSummary {
  legalName: string;
  unifiedSocialCreditCodeMasked: string;
  registeredAddress?: string;
  legalRepName?: string;
  legalRepPhoneMasked?: string;
  industry?: string;
  scale?: CustomerCorporateScale;
}

export interface CorporateRegistrationReviewSnapshot extends CustomerCorporateProfileSummary {
  contactName: string;
  contactPhoneMasked: string;
  email?: string;
}

export interface CustomerMembershipReview {
  id: string;
  tenantId: string;
  sourceWorkspaceId?: string;
  customerId: string;
  customerName?: string;
  reviewType: CustomerMembershipReviewType;
  qualificationType?: string;
  status: CustomerMembershipReviewStatus;
  channel: string;
  reason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  qualificationSnapshot?: CustomerQualificationRevision;
  corporateSnapshot?: CorporateRegistrationReviewSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewCustomerMembershipRequest {
  status: Extract<CustomerMembershipReviewStatus, "approved" | "rejected" | "supplement_required" | "cancelled">;
  reason?: string;
}

export interface CustomerMembershipQualificationType {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  categoryCode: RentalCategoryCode;
  capabilityCode?: string;
  requiredForBooking: boolean;
  status: "enabled" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface SaveCustomerMembershipQualificationTypeRequest {
  id?: string;
  code: string;
  name: string;
  capabilityCode?: string;
  requiredForBooking?: boolean;
  status?: "enabled" | "disabled";
}

export interface CustomerQualificationRef {
  id: string;
  customerId: string;
  qualificationType: string;
  referenceNoMasked?: string;
  issuedAt?: string;
  expiresAt?: string;
  status: CustomerQualificationStatus;
  /** 最近一次提交来源；不是审核结论。 */
  source?: "admin" | "app" | string;
  evidenceRef?: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerQualificationApplicableScope {
  workspaceId: string;
  categoryCode: RentalCategoryCode;
  capabilityCode?: string;
  requiredForBooking: boolean;
}

/** 每次证件提交对应一份不可变快照，供审核详情和重审历史回看。 */
export interface CustomerQualificationRevision {
  id: string;
  tenantId?: string;
  workspaceId: string;
  customerId: string;
  qualificationType: string;
  categoryCode: RentalCategoryCode;
  capabilityCode?: string;
  applicableScope: CustomerQualificationApplicableScope;
  referenceNoMasked?: string;
  issuedAt?: string;
  expiresAt?: string;
  evidenceRef?: string;
  source: "admin" | "app" | string;
  submittedBy?: string;
  submittedAt: string;
  qualificationStatus: CustomerQualificationStatus;
  reviewStatus: CustomerMembershipReviewStatus;
  reviewReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewId?: string;
  createdAt: string;
}

/** 当前空间个人会员管理列表。账号、空间关系与证件状态同时展示，但不包含任何明文凭据。 */
export interface PersonalMembershipMember {
  customerId: string;
  name: string;
  phoneMasked: string;
  email?: string;
  identityNoMasked?: string;
  /** 基础画像主数据（选填）。birthday 为 ISO 日期串 YYYY-MM-DD。 */
  gender?: string;
  birthday?: string;
  sourceChannel?: string;
  region?: string;
  membershipStatus: CustomerMembershipStatus;
  levelName: string;
  account: CustomerAccountSummary;
  qualifications: CustomerQualificationRef[];
  createdAt: string;
}

export interface CorporateMembershipMember {
  customerId: string;
  name: string;
  corporateName?: string;
  email?: string;
  corporateProfile?: CustomerCorporateProfileSummary;
  phoneMasked: string;
  membershipStatus: CustomerMembershipStatus;
  employeeCount: number;
  adminCount: number;
  createdAt: string;
}

export interface SubmitCustomerQualificationRequest {
  qualificationType: string;
  referenceNo?: string;
  issuedAt?: string;
  expiresAt?: string;
  evidenceRef?: string;
}

export interface SetCustomerMembershipTemporaryPasswordRequest {
  temporaryPassword: string;
}

export interface CustomerCorporateMembership {
  id: string;
  corporateCustomerId: string;
  personalCustomerId: string;
  personalCustomerName?: string;
  role: "admin" | "employee";
  department?: string;
  employeeNo?: string;
  status: "active" | "suspended" | "exited";
  effectiveFrom: string;
  effectiveTo?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveCustomerCorporateMembershipRequest {
  personalCustomerId: string;
  role: "admin" | "employee";
  department?: string;
  employeeNo?: string;
  status?: "active" | "suspended" | "exited";
  effectiveFrom?: string;
  effectiveTo?: string;
  reason?: string;
}

export const CUSTOMER_MEMBERSHIP_PLAN_TARGET_TYPES = ["personal", "corporate"] as const;
export type CustomerMembershipPlanTargetType = (typeof CUSTOMER_MEMBERSHIP_PLAN_TARGET_TYPES)[number];

export type CustomerMembershipBenefitType =
  | "rental_discount"
  | "deposit_reduction"
  | "preauth_reduction"
  | "service_benefit"
  | "priority_reservation"
  | "quote_validity_extension";

export type CustomerMembershipBenefitScope =
  | { type: "tenant" }
  | { type: "workspaces"; workspaceIds: string[] }
  | { type: "categories"; categoryCodes: RentalCategoryCode[] };

export function membershipBenefitScopeMatches(
  scope: CustomerMembershipBenefitScope | undefined,
  workspaceId: string,
  categoryCode: RentalCategoryCode
): boolean {
  if (!scope || scope.type === "tenant") return true;
  if (scope.type === "workspaces") return Array.isArray(scope.workspaceIds) && scope.workspaceIds.includes(workspaceId);
  if (scope.type === "categories") return Array.isArray(scope.categoryCodes) && scope.categoryCodes.includes(categoryCode);
  return false;
}

export interface CustomerMembershipBenefit {
  type: CustomerMembershipBenefitType;
  scope?: CustomerMembershipBenefitScope;
  /** percentage / amount / quota / priority */
  calculation: "percentage" | "amount" | "quota" | "priority";
  value: number;
  maximum?: number;
  applicableServiceIds?: string[];
  stackable?: boolean;
  conditions?: Record<string, unknown>;
}

/** 报价实际消费的会员权益快照；方案后续调整不得改写这次取价与减免依据。 */
export interface RentalMembershipBenefitEvaluation {
  /** Frozen service applicability; [] means all. Legacy absence uses original allocation keys, never current plans. */
  applicableServiceIds?: string[];
  scope?: CustomerMembershipBenefitScope;
  scopeMatched?: boolean;
  source: "personal" | "corporate";
  planId: string;
  planVersionId: string;
  planName: string;
  type: CustomerMembershipBenefitType;
  calculation: CustomerMembershipBenefit["calculation"];
  configuredValue: number;
  appliesTo: "rental" | "service" | "deposit" | "preauthorization" | "quote_validity" | "priority";
  appliedAmount: number;
  /**
   * 本次减免所依据的费用基数（优惠方案与券之后的净额）。
   *
   * 续租按全租期重算时必须知道它：只有拿「原基数」与「新基数」对比，才能判断这条
   * 会员权益该不该跟着放大。缺了它就只能冻结原减免额，新增租期拿不到会员折扣。
   * 历史快照没有此字段，续租时退回冻结口径。
   */
  base?: number;
  /** 权益配置的封顶值。重算时封顶不因基数变大而放宽，因此必须一起固化。 */
  configuredMaximum?: number;
  /** 押金/预授权权益的风控依据：商品风险级别、客户风险校验结果与当时空间限额。 */
  securityRiskLevels?: Array<RentalSecurityRiskLevel | "unclassified">;
  securityRiskAssessments?: Array<{
    itemGroupId?: string;
    pricingGroupId?: string;
    riskLevel: RentalSecurityRiskLevel | "unclassified";
    allowed: boolean;
    quantity: number;
  }>;
  securityRiskCheck?: "not_enabled" | "not_checked" | "clear" | "open_risk" | "unavailable";
  securityPolicySnapshot?: RentalMembershipSecurityReductionPolicy;
  securityOriginalAmount?: number;
  securityEligibleBase?: number;
  skippedReason?: string;
  allocations?: Record<string, number>;
  detail: string;
}

export interface CustomerMembershipPlanVersion {
  id: string;
  planId: string;
  version: number;
  status: "draft" | "published" | "disabled";
  levelRank: number;
  isDefault: boolean;
  isRecommended: boolean;
  appVisible: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  eligibility: Record<string, unknown>;
  benefits: CustomerMembershipBenefit[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  disabledBy?: string;
  disabledAt?: string;
  disableReason?: string;
  restoredFromVersionId?: string;
  restoreReason?: string;
}

export interface CustomerMembershipScopeOptions {
  workspaces: Array<{ id: string; code: string; name: string; categoryCode: RentalCategoryCode }>;
  categories: Array<{ code: RentalCategoryCode; name: string }>;
}

export interface BookingMemberOption {
  customerId: string;
  name: string;
  phoneMasked: string;
  membershipStatus: CustomerMembershipStatus;
}

export interface CustomerMembershipPlan {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  targetType: CustomerMembershipPlanTargetType;
  status: "draft" | "active" | "disabled";
  currentVersion?: CustomerMembershipPlanVersion;
  versions?: CustomerMembershipPlanVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveCustomerMembershipPlanRequest {
  id?: string;
  code: string;
  name: string;
  targetType: CustomerMembershipPlanTargetType;
  levelRank: number;
  isDefault?: boolean;
  isRecommended?: boolean;
  appVisible?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  eligibility?: Record<string, unknown>;
  benefits: CustomerMembershipBenefit[];
}

export interface CustomerMembershipPlanAssignment {
  id: string;
  customerId: string;
  planId: string;
  planVersionId: string;
  source: "manual" | "system" | "corporate_contract";
  status: "active" | "expired" | "revoked";
  effectiveFrom: string;
  effectiveTo?: string;
  reason?: string;
  revokedBy?: string;
  revokedAt?: string;
  revokeReason?: string;
  snapshot: { planName: string; targetType: CustomerMembershipPlanTargetType; benefits: CustomerMembershipBenefit[] };
  createdAt: string;
}

/** 新建报价/订单的预约身份。个人始终是实际使用人与资质校验来源。 */
export interface RentalBookingIdentityInput {
  /** 默认 personal；enterprise_employee 必须同时指定当前空间的有效企业员工关系。 */
  bookingIdentity?: "personal" | "enterprise_employee";
  corporateCustomerId?: string;
  /** 默认 false；开启后企业同时成为签约与付款主体，个人仍是使用人。 */
  enterpriseContractAndPayer?: boolean;
}

/** 由服务端解析并冻结，页面和客户端不能自行构造。 */
export interface RentalMembershipSnapshot {
  bookingIdentity: "personal" | "enterprise_employee";
  personalCustomerId: string;
  personalCustomerName: string;
  corporateCustomerId?: string;
  corporateCustomerName?: string;
  corporateMembershipId?: string;
  enterpriseContractAndPayer: boolean;
  /** 仅由订单确认事务冻结；缺失的旧单须核对原账，不用当前主档补写历史。 */
  settlement?: {
    mode: "per_order" | "credit";
    payerCustomerId: string;
    currency: string;
    billingCycle: "monthly" | "semi_monthly" | "per_order";
    creditId?: string;
    creditRevision?: number;
    confirmedAt: string;
  };
  benefitSource: "personal" | "corporate";
  personalPlan?: CustomerMembershipPlanAssignment;
  corporatePlan?: CustomerMembershipPlanAssignment;
  /** 本次下单时实际使用的个人证件状态；后续资料修改不改写历史判断。 */
  qualifications: CustomerQualificationRef[];
  resolvedAt: string;
}

export interface CustomerMembershipBookingOption {
  corporateCustomerId: string;
  corporateCustomerName: string;
  corporateMembershipId: string;
  role: CustomerCorporateMembership["role"];
  effectiveTo?: string;
}

export interface AssignCustomerMembershipPlanRequest {
  customerId: string;
  planVersionId: string;
  source?: "manual" | "system" | "corporate_contract";
  effectiveFrom?: string;
  effectiveTo?: string;
  reason?: string;
}

export interface CustomerMembershipPlanVersionActionRequest {
  reason: string;
}

/**
 * CORP-SETTLE-01A：企业授信当前账面摘要。
 *
 * `reservedAmount` 是已确认但尚未结算的订单占用，`receivableAmount` 是已结算、
 * 尚未回款的企业应收；可用额度必须由服务端按「额度 - 两者」计算，客户端不能自行
 * 传入或覆盖。
 */
export interface CustomerCorporateCreditAccountSummary {
  tenantId: string;
  customerId: string;
  creditLimit: number;
  reservedAmount: number;
  receivableAmount: number;
  availableAmount: number;
  currency: string;
  status: CustomerCorporateCredit["status"];
  billingCycle: CustomerCorporateCredit["billingCycle"];
  settlementTermDays: number;
}

/** CORP-SETTLE-01A：授信账务流水，追加式且不可编辑。 */
export interface CustomerCorporateCreditLedgerEntry {
  id: string;
  tenantId: string;
  customerId: string;
  workspaceId?: string;
  orderId?: string;
  entryType: "reserve" | "release" | "settle" | "payment" | "payment_allocation" | "adjust";
  amount: number;
  reservedDelta: number;
  receivableDelta: number;
  reservedAfter: number;
  receivableAfter: number;
  currency: string;
  idempotencyKey: string;
  reason: string;
  operator?: string;
  occurredAt: string;
  createdAt: string;
}

/** 财务按原合同/账单核定一笔企业债权到期日，不由程序推算账期。 */
export interface RecordCustomerCorporateCreditMaturityRequest {
  ledgerId: string;
  dueAt: string;
  basisRef: string;
  reason: string;
  idempotencyKey: string;
}
export interface CustomerCorporateCreditMaturityReceipt {
  ledgerId: string;
  orderId: string;
  currency: string;
  dueAt: string;
  basisRef: string;
  reason: string;
  idempotencyKey: string;
  recordedBy: string;
  recordedAt: string;
}

/** CORP-SETTLE-01A：企业账期回款登记。 */
export interface RecordCustomerCorporateCreditPaymentRequest {
  amount: number;
  currency?: string;
  reason: string;
  idempotencyKey: string;
}

export interface CustomerMembershipPlanAssignmentActionRequest {
  reason: string;
}

export interface TenantRentalProfile {
  tenantId: string;
  categoryCode: RentalCategoryCode;
  capabilities: RentalCapability[];
  terminology: RentalCategoryTerminology;
  configVersion: string;
  initializedAt: string;
  updatedAt: string;
}

/** 经营空间可启用的收款方式。线上方式还必须通过租户 Provider 配置与实时校验。 */
export const RENTAL_PAYMENT_METHOD_CODES = [
  "offline_cash",
  "offline_transfer",
  "alipay",
  "wechat_pay"
] as const;
export type RentalPaymentMethod = (typeof RENTAL_PAYMENT_METHOD_CODES)[number];
export const RENTAL_OFFLINE_PAYMENT_METHOD_CODES = ["offline_cash", "offline_transfer"] as const;
export type RentalOfflinePaymentMethod = (typeof RENTAL_OFFLINE_PAYMENT_METHOD_CODES)[number];
export const DEFAULT_RENTAL_PAYMENT_METHODS: RentalPaymentMethod[] = [...RENTAL_PAYMENT_METHOD_CODES];

/** 一个本地配送承接区域；省市必填，区县留空表示整座城市。 */
export interface RentalDeliveryServiceArea {
  province: string;
  city: string;
  district?: string;
}

/** 本地配送区域策略。allowlist 仅允许列出的区域，不调用外部地图或地理编码服务。 */
export interface RentalDeliveryServiceAreaPolicy {
  mode: "all" | "allowlist";
  areas: RentalDeliveryServiceArea[];
}

/**
 * 配送/上门类履约的收货地址快照（进订单不可变快照，需求 4.3 同款口径：主档改动不篡改历史订单）。
 * 事实源是客户地址簿 customer_delivery_addresses；下单时按选定地址固化一份。
 * `phone` 为明文，仅运营视图；下发客户端前必须置空并只给 `phoneMasked`。
 */
export interface RentalDeliveryAddressSnapshot {
  /** 来源地址簿记录 id，仅备查；地址内容以本快照为准，不回读地址簿。 */
  addressId?: string;
  recipient: string;
  /** 明文电话，仅运营视图；客户视图必须省略。 */
  phone?: string;
  phoneMasked: string;
  countryCode: string;
  province: string;
  city: string;
  district?: string;
  detail: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

/** 后台代客建单用的本单收货地址输入。服务端校验并固化为快照，不会替客户修改地址簿。 */
export interface RentalDeliveryAddressDraft {
  recipient: string;
  phone: string;
  countryCode?: string;
  province: string;
  city: string;
  district?: string;
  detail: string;
  postalCode?: string;
}

export interface TenantRentalBusinessSettings {
  tenantId: string;
  /** 经营空间资源排期；缺省不启用自动任务。 */
  allocation?: { autoPreassign: boolean; preassignDays: number; autoLock: boolean; lockMinutes: number; protectManual: boolean };
  categoryCode: RentalCategoryCode;
  configVersion: string;
  pricing: {
    enabledUnits: RentalPricingUnit[];
    defaultUnit: RentalPricingUnit;
    /**
     * 经营空间的结算币种（需求 §948）。
     *
     * 事实来源在这里而不是租户表：这份设置的主键就是 workspaceId，一个租户下的香港店与
     * 深圳店天然各存一份。租户级只提供**新建空间时的默认值**，不做覆盖来源。
     */
    currency: RentalCurrency;
    taxIncluded: boolean;
    /**
     * **兼容开关**：是否仍启用 PRICE-03 之前的空间级 `weekendMultiplier` /
     * `holidayMultiplier` 倍率。
     *
     * 只作用于这两个旧字段。逐商品的 `dayTypePrices`、周期性计价时段与日期时间覆盖
     * 都是价格版本里的显式配置，关掉本开关后照常生效；旧倍率关掉后落回商品基础价。
     * 若将来需要「整体关闭按日期类型加价」，应新增语义明确的 `dateTypePricingEnabled`，
     * 不要复用本字段——复用会让同一个布尔同时表达两种不同范围。
     */
    holidayPricingEnabled: boolean;
  };
  /**
   * 履约能力开关。**只**保留运营层面的启用集合；「是否允许异地归还」、付款时机、
   * 押金模式与逾期规则属于 `RentalRuleConfig`（规则版本），由报价与订单快照固化。
   * 早前这里各存一份副本，报价却只读规则快照——设置里那份从未参与计算，只会让
   * 运营改了设置却发现订单金额不变。存量 JSON 行里仍可能带旧键，读路径忽略即可。
   */
  fulfillment: {
    enabledModes: RentalFulfillmentMode[];
    /** 本地配送地址范围。旧设置缺省按不限制读取，租户显式改为 allowlist 后才启用地区拦截。 */
    deliveryServiceArea?: RentalDeliveryServiceAreaPolicy;
  };
  payment: {
    /** 空间允许客户/运营选择的收款方式；支付宝/微信仍需另有已验证的租户 Provider。 */
    enabledMethods: RentalPaymentMethod[];
  };
  calendar: {
    weekendDays: number[];
    holidayPricingEnabled: boolean;
    officialCalendarRegion: "CN" | "NONE";
    /**
     * 每周默认营业模板，下标 0=周日 … 6=周六（与 `weekendDays` 同一编号口径）。
     *
     * 未配置时视为「未声明时段限制」，不校验时点——存量经营空间没有这份模板，
     * 把缺省当成"全天不营业"会让所有既有租户立刻无法下单。
     */
    weeklyHours?: RentalBusinessHours[];
    /**
     * IANA 时区标识（如 `Asia/Shanghai`），决定营业日界。
     *
     * 自然日、夜与日历日期类型都按这个时区切分日界；缺省视为 `Asia/Shanghai`。
     * 存标识而不是固定偏移，是为了让实行夏令时的地区也能算对日界。
     * 该设置在 SPACE-03 之后按经营空间存储，因此实际粒度是每个经营空间一个时区。
     */
    timeZone?: string;
  };
  membership: {
    signupRewardEnabled: boolean;
    signupRewardType: "points" | "balance" | "coupon";
    signupRewardAmount: number;
    signupRewardCouponTemplateId?: string;
    referralRewardEnabled: boolean;
    referralRewardType: "points" | "balance" | "coupon";
    referrerRewardAmount: number;
    inviteeRewardAmount: number;
    referralRewardCouponTemplateId?: string;
    referralTrigger: "registration" | "identity_verified" | "first_order_completed";
  };
  notifications: {
    enabledEvents: string[];
    editableChannels: Array<"sms" | "app_push" | "wechat" | "email">;
  };
  updatedAt: string;
  updatedBy: string;
}

export interface SaveTenantRentalBusinessSettingsRequest extends Omit<TenantRentalBusinessSettings, "tenantId" | "categoryCode" | "configVersion" | "updatedAt" | "updatedBy"> {}

export interface RentalCouponTemplate {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  discountType: "fixed_amount" | "percentage";
  discountValue: number;
  minimumSpend: number;
  maximumDiscount?: number;
  /** 优惠作用对象；普通券不得作用于押金、预授权或异常费用。 */
  appliesTo: RentalDiscountTarget;
  /** 是否允许与已应用的自动优惠方案叠加。 */
  stackableWithDiscountPlans: boolean;
  totalQuota: number;
  claimedQuantity: number;
  perCustomerLimit: number;
  perCustomerUseLimit: number;
  totalBudget?: number;
  lockedBudget: number;
  redeemedBudget: number;
  /** 可领取时段；旧模板回填为原 effectiveFrom/effectiveTo，保持兼容。 */
  claimFrom: string;
  claimTo: string;
  /** 券可使用时间；只按报价/订单确认时点判断，不拿租赁开始时间代替。 */
  effectiveFrom: string;
  effectiveTo: string;
  /** 可选的适用租期窗口，按租赁开始时点判断。 */
  applicableRentalFrom?: string;
  applicableRentalTo?: string;
  applicableItemGroupIds: string[];
  status: "draft" | "scheduled" | "active" | "paused" | "ended" | "void";
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveRentalCouponTemplateRequest {
  id?: string;
  code: string;
  name: string;
  discountType: "fixed_amount" | "percentage";
  discountValue: number;
  minimumSpend: number;
  maximumDiscount?: number;
  appliesTo?: RentalDiscountTarget;
  stackableWithDiscountPlans?: boolean;
  totalQuota: number;
  perCustomerLimit: number;
  perCustomerUseLimit?: number;
  totalBudget?: number;
  claimFrom?: string;
  claimTo?: string;
  effectiveFrom: string;
  effectiveTo: string;
  applicableRentalFrom?: string;
  applicableRentalTo?: string;
  applicableItemGroupIds?: string[];
  status?: RentalCouponTemplate["status"];
}

export type RentalDayType = "workday" | "weekend" | "statutory_holiday" | "makeup_workday" | "tenant_special";

/**
 * 营业状态（需求 4.5.4 的四态）。
 *
 * | 正常营业 open | 在配置时段内提供允许的领取、归还和配送服务 |
 * | 限时营业 limited | 只在指定时段提供指定履约能力 |
 * | 停止营业 closed | 不接受普通现场领取、配送或现场归还 |
 * | 自助营业 self_service | 人工停业，但允许具备 capability 的智能柜、自助停车场等方式履约 |
 *
 * 与 `closed: boolean` 的关系：`closed` 是本字段引入前的两态遗留表示。
 * 存量日历的 `days` JSON 里没有 `businessStatus`，因此读取时按 `closed` 推导，
 * 不把历史数据当成"未配置"。新写入一律带 `businessStatus`。
 */
export type RentalCalendarBusinessStatus = "open" | "limited" | "closed" | "self_service";

/** 营业时段。`start`/`end` 是营业时区的当地时间 `HH:mm`，24 小时制。 */
export interface RentalTimeWindow {
  start: string;
  end: string;
}

/**
 * 某天的营业时段与各履约动作可用时段（需求 4.5.1）。
 *
 * 需求要求「每周默认营业模板至少包含工作日、休息日、每日一个或多个营业时段，
 * 以及领取、归还和配送的默认可用时段」，因此营业时段是**多段**（午休可拆两段），
 * 且三个履约动作各自可以有更窄的时段。
 *
 * 各动作时段缺省表示沿用 `windows`：多数门店的领取归还就是营业时间，
 * 要求每家都把三个动作各填一遍只会制造重复配置。
 */
/**
 * 营业与履约时段（需求 4.5.1）。四个字段各自三态，语义不能混：
 *
 * - `windows`：当天的营业时段。空数组 = **当天不营业**（不是"不限制"）；
 * - `pickup` / `return` / `delivery`：动作时段。`undefined` = 未单独声明，
 *   **继承 `windows`**；空数组 = 当天**不提供**该动作；非空 = 只在这些时段内提供。
 *
 * 把空数组当成"不限制"会把「今天不配送」直接变成「全天可配送」，
 * 因此判定必须区分 `undefined` 与 `[]`（见服务层 windowVerdict）。
 */
export interface RentalBusinessHours {
  windows: RentalTimeWindow[];
  pickup?: RentalTimeWindow[];
  return?: RentalTimeWindow[];
  delivery?: RentalTimeWindow[];
}

/**
 * 被人工覆盖前的原始值（需求 4.5.3：「日期详情必须能说明当前结果来自人工覆盖、
 * 官方日历还是每周模板，并展示**被覆盖的原始值**」）。
 *
 * 它同时承担第二个职责：需求要求「移除人工覆盖表示恢复到下一优先级来源，
 * 不得把该日期变成没有来源的空白日」——覆盖时若不留下原始值，移除时就只能
 * 凭周模板重算，官方日历里那天的节日名与类型就永久丢了。
 */
export interface RentalCalendarDayOrigin {
  dayType: RentalDayType;
  name: string;
  pricingMultiplier: number;
  closed: boolean;
  businessStatus?: RentalCalendarBusinessStatus;
  source: "week_rule" | "official_cn";
}

/**
 * 审计用的日期取值快照。与 `RentalCalendarDayOrigin` 的唯一区别是 `source` 允许
 * `tenant_override`：审计要记「从人工覆盖改成了什么」，而 `overriddenFrom` 只记
 * 「人工覆盖之前的非覆盖来源是什么」，两者的取值域本就不同，共用一个类型会让
 * `overriddenFrom` 意外接受 `tenant_override`，那正是需求禁止的自我指向。
 */
export interface RentalCalendarDaySnapshot {
  dayType: RentalDayType;
  name: string;
  pricingMultiplier: number;
  closed: boolean;
  businessStatus?: RentalCalendarBusinessStatus;
  source: "week_rule" | "official_cn" | "tenant_override";
  /** 营业时段快照（需求 4.5.3/4.5.5）：只改时段时，审计前后值必须能看出时段变化。 */
  hours?: RentalBusinessHours;
  /** 日历只保存一次性特殊价格规则的稳定引用，价格值仍在价格版本内。 */
  pricingOverrideRef?: string;
}

/**
 * 人工覆盖的审计流水（需求 4.5.3）。
 *
 * 为什么不把撤销原因写回那一天：移除覆盖后该日期已经**不是**人工覆盖了，
 * 把 `overrideReason` 留在上面会让它自相矛盾（source=official_cn 却带覆盖原因），
 * 而下一次导入或渲染都会以 source 为准，撤销原因等于静默丢失。
 * 因此审计挂在年度日历上，与该日期当前取值解耦。
 */
export interface RentalCalendarOverrideAudit {
  date: string;
  /** `override` 建立或修改人工覆盖；`revert` 移除人工覆盖恢复下一优先级来源。 */
  action: "override" | "revert";
  reason: string;
  operator?: string;
  at: string;
  /** 操作前的取值。首次覆盖一个周模板生成、尚未落库的日期时可能为空。 */
  before?: RentalCalendarDaySnapshot;
  after: RentalCalendarDaySnapshot;
  /**
   * 记录发生在哪一个年度版本上。
   *
   * 审计已从年度日历的 JSON 字段搬到独立的只追加表（那里的 `slice(-500)` 截断会
   * 静默删掉最早的记录，与需求 4.5.8「完整审计」冲突），因此每条记录必须自带
   * 年度与版本，才能按版本回放。
   */
  year?: number;
  version?: string;
  /**
   * 范围覆盖的批次标识（需求 4.5.9：一次范围提交共用原因、操作者与批次标识）。
   * 单日编辑没有批次，留空。
   */
  batchId?: string;
}

/**
 * 范围覆盖的适用范围记录（需求 4.5.9：日期详情须能展示日期时间覆盖信息）。
 *
 * 记录在每个被覆盖日期上：范围覆盖产生的一批日期共享同一个 `batchId` 与范围边界，
 * 点击范围内任意日期都能还原「这次覆盖是哪一次范围操作的一部分」。
 */
export interface RentalCalendarOverrideScope {
  kind: "single" | "range";
  batchId: string;
  /** 覆盖的日期范围（含端点）。单日时 start === end。 */
  rangeStart: string;
  rangeEnd: string;
  /**
   * 日期时间范围的起止时点（需求 4.5.5/4.5.9：一次性覆盖须展示开始和结束时点）。
   *
   * 边界语义：日历字段（日期类型、营业状态、时段）按**整天**生效——它们在数据模型上
   * 就是逐日属性；起止时点记录的是这次范围选择的原始输入，供详情展示，以及供
   * PRICE-03 的一次性日期时间价格覆盖引用消费。不在本层做半天截断。
   */
  startDateTime?: string;
  endDateTime?: string;
}

/**
 * 发布时相对上一已发布版本的日期差异（需求 4.5.7：发布记录可追溯）。
 * 只存日期列表而不存整日快照：整年 365 天的前后快照会让这一行 JSON 膨胀数倍，
 * 而被替代的旧版本本身完整保留在库里，需要逐日对比时读那一行即可。
 */
export interface RentalCalendarPublishDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface RentalCalendarDay {
  date: string;
  dayType: RentalDayType;
  name: string;
  pricingMultiplier: number;
  /** 两态遗留表示，保留以兼容存量数据与既有调用方；新逻辑以 `businessStatus` 为准。 */
  closed: boolean;
  /** 四态营业状态（需求 4.5.4）。缺省时由 `closed` 推导。 */
  businessStatus?: RentalCalendarBusinessStatus;
  source: "week_rule" | "official_cn" | "tenant_override";
  /** 该日期的营业时段覆盖（需求 4.5.3：可覆盖营业时段与领取/归还/配送能力）。 */
  hours?: RentalBusinessHours;
  /** 一次性特殊价格规则引用；不得在日历内保存商品价格或统一价格系数。 */
  pricingOverrideRef?: string;
  /** 人工覆盖的调整原因、操作人与调整时间（需求 4.5.3 要求必须保存）。 */
  overrideReason?: string;
  overrideBy?: string;
  overrideAt?: string;
  /** 被覆盖掉的原始值，供日期详情展示与移除覆盖时恢复。 */
  overriddenFrom?: RentalCalendarDayOrigin;
  /** 本次覆盖所属的范围操作（需求 4.5.9）。单日覆盖也有 scope（kind: "single"）。 */
  overrideScope?: RentalCalendarOverrideScope;
}

export interface RentalCalendarYear {
  tenantId: string;
  year: number;
  region: "CN" | "NONE";
  version: string;
  /**
   * 年度日历状态（需求 4.5.7）。
   *
   * - `draft` 草稿：可编辑或删除
   * - `published` 已发布：**不可直接修改**；每个经营空间每个年度只能有一个
   * - `superseded` 已被替代：被更新的已发布版本取代，保留供历史报价追溯
   * - `void` 已作废：人工废弃的草稿或错误版本
   */
  status: "draft" | "published" | "superseded" | "void";
  /** 被替代时间。需求要求历史版本不得被删除或原地改回，只能标记替代。 */
  supersededAt?: string;
  /** 发布人、变更原因与上一版本号：需求 4.5.7 要求发布记录可追溯。 */
  publishedBy?: string;
  changeReason?: string;
  previousVersion?: string;
  /**
   * 本草稿是从哪个历史版本恢复出来的（需求 4.5.7：「恢复旧规则也必须以旧内容生成新的
   * 发布版本，不得删除新版本或把旧版本原地改回」）。被恢复的版本本身不做任何改动。
   */
  restoredFromVersion?: string;
  restoreReason?: string;
  /**
   * 作废审计（需求 4.5.7「已作废：人工废弃的草稿或错误版本」）。
   * 只有草稿可作废；已发布版本须由新版本替代、已被替代版本须保留供历史报价追溯，
   * 均不走作废。作废时记录时间、操作人与原因，供事后解释这条草稿为何被丢弃。
   */
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  /** 相对上一已发布版本的日期差异，发布时算好存下——事后重算需要旧版本仍在库里。 */
  publishDiff?: RentalCalendarPublishDiff;
  /** 人工覆盖与撤销的审计流水（需求 4.5.3）。 */
  overrideAudits?: RentalCalendarOverrideAudit[];
  sourceName?: string;
  sourceUrl?: string;
  sourcePublishedAt?: string;
  importedAt?: string;
  /**
   * 引用的公共官方来源版本（需求 4.5.7：发布记录必须保存官方来源版本）。
   * 空间日历不再自带原始官方数据，而是指向平台注册表里的某一版，追溯时能说清
   * 「这一年的节假日安排来自哪个来源的哪一版」。
   */
  sourceVersionId?: string;
  sourceVersion?: string;
  /**
   * 该年度公共官方来源是否有比本日历所引用版本**更新**的有效版本（需求 4.5.2：
   * 平台登记新官方版本后，为空间生成更新提示，**不得自动影响空间**）。
   *
   * 读取时派生、不落库：它取决于平台注册表的当前状态，存下来就会立刻过期。
   */
  officialSourceUpdateAvailable?: boolean;
  /**
   * 从未引用过任何官方来源、但该年度存在**启用**的可选公共来源时为 true。
   * 与 `officialSourceUpdateAvailable` 分开：前者是「当前引用的来源出了新版」，
   * 这条是「有官方来源可供选择」，不能把后者伪装成前者（那会跨来源误报）。
   */
  officialSourceAvailableToSelect?: boolean;
  /** `officialSourceAvailableToSelect` 为 true 时，可供选择的**启用来源数量**（不是版本号）。 */
  availableOfficialSourceCount?: number;
  /**
   * 该年度登记过公共来源、但当前**全部已停用**时为 true。
   * 用于把空状态区分成「当前没有可用来源」与「从未登记」——后者是两个字段都为空且无 sourceName。
   */
  officialSourceRegisteredButUnavailable?: boolean;
  /**
   * 已引用来源时，同来源的最新版本号（在 `officialSourceUpdateAvailable` 分支才有意义）。
   * 未引用来源的分支**不返回**它：跨来源没有全局最新版，显示任意「最新 vX」会误导。
   */
  latestOfficialSourceVersionId?: string;
  latestOfficialSourceVersion?: string;
  /**
   * 最近一次官方导入中因存在人工覆盖而未被写入的日期。
   * 导入不覆盖人工覆盖，但运营必须知道「官方改了这几天而你的覆盖仍然生效」，
   * 否则会以为导入失败或以为官方值已生效。
   */
  importPreservedOverrides?: string[];
  publishedAt?: string;
  /**
   * 乐观锁版本号（需求 4.5.3 的并发编辑保护）。
   *
   * 整年日期存在同一个 JSON 字段里，两个编辑人同时改**不同日期**时，各自都会读到
   * 同一份草稿、复制全年、改自己那天、再写回整份 JSON——后写入者把先写入者的改动
   * 整体覆盖，且双方都收到成功。年度版本号（`version`）解决不了这件事：它只在
   * 「编辑已发布版本」时递增，同一草稿内的连续编辑共用一个版本号。
   *
   * 因此每次写入都递增本字段，落库时以「读到的 revision」为条件（条件更新），
   * 不匹配即说明中途有人改过，接口返回 409 让前端刷新后重试。
   */
  revision?: number;
  days: RentalCalendarDay[];
}

/**
 * 年度日历版本的**轻量摘要**（用于版本历史列表）。
 *
 * 列表不能直接返回 `RentalCalendarYear`：那会把每个版本的全年 365 条日期与全部
 * 覆盖审计一并塞进响应，版本一多响应体就迅速膨胀到无法使用。列表只回可用于
 * 挑选版本的元数据与计数，逐日与审计由版本详情接口按需返回。
 */
export interface RentalCalendarVersionSummary
  extends Omit<RentalCalendarYear, "days" | "overrideAudits" | "publishDiff"> {
  /** 该版本的日期条目数，用于判断是否为完整年度。 */
  dayCount: number;
  /** 该版本的人工覆盖日期数。 */
  overrideCount: number;
  /** 该版本的覆盖审计条数。 */
  overrideAuditCount: number;
  /** 相对上一已发布版本的差异条数，详情里才给出具体日期。 */
  publishDiffCounts?: { added: number; removed: number; changed: number };
}

/**
 * 保存人工覆盖。`overrideReason` 必填——需求 4.5.3 要求人工覆盖必须保存调整原因；
 * 操作人与调整时间由服务端从会话与当前时刻填入，不接受调用方自报。
 * `overriddenFrom` 同理由服务端从被覆盖的那天推导，不接受调用方传入。
 */
export interface SaveRentalCalendarDayRequest
  extends Omit<RentalCalendarDay, "source" | "overrideBy" | "overrideAt" | "overriddenFrom" | "overrideScope"> {
  overrideReason: string;
}

export type OfficialCalendarDayInput = Array<
  Pick<RentalCalendarDay, "date" | "dayType" | "name"> &
    Partial<Pick<RentalCalendarDay, "pricingMultiplier" | "closed">>
>;

/**
 * 公共官方日历来源（需求 4.5.2/4.5.8）。
 *
 * 平台级资源，**不属于任何租户**：官方节假日数据是公共基础来源，由 SaaS 平台管理员
 * 维护。经营空间不能直接导入原始官方数据，只能引用某个来源版本生成自己的年度草稿，
 * 再由有权限的空间人员确认并发布——否则「导入即影响全部经营空间」，与需求相反。
 */
export interface OfficialCalendarSource {
  id: string;
  region: "CN";
  name: string;
  url: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 公共官方日历的**来源版本**（需求 4.5.2：官方日历再次调整时必须形成新的来源版本）。
 * 只追加：旧版本保留，供空间日历追溯自己当初引用的是哪一版官方数据。
 */
export interface OfficialCalendarSourceVersion {
  id: string;
  sourceId: string;
  /**
   * 登记当时的来源信息**快照**。
   *
   * 不是 join 来源主档得到的当前值：主档允许改名称、URL、地区，一改就会让昨天登记的
   * 旧版本显示成新名称新 URL，租户引用旧版本时也拿到改后的信息，等于历史版本的含义
   * 被事后改写。主档继续维护，历史版本一律按快照解释。
   */
  sourceName: string;
  sourceUrl: string;
  region: "CN";
  year: number;
  /** 展示用版本号（1.0/1.1…）。排序与并发分配一律用 `sequence`。 */
  version: string;
  /** 版本序号（1 起）。字符串版本号在 1.10 之后会被字典序排到 1.9 之前。 */
  sequence: number;
  /** 官方公告的发布日期。与 `importedAt` 不同：追溯要能区分官方何时发布与平台何时入库。 */
  publishedAt: string;
  importedAt: string;
  importedBy?: string;
  days: OfficialCalendarDayInput;
}

/** 来源版本的轻量摘要：列表不返回整年 days，只给条数。 */
export interface OfficialCalendarSourceVersionSummary
  extends Omit<OfficialCalendarSourceVersion, "days"> {
  dayCount: number;
  /** 来源主档当前是否启用。停用来源的旧版本不再供空间新应用，但历史引用必须保留。 */
  sourceActive: boolean;
}

/** 登记或更新一个公共官方日历来源（仅 SaaS 平台管理员）。 */
export interface SaveOfficialCalendarSourceRequest {
  id?: string;
  region: "CN";
  name: string;
  url: string;
  notes?: string;
  isActive?: boolean;
}

/** 为某来源登记一个新的年度来源版本（仅 SaaS 平台管理员）。版本号由服务端递增。 */
export interface RegisterOfficialCalendarSourceVersionRequest {
  year: number;
  publishedAt: string;
  days: OfficialCalendarDayInput;
}

/**
 * 经营空间引用某个公共来源版本生成/更新本空间年度草稿（需求 4.5.2）。
 *
 * 空间侧**不再接受原始官方日期**：那等于让租户自行编造公共数据，与 4.5.8
 * 「SaaS 平台管理员导入和维护公共官方日历来源」冲突。
 */
export interface ApplyOfficialCalendarSourceRequest {
  sourceVersionId: string;
}

export interface ImportRentalCalendarRequest {
  year: number;
  region: "CN";
  sourceName: string;
  sourceUrl: string;
  sourcePublishedAt: string;
  days: OfficialCalendarDayInput;
  /** 引用的公共来源版本（需求 4.5.2）。空间侧应用来源版本时由服务端填入，供追溯。 */
  sourceVersionId?: string;
  sourceVersion?: string;
}

/**
 * 移除人工覆盖。原因必填：撤销和建立覆盖一样是一次经营决策，
 * 只记「谁在什么时候撤销了」而不记「为什么」，事后无法判断是纠错还是误操作。
 */
export interface RemoveRentalCalendarDayOverrideRequest {
  overrideReason: string;
}

/**
 * 范围覆盖可设置的字段（需求 4.5.9：范围操作只修改用户明确选择的字段）。
 *
 * 提供了哪个字段就覆盖哪个字段；未提供的字段保持该日期当前值（有覆盖沿用覆盖，
 * 无覆盖沿用基础值）。「一次性特殊价格覆盖」按 v2.9 边界由 PRICE-03 保存价格值，
 * 日历只保存稳定引用，不保存商品价格或空间统一价格系数。
 */
export interface RentalCalendarRangeFields {
  dayType?: RentalDayType;
  name?: string;
  pricingOverrideRef?: string;
  businessStatus?: RentalCalendarBusinessStatus;
  hours?: RentalBusinessHours;
}

/** 范围覆盖预览/应用的公共范围入参。整日覆盖可跨月，不得跨年度（需求 4.5.9）。 */
export interface RentalCalendarRangeScopeInput {
  startDate: string;
  endDate: string;
  /** 日期时间范围的起止时点。给出时必须落在 startDate/endDate 当天。 */
  startDateTime?: string;
  endDateTime?: string;
}

/** 范围覆盖预览（需求 4.5.9：提交前展示冲突日期、当前值与将替换的字段）。 */
export interface PreviewRentalCalendarRangeOverrideRequest extends RentalCalendarRangeScopeInput {
  fields: RentalCalendarRangeFields;
}

export interface RentalCalendarRangePreviewRow {
  date: string;
  /** 该日期已有人工覆盖：应用必须经用户明确确认，不得静默覆盖。 */
  conflict: boolean;
  /** 每周模板或官方来源形成的基础值。 */
  base: RentalCalendarDaySnapshot;
  /** 当前生效值（无覆盖时等于基础值）。 */
  current: RentalCalendarDaySnapshot;
  /** 应用后的结果值。 */
  after: RentalCalendarDaySnapshot;
  /** 将被修改的字段名。 */
  changedFields: string[];
}

export interface RentalCalendarRangeOverridePreview {
  year: number;
  /** 预览基于的年度版本（草稿优先，其次已发布，再次周模板）。 */
  version: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  conflictCount: number;
  days: RentalCalendarRangePreviewRow[];
}

/** 应用范围覆盖（需求 4.5.9：全部成功或全部失败，共用原因/批次/操作者/时间，一次 revision）。 */
export interface ApplyRentalCalendarRangeOverrideRequest extends PreviewRentalCalendarRangeOverrideRequest {
  overrideReason: string;
  /** 缺省由服务端生成并返回。前端可用它把预览与提交关联到同一次范围操作。 */
  batchId?: string;
  /** 读取草稿时的 revision；不匹配返回 409（需求：并发冲突返回明确 409）。 */
  expectedRevision?: number;
  /** 范围内存在既有覆盖时必须显式确认；缺省且存在冲突 → 409，绝不静默覆盖。 */
  overrideConfirmed?: boolean;
}

export interface ApplyRentalCalendarRangeOverrideResult {
  batchId: string;
  year: number;
  /** 写入的年度版本（编辑已发布版本时会生成新草稿版本）。 */
  version: string;
  revision: number;
  appliedCount: number;
}

/** 范围移除预览（需求 4.5.9：按范围移除前展示恢复后的日期类型、营业状态和引用变化）。 */
export interface PreviewRentalCalendarRangeRemoveRequest extends RentalCalendarRangeScopeInput {}

export interface RentalCalendarRangeRemovePreviewRow {
  date: string;
  hasOverride: boolean;
  current: RentalCalendarDaySnapshot;
  /** 移除后恢复到的值（`overriddenFrom`，缺省按周模板重算）。无覆盖时等于 current。 */
  restored: RentalCalendarDaySnapshot;
  restoredSource: "official_cn" | "week_rule";
}

export interface RentalCalendarRangeRemovePreview {
  year: number;
  version: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  overrideCount: number;
  days: RentalCalendarRangeRemovePreviewRow[];
}

/** 应用范围移除：只移除范围内带人工覆盖的日期，其余保持不变（不算错误）。 */
export interface ApplyRentalCalendarRangeRemoveRequest {
  startDate: string;
  endDate: string;
  overrideReason: string;
  batchId?: string;
  expectedRevision?: number;
}

export interface ApplyRentalCalendarRangeRemoveResult {
  batchId: string;
  year: number;
  version: string;
  revision: number;
  /** 实际移除覆盖的日期数。 */
  removedCount: number;
  /** 范围内本就没有覆盖的日期数（保持原样，不是失败）。 */
  unchangedCount: number;
}

/** 发布年度日历。变更原因必填（需求 4.5.7：发布记录可追溯）。 */
/**
 * 发布前影响预览（需求 4.5.8：发布前必须展示受影响日期以及停业、营业时间、履约能力和
 * 特殊价格变化；存在未来订单时必须提示，但不得直接改变这些订单）。
 *
 * 纯只读推演：调用它不写任何状态，也不触碰未来订单——提示的作用是让发布人知道
 * 这次发布会影响到谁，处置由人决定。
 */
export interface RentalCalendarPublishPreviewDate {
  date: string;
  /** 相对当前已发布版本：新增日期 / 该日期在新版本里消失 / 取值发生变化。 */
  change: "added" | "removed" | "changed";
  before?: RentalCalendarDaySnapshot;
  after?: RentalCalendarDaySnapshot;
  /** 发生变化的维度，供界面按「停业/时段/价格」分组展示。 */
  changedFields: Array<
    "dayType" | "name" | "businessStatus" | "closed" | "hours" | "pricingMultiplier" | "pricingOverrideRef" | "source"
  >;
}

/** 发布前影响预览里被提示的未来订单。只提示，不修改。 */
export interface RentalCalendarPublishPreviewOrder {
  orderId: string;
  orderNo: string;
  status: string;
  startAt: string;
  endAt: string;
  /** 该订单与本次变化重叠的营业日期。 */
  affectedDates: string[];
}

export interface RentalCalendarPublishPreview {
  year: number;
  /** 待发布草稿的版本号。 */
  draftVersion: string;
  /** 当前已发布版本号；该年度尚无已发布版本时为空（此时是首次发布）。 */
  publishedVersion?: string;
  /** 首次发布：没有可比对象，逐日差异没有信息量，界面应提示「全年首次发布」。 */
  /**
   * 首次发布：该年度还没有已发布版本。
   *
   * 此时逐日差异的基准是**每周默认营业模板**生成的基准年历，而不是"空日历"——
   * 与空日历比会把全年 365 天都列成变更，没有筛选价值；与周模板比得到的恰好是
   * 这次发布真正带来的业务变化（人工覆盖、官方节假日、停业/限时、特殊价格）。
   * 界面应据此说明基准是周模板，但**不得**因为首发就不展示受影响日期与未来订单提示。
   */
  firstPublish: boolean;
  diff: RentalCalendarPublishDiff;
  dates: RentalCalendarPublishPreviewDate[];
  /** 营业状态或停业标记发生变化的日期。 */
  closureChanges: string[];
  /** 营业时段或领取/归还/配送可用时段发生变化的日期。 */
  hoursChanges: string[];
  /** 特殊价格（日期系数）发生变化的日期。 */
  pricingChanges: string[];
  futureOrders: RentalCalendarPublishPreviewOrder[];
  /** 该年度是否已确认公共官方来源（与「日历是否发布」是两个状态）。 */
  officialSourceConfirmed: boolean;
}

export interface PublishRentalCalendarRequest {
  changeReason: string;
}

/** 作废年度日历草稿（需求 4.5.7）。原因必填，用于事后解释这条草稿为何被丢弃。 */
export interface VoidRentalCalendarRequest {
  reason: string;
}

/**
 * 以某个历史版本的内容生成新草稿（需求 4.5.7：「恢复旧规则也必须以旧内容生成新的
 * 发布版本，不得删除新版本或把旧版本原地改回」）。
 *
 * 恢复只产生草稿：后续仍要走发布前预检、填写变更原因、发布这条正路。
 * 被恢复的历史版本与当前已发布版本都不做任何改动。
 */
export interface RestoreRentalCalendarVersionRequest {
  reason: string;
}

/** 阶梯价档位。`whole_order` 是长租折扣；`progressive` 是使用量超额的分段累进单价。 */
export interface RentalPricingTier {
  /** 起始单位数（含）。progressive 的首档必须从 1 开始，覆盖全部超额用量。 */
  minUnits: number;
  unitAmount: number;
}

/** whole_order：达到档位后全部单位采用该档单价；progressive：只对该档覆盖的超额单位计价。 */
export type RentalPricingTierMode = "whole_order" | "progressive";

export interface RentalPricingRate {
  id: string;
  /** PRICE-GROUP-01：新价格事实以定价分组为对象；旧快照可只含 itemGroupId。 */
  pricingGroupId?: string;
  pricingGroupCode?: string;
  pricingGroupName?: string;
  itemGroupId: string;
  itemGroupCode: string;
  itemGroupName: string;
  unit: RentalPricingUnit;
  baseAmount: number;
  weekendMultiplier: number;
  holidayMultiplier: number;
  depositAmount: number;
  minimumUnits: number;
  includedUsage?: number;
  excessUsageAmount?: number;
  /** 使用量进位精度：0 按整数、1 按 0.1、2 按 0.01 向上计费；缺省为 0。 */
  usagePrecision?: 0 | 1 | 2;
  /** 阶梯计价模式。未指定时保留既有时间租赁「达到档位后整单换价」语义。 */
  tierMode?: RentalPricingTierMode;
  /** 阶梯价。时间租赁按整单重定价；使用量必须显式选择 progressive。 */
  tiers?: RentalPricingTier[];
  /** 封顶价（需求 4.4）：单行租金上限。0 是合法值（免租），undefined 表示不封顶。 */
  maxAmount?: number;
  /**
   * 租金倍数押金的倍数（需求 4.4「固定押金、租金倍数押金、预授权或免押」）。
   *
   * 仅当规则的 `depositMode === "price_multiple"` 时使用：该行押金 = 该行租金 × 本值。
   * 与 `depositAmount`（固定押金）是两种模式下各自的取数来源，不会同时生效。
   */
  depositMultiple?: number;
  /**
   * 预授权额度的固定金额（需求 4.4.7：押金与预授权独立计算）。
   *
   * 与 `depositAmount` 分开：同一订单可能「收 500 押金 + 冻结 2000 额度」，两个数不同。
   * 缺省时回落到 `depositAmount`——存量费率行只配了押金字段，回落保证既有报价口径不变。
   */
  preAuthAmount?: number;
  /** 预授权额度的租金倍数。缺省时回落到 `depositMultiple`，理由同上。 */
  preAuthMultiple?: number;
  /**
   * 小时粒度（分钟），仅 `unit: "hour"` 使用。缺省 60。
   *
   * 需求 4.4.5：「按价格配置的小时粒度向上取整，例如每 1 小时或每 30 分钟；
   * 不足一个粒度按一个粒度计」——因此它属于**价格**而不是经营空间规则。
   */
  hourGranularityMinutes?: number;
  /**
   * 商品在该日期类型下的单价系数（需求 4.5.5 v2.9：商品×计价单位×日期类型的价格）。
   * 与 weekendMultiplier/holidayMultiplier 并存且**优先于**它们：weekend/holiday 是
   * 既有兼容字段，新配置按五类日期类型逐类设置，无需新增报价代码分支。
   */
  dayTypePrices?: Partial<Record<RentalDayType, number>>;
  /**
   * 周期性计价时段（需求 4.5.5 v2.9）：「每周五 12:00 至周一 00:00 按周末价」等
   * 重复规则。命中按计费单位的取价时点（营业时区的星期 + 分钟）判定；
   * 同一商品同一计价单位的时段不得重叠（保存/发布时拒绝）。
   */
  periodicWindows?: RentalPeriodicPriceWindow[];
  /**
   * 一次性日期时间价格覆盖的价格值（需求 4.5.5 v2.9：适用范围在日历侧，价格值在
   * 价格模块）。按取价时点命中 [start, end)；两条覆盖区间重叠时拒绝保存。
   */
  datetimeOverrides?: RentalDatetimePriceOverride[];
}

/** 周期性计价时段：营业时区的一周内、[fromWeekday+fromTime, toWeekday+toTime) 连续生效。 */
export interface RentalPeriodicPriceWindow {
  /** 起始星期（0=周日…6=周六，与 Date.getUTCDay 一致）。 */
  fromWeekday: number;
  /** 起始时刻 HH:mm（营业时区）。 */
  fromTime: string;
  /** 结束星期。可与 fromWeekday 相同（同日内时段），跨星期时按周循环解释。 */
  toWeekday: number;
  toTime: string;
  /** 该时段的价格系数。 */
  multiplier: number;
}

/** 一次性日期时间价格覆盖的价格值（绝对时刻，营业时区书写）。 */
export interface RentalDatetimePriceOverride {
  /** 被营业日历引用的稳定规则标识。存量规则可为空，新建规则应填写。 */
  id?: string;
  start: string;
  end: string;
  multiplier: number;
}

/**
 * PRICE-02B：月历分时价格摘要的单日条目（只读消费 PRICE-03 的已发布价格事实）。
 * 由服务端用与报价**同一个**命中助手（periodicWindowHits）计算，月历不复制价格值、
 * 不建立第二套价格事实；timeLabel 仅用于展示。
 */
export interface RentalCalendarTimePriceDay {
  date: string;
  entries: Array<{
    /**
     * PRICE-03 起价格版本是**空间级**的，版本里的费率不带计划标识。
     * 这两个字段按「商品 × 计价单位」回查当前拥有该价格的在用计划，仅用于展示；
     * 价格已从计划下线但版本仍生效时为空——编一个计划编码会让月历看起来仍受它管辖。
     */
    planId?: string;
    planCode?: string;
    /** 空间级价格版本号（v1、v2…）。 */
    version: string;
    itemGroupCodes: string[];
    unit: string;
    timeLabel: string;
    multiplier: number;
    source: "periodic" | "datetime_override";
    /** 一次性覆盖条目对应的日历引用。 */
    overrideRef?: string;
  }>;
}

/** 调价计划的单条变更（需求 4.4.3：计划只保存差异，确认时展示每个受影响商品的最终价）。 */
export interface RentalPriceAdjustmentChange {
  /** 新调价以定价分组为对象；itemGroupId 仅用于读取迁移前历史计划。 */
  pricingGroupId?: string;
  itemGroupId: string;
  unit: RentalPricingUnit;
  /** `set_base` 直接设价；`percent` 按百分比（正上调/负下调）；`fixed` 加减固定金额。 */
  op: "set_base" | "percent" | "fixed";
  value: number;
}

/**
 * 不可变价格版本（需求 4.4.3）：某一生效时点、**某经营空间**全部有效商品价格的
 * **完整、不可变**结果。禁止就地修改；每次调价（立即保存或计划执行）追加新行。
 *
 * 粒度是空间而不是价格计划：同一空间同一「商品 × 计价单位」在任一时点只能有唯一
 * 生效价格，若按计划各留一条版本链，两个计划各自"合法"的版本合起来仍可能给同一
 * 商品两个价格，报价就只能在冲突里择一。
 */
export interface RentalPriceVersion {
  id: string;
  tenantId: string;
  workspaceId: string;
  /** 空间内原子序号（1 起）。字符串版本号在 v10 之后排序不可靠，故以整数为准。 */
  sequence: number;
  /** 展示用版本号（`v${sequence}`）。 */
  version: string;
  /** 生效时刻：报价按「租期开始时点 ≤ 生效时刻」的最新版本取价（需求 4.4.4）。 */
  effectiveFrom: string;
  /** 该版本的全部有效费率（完整结果，不只是差异）。 */
  rates: RentalPricingRate[];
  changeReason?: string;
  createdBy?: string;
  createdAt: string;
}

/**
 * 调价计划（需求 4.4.3）：草稿、待生效、已生效、已取消、执行失败。
 * 只保存差异（op + 受影响行）；确认时生成完整新版本。
 */
export interface RentalPriceAdjustmentPlan {
  id: string;
  tenantId: string;
  planId: string;
  code: string;
  name: string;
  status: "draft" | "pending" | "applied" | "cancelled" | "failed";
  changes: RentalPriceAdjustmentChange[];
  /** 定时执行的生效时刻；缺省 = 立即执行。 */
  scheduledAt?: string;
  resultVersionId?: string;
  changeReason: string;
  createdBy?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  /** 执行失败的错误信息（执行成功后为空）。 */
  failureReason?: string;
  cancelReason?: string;
  createdAt: string;
}

/** 以历史价格快照生成新的当前版本；历史版本本身保持不可变。 */
export interface RestoreRentalPriceVersionRequest {
  reason: string;
}

/** 创建调价计划请求（需求 4.4.3：差异 + 定时/立即 + 原因）。 */
export interface CreateRentalPriceAdjustmentRequest {
  code: string;
  name: string;
  changes: RentalPriceAdjustmentChange[];
  /** 定时执行的生效时刻；缺省 = 确认后立即执行。 */
  scheduledAt?: string;
  changeReason: string;
}

/** 取消调价计划请求（已生效不可取消）。 */
export interface CancelRentalPriceAdjustmentRequest {
  reason: string;
}

/** 创建调价计划的响应：附带逐行最终价预览（需求 4.4.3：不得只展示公式）。 */
export interface RentalPriceAdjustmentPreviewRow {
  itemGroupId: string;
  itemGroupCode: string;
  unit: RentalPricingUnit;
  /** 调整前基础价。 */
  beforeBaseAmount: number;
  /** 调整后基础价（op 直接算出的最终值）。 */
  afterBaseAmount: number;
}

/**
 * 履约费用（需求 4.4 公式里的独立一项）。
 *
 * 配在价格计划上而不是地点上：它是**价格**，要随计划版本一起发布、生效和快照，
 * 这样报价才能复算「当时按哪一版履约费收的」。配在地点上则会随主档改名/改价漂移。
 */
export interface RentalFulfillmentFee {
  mode: RentalFulfillmentMode;
  /** 该履约方式的基础履约费。0 表示该方式免费，undefined（不配置）同样按 0。 */
  amount: number;
  /** 异地归还附加费：归还地点与取件地点不同时追加。 */
  crossLocationAmount?: number;
}

export interface RentalPricingPlanV1 {
  id: string;
  tenantId: string;
  categoryCode: RentalCategoryCode;
  code: string;
  name: string;
  currency: RentalCurrency;
  status: "draft" | "enabled" | "disabled";
  version: string;
  effectiveFrom: string;
  effectiveTo?: string;
  rates: RentalPricingRate[];
  /** 履约费用（需求 4.4）。留空表示该计划不收履约费。 */
  fulfillmentFees?: RentalFulfillmentFee[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveRentalPricingPlanRequest {
  id?: string;
  code: string;
  name: string;
  status?: "draft" | "enabled" | "disabled";
  effectiveFrom: string;
  effectiveTo?: string;
  changeReason: string;
  rates: Array<Omit<RentalPricingRate, "id" | "itemGroupCode" | "itemGroupName">>;
  fulfillmentFees?: RentalFulfillmentFee[];
}

/**
 * 优惠可作用的费用对象（需求 4.4.10）。
 *
 * 刻意不含押金、预授权与异常费用：需求明确「标准租金优惠不得含糊地减免押金、
 * 预授权或异常费用」。把它们排除在类型之外，而不是靠运行时判断——
 * 判断可以漏写，类型不会。
 */
export const RENTAL_DISCOUNT_TARGETS = ["rental", "fulfillment", "service"] as const;
export type RentalDiscountTarget = (typeof RENTAL_DISCOUNT_TARGETS)[number];

/** 优惠类型（需求 4.4.10 第一阶段三种）。复杂规则须另建模型，不得塞进这三个字段。 */
export const RENTAL_DISCOUNT_TYPES = ["percentage", "fixed_amount", "threshold_amount"] as const;
export type RentalDiscountType = (typeof RENTAL_DISCOUNT_TYPES)[number];

export interface RentalDiscountPlan {
  id: string;
  tenantId: string;
  categoryCode: RentalCategoryCode;
  code: string;
  name: string;
  status: "draft" | "enabled" | "disabled";
  /**
   * `percentage` 按基数百分比；`fixed_amount` 固定减免；
   * `threshold_amount` 满 `thresholdAmount` 减 `discountValue`（满额固定减免）。
   */
  discountType: RentalDiscountType;
  discountValue: number;
  minimumSpend: number;
  /** 满额固定减免的门槛。`discountType === "threshold_amount"` 时必填。 */
  thresholdAmount?: number;
  maximumDiscount?: number;
  /** 作用的费用对象。缺省 `rental`（商品租金与使用量费用）。 */
  appliesTo: RentalDiscountTarget;
  customerScope: "all" | "personal" | "corporate" | "member";
  applicableItemGroupIds: string[];
  /** MKT-01C：面向客户的适用范围。空数组表示全部定价分组。 */
  applicablePricingGroupIds?: string[];
  applicableDayTypes: RentalDayType[];
  priority: number;
  /**
   * 互斥组（需求 4.4.10「同一互斥组只能应用一个优惠」）。
   * 留空表示自成一组：它只与自己互斥，不会挤掉别的方案。
   */
  exclusiveGroup?: string;
  /** 是否允许与**其他优惠方案**同时应用（跨互斥组叠加需双方都允许）。 */
  stackableWithOtherPlans: boolean;
  stackableWithCoupon: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveRentalDiscountPlanRequest extends Omit<RentalDiscountPlan, "id" | "tenantId" | "categoryCode" | "version" | "createdAt" | "updatedAt"> {
  id?: string;
  changeReason: string;
}

/** 优惠方案未被应用的原因码（需求 4.4.10：未应用优惠必须有可解释的原因）。 */
export const RENTAL_DISCOUNT_SKIP_REASONS = [
  "status_not_enabled",
  "outside_effective_period",
  "below_minimum_spend",
  "below_threshold",
  "customer_scope_mismatch",
  "item_group_mismatch",
  "day_type_mismatch",
  "no_chargeable_target",
  "exclusive_group_lost",
  "not_stackable_with_applied",
  "zero_discount"
] as const;
export type RentalDiscountSkipReason = (typeof RENTAL_DISCOUNT_SKIP_REASONS)[number];

/**
 * 单个优惠方案在一张报价里的评估结论。
 *
 * `candidateAmount` 与 `discountAmount` 必须分开：互斥竞争要按「若应用会减免多少」
 * 比大小，而落选方案的实际减免是 0。只存后者就无法解释「它输给谁、差多少」。
 */
export interface RentalQuoteDiscountEvaluation {
  /** 原优惠规则本体；续租重算不回读已修改的营销方案。旧快照可缺省。 */
  planSnapshot?: RentalDiscountPlan;
  planId: string;
  planCode: string;
  planName: string;
  planVersion: string;
  /** 方案所属经营空间。营销权益按空间隔离，快照必须能证明用的是本空间的方案。 */
  workspaceId: string;
  appliesTo: RentalDiscountTarget;
  discountType: RentalDiscountType;
  priority: number;
  exclusiveGroup?: string;
  stackableWithOtherPlans: boolean;
  stackableWithCoupon: boolean;
  applied: boolean;
  skipReason?: RentalDiscountSkipReason;
  /** 人类可读的落选说明，含竞争对手编码与金额差。 */
  skipDetail?: string;
  /** 逐项资格判据，按需求「生成报价时校验并展示资格」。 */
  eligibility: Array<{ rule: string; passed: boolean; detail?: string }>;
  /** 该作用对象的优惠前金额。 */
  grossAmount: number;
  /** 实际计算基数：已扣除本作用对象上先前叠加的优惠。 */
  base: number;
  /** 计算公式文本，供报价明细直接展示。 */
  formula: string;
  /** 若被应用，本方案能减免多少（互斥比较用的就是这个值）。 */
  candidateAmount: number;
  /** 实际减免；未应用时为 0。 */
  discountAmount: number;
  /** 租金优惠按订单行分摊；部分取消、退款与报表不得再靠整单金额猜测。 */
  rentalAllocations?: Record<string, number>;
  maximumDiscount?: number;
  /** 是否被最大优惠金额截断。 */
  capped: boolean;
}

/**
 * 增值服务的计费单位（需求 4.4.11「服务计费单位独立于商品租金单位」）。
 *
 * `per_day` 是**自然日**而不是 24 小时块：需求写的是「每自然日」「每日服务逐日取价」，
 * 周一 22:00 到周二 08:00 的清洁服务占用两个工作日，按 24 小时折算只会算成一天。
 * `per_night` 按过夜数；`per_rental_period` 整段租期一次；`per_hour` 按小时进位。
 * 人员/班次/里程类单位需要排班或采集数据，属 SHARED-PEOPLE-01 与品类扩展，不在此。
 */
export const RENTAL_SERVICE_BILLING_UNITS = [
  "per_order",
  "per_unit",
  "per_day",
  "per_night",
  "per_hour",
  "per_rental_period"
] as const;
export type RentalServiceBillingUnit = (typeof RENTAL_SERVICE_BILLING_UNITS)[number];

/** 服务被选中的方式（需求 4.4.11「可选、推荐、强制和人工服务」）。 */
export const RENTAL_SERVICE_SELECTION_MODES = ["optional", "recommended", "mandatory"] as const;
export type RentalServiceSelectionMode = (typeof RENTAL_SERVICE_SELECTION_MODES)[number];

/**
 * 条件强制服务的触发规则（需求 4.4.11：强制服务必须保存触发规则，
 * 并标记「业务规则要求」，不得伪装成客户自愿选择）。
 *
 * 判据留空表示该维度不限制。改变商品、履约方式或金额后必须重新判断，
 * 因此规则只描述**条件**，不缓存判断结果。
 */
export interface RentalServiceMandatoryRule {
  /** 命中任一商品组即触发。 */
  itemGroupIds?: string[];
  /** 命中任一履约方式即触发。 */
  fulfillmentModes?: RentalFulfillmentMode[];
  /** 优惠前租金达到该金额即触发（高价值商品强制基础保障的落点）。 */
  minRentalAmount?: number;
}

/**
 * 第三方保险的接入状态（需求 4.4.11）。
 *
 * 刻意**没有**「已投保」这个取值：未接入真实服务商前不得向客户展示已投保、
 * 虚构保单号，也不得把商户损坏免赔称为保险。真实 Provider 接入属 EXT-02，
 * 到那时才会新增带保单号与理赔状态的取值，而不是现在先留一个可以被误用的字段。
 */
export const RENTAL_INSURANCE_PROVIDER_STATUSES = ["simulated", "reserved"] as const;
export type RentalInsuranceProviderStatus = (typeof RENTAL_INSURANCE_PROVIDER_STATUSES)[number];

export interface RentalValueAddedService {
  id: string;
  tenantId: string;
  categoryCode: RentalCategoryCode;
  code: string;
  name: string;
  serviceType: "insurance" | "damage_waiver" | "delivery" | "consumable" | "operator" | "support" | "other";
  billingUnit: RentalServiceBillingUnit;
  price: number;
  /** 最小可选数量。可重复选择的服务用它表达「至少两份」。 */
  minimumQuantity: number;
  maximumQuantity: number;
  coverageLimit?: number;
  deductible?: number;
  termsVersion: string;
  terms: string;
  applicableItemGroupIds: string[];
  /** 适用履约方式。留空表示不限制。 */
  applicableFulfillmentModes: RentalFulfillmentMode[];
  /** 适用履约地点。留空表示不限制。 */
  applicableLocationIds: string[];
  /** 适用客户类型。 */
  customerScope: "all" | "personal" | "corporate";
  selectionMode: RentalServiceSelectionMode;
  /** `selectionMode === "mandatory"` 时必填：触发规则。 */
  mandatoryRule?: RentalServiceMandatoryRule;
  /**
   * 仅 `serviceType === "insurance"` 使用。损坏免赔（damage_waiver）是租赁商自己的
   * 合同责任减免，配它等于把免赔冒充成保险，因此服务端拒绝。
   */
  insuranceProviderStatus?: RentalInsuranceProviderStatus;
  insuranceProviderName?: string;
  /** 是否必须按服务地点与计划时段检查并预留容量。 */
  requiresCapacity: boolean;
  status: "enabled" | "disabled";
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveRentalValueAddedServiceRequest extends Omit<RentalValueAddedService, "id" | "tenantId" | "categoryCode" | "version" | "createdAt" | "updatedAt"> {
  id?: string;
}

/** 服务未通过资格判定的原因码（需求 4.4.11：不适用时服务端必须明确拒绝）。 */
export const RENTAL_SERVICE_SKIP_REASONS = [
  "status_not_enabled",
  "item_group_mismatch",
  "fulfillment_mode_mismatch",
  "location_mismatch",
  "customer_scope_mismatch",
  "quantity_out_of_range",
  "mandatory_missing"
] as const;
export type RentalServiceSkipReason = (typeof RENTAL_SERVICE_SKIP_REASONS)[number];

/**
 * 报价/订单里固化的服务快照（需求 4.4.11「报价与订单保存实际命中的服务、价格、
 * 资格和条款快照」，以及「条款发布后不可原地修改；有效报价与历史订单继续使用原快照」）。
 *
 * 条款正文整段固化而不是只存版本号：需求明确「不得用当前网页条款替代历史订单条款」，
 * 只存版本号在服务被删除或改写后就取不回当时的正文。
 */
export interface RentalQuoteServiceSnapshot {
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  serviceType: RentalValueAddedService["serviceType"];
  serviceVersion: string;
  workspaceId: string;
  billingUnit: RentalServiceBillingUnit;
  selectionMode: RentalServiceSelectionMode;
  /** 强制服务必须标记「业务规则要求」，不得显示为客户自愿选择。 */
  requiredByRule: boolean;
  mandatoryRuleHit?: string;
  unitPrice: number;
  quantity: number;
  /** 计费单位数（按 billingUnit 与租期算出）。 */
  billingUnits: number;
  amount: number;
  /** 计算说明：单价 × 数量 × 单位数。 */
  formula: string;
  coverageLimit?: number;
  deductible?: number;
  /** 报价时冻结的商品适用范围；空数组表示不限商品，存量未冻结记录须人工核对条款。 */
  applicableItemGroupIds?: string[];
  termsVersion: string;
  /** 条款正文快照。 */
  terms: string;
  /** 逐条资格判据，供报价直接展示「为什么这个服务可用」。 */
  eligibility: Array<{ rule: string; passed: boolean; detail?: string }>;
  /**
   * 保障服务的展示口径。`damage_waiver` 恒为 false 且不带 provider；
   * `insurance` 在接入真实 Provider 前也恒为 false——未投保就不能显示已投保。
   */
  insuredDisplayable: false;
  insuranceProviderStatus?: RentalInsuranceProviderStatus;
  insuranceProviderName?: string;
  requiresCapacity: boolean;
  /** 有容量服务与按小时服务使用自己的计划时段，不得默认套用完整租期。 */
  scheduledStartAt: string;
  scheduledEndAt: string;
  serviceLocationId: string;
  capacityQuantity: number;
  /** 服务费用已被优惠或券抵扣的金额；退款只能退客户实际支付的净额。 */
  discountAllocatedAmount?: number;
  couponAllocatedAmount?: number;
}

/**
 * 增值服务的实际履约状态（MKT-02D）。
 *
 * 计划时间只能说明服务承诺，不能自动证明已经开始或完成；新订单的服务发生项
 * 必须由运营人员明确记录实际动作。终态不会被后续动作覆盖。
 */
export const RENTAL_SERVICE_EXECUTION_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
  "no_show"
] as const;
export type RentalServiceExecutionStatus = (typeof RENTAL_SERVICE_EXECUTION_STATUSES)[number];

export const RENTAL_SERVICE_EXECUTION_ACTIONS = ["start", "complete", "cancel", "fail", "no_show"] as const;
export type RentalServiceExecutionAction = (typeof RENTAL_SERVICE_EXECUTION_ACTIONS)[number];

export const RENTAL_SERVICE_REFUND_STATUSES = [
  "none",
  "pending_review",
  "approved_pending_refund",
  "rejected",
  "refunded",
  /** 取货前订单变更已经把客户净额纳入订单退款差额，不再创建服务退款审核单。 */
  "included_in_order_change"
] as const;
export type RentalServiceRefundStatus = (typeof RENTAL_SERVICE_REFUND_STATUSES)[number];

/** APP 与管理端共用的服务实际履约动作入参。完成的每一段必须使用独立稳定的
 * Idempotency-Key 请求头；重试保持原键和原请求，不能按当前剩余数量重建请求。 */
export interface UpdateRentalServiceOccurrenceRequest {
  action: RentalServiceExecutionAction;
  actualAt?: string;
  result?: string;
  /** 完成动作本次实际执行的服务数量；缺省表示完成全部剩余数量。 */
  executedQuantity?: number;
  reason?: string;
  evidenceAttachments?: string[];
  /** 完成时必须明确记录客户是否确认，不能从“点击完成”推断。 */
  customerConfirmed?: boolean;
  /** 失败/取消的建议退款额，缺省为该次服务客户实际支付的净额。 */
  refundAmount?: number;
  compensationAmount?: number;
}

/**
 * 订单上的一次服务发生（MKT-02C）。
 *
 * 为什么不能按 serviceId 合并：同一个服务可以在原订单买一次、再由第 1 次续租买一次，
 * 两次的服务版本、条款版本、时段、单价与净额都可能不同，各自还对应**独立的**容量预留。
 * 早期实现把它们按 serviceId 合并成一条并取时段并集，结果是后一次覆盖前一次的版本与
 * 金额，账上有服务费但找不到对应的那次履约承诺。
 *
 * 因此发生项一律追加、不覆盖。`occurrenceId` 是稳定标识，`reservationKey` 就是容量依据
 * ——它与 `rental_service_reservations.idempotencyKey` 同源，凭它可以把一次发生项和它
 * 自己那条容量预留精确配对，而不是靠 serviceId 猜。
 *
 * 字段全部可选：存量订单的服务快照没有这些信息，读取侧按缺省回落到旧口径。
 */
export interface RentalOrderServiceOccurrence extends RentalQuoteServiceSnapshot {
  /** 稳定标识。形如 `order:<订单id>:<serviceId>:<序号>` 或 `extension:<续租id>:<serviceId>:<序号>`。 */
  occurrenceId?: string;
  /** 来源：下单时约定的服务，还是某一次续租新增/延长出来的。 */
  origin?: "order" | "extension";
  /** 来源续租的 id 与序号（origin 为 extension 时给出），用于界面上显示"第几次续租新增"。 */
  extensionId?: string;
  extensionSequence?: number;
  /** 容量依据：对应容量预留的幂等键。不需要容量的服务没有这一项。 */
  reservationKey?: string;
  /** 实际履约状态；存量订单缺省时按 not_started 读取，但不会自动补写历史。 */
  executionStatus?: RentalServiceExecutionStatus;
  actualStartAt?: string;
  actualEndAt?: string;
  executionResult?: string;
  /** 已实际执行的数量；存量订单缺省时按 0 读取。 */
  executedQuantity?: number;
  /** ORDER-CHANGE-01D：取货前已取消的服务数量；quantity 表示当前仍有效的服务数量。 */
  cancelledQuantity?: number;
  /** 每次部分执行的事实，不用覆盖前一次结果。 */
  executionSegments?: Array<{
    quantity: number;
    actualStartAt?: string;
    actualEndAt: string;
    result: string;
    evidenceAttachments?: string[];
    customerConfirmedAt?: string;
    executedBy?: string;
  }>;
  failureReason?: string;
  evidenceAttachments?: string[];
  customerConfirmedAt?: string;
  executedBy?: string;
  /** 服务取消/失败产生的净额退款审核状态；批准不等于已实际退款。 */
  refundStatus?: RentalServiceRefundStatus;
  refundAmount?: number;
  refundReviewId?: string;
  /** 实际退款资金事件落账后的闭环事实；批准与实际退款必须分开记录。 */
  refundedAt?: string;
  refundedBy?: string;
  compensationAmount?: number;
}

/** Original service-operation observation. Unknown does not prove rollback or allow resubmission. */
export type RentalServiceExecutionReceipt =
  | { status: "committed"; order: RentalOrder; occurrence: RentalOrderServiceOccurrence }
  | { status: "unknown" };

export interface RentalServiceCapacity {
  id: string;
  tenantId: string;
  workspaceId: string;
  serviceId: string;
  locationId: string;
  windowStart: string;
  windowEnd: string;
  totalCapacity: number;
  reservedQuantity: number;
  usedQuantity: number;
  status: "enabled" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface SaveRentalServiceCapacityRequest {
  id?: string;
  serviceId: string;
  locationId: string;
  windowStart: string;
  windowEnd: string;
  totalCapacity: number;
  status: "enabled" | "disabled";
}

/**
 * 应付押金规则（需求 4.4.7）。
 *
 * `mode` 决定金额来源：`fixed` 取费率的 `depositAmount`，`price_multiple` 取
 * `depositMultiple × 该行租金`，`none` 不收。`maxAmount` 是单笔订单押金上限。
 */
/**
 * 押金模式（需求 4.4.7）。押金是**实收可退可抵扣**的资金，与预授权独立。
 * - `none` 免押；`fixed` 每件固定（费率 depositAmount × 数量）；
 * - `price_multiple` 商品行租金倍数（以该行日期价格与封顶处理后的租金为基数）；
 * - `order_fixed` 每单固定（规则级 fixedAmount，整单一笔，不随行数或数量放大）。
 * `maxAmount` 是**订单级上限**，按各行求和后再应用（需求 4.4.7：先逐行求和再封顶）。
 */
export type RentalDepositMode = "none" | "fixed" | "price_multiple" | "order_fixed";

export interface RentalDepositRule {
  mode: RentalDepositMode;
  /** 单笔订单的押金上限。留空表示不设上限；0 是合法值（等于免押）。 */
  maxAmount?: number;
  /** 每单固定押金金额，仅 `order_fixed` 使用。整单一笔，不随行数放大。 */
  fixedAmount?: number;
}

/**
 * 预授权模式（需求 4.4.7）。预授权是**冻结额度**、不是收款，与押金完全独立，可同时存在。
 * 相较押金多两种：
 * - `order_fixed` 订单固定额度（规则级 fixedAmount）；
 * - `risk_surcharge` 风险附加额度：按行租金倍数求和后，再加规则级 `riskSurchargeAmount`
 *   风险缓冲（冻结租金价值之外再冻一笔风险准备金）。
 * `maxAmount` 为订单级预授权上限，逐行求和后再应用。
 */
export type RentalPreauthorizationMode =
  | "none"
  | "fixed"
  | "price_multiple"
  | "order_fixed"
  | "risk_surcharge";

export interface RentalPreauthorizationRule {
  mode: RentalPreauthorizationMode;
  /** 单笔订单的预授权额度上限。留空表示不设上限。 */
  maxAmount?: number;
  /** 订单固定额度，仅 `order_fixed` 使用。 */
  fixedAmount?: number;
  /** 风险附加额度，仅 `risk_surcharge` 使用；加在按行租金倍数求和之上。 */
  riskSurchargeAmount?: number;
}

/**
 * RULE-01B：押金减免依据（需求 4.4.7 line 526）。会员权益、企业合同或人工审批导致
 * 免押/减押/降低预授权时，必须保存**减免类型、依据、审批人及当时规则快照**，
 * 不能只保存金额为 0。客户端不得直接传最终减免金额——必须引用可信事实由服务端计算。
 */
export type RentalSecurityReductionType = "member_benefit" | "corporate_contract" | "manual_approval";

/** 商品级风控等级。缺失或非法值一律按 unclassified 处理，不得自动减免保证金。 */
export const RENTAL_SECURITY_RISK_LEVELS = ["low", "standard", "high"] as const;
export type RentalSecurityRiskLevel = (typeof RENTAL_SECURITY_RISK_LEVELS)[number];

/** 空间规则版本内的会员保证金/预授权减免门禁；规则缺失或未启用时默认不允许。 */
export interface RentalMembershipSecurityReductionPolicy {
  enabled: boolean;
  /** 只有明确允许的商品风险等级参与减免；商品未分级时始终不参与。 */
  allowedRiskLevels?: RentalSecurityRiskLevel[];
  /** 相对于风控允许商品对应保证金/预授权基数的比例上限（0-100）。 */
  maxReductionPercent?: number;
  /** 单笔订单此类资金的绝对减免上限，使用空间结算币种。 */
  maxReductionAmount?: number;
}

export interface RentalSecurityReduction {
  /** 作用对象：押金还是预授权。两者独立减免。 */
  instrument: "deposit" | "preauthorization";
  type: RentalSecurityReductionType;
  /** 引用的可信事实标识：会员权益 id、企业合同号或审批单号。 */
  factReference: string;
  /** 减免后的目标金额，由服务端依据 fact 计算，不接受客户端直接传最终减免额。 */
  reducedTo: number;
  approver?: string;
  reason: string;
}

/**
 * 资金事件只追加，不通过修改原报价明细表达。mock 是模拟，offline 是原授权下已确认
 * 的线下收款，线上来源由支付运行器核验；这些来源不能混作同一笔实款。
 */
export type RentalFundingInstrument = "deposit" | "preauthorization" | "rental";

/**
 * 资金动作。押金：initiate（收取）、capture（抵扣）、refund（退款）、fail（失败）；
 * 预授权：initiate（冻结）、append（追加）、capture（转扣）、release（释放）、fail（失败）。
 */
export type RentalFundingAction = "initiate" | "append" | "capture" | "refund" | "release" | "fail";

export interface RentalFundingEvent {
  id: string;
  tenantId: string;
  workspaceId: string;
  orderId: string;
  instrument: RentalFundingInstrument;
  action: RentalFundingAction;
  amount: number;
  /** 该 instrument 在本事件后的余额（押金实收余额 / 预授权冻结余额）。由服务端结算。 */
  balanceAfter: number;
  /** 服务端核对的资金来源；旧 mock 只有关联原线下确认记录才可投影为 offline。 */
  provider: "mock" | "offline" | "alipay" | "wechat_pay" | "stripe";
  /** 线下人工收退款的实际方式；预授权转扣/释放等内部资金动作不填。 */
  paymentMethod?: RentalOfflinePaymentMethod;
  /** 幂等键：同一 (order, instrument, action, idempotencyKey) 重复提交只落一条。 */
  idempotencyKey: string;
  reason: string;
  operator?: string;
  /** 失败事件记录失败原因码，供恢复流程判断可否重试。 */
  failureCode?: string;
  at: string;
  createdAt: string;
}

export interface InitiateRentalFundingRequest {
  instrument: RentalFundingInstrument;
  /** 首次金额由服务端从订单快照的押金/预授权字段取得，客户端不得提交。 */
  idempotencyKey: string;
  reason: string;
  paymentMethod?: RentalOfflinePaymentMethod;
}

export interface RentalFundingAmountRequest {
  instrument: RentalFundingInstrument;
  amount: number;
  idempotencyKey: string;
  reason: string;
  paymentMethod?: RentalOfflinePaymentMethod;
}

/** MKT-02D：将已批准的增值服务退款写入模拟资金流水并闭合该服务发生项。 */
export interface RefundRentalServiceRequest {
  amount: number;
  idempotencyKey: string;
  reason: string;
  paymentMethod?: RentalOfflinePaymentMethod;
}

export interface RentalFundingReleaseRequest {
  idempotencyKey: string;
  reason: string;
}

export interface RentalFundingFailureRequest {
  instrument: RentalFundingInstrument;
  failureCode: string;
  idempotencyKey: string;
  reason: string;
  paymentMethod?: RentalOfflinePaymentMethod;
}

export interface RentalFundingBalance {
  orderId: string;
  /** 本次余额的证据口径，未混入另一类事件；events 仍保留全部历史。 */
  balanceBasis: "real" | "simulated";
  /** 仅服务端确认的纯演练订单可用；不是客户端写入授权。 */
  simulationAllowed: boolean;
  /** 保证金只有实际抵扣后才计入已付；企业原核销独立抵应收、不并入现金collected。balance扣原净实收/抵扣/核销，负值为未处理多收；due为当前待收（含待补款续租，下限0），消费者不自行推导。 */
  rental: { payable: number; collected: number; refunded: number; securityCaptured: number;
    /** Original corporate payment allocations, not extra cash events. Old responses may omit it. */
    corporatePaid?: number;
    balance: number; pendingExtensionAmount: number; due: number };
  /** pendingExtensionAmount 是尚未生效续租申请带来的新增资金要求；due 为当前待收押金（requiredAmount - collected，已下限 0），服务端计算。 */
  deposit: { collected: number; captured: number; refunded: number; balance: number; requiredAmount: number; pendingExtensionAmount: number; due: number };
  preauthorization: { frozen: number; captured: number; released: number; balance: number; requiredAmount: number; pendingExtensionAmount: number };
  events: RentalFundingEvent[];
}


/**
 * 续租 / 延期规则（需求 4.6.9）。
 *
 * 这里只放**准入**约束。金额一律由增量期重新报价得出，不在规则里配"续租单价"——
 * 那会造出第二套价格事实，与已发布的空间价格版本对不上。
 */
export interface RentalExtensionRule {
  /** 缺省保留新增时段单独计费；随订单规则快照固定。 */
  pricingMode?: "incremental" | "original_total";
  /** 关掉后订单不再接受续租申请。缺省视为 true。 */
  enabled: boolean;
  /** 同一订单允许续租的次数上限。不填即不限。 */
  maxTimes?: number;
  /** 累计延长的天数上限（自然日）。不填即不限。 */
  maxTotalDays?: number;
  /**
   * 已逾期时补办续租是否强制先付款。缺省 true。
   *
   * 企业月结客户平时不需要补款动作即可续租，但已经逾期说明履约已经出问题，
   * 这时仍挂账会让欠款继续累积——旧模块也是在逾期时强制转为即时收款。
   */
  forceImmediateWhenOverdue: boolean;
}

/**
 * 提前归还退款规则（需求 4.6.8）。
 *
 * 需求要求「允许租金退款时必须明确计费单位、长租阶梯是否重新计算、优惠如何重新分摊」，
 * 本实现的口径固定为：**按未使用计费单位占比折算，阶梯档不重算，优惠按同一比例同步折减**。
 * 因此规则里只需要「提前多久」和「退几成」两个旋钮，不需要再选算法——
 * 给算法留选项会让同一个空间的历史订单出现两种退款口径，事后无法解释。
 */
export interface RentalEarlyReturnRule {
  /**
   * `none` 不退；`auto` 按规则直接退；`manual_review` 只生成待审批退款，审批通过才落账。
   * 缺省 `none`。
   */
  mode: "none" | "auto" | "manual_review";
  /**
   * 至少提前多少小时归还才产生退款。汽车租赁的惯例是 24——提前不足一天不退。
   * 0 表示只要提前就退。
   */
  minAdvanceHours: number;
  /** 剩余租金的退款比例（0-100）。 */
  refundPercent: number;
  /** 单笔退款上限。不填即不封顶。 */
  maxRefundAmount?: number;
  /**
   * 是否连未发生的增值服务费一并退（需求 4.6.8：「未发生且可取消的服务或履约费用
   * 可按规则退款」）。只退计划服务时段完全落在归还时刻之后的那些行。
   */
  refundUndeliveredServices: boolean;
}

/**
 * 税规则（通行租赁系统的做法；需求文档目前没有税务口径，属新增能力）。
 *
 * 只做**价内税**：标价即含税，税额由含税额反算 `含税额 × r/(1+r)`，客户看到的应付金额
 * 不变。这样选是因为大陆租赁零售的标价惯例就是含税价，而香港没有增值税——把税率配成 0
 * 即可，不需要第二套报价口径。
 *
 * `inclusive` 目前固定 `true`，留着这个字段是为了将来做价外税（B2B 不含税报价）时
 * 有地方表达，而不必再改一次快照结构。
 */
export interface RentalTaxRule {
  /** 税率，小数形式：13% 填 0.13。0 表示不计税。 */
  rate: number;
  /** 价内税恒为 true。价外税尚未实现，写 false 会被服务端拒绝。 */
  inclusive: true;
  /** 票面税种说明，如「增值税 13%」。只做展示与开票参考，不参与计算。 */
  label?: string;
}

export interface RentalNoShowRule {
  /** 开启后，领取时间超过宽限才进入待确认爽约；关闭时不自动推进爽约状态。 */
  enabled: boolean;
  /** 从订单 startAt 起算的领取宽限，独立于未支付保留和归还逾时宽限。 */
  pickupGraceMinutes: number;
  /** 进入待确认爽约后，必须等待的最终确认时限。 */
  finalizationMinutes: number;
  /** 爽约最终结算的费用依据。 */
  feeType: "none" | "fixed_amount" | "percentage";
  feeValue: number;
}

export interface RentalRuleConfig {  /**
   * 计价相关的经营空间规则（需求 4.4.5：「班次时长及边界由经营空间规则定义」）。
   *
   * 可选，且整组可缺省：既有规则快照里没有这一组，订单必须继续按原快照复算，
   * 不能因为新增字段就让历史订单换一套班次口径。
   */
  pricing?: {
    /** 班次时长（小时）。缺省 8。 */
    shiftHours?: number;
    /**
     * 班次边界：一天内各班次的起始小时（营业时区），如 `[0, 8, 16]`。
     * 给了边界就按「跨过几个班次窗口」计数；不给则按班次时长整除。
     */
    shiftStartHours?: number[];
    /** 小时计价按连续24小时分段；缺省关闭。 */
    hourToDayEnabled?: boolean;
    /** 余段严格超过该小时数转日价；达到日价也封顶。开启时必填，0 < 值 <= 24。 */
    hourToDayThresholdHours?: number;
  };
  payment: {
    timing: "order" | "confirmation" | "pickup" | "offline_terms";
    depositMode: "none" | "fixed" | "price_multiple" | "preauthorization";
    preauthorizationRequired: boolean;
    unpaidHoldMinutes: number;
    /** 报价有效期独立于订单未支付占用时限；旧快照缺省沿用原口径。 */
    quoteValidityMinutes?: number;
  };
  /**
   * 应付押金规则（需求 4.4.7：押金与预授权**独立配置、独立计算**，可同时存在）。
   *
   * 与 `payment.depositMode` 的关系：后者是旧的「二选一」口径，一个字段在押金与预授权之间
   * 切换，表达不了「同时收 500 押金并冻结 2000 额度」。新配置用本组与 `preauthorization`
   * 两组独立表达；整组可缺省，缺省时由 `payment.depositMode` 派生，使既有已发布规则快照
   * 继续按原口径复算（历史订单不得因新增字段换一套押金口径）。
   */
  deposit?: RentalDepositRule;
  /** 预授权规则（需求 4.4.7）。独立于押金，可与押金同时存在。 */
  preauthorization?: RentalPreauthorizationRule;
  /**
   * 会员减押金/预授权独立风控门禁。缺省等同关闭；启用时必须显式配置商品风险等级、
   * 比例上限和单笔绝对上限。客户必须仍是有效会员且没有未关闭风险记录。
   */
  membershipSecurityReduction?: {
    deposit?: RentalMembershipSecurityReductionPolicy;
    preauthorization?: RentalMembershipSecurityReductionPolicy;
  };
  fulfillment: {
    pickupInspectionRequired: boolean;
    returnInspectionRequired: boolean;
    evidenceRequired: boolean;
    allowDifferentReturnLocation: boolean;
    /** 领取前准备缓冲（分钟），只占库存不计租金。缺省 0。 */
    pickupBufferMinutes?: number;
    /** 归还后检查、清洁等周转缓冲（分钟），只占库存不计租金。缺省 0。 */
    returnBufferMinutes?: number;
  };
  overdue: {
    graceMinutes: number;
    feeMode: "none" | "hourly" | "next_period" | "multiplier" | "manual_review" | "hourly_to_daily";
    feeMultiplier: number;
    maximumFee?: number;
    /** hourly_to_daily：每个逾时小时按原版本对应日价的百分比计费。 */
    hourlyRatePercent?: number;
    /** hourly_to_daily：扣除一次宽限后，每24小时余段超过此阈值转一天。 */
    dailyAfterHours?: number;
  };
  cancellation: {
    freeBeforeHours: number;
    lateFeeType: "none" | "fixed_amount" | "percentage";
    lateFeeValue: number;
    weatherExceptionEnabled: boolean;
    /** 爽约独立于客户主动取消；缺省表示历史订单没有这组规则。 */
    noShow?: RentalNoShowRule;
  };
  qualification: {
    required: boolean;
    documentTypes: string[];
    minimumValidityDays: number;
  };
  damage: {
    manualReviewRequired: boolean;
    chargeLimit?: number;
  };
  /**
   * 续租 / 延期规则（需求 4.6.9）。
   *
   * 整组可缺省：既有规则快照没有这一组，缺省视为「允许续租、不限次数与天数、
   * 逾期补办续租必须先付款」，历史订单不因新增字段换一套口径。
   */
  extension?: RentalExtensionRule;
  /**
   * 提前归还退款规则（需求 4.6.8）。
   *
   * 整组可缺省，**缺省即不退租金**——需求原文是「第一阶段固定租期订单提前归还
   * 默认不自动退租金」。缺省必须等于今天的行为，不能因为新增了字段就开始退钱。
   */
  earlyReturn?: RentalEarlyReturnRule;
  /**
   * 税规则。整组可缺省，**缺省即不计税**（税率 0、税额 0），历史订单的复算结果不变。
   *
   * 必须放在规则配置里而不是租户经营设置里：`RentalRuleConfig` 就是报价与订单的
   * `ruleSnapshot`，只有进了快照，事后才说得清「这张单当时按几个点算的税」。
   */
  tax?: RentalTaxRule;
}

/**
 * RULE-01A：规则版本五态（需求 4.6.1）。
 * pending 与 published 的区别只是生效时点是否已到，superseded 的判据是有更新的版本
 * 已经生效——三者都由服务端按当前时间现算，客户端不要据此推断可否编辑，编辑判据是 draft。
 */
export type RentalRuleVersionStatus = "draft" | "pending" | "published" | "superseded" | "void";

export interface RentalRuleVersion {
  id: string;
  tenantId: string;
  categoryCode: RentalCategoryCode;
  version: string;
  status: RentalRuleVersionStatus;
  config: RentalRuleConfig;
  changeReason: string;
  createdBy: string;
  createdAt: string;
  publishedAt?: string;
  /** 生效时点。报价按**租期开始时间**匹配覆盖该时点的版本，缺失即不参与匹配。 */
  effectiveFrom?: string;
  publishedBy?: string;
  /** 被更新版本替代的时刻。由发布动作写入，不作为匹配依据。 */
  supersededAt?: string;
  /** 上一版本号，构成版本链；恢复产生的草稿另记 restoredFromVersion。 */
  previousVersion?: string;
  restoredFromVersion?: string;
  restoreReason?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

/** 规则版本审计（只追加）：发布、恢复、作废各记一条，含原因与操作者（需求 4.6.14）。 */
export interface RentalRuleVersionAudit {
  id: string;
  tenantId: string;
  workspaceId: string;
  ruleVersionId: string;
  version: string;
  action: "publish" | "restore" | "void";
  fromStatus?: RentalRuleVersionStatus;
  toStatus: RentalRuleVersionStatus;
  reason: string;
  operator?: string;
  at: string;
}

export interface SaveRentalRuleVersionRequest {
  config: RentalRuleConfig;
  changeReason: string;
  /** 只改草稿。省略时新建草稿；已发布版本不接受修改，需先恢复为新草稿。 */
  versionId?: string;
}

/** 发布或安排生效。effectiveFrom 省略即立即生效。 */
export interface PublishRentalRuleVersionRequest {
  effectiveFrom?: string;
  reason: string;
}

export interface RestoreRentalRuleVersionRequest {
  reason: string;
}

export interface VoidRentalRuleVersionRequest {
  reason: string;
}

export interface RentalRulePublishPreview {
  draftVersion: string;
  effectiveFrom: string;
  /** true 表示未来生效（待生效），false 表示立即生效。 */
  scheduled: boolean;
  currentVersion?: string;
  supersededVersions: string[];
  /** 已固化规则快照、发布后仍按原条款结算的报价数量（需求 4.6.1）。 */
  lockedQuoteCount: number;
}

export type RentalCustomerCouponStatus = "claimed" | "locked" | "redeemed" | "expired" | "void";

export interface RentalCustomerCoupon {
  id: string;
  tenantId: string;
  customerId: string;
  templateId: string;
  templateCode: string;
  templateName: string;
  templateVersion: string;
  discountType: RentalCouponTemplate["discountType"];
  discountValue: number;
  minimumSpend: number;
  maximumDiscount?: number;
  appliesTo: RentalDiscountTarget;
  stackableWithDiscountPlans: boolean;
  applicableItemGroupIds: string[];
  grantReason: string;
  status: RentalCustomerCouponStatus;
  claimedAt: string;
  /** 领取时固化的适用租期窗口。 */
  applicableRentalFrom?: string;
  applicableRentalTo?: string;
  effectiveFrom: string;
  effectiveTo: string;
  lockedOrderId?: string;
  lockedAt?: string;
  lockedDiscountAmount?: number;
  redeemedOrderId?: string;
  redeemedAt?: string;
  releasedAt?: string;
  releaseReason?: string;
  expiredAt?: string;
  voidedAt?: string;
  voidReason?: string;
}

export interface RentalQuoteCouponEvaluation {
  couponId: string;
  templateId: string;
  templateCode: string;
  templateName: string;
  templateVersion: string;
  appliesTo: RentalDiscountTarget;
  discountType: RentalCouponTemplate["discountType"];
  discountValue: number;
  minimumSpend: number;
  maximumDiscount?: number;
  stackableWithDiscountPlans: boolean;
  /** 本次校验的服务端时点与租期开始时点分开记录，便于解释有效性。 */
  checkedAt: string;
  rentalStartAt: string;
  applicableRentalFrom?: string;
  applicableRentalTo?: string;
  baseBeforeDiscount: number;
  runningBase: number;
  formula: string;
  discountAmount: number;
  /** 租金券按实际适用订单行分摊，后续取消、部分归还和退款不再按整单猜测。 */
  rentalAllocations?: Record<string, number>;
  /** 服务券按实际服务快照分摊，提前归还退款只能退客户实付净额。 */
  serviceAllocations?: Record<string, number>;
}

export interface RentalRewardLedgerEntry {
  id: string;
  tenantId: string;
  customerId: string;
  rewardType: "points" | "balance" | "coupon";
  amount: number;
  triggerType: "registration" | "identity_verified" | "first_order_completed" | "referral";
  idempotencyKey: string;
  relatedCustomerId?: string;
  status: "granted" | "reversed";
  reason: string;
  benefitReferenceIds?: string[];
  appliedAt?: string;
  createdAt: string;
  reversedAt?: string;
}

export interface RentalCustomerBenefitAccount {
  tenantId: string;
  customerId: string;
  pointsBalance: number;
  marketingBalance: number;
  availableRewardCouponCount: number;
  updatedAt: string;
}

export interface GrantRentalRewardRequest {
  customerId: string;
  triggerType: RentalRewardLedgerEntry["triggerType"];
  idempotencyKey: string;
  relatedCustomerId?: string;
}

export interface RentalNotificationTemplateV1 {
  id: string;
  tenantId: string;
  eventCode: string;
  channel: "sms" | "app_push" | "wechat" | "email";
  name: string;
  title: string;
  body: string;
  /** 短信渠道在对应服务商侧的模板编码；仅由服务端用于投递，不渲染到日志。 */
  providerTemplateCode?: string;
  variableSchema: Record<string, { label: string; required: boolean }>;
  status: "enabled" | "disabled";
  version: string;
  updatedAt: string;
}

export interface SaveRentalNotificationTemplateRequest extends Omit<RentalNotificationTemplateV1, "id" | "tenantId" | "version" | "updatedAt"> {
  id?: string;
}

export interface RentalNotificationSendLogV1 {
  id: string;
  tenantId: string;
  templateId: string;
  templateVersion: string;
  eventCode: string;
  channel: RentalNotificationTemplateV1["channel"];
  /** 发送目标一律脱敏后留存（需求 4.9）。手机号 → 138****8888，邮箱 → a***@b.com。 */
  recipient: string;
  renderedTitle: string;
  renderedBody: string;
  variables: Record<string, unknown>;
  /** 未接真实 Provider 时只能使用 simulated / simulation_failed，不得冒充真实发送或送达。 */
  /** sent=服务商已受理，delivery_pending=已查询但尚无最终回执，delivered/ delivery_failed=服务商最终回执。 */
  status: "queued" | "sent" | "delivery_pending" | "delivered" | "delivery_failed" | "failed" | "delivery_uncertain" | "simulated" | "simulation_failed";
  provider: string;
  providerMessageId?: string;
  errorMessage?: string;
  attempts: number;
  /** 下一次允许自动重试的时间；只对真实短信投递记录有值。 */
  nextAttemptAt?: string;
  /** 最近一次实际调用短信服务商的时间。 */
  lastAttemptAt?: string;
  /** 发送上限快照，避免后续配置变化改变历史日志的重试边界。 */
  maxAttempts?: number;
  /**
   * NOTICE-01A：触发本条通知的业务对象。业务事件驱动的通知带上它（如 order / 订单id），
   * 手工发送没有业务对象。
   */
  businessObjectType?: string;
  businessObjectId?: string;
  /**
   * NOTICE-01A：空间级幂等键，形如 `<eventCode>:<businessObjectId>`。
   * 同一空间同一业务事件只落一条；手工发送不带键，不参与去重。
   */
  idempotencyKey?: string;
  createdAt: string;
  sentAt?: string;
}

export interface SendRentalNotificationRequest {
  templateId: string;
  recipient: string;
  variables: Record<string, unknown>;
}

export interface RentalQuoteRequest {
  customerType: "personal" | "corporate";
  customerId?: string;
  /** 新会员订单使用。customerId 必须是个人会员，企业不能直接替代个人。 */
  bookingIdentity?: RentalBookingIdentityInput;
  fulfillmentMode: RentalFulfillmentMode;
  fulfillmentLocationId: string;
  returnLocationId?: string;
  /** 配送/上门类履约（deliveryDestination=customer_address 的品类）必填：客户地址簿里选定的收货地址 id。
   *  服务端据此解析并把地址固化进报价/订单快照（RentalQuoteSnapshotV1.deliveryAddressSnapshot），不采信客户端自报的地址内容。 */
  deliveryAddressId?: string;
  /** 仅用于本单；与 deliveryAddressId 二选一，不写入客户地址簿。 */
  deliveryAddressDraft?: RentalDeliveryAddressDraft;
  startAt: string;
  endAt: string;
  pricingPlanId?: string;
  discountPlanId?: string;
  customerCouponId?: string;
  lines: Array<{
    /** 新订单由定价分组进入；服务端解析为实际承接库存的产品型号。 */
    pricingGroupId?: string;
    /** 显式提交表示预约准确型号；仅提交 pricingGroupId 表示允许组内分配。 */
    itemGroupId?: string;
    /** 服务端解析后固化；客户端自报的值不可信。 */
    reservationPrecision?: "group" | "exact_model";
    /** 服务端报价时的组成员及名称快照；不得从客户端请求采信。 */
    pricingGroupMemberItemGroupIds?: string[];
    pricingGroupCode?: string;
    pricingGroupName?: string;
    quantity: number;
    pricingUnit?: RentalPricingUnit;
    usageQuantity?: number;
    note?: string;
  }>;
  services?: Array<{
    serviceId: string;
    quantity: number;
    /** 省略时使用租赁起止；有容量服务和按小时服务必须明确提供。 */
    scheduledStartAt?: string;
    scheduledEndAt?: string;
    serviceLocationId?: string;
  }>;
}

/**
 * TENANT-READY-01：空白/半配置租户的开业配置状态（服务端权威判定）。
 * 全部事实按当前租户 + 经营空间聚合；不回落 demo 或共享默认数据。
 */
export interface TenantReadinessItem {
  key: string;
  title: string;
  done: boolean;
  /** 事实源暂时不可读时置 true；这不是“未配置”，页面应提示重试而不是误导配置。 */
  unavailable?: boolean;
  /** 可暂缓项：缺失时不阻塞 ready，也不得伪装成报价闸门（如会员方案）。
   *  ready 与 quoteBlockers 只反映必做项，页面据实标注避免制造假闸门。 */
  optional?: boolean;
  /** 未完成时缺什么、下一步去哪。 */
  missing: string;
  nextHref: string;
  summary?: string;
}

export interface TenantReadinessStatus {
  tenantId: string;
  workspaceId: string;
  status: "not_started" | "configuring" | "completed";
  ready: boolean;
  missingKeys: string[];
  items: TenantReadinessItem[];
  /** 报价/下单的硬闸门摘要：即便部分完成，服务端仍有独立拦截。 */
  quoteBlockers: string[];
}

/** 报价命中的单个「营业日期 × 商品组」计价依据（需求 4.5.6）。 */
export interface RentalQuoteCalendarDay {
  /** 营业时区下的日期键，与营业日历同一口径。 */
  date: string;
  /** 该日期所属年度。跨年度租期靠它区分依据来自哪一年的日历。 */
  year: number;
  dayType: RentalDayType;
  businessStatus: RentalCalendarBusinessStatus;
  /** 该日期规则的来源：人工覆盖 / 官方日历 / 每周模板（需求 4.5.3 的优先级）。 */
  source: RentalCalendarDay["source"];
  /** 该年度日历的版本；未发布年度记为 `draft`。 */
  calendarVersion: string;
  itemGroupId: string;
  itemGroupCode: string;
  /** 落在该日期上的计费单位数。小时粒度下同一天可能有多个计费块。 */
  unitCount: number;
  /** 该日期实际使用的单位价（已含阶梯档位选择，未乘日期系数）。 */
  unitAmount: number;
  /** 该日期实际应用的日期价格系数。 */
  multiplier: number;
  /** 该日期的实际价格：unitCount × unitAmount × multiplier，未乘商品数量、未封顶。 */
  amount: number;
  /**
   * 该计费单位的**取价时点**（需求 4.5.6 v2.9：每个计费单位必须有明确的取价时点）。
   * 自然日首个单位 = 实际租期开始时点、后续单位 = 对应营业日期的开始时点；
   * 小时/班次/夜/24 小时/周/30 日月 = 计费块开始时点；整包 = 起租时点。
   * 使用量与日期无对应关系，省略。分时价格按取价时点命中。
   */
  priceAt?: string;
  /**
   * 命中的价格解析层（需求 4.4.5/4.5.5 v2.9 的四级优先级）：
   * `date_override` 具体日期时间覆盖 > `periodic` 周期性计价时段 >
   * `day_type` 商品日期类型价格 > `base` 商品基础价格。
   *
   * `day_type_legacy` 是 PRICE-03 之前的兼容层：整个空间共用的
   * `weekendMultiplier` / `holidayMultiplier`，由经营设置的
   * `pricing.holidayPricingEnabled` 控制。它与 `day_type` 分开记录，
   * 快照才能说清这一单位是按**逐商品配置的日期类型价格**算的，
   * 还是按旧的空间级倍率算的——两者的后续处置不同（前者保留，后者待迁移移除）。
   */
  hitLayer?: "date_override" | "periodic" | "day_type" | "day_type_legacy" | "base";
  /** 该单位命中时的价格计划版本（需求 4.4.8：逐计费单位保存价格版本）。 */
  pricingPlanVersion?: string;
}

export interface RentalQuoteChargeLine {
  code: string;
  name: string;
  type:
    | "rental"
    | "calendar_adjustment"
    | "fulfillment"
    | "preauthorization"
    | "discount"
    | "coupon"
    | "service"
    | "deposit"
    | "cancellation"
    | "overdue"
    | "damage"
    /** 续租新增期间的费用（需求 4.6.9）。一次续租一条，code 带序号以便去重。 */
    | "extension"
    /** 提前归还退还的租金（需求 4.6.8）。金额为**负数**，直接冲减应收。 */
    /** 订单变更产生的差额；原订单金额不改，只追加一条变更费用事实。 */
    | "early_return_refund"
    | "order_change";
  amount: number;
  sourceId?: string;
  sourceVersion?: string;
  detail?: string;
}

/** 服务端报价来源，不是客户端输入或永久授权；存量缺失不得推断创建者。 */
export interface RentalQuoteSourceSnapshot {
  version: 'rental-quote-source-1';
  tenantId: string;
  workspaceId: string;
  actor: { kind: 'user' | 'customer'; id: string };
  audience: 'operator' | 'staff' | 'client';
}

export interface RentalQuoteSnapshotV1 {
  sourceSnapshot?: RentalQuoteSourceSnapshot;
  /** 报价时完整取还检查模板；空数组表示无启用模板，缺省仅表示存量无证据。 */
  inspectionTemplateSnapshots?: RentalInspectionTemplate[];
  /** 本次报价实际采用的不可变品类版本；存量无证据时不伪造回填。 */
  categoryVersionId?: string;
  /** 报价时的计价日历及空间计价口径，供原价续租复算。 */
  pricingContext?: RentalRepricingContext;
  id: string;
  tenantId: string;
  quoteNo: string;
  categoryCode: RentalCategoryCode;
  request: RentalQuoteRequest;
  /** 配送/上门类（customer_address 品类）报价固化的收货地址快照；自取或车辆据点类无此字段。下单时原样拷进订单。 */
  deliveryAddressSnapshot?: RentalDeliveryAddressSnapshot;
  /** 新会员预约身份、主体与权益版本的服务端快照。 */
  membershipSnapshot?: RentalMembershipSnapshot;
  /** 会员方案中本次真正生效的权益与金额；只存会员关系不足以解释实际减免。 */
  membershipBenefitEvaluations?: RentalMembershipBenefitEvaluation[];
  chargeLines: RentalQuoteChargeLine[];
  rentalAmount: number;
  /** 定价组／商品行的租金快照，订单变更与退款按此分摊。 */
  rentalLineAmounts?: Record<string, number>;
  discountAmount: number;
  couponAmount: number;
  serviceAmount: number;
  /** 履约费用合计（需求 4.4 公式的独立一项，与增值服务分开计）。 */
  fulfillmentAmount: number;
  /** 应付押金：实收的那部分。与预授权独立计算，可同时存在。 */
  depositAmount: number;
  /**
   * 预授权额度（需求 4.4「同时独立计算：应付押金；预授权金额」）。
   *
   * 与 `depositAmount` 独立且必须分开存：早前二者共用一个字段，只把明细行改个名，
   * 于是「实收 500 押金」与「冻结 500 额度」在数据上完全无法区分，
   * 对账、退款与风控都读不出真实资金状态。两者都不进 `payableAmount`：
   * 押金要退、预授权只是冻结，都不是本次交易的收入。
   */
  preAuthAmount: number;
  payableAmount: number;
  /**
   * 本次实收（需求 4.4.1：`本次实收 = 租赁应付 + 应付押金`）。
   *
   * 必须是独立字段：需求明确「应付押金、预授权金额、已支付、待支付和可退金额必须作为
   * 独立金额字段，不得用同一个字段或明细类型混用」。押金此前是一条正数明细却不进
   * `payableAmount`，于是 `sum(chargeLines)` 不等于任何单一总额，与「明细之和等于
   * 对应总额」冲突。补上本字段后对应关系明确：非押金明细之和 = payableAmount、
   * 押金明细之和 = depositAmount、两者之和 = receivableAmount；
   * 预授权额度按需求不计入其中任何一项。
   */
  receivableAmount: number;
  /**
   * 税率（小数形式，13% 记 0.13）与从 `payableAmount` 反算出的税额。
   *
   * 价内税是对已收金额的**拆分**，不是追加：`payableAmount` 与 `receivableAmount` 都不含
   * 税额的加减，因此也**不进 `chargeLines`**——做成一条正数明细会打破上面那条
   * 「非押金明细之和 = payableAmount」的对应关系。押金不计税（押金不是收入）。
   * 两个字段整体可缺省：规则没配税时为 0，存量报价读出来也是 0。
   */
  taxRate?: number;
  taxAmount?: number;
  /**
   * 结算币种快照（需求 §948）。取报价时经营空间的币种，之后空间改币种不影响已出的报价。
   * 可缺省：存量报价读出来是 undefined，展示时回落到人民币符号。
   */
  currency?: RentalCurrency;
  pricingPlanVersion: string;
  /**
   * 本次报价实际命中的费率（需求 4.4「报价快照」+ 验收「相同输入可复算」）。
   *
   * 只存 `pricingPlanVersion` 不够：编辑计划会覆盖同一行并递增版本号，
   * 旧版本的费率内容随之消失，历史报价指向一个已不存在的版本，无法按原价复算。
   * 这里固化命中的费率本体，复算不再依赖计划仍以该版本存在。
   */
  rateSnapshot: RentalPricingRate[];
  /**
   * PRICE-03：本次报价命中的**空间级不可变价格版本**引用。
   *
   * 与 `rateSnapshot` 并存而不重复：快照回答「按什么价算的」，版本引用回答
   * 「这份价格是空间的哪一次调价结果」——追责与对账要的是后者。
   * 内存数据源没有版本事实，因此可空。
   */
  priceVersionId?: string;
  priceVersion?: string;
  ruleVersion: string;
  ruleSnapshot: RentalRuleConfig;
  calendarVersion?: string;
  /**
   * 命中营业日期的结构化快照（需求 4.5.6）。
   *
   * 需求原文要求「保存**每个**命中营业日期的年度、日期类型、营业状态、实际价格、
   * 来源和年度日历版本；跨年度报价不得只保存一个年份或版本号」。
   * `calendarVersion` 是把各年度版本拼成的字符串，够用于人读但无法复算：
   * 它说不出哪一天是什么类型、按什么系数算了多少钱、依据来自人工覆盖还是官方日历。
   *
   * 每条记录对应一个「营业日期 × 商品组」组合——日历事实（年度、类型、状态、来源、
   * 版本）与商品无关，但实际价格与商品相关，同一天不同商品的系数可以不同
   * （需求 4.5.5：车辆节假日加价 30%、摄影器材加价 10%）。
   */
  calendarSnapshot: RentalQuoteCalendarDay[];
  /**
   * 命中年度里官方日历尚未确认的提示（需求 4.5.2）。
   *
   * 未来年度官方日历尚未发布时，系统仍按经营空间每周默认模板允许报价，但必须
   * 明确提示「该年度官方日历尚未确认」——否则运营无法区分「按已确认官方日历报的价」
   * 与「按周模板兜底报的价」，而后续官方日历发布后不得反向改动这张已锁价报价。
   * 每个未确认年度一条；全部年度都有已发布官方日历时为空数组。
   */
  calendarWarnings: string[];
  appliedDiscountPlanIds: string[];
  /**
   * 每个候选优惠方案的评估结论（需求 4.4.10「报价必须展示已应用优惠、满足但因互斥
   * 未应用的优惠及原因」，以及「保存资格判断、优惠前金额、每项计算基数、优惠公式、
   * 实际减免金额和作用对象」）。
   *
   * 与 `appliedDiscountPlanIds` 并存而非替代：后者是「应用了哪些」的索引，
   * 这里是「每个候选为什么被应用或落选」的完整依据。客服要向客户解释
   * 「为什么用的是 A 券不是 B 券」时，只有这份记录能回答。
   */
  discountEvaluations: RentalQuoteDiscountEvaluation[];
  /**
   * MKT-02A：报价命中的增值服务快照（服务、价格、单位数、资格判据与条款正文）。
   *
   * 与 chargeLines 里的 `service:` 行并存：明细行只回答「收了多少」，
   * 快照回答「按哪一版服务与条款收的、凭什么资格可用、强制还是可选」。
   * 服务后续改价、改条款或停用都不得改变这张报价与由它下单的订单。
   */
  serviceSnapshots: RentalQuoteServiceSnapshot[];
  customerCouponId?: string;
  /** MKT-01B：报价时命中的客户券权益与计算结果，不回读可变模板。 */
  couponEvaluation?: RentalQuoteCouponEvaluation;
  /**
   * CORE-EXT-02D：报价生成时该经营空间**已启用能力**的版本快照。
   *
   * 存在的理由：capability 升级或改配置后，已发出的有效报价与由它下单的在途订单
   * 必须继续按**当时**的实现版本与配置版本校验和履约，不能被升级悄悄改写。
   * 因此这里固化每个已启用能力的 code、实现版本、配置版本与配置本体——
   * 下单时原样拷进订单，后续在途环节的 Hook 判定都用它，而不是当前实例。
   * 快照足以解释「这张单当时为什么这么放行/阻止/收费」，即使能力已被暂停或升级。
   */
  capabilitySnapshot?: RentalWorkspaceCapabilitySnapshotEntry[];
  /**
   * Review P1-5：报价阶段的 capability 判断记录。API 必须把它连同 warning 一起返回，
   * 否则「需转接环」这类风险虽被发现，用户却不知道要确认什么。
   */
  capabilityDecisions?: RentalCapabilityDecisionSnapshot[];
  expiresAt: string;
  createdAt: string;
  consumedAt?: string;
  consumedOrderId?: string;
}

/**
 * CORE-EXT-02D：报价 / 订单固化的单条能力版本快照。
 *
 * 与 `WorkspaceCapabilityInstance` 的区别：这是**不可变的历史事实**，只保留判定所需的
 * 版本与配置，不含 revision、时间戳等会随实例变动的字段。重建 Hook 执行名单时，
 * 由它构造出「状态恒为 enabled」的实例视图——在途订单不因能力被暂停而中断履约。
 */
export interface RentalWorkspaceCapabilitySnapshotEntry {
  code: RentalCapability;
  implementationVersion: string;
  configVersion: string;
  config: RentalCapabilityConfig;
}

/**
 * Review P1-5：一次 capability 判断的**不可变记录**，写进报价与订单。
 *
 * `capabilitySnapshot` 只回答「当时启用了哪些能力、什么版本」，回答不了
 * 「当时判成了什么、依据是什么」。缺了后者，报价发现的风险既返回不给用户，
 * 也无法在下单时被引用——运营只看到一个 201，不知道要确认什么。
 *
 * `id` 是下单时引用的凭据：下单侧只能引用报价里已有的判断，不得凭空重构一份。
 */
export interface RentalCapabilityDecisionSnapshot {
  id: string;
  point: RentalCapabilityHookPoint;
  capability: RentalCapability;
  implementationVersion: string;
  configVersion: string;
  /** 能力自报的规则集版本（与实现版本同源，但由能力在证据里给出，便于跨版本比对）。 */
  rulesetVersion?: string;
  decision: RentalCapabilityHookDecision;
  /** 风险代码集合。取自 blockReasons 与 notices 的 code，供程序判定与例外确认引用。 */
  riskCodes: string[];
  blockReasons: RentalCapabilityHookNotice[];
  notices: RentalCapabilityHookNotice[];
  feeBases: RentalCapabilityFeeBasis[];
  /** 判定当时的器材组合（商品级），供事后解释「基于什么组合得出这个结论」。 */
  equipment?: RentalCapabilityEquipmentLine[];
  at: string;
}

/**
 * Review P1-6：带风险继续的**完整例外快照**，写进订单。
 *
 * 早前只把确认压缩成一个风险代码集合，于是原因、确认人、权限与时间全部丢失，
 * 配货及后续履约也无从还原「这单的风险已经有人裁决过」。审计里只剩
 * `confirmed: true` 是不够的——那解释不了谁在什么依据下批准了它。
 */
export interface RentalCapabilityExceptionSnapshot {
  capability: RentalCapability;
  riskCode: string;
  reason: string;
  confirmedBy: string;
  /** 确认时依据的权限码。留痕是为了事后能核对「他当时确实有这个权限」。 */
  confirmedWithPermission: string;
  confirmedAt: string;
  /** 被确认的报价判断记录 id。空表示该风险不来自报价阶段（例如配货时才出现）。 */
  decisionId?: string;
  implementationVersion: string;
  configVersion: string;
  rulesetVersion?: string;
  equipment?: RentalCapabilityEquipmentLine[];
}

const commonSettingModules: RentalSettingModule[] = [
  "pricing",
  "discounts",
  "coupons",
  "value_added_services",
  "rental_rules",
  "business_calendar",
  "membership_rewards",
  "notification_templates"
];

/** 四品类共用的商品级风控标记；不设默认值，未分级的历史商品按 unclassified 处理。 */
const securityRiskAttribute = (): RentalAttributeDefinition => ({
  code: "securityRiskLevel",
  label: "商品风控等级",
  scope: "item_group",
  type: "select",
  options: [...RENTAL_SECURITY_RISK_LEVELS]
});

export const RENTAL_CATEGORY_DEFINITIONS: RentalCategoryDefinition[] = [
  {
    code: RentalCategoryCode.Camera,
    name: "摄影设备",
    description: "机身、镜头、三脚架、云台相机、运动相机与拍摄套装租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Quantity, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "usage_reading", "camera_compatibility", "camera_kit_handover", "inspection_care"],
    requiredCapabilities: [],
    terminology: { itemLabel: "器材", itemGroupLabel: "器材型号", assetLabel: "器材资产", fulfillmentLabel: "器材门店", pickupLabel: "取机", returnLabel: "还机", deliveryLabel: "配送到家", identifierLabel: "资产编号", serialLabel: "序列号", usageMetricLabel: "快门次数", navigationLabels: { inventoryGroup: "摄影器材", itemGroups: "器材型号", pricingGroups: "器材定价分组", assets: "器材资产与库存", locations: "器材门店" } },
    attributeSchema: { brand: "string", model: "string", equipmentType: "string", mount: "string", sensor: "string", securityRiskLevel: "string", serialNo: "string", shutterCount: "number" },
    businessModel: {
      // 摄影器材的基础租金按时间计价。快门次数等读数用于交接、养护和后续
      // 超量费用依据，不作为整件器材的基础租金单位；“整包”也不等于套装库存，
      // 套装仍按所选时间单位定价。
      pricingUnits: ["hour", "day_24h", "calendar_day", "week"],
      defaultPricingUnit: "day_24h",
      fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "locker_pickup_return", "delivery", "carrier_shipping"],
      locationTypes: ["store", "warehouse", "locker", "delivery_hub"],
      deliveryDestination: "customer_address",
      settingModules: [...commonSettingModules],
      assetFields: [
        securityRiskAttribute(),
        { code: "brand", label: "厂商", scope: "item_group", type: "string", required: true },
        { code: "model", label: "型号", scope: "item_group", type: "string", required: true },
        { code: "equipmentType", label: "器材子类型", scope: "item_group", type: "select", options: ["camera_body", "lens", "tripod", "gimbal_camera", "action_camera", "lighting", "other"] },
        { code: "mount", label: "卡口", scope: "item_group", type: "select", options: ["RF", "EF", "E", "Z", "L", "M43", "A", "其他"] },
        { code: "sensor", label: "传感器规格", scope: "item_group", type: "select", options: ["full_frame", "aps_c", "m43", "medium_format", "one_inch", "other"] },
        { code: "serialNo", label: "设备序列号", scope: "asset", type: "string", required: true, unique: true },
        { code: "shutterCount", label: "快门次数", scope: "transaction", type: "number", unit: "次" },
        { code: "conditionGrade", label: "成色等级", scope: "asset", type: "select", options: ["A", "B", "C"] },
        // CAM-01A：兼容性判定所需的规范化字段。兼容规则（卡口、画幅覆盖、供电）只能读
        // **已声明**的字段——动态字段校验会拒绝未定义的属性，因此这些字段必须登记在品类里，
        // 运营才能填、能力才能判。它们只描述器材本身，不含任何判定逻辑。
        { code: "role", label: "器材角色", scope: "item_group", type: "select", options: ["body", "lens", "power", "storage", "accessory", "battery", "charger", "monitor"] },
        { code: "sensorFormat", label: "画幅（规范化）", scope: "item_group", type: "select", options: ["m43", "aps_c", "full_frame", "medium_format"] },
        { code: "coversFormat", label: "镜头像场覆盖", scope: "item_group", type: "select", options: ["m43", "aps_c", "full_frame", "medium_format"] },
        { code: "powerDrawW", label: "峰值功耗", scope: "item_group", type: "number", unit: "W" },
        { code: "powerSupplyW", label: "供电额定", scope: "item_group", type: "number", unit: "W" },
        // 多对多兼容关系进入 camera_compatibility 的结构化、版本化配置；
        // 商品字段只保留器材自身的单值物理属性，不再用逗号字符串伪装关系表。
        { code: "batteryModel", label: "电池型号", scope: "item_group", type: "string" },
        { code: "storageType", label: "存储卡介质", scope: "item_group", type: "select", options: ["sd", "sdxc", "cfexpress_a", "cfexpress_b", "cfast", "xqd", "microsd"] },
        { code: "accessoryKind", label: "配件类型", scope: "item_group", type: "select", options: ["stabilizer", "flash", "cage", "other"] },
        { code: "maxPayloadG", label: "稳定器最大载重", scope: "item_group", type: "number", unit: "g" },
        { code: "weightG", label: "自重", scope: "item_group", type: "number", unit: "g" },
        { code: "shoeType", label: "热靴类型", scope: "item_group", type: "string" },
        // 资产级覆盖（Review P1-8）：同一商品组下个别资产的实际差异（改装、配件缺失、
        // 型号小改款）必须能在资产上登记，配货阶段按**实际挑中的资产**判定时才看得见。
        { code: "assetMountOverride", label: "资产实际卡口（覆盖商品组）", scope: "asset", type: "string" },
        { code: "assetPowerDrawW", label: "资产实际峰值功耗（覆盖商品组）", scope: "asset", type: "number", unit: "W" }
      ],
      supportsHolidayPricing: true,
      supportsUsagePricing: false,
      supportsPreauthorization: true,
      supportsQualificationReview: false,
      valueAddedServicePresets: ["损坏免赔", "设备保险", "上门配送", "备用电池", "技术支持"],
      defaults: {
        fulfillment: { allowDifferentReturnLocation: false },
        payment: { timing: "order" },
        overdue: { graceMinutes: 30, feeMode: "next_period", feeMultiplier: 1 },
        rules: { evidenceRequired: true, cancellation: { freeBeforeHours: 24, lateFeeType: "percentage", lateFeeValue: 20, weatherExceptionEnabled: false }, qualificationDocumentTypes: [] },
        initialSetup: { operatorName: "演示摄影器材行", locationName: "中心器材门店", locationType: "store" },
        inspectionFields: [
          { code: "appearance_ok", label: "外观完好", type: "boolean", required: true },
          { code: "function_ok", label: "功能正常", type: "boolean", required: true },
          // CAM-01B：套装清点是可选字段而不是全摄影订单的硬必填项；Hook 只在
          // 本单确实包含 bundle 且操作员明确填了“不齐”时阻断，兼容旧模板与非套装订单。
          { code: "kit_complete", label: "套装附件齐全", type: "boolean", required: false },
          // 镜头、三脚架、云台/运动相机不一定有机械快门读数。
          { code: "shutter_count", label: "快门次数（适用机型）", type: "number", required: false, unit: "次", usageMetric: true }
        ],
        sampleBaseAmount: 180,
        sampleAmountIncrement: 80
      }
    },
    version: "0.4.0"
  },
  {
    code: RentalCategoryCode.Camping,
    name: "露营设备",
    description: "帐篷、桌椅、炊具和露营套装租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Quantity, RentalInventoryMode.Consumable, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "camping_kit_integrity", "camping_cleaning_turnaround"],
    requiredCapabilities: [],
    terminology: { itemLabel: "装备", itemGroupLabel: "装备型号", assetLabel: "装备资产", fulfillmentLabel: "装备仓", pickupLabel: "领用", returnLabel: "归还", deliveryLabel: "配送到家", identifierLabel: "装备编号", serialLabel: "批次号", navigationLabels: { inventoryGroup: "户外装备", itemGroups: "装备型号", pricingGroups: "装备定价分组", assets: "装备资产与库存", locations: "装备仓库" } },
    attributeSchema: { brand: "string", model: "string", people: "number", season: "string", material: "string", dimensions: "string", capacity: "number", securityRiskLevel: "string", batchNo: "string" },
    businessModel: {
      // 露营装备按占用日期或夜晚计价；套装是库存/商品形态，不是脱离租期的
      // “整包一次价”，因此不在基础计价单位里暴露 package。
      pricingUnits: ["calendar_day", "night", "week"],
      defaultPricingUnit: "calendar_day",
      fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "warehouse_pickup_return", "delivery", "carrier_shipping"],
      locationTypes: ["store", "warehouse", "delivery_hub"],
      deliveryDestination: "customer_address",
      settingModules: [...commonSettingModules],
      assetFields: [
        securityRiskAttribute(),
        { code: "brand", label: "品牌", scope: "item_group", type: "string", required: true },
        { code: "model", label: "型号", scope: "item_group", type: "string" },
        { code: "people", label: "适用人数", scope: "item_group", type: "number", unit: "人" },
        { code: "season", label: "季节规格", scope: "item_group", type: "select", options: ["三季", "四季"] },
        { code: "material", label: "材质", scope: "item_group", type: "string" },
        { code: "dimensions", label: "展开尺寸", scope: "item_group", type: "string" },
        { code: "capacity", label: "容量", scope: "item_group", type: "number", unit: "L" },
        { code: "batchNo", label: "批次号", scope: "asset", type: "string", unique: true },
        { code: "cleaningStatus", label: "清洁状态", scope: "transaction", type: "select", options: ["clean", "needs_cleaning", "damaged"] }
      ],
      supportsHolidayPricing: true,
      supportsUsagePricing: false,
      supportsPreauthorization: false,
      supportsQualificationReview: false,
      valueAddedServicePresets: ["清洁服务", "配送服务", "天气保障", "耗材包"],
      defaults: {
        fulfillment: { allowDifferentReturnLocation: false },
        payment: { timing: "order" },
        overdue: { graceMinutes: 30, feeMode: "next_period", feeMultiplier: 1 },
        rules: { evidenceRequired: false, cancellation: { freeBeforeHours: 24, lateFeeType: "percentage", lateFeeValue: 10, weatherExceptionEnabled: false }, qualificationDocumentTypes: [] },
        initialSetup: { operatorName: "演示露营装备中心", locationName: "中心装备仓", locationType: "warehouse" },
        inspectionFields: [
          { code: "count_ok", label: "数量齐全", type: "boolean", required: true },
          { code: "cleanliness", label: "清洁状态", type: "select", required: true, options: ["良好", "需清洁", "严重污损"] },
          { code: "damage_note", label: "破损说明", type: "text", required: false }
        ],
        sampleBaseAmount: 80,
        sampleAmountIncrement: 20
      }
    },
    version: "0.4.0"
  },
  {
    code: RentalCategoryCode.Vehicle,
    name: "车辆载具",
    description: "汽车、摩托车和其他载具租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized],
    defaultCapabilities: ["serialized_inventory", "pickup", "return", "delivery", "dispatch", "usage_reading", "qualification", "iot", "inspection_care", "vehicle_relocation"],
    requiredCapabilities: [],
    terminology: { itemLabel: "车辆", itemGroupLabel: "车辆型号", assetLabel: "车辆", fulfillmentLabel: "门店", pickupLabel: "取车", returnLabel: "还车", deliveryLabel: "送车到点", identifierLabel: "车辆编号", serialLabel: "车架号", usageMetricLabel: "里程", assetCollectionLabel: "车队", navigationLabels: { inventoryGroup: "车辆型号与车队", itemGroups: "厂牌车型管理", pricingGroups: "车辆定价分组", assets: "车辆管理", locations: "门店管理" } },
    attributeSchema: { manufacturer: "string", brand: "string", model: "string", trim: "string", modelYear: "number", seats: "number", transmission: "string", energyType: "string", securityRiskLevel: "string", licensePlate: "string", vin: "string", color: "string", firstRegistrationDate: "date", insuranceExpiry: "date", inspectionExpiry: "date", mileage: "number" },
    businessModel: {
      // 车辆可按时间或里程等使用量计价；车组/车型组合不使用“整包一次价”。
      pricingUnits: ["hour", "day_24h", "calendar_day", "week", "month", "usage"],
      defaultPricingUnit: "day_24h",
      fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "delivery"],
      locationTypes: ["store", "station", "warehouse", "delivery_hub"],
      deliveryDestination: "tenant_location",
      settingModules: [...commonSettingModules],
      assetFields: [
        securityRiskAttribute(),
        { code: "manufacturer", label: "制造商", scope: "item_group", type: "string", required: true },
        { code: "brand", label: "品牌", scope: "item_group", type: "string", required: true },
        { code: "model", label: "车系 / 车型", scope: "item_group", type: "string", required: true },
        { code: "trim", label: "具体款型", scope: "item_group", type: "string" },
        { code: "modelYear", label: "年款", scope: "item_group", type: "number" },
        { code: "seats", label: "座位数", scope: "item_group", type: "number", unit: "座" },
        { code: "transmission", label: "变速方式", scope: "item_group", type: "select", options: ["自动", "手动", "其他"] },
        { code: "energyType", label: "能源类型", scope: "item_group", type: "select", options: ["燃油", "纯电", "混动", "其他"] },
        { code: "licensePlate", label: "车牌号", scope: "asset", type: "string", required: true, unique: true },
        { code: "vin", label: "VIN（车辆识别代号）", scope: "asset", type: "string", required: true, unique: true },
        { code: "color", label: "车身颜色", scope: "asset", type: "select", options: ["黑", "白", "银", "灰", "红", "蓝", "其他"] },
        { code: "firstRegistrationDate", label: "首次登记日期", scope: "asset", type: "date" },
        { code: "insuranceExpiry", label: "保险有效期至", scope: "asset", type: "date" },
        { code: "inspectionExpiry", label: "年检有效期至", scope: "asset", type: "date" },
        { code: "mileage", label: "里程", scope: "transaction", type: "number", unit: "km" },
        { code: "energyLevel", label: "油量/电量", scope: "transaction", type: "number", unit: "%" }
      ],
      catalogPresentation: {
        itemGroupDescription: "维护厂商发布的车辆型号主档，例如宝马 3 系 325Li、奔驰 C 级 C260L。舒适轿车组、城市 SUV 组属于车辆定价分组，不在这里建立。",
        itemGroupCodeLabel: "型号编码",
        itemGroupNameLabel: "车型显示名称",
        itemGroupNamePlaceholder: "如：荣威 D7 标准版",
        fixedInventoryMode: RentalInventoryMode.Serialized,
        fixedUnit: "辆",
        itemGroupSummaryFields: ["manufacturer", "brand", "model", "trim", "modelYear", "energyType"],
        assetDescription: "每条记录代表一辆具体车辆。先选择车辆型号，再登记车辆编号、车牌、VIN、所在门店和当前状态。",
        assetSummaryFields: ["licensePlate", "vin", "color"]
      },
      supportsHolidayPricing: true,
      supportsUsagePricing: true,
      supportsPreauthorization: true,
      supportsQualificationReview: true,
      valueAddedServicePresets: ["基础保险", "不计免赔", "道路救援", "儿童座椅", "异地还车"],
      defaults: {
        fulfillment: { allowDifferentReturnLocation: true },
        payment: { timing: "order" },
        overdue: { graceMinutes: 30, feeMode: "next_period", feeMultiplier: 1 },
        rules: { evidenceRequired: true, cancellation: { freeBeforeHours: 24, lateFeeType: "percentage", lateFeeValue: 20, weatherExceptionEnabled: false }, qualificationDocumentTypes: ["驾驶证"] },
        initialSetup: { operatorName: "演示车辆租赁门店", locationName: "中心车行门店", locationType: "store" },
        inspectionFields: [
          { code: "appearance_ok", label: "外观完好", type: "boolean", required: true },
          { code: "function_ok", label: "功能正常", type: "boolean", required: true },
          { code: "usage_reading", label: "里程", type: "number", required: false, unit: "km", usageMetric: true }
        ],
        sampleBaseAmount: 380,
        sampleAmountIncrement: 100
      }
    },
    version: "0.5.0"
  },
  {
    code: RentalCategoryCode.Construction,
    name: "工程设备",
    description: "工程机械、工具和配套设备租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Quantity, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "dispatch", "usage_reading", "qualification", "iot", "inspection_care", "construction_transport"],
    requiredCapabilities: [],
    terminology: { itemLabel: "设备", itemGroupLabel: "设备型号", assetLabel: "设备资产", fulfillmentLabel: "设备仓", pickupLabel: "出库", returnLabel: "入库", deliveryLabel: "送达工地", identifierLabel: "设备编号", serialLabel: "序列号", usageMetricLabel: "工时", navigationLabels: { inventoryGroup: "工程设备", itemGroups: "设备型号", pricingGroups: "设备定价分组", assets: "设备台账与库存", locations: "设备仓库" } },
    attributeSchema: { manufacturer: "string", brand: "string", model: "string", power: "string", ratedLoad: "number", ratedLoadUnit: "string", securityRiskLevel: "string", factoryNo: "string", inspectionExpiry: "date", hourMeter: "number" },
    businessModel: {
      // 工程设备支持小时、班次、长期和工时等使用量计价；附件、操作员和运输
      // 组合应由增值服务/定价分组表达，不使用含义不清的“整包一次价”。
      pricingUnits: ["hour", "shift", "calendar_day", "week", "month", "usage"],
      defaultPricingUnit: "shift",
      fulfillmentModes: ["warehouse_pickup_return", "delivery", "onsite_delivery", "partner_pickup_return"],
      locationTypes: ["warehouse", "delivery_hub", "project_site"],
      deliveryDestination: "customer_address",
      settingModules: [...commonSettingModules],
      assetFields: [
        securityRiskAttribute(),
        { code: "manufacturer", label: "制造商", scope: "item_group", type: "string", required: true },
        { code: "brand", label: "品牌", scope: "item_group", type: "string" },
        { code: "model", label: "型号", scope: "item_group", type: "string", required: true },
        { code: "power", label: "功率", scope: "item_group", type: "string" },
        { code: "ratedLoad", label: "额定载荷", scope: "item_group", type: "number" },
        { code: "ratedLoadUnit", label: "额定载荷单位", scope: "item_group", type: "select", options: ["kg", "t"] },
        { code: "factoryNo", label: "出厂编号", scope: "asset", type: "string", required: true, unique: true },
        { code: "inspectionExpiry", label: "检验有效期", scope: "asset", type: "date" },
        { code: "hourMeter", label: "累计工时", scope: "transaction", type: "number", unit: "小时" }
      ],
      supportsHolidayPricing: true,
      supportsUsagePricing: true,
      supportsPreauthorization: true,
      supportsQualificationReview: true,
      valueAddedServicePresets: ["设备保险", "操作员服务", "运输服务", "现场技术支持", "损坏免赔"],
      defaults: {
        fulfillment: { allowDifferentReturnLocation: false },
        payment: { timing: "confirmation" },
        overdue: { graceMinutes: 60, feeMode: "manual_review", feeMultiplier: 1 },
        rules: { evidenceRequired: true, cancellation: { freeBeforeHours: 48, lateFeeType: "percentage", lateFeeValue: 20, weatherExceptionEnabled: false }, qualificationDocumentTypes: ["操作资格证"] },
        initialSetup: { operatorName: "演示工程设备中心", locationName: "中心设备场站", locationType: "project_site" },
        inspectionFields: [
          { code: "appearance_ok", label: "外观完好", type: "boolean", required: true },
          { code: "function_ok", label: "功能正常", type: "boolean", required: true },
          { code: "usage_reading", label: "工时", type: "number", required: false, unit: "小时", usageMetric: true }
        ],
        sampleBaseAmount: 680,
        sampleAmountIncrement: 180
      }
    },
    version: "0.4.0"
  }
];

export interface SaveTenantRentalProfileRequest {
  categoryCode: RentalCategoryCode;
  capabilities?: RentalCapability[];
  terminology?: Partial<RentalCategoryTerminology>;
  operator?: string;
}

export interface RentalFulfillmentLocation {
  id: string;
  tenantId: string;
  organizationId?: string;
  code: string;
  name: string;
  type: RentalLocationType;
  operatorId?: string;
  operatorType?: "self_operated" | "partner";
  operatorName?: string;
  parentLocationId?: string;
  capabilities: Array<"pickup" | "return" | "storage" | "delivery">;
  address?: string;
  /** 行政区划主数据（选填）：便于按地区检索与展示，不参与业务判定。 */
  province?: string;
  city?: string;
  district?: string;
  /** 门店时区（选填），录入端默认 Asia/Shanghai。 */
  timezone?: string;
  /** 门店坐标（WGS84/GCJ02 由录入端约定）；用于客户端按位置排序与地图导航。 */
  latitude?: number;
  longitude?: number;
  contactName?: string;
  contactPhone?: string;
  businessHours?: string;
  status: "enabled" | "disabled";
}

export interface SaveRentalFulfillmentLocationRequest {
  id?: string;
  organizationId?: string | null;
  code: string;
  name: string;
  type: RentalLocationType;
  operatorId?: string;
  operatorType?: "self_operated" | "partner";
  operatorName?: string;
  parentLocationId?: string;
  capabilities: Array<"pickup" | "return" | "storage" | "delivery">;
  address?: string;
  province?: string;
  city?: string;
  district?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  contactName?: string;
  contactPhone?: string;
  businessHours?: string;
  status?: "enabled" | "disabled";
}

export interface RentalFulfillmentOperator {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: "self_operated" | "partner";
  contactName?: string;
  contactPhone?: string;
  settlementMode?: "self" | "monthly" | "per_order";
  status: "enabled" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface RentalFulfillmentLocationSnapshot {
  id: string;
  code: string;
  name: string;
  type: RentalLocationType;
  capabilities: Array<"pickup" | "return" | "storage" | "delivery">;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  businessHours?: string;
  operator: {
    id: string;
    code: string;
    name: string;
    type: "self_operated" | "partner";
    settlementMode?: "self" | "monthly" | "per_order";
  };
}

export interface SaveRentalFulfillmentOperatorRequest {
  id?: string;
  code: string;
  name: string;
  type: "self_operated" | "partner";
  contactName?: string;
  contactPhone?: string;
  settlementMode?: "self" | "monthly" | "per_order";
  status?: "enabled" | "disabled";
}

export interface RentalBundleComponent {
  itemGroupId: string;
  itemGroupCode: string;
  itemGroupName: string;
  quantity: number;
  optional?: boolean;
  substitutionGroup?: string;
}

export interface RentalItemGroup {
  id: string;
  tenantId: string;
  categoryCode: RentalCategoryCode;
  code: string;
  name: string;
  inventoryMode: RentalInventoryMode;
  unit: string;
  description?: string;
  attributes: Record<string, unknown>;
  /** 产品型号主档图片；第一张或 `isCover=true` 的图片作为列表封面。 */
  images?: RentalItemGroupImage[];
  bundleComponents: RentalBundleComponent[];
  status: "enabled" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface RentalItemGroupImage {
  id: string;
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | string;
  sizeBytes: number;
  isCover: boolean;
  /** 鉴权图片地址；客户端应使用当前运营会话读取，不得拼接本地存储路径。 */
  url: string;
}

/**
 * 面向客户销售与定价的分组。产品型号保存规格，资产保存实体；定价分组只保存
 * “哪些型号可以承接这档商品”。同一型号可加入多个分组，库存仍只在型号层维护。
 */
export interface RentalPricingGroup {
  id: string;
  tenantId: string;
  categoryCode: RentalCategoryCode;
  code: string;
  name: string;
  description?: string;
  defaultPricingUnit?: RentalPricingUnit;
  memberItemGroupIds: string[];
  members: Array<Pick<RentalItemGroup, "id" | "code" | "name" | "inventoryMode" | "unit" | "status">>;
  status: "enabled" | "disabled";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RentalPricingGroupInitialRate {
  unit: RentalPricingUnit;
  baseAmount: number;
  /** 固定押金模式下的每件押金；仅当前已生效规则要求时必填。 */
  depositAmount?: number;
  /** 押金租金倍数模式下的倍数；仅当前已生效规则要求时必填。 */
  depositMultiple?: number;
  /** 固定预授权模式的每件冻结额度；不与实收押金混为同一资金。 */
  preAuthAmount?: number;
  /** 预授权租金倍数/风险附加模式下的倍数。 */
  preAuthMultiple?: number;
  /** 以下字段仅用于 unit=usage；时间租赁不在新建分组时配置阶梯规则。 */
  includedUsage?: number;
  excessUsageAmount?: number;
  usagePrecision?: 0 | 1 | 2;
  tierMode?: "progressive";
  tiers?: RentalPricingTier[];
  maxAmount?: number;
}

/** 仅修改当前定价组各计价单位的押金/预授权费率，不允许改基本租金。 */
export interface RentalPricingGroupSecurityRateOverride {
  unit: RentalPricingUnit;
  depositAmount?: number;
  depositMultiple?: number;
  preAuthAmount?: number;
  preAuthMultiple?: number;
}

export interface UpdateRentalPricingGroupSecurityRatesRequest {
  rates: RentalPricingGroupSecurityRateOverride[];
}

export interface SaveRentalPricingGroupRequest {
  id?: string;
  code: string;
  name: string;
  description?: string;
  defaultPricingUnit?: RentalPricingUnit;
  /**
   * 新建分组时必须同时提交至少一条基本价。常规时间租赁只配置“计价单位 + 价格”；
   * 使用量单位必须在此配置包含量、精度与超额价格（或累进阶梯），避免生成不可报价的费率。
   */
  initialRates?: RentalPricingGroupInitialRate[];
  memberItemGroupIds: string[];
  status?: "enabled" | "disabled";
}

export interface SaveRentalItemGroupRequest {
  id?: string;
  code: string;
  name: string;
  inventoryMode: RentalInventoryMode;
  unit?: string;
  description?: string;
  attributes?: Record<string, unknown>;
  bundleComponents?: Array<Pick<RentalBundleComponent, "itemGroupId" | "quantity" | "optional" | "substitutionGroup">>;
  status?: "enabled" | "disabled";
  operator?: string;
}

export interface RentalAsset {
  id: string;
  tenantId: string;
  itemGroupId: string;
  itemGroupCode: string;
  itemGroupName: string;
  assetNo: string;
  serialNo?: string;
  locationId: string;
  locationName: string;
  status: RentalAssetStatus;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SaveRentalAssetRequest {
  id?: string;
  itemGroupId: string;
  assetNo: string;
  serialNo?: string;
  locationId: string;
  status?: RentalAssetStatus;
  attributes?: Record<string, unknown>;
  operator?: string;
}

/** STOCK-OPS-01：序列化资产状态只追加历史，不用当前状态快照冒充过去事实。 */
export type RentalAssetStatusHistorySource = "onboarding" | "manual" | "order" | "disposition";

export interface RentalAssetStatusHistory {
  id: string;
  tenantId: string;
  workspaceId: string;
  assetId: string;
  assetNo: string;
  fromStatus?: RentalAssetStatus;
  toStatus: RentalAssetStatus;
  source: RentalAssetStatusHistorySource;
  sourceId?: string;
  reason: string;
  operator: string;
  createdAt: string;
}

export interface RentalStockBalance {
  id: string;
  tenantId: string;
  itemGroupId: string;
  itemGroupCode: string;
  itemGroupName: string;
  locationId: string;
  locationName: string;
  onHandQuantity: number;
  reservedQuantity: number;
  maintenanceQuantity: number;
  availableQuantity: number;
  updatedAt: string;
}

export interface SaveRentalStockBalanceRequest {
  itemGroupId: string;
  locationId: string;
  onHandQuantity: number;
  maintenanceQuantity?: number;
  operator?: string;
}

/** STOCK-OPS-01：数量与一次性耗材库存的可审计日常作业。余额是当前快照，流水才是调整来源。 */
export const RENTAL_STOCK_OPERATION_TYPES = ["receive", "count_adjustment", "transfer", "consume", "scrap", "retire"] as const;
export type RentalStockOperationType = (typeof RENTAL_STOCK_OPERATION_TYPES)[number];
/** 内部租赁归还和维修隔离流水，不开放为管理端任意库存作业。 */
export type RentalStockLedgerOperationType = RentalStockOperationType | "return_transfer" | "maintenance_quarantine" | "maintenance_release" | "maintenance_write_off";

export interface RentalStockLedgerEntry {
  id: string;
  tenantId: string;
  workspaceId: string;
  operationId: string;
  entryKind: "single" | "out" | "in";
  operationType: RentalStockLedgerOperationType;
  itemGroupId: string;
  itemGroupCode: string;
  itemGroupName: string;
  locationId: string;
  locationName: string;
  quantityDelta: number;
  onHandBefore: number;
  onHandAfter: number;
  /** 维修隔离数量变化；历史/普通库存流水为 0。 */
  maintenanceDelta: number;
  reservedQuantity: number;
  maintenanceQuantity: number;
  reason: string;
  /** 外部批次或本次库存作业批次，不能替代幂等键。 */
  batchNo?: string;
  /** 外部入库单、盘点单、调拨单或审批单号。 */
  sourceDocumentNo?: string;
  sourceOrderId?: string;
  sourceInspectionId?: string;
  sourceDispositionId?: string;
  idempotencyKey: string;
  operator: string;
  createdAt: string;
}

export interface RentalStockOperationRequest {
  type: RentalStockOperationType;
  itemGroupId: string;
  locationId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  quantity?: number;
  actualOnHandQuantity?: number;
  reason: string;
  batchNo?: string;
  sourceDocumentNo?: string;
  idempotencyKey: string;
  operator?: string;
}

export interface RentalStockOperationResult {
  operationId: string;
  operationType: RentalStockOperationType;
  idempotent: boolean;
  entries: RentalStockLedgerEntry[];
  balances: RentalStockBalance[];
}

/** STOCK-CLOSE-01 / SHARED-WORK-01A：归还后库存处置与养护工单的统一事实契约。 */
export const RENTAL_WORK_ORDER_TYPES = ["cleaning", "restock", "calibration", "repair"] as const;
export type RentalWorkOrderType = (typeof RENTAL_WORK_ORDER_TYPES)[number];
export const RENTAL_WORK_ORDER_STATUSES = ["pending", "in_progress", "pending_review", "completed", "rejected", "cancelled"] as const;
export type RentalWorkOrderStatus = (typeof RENTAL_WORK_ORDER_STATUSES)[number];

export interface RentalStockDisposition {
  id: string;
  tenantId: string;
  workspaceId: string;
  orderId: string;
  inspectionId?: string;
  returnBatchKey: string;
  dedupeKey: string;
  itemGroupId: string;
  locationId: string;
  assetId?: string;
  quantity: number;
  receivedAt: string;
  bufferUntil: string;
  status: "buffered" | "blocked" | "restored" | "written_off";
  blockReason?: string;
  restoredQuantity: number;
  restoredAt?: string;
  restoredBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WriteOffRentalStockDispositionRequest {
  reason: string;
}

export interface RentalWorkOrder {
  id: string;
  tenantId: string;
  workspaceId: string;
  workNo: string;
  type: RentalWorkOrderType;
  status: RentalWorkOrderStatus;
  dispositionId?: string;
  orderId?: string;
  inspectionId?: string;
  itemGroupId: string;
  locationId: string;
  assetId?: string;
  quantity: number;
  assigneeId?: string;
  assigneeName?: string;
  reason: string;
  result?: string;
  attachments: string[];
  startedAt?: string;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewReason?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RentalWorkOrderAssignee {
  id: string;
  account: string;
  displayName: string;
}

export interface RentalWorkOrderHistoryEntry {
  id: string;
  action: string;
  operator: string;
  detail: string;
  createdAt: string;
}

export interface CreateRentalWorkOrderRequest {
  dispositionId: string;
  type: RentalWorkOrderType;
  assigneeId?: string;
  reason?: string;
}

export interface AssignRentalWorkOrderRequest {
  /** 只能选择当前经营空间启用的运营账号；省略表示清除派工。 */
  assigneeId?: string;
}

export interface SubmitRentalWorkOrderRequest {
  result: string;
  attachments?: string[];
}

export interface ReviewRentalWorkOrderRequest {
  decision: "approved" | "rejected";
  reason: string;
}

export interface CancelRentalWorkOrderRequest {
  reason: string;
}

export interface RentalAvailabilityRequest {
  locationId: string;
  startAt: string;
  endAt: string;
  lines: Array<{ itemGroupId: string; quantity: number }>;
}

export interface RentalAvailabilityLine {
  itemGroupId: string;
  itemGroupCode: string;
  itemGroupName: string;
  inventoryMode: RentalInventoryMode;
  requestedQuantity: number;
  availableQuantity: number;
  available: boolean;
  reasons: string[];
}

export interface RentalAvailabilityResult {
  available: boolean;
  locationId: string;
  startAt: string;
  endAt: string;
  lines: RentalAvailabilityLine[];
}

export interface CreateRentalOrderRequest {
  quoteId: string;
  customerType: "personal" | "corporate";
  customerId?: string;
  /** 必须与报价请求一致；服务端重新解析后覆盖客户端主体字段。 */
  bookingIdentity?: RentalBookingIdentityInput;
  customerName: string;
  contactPhone?: string;
  /**
   * CUSTOMER-01C：订单四类主体的选择（需求 4.8.4）。
   *
   * 省略即回落为「签约/付款/使用人都是下单客户本人」——既有下单路径与存量订单
   * 都是这个语义，因此本字段是**纯附加**，不改变任何现有调用方的行为。
   * 企业订单可据此显式区分总部付款、分公司签约、司机使用、行政经办。
   */
  subjects?: CustomerOrderSubjectInput;
  qualificationApproved?: boolean;
  qualificationValidTo?: string;
  fulfillmentMode: RentalFulfillmentMode;
  fulfillmentLocationId: string;
  returnLocationId?: string;
  startAt: string;
  endAt: string;
  lines: Array<{
    itemGroupId: string;
    pricingGroupId?: string;
    quantity: number;
    note?: string;
  }>;
  /**
   * CAM-01A：对能力**风险提示（warn）**的例外确认。
   *
   * 风险组合（如非原生卡口需转接环）默认在下单时被阻止；只有携带带原因的确认，
   * 且提交者具备确认权限（由控制器校验），才允许带风险下单，并把确认记入审计。
   * 不兼容组合（block）不可确认——无论是否带确认都必须被服务端拒绝。
   */
  capabilityExceptions?: Array<{
    capability: RentalCapability;
    code: string;
    reason: string;
    /**
     * Review P1-6：被确认的报价判断记录 id（`RentalQuoteSnapshotV1.capabilityDecisions[].id`）。
     *
     * 要求提交它是为了让确认**指向报价里真实存在的那条判断**，而不是凭空声明一个风险代码。
     * 缺省时服务端按「能力 + 风险代码」在报价判断里回查；查不到则该确认不作数。
     */
    decisionId?: string;
    /**
     * 以下三项由**服务端控制器**补齐，客户端提交无效（会被 whitelist 剥离）。
     * 它们只有鉴权上下文知道，让客户端自报等于允许伪造确认人与权限。
     */
    confirmedBy?: string;
    confirmedWithPermission?: string;
    confirmedAt?: string;
  }>;
  operator?: string;
}

/**
 * CAM-01A：传给能力 Hook 的**已解析器材行**（通用富化，非摄影专属）。
 *
 * 报价/订单的原始行只有 itemGroupId + quantity；能力要判定兼容性必须看到器材的
 * 卡口、画幅、供电、存储、接口等属性。Core 把这些属性解析后随 subject 一并传入——
 * 这是与品类无关的数据透传（「本次涉及哪些商品、各自属性是什么」），
 * 不是在 Core 里写摄影逻辑。
 */
export interface RentalCapabilityEquipmentLine {
  itemGroupId: string;
  itemGroupName: string;
  inventoryMode: RentalInventoryMode;
  quantity: number;
  /**
   * Review P1-8：配货阶段的**实际资产**标识。
   *
   * 报价阶段按商品组判定，此时没有这两个字段；配货阶段按真正挑中的资产判定，
   * 必须带上它们——否则事后无法解释「当时判的是哪一台机身、哪一支镜头」，
   * 同商品组下资产属性存在差异时也无从追溯。
   */
  assetId?: string;
  assetNo?: string;
  attributes: Record<string, unknown>;
}

export interface CancelRentalOrderRequest {
  reason: string;
  weatherException?: boolean;
}

export interface RentalOrderLine {
  id: string;
  pricingGroupId?: string;
  pricingGroupCode?: string;
  pricingGroupName?: string;
  /** 报价时客户选择的预约精度；旧订单未设置时沿用组内分配语义。 */
  reservationPrecision?: "group" | "exact_model";
  /** 下单时的成员范围；之后修改分组不会改写历史订单。 */
  pricingGroupMemberItemGroupIds?: string[];
  itemGroupId: string;
  itemGroupCode: string;
  itemGroupName: string;
  inventoryMode: RentalInventoryMode;
  quantity: number;
  /** 订单变更已取消的数量。原始数量、价格与金额保留不改，活动数量 = quantity - cancelledQuantity。 */
  cancelledQuantity?: number;
  unitPrice: number;
  amount: number;
  note?: string;
}

export interface RentalReservation {
  id: string;
  orderId: string;
  orderLineId: string;
  itemGroupId: string;
  locationId: string;
  quantity: number;
  releasedQuantity: number;
  status: RentalReservationStatus;
  expiresAt?: string;
  createdAt: string;
}

/**
 * 费用审核单（需求 4.6.10 的人工催收、4.6.8 的人工审核退款）。
 *
 * 规则选了「人工审核」时，金额照样按快照算出来，但**不得直接落账**——落多少由催收
 * 或减免的结论决定。此前这两条路径一个直接返回 0、一个直接跳过，结果是逾期费被静默
 * 免除、退款被静默丢弃，运营侧连一条待办都看不到，订单还能照常结清。
 *
 * 因此这张单必须同时具备三件事：建议金额与依据（能解释）、审核结果与认定金额
 * （能追溯），以及**阻止结清**的能力（未处理不许关单）。
 */
export interface RentalOrderFeeReview {
  id: string;
  /**
   * 逾期、提前归还退款、增值服务未履约退款，以及取消/爽约后遗留资金的退款审核。
   *
   * `refund_due`：订单取消或确认爽约时仍持有押金、预授权冻结或多收的租金。
   * 这张单**不动账**——批准只表示退款/释放已获认可，实际资金动作仍由资金区按权限单独办理。
   */
  type: "overdue" | "early_return_refund" | "service_refund" | "refund_due" | "carrier_rental_refund";
  /** 服务退款审核对应的服务发生项；逾时审核时可记录归还批次，其他类型为空。 */
  sourceId?: string;
  /** 规则算出的建议金额；null 表示尚待核定，绝不表示零。退款类落账时取负。 */
  suggestedAmount: number | null;
  /** 金额待核定的租金退款，服务端冻结的最大应收核减额；批准须显式填认定额。 */
  maximumAmount?: number;
  /** 逐条依据：应归还/实际归还时间、规则模式与金额构成。客服据此向客户解释。 */
  basis: string[];
  status: "pending" | "approved" | "rejected";
  /** 审核认定额。已知建议可缺省；建议为null必须显式填数（含零），且不超过原快照上限。 */
  decidedAmount?: number;
  reason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

/**
 * R1 运营工作台的统一待办。
 *
 * 这里聚合的是“当前确实有下一步操作”的事实，不把通知模拟发送成功、
 * 已处理的历史记录或仅供查看的状态混进来。链接只指向现有订单/工单详情，
 * 不在待办层复制一套业务动作。
 */
export type RentalWorkbenchTodoType =
  | "pending_payment"
  | "no_show_notice"
  | "no_show_confirmation"
  | "return_overdue"
  | "fee_review"
  | "refund"
  | "work_order"
  | "offline_payment_pending"
  /** NOTICE-01：业务事件通知未成功写入模拟发送记录，需要运营处理。 */
  | "notification_failure"
  /** 取消/爽约后仍持有押金、预授权或多收租金，待裁定 `refund_due` 审核后办理退款。 */
  | "cancelled_refund_due";

export interface RentalWorkbenchTodo {
  id: string;
  type: RentalWorkbenchTodoType;
  priority: "high" | "normal";
  title: string;
  description: string;
  href: string;
  orderId?: string;
  orderNo?: string;
  workOrderId?: string;
  amount?: number;
  createdAt: string;
}

export interface RentalWorkbenchTodos {
  generatedAt: string;
  counts: Record<RentalWorkbenchTodoType, number>;
  items: RentalWorkbenchTodo[];
}

export interface RentalAllocation {
  id: string;
  orderId: string;
  orderLineId: string;
  /** 套装拆分后的实际组成商品；历史分配可能为空。 */
  itemGroupId?: string;
  assetId?: string;
  assetNo?: string;
  quantity: number;
  /** allocated 为历史已配货记录，按已锁定处理。 */
  status: "pre_assigned" | "locked" | "allocated" | "picked_up" | "consumed" | "returned" | "released";
  metadata?: {
    reservationId?: string;
    source: "manual" | "automatic";
    protected: boolean;
    assignedAt: string;
    lockedAt?: string;
    itemGroupName?: string;
    locationId?: string;
    /** 取货后换货产生的分配；归还时仍需按客户持有物回收。 */
    exchangeId?: string;
    exchangeDisposition?: "return_to_warehouse" | "off_shelf";
  };
}

export interface RentalAssignmentState {
  revision: number;
  issue?: string;
  history: Array<{ id: string; at: string; actor: string; action: string; reason?: string; before: RentalAllocation[]; after: RentalAllocation[] }>;
  operationLock?: { ownerId: string; ownerName: string; token: string; expiresAt: string };
}

export interface ManageRentalAllocationRequest {
  action: "preassign" | "lock" | "unlock" | "release" | "reassign";
  expectedRevision: number;
  selections?: Array<{ reservationId: string; itemGroupId?: string; assetIds?: string[]; quantity?: number }>;
  allocationIds?: string[];
  reason?: string;
}

export interface RentalOperationLockRequest {
  action: "acquire" | "release" | "force-release";
  token?: string;
  reason?: string;
}

export interface CreateRentalOrderInternalNoteRequest {
  content: string;
}

export interface RentalAllocationCandidates {
  revision: number;
  reservations: Array<{ reservationId: string; orderLineId: string; itemGroupId: string; itemGroupName: string; locationId: string; inventoryMode: RentalInventoryMode; quantity: number; assignedQuantity: number; lockedQuantity: number; models: Array<{ itemGroupId: string; name: string; enabled: boolean }>; candidates: Array<{ assetId: string; assetNo: string; itemGroupId: string; available: boolean; reason?: string; imageUrl?: string }> }>;
}

/** 分配是独立维度，不用订单主状态或资产当前状态代替未来排期。 */
export function rentalAllocationProgress(order: Pick<RentalOrder, "reservations" | "allocations">) {
  const active = order.allocations.filter((a) => ["pre_assigned", "locked", "allocated", "picked_up"].includes(a.status));
  const required = order.reservations.filter((r) => !["released", "expired", "cancelled"].includes(r.status)).reduce((sum, r) => sum + Math.max(0, r.quantity - r.releasedQuantity), 0);
  const assigned = active.reduce((sum, a) => sum + a.quantity, 0);
  const locked = active.filter((a) => a.status !== "pre_assigned").reduce((sum, a) => sum + a.quantity, 0);
  return { required, assigned, locked, label: !assigned ? "待分配" : assigned < required ? "部分分配" : locked < required ? "待锁定" : "已锁定" };
}

export interface SubstituteRentalBundleComponentRequest {
  orderLineId: string;
  fromItemGroupId: string;
  toItemGroupId: string;
}

export interface PartialReturnRentalOrderRequest {
  items: Array<{
    allocationId: string;
    quantity: number;
  }>;
  /**
   * 本次归还批次的标识，由调用方生成，网络重试时必须复用同一个值。
   *
   * 为什么必须由调用方给：部分归还是**天然可重复**的业务动作——数量库存租 3 件，
   * 先还 1 件、再还 1 件是两次真实归还，而两次请求的分配项与数量完全相同。
   * 幂等兜底键此前是「订单 + 分配项内容哈希」，于是第二次被当成第一次的重试
   * 直接丢弃：客户还了两件，系统只记一件。
   *
   * 也不能改用「当前已归还进度」做兜底键：那样第一次请求的网络重试会因为进度
   * 已经变化而被当成新归还，重复扣减库存。可重复动作的幂等只能由调用方标识。
   *
   * 缺省时服务端要求必须带 `Idempotency-Key` 请求头；两者都没有则拒绝——
   * 宁可让调用方补一个标识，也不能静默丢掉一次真实归还。
   */
  batchNo?: string;
  /** 员工现场签字文件；只引用已完成上传且服务端校验归属的文件资产。 */
  handoverSignatureFileAssetId?: string;
}

export interface RentalOrder {
  /** 原样继承报价的取还检查要求，模板后续修改或停用不追改原单。 */
  inspectionTemplateSnapshots?: RentalInspectionTemplate[];
  /** 原样继承有效报价的品类版本，不在建单时读取空间最新绑定。 */
  categoryVersionId?: string;
  id: string;
  tenantId: string;
  orderNo: string;
  categoryCode: RentalCategoryCode;
  status: RentalCoreOrderStatus;
  customerType: "personal" | "corporate";
  customerId?: string;
  customerName: string;
  contactPhone?: string;
  /** 报价生成时解析的会员预约身份、企业关系与权益快照。 */
  membershipSnapshot?: RentalMembershipSnapshot;
  /** 会员方案实际消费的权益、跳过原因与金额分摊；与报价同源，不能回读当前方案重算。 */
  membershipBenefitEvaluations?: RentalMembershipBenefitEvaluation[];
  fulfillmentMode: RentalFulfillmentMode;
  fulfillmentLocationId: string;
  fulfillmentLocationName: string;
  fulfillmentLocationSnapshot: RentalFulfillmentLocationSnapshot;
  returnLocationId?: string;
  returnLocationName?: string;
  returnLocationSnapshot: RentalFulfillmentLocationSnapshot;
  /** 配送/上门类（customer_address 品类）订单的收货地址快照（含明文电话，运营视图）；自取、车辆据点类订单无此字段。 */
  deliveryAddressSnapshot?: RentalDeliveryAddressSnapshot;
  startAt: string;
  /** 承运寄送：经凭证核验的客户实际签收时点；其他履约方式为空。 */
  actualRentalStartAt?: string;
  /**
   * 原始约定归还时间，**永不因续租而改变**（需求 4.6.9：延期是订单变更，
   * 不得直接修改原订单结束时间）。要判断「现在几点该还」用 `effectiveEndAt`。
   */
  endAt: string;
  /**
   * 当前约定归还时间：最近一次**已生效**续租记录的 `newEndAt`；没有续租时等于 `endAt`。
   *
   * 存成字段而不是每次从续租记录聚合——占用冲突检查与逾期判定都要读它，
   * 聚合会给这两条高频路径各加一次查询。整字段可缺省，存量订单读取时回落到 `endAt`。
   */
  effectiveEndAt?: string;
  /** 承运寄送的当前约定归还时点（以实际签收时刻平移租期，并随续租更新）。 */
  carrierRentalDueAt?: string;
  quoteId: string;
  quoteNo: string;
  pricingPlanVersion: string;
  /** PRICE-03：下单时从报价拷贝的空间级价格版本引用（内存数据源下为空）。 */
  priceVersionId?: string;
  priceVersion?: string;
  ruleVersion: string;
  ruleSnapshot: RentalRuleConfig;
  calendarVersion?: string;
  /** 从报价拷贝的逐日计价依据（需求 4.5.7：订单始终使用订单快照）。 */
  calendarSnapshot?: RentalQuoteCalendarDay[];
  /**
   * CORE-EXT-02D：下单时从报价拷贝的能力版本快照。
   *
   * 在途订单的 allocation / pickup / return / settlement 各环节 Hook 都用它重建执行名单，
   * 因此即便能力随后被升级或暂停，这张订单仍按下单当时的实现版本与配置履约。
   */
  capabilitySnapshot?: RentalWorkspaceCapabilitySnapshotEntry[];
  /** Review P1-5：下单时从报价拷贝的判断记录（不可变）。 */
  capabilityDecisions?: RentalCapabilityDecisionSnapshot[];
  /** Review P1-6：带风险继续的完整例外快照（不可变），配货与后续履约据此还原裁决。 */
  capabilityExceptions?: RentalCapabilityExceptionSnapshot[];
  /**
   * MKT-02A：从报价直接继承的服务、价格、资格、时段与条款正文快照。
   *
   * MKT-02C 起每一项都是一次**独立的服务发生**：同一服务被续租再买一次会追加一条，
   * 不再按 serviceId 合并。见 `RentalOrderServiceOccurrence`。
   */
  serviceSnapshots?: RentalOrderServiceOccurrence[];
  /**
   * CUSTOMER-01C：订单四类主体（需求 4.8.4）。
   *
   * 三个 id 列服务于按角色反查（合并与注销要用），`subjectSnapshot` 固化下单当时的
   * 名称、脱敏证件与授权范围——主体改名或授权到期都不得篡改历史订单。
   * 全部可空：存量订单没有主体拆分，读取侧回落到 `customerId` 作为三个主体。
   */
  contractSubjectCustomerId?: string;
  payerSubjectCustomerId?: string;
  userSubjectCustomerId?: string;
  agentId?: string;
  subjectSnapshot?: CustomerOrderSubjectSnapshot[];
  /**
   * Review P1-10：能力快照的解释口径。
   *
   * `snapshot`：订单带自己的能力快照，在途环节按它判定。
   * `legacy_empty`：迁移前的存量订单没有快照。**明确解释为空快照**——
   * 不执行订单创建后新增或启用的 capability，也绝不回退到「当前已启用的能力」，
   * 否则新启用一个能力就会反向影响所有旧订单的履约判定。
   */
  capabilityPolicy?: "snapshot" | "legacy_empty";
  chargeLines: RentalQuoteChargeLine[];
  /**
   * 待人工裁定的费用审核单（见 `RentalOrderFeeReview`）。
   *
   * 只要还有 `pending` 的，订单就不许结清——这是「人工审核」这个规则选项唯一能
   * 兑现的方式：否则它等于一句静默免除。
   */
  feeReviews?: RentalOrderFeeReview[];
  rentalAmount: number;
  discountAmount: number;
  couponAmount: number;
  serviceAmount: number;
  /** 履约费用合计。与报价同口径，便于订单侧对账时逐项核对。 */
  fulfillmentAmount: number;
  depositAmount: number;
  /** 预授权额度。与 `depositAmount` 独立，可同时存在，理由见报价快照上的同名字段。 */
  preAuthAmount: number;
  payableAmount: number;
  adjustmentAmount: number;
  finalPayableAmount: number;
  /**
   * 从报价拷贝的税率，以及按 `finalPayableAmount` 反算的税额（价内税）。
   *
   * 税额跟着**最终应付**走而不是原应付：逾期费、损坏费、续租费、提前归还退款都会改
   * `adjustmentAmount`，含税总额变了税额就得跟着变，否则报表里"不含税收入 + 税额"凑不回
   * 实收。押金不含税，因此不参与反算。两个字段可缺省，规则没配税时为 0。
   */
  taxRate?: number;
  taxAmount?: number;
  /** 从报价拷贝的结算币种快照（需求 §948：一个订单只有一个结算币种）。 */
  currency?: RentalCurrency;
  cancellationReason?: string;
  cancelledAt?: string;
  /** 订单已超过领取宽限，但尚未完成最终爽约确认。 */
  pickupOverdueAt?: string;
  /** 已记录客户通知的模拟发送时间；没有通知记录不得自动判定爽约。 */
  noShowNoticeAt?: string;
  noShowAt?: string;
  noShowReason?: string;
  completedAt?: string;
  totalAmount: number;
  lines: RentalOrderLine[];
  reservations: RentalReservation[];
  allocations: RentalAllocation[];
  assignment?: RentalAssignmentState;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * ORDER-LIST-01：订单列表的分配进度筛选值，与 `rentalAllocationProgress().label`
 * 及 `assignment.issue` 一一对应。放在契约里而不是页面里：服务端在 SQL 里
 * 按同一判据筛，页面不再对整个列表做内存过滤。
 */
export const RENTAL_ORDER_ASSIGNMENT_FILTERS = ["pending", "partial", "unlocked", "locked", "issue"] as const;
export type RentalOrderAssignmentFilter = (typeof RENTAL_ORDER_ASSIGNMENT_FILTERS)[number];

export const RENTAL_ORDER_LIST_DEFAULT_PAGE_SIZE = 20;
export const RENTAL_ORDER_LIST_MAX_PAGE_SIZE = 200;
/** Public order-list sorting keys; never accept SQL identifiers from a client. */
export const RENTAL_ORDER_SORT_FIELDS = ["createdAt", "orderNo", "customerName", "startAt", "endAt", "payableAmount", "quoteNo", "status"] as const;
export type RentalOrderSortField = (typeof RENTAL_ORDER_SORT_FIELDS)[number];

/**
 * ORDER-LIST-01：`GET /rental/v1/orders` 的查询参数。
 *
 * 空间**不由客户端传入**，一律取会话（与报表同一条规矩）。
 * 分页与筛选全部在数据库里执行；没有 `page`/`pageSize` 时服务端返回旧的纯数组
 * （兼容既有调用方），给了任一分页参数才返回 `RentalOrderPage` 信封。
 */
export interface RentalOrderListQuery {
  page?: number;
  /** 缺省 `RENTAL_ORDER_LIST_DEFAULT_PAGE_SIZE`，上限 `RENTAL_ORDER_LIST_MAX_PAGE_SIZE`。 */
  pageSize?: number;
  status?: RentalCoreOrderStatus;
  /** 订单号、客户名、企业主体名（会员快照）或付款主体客户 id 的模糊匹配。 */
  keyword?: string;
  /**
   * 租期区间：订单的**当前**归还时间（`effectiveEndAt ?? endAt`）晚于 `from`
   * 且起租时间早于 `to`。用当前归还时间是因为续租过的订单实际占用到那一天。
   */
  from?: string;
  to?: string;
  /** 分配进度。除 `issue` 外只对已确认/待交付订单有意义，服务端按该状态集合筛。 */
  assignment?: RentalOrderAssignmentFilter;
  /** 只看仍有待裁定费用审核的订单（ORDER-CLOSE-02：它们会阻止关单）。 */
  pendingFeeOnly?: boolean;
  /** Global sort priorities, e.g. "startAt.asc,orderNo.desc". Max 8 unique allowlisted fields; omitted means createdAt desc, id desc. */
  sort?: string;
}

export interface RentalOrderPage {
  items: RentalOrder[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * REPORT-01A：异常费用的口径。
 *
 * 取自订单费用行的 `type`，不另立一套判据：报表说的「异常」必须和账单上
 * 那几行费用是同一件事，否则运营对不上账。三类都是「本不该发生、发生了要收钱」：
 * 逾期、损坏、取消。押金与预授权不是费用，不计入。
 */
export const RENTAL_EXCEPTION_CHARGE_TYPES = ["overdue", "damage", "cancellation"] as const;
export type RentalExceptionChargeType = (typeof RENTAL_EXCEPTION_CHARGE_TYPES)[number];

/**
 * REPORT-01A：当前经营空间的经营报表。
 *
 * 三条口径，写在类型上而不是只写在实现里：
 *
 * 1. **只取 Rental Core 规范化事实**（`rental_orders`）。不读车辆、履约地点或旧
 *    车辆品类的任何专用字段——那些字段在非车辆品类里根本不存在，
 *    用它们做指标等于让报表只对一个品类成立。
 * 2. **指标定义不随品类变化**。四个品类走同一套公式；页面标题可以用品类术语
 *    （器材/装备/车辆/设备），但「租赁收入」是什么永远是同一个算法。
 * 3. **严格按 tenantId + workspaceId 隔离**。空间是数据边界，不是页头标签；
 *    空空间返回全零，而不是回退到租户汇总。
 *
 * REPORT-01B 在此基础上补了库存/资产口径、地点与客户维度、筛选与导出。
 * 仍**不含**跨空间汇总——数据模型保留未来按租户汇总的可能，但不提前开放
 * 绕过空间权限的查询（需求 4.10）。
 */
export interface RentalWorkspaceOperationReport {
  tenantId: string;
  workspaceId: string;
  categoryCode: RentalCategoryCode;
  /** 统计区间（按订单起租时间归入）。两端可缺省，缺省即不限。 */
  range: { from?: string; to?: string };
  /**
   * REPORT-01B：本次实际生效的全部筛选条件回显。
   *
   * 导出与页面必须用同一份筛选，因此把它随出参带回：对账时能直接看出
   * 这份数字是在哪个区间、哪个地点、哪个客户口径下算出来的。
   */
  filter: RentalWorkspaceReportFilter;
  /** 订单量：**非草稿**订单数。草稿还没成为经营事实，计入会虚增经营规模。 */
  orderCount: number;
  /**
   * 订单量按状态拆分。
   *
   * 需要它才能解释「为什么收入和订单量不成比例」——在租与已完成的收入确认程度
   * 本来就不同，只给一个总数会让人以为是数据错了。
   */
  statusBreakdown: Array<{ status: RentalCoreOrderStatus; count: number }>;
  /**
   * 本报表的结算币种（需求 §948）。经营空间是单币种的，因此整张报表只有一个币种，
   * 不需要按币种分组；界面与 CSV 用它决定金额符号，而不是硬编码 `¥`。
   */
  currency: RentalCurrency;
  /** 租赁收入：`sum(rentalAmount)`。只含租金，不含增值服务、履约费与押金。 */
  rentalRevenue: number;
  /** 优惠金额：`sum(discountAmount + couponAmount)`。方案优惠与券优惠合计。 */
  discountTotal: number;
  /** 应收金额：`sum(finalPayableAmount)`，即调账后的应收，与账单口径一致。 */
  receivableTotal: number;
  /**
   * 税额合计：`sum(taxAmount)`。价内税，已经包含在 `receivableTotal` 里，不要再相加。
   * 规则未配税的空间恒为 0。
   */
  taxTotal: number;
  /** 不含税应收：`receivableTotal − taxTotal`。开票与收入确认看这个数。 */
  netOfTaxTotal: number;
  /** 异常费用：订单费用行中 `RENTAL_EXCEPTION_CHARGE_TYPES` 的金额合计。 */
  exceptionFeeTotal: number;
  /** 异常订单数：**产生过**异常费用行的订单数（不是「取消的订单数」）。 */
  exceptionOrderCount: number;
  /** 异常费用按类型拆分：逾期/损坏/取消各自的金额与涉及订单数。 */
  exceptionFeeBreakdown: Array<{ type: RentalExceptionChargeType; amount: number; orderCount: number }>;
  /** REPORT-01B：库存与资产口径。分子、分母与统计时点写在各自类型上。 */
  utilization: RentalWorkspaceUtilization;
  /** REPORT-01B：地点维度汇总。逐行金额与订单数相加等于总量，可与订单明细对账。 */
  locationBreakdown: RentalWorkspaceLocationBreakdownRow[];
  /** REPORT-01B：客户维度汇总。同样可与订单明细对账。 */
  customerBreakdown: RentalWorkspaceCustomerBreakdownRow[];
  /**
   * REPORT-01B：当前事实无法还原的口径，逐条列出。
   *
   * 放进出参而不是只写在文档里：页面必须把「这个数是快照、不是区间利用率」
   * 告诉看报表的人。少了这一条，运营会把快照当成区间利用率去做决策。
   */
  historicalCaliberGaps: string[];
  generatedAt: string;
}

/**
 * REPORT-01B：报表筛选条件。
 *
 * 刻意**不含** `workspaceId`：空间一律由服务端按会话解析。让客户端传空间
 * 等于允许查自己无权进入的空间（需求 4.10「必须使用会话中的租户、经营空间
 * 和数据范围，不能接受客户端覆盖」）。
 */
export interface RentalWorkspaceReportFilter {
  /** 统计区间，按订单**起租时间**归入。两端可缺省，缺省即不限。 */
  from?: string;
  to?: string;
  /** 履约地点。按下单时的履约地点 id 过滤。 */
  locationId?: string;
  /** 客户主档 id。 */
  customerId?: string;
  /** 客户类型：个人 / 企业。 */
  customerType?: "personal" | "corporate";
}

/**
 * REPORT-01B：序列化资产口径。**当前快照**，不是区间利用率。
 *
 * 为什么只能是快照：`rental_assets` 只存当前 `status`，没有状态变更历史表，
 * 因此「这段区间里有多少可出租小时」在库里根本不存在。用当前状态去乘区间长度
 * 得到的比率会被读成历史利用率，而它只是「今天的状态 × 区间长度」——
 * 那是伪造，不是估算。历史口径缺口登记在 `historicalCaliberGaps`。
 */
export interface RentalSerializedAssetUtilization {
  /** 统计时点：读取这批资产状态的瞬间。区间筛选**不影响**本指标。 */
  snapshotAt: string;
  /** 在册资产总数（含停用）。 */
  totalCount: number;
  /** 分母：可运营资产数 = 在册总数 - 停用（`disabled`）。 */
  operableCount: number;
  /** 分子：当前处于 `rented` 的资产数。 */
  rentedCount: number;
  /** `rentedCount / operableCount`；分母为 0 时为 0，不返回 NaN。 */
  rentedRatio: number;
  /** 各状态资产数，供解释「不可租的都卡在哪一环」。 */
  statusBreakdown: Array<{ status: RentalAssetStatus; count: number }>;
}

/**
 * REPORT-01B：数量库存口径。同样是**当前快照**。
 *
 * `rental_stock_balances` 只存当前三个数量列，没有历史；理由同序列化资产。
 */
export interface RentalQuantityStockUtilization {
  snapshotAt: string;
  /** 分母：在库总量 `sum(onHandQuantity)`。 */
  onHandTotal: number;
  /** 分子：已占用 `sum(reservedQuantity)`。 */
  reservedTotal: number;
  /** 维修占用 `sum(maintenanceQuantity)`，既不可租也不算已出租。 */
  maintenanceTotal: number;
  /** 可租余量 = 在库 - 已占用 - 维修；负数按 0 截断（数据异常时不返回负库存）。 */
  availableTotal: number;
  /** `reservedTotal / onHandTotal`；分母为 0 时为 0。 */
  reservedRatio: number;
}

/**
 * REPORT-01B：区间内订单占用时长。**只有分子，没有比率**。
 *
 * 这是区间口径里唯一能从现有事实算出的量：订单的租期时长是订单自己的字段。
 * 但「可出租时长」需要历史可用状态，库里没有，因此这里刻意不给比率——
 * 给一个分母靠猜的比率，比不给更糟。
 */
/**
 * 续租记录的状态（需求 4.6.9：「申请中但未成功不视为已经延期」）。
 *
 * 只有 `effective` 会推进订单的 `effectiveEndAt` 与占用；其余状态下原租期一律不变。
 */
export type RentalOrderExtensionStatus = "pending_payment" | "effective" | "cancelled" | "expired";

/**
 * 一次续租 / 延期（需求 4.6.9）。append-only，不可编辑——它是"这段时间按什么价延长的"
 * 的唯一凭据，改它等于改历史账。
 */
export interface RentalRepricingContext {
  /** 小时转日租/逾时所需的同版本24小时日价，不能事后读取现价。 */
  dayRates?: RentalPricingRate[];
  timeZone: string;
  legacyDayTypeMultipliers: boolean;
  calendars: RentalCalendarYear[];
}

export interface RentalExtensionPricingSnapshot {
  method: "original_version_difference";
  /** Original-total calculation details. For an exchange this contains only
   * the stable changed line's retained/remaining periods; not an order total. */
  fullChargeLines: RentalQuoteChargeLine[];
  scope?: "order" | "exchange_line";
  context: RentalRepricingContext;
  previousPayableAmount: number;
  recalculatedPayableAmount: number;
  recalculatedRentalAmount: number;
  recalculatedServiceAmount: number;
  recalculatedDiscountAmount: number;
  /** Original adopted membership evaluations under the recalculated bases; not a new entitlement. */
  membershipBenefitEvaluations?: RentalMembershipBenefitEvaluation[];
  recalculatedCouponAmount: number;
  totalBillableUnits: number;
  differenceAmount: number;
  discountEvaluations: RentalQuoteDiscountEvaluation[];
  couponEvaluation?: RentalQuoteCouponEvaluation;
  chargeLines: RentalQuoteChargeLine[];
  refundReview?: {
    amount: number;
    status: "pending" | "approved" | "rejected" | "superseded";
    reason?: string;
    reviewedBy?: string;
    reviewedAt?: string;
  };
}

export interface RentalOrderExtension {
  /** 本次动作的品类政策及真正执行的计价实现；存量缺省不补写。 */
  executionBasis?: RentalOrderActionExecutionBasis;
  id: string;
  tenantId: string;
  workspaceId: string;
  orderId: string;
  /** 同一订单内的续租序号，从 1 开始。费用明细的 code 用它去重。 */
  sequence: number;
  status: RentalOrderExtensionStatus;
  /** 本次续租前的当前归还时间。 */
  originalEndAt: string;
  /** 本次续租后的归还时间。 */
  newEndAt: string;
  /** 全租期重算后的计费单位增量，可为 0。 */
  billableUnits: number;
  rentalAmount: number;
  serviceAmount: number;
  /** 押金差额 = 按新租期算出的应收押金 − 已收押金，可为 0。 */
  depositDelta: number;
  /** 预授权差额，口径同上。 */
  preAuthDelta: number;
  /** 本次需补的正应付差额（已重算原优惠）；负差额另走退款审核。 */
  payableAmount: number;
  currency: string;
  /** 本次实际价格版本：原价补差沿用原报价；独立续租采用申请时适用版本。 */
  priceVersionId?: string;
  priceVersion?: string;
  ruleVersion: string;
  /** 本次实际费率、规则与日历快照；取值来源由 executionBasis 区分。 */
  rateSnapshot: RentalPricingRate[];
  ruleSnapshot: RentalRuleConfig;
  calendarSnapshot: RentalQuoteCalendarDay[];
  pricingSnapshot?: RentalExtensionPricingSnapshot;
  /**
   * 本次续租新增的增值服务快照，申请时固化。
   *
   * 必须落库而不是只留在预览里：申请与生效之间可能隔着客户补款，生效时要靠它
   * 确认服务容量、并把这些服务合并进订单的 `serviceSnapshots`（归还结算判断服务
   * 是否已开始、以及损坏免赔认定都读订单上的那一份）。
   */
  serviceSnapshots?: RentalQuoteServiceSnapshot[];
  /**
   * 申请时快照的结算方式。`monthly` 表示企业月结客户，检查通过即生效、
   * 费用记入月结账单，不需要客户补款动作；`immediate` 需要补款后才生效。
   */
  settlementMode: "immediate" | "monthly";
  memo?: string;
  paidAt?: string;
  /** 生效时点。只有生效的记录才推进订单的 `effectiveEndAt` 与占用。 */
  effectiveAt?: string;
  /** 幂等键：同一订单内重复提交只落一条记录。 */
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
}

export interface ReviewRentalExtensionRefundRequest {
  decision: "approved" | "rejected";
  reason: string;
}

/** 裁定一张费用审核单（逾期人工催收 / 提前归还人工审核退款）。 */
export interface ReviewRentalOrderFeeReviewRequest {
  decision: "approved" | "rejected";
  reason: string;
  /**
   * 认定金额。已知建议额可省略；金额待核定必须显式填数（含零）。
   *
   * 已知金额不超过建议，待核定退款不超过服务端原快照最大核减额与当前应收；
   * 不授予另立费用或实际退款权限。
   */
  amount?: number;
}

/** 续租申请 / 试算的入参。APP 与后台用同一份。 */
export interface RentalOrderExtensionRequest {
  /** 新的归还时间。必须晚于订单当前的 `effectiveEndAt`。 */
  newEndAt: string;
  /** 增量期要一并追加的增值服务。不填表示只延长租期。 */
  services?: Array<{
    serviceId: string;
    quantity: number;
    scheduledStartAt?: string;
    scheduledEndAt?: string;
    serviceLocationId?: string;
  }>;
  memo?: string;
}

/**
 * 续租试算结果：金额与依据齐全但不落库，供客户/运营确认后再提交申请。
 *
 * 单独定义而不是复用 `RentalOrderExtension`：试算没有 id、状态与创建人，
 * 用 `Partial` 表达会让调用方分不清"这个字段现在没有"和"这个字段永远没有"。
 */
export interface RentalOrderExtensionPreview {
  executionBasis?: RentalOrderActionExecutionBasis;
  pricingSnapshot?: RentalExtensionPricingSnapshot;
  orderId: string;
  originalEndAt: string;
  newEndAt: string;
  billableUnits: number;
  rentalAmount: number;
  serviceAmount: number;
  depositDelta: number;
  preAuthDelta: number;
  payableAmount: number;
  currency: string;
  settlementMode: "immediate" | "monthly";
  /** 正差额且非企业月结才需补款；零差额与待审退款不阻止续租。 */
  paymentRequired: boolean;
  /** 增量期的逐行计算说明，与报价的「计算说明」同源，便于客服核对。 */
  chargeLines: RentalQuoteChargeLine[];
  calendarSnapshot: RentalQuoteCalendarDay[];
  /**
   * 本次续租新增的增值服务快照。
   *
   * 此前续租只把服务费算进 `serviceAmount` 与费用明细，解析出来的快照直接丢弃，
   * 于是这些服务既不占服务容量、也不进订单的 `serviceSnapshots`：容量可被超卖，
   * 归还结算看不到它们，续租加的损坏免赔也静默不生效。
   */
  serviceSnapshots?: RentalQuoteServiceSnapshot[];
  priceVersionId?: string;
  priceVersion?: string;
  ruleVersion: string;
}

export type RentalOrderExchangePriceBasis = "original_order_price" | "replacement_current_price";
export interface RentalIncrementalPricingSnapshot {
  version: 1;
  startAt: string;
  endAt: string;
  context: RentalRepricingContext;
  /** Exact newly billed lines; absence of a stable id cannot be repaired from
   * today's item group. The billed period must match the owning extension. */
  lines: Array<{ orderLineId?: string; itemGroupId: string; pricingGroupId?: string; quantity: number;
    /** Bind a post-exchange extension to the original currently held exchange. */
    exchangeId?: string;
    pricingUnit: RentalPricingUnit; amount: number; billableUnits: number;
    /** Zero for usage/package: they have no time-based denominator. */
    billedHours: number; selectedUnitAmount: number }>;
}

export interface RentalOrderActionExecutionBasis {
  incrementalPricing?: RentalIncrementalPricingSnapshot;
  pricingMode: "incremental" | "original_total";
  policySource: "current_workspace" | "original_quote";
  categoryCode: RentalCategoryCode;
  originalCategoryVersionId?: string;
  categoryVersionId?: string;
  adoptionRevision?: number;
  /** 只有来源版本有历史证据时保存正文，不用静态模板伪造旧政策。 */
  categoryPolicySnapshot?: RentalCategoryDefinition;
  pricingStrategies: Array<{ unit: RentalPricingUnit; implementationVersion: string }>;
}
export type RentalOrderExchangeDisposition = "return_to_warehouse" | "off_shelf";

/** 取货后换货时追加的检查快照；金额只能由服务端依据其中的事实计算。 */
export interface RentalOrderExchangeInspectionSnapshot {
  condition?: string;
  usage?: Record<string, unknown>;
  exceptions?: Array<{ code: string; description: string; chargeAmount?: number }>;
  attachments?: string[];
  customerConfirmed: boolean;
}

/** Immutable billed period for a stable order line. Amounts are gross rental,
 * not cash receipts; a split retains the original selected tier and paid units. */
export interface RentalOrderExchangePricingSegment {
  orderLineId: string;
  itemGroupId: string;
  pricingGroupId?: string;
  quantity: number;
  startAt: string;
  endAt: string;
  source: { kind: "quote" | "extension" | "price_version"; id: string; priceVersionId?: string; priceVersion: string };
  rate: RentalPricingRate;
  context: RentalRepricingContext;
  ruleSnapshot: RentalRuleConfig;
  calendarSnapshot: RentalQuoteCalendarDay[];
  applyMinimumUnits: boolean;
  selectedUnitAmount: number;
  billableUnits: number;
  billedHours: number;
  amount: number;
  /** A carried original-price tail still belongs to the same billed blocks;
   * another split subtracts the prior prefix instead of restarting unit rounding. */
  splitBasis?: { startAt: string; endAt: string; amount: number; billableUnits: number; billedHours: number;
    applyMinimumUnits: boolean; consumedAmount: number; consumedUnits: number; consumedHours: number };
}

/** Server-created replacement-goods evidence; never supplied by an exchange request. */
export interface RentalOrderExchangeExecutionBasis {
  categoryCode: RentalCategoryCode;
  categoryVersionId?: string;
  adoptionRevision?: number;
  categoryPolicySnapshot?: RentalCategoryDefinition;
  effectiveFrom: string;
  priceBasis: RentalOrderExchangePriceBasis;
  pricingStrategies: Array<{ unit: RentalPricingUnit; implementationVersion: string }>;
  rateSnapshot: RentalPricingRate[];
  ruleSnapshot: RentalRuleConfig;
  calendarSnapshot: RentalQuoteCalendarDay[];
  pricingSnapshot?: RentalExtensionPricingSnapshot;
  /** Versioned line sources, including retained performed periods and the new
   * remaining period. Legacy absence is not permission to infer past prices. */
  linePricing?: { version: 1; orderLineId: string; originalAmount: number; replacementAmount: number;
    previousSegments: RentalOrderExchangePricingSegment[]; segments: RentalOrderExchangePricingSegment[];
    /** Exact billed numerator/denominator for overdue; original-price exchange
     * retains its prior basis even when the remaining period is already paid. */
    overdueBasis: RentalOrderExchangePricingSegment };
  inspectionTemplateSnapshots: RentalInspectionTemplate[];
  capabilitySnapshot?: RentalWorkspaceCapabilitySnapshotEntry[];
}

/** ORDER-CHANGE-01A/01B/01C/01E：订单变更试算结果。 */
export interface RentalOrderChangePreview {
  orderId: string;
  type: "partial_line_cancel" | "service_cancel" | "post_pickup_exchange";
  /** 试算基于的订单更新时间；提交时必须原样带回，防止旧预览覆盖新变更。 */
  expectedUpdatedAt: string;
  cancelledLineIds: string[];
  cancelledItems: Array<{ lineId: string; itemGroupName: string; quantity: number }>;
  /** ORDER-CHANGE-01C：已取消的未开始服务发生项；金额按订单快照中的客户净支付计算。 */
  cancelledServices: Array<{ occurrenceId: string; serviceName: string; quantity: number; refundAmount: number }>;
  remainingLineIds: string[];
  beforePayableAmount: number;
  recalculatedPayableAmount: number;
  /** 新账面应收 - 原账面应收；负数表示应核减，正数表示需要补款。 */
  differenceAmount: number;
  additionalAmount: number;
  refundAmount: number;
  depositDelta: number;
  preAuthDelta: number;
  currency: string;
  /** 沿用原订单价格、规则、优惠与券快照的重算依据。 */
  pricingSnapshot?: RentalExtensionPricingSnapshot;
  resourceRelease: Array<{ lineId: string; itemGroupName: string; quantity: number }>;
  serviceResourceRelease: Array<{ occurrenceId: string; serviceName: string; quantity: number }>;
  /** ORDER-CHANGE-01E：换货专用的旧/新资源与价格依据。 */
  exchange?: {
    orderLineId: string;
    allocationId: string;
    originalItemGroupId: string;
    originalItemGroupName: string;
    replacementItemGroupId: string;
    replacementItemGroupName: string;
    replacementPricingGroupId?: string;
    priceBasis: RentalOrderExchangePriceBasis;
    originalDisposition: RentalOrderExchangeDisposition;
    originalAmount: number;
    replacementAmount: number;
    differenceAmount: number;
    originalPriceVersion?: string;
    replacementPriceVersion?: string;
    replacementAssetId?: string;
    replacementAssetNo?: string;
    cancelledServiceOccurrenceIds?: string[];
    inspectionSnapshot: RentalOrderExchangeInspectionSnapshot;
    executionBasis?: RentalOrderExchangeExecutionBasis;
  };
  warnings: string[];
}

/** 订单变更请求。只接受服务端按订单/服务快照重算的取消项，不接受客户端传金额。 */
export interface ApplyRentalOrderChangeRequest {
  type: "partial_line_cancel" | "service_cancel" | "post_pickup_exchange";
  /** 兼容 01A 的整行请求；01B 优先使用 items 表达数量库存的部分数量取消。 */
  lineIds?: string[];
  items?: Array<{ lineId: string; quantity: number }>;
  /** ORDER-CHANGE-01C：只能选择取货前、尚未开始的服务发生项。 */
  serviceOccurrenceIds?: string[];
  /** ORDER-CHANGE-01D：数量型服务可按发生项拆分取消；与 serviceOccurrenceIds 二选一。 */
  serviceItems?: Array<{ occurrenceId: string; quantity: number }>;
  /** ORDER-CHANGE-01E：取货后一次换一个分配项，金额与资源由服务端重算。 */
  orderLineId?: string;
  allocationId?: string;
  replacementItemGroupId?: string;
  replacementAssetId?: string;
  replacementPricingGroupId?: string;
  priceBasis?: RentalOrderExchangePriceBasis;
  originalDisposition?: RentalOrderExchangeDisposition;
  exchangeLocationId?: string;
  inspectionSnapshot?: RentalOrderExchangeInspectionSnapshot;
  cancelServiceOccurrenceIds?: string[];
  reason: string;
  customerConfirmed: boolean;
  expectedUpdatedAt: string;
}

/** 订单变更只追加记录。原订单与原订单行仍保留，所有差异和金额从这里回放。 */
/** 待确认爽约订单恢复为待领取时写入变更历史的请求快照；没有对外 DTO，只由服务端构造。 */
export interface ResumePickupRentalOrderChangeRequest {
  type: "resume_pickup";
  reason: string;
  customerConfirmed: boolean;
  expectedUpdatedAt: string;
}

export interface RentalOrderChange {
  id: string;
  tenantId: string;
  workspaceId: string;
  orderId: string;
  sequence: number;
  type: "partial_line_cancel" | "service_cancel" | "post_pickup_exchange" | "resume_pickup";
  status: "applied" | "rejected";
  request: ApplyRentalOrderChangeRequest | ResumePickupRentalOrderChangeRequest;
  beforeSnapshot: Record<string, unknown>;
  afterSnapshot: Record<string, unknown>;
  diff: Record<string, unknown>;
  refundAmount: number;
  additionalAmount: number;
  depositDelta: number;
  preAuthDelta: number;
  idempotencyKey: string;
  requestedBy: string;
  appliedBy?: string;
  requestedAt: string;
  appliedAt?: string;
  createdAt: string;
}

/** 订单变更试算入参。 */
export interface PreviewRentalOrderChangeRequest {
  type: "partial_line_cancel" | "service_cancel" | "post_pickup_exchange";
  /** 兼容 01A 的整行请求；01B 优先使用 items 表达数量库存的部分数量取消。 */
  lineIds?: string[];
  items?: Array<{ lineId: string; quantity: number }>;
  serviceOccurrenceIds?: string[];
  /** ORDER-CHANGE-01D：数量型服务可按发生项拆分取消；与 serviceOccurrenceIds 二选一。 */
  serviceItems?: Array<{ occurrenceId: string; quantity: number }>;
  orderLineId?: string;
  allocationId?: string;
  replacementItemGroupId?: string;
  replacementAssetId?: string;
  replacementPricingGroupId?: string;
  priceBasis?: RentalOrderExchangePriceBasis;
  originalDisposition?: RentalOrderExchangeDisposition;
  exchangeLocationId?: string;
  inspectionSnapshot?: RentalOrderExchangeInspectionSnapshot;
  cancelServiceOccurrenceIds?: string[];
}

export interface RentalOrderOccupancy {
  /** 参与统计的订单数（与 `orderCount` 同一口径：非草稿 + 筛选后）。 */
  orderCount: number;
  /** 租期时长合计（小时，保留两位）。 */
  totalHours: number;
  /** 平均租期时长（小时）；订单数为 0 时为 0。 */
  averageHours: number;
}

export interface RentalWorkspaceUtilization {
  serializedAssets: RentalSerializedAssetUtilization;
  quantityStock: RentalQuantityStockUtilization;
  orderOccupancy: RentalOrderOccupancy;
}

/** REPORT-01B：地点维度汇总行。名称取下单时快照，主档改名不改写历史。 */
export interface RentalWorkspaceLocationBreakdownRow {
  locationId: string;
  locationName: string;
  orderCount: number;
  rentalRevenue: number;
  discountTotal: number;
  receivableTotal: number;
  exceptionFeeTotal: number;
}

/**
 * REPORT-01B：客户维度汇总行。
 *
 * 只带客户名与类型。手机号、证件号一概不进报表与导出——报表是给经营看趋势的，
 * 不是客户资料的第二个出口。
 */
export interface RentalWorkspaceCustomerBreakdownRow {
  /** 存量订单可能没有客户主档 id，此时按订单上的客户名归并。 */
  customerId?: string;
  customerName: string;
  customerType: string;
  orderCount: number;
  rentalRevenue: number;
  discountTotal: number;
  receivableTotal: number;
  exceptionFeeTotal: number;
}

export interface RentalInspectionTemplate {
  id: string;
  tenantId: string;
  categoryCode: RentalCategoryCode;
  code: string;
  name: string;
  stage: "pickup" | "return";
  version: string;
  fields: RentalInspectionFieldDefinition[];
  enabled: boolean;
  /** Read-only order projection: this template applies only to these actual resources. */
  allocationIds?: string[];
  /** Original stored template ID; projection IDs are never database foreign keys. */
  sourceTemplateId?: string;
  /** Read-only projection identifying the replacement-goods change. */
  exchangeId?: string;
}

export interface CreateRentalInspectionRequest {
  templateId: string;
  results: Record<string, unknown>;
  /** 承运寄送领取检查使用经核验的客户签收时间；普通履约方式不得传此字段。 */
  carrierActualAt?: string;
  /**
   * 归还阶段可指定本次实际归还的分配项。存在时是“逐批归还检查”：只释放本批
   * 已领取的资产/数量，订单仍保持租赁中；最后一批必须使用整单归还，以统一计算
   * 逾期、提前归还和最终服务结算。
   */
  returnItems?: Array<{ allocationId: string; quantity: number }>;
  /**
   * 分批归还的批次标识，语义与 `PartialReturnRentalOrderRequest.batchNo` 完全一致。
   *
   * 带 `returnItems` 的归还检查是分批归还的第二个入口，此前和 `partial-return`
   * 一样用分配项内容哈希做幂等兜底键，因此同样会把「第二次归还相同数量」
   * 判成第一次的重试。只在 `returnItems` 非空时需要。
   */
  returnBatchNo?: string;
  /** 检查员只能提交建议损失额；最终计费必须由结算权限人员独立审核。 */
  exceptions?: Array<{
    code: string;
    description: string;
    /** 可选的本次归还分配项；缺省表示异常影响本批全部归还资源。 */
    allocationId?: string;
    chargeAmount?: number;
    evidenceAttachments?: string[];
  }>;
  attachments?: string[];
  /** 员工现场签字文件；签名必须与当前订单、阶段及幂等批次一致。 */
  handoverSignatureFileAssetId?: string;
  operator?: string;
}

export interface RentalHandoverRequest {
  /** 无检查模板时的员工现场签字文件。 */
  handoverSignatureFileAssetId?: string;
  /** 承运寄送领取时使用经核验的客户签收时间；普通履约方式不得传此字段。 */
  carrierActualAt?: string;
}

export interface CreateStaffOfflinePaymentRequest {
  orderId: string;
  instrument: "rental" | "deposit";
  amount: number;
  paymentMethod: "offline_cash" | "offline_transfer";
  reason: string;
  idempotencyKey: string;
  evidenceFileAssetId?: string;
}

export interface RentalInspectionRecord {
  id: string;
  tenantId: string;
  orderId: string;
  stage: "pickup" | "return";
  templateId: string;
  templateCode: string;
  templateVersion: string;
  /** Replacement action whose frozen requirements were used for this inspection. */
  exchangeId?: string;
  results: Record<string, unknown>;
  /** 归还检查引用的领取基线；领取记录本身为空。 */
  baselineInspectionId?: string;
  comparisons?: Array<{ fieldCode: string; baseline?: unknown; current?: unknown; changed: boolean }>;
  /** 通用使用量读数（快门、里程、工时等由字段编码识别），保留原始值与差值。 */
  usageReadings?: Array<{ fieldCode: string; baseline?: number; current: number; delta?: number }>;
  /** 使用量异常修正只追加记录，不覆盖原始检查结果；当前有效读数由最后一次修正得到。 */
  usageCorrections?: Array<{
    id: string;
    fieldCode: string;
    from: number;
    to: number;
    reason: string;
    evidenceAttachments: string[];
    operator: string;
    correctedAt: string;
  }>;
  /** 本记录覆盖的部分归还分配项；整单检查为空。 */
  returnedItems?: Array<{ allocationId: string; quantity: number }>;
  exceptions: Array<{
    code: string;
    description: string;
    /** 异常具体关联的归还分配项；缺省表示本批全部资源。 */
    allocationId?: string;
    /** 检查员提交的建议额，不直接进入订单应付。 */
    suggestedChargeAmount?: number;
    evidenceAttachments?: string[];
    reviewStatus: "pending" | "approved" | "rejected";
    approvedChargeAmount?: number;
    reviewReason?: string;
    liability?: "customer" | "normal_wear" | "lessor" | "third_party" | "undetermined";
    waiverDecision?: "covered" | "excluded";
    /** 首次审核损失额和免赔裁定依据；金额复核不得改写这批历史事实。 */
    assessedDamageAmount?: number;
    waiverCustomerChargeCeiling?: number;
    waiverOccurrenceId?: string;
    waiverServiceId?: string;
    waiverTermsVersion?: string;
    incidentAt?: string;
    incidentBasis?: string;
    reviewedBy?: string;
    reviewedAt?: string;
    /** 正数异常费用审核后，必须记录客户确认或申诉，才能进入结算。存量记录缺省表示旧链路。 */
    customerResponseStatus?: "not_required" | "pending" | "confirmed" | "disputed";
    customerResponseReason?: string;
    customerRespondedBy?: string;
    customerRespondedAt?: string;
    customerResponseHistory?: Array<{
      decision: "confirmed" | "disputed";
      reason: string;
      operator: string;
      respondedAt: string;
    }>;
    /** 客户申诉后的正式金额复核，只追加前后金额，不覆盖原裁定事实。 */
    adjustmentHistory?: Array<{
      fromAmount: number;
      toAmount: number;
      reason: string;
      operator: string;
      adjustedAt: string;
    }>;
  }>;
  attachments: string[];
  operator: string;
  createdAt: string;
}

export interface CorrectRentalInspectionUsageRequest {
  fieldCode: string;
  correctedCurrent: number;
  reason: string;
  evidenceAttachments?: string[];
}

export interface ReviewRentalInspectionExceptionRequest {
  decision: "approved" | "rejected";
  approvedChargeAmount?: number;
  /** 有免赔服务且计费时必须明确核对事故责任与条款，不以购买事实自动认定适用。 */
  waiverDecision?: "covered" | "excluded";
  /** 有免赔服务的正数损失裁定须明确实际事故时间与核实依据，不能使用检查时间代替。 */
  incidentAt?: string;
  incidentBasis?: string;
  /** 可明确指定冻结的保障发生项；不读取当前服务配置。 */
  waiverOccurrenceId?: string;
  /** 赔偿责任审核；正数客户费用必须明确为 customer，不能将正常损耗当作损坏收费。 */
  liability?: "customer" | "normal_wear" | "lessor" | "third_party" | "undetermined";
  reason: string;
}

export interface AdjustRentalInspectionExceptionRequest {
  approvedChargeAmount: number;
  reason: string;
}

export interface RecordRentalInspectionExceptionCustomerResponseRequest {
  decision: "confirmed" | "disputed";
  reason: string;
}
