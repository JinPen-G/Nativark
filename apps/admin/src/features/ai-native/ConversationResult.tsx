/** Explicit original-turn text and isolated display from the existing readers.
 * Each turn owns its display port. A result reread suspends the same display;
 * unavailable results or revoked scope withdraw it. No model or business calls. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AI_CONVERSATION_DRAFT_VERSION, AI_TASK_CENTER_ENTRY_PERMISSIONS, validateAiConversationTaskModelDraft,
  type AiConversationTurnObservationDraft, type AiTaskModelObservationDraft, type AiWorkbenchDisplayBindingDraft } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { createAiWorkbenchDisplayPort } from '@/api/aiWorkbenchDisplays';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { ActionButton, Alert } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { VisibleObservationBoundary } from './VisibleObservationBoundary';
import { useVisibleObservationHost } from './VisibleObservationHost';
import { TaskWorkbenchDisplay } from './TaskWorkbenchDisplay';
import { displaySame, type WorkbenchDisplayPort } from './workbench-display-host';
import { ModelText } from './ModelText';
import { safeDisplayText } from './safe-display';
import { useAiManagementLocale } from './management-locale';
import styles from './AiManagement.module.css';

type Result = Awaited<ReturnType<typeof aiConversationsApi.result>>;
type DisplayReference = Pick<AiTaskModelObservationDraft, 'taskId' | 'runId' | 'resultId'>;
type View = { owner: string; result: Result | null; display: DisplayReference | null; busy: boolean; error: boolean };
const emptyView = (owner: string): View => ({ owner, result: null, display: null, busy: false, error: false });
export function ConversationResult({ identity, conversationId, turn, current }: {
  identity?: string; conversationId: string; turn: AiConversationTurnObservationDraft; current: () => boolean;
}) {
  const visible = useVisibleObservationHost();
  const { t } = useAiManagementLocale(), auth = useAuthStore();
  const tenantId = auth.tenant?.tenantId, workspaceId = auth.currentWorkspaceId;
  const epoch = currentSessionEpoch(), signal = currentSessionSignal();
  const authorization = JSON.stringify([tenantId, workspaceId, auth.user, epoch]);
  const owner = JSON.stringify([identity ?? JSON.stringify([tenantId, workspaceId, auth.user?.id]), authorization, conversationId, turn]);
  const [view, setView] = useState(() => emptyView(owner)), latest = useRef(view);
  const [displayEpoch, setDisplayEpoch] = useState(0), livePort = useRef<WorkbenchDisplayPort | null>(null);
  const request = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(false);
  const renderGeneration = generation.current;
  const scope = useRef({ owner, current }); scope.current = { owner, current };
  const permitted = () => {
    const now = useAuthStore.getState();
    return scope.current.owner === owner && currentSessionEpoch() === epoch && !signal.aborted && !document.hidden
      && !!now.token && now.sessionVerified && !!tenantId && !!workspaceId && !!now.user && !now.user.isSaasAdmin
      && AI_TASK_CENTER_ENTRY_PERMISSIONS.some(now.hasPermission) && scope.current.current()
      && authorization === JSON.stringify([now.tenant?.tenantId, now.currentWorkspaceId, now.user, currentSessionEpoch()]);
  };
  const active = () => mounted.current && permitted();
  const publish = (next: View) => { latest.current = next; setView(next); };
  const originalResult = () => {
    const snapshot = latest.current;
    return snapshot.owner === owner && !snapshot.busy && snapshot.result?.status === 'observed'
      && snapshot.result.result.status === 'available' ? snapshot.result.result : null;
  };
  const port = useMemo(() => {
    let retained: AiTaskModelObservationDraft | null = null;
    const original = createAiWorkbenchDisplayPort({ tenantId: tenantId ?? '', workspaceId: workspaceId ?? '',
      current: () => livePort.current === scoped && active() && originalResult() !== null });
    const check = (source: AiTaskModelObservationDraft | null, abort: AbortSignal) => {
      if (!source || abort.aborted || livePort.current !== scoped || !active() || originalResult() !== source) throw Error('AI_SCOPE_CHANGED');
      return source;
    };
    const bound = (binding: AiWorkbenchDisplayBindingDraft, source: AiTaskModelObservationDraft) => {
      if (binding.conversationId !== conversationId || binding.turnId !== turn.turnId || binding.taskId !== source.taskId
        || binding.capabilityCode !== turn.capabilityCode || binding.capabilityVersion !== turn.capabilityVersion
        || !displaySame(binding.original, turn.original)) throw Error('AI_RESOURCE_UNAVAILABLE');
    };
    // These ports only read retained display/source material. Candidate review
    // and approval stay unavailable without their original trusted hosts.
    const scoped: WorkbenchDisplayPort & { activate(): void; dispose(): void } = {
      activate: () => original.activate(),
      dispose: () => { retained = null; original.dispose(); },
      async read(taskId, abort) {
        const source = check(originalResult(), abort);
        if (taskId !== source.taskId) throw Error('AI_RESOURCE_UNAVAILABLE');
        retained = null;
        const material = await original.read(taskId, abort); check(source, abort); bound(material.presentation.binding, source);
        if (material.presentation.generation.runId !== source.runId || material.presentation.generation.resultId !== source.resultId)
          throw Error('AI_RESOURCE_UNAVAILABLE');
        retained = source; return material;
      },
      async revalidate(lease, abort) {
        const source = check(retained, abort); bound(lease.binding, source);
        const next = await original.revalidate(lease, abort); check(source, abort); bound(next.binding, source); return next;
      },
      async readSource(binding, sourceId, abort) {
        const source = check(retained, abort); bound(binding, source);
        const value = await original.readSource!(binding, sourceId, abort); check(source, abort); return value;
      },
    };
    return scoped;
  }, [owner, displayEpoch]);
  const clear = () => {
    generation.current++; request.current?.abort(); request.current = null; livePort.current = null; port.dispose();
    publish(emptyView(owner)); setDisplayEpoch(previous => previous + 1);
  };
  useEffect(() => {
    mounted.current = true; livePort.current = port; port.activate(); publish(emptyView(owner));
    const revoked = () => { if (!permitted()) clear(); };
    document.addEventListener('visibilitychange', clear); signal.addEventListener('abort', clear, { once: true });
    const unsubscribe = useAuthStore.subscribe(revoked);
    return () => { mounted.current = false; generation.current++; request.current?.abort(); request.current = null;
      if (livePort.current === port) livePort.current = null;
      port.dispose(); latest.current = emptyView(owner); unsubscribe();
      document.removeEventListener('visibilitychange', clear); signal.removeEventListener('abort', clear); };
  }, [port]);
  const allowed = permitted();
  useEffect(() => { if (!allowed) clear(); }, [allowed, owner]);
  const read = async () => {
    if (!active() || request.current || generation.current !== renderGeneration) throw Error('AI_SCOPE_CHANGED');
    const controller = new AbortController(); request.current = controller;
    // Keep the display instance and its unsubmitted candidate while the
    // original result is being reread, but revoke every old read port now.
    port.dispose(); publish({ ...latest.current, result: null, busy: true, error: false });
    const reading = () => active() && generation.current === renderGeneration && request.current === controller && !controller.signal.aborted;
    try {
      const value = await aiConversationsApi.result({ draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId,
        admissionKey: turn.admissionKey }, turn, controller.signal);
      if (!reading()) throw Error('AI_SCOPE_CHANGED');
      if (value.status === 'observed' && !validateAiConversationTaskModelDraft(value.result, turn)) throw Error('AI_RESOURCE_UNAVAILABLE');
      const result = value.status === 'observed' && value.result.status === 'available' ? value.result : null;
      publish({ owner, result: value, display: result ? { taskId: result.taskId, runId: result.runId, resultId: result.resultId } : null,
        busy: false, error: false });
      if (result) port.activate();
    } catch (failure) { if (turn.task) visible?.cancelTask(turn.task.taskId);
      if (reading()) { port.dispose(); publish({ ...emptyView(owner), error: true }); } throw failure; }
    finally { if (request.current === controller) request.current = null; }
  };
  const { result, display, busy, error } = view.owner === owner ? view : emptyView(owner);
  if (!allowed) return null;
  return <section aria-label={t('原轮次模型结果')} aria-busy={busy}>
    <p>{safeDisplayText(turn.turnId, 191)}</p>
    <ActionButton label={t(result ? '重读原模型结果' : '读取原模型结果')} disabled={busy || !active()} onAction={read} />
    {error && <Alert type="warning" title={t('原结果当前不可读取，旧正文已清除；不自动重试或重新生成。')} />}
    {result && <>
      <p className={styles.help}>{t('模型文本不证明业务已完成；本次只读，不启动模型或业务。')}</p>
      {result.status === 'material_erased' ? <p>{t('原输入已清理，不恢复正文或执行权限。')}</p>
        : result.status === 'no_task_observed' ? <p>{t('未观察到任务关联，不推断模型未调用。')}</p>
          : result.status === 'no_unique_result' ? <p>{t('该原轮次没有唯一可定位结果，不猜测其他轮次或补造答案。')}</p>
            : result.result.status === 'available' ? <VisibleObservationBoundary kind="text"
                reference={{ taskId: result.result.taskId, runId: result.result.runId, source: { kind: 'model_result', resultId: result.result.resultId } }}
                ready={result.result.text!.value.trim().length > 0 && active()}><ModelText text={result.result.text!.value} /></VisibleObservationBoundary>
              : <p>{t(result.result.status === 'stale' ? '事实已变化，旧正文不显示，请回原业务页核对。'
                : result.result.status === 'unknown' ? '结果待核对，不自动重试。' : '原步骤失败，未产生可展示答案。')}</p>}
    </>}
    {display && tenantId && workspaceId && <TaskWorkbenchDisplay identity={owner}
      expected={{ tenantId, workspaceId, ...display }} port={port} enabled={!busy && originalResult() !== null}
      current={() => active() && generation.current === renderGeneration && (latest.current.busy || originalResult() !== null)} />}
  </section>;
}
