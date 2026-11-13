/** Task-center consumer of the server-derived original quote selection.
 * The existing human review and linked reprepare keep their separate receipts,
 * approvals and Core execution. Mounting this consumer performs no request. */
import { useEffect, useRef, useState } from 'react';
import { TaskHumanApproval, type TaskOrderReviewReference } from './TaskHumanApproval';
import { QuoteReprepare } from './QuoteReprepare';
import type { AiWorkbenchFieldMaterialDraft, AiApprovalApplicationReferenceDraft, AiTaskReviewQueryDraft } from '@rental-os/shared';
import type { WorkbenchQuoteParameterReview } from './workbench-input-review-session';

export function TaskQuoteReprepare({ taskId, identity, current, onAccessDenied, parameterReview,
  revalidateParameters, onParameterReviewed, requestedProposal }: {
  taskId: string; identity: string; current(): boolean; onAccessDenied(): void;
  parameterReview?: WorkbenchQuoteParameterReview | null;
  revalidateParameters?(review: WorkbenchQuoteParameterReview, signal: AbortSignal): Promise<AiWorkbenchFieldMaterialDraft>;
  onParameterReviewed?(status: 'adopted' | 'conflict'): void;
  requestedProposal?: AiTaskReviewQueryDraft & { proposal: AiApprovalApplicationReferenceDraft };
}) {
  const [source, setSource] = useState<{ owner: string; value: TaskOrderReviewReference } | null>(null);
  const owner = JSON.stringify([identity, taskId]);
  const scope = useRef({ owner, current }); scope.current = { owner, current };
  const active = () => scope.current.owner === owner && !document.hidden && scope.current.current();
  useEffect(() => {
    const retract = () => { if (document.hidden) setSource(null); };
    document.addEventListener('visibilitychange', retract);
    return () => document.removeEventListener('visibilitychange', retract);
  }, [owner]);
  return <>
    <TaskHumanApproval key={owner} taskId={taskId} identity={identity} current={active} onAccessDenied={onAccessDenied}
      requestedProposal={requestedProposal}
      onOrderReviewed={value => {
        if (!active()) return;
        setSource(value?.taskId === taskId && value.selection ? { owner, value: structuredClone(value) } : null);
      }} />
    {active() && source?.owner === owner && source.value.selection && source.value.taskId === taskId && <QuoteReprepare
      key={JSON.stringify([owner, source.value.selection.draftVersion, source.value.selection.taskId,
        source.value.selection.runId, source.value.selection.selectionId, source.value.selection.originalInputRef, source.value.selection.inputHash])}
      selection={source.value.selection}
      parameterReview={parameterReview?.candidate.binding.taskId === taskId ? parameterReview : null}
      revalidateParameters={revalidateParameters} onParameterReviewed={onParameterReviewed}
      original={source.value.original} showOriginalApproval={false} identity={identity} current={active} onAccessDenied={onAccessDenied} />}
  </>;
}
