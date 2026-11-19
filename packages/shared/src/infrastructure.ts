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


/** 原支付业务合同由 Rental Core 单源提供，保持旧各端导入路径。 */
export type { PaymentReconciliationSummary, PaymentStatementKind, PaymentStatementReviewStatus, PaymentStatementBatchSummary, PaymentStatementLineSummary, PaymentStatementBatchDetail, ReviewPaymentStatementLineRequest } from "@rental-os/rental-core";
