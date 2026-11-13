/** Ordinary opening-section proposal transport. Both directions use the
 * formal shared schemas; current identity/epoch and the server's original
 * Task/receipt authorities remain mandatory. No Core save or publish port. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT, AI_TASK_OPENING_PROPOSAL_HTTP_CONTRACTS,
  AI_TASK_OPENING_PROPOSAL_HTTP_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS,
  type ApiResult, type AiTaskOpeningProposalQueryDraft, type AiTaskOpeningProposalPreviewRequestDraft,
  type AiTaskOpeningProposalPrepareRequestDraft, type AiTaskOpeningProposalOperationReadDraft,
  type AiTaskOpeningProposalListDraft, type AiTaskOpeningProposalPreviewDraft, type AiTaskOpeningProposalOperationDraft } from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { http } from './http';

const definitions = JSON.parse(JSON.stringify({ ...AI_TASK_OPENING_PROPOSAL_HTTP_SCHEMAS,
  AiSceneRequestReadDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReadDraft }).replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validators = Object.fromEntries(Object.keys(AI_TASK_OPENING_PROPOSAL_HTTP_SCHEMAS)
  .map(name => [name, ajv.compile({ $ref: `#/$defs/${name}`, $defs: definitions })]));
export function validateTaskOpeningProposal<T>(name: string, value: unknown): T {
  const copy = structuredClone(value);
  if (new TextEncoder().encode(JSON.stringify(copy)).length > 262144 || !validators[name]?.(copy)) throw Error('AI_RESOURCE_UNAVAILABLE');
  return copy as T;
}
async function post<T>(action: keyof typeof AI_TASK_OPENING_PROPOSAL_HTTP_CONTRACTS, value: AiTaskOpeningProposalQueryDraft,
  signal: AbortSignal): Promise<T> {
  const contract = AI_TASK_OPENING_PROPOSAL_HTTP_CONTRACTS[action], command = validateTaskOpeningProposal<AiTaskOpeningProposalQueryDraft>(contract.request, value);
  const auth = useAuthStore.getState(), epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  const owner = JSON.stringify([auth.user, auth.tenant?.tenantId, auth.currentWorkspaceId]);
  const check = () => {
    const next = useAuthStore.getState();
    if (active.aborted || epoch !== currentSessionEpoch() || !next.token || !next.tenant?.tenantId || !next.currentWorkspaceId
      || next.user?.isSaasAdmin || JSON.stringify([next.user, next.tenant.tenantId, next.currentWorkspaceId]) !== owner) throw Error('AI_SCOPE_CHANGED');
  };
  check();
  const result = await http.post<ApiResult<unknown>>(`/${AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT.basePath}/${AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT[action]}`,
    command, { signal: active, timeout: action === 'prepare' ? 120000 : 15000 }); check();
  const response = validateTaskOpeningProposal<AiTaskOpeningProposalListDraft | AiTaskOpeningProposalPreviewDraft | AiTaskOpeningProposalOperationDraft>(contract.response, result.data.data);
  if ('source' in response) {
    if (response.source.taskId !== command.taskId || command.runId !== undefined && response.source.runId !== command.runId
      || response.source.scope.tenantId !== auth.tenant?.tenantId || response.source.scope.workspaceId !== auth.currentWorkspaceId) throw Error('AI_SCOPE_CHANGED');
  } else {
    if (response.diagnosisTaskId !== command.taskId || command.runId !== undefined && response.diagnosisRunId !== command.runId
      || !('operationKey' in command) || response.operationKey !== command.operationKey
      || response.receipt && (response.receipt.material.scope.tenantId !== auth.tenant?.tenantId
        || response.receipt.material.scope.workspaceId !== auth.currentWorkspaceId)) throw Error('AI_SCOPE_CHANGED');
  }
  check(); return response as T;
}
export const aiTaskOpeningProposalsApi = Object.freeze({
  list: (value: AiTaskOpeningProposalQueryDraft, signal: AbortSignal) => post<AiTaskOpeningProposalListDraft>('list', value, signal),
  preview: (value: AiTaskOpeningProposalPreviewRequestDraft, signal: AbortSignal) => post<AiTaskOpeningProposalPreviewDraft>('preview', value, signal),
  prepare: (value: AiTaskOpeningProposalPrepareRequestDraft, signal: AbortSignal) => post<AiTaskOpeningProposalOperationDraft>('prepare', value, signal),
  operation: (value: AiTaskOpeningProposalOperationReadDraft, signal: AbortSignal) => post<AiTaskOpeningProposalOperationDraft>('operation', value, signal),
});
