/** Rental 设备台账、数据交换和运营汇总合同。基础台账引用公共合同，模拟状态沿原事实表示。 */
import type { FileAssetSummary } from "@rental-os/platform-contracts/files";
import type { AsyncJobSummary, PrintJobSummary } from "@rental-os/platform-contracts/jobs";
import type {
  AdapterLogSummary,
  InfraAdapterCapability,
  NotificationSendLogSummary,
  NotificationTemplateSummary
} from "@rental-os/platform-contracts/notifications";

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
