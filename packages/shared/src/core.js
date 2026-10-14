"use strict";
/**
 * Rental Core v0.1：通用租赁内核契约。
 *
 * 品类、能力、经营空间、商品与资产、报价与订单、计价与优惠、押金与资金、
 * 规则版本、日历、通知、客户主档与会员、报表口径。新业务的唯一契约来源。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RENTAL_SERVICE_EXECUTION_ACTIONS = exports.RENTAL_SERVICE_EXECUTION_STATUSES = exports.RENTAL_SERVICE_SKIP_REASONS = exports.RENTAL_INSURANCE_PROVIDER_STATUSES = exports.RENTAL_SERVICE_SELECTION_MODES = exports.RENTAL_SERVICE_BILLING_UNITS = exports.RENTAL_DISCOUNT_SKIP_REASONS = exports.RENTAL_DISCOUNT_TYPES = exports.RENTAL_DISCOUNT_TARGETS = exports.DEFAULT_RENTAL_PAYMENT_METHODS = exports.RENTAL_OFFLINE_PAYMENT_METHOD_CODES = exports.RENTAL_PAYMENT_METHOD_CODES = exports.CUSTOMER_MEMBERSHIP_PLAN_TARGET_TYPES = exports.CUSTOMER_QUALIFICATION_STATUSES = exports.CUSTOMER_MEMBERSHIP_REVIEW_STATUSES = exports.CUSTOMER_MEMBERSHIP_REVIEW_TYPES = exports.CUSTOMER_MEMBERSHIP_REGISTRATION_MODES = exports.CUSTOMER_CORPORATE_SCALE_LABELS = exports.CUSTOMER_CORPORATE_SCALES = exports.CUSTOMER_CORPORATE_INDUSTRY_LABELS = exports.CUSTOMER_CORPORATE_INDUSTRIES = exports.CUSTOMER_SOURCE_CHANNEL_LABELS = exports.CUSTOMER_SOURCE_CHANNELS = exports.CUSTOMER_GENDER_LABELS = exports.CUSTOMER_GENDERS = exports.CUSTOMER_RISK_STATUSES = exports.CUSTOMER_RISK_LEVELS = exports.CUSTOMER_RISK_TYPES = exports.CUSTOMER_STATUS_ACTIONS = exports.CUSTOMER_ACCOUNT_STATUSES = exports.CUSTOMER_MEMBERSHIP_STATUSES = exports.BUSINESS_WORKSPACE_RUN_MODES = exports.RENTAL_CATEGORY_ICON_CODES = exports.RENTAL_LOCATION_TYPES = exports.RENTAL_CARRIER_SHIPMENT_EVENT_TYPES = exports.RENTAL_FULFILLMENT_MODES = exports.RENTAL_PRICING_UNIT_LABELS = exports.RENTAL_PRICING_UNIT_CODES = exports.RENTAL_CAPABILITY_MODULES = exports.RENTAL_CURRENCY_CODES = exports.RENTAL_CURRENCY_META = exports.RENTAL_CAPABILITY_HOOK_POINTS = exports.RENTAL_CAPABILITY_LIFECYCLE_STATUSES = exports.RENTAL_CORE_CAPABILITY_CODES = exports.RENTAL_CAPABILITY_CODES = exports.RentalCoreOrderStatus = exports.RentalReservationStatus = exports.RentalAssetStatus = exports.RentalInventoryMode = exports.RentalCategoryCode = void 0;
exports.RENTAL_EXCEPTION_CHARGE_TYPES = exports.RENTAL_ORDER_LIST_MAX_PAGE_SIZE = exports.RENTAL_ORDER_LIST_DEFAULT_PAGE_SIZE = exports.RENTAL_ORDER_ASSIGNMENT_FILTERS = exports.RENTAL_WORK_ORDER_STATUSES = exports.RENTAL_WORK_ORDER_TYPES = exports.RENTAL_STOCK_OPERATION_TYPES = exports.RENTAL_CATEGORY_DEFINITIONS = exports.RENTAL_SECURITY_RISK_LEVELS = exports.RENTAL_SERVICE_REFUND_STATUSES = void 0;
exports.formatRentalMoney = formatRentalMoney;
exports.rentalCurrencySymbol = rentalCurrencySymbol;
exports.membershipBenefitScopeMatches = membershipBenefitScopeMatches;
exports.rentalAllocationProgress = rentalAllocationProgress;
// Rental Core v0.1 ---------------------------------------------------------
var RentalCategoryCode;
(function (RentalCategoryCode) {
    RentalCategoryCode["Vehicle"] = "vehicle";
    RentalCategoryCode["Camera"] = "camera";
    RentalCategoryCode["Camping"] = "camping";
    RentalCategoryCode["Construction"] = "construction";
})(RentalCategoryCode || (exports.RentalCategoryCode = RentalCategoryCode = {}));
var RentalInventoryMode;
(function (RentalInventoryMode) {
    RentalInventoryMode["Serialized"] = "serialized";
    RentalInventoryMode["Quantity"] = "quantity";
    /** 一次性使用的库存；领取时消耗，不进入归还、周转或维修隔离。 */
    RentalInventoryMode["Consumable"] = "consumable";
    RentalInventoryMode["Bundle"] = "bundle";
})(RentalInventoryMode || (exports.RentalInventoryMode = RentalInventoryMode = {}));
var RentalAssetStatus;
(function (RentalAssetStatus) {
    RentalAssetStatus["Available"] = "available";
    RentalAssetStatus["Reserved"] = "reserved";
    RentalAssetStatus["Rented"] = "rented";
    RentalAssetStatus["Inspection"] = "inspection";
    RentalAssetStatus["Maintenance"] = "maintenance";
    RentalAssetStatus["Disabled"] = "disabled";
})(RentalAssetStatus || (exports.RentalAssetStatus = RentalAssetStatus = {}));
var RentalReservationStatus;
(function (RentalReservationStatus) {
    RentalReservationStatus["Soft"] = "soft";
    RentalReservationStatus["Confirmed"] = "confirmed";
    RentalReservationStatus["Fulfilled"] = "fulfilled";
    RentalReservationStatus["Released"] = "released";
    RentalReservationStatus["Expired"] = "expired";
    RentalReservationStatus["Cancelled"] = "cancelled";
})(RentalReservationStatus || (exports.RentalReservationStatus = RentalReservationStatus = {}));
var RentalCoreOrderStatus;
(function (RentalCoreOrderStatus) {
    RentalCoreOrderStatus["Draft"] = "draft";
    RentalCoreOrderStatus["Reserved"] = "reserved";
    RentalCoreOrderStatus["PickupOverdue"] = "pickup_overdue";
    RentalCoreOrderStatus["ReadyForPickup"] = "ready_for_pickup";
    RentalCoreOrderStatus["Renting"] = "renting";
    RentalCoreOrderStatus["ReturnInspection"] = "return_inspection";
    RentalCoreOrderStatus["Settling"] = "settling";
    RentalCoreOrderStatus["Completed"] = "completed";
    RentalCoreOrderStatus["Cancelled"] = "cancelled";
    RentalCoreOrderStatus["NoShow"] = "no_show";
})(RentalCoreOrderStatus || (exports.RentalCoreOrderStatus = RentalCoreOrderStatus = {}));
exports.RENTAL_CAPABILITY_CODES = [
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
];
/**
 * Rental Core 直接提供的跨品类基础能力。
 *
 * 这些能力随品类定义生效，不创建经营空间 capability 实例，也不由运营启停；对应规则
 * 分别在库存、履约、业务规则和检查模板中配置。其余 code 才属于可独立启停、版本化的扩展模块。
 */
exports.RENTAL_CORE_CAPABILITY_CODES = [
    "serialized_inventory",
    "quantity_inventory",
    "bundle_inventory",
    "pickup",
    "return",
    "delivery",
    "usage_reading",
    "qualification",
    "inspection_care"
];
/** capability 生命周期。`disabled` 与「从未启用」不同：前者有实例与审计，后者没有实例行。 */
exports.RENTAL_CAPABILITY_LIFECYCLE_STATUSES = ["enabled", "paused", "disabled"];
/**
 * CORE-EXT-02B：capability Hook 的七个触发点。
 *
 * 这个列表就是 Rental Core 愿意对外开放的**全部**扩展时机。它刻意是封闭枚举而不是
 * 任意字符串：能力模块只能挂在 Core 认得的节点上，不能自己发明一个 Core 从未调用的
 * 节点名然后声称"已接入"。值同时作为审计里的节点标识。
 */
exports.RENTAL_CAPABILITY_HOOK_POINTS = [
    "item_onboarding",
    "quote_validation",
    "order_confirmation",
    "allocation_dispatch",
    "pickup_delivery",
    "return_inspection",
    "settlement"
];
/** 币种的符号与中文名。符号只用于展示，不参与任何计算。 */
exports.RENTAL_CURRENCY_META = {
    CNY: { symbol: "¥", label: "人民币" },
    HKD: { symbol: "HK$", label: "港币" },
    MOP: { symbol: "MOP$", label: "澳门元" },
    TWD: { symbol: "NT$", label: "新台币" },
    SGD: { symbol: "S$", label: "新加坡元" },
    USD: { symbol: "$", label: "美元" },
    EUR: { symbol: "€", label: "欧元" }
};
exports.RENTAL_CURRENCY_CODES = Object.keys(exports.RENTAL_CURRENCY_META);
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
function formatRentalMoney(amount, currency) {
    const value = Number.isFinite(amount) ? amount : 0;
    const sign = value < 0 ? "-" : "";
    const fixed = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const meta = currency ? exports.RENTAL_CURRENCY_META[currency] : exports.RENTAL_CURRENCY_META.CNY;
    return meta ? `${sign}${meta.symbol}${fixed}` : `${currency} ${sign}${fixed}`;
}
/** 币种符号；未登记的币种回落成币种代码本身，绝不猜符号。 */
function rentalCurrencySymbol(currency) {
    if (!currency)
        return exports.RENTAL_CURRENCY_META.CNY.symbol;
    return exports.RENTAL_CURRENCY_META[currency]?.symbol ?? currency;
}
/**
 * 品类能力的统一注册表。新增专属能力时先登记扩展点，再由独立模块实现；
 * Rental Core 只识别 capability code，不在订单主流程里判断具体品类。
 */
exports.RENTAL_CAPABILITY_MODULES = [
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
exports.RENTAL_PRICING_UNIT_CODES = ["hour", "shift", "day_24h", "calendar_day", "night", "week", "month", "usage", "package"];
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
exports.RENTAL_PRICING_UNIT_LABELS = {
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
exports.RENTAL_FULFILLMENT_MODES = [
    "store_pickup_return",
    "partner_pickup_return",
    "warehouse_pickup_return",
    "locker_pickup_return",
    "delivery",
    "onsite_delivery",
    "carrier_shipping"
];
/** 承运寄送的里程碑。实际计租从可信签收开始，到客户交承运商并留存揽收凭证结束。 */
exports.RENTAL_CARRIER_SHIPMENT_EVENT_TYPES = [
    "outbound_dispatched",
    "customer_signed",
    "customer_handoff",
    "warehouse_received"
];
/**
 * Rental Core 履约地点类型的唯一取值来源。
 *
 * 品类定义、管理端选项和 API DTO 必须共用这一组值。此前 DTO 仍接受旧的
 * pickup_point / delivery_point / parking，却拒绝品类定义真实使用的
 * station / locker / delivery_hub，导致页面能选、保存必然 400。
 */
exports.RENTAL_LOCATION_TYPES = ["store", "warehouse", "station", "locker", "delivery_hub", "project_site"];
/** Controlled names, never arbitrary SVG, URLs or executable icon definitions. */
exports.RENTAL_CATEGORY_ICON_CODES = ["rental", "camera", "camping", "construction", "vehicle", "clothing", "tool", "package"];
exports.BUSINESS_WORKSPACE_RUN_MODES = ["production", "demo", "development"];
/**
 * CUSTOMER-01A：空间会员状态（需求 4.8.6 的六态）。
 *
 * 六态必须都在类型里，不能用 active/suspended 两态凑：需求给每一态定义了不同的业务含义
 * （待激活尚未完成认证、风险受限只限制部分能力、已退出是客户主动、已注销是终态），
 * 合并成两态就无法表达「为什么不能下单」，而那正是运营与客服每天要回答的问题。
 */
exports.CUSTOMER_MEMBERSHIP_STATUSES = [
    "pending_activation",
    "active",
    "suspended",
    "risk_restricted",
    "exited",
    "closed"
];
/**
 * CUSTOMER-01A：客户账号状态（需求 4.8.1 / 4.8.13）。
 *
 * 与空间会员状态**分开**：账号是「客户如何登录」，会员关系是「客户在某空间有什么资格」。
 * 停用账号阻止登录全部空间；暂停某个空间的会员关系不影响登录与其他空间业务。
 * 两者共用一个字段是本任务明确要避免的建模错误。
 */
exports.CUSTOMER_ACCOUNT_STATUSES = ["active", "suspended", "closed"];
/** 状态变更动作。解除限制也是独立记录，不允许删除原限制事实（需求 4.8.6）。 */
exports.CUSTOMER_STATUS_ACTIONS = [
    "activate",
    "suspend",
    "restrict",
    "release",
    "exit",
    "close",
    "reopen",
    "merge"
];
exports.CUSTOMER_RISK_TYPES = [
    "overdue",
    "damage_dispute",
    "identity_anomaly",
    "payment_dispute",
    "other"
];
exports.CUSTOMER_RISK_LEVELS = ["low", "medium", "high"];
exports.CUSTOMER_RISK_STATUSES = ["open", "reviewing", "closed"];
/**
 * 客户基础主数据的预置下拉项（全部选填）。管理端据此渲染快速选择，
 * 服务端 DTO 用同一常量做 `@IsIn` 兜底，避免两处枚举漂移。取值仅作展示与检索，不参与业务判定。
 */
exports.CUSTOMER_GENDERS = ["male", "female", "unknown"];
exports.CUSTOMER_GENDER_LABELS = {
    male: "男",
    female: "女",
    unknown: "未知"
};
exports.CUSTOMER_SOURCE_CHANNELS = ["walk_in", "mini_program", "referral", "online_ad", "other"];
exports.CUSTOMER_SOURCE_CHANNEL_LABELS = {
    walk_in: "到店",
    mini_program: "小程序",
    referral: "朋友推荐",
    online_ad: "线上广告",
    other: "其他"
};
exports.CUSTOMER_CORPORATE_INDUSTRIES = ["media", "outdoor_tourism", "auto_service", "construction", "events", "other"];
exports.CUSTOMER_CORPORATE_INDUSTRY_LABELS = {
    media: "影视传媒",
    outdoor_tourism: "文旅户外",
    auto_service: "汽车服务",
    construction: "建筑工程",
    events: "活动会展",
    other: "其他"
};
exports.CUSTOMER_CORPORATE_SCALES = ["1-10", "11-50", "51-200", "200+"];
exports.CUSTOMER_CORPORATE_SCALE_LABELS = {
    "1-10": "1-10人",
    "11-50": "11-50人",
    "51-200": "51-200人",
    "200+": "200人以上"
};
/** 租户统一注册审核模式。 */
exports.CUSTOMER_MEMBERSHIP_REGISTRATION_MODES = ["automatic", "manual"];
exports.CUSTOMER_MEMBERSHIP_REVIEW_TYPES = ["registration", "corporate_registration", "qualification"];
exports.CUSTOMER_MEMBERSHIP_REVIEW_STATUSES = [
    "pending", "approved", "rejected", "supplement_required", "cancelled"
];
exports.CUSTOMER_QUALIFICATION_STATUSES = [
    "not_submitted", "pending", "approved", "rejected", "expired", "revoked"
];
exports.CUSTOMER_MEMBERSHIP_PLAN_TARGET_TYPES = ["personal", "corporate"];
function membershipBenefitScopeMatches(scope, workspaceId, categoryCode) {
    if (!scope || scope.type === "tenant")
        return true;
    if (scope.type === "workspaces")
        return Array.isArray(scope.workspaceIds) && scope.workspaceIds.includes(workspaceId);
    if (scope.type === "categories")
        return Array.isArray(scope.categoryCodes) && scope.categoryCodes.includes(categoryCode);
    return false;
}
/** 经营空间可启用的收款方式。线上方式还必须通过租户 Provider 配置与实时校验。 */
exports.RENTAL_PAYMENT_METHOD_CODES = [
    "offline_cash",
    "offline_transfer",
    "alipay",
    "wechat_pay"
];
exports.RENTAL_OFFLINE_PAYMENT_METHOD_CODES = ["offline_cash", "offline_transfer"];
exports.DEFAULT_RENTAL_PAYMENT_METHODS = [...exports.RENTAL_PAYMENT_METHOD_CODES];
/**
 * 优惠可作用的费用对象（需求 4.4.10）。
 *
 * 刻意不含押金、预授权与异常费用：需求明确「标准租金优惠不得含糊地减免押金、
 * 预授权或异常费用」。把它们排除在类型之外，而不是靠运行时判断——
 * 判断可以漏写，类型不会。
 */
exports.RENTAL_DISCOUNT_TARGETS = ["rental", "fulfillment", "service"];
/** 优惠类型（需求 4.4.10 第一阶段三种）。复杂规则须另建模型，不得塞进这三个字段。 */
exports.RENTAL_DISCOUNT_TYPES = ["percentage", "fixed_amount", "threshold_amount"];
/** 优惠方案未被应用的原因码（需求 4.4.10：未应用优惠必须有可解释的原因）。 */
exports.RENTAL_DISCOUNT_SKIP_REASONS = [
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
];
/**
 * 增值服务的计费单位（需求 4.4.11「服务计费单位独立于商品租金单位」）。
 *
 * `per_day` 是**自然日**而不是 24 小时块：需求写的是「每自然日」「每日服务逐日取价」，
 * 周一 22:00 到周二 08:00 的清洁服务占用两个工作日，按 24 小时折算只会算成一天。
 * `per_night` 按过夜数；`per_rental_period` 整段租期一次；`per_hour` 按小时进位。
 * 人员/班次/里程类单位需要排班或采集数据，属 SHARED-PEOPLE-01 与品类扩展，不在此。
 */
exports.RENTAL_SERVICE_BILLING_UNITS = [
    "per_order",
    "per_unit",
    "per_day",
    "per_night",
    "per_hour",
    "per_rental_period"
];
/** 服务被选中的方式（需求 4.4.11「可选、推荐、强制和人工服务」）。 */
exports.RENTAL_SERVICE_SELECTION_MODES = ["optional", "recommended", "mandatory"];
/**
 * 第三方保险的接入状态（需求 4.4.11）。
 *
 * 刻意**没有**「已投保」这个取值：未接入真实服务商前不得向客户展示已投保、
 * 虚构保单号，也不得把商户损坏免赔称为保险。真实 Provider 接入属 EXT-02，
 * 到那时才会新增带保单号与理赔状态的取值，而不是现在先留一个可以被误用的字段。
 */
exports.RENTAL_INSURANCE_PROVIDER_STATUSES = ["simulated", "reserved"];
/** 服务未通过资格判定的原因码（需求 4.4.11：不适用时服务端必须明确拒绝）。 */
exports.RENTAL_SERVICE_SKIP_REASONS = [
    "status_not_enabled",
    "item_group_mismatch",
    "fulfillment_mode_mismatch",
    "location_mismatch",
    "customer_scope_mismatch",
    "quantity_out_of_range",
    "mandatory_missing"
];
/**
 * 增值服务的实际履约状态（MKT-02D）。
 *
 * 计划时间只能说明服务承诺，不能自动证明已经开始或完成；新订单的服务发生项
 * 必须由运营人员明确记录实际动作。终态不会被后续动作覆盖。
 */
exports.RENTAL_SERVICE_EXECUTION_STATUSES = [
    "not_started",
    "in_progress",
    "completed",
    "cancelled",
    "failed",
    "no_show"
];
exports.RENTAL_SERVICE_EXECUTION_ACTIONS = ["start", "complete", "cancel", "fail", "no_show"];
exports.RENTAL_SERVICE_REFUND_STATUSES = [
    "none",
    "pending_review",
    "approved_pending_refund",
    "rejected",
    "refunded",
    /** 取货前订单变更已经把客户净额纳入订单退款差额，不再创建服务退款审核单。 */
    "included_in_order_change"
];
/** 商品级风控等级。缺失或非法值一律按 unclassified 处理，不得自动减免保证金。 */
exports.RENTAL_SECURITY_RISK_LEVELS = ["low", "standard", "high"];
const commonSettingModules = [
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
const securityRiskAttribute = () => ({
    code: "securityRiskLevel",
    label: "商品风控等级",
    scope: "item_group",
    type: "select",
    options: [...exports.RENTAL_SECURITY_RISK_LEVELS]
});
exports.RENTAL_CATEGORY_DEFINITIONS = [
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
/** STOCK-OPS-01：数量与一次性耗材库存的可审计日常作业。余额是当前快照，流水才是调整来源。 */
exports.RENTAL_STOCK_OPERATION_TYPES = ["receive", "count_adjustment", "transfer", "consume", "scrap", "retire"];
/** STOCK-CLOSE-01 / SHARED-WORK-01A：归还后库存处置与养护工单的统一事实契约。 */
exports.RENTAL_WORK_ORDER_TYPES = ["cleaning", "restock", "calibration", "repair"];
exports.RENTAL_WORK_ORDER_STATUSES = ["pending", "in_progress", "pending_review", "completed", "rejected", "cancelled"];
/** 分配是独立维度，不用订单主状态或资产当前状态代替未来排期。 */
function rentalAllocationProgress(order) {
    const active = order.allocations.filter((a) => ["pre_assigned", "locked", "allocated", "picked_up"].includes(a.status));
    const required = order.reservations.filter((r) => !["released", "expired", "cancelled"].includes(r.status)).reduce((sum, r) => sum + Math.max(0, r.quantity - r.releasedQuantity), 0);
    const assigned = active.reduce((sum, a) => sum + a.quantity, 0);
    const locked = active.filter((a) => a.status !== "pre_assigned").reduce((sum, a) => sum + a.quantity, 0);
    return { required, assigned, locked, label: !assigned ? "待分配" : assigned < required ? "部分分配" : locked < required ? "待锁定" : "已锁定" };
}
/**
 * ORDER-LIST-01：订单列表的分配进度筛选值，与 `rentalAllocationProgress().label`
 * 及 `assignment.issue` 一一对应。放在契约里而不是页面里：服务端在 SQL 里
 * 按同一判据筛，页面不再对整个列表做内存过滤。
 */
exports.RENTAL_ORDER_ASSIGNMENT_FILTERS = ["pending", "partial", "unlocked", "locked", "issue"];
exports.RENTAL_ORDER_LIST_DEFAULT_PAGE_SIZE = 20;
exports.RENTAL_ORDER_LIST_MAX_PAGE_SIZE = 200;
/**
 * REPORT-01A：异常费用的口径。
 *
 * 取自订单费用行的 `type`，不另立一套判据：报表说的「异常」必须和账单上
 * 那几行费用是同一件事，否则运营对不上账。三类都是「本不该发生、发生了要收钱」：
 * 逾期、损坏、取消。押金与预授权不是费用，不计入。
 */
exports.RENTAL_EXCEPTION_CHARGE_TYPES = ["overdue", "damage", "cancellation"];
//# sourceMappingURL=core.js.map