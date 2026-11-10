import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { AI_TASK_RULE_DRAFT_FIELDS, type AiTaskRuleDraftReference } from '@rental-os/shared';
import { useNavigate } from 'react-router-dom';
import { ActionButton, Alert, Button, Checkbox, ConfirmAction, Input, Select } from '@/components/ui';
import { APP_ROUTES } from '@/app/navigation';
import { aiTaskRuleDraftApi } from '@/api/aiTaskRuleDraft';
import { useAuthStore } from '@/features/auth/authStore';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAiManagementLocale } from './management-locale';
import { createTaskRuleDraftSession, taskRuleDraftStore, createTaskRuleDraftPreparationSession, taskRuleDraftPreparationStore } from './task-rule-draft-session';
import { formatTimestamp } from './formatters';
import { RuleDraftDifferences } from './TaskRuleDraftView';
import styles from './AiManagement.module.css';

export type TaskRuleDraftProps = { taskId: string; identity: string; current(): boolean; onAccessDenied(): void };
export function TaskRuleDraft(props: TaskRuleDraftProps) {
  const [prepared, setPrepared] = useState<{ identity: string; taskId: string } | null>(null);
  const taskId = prepared?.identity === props.identity ? prepared.taskId : props.taskId;
  return <section className={styles.stack}>
    <RulePreparation {...props} onPrepared={reference => { if (props.current()) setPrepared({ identity: props.identity, taskId: reference.taskId }); }} />
    <RuleDraftConsumer {...props} taskId={taskId} identity={`${props.identity}:${taskId}`} />
  </section>;
}

function RuleDraftConsumer({ taskId, identity, current, onAccessDenied }: TaskRuleDraftProps) {
  const { t } = useAiManagementLocale(), auth = useAuthStore(), [, changed] = useReducer(n => n + 1, 0), reasonId = useId();
  const [reason, setReason] = useState('依原提案保存规则草稿');
  const stableOwner = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, taskId]);
  const epoch = currentSessionEpoch(), binding = JSON.stringify([identity, taskId, stableOwner, auth.user, epoch]);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const active = () => owner.current.binding === binding && epoch === currentSessionEpoch() && !document.hidden && owner.current.current();
  const session = useMemo(() => {
    let storage: Storage | undefined; try { if (typeof window !== 'undefined') storage = window.localStorage; } catch { /* Reads remain possible; preserve-before-save will refuse dispatch. */ }
    return createTaskRuleDraftSession({ taskId, current: active, api: aiTaskRuleDraftApi,
      store: taskRuleDraftStore(`rental-os-rule-draft:${stableOwner}`, storage), changed });
  }, [binding]);
  useEffect(() => { session.activate(); const clear = () => session.clear(); document.addEventListener('visibilitychange', clear);
    return () => { document.removeEventListener('visibilitychange', clear); session.dispose(); }; }, [session]);
  if (!active()) return null;
  const data = session.view, canManage = auth.hasPermission('rental-os:rules:manage');
  const action = (work: () => Promise<void>) => async () => { try { await work(); } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (active() && (status === 401 || status === 403)) onAccessDenied(); throw error;
  } };
  const inspect = (reference: AiTaskRuleDraftReference) => action(() => session.review(reference, reason));
  const committed = data.operation?.operation.state === 'committed' ? data.operation.operation : null;
  return <section className={styles.stack} aria-label={t('规则业务草稿')}>
    <p className={styles.help}>{t('核对原提案后保存业务草稿。保存不会发布或替换当前生效规则。')}</p>
    {data.locatorInvalid && <Alert type="warning" title={t('原保存定位不可用，不能再次保存。')}
      description={t('可读取原提案及原业务收据；定位缺失不证明未保存。')} />}
    {data.pending && <Alert type="warning" title={t(data.busy === 'save' ? '正在保存原业务草稿。' : '原保存结果待核对。')}
      description={t('只读取原操作；未观察到结果也不代表未保存，不自动重试。')} />}
    {data.pending ? <ActionButton label={t('核对原保存结果')} disabled={!!data.busy} onAction={action(() => session.operation(data.pending!))} />
      : <ActionButton label={t('读取规则提案')} disabled={!!data.busy} onAction={action(() => session.list())} />}
    {!data.pending && data.loaded && data.items.length === 0 && <p className={styles.help}>{t('本任务没有已保存的规则提案，请继续原开业提案流程。')}</p>}
    {!data.pending && data.items.length > 0 && <div className={styles.field}>
      <label htmlFor={reasonId}>{t('变更原因')}</label><Input.TextArea id={reasonId} value={reason} maxLength={500} disabled={!!data.busy}
        onChange={event => { setReason(event.target.value); session.clearReview(); }} />
      {data.items.map(item => <div key={item.reference.stepId} className={styles.section}>
        <h3>{t('原规则版本')} {item.target.version}</h3>
        <ActionButton label={t('核对业务草稿')} disabled={!canManage || !!data.busy || !reason.trim()}
          onAction={inspect(item.reference)} />
        {data.locatorInvalid && <ActionButton label={t('核对原保存结果')} disabled={!!data.busy}
          onAction={action(() => session.operation(item.reference))} />}
      </div>)}
    </div>}
    {!data.pending && data.review && <section className={styles.section}>
      <p>{t(data.review.mode === 'restore_to_new_draft' ? '将保留原规则，生成新的业务草稿。' : '将保存原规则的业务草稿。')}
        {' '}{t('草稿版本')} {data.review.resultVersion}</p>
      <RuleDraftDifferences review={data.review} translate={t} />
      <ConfirmAction label={t('保存业务草稿')} prompt={t('确认保存这份业务草稿？不会发布当前规则。')} confirmLabel={t('确认保存草稿')}
        disabled={!canManage || !data.saveEnabled || !!data.busy}
        onConfirm={action(() => session.save())} />
      {!data.saveEnabled && <p className={styles.help}>{t('当前未开放新草稿保存，仍可核对原操作。')}</p>}
    </section>}
    {committed && <section className={styles.section}>
      <Alert type="success" title={t('原业务草稿已保存。')} description={t('这是保存时的原收据；发布需继续原规则流程。')} />
      <p>{t('草稿版本')} {committed.draft.version} · {formatTimestamp(committed.committedAt).value}</p>
      <RuleDraftDifferences review={committed} translate={t} />
    </section>}
    {data.operation?.operation.state === 'not_observed' && <Alert type="warning" title={t('未观察到原操作。')}
      description={t('保留原定位并继续核对，不能据此重发保存。')} />}
    {!!data.error && <Alert type="warning" title={t(data.pending ? '保存未能确认，请核对原结果。' : '当前规则草稿不可读取，请核对权限或重新读取。')} />}
  </section>;
}

const preparationLabels: Record<typeof AI_TASK_RULE_DRAFT_FIELDS[number], string> = {
  'fulfillment.pickupInspectionRequired': '交付检查', 'fulfillment.returnInspectionRequired': '归还检查',
  'fulfillment.evidenceRequired': '履约凭证', 'fulfillment.allowDifferentReturnLocation': '异地归还',
  'damage.manualReviewRequired': '损坏人工审核', 'cancellation.weatherExceptionEnabled': '天气例外'
};
function RulePreparation({ taskId, identity, current, onAccessDenied, onPrepared }: TaskRuleDraftProps & { onPrepared(reference: AiTaskRuleDraftReference): void }) {
  const auth = useAuthStore(), { t } = useAiManagementLocale(), navigate = useNavigate(), [, changed] = useReducer(n => n + 1, 0);
  const epoch = currentSessionEpoch(), stable = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, taskId]);
  const binding = JSON.stringify([identity, stable, auth.user, epoch]), owner = useRef({ binding, current }); owner.current = { binding, current };
  const active = () => owner.current.binding === binding && epoch === currentSessionEpoch() && !document.hidden && owner.current.current();
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.localStorage; } catch { /* Preserve-before-dispatch refuses a preparation without a locator. */ }
    return createTaskRuleDraftPreparationSession({ taskId, tenantId: auth.tenant?.tenantId ?? '', workspaceId: auth.currentWorkspaceId ?? '',
      current: active, changed, api: aiTaskRuleDraftApi, store: taskRuleDraftPreparationStore(`rental-os-rule-preparation:${stable}`, storage) });
  }, [binding]);
  useEffect(() => { session.activate(); const clear = () => session.clear(); document.addEventListener('visibilitychange', clear);
    return () => { document.removeEventListener('visibilitychange', clear); session.dispose(); }; }, [session]);
  if (!active() || !auth.hasPermission('rental-os:rules:manage')) return null;
  const data = session.view, saved = data.operation?.operation.state === 'ai_proposal_saved' ? data.operation.operation : null;
  const action = (work: () => Promise<void>) => async () => {
    try { await work(); const value = session.view.operation?.operation;
      if (active() && value?.state === 'ai_proposal_saved') onPrepared(value.proposal.reference);
    } catch (error) { if (active() && [401, 403].includes((error as { response?: { status?: number } }).response?.status ?? 0)) onAccessDenied(); throw error; }
  };
  return <section className={styles.stack} aria-label={t('新的规则准备')} aria-busy={!!data.busy}>
    <p>{t('明确发起关联的新规则准备。原诊断保持不变；本步只保存 AI 提案，Core 草稿与发布另行确认。')}</p>
    <div className={styles.toolbar}>
      {data.pending ? <ActionButton label={t('核对原规则准备结果')} disabled={!!data.busy} onAction={action(() => session.operation())} />
        : <ActionButton label={t('读取原规则字段')} disabled={!!data.busy || data.invalid} onAction={action(() => session.read())} />}
      <Button onClick={() => { if (active() && useAuthStore.getState().hasPermission('rental-os:rules:manage')) navigate(APP_ROUTES.rentalSettings.path); }}>{t('原规则配置页')}</Button>
    </div>
    {data.invalid && <Alert type="warning" title={t('原准备定位不可读取，不能重新发起。')} />}
    {data.preparation?.hasMore && <p>{t('仅提供最新20个原规则版本，请在原配置页核对其他版本。')}</p>}
    {data.preparation && !data.pending && <>
      {!data.preparation.targets.length ? <p>{t('尚无原规则版本，请先在原规则页创建。')}</p> : <Select aria-label={t('选择原规则版本')}
        value={data.targetId ?? undefined} disabled={!!data.busy} placeholder={t('选择原规则版本')}
        options={data.preparation.targets.map(target => ({ value: target.id, label: `${target.version} · ${t(target.status)}` }))}
        onChange={value => session.select(String(value))} />}
      {data.values && <>
        <div className={styles.stack}>{AI_TASK_RULE_DRAFT_FIELDS.map(field => <Checkbox key={field} checked={data.values![field]} disabled={!!data.busy}
          onChange={event => session.edit(field, event.target.checked)}>{t(preparationLabels[field])}</Checkbox>)}</div>
        <ActionButton label={t('预览原规则差异')} disabled={!!data.busy} onAction={action(() => session.preview())} />
      </>}
    </>}
    {data.preview && !data.pending && <>
      <RuleDraftDifferences review={{ changes: data.preview.changes, normalizations: [] }} translate={t} />
      <p>{t('本步是 AI 提案预览；业务草稿保存时由 Core 重新校验。')}</p>
      {data.preview.status === 'no_change' ? <p>{t('所选字段没有差异，不创建新准备。')}</p> : <ConfirmAction label={t('明确保存新的 AI 规则提案')}
        prompt={t('按以上原版本和差异发起关联的新规则准备？只保存 AI 提案，不保存或发布 Core 规则。')}
        disabled={!!data.busy || data.invalid} onConfirm={action(() => session.prepare(crypto.randomUUID()))} />}
    </>}
    {saved && <Alert type="success" title={t('新的 AI 规则提案已保存。')} description={t('下方按新任务核对 Core 草稿，发布仍走原规则流程。')} />}
    {data.operation?.operation.state === 'linked_request_recorded' && <Alert type="warning" title={t('关联规则请求已记录，AI 提案尚未确认。')}
      description={t('只核对原准备操作，不换键创建任务或重放未知保存。')} />}
    {data.operation?.operation.state === 'not_observed' && <p>{t('未观察到原准备，不证明没有提交；继续核对原操作。')}</p>}
    {!!data.error && <Alert type="warning" title={t(data.pending ? '规则准备结果未确认，请核对原操作。' : '当前原规则准备不可用，请核对权限、发布政策与版本。')} />}
  </section>;
}
