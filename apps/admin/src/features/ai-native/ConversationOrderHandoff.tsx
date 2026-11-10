import { useRef } from 'react';
import { AI_CONVERSATION_DRAFT_VERSION, validateAiConversationAdmissionDraft, validateAiConversationTurnDraft,
  type AiConversationTurnObservationDraft, type AiTaskOrderHandoffResponse } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { OrderHumanHandoff } from './OrderHumanHandoff';
/** A conversation's retained original Task is verified before and after each
 * current-facts read. Reopening a turn creates no original request or model run. */
export function ConversationOrderHandoff({ identity, conversationId, turn, current, onUnavailable, onObserved }: {
  identity: string; conversationId: string; turn: AiConversationTurnObservationDraft; current(): boolean;
  onUnavailable?(): void; onObserved?(value: AiTaskOrderHandoffResponse): void;
}) {
  const signature = JSON.stringify([conversationId, turn]), owner = useRef({ signature, current }); owner.current = { signature, current };
  if (!validateAiConversationTurnDraft(turn) || turn.capabilityCode !== 'order_explanation' || turn.material !== 'retained' || !turn.task || 'creation' in turn) return null;
  const verify = async (signal: AbortSignal) => {
    if (signal.aborted || owner.current.signature !== signature || !owner.current.current()) throw Error('AI_SCOPE_CHANGED');
    const query = { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId, admissionKey: turn.admissionKey };
    const value = await aiConversationsApi.admission(query, signal);
    if (signal.aborted || owner.current.signature !== signature || !owner.current.current()
      || !validateAiConversationAdmissionDraft(value, query) || JSON.stringify(value.result) !== JSON.stringify(turn)) throw Error('AI_REVISION_CONFLICT');
  };
  return <OrderHumanHandoff query={{ taskId: turn.task.taskId, runId: turn.task.runId }} identity={identity}
    current={() => owner.current.signature === signature && owner.current.current()} verify={verify}
    validate={value => { if (value.origin.inputRef !== turn.original.inputRef || value.origin.draftVersion !== turn.original.draftVersion
      || value.origin.contentHash !== turn.requestHash || value.origin.requestKey !== turn.originalRequestKey
      || value.origin.sceneVersion !== turn.capabilityVersion) throw Error('AI_REVISION_CONFLICT'); }}
    onUnavailable={onUnavailable} onObserved={onObserved} />;
}
