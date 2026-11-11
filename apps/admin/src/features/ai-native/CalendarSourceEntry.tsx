/** The original calendar page records a bounded source Task, then opens the
 * existing linked R1/Core consumers. It never asks the user to supply a TaskId. */
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { aiTaskCalendarDraftEntryReference, aiTaskCalendarDraftPreparationReference, aiTaskCalendarDraftOperationResponse,
  type AiTaskCalendarDraftPreparationReference, type AiTaskCalendarDraftOperationResponse } from '@rental-os/shared';
import { ActionButton, Alert, Button, ConfirmAction, Select } from '@/components/ui';
import { aiTaskCalendarDraftApi } from '@/api/aiTaskCalendarDraft';
import { useAuthStore } from '@/features/auth/authStore';
import { currentSessionEpoch } from '@/app/queryClient';
import { calendarPreparationStorageKey, calendarPreparationStore, createTaskCalendarSourceEntrySession } from './task-calendar-draft-session';
import { CalendarDraftPreparation, useCalendarDraftLocale } from './CalendarDraftPreparation';
import { TaskCalendarDraft } from './TaskCalendarDraft';
import styles from './AiManagement.module.css';

export function CalendarSourceEntry({ date, identity, current, onAccessDenied, onComplete }: {
  date: string; identity: string; current(): boolean; onAccessDenied(): void; onComplete(): void;
}) {
  const { t } = useCalendarDraftLocale(), auth = useAuthStore(), [, changed] = useReducer(n => n + 1, 0), id = useId();
  const [opened, setOpened] = useState<{ binding: string; taskId: string }>(),
    [prepared, setPrepared] = useState<{ binding: string; taskId: string; reference: AiTaskCalendarDraftPreparationReference }>();
  // Revision changes invalidate presentation, never the original recovery key.
  const stableOwner = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, date]);
  const epoch = currentSessionEpoch(), binding = JSON.stringify([identity, stableOwner, auth.user, epoch]);
  const mounted = useRef(true);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const active = () => mounted.current && owner.current.binding === binding && epoch === currentSessionEpoch() && !document.hidden
    && auth.hasPermission('rental-os:calendar:edit') && owner.current.current();
  const session = useMemo(() => {
    let storage: Storage | undefined; try { if (typeof window !== 'undefined') storage = window.localStorage; } catch { /* Fail closed before dispatch. */ }
    return createTaskCalendarSourceEntrySession({ tenantId: auth.tenant?.tenantId ?? '', workspaceId: auth.currentWorkspaceId ?? '', current: active, changed,
      api: aiTaskCalendarDraftApi, store: calendarPreparationStore(`rental-os-calendar-entry:${stableOwner}`, value => aiTaskCalendarDraftEntryReference.parse(value), storage) });
  }, [binding]);
  useEffect(() => { mounted.current = true; session.activate(); const clear = () => { session.clear(); setOpened(undefined); setPrepared(undefined); };
    document.addEventListener('visibilitychange', clear); return () => { mounted.current = false; document.removeEventListener('visibilitychange', clear); session.dispose(); }; }, [session]);
  if (!active()) return null;
  const taskId = opened?.binding === binding ? opened.taskId : undefined, proposalTaskId = prepared?.binding === binding ? prepared.taskId : undefined;
  const view = session.view, task = view.result?.operation.state === 'original_request_recorded' ? view.result.operation.task : null;
  const action = (work: () => Promise<void>) => async () => { try { await work(); } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (active() && (status === 401 || status === 403)) onAccessDenied(); throw error;
  } };
  const complete = async (receipt: AiTaskCalendarDraftOperationResponse) => {
    const saved = aiTaskCalendarDraftOperationResponse.parse(receipt), pending = view.pending;
    if (!active() || !pending || !prepared || prepared.binding !== binding || !taskId
      || prepared.reference.taskId !== taskId || saved.taskId !== prepared.taskId || saved.reference.taskId !== prepared.taskId
      || saved.operation.state !== 'committed' || saved.operation.target.date !== date) throw Error('AI_RESULT_UNKNOWN');
    let storage: Storage | undefined; try { storage = window.localStorage; } catch { /* Preserve the original keys. */ }
    const originalPreparation = calendarPreparationStore(calendarPreparationStorageKey({ tenantId: auth.tenant?.tenantId,
      workspaceId: auth.currentWorkspaceId, actorId: auth.user?.id, taskId }), value => aiTaskCalendarDraftPreparationReference.parse(value), storage);
    const entry = calendarPreparationStore(`rental-os-calendar-entry:${stableOwner}`, value => aiTaskCalendarDraftEntryReference.parse(value), storage);
    // A confirmed Core result permits cleanup of this journey only. The
    // stores compare exact keys and preserve a newer request from another page.
    const entryCurrent = entry.read(), preparationCurrent = originalPreparation.read();
    if (entryCurrent && entryCurrent.operationKey !== pending.operationKey || preparationCurrent
      && (preparationCurrent.taskId !== prepared.reference.taskId || preparationCurrent.operationKey !== prepared.reference.operationKey))
      throw Error('AI_RESULT_UNKNOWN');
    originalPreparation.clearCompleted(prepared.reference);
    entry.clearCompleted(pending);
    if (active()) onComplete();
  };
  return <section className={styles.stack} aria-label={t('原日历草稿')}>
    <p className={styles.help}>{date} · {t('先记录原日历任务，再核对日期差异。')}</p>
    {view.invalid && <Alert type="warning" title={t('原操作定位不可读取，不能再次发起。')} />}
    {view.pending ? <ActionButton intent="review" label={t('核对原日历任务')} disabled={view.busy} onAction={action(() => session.operation())} />
      : <ActionButton intent="review" label={t('读取日历草稿')} disabled={view.busy || view.invalid}
        onAction={action(async () => { await session.read(date); if (session.view.source?.targets.length === 1) session.select(session.view.source.targets[0].id); })} />}
    {!view.pending && view.source && <>
      {view.source.targets.length ? <>
        <div className={styles.field}><label htmlFor={id}>{t('草稿版本')}</label><Select id={id} value={view.selected ?? undefined} disabled={view.busy || view.invalid}
          options={view.source.targets.map(row => ({ value: row.id, label: `${row.date} · v${row.version}` }))} onChange={value => session.select(value)} /></div>
        <ConfirmAction label={t('记录原日历任务')} prompt={t('先记录原日历任务，再核对日期差异。')} confirmLabel={t('记录原日历任务')}
          disabled={view.busy || view.invalid || !view.selected} onConfirm={action(() => session.create(crypto.randomUUID()))} />
      </> : <p>{t('当前没有包含该日期的已存草稿，请先在原日历流程准备草稿。')}</p>}
      {view.source.hasMore && <p className={styles.help}>{t('只显示最近20份草稿。')}</p>}
    </>}
    {task?.state === 'observed' && <>
      <Alert type="success" title={t('原日历任务已记录。')} />
      {!taskId && <Button onClick={() => { if (active()) setOpened({ binding, taskId: task.taskId }); }}>{t('继续准备日期差异')}</Button>}
    </>}
    {(task?.state === 'not_observed' || view.result?.operation.state === 'not_observed') && <Alert type="warning" title={t('日历任务尚未观察到，保留原定位继续核对。')} />}
    {view.pending && !view.result && <Alert type="warning" title={t('原任务结果待核对，请按原操作读取。')} />}
    {taskId && <CalendarDraftPreparation key={`${binding}:${taskId}`} taskId={taskId} identity={binding} date={date} current={active} onAccessDenied={onAccessDenied}
      onPrepared={(id, reference) => { if (active()) setPrepared({ binding, taskId: id, reference: structuredClone(reference) }); }} />}
    {proposalTaskId && <TaskCalendarDraft key={`${binding}:${proposalTaskId}`} taskId={proposalTaskId} identity={binding} current={active}
      onAccessDenied={onAccessDenied} allowPreparation={false} onCommitted={complete} />}
    {!!view.error && <Alert type="warning" title={t('当前日历操作不可用，请核对原结果或当前权限。')} />}
  </section>;
}
