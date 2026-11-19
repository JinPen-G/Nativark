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

const id = { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const time = { type: 'string', format: 'date-time', minLength: 20, maxLength: 40 };

// 原上传键按调用方文本校验，保留UTF-16原长与上传创建入口的trim规则。
const reference = { oneOf: [
  { type: 'object', properties: { idempotencyKey: { type: 'string', minLength: 1, maxLength: 191, pattern: '\\S' } },
    required: ['idempotencyKey'], additionalProperties: false },
  { type: 'object', properties: { sessionId: { ...id } }, required: ['sessionId'], additionalProperties: false }
] };
const file = {
  type: 'object',
  properties: {
    businessModule: { type: 'string', enum: ['rental-core'] },
    businessType: { type: 'string', enum: ['rental_order', 'rental_work_order'] },
    businessId: { ...id },
    fileName: { type: 'string', minLength: 1, maxLength: 180 },
    mimeType: { type: 'string', minLength: 1, maxLength: 127, pattern: '^[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+$' },
    sizeBytes: { type: 'integer', minimum: 1, maximum: 20971520 },
    uploadScene: { type: 'string', enum: ['pickup-evidence', 'return-evidence', 'handover-signature', 'work-order-evidence', 'offline-payment-proof'] },
    metadata: { type: 'object', properties: {
      handoverStage: { type: 'string', enum: ['pickup', 'return'] }, handoverBatchId: { ...id }
    }, required: [], additionalProperties: false }
  },
  required: ['businessModule', 'businessType', 'businessId', 'fileName', 'mimeType', 'sizeBytes', 'uploadScene'],
  additionalProperties: false
};
const session = {
  type: 'object',
  properties: {
    sessionId: { ...id }, fileAssetId: { ...id },
    status: { type: 'string', enum: ['pending_upload', 'freeze_pending', 'completed', 'failed'] },
    fileStatus: { type: 'string', enum: ['pending_upload', 'active', 'failed', 'delete_pending', 'deleted'] },
    mode: { type: 'string', enum: ['provider', 'simulation'] }, expiresAt: time, completedAt: { oneOf: [time, { type: 'null' }] }
  },
  required: ['sessionId', 'fileAssetId', 'status', 'fileStatus', 'mode', 'expiresAt', 'completedAt'],
  additionalProperties: false
};
const observation = {
  reference, descriptionHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  observation: { type: 'string', enum: ['stored_metadata_not_transfer_proof'] }, retryable: { type: 'boolean', const: false },
  uploadGrant: { type: 'string', enum: ['not_provided'] }, nextAction: { type: 'string', enum: ['read_original_upload'] }
};

/** Rental员工原键观察的请求与回执schema，沿原封闭字段和原长度/格式门槛。 */
export const STAFF_UPLOAD_OBSERVATION_SCHEMAS: Record<string, Record<string, unknown>> = {
  StaffUploadObservationRequest: { type: 'object', properties: { reference, file },
    required: ['reference', 'file'], additionalProperties: false },
  StaffUploadObservationResponse: { oneOf: [
    { type: 'object', properties: { ...observation, state: { type: 'string', enum: ['observed'] }, session },
      required: ['reference', 'descriptionHash', 'observation', 'retryable', 'uploadGrant', 'nextAction', 'state', 'session'],
      additionalProperties: false },
    { type: 'object', properties: { ...observation, state: { type: 'string', enum: ['not_observed'] }, session: { type: 'null' } },
      required: ['reference', 'descriptionHash', 'observation', 'retryable', 'uploadGrant', 'nextAction', 'state', 'session'],
      additionalProperties: false }
  ] }
};
