/** Explicit ordinary-section AI proposals. Original current values and field
 * choices come from the server; each target has its own preserved operation
 * locator. Saved differences use their original receipt, never current candidates.
 * Proposal preparation grants no Core save, approval or publication. */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { AiTaskOpeningProposalListDraft, AiTaskOpeningProposalMaterialDraft, AiTaskOpeningProposalSectionDraft } from '@rental-os/shared';
import { ActionButton, Alert, ConfirmAction, Input, Select } from '@/components/ui';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { useAiManagementLocale } from './management-locale';
import { createTaskOpeningProposalSession } from './task-opening-proposal-session';
import { formatTimestamp } from './formatters';
import { safeDisplayText } from './safe-display';
import styles from './AiManagement.module.css';

type Candidate = AiTaskOpeningProposalListDraft['candidates'][number];
const titles = { workspace_profile: '空间资料', item_groups: '商品组', pricing_groups_rates: '计价组与费率', fulfillment_network: '履约网络' };
const targetKey = (value: Candidate) => JSON.stringify([value.key, value.targetId]);
export function TaskOpeningProposals({ taskId, runId, identity, current }: {
  taskId: string; runId?: string; identity: string; current(): boolean;
}) {
  const auth = useAuthStore(), { t } = useAiManagementLocale(), [, changed] = useReducer(value => value + 1, 0);
  const [selected, select] = useState<string | null>(null), epoch = currentSessionEpoch();
  const binding = JSON.stringify([taskId, runId, identity, auth.user, auth.tenant?.tenantId, auth.currentWorkspaceId, epoch]);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const valid = () => owner.current.binding === binding && epoch === currentSessionEpoch() && !document.hidden && owner.current.current();
  const session = useMemo(() => createTaskOpeningProposalSession({ query: { taskId, ...(runId ? { runId } : {}) },
    tenantId: auth.tenant?.tenantId ?? '', workspaceId: auth.currentWorkspaceId ?? '', current: valid, changed,
    storageKey: `${binding}:opening-read` }), [binding]);
  useEffect(() => { session.activate(); const clear = () => { session.clear(); select(null); }; document.addEventListener('visibilitychange', clear);
    return () => { document.removeEventListener('visibilitychange', clear); session.dispose(); }; }, [session]);
  if (!auth.hasPermission('rental-os:price:manage') || !valid()) return null;
  const data = session.view, list = data.list, candidate = list?.candidates.find(row => targetKey(row) === selected);
  return <section className={styles.stack} aria-label={t('普通分区 AI 提案')} aria-busy={data.busy}>
    <ActionButton label={t('读取可准备分区')} pendingLabel={t('正在核对')} disabled={data.busy} onAction={() => session.read()} />
    {data.error && <Alert type="warning" title={t('原分区来源不可读取，请重新核对。')} />}
    {list && <>
      {!list.candidates.length && <p>{t('本轮没有可准备的普通分区。')}</p>}
      {list.hasMore && <p>{t('仅提供已读取的分区候选，请在原配置页核对其余资料。')}</p>}
      {!!list.candidates.length && <Select aria-label={t('选择分区')} value={selected ?? undefined} onChange={value => select(String(value))}
        options={list.candidates.map(row => ({ value: targetKey(row), label: t(titles[row.key]) + (row.key === 'item_groups'
          ? ` · ${safeDisplayText(row.fields.find(field => field.field === 'code')?.value ?? row.targetId, 191)}` : '') }))} />}
      {candidate && <OpeningTarget key={`${binding}:${targetKey(candidate)}:${list.source.materialHash}`} query={{ taskId, ...(runId ? { runId } : {}) }}
        list={list} candidate={candidate} identity={binding} current={valid} />}
    </>}
    <p className={styles.help}>{t('各分区独立准备 AI 提案；业务草稿、批准、活动配置和发布须沿原业务流程。')}</p>
  </section>;
}

function OpeningTarget({ query, list, candidate, identity, current }: { query: { taskId: string; runId?: string };
  list: AiTaskOpeningProposalListDraft; candidate: Candidate; identity: string; current(): boolean }) {
  const auth = useAuthStore(), { t } = useAiManagementLocale(), [, changed] = useReducer(value => value + 1, 0);
  const [values, setValues] = useState<Record<string, string | string[]>>(Object.fromEntries(candidate.fields.map(field => [field.field,
    Array.isArray(field.value) ? [...field.value] : field.value ?? ''])));
  const epoch = currentSessionEpoch(), binding = JSON.stringify([identity, candidate.key, candidate.targetId, candidate.expectedVersion, auth.user, epoch]);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const valid = () => owner.current.binding === binding && epoch === currentSessionEpoch() && !document.hidden && owner.current.current();
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.localStorage; } catch { /* Read/preview remain possible; prepare requires reliable storage. */ }
    return createTaskOpeningProposalSession({ query, tenantId: list.source.scope.tenantId, workspaceId: list.source.scope.workspaceId,
      current: valid, changed, store: storage, storageKey: `rental-os-opening-proposal:${JSON.stringify([auth.user?.id,
        list.source.scope, query.taskId, candidate.key, candidate.targetId])}`, initialList: list,
      target: { key: candidate.key, targetId: candidate.targetId } });
  }, [binding]);
  useEffect(() => { session.activate(); const clear = () => session.clear(); document.addEventListener('visibilitychange', clear);
    return () => { document.removeEventListener('visibilitychange', clear); session.dispose(); }; }, [session]);
  const data = session.view, saved = data.operation?.state === 'observed' ? data.operation.receipt : null;
  const section = (): AiTaskOpeningProposalSectionDraft => ({ key: candidate.key, expectedVersion: candidate.expectedVersion,
    ...(candidate.key === 'item_groups' ? { targetId: candidate.targetId } : {}),
    changes: candidate.fields.map(field => ({ field: field.field, value: values[field.field] })) });
  const edit = (field: string, value: string | string[]) => { if (!valid() || data.locked || data.busy) return;
    session.edit(); setValues(before => ({ ...before, [field]: value })); };
  return <section className={styles.stack} aria-label={t(titles[candidate.key])} aria-busy={data.busy}>
    {!data.locked && !data.preview && <p>{t('原配置版本')}：{safeDisplayText(candidate.expectedVersion, 191)}</p>}
    {!data.locked && candidate.fields.map(field => <label key={field.field}>
      {t(safeDisplayText(field.title, 191))}
      {field.input === 'text' ? <Input value={typeof values[field.field] === 'string' ? values[field.field] : ''} maxLength={field.maxLength}
        disabled={data.busy} onChange={event => edit(field.field, event.currentTarget.value)} />
        : <Select mode={field.input === 'choices' ? 'multiple' : undefined} value={values[field.field]} disabled={data.busy}
          options={(field.choices ?? []).map(value => ({ value, label: t(safeDisplayText(value, 191)) }))}
          onChange={value => edit(field.field, Array.isArray(value) ? value.map(String) : String(value))} />}
    </label>)}
    <ActionButton label={t(data.locked ? '核对原提案操作' : '预览原配置差异')} disabled={data.busy}
      onAction={() => data.locked ? session.operation() : session.preview(section())} />
    {data.error && <Alert type="warning" title={t('本次分区核对未完成，请核对原来源或原操作。')} />}
    {data.preview && <>
      <OpeningProposalMaterial material={data.preview.material} saved={false} />
      {data.preview.material.status === 'no_change' ? <p>{t('没有配置差异。')}</p> : <ConfirmAction label={t('明确准备本分区提案')} disabled={data.busy || data.locked}
        prompt={t('按已核对差异创建独立 AI 提案？不会保存活动配置或发布。')} onConfirm={() => session.prepare()} />}
    </>}
    {data.unknown && <Alert type="warning" title={t('原提案操作待核对，请读取同一原操作。')} />}
    {saved && <>
      <p role="status">{t('原 AI 提案已保存')}：{safeDisplayText(saved.proposalId, 191)}
        {' · '}{t('业务草稿未创建，尚未批准或发布。')}</p>
      <OpeningProposalMaterial material={saved.material} saved />
    </>}
  </section>;
}

function OpeningProposalMaterial({ material, saved }: { material: AiTaskOpeningProposalMaterialDraft; saved: boolean }) {
  const { locale, t } = useAiManagementLocale(), en = locale === 'en-US';
  const title = en ? (saved ? 'Saved proposal changes' : 'Current difference preview') : (saved ? '原保存提案差异' : '当前差异预览');
  const value = (input: string | string[] | null) => input === null ? (en ? 'Not loaded' : '未加载')
    : Array.isArray(input) && input.length === 0 ? (en ? 'None' : '无')
      : safeDisplayText(Array.isArray(input) ? input.join('、') : input, 20000);
  return <section className={styles.stack} aria-label={title}>
    <h4>{title}</h4>
    <dl className={styles.facts}>
      <div><dt>{en ? 'Original configuration version' : '原配置版本'}</dt><dd>{safeDisplayText(material.expectedVersion, 191)}</dd></div>
      <div><dt>{en ? 'Observed at' : '观察时间'}</dt><dd>{formatTimestamp(material.observedAt).value}</dd></div>
      <div><dt>{en ? 'Source' : '来源'}</dt><dd>{en ? 'Original business configuration' : '原经营配置'}</dd></div>
      <div><dt>{en ? 'Workspace' : '经营空间'}</dt><dd>{safeDisplayText(material.scope.workspaceId, 191)}</dd></div>
      <div><dt>{en ? 'Configuration target' : '配置对象'}</dt><dd>{safeDisplayText(material.targetId, 191)}</dd></div>
    </dl>
    <dl className={styles.facts}>{material.changes.map(change => <div key={change.field}>
      <dt>{t(safeDisplayText(change.field, 191))}</dt>
      <dd>{en ? 'Before' : '原值'}：{value(change.before)}<br />{en ? 'After' : '新值'}：{value(change.after)}</dd>
    </div>)}</dl>
    <p className={styles.help}>{en
      ? 'Only this partition in the workspace above is recorded. Business effects require original validation; check current configuration on the business page.'
      : '仅记录上述经营空间的本分区差异。实际业务影响须经原业务校验，当前活动配置请在原业务页核对。'}</p>
  </section>;
}
