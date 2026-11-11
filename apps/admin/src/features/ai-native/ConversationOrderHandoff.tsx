import { useRef } from 'react';
import { AI_CONVERSATION_DRAFT_VERSION, AI_SCENE_MODEL_HTTP_DRAFT, validateAiConversationAdmissionDraft, validateAiConversationTurnDraft,
  validateAiSceneRequestReceiptDraft, validateAiSceneRequestReconcileDraft,
  type AiConversationTurnObservationDraft, type AiTaskOrderHandoffResponse, type AiTaskSceneReadDraft, type AiTaskSceneObservationDraft,
  type AiSceneRequestReceiptDraft, type AiSceneTaskReceiptDraft, type ApiResult } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { http } from '@/api/http';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { OrderHumanHandoff } from './OrderHumanHandoff';
import { validateTaskCenterSnapshot } from './task-center-reader';
/** A conversation's retained original Task is verified before and after each
 * current-facts read. Reopening a turn creates no original request or model run. */
export function ConversationOrderHandoff({ identity, conversationId, turn, current, onUnavailable, onObserved }: {
  identity: string; conversationId: string; turn: AiConversationTurnObservationDraft; current(): boolean;
  onUnavailable?(): void; onObserved?(value: AiTaskOrderHandoffResponse): void;
}) {
  const auth = useAuthStore(), epoch = currentSessionEpoch();
  const binding = () => { const state = useAuthStore.getState(); return JSON.stringify([identity, conversationId, turn,
    state.tenant?.tenantId, state.currentWorkspaceId, state.user, state.token, currentSessionEpoch()]); };
  const signature = binding(), owner = useRef({ signature, current }); owner.current = { signature, current };
  const source = useRef<{ signature: string; signal: AbortSignal; receipt: AiSceneRequestReceiptDraft;
    task: Extract<AiSceneTaskReceiptDraft, { state: 'observed' }> } | null>(null);
  const valid = () => owner.current.signature === signature && binding() === signature && epoch === currentSessionEpoch()
    && !document.hidden && owner.current.current();
  if (!validateAiConversationTurnDraft(turn) || turn.capabilityCode !== 'order_explanation' || turn.material !== 'retained' || !turn.task || 'creation' in turn) return null;
  const task = turn.task;
  const verify = async (signal: AbortSignal) => {
    const check = () => { if (signal.aborted || !valid()) throw Error('AI_SCOPE_CHANGED'); };
    check();
    const query = { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId, admissionKey: turn.admissionKey };
    const admission = async () => {
      check(); const value = await aiConversationsApi.admission(query, signal); check();
      if (!validateAiConversationAdmissionDraft(value, query) || JSON.stringify(value.result) !== JSON.stringify(turn)) throw Error('AI_REVISION_CONFLICT');
    };
    await admission();
    const reference: AiTaskSceneReadDraft = { kind: 'original', taskId: task.taskId, runId: task.runId, original: turn.original };
    // Read provenance by the original Task/reference under the historical
    // observer; a scene/body admission hash is not the scoped receipt hash.
    const response = await http.post<ApiResult<unknown>>(`/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene}`,
      reference, { signal, timeout: 15000 }); check();
    if (new TextEncoder().encode(JSON.stringify(response.data.data)).length > 262144) throw Error('AI_RESOURCE_UNAVAILABLE');
    const value = response.data.data as AiTaskSceneObservationDraft;
    if (!value || value.kind !== 'original' || value.taskId !== task.taskId || value.runId !== task.runId || value.originRunId !== task.runId
      || !value.originalInput || !value.task || !value.snapshot || value.snapshot.availability !== 'available') throw Error('AI_REVISION_CONFLICT');
    const receipt = value.originalInput.receipt, origin = value.task.original;
    const observed = { state: 'observed' as const, receipt, task: value.task.task };
    if (!validateAiSceneRequestReconcileDraft(observed, turn.original, turn) || observed.task.state !== 'observed' || receipt.state === 'revoked'
      || observed.task.taskId !== task.taskId || observed.task.runId !== task.runId
      || !origin || typeof origin !== 'object' || !('receipt' in origin) || !validateAiSceneRequestReceiptDraft(origin.receipt, turn.original, turn)
      || origin.receipt.contentHash !== receipt.contentHash || origin.receipt.revision !== receipt.revision
      || origin.inputRef !== turn.original.inputRef || origin.inputHash !== receipt.contentHash || origin.inputRevision !== receipt.revision
      || origin.sceneCode !== turn.capabilityCode || origin.sceneVersion !== turn.capabilityVersion || origin.audience !== 'operator'
      || origin.scope?.tenantId !== auth.tenant?.tenantId || origin.scope?.workspaceId !== auth.currentWorkspaceId) throw Error('AI_REVISION_CONFLICT');
    const snapshot = validateTaskCenterSnapshot(value.snapshot.value, task.taskId);
    if (snapshot.sceneCode !== turn.capabilityCode || snapshot.sceneVersion !== turn.capabilityVersion || snapshot.revision !== observed.task.revision) throw Error('AI_REVISION_CONFLICT');
    const previous = source.current;
    if (previous?.signature === signature && previous.signal === signal
      && (previous.receipt.contentHash !== receipt.contentHash || previous.receipt.revision !== receipt.revision
        || JSON.stringify(previous.task) !== JSON.stringify(observed.task))) throw Error('AI_REVISION_CONFLICT');
    await admission(); check(); source.current = { signature, signal, receipt, task: observed.task };
  };
  return <OrderHumanHandoff query={{ taskId: task.taskId, runId: task.runId }} identity={identity}
    current={valid} verify={verify}
    validate={value => { const original = source.current;
      if (!original || original.signature !== signature || original.signal.aborted || !valid()) throw Error('AI_SCOPE_CHANGED');
      if (value.origin.inputRef !== turn.original.inputRef || value.origin.draftVersion !== turn.original.draftVersion
        || value.origin.contentHash !== original.receipt.contentHash || value.origin.requestKey !== original.receipt.requestKey
        || value.origin.sceneVersion !== original.receipt.sceneVersion || value.taskId !== original.task.taskId || value.runId !== original.task.runId
        || value.scope.tenantId !== auth.tenant?.tenantId || value.scope.workspaceId !== auth.currentWorkspaceId) throw Error('AI_REVISION_CONFLICT'); }}
    onUnavailable={onUnavailable} onObserved={onObserved} />;
}
