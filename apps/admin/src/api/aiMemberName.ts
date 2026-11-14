import { AI_MEMBER_NAME_HTTP, aiMemberNameResponse, type AiMemberNameQuery, type AiMemberNameLocator,
  type AiMemberNameSelection, type AiMemberNamePrepareInput, type AiMemberNameExecuteInput,
  type AiMemberNameReconfirmationInspectInput, type AiMemberNameReconfirmationPrepareInput,
  type AiMemberNameStartReviewInput, type ApiResult } from '@rental-os/shared';
import { http } from './http';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
const post = async (action: keyof Omit<typeof AI_MEMBER_NAME_HTTP, 'basePath'>, value: unknown, signal: AbortSignal) => {
  const epoch = currentSessionEpoch(), combined = AbortSignal.any([signal, currentSessionSignal()]);
  if (combined.aborted) throw Error('AI_SCOPE_CHANGED');
  const write = ['prepare', 'execute', 'prepareReconfirmation', 'startReview'].includes(action);
  // The original operation may be durable when authentication delivery fails.
  // A new credential cannot authorize replay of that same POST.
  const result = await http.post<ApiResult<unknown>>(`/${AI_MEMBER_NAME_HTTP.basePath}/${AI_MEMBER_NAME_HTTP[action]}`, structuredClone(value),
    { signal: combined, timeout: 12000, ...(write ? { _authRetry: true } : {}) });
  if (combined.aborted || currentSessionEpoch() !== epoch) throw Error('AI_SCOPE_CHANGED');
  return aiMemberNameResponse.parse(result.data.data);
};
export const aiMemberNameApi = Object.freeze({ availability: (signal: AbortSignal) => post('availability', {}, signal),
  discover: (query: AiMemberNameQuery, signal: AbortSignal) => post('discover', { query }, signal),
  inspect: (value: AiMemberNameSelection, signal: AbortSignal) => post('inspect', value, signal),
  prepare: (value: AiMemberNamePrepareInput, signal: AbortSignal) => post('prepare', value, signal),
  read: (locator: AiMemberNameLocator, signal: AbortSignal) => post('read', { locator }, signal),
  execute: (value: AiMemberNameExecuteInput, signal: AbortSignal) => post('execute', value, signal),
  inspectReconfirmation: (value: AiMemberNameReconfirmationInspectInput, signal: AbortSignal) => post('inspectReconfirmation', value, signal),
  prepareReconfirmation: (value: AiMemberNameReconfirmationPrepareInput, signal: AbortSignal) => post('prepareReconfirmation', value, signal),
  readReconfirmation: (locator: AiMemberNameLocator, signal: AbortSignal) => post('readReconfirmation', { locator }, signal),
  startReview: (value: AiMemberNameStartReviewInput, signal: AbortSignal) => post('startReview', value, signal) });
