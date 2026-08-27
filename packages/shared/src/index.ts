export enum TenantStatus {
  Active = "active",
  Frozen = "frozen",
  Disabled = "disabled"
}

export enum OrganizationType {
  Operator = "operator",
  CarShop = "car_shop",
  Store = "store",
  Station = "station"
}

export enum RoleScope {
  Operator = "operator",
  CarShop = "car_shop",
  Store = "store",
  Station = "station"
}

export enum StoreRentalMode {
  Store = "store_rental",
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
 * `store-rental.service.ts` 的各个 action 处理器里，没有集中定义。
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

export enum ConfigStatus {
  Draft = "draft",
  Effective = "effective",
  Archived = "archived"
}

export interface TenantContext {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  categoryCode?: RentalCategoryCode;
  categoryName?: string;
  capabilities?: RentalCapability[];
}

export interface AuthUser {
  id: string;
  tenantId: string;
  account: string;
  displayName: string;
  roleNames: string[];
  roleIds?: string[];
  scope: RoleScope;
  dataScope?: SystemDataScope;
  organizationId?: string;
  organizationName?: string;
  isPlatformAdmin?: boolean;
  isSaasAdmin?: boolean;
  mustChangePassword?: boolean;
  permissions?: string[];
}

export interface LoginRequest {
  tenantCode: string;
  account: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tenant: TenantContext;
  user: AuthUser;
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
}

export interface RefreshSessionRequest {
  refreshToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface TenantSummary {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  enabledBusinessLines: string[];
  categoryCode?: RentalCategoryCode;
  categoryName?: string;
  capabilities?: RentalCapability[];
  /** 经营空间才是品类事实源；以下字段供 SaaS 管理面汇总展示。 */
  workspaceCount?: number;
  workspaceCategoryCodes?: RentalCategoryCode[];
  userCount?: number;
  organizationCount?: number;
  orderCount?: number;
  statusReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateTenantRequest {
  tenantName: string;
}

export interface UpdateTenantStatusRequest {
  status: TenantStatus;
  reason: string;
}

export interface OrganizationSummary {
  id: string;
  tenantId: string;
  parentId?: string;
  type: RoleScope;
  code: string;
  name: string;
  status: "enabled" | "disabled";
}

export interface SaveOrganizationRequest {
  id?: string;
  tenantId: string;
  parentId?: string;
  type: RoleScope;
  code: string;
  name: string;
  status: "enabled" | "disabled";
  operator?: string;
}

export interface PermissionLeaf {
  code: string;
  name: string;
  description?: string;
}

export interface PermissionModule {
  code: string;
  name: string;
  children: PermissionLeaf[];
}

export type SystemDataScope = "all" | "organization" | "store" | "own";

export interface SystemRoleRow {
  id: string;
  tenantId?: string;
  code: string;
  name: string;
  description?: string;
  scope: RoleScope;
  fixedAllPermissions: boolean;
  enabledBusinessScopes: string[];
  isActive: boolean;
  permissions: string[];
  buttonPermissions: string[];
  dataScope: SystemDataScope;
}

export interface SaveSystemRoleRequest {
  id?: string;
  tenantId?: string;
  code: string;
  name: string;
  description?: string;
  scope: RoleScope;
  enabledBusinessScopes: string[];
  permissions: string[];
  buttonPermissions?: string[];
  dataScope?: SystemDataScope;
  isActive: boolean;
}

export interface SystemUserRow {
  id: string;
  tenantId: string;
  account: string;
  displayName: string;
  phone?: string;
  organizationId?: string;
  organizationName?: string;
  roleIds: string[];
  roleNames: string[];
  scope: RoleScope;
  isPlatformAdmin: boolean;
  isSaasAdmin?: boolean;
  mustChangePassword?: boolean;
  temporaryPassword?: string;
  isActive: boolean;
  permissions: string[];
  dataScope: SystemDataScope;
}

export interface SaveSystemUserRequest {
  id?: string;
  /** SaaS 管理员可指定；租户内管理员省略时由当前会话租户补齐。 */
  tenantId?: string;
  account: string;
  displayName: string;
  phone?: string;
  organizationId?: string;
  roleIds: string[];
  isPlatformAdmin?: boolean;
  isSaasAdmin?: boolean;
  isActive: boolean;
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

export interface SystemSecurityBaselineConfig {
  loginRateLimit: {
    enabled: boolean;
    maxFailures: number;
    windowMinutes: number;
    lockMinutes: number;
  };
  passwordPolicy: {
    minLength: number;
    requireLetter: boolean;
    requireNumber: boolean;
    disallowDefaultPassword: boolean;
    expireDays: number;
  };
  masking: {
    phone: boolean;
    identityNo: boolean;
    driverLicenseNo: boolean;
    email: boolean;
    apiKey: boolean;
  };
  secondConfirmation: {
    enabled: boolean;
    actions: string[];
  };
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

export interface PlatformAuditLogRow {
  id: string;
  tenantId: string;
  /** 经营域审计必填；平台域动作不属于任何经营空间时为空。 */
  workspaceId?: string;
  action: string;
  operator: string;
  targetType: string;
  targetId?: string;
  detail: string;
  createdAt: string;
}

export interface PlatformAuditLogQuery {
  tenantId?: string;
  action?: string;
  operator?: string;
  targetType?: string;
  limit?: number;
}

export interface PlatformAuditResult {
  rows: PlatformAuditLogRow[];
  total: number;
}

export interface PlatformDictionaryItem {
  code: string;
  label: string;
  value: string;
  sortNo: number;
  enabled: boolean;
  remark?: string;
}

export interface PlatformDictionaryGroup {
  code: string;
  name: string;
  module: string;
  description?: string;
  items: PlatformDictionaryItem[];
  updatedAt: string;
  updatedBy: string;
}

export interface SavePlatformDictionaryGroupRequest {
  code: string;
  name: string;
  module: string;
  description?: string;
  items: PlatformDictionaryItem[];
  operator: string;
}

export interface PlatformNumberRule {
  code: string;
  name: string;
  module: string;
  prefix: string;
  datePattern: "yyyyMMdd" | "yyyyMM" | "yyMMdd" | "none";
  sequenceLength: number;
  currentSequence: number;
  resetCycle: "daily" | "monthly" | "yearly" | "never";
  enabled: boolean;
  sample: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SavePlatformNumberRuleRequest {
  code: string;
  name: string;
  module: string;
  prefix: string;
  datePattern: PlatformNumberRule["datePattern"];
  sequenceLength: number;
  currentSequence?: number;
  resetCycle: PlatformNumberRule["resetCycle"];
  enabled: boolean;
  operator: string;
}

export interface GeneratePlatformNumberRequest {
  code: string;
  operator: string;
}

export interface GeneratePlatformNumberResult {
  code: string;
  generatedNo: string;
  nextSequence: number;
}

export type PlatformFilterPresetScope =
  | "store-rental.orders"
  | "store-rental.vehicles"
  | "store-rental.members"
  | "store-rental.corporates"
  | "store-rental.stations"
  | "store-rental.vehicle-transfer"
  | "store-rental.contracts";

export interface PlatformFilterPreset {
  id: string;
  tenantId: string;
  scopeKey: PlatformFilterPresetScope;
  name: string;
  description?: string;
  filters: Record<string, unknown>;
  isDefault: boolean;
  isSystem: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface PlatformFilterPresetQuery {
  tenantId?: string;
  scopeKey?: PlatformFilterPresetScope;
}

export interface SavePlatformFilterPresetRequest {
  id?: string;
  tenantId?: string;
  scopeKey: PlatformFilterPresetScope;
  name: string;
  description?: string;
  filters: Record<string, unknown>;
  isDefault?: boolean;
  operator?: string;
}

export interface SetPlatformFilterPresetDefaultRequest {
  operator?: string;
}

export interface DeletePlatformFilterPresetResult {
  id: string;
  deleted: boolean;
}

export interface TenantBootstrapRequest {
  tenantCode: string;
  tenantName: string;
  categoryCode: RentalCategoryCode;
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

export interface StoreRentalOrderSummary {
  id: string;
  orderNo: string;
  mode: StoreRentalMode;
  memberId?: string;
  corporateId?: string;
  customerName: string;
  customerPhoneMasked: string;
  corporateShortName?: string;
  vehicleGroupName: string;
  plateNo?: string;
  pickupStoreName: string;
  returnStoreName: string;
  pickupStationName?: string;
  returnStationName?: string;
  pickupAt: string;
  returnAt: string;
  createdAt?: string;
  totalAmount: number;
  billingMode: BillingMode;
  mainStatus: OrderMainStatus;
  dispatchStatus: DispatchStatus;
  paymentStatus: PaymentStatus;
  operationLockStatus?: OperationLockStatus;
  operationLockOperator?: string;
  operationLockExpiresAt?: string;
  dynamicPricingVersion?: string;
  riskFlags: string[];
}

export interface StoreRentalOrderTimelineItem {
  at: string;
  actor: string;
  action: string;
}

export type StoreRentalOrderOperationRecordStatus =
  | "processing"
  | "completed"
  | "failed"
  | "duplicate"
  | "locked";

export interface StoreRentalOrderOperationRecord {
  id: string;
  orderId: string;
  orderNo: string;
  action: string;
  actionLabel: string;
  status: StoreRentalOrderOperationRecordStatus;
  idempotencyKey?: string;
  requestHash: string;
  lockStatus?: OperationLockStatus;
  operator?: string;
  message?: string;
  expiresAt?: string;
  completedAt?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export type StoreRentalOrderNotificationChannel =
  | "sms"
  | "email"
  | "in_app"
  | "phone"
  | "system";

export type StoreRentalOrderNotificationStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped";

export interface StoreRentalOrderNotificationRecord {
  id: string;
  orderId: string;
  orderNo: string;
  event: string;
  eventLabel: string;
  channel: StoreRentalOrderNotificationChannel;
  targetMasked: string;
  status: StoreRentalOrderNotificationStatus;
  templateCode: string;
  contentSummary: string;
  operator?: string;
  relatedAction?: string;
  idempotencyKey?: string;
  failReason?: string;
  sentAt?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface StoreRentalOrderFeeItem {
  name: string;
  amount: number;
}

export type StoreRentalFeeStage =
  | "booking"
  | "rental"
  | "pickup"
  | "return_settlement"
  | "cancellation"
  | "post_charge";

export type StoreRentalFeeSource = "system" | "manual";

export type StoreRentalFeeDirection = "charge" | "refund" | "waiver";

export type StoreRentalFeeStatus =
  | "pending"
  | "settled"
  | "waived"
  | "monthly_billing"
  | "voided";

export interface StoreRentalFeeLedgerItem {
  id: string;
  code: string;
  name: string;
  stage: StoreRentalFeeStage;
  source: StoreRentalFeeSource;
  direction: StoreRentalFeeDirection;
  status: StoreRentalFeeStatus;
  invoicedStatus?: string;
  amount: number;
  settledAmount: number;
  pendingAmount: number;
  description: string;
  snapshotRef: string;
  createdAt: string;
}

export type StoreRentalTransactionType =
  | "pre_auth_freeze"
  | "pre_auth_release"
  | "pre_auth_capture"
  | "payment"
  | "refund"
  | "waiver"
  | "monthly_bill";

export interface StoreRentalTransactionRecord {
  id: string;
  type: StoreRentalTransactionType;
  channel: "online" | "offline" | "internal";
  amount: number;
  status: "pending" | "success" | "failed";
  at: string;
  operator: string;
  relatedFeeIds: string[];
  note: string;
}

export type StoreRentalContractStatus =
  | "pending"
  | "signed"
  | "fallback_uploaded"
  | "voided";

export type StoreRentalContractPrintStatus =
  | "not_generated"
  | "generated"
  | "printed"
  | "downloaded";

export interface StoreRentalContractRecord {
  id: string;
  documentNo: string;
  type: "rental_contract" | "pickup_sheet" | "return_sheet" | "settlement_sheet";
  title: string;
  status: StoreRentalContractStatus;
  signMethod: "app" | "counter" | "offline_paper" | "system";
  signerName?: string;
  signedAt?: string;
  fileUrl?: string;
  operator: string;
  createdAt: string;
  templateCode?: string;
  printStatus?: StoreRentalContractPrintStatus;
  printCount?: number;
  lastPrintedAt?: string;
  downloadUrl?: string;
  externalProvider?: "reserved" | "mock";
  externalSignStatus?: "skipped" | "pending" | "signed" | "failed";
  snapshot: Record<string, unknown>;
}

export interface StoreRentalContractTemplate {
  code: StoreRentalContractRecord["type"];
  name: string;
  description: string;
  defaultSignMethod: StoreRentalContractRecord["signMethod"];
  autoGenerateScenes: Array<"pickup" | "return" | "settlement" | "manual">;
  mockIntegration: {
    printProvider: "reserved";
    signProvider: "reserved";
    autoSkipExternalCall: boolean;
  };
}

export interface StoreRentalContractCenterRow extends StoreRentalContractRecord {
  orderId: string;
  orderNo: string;
  customerName: string;
  customerPhoneMasked: string;
  corporateShortName?: string;
  vehicleGroupName: string;
  plateNo?: string;
  pickupStoreName: string;
  returnStoreName: string;
  pickupAt: string;
  returnAt: string;
  billingMode: BillingMode;
  mainStatus: OrderMainStatus;
  paymentStatus: PaymentStatus;
}

export interface StoreRentalContractCenterStats {
  total: number;
  pending: number;
  signed: number;
  fallbackUploaded: number;
  voided: number;
  printed: number;
  skippedExternalCalls: number;
}

export interface StoreRentalContractCenter {
  rows: StoreRentalContractCenterRow[];
  stats: StoreRentalContractCenterStats;
  templates: StoreRentalContractTemplate[];
}

export interface StoreRentalContractCenterQuery {
  keyword?: string;
  type?: StoreRentalContractRecord["type"];
  status?: StoreRentalContractStatus;
  orderStatus?: OrderMainStatus;
}

export interface StoreRentalContractPrintRequest {
  operator: string;
  mode?: "print" | "download";
}

export interface StoreRentalContractPrintResult {
  record: StoreRentalContractRecord;
  printJobId: string;
  downloadUrl: string;
  skippedExternalCall: true;
  message: string;
}

export interface StoreRentalContractMockSignRequest {
  operator: string;
  signerName?: string;
  signMethod?: StoreRentalContractRecord["signMethod"];
  fileUrl?: string;
}

export interface StoreRentalContractMockSignResult {
  record: StoreRentalContractRecord;
  skippedExternalCall: true;
  message: string;
}

export interface StoreRentalNotificationRecord {
  id: string;
  scene:
    | "order_created"
    | "pickup_completed"
    | "return_completed"
    | "payment_due"
    | "post_charge"
    | "order_terminal"
    | "manual";
  channel: "sms" | "app" | "email" | "manual";
  target: string;
  status: "pending" | "sent" | "failed" | "skipped";
  content: string;
  idempotencyKey?: string;
  operator: string;
  sentAt?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface StoreRentalOrderRemarkRecord {
  id: string;
  category:
    | "general"
    | "internal_note"
    | "customer_note"
    | "return_visit"
    | "fulfillment_followup"
    | "pickup"
    | "return"
    | "finance"
    | "risk"
    | "customer_followup";
  content: string;
  visibility: "internal" | "customer_visible";
  operator: string;
  followUpAt?: string;
  reminderAt?: string;
  responsibleUserId?: string;
  responsibleName?: string;
  status: "open" | "closed";
  closedAt?: string;
  closedBy?: string;
  closeNote?: string;
  createdAt: string;
}

export interface StoreRentalOperationLockRecord {
  id: string;
  stage: "pickup" | "return" | "settlement" | "fee";
  status: OperationLockStatus;
  operator: string;
  startedAt: string;
  expiresAt?: string;
  releasedAt?: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
}

export interface StoreRentalIdempotencyRecord {
  id: string;
  action: string;
  key: string;
  status: "processing" | "success" | "failed";
  requestHash?: string;
  responseSnapshot?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StoreRentalEventSnapshotRecord {
  id: string;
  snapshotRef: string;
  eventType:
    | "pickup_qualification"
    | "pickup_fund"
    | "pickup_delivery"
    | "return_inspection"
    | "return_settlement"
    | "settlement_confirmation"
    | "operation_lock_release"
    | "manual_adjust"
    | "extension"
    | "redirection"
    | "return_location_change"
    | "accident_registration"
    | "no_show"
    | "order_rejection"
    | "order_close"
    | "order_cancellation";
  title: string;
  triggerReason?: string;
  settlementTarget?: string;
  amount?: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  amountBreakdown?: Record<string, unknown>;
  payload: Record<string, unknown>;
  operator: string;
  occurredAt: string;
  createdAt: string;
}

export interface StoreRentalOrderFulfillmentRecords {
  contracts: StoreRentalContractRecord[];
  notifications: StoreRentalNotificationRecord[];
  remarks: StoreRentalOrderRemarkRecord[];
  operationLocks: StoreRentalOperationLockRecord[];
  idempotencyRecords: StoreRentalIdempotencyRecord[];
}

export interface StoreRentalFinancialOverview {
  totalReceivableAmount: number;
  customerReceivedAmount: number;
  monthlyBillingAmount: number;
  pendingAmount: number;
  refundAmount: number;
  postChargeAmount: number;
}

export interface StoreRentalFeeCenter {
  orderId: string;
  orderNo: string;
  feeLedgerItems: StoreRentalFeeLedgerItem[];
  transactionRecords: StoreRentalTransactionRecord[];
  financialOverview: StoreRentalFinancialOverview;
}

export interface CreateStoreRentalFeeRequest {
  code: string;
  name: string;
  stage: StoreRentalFeeStage;
  direction: StoreRentalFeeDirection;
  amount: number;
  description: string;
  operator: string;
}

export interface CreateStoreRentalTransactionRequest {
  type: StoreRentalTransactionType;
  channel: "online" | "offline" | "internal";
  amount: number;
  operator: string;
  relatedFeeIds: string[];
  note: string;
}

export interface WaiveStoreRentalFeeRequest {
  amount: number;
  operator: string;
  reason: string;
}

export interface CreateStoreRentalContractRequest {
  type: StoreRentalContractRecord["type"];
  title?: string;
  status?: StoreRentalContractStatus;
  signMethod?: StoreRentalContractRecord["signMethod"];
  signerName?: string;
  signedAt?: string;
  fileUrl?: string;
  templateCode?: string;
  printStatus?: StoreRentalContractPrintStatus;
  downloadUrl?: string;
  operator: string;
  snapshot?: Record<string, unknown>;
}

export interface CreateStoreRentalNotificationRequest {
  scene: StoreRentalNotificationRecord["scene"];
  channel: StoreRentalNotificationRecord["channel"];
  target: string;
  content: string;
  status?: StoreRentalNotificationRecord["status"];
  idempotencyKey?: string;
  operator: string;
  payload?: Record<string, unknown>;
}

export interface CreateStoreRentalRemarkRequest {
  category: StoreRentalOrderRemarkRecord["category"];
  content: string;
  visibility?: StoreRentalOrderRemarkRecord["visibility"];
  operator: string;
  followUpAt?: string;
  reminderAt?: string;
  responsibleUserId?: string;
  responsibleName?: string;
  status?: StoreRentalOrderRemarkRecord["status"];
}

export interface CloseStoreRentalRemarkRequest {
  operator: string;
  closeNote?: string;
}

export interface CreateStoreRentalOperationLockRequest {
  stage: StoreRentalOperationLockRecord["stage"];
  status?: OperationLockStatus;
  operator: string;
  expiresAt?: string;
  releasedAt?: string;
  idempotencyKey?: string;
  payload?: Record<string, unknown>;
}

export type StoreRentalInspectionStage = "pickup" | "return";

export interface StoreRentalInspectionRecord {
  id: string;
  stage: StoreRentalInspectionStage;
  at: string;
  operator: string;
  plateNo?: string;
  mileage?: number;
  fuelLevelPercent?: number;
  batteryLevelPercent?: number;
  cleanliness: "clean" | "normal" | "dirty";
  damageFound: boolean;
  damageDescription?: string;
  missingItems?: string;
  photoCount: number;
  customerSigned: boolean;
  memo?: string;
}

export interface StoreRentalSettlementSummary {
  rentalAmount: number;
  serviceFeeAmount: number;
  overtimeFeeAmount: number;
  extraMileageFeeAmount: number;
  damageFeeAmount: number;
  cleaningFeeAmount: number;
  discountAmount: number;
  finalReceivableAmount: number;
  returnFeeTotal: number;
  returnTransactionTotal: number;
  balanceDue: number;
  customerPayableAmount: number;
  customerRefundAmount: number;
  monthlyBillAmount: number;
  monthlyBillingPosted: boolean;
}

export interface StoreRentalOrderDetail extends StoreRentalOrderSummary {
  timeline: StoreRentalOrderTimelineItem[];
  feeItems: StoreRentalOrderFeeItem[];
  feeLedgerItems: StoreRentalFeeLedgerItem[];
  transactionRecords: StoreRentalTransactionRecord[];
  contracts: StoreRentalContractRecord[];
  notifications: StoreRentalNotificationRecord[];
  remarks: StoreRentalOrderRemarkRecord[];
  operationLocks: StoreRentalOperationLockRecord[];
  idempotencyRecords: StoreRentalIdempotencyRecord[];
  financialOverview: StoreRentalFinancialOverview;
  inspectionRecords: StoreRentalInspectionRecord[];
  settlementSummary: StoreRentalSettlementSummary;
  snapshots: {
    vehicleGroup: string;
    pickupStore: string;
    returnStore: string;
    pricingVersion: string;
    priceVersionId?: string;
    marketingPlanVersionId?: string;
    marketingPlanName?: string;
    termsVersion: string;
    events: StoreRentalEventSnapshotRecord[];
    dynamicPricingVersion?: string;
  };
  operationLockExpiredHint?: string;
  preAuthExpiredHint?: string;
  availableActions?: string[];
}

export interface StoreRentalOrderActionResult {
  orderId: string;
  orderNo: string;
  action: string;
  received: Record<string, unknown>;
  result: "mocked" | "updated";
  message: string;
  nextStatus: OrderMainStatus;
  nextPaymentStatus: PaymentStatus;
  nextDispatchStatus: DispatchStatus;
  nextRecommendedActions: string[];
}

export interface StoreRentalRuleConfig {
  version: string;
  status: ConfigStatus;
  effectiveAt: string;
  enabledModes: StoreRentalMode[];
  payment: {
    enabledGateways: Array<"jiekou" | "credit_card">;
    preAuthMode: "rental_ratio" | "fixed_amount";
    preAuthRatioPercent: number;
    fixedPreAuthAmount: number;
    maxPreAuthRatioPercent: number;
    enterpriseMonthlyPreAuthAmount: number;
    pickupFundHandling: Array<"performance_guarantee" | "preauth_to_rental">;
    preAuthProvider: "mock" | "payment_gateway";
  };
  pendingPayment: {
    enabled: boolean;
    holdMinutes: number;
    timeoutAction: "cancel_release";
  };
  oneWayReturn: {
    enabled: boolean;
    baseFeeAmount: number;
    crossCityFeeAmount: number;
    requireStorePairRule: boolean;
  };
  dispatch: {
    autoAssignEnabled: boolean;
    vehicleLockMode: "vehicle_group" | "specific_vehicle";
    minTurnoverMinutes: number;
    allowManualOverride: boolean;
  };
  durationBilling: {
    minBillableHours: number;
    chargeAsDayAfterHours: number;
    billingUnitMinutes: number;
  };
  pickupReturn: {
    allowEarlyPickup: boolean;
    earlyPickupGraceMinutes: number;
    turnaroundMinutes: number;
    operationLockEnabled: boolean;
    operationLockMinutes: number;
    closePickupWindowAction: "keep_reserved" | "auto_no_show";
    closeReturnWindowAction: "submit_return_inspection" | "keep_renting";
    allowEarlyReturn: boolean;
    earlyReturnRefundMode: "full_unused_days" | "no_refund";
    gracePeriodMinutes?: number;
    overtimeHourlyRate?: number;
    dailyThresholdHours?: number;
    overMileageRate?: number;
  };
  cancellation: {
    limitedFreeCancelEnabled: boolean;
    limitedFreeCancelMinutes: number;
    freeCancelBeforeHours: number;
    freeCancelRefundMode: "full_refund" | "deduct_fee";
    freeCancelServiceFeeAmount: number;
    responsibleCancelMode: "preauth_ratio" | "fixed_amount";
    responsibleCancelFixedAmount: number;
    responsibleCancelPreAuthRatioPercent: number;
    tieredDeductionEnabled: boolean;
  };
  noShow: {
    vehicleHoldHours: number;
    autoReleaseEnabled: boolean;
    noShowGraceMinutes: number;
    chargeNoShowFee: boolean;
    noShowFeeMode: "fixed_amount" | "preauth_ratio";
    noShowFeeAmount: number;
    noShowPreAuthRatioPercent: number;
  };
  overdue: {
    graceMinutes: number;
    billingUnitMinutes: number;
    feeMultiplier: number;
    penaltyEnabled: boolean;
    penaltyMode: "fixed_amount" | "percentage";
    fixedPenaltyAmount: number;
    feeCapAmount: number;
  };
  extension: {
    allowExtension: boolean;
    allowOverdueExtension: boolean;
    customerPayMode: "pay_now" | "settle_on_return";
    enterpriseMonthlyMode: "post_to_monthly_bill";
  };
  inspection: {
    requirePickupPhotos: boolean;
    requireReturnPhotos: boolean;
    damageReviewRole: string;
  };
  enterpriseBilling: {
    monthlySettlementEnabled: boolean;
    postOnOrderCompleted: boolean;
    requireCorporateSnapshot: boolean;
  };
}

export interface StoreRentalRuleVersionRecord {
  version: string;
  versionNo: number;
  status: ConfigStatus;
  savedBy: string;
  savedAt: string;
  effectiveAt: string;
  changeReason: string;
  snapshot: StoreRentalRuleConfig;
}

export type SaveStoreRentalRuleConfigRequest = StoreRentalRuleConfig & {
  operator?: string;
  changeReason?: string;
};

export interface PricingPlanSummary {
  id: string;
  code: string;
  name: string;
  status: ConfigStatus;
  currency: string;
  effectiveAt: string;
  version: string;
  vehicleGroupCount: number;
}

export interface PricingRuleLine {
  vehicleGroupCode: string;
  vehicleGroupName: string;
  baseDailyAmount: number;
  weekendDailyAmount: number;
  depositAmount: number;
}

export interface ServiceFeeRule {
  code: string;
  name: string;
  amount: number;
  chargeMode: "fixed" | "per_day";
  enabled: boolean;
  customerScope?: "personal" | "enterprise" | "all";
}

export interface PricingPlanDetail extends PricingPlanSummary {
  currentVersionId?: string;
  savedBy?: string;
  savedAt?: string;
  ruleLines: PricingRuleLine[];
  serviceFees: ServiceFeeRule[];
  durationRules: Array<{
    minDays: number;
    discountPercent: number;
  }>;
  storeAdjustments: Array<{
    pickupStoreCode: string;
    returnStoreCode: string;
    amount: number;
    name: string;
  }>;
  versions?: PriceVersionRecord[];
  schedules?: PriceAdjustmentSchedule[];
}

export interface PriceVersionRecord {
  version: string;
  title: string;
  savedBy: string;
  savedAt: string;
  source: "manual" | "schedule";
  changeReason?: string;
  values: Array<{
    vehicleGroupCode: string;
    vehicleGroupName: string;
    dailyPrice: number;
    depositAmount: number;
  }>;
}

export interface SavePricingPlanRequest {
  operator?: string;
  changeReason?: string;
  ruleLines: PricingRuleLine[];
}

export interface PriceAdjustmentSchedule {
  id: string;
  effectiveAt: string;
  summary: string;
  status: "scheduled" | "executed" | "cancelled";
  createdBy: string;
  createdAt: string;
  changes: Array<{
    vehicleGroupCode: string;
    vehicleGroupName: string;
    currentPrice: number;
    newPrice: number;
  }>;
}

export interface CreatePriceAdjustmentScheduleRequest {
  effectiveAt: string;
  summary: string;
  operator?: string;
  changes: PriceAdjustmentSchedule["changes"];
}

export type StoreRentalCustomerType = "personal" | "enterprise";
export type MarketingDiscountActionType = "discount" | "amount_off" | "fixed_price";

export interface MarketingDiscountAction {
  type: MarketingDiscountActionType;
  value: number;
  label: string;
}

export interface MarketingPlanRuleLine {
  id: string;
  name: string;
  vehicleGroupCodes: string[];
  membershipLevels: string[];
  minBillableDays?: number;
  bookingLeadDays?: number;
  weekdayAction: MarketingDiscountAction;
  holidayAction: MarketingDiscountAction;
  statutoryHolidayAction?: MarketingDiscountAction;
  maxDeductionAmount?: number;
}

export interface MarketingPlanSummary {
  id: string;
  code: string;
  name: string;
  displayName: string;
  status: ConfigStatus;
  version: string;
  versionId: string;
  customerScope: StoreRentalCustomerType | "all";
  supportedModes: StoreRentalMode[];
  priority: number;
  effectiveFrom: string;
  effectiveTo: string;
  storeCodes: string[];
  vehicleGroupCodes: string[];
  manualVerification: boolean;
  qualificationName?: string;
  requiredDocText?: string;
  weekdayRate: number;
  holidayRate: number;
  fixedDeductionAmount: number;
  description: string;
  updatedAt: string;
  updatedBy: string;
  ruleCount: number;
}

export interface MarketingPlanDetail extends MarketingPlanSummary {
  rules: MarketingPlanRuleLine[];
  versionHistory: MarketingPlanVersionRecord[];
}

export interface MarketingPlanVersionRecord {
  versionId: string;
  versionNo: number;
  status: ConfigStatus;
  savedBy: string;
  savedAt: string;
  changeReason: string;
  snapshot: Omit<MarketingPlanSummary, "ruleCount">;
  rules: MarketingPlanRuleLine[];
}

export interface SaveMarketingPlanRequest {
  id?: string;
  code?: string;
  name: string;
  displayName: string;
  status: ConfigStatus;
  customerScope: StoreRentalCustomerType | "all";
  supportedModes: StoreRentalMode[];
  priority: number;
  effectiveFrom: string;
  effectiveTo: string;
  storeCodes: string[];
  vehicleGroupCodes: string[];
  manualVerification: boolean;
  qualificationName?: string;
  requiredDocText?: string;
  weekdayRate: number;
  holidayRate: number;
  fixedDeductionAmount: number;
  description: string;
  rules: MarketingPlanRuleLine[];
  operator?: string;
  changeReason?: string;
}

export interface PricingQuoteRequest {
  planId: string;
  vehicleGroupCode: string;
  pickupStoreCode: string;
  returnStoreCode: string;
  pickupAt: string;
  returnAt: string;
  billingMode: BillingMode;
  serviceCodes?: string[];
  corporateId?: string;
  customerType?: StoreRentalCustomerType;
  membershipLevel?: string;
  marketingPlanId?: string;
  couponAmount?: number;
  pointsAmount?: number;
}

export interface PricingQuoteExplanationLine {
  code: string;
  title: string;
  detail: string;
  amount: number;
  source?: "base_price" | "dynamic_pricing" | "marketing" | "value_added_service" | "membership" | "store_adjustment" | "deposit";
}

export interface PricingQuoteBillingSegment {
  date: string;
  dayType: "weekday" | "holiday" | "statutory_holiday";
  baseDailyAmount: number;
  marketingActionLabel?: string;
  discountAmount: number;
}

export interface PricingQuoteResult {
  quoteNo: string;
  planId: string;
  currency: string;
  billableDays: number;
  rentalAmount: number;
  serviceFeeAmount: number;
  adjustmentAmount: number;
  discountAmount: number;
  depositAmount: number;
  payableAmount: number;
  monthlySettlementAmount?: number;
  feeItems: Array<{
    code: string;
    name: string;
    amount: number;
    source?: string;
  }>;
  selectedMarketingPlan?: {
    id: string;
    versionId: string;
    name: string;
    displayName: string;
    manualVerification: boolean;
    qualificationName?: string;
    requiredDocText?: string;
  };
  selectedMembershipPlan?: {
    id: string;
    code: string;
    name: string;
    orderDiscountPercent: number;
    depositDiscountPercent: number;
  };
  billingSegments: PricingQuoteBillingSegment[];
  explanationLines: PricingQuoteExplanationLine[];
  snapshots: {
    pricingVersion: string;
    priceVersionId: string;
    ruleVersion: string;
    vehicleGroupCode: string;
    pickupStoreCode: string;
    returnStoreCode: string;
    baseDailyAmount: number;
    standardDailyRate?: number;
    freeKm?: number;
    priceVersionTitle?: string;
    marketingPlanId?: string;
    marketingPlanVersionId?: string;
    marketingPlanName?: string;
    manualVerification?: boolean;
    qualificationName?: string;
    requiredDocText?: string;
    membershipPlanId?: string;
    membershipPlanCode?: string;
    membershipPlanName?: string;
    membershipOrderDiscountPercent?: number;
    membershipDepositDiscountPercent?: number;
    effectiveAt?: string;
    ruleEffectiveAt?: string;
    membershipVersion?: string;
    dynamicPricingScheduleId?: string;
    dynamicPricingVersion?: string;
    dynamicPricingPlanVersion?: string;
    dynamicPricingSummary?: string;
    dynamicPricingEffectiveAt?: string;
    dynamicPricingAdjustedDailyRate?: number;
    dynamicPricingAdjustmentAmount?: number;
  };
  warnings: string[];
}

export interface StoreRentalAvailabilityRequest {
  mode: StoreRentalMode;
  pickupStoreCode: string;
  returnStoreCode: string;
  pickupAt: string;
  returnAt: string;
  vehicleGroupCodes?: string[];
}

export interface StoreRentalAvailabilityGroup {
  vehicleGroupCode: string;
  vehicleGroupName: string;
  totalCount: number;
  availableCount: number;
  reservedCount: number;
  rentingCount: number;
  disabledCount: number;
  recommendedStationNames: string[];
  warnings: string[];
}

export interface StoreRentalAvailabilityResult {
  requestNo: string;
  checkedAt: string;
  ruleVersion: string;
  pickupStoreCode: string;
  returnStoreCode: string;
  groups: StoreRentalAvailabilityGroup[];
}

export interface WorkflowTransition {
  from: OrderMainStatus;
  action: string;
  to: OrderMainStatus;
  actorScope: RoleScope[];
  requiredPermission: string;
  integrationPlaceholders: string[];
}

export interface CreateStoreRentalOrderRequest {
  quoteNo: string;
  memberId?: string;
  corporateId?: string;
  customerName: string;
  customerPhone: string;
  corporateShortName?: string;
  billingMode: BillingMode;
  collectionMode: "deposit" | "pending" | "monthly";
}

export interface CreateStoreRentalOrderResult {
  id: string;
  orderNo: string;
  quoteNo: string;
  mainStatus: OrderMainStatus;
  paymentStatus: PaymentStatus;
  dispatchStatus: DispatchStatus;
  totalAmount: number;
  message: string;
  snapshots: PricingQuoteResult["snapshots"];
}

export type DispatchOptimizationResultStatus =
  | "optimized"
  | "unchanged"
  | "skipped"
  | "failed";

export type DispatchOptimizationReasonCode =
  | "ASSIGN_PENDING"
  | "REPLACE_CONFLICT"
  | "REPLACE_SCORE"
  | "KEEP_CURRENT"
  | "SKIP_MANUAL"
  | "SKIP_NEAR_LOCK"
  | "SKIP_NO_VEHICLE"
  | "APPLY_VALIDATION_FAILED";

export interface StoreRentalDispatchCandidate {
  vehicleId: string;
  licensePlate: string;
  vehicleGroupName: string;
  currentStoreName: string;
  currentStationName: string;
  operationStatus: VehicleInstanceSummary["operationStatus"];
  score: number;
  scoreText: string;
  reasonTags: string[];
  riskFlags: string[];
}

export interface StoreRentalDispatchOrderRow {
  orderId: string;
  orderNo: string;
  customerName: string;
  pickupAt: string;
  returnAt: string;
  pickupStoreName: string;
  returnStoreName: string;
  vehicleGroupName: string;
  currentPlateNo?: string;
  mainStatus: OrderMainStatus;
  dispatchStatus: DispatchStatus;
  totalAmount: number;
  occupancyHours: number;
  nearLock: boolean;
  riskFlags: string[];
  candidates: StoreRentalDispatchCandidate[];
}

export interface StoreRentalDispatchBoard {
  generatedAt: string;
  referenceDate: string;
  windowDays: 3 | 7 | 14;
  storeScopeLabel: string;
  rows: StoreRentalDispatchOrderRow[];
  vehicles: VehicleInstanceSummary[];
  vehicleGroups: VehicleGroupMaster[];
  metrics: {
    activeOrders: number;
    pendingOrders: number;
    preassignedOrders: number;
    lockedOrders: number;
    manualRequiredOrders: number;
    candidateVehicles: number;
  };
}

export interface StoreRentalDispatchOptimizeRequest {
  windowDays: 3 | 7 | 14;
  referenceDate?: string;
  storeName?: string;
  vehicleGroupName?: string;
  operator?: string;
}

export interface StoreRentalDispatchApplyRequest {
  planId?: string;
  operator?: string;
  rows: StoreRentalDispatchResultRow[];
}

export interface StoreRentalDispatchManualReassignRequest {
  orderId: string;
  targetVehicleId?: string;
  targetPlateNo?: string;
  reason?: string;
  memo?: string;
  operator?: string;
}

export type StoreRentalVehicleUnavailableReason =
  | "disabled"
  | "controlled"
  | "maintenance"
  | "accident"
  | "license_issue"
  | "insurance_issue"
  | "cleaning_unready"
  | "other";

export interface StoreRentalDispatchVehicleUnavailableRequest {
  orderId?: string;
  vehicleId?: string;
  plateNo?: string;
  reason: StoreRentalVehicleUnavailableReason;
  targetOperationStatus?: "controlled" | "maintenance" | "disabled";
  memo?: string;
  operator?: string;
  tryAutoReassign?: boolean;
}

export interface StoreRentalDispatchVehicleUnavailableOrderResult {
  orderId: string;
  orderNo: string;
  beforeVehicle?: string;
  targetVehicle?: string;
  beforeDispatchStatus: DispatchStatus;
  nextDispatchStatus: DispatchStatus;
  action:
    | "auto_reassigned"
    | "released_to_manual_queue"
    | "manual_protected_alert"
    | "skipped";
  reasonText: string;
  riskLevel: "low" | "medium" | "high";
}

export interface StoreRentalDispatchVehicleUnavailableResult {
  vehicleId?: string;
  plateNo: string;
  reason: StoreRentalVehicleUnavailableReason;
  targetOperationStatus: "controlled" | "maintenance" | "disabled";
  affectedCount: number;
  autoReassignedCount: number;
  manualQueueCount: number;
  protectedAlertCount: number;
  rows: StoreRentalDispatchVehicleUnavailableOrderResult[];
  message: string;
}

export interface StoreRentalDispatchHardLockRequest {
  orderIds?: string[];
  windowDays?: 3 | 7 | 14;
  referenceDate?: string;
  storeName?: string;
  operator?: string;
}

export interface StoreRentalDispatchResultRow {
  id: string;
  orderId: string;
  orderNo: string;
  customerName: string;
  pickupAt: string;
  returnAt: string;
  vehicleGroupName: string;
  beforeVehicle?: string;
  beforeVehicleId?: string;
  targetVehicle?: string;
  targetVehicleId?: string;
  resultStatus: DispatchOptimizationResultStatus;
  reasonCode: DispatchOptimizationReasonCode;
  reasonText: string;
  reasonDetail?: string;
  riskLevel: "low" | "medium" | "high";
  nearLock: boolean;
  applied?: boolean;
  failureReason?: string;
}

export interface StoreRentalDispatchPlan {
  planId: string;
  generatedAt: string;
  referenceDate: string;
  windowDays: 3 | 7 | 14;
  storeScopeLabel: string;
  metrics: {
    participatingOrders: number;
    preassignedOrders: number;
    pendingOrders: number;
    lockedOrders: number;
    manualProtectedOrders: number;
    nearLockOrders: number;
    candidateVehicles: number;
    optimizedRows: number;
    unchangedRows: number;
    skippedRows: number;
  };
  rows: StoreRentalDispatchResultRow[];
}

export interface StoreRentalDispatchApplyResult {
  planId?: string;
  appliedCount: number;
  failedCount: number;
  rows: StoreRentalDispatchResultRow[];
  message: string;
}

export type StoreRentalDispatchEventType =
  | "optimization_preview"
  | "optimization_apply"
  | "optimization_apply_failed"
  | "hard_lock_success"
  | "hard_lock_failed"
  | "manual_reassign"
  | "manual_required"
  | "vehicle_unavailable"
  | "ai_analysis"
  | "alert_closed"
  | "task_claimed"
  | "task_processed"
  | "task_closed";

export interface StoreRentalDispatchEvent {
  id: string;
  eventType: StoreRentalDispatchEventType;
  source: "system" | "manual" | "ai" | "job" | "accident_registration";
  title: string;
  orderId?: string;
  orderNo?: string;
  planId?: string;
  beforeVehicle?: string;
  targetVehicle?: string;
  reasonCode?: DispatchOptimizationReasonCode | "VEHICLE_UNAVAILABLE" | "MANUAL_ALERT";
  reasonText?: string;
  riskLevel: "low" | "medium" | "high";
  operator?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface StoreRentalAiDispatchAnalyzeRequest {
  windowDays: 3 | 7 | 14;
  referenceDate?: string;
  storeName?: string;
  vehicleGroupName?: string;
  operator?: string;
}

export interface StoreRentalAiDispatchPacketSummary {
  promptVersion: string;
  packetVersion: string;
  windowDays: 3 | 7 | 14;
  storeScopeLabel: string;
  orderCount: number;
  candidateVehicleCount: number;
  manualTaskCount: number;
  highRiskTaskCount: number;
}

export interface StoreRentalAiDispatchRiskRow {
  riskType: string;
  orderNo?: string;
  description: string;
  suggestion: string;
  severity: "低" | "中" | "高";
}

export interface StoreRentalAiDispatchRecommendation {
  orderId?: string;
  orderNo?: string;
  action: "preassign" | "hard_lock" | "manual_review" | "keep_current";
  targetVehicleId?: string;
  targetVehicle?: string;
  confidence: "low" | "medium" | "high";
  reasonText: string;
  applyReady: boolean;
}

export interface StoreRentalAiDispatchAnalysisResult {
  analysisId: string;
  generatedAt: string;
  mode: "mock";
  promptVersion: string;
  packetVersion: string;
  requestSummary: StoreRentalAiDispatchPacketSummary;
  riskRows: StoreRentalAiDispatchRiskRow[];
  recommendations: StoreRentalAiDispatchRecommendation[];
  event: StoreRentalDispatchEvent;
  message: string;
}

export type StoreRentalDispatchTaskType =
  | "unassigned"
  | "near_lock_unlocked"
  | "manual_required"
  | "vehicle_unavailable"
  | "manual_protected_invalid"
  | "accident_reassignment";

export interface StoreRentalDispatchTask {
  id: string;
  taskType: StoreRentalDispatchTaskType;
  taskStatus?: "open" | "claimed" | "processing" | "completed";
  claimedBy?: string;
  claimedAt?: string;
  completedBy?: string;
  completedAt?: string;
  priority: "low" | "medium" | "high";
  title: string;
  description: string;
  orderId: string;
  orderNo: string;
  customerName: string;
  pickupAt: string;
  returnAt: string;
  pickupStoreName: string;
  vehicleGroupName: string;
  currentPlateNo?: string;
  mainStatus: OrderMainStatus;
  dispatchStatus: DispatchStatus;
  dueAt?: string;
  reasonText: string;
  candidates: StoreRentalDispatchCandidate[];
  latestEvent?: StoreRentalDispatchEvent;
}

export interface StoreRentalDispatchTaskQuery {
  windowDays?: 3 | 7 | 14;
  referenceDate?: string;
  storeName?: string;
  vehicleGroupName?: string;
}

export interface StoreRentalDispatchCloseTaskRequest {
  taskId: string;
  orderId: string;
  taskType: StoreRentalDispatchTaskType;
  reason: string;
  operator?: string;
}

export interface StoreRentalDispatchTaskActionResult {
  taskId: string;
  orderId: string;
  orderNo: string;
  status: "closed" | "claimed" | "processing" | "completed";
  taskStatus?: "open" | "claimed" | "processing" | "completed";
  claimedBy?: string;
  claimedAt?: string;
  completedBy?: string;
  completedAt?: string;
  event: StoreRentalDispatchEvent;
  message: string;
}

export interface StoreRentalDispatchTaskPool {
  generatedAt: string;
  referenceDate: string;
  storeScopeLabel: string;
  metrics: {
    totalTasks: number;
    highPriorityTasks: number;
    manualRequiredTasks: number;
    vehicleUnavailableTasks: number;
    nearLockTasks: number;
  };
  tasks: StoreRentalDispatchTask[];
}

export interface StoreRentalDispatchEventQuery {
  orderId?: string;
  planId?: string;
  limit?: number;
  eventType?: string;
}

export interface StoreStationSummary {
  id: string;
  name: string;
  companyName?: string;
  storeCode?: string;
  stationCode?: string;
  parentStoreName: string;
  stationType: string;
  parkingLotType?: string;
  parkingCompany?: string;
  serviceCapabilities: string[];
  parkingTotal: number;
  parkingAvailable: number;
  status: "enabled" | "disabled";
  serviceStatus: "normal" | "paused" | "maintenance";
  address: string;
  longitude?: number;
  latitude?: number;
  contactName: string;
  contactPhone: string;
  email?: string;
  fax?: string;
  businessHours?: string;
  counterServiceHours?: string;
  accessMethod?: string;
  fixedParkingSpaces?: string[];
  parkingFeeRule?: string;
  description?: string;
  remark?: string;
  storeRentalEnabled: boolean;
  storeRentalServiceStatus?: "normal" | "paused";
  storeRentalManualHandover?: boolean;
  storeRentalManualInspection?: boolean;
  storeSelfServiceEnabled: boolean;
  storeSelfServiceStatus?: "normal" | "paused";
  selfServiceAllowNightReturn?: boolean;
  selfServicePickupMethods?: string[];
}

export interface StoreStationListQuery {
  keyword?: string;
  serviceCapability?: string;
  serviceStatus?: StoreStationSummary["serviceStatus"] | "paused";
  status?: StoreStationSummary["status"];
  scopeType?: StoreStationHierarchyNode["type"];
  scopeLabel?: string;
  organizationId?: string;
  page?: number;
  pageSize?: number;
}

export interface StoreStationListResult {
  rows: StoreStationSummary[];
  total: number;
  page: number;
  pageSize: number;
  stats: {
    total: number;
    enabled: number;
    disabled: number;
    normal: number;
    paused: number;
    maintenance: number;
  };
}

export interface StoreStationHierarchyNode {
  id: string;
  type: "all" | "company" | "store";
  label: string;
  parentId?: string;
  stationCount: number;
  children?: StoreStationHierarchyNode[];
}

export interface VehicleGroupMaster {
  id: string;
  vehicleType: string;
  brand: string;
  model: string;
  year: string;
  originType: string;
  seats: number;
  displacement: string;
  trunkCapacity: string;
  features: string[];
  storeProductGroupName: string;
  dailyPrice: number;
  freeKm: number;
  pricePerKm: number;
  status: "enabled" | "disabled";
  priceVersionId?: string;
  vehicleCount?: number;
  reservedOrderCount?: number;
  isSpecial?: boolean;
  minMemberLevel?: string;
  versionNote?: string;
}

export interface VehicleInstanceSummary {
  id: string;
  licensePlate: string;
  vin: string;
  vehicleGroupName: string;
  assetCompanyName: string;
  currentStoreName: string;
  currentStationName: string;
  operationStatus: "idle" | "reserved" | "renting" | "controlled" | "maintenance" | "disabled";
  enabled: boolean;
  currentServiceType: "STORE_STANDARD" | "STORE_24H";
  serviceTypes: Array<"STORE_STANDARD" | "STORE_24H">;
  mileage: number;
  color: string;
  cid?: string;
  isSpecial: boolean;
  disabledReason?: string;
  maintenanceReason?: string;
  tags?: string[];
  lastOperationAt?: string;
  lastOperationBy?: string;
}

export interface VehicleListQuery {
  keyword?: string;
  operationStatus?: VehicleInstanceSummary["operationStatus"];
  serviceType?: VehicleInstanceSummary["currentServiceType"];
  storeName?: string;
  page?: number;
  pageSize?: number;
}

export interface VehicleListResult {
  rows: VehicleInstanceSummary[];
  total: number;
  page: number;
  pageSize: number;
  availableStores: string[];
  availableStations: string[];
  stats: {
    total: number;
    idle: number;
    reserved: number;
    renting: number;
    controlled: number;
    maintenance: number;
    disabled: number;
  };
}

export interface VehicleDetailOrderRecord {
  orderId: string;
  orderNo: string;
  customerName: string;
  pickupAt: string;
  returnAt: string;
  pickupStoreName: string;
  returnStoreName: string;
  mainStatus: OrderMainStatus;
  dispatchStatus: DispatchStatus;
  totalAmount: number;
}

export interface VehicleLocationEvent {
  id: string;
  at: string;
  type: "pickup" | "return" | "transfer" | "manual_adjust" | "iot_sync";
  storeName: string;
  stationName: string;
  mileage: number;
  operator: string;
  source: "order" | "operation" | "iot";
  note?: string;
}

export interface CreateVehicleLocationEventRequest {
  at?: string;
  type: "pickup" | "return" | "transfer" | "manual_adjust" | "iot_sync";
  storeName: string;
  stationName: string;
  mileage: number;
  note?: string;
  operator?: string;
}

export interface UpdateVehicleLocationEventRequest {
  at?: string;
  type?: "pickup" | "return" | "transfer" | "manual_adjust" | "iot_sync";
  storeName?: string;
  stationName?: string;
  mileage?: number;
  note?: string;
  operator?: string;
}

export interface VehicleConditionPhotoRecord {
  id: string;
  at: string;
  scene: "pickup" | "return" | "maintenance" | "manual";
  operator: string;
  remark: string;
  photos: string[];
}

export interface CreateVehicleConditionPhotoRecordRequest {
  at?: string;
  scene: "pickup" | "return" | "maintenance" | "manual";
  remark: string;
  photos: string[];
  operator?: string;
}

export interface VehicleMaintenanceRecord {
  id: string;
  date: string;
  type: string;
  vendor: string;
  mileage: number;
  costAmount: number;
  status: "pending" | "processing" | "completed";
  nextDueAt?: string;
  nextDueMileage?: number;
  attachments?: string[];
  operator?: string;
  remark?: string;
}

export interface CreateVehicleMaintenanceRecordRequest {
  date?: string;
  type: string;
  vendor: string;
  mileage: number;
  costAmount: number;
  status: "pending" | "processing" | "completed";
  nextDueAt?: string;
  nextDueMileage?: number;
  attachments?: string[];
  remark?: string;
  operator?: string;
}

export interface UpdateVehicleMaintenanceRecordRequest {
  date?: string;
  type?: string;
  vendor?: string;
  mileage?: number;
  costAmount?: number;
  status?: "pending" | "processing" | "completed";
  nextDueAt?: string;
  nextDueMileage?: number;
  attachments?: string[];
  remark?: string;
  operator?: string;
}

export interface VehicleAccidentRecord {
  id: string;
  date: string;
  description: string;
  claimStatus: "pending" | "processing" | "closed";
  estimatedCostAmount: number;
  reportNo: string;
}

export interface CreateVehicleAccidentRecordRequest {
  date?: string;
  description: string;
  claimStatus: "pending" | "processing" | "closed";
  estimatedCostAmount: number;
  reportNo?: string;
  operator?: string;
}

export interface UpdateVehicleAccidentRecordRequest {
  date?: string;
  description?: string;
  claimStatus?: "pending" | "processing" | "closed";
  estimatedCostAmount?: number;
  reportNo?: string;
  operator?: string;
}

export interface VehicleOperationLog {
  id: string;
  at: string;
  operator: string;
  action: string;
  reason?: string;
  ip?: string;
}

export interface VehicleStatusRecheckSummary {
  checkedOrderCount: number;
  releasedOrderCount: number;
  manualQueueOrderNos: string[];
  reason: string;
}

export interface VehicleStatusChangeRecord {
  id: string;
  vehicleId: string;
  at: string;
  operator: string;
  fromEnabled: boolean;
  toEnabled: boolean;
  fromOperationStatus: VehicleInstanceSummary["operationStatus"];
  toOperationStatus: VehicleInstanceSummary["operationStatus"];
  reason?: string;
  impactedOrderCount: number;
  impactedOrderNos: string[];
}

export interface VehicleAttachmentRecord {
  id: string;
  vehicleId: string;
  category: "vehicle_photo" | "license" | "insurance" | "inspection" | "maintenance" | "other";
  name: string;
  url: string;
  source: "manual" | "reserved_adapter";
  operator: string;
  remark?: string;
  createdAt: string;
}

export interface SaveVehicleAttachmentRequest {
  id?: string;
  category: VehicleAttachmentRecord["category"];
  name: string;
  url: string;
  source?: VehicleAttachmentRecord["source"];
  operator?: string;
  remark?: string;
}

export interface StoreRentalVehicleDetail {
  vehicle: VehicleInstanceSummary;
  relatedOrders: VehicleDetailOrderRecord[];
  locationEvents: VehicleLocationEvent[];
  conditionPhotos: VehicleConditionPhotoRecord[];
  maintenanceRecords: VehicleMaintenanceRecord[];
  accidentRecords: VehicleAccidentRecord[];
  credentialRecords: VehicleCredentialRecord[];
  onboardItems: VehicleOnboardItemRecord[];
  tboxDevice?: TboxDeviceSummary;
  statusChangeRecords: VehicleStatusChangeRecord[];
  attachmentRecords: VehicleAttachmentRecord[];
  operationLogs: VehicleOperationLog[];
}

export interface UpdateVehicleStatusRequest {
  enabled?: boolean;
  operationStatus?: VehicleInstanceSummary["operationStatus"];
  reason?: string;
  operator?: string;
}

export interface VehicleStatusActionResult {
  vehicle: VehicleInstanceSummary;
  message: string;
  recheckSummary?: VehicleStatusRecheckSummary;
}

export type VehicleTransferStatus =
  | "pending"
  | "approved"
  | "departed"
  | "arrived"
  | "completed"
  | "cancelled";

export interface VehicleTransferTaskItem {
  vehicleId: string;
  licensePlate: string;
  sourceStoreName: string;
  sourceStationName: string;
  targetStoreName: string;
  targetStationName: string;
  targetServiceType: VehicleInstanceSummary["currentServiceType"];
  result: "pending" | "completed" | "failed";
  message?: string;
}

export interface VehicleTransferTask {
  id: string;
  taskNo: string;
  status: VehicleTransferStatus;
  sourceStoreName: string;
  sourceStationName: string;
  targetStoreName: string;
  targetStationName: string;
  targetServiceType: VehicleInstanceSummary["currentServiceType"];
  vehicleCount: number;
  reason?: string;
  operator: string;
  items: VehicleTransferTaskItem[];
  createdAt: string;
  approvedAt?: string;
  departedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  completedAt?: string;
}

export interface CreateVehicleTransferTaskRequest {
  vehicleIds: string[];
  targetStoreName: string;
  targetStationName: string;
  targetServiceType: VehicleInstanceSummary["currentServiceType"];
  reason: string;
  operator?: string;
}

export interface VehicleTransferTaskResult {
  task: VehicleTransferTask;
  vehicles: VehicleInstanceSummary[];
}

export interface AdvanceVehicleTransferTaskRequest {
  action: "approve" | "depart" | "arrive" | "cancel";
  operator?: string;
  reason?: string;
}

export type VehicleCredentialStatus = "valid" | "expiring" | "expired" | "missing";

export interface VehicleCredentialRecord {
  id: string;
  vehicleId: string;
  credentialType: "license" | "insurance" | "inspection" | "permit" | "other";
  credentialName: string;
  certNo: string;
  status: VehicleCredentialStatus;
  issueAt?: string;
  expiresAt?: string;
  reminderDays: number;
  attachments: string[];
  operator: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveVehicleCredentialRequest {
  id?: string;
  credentialType: VehicleCredentialRecord["credentialType"];
  credentialName: string;
  certNo: string;
  status?: VehicleCredentialStatus;
  issueAt?: string;
  expiresAt?: string;
  reminderDays?: number;
  attachments?: string[];
  operator?: string;
}

export type VehicleOnboardItemStatus = "normal" | "missing" | "damaged";

export interface VehicleOnboardItemRecord {
  id: string;
  vehicleId: string;
  category: "key" | "document" | "equipment" | "cleaning" | "other";
  itemName: string;
  standardQuantity: number;
  actualQuantity: number;
  status: VehicleOnboardItemStatus;
  priceAmount: number;
  checkedAt: string;
  operator: string;
  remark?: string;
}

export interface SaveVehicleOnboardItemRequest {
  id?: string;
  category: VehicleOnboardItemRecord["category"];
  itemName: string;
  standardQuantity: number;
  actualQuantity: number;
  status?: VehicleOnboardItemStatus;
  priceAmount?: number;
  checkedAt?: string;
  operator?: string;
  remark?: string;
}

export interface TboxDeviceSummary {
  id: string;
  cid: string;
  provider: string;
  modelNo: string;
  status: "active" | "inactive" | "fault";
  onlineStatus: "online" | "offline" | "unknown";
  boundVehicleId?: string;
  boundPlateNo?: string;
  boundVehicleGroupName?: string;
  currentStationName?: string;
  batteryLevel?: number;
  signalStrength?: number;
  lastHeartbeatAt?: string;
  lastCommandStatus?: "pending" | "success" | "failed";
}

export interface BindTboxDeviceRequest {
  vehicleId?: string;
  operator?: string;
}

export interface RunTboxCommandRequest {
  command: "LOCK_DOOR" | "UNLOCK_DOOR" | "FIND_CAR" | "SYNC_STATUS";
  operator?: string;
}

export interface TboxCommandRecord {
  id: string;
  deviceId: string;
  cid: string;
  vehiclePlateNo?: string;
  command: RunTboxCommandRequest["command"];
  status: "pending" | "success" | "failed";
  operator: string;
  note?: string;
  createdAt: string;
}

export interface TboxCommandResult {
  device: TboxDeviceSummary;
  command: TboxCommandRecord;
  message: string;
}

export interface StationCalendarDay {
  id: string;
  stationId: string;
  stationName: string;
  date: string;
  businessStatus: "open" | "closed" | "paused";
  openTime: string;
  closeTime: string;
  capacityLimit?: number;
  note?: string;
  operator: string;
  updatedAt: string;
}

export interface SaveStationCalendarDayRequest {
  date: string;
  businessStatus: StationCalendarDay["businessStatus"];
  openTime?: string;
  closeTime?: string;
  capacityLimit?: number;
  note?: string;
  operator?: string;
}

export interface StationCapacitySnapshot {
  id: string;
  stationId: string;
  stationName: string;
  date: string;
  totalSpaces: number;
  capacityLimit?: number;
  availableSpaces: number;
  reservedSpaces: number;
  occupiedVehicles: number;
  controlledVehicles: number;
  maintenanceVehicles: number;
  disabledVehicles: number;
  rentingVehicles: number;
  pendingPickupVehicles: number;
  pendingReturnVehicles: number;
  pickupQueueVehicles: number;
  returnQueueVehicles: number;
  queueVehicles: number;
  turnoverBufferMinutes: number;
  estimatedWaitMinutes: number;
  pressureLevel: "normal" | "busy" | "overloaded" | "closed";
  pressureReason?: string;
  businessStatus?: "open" | "closed" | "paused";
  closedByCalendar?: boolean;
  source: "system" | "manual";
  createdAt: string;
}

export interface StationCapacityRefreshResult {
  snapshots: StationCapacitySnapshot[];
  message: string;
}

export interface DeleteVehicleGroupResult {
  id: string;
  deleted: boolean;
  message: string;
}

export interface StoreValueAddedServiceSummary {
  id: string;
  name: string;
  code: string;
  category: "insurance" | "equipment" | "service";
  memberLimit: string;
  price: number;
  unit: "/天" | "/次";
  maxQuantity: number;
  trackInventory: boolean;
  totalStock?: number;
  currentStock?: number;
  minMemberTierRank?: number;
  corporateOnly?: boolean;
  maxPerOrder?: number;
  status: "enabled" | "disabled";
  version: string;
  description: string;
}

export interface MemberSummary {
  id: string;
  name: string;
  phoneMasked: string;
  source: string;
  levelName: string;
  pointsBalance: number;
  status: "pending_review" | "active" | "suspended" | "blacklisted";
  reviewStatus: "pending" | "approved" | "rejected";
  registerAt: string;
  totalOrders: number;
  totalSpendAmount: number;
  tags: string[];
  identityVerified: boolean;
  driverLicenseVerified: boolean;
}

export interface MemberListQuery {
  keyword?: string;
  status?: MemberSummary["status"];
  reviewStatus?: MemberSummary["reviewStatus"];
  tag?: string;
  page?: number;
  pageSize?: number;
}

export interface MemberListResult {
  rows: MemberSummary[];
  total: number;
  page: number;
  pageSize: number;
  availableTags: string[];
  stats: {
    total: number;
    active: number;
    pendingReview: number;
    blacklisted: number;
  };
}

export interface MemberTimelineRecord {
  id: string;
  at: string;
  operator: string;
  action: string;
  remark?: string;
}

export interface MemberDetail extends MemberSummary {
  phone: string;
  email?: string;
  identityNoMasked?: string;
  driverLicenseNoMasked?: string;
  birthday?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  notes?: string;
  riskNote?: string;
  referrerCustomerId?: string;
  recentOrderNos: string[];
  timeline: MemberTimelineRecord[];
  photos?: Record<string, string>;
}

export interface SaveMemberRequest {
  id?: string;
  name: string;
  phone: string;
  email?: string;
  levelName: string;
  status: "pending_review" | "active" | "suspended" | "blacklisted";
  source: string;
  tags: string[];
  identityVerified: boolean;
  driverLicenseVerified: boolean;
  identityNoMasked?: string;
  driverLicenseNoMasked?: string;
  birthday?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  notes?: string;
  riskNote?: string;
  referrerCustomerId?: string;
}

export interface ProcessMemberRiskRequest {
  action: "suspend" | "blacklist" | "restore";
  reason: string;
  operator?: string;
  tags?: string[];
}

export interface ProcessMemberRiskResult {
  member: MemberDetail;
  affectedOrderNos: string[];
  message: string;
}

export interface MemberReviewTask {
  id: string;
  memberId: string;
  memberName: string;
  phoneMasked: string;
  submittedAt: string;
  reviewStatus: "pending" | "approved" | "rejected";
  riskFlags: string[];
  documents: string[];
  remark?: string;
}

export interface ProcessMemberReviewRequest {
  action: "approve" | "reject";
  remark?: string;
  operator?: string;
}

export interface MembershipPlanSummary {
  id: string;
  code: string;
  name: string;
  tierRank: number;
  status: "enabled" | "disabled";
  upgradeCondition: string;
  benefitSummary: string;
  orderDiscountPercent: number;
  depositDiscountPercent: number;
  freeServiceCount: number;
}

export interface SaveMembershipPlanRequest {
  id?: string;
  code: string;
  name: string;
  tierRank: number;
  status: "enabled" | "disabled";
  upgradeCondition: string;
  benefitSummary: string;
  orderDiscountPercent: number;
  depositDiscountPercent: number;
  freeServiceCount: number;
}

export interface CorporateContact {
  id: string;
  name: string;
  title: string;
  phone: string;
  email?: string;
}

export interface CorporateContractRecord {
  id: string;
  contractNo: string;
  contractName: string;
  status: "draft" | "active" | "expiring" | "expired" | "terminated";
  startDate: string;
  endDate: string;
  amount: number;
  linkedStores: string[];
  statementEmail?: string;
  attachments: string[];
  remark?: string;
}

export interface CorporateSummary {
  id: string;
  shortName: string;
  fullName: string;
  status: "active" | "paused" | "disabled";
  creditLimitAmount: number;
  accountPeriodDays: number;
  settlementMode: "monthly" | "prepaid";
  contactName: string;
  contactPhone: string;
  activeOrderCount: number;
  unpaidAmount: number;
  contractStatus: "active" | "expiring" | "expired";
}

export interface CorporateListQuery {
  keyword?: string;
  status?: CorporateSummary["status"];
  contractStatus?: CorporateSummary["contractStatus"];
  page?: number;
  pageSize?: number;
}

export interface CorporateListResult {
  rows: CorporateSummary[];
  total: number;
  page: number;
  pageSize: number;
  stats: {
    total: number;
    active: number;
    paused: number;
    disabled: number;
    expiringContracts: number;
    expiredContracts: number;
  };
}

export interface CorporateDetail extends CorporateSummary {
  billingEmail?: string;
  billingCycleDay: number;
  statementEmail?: string;
  reconciliationContactName?: string;
  reconciliationContactPhone?: string;
  autoGenerateStatement: boolean;
  creditWarningAmount?: number;
  invoiceTitle?: string;
  linkedStores: string[];
  notes?: string;
  recentOrderNos: string[];
  contacts: CorporateContact[];
  contracts: CorporateContractRecord[];
}

export interface SaveCorporateRequest {
  id?: string;
  shortName: string;
  fullName: string;
  status: "active" | "paused" | "disabled";
  creditLimitAmount: number;
  accountPeriodDays: number;
  billingCycleDay: number;
  settlementMode: "monthly" | "prepaid";
  contactName: string;
  contactPhone: string;
  billingEmail?: string;
  statementEmail?: string;
  reconciliationContactName?: string;
  reconciliationContactPhone?: string;
  autoGenerateStatement: boolean;
  creditWarningAmount?: number;
  invoiceTitle?: string;
  linkedStores: string[];
  notes?: string;
  contacts: CorporateContact[];
  contracts: CorporateContractRecord[];
}

export interface CorporateMonthlyBillLineItem {
  id: string;
  orderId: string;
  orderNo: string;
  occurredAt: string;
  customerName: string;
  vehicleGroupName: string;
  pickupStoreName: string;
  returnStoreName: string;
  amount: number;
  feeCodes: string[];
  remark?: string;
}

export interface CorporateMonthlyBillSummary {
  id: string;
  billNo: string;
  corporateId: string;
  corporateShortName: string;
  period: string;
  status: "draft" | "posted" | "partially_paid" | "paid" | "void";
  generatedAt: string;
  dueDate: string;
  orderCount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  lineItems: CorporateMonthlyBillLineItem[];
}

export interface SettleCorporateMonthlyBillRequest {
  amount: number;
  channel: "online" | "offline" | "internal";
  operator?: string;
  note?: string;
}

export type InfraAdapterCapability =
  | "payment"
  | "pre_auth"
  | "sms"
  | "email"
  | "app_push"
  | "e_contract"
  | "tbox"
  | "ai_dispatch"
  | "export"
  | "print"
  | "file";

export interface InfraCapabilityCard {
  capability: InfraAdapterCapability;
  name: string;
  provider: string;
  mode: "mock" | "reserved" | "real";
  status: "enabled" | "disabled" | "not_configured";
  description: string;
  lastCalledAt?: string;
  totalLogs: number;
  nextIntegrationPoint: string;
}

export interface FileAssetSummary {
  id: string;
  businessModule: string;
  businessType: string;
  businessId?: string;
  fileName: string;
  fileExt?: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  storageKey: string;
  publicUrl?: string;
  uploadScene: string;
  status: "active" | "deleted" | string;
  uploadedBy?: string;
  createdAt: string;
}

export interface FileAssetQuery {
  businessModule?: string;
  businessType?: string;
  businessId?: string;
  uploadScene?: string;
  status?: string;
  limit?: number;
}

export interface CreateFileAssetRequest {
  businessModule: string;
  businessType: string;
  businessId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  uploadScene: string;
  uploadedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCorporateContractAttachmentRequest {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  uploadedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface CorporateContractAttachmentResult {
  corporate: CorporateDetail;
  contract: CorporateContractRecord;
  file: FileAssetSummary;
}

export interface NotificationTemplateSummary {
  id: string;
  code: string;
  name: string;
  category: string;
  trigger: string;
  channels: Array<"APP" | "SMS" | "EMAIL" | string>;
  content: string;
  enabled: boolean;
  updatedAt: string;
}

export interface NotificationSendLogSummary {
  id: string;
  templateCode?: string;
  businessType: string;
  businessId?: string;
  targetType: "member" | "corporate" | "operator" | string;
  targetName?: string;
  targetMasked?: string;
  channels: Array<"APP" | "SMS" | "EMAIL" | string>;
  provider: string;
  status: "mock_success" | "mock_failed" | "skipped" | string;
  sentAt?: string;
  createdAt: string;
  requestJson: Record<string, unknown>;
  responseJson?: Record<string, unknown>;
}

export interface SendMockNotificationRequest {
  templateCode?: string;
  businessType: string;
  businessId?: string;
  targetType: "member" | "corporate" | "operator" | string;
  targetName?: string;
  targetMasked?: string;
  channels: Array<"APP" | "SMS" | "EMAIL" | string>;
  variables?: Record<string, string | number>;
  operator?: string;
}

export interface AdapterLogSummary {
  id: string;
  provider: string;
  capability: InfraAdapterCapability | string;
  operation: string;
  businessType?: string;
  businessId?: string;
  status: "mock_success" | "mock_failed" | "reserved" | "skipped" | string;
  requestJson: Record<string, unknown>;
  responseJson?: Record<string, unknown>;
  errorMessage?: string;
  createdAt: string;
}

export interface InvokeMockAdapterRequest {
  provider: string;
  capability: InfraAdapterCapability | string;
  operation: string;
  businessType?: string;
  businessId?: string;
  payload?: Record<string, unknown>;
  operator?: string;
}

export interface AsyncJobSummary {
  id: string;
  jobType: string;
  businessType?: string;
  businessId?: string;
  status: "queued" | "running" | "success" | "failed" | "skipped" | string;
  attempt: number;
  maxAttempts: number;
  scheduledAt?: string;
  startedAt?: string;
  finishedAt?: string;
  operator?: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAsyncJobRequest {
  jobType: string;
  businessType?: string;
  businessId?: string;
  scheduledAt?: string;
  payload?: Record<string, unknown>;
  operator?: string;
}

export type DataExchangeOperation = "export" | "import_validate" | "template_download";

export interface DataExchangeTemplateSummary {
  templateCode: string;
  targetModule: "store-rental" | string;
  targetObject: "stations" | "vehicles" | "members" | "corporates" | "orders" | string;
  name: string;
  operation: DataExchangeOperation;
  format: "xlsx" | "csv" | string;
  fields: string[];
  mockFileName: string;
  enabled: boolean;
  nextIntegrationPoint: string;
}

export interface CreateDataExchangeJobRequest {
  operation: DataExchangeOperation;
  targetModule: "store-rental" | string;
  targetObject: DataExchangeTemplateSummary["targetObject"];
  templateCode?: string;
  sourceFileAssetId?: string;
  sourceFileName?: string;
  filters?: Record<string, unknown>;
  importMode?: "validate_only" | "append" | "upsert" | string;
  operator?: string;
}

export interface DataExchangeJobResult {
  job: AsyncJobSummary;
  sourceFileAsset?: FileAssetSummary;
}

export interface PrintJobSummary {
  id: string;
  documentNo: string;
  documentType: string;
  templateCode: string;
  businessType: string;
  businessId?: string;
  status: "mock_generated" | "queued" | "failed" | string;
  fileAssetId?: string;
  operator?: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePrintJobRequest {
  documentType: "pickup_sheet" | "return_sheet" | "rental_contract" | "invoice" | string;
  templateCode: string;
  businessType: string;
  businessId?: string;
  payload?: Record<string, unknown>;
  operator?: string;
}

export interface TBoxDeviceSummary {
  id: string;
  cid: string;
  simNo?: string;
  model: string;
  status: "bound" | "unbound" | "offline" | "fault" | string;
  boundVehicleId?: string;
  boundPlateNo?: string;
  vehicleModel?: string;
  firmwareVersion?: string;
  appVersion?: string;
  warrantyExpireAt?: string;
  supportsIButton: boolean;
  iButtonCode?: string;
  powerOnAt?: string;
  lastHeartbeatAt?: string;
  telemetry?: Record<string, unknown>;
  updatedAt: string;
}

export interface SaveTBoxDeviceRequest {
  id?: string;
  cid: string;
  simNo?: string;
  model: string;
  status?: TBoxDeviceSummary["status"];
  firmwareVersion?: string;
  appVersion?: string;
  warrantyExpireAt?: string;
  supportsIButton?: boolean;
  iButtonCode?: string;
}

export interface BindTBoxDeviceRequest {
  vehicleId?: string;
  plateNo?: string;
  vehicleModel?: string;
  operator?: string;
}

export interface InfraDashboardResult {
  generatedAt: string;
  capabilities: InfraCapabilityCard[];
  files: FileAssetSummary[];
  notificationTemplates: NotificationTemplateSummary[];
  notificationLogs: NotificationSendLogSummary[];
  adapterLogs: AdapterLogSummary[];
  jobs: AsyncJobSummary[];
  dataExchangeTemplates: DataExchangeTemplateSummary[];
  printJobs: PrintJobSummary[];
  tboxDevices: TBoxDeviceSummary[];
}

export type FinanceDocumentType = "invoice" | "receipt";

export type FinanceDocumentStatus = "draft" | "issued" | "sent" | "voided";

export type FinanceDocumentAuditAction =
  | "created"
  | "updated"
  | "issued"
  | "sent"
  | "voided"
  | "reissued"
  | string;

export interface FinanceDocumentAuditItem {
  at: string;
  operator?: string;
  action: FinanceDocumentAuditAction;
  remark?: string;
  relatedDocumentNo?: string;
  relatedFeeIds?: string[];
}

export type FinanceManualAdjustmentDirection =
  | "charge"
  | "refund"
  | "waiver";

export type FinanceManualAdjustmentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "posted";

export type FinancePreAuthorizationStatus =
  | "pending"
  | "frozen"
  | "partially_captured"
  | "captured"
  | "released"
  | "expired"
  | "failed";

export type FinancePreAuthorizationChannel = "online" | "offline" | "internal";

export type FinanceReconciliationStatus = "matched" | "pending" | "exception";

export interface FinanceOverviewMetrics {
  customerReceivedAmount: number;
  preAuthFrozenAmount: number;
  refundAmount: number;
  monthlyBillingAmount: number;
  monthlyUnpaidAmount: number;
  invoiceIssuedAmount: number;
  pendingAdjustmentAmount: number;
  exceptionCount: number;
}

export interface FinanceTransactionRow {
  id: string;
  orderId?: string;
  orderNo?: string;
  corporateId?: string;
  corporateShortName?: string;
  customerName?: string;
  type: StoreRentalTransactionType | "manual_adjustment";
  channel: "online" | "offline" | "internal";
  amount: number;
  status: "pending" | "success" | "failed";
  at: string;
  operator: string;
  billingMode?: BillingMode;
  relatedFeeIds: string[];
  note?: string;
}

export interface FinanceDocumentRow {
  id: string;
  documentNo: string;
  type: FinanceDocumentType;
  status: FinanceDocumentStatus;
  orderId?: string;
  orderNo?: string;
  memberId?: string;
  corporateId?: string;
  corporateShortName?: string;
  monthlyBillId?: string;
  customerName: string;
  title: string;
  taxNo?: string;
  email?: string;
  amount: number;
  issueSource: "manual" | "order" | "monthly_bill" | string;
  relatedFeeIds: string[];
  originalDocumentId?: string;
  originalDocumentNo?: string;
  replacementDocumentId?: string;
  replacementDocumentNo?: string;
  issuedAt?: string;
  voidedAt?: string;
  voidReason?: string;
  voidedBy?: string;
  reissuedAt?: string;
  createdBy?: string;
  remark?: string;
  auditTrail: FinanceDocumentAuditItem[];
  createdAt: string;
}

export interface SaveFinanceDocumentRequest {
  id?: string;
  documentNo?: string;
  type: FinanceDocumentType;
  status: FinanceDocumentStatus;
  orderId?: string;
  orderNo?: string;
  memberId?: string;
  corporateId?: string;
  corporateShortName?: string;
  monthlyBillId?: string;
  customerName: string;
  title: string;
  taxNo?: string;
  email?: string;
  amount: number;
  issueSource?: "manual" | "order" | "monthly_bill" | string;
  relatedFeeIds?: string[];
  originalDocumentId?: string;
  originalDocumentNo?: string;
  replacementDocumentId?: string;
  replacementDocumentNo?: string;
  issuedAt?: string;
  voidReason?: string;
  voidedBy?: string;
  reissuedAt?: string;
  createdBy?: string;
  remark?: string;
  auditTrail?: FinanceDocumentAuditItem[];
}

export interface FinanceManualAdjustmentRow {
  id: string;
  adjustmentNo: string;
  orderId?: string;
  orderNo?: string;
  memberId?: string;
  corporateId?: string;
  corporateShortName?: string;
  customerName?: string;
  category: string;
  direction: FinanceManualAdjustmentDirection;
  targetBillingMode: BillingMode;
  amount: number;
  status: FinanceManualAdjustmentStatus;
  reason: string;
  operator: string;
  approvedBy?: string;
  approvalRemark?: string;
  postedFeeId?: string;
  postedTransactionId?: string;
  postedAt?: string;
  createdAt: string;
}

export interface SaveFinanceManualAdjustmentRequest {
  orderId?: string;
  orderNo?: string;
  memberId?: string;
  corporateId?: string;
  corporateShortName?: string;
  customerName?: string;
  category: string;
  direction: FinanceManualAdjustmentDirection;
  targetBillingMode: BillingMode;
  amount: number;
  reason: string;
  operator?: string;
}

export interface FinancePreAuthorizationRow {
  id: string;
  preAuthNo: string;
  orderId?: string;
  orderNo?: string;
  memberId?: string;
  corporateId?: string;
  corporateShortName?: string;
  customerName?: string;
  status: FinancePreAuthorizationStatus;
  channel: FinancePreAuthorizationChannel;
  provider: string;
  authorizedAmount: number;
  capturedAmount: number;
  releasedAmount: number;
  remainingAmount: number;
  currency: string;
  authCode?: string;
  channelReferenceNo?: string;
  paymentMethod?: string;
  frozenAt?: string;
  capturedAt?: string;
  releasedAt?: string;
  expiresAt?: string;
  operator?: string;
  remark?: string;
  createdAt: string;
}

export interface SaveFinancePreAuthorizationRequest {
  id?: string;
  preAuthNo?: string;
  orderId?: string;
  orderNo?: string;
  memberId?: string;
  corporateId?: string;
  corporateShortName?: string;
  customerName?: string;
  status: FinancePreAuthorizationStatus;
  channel: FinancePreAuthorizationChannel;
  provider?: string;
  authorizedAmount: number;
  capturedAmount?: number;
  releasedAmount?: number;
  currency?: string;
  authCode?: string;
  channelReferenceNo?: string;
  paymentMethod?: string;
  frozenAt?: string;
  capturedAt?: string;
  releasedAt?: string;
  expiresAt?: string;
  operator?: string;
  remark?: string;
}

export interface ProcessFinanceManualAdjustmentRequest {
  action: "approve" | "reject";
  operator?: string;
  remark?: string;
}

export interface FinanceReconciliationRow {
  id: string;
  sourceType: "transaction" | "monthly_bill" | "manual_adjustment";
  sourceNo: string;
  occurredAt: string;
  counterparty: string;
  amount: number;
  status: FinanceReconciliationStatus;
  issue?: string;
  suggestedAction?: string;
}

export type StoreRentalReportPeriod = "today" | "7d" | "30d" | "custom";

export type StoreRentalReportType =
  | "overview"
  | "orders"
  | "vehicles"
  | "finance"
  | "ops"
  | "audit"
  | "risk";

export interface StoreRentalReportQuery {
  tenantId?: string;
  from?: string;
  to?: string;
  period?: StoreRentalReportPeriod;
  storeName?: string;
  vehicleGroupName?: string;
  billingMode?: BillingMode | "all";
  mainStatuss?: string[];
  riskCategory?: string;
  orderId?: string;
  memberId?: string;
}

export interface StoreRentalMetricCard {
  key: string;
  label: string;
  value: number;
  unit?: string;
  displayValue: string;
  trendText?: string;
  severity: "normal" | "success" | "warning" | "danger" | "info";
}

export interface StoreRentalNamedMetric {
  name: string;
  value: number;
  amount?: number;
  percent?: number;
  settledAmount?: number;
  pendingAmount?: number;
  riskCount?: number;
  refundAmount?: number;
  waiverAmount?: number;
  completedCount?: number;
  cancelledCount?: number;
  monthlyCount?: number;
  completionRate?: number;
  avgOrderValue?: number;
  settlementRate?: number;
  riskRate?: number;
  statusBreakdown?: Record<string, number>;
}

export interface StoreRentalTimeSeriesPoint {
  label: string;
  orderCount: number;
  revenueAmount: number;
  settlementAmount: number;
}

export interface StoreRentalReportDashboard {
  generatedAt: string;
  range: {
    from: string;
    to: string;
    period: StoreRentalReportPeriod;
  };
  metricCards: StoreRentalMetricCard[];
  orderFunnel: StoreRentalNamedMetric[];
  vehicleStatusDistribution: StoreRentalNamedMetric[];
  weeklyRevenue: StoreRentalTimeSeriesPoint[];
  topStores: StoreRentalNamedMetric[];
  topVehicleGroups: StoreRentalNamedMetric[];
  riskTrend: StoreRentalNamedMetric[];
  financeSummary: {
    receivableAmount: number;
    settledAmount: number;
    pendingAmount: number;
    refundAmount: number;
    waiverAmount: number;
    monthlyBillingAmount: number;
    monthlyBillTotalAmount: number;
    monthlyBillPaidAmount: number;
    monthlyBillBalanceAmount: number;
  };
}

export interface StoreRentalOrderReportRow {
  orderId: string;
  orderNo: string;
  customerName: string;
  corporateShortName?: string;
  vehicleGroupName: string;
  plateNo?: string;
  pickupStoreName: string;
  returnStoreName: string;
  pickupAt: string;
  returnAt: string;
  mainStatus: OrderMainStatus;
  dispatchStatus: DispatchStatus;
  paymentStatus: PaymentStatus;
  billingMode: BillingMode;
  totalAmount: number;
  settledAmount: number;
  pendingAmount: number;
  riskFlags: string[];
}

export interface StoreRentalOrdersReport {
  generatedAt: string;
  summary: {
    totalOrders: number;
    pendingOrders: number;
    inProgressOrders: number;
    settlementOrders: number;
    riskOrders: number;
    monthlyOrders: number;
    totalSettledAmount: number;
    totalPendingAmount: number;
    totalAmount: number;
    completedOrders: number;
    cancelledOrders: number;
  };
  byStore: StoreRentalNamedMetric[];
  byVehicleGroup: StoreRentalNamedMetric[];
  byRoute: StoreRentalNamedMetric[];
  byStatus: StoreRentalNamedMetric[];
  byBillingMode: StoreRentalNamedMetric[];
  byStoreVehicleGroup: Array<{
    storeName: string;
    vehicleGroupName: string;
    count: number;
    amount: number;
    settledAmount: number;
    pendingAmount: number;
    riskCount: number;
    completionRate: number;
  }>;
  rows: StoreRentalOrderReportRow[];
}

export interface StoreRentalVehicleReportRow {
  vehicleId: string;
  plateNo: string;
  vehicleGroupName: string;
  assetCompanyName: string;
  currentStoreName: string;
  currentStationName: string;
  operationStatus: VehicleInstanceSummary["operationStatus"];
  mileage: number;
  orderCount: number;
  revenueAmount: number;
  utilizationPercent: number;
  maintenanceCostAmount: number;
  accidentCount: number;
}

export interface StoreRentalVehiclesReport {
  generatedAt: string;
  summary: {
    totalVehicles: number;
    rentableVehicles: number;
    rentingVehicles: number;
    maintenanceVehicles: number;
    disabledVehicles: number;
    utilizationPercent: number;
  };
  rows: StoreRentalVehicleReportRow[];
}

export interface StoreRentalFinanceReportRow {
  orderNo: string;
  customerName: string;
  corporateShortName?: string;
  billingMode: BillingMode;
  receivableAmount: number;
  settledAmount: number;
  pendingAmount: number;
  refundAmount: number;
  waiverAmount: number;
  monthlyBillingAmount: number;
  paymentStatus: PaymentStatus;
  occurredAt: string;
}

export interface StoreRentalFinanceReport {
  generatedAt: string;
  summary: StoreRentalReportDashboard["financeSummary"];
  rows: StoreRentalFinanceReportRow[];
  monthlyBills: CorporateMonthlyBillSummary[];
  reconciliation?: StoreRentalFinanceReconciliation;
}

export interface StoreRentalFinanceReconciliationDimension {
  totalAmount: number;
  count: number;
}

export interface StoreRentalFinanceReconciliation {
  collections: { totalAmount: number; count: number };
  refunds: { totalAmount: number; count: number };
  waivers: { totalAmount: number; count: number };
  monthlyBills: { totalAmount: number; count: number; unpaidAmount: number };
  netAmount: number;
  byStore: Record<string, {
    collections: number;
    refunds: number;
    waivers: number;
    count: number;
  }>;
  byBillingMode: Record<string, {
    collections: number;
    refunds: number;
    waivers: number;
    count: number;
  }>;
}

export interface StoreRentalRiskReportRow {
  orderId: string;
  orderNo: string;
  customerName: string;
  corporateShortName?: string;
  vehicleGroupName: string;
  plateNo?: string;
  pickupStoreName: string;
  returnStoreName: string;
  pickupAt: string;
  returnAt: string;
  mainStatus: OrderMainStatus;
  dispatchStatus: DispatchStatus;
  billingMode: BillingMode;
  totalAmount: number;
  riskCategories: string[];
  riskFlags: string[];
}

export interface StoreRentalRiskReport {
  generatedAt: string;
  range: {
    from: string;
    to: string;
    period: StoreRentalReportPeriod;
  };
  summary: {
    totalRiskOrders: number;
    pickupOverdueCount: number;
    overdueReturnCount: number;
    accidentCount: number;
    manualDispatchCount: number;
    blacklistCount: number;
    adjustmentCount: number;
    reassignCount: number;
    noShowCount: number;
    totalExposureAmount: number;
  };
  byCategory: StoreRentalNamedMetric[];
  byStore: StoreRentalNamedMetric[];
  byFlag: StoreRentalNamedMetric[];
  rows: StoreRentalRiskReportRow[];
}

export interface StoreRentalReportExportRequest {
  reportType: StoreRentalReportType;
  filters: StoreRentalReportQuery;
  operator?: string;
}

export interface StoreRentalReportExportJob {
  id: string;
  reportType: StoreRentalReportType;
  fileName: string;
  status: "queued" | "processing" | "completed" | "failed";
  rowCount: number;
  filters: StoreRentalReportQuery;
  downloadUrl?: string;
  operator?: string;
  createdAt: string;
  completedAt?: string;
}

export interface StoreRentalOpsLogRow {
  id: string;
  level: "info" | "warning" | "error";
  category: string;
  message: string;
  traceId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface StoreRentalOpsHealth {
  generatedAt: string;
  dataSource: "mysql";
  database: {
    connected: boolean;
    provider: "mysql";
    checkedAt: string;
  };
  seed: {
    tenantCount: number;
    orderCount: number;
    vehicleCount: number;
    reportExportJobCount: number;
  };
  scripts: Array<{
    name: string;
    path: string;
    purpose: string;
  }>;
  recentLogs: StoreRentalOpsLogRow[];
}

export interface ApiResult<T> {
  data: T;
  requestId: string;
}

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
  ReadyForPickup = "ready_for_pickup",
  Renting = "renting",
  ReturnInspection = "return_inspection",
  Completed = "completed",
  Cancelled = "cancelled"
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
  "iot"
] as const;

export type RentalCapability = (typeof RENTAL_CAPABILITY_CODES)[number];

export interface RentalCapabilityModuleDefinition {
  code: RentalCapability;
  label: string;
  kind: "core" | "category_extension";
  extensionPoints: Array<"menu" | "api" | "order_validation" | "fulfillment" | "integration">;
}

/**
 * 品类能力的统一注册表。新增专属能力时先登记扩展点，再由独立模块实现；
 * Rental Core 只识别 capability code，不在订单主流程里判断具体品类。
 */
export const RENTAL_CAPABILITY_MODULES: RentalCapabilityModuleDefinition[] = [
  { code: "serialized_inventory", label: "序列化库存", kind: "core", extensionPoints: ["order_validation", "fulfillment"] },
  { code: "quantity_inventory", label: "数量库存", kind: "core", extensionPoints: ["order_validation", "fulfillment"] },
  { code: "bundle_inventory", label: "套装库存", kind: "core", extensionPoints: ["order_validation", "fulfillment"] },
  { code: "pickup", label: "领取", kind: "core", extensionPoints: ["fulfillment"] },
  { code: "return", label: "归还", kind: "core", extensionPoints: ["fulfillment"] },
  { code: "delivery", label: "配送", kind: "category_extension", extensionPoints: ["menu", "api", "fulfillment", "integration"] },
  { code: "locker", label: "智能柜", kind: "category_extension", extensionPoints: ["menu", "api", "fulfillment", "integration"] },
  { code: "dispatch", label: "调度", kind: "category_extension", extensionPoints: ["menu", "api", "fulfillment"] },
  { code: "usage_reading", label: "使用量读数", kind: "category_extension", extensionPoints: ["order_validation", "fulfillment"] },
  { code: "qualification", label: "资质审核", kind: "category_extension", extensionPoints: ["menu", "api", "order_validation"] },
  { code: "iot", label: "IoT", kind: "category_extension", extensionPoints: ["menu", "api", "integration"] }
];

export interface RentalCategoryTerminology {
  itemLabel: string;
  itemGroupLabel: string;
  assetLabel: string;
  fulfillmentLabel: string;
  pickupLabel: string;
  returnLabel: string;
  identifierLabel: string;
  usageMetricLabel?: string;
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
export type RentalFulfillmentMode = "store_pickup_return" | "partner_pickup_return" | "warehouse_pickup_return" | "locker_pickup_return" | "delivery" | "onsite_delivery";
export type RentalLocationType = "store" | "warehouse" | "station" | "locker" | "delivery_hub" | "project_site";
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
}

export interface RentalCategoryDefaults {
  fulfillment: { allowDifferentReturnLocation: boolean };
  payment: { timing: TenantRentalBusinessSettings["payment"]["timing"] };
  overdue: Pick<TenantRentalBusinessSettings["overdue"], "graceMinutes" | "feeMode" | "feeMultiplier">;
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
  settingModules: RentalSettingModule[];
  assetFields: RentalAttributeDefinition[];
  supportsHolidayPricing: boolean;
  supportsUsagePricing: boolean;
  supportsPreauthorization: boolean;
  supportsQualificationReview: boolean;
  valueAddedServicePresets: string[];
  defaults: RentalCategoryDefaults;
}

export interface RentalCategoryDefinition {
  code: RentalCategoryCode;
  name: string;
  description: string;
  supportedInventoryModes: RentalInventoryMode[];
  defaultCapabilities: RentalCapability[];
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
export interface BusinessWorkspace {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  categoryCode: RentalCategoryCode;
  status: BusinessWorkspaceStatus;
  /** 升级兼容层：既有业务全部归属租户的默认空间。每租户至多一个。 */
  isDefault: boolean;
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
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBusinessWorkspaceRequest {
  code: string;
  name: string;
  categoryCode: RentalCategoryCode;
}

/** 不含 categoryCode：品类创建后不可通过普通设置变更（需求 3）。 */
export interface UpdateBusinessWorkspaceRequest {
  name?: string;
  status?: BusinessWorkspaceStatus;
}

export interface SaveWorkspaceMemberRequest {
  userId: string;
  roleId?: string;
  dataScope?: SystemDataScope;
  isActive?: boolean;
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
  qualifications: Record<string, unknown>;
  corporateName?: string;
  corporateTaxNo?: string;
  status: "active" | "suspended";
  /** 回填来源的旧会员主键，仅用于对账追溯，不参与业务判定。 */
  sourceMemberId?: string;
  createdAt: string;
  updatedAt: string;
  /** 该客户已接入的经营空间关系。列表接口默认带出，便于判断"是否需要接入本空间"。 */
  workspaceLinks?: CustomerWorkspaceLink[];
}

/** SPACE-04：客户在某个经营空间的业务关系。会员等级按空间隔离。 */
export interface CustomerWorkspaceLink {
  id: string;
  tenantId: string;
  workspaceId: string;
  customerId: string;
  levelName: string;
  status: "active" | "suspended";
  firstOrderAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveSharedCustomerRequest {
  customerType: "personal" | "corporate";
  name: string;
  phone: string;
  email?: string;
  identityVerified?: boolean;
  identityNo?: string;
  qualifications?: Record<string, unknown>;
  corporateName?: string;
  corporateTaxNo?: string;
}

/**
 * 把已存在的共享客户接入当前经营空间。
 *
 * 刻意不接受 workspaceId：目标空间一律取自服务端会话，
 * 否则客户端可以把客户接入自己无权进入的空间。
 */
export interface LinkCustomerToWorkspaceRequest {
  customerId: string;
  levelName?: string;
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

export interface TenantRentalBusinessSettings {
  tenantId: string;
  categoryCode: RentalCategoryCode;
  configVersion: string;
  pricing: {
    enabledUnits: RentalPricingUnit[];
    defaultUnit: RentalPricingUnit;
    currency: "CNY";
    taxIncluded: boolean;
    holidayPricingEnabled: boolean;
  };
  fulfillment: {
    enabledModes: RentalFulfillmentMode[];
    allowDifferentReturnLocation: boolean;
  };
  payment: {
    timing: "order" | "confirmation" | "pickup" | "offline_terms";
    depositMode: "none" | "fixed" | "price_multiple" | "preauthorization";
    preauthorizationRequired: boolean;
  };
  overdue: {
    graceMinutes: number;
    feeMode: "none" | "hourly" | "next_period" | "multiplier" | "manual_review";
    feeMultiplier: number;
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
  totalQuota: number;
  claimedQuantity: number;
  perCustomerLimit: number;
  effectiveFrom: string;
  effectiveTo: string;
  applicableItemGroupIds: string[];
  status: "draft" | "enabled" | "disabled";
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
  totalQuota: number;
  perCustomerLimit: number;
  effectiveFrom: string;
  effectiveTo: string;
  applicableItemGroupIds?: string[];
  status?: "draft" | "enabled" | "disabled";
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
  /** 人工覆盖的调整原因、操作人与调整时间（需求 4.5.3 要求必须保存）。 */
  overrideReason?: string;
  overrideBy?: string;
  overrideAt?: string;
  /** 被覆盖掉的原始值，供日期详情展示与移除覆盖时恢复。 */
  overriddenFrom?: RentalCalendarDayOrigin;
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
  extends Omit<RentalCalendarDay, "source" | "overrideBy" | "overrideAt" | "overriddenFrom"> {
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
  /** 便于列表直接展示，不必再查来源表。 */
  sourceName: string;
  sourceUrl: string;
  region: "CN";
  year: number;
  version: string;
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
    "dayType" | "name" | "businessStatus" | "closed" | "hours" | "pricingMultiplier" | "source"
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

/** 阶梯价档位：达到 `minUnits` 时整单改用 `unitAmount`（长租折扣口径）。 */
export interface RentalPricingTier {
  minUnits: number;
  unitAmount: number;
}

export interface RentalPricingRate {
  id: string;
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
  /** 阶梯价（需求 4.4）。留空表示整段按 baseAmount 计。 */
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
   * 小时粒度（分钟），仅 `unit: "hour"` 使用。缺省 60。
   *
   * 需求 4.4.5：「按价格配置的小时粒度向上取整，例如每 1 小时或每 30 分钟；
   * 不足一个粒度按一个粒度计」——因此它属于**价格**而不是经营空间规则。
   */
  hourGranularityMinutes?: number;
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
  currency: "CNY";
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

export interface RentalDiscountPlan {
  id: string;
  tenantId: string;
  categoryCode: RentalCategoryCode;
  code: string;
  name: string;
  status: "draft" | "enabled" | "disabled";
  discountType: "percentage" | "fixed_amount";
  discountValue: number;
  minimumSpend: number;
  maximumDiscount?: number;
  customerScope: "all" | "personal" | "corporate" | "member";
  applicableItemGroupIds: string[];
  applicableDayTypes: RentalDayType[];
  priority: number;
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

export interface RentalValueAddedService {
  id: string;
  tenantId: string;
  categoryCode: RentalCategoryCode;
  code: string;
  name: string;
  serviceType: "insurance" | "damage_waiver" | "delivery" | "consumable" | "operator" | "support" | "other";
  billingUnit: "per_order" | "per_day" | "per_unit";
  price: number;
  maximumQuantity: number;
  coverageLimit?: number;
  deductible?: number;
  termsVersion: string;
  terms: string;
  applicableItemGroupIds: string[];
  status: "enabled" | "disabled";
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveRentalValueAddedServiceRequest extends Omit<RentalValueAddedService, "id" | "tenantId" | "categoryCode" | "version" | "createdAt" | "updatedAt"> {
  id?: string;
}

export interface RentalRuleConfig {
  /**
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
  };
  payment: {
    timing: "order" | "confirmation" | "pickup" | "offline_terms";
    depositMode: "none" | "fixed" | "price_multiple" | "preauthorization";
    preauthorizationRequired: boolean;
    unpaidHoldMinutes: number;
  };
  fulfillment: {
    pickupInspectionRequired: boolean;
    returnInspectionRequired: boolean;
    evidenceRequired: boolean;
    allowDifferentReturnLocation: boolean;
  };
  overdue: {
    graceMinutes: number;
    feeMode: "none" | "hourly" | "next_period" | "multiplier" | "manual_review";
    feeMultiplier: number;
    maximumFee?: number;
  };
  cancellation: {
    freeBeforeHours: number;
    lateFeeType: "none" | "fixed_amount" | "percentage";
    lateFeeValue: number;
    weatherExceptionEnabled: boolean;
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
}

export interface RentalRuleVersion {
  id: string;
  tenantId: string;
  categoryCode: RentalCategoryCode;
  version: string;
  status: "draft" | "published" | "retired";
  config: RentalRuleConfig;
  changeReason: string;
  createdBy: string;
  createdAt: string;
  publishedAt?: string;
}

export interface SaveRentalRuleVersionRequest {
  config: RentalRuleConfig;
  changeReason: string;
  publish?: boolean;
}

export type RentalCustomerCouponStatus = "claimed" | "locked" | "redeemed" | "expired" | "void";

export interface RentalCustomerCoupon {
  id: string;
  tenantId: string;
  customerId: string;
  templateId: string;
  templateCode: string;
  templateName: string;
  status: RentalCustomerCouponStatus;
  claimedAt: string;
  effectiveFrom: string;
  effectiveTo: string;
  lockedOrderId?: string;
  lockedAt?: string;
  redeemedOrderId?: string;
  redeemedAt?: string;
  releasedAt?: string;
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
  recipient: string;
  renderedTitle: string;
  renderedBody: string;
  variables: Record<string, unknown>;
  status: "queued" | "sent" | "failed";
  provider: string;
  providerMessageId?: string;
  errorMessage?: string;
  attempts: number;
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
  fulfillmentMode: RentalFulfillmentMode;
  fulfillmentLocationId: string;
  returnLocationId?: string;
  startAt: string;
  endAt: string;
  pricingPlanId?: string;
  discountPlanId?: string;
  customerCouponId?: string;
  lines: Array<{ itemGroupId: string; quantity: number; pricingUnit?: RentalPricingUnit; usageQuantity?: number; note?: string }>;
  services?: Array<{ serviceId: string; quantity: number }>;
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
    | "damage";
  amount: number;
  sourceId?: string;
  sourceVersion?: string;
  detail?: string;
}

export interface RentalQuoteSnapshotV1 {
  id: string;
  tenantId: string;
  quoteNo: string;
  categoryCode: RentalCategoryCode;
  request: RentalQuoteRequest;
  chargeLines: RentalQuoteChargeLine[];
  rentalAmount: number;
  discountAmount: number;
  couponAmount: number;
  serviceAmount: number;
  /** 履约费用合计（需求 4.4 公式的独立一项，与增值服务分开计）。 */
  fulfillmentAmount: number;
  /** 应付押金：实收的那部分。预授权模式下为 0——钱是冻结的，没有收。 */
  depositAmount: number;
  /**
   * 预授权额度（需求 4.4「同时独立计算：应付押金；预授权金额」）。
   *
   * 与 `depositAmount` 互斥且必须分开存：早前二者共用一个字段，只把明细行改个名，
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
  pricingPlanVersion: string;
  /**
   * 本次报价实际命中的费率（需求 4.4「报价快照」+ 验收「相同输入可复算」）。
   *
   * 只存 `pricingPlanVersion` 不够：编辑计划会覆盖同一行并递增版本号，
   * 旧版本的费率内容随之消失，历史报价指向一个已不存在的版本，无法按原价复算。
   * 这里固化命中的费率本体，复算不再依赖计划仍以该版本存在。
   */
  rateSnapshot: RentalPricingRate[];
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
  customerCouponId?: string;
  expiresAt: string;
  createdAt: string;
  consumedAt?: string;
  consumedOrderId?: string;
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

export const RENTAL_CATEGORY_DEFINITIONS: RentalCategoryDefinition[] = [
  {
    code: RentalCategoryCode.Camera,
    name: "摄影设备",
    description: "机身、镜头、灯光和拍摄套装租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Quantity, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "usage_reading"],
    terminology: { itemLabel: "器材", itemGroupLabel: "器材型号", assetLabel: "器材资产", fulfillmentLabel: "器材门店", pickupLabel: "取机", returnLabel: "还机", identifierLabel: "资产编号", usageMetricLabel: "快门次数" },
    attributeSchema: { brand: "string", model: "string", mount: "string", sensor: "string", serialNo: "string", shutterCount: "number" },
    businessModel: {
      pricingUnits: ["hour", "day_24h", "calendar_day", "week", "package", "usage"],
      defaultPricingUnit: "day_24h",
      fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "locker_pickup_return", "delivery"],
      locationTypes: ["store", "warehouse", "locker", "delivery_hub"],
      settingModules: [...commonSettingModules],
      assetFields: [
        { code: "brand", label: "厂商", scope: "item_group", type: "string", required: true },
        { code: "model", label: "型号", scope: "item_group", type: "string", required: true },
        { code: "mount", label: "卡口", scope: "item_group", type: "string" },
        { code: "sensor", label: "传感器规格", scope: "item_group", type: "string" },
        { code: "serialNo", label: "设备序列号", scope: "asset", type: "string", required: true, unique: true },
        { code: "shutterCount", label: "快门次数", scope: "transaction", type: "number", unit: "次" },
        { code: "conditionGrade", label: "成色等级", scope: "asset", type: "select", options: ["A", "B", "C"] }
      ],
      supportsHolidayPricing: true,
      supportsUsagePricing: true,
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
          { code: "shutter_count", label: "快门次数", type: "number", required: true, unit: "次" }
        ],
        sampleBaseAmount: 180,
        sampleAmountIncrement: 80
      }
    },
    version: "0.3.0"
  },
  {
    code: RentalCategoryCode.Camping,
    name: "露营设备",
    description: "帐篷、桌椅、炊具和露营套装租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Quantity, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery"],
    terminology: { itemLabel: "装备", itemGroupLabel: "装备品类", assetLabel: "装备资产", fulfillmentLabel: "装备仓", pickupLabel: "领用", returnLabel: "归还", identifierLabel: "装备编号" },
    attributeSchema: { brand: "string", model: "string", people: "number", season: "string", material: "string", batchNo: "string" },
    businessModel: {
      pricingUnits: ["calendar_day", "night", "week", "package"],
      defaultPricingUnit: "calendar_day",
      fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "warehouse_pickup_return", "delivery"],
      locationTypes: ["store", "warehouse", "delivery_hub"],
      settingModules: [...commonSettingModules],
      assetFields: [
        { code: "brand", label: "品牌", scope: "item_group", type: "string", required: true },
        { code: "model", label: "型号", scope: "item_group", type: "string" },
        { code: "people", label: "适用人数", scope: "item_group", type: "number", unit: "人" },
        { code: "season", label: "季节规格", scope: "item_group", type: "select", options: ["三季", "四季"] },
        { code: "material", label: "材质", scope: "item_group", type: "string" },
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
        rules: { evidenceRequired: false, cancellation: { freeBeforeHours: 24, lateFeeType: "percentage", lateFeeValue: 10, weatherExceptionEnabled: true }, qualificationDocumentTypes: [] },
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
    version: "0.3.0"
  },
  {
    code: RentalCategoryCode.Vehicle,
    name: "车辆载具",
    description: "汽车、摩托车和其他载具租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "bundle_inventory", "pickup", "return", "dispatch", "usage_reading", "qualification", "iot"],
    terminology: { itemLabel: "车辆", itemGroupLabel: "车型组", assetLabel: "车辆", fulfillmentLabel: "门店", pickupLabel: "取车", returnLabel: "还车", identifierLabel: "车辆编号", usageMetricLabel: "里程" },
    attributeSchema: { manufacturer: "string", brand: "string", model: "string", trim: "string", energyType: "string", licensePlate: "string", vin: "string", mileage: "number" },
    businessModel: {
      pricingUnits: ["hour", "day_24h", "calendar_day", "week", "month", "usage", "package"],
      defaultPricingUnit: "day_24h",
      fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "delivery"],
      locationTypes: ["store", "station", "warehouse", "delivery_hub"],
      settingModules: [...commonSettingModules],
      assetFields: [
        { code: "manufacturer", label: "制造商", scope: "item_group", type: "string", required: true },
        { code: "brand", label: "品牌", scope: "item_group", type: "string", required: true },
        { code: "model", label: "车系", scope: "item_group", type: "string", required: true },
        { code: "trim", label: "款型", scope: "item_group", type: "string" },
        { code: "energyType", label: "能源类型", scope: "item_group", type: "select", options: ["燃油", "纯电", "混动", "其他"] },
        { code: "licensePlate", label: "车牌号", scope: "asset", type: "string", required: true, unique: true },
        { code: "vin", label: "VIN", scope: "asset", type: "string", required: true, unique: true },
        { code: "mileage", label: "里程", scope: "transaction", type: "number", unit: "km" },
        { code: "energyLevel", label: "油量/电量", scope: "transaction", type: "number", unit: "%" }
      ],
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
          { code: "usage_reading", label: "里程", type: "number", required: false, unit: "km" }
        ],
        sampleBaseAmount: 380,
        sampleAmountIncrement: 100
      }
    },
    version: "0.3.0"
  },
  {
    code: RentalCategoryCode.Construction,
    name: "工程设备",
    description: "工程机械、工具和配套设备租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Quantity, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "dispatch", "usage_reading", "qualification", "iot"],
    terminology: { itemLabel: "设备", itemGroupLabel: "设备型号", assetLabel: "设备资产", fulfillmentLabel: "设备仓", pickupLabel: "出库", returnLabel: "入库", identifierLabel: "设备编号", usageMetricLabel: "工时" },
    attributeSchema: { manufacturer: "string", brand: "string", model: "string", power: "string", ratedLoad: "number", factoryNo: "string", hourMeter: "number" },
    businessModel: {
      pricingUnits: ["hour", "shift", "calendar_day", "week", "month", "usage", "package"],
      defaultPricingUnit: "shift",
      fulfillmentModes: ["warehouse_pickup_return", "delivery", "onsite_delivery", "partner_pickup_return"],
      locationTypes: ["warehouse", "delivery_hub", "project_site"],
      settingModules: [...commonSettingModules],
      assetFields: [
        { code: "manufacturer", label: "制造商", scope: "item_group", type: "string", required: true },
        { code: "brand", label: "品牌", scope: "item_group", type: "string" },
        { code: "model", label: "型号", scope: "item_group", type: "string", required: true },
        { code: "power", label: "功率", scope: "item_group", type: "string" },
        { code: "ratedLoad", label: "额定载荷", scope: "item_group", type: "number" },
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
          { code: "usage_reading", label: "工时", type: "number", required: false, unit: "小时" }
        ],
        sampleBaseAmount: 680,
        sampleAmountIncrement: 180
      }
    },
    version: "0.3.0"
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
  code: string;
  name: string;
  type: RentalLocationType;
  operatorId?: string;
  operatorType?: "self_operated" | "partner";
  operatorName?: string;
  parentLocationId?: string;
  capabilities: Array<"pickup" | "return" | "storage" | "delivery">;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  businessHours?: string;
  status: "enabled" | "disabled";
}

export interface SaveRentalFulfillmentLocationRequest {
  id?: string;
  code: string;
  name: string;
  type: RentalLocationType;
  operatorId?: string;
  operatorType?: "self_operated" | "partner";
  operatorName?: string;
  parentLocationId?: string;
  capabilities: Array<"pickup" | "return" | "storage" | "delivery">;
  address?: string;
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
  bundleComponents: RentalBundleComponent[];
  status: "enabled" | "disabled";
  createdAt: string;
  updatedAt: string;
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
  customerName: string;
  contactPhone?: string;
  qualificationApproved?: boolean;
  qualificationValidTo?: string;
  fulfillmentMode: RentalFulfillmentMode;
  fulfillmentLocationId: string;
  returnLocationId?: string;
  startAt: string;
  endAt: string;
  lines: Array<{
    itemGroupId: string;
    quantity: number;
    note?: string;
  }>;
  operator?: string;
}

export interface CancelRentalOrderRequest {
  reason: string;
  weatherException?: boolean;
}

export interface RentalOrderLine {
  id: string;
  itemGroupId: string;
  itemGroupCode: string;
  itemGroupName: string;
  inventoryMode: RentalInventoryMode;
  quantity: number;
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

export interface RentalAllocation {
  id: string;
  orderId: string;
  orderLineId: string;
  /** 套装拆分后的实际组成商品；历史分配可能为空。 */
  itemGroupId?: string;
  assetId?: string;
  assetNo?: string;
  quantity: number;
  status: "allocated" | "picked_up" | "returned" | "released";
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
}

export interface RentalOrder {
  id: string;
  tenantId: string;
  orderNo: string;
  categoryCode: RentalCategoryCode;
  status: RentalCoreOrderStatus;
  customerType: "personal" | "corporate";
  customerId?: string;
  customerName: string;
  contactPhone?: string;
  fulfillmentMode: RentalFulfillmentMode;
  fulfillmentLocationId: string;
  fulfillmentLocationName: string;
  fulfillmentLocationSnapshot: RentalFulfillmentLocationSnapshot;
  returnLocationId?: string;
  returnLocationName?: string;
  returnLocationSnapshot: RentalFulfillmentLocationSnapshot;
  startAt: string;
  endAt: string;
  quoteId: string;
  quoteNo: string;
  pricingPlanVersion: string;
  ruleVersion: string;
  ruleSnapshot: RentalRuleConfig;
  calendarVersion?: string;
  /** 从报价拷贝的逐日计价依据（需求 4.5.7：订单始终使用订单快照）。 */
  calendarSnapshot?: RentalQuoteCalendarDay[];
  chargeLines: RentalQuoteChargeLine[];
  rentalAmount: number;
  discountAmount: number;
  couponAmount: number;
  serviceAmount: number;
  /** 履约费用合计。与报价同口径，便于订单侧对账时逐项核对。 */
  fulfillmentAmount: number;
  depositAmount: number;
  /** 预授权额度。与 `depositAmount` 互斥，理由见报价快照上的同名字段。 */
  preAuthAmount: number;
  payableAmount: number;
  adjustmentAmount: number;
  finalPayableAmount: number;
  cancellationReason?: string;
  cancelledAt?: string;
  completedAt?: string;
  totalAmount: number;
  lines: RentalOrderLine[];
  reservations: RentalReservation[];
  allocations: RentalAllocation[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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
}

export interface CreateRentalInspectionRequest {
  templateId: string;
  results: Record<string, unknown>;
  exceptions?: Array<{ code: string; description: string; chargeAmount?: number }>;
  attachments?: string[];
  operator?: string;
}

export interface RentalInspectionRecord {
  id: string;
  tenantId: string;
  orderId: string;
  stage: "pickup" | "return";
  templateId: string;
  templateCode: string;
  templateVersion: string;
  results: Record<string, unknown>;
  exceptions: Array<{ code: string; description: string; chargeAmount?: number }>;
  attachments: string[];
  operator: string;
  createdAt: string;
}
