/** Task-center consumer of the server-derived original quote selection.
 * The existing human review and linked reprepare keep their separate receipts,
 * approvals and Core execution. Mounting this consumer performs no request. */
import { useEffect, useRef, useState } from 'react';
import { TaskHumanApproval, type TaskOrderReviewReference } from './TaskHumanApproval';
import { QuoteReprepare } from './QuoteReprepare';

export function TaskQuoteReprepare({ taskId, identity, current, onAccessDenied }: {
  taskId: string; identity: string; current(): boolean; onAccessDenied(): void;
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
      onOrderReviewed={value => {
        if (!active()) return;
        setSource(value?.taskId === taskId && value.selection ? { owner, value: structuredClone(value) } : null);
      }} />
    {active() && source?.owner === owner && source.value.selection && source.value.taskId === taskId && <QuoteReprepare
      key={JSON.stringify([owner, source.value.selection, source.value.original])} selection={source.value.selection}
      original={source.value.original} showOriginalApproval={false} identity={identity} current={active} onAccessDenied={onAccessDenied} />}
  </>;
}
