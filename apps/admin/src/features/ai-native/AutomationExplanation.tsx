/** Explicit explanation of one reviewed original event. The journal stores
 * only its inputRef before startup; a reopened/unknown attempt reads that
 * original result and never creates another Task or business operation. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiAutomationExplanationObservationDraft, AiAutomationExplanationPreparationDraft } from '@rental-os/shared';
import { aiAutomationExplanationsApi } from '@/api/aiAutomationExplanations';
import { ActionButton, Alert, ConfirmAction, Button } from '@/components/ui';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { safeDisplayText } from './safe-display';
import { formatTimestamp } from './formatters';
import { useAiManagementLocale } from './management-locale';
import styles from './AiManagement.module.css';

export function AutomationExplanation({ inputRef, eventId, identity, current, close }: {
  inputRef: string; eventId: string; identity: string; current(): boolean; close(): void;
}) {
  const auth = useAuthStore(), { t } = useAiManagementLocale(), epoch = currentSessionEpoch();
  const binding = JSON.stringify([identity, auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, inputRef, eventId, epoch]);
  const owner = useRef({ binding, current }); owner.current = { binding, current };
  const storageKey = `rental-os-automation-explanation:${JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, inputRef])}`;
  const [result, setResult] = useState<AiAutomationExplanationObservationDraft | null>(null);
  const [preparation, setPreparation] = useState<AiAutomationExplanationPreparationDraft | null>(null);
  const [displayBinding, setDisplayBinding] = useState(binding);
  const [attempted, setAttempted] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const control = useMemo(() => ({ abort: new AbortController(), generation: 0, pending: false, attempted: false, ready: false }), [binding]);
  const live = () => owner.current.binding === binding && epoch === currentSessionEpoch()
    && !control.abort.signal.aborted && !document.hidden && owner.current.current();
  useEffect(() => {
    control.abort = new AbortController();
    control.generation++;
    control.pending = false; control.attempted = false;
    setDisplayBinding(binding); setResult(null); setPreparation(null); setAttempted(false); setError(''); setBusy(false);
    const hidden = () => { if (!document.hidden) return;
      control.generation++; control.abort.abort(); setResult(null); setPreparation(null); close(); };
    try {
      const text = window.localStorage.getItem(storageKey);
      if (text) {
        const saved = JSON.parse(text);
        if (Object.keys(saved).length !== 2 || saved.version !== 'automation-explanation-attempt-1' || saved.inputRef !== inputRef) throw Error();
        control.attempted = true;
        setAttempted(true);
      }
    } catch { control.attempted = true; setAttempted(true); setError(t('原操作定位不可读取，请核对原结果。')); }
    control.ready = true;
    document.addEventListener('visibilitychange', hidden);
    return () => { control.ready = false; control.generation++; control.abort.abort(); document.removeEventListener('visibilitychange', hidden); };
  }, [binding]);
  const checked = (value: AiAutomationExplanationObservationDraft) => {
    if (value.original.inputRef !== inputRef || value.source.event.eventId !== eventId
      || value.source.event.scope.kind !== 'workspace' || value.source.event.scope.tenantId !== auth.tenant?.tenantId
      || value.source.event.scope.workspaceId !== auth.currentWorkspaceId) throw Error('AI_SCOPE_CHANGED');
    return value;
  };
  const run = async (work: (current: () => boolean, signal: AbortSignal) => Promise<void>) => {
    if (!live() || !control.ready || control.pending) throw Error('AI_ACTION_UNAVAILABLE');
    control.pending = true;
    const generation = ++control.generation, abort = control.abort;
    const current = () => live() && generation === control.generation && abort === control.abort;
    setBusy(true); setError('');
    try { await work(current, abort.signal); } catch (error) { if (current()) { setResult(null); setPreparation(null); setError(t('原解释结果暂不可核对，请读取原结果；不要重新发起。')); } throw error; }
    finally { if (abort === control.abort) control.pending = false; if (current()) setBusy(false); }
  };
  const read = () => run(async (current, signal) => {
    const value = await aiAutomationExplanationsApi.read({ inputRef }, signal);
    if (!current()) return;
    const observed = checked(value);
    setResult(observed); setPreparation(null);
  });
  const prepare = () => run(async (current, signal) => {
    const value = await aiAutomationExplanationsApi.read({ inputRef }, signal);
    if (!current()) return;
    const observed = checked(value);
    setResult(observed); setPreparation(null);
    if (control.attempted || observed.state !== 'not_started') return;
    const prepared = await aiAutomationExplanationsApi.prepare({ inputRef }, signal);
    if (!current()) return;
    if (prepared.original.inputRef !== inputRef || prepared.original.taskId !== observed.original.taskId
      || prepared.original.runId !== observed.original.runId || prepared.event.eventId !== eventId
      || prepared.event.scope.kind !== 'workspace' || prepared.event.scope.tenantId !== auth.tenant?.tenantId
      || prepared.event.scope.workspaceId !== auth.currentWorkspaceId) throw Error('AI_SCOPE_CHANGED');
    setPreparation(prepared);
  });
  const start = () => run(async (current, signal) => {
    if (!preparation || control.attempted) throw Error('AI_ACTION_UNAVAILABLE');
    const original = preparation;
    const latest = await aiAutomationExplanationsApi.prepare({ inputRef }, signal);
    if (!current()) throw Error('AI_SCOPE_CHANGED');
    if (JSON.stringify(latest) !== JSON.stringify(original)) { setPreparation(null); throw Error('AI_SOURCE_CHANGED'); }
    const journal = JSON.stringify({ version: 'automation-explanation-attempt-1', inputRef });
    const prior = window.localStorage.getItem(storageKey);
    if (prior !== null) { control.attempted = true; setAttempted(true); throw Error('AI_OPERATION_ALREADY_STARTED'); }
    window.localStorage.setItem(storageKey, journal);
    control.attempted = true; setAttempted(true);
    if (window.localStorage.getItem(storageKey) !== journal || !current()) throw Error('AI_OPERATION_LOCATOR_DAMAGED');
    setPreparation(null); setResult(null);
    const value = await aiAutomationExplanationsApi.start({ inputRef, decision: 'start_original_automation_explanation',
      preparation: original }, signal);
    if (current()) setResult(checked(value));
  });
  if (displayBinding !== binding || !live()) return null;
  return <section className={styles.section} aria-label={t('原经营事件解释')}>
    <div className={styles.toolbar}>
      <h3>{t('原经营事件解释')}</h3>
      <ActionButton intent="forward" label={t('读取原结果')} successLabel={t('原结果已读取')} onAction={read} disabled={busy} />
      <ActionButton intent="forward" label={t('准备解释')} successLabel={t('已核对原事件')} onAction={prepare} disabled={busy || attempted} />
      <Button onClick={close}>{t('关闭')}</Button>
    </div>
    {error && <Alert type="warning" title={error} />}
    {attempted && <p className={styles.help}>{t('已发起的原操作只读取结果；未知不表示可以重发。')}</p>}
    {preparation && <>
      <dl className={styles.facts}>
        <div><dt>{t('原事件')}</dt><dd>{safeDisplayText(preparation.event.type)} · {safeDisplayText(preparation.event.eventId)}</dd></div>
        <div><dt>{t('来源修订')}</dt><dd>{preparation.event.resource.version}</dd></div>
        <div><dt>{t('处理模式')}</dt><dd>{safeDisplayText(preparation.inputMode)}</dd></div>
        <div><dt>{t('有效期')}</dt><dd>{formatTimestamp(preparation.expiresAt).value}</dd></div>
      </dl>
      <p className={styles.help}>{t('解释会计入原任务和模型用量，不会批准或执行业务。')}</p>
      <ConfirmAction label={t('确认解释')} prompt={t('基于已核对的原事件调用一次模型；继续使用原任务和预算。')}
        doneLabel={t('原结果已读取')} onConfirm={start} disabled={busy || attempted} />
    </>}
    {result && <>
      <p role="status">{result.state === 'completed' ? t('解释已生成，仍需人工核实。')
        : result.state === 'failed' ? t('原解释失败，请沿人工流程处理。')
          : result.state === 'unknown' ? t('原解释待核对，不自动重发。') : t('尚未发起原解释。')}</p>
      {result.state === 'completed' && <p>{safeDisplayText(result.result.text, 131072)}</p>}
    </>}
  </section>;
}
