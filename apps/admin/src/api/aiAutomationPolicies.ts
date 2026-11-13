/** Current-workspace policy proposals and original CAS receipts only. The
 * canonical transport never retries a policy POST or grants model/Core access. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { AxiosRequestConfig } from 'axios';
import {
  AI_AUTOMATION_POLICY_HTTP_CONTRACTS, AI_AUTOMATION_POLICY_HTTP_SCHEMAS, AI_EVENTS_DRAFT_SCHEMAS,
  type ApiResult, type AiAutomationPolicyChangeDraft, type AiAutomationPolicyDiscoveryDraft,
  type AiAutomationPolicyReadRequestDraft, type AiAutomationPolicyCurrentDraft, type AiAutomationPolicyPreviewDraft,
  type AiAutomationPolicyConfirmedPreparationDraft, type AiAutomationPolicyPreparationDraft,
  type AiAutomationPolicyPreparationReadDraft, type AiAutomationPolicyReviewDraft,
  type AiAutomationPolicyConfirmedCommitDraft, type AiAutomationPolicyCommitResultDraft,
  type AiAutomationPolicyOperationDraft,
} from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { http } from './http';

const definitions = JSON.parse(JSON.stringify({ ...AI_AUTOMATION_POLICY_HTTP_SCHEMAS,
  AiAutomationToolReferenceDraft: AI_EVENTS_DRAFT_SCHEMAS.AiAutomationToolReferenceDraft,
}).replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validators = Object.fromEntries(Object.keys(AI_AUTOMATION_POLICY_HTTP_SCHEMAS).map(name => [name,
  ajv.compile({ $ref: `#/$defs/${name}`, $defs: definitions })]));

export class AutomationPolicyApiError extends Error {
  constructor(readonly code: 'AI_INVALID_INPUT' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_SCOPE_CHANGED' | 'AI_RESULT_UNKNOWN') { super(code); }
}

export function validateAutomationPolicy<T>(name: string, value: unknown, maximum = 262144): T {
  try {
    const copy = structuredClone(value), encoded = JSON.stringify(copy);
    if (!encoded || new TextEncoder().encode(encoded).byteLength > maximum || !validators[name]?.(copy)) throw Error();
    return copy as T;
  } catch { throw new AutomationPolicyApiError('AI_RESOURCE_UNAVAILABLE'); }
}

const identity = () => {
  const auth = useAuthStore.getState();
  if (!auth.sessionVerified || !auth.token || !auth.user?.id || auth.user.isSaasAdmin || !auth.tenant?.tenantId
    || !auth.currentWorkspaceId || !auth.hasPermission('system:params:manage')) throw new AutomationPolicyApiError('AI_SCOPE_CHANGED');
  return JSON.stringify([auth.tenant.tenantId, auth.currentWorkspaceId, auth.user, currentSessionEpoch()]);
};
type Action = 'discover' | 'read' | 'preview' | 'prepareConfirmed' | 'preparation' | 'review' | 'commitConfirmed' | 'operation';
const paths: Record<Action, string> = { discover: 'discover', read: 'read', preview: 'preview', prepareConfirmed: 'prepare-confirmed',
  preparation: 'preparation', review: 'review', commitConfirmed: 'commit-confirmed', operation: 'operation' };
async function post<T>(action: Action, body: unknown, signal: AbortSignal): Promise<T> {
  const contract = AI_AUTOMATION_POLICY_HTTP_CONTRACTS[action], write = action === 'prepareConfirmed' || action === 'commitConfirmed';
  let command: unknown;
  try { command = validateAutomationPolicy(contract.request, body, 65536); }
  catch { throw new AutomationPolicyApiError('AI_INVALID_INPUT'); }
  const epoch = currentSessionEpoch(), binding = identity(), active = AbortSignal.any([signal, currentSessionSignal()]);
  const check = () => {
    if (active.aborted || currentSessionEpoch() !== epoch || identity() !== binding) throw new AutomationPolicyApiError('AI_SCOPE_CHANGED');
  };
  check();
  const config: AxiosRequestConfig & { _authRetry: true } = { signal: active, timeout: 15000, _authRetry: true };
  const response = await http.post<ApiResult<unknown>>(`/ai-native/automation/operator/policies/${paths[action]}`, command,
    config);
  check();
  try { return validateAutomationPolicy<T>(contract.response, response.data.data); }
  catch { throw new AutomationPolicyApiError(write ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE'); }
}

export const aiAutomationPoliciesApi = Object.freeze({
  discover: (signal: AbortSignal) => post<AiAutomationPolicyDiscoveryDraft>('discover', {}, signal),
  read: (input: AiAutomationPolicyReadRequestDraft, signal: AbortSignal) => post<AiAutomationPolicyCurrentDraft>('read', input, signal),
  preview: (input: AiAutomationPolicyChangeDraft, signal: AbortSignal) => post<AiAutomationPolicyPreviewDraft>('preview', input, signal),
  prepareConfirmed: (input: AiAutomationPolicyConfirmedPreparationDraft, signal: AbortSignal) =>
    post<AiAutomationPolicyPreparationDraft>('prepareConfirmed', input, signal),
  preparation: (operationKey: string, signal: AbortSignal) => post<AiAutomationPolicyPreparationReadDraft>('preparation', { operationKey }, signal),
  review: (preparationId: string, signal: AbortSignal) => post<AiAutomationPolicyReviewDraft>('review', { preparationId }, signal),
  commitConfirmed: (input: AiAutomationPolicyConfirmedCommitDraft, signal: AbortSignal) =>
    post<AiAutomationPolicyCommitResultDraft>('commitConfirmed', input, signal),
  operation: (operationKey: string, signal: AbortSignal) => post<AiAutomationPolicyOperationDraft>('operation', { operationKey }, signal),
});
export type AutomationPoliciesApi = typeof aiAutomationPoliciesApi;
