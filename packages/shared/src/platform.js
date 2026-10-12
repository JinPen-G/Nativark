"use strict";
/**
 * 平台与系统域契约：租户、会话、组织、账号角色、系统规则、字典与编号规则。
 *
 * 从原 8683 行单文件拆出。拆分只按依赖方向切，不改任何声明——`index.ts` 仍然
 * 整体再导出，因此上百个引用方一行都不用改。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_UI_CORNER_RADIUS_FULL = exports.ADMIN_UI_CORNER_RADIUS_DEFAULT = exports.ADMIN_UI_CORNER_RADIUS_MAX = exports.ADMIN_UI_CORNER_RADIUS_MIN = exports.ConfigStatus = exports.BillingMode = exports.PaymentStatus = exports.OperationLockStatus = exports.DispatchStatus = exports.ORDER_MAIN_STATUS_TRANSITIONS = exports.OrderMainStatus = exports.RentalMode = exports.RoleScope = exports.OrganizationType = exports.TenantStatus = void 0;
var TenantStatus;
(function (TenantStatus) {
    TenantStatus["Active"] = "active";
    TenantStatus["Frozen"] = "frozen";
    TenantStatus["Disabled"] = "disabled";
})(TenantStatus || (exports.TenantStatus = TenantStatus = {}));
var OrganizationType;
(function (OrganizationType) {
    OrganizationType["Operator"] = "operator";
    OrganizationType["CarShop"] = "car_shop";
    OrganizationType["Store"] = "store";
    OrganizationType["Station"] = "station";
})(OrganizationType || (exports.OrganizationType = OrganizationType = {}));
var RoleScope;
(function (RoleScope) {
    RoleScope["Operator"] = "operator";
    RoleScope["CarShop"] = "car_shop";
    RoleScope["Store"] = "store";
    RoleScope["Station"] = "station";
})(RoleScope || (exports.RoleScope = RoleScope = {}));
var RentalMode;
(function (RentalMode) {
    RentalMode["Rental"] = "rental_os";
    RentalMode["SelfService24h"] = "self_service_24h";
})(RentalMode || (exports.RentalMode = RentalMode = {}));
var OrderMainStatus;
(function (OrderMainStatus) {
    OrderMainStatus["PendingPayment"] = "pending_payment";
    OrderMainStatus["Reserved"] = "reserved";
    OrderMainStatus["PickupOverdue"] = "pickup_overdue";
    OrderMainStatus["Inspecting"] = "inspecting";
    OrderMainStatus["Renting"] = "renting";
    OrderMainStatus["Renewing"] = "renewing";
    OrderMainStatus["Overdue"] = "overdue";
    OrderMainStatus["AccidentProcessing"] = "accident_processing";
    OrderMainStatus["SettlementPending"] = "settlement_pending";
    OrderMainStatus["PaymentDue"] = "payment_due";
    OrderMainStatus["RefundPending"] = "refund_pending";
    OrderMainStatus["Completed"] = "completed";
    OrderMainStatus["Cancelled"] = "cancelled";
    OrderMainStatus["NoShow"] = "no_show";
    OrderMainStatus["Rejected"] = "rejected";
    OrderMainStatus["Closed"] = "closed";
})(OrderMainStatus || (exports.OrderMainStatus = OrderMainStatus = {}));
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
exports.ORDER_MAIN_STATUS_TRANSITIONS = {
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
var DispatchStatus;
(function (DispatchStatus) {
    DispatchStatus["Pending"] = "pending";
    DispatchStatus["PreAssigned"] = "pre_assigned";
    DispatchStatus["Locked"] = "locked";
    DispatchStatus["ManualReassigned"] = "manual_reassigned";
    DispatchStatus["Upgraded"] = "upgraded";
    DispatchStatus["ManualRequired"] = "dispatch_manual_required";
})(DispatchStatus || (exports.DispatchStatus = DispatchStatus = {}));
var OperationLockStatus;
(function (OperationLockStatus) {
    OperationLockStatus["Active"] = "active";
    OperationLockStatus["Interrupted"] = "interrupted";
    OperationLockStatus["Expired"] = "expired";
    OperationLockStatus["Released"] = "released";
})(OperationLockStatus || (exports.OperationLockStatus = OperationLockStatus = {}));
var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["Unpaid"] = "unpaid";
    PaymentStatus["DepositPaid"] = "deposit_paid";
    PaymentStatus["MonthlyBilling"] = "monthly_billing";
    PaymentStatus["PartialPaid"] = "partial_paid";
    PaymentStatus["Paid"] = "paid";
    PaymentStatus["PaymentDue"] = "payment_due";
    PaymentStatus["RefundPending"] = "refund_pending";
    PaymentStatus["Refunded"] = "refunded";
})(PaymentStatus || (exports.PaymentStatus = PaymentStatus = {}));
var BillingMode;
(function (BillingMode) {
    BillingMode["CustomerPay"] = "customer_pay";
    BillingMode["Monthly"] = "monthly";
})(BillingMode || (exports.BillingMode = BillingMode = {}));
var ConfigStatus;
(function (ConfigStatus) {
    ConfigStatus["Draft"] = "draft";
    ConfigStatus["Effective"] = "effective";
    ConfigStatus["Archived"] = "archived";
})(ConfigStatus || (exports.ConfigStatus = ConfigStatus = {}));
/** 管理后台圆角的可配置范围。数值只表达基础控件圆角，胶囊与圆形控件仍是平台保留形态。 */
exports.ADMIN_UI_CORNER_RADIUS_MIN = 8;
exports.ADMIN_UI_CORNER_RADIUS_MAX = 40;
exports.ADMIN_UI_CORNER_RADIUS_DEFAULT = 12;
/** 「极致圆角」离散档：跳过 20→999 之间的所有值，只允许直接取 20 或 999（CSS 常用胶囊值）。 */
exports.ADMIN_UI_CORNER_RADIUS_FULL = 999;
//# sourceMappingURL=platform.js.map