/** 员工上传原键观察合同，仅返回已存事实。 */
export const STAFF_UPLOAD_OBSERVATION_HTTP = { basePath: 'staff/v1/uploads', observe: 'sessions/observe' } as const;
export type StaffUploadObservationReference = { idempotencyKey: string } | { sessionId: string };
export interface StaffUploadObservationFile {
  businessModule: 'rental-core'; businessType: 'rental_order' | 'rental_work_order'; businessId: string;
  fileName: string; mimeType: string; sizeBytes: number;
  uploadScene: 'pickup-evidence' | 'return-evidence' | 'handover-signature' | 'work-order-evidence' | 'offline-payment-proof';
  metadata?: { handoverStage?: 'pickup' | 'return'; handoverBatchId?: string };
}
export interface StaffUploadObservationRequest {
  reference: StaffUploadObservationReference; file: StaffUploadObservationFile;
}
export interface StaffUploadObservedSession {
  sessionId: string; fileAssetId: string;
  status: 'pending_upload' | 'freeze_pending' | 'completed' | 'failed';
  fileStatus: 'pending_upload' | 'active' | 'failed' | 'delete_pending' | 'deleted';
  mode: 'provider' | 'simulation'; expiresAt: string; completedAt: string | null;
}
export type StaffUploadObservationResponse = {
  reference: StaffUploadObservationReference;
  /** Hash of the declared file description, never a file-content checksum. */
  descriptionHash: string;
  observation: 'stored_metadata_not_transfer_proof'; retryable: false;
  uploadGrant: 'not_provided'; nextAction: 'read_original_upload';
} & ({ state: 'observed'; session: StaffUploadObservedSession }
  | { state: 'not_observed'; session: null });
