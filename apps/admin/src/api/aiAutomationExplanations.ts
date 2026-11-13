/** Original automation input only. Closed shared contracts and session binding
 * validate reads, previews and the one explicit first model attempt; damaged
 * or unknown start acknowledgements never authorize a replacement operation. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_AUTOMATION_EXPLANATION_HTTP, AI_AUTOMATION_EXPLANATION_CONTRACTS,
  AI_AUTOMATION_EXPLANATION_SCHEMAS, AI_EVENTS_DRAFT_SCHEMAS, AI_SCOPE_DRAFT_SCHEMAS,
  type AiAutomationExplanationReadDraft, type AiAutomationExplanationPreparationDraft,
  type AiAutomationExplanationStartDraft, type AiAutomationExplanationObservationDraft, type ApiResult } from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { http } from './http';

const definitions = JSON.parse(JSON.stringify({ ...AI_AUTOMATION_EXPLANATION_SCHEMAS,
  ...AI_EVENTS_DRAFT_SCHEMAS, ...AI_SCOPE_DRAFT_SCHEMAS }).replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validators = Object.fromEntries(Object.keys(AI_AUTOMATION_EXPLANATION_SCHEMAS)
  .map(name => [name, ajv.compile({ $ref: `#/$defs/${name}`, $defs: definitions })]));
export function validateAutomationExplanation<T>(name: string, value: unknown): T {
  const copy = structuredClone(value), encoded = JSON.stringify(copy);
  if (!encoded || new TextEncoder().encode(encoded).length > 262144 || !validators[name]?.(copy)) throw Error('AI_RESOURCE_UNAVAILABLE');
  return copy as T;
}
const identity = () => {
  const auth = useAuthStore.getState();
  if (!auth.sessionVerified || !auth.token || !auth.user || auth.user.isSaasAdmin || !auth.tenant?.tenantId || !auth.currentWorkspaceId) {
    throw Error('AI_SCOPE_CHANGED');
  }
  return JSON.stringify([auth.tenant.tenantId, auth.currentWorkspaceId, auth.user, currentSessionEpoch()]);
};
async function post<T>(action: keyof typeof AI_AUTOMATION_EXPLANATION_CONTRACTS, value: unknown, signal: AbortSignal) {
  const contract = AI_AUTOMATION_EXPLANATION_CONTRACTS[action], command = validateAutomationExplanation(contract.request, value);
  const before = identity(), combined = AbortSignal.any([signal, currentSessionSignal()]);
  const check = () => { if (combined.aborted || identity() !== before) throw Error('AI_SCOPE_CHANGED'); };
  check();
  const config = { signal: combined, timeout: action === 'start' ? 120000 : 15000, _authRetry: true };
  const response = await http.post<ApiResult<unknown>>(`/${AI_AUTOMATION_EXPLANATION_HTTP.basePath}/${AI_AUTOMATION_EXPLANATION_HTTP[action]}`,
    command, config);
  check();
  return validateAutomationExplanation<T>(contract.response, response.data.data);
}
export const aiAutomationExplanationsApi = Object.freeze({
  read: (value: AiAutomationExplanationReadDraft, signal: AbortSignal) => post<AiAutomationExplanationObservationDraft>('read', value, signal),
  prepare: (value: AiAutomationExplanationReadDraft, signal: AbortSignal) => post<AiAutomationExplanationPreparationDraft>('prepare', value, signal),
  start: (value: AiAutomationExplanationStartDraft, signal: AbortSignal) => post<AiAutomationExplanationObservationDraft>('start', value, signal),
});
