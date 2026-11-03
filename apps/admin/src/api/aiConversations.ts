/** Original conversation transport and explicit Task creation/order-model start.
 * Only orderStart dispatches through the original host; reads never recover a run. */
import { AI_CONVERSATION_HTTP_DRAFT, AI_SCENE_REQUEST_HTTP_DRAFT, AI_SCENE_ORDER_READ_HTTP_DRAFT, type AiSceneRequestReadDraft, type AiConversationListDraft, type AiConversationTurnListDraft,
  type AiConversationTurnReferenceDraft, type AiConversationTurnObservationDraft, type AiConversationCreateDraft,
  type AiConversationMutationDraft, type AiConversationOperationRequestDraft, type AiConversationTurnAdmissionDraft,
  type AiSceneCode, type AiConversationUnstartedCloseDraft, type ApiResult } from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { readConversationHistory, readConversationDetail, readConversationTaskResult } from '@/features/ai-native/conversation-history-reader';
import { aiTaskCenterApi } from './aiTaskCenter';
import { http } from './http';

async function lifecycle(action: 'create' | 'archive' | 'delete' | 'operation' | 'admit' | 'admission' | 'release' | 'closeUnstarted' | 'read', command: unknown, signal: AbortSignal) {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const result = await http.post<ApiResult<unknown>>(`/${AI_CONVERSATION_HTTP_DRAFT.basePath}/${action}`, structuredClone(command), { signal: active });
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  return result.data.data;
}
async function originalTask(action: 'createTask' | 'recovery', input: AiSceneRequestReadDraft, signal: AbortSignal) {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const response = await http.post<ApiResult<unknown>>(`/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT[action]}`,
    structuredClone(input), { signal: active });
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  return response.data.data;
}
async function orderModel(action: 'readPreparation' | 'start' | 'readOrderResult' | 'readAnswer', input: AiSceneRequestReadDraft, signal: AbortSignal) {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const response = await http.post<ApiResult<unknown>>(`/${AI_SCENE_ORDER_READ_HTTP_DRAFT.basePath}/${AI_SCENE_ORDER_READ_HTTP_DRAFT[action]}`,
    structuredClone(input), { signal: active });
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  return response.data.data;
}
export const aiConversationsApi = Object.freeze({
  orderFacts: (input: AiSceneRequestReadDraft, signal: AbortSignal) => orderModel('readOrderResult', input, signal),
  orderAnswer: (input: AiSceneRequestReadDraft, signal: AbortSignal) => orderModel('readAnswer', input, signal),
  orderPreparation: (input: AiSceneRequestReadDraft, signal: AbortSignal) => orderModel('readPreparation', input, signal),
  orderStart: (input: AiSceneRequestReadDraft, signal: AbortSignal) => orderModel('start', input, signal),
  createTask: (input: AiSceneRequestReadDraft, signal: AbortSignal) => originalTask('createTask', input, signal),
  recovery: (input: AiSceneRequestReadDraft, signal: AbortSignal) => originalTask('recovery', input, signal),
  read: (input: import('@rental-os/shared').AiConversationReferenceDraft, signal: AbortSignal) => lifecycle('read', input, signal),
  release: (input: AiConversationMutationDraft, signal: AbortSignal) => lifecycle('release', input, signal),
  closeUnstarted: (input: AiConversationUnstartedCloseDraft, signal: AbortSignal) => lifecycle('closeUnstarted', input, signal),
  admit: (input: AiConversationTurnAdmissionDraft, signal: AbortSignal) => lifecycle('admit', input, signal),
  admission: (input: AiConversationTurnReferenceDraft, signal: AbortSignal) => lifecycle('admission', input, signal),
  create: (input: AiConversationCreateDraft, signal: AbortSignal) => lifecycle('create', input, signal),
  archive: (input: AiConversationMutationDraft, signal: AbortSignal) => lifecycle('archive', input, signal),
  delete: (input: AiConversationMutationDraft, signal: AbortSignal) => lifecycle('delete', input, signal),
  operation: (input: AiConversationOperationRequestDraft, signal: AbortSignal) => lifecycle('operation', input, signal),
  async list(input: AiConversationListDraft, signal: AbortSignal) {
    const epoch = currentSessionEpoch();
    const active = AbortSignal.any([signal, currentSessionSignal()]);
    return readConversationHistory(async (query, requestSignal) => {
      const result = await http.post<ApiResult<unknown>>(`/${AI_CONVERSATION_HTTP_DRAFT.basePath}/list`, query, { signal: requestSignal });
      return result.data.data;
    }, input, active, () => epoch === currentSessionEpoch());
  },
  async detail(input: AiConversationTurnListDraft, capabilityCode: AiSceneCode, signal: AbortSignal) {
    const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
    const read = async (action: 'read' | 'turns', query: unknown, requestSignal: AbortSignal) => {
      const result = await http.post<ApiResult<unknown>>(`/${AI_CONVERSATION_HTTP_DRAFT.basePath}/${action}`, query, { signal: requestSignal });
      return result.data.data;
    };
    return readConversationDetail({ read: (query, signal) => read('read', query, signal),
      turns: (query, signal) => read('turns', query, signal) }, input, capabilityCode, active, () => epoch === currentSessionEpoch());
  },
  async result(input: AiConversationTurnReferenceDraft, turn: AiConversationTurnObservationDraft, signal: AbortSignal) {
    const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
    return readConversationTaskResult({
      admission: async (query, requestSignal) => {
        const response = await http.post<ApiResult<unknown>>(`/${AI_CONVERSATION_HTTP_DRAFT.basePath}/admission`, query, { signal: requestSignal });
        return response.data.data;
      },
      snapshot: aiTaskCenterApi.snapshot, result: aiTaskCenterApi.result,
    }, input, turn, active, () => epoch === currentSessionEpoch());
  },
});
