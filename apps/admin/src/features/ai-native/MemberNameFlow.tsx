import { useEffect, useId, useMemo, useReducer, useState } from 'react';
import { ActionButton, Alert, ConfirmAction, Input, Select } from '@/components/ui';
import { aiMemberNameApi } from '@/api/aiMemberName';
import { useAuthStore } from '@/features/auth/authStore';
import { createMemberNameSession, memberNameStore } from './member-name-session';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import styles from './AiManagement.module.css';

export function MemberNameFlow({ identity, current, onAccessDenied }: { identity: string; current(): boolean; onAccessDenied(): void }) {
  const { t } = useAiManagementLocale(), auth = useAuthStore(), [, changed] = useReducer(n => n + 1, 0);
  const searchId = useId(), nameId = useId(), memberId = useId();
  const [search, setSearch] = useState(''), [selected, setSelected] = useState<string | undefined>(), [name, setName] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const storageKey = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id]);
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = typeof window === 'undefined' ? undefined : window.localStorage; } catch { /* preserve-before-dispatch refuses writes */ }
    return createMemberNameSession({ tenantId: auth.tenant?.tenantId ?? '', current, api: aiMemberNameApi,
      store: memberNameStore(`rental-os-member-name:${storageKey}`, storage), changed });
  }, [identity]);
  useEffect(() => () => session.dispose(), [session]);
  const view = session.view, frame = view.frame, canWrite = auth.hasPermission('rental-os:member:manage') && auth.hasPermission('system:params:manage');
  const action = (work: () => Promise<unknown>) => async () => { try { return await work(); } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 401 || status === 403) onAccessDenied(); throw error;
  } };
  const reset = () => { session.resetDraft(); setSelected(undefined); setName(''); setRequestKey(crypto.randomUUID()); };
  return <section className={styles.stack} aria-label={t('会员姓名修改')}>
    <p className={styles.help}>{t('选择会员并核对姓名差异。修改属于本租户共享会员资料，不改变订单或企业关系。')}</p>
    {view.pending && <Alert type="warning" title={t('原请求结果待核对。')}
      description={t('保留原定位，只读取原记录；未观察到结果不表示未提交。')} />}
    {view.locatorDamaged && <Alert type="warning" title={t('原定位无法读取，已阻止新的姓名修改。')}
      description={t('请保留本地记录并核对原任务；定位损坏不表示没有已提交的请求。')} />}
    {view.pending || frame?.task ? <ActionButton label={t('核对原姓名修改结果')} disabled={!!view.busy} onAction={action(() => session.read())} />
      : <ActionButton label={t('打开会员姓名入口')} disabled={!!view.busy} onAction={action(() => session.availability())} />}
    {!view.pending && !view.locatorDamaged && frame?.newWorkEnabled && !frame.task && <div className={styles.section}>
      <div className={styles.field}><label htmlFor={searchId}>{t('查找会员')}</label>
        <Input id={searchId} value={search} maxLength={191} disabled={!!view.busy} onChange={event => { setSearch(event.target.value); reset(); }} /></div>
      <ActionButton label={t('查找会员')} disabled={!!view.busy || !search.trim()}
        onAction={action(() => session.discover({ limit: 20, name: search.trim() }))} />
      {frame.phase === 'candidates' && frame.candidates.length === 0 && <p className={styles.help}>{t('没有匹配的会员，请核对姓名。')}</p>}
      {frame.phase === 'candidates' && frame.candidates.length > 0 && <>
        <div className={styles.field}><label htmlFor={memberId}>{t('选择具体会员')}</label>
          <Select id={memberId} value={selected} allowClear disabled={!!view.busy} placeholder={t('请选择，不自动匹配同名会员')}
            options={frame.candidates.map(row => ({ value: row.customerId, label: `${row.name} · ${row.phoneMasked}` }))}
            onChange={value => { setSelected(value); setRequestKey(crypto.randomUUID()); }} /></div>
        <div className={styles.field}><label htmlFor={nameId}>{t('新姓名')}</label>
          <Input id={nameId} value={name} maxLength={120} disabled={!!view.busy} onChange={event => setName(event.target.value)} /></div>
        <ActionButton label={t('核对姓名差异')} disabled={!!view.busy || !selected || !name.trim()}
          onAction={action(() => session.inspect(selected!, name.trim(), requestKey))} />
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
