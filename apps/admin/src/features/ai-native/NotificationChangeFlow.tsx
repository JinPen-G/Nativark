/** Notification differences and explicit original-task preparation only.
 * Approval/continuation stay in the existing TaskHumanApproval consumer;
 * this component neither commits settings nor publishes configuration. */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Dayjs } from 'dayjs';
import type { AiApprovedSettingsChangePrepareDraft } from '@rental-os/shared';
import { useAuthStore } from '@/features/auth/authStore';
import { ActionButton, Alert, ConfirmAction, DatePicker, Select } from '@/components/ui';
import { aiNotificationChangesApi } from '@/api/aiNotificationChanges';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { notificationChannelLabels, notificationEventLabels } from '@/features/settings/governance/ruleOptionLabels';
import { createNotificationChangeSession, notificationChangeStore } from './notification-change-session';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import styles from './AiManagement.module.css';

const english: Record<string, string> = {
  '通知设置审核': 'Notification settings review',
  '读取当前通知设置': 'Read current notification settings',
  '来源为原通知设置；仅影响当前经营空间。': 'From the original notification settings; affects only the current workspace.',
  '当前设置版本': 'Current settings revision',
  '启用事件': 'Enabled events', '通知渠道': 'Notification channels', '审核有效期': 'Review expiry',
  '核对通知差异': 'Review notification differences', '准备审核任务': 'Prepare review task',
  '按所示差异准备原审核任务？设置在批准提交后才更新。': 'Prepare the original review task with these differences? Settings change only after approval and submission.',
  '原审核任务已准备，设置尚未更新。': 'The original review task is ready. Settings have not changed.',
  '查看原审核任务': 'Open original review task', '核对原通知请求': 'Check original notification request',
  '原请求结果待核对。': 'The original request result needs checking.',
  '保留原定位，核对原收据后再继续。': 'Keep the original reference and check its receipt before continuing.',
  '继续准备原审核任务': 'Continue preparing original review task',
  '按已读取的原差异继续准备审核任务？不会重发结果未知的步骤。': 'Continue preparing the review task using the original differences? Steps with unknown results will not be resent.',
  '原定位无法读取，已阻止新通知请求。': 'The original reference cannot be read. New notification requests are blocked.',
  '未观察到原记录，不能据此重发请求。': 'The original record is unobserved. This does not permit resending.',
  '通知设置已由原 Core 更新。': 'Notification settings were updated by the original Core.',
  '当前值': 'Current value', '新值': 'New value', '没有启用事件': 'No events enabled',
  '读取或准备失败，请核对当前权限和原请求。': 'Reading or preparation failed. Check current permissions and the original request.',
  '通知设置已变化，请重新核对差异并确认。': 'Notification settings have changed. Review the differences again before confirming.',
  '短信': 'SMS', '应用推送': 'App push', '微信': 'WeChat', '邮件': 'Email',
  '会员注册': 'Member registration', '订单创建': 'Order creation', '订单确认': 'Order confirmation',
  '订单取消': 'Order cancellation', '超时未取': 'Overdue pickup', '爽约': 'No-show', '订单逾期': 'Overdue order',
  '已领取': 'Pickup completed', '已归还': 'Return completed', '领取提醒': 'Pickup reminder', '归还提醒': 'Return reminder'
};
type Notifications = AiApprovedSettingsChangePrepareDraft['notifications'];

export function NotificationChangeFlow({ identity, current, onTaskReady, onAccessDenied }: {
  identity: string; current(): boolean; onTaskReady(task: { taskId: string; runId: string }): void; onAccessDenied(): void;
}) {
  const auth = useAuthStore(), locale = useAiManagementLocale();
  const t = (text: string) => locale.locale === 'en-US' && english[text] ? english[text] : locale.t(text);
  const [, refresh] = useState(0);
  const [draft, setDraft] = useState<Notifications | null>(null), [expiry, setExpiry] = useState<Dayjs | null>(null);
  const [original, setOriginal] = useState(() => ({ changeKey: crypto.randomUUID(), creationKey: crypto.randomUUID() }));
  const eventsId = useId(), channelsId = useId(), expiryId = useId();
  const tenantId = auth.tenant?.tenantId ?? '', workspaceId = auth.currentWorkspaceId ?? '', actorId = auth.user?.id ?? '';
  const epoch = currentSessionEpoch(), binding = JSON.stringify([identity, tenantId, workspaceId, actorId, epoch]);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const active = () => owner.current.binding === binding && currentSessionEpoch() === epoch
    && !currentSessionSignal().aborted && typeof document !== 'undefined' && !document.hidden && owner.current.current();
  const controller = useMemo(() => {
    let storage: Storage | undefined; try { storage = localStorage; } catch { /* Writes remain unavailable without confirmed storage. */ }
    const scope = JSON.stringify([identity, tenantId, workspaceId, actorId]);
    const create = () => createNotificationChangeSession({ current: active, api: aiNotificationChangesApi,
      store: notificationChangeStore(`rental-os-notification-change:${scope}`, storage), changed: () => refresh(value => value + 1) });
    let session = create(), disposed = false;
    return { get session() { return session; }, activate() {
      // StrictMode effect replay must replace the disposed request driver.
      // Reopening restores original IDs only; it never prepares or starts.
      if (disposed) { session = create(); disposed = false; }
    }, dispose() { session.dispose(); disposed = true; } };
  }, [binding]);
  useEffect(() => {
    controller.activate(); setDraft(null); setExpiry(null);
    setOriginal({ changeKey: crypto.randomUUID(), creationKey: crypto.randomUUID() }); refresh(value => value + 1);
    const visibility = () => {
      if (document.hidden) { controller.dispose(); setDraft(null); setExpiry(null); }
      else controller.activate();
      refresh(value => value + 1);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); controller.dispose(); };
  }, [controller]);
  const session = controller.session;
  const view = session.view, busy = !!view.busy, canManage = auth.hasPermission('rental-os:price:manage');
  const action = (work: () => Promise<unknown>) => async () => {
    try { return await work(); } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 401 || status === 403) onAccessDenied(); throw error;
    }
  };
  const eventName = (value: string) => t(notificationEventLabels[value] ?? value);
  const channelName = (value: string) => t(notificationChannelLabels[value] ?? value);
  const names = (values: readonly string[], label: (value: string) => string) => values.length ? values.map(label).join(', ') : t('没有启用事件');
  const events = [...new Set([...Object.keys(notificationEventLabels), ...(view.current?.notifications.enabledEvents ?? [])])];
  const difference = view.change?.diff ?? (view.review ? {
    'notifications.enabledEvents': { before: view.review.before.notifications.enabledEvents, after: view.review.after.enabledEvents },
    'notifications.editableChannels': { before: view.review.before.notifications.editableChannels, after: view.review.after.editableChannels }
  } : null);
  const waiting = view.confirmation?.state === 'waiting_confirmation';
  const failure = view.error as { message?: string; response?: { data?: { code?: string } } } | null;
  const conflict = failure?.message === 'AI_REVISION_CONFLICT' || failure?.response?.data?.code === 'AI_REVISION_CONFLICT';
  if (!active()) return null;
  return <section className={styles.stack} aria-label={t('通知设置审核')}>
    <p className={styles.help}>{t('来源为原通知设置；仅影响当前经营空间。')}</p>
    {view.locatorDamaged && <Alert type="warning" title={t('原定位无法读取，已阻止新通知请求。')} />}
    {view.pending && <Alert type="warning" title={t('原请求结果待核对。')} description={t('保留原定位，核对原收据后再继续。')} />}
    {!!view.error && <Alert type={conflict ? 'warning' : 'error'} title={t(conflict && !view.original
      ? '通知设置已变化，请重新核对差异并确认。' : '读取或准备失败，请核对当前权限和原请求。')} />}
    {view.original ? <ActionButton label={t('核对原通知请求')} disabled={busy || view.locatorDamaged} onAction={action(() => session.read())} />
      : <ActionButton label={t('读取当前通知设置')} disabled={busy || view.locatorDamaged} onAction={action(async () => {
        const found = await session.load(); if (active()) { setDraft(structuredClone(found.notifications)); setExpiry(null); }
      })} />}
    {view.current && draft && !view.original && <div className={styles.section}>
      <p>{t('当前设置版本')} {view.current.settingsRevision}</p>
      <div className={styles.field}><label htmlFor={eventsId}>{t('启用事件')}</label>
        <Select id={eventsId} mode="multiple" value={draft.enabledEvents} disabled={busy || !canManage}
          options={events.map(value => ({ value, label: eventName(value) }))}
          onChange={value => { session.clearReview(); setDraft(previous => previous && ({ ...previous, enabledEvents: value })); }} /></div>
      <div className={styles.field}><label htmlFor={channelsId}>{t('通知渠道')}</label>
        <Select id={channelsId} mode="multiple" value={draft.editableChannels} disabled={busy || !canManage}
          options={Object.keys(notificationChannelLabels).map(value => ({ value, label: channelName(value) }))}
          onChange={value => { session.clearReview(); setDraft(previous => previous && ({ ...previous, editableChannels: value })); }} /></div>
      <div className={styles.field}><label htmlFor={expiryId}>{t('审核有效期')}</label>
        <DatePicker id={expiryId} showTime value={expiry} disabled={busy || !canManage} onChange={value => { session.clearReview(); setExpiry(value); }} /></div>
      <ActionButton label={t('核对通知差异')} disabled={busy || !canManage || !expiry || draft.editableChannels.length === 0}
        onAction={action(async () => { session.inspect(draft, expiry!.toISOString()); })} />
    </div>}
    {difference && <section className={styles.section}>
      <dl className={styles.facts}>
        <div><dt>{t('启用事件')} · {t('当前值')}</dt><dd>{names(difference['notifications.enabledEvents'].before, eventName)}</dd></div>
        <div><dt>{t('启用事件')} · {t('新值')}</dt><dd>{names(difference['notifications.enabledEvents'].after, eventName)}</dd></div>
        <div><dt>{t('通知渠道')} · {t('当前值')}</dt><dd>{names(difference['notifications.editableChannels'].before, channelName)}</dd></div>
        <div><dt>{t('通知渠道')} · {t('新值')}</dt><dd>{names(difference['notifications.editableChannels'].after, channelName)}</dd></div>
        <div><dt>{t('审核有效期')}</dt><dd>{formatTimestamp(view.change?.expiresAt ?? view.review?.expiresAt).value}</dd></div>
      </dl>
      {!view.original && view.review && <ConfirmAction label={t('准备审核任务')}
        prompt={t('按所示差异准备原审核任务？设置在批准提交后才更新。')} confirmLabel={t('准备审核任务')}
        disabled={busy || !canManage} onConfirm={action(() => session.prepare(original))} />}
      {view.canContinue && <ConfirmAction label={t('继续准备原审核任务')}
        prompt={t('按已读取的原差异继续准备审核任务？不会重发结果未知的步骤。')} confirmLabel={t('继续准备原审核任务')}
        disabled={busy || !canManage} onConfirm={action(() => session.continuePreparation())} />}
    </section>}
    {view.original && !view.change && !busy && <p className={styles.help}>{t('未观察到原记录，不能据此重发请求。')}</p>}
    {waiting && <p>{t('原审核任务已准备，设置尚未更新。')}</p>}
    {view.result?.operation && <p>{t('通知设置已由原 Core 更新。')} {view.result.operation.resultRevision}</p>}
    {view.task && (waiting || view.result?.operation) && <ActionButton label={t('查看原审核任务')} disabled={busy}
      onAction={async () => { if (active() && view.task) onTaskReady({ taskId: view.task.taskId, runId: view.task.runId }); }} />}
  </section>;
}
