/**
 * 基础设施域契约：文件、打印、异步任务、通知、外部适配器与 T-Box 设备。
 *
 * 这些声明原先夹在单品类租赁域的契约文件里。该域整体下线后，它们是
 * 唯一还有消费方的部分——integrations / files / jobs / notifications 四个模块，
 * 与具体品类业务无关。因此单独成文件，原来的 legacy.ts 随之删除。
 */

import type { InfraAdapterCapability, NotificationTemplateSummary, NotificationSendLogSummary, AdapterLogSummary } from "@rental-os/platform-contracts/notifications";
export type { InfraAdapterCapability, NotificationTemplateSummary, NotificationSendLogSummary, SendMockNotificationRequest, AdapterLogSummary } from "@rental-os/platform-contracts/notifications";
import type { AsyncJobSummary, PrintJobSummary } from "@rental-os/platform-contracts/jobs";
export type { AsyncJobSummary, CreateAsyncJobRequest, PrintJobSummary, CreatePrintJobRequest } from "@rental-os/platform-contracts/jobs";

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

import type { FileAssetSummary } from "@rental-os/platform-contracts/files";
export type {
  FileAssetSummary,
  FileAssetQuery,
  CreateFileAssetRequest,
  CreateFileUploadSessionRequest,
  FileUploadSessionSummary,
  FileUploadCleanupSummary,
  CompleteFileUploadRequest,
  FileDownloadUrlSummary
} from "@rental-os/platform-contracts/files";


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


export interface InvokeMockAdapterRequest {
  provider: string;
  capability: InfraAdapterCapability | string;
  operation: string;
  businessType?: string;
  businessId?: string;
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

export type { RentalDocumentType, RentalDocumentRenderResult, RentalDocumentSnapshotSummary } from "@rental-os/rental-core/document-contracts";

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
