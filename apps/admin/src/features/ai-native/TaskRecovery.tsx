/** Trusted controls for the original recovery host. The parent injects the
 * authorized locator; opening, refreshing and storage events never execute.
 * No model/display message can confirm either operation. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { AiTaskRecoverySnapshot } from '@rental-os/shared';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { aiTaskRecoveryApi } from '@/api/aiTaskRecovery';
import { useAuthStore } from '@/features/auth/authStore';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';
import { TaskRecoverySession, taskRecoveryStorageKey, type TaskRecoveryLocator, type TaskRecoveryState } from './task-recovery-session';
import styles from './AiManagement.module.css';

// Consumer-specific copy uses the existing locale identity and common fallback.
const english: Record<string, string> = {
  '原任务恢复与接管': 'Original task recovery and takeover',
  '核对恢复目标': 'Review recovery target',
  '恢复原运行': 'Recover original run',
  '接管原运行': 'Take over original run',
  '核对原恢复操作': 'Read original recovery operation',
  '确认恢复这次原运行？服务端会重新核对权限和原结果，待核对操作不会重新执行。': 'Recover this original run? The server rechecks access and original results. Uncertain operations will not be replayed.',
  '确认接管这次原运行？已发生的操作保留，待核对结果不会重新执行。': 'Take over this original run? Existing effects are preserved. Uncertain operations will not be replayed.',
  '已返回原运行结果': 'Original run response received',
  '恢复沿用原任务及累计资源；已完成操作保留，待核对操作只读取原证据。': 'Recovery keeps the original task and cumulative resources. Completed effects remain; uncertain operations use original evidence.',
  '当前没有受权恢复来源，可继续使用原任务读取或人工业务流程。': 'No authorized recovery source is available. Use original task reads or the manual workflow.',
  '当前浏览器无法安全记录跨标签操作，恢复与接管暂不可提交。': 'This browser cannot safely record operations across tabs. Recovery and takeover cannot be submitted.',
  '当前恢复来源不可用，请重新核对原任务或使用人工流程。': 'The recovery source is unavailable. Review the original task or use the manual workflow.',
  '本次恢复结果待核对，已保留原运行定位；不会再次发送。': 'This recovery result is uncertain. The original run reference is retained and will not be resubmitted.',
  '原操作存储无法核对，保留原定位，只允许读取原操作。': 'Original operation storage cannot be verified. Keep the original reference and read that operation only.',
  '当前无权读取或恢复这份原任务，请核对权限。': 'You cannot currently read or recover this task. Check access.',
  '未取得可靠结果，请核对原操作或使用人工流程。': 'No reliable result was received. Check the original operation or use the manual workflow.',
  '本次没有启动运行，请核对原状态后再决定。': 'No run started. Review its original state before deciding.',
  '原运行已返回，业务结果仍以原收据为准。': 'The original run returned. Business results still require original receipts.',
  '原运行已完成，业务结果仍以原收据为准。': 'The original run completed. Business results still require original receipts.',
  '原运行部分完成，请逐步核对原结果。': 'The original run partly completed. Check its original step results.',
  '原运行已暂停，继续输入或确认请使用原入口。': 'The original run paused. Continue input or confirmation in its original workflow.',
  '原取消请求已记录，不表示业务已回滚。': 'The original cancellation request was recorded. It does not mean business effects were rolled back.',
  '原运行已取消，已发生的业务保留。': 'The original run was cancelled. Existing business effects remain.',
  '原运行失败，原结果和用量记录保留。': 'The original run failed. Its original results and usage records remain.',
  '原接管已记录；不表示远端已停止或业务已完成。': 'The original takeover was recorded. It does not prove remote work stopped or business completed.',
  '尚未观察到原接管收据，不能据此重新提交。': 'The original takeover receipt has not been observed. This does not permit resubmission.',
  '没有可提交的恢复动作；等待输入或审批仍走原入口。': 'No recovery action is available. Input and approval remain in their original workflows.',
  '已完成': 'Completed', '待核对': 'Needs reconciliation', '未执行': 'Not executed', '执行中': 'Running', '已失败': 'Failed', '已取消': 'Cancelled',
  '任务累计资源': 'Cumulative task resources', '累计资源尚未核实，不能按零计算。': 'Cumulative resources are unverified and cannot be treated as zero.',
  '已用': 'Consumed', '占用': 'Reserved', '上限': 'Limit', '步骤': 'Steps', '调用': 'Calls', '主动耗时': 'Active time', '输出字节': 'Output bytes',
};
const errors: Record<NonNullable<TaskRecoveryState['error']>, string> = {
  source_unavailable: '当前恢复来源不可用，请重新核对原任务或使用人工流程。',
  operation_unknown: '本次恢复结果待核对，已保留原运行定位；不会再次发送。',
  journal_unavailable: '原操作存储无法核对，保留原定位，只允许读取原操作。',
  access_denied: '当前无权读取或恢复这份原任务，请核对权限。',
};
const outcomes: Record<string, string> = {
  succeeded: '原运行已完成，业务结果仍以原收据为准。',
  partially_succeeded: '原运行部分完成，请逐步核对原结果。',
  paused: '原运行已暂停，继续输入或确认请使用原入口。',
  cancel_requested: '原取消请求已记录，不表示业务已回滚。',
  cancelled: '原运行已取消，已发生的业务保留。',
  failed: '原运行失败，原结果和用量记录保留。',
};
function stepStatus(step: AiTaskRecoverySnapshot['steps'][number]): string {
  if (step.status === 'unknown' || step.effect === 'possible') return '待核对';
  return ({ succeeded: '已完成', pending: '未执行', running: '执行中', failed: '已失败', cancelled: '已取消' } as const)[step.status];
}

export interface TaskRecoveryProps {
  identity: string;
  taskId: string;
  current(): boolean;
  /** Required source dependency. Absence remains explicitly unavailable. */
  locate?: TaskRecoveryLocator | null;
  onAccessDenied?(): void;
}
export function TaskRecovery({ identity, taskId, current, locate = aiTaskRecoveryApi.locate, onAccessDenied }: TaskRecoveryProps) {
  const locale = useAiManagementLocale(), t = (text: string) => locale.locale === 'en-US' && english[text] ? english[text] : locale.t(text);
  const auth = useAuthStore.getState();
  const storageKey = taskRecoveryStorageKey({ tenantId: auth.tenant?.tenantId ?? '', workspaceId: auth.currentWorkspaceId ?? '',
    userId: auth.user?.id ?? '', taskId });
  const scope = useRef({ identity, taskId, storageKey, current, locate, onAccessDenied });
  scope.current = { identity, taskId, storageKey, current, locate, onAccessDenied };
  const session = useMemo(() => new TaskRecoverySession({ taskId, locate, port: aiTaskRecoveryApi,
    current: () => scope.current.identity === identity && scope.current.taskId === taskId && scope.current.storageKey === storageKey
      && scope.current.locate === locate && !document.hidden && scope.current.current(),
    onAccessDenied: () => scope.current.onAccessDenied?.(),
    store: { read: () => window.localStorage.getItem(storageKey), write: value => window.localStorage.setItem(storageKey, value),
      exclusive: async work => {
        if (!navigator.locks) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
        return await navigator.locks.request(storageKey, async () => work());
      } },
  }), [identity, taskId, storageKey, locate]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) session.suspend(); };
    const changed = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) { session.suspend(); session.activate(); } };
    document.addEventListener('visibilitychange', hidden); window.addEventListener('storage', changed);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('storage', changed); };
  }, [session, storageKey]);
  useEffect(() => { if (!current()) session.suspend(); }, [session, current]);
  if (!current() || document.hidden) return null;
  const canWrite = typeof navigator.locks?.request === 'function';
  const canInspect = !!locate && !state.busy && !state.invalid && (!state.original || state.resolved);
  const ready = canInspect && canWrite;
  const observed = state.observation;
  return <section className={styles.section} aria-label={t('原任务恢复与接管')} aria-busy={!!state.busy}>
    <p className={styles.help}>{t('恢复沿用原任务及累计资源；已完成操作保留，待核对操作只读取原证据。')}</p>
    {!locate && <p className={styles.help}>{t('当前没有受权恢复来源，可继续使用原任务读取或人工业务流程。')}</p>}
    {!canWrite && <Alert type="warning" title={t('当前浏览器无法安全记录跨标签操作，恢复与接管暂不可提交。')} />}
    <div className={styles.toolbar}>
      <ActionButton variant="secondary" label={t('核对恢复目标')} pendingLabel={t('读取中…')} disabled={!canInspect} onAction={() => session.inspect()} />
      {state.review?.actions.includes('recover') && <ConfirmAction tone="neutral" label={t('恢复原运行')}
        prompt={t('确认恢复这次原运行？服务端会重新核对权限和原结果，待核对操作不会重新执行。')}
        doneLabel={t('已返回原运行结果')} disabled={!ready} onConfirm={() => session.execute('recover')} />}
      {state.review?.actions.includes('takeover') && <ConfirmAction tone="neutral" label={t('接管原运行')}
        prompt={t('确认接管这次原运行？已发生的操作保留，待核对结果不会重新执行。')}
        doneLabel={t('已返回原运行结果')} disabled={!ready} onConfirm={() => session.execute('takeover')} />}
      {state.original && <ActionButton variant="secondary" label={t('核对原恢复操作')} pendingLabel={t('核对中…')}
        disabled={!!state.busy} onAction={() => session.read()} />}
    </div>
    {state.review && state.review.actions.length === 0 && <p className={styles.help}>{t('没有可提交的恢复动作；等待输入或审批仍走原入口。')}</p>}
    {state.error && <Alert type="warning" title={t(errors[state.error])} />}
    {state.invalid && !state.error && <Alert type="warning" title={t(errors.journal_unavailable)} />}
    {state.outcome && state.resolved && <p className={styles.help} role="status" aria-live="polite">{t(state.outcome.kind === 'not_started'
      ? '本次没有启动运行，请核对原状态后再决定。' : outcomes[state.outcome.outcome.status] ?? '原运行已返回，业务结果仍以原收据为准。')}</p>}
    {state.takeoverReceipt && <p className={styles.help} role="status">{t(state.takeoverReceipt.status === 'observed'
      ? '原接管已记录；不表示远端已停止或业务已完成。' : '尚未观察到原接管收据，不能据此重新提交。')}</p>}
    {observed && <>
      <p className={styles.help}>{t('原运行')}: {safeDisplayText(observed.run.runId, 191)} · {t('任务修订')}: {observed.task.revision}</p>
      <ol className={styles.timeline} aria-label={t('步骤')}>
        {observed.steps.map(step => <li key={step.stepId}>
          <span>{safeDisplayText(step.toolCode, 191)}</span>
          <span>{safeDisplayText(step.actionId, 191)}</span>
          <span>{t(stepStatus(step))}</span>
        </li>)}
      </ol>
      <p className={styles.help}>{t('任务累计资源')}</p>
      {observed.resources ? <dl className={styles.facts}>
        {Object.entries(observed.resources.counters).map(([kind, counter]) => <div key={kind}>
          <dt>{t(({ steps: '步骤', calls: '调用', active_ms: '主动耗时', output_bytes: '输出字节' } as Record<string, string>)[kind])}{kind === 'active_ms' && ' (ms)'}</dt>
          <dd>{t('已用')}: {counter.consumed} · {t('占用')}: {counter.reserved} · {t('上限')}: {counter.limit}</dd>
        </div>)}
      </dl> : <p className={styles.help}>{t('累计资源尚未核实，不能按零计算。')}</p>}
    </>}
  </section>;
}
