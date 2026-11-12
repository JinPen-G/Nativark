/** Original staff upload observations only. References and file descriptions
 * select an existing operation; they grant no upload, file read or retry. */
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafText as text, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

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

const reference: AiLeafSchemaDraft = { oneOf: [object({ idempotencyKey: id() }), object({ sessionId: id() })] };
const file = object({ businessModule: choice('rental-core'), businessType: choice('rental_order', 'rental_work_order'),
  businessId: id(), fileName: text(180), mimeType: { ...text(127), pattern: '^[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+$' },
  sizeBytes: integer(1, 20971520), uploadScene: choice('pickup-evidence', 'return-evidence', 'handover-signature', 'work-order-evidence', 'offline-payment-proof'),
  metadata: object({ handoverStage: choice('pickup', 'return'), handoverBatchId: id() }, []) },
  ['businessModule', 'businessType', 'businessId', 'fileName', 'mimeType', 'sizeBytes', 'uploadScene']);
const session = object({ sessionId: id(), fileAssetId: id(), status: choice('pending_upload', 'freeze_pending', 'completed', 'failed'),
  fileStatus: choice('pending_upload', 'active', 'failed', 'delete_pending', 'deleted'), mode: choice('provider', 'simulation'),
  expiresAt: time, completedAt: { oneOf: [time, { type: 'null' }] } });
const observation = { reference, descriptionHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  observation: choice('stored_metadata_not_transfer_proof'), retryable: { type: 'boolean', const: false },
  uploadGrant: choice('not_provided'), nextAction: choice('read_original_upload') } satisfies Record<string, AiLeafSchemaDraft>;
export const STAFF_UPLOAD_OBSERVATION_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  StaffUploadObservationRequest: object({ reference, file }),
  StaffUploadObservationResponse: { oneOf: [object({ ...observation, state: choice('observed'), session }),
    object({ ...observation, state: choice('not_observed'), session: { type: 'null' } })] },
};
