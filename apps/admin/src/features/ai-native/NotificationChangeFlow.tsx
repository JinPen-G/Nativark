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
import { createNotificationChangeSession, notificationChangeStore, notificationOriginalLocator, sameNotificationOriginal } from './notification-change-session';
import { originalReconfirmationStore } from './original-reconfirmation-journal';
import { createOriginalReconfirmationSession } from './original-reconfirmation-session';
import { notificationReconfirmationPort } from './notification-reconfirmation';
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
  '已领取': 'Pickup completed', '已归还': 'Return completed', '领取提醒': 'Pickup reminder', '归还提醒': 'Return reminder',
  '重新确认通知修改': 'Reconfirm notification changes', '读取重新确认依据': 'Read reconfirmation records',
  '重新核对当前通知差异': 'Review current notification differences again', '旧提案版本': 'Previous proposal revision',
  '旧提案值': 'Previous proposed values', '新启用事件': 'New enabled events', '新通知渠道': 'New notification channels',
  '准备新的通知变更': 'Prepare a new notification change',
  '原审核须已终结且未提交。按当前差异保存新变更，随后另行启动和批准审核？':
    'The original review must have ended without submission. Save this new change, then start and approve a separate review?',
  '新的通知变更结果待核对。': 'The new notification change result needs checking.',
  '只读取旧请求关联的新变更；未观察到结果不能重发。': 'Read the new change linked to the previous request. An unobserved result does not permit resending.',
  '接续新的通知审核': 'Open the new notification review', '启动新的通知审核': 'Start the new notification review',
  '继续原通知审核': 'Continue the original notification review',
  '按同一原定位继续尚未开始的审核？原服务将再次核对未启动证据、权限和有效期。':
    'Continue the unstarted review at the same original reference? The original service rechecks unstarted evidence, permissions and expiry.',
  '按已保存的新变更创建和启动原审核任务？批准和提交仍由原审核入口处理。':
    'Create and start the original review task for this saved change? Approval and submission still use the original review workflow.',
  '重新确认记录不可用，已暂停新操作。': 'Reconfirmation records are unavailable. New actions are paused.',
  '重新确认失败，请核对原任务和当前差异。': 'Reconfirmation failed. Check the original task and current differences.',
  '关闭已完成的重新确认': 'Close completed reconfirmation',
  '核对差异后显示当前原设置，保存新变更不改变设置。': 'Review the differences to see current settings. Saving a new change does not update them.'
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
  const [reconfirmDraft, setReconfirmDraft] = useState<Notifications | null>(null), [reconfirmExpiry, setReconfirmExpiry] = useState<Dayjs | null>(null);
  const eventsId = useId(), channelsId = useId(), expiryId = useId(), reconfirmEventsId = useId(), reconfirmChannelsId = useId(), reconfirmExpiryId = useId();
  const tenantId = auth.tenant?.tenantId ?? '', workspaceId = auth.currentWorkspaceId ?? '', actorId = auth.user?.id ?? '';
  const scope = (value: ReturnType<typeof useAuthStore.getState>) => JSON.stringify([value.tenant?.tenantId, value.currentWorkspaceId,
    value.user?.id, value.user?.dataScope, value.user?.locationScope, value.user?.organizationId,
    value.user?.permissions && [...new Set(value.user.permissions)].sort(), value.user?.tenantMembership]);
  const epoch = currentSessionEpoch(), originalScope = scope(auth), binding = JSON.stringify([identity, tenantId, workspaceId, actorId, epoch, originalScope]);
  const mounted = useRef(true);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const active = () => mounted.current && owner.current.binding === binding && currentSessionEpoch() === epoch
    && scope(useAuthStore.getState()) === originalScope
    && !currentSessionSignal().aborted && typeof document !== 'undefined' && !document.hidden && owner.current.current();
  const controller = useMemo(() => {
    let storage: Storage | undefined; try { storage = localStorage; } catch { /* Writes remain unavailable without confirmed storage. */ }
    const scope = JSON.stringify([identity, tenantId, workspaceId, actorId]);
    const create = () => {
      const changed = () => refresh(value => value + 1);
      const reconfirmationStore = originalReconfirmationStore(`rental-os-notification-reconfirmation:${scope}`, notificationOriginalLocator, storage);
      const session = createNotificationChangeSession({ current: active, api: aiNotificationChangesApi,
        store: notificationChangeStore(`rental-os-notification-change:${scope}`, storage), changed, writesAllowed: () => {
          const journal = reconfirmationStore.read();
          return !reconfirmation.view.busy && !reconfirmation.view.damaged && (!journal || journal.phase === 'attached'
            && !!journal.replacement && !!session.view.original && sameNotificationOriginal(journal.replacement, session.view.original));
        } });
      const reconfirmation = createOriginalReconfirmationSession({ current: active, changed, same: sameNotificationOriginal,
        store: reconfirmationStore, port: notificationReconfirmationPort({ api: aiNotificationChangesApi, session }) });
      return { session, reconfirmation };
    };
    let group = create(), disposed = false;
    return { get session() { return group.session; }, get reconfirmation() { return group.reconfirmation; }, activate() {
      // StrictMode effect replay must replace the disposed request driver.
      // Reopening restores original IDs only; it never prepares or starts.
      if (disposed) { group = create(); disposed = false; }
    }, dispose() { group.reconfirmation.dispose(); group.session.dispose(); disposed = true; } };
  }, [binding]);
  useEffect(() => {
    mounted.current = true;
    controller.activate(); setDraft(null); setExpiry(null); setReconfirmDraft(null); setReconfirmExpiry(null);
    setOriginal({ changeKey: crypto.randomUUID(), creationKey: crypto.randomUUID() }); refresh(value => value + 1);
    const visibility = () => {
      if (document.hidden) { controller.dispose(); setDraft(null); setExpiry(null); setReconfirmDraft(null); setReconfirmExpiry(null); }
      else controller.activate();
      refresh(value => value + 1);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', visibility); controller.dispose(); };
  }, [controller]);
  const session = controller.session, reconfirmation = controller.reconfirmation, reconfirm = reconfirmation.view;
  const hostCurrent = () => active() && controller.session === session && controller.reconfirmation === reconfirmation;
  const view = session.view, busy = !!view.busy || !!reconfirm.busy, canManage = auth.hasPermission('rental-os:price:manage');
  const recoveryOriginal = view.original ?? reconfirm.journal?.replacement ?? reconfirm.journal?.original;
  const attached = reconfirm.journal?.phase === 'attached' && !!reconfirm.journal.replacement && !!view.original
    && sameNotificationOriginal(reconfirm.journal.replacement, view.original);
  const terminal = !!view.result && ['failed', 'cancelled'].includes(view.result.snapshot.task.status) && !view.result.operation;
  const writesBlocked = reconfirm.damaged || !!reconfirm.journal && !attached;
  const readReconfirmation = async (follow = false) => {
    if (follow) await reconfirmation.followReplacement();
    else await reconfirmation.read(reconfirm.journal ? undefined : view.original ?? undefined);
    if (!hostCurrent()) return;
    const current = reconfirmation.view;
    if (current.journal?.phase === 'read_original' && current.current && !current.prepared) {
      await session.read(current.journal.original);
      if (!hostCurrent()) return;
      const material = session.view.change;
      setReconfirmDraft(material ? { enabledEvents: [...material.diff['notifications.enabledEvents'].after],
        editableChannels: [...material.diff['notifications.editableChannels'].after] } : null);
    } else setReconfirmDraft(null);
    setReconfirmExpiry(null);
  };
  const action = (work: () => Promise<unknown>) => async () => {
    try { if (!hostCurrent()) throw Error('AI_SCOPE_CHANGED'); return await work(); } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (hostCurrent() && (status === 401 || status === 403)) onAccessDenied(); throw error;
    }
  };
  const eventName = (value: string) => t(notificationEventLabels[value] ?? value);
  const channelName = (value: string) => t(notificationChannelLabels[value] ?? value);
  const names = (values: readonly string[], label: (value: string) => string) => values.length ? values.map(label).join(', ') : t('没有启用事件');
  const events = [...new Set([...Object.keys(notificationEventLabels), ...(view.current?.notifications.enabledEvents ?? []),
    ...(reconfirmDraft?.enabledEvents ?? []), ...(reconfirm.review?.current.notifications.enabledEvents ?? [])])];
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
    {recoveryOriginal ? <ActionButton label={t('核对原通知请求')} disabled={busy} onAction={action(() => session.read(recoveryOriginal))} />
      : <ActionButton label={t('读取当前通知设置')} disabled={busy || view.locatorDamaged} onAction={action(async () => {
        const found = await session.load(); if (hostCurrent()) { setDraft(structuredClone(found.notifications)); setExpiry(null); }
      })} />}
    {view.current && draft && !view.original && !reconfirm.journal && !reconfirm.damaged && <div className={styles.section}>
      <p>{t('当前设置版本')} {view.current.settingsRevision}</p>
      <div className={styles.field}><label htmlFor={eventsId}>{t('启用事件')}</label>
        <Select id={eventsId} mode="multiple" value={draft.enabledEvents} disabled={busy || !canManage}
          options={events.map(value => ({ value, label: eventName(value) }))}
          onChange={value => { if (hostCurrent()) { session.clearReview(); setDraft(previous => previous && ({ ...previous, enabledEvents: value })); } }} /></div>
      <div className={styles.field}><label htmlFor={channelsId}>{t('通知渠道')}</label>
        <Select id={channelsId} mode="multiple" value={draft.editableChannels} disabled={busy || !canManage}
          options={Object.keys(notificationChannelLabels).map(value => ({ value, label: channelName(value) }))}
          onChange={value => { if (hostCurrent()) { session.clearReview(); setDraft(previous => previous && ({ ...previous, editableChannels: value })); } }} /></div>
      <div className={styles.field}><label htmlFor={expiryId}>{t('审核有效期')}</label>
        <DatePicker id={expiryId} showTime value={expiry} disabled={busy || !canManage} onChange={value => { if (hostCurrent()) { session.clearReview(); setExpiry(value); } }} /></div>
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
        disabled={busy || !canManage || writesBlocked} onConfirm={action(() => session.prepare(original))} />}
      {view.canContinue && <ConfirmAction label={t(view.pending?.stage === 'start' ? '继续原通知审核' : attached ? '启动新的通知审核' : '继续准备原审核任务')}
        prompt={t(view.pending?.stage === 'start' ? '按同一原定位继续尚未开始的审核？原服务将再次核对未启动证据、权限和有效期。'
          : attached ? '按已保存的新变更创建和启动原审核任务？批准和提交仍由原审核入口处理。'
          : '按已读取的原差异继续准备审核任务？不会重发结果未知的步骤。')}
        confirmLabel={t(view.pending?.stage === 'start' ? '继续原通知审核' : attached ? '启动新的通知审核' : '继续准备原审核任务')}
        disabled={busy || !canManage || writesBlocked} onConfirm={action(() => session.continuePreparation())} />}
    </section>}
    {(terminal || reconfirm.journal || reconfirm.damaged) && <section className={styles.section} aria-label={t('重新确认通知修改')}>
      {reconfirm.damaged && <Alert type="warning" title={t('重新确认记录不可用，已暂停新操作。')} />}
      {['prepare', 'handoff'].includes(reconfirm.journal?.phase ?? '') && <Alert type="warning" title={t('新的通知变更结果待核对。')}
        description={t('只读取旧请求关联的新变更；未观察到结果不能重发。')} />}
      <ActionButton label={t('读取重新确认依据')} disabled={busy || !reconfirm.journal && !view.original}
        onAction={action(() => readReconfirmation())} />
      {terminal && attached && <ActionButton label={t('重新核对当前通知差异')} disabled={busy || reconfirm.damaged}
        onAction={action(() => readReconfirmation(true))} />}
      {reconfirm.journal?.phase === 'read_original' && reconfirm.current && !reconfirm.damaged && reconfirmDraft && <>
        <p className={styles.help}>{t('核对差异后显示当前原设置，保存新变更不改变设置。')}</p>
        <div className={styles.field}><label htmlFor={reconfirmEventsId}>{t('新启用事件')}</label>
          <Select id={reconfirmEventsId} mode="multiple" value={reconfirmDraft.enabledEvents} disabled={busy || !canManage}
            options={events.map(value => ({ value, label: eventName(value) }))}
            onChange={value => { if (hostCurrent()) { reconfirmation.clearReview(); setReconfirmDraft(previous => previous && ({ ...previous, enabledEvents: value })); } }} /></div>
        <div className={styles.field}><label htmlFor={reconfirmChannelsId}>{t('新通知渠道')}</label>
          <Select id={reconfirmChannelsId} mode="multiple" value={reconfirmDraft.editableChannels} disabled={busy || !canManage}
            options={Object.keys(notificationChannelLabels).map(value => ({ value, label: channelName(value) }))}
            onChange={value => { if (hostCurrent()) { reconfirmation.clearReview(); setReconfirmDraft(previous => previous && ({ ...previous, editableChannels: value })); } }} /></div>
        <div className={styles.field}><label htmlFor={reconfirmExpiryId}>{t('审核有效期')}</label>
          <DatePicker id={reconfirmExpiryId} showTime value={reconfirmExpiry} disabled={busy || !canManage}
            onChange={value => { if (hostCurrent()) { reconfirmation.clearReview(); setReconfirmExpiry(value); } }} /></div>
        <ActionButton label={t('核对通知差异')} disabled={busy || !canManage || !reconfirmExpiry || !reconfirmDraft.editableChannels.length}
          onAction={action(() => reconfirmation.review({ notifications: reconfirmDraft, expiresAt: reconfirmExpiry!.toISOString() }))} />
      </>}
      {reconfirm.review && <>
        <dl className={styles.facts}>
          <div><dt>{t('旧提案版本')}</dt><dd>{reconfirm.review.previous.baseRevision}</dd></div>
          <div><dt>{t('旧提案值')}</dt><dd>{names(reconfirm.review.previous.diff['notifications.enabledEvents'].after, eventName)} · {names(reconfirm.review.previous.diff['notifications.editableChannels'].after, channelName)}</dd></div>
          <div><dt>{t('当前设置版本')}</dt><dd>{reconfirm.review.current.settingsRevision}</dd></div>
          <div><dt>{t('启用事件')} · {t('当前值')}</dt><dd>{names(reconfirm.review.fields[0].before.enabledEvents, eventName)}</dd></div>
          <div><dt>{t('启用事件')} · {t('新值')}</dt><dd>{names(reconfirm.review.fields[0].after.enabledEvents, eventName)}</dd></div>
          <div><dt>{t('通知渠道')} · {t('当前值')}</dt><dd>{names(reconfirm.review.fields[0].before.editableChannels, channelName)}</dd></div>
          <div><dt>{t('通知渠道')} · {t('新值')}</dt><dd>{names(reconfirm.review.fields[0].after.editableChannels, channelName)}</dd></div>
          <div><dt>{t('审核有效期')}</dt><dd>{formatTimestamp(reconfirm.review.expiresAt).value}</dd></div>
        </dl>
        <ConfirmAction label={t('准备新的通知变更')} confirmLabel={t('准备新的通知变更')}
          prompt={t('原审核须已终结且未提交。按当前差异保存新变更，随后另行启动和批准审核？')}
          disabled={busy || !canManage || reconfirm.damaged} onConfirm={action(() => reconfirmation.prepare())} />
      </>}
      {reconfirm.prepared && ['prepared', 'handoff', 'attached'].includes(reconfirm.journal?.phase ?? '') &&
        <ActionButton label={t('接续新的通知审核')} disabled={busy || reconfirm.damaged}
          onAction={action(() => reconfirmation.attach())} />}
      {!!reconfirm.error && <Alert type="warning" title={t('重新确认失败，请核对原任务和当前差异。')} />}
      {attached && view.result?.operation && <ActionButton label={t('关闭已完成的重新确认')} disabled={busy || reconfirm.damaged}
        onAction={action(async () => { await reconfirmation.finish(); if (hostCurrent()) { setReconfirmDraft(null); setReconfirmExpiry(null); } })} />}
    </section>}
    {view.original && !view.change && !busy && <p className={styles.help}>{t('未观察到原记录，不能据此重发请求。')}</p>}
    {waiting && <p>{t('原审核任务已准备，设置尚未更新。')}</p>}
    {view.result?.operation && <p>{t('通知设置已由原 Core 更新。')} {view.result.operation.resultRevision}</p>}
    {view.task && (waiting || terminal || view.result?.operation) && <ActionButton label={t('查看原审核任务')} disabled={busy}
      onAction={async () => { if (hostCurrent() && view.task) onTaskReady({ taskId: view.task.taskId, runId: view.task.runId }); }} />}
  </section>;
}
