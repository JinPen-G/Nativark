/** Operator-managed customer scene policy and model-plan wire contracts. These
 * describe the original CAS/read results, not customer authorization, model
 * capability, budget admission or booking approval. No caller-selected scope. */
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafRef as ref, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export interface AiClientPolicyKeyDraft {
  channel: 'wechat_miniprogram' | 'web' | 'app'; customerType: 'personal' | 'corporate';
}
export interface AiClientPolicyChangeDraft extends AiClientPolicyKeyDraft {
  operationKey: string; expectedRevision: number; enabled: boolean; allowCreate: boolean;
  allowRead: boolean; allowExecute: boolean; allowRequestInput?: boolean;
  allowSubmitInput?: boolean; allowResumeInput?: boolean; allowCancel?: boolean; expiresAt: string;
}
export interface AiClientPolicyOperationRequestDraft extends AiClientPolicyKeyDraft { operationKey: string }
export interface AiClientPolicySnapshotDraft extends AiClientPolicyKeyDraft {
  id: string; tenantId: string; workspaceId: string; sceneCode: string; sceneVersion: string;
  enabled: boolean; allowCreate: boolean; allowRead: boolean; allowExecute: boolean;
  allowRequestInput: boolean; allowSubmitInput: boolean; allowResumeInput: boolean; allowCancel: boolean;
  revision: number; expiresAt: string;
}
export type AiClientPolicyReadResponseDraft = { execution: 'not_attested' } & (
  | { state: 'configured'; policy: AiClientPolicySnapshotDraft }
  | { state: 'not_configured'; policy: null });
type Observed = { state: 'observed'; operationKey: string; result: AiClientPolicySnapshotDraft;
  recordedAt: string; retryable: false; execution: 'not_attested' };
export type AiClientPolicyOperationResponseDraft = Observed | { state: 'not_observed'; operationKey: string;
  retryable: false; execution: 'not_attested' };
export type AiClientPolicyChangeResponseDraft = Observed | { state: 'unknown'; operationKey: string;
  retryable: false; execution: 'not_attested'; nextAction: 'read_original_policy_operation' };
export interface AiClientModelPlanLimitsDraft {
  maxSteps: number; maxCalls: number; maxConcurrent: 1;
  maxTotalMs: number; maxStepMs: number; maxOutputBytes: number;
}
export interface AiClientModelPlanChangeDraft {
  expectedRevision: number | null; enabled: boolean; limits: AiClientModelPlanLimitsDraft; expiresAt: string;
}
export interface AiClientModelPlanChangeResponseDraft {
  revision: number; enabled: boolean; limits: AiClientModelPlanLimitsDraft; expiresAt: string; execution: 'not_attested';
}
/** This is a current plan row, not an exact historical mutation receipt. */
export type AiClientModelPlanReadResponseDraft = { state: 'configured' } & AiClientModelPlanChangeResponseDraft
  | { state: 'not_configured'; execution: 'not_attested' };
export interface AiClientPolicyHttpRequestsDraft {
  read: AiClientPolicyKeyDraft; change: AiClientPolicyChangeDraft; operation: AiClientPolicyOperationRequestDraft;
  readModelPlan: Record<string, never>; changeModelPlan: AiClientModelPlanChangeDraft;
}
export interface AiClientPolicyHttpResponsesDraft {
  read: AiClientPolicyReadResponseDraft; change: AiClientPolicyChangeResponseDraft; operation: AiClientPolicyOperationResponseDraft;
  readModelPlan: AiClientModelPlanReadResponseDraft; changeModelPlan: AiClientModelPlanChangeResponseDraft;
}
export const AI_CLIENT_POLICY_HTTP_CONTRACTS = Object.freeze({
  read: { request: 'AiClientPolicyKeyDraft', response: 'AiClientPolicyReadResponseDraft', write: false },
  change: { request: 'AiClientPolicyChangeDraft', response: 'AiClientPolicyChangeResponseDraft', write: true },
  operation: { request: 'AiClientPolicyOperationRequestDraft', response: 'AiClientPolicyOperationResponseDraft', write: false },
  readModelPlan: { request: 'AiClientModelPlanReadRequestDraft', response: 'AiClientModelPlanReadResponseDraft', write: false },
  changeModelPlan: { request: 'AiClientModelPlanChangeDraft', response: 'AiClientModelPlanChangeResponseDraft', write: true },
} as const);

const bool: AiLeafSchemaDraft = { type: 'boolean' }, no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const date: AiLeafSchemaDraft = { type: 'string', format: 'date-time' };
const key = { channel: choice('wechat_miniprogram', 'web', 'app'), customerType: choice('personal', 'corporate') };
const operationKey = { ...id(), maxLength: 128 }, revision = integer(1, 4294967294);
const flags = { enabled: bool, allowCreate: bool, allowRead: bool, allowExecute: bool,
  allowRequestInput: bool, allowSubmitInput: bool, allowResumeInput: bool, allowCancel: bool };
const limits = object({ maxSteps: integer(1, 1000), maxCalls: integer(1, 1000), maxConcurrent: { type: 'integer', const: 1 },
  maxTotalMs: integer(1, 86400000), maxStepMs: integer(1, 86400000), maxOutputBytes: integer(1, 16777216) });
const execution = choice('not_attested'), operation = { operationKey, retryable: no, execution };
const observed = object({ ...operation, state: choice('observed'), result: ref('AiClientPolicySnapshotDraft'), recordedAt: date });
const plan = { revision, enabled: bool, limits, expiresAt: date, execution };
export const AI_CLIENT_POLICY_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiClientPolicyKeyDraft: object(key),
  AiClientPolicyOperationRequestDraft: object({ ...key, operationKey }),
  AiClientPolicyChangeDraft: object({ ...key, operationKey, expectedRevision: integer(0, 4294967293), ...flags, expiresAt: date },
    ['channel', 'customerType', 'operationKey', 'expectedRevision', 'enabled', 'allowCreate', 'allowRead', 'allowExecute', 'expiresAt']),
  AiClientPolicySnapshotDraft: object({ ...key, ...flags, id: { type: 'string', format: 'uuid' }, tenantId: id(), workspaceId: id(),
    sceneCode: { ...id(), maxLength: 128 }, sceneVersion: { ...id(), maxLength: 64 }, revision, expiresAt: date }),
  AiClientPolicyReadResponseDraft: { oneOf: [
    object({ state: choice('configured'), policy: ref('AiClientPolicySnapshotDraft'), execution }),
    object({ state: choice('not_configured'), policy: { type: 'null' }, execution })] },
  AiClientPolicyOperationResponseDraft: { oneOf: [observed, object({ ...operation, state: choice('not_observed') })] },
  AiClientPolicyChangeResponseDraft: { oneOf: [observed,
    object({ ...operation, state: choice('unknown'), nextAction: choice('read_original_policy_operation') })] },
  AiClientModelPlanReadRequestDraft: object({}),
  AiClientModelPlanChangeDraft: object({ expectedRevision: { oneOf: [integer(1, 4294967293), { type: 'null' }] },
    enabled: bool, limits, expiresAt: date }),
  AiClientModelPlanChangeResponseDraft: object(plan),
  AiClientModelPlanReadResponseDraft: { oneOf: [object({ state: choice('configured'), ...plan }),
    object({ state: choice('not_configured'), execution })] },
};
