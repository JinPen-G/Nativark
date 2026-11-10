/** Existing Task detail -> original calendar proposal -> reviewed Core draft.
 * Only the original save receipt reports completion; unknown is read only. */
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { AiTaskCalendarDraftReviewResponse } from '@rental-os/shared';
import { ActionButton, Alert, Checkbox, ConfirmAction, Input } from '@/components/ui';
import { aiTaskCalendarDraftApi } from '@/api/aiTaskCalendarDraft';
import { useAuthStore } from '@/features/auth/authStore';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAiManagementLocale } from './management-locale';
import { createTaskCalendarDraftSession, taskCalendarDraftStore } from './task-calendar-draft-session';
import { formatTimestamp } from './formatters';
import styles from './AiManagement.module.css';

function CalendarDifferences({ value }: { value: Pick<AiTaskCalendarDraftReviewResponse, 'before' | 'after'> }) {
  const { t } = useAiManagementLocale();
  const labels: Record<string, string> = { open: '营业', limited: '限定营业', closed: '不营业', self_service: '自助服务',
    week_rule: '每周模板', official_cn: '官方日历', tenant_override: '人工覆盖', workday: '工作日', weekend: '休息日',
    statutory_holiday: '法定节假日', makeup_workday: '调休工作日', tenant_special: '自定义日期' };
  const text = (value: string | number | boolean | undefined, field: string) => value === undefined ? t('未单独声明')
    : typeof value === 'boolean' ? t(value ? '是' : '否') : typeof value === 'string' ? (['businessStatus','source','dayType'].includes(field) ? t(labels[value] ?? value) : value) : String(value);
  const hours = (hourValue: typeof value.before.hours, kind: 'windows' | 'pickup' | 'return' | 'delivery') => hourValue?.[kind] === undefined
    ? t(kind === 'windows' ? '未单独声明' : '沿用营业时段') : hourValue[kind]!.length === 0 ? t('不提供') : hourValue[kind]!.map(row => `${row.start}–${row.end}`).join('、');
  return <dl className={styles.stack}>
    {([['name','日期名称'],['businessStatus','营业状态'],['closed','停止营业'],['source','来源'],['dayType','日期类型'],
      ['pricingMultiplier','原价格倍率'],['pricingOverrideRef','原特殊价格引用']] as const).map(([key,label]) => <div key={key}>
      <dt>{t(label)}</dt><dd>{text(value.before[key],key)} → {text(value.after[key],key)}</dd></div>)}
    {(['windows','pickup','return','delivery'] as const).map((kind,index) => <div key={kind}><dt>{t(['营业时段','领取时段','归还时段','配送时段'][index])}</dt>
      <dd>{hours(value.before.hours,kind)} → {hours(value.after.hours,kind)}</dd></div>)}
  </dl>;
}

export function TaskCalendarDraft({ taskId, identity, current, onAccessDenied }: {
  taskId: string; identity: string; current(): boolean; onAccessDenied(): void;
}) {
  const { t } = useAiManagementLocale(), auth = useAuthStore(), [, changed] = useReducer(n => n + 1, 0), reasonId = useId();
  const [reason, setReason] = useState(''), [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const stableOwner = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, taskId]);
  const epoch = currentSessionEpoch(), binding = JSON.stringify([identity, taskId, stableOwner, auth.user, epoch]);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const active = () => owner.current.binding === binding && epoch === currentSessionEpoch() && !document.hidden && owner.current.current();
  const session = useMemo(() => {
    let storage: Storage | undefined; try { if (typeof window !== 'undefined') storage = window.localStorage; } catch { /* Preserve-before-save refuses unavailable storage. */ }
    return createTaskCalendarDraftSession({ taskId, current: active, api: aiTaskCalendarDraftApi,
      store: taskCalendarDraftStore(`rental-os-calendar-draft:${stableOwner}`, storage), changed });
  }, [binding]);
  useEffect(() => { session.activate(); const clear = () => session.clear(); document.addEventListener('visibilitychange', clear);
    return () => { document.removeEventListener('visibilitychange', clear); session.dispose(); }; }, [session]);
  if (!active()) return null;
  const data = session.view, canManage = auth.hasPermission('rental-os:calendar:edit');
  const action = (work: () => Promise<void>) => async () => { try { await work(); } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (active() && (status === 401 || status === 403)) onAccessDenied(); throw error;
  } };
  const committed = data.operation?.operation.state === 'committed' ? data.operation.operation : null;
  return <section className={styles.stack} aria-label={t('日历业务草稿')}>
    <p className={styles.help}>{t('核对日期与差异后保存原日历草稿。发布需继续原日历流程。')}</p>
    {data.locatorInvalid && <Alert type="warning" title={t('原保存定位不可用，不能再次保存。')} description={t('可读取原提案及原业务收据；定位缺失不证明未保存。')} />}
    {data.pending && <Alert type="warning" title={t('原保存结果待核对。')} description={t('只读取原操作；未观察到结果也不代表未保存，不自动重试。')} />}
    {data.pending ? <ActionButton label={t('核对原保存结果')} disabled={!!data.busy} onAction={action(() => session.operation(data.pending!))} />
      : <ActionButton label={t('读取日历提案')} disabled={!!data.busy} onAction={action(() => session.list())} />}
    {!data.pending && data.loaded && data.items.length === 0 && <p>{t('本任务没有已保存的日历提案，请继续原开业提案流程。')}</p>}
    {!data.pending && data.items.length > 0 && <div className={styles.stack}>
      <div className={styles.field}><label htmlFor={reasonId}>{t('覆盖原因')}</label>
        <Input.TextArea id={reasonId} value={reason} maxLength={1000} disabled={!!data.busy} onChange={event => { setReason(event.target.value); session.clearReview(); }} /></div>
      {data.items.some(item => item.overrideRequired) && <Checkbox checked={overrideConfirmed} disabled={!!data.busy}
        onChange={event => { setOverrideConfirmed(event.target.checked); session.clearReview(); }}>{t('确认覆盖已有人工设置')}</Checkbox>}
      {data.items.map(item => <section className={styles.section} key={`${item.reference.runId}:${item.reference.stepId}`}>
        <h3>{item.target.date} · {t('原日历版本')} {item.target.version}</h3>
        <ActionButton label={t('核对日历草稿')} disabled={!canManage || !!data.busy || !reason.trim() || (item.overrideRequired && !overrideConfirmed)}
          onAction={action(() => session.review(item.reference, reason, item.overrideRequired && overrideConfirmed))} />
        <ActionButton label={t('核对原保存结果')} disabled={!!data.busy} onAction={action(() => session.operation(item.reference))} />
      </section>)}
    </div>}
    {!data.pending && data.review && <section className={styles.section}>
      <h3>{data.review.target.date} · {t('草稿版本')} {data.review.target.version}</h3>
      <CalendarDifferences value={data.review} />{data.review.overrideRequired && <p>{t('原覆盖原因')}：{data.review.existingOverrideReason ?? t('未记录')}</p>}<p>{t('覆盖原因')}：{data.review.overrideReason}</p>
      <ConfirmAction label={t('保存日历草稿')} prompt={t('确认保存本次复核的日历草稿？发布需继续原日历流程。')} confirmLabel={t('确认保存草稿')}
        disabled={!canManage || !data.saveEnabled || !!data.busy} onConfirm={action(() => session.save())} />
      {!data.saveEnabled && <p>{t('当前未开放新草稿保存，仍可核对原操作。')}</p>}
    </section>}
    {committed && <section className={styles.section}>
      <Alert type="success" title={t('原日历草稿已保存。')} description={t('这是保存时的原收据；发布需继续原日历流程。')} />
      <p>{committed.target.date} · {committed.target.version} · {formatTimestamp(committed.committedAt).value}</p>
      <CalendarDifferences value={committed} /><p>{t('覆盖原因')}：{committed.overrideReason}</p>
    </section>}
    {data.operation?.operation.state === 'not_observed' && <Alert type="warning" title={t('未观察到原操作。')} description={t('保留原定位并继续核对，不能据此重发保存。')} />}
    {!!data.error && <Alert type="warning" title={t(data.pending ? '保存未能确认，请核对原结果。' : '当前日历草稿不可核对，请重新读取提案或核对权限。')} />}
  </section>;
}
