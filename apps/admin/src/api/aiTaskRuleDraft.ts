/** Formal task rule-draft API. Original references are read from the server,
 * never entered by a user or reconstructed from a model/card's raw fields. */
import { AI_TASK_RULE_DRAFT_HTTP, aiTaskRuleDraftListResponse, aiTaskRuleDraftReviewResponse, aiTaskRuleDraftOperationResponse,
  aiTaskRuleDraftPreparationInput, aiTaskRuleDraftPreparationResponse, aiTaskRuleDraftPreparationPreviewInput,
  aiTaskRuleDraftPreparationPreviewResponse, aiTaskRuleDraftPrepareInput, aiTaskRuleDraftPreparationReference,
  aiTaskRuleDraftPreparationOperationResponse, type AiTaskRuleDraftReference, type AiTaskRuleDraftReviewInput,
  type AiTaskRuleDraftSaveInput, type AiTaskRuleDraftPreparationPreviewInput, type AiTaskRuleDraftPrepareInput,
  type AiTaskRuleDraftPreparationReference, type ApiResult } from '@rental-os/shared';
import { http } from './http';
import { currentSessionSignal, currentSessionEpoch } from '@/app/queryClient';
const post = async (action: 'list' | 'review' | 'save' | 'operation' | 'preparation' | 'previewPreparation' | 'prepare' | 'preparationOperation', value: unknown, signal: AbortSignal) => {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const result = await http.post<ApiResult<unknown>>(`/${AI_TASK_RULE_DRAFT_HTTP.basePath}/${AI_TASK_RULE_DRAFT_HTTP[action]}`, structuredClone(value),
    { signal: active, timeout: 12000 });
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  return result.data.data;
};
export const aiTaskRuleDraftApi = Object.freeze({
  list: async (taskId: string, signal: AbortSignal) => aiTaskRuleDraftListResponse.parse(await post('list', { taskId }, signal)),
  review: async (value: AiTaskRuleDraftReviewInput, signal: AbortSignal) => aiTaskRuleDraftReviewResponse.parse(await post('review', value, signal)),
  save: async (value: AiTaskRuleDraftSaveInput, signal: AbortSignal) => aiTaskRuleDraftOperationResponse.parse(await post('save', value, signal)),
  operation: async (value: AiTaskRuleDraftReference, signal: AbortSignal) => aiTaskRuleDraftOperationResponse.parse(await post('operation', value, signal)),
  preparation: async (taskId: string, signal: AbortSignal) => aiTaskRuleDraftPreparationResponse.parse(await post('preparation', aiTaskRuleDraftPreparationInput.parse({ taskId }), signal)),
  previewPreparation: async (value: AiTaskRuleDraftPreparationPreviewInput, signal: AbortSignal) => aiTaskRuleDraftPreparationPreviewResponse.parse(
    await post('previewPreparation', aiTaskRuleDraftPreparationPreviewInput.parse(structuredClone(value)), signal)),
  prepareProposal: async (value: AiTaskRuleDraftPrepareInput, signal: AbortSignal) => aiTaskRuleDraftPreparationOperationResponse.parse(
    await post('prepare', aiTaskRuleDraftPrepareInput.parse(structuredClone(value)), signal)),
  preparationOperation: async (value: AiTaskRuleDraftPreparationReference, signal: AbortSignal) => aiTaskRuleDraftPreparationOperationResponse.parse(
    await post('preparationOperation', aiTaskRuleDraftPreparationReference.parse(structuredClone(value)), signal))
});
