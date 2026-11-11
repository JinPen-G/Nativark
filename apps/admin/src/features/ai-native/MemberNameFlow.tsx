/** Original member-name consumer. An optional master ID selects a fresh server
 * candidate query; it is never approval or access evidence. Effect replay and
 * context changes discard local facts while retaining uncertain operation IDs. */
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { ActionButton, Alert, ConfirmAction, Input, Select } from '@/components/ui';
import { aiMemberNameApi } from '@/api/aiMemberName';
import { useAuthStore } from '@/features/auth/authStore';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { createMemberNameSession, memberNameStore } from './member-name-session';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import styles from './AiManagement.module.css';

const scope = (auth: ReturnType<typeof useAuthStore.getState>) => JSON.stringify([
  auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, auth.user?.isSaasAdmin, auth.user?.isPlatformAdmin,
  auth.user?.organizationId, auth.user?.dataScope, auth.user?.locationScope,
  auth.user?.permissions && [...new Set(auth.user.permissions)].sort(), auth.user?.tenantMembership
]);
export function MemberNameFlow({ identity, customerId, current, onAccessDenied }: {
  identity: string; customerId?: string; current(): boolean; onAccessDenied(): void;
}) {
  const { t } = useAiManagementLocale(), auth = useAuthStore(), [, changed] = useReducer(n => n + 1, 0);
  const searchId = useId(), nameId = useId(), memberId = useId();
  const [search, setSearch] = useState(''), [selected, setSelected] = useState<string | undefined>(), [name, setName] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const epoch = currentSessionEpoch(), originalScope = scope(auth), binding = JSON.stringify([identity, customerId, originalScope, epoch]);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const active = () => owner.current.binding === binding && epoch === currentSessionEpoch()
    && originalScope === scope(useAuthStore.getState()) && typeof document !== 'undefined'
    && !document.hidden && !currentSessionSignal().aborted && owner.current.current();
  const storageKey = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id]);
  const controller = useMemo(() => {
    let storage: Storage | undefined; try { storage = typeof window === 'undefined' ? undefined : window.localStorage; } catch { /* preserve-before-dispatch refuses writes */ }
    const create = () => createMemberNameSession({ tenantId: auth.tenant?.tenantId ?? '', current: active, api: aiMemberNameApi,
      store: memberNameStore(`rental-os-member-name:${storageKey}`, storage), changed });
    let session = create(), disposed = false;
    return { get session() { return session; }, activate() {
      // StrictMode replays effects on the same mounted component. A disposed
      // driver cannot be reused; its successor only restores the original IDs.
      if (disposed) { session = create(); disposed = false; }
    }, dispose() { session.dispose(); disposed = true; } };
  }, [binding]);
  useEffect(() => {
    controller.activate(); setSearch(''); setSelected(undefined); setName(''); setRequestKey(crypto.randomUUID()); changed();
    const visibility = () => {
      if (document.hidden) { controller.dispose(); setSearch(''); setSelected(undefined); setName(''); }
      else controller.activate();
      changed();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); controller.dispose(); };
  }, [controller]);
  const session = controller.session, view = session.view;
  // A preserved request can belong to another member in this actor's journal.
  // It remains readable, but cannot present or approve that person's facts here.
  const frame = customerId === undefined || !view.frame || ((!view.frame.locator || view.frame.locator.customerId === customerId)
    && view.frame.candidates.every(row => row.customerId === customerId)) ? view.frame : null;
  const canWrite = auth.hasPermission('rental-os:member:manage');
  const action = (work: () => Promise<unknown>) => async () => { try { return await work(); } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (active() && (status === 401 || status === 403)) onAccessDenied(); throw error;
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
    {view.pending || frame?.task ? <ActionButton label={t('核对原姓名修改结果')} disabled={!!view.busy} onAction={action(() => session.read())} />
      : <ActionButton label={t('打开会员姓名入口')} disabled={!!view.busy}
        onAction={action(() => customerId === undefined ? session.availability() : discover())} />}
    {!view.pending && !view.locatorDamaged && frame?.newWorkEnabled && !frame.task && <div className={styles.section}>
      {customerId === undefined && <div className={styles.field}><label htmlFor={searchId}>{t('查找会员')}</label>
        <Input id={searchId} value={search} maxLength={191} disabled={!!view.busy} onChange={event => { setSearch(event.target.value); reset(); }} /></div>}
      <ActionButton label={t('查找会员')} disabled={!!view.busy || (customerId === undefined && !search.trim())}
        onAction={action(discover)} />
      {frame.phase === 'candidates' && frame.candidates.length === 0 && <p className={styles.help}>{t('没有匹配的会员，请核对姓名。')}</p>}
      {frame.phase === 'candidates' && frame.candidates.length > 0 && <>
        {customerId === undefined ? <div className={styles.field}><label htmlFor={memberId}>{t('选择具体会员')}</label>
          <Select id={memberId} value={selected} allowClear disabled={!!view.busy} placeholder={t('请选择，不自动匹配同名会员')}
            options={frame.candidates.map(row => ({ value: row.customerId, label: `${row.name} · ${row.phoneMasked}` }))}
            onChange={value => { setSelected(value); setRequestKey(crypto.randomUUID()); }} /></div>
          : <p>{t('本次会员')} {frame.candidates[0]?.name} · {frame.candidates[0]?.phoneMasked}</p>}
        <div className={styles.field}><label htmlFor={nameId}>{t('新姓名')}</label>
          <Input id={nameId} value={name} maxLength={120} disabled={!!view.busy} onChange={event => setName(event.target.value)} /></div>
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
          confirmLabel={t('准备原审核任务')} disabled={!!view.busy || !canWrite} onConfirm={action(() => session.prepare())} />}
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
        confirmLabel={t('确认并提交原修改')} disabled={!!view.busy || !canWrite || !frame.task?.confirmationHash}
        onConfirm={action(() => session.execute())} />
    </section>}
    {frame?.operation && <Alert type="success" title={t('原姓名修改已完成。')}
      description={`${frame.operation.resultName} · ${t('资料版本')} ${frame.operation.resultRevision} · ${formatTimestamp(frame.operation.committedAt).value}`} />}
    {!view.pending && frame?.operation && <ActionButton label={t('准备另一项姓名修改')} disabled={!!view.busy} onAction={async () => reset()} />}
    {frame?.phase === 'not_observed' && <Alert type="warning" title={t('未观察到原姓名修改记录。')}
      description={t('保留原定位继续核对，不能据此重发。')} />}
    {frame?.phase === 'difference_stale_not_saved' && <Alert type="warning" title={t('会员资料已变化，本次未保存变更。')}
      description={t('请重新查找会员并核对差异，再准备新的审核任务。')} />}
    {frame?.phase === 'task_read_unavailable' && <Alert type="warning" title={t('当前原任务不可读取，请核对读取权限。')} />}
    {!!view.error && <Alert type="warning" title={t(view.pending ? '请求未能确认，请读取原记录。' : '当前操作不可用，请核对权限或输入。')} />}
  </section>;
}
