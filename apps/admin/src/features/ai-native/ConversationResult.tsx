/** Original admission plus server-proven model successors in the chat host.
 * Display candidates only open the existing human review. Explicit approval,
 * answers and model controls retain their original keys/receipts; reopening
 * and result reads never start another model or business action. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AI_CONVERSATION_DRAFT_VERSION, AI_TASK_CENTER_ENTRY_PERMISSIONS, validateAiConversationTaskResultDraft,
  type AiConversationTurnObservationDraft, type AiTaskModelObservationDraft, type AiWorkbenchModelControlObservation } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { aiTaskCenterApi } from '@/api/aiTaskCenter';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { ActionButton, Alert } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { VisibleObservationBoundary } from './VisibleObservationBoundary';
import { useVisibleObservationHost } from './VisibleObservationHost';
import { TaskWorkbenchDisplay } from './TaskWorkbenchDisplay';
import { TaskWorkbenchModelControlProvider } from './TaskWorkbenchModelControls';
import { TaskClarification } from './TaskClarification';
import { TaskQuoteReprepare } from './TaskQuoteReprepare';
import { TaskHumanApproval } from './TaskHumanApproval';
import { createConversationWorkbenchHost, type ConversationRequestedProposal, type ConversationWorkbenchSource } from './conversation-workbench-host';
import { ModelText } from './ModelText';
import { safeDisplayText } from './safe-display';
import { useAiManagementLocale } from './management-locale';
import type { QuoteAnswerReference } from './conversation-quote-confirmation-session';
import styles from './AiManagement.module.css';

type Result = Awaited<ReturnType<typeof aiConversationsApi.currentResult>>;
type DisplayReference = Pick<AiTaskModelObservationDraft, 'taskId' | 'runId' | 'resultId'>;
type View = { owner: string; result: Result | null; display: DisplayReference | null; busy: boolean; error: boolean };
const emptyView = (owner: string): View => ({ owner, result: null, display: null, busy: false, error: false });
const emptyReview = { busy: false, review: null, parameters: null, unavailable: false };
const noSubscribe = () => () => {};
const emptyReviewSnapshot = () => emptyReview;
export function ConversationResult({ identity, conversationId, turn, current, onAccessDenied, onAnswerReceipt }: {
  identity?: string; conversationId: string; turn: AiConversationTurnObservationDraft; current: () => boolean;
  onAccessDenied?: () => void;
  onAnswerReceipt?: (receipt: QuoteAnswerReference | null) => void;
}) {
  const visible = useVisibleObservationHost();
  const { t } = useAiManagementLocale(), auth = useAuthStore();
  const tenantId = auth.tenant?.tenantId, workspaceId = auth.currentWorkspaceId;
  const epoch = currentSessionEpoch(), signal = currentSessionSignal();
  const authorization = JSON.stringify([tenantId, workspaceId, auth.user, epoch]);
  const reviewIdentity = identity ?? JSON.stringify([tenantId, workspaceId, auth.user?.id]);
  const owner = JSON.stringify([reviewIdentity, authorization, conversationId, turn]);
  const [view, setView] = useState(() => emptyView(owner)), latest = useRef(view);
  const [displayEpoch, setDisplayEpoch] = useState(0);
  const [reviewSection, setReviewSection] = useState<'input' | 'approval' | null>(null);
  const [requestedProposal, setRequestedProposal] = useState<ConversationRequestedProposal | null>(null);
  const liveHost = useRef<ReturnType<typeof createConversationWorkbenchHost> | null>(null);
  const request = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(false);
  const renderGeneration = generation.current;
  const scope = useRef({ owner, current, onAccessDenied }); scope.current = { owner, current, onAccessDenied };
  const permitted = () => {
    const now = useAuthStore.getState();
    return scope.current.owner === owner && currentSessionEpoch() === epoch && !signal.aborted && !document.hidden
      && !!now.token && now.sessionVerified && !!tenantId && !!workspaceId && !!now.user && !now.user.isSaasAdmin
      && AI_TASK_CENTER_ENTRY_PERMISSIONS.some(now.hasPermission) && scope.current.current()
      && authorization === JSON.stringify([now.tenant?.tenantId, now.currentWorkspaceId, now.user, currentSessionEpoch()]);
  };
  const active = () => mounted.current && permitted();
  const publish = (next: View) => { latest.current = next; setView(next); };
  const originalResult = (): ConversationWorkbenchSource | null => {
    const snapshot = latest.current;
    return snapshot.owner === owner && !snapshot.busy && snapshot.result?.status === 'observed'
      && snapshot.result.result.status === 'available' ? snapshot.result : null;
  };
  const host = useMemo(() => {
    if (!turn.task || turn.material !== 'retained' || 'creation' in turn || !tenantId || !workspaceId) return null;
    const scoped = createConversationWorkbenchHost({ conversationId, turn, tenantId, workspaceId,
      source: originalResult, current: () => liveHost.current === scoped && active(),
      admission: aiConversationsApi.admission, tasks: aiTaskCenterApi,
      onReview: section => { setRequestedProposal(null); setReviewSection(section); },
      onConfirmation: reference => { setRequestedProposal(reference); setReviewSection('approval'); },
    });
    return scoped;
  }, [owner, displayEpoch]);
  const reviewState = useSyncExternalStore(host?.inputReview.subscribe ?? noSubscribe,
    host?.inputReview.snapshot ?? emptyReviewSnapshot, host?.inputReview.snapshot ?? emptyReviewSnapshot);
  const clear = () => {
    generation.current++; request.current?.abort(); request.current = null; liveHost.current = null; host?.port.dispose();
    publish(emptyView(owner)); setReviewSection(null); setRequestedProposal(null); setDisplayEpoch(previous => previous + 1);
  };
  const deny = () => { clear(); scope.current.onAccessDenied?.(); };
  useEffect(() => {
    mounted.current = true; liveHost.current = host; host?.port.activate(); publish(emptyView(owner));
    setReviewSection(null); setRequestedProposal(null);
    const revoked = () => { if (!permitted()) clear(); };
    document.addEventListener('visibilitychange', clear); signal.addEventListener('abort', clear, { once: true });
    const unsubscribe = useAuthStore.subscribe(revoked);
    return () => { mounted.current = false; generation.current++; request.current?.abort(); request.current = null;
      if (liveHost.current === host) liveHost.current = null;
      host?.port.dispose(); latest.current = emptyView(owner); unsubscribe();
      document.removeEventListener('visibilitychange', clear); signal.removeEventListener('abort', clear); };
  }, [host, owner]);
  const allowed = permitted();
  useEffect(() => { if (!allowed) clear(); }, [allowed, owner]);
  const read = async (control?: AiWorkbenchModelControlObservation, controlSignal?: AbortSignal) => {
    if (!active() || request.current || generation.current !== renderGeneration) throw Error('AI_SCOPE_CHANGED');
    if (control && control.taskId !== turn.task?.taskId) throw Error('AI_RESOURCE_UNAVAILABLE');
    const controller = new AbortController(); request.current = controller;
    const abort = controlSignal ? AbortSignal.any([controller.signal, controlSignal]) : controller.signal;
    // Keep the display instance and its unsubmitted candidate while the
    // original result is being reread, but revoke every old read port now.
    host?.port.suspend(); publish({ ...latest.current, result: null, busy: true, error: false });
    const ownsRead = () => active() && generation.current === renderGeneration && request.current === controller;
    const reading = () => ownsRead() && !abort.aborted;
    try {
      const reference = { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId, admissionKey: turn.admissionKey };
      const value = control ? await aiConversationsApi.controlResult(reference, turn, control, abort)
        : await aiConversationsApi.currentResult(reference, turn, abort);
      if (!reading()) throw Error('AI_SCOPE_CHANGED');
      if (!validateAiConversationTaskResultDraft(value, reference, turn)) throw Error('AI_RESOURCE_UNAVAILABLE');
      if (control && (value.status !== 'observed' || value.result.runId !== control.runId
        || value.result.resultId !== control.resultId || value.lineage.kind !== 'model_control'
        || value.result.status !== 'available')) throw Error('AI_REVISION_CONFLICT');
      const result = value.status === 'observed' && value.result.status === 'available' ? value.result : null;
      publish({ owner, result: value, display: result ? { taskId: result.taskId, runId: result.runId, resultId: result.resultId } : null,
        busy: false, error: false });
      setRequestedProposal(null); if (!result) setReviewSection(null);
      if (result) host?.port.activate();
    } catch (failure) { if (turn.task) visible?.cancelTask(turn.task.taskId);
      if (ownsRead()) { host?.port.suspend(); publish({ ...emptyView(owner), error: true }); setReviewSection(null); setRequestedProposal(null);
        if ([401, 403].includes((failure as { response?: { status?: number } }).response?.status ?? 0)) deny(); }
      throw failure; }
    finally { if (request.current === controller) request.current = null; }
  };
  const currentRead = useRef(read); currentRead.current = read;
  const controlHost = useMemo(() => ({ identity: owner, taskId: turn.task?.taskId ?? null,
    current: () => active() && liveHost.current === host,
    refresh: (value: AiWorkbenchModelControlObservation, abort: AbortSignal) => {
      if (!active() || liveHost.current !== host || abort.aborted) return Promise.reject(Error('AI_SCOPE_CHANGED'));
      return currentRead.current(value, abort);
    },
  }), [host, owner]);
  const { result, display, busy, error } = view.owner === owner ? view : emptyView(owner);
  if (!allowed) return null;
  return <section aria-label={t('原轮次模型结果')} aria-busy={busy}>
    <p>{safeDisplayText(turn.turnId, 191)}</p>
    <ActionButton label={t(result ? '重读原模型结果' : '读取原模型结果')} disabled={busy || !active()} onAction={() => read()} />
    {error && <Alert type="warning" title={t('原结果当前不可读取，旧正文已清除；不自动重试或重新生成。')} />}
    {result && <>
      <p className={styles.help}>{t('模型文本不证明业务已完成；本次只读，不启动模型或业务。')}</p>
      {result.status === 'material_erased' ? <p>{t('原输入已清理，不恢复正文或执行权限。')}</p>
        : result.status === 'no_task_observed' ? <p>{t('未观察到任务关联，不推断模型未调用。')}</p>
          : result.status === 'no_unique_result' ? <p>{t('该原轮次没有唯一可定位结果，不猜测其他轮次或补造答案。')}</p>
            : result.status === 'observed' && result.result.status === 'available' ? <VisibleObservationBoundary kind="text"
                reference={{ taskId: result.result.taskId, runId: result.result.runId, source: { kind: 'model_result', resultId: result.result.resultId } }}
                ready={result.result.text!.value.trim().length > 0 && active()}><ModelText text={result.result.text!.value} /></VisibleObservationBoundary>
              : result.status === 'observed' && <p>{t(result.result.status === 'stale' ? '事实已变化，旧正文不显示，请回原业务页核对。'
                : result.result.status === 'unknown' ? '结果待核对，不自动重试。' : '原步骤失败，未产生可展示答案。')}</p>}
    </>}
    {host && turn.task && tenantId && workspaceId && <TaskWorkbenchModelControlProvider value={controlHost}>
      <TaskWorkbenchDisplay identity={owner} expected={{ tenantId, workspaceId, taskId: turn.task.taskId,
        runId: display?.runId ?? turn.task.runId, ...(display ? { resultId: display.resultId } : {}) }}
        port={host.port} enabled={!busy && originalResult() !== null}
        current={() => active() && generation.current === renderGeneration} />
      {(reviewSection === 'input' || onAnswerReceipt) && <section aria-label={t('补充信息')} hidden={busy} inert={busy}>
        <TaskClarification key={`input:${owner}`} taskId={turn.task.taskId} identity={reviewIdentity}
          current={() => active() && !latest.current.busy && (!reviewState.review || host.reviewCurrent())} onAccessDenied={deny}
          onReceiptChange={onAnswerReceipt}
          candidateReview={host.reviewCurrent() ? reviewState.review : null}
          onCandidateReviewed={status => { if (status === 'adopted') host.inputReview.clear(); }} />
      </section>}
      {reviewSection === 'approval' && <section aria-label={t('人工确认')} hidden={busy} inert={busy}>
        {turn.capabilityCode === 'quote_clarification' ? <TaskQuoteReprepare key={`approval:${owner}`}
            taskId={turn.task.taskId} identity={reviewIdentity} current={() => active() && !latest.current.busy} onAccessDenied={deny}
            requestedProposal={requestedProposal ?? undefined} parameterReview={host.reviewCurrent() ? reviewState.parameters : null}
            revalidateParameters={host.revalidateParameters} onParameterReviewed={status => { if (status === 'adopted') host.inputReview.clear(); }} />
            : <TaskHumanApproval key={`approval:${owner}`} taskId={turn.task.taskId} identity={reviewIdentity}
              current={() => active() && !latest.current.busy} onAccessDenied={deny} requestedProposal={requestedProposal ?? undefined} />}
      </section>}
    </TaskWorkbenchModelControlProvider>}
  </section>;
}
