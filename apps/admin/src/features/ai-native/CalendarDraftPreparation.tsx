/** Explicit date differences become a linked R1 proposal. Current identity,
 * visibility and session epoch revoke late responses; original operation keys
 * are persisted before dispatch and uncertain results are read only. */
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { aiTaskCalendarDraftPreparationReference, type AiTaskCalendarDraftPreparationReference, type AiTaskCalendarDraftReference } from '@rental-os/shared';
import { ActionButton, Alert, Button, ConfirmAction, Input, Select } from '@/components/ui';
import { aiTaskCalendarDraftApi } from '@/api/aiTaskCalendarDraft';
import { useAuthStore } from '@/features/auth/authStore';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAiManagementLocale } from './management-locale';
import { calendarPreparationStorageKey, calendarPreparationStore, createTaskCalendarDraftPreparationSession } from './task-calendar-draft-session';
import styles from './AiManagement.module.css';

const english: Record<string, string> = {
  '准备日历提案': 'Prepare calendar proposal', '读取日历草稿': 'Read calendar drafts',
  '先记录原日历任务，再核对日期差异。': 'Record the original calendar task, then review the date changes.',
  '记录原日历任务': 'Record original calendar task', '原日历任务已记录。': 'Original calendar task recorded.',
  '继续准备日期差异': 'Continue preparing date changes', '核对原日历任务': 'Check original calendar task',
  '当前没有包含该日期的已存草稿，请先在原日历流程准备草稿。': 'No saved draft contains this date. Prepare a draft in the calendar workflow first.',
  '只显示最近20份草稿。': 'Showing the latest 20 drafts.',
  '原任务结果待核对，请按原操作读取。': 'The original task result is uncertain. Read the original operation.',
  '原操作定位不可读取，不能再次发起。': 'The original operation reference cannot be read. A new attempt is unavailable.',
  '日历任务尚未观察到，保留原定位继续核对。': 'The calendar task has not been observed. Keep the original reference and check again.',
  '核对原日历提案': 'Check original calendar proposal', '日期名称': 'Date name', '营业状态': 'Business status',
  '草稿版本': 'Draft version', '日期': 'Date', '核对日期差异': 'Review date changes',
  '保存AI日历提案': 'Save AI calendar proposal',
  '确认按已核对的日期差异保存AI提案？原日历草稿另行复核和保存。': 'Save an AI proposal using the reviewed date changes? Review and save the calendar draft separately.',
  '确认保存提案': 'Save proposal', '日期与原值': 'Date and original values', '确认后的新值': 'Confirmed new values',
  '当前字段没有变化。': 'The fields are unchanged.',
  '新日历提案已保存。': 'New calendar proposal saved.',
  '核对并保存这份日历草稿': 'Review and save this calendar draft',
  '原提案结果待核对，请按原操作读取。': 'The original proposal result is uncertain. Read the original operation.',
  '关联请求已记录，提案尚未确认，请继续核对原结果。': 'The linked request is recorded. The proposal is unconfirmed; check the original result.',
  '未观察到原操作，请保留原定位继续核对。': 'The original operation has not been observed. Keep the original reference and check again.',
  '当前日历操作不可用，请核对原结果或当前权限。': 'The calendar operation is unavailable. Check its original result or your current permissions.',
  '本任务没有已保存的日历提案。': 'This task has no saved calendar proposal.',
  '原日历草稿': 'Original calendar draft', '正常营业': 'Open', '限时营业': 'Limited hours',
  '停止营业': 'Closed', '自助营业': 'Self-service',
  '完成本次修改': 'Finish this change',
  '原草稿保存因版本冲突未提交。': 'The original draft save was rejected because its version changed.',
  '请读取当前字段，核对新差异并准备新的 AI 提案。': 'Read the current fields, review new changes and prepare a new AI proposal.',
  '读取当前字段并重新准备': 'Read current fields and prepare again',
  '原拒绝记录': 'Original rejection receipt',
};
export function useCalendarDraftLocale() {
  const locale = useAiManagementLocale();
  const t = useCallback((text: string) => locale.locale === 'en-US' && english[text] ? english[text] : locale.t(text), [locale.locale, locale.t]);
  return { ...locale, t };
}

export function CalendarDraftPreparation({ taskId, identity, current, onAccessDenied, date: originalDate, onPrepared, rejected }: {
  taskId: string; identity: string; current(): boolean; onAccessDenied(): void; date?: string;
  rejected?: AiTaskCalendarDraftReference;
  onPrepared(taskId: string, reference: AiTaskCalendarDraftPreparationReference): void;
}) {
  const { t } = useCalendarDraftLocale(), auth = useAuthStore(), [, changed] = useReducer(n => n + 1, 0), fieldId = useId();
  const [date, setDate] = useState(originalDate ?? '');
  const stableOwner = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, taskId]);
  const epoch = currentSessionEpoch(), binding = JSON.stringify([identity, stableOwner, auth.user, epoch, originalDate, rejected]);
  const mounted = useRef(true);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const active = () => mounted.current && owner.current.binding === binding && epoch === currentSessionEpoch() && !document.hidden
    && auth.hasPermission('rental-os:calendar:edit') && owner.current.current();
  const session = useMemo(() => {
    let storage: Storage | undefined; try { if (typeof window !== 'undefined') storage = window.localStorage; } catch { /* Fail closed before dispatch. */ }
    return createTaskCalendarDraftPreparationSession({ taskId, tenantId: auth.tenant?.tenantId ?? '', workspaceId: auth.currentWorkspaceId ?? '',
      current: active, changed, api: aiTaskCalendarDraftApi,
      store: calendarPreparationStore(calendarPreparationStorageKey({ tenantId: auth.tenant?.tenantId,
        workspaceId: auth.currentWorkspaceId, actorId: auth.user?.id, taskId }), value => aiTaskCalendarDraftPreparationReference.parse(value), storage), rejected });
  }, [binding]);
  useEffect(() => { mounted.current = true; session.activate(); const clear = () => session.clear(); document.addEventListener('visibilitychange', clear);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', clear); session.dispose(); }; }, [session]);
  if (!active()) return null;
  const view = session.view, busy = !!view.busy;
  const action = (work: () => Promise<void>) => async () => { try { await work(); } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (active() && (status === 401 || status === 403)) onAccessDenied(); throw error;
  } };
  const labels = { open: t('正常营业'), limited: t('限时营业'), closed: t('停止营业'), self_service: t('自助营业') };
  const operation = view.operation?.operation;
  return <section className={styles.stack} aria-label={t('准备日历提案')}>
    {view.invalid && <Alert type="warning" title={t('原操作定位不可读取，不能再次发起。')} />}
    {rejected && view.pending && operation?.state === 'ai_proposal_saved' && operation.proposal.reference.taskId === rejected.taskId
      && operation.proposal.reference.runId === rejected.runId && operation.proposal.reference.stepId === rejected.stepId
      && <ActionButton intent="review" label={t('读取当前字段并重新准备')} disabled={busy || view.invalid || !date}
      onAction={action(async () => { await session.read(date); if (session.view.preparation?.targets.length === 1) session.select(session.view.preparation.targets[0].id); })} />}
    {view.pending ? <>
      {operation?.state !== 'ai_proposal_saved' && <Alert type="warning" title={t('原提案结果待核对，请按原操作读取。')} />}
      <ActionButton intent="review" label={t('核对原日历提案')} disabled={busy} onAction={action(() => session.operation())} />
    </> : <>
      {!originalDate && <div className={styles.field}><label htmlFor={`${fieldId}-date`}>{t('日期')}</label>
        <Input id={`${fieldId}-date`} type="date" value={date} disabled={busy || view.invalid}
          onChange={event => { session.clear(); setDate(event.target.value); }} /></div>}
      <ActionButton intent="review" label={t(rejected ? '读取当前字段并重新准备' : '读取日历草稿')} disabled={busy || view.invalid || !date}
        onAction={action(async () => { await session.read(date); if (session.view.preparation?.targets.length === 1) session.select(session.view.preparation.targets[0].id); })} />
    </>}
    {!view.pending && view.preparation && <>
      {view.preparation.targets.length === 0 ? <p>{t('当前没有包含该日期的已存草稿，请先在原日历流程准备草稿。')}</p> : <>
        <div className={styles.field}><label htmlFor={`${fieldId}-version`}>{t('草稿版本')}</label>
          <Select id={`${fieldId}-version`} value={view.targetId ?? undefined} disabled={busy || view.invalid}
            options={view.preparation.targets.map(row => ({ value: row.id, label: `${row.date} · v${row.version}` }))} onChange={id => session.select(id)} /></div>
        {view.values && <div className={styles.formGrid}>
          <div className={styles.field}><label htmlFor={`${fieldId}-name`}>{t('日期名称')}</label>
            <Input id={`${fieldId}-name`} value={view.values.name} maxLength={120} disabled={busy || view.invalid} onChange={event => session.edit('name', event.target.value)} /></div>
          {view.values.businessStatus !== undefined && <div className={styles.field}><label htmlFor={`${fieldId}-status`}>{t('营业状态')}</label>
            <Select id={`${fieldId}-status`} value={view.values.businessStatus} disabled={busy || view.invalid}
              options={Object.entries(labels).map(([value, label]) => ({ value, label }))} onChange={value => session.edit('businessStatus', value)} /></div>}
        </div>}
        <ActionButton intent="review" label={t('核对日期差异')} disabled={busy || view.invalid || !view.values?.name.trim()} onAction={action(() => session.preview())} />
      </>}
      {view.preparation.hasMore && <p className={styles.help}>{t('只显示最近20份草稿。')}</p>}
    </>}
    {!view.pending && view.preview && <section className={styles.section}>
      <h3>{view.preview.target.date} · v{view.preview.target.version}</h3>
      <dl className={styles.stack}>{view.preview.changes.map(change => <div key={change.field}><dt>{t(change.field === 'name' ? '日期名称' : '营业状态')}</dt>
        <dd>{change.field === 'businessStatus' ? labels[change.before] : change.before} → {change.field === 'businessStatus' ? labels[change.after] : change.after}</dd></div>)}</dl>
      {view.preview.status === 'no_change' ? <p>{t('当前字段没有变化。')}</p> : <ConfirmAction label={t('保存AI日历提案')}
        prompt={t('确认按已核对的日期差异保存AI提案？原日历草稿另行复核和保存。')} confirmLabel={t('确认保存提案')}
        disabled={busy || view.invalid} onConfirm={action(() => session.prepare(crypto.randomUUID()))} />}
    </section>}
    {operation?.state === 'ai_proposal_saved' && <>
      <Alert type="success" title={t('新日历提案已保存。')} />
      <Button onClick={() => { if (active() && view.operation) onPrepared(operation.task.taskId, view.operation.reference); }}>{t('核对并保存这份日历草稿')}</Button>
    </>}
    {operation?.state === 'linked_request_recorded' && <Alert type="warning" title={t('关联请求已记录，提案尚未确认，请继续核对原结果。')} />}
    {operation?.state === 'not_observed' && <Alert type="warning" title={t('未观察到原操作，请保留原定位继续核对。')} />}
    {!!view.error && <Alert type="warning" title={t('当前日历操作不可用，请核对原结果或当前权限。')} />}
  </section>;
}
