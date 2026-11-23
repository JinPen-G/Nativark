import { createAiModelControlApi } from "@rental-os/ai-native-admin/source/api/aiModelControl";
/** Original conversation transport and explicit Task creation/scene-model starts.
 * Starts use the original hosts; reads never recover a run or dispatch a model. */
import { AI_CONVERSATION_HTTP_DRAFT, AI_SCENE_REQUEST_HTTP_DRAFT, AI_SCENE_REQUEST_DRAFT_VERSION, AI_SCENE_ORDER_READ_HTTP_DRAFT, AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT, AI_SCENE_MODEL_HTTP_DRAFT, aiTaskReadPolicyQuery, type AiSceneRequestReadDraft, type AiConversationListDraft, type AiConversationTurnListDraft,
  type AiConversationTurnReferenceDraft, type AiConversationTurnObservationDraft, type AiConversationCreateDraft,
  type AiConversationMutationDraft, type AiConversationOperationRequestDraft, type AiConversationTurnAdmissionDraft,
  type AiSceneCode, type AiConversationUnstartedCloseDraft, type ApiResult,
  type AiWorkbenchModelControlCommand, type AiWorkbenchModelControlReference, type AiWorkbenchModelControlPreparation,
  type AiWorkbenchModelControlObservation, validateAiConversationTaskResultDraft, type AiConversationTaskResultDraft,
  type AiSceneModelAnswerQueryDraft, type AiSceneModelQuoteConfirmDraft, type AiTaskSceneReadDraft, type AiTaskSceneObservationDraft } from '@rental-os/shared';
import { readConversationHistory, readConversationDetail, readConversationTaskResult } from '../ai-native/conversation-history-reader';
import { createAiTaskCenterApi } from '@rental-os/ai-native-admin/source/api/aiTaskCenter';
import { parseWorkbenchModelControl } from '@rental-os/ai-native-admin/source/ai-native/workbench-model-control-session';
import { displaySame } from '@rental-os/ai-native-admin/source/ai-native/workbench-display-host';
import type { RentalAssistantTransport } from "../transport";

export function createAiConversationsApi(transport: RentalAssistantTransport) {
  const { http, useAuthStore, currentSessionEpoch, currentSessionSignal } = transport.session;
  const aiTaskCenterApi = createAiTaskCenterApi(transport.session.runtime);


async function currentConversationResult(input: AiConversationTurnReferenceDraft, turn: AiConversationTurnObservationDraft,
  signal: AbortSignal): Promise<AiConversationTaskResultDraft> {
  const command = structuredClone(input), expected = structuredClone(turn), epoch = currentSessionEpoch();
  const active = AbortSignal.any([signal, currentSessionSignal()]), auth = useAuthStore.getState();
  const owner = JSON.stringify([auth.user, auth.tenant?.tenantId, auth.currentWorkspaceId]);
  const check = () => { const now = useAuthStore.getState();
    if (active.aborted || epoch !== currentSessionEpoch() || !now.token || !now.sessionVerified || !now.user || now.user.isSaasAdmin
      || !now.tenant?.tenantId || !now.currentWorkspaceId
      || owner !== JSON.stringify([now.user, now.tenant.tenantId, now.currentWorkspaceId])) throw Error('AI_SCOPE_CHANGED');
  };
  check();
  const config = { signal: active, timeout: 15000, _authRetry: true };
  const response = await http.post<ApiResult<unknown>>(`/${AI_CONVERSATION_HTTP_DRAFT.basePath}/task-result`, command,
    config);
  check();
  if (!validateAiConversationTaskResultDraft(response.data.data, command, expected)) throw Error('AI_RESOURCE_UNAVAILABLE');
  return structuredClone(response.data.data);
}

async function controlConversationResult(input: AiConversationTurnReferenceDraft, turn: AiConversationTurnObservationDraft,
  value: AiWorkbenchModelControlObservation, signal: AbortSignal): Promise<AiConversationTaskResultDraft> {
  const selected = parseWorkbenchModelControl('AiWorkbenchModelControlObservation', value);
  if (selected.status !== 'available' || !selected.runId || !selected.resultId || selected.taskId !== turn.task?.taskId)
    throw Error('AI_RESOURCE_UNAVAILABLE');
  const reference = { taskId: selected.taskId, operationId: selected.operationId };
  const before = await workbenchControl('model-control-read', reference, signal);
  if (!displaySame(before, selected)) throw Error('AI_REVISION_CONFLICT');
  const result = await currentConversationResult(input, turn, signal);
  if (result.status !== 'observed' || result.lineage.kind !== 'model_control' || result.result.taskId !== selected.taskId
    || result.result.runId !== selected.runId || result.result.resultId !== selected.resultId
    || result.lineage.runSequence !== selected.presentationRevision) throw Error('AI_REVISION_CONFLICT');
  if (!displaySame(before, await workbenchControl('model-control-read', reference, signal))) throw Error('AI_REVISION_CONFLICT');
  return result;
}

const originalModelControl = createAiModelControlApi(transport.aiHost);
async function workbenchControl(action: 'model-control-prepare', input: { taskId: string }, signal: AbortSignal): Promise<AiWorkbenchModelControlPreparation>;
async function workbenchControl(action: 'model-control' | 'model-control-read', input: AiWorkbenchModelControlCommand | AiWorkbenchModelControlReference,
  signal: AbortSignal): Promise<AiWorkbenchModelControlObservation>;
async function workbenchControl(action: 'model-control-prepare' | 'model-control' | 'model-control-read', input: unknown, signal: AbortSignal) {
  if (action === 'model-control-prepare') return originalModelControl.prepare(parseWorkbenchModelControl('AiWorkbenchDisplayReadDraft', input), signal);
  if (action === 'model-control') return originalModelControl.execute(parseWorkbenchModelControl('AiWorkbenchModelControlCommand', input), signal);
  return originalModelControl.read(parseWorkbenchModelControl('AiWorkbenchModelControlReference', input), signal);
}

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
/** Historical source observation uses the persisted Task/Run/reference. The
 * creation-command reconcile route cannot accept this minimal journal. */
async function originalReceipt(input: Extract<AiTaskSceneReadDraft, { kind: 'original' }>, signal: AbortSignal) {
  const command = structuredClone(input);
  if (!command || command.kind !== 'original' || Object.keys(command).length !== 4 || !command.original
    || Object.keys(command.original).length !== 2 || command.original.draftVersion !== AI_SCENE_REQUEST_DRAFT_VERSION
    || typeof command.original.inputRef !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(command.original.inputRef)
    || typeof command.runId !== 'string') throw Error('AI_INVALID_INPUT');
  aiTaskReadPolicyQuery.parse({ taskId: command.taskId, runId: command.runId });
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  const auth = useAuthStore.getState(), tenantId = auth.tenant?.tenantId, workspaceId = auth.currentWorkspaceId;
  const owner = JSON.stringify([auth.user, tenantId, workspaceId]);
  const check = () => {
    const current = useAuthStore.getState();
    if (active.aborted || epoch !== currentSessionEpoch() || !tenantId || !workspaceId || !current.token || current.user?.isSaasAdmin
      || JSON.stringify([current.user, current.tenant?.tenantId, current.currentWorkspaceId]) !== owner) throw Error('AI_SCOPE_CHANGED');
  };
  check();
  const response = await http.post<ApiResult<unknown>>(`/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene}`,
    command, { signal: active, timeout: 15000 }); check();
  if (new TextEncoder().encode(JSON.stringify(response.data.data)).length > 262144) throw Error('AI_RESOURCE_UNAVAILABLE');
  const value = response.data.data as Extract<AiTaskSceneObservationDraft, { kind: 'original' }>;
  if (!value || value.kind !== 'original' || value.taskId !== command.taskId || value.runId !== command.runId
    || value.originRunId !== command.runId || !value.task || !value.task.original || typeof value.task.original !== 'object'
    || !('receipt' in value.task.original) || value.task.original.scope?.tenantId !== tenantId
    || value.task.original.scope?.workspaceId !== workspaceId || value.task.original.audience !== 'operator') throw Error('AI_SCOPE_CHANGED');
  return value;
}
async function openingStart(input: AiSceneRequestReadDraft, signal: AbortSignal) {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const response = await http.post<ApiResult<unknown>>(`/${AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT.basePath}/${AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT.start}`,
    structuredClone(input), { signal: active, timeout: 120000 });
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  return response.data.data;
}
async function quoteStart(input: AiSceneRequestReadDraft, signal: AbortSignal) {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const response = await http.post<ApiResult<unknown>>(`/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${AI_SCENE_MODEL_HTTP_DRAFT.start}`,
    structuredClone(input), { signal: active, timeout: 120000 });
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  return response.data.data;
}
async function quoteOperation(action: 'readQuotePreparation' | 'confirmClarifiedQuote' | 'readClarifiedQuoteReceipt',
  input: AiSceneModelAnswerQueryDraft | AiSceneModelQuoteConfirmDraft, signal: AbortSignal) {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const response = await http.post<ApiResult<unknown>>(`/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${AI_SCENE_MODEL_HTTP_DRAFT[action]}`,
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
const aiConversationsApi = Object.freeze({
  prepareModelControl: (input: { taskId: string }, signal: AbortSignal) => workbenchControl('model-control-prepare', input, signal),
  modelControl: (input: AiWorkbenchModelControlCommand, signal: AbortSignal) => workbenchControl('model-control', input, signal),
  readModelControl: (input: AiWorkbenchModelControlReference, signal: AbortSignal) => workbenchControl('model-control-read', input, signal),
  openingStart,
  quoteStart,
  quotePreparation: (input: AiSceneModelAnswerQueryDraft, signal: AbortSignal) => quoteOperation('readQuotePreparation', input, signal),
  quoteConfirm: (input: AiSceneModelQuoteConfirmDraft, signal: AbortSignal) => quoteOperation('confirmClarifiedQuote', input, signal),
  quoteReceipt: (input: AiSceneModelAnswerQueryDraft, signal: AbortSignal) => quoteOperation('readClarifiedQuoteReceipt', input, signal),
  originalReceipt,
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
  async detail(input: AiConversationTurnListDraft, capabilityCode: AiSceneCode, signal: AbortSignal, includeClosedTurn = false) {
    const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
    const read = async (action: 'read' | 'turns', query: unknown, requestSignal: AbortSignal) => {
      const result = await http.post<ApiResult<unknown>>(`/${AI_CONVERSATION_HTTP_DRAFT.basePath}/${action}`, query, { signal: requestSignal });
      return result.data.data;
    };
    return readConversationDetail({ read: (query, signal) => read('read', includeClosedTurn ? { ...query, includeClosedTurn: true } : query, signal),
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
      orderAnswer: (original, requestSignal) => orderModel('readAnswer', original, requestSignal),
    }, input, turn, active, () => epoch === currentSessionEpoch());
  },
  currentResult: currentConversationResult,
  controlResult: controlConversationResult,
});

  return aiConversationsApi;
}
export type AiConversationsApi = ReturnType<typeof createAiConversationsApi>;
