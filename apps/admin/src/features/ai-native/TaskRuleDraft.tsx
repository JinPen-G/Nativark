import { useEffect, useId, useMemo, useReducer, useState } from 'react';
import type { AiTaskRuleDraftReference } from '@rental-os/shared';
import { ActionButton, Alert, ConfirmAction, Input } from '@/components/ui';
import { aiTaskRuleDraftApi } from '@/api/aiTaskRuleDraft';
import { useAuthStore } from '@/features/auth/authStore';
import { useAiManagementLocale } from './management-locale';
import { createTaskRuleDraftSession, taskRuleDraftStore } from './task-rule-draft-session';
import { formatTimestamp } from './formatters';
import { RuleDraftDifferences } from './TaskRuleDraftView';
import styles from './AiManagement.module.css';

export function TaskRuleDraft({ taskId, identity, current, onAccessDenied }: { taskId: string; identity: string; current(): boolean; onAccessDenied(): void }) {
  const { t } = useAiManagementLocale(), auth = useAuthStore(), [, changed] = useReducer(n => n + 1, 0), reasonId = useId();
  const [reason, setReason] = useState('依原提案保存规则草稿');
  const stableOwner = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, taskId]);
  const session = useMemo(() => {
    let storage: Storage | undefined; try { if (typeof window !== 'undefined') storage = window.localStorage; } catch { /* Reads remain possible; preserve-before-save will refuse dispatch. */ }
    return createTaskRuleDraftSession({ taskId, current, api: aiTaskRuleDraftApi,
      store: taskRuleDraftStore(`rental-os-rule-draft:${stableOwner}`, storage), changed });
  }, [identity, taskId]);
  useEffect(() => () => session.dispose(), [session]);
  const data = session.view, canManage = auth.hasPermission('rental-os:rules:manage');
  const action = (work: () => Promise<void>) => async () => { try { await work(); } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 401 || status === 403) onAccessDenied(); throw error;
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
