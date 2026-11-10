import { AI_MEMBER_NAME_HTTP, aiMemberNameResponse, type AiMemberNameQuery, type AiMemberNameLocator,
  type AiMemberNameSelection, type AiMemberNamePrepareInput, type AiMemberNameExecuteInput, type ApiResult } from '@rental-os/shared';
import { http } from './http';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
const post = async (action: keyof Omit<typeof AI_MEMBER_NAME_HTTP, 'basePath'>, value: unknown, signal: AbortSignal) => {
  const epoch = currentSessionEpoch(), combined = AbortSignal.any([signal, currentSessionSignal()]);
  const result = await http.post<ApiResult<unknown>>(`/${AI_MEMBER_NAME_HTTP.basePath}/${AI_MEMBER_NAME_HTTP[action]}`, value,
    { signal: combined, timeout: 12000 });
  if (combined.aborted || currentSessionEpoch() !== epoch) throw Error('AI_SCOPE_CHANGED');
  return aiMemberNameResponse.parse(result.data.data);
};
export const aiMemberNameApi = Object.freeze({ availability: (signal: AbortSignal) => post('availability', {}, signal),
  discover: (query: AiMemberNameQuery, signal: AbortSignal) => post('discover', { query }, signal),
  inspect: (value: AiMemberNameSelection, signal: AbortSignal) => post('inspect', value, signal),
  prepare: (value: AiMemberNamePrepareInput, signal: AbortSignal) => post('prepare', value, signal),
  read: (locator: AiMemberNameLocator, signal: AbortSignal) => post('read', { locator }, signal),
  execute: (value: AiMemberNameExecuteInput, signal: AbortSignal) => post('execute', value, signal) });
