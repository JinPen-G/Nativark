/** Original rule object -> stable creation journal -> existing R1/Core flow.
 * Only object/user/workspace ids key local storage. Display revisions revoke
 * buffered facts without hiding the journal; new rounds need original receipts. */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActionButton, Alert, Button, ConfirmAction } from '@/components/ui';
import { aiTaskRuleDraftApi } from '@/api/aiTaskRuleDraft';
import { useAuthStore } from '@/features/auth/authStore';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAiManagementLocale } from './management-locale';
import { createRuleSourceEntrySession, ruleSourceEntryStore } from './rule-source-entry-session';
import { TaskRuleDraft } from './TaskRuleDraft';
import styles from './AiManagement.module.css';

const english: Record<string, string> = {
  '准备规则提案': 'Prepare rule proposal', '读取原规则来源': 'Read original rule source', '记录原规则任务': 'Record original rule task',
  '先记录本版本的原任务，再核对 AI 提案与 Core 草稿。': 'Record this version’s original task, then review the AI proposal and Core draft.',
  '核对原规则任务': 'Check original rule task', '继续准备规则差异': 'Continue preparing rule changes',
  '原规则任务已记录。': 'Original rule task recorded.', '原任务结果待核对，请保留原定位。': 'The original task result is uncertain. Keep the original reference.',
  '原定位不可读取，不能再次发起。': 'The original reference cannot be read. A new attempt is unavailable.',
  '原规则版本': 'Original rule version', '开始下一轮规则准备': 'Start another rule preparation',
  '再次核对原 Core 收据后开始下一轮？': 'Check the original Core receipt again and start another preparation?',
  '确认开始下一轮': 'Start another preparation', '未观察到原任务，请继续核对原操作。': 'The original task has not been observed. Check the original operation again.',
  '当前规则入口不可用，请核对原结果或当前权限。': 'This rule entry is unavailable. Check its original result or your current permissions.'
};
export function useRuleSourceLocale() {
  const locale = useAiManagementLocale();
  const t = useCallback((text: string) => locale.locale === 'en-US' && english[text] ? english[text] : locale.t(text), [locale.locale, locale.t]);
  return { ...locale, t };
}
export function RuleSourceEntry({ targetId, version, identity, current, onAccessDenied }: {
  targetId: string; version: string; identity: string; current(): boolean; onAccessDenied(): void;
}) {
  const auth = useAuthStore(), { t } = useRuleSourceLocale(), [, changed] = useReducer(n => n + 1, 0);
  const [opened, setOpened] = useState<{ binding: string; taskId: string }>();
  const stable = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, targetId]);
  const epoch = currentSessionEpoch(), binding = JSON.stringify([identity, stable, auth.user, epoch, version]);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const active = () => owner.current.binding === binding && epoch === currentSessionEpoch() && !document.hidden
    && auth.hasPermission('rental-os:rules:manage') && owner.current.current();
  const session = useMemo(() => {
    let storage: Storage | undefined; try { if (typeof window !== 'undefined') storage = window.localStorage; } catch { /* Preserve-before-create refuses unavailable storage. */ }
    return createRuleSourceEntrySession({ targetId, version, tenantId: auth.tenant?.tenantId ?? '', workspaceId: auth.currentWorkspaceId ?? '',
      current: active, changed, api: aiTaskRuleDraftApi, store: ruleSourceEntryStore(`rental-os-rule-source:${stable}`, storage) });
  }, [binding]);
  useEffect(() => { session.activate(); const clear = () => { session.clear(); setOpened(undefined); }; document.addEventListener('visibilitychange', clear);
    return () => { document.removeEventListener('visibilitychange', clear); session.dispose(); }; }, [session]);
  if (!active()) return null;
  const view = session.view, operation = view.operation?.operation, task = operation?.state === 'original_request_recorded' ? operation.task : null;
  const action = (work: () => Promise<void>) => async () => { try { await work(); } catch (error) {
    if (active() && [401, 403].includes((error as { response?: { status?: number } }).response?.status ?? 0)) onAccessDenied(); throw error;
  } };
  return <section className={styles.stack} aria-label={t('准备规则提案')}>
    <p className={styles.help}>{t('原规则版本')} {operation?.state === 'original_request_recorded' ? operation.target.version : version}</p>
    {view.invalid && <Alert type="warning" title={t('原定位不可读取，不能再次发起。')} />}
    {view.pending ? <ActionButton intent="review" label={t('核对原规则任务')} disabled={view.busy} onAction={action(() => session.operation())} />
      : <ActionButton intent="review" label={t('读取原规则来源')} disabled={view.busy || view.invalid} onAction={action(() => session.read())} />}
    {!view.pending && view.source && <ConfirmAction label={t('记录原规则任务')}
      prompt={t('先记录本版本的原任务，再核对 AI 提案与 Core 草稿。')} confirmLabel={t('记录原规则任务')}
      disabled={view.busy || view.invalid} onConfirm={action(() => session.create(crypto.randomUUID()))} />}
    {task?.state === 'observed' && <>
      <Alert type="success" title={t('原规则任务已记录。')} />
      {opened?.binding !== binding && <Button onClick={() => { if (active()) setOpened({ binding, taskId: task.taskId }); }}>{t('继续准备规则差异')}</Button>}
    </>}
    {view.pending && !operation && <Alert type="warning" title={t('原任务结果待核对，请保留原定位。')} />}
    {(operation?.state === 'not_observed' || task?.state === 'not_observed') && <Alert type="warning" title={t('未观察到原任务，请继续核对原操作。')} />}
    {opened?.binding === binding && <TaskRuleDraft key={`${binding}:${opened.taskId}`} taskId={opened.taskId} identity={binding} current={active}
      onAccessDenied={onAccessDenied} onPrepared={reference => session.prepared(reference)} onCommitted={value => session.confirmed(value)} />}
    {view.committed && <ConfirmAction label={t('开始下一轮规则准备')} prompt={t('再次核对原 Core 收据后开始下一轮？')}
      confirmLabel={t('确认开始下一轮')} disabled={view.busy || view.invalid} onConfirm={action(async () => { await session.beginNext(); setOpened(undefined); })} />}
    {!!view.error && <Alert type="warning" title={t('当前规则入口不可用，请核对原结果或当前权限。')} />}
  </section>;
}
