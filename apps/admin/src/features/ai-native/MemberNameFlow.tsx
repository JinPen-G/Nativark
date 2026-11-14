/** Original member-name consumer. An optional master ID selects a fresh server
 * candidate query; it is never approval or access evidence. Effect replay and
 * context changes discard local facts while retaining uncertain operation IDs. */
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { aiMemberNameLocator } from '@rental-os/shared';
import { ActionButton, Alert, ConfirmAction, Input, Select } from '@/components/ui';
import { aiMemberNameApi } from '@/api/aiMemberName';
import { useAuthStore } from '@/features/auth/authStore';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { createMemberNameSession, memberNameStore, sameMemberNameLocator } from './member-name-session';
import { originalReconfirmationStore } from './original-reconfirmation-journal';
import { createOriginalReconfirmationSession } from './original-reconfirmation-session';
import { memberNameReconfirmationPort } from './member-name-reconfirmation';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import styles from './AiManagement.module.css';

const scope = (auth: ReturnType<typeof useAuthStore.getState>) => JSON.stringify([
  auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, auth.user?.isSaasAdmin, auth.user?.isPlatformAdmin,
  auth.user?.organizationId, auth.user?.dataScope, auth.user?.locationScope,
  auth.user?.permissions && [...new Set(auth.user.permissions)].sort(), auth.user?.tenantMembership
]);
const reconfirmationEnglish: Record<string, string> = {
  '重新确认姓名修改': 'Reconfirm the name change', '读取重新确认依据': 'Read reconfirmation records',
  '重新核对当前姓名差异': 'Review current name differences again', '旧提案姓名': 'Previous proposed name',
  '准备新的姓名变更': 'Prepare a new name change',
  '原审核须已终结且未提交。按当前差异保存新变更，随后另行启动和确认审核？':
    'The original review must have ended without submission. Save this new change, then start and confirm a separate review?',
  '新姓名变更已保存，尚未启动新审核。': 'The new name change is saved. Its new review has not started.',
  '接续新的姓名审核': 'Open the new name review', '启动新的姓名审核': 'Start the new name review',
  '继续原姓名审核': 'Continue the original name review',
  '按同一原定位继续启动尚未开始的审核？仍需原服务核对准入，姓名不会在此步提交。':
    'Continue starting the unstarted review at the same original reference? The original service still checks admission; this step does not submit the name change.',
  '为已保存的新变更启动原审核任务？姓名仍须另行确认提交。':
    'Start the original review task for this saved change? Submitting the name change still requires separate confirmation.',
  '新的姓名变更结果待核对。': 'The new name change result needs checking.',
  '只读取旧请求关联的新变更；未观察到结果不能重发。': 'Read the new change linked to the previous request. An unobserved result does not permit resending.',
  '重新确认记录不可用，已暂停新操作。': 'Reconfirmation records are unavailable. New actions are paused.',
  '重新确认失败，请核对原任务和当前差异。': 'Reconfirmation failed. Check the original task and current differences.',
  '关闭已完成的重新确认': 'Close completed reconfirmation'
};
export function MemberNameFlow({ identity, customerId, current, onAccessDenied }: {
  identity: string; customerId?: string; current(): boolean; onAccessDenied(): void;
}) {
  const locale = useAiManagementLocale(), auth = useAuthStore(), [, changed] = useReducer(n => n + 1, 0);
  const t = (text: string) => locale.locale === 'en-US' && reconfirmationEnglish[text] ? reconfirmationEnglish[text] : locale.t(text);
  const searchId = useId(), nameId = useId(), memberId = useId(), reconfirmNameId = useId();
  const [search, setSearch] = useState(''), [selected, setSelected] = useState<string | undefined>(), [name, setName] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [reconfirmName, setReconfirmName] = useState('');
  const epoch = currentSessionEpoch(), originalScope = scope(auth), binding = JSON.stringify([identity, customerId, originalScope, epoch]);
  const mounted = useRef(true);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const active = () => mounted.current && owner.current.binding === binding && epoch === currentSessionEpoch()
    && originalScope === scope(useAuthStore.getState()) && typeof document !== 'undefined'
    && !document.hidden && !currentSessionSignal().aborted && owner.current.current();
  const storageKey = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id]);
  const controller = useMemo(() => {
    let storage: Storage | undefined; try { storage = typeof window === 'undefined' ? undefined : window.localStorage; } catch { /* preserve-before-dispatch refuses writes */ }
    const create = () => {
      const reconfirmationStore = originalReconfirmationStore(`rental-os-member-name-reconfirmation:${storageKey}`, aiMemberNameLocator, storage);
      const session = createMemberNameSession({ tenantId: auth.tenant?.tenantId ?? '', current: active, api: aiMemberNameApi,
        store: memberNameStore(`rental-os-member-name:${storageKey}`, storage), changed, writesAllowed: () => {
          const journal = reconfirmationStore.read();
          if (customerId && session.view.locator && session.view.locator.customerId !== customerId) return false;
          return !reconfirmation.view.busy && !reconfirmation.view.damaged && (!journal || journal.phase === 'attached'
            && !!journal.replacement && !!session.view.locator && sameMemberNameLocator(journal.replacement, session.view.locator));
        } });
      const reconfirmation = createOriginalReconfirmationSession({ current: active, changed, same: (left, right) => sameMemberNameLocator(left, right),
        store: reconfirmationStore, port: memberNameReconfirmationPort({ tenantId: auth.tenant?.tenantId ?? '', api: aiMemberNameApi, session }) });
      return { session, reconfirmation };
    };
    let group = create(), disposed = false;
    return { get session() { return group.session; }, get reconfirmation() { return group.reconfirmation; }, activate() {
      // StrictMode replays effects on the same mounted component. A disposed
      // driver cannot be reused; its successor only restores the original IDs.
      if (disposed) { group = create(); disposed = false; }
    }, dispose() { group.reconfirmation.dispose(); group.session.dispose(); disposed = true; } };
  }, [binding]);
  useEffect(() => {
    mounted.current = true;
    controller.activate(); setSearch(''); setSelected(undefined); setName(''); setReconfirmName(''); setRequestKey(crypto.randomUUID()); changed();
    const visibility = () => {
      if (document.hidden) { controller.dispose(); setSearch(''); setSelected(undefined); setName(''); setReconfirmName(''); }
      else controller.activate();
      changed();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', visibility); controller.dispose(); };
  }, [controller]);
  const session = controller.session, view = session.view, reconfirmation = controller.reconfirmation, reconfirm = reconfirmation.view;
  const hostCurrent = () => active() && controller.session === session && controller.reconfirmation === reconfirmation;
  const busy = !!view.busy || !!reconfirm.busy;
  // A preserved request can belong to another member in this actor's journal.
  // It remains readable, but cannot present or approve that person's facts here.
  const frame = customerId === undefined || !view.frame || ((!view.frame.locator || view.frame.locator.customerId === customerId)
    && view.frame.candidates.every(row => row.customerId === customerId)) ? view.frame : null;
  const canWrite = auth.hasPermission('rental-os:member:manage');
  const recoveryLocator = view.locator ?? reconfirm.journal?.replacement ?? reconfirm.journal?.original;
  const reconfirmVisible = customerId === undefined || !reconfirm.journal || reconfirm.journal.original.customerId === customerId;
  const reconfirmReview = reconfirmVisible ? reconfirm.review?.reconfirmation?.review : null;
  const terminal = !!frame?.task && ['failed', 'cancelled'].includes(frame.task.status ?? '') && !frame.operation;
  const attached = reconfirm.journal?.phase === 'attached' && !!reconfirm.journal.replacement
    && !!view.locator && sameMemberNameLocator(reconfirm.journal.replacement, view.locator);
  const action = (work: () => Promise<unknown>) => async () => { try {
    if (!hostCurrent()) throw Error('AI_SCOPE_CHANGED');
    return await work();
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (hostCurrent() && (status === 401 || status === 403)) onAccessDenied(); throw error;
  } };
  const reset = () => { session.resetDraft(); setSelected(undefined); setName(''); setRequestKey(crypto.randomUUID()); };
  const discover = () => session.discover(customerId === undefined ? { limit: 20, name: search.trim() } : { limit: 1, customerId });
  const selectedCustomerId = customerId === undefined ? selected
    : frame?.candidates.length === 1 && frame.candidates[0].customerId === customerId ? frame.candidates[0].customerId : undefined;
  if (!active()) return null;
  return <section className={styles.stack} aria-label={t('会员姓名修改')}>
    <p className={styles.help}>{t('选择会员并核对姓名差异。修改属于本租户共享会员资料，不改变订单或企业关系。')}</p>
    {view.pending && <Alert type="warning" title={t('原请求结果待核对。')}
      description={t('保留原定位，只读取原记录；未观察到结果不表示未提交。')} />}
    {view.locatorDamaged && <Alert type="warning" title={t('原定位无法读取，已阻止新的姓名修改。')}
      description={t('请保留本地记录并核对原任务；定位损坏不表示没有已提交的请求。')} />}
    {recoveryLocator ? <ActionButton label={t('核对原姓名修改结果')} disabled={busy} onAction={action(() => session.read(recoveryLocator))} />
      : <ActionButton label={t('打开会员姓名入口')} disabled={busy}
        onAction={action(() => customerId === undefined ? session.availability() : discover())} />}
    {!view.pending && !view.locatorDamaged && !reconfirm.journal && !reconfirm.damaged && frame?.newWorkEnabled && !frame.task && <div className={styles.section}>
      {customerId === undefined && <div className={styles.field}><label htmlFor={searchId}>{t('查找会员')}</label>
        <Input id={searchId} value={search} maxLength={191} disabled={busy} onChange={event => { if (hostCurrent()) { reset(); setSearch(event.target.value); } }} /></div>}
      <ActionButton label={t('查找会员')} disabled={!!view.busy || (customerId === undefined && !search.trim())}
        onAction={action(discover)} />
      {frame.phase === 'candidates' && frame.candidates.length === 0 && <p className={styles.help}>{t('没有匹配的会员，请核对姓名。')}</p>}
      {frame.phase === 'candidates' && frame.candidates.length > 0 && <>
        {customerId === undefined ? <div className={styles.field}><label htmlFor={memberId}>{t('选择具体会员')}</label>
          <Select id={memberId} value={selected} allowClear disabled={!!view.busy} placeholder={t('请选择，不自动匹配同名会员')}
            options={frame.candidates.map(row => ({ value: row.customerId, label: `${row.name} · ${row.phoneMasked}` }))}
            onChange={value => { if (hostCurrent()) { setSelected(value); setRequestKey(crypto.randomUUID()); } }} /></div>
          : <p>{t('本次会员')} {frame.candidates[0]?.name} · {frame.candidates[0]?.phoneMasked}</p>}
        <div className={styles.field}><label htmlFor={nameId}>{t('新姓名')}</label>
          <Input id={nameId} value={name} maxLength={120} disabled={busy} onChange={event => { if (hostCurrent()) setName(event.target.value); }} /></div>
        <ActionButton label={t('核对姓名差异')} disabled={!!view.busy || !selectedCustomerId || !name.trim()}
          onAction={action(() => session.inspect(selectedCustomerId!, name.trim(), requestKey))} />
        {frame.truncated && <p className={styles.help}>{t('匹配结果较多，请输入更完整的姓名。')}</p>}
      </>}
      {frame.review && <section className={styles.section}>
        <p>{t('本次会员')} {frame.candidates[0]?.name} · {frame.candidates[0]?.phoneMasked}</p>
        <dl className={styles.facts}><div><dt>{t('当前姓名')}</dt><dd>{frame.review.change.before}</dd></div>
          <div><dt>{t('新姓名')}</dt><dd>{frame.review.change.after}</dd></div>
          <div><dt>{t('资料版本')}</dt><dd>{frame.review.change.baseRevision}</dd></div>
          <div><dt>{t('核对有效期')}</dt><dd>{formatTimestamp(frame.review.change.expiresAt).value}</dd></div></dl>
        <p className={styles.help}>{t('来源为原会员主档；本租户共享。手机号、身份和企业关系需走原验证流程。')}</p>
        {frame.phase === 'no_change' ? <p>{t('姓名未发生变化。')}</p> : <ConfirmAction label={t('准备姓名审核')}
          prompt={t('为此会员准备原姓名审核任务并启用本任务的处理权限？此步不会更新姓名，提交前仍需确认。')}
          confirmLabel={t('准备原审核任务')} disabled={busy || !canWrite} onConfirm={action(() => session.prepare())} />}
        <ActionButton label={t('重新选择会员')} disabled={!!view.busy} onAction={async () => reset()} />
      </section>}
    </div>}
    {!view.pending && frame && !frame.newWorkEnabled && <p className={styles.help}>{t('当前未开放新的姓名修改，原记录仍按当前权限核对。')}</p>}
    {!view.pending && frame?.phase === 'waiting_confirmation' && frame.change && <section className={styles.section}>
      <h3>{t('确认共享会员姓名修改')}</h3>
      <p>{t('本次会员')} {frame.candidates[0]?.name} · {frame.candidates[0]?.phoneMasked}</p>
      <p>{frame.change.before} → {frame.change.after}</p>
      <p className={styles.help}>{t('只修改本租户共享会员的姓名。确认后由原审批和 Core 提交，其他资料保持原流程。')}</p>
      <ConfirmAction label={t('确认修改姓名')} prompt={t('确认将所示会员姓名修改为新值？')}
        confirmLabel={t('确认并提交原修改')} disabled={busy || !canWrite || !!reconfirm.journal && !attached || reconfirm.damaged || !frame.task?.confirmationHash}
        onConfirm={action(() => session.execute())} />
    </section>}
    {view.canStartReview && frame?.phase === 'task_created' && <ConfirmAction label={t('继续原姓名审核')}
      confirmLabel={t('继续原姓名审核')}
      prompt={t('按同一原定位继续启动尚未开始的审核？仍需原服务核对准入，姓名不会在此步提交。')}
      disabled={busy || !canWrite || !frame.newWorkEnabled || reconfirm.damaged || !!reconfirm.journal && !attached}
      onConfirm={action(() => session.startReview())} />}
    {reconfirmVisible && (terminal || reconfirm.journal || reconfirm.damaged) && <section className={styles.section} aria-label={t('重新确认姓名修改')}>
      {reconfirm.damaged && <Alert type="warning" title={t('重新确认记录不可用，已暂停新操作。')} />}
      {['prepare', 'handoff'].includes(reconfirm.journal?.phase ?? '') && <Alert type="warning" title={t('新的姓名变更结果待核对。')}
        description={t('只读取旧请求关联的新变更；未观察到结果不能重发。')} />}
      <ActionButton label={t('读取重新确认依据')} disabled={busy || !reconfirm.journal && !frame?.locator}
        onAction={action(async () => { await reconfirmation.read(reconfirm.journal ? undefined : frame!.locator!); if (hostCurrent()) setReconfirmName(''); })} />
      {terminal && attached && <ActionButton label={t('重新核对当前姓名差异')} disabled={busy || reconfirm.damaged}
        onAction={action(async () => { await reconfirmation.followReplacement(); if (hostCurrent()) setReconfirmName(''); })} />}
      {reconfirm.journal?.phase === 'read_original' && reconfirm.current && !reconfirm.damaged && <>
        <div className={styles.field}><label htmlFor={reconfirmNameId}>{t('新姓名')}</label>
          <Input id={reconfirmNameId} value={reconfirmName} maxLength={120} disabled={busy || !canWrite}
            onChange={event => { if (hostCurrent()) { reconfirmation.clearReview(); setReconfirmName(event.target.value); } }} /></div>
        <ActionButton label={t('核对姓名差异')} disabled={busy || !canWrite || !reconfirmName.trim()}
          onAction={action(() => reconfirmation.review(reconfirmName.trim()))} />
      </>}
      {reconfirmReview && <>
        <p>{t('本次会员')} {reconfirm.review?.candidates[0]?.name} · {reconfirm.review?.candidates[0]?.phoneMasked}</p>
        <dl className={styles.facts}>
          <div><dt>{t('旧提案姓名')}</dt><dd>{reconfirmReview.previous.before} → {reconfirmReview.previous.after} · {reconfirmReview.previous.baseRevision}</dd></div>
          <div><dt>{t('当前姓名')}</dt><dd>{reconfirmReview.current.before}</dd></div>
          <div><dt>{t('新姓名')}</dt><dd>{reconfirmReview.name}</dd></div>
          <div><dt>{t('资料版本')}</dt><dd>{reconfirmReview.current.baseRevision}</dd></div>
          <div><dt>{t('核对有效期')}</dt><dd>{formatTimestamp(reconfirmReview.expiresAt).value}</dd></div>
        </dl>
        <ConfirmAction label={t('准备新的姓名变更')} confirmLabel={t('准备新的姓名变更')}
          prompt={t('原审核须已终结且未提交。按当前差异保存新变更，随后另行启动和确认审核？')}
          disabled={busy || !canWrite || reconfirm.damaged} onConfirm={action(() => reconfirmation.prepare())} />
      </>}
      {reconfirm.prepared && ['prepared', 'handoff', 'attached'].includes(reconfirm.journal?.phase ?? '') &&
        <ActionButton label={t('接续新的姓名审核')} disabled={busy || reconfirm.damaged}
          onAction={action(() => reconfirmation.attach())} />}
      {attached && view.canStartReview && frame?.phase === 'prepared' && <>
        <p>{t('新姓名变更已保存，尚未启动新审核。')} {frame.change?.before} → {frame.change?.after}</p>
        <ConfirmAction label={t('启动新的姓名审核')} confirmLabel={t('启动新的姓名审核')}
          prompt={t('为已保存的新变更启动原审核任务？姓名仍须另行确认提交。')}
          disabled={busy || !canWrite || reconfirm.damaged} onConfirm={action(() => session.startReview())} />
      </>}
      {!!reconfirm.error && <Alert type="warning" title={t('重新确认失败，请核对原任务和当前差异。')} />}
      {attached && frame?.operation && <ActionButton label={t('关闭已完成的重新确认')} disabled={busy || reconfirm.damaged}
        onAction={action(async () => { await reconfirmation.finish(); if (hostCurrent()) reset(); })} />}
    </section>}
    {frame?.operation && <Alert type="success" title={t('原姓名修改已完成。')}
      description={`${frame.operation.resultName} · ${t('资料版本')} ${frame.operation.resultRevision} · ${formatTimestamp(frame.operation.committedAt).value}`} />}
    {!view.pending && !reconfirm.journal && !reconfirm.damaged && frame?.operation && <ActionButton label={t('准备另一项姓名修改')} disabled={busy} onAction={async () => reset()} />}
    {frame?.phase === 'not_observed' && <Alert type="warning" title={t('未观察到原姓名修改记录。')}
      description={t('保留原定位继续核对，不能据此重发。')} />}
    {frame?.phase === 'difference_stale_not_saved' && <Alert type="warning" title={t('会员资料已变化，本次未保存变更。')}
      description={t('请重新查找会员并核对差异，再准备新的审核任务。')} />}
    {frame?.phase === 'task_read_unavailable' && <Alert type="warning" title={t('当前原任务不可读取，请核对读取权限。')} />}
    {!!view.error && <Alert type="warning" title={t(view.pending ? '请求未能确认，请读取原记录。' : '当前操作不可用，请核对权限或输入。')} />}
  </section>;
}
