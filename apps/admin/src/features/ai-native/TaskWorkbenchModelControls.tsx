/** Trusted React controls outside the opaque display. The original server
 * selects the source and executes one model operation; frame messages have
 * no path to these handlers or to business preparation/approval. */
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { AiWorkbenchModelControlObservation, AiWorkbenchModelControlKind } from '@rental-os/shared';
import { ActionButton, Alert } from '@/components/ui';
import { aiConversationsApi } from '@/api/aiConversations';
import { useAuthStore } from '@/features/auth/authStore';
import { useAiManagementLocale } from './management-locale';
import { WorkbenchModelControlSession, workbenchModelControlStorageKey, type WorkbenchModelControlState } from './workbench-model-control-session';
import styles from './AiManagement.module.css';

interface ControlHost {
  identity: string; taskId: string | null; current(): boolean;
  refresh(value: AiWorkbenchModelControlObservation, signal: AbortSignal): Promise<void>;
}
const ControlHostContext = createContext<ControlHost | null>(null);
export function TaskWorkbenchModelControlProvider({ value, children }: { value: ControlHost; children: ReactNode }) {
  return <ControlHostContext.Provider value={value}>{children}</ControlHostContext.Provider>;
}
export const useTaskWorkbenchModelControlHost = () => useContext(ControlHostContext);
const port = { prepare: aiConversationsApi.prepareModelControl, execute: aiConversationsApi.modelControl, read: aiConversationsApi.readModelControl };
const kindLabels: Record<AiWorkbenchModelControlKind, string> = { reinterpret: '重新解释', reformat: '重新排版' };
const errorLabels: Record<NonNullable<WorkbenchModelControlState['error']>, string> = {
  source_unavailable: '当前无法准备模型操作，仍可查看原结果或使用人工入口。',
  operation_unknown: '本次调用结果待核对，请读取原操作。',
  journal_unavailable: '原操作定位无法核对，请保留原任务记录并核对原操作。',
  result_unavailable: '原模型调用已完成，当前结果尚不可展示。可重读这次原结果。',
};
function statusLabel(state: WorkbenchModelControlState): string {
  if (state.preparation) return '当前原结果已核对，请选择操作。';
  switch (state.observation?.status) {
    case 'available': return '本次模型调用已完成，结果仍按当前权限读取。';
    case 'failed': return '本次模型调用失败，原操作和用量记录已保留。';
    case 'registered': case 'running': return '本次调用已登记，请核对原操作查看进展。';
    default: return state.original ? '已保留上次操作，先核对原结果。' : '';
  }
}

export function TaskWorkbenchModelControls({ identity, taskId, sourceEnabled, sourceRunId, sourceResultId, current, onAvailable }: {
  identity: string; taskId: string; sourceEnabled: boolean; sourceRunId?: string; sourceResultId?: string; current(): boolean;
  onAvailable(value: AiWorkbenchModelControlObservation, signal: AbortSignal): Promise<void>;
}) {
  const { t } = useAiManagementLocale(), auth = useAuthStore.getState();
  const storageKey = workbenchModelControlStorageKey({ tenantId: auth.tenant?.tenantId ?? '',
    workspaceId: auth.currentWorkspaceId ?? '', userId: auth.user?.id ?? '', taskId });
  const scope = useRef({ identity, taskId, storageKey, sourceEnabled, current, onAvailable });
  scope.current = { identity, taskId, storageKey, sourceEnabled, current, onAvailable };
  const session = useMemo(() => new WorkbenchModelControlSession({ taskId, port,
    current: () => scope.current.identity === identity && scope.current.taskId === taskId && scope.current.storageKey === storageKey
      && !document.hidden && scope.current.current(),
    sourceEnabled: () => scope.current.sourceEnabled,
    newKey: () => crypto.randomUUID(),
    store: { read: () => window.localStorage.getItem(storageKey), write: value => window.localStorage.setItem(storageKey, value),
      exclusive: async work => {
        if (!navigator.locks) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
        return await navigator.locks.request(storageKey, async () => work());
      } },
    onAvailable: (value, signal) => scope.current.onAvailable(value, signal),
  }), [identity, taskId, storageKey]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => {
    session.activate();
    // Reopening may observe only the retained operation, never prepare or run.
    if (session.snapshot().original && !session.snapshot().invalid) void session.read().catch(() => undefined);
    return () => session.dispose();
  }, [session]);
  useEffect(() => {
    const changed = () => {
      if (document.hidden) session.suspend();
      else if (scope.current.current() && session.snapshot().original) void session.read().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', changed);
    // Storage events are hints to reread the original journal, not operation
    // receipts. Abort old delivery before inspecting another tab's locator.
    const journalChanged = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      session.suspend();
      if (!document.hidden && scope.current.current()) void session.read().catch(() => undefined);
    };
    window.addEventListener('storage', journalChanged);
    return () => { document.removeEventListener('visibilitychange', changed); window.removeEventListener('storage', journalChanged); };
  }, [session]);
  useEffect(() => { session.clearPreparation(); }, [session, sourceEnabled, sourceRunId, sourceResultId]);
  if (!current() || document.hidden) return null;
  const complete = state.observation?.status === 'available' || state.observation?.status === 'failed';
  const writesAvailable = typeof navigator.locks?.request === 'function' && typeof globalThis.crypto?.randomUUID === 'function';
  const canPrepare = sourceEnabled && writesAvailable && !state.busy && !state.invalid && (!state.original || complete);
  return <section aria-label={t('解释与排版操作')} aria-busy={!!state.busy}>
    <p className={styles.help}>{t('重新解释或排版会调用模型，可能消耗额度。修改租赁条件请回原业务入口重新办理。')}</p>
    {!writesAvailable && <Alert type="warning" title={t('当前浏览器无法安全记录模型操作，请使用支持跨标签锁的浏览器。')} />}
    <div className={styles.toolbar}>
      <ActionButton variant="secondary" label={t('核对当前原结果')} pendingLabel={t('读取中…')} disabled={!canPrepare}
        onAction={() => session.prepare()} />
      {state.preparation?.kinds.map(kind => <ActionButton key={kind} variant="secondary" label={t(kindLabels[kind])}
        pendingLabel={t('模型处理中…')} disabled={!!state.busy || state.invalid || !sourceEnabled || !writesAvailable}
        onAction={() => session.execute(kind)} />)}
      {(state.original || state.invalid) && <ActionButton variant="secondary" label={t('核对本次模型操作')} pendingLabel={t('读取中…')}
        disabled={!!state.busy} onAction={() => session.read()} />}
      {state.error === 'result_unavailable' && state.observation?.status === 'available' && <ActionButton variant="secondary"
        label={t('重读这次原结果')} pendingLabel={t('读取中…')} disabled={!!state.busy} onAction={() => session.refreshResult()} />}
    </div>
    {statusLabel(state) && <p className={styles.help} role="status">{t(statusLabel(state))}</p>}
    {state.error && <Alert type="warning" title={t(errorLabels[state.error])} />}
  </section>;
}
