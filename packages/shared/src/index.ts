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
  /**
   * CORE-EXT-02C：本空间**缺失的首期必选能力**，与生产就绪标记配套。
   *
   * 两者与 `tenant.capabilities` 是不同的东西，必须分开表示（验收明确要求
   * 「空间『可访问』与『品类能力已达到生产经营条件』分开表示」）：
   * `tenant.capabilities` 决定**入口可见性**，而这两个字段决定管理端要不要显示
   * 「该空间尚未达到生产经营条件」。开发/演示空间可以继续验证通用 Core，
   * 但不得因为能进得去就被当成已具备完整品类能力。
   */
  missingRequiredCapabilities?: RentalCapability[];
  capabilityProductionReady?: boolean;
  /**
   * 当前空间的运行模式。前端据此明确标注「非生产」，而不是只靠 productionReady 猜。
   * 服务端的经营门禁也以它为准（`production` 且缺必选能力时拒绝业务写入）。
   */
  workspaceRunMode?: BusinessWorkspaceRunMode;
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
  "iot",
  // CAM-01A：首个真实产品能力——摄影器材兼容性。仅摄影品类适用（applicableCategories 收口），
  // 只做兼容性判定，不代替 CAM-01 的附件清点、使用量、检查与养护。
  "camera_compatibility",
  // 各品类首期经营闭环的独立 capability。先登记、后实现：没有 implementationVersion
  // 时会明确显示「已声明但未实现」，并阻止该品类空间进入 production。
  "camera_kit_handover",
  "camping_kit_integrity",
  "camping_cleaning_turnaround",
  "inspection_care",
  "vehicle_relocation",
  "construction_transport"
] as const;

export type RentalCapability = (typeof RENTAL_CAPABILITY_CODES)[number];

/**
 * capability 种类（CORE-EXT-02A）。
 *
 * - `category_required` 模块自身只适合作为品类必选；最终是否必选以各品类定义中的
 *   `requiredCapabilities` 为准。同一个 `shared` 能力可以对某品类必选、对另一品类可选。
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
export interface RentalCapabilityFeeBasis {
  code: string;
  label: string;
  amount: number;
  currency: "CNY";
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
  // 三种库存与取还是 Rental Core 自身实现的能力，因此带 `core-1.0` 实现版本：
  // 它们确实有可执行模块（库存与履约主流程），不属于"只有 code"。
  { code: "serialized_inventory", label: "序列化库存", kind: "category_required", extensionPoints: ["order_validation", "fulfillment"], applicableCategories: "all", dependsOn: [], conflictsWith: [], configSchema: [], implementationVersion: "core-1.0" },
  { code: "quantity_inventory", label: "数量库存", kind: "category_required", extensionPoints: ["order_validation", "fulfillment"], applicableCategories: "all", dependsOn: [], conflictsWith: [], configSchema: [], implementationVersion: "core-1.0" },
  { code: "bundle_inventory", label: "套装库存", kind: "category_optional", extensionPoints: ["order_validation", "fulfillment"], applicableCategories: "all", dependsOn: ["serialized_inventory"], conflictsWith: [], configSchema: [], implementationVersion: "core-1.0" },
  { code: "pickup", label: "领取", kind: "category_required", extensionPoints: ["fulfillment"], applicableCategories: "all", dependsOn: [], conflictsWith: [], configSchema: [], implementationVersion: "core-1.0" },
  { code: "return", label: "归还", kind: "category_required", extensionPoints: ["fulfillment"], applicableCategories: "all", dependsOn: [], conflictsWith: [], configSchema: [], implementationVersion: "core-1.0" },
  // 以下能力**只登记了 code 与扩展点，尚无可执行模块**（缺 implementationVersion）。
  // 它们在管理端显示为「已声明但未实现」，不得启用、不得开放菜单或 API。
  // 各自的真实模块由 SHARED-*/CAM-*/VEH-* 等任务实现，实现时再补 implementationVersion。
  {
    code: "delivery", label: "配送", kind: "shared",
    extensionPoints: ["menu", "api", "fulfillment", "integration"],
    applicableCategories: "all", dependsOn: [], conflictsWith: [],
    configSchema: [
      { key: "maxDistanceKm", label: "最大配送半径（公里）", type: "number", required: true, min: 0, max: 500 },
      { key: "requireSignature", label: "是否需要签收", type: "boolean", required: false }
    ]
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
    // `legacy-1.0` 而不是缺省：`/store-rental/dispatch/*` 在历史车辆域里确有十余个
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
    configSchema: [{ key: "metric", label: "读数指标", type: "enum", required: true, options: ["mileage", "hours", "shutter"] }]
  },
  {
    code: "qualification", label: "资质审核", kind: "shared",
    extensionPoints: ["menu", "api", "order_validation"],
    applicableCategories: "all", dependsOn: [], conflictsWith: [],
    configSchema: [{ key: "minimumValidityDays", label: "证件最短剩余有效天数", type: "number", required: true, min: 0, max: 3650 }]
  },
  {
    code: "iot", label: "IoT", kind: "shared",
    extensionPoints: ["menu", "api", "integration"],
    applicableCategories: [RentalCategoryCode.Vehicle, RentalCategoryCode.Construction], dependsOn: [], conflictsWith: [],
    configSchema: [{ key: "provider", label: "遥测服务商", type: "string", required: true }],
    // 同 dispatch：`/store-rental/tbox-devices` 在历史车辆域里已实现。
    implementationVersion: "legacy-1.0"
  },
  {
    code: "camera_kit_handover", label: "摄影套装交接与附件清点", kind: "category_required",
    extensionPoints: ["order_validation", "fulfillment"],
    applicableCategories: [RentalCategoryCode.Camera], dependsOn: ["bundle_inventory"], conflictsWith: [],
    configSchema: []
  },
  {
    code: "camping_kit_integrity", label: "露营套装完整性", kind: "category_required",
    extensionPoints: ["order_validation", "fulfillment"],
    applicableCategories: [RentalCategoryCode.Camping], dependsOn: ["bundle_inventory"], conflictsWith: [],
    configSchema: []
  },
  {
    code: "camping_cleaning_turnaround", label: "露营清洁周转", kind: "category_required",
    extensionPoints: ["fulfillment"],
    applicableCategories: [RentalCategoryCode.Camping], dependsOn: ["return"], conflictsWith: [],
    configSchema: []
  },
  {
    code: "inspection_care", label: "检查与养护", kind: "shared",
    extensionPoints: ["fulfillment"],
    applicableCategories: [RentalCategoryCode.Camera, RentalCategoryCode.Vehicle, RentalCategoryCode.Construction],
    dependsOn: ["return"], conflictsWith: [], configSchema: []
  },
  {
    code: "vehicle_relocation", label: "车辆异地还车", kind: "category_required",
    extensionPoints: ["order_validation", "fulfillment"],
    applicableCategories: [RentalCategoryCode.Vehicle], dependsOn: ["dispatch"], conflictsWith: [],
    configSchema: []
  },
  {
    code: "construction_transport", label: "工程设备运输交付", kind: "category_required",
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
  /** 该品类进入 production 必须启用的能力；共享能力也可以在某个品类中成为必选。 */
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
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBusinessWorkspaceRequest {
  code: string;
  name: string;
  categoryCode: RentalCategoryCode;
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
export type CustomerStatusScope = "account" | "workspace";

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
  /**
   * 双方的空间会员关系。合并**不合并权益**：各空间等级、积分、券分别保留，
   * 因此这里只如实列出，供人工确认「合并后客户在哪些空间各是什么状态」。
   */
  sourceMemberships: Array<{ workspaceId: string; levelName: string; status: CustomerMembershipStatus }>;
  targetMemberships: Array<{ workspaceId: string; levelName: string; status: CustomerMembershipStatus }>;
  /** 两边都有会员关系的空间。这些空间需要人工决定保留哪一份等级。 */
  overlappingWorkspaceIds: string[];
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

/**
 * CUSTOMER-01C：企业授信与账期。
 *
 * 本阶段**只存事实**：额度不接进报价与订单确认链路。额度占用与释放需要与订单、
 * 支付、退款联动，属后续任务；在没有联动设计前先改金额链路会留下对不上的账。
 */
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
  /** 该客户已接入的经营空间关系。列表接口默认带出，便于判断"是否需要接入本空间"。 */
  workspaceLinks?: CustomerWorkspaceLink[];
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

/** SPACE-04 / CUSTOMER-01A：客户在某个经营空间的业务关系。会员等级与状态按空间隔离。 */
export interface CustomerWorkspaceLink {
  id: string;
  tenantId: string;
  workspaceId: string;
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

/**
 * 应付押金规则（需求 4.4.7）。
 *
 * `mode` 决定金额来源：`fixed` 取费率的 `depositAmount`，`price_multiple` 取
 * `depositMultiple × 该行租金`，`none` 不收。`maxAmount` 是单笔订单押金上限。
 */
export interface RentalDepositRule {
  mode: "none" | "fixed" | "price_multiple";
  /** 单笔订单的押金上限。留空表示不设上限；0 是合法值（等于免押）。 */
  maxAmount?: number;
}

/**
 * 预授权规则（需求 4.4.7）。与押金**完全独立**：可以只冻结不收押金、只收押金不冻结，
 * 也可以两者同时存在。金额来源取费率的 `preAuthAmount`/`preAuthMultiple`，
 * 二者缺省时回落到 `depositAmount`/`depositMultiple`——存量费率行只有押金字段。
 */
export interface RentalPreauthorizationRule {
  mode: "none" | "fixed" | "price_multiple";
  /** 单笔订单的预授权额度上限。留空表示不设上限。 */
  maxAmount?: number;
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
  };
  payment: {
    timing: "order" | "confirmation" | "pickup" | "offline_terms";
    depositMode: "none" | "fixed" | "price_multiple" | "preauthorization";
    preauthorizationRequired: boolean;
    unpaidHoldMinutes: number;
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
   * 周期性时段由 PRICE-03 提供价格事实；该层就绪前不会出现在快照里。
   */
  hitLayer?: "date_override" | "periodic" | "day_type" | "base";
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
  customerCouponId?: string;
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

export const RENTAL_CATEGORY_DEFINITIONS: RentalCategoryDefinition[] = [
  {
    code: RentalCategoryCode.Camera,
    name: "摄影设备",
    description: "机身、镜头、灯光和拍摄套装租赁",
    supportedInventoryModes: [RentalInventoryMode.Serialized, RentalInventoryMode.Quantity, RentalInventoryMode.Bundle],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "usage_reading", "camera_compatibility", "camera_kit_handover", "inspection_care"],
    requiredCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "camera_compatibility", "camera_kit_handover", "usage_reading", "inspection_care"],
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
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "camping_kit_integrity", "camping_cleaning_turnaround"],
    requiredCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "camping_kit_integrity", "camping_cleaning_turnaround"],
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
    defaultCapabilities: ["serialized_inventory", "bundle_inventory", "pickup", "return", "dispatch", "usage_reading", "qualification", "iot", "inspection_care", "vehicle_relocation"],
    requiredCapabilities: ["serialized_inventory", "bundle_inventory", "pickup", "return", "dispatch", "usage_reading", "qualification", "inspection_care", "vehicle_relocation"],
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
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "dispatch", "usage_reading", "qualification", "iot", "inspection_care", "construction_transport"],
    requiredCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "dispatch", "usage_reading", "qualification", "inspection_care", "construction_transport"],
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
