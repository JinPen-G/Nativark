/** 原基础设施合同兼容入口。公共文件、通知与作业归公共合同，Rental设备与业务交换归其正式子出口。 */
export type {
  InfraAdapterCapability, NotificationTemplateSummary, NotificationSendLogSummary,
  SendMockNotificationRequest, AdapterLogSummary
} from "@rental-os/platform-contracts/notifications";
export type {
  AsyncJobSummary, CreateAsyncJobRequest, PrintJobSummary, CreatePrintJobRequest
} from "@rental-os/platform-contracts/jobs";
export type {
  FileAssetSummary, FileAssetQuery, CreateFileAssetRequest, CreateFileUploadSessionRequest,
  FileUploadSessionSummary, FileUploadCleanupSummary, CompleteFileUploadRequest, FileDownloadUrlSummary
} from "@rental-os/platform-contracts/files";
export type {
  InfraCapabilityCard, InvokeMockAdapterRequest, DataExchangeOperation, DataExchangeTemplateSummary,
  CreateDataExchangeJobRequest, DataExchangeJobResult, TBoxDeviceSummary, SaveTBoxDeviceRequest,
  BindTBoxDeviceRequest, InfraDashboardResult
} from "@rental-os/rental-core/integration-contracts";
export type {
  RentalDocumentType, RentalDocumentRenderResult, RentalDocumentSnapshotSummary
} from "@rental-os/rental-core/document-contracts";
export type {
  PaymentReconciliationSummary, PaymentStatementKind, PaymentStatementReviewStatus, PaymentStatementBatchSummary,
  PaymentStatementLineSummary, PaymentStatementBatchDetail, ReviewPaymentStatementLineRequest
} from "@rental-os/rental-core";
