/** Public transport boundary only. Reuses existing probe/usage contracts,
 * projects internal task material, and never grants execution or writes state. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_PLATFORM_CAPABILITY_HTTP_OPERATIONS, AI_TEXT_CAPABILITY_HTTP_SCHEMAS,
  AI_SCENE_REQUEST_DRAFT_SCHEMAS, AI_USAGE_DRAFT_SCHEMAS } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';

export type PlatformProbeHttpAction = typeof AI_PLATFORM_CAPABILITY_HTTP_OPERATIONS[number][0];
const ajv = new Ajv({ strict: false, coerceTypes: false, removeAdditional: false, useDefaults: false });
addFormats(ajv);
const refs = (value: unknown): unknown => Array.isArray(value) ? value.map(refs)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, key === '$ref' && typeof child === 'string' ? child.replace(/^#\/components\/schemas\//u, 'urn:rental:platform-probe:') : refs(child)])) : value;
for (const family of [AI_TEXT_CAPABILITY_HTTP_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS, AI_USAGE_DRAFT_SCHEMAS]) {
  for (const [name, schema] of Object.entries(family)) ajv.addSchema(refs(schema) as object, `urn:rental:platform-probe:${name}`);
}
const validators = new Map(AI_PLATFORM_CAPABILITY_HTTP_OPERATIONS.map(([action, request, response]) =>
  [action, { request: ajv.getSchema(`urn:rental:platform-probe:${request}`)!, response: ajv.getSchema(`urn:rental:platform-probe:${response}`)! }]));
export function validatePlatformProbeHttp(action: PlatformProbeHttpAction, phase: 'request' | 'response', value: unknown) {
  return validators.get(action)![phase](value);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return value as Record<string, unknown>;
}
const fields = (value: unknown, names: readonly string[]) => {
  const source = object(value);
  return Object.fromEntries(names.filter(name => source[name] !== undefined).map(name => [name, source[name]]));
};
const taskFields = ['taskId', 'runId', 'status', 'revision', 'replayed'];
export function projectPlatformProbeHttp(action: PlatformProbeHttpAction, requestKey: string, value: unknown) {
  const raw = object(value), common = { requestKey, retryable: false as const };
  if (action === 'publish') return { ...common, ...fields(raw, ['state', 'inputRef', 'inputHash', 'replayed']) };
  if (action === 'readOriginal') {
    if (raw.state === 'stored') return { ...common, ...fields(raw, ['state', 'inputRef', 'inputHash']) };
    if (raw.state !== 'not_found') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return { ...common, state: 'not_observed' as const };
  }
  if (action === 'createTask') return { ...common, ...fields(raw, taskFields) };
  if (action === 'readTask') return raw.task
    ? { ...common, state: 'observed' as const, task: fields(raw.task, taskFields) }
    : { ...common, state: raw.state, task: null };
  if (action === 'start' || action === 'reconcile') return raw.kind === 'not_started'
    ? { ...common, kind: raw.kind, reason: raw.reason, semantics: 'task_outcome_not_capability_evidence' as const }
    : { ...common, kind: raw.kind, outcome: fields(raw.outcome, ['status', 'completedSteps', 'cleanupFailed']),
      semantics: 'task_outcome_not_capability_evidence' as const };
  if (action === 'inspect') return { requestKey, task: fields(raw.task, ['taskId', 'revision', 'status', 'cancelRequestedAt']),
    run: fields(raw.run, ['runId', 'status']), semantics: 'task_outcome_not_capability_evidence' as const };
  if (action === 'cancel') return { ...common, status: 'cancel_requested' as const, revision: object(raw.event).taskRevision };
  if (action === 'readCapabilityReceipt') return { ...common,
    ...fields(raw, ['capability', 'status', 'receiptId', 'evidenceHash', 'reason']),
    observation: raw.observation ? fields(raw.observation, ['methodVersion', 'mode', 'configurationRevision', 'checkedAt', 'expiresAt']) : null,
    semantics: 'original_receipt_not_task_outcome' as const };
  // History/accounting already have safe projections. Unexpected future fields
  // fail the closed validator instead of reaching the HTTP response.
  return { ...raw, requestKey };
}
