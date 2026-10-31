/**
 * 基础设施域契约：文件、打印、异步任务、通知、外部适配器与 T-Box 设备。
 *
 * 这些声明原先夹在单品类租赁域的契约文件里。该域整体下线后，它们是
 * 唯一还有消费方的部分——integrations / files / jobs / notifications 四个模块，
 * 与具体品类业务无关。因此单独成文件，原来的 legacy.ts 随之删除。
 */

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
  /** 服务端内部对象键；对外接口不返回，保留为可选字段兼容内部 mock 数据。 */
  storageKey?: string;
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

export interface CreateFileUploadSessionRequest {
  businessModule: string;
  businessType: string;
  /** 上传必须绑定已存在的租户业务对象，禁止只凭调用方字符串制造孤儿文件。 */
  businessId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadScene: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface FileUploadSessionSummary {
  sessionId: string;
  fileAssetId: string;
  provider: string;
  mode: "provider" | "simulation";
  /** freeze_pending binds a one-time content write; only original completion
   * observation may resume it, never a new upload or PUT retry. */
  status: "pending_upload" | "freeze_pending" | "completed" | "failed" | string;
  /** Only the original still-pending staging object receives a PUT grant. */
  uploadUrl?: string;
  uploadHeaders?: Record<string, string>;
  expiresAt: string;
}

export interface FileUploadCleanupSummary {
  scanned: number;
  invalidated: number;
  deletedObjects: number;
  cleanupPending: number;
  sessionIds: string[];
}

export interface CompleteFileUploadRequest {
  /** Optional SHA-256 assertion for staged uploads; the server computes the
   * actual digest. It never treats this client field as content evidence. */
  checksum?: string;
}

export interface FileDownloadUrlSummary {
  fileAssetId: string;
  provider: string;
  mode: "provider" | "simulation";
  downloadUrl: string;
  expiresAt?: string;
}

/** EXT-01D：运营端按当前经营空间执行的支付/退款主动对账结果。 */
export interface PaymentReconciliationSummary {
  scanned: number;
  processed: number;
  paid: number;
  closed: number;
  refunded: number;
  pending: number;
  failed: number;
  results: Array<{
    kind: "payment_intent" | "refund";
    id: string;
    orderId: string;
    previousStatus: string;
    status: string;
    error?: string;
  }>;
}

/** EXT-01D：生产支付对账文件导入结果。导入只生成证据与差异，不改资金事实。 */
export type PaymentStatementKind = "payment" | "refund";
export type PaymentStatementReviewStatus = "not_required" | "open" | "query_pending" | "acknowledged";

export interface PaymentStatementBatchSummary {
  id: string;
  workspaceId: string;
  provider: "alipay" | "wechat_pay" | string;
  fileName: string;
  fileSha256: string;
  status: "matched" | "needs_review" | "reviewed" | string;
  totalRows: number;
  matchedRows: number;
  differenceRows: number;
  acknowledgedRows: number;
  importedBy?: string;
  importedAt: string;
}

export interface PaymentStatementLineSummary {
  id: string;
  batchId: string;
  rowNumber: number;
  kind: PaymentStatementKind;
  merchantOrderNo: string;
  merchantRefundNo?: string;
  externalId?: string;
  statementStatus: string;
  normalizedStatus: string;
  amount: number;
  currency: string;
  occurredAt?: string;
  localRecordId?: string;
  localStatus?: string;
  differenceCodes: string[];
  differenceDetail?: string;
  reviewStatus: PaymentStatementReviewStatus;
  reviewReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface PaymentStatementBatchDetail extends PaymentStatementBatchSummary {
  lines: PaymentStatementLineSummary[];
}

export interface ReviewPaymentStatementLineRequest {
  decision: "acknowledge" | "query_provider";
  reason: string;
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
  targetModule: "rental-os" | string;
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
  targetModule: "rental-os" | string;
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

/**
 * DOC-PRINT-01：订单客户凭证的服务端渲染类型。
 *
 * 这四类凭证只允许读取订单已经固化的业务事实；它们不是发票、电子签章或法定票据。
 * 服务端先统一输出这个结果，管理端和后续 APP 可以复用同一份脱敏快照，避免各端
 * 各自重新拼接订单字段后出现口径漂移。
 */
export type RentalDocumentType = "quote" | "delivery" | "return" | "settlement";

export interface RentalDocumentRenderResult {
  /** 已落库的不可变凭证快照 ID；无数据库的纯内存调用可为空。 */
  snapshotId?: string;
  documentType: RentalDocumentType;
  templateCode: `${RentalDocumentType}-v1`;
  title: string;
  documentNo: string;
  sourceOrderUpdatedAt: string;
  snapshotAt: string;
  /** 不包含规则、成本、权限、证件或完整资金流水的客户可读快照。 */
  snapshot: Record<string, unknown>;
  /** HTML 仅供预览/打印，不代表正式 PDF 或法定票据。 */
  html: string;
  /** 对 snapshot 做规范化 JSON 后的 SHA-256，便于客户端确认同一订单事实的重生成结果。 */
  contentHash: string;
}

/**
 * DOC-PRINT-01：不可变凭证历史的目录项。
 *
 * 历史列表只返回版本定位和校验信息，不把 HTML 或快照正文混在列表响应里；
 * 读取正文必须再按当前订单、空间和权限读取指定 snapshotId。
 */
export interface RentalDocumentSnapshotSummary {
  snapshotId: string;
  documentType: RentalDocumentType;
  templateCode: `${RentalDocumentType}-v1`;
  documentNo: string;
  sourceOrderUpdatedAt: string;
  snapshotAt: string;
  contentHash: string;
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
