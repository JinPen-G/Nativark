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
}

export interface AuthUser {
  id: string;
  account: string;
  displayName: string;
  roleNames: string[];
  roleIds?: string[];
  scope: RoleScope;
  dataScope?: SystemDataScope;
  organizationId?: string;
  organizationName?: string;
  isPlatformAdmin?: boolean;
  permissions?: string[];
}

export interface LoginRequest {
  tenantCode: string;
  account: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  tenant: TenantContext;
  user: AuthUser;
}

export interface TenantSummary {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  enabledBusinessLines: string[];
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
  isActive: boolean;
  permissions: string[];
  dataScope: SystemDataScope;
}

export interface SaveSystemUserRequest {
  id?: string;
  tenantId: string;
  account: string;
  displayName: string;
  phone?: string;
  organizationId?: string;
  roleIds: string[];
  isPlatformAdmin?: boolean;
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
  | "store-rental.stations";

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
  operator: string;
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
  totalAmount: number;
  billingMode: BillingMode;
  mainStatus: OrderMainStatus;
  dispatchStatus: DispatchStatus;
  paymentStatus: PaymentStatus;
  operationLockStatus?: OperationLockStatus;
  operationLockOperator?: string;
  operationLockExpiresAt?: string;
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
  };
  operationLockExpiredHint?: string;
  preAuthExpiredHint?: string;
  availableActions: string[];
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
  customerScope?: StoreRentalCustomerType | "all";
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
    membershipVersion?: string;
    membershipOrderDiscountPercent?: number;
    membershipDepositDiscountPercent?: number;
    membershipRentalDiscountAmount?: number;
    membershipDepositDiscountAmount?: number;
    effectiveAt?: string;
    ruleEffectiveAt?: string;
    dynamicPricingScheduleId?: string;
    dynamicPricingVersion?: string;
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
  | "task_closed"
  | "task_claimed"
  | "task_processed"
  | "task_completed";

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
  maxPerOrder?: number;
  corporateOnly?: boolean;
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
  };
  byStore: StoreRentalNamedMetric[];
  byVehicleGroup: StoreRentalNamedMetric[];
  byStatus: StoreRentalNamedMetric[];
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
