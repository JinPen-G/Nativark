/** Current-owner recovery transport. The server resolves the original host;
 * explicit commands bind the reviewed Task/Run/plan/CAS. Read operations never
 * claim a lease, renew a budget or attest a business outcome. */
import type { AiSceneRequestReadDraft } from './ai-scene-request-draft';
import type { AiTaskRecoverySnapshot, AiSceneModelExecutionDraft, AiSceneModelRecoverySnapshotReadResponse } from './ai-task-recovery-draft';
import type { AiOrderReadTakeoverReceiptDraft } from './ai-order-read-http-draft';
import { AI_ORDER_READ_HTTP_SCHEMAS } from './ai-order-read-http-draft';
import { AI_TASK_RECOVERY_HTTP_SCHEMAS } from './ai-task-recovery-draft';
import { AI_SCENE_REQUEST_DRAFT_SCHEMAS } from './ai-scene-request-draft-schemas';
import { validateAiLeafSchemaValue } from './ai-leaf-schema-validation';
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafRef as ref, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_TASK_CENTER_RECOVERY_HTTP = Object.freeze({ basePath: 'ai-native/task-center/recovery',
  target: 'target', snapshot: 'snapshot', recover: 'recover', takeover: 'takeover', receipt: 'receipt' } as const);
export type AiTaskRecoveryHostDraft = 'order_read' | 'opening_model' | 'quote_model' | 'opening_read';
export interface AiTaskRecoveryTargetQueryDraft { taskId: string; runId?: string }
export interface AiTaskRecoveryRunQueryDraft { taskId: string; runId: string }
export interface AiTaskRecoveryCommandDraft extends AiTaskRecoveryRunQueryDraft {
  planHash: string; expectedTaskRevision: number; expectedRunRevision: number; expectedFencingToken: string;
}
export interface AiTaskRecoveryReceiptQueryDraft extends AiTaskRecoveryRunQueryDraft {
  expectedTaskRevision: number; expectedRunRevision: number; expectedFencingToken: string;
}
type Base = AiTaskRecoveryRunQueryDraft & { observedAt: string; execution: 'read_only_no_lease_or_dispatch' };
export type AiTaskRecoveryTargetDraft = Base & (
  | { status: 'available'; host: AiTaskRecoveryHostDraft; original: AiSceneRequestReadDraft;
      originRunId: string; planHash: string; snapshot: AiTaskRecoverySnapshot; actions: Array<'recover' | 'takeover'> }
  | { status: 'unavailable'; reason: 'original_request_unavailable' | 'plan_unavailable' | 'host_unavailable'
      | 'specialized_host_required' | 'host_run_mismatch' }
);
export type AiTaskRecoveryResultDraft = AiTaskRecoveryRunQueryDraft & { outcome: AiSceneModelExecutionDraft;
  automaticRetry: false; businessExecution: 'read_original_receipt' };
export interface AiTaskRecoveryReceiptDraft extends AiTaskRecoveryRunQueryDraft { original: AiSceneRequestReadDraft;
  receipt: AiOrderReadTakeoverReceiptDraft; execution: 'read_only_no_lease_or_dispatch' }
export type AiTaskRecoverySnapshotDraft = AiSceneModelRecoverySnapshotReadResponse;

const shortId = { ...id(), maxLength: 36 }, revision = integer(1, 4294967294);
const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const fencing: AiLeafSchemaDraft = { type: 'string', pattern: '^[1-9][0-9]{0,19}$' };
const run = { taskId: shortId, runId: shortId };
const receipt = { ...run, expectedTaskRevision: revision, expectedRunRevision: revision, expectedFencingToken: fencing };
const base = { ...run, observedAt: time, execution: choice('read_only_no_lease_or_dispatch') };
export const AI_TASK_CENTER_RECOVERY_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiTaskRecoveryTargetQueryDraft: object(run, ['taskId']),
  AiTaskRecoveryRunQueryDraft: object(run),
  AiTaskRecoveryCommandDraft: object({ ...receipt, planHash: hash }),
  AiTaskRecoveryReceiptQueryDraft: object(receipt),
  AiTaskRecoveryTargetDraft: { oneOf: [
    object({ ...base, status: choice('available'), host: choice('order_read', 'opening_model', 'quote_model', 'opening_read'),
      original: ref('AiSceneRequestReadDraft'), originRunId: shortId, planHash: hash, snapshot: ref('AiTaskRecoverySnapshot'),
      actions: { type: 'array', items: choice('recover', 'takeover'), minItems: 0, maxItems: 2, uniqueItems: true } }),
    object({ ...base, status: choice('unavailable'), reason: choice('original_request_unavailable', 'plan_unavailable',
      'host_unavailable', 'specialized_host_required', 'host_run_mismatch') })
  ] },
  AiTaskRecoveryResultDraft: object({ ...run, outcome: ref('AiSceneModelExecutionDraft'),
    automaticRetry: { type: 'boolean', const: false }, businessExecution: choice('read_original_receipt') }),
  AiTaskRecoveryReceiptDraft: object({ ...run, original: ref('AiSceneRequestReadDraft'),
    receipt: AI_ORDER_READ_HTTP_SCHEMAS.AiOrderReadTakeoverReceiptResponseDraft.properties!.receipt,
    execution: choice('read_only_no_lease_or_dispatch') })
};
export const AI_TASK_CENTER_RECOVERY_CONTRACTS = Object.freeze({
  target: { request: 'AiTaskRecoveryTargetQueryDraft', response: 'AiTaskRecoveryTargetDraft', write: false },
  snapshot: { request: 'AiTaskRecoveryRunQueryDraft', response: 'AiSceneModelRecoverySnapshotReadResponse', write: false },
  recover: { request: 'AiTaskRecoveryCommandDraft', response: 'AiTaskRecoveryResultDraft', write: true },
  takeover: { request: 'AiTaskRecoveryCommandDraft', response: 'AiTaskRecoveryResultDraft', write: true },
  receipt: { request: 'AiTaskRecoveryReceiptQueryDraft', response: 'AiTaskRecoveryReceiptDraft', write: false }
} as const);

type Values = { AiTaskRecoveryTargetQueryDraft: AiTaskRecoveryTargetQueryDraft;
  AiTaskRecoveryRunQueryDraft: AiTaskRecoveryRunQueryDraft; AiTaskRecoveryCommandDraft: AiTaskRecoveryCommandDraft;
  AiTaskRecoveryReceiptQueryDraft: AiTaskRecoveryReceiptQueryDraft; AiTaskRecoveryTargetDraft: AiTaskRecoveryTargetDraft;
  AiTaskRecoveryResultDraft: AiTaskRecoveryResultDraft; AiTaskRecoveryReceiptDraft: AiTaskRecoveryReceiptDraft;
  AiSceneModelRecoverySnapshotReadResponse: AiTaskRecoverySnapshotDraft };
/** Closed values only; successful parsing grants no action or source access. */
export function validateAiTaskCenterRecoveryValue<K extends keyof Values>(name: K, value: unknown): value is Values[K] {
  try {
    const schemas = { ...AI_SCENE_REQUEST_DRAFT_SCHEMAS, ...AI_TASK_RECOVERY_HTTP_SCHEMAS, ...AI_TASK_CENTER_RECOVERY_SCHEMAS };
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 524288
      && validateAiLeafSchemaValue(schemas[name], value, schemas);
  } catch { return false; }
}
