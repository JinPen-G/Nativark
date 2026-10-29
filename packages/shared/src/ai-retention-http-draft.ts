/** Explicit retention transport, not a delete grant or proof of backup erasure.
 * Current full-workspace management authority and original hold/receipt checks
 * remain mandatory. Unknown object deletion can only be observed, never resent. */
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafTime as time, leafList as list, leafRef as ref, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
export const AI_RETENTION_KINDS_DRAFT = ['task', 'request', 'knowledge', 'memory', 'material', 'attachment'] as const;
export type AiRetentionKindDraft = typeof AI_RETENTION_KINDS_DRAFT[number];
export interface AiRetentionCleanupDraft { kind: AiRetentionKindDraft; limit?: number; after?: string }
export interface AiRetentionReceiptReadDraft { id: string }
export interface AiRetentionReceiptListDraft { limit?: number; before?: string }
export interface AiRetentionReceiptDraft {
  id: string; tenantId: string; workspaceId: string; kind: AiRetentionKindDraft; resourceId: string;
  policyVersion: string; targetHash: string; state: 'prepared' | 'deleting' | 'unknown' | 'erased' | 'withdrawn' | 'superseded';
  revision: number; createdAt: string; erasedAt: string | null;
}
export type AiRetentionCleanupResultDraft =
  | { id: string; state: 'erased' | 'withdrawn' | 'prepared'; replayed?: boolean; absentInSnapshot?: true }
  | { id: string; state: 'held'; reason: 'referenced_by_unresolved_task' | 'unresolved_effects' | 'association_limit'
      | 'original_operation_retention' | 'shared_or_business_attachment' }
  | { id: string; state: 'unavailable'; reason: 'source_task_binding_unavailable' | 'storage_erasure_not_assembled'
      | 'mock_storage_has_no_physical_erasure_evidence' | 'original_storage_location_not_proved' | 'storage_dependency_unavailable'; retryable?: false; replayed?: boolean }
  | { id: string; state: 'unknown'; retryable: false; nextAction?: 'observe_original_object_absence' }
  | { state: 'unknown' | 'unavailable'; retryable: false; nextAction: 'list_retention_receipts' };
export interface AiRetentionCleanupResponseDraft { policyVersion: string; scanned: number; limit: number;
  results: AiRetentionCleanupResultDraft[]; nextAfter: string | null; coverage: 'bounded_candidate_page';
  businessRecords: 'preserved'; backupErasure: 'not_attested' }
export interface AiRetentionReceiptListResponseDraft { rows: AiRetentionReceiptDraft[]; coverage: 'bounded_page'; retryable: false }
export interface AiRetentionHttpRequestsDraft { cleanup: AiRetentionCleanupDraft; receipt: AiRetentionReceiptReadDraft; receipts: AiRetentionReceiptListDraft }
export interface AiRetentionHttpResponsesDraft { cleanup: AiRetentionCleanupResponseDraft; receipt: AiRetentionReceiptDraft; receipts: AiRetentionReceiptListResponseDraft }
export const AI_RETENTION_HTTP_CONTRACTS = Object.freeze({
  cleanup: { request: 'AiRetentionCleanupDraft', response: 'AiRetentionCleanupResponseDraft', write: true },
  receipt: { request: 'AiRetentionReceiptReadDraft', response: 'AiRetentionReceiptDraft', write: false },
  receipts: { request: 'AiRetentionReceiptListDraft', response: 'AiRetentionReceiptListResponseDraft', write: false },
} as const);
const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' }, nil: AiLeafSchemaDraft = { type: 'null' };
const no: AiLeafSchemaDraft = { type: 'boolean', const: false }, yes: AiLeafSchemaDraft = { type: 'boolean', const: true };
const replayed: AiLeafSchemaDraft = { type: 'boolean' };
export const AI_RETENTION_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiRetentionCleanupDraft: object({ kind: choice(...AI_RETENTION_KINDS_DRAFT), limit: integer(1, 10), after: id() }, ['kind']),
  AiRetentionReceiptReadDraft: object({ id: hash }),
  AiRetentionReceiptListDraft: object({ limit: integer(1, 50), before: time }, []),
  AiRetentionReceiptDraft: object({ id: hash, tenantId: id(), workspaceId: id(), kind: choice(...AI_RETENTION_KINDS_DRAFT), resourceId: id(),
    policyVersion: id(), targetHash: hash, state: choice('prepared', 'deleting', 'unknown', 'erased', 'withdrawn', 'superseded'),
    revision: integer(1, 4294967294), createdAt: time, erasedAt: { oneOf: [time, nil] } }),
  AiRetentionCleanupResultDraft: { oneOf: [
    object({ id: hash, state: choice('erased', 'withdrawn', 'prepared'), replayed, absentInSnapshot: yes }, ['id', 'state']),
    object({ id: hash, state: choice('held'), reason: choice('referenced_by_unresolved_task', 'unresolved_effects', 'association_limit',
      'original_operation_retention', 'shared_or_business_attachment') }),
    object({ id: hash, state: choice('unavailable'), reason: choice('source_task_binding_unavailable', 'storage_erasure_not_assembled',
      'mock_storage_has_no_physical_erasure_evidence', 'original_storage_location_not_proved', 'storage_dependency_unavailable'), retryable: no, replayed }, ['id', 'state', 'reason']),
    object({ id: hash, state: choice('unknown'), retryable: no, nextAction: choice('observe_original_object_absence') }, ['id', 'state', 'retryable']),
    object({ state: choice('unknown', 'unavailable'), retryable: no, nextAction: choice('list_retention_receipts') }),
  ] },
  AiRetentionCleanupResponseDraft: object({ policyVersion: id(), scanned: integer(0, 10), limit: integer(1, 10),
    results: list(ref('AiRetentionCleanupResultDraft'), 10), nextAfter: { oneOf: [id(), nil] }, coverage: choice('bounded_candidate_page'),
    businessRecords: choice('preserved'), backupErasure: choice('not_attested') }),
  AiRetentionReceiptListResponseDraft: object({ rows: list(ref('AiRetentionReceiptDraft'), 50), coverage: choice('bounded_page'), retryable: no }),
};
