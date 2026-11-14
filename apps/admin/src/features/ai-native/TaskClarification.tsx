/** Human answers to the original persisted question. Workbench values remain
 * candidates until fixed host review; the full question is read again before
 * submission. Unknown locks resubmission and storage retains references only. */
import { useEffect, useId, useRef, useState } from 'react';
import { AI_TASK_INPUT_DRAFT_VERSION, isAiTaskInputContractDraft, isAiTaskInputSubmissionDraft,
  validateAiTaskInputAnswersDraft, type AiTaskClarificationObservationDraft,
  type AiTaskClarificationProgressDraft, type AiTaskInputSubmissionDraft, type AiTaskClarificationReceiptQueryDraft } from '@rental-os/shared';
import { aiTaskCenterApi } from '@/api/aiTaskCenter';
import { useAiManagementLocale as useLocale } from './management-locale';
import { ActionButton, Alert, ConfirmAction, Input, Select } from '@/components/ui';
import { safeDisplayText } from './safe-display';
import { useVisibleObservationHost } from './VisibleObservationHost';
import { formatTimestamp } from './formatters';
import { displaySame } from './workbench-display-host';
import { inspectWorkbenchInputCandidate, preserveWorkbenchQuestionDraft,
  type WorkbenchInputCandidateReview } from './workbench-input-review-session';

type Question = NonNullable<AiTaskClarificationObservationDraft['input']>;
type ReceiptReference = AiTaskClarificationReceiptQueryDraft['reference'];
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(value);
function savedReference(key: string, taskId: string): ReceiptReference | 'invalid' | null {
  try {
    const raw = sessionStorage.getItem(key); if (raw === null) return null;
    if (!raw || raw.length > 512) return 'invalid';
    const value = JSON.parse(raw);
    return value && Object.keys(value).length === 3 && id(value.requestId) && Number.isInteger(value.expectedRevision)
      && value.expectedRevision >= 1 && value.expectedRevision <= 4294967294 && typeof value.submissionKey === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value.submissionKey) ? { taskId, ...value } : 'invalid';
  } catch { return 'invalid'; }
}
export function prepareTaskClarificationAnswer(taskId: string, input: Question, draft: Record<string, string>, submissionKey: string): AiTaskInputSubmissionDraft {
  if (!id(taskId) || !isAiTaskInputContractDraft(input.contract) || !Number.isFinite(Date.parse(input.expiresAt))
    || Date.parse(input.expiresAt) <= Date.now()) throw Error('AI_INVALID_INPUT');
  const answers = input.contract.fields.flatMap(field => {
    const value = draft[field.fieldId];
    if (value === undefined || value === '') return [];
    return [{ fieldId: field.fieldId, value: field.kind === 'integer' && /^[1-9][0-9]*$/u.test(value) ? Number(value) : value }];
  });
  const submission = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId, requestId: input.requestId,
    expectedRevision: input.revision, submissionKey, answers };
  if (!isAiTaskInputSubmissionDraft(submission) || !validateAiTaskInputAnswersDraft(input.contract, answers)) throw Error('AI_INVALID_INPUT');
  return structuredClone(submission);
}
function question(value: AiTaskClarificationObservationDraft, taskId: string): Question | null {
  if (value?.taskId !== taskId || value.execution !== 'read_only_no_start_no_reconnect_side_effect') throw Error('AI_RESOURCE_UNAVAILABLE');
  if (value.input === null) return null;
  const input = value.input;
  if (!input || !id(input.requestId) || !Number.isInteger(input.revision) || input.revision < 1 || input.revision > 4294967294
    || !Number.isFinite(Date.parse(input.expiresAt)) || !isAiTaskInputContractDraft(input.contract)) throw Error('AI_RESOURCE_UNAVAILABLE');
  return structuredClone(input);
}
export function validateTaskClarificationProgress(value: AiTaskClarificationProgressDraft, original: Pick<AiTaskInputSubmissionDraft, 'taskId' | 'requestId'>) {
  if (value?.taskId !== original.taskId || value.requestId !== original.requestId || value.automaticRetry !== false
    || value.businessExecution !== 'not_inferred_from_input' || !value.receipt || !value.continuation) throw Error('AI_RESULT_UNKNOWN');
  const receipt = value.receipt;
  if (receipt.state !== 'not_observed' && (receipt.state !== 'observed' || !id(receipt.receiptId)
    || !Number.isInteger(receipt.taskRevision) || receipt.taskRevision < 1 || receipt.taskRevision > 4294967294
    || receipt.runId !== null && !id(receipt.runId) || receipt.replayed !== null && typeof receipt.replayed !== 'boolean')) throw Error('AI_RESULT_UNKNOWN');
  const next = value.continuation;
  if (!['not_attempted', 'not_started', 'unavailable', 'run_outcome'].includes(next.kind)
    || next.kind === 'run_outcome' && !['succeeded', 'partially_succeeded', 'paused', 'cancel_requested', 'cancelled', 'unknown', 'unavailable', 'failed'].includes(next.status))
    throw Error('AI_RESULT_UNKNOWN');
  return structuredClone(value);
}
export function TaskClarification({ taskId, identity, current, onAccessDenied, onReceiptChange, candidateReview, onCandidateReviewed }: {
  taskId: string; identity: string; current: () => boolean; onAccessDenied: () => void;
  onReceiptChange?: (value: { reference: ReceiptReference; receiptId: string } | null) => void;
  candidateReview?: WorkbenchInputCandidateReview | null;
  onCandidateReviewed?: (status: 'adopted' | 'conflict') => void;
}) {
  const visible = useVisibleObservationHost();
  const { t } = useLocale(), label = useId(), key = `ai-task-input:${identity}:${taskId}`;
  const [input, setInput] = useState<Question | null>(null), [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [draftConflict, setDraftConflict] = useState(false);
  const [candidateConflict, setCandidateConflict] = useState<'fields' | 'values' | null>(null);
  const [original, setOriginal] = useState<AiTaskInputSubmissionDraft | null>(null);
  const [saved, setSaved] = useState(() => savedReference(key, taskId));
  const [locked, setLocked] = useState(() => { try { return sessionStorage.getItem(key) !== null; } catch { return true; } });
  const [receipt, setReceipt] = useState<AiTaskClarificationProgressDraft | null>(null);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const flight = useRef<AbortController | null>(null), mounted = useRef(true), owner = useRef({ taskId, identity });
  const draftBasis = useRef<Question | null>(null);
  const active = useRef({ taskId, identity, current, onAccessDenied, onReceiptChange, candidateReview, onCandidateReviewed });
  active.current = { taskId, identity, current, onAccessDenied, onReceiptChange, candidateReview, onCandidateReviewed };
  useEffect(() => {
    owner.current = { taskId, identity }; mounted.current = true;
    draftBasis.current = null;
    setInput(null); setLoaded(false); setDraft({}); setDraftConflict(false); setCandidateConflict(null);
    setOriginal(null); setReceipt(null); setError(false); setBusy(false); setSaved(savedReference(key, taskId));
    try { setLocked(sessionStorage.getItem(key) !== null); } catch { setLocked(true); }
    const hidden = () => {
      if (!document.hidden) return;
      flight.current?.abort(); flight.current = null; setInput(null); setLoaded(false); setBusy(false);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; flight.current?.abort(); flight.current = null; draftBasis.current = null;
      document.removeEventListener('visibilitychange', hidden); };
  }, [taskId, identity, key]);
  const same = (signal?: AbortSignal) => mounted.current && active.current.taskId === taskId && active.current.identity === identity
    && owner.current.taskId === taskId && owner.current.identity === identity && !document.hidden && active.current.current() && !signal?.aborted;
  const retainQuestion = (value: Question | null, offered: Parameters<typeof preserveWorkbenchQuestionDraft>[2] = []) => {
    // Absence of a successor question is not a replacement field contract.
    // Keep still-legal local input under its previous basis, with no submission
    // surface, until an actual new question can independently validate it.
    const previousBasis = input ?? draftBasis.current;
    const kept = preserveWorkbenchQuestionDraft(value ?? previousBasis, draft, offered);
    if (value) draftBasis.current = value;
    setDraft(kept.draft); setInput(value); setLoaded(true);
    setDraftConflict(kept.rejected.length > 0 || !!previousBasis && !displaySame(previousBasis, value));
    return kept;
  };
  const run = async (operation: 'read' | 'candidate' | 'submit' | 'receipt' | 'continue') => {
    if (flight.current || !same()) throw Error('AI_SCOPE_CHANGED');
    const controller = new AbortController(); flight.current = controller; setBusy(true); setError(false);
    active.current.onReceiptChange?.(null);
    let dispatched = false, visibleKey: string | null = null;
    try {
      if (operation === 'read' || operation === 'candidate') {
        setLoaded(false);
        const value = question(await aiTaskCenterApi.input(taskId, controller.signal), taskId);
        if (!same(controller.signal)) return;
        // A new persisted request can be answered. Missing/consumed questions
        // never clear an uncertain submission or grant retry of its old key.
        const stored = savedReference(key, taskId);
        // A damaged locator or an unobserved old submission stays closed even
        // when another question appears. Observe the original receipt first.
        if (stored === 'invalid') { setSaved('invalid'); setLocked(true); }
        else if (!stored) { setLocked(false); }
        else if (value && stored.requestId !== value.requestId && receipt?.receipt.state === 'observed'
          && !(receipt.continuation.kind === 'run_outcome' && receipt.continuation.status === 'unknown')) {
          sessionStorage.removeItem(key); setOriginal(null); setSaved(null); setReceipt(null); setLocked(false);
        }
        if (operation === 'candidate') {
          const review = active.current.candidateReview;
          if (locked || stored || !review || review.candidate.binding.taskId !== taskId) throw Error('AI_RESULT_UNKNOWN');
          const currentReview = inspectWorkbenchInputCandidate(review.candidate, review.fieldMaterial, value);
          if (currentReview.status !== 'ready' || !displaySame(review.question, value)) {
            retainQuestion(value); setCandidateConflict('fields'); active.current.onCandidateReviewed?.('conflict');
            throw Error('AI_REVISION_CONFLICT');
          }
          const kept = retainQuestion(value, currentReview.candidate.answers);
          const conflict = kept.conflicts.length > 0 || kept.rejected.length > 0;
          setCandidateConflict(kept.conflicts.length ? 'values' : kept.rejected.length ? 'fields' : null);
          active.current.onCandidateReviewed?.(conflict ? 'conflict' : 'adopted');
          // Adoption only fills the original form. The separate fixed
          // confirmation below still owns the explicit human answer.
        } else { retainQuestion(value); setCandidateConflict(null); }
        return;
      }
      let submission = original;
      if (operation === 'submit') {
        if (locked || !input || sessionStorage.getItem(key)) throw Error('AI_RESULT_UNKNOWN');
        const latest = question(await aiTaskCenterApi.input(taskId, controller.signal), taskId);
        if (!same(controller.signal)) return;
        if (!latest || !displaySame(input, latest)) { retainQuestion(latest); throw Error('AI_REVISION_CONFLICT'); }
        submission = prepareTaskClarificationAnswer(taskId, latest, draft, crypto.randomUUID());
        if (!same(controller.signal) || sessionStorage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN');
        const marker = JSON.stringify({ requestId: submission.requestId, expectedRevision: submission.expectedRevision, submissionKey: submission.submissionKey });
        sessionStorage.setItem(key, marker);
        if (sessionStorage.getItem(key) !== marker) throw Error('AI_RESOURCE_UNAVAILABLE');
        setOriginal(submission); setSaved({ taskId, requestId: submission.requestId, expectedRevision: submission.expectedRevision,
          submissionKey: submission.submissionKey }); setLocked(true); setDraft({}); setInput(null);
      }
      const reference = submission ?? (saved !== 'invalid' ? saved : null);
      if (!reference || operation === 'submit' && !submission) throw Error('AI_RESOURCE_UNAVAILABLE');
      if (operation === 'submit' && submission) visibleKey = visible?.begin({ taskId, trigger: 'original_input_resume', originKey: submission.requestId }) ?? null;
      dispatched = true;
      const result = validateTaskClarificationProgress(await (operation === 'receipt'
        ? aiTaskCenterApi.inputReceipt(submission ? { submission: structuredClone(submission) } : { reference: structuredClone(reference) }, controller.signal)
        : operation === 'submit' ? aiTaskCenterApi.resumeInput({ submission: structuredClone(submission!) }, controller.signal)
          : aiTaskCenterApi.continueInput(submission ? { submission: structuredClone(submission) } : { reference: structuredClone(reference) }, controller.signal)), reference);
      if (same(controller.signal) && result.receipt.state === 'observed' && result.receipt.runId
        && result.continuation.kind === 'run_outcome' && ['succeeded', 'partially_succeeded', 'paused'].includes(result.continuation.status))
        visible?.bindRun(visibleKey, result.receipt.runId);
      else visible?.cancel(visibleKey);
      if (same(controller.signal)) {
        setReceipt(result);
        if (result.receipt.state === 'observed' && result.receipt.runId) active.current.onReceiptChange?.({
          reference: { taskId, requestId: reference.requestId, expectedRevision: reference.expectedRevision, submissionKey: reference.submissionKey },
          receiptId: result.receipt.receiptId,
        });
      }
      if (operation === 'submit' && result.receipt.state !== 'observed') throw Error('AI_RESULT_UNKNOWN');
    } catch (failure) {
      visible?.cancel(visibleKey);
      if (same(controller.signal)) {
        setError(true); setReceipt(null);
        if (dispatched && operation === 'submit') { setInput(null); setDraft({}); }
        if ([401, 403].includes((failure as { response?: { status?: number } }).response?.status ?? 0)) {
          draftBasis.current = null; setInput(null); setDraft({}); setOriginal(null); active.current.onAccessDenied();
        }
      }
      throw failure;
    } finally { if (flight.current === controller) flight.current = null; if (same()) setBusy(false); }
  };
  if (!same()) return null;
  const expired = !!input && Date.parse(input.expiresAt) <= Date.now();
  return <section aria-label={t('原任务补充信息')} style={{ overflowWrap: 'anywhere' }}>
    <p className="muted" id={`${label}-help`}>{t('提交回答会尝试继续原任务，可能产生模型用量。')}</p>
    <div className="panel-toolbar">
      <ActionButton label={t('读取当前问题')} pendingLabel={t('读取中…')} disabled={busy} onAction={() => run('read')} />
      {candidateReview && candidateReview.candidate.binding.taskId === taskId && <ActionButton label={t('核对候选输入')}
        disabled={busy || locked || candidateReview.status !== 'ready' || Date.parse(candidateReview.expiresAt) <= Date.now()}
        onAction={() => run('candidate')} />}
      {(original || saved && saved !== 'invalid') && <ActionButton label={t('核对原回答收据')} pendingLabel={t('核对中…')} disabled={busy} onAction={() => run('receipt')} />}
      {(original || saved && saved !== 'invalid') && receipt?.receipt.state === 'observed'
        && !(receipt.continuation.kind === 'not_started' && receipt.continuation.reason === 'quote_parameters_ready') && <ConfirmAction label={t('明确继续原任务')}
        prompt={t('按这份已保存的回答继续？仍须当前权限、原计划和累计限额；不会自动批准业务。')}
        doneLabel={t('已获得继续结果')} disabled={busy} onConfirm={() => run('continue')} />}
    </div>
    {(candidateConflict === 'fields' || candidateReview?.status === 'conflict') && <Alert type="warning"
      title={t('候选与当前问题的字段或版本不符；已保留原输入，请按原问题核对。')} />}
    {candidateConflict === 'values' && <Alert type="warning" title={t('候选与已填写内容不同；已保留原输入，请逐项核对。')} />}
    {draftConflict && <Alert type="warning" title={t('当前问题已变化，合法输入已保留；请核对字段和候选后再明确提交。')} />}
    {loaded && !input && !locked && <p role="status">{t('当前没有待补充问题；没有记录不代表业务已完成。')}</p>}
    {input && <fieldset disabled={busy || locked || expired} aria-busy={busy} aria-describedby={`${label}-help${error ? ` ${label}-error` : ''}`}>
      <legend>{t('请明确补充')}</legend>
      <p>{t('问题有效期')}: {formatTimestamp(input.expiresAt).value}</p>
      {input.contract.fields.map(field => <div key={field.fieldId}>
        <label htmlFor={`${label}-${field.fieldId}`}>{safeDisplayText(field.label, 160)}{field.required ? t('（必填）') : ''}</label>
        {field.kind === 'choice' ? <Select id={`${label}-${field.fieldId}`} aria-label={safeDisplayText(field.label, 160)}
          disabled={busy || locked || expired} value={draft[field.fieldId] ?? undefined}
          options={field.options.map(option => ({ value: option.value, label: safeDisplayText(option.label, 160) }))}
          onChange={value => setDraft(old => ({ ...old, [field.fieldId]: String(value ?? '') }))} />
          : <Input id={`${label}-${field.fieldId}`} value={draft[field.fieldId] ?? ''} type="text"
            inputMode={field.kind === 'integer' ? 'numeric' : 'text'} maxLength={field.kind === 'text' ? field.maxLength : 7}
            aria-describedby={`${label}-${field.fieldId}-hint`} disabled={busy || locked || expired}
            onChange={event => { const value = event.currentTarget.value; setDraft(old => ({ ...old, [field.fieldId]: value })); }} />}
        {field.kind !== 'choice' && <p id={`${label}-${field.fieldId}-hint`} className="muted">{t(field.kind === 'integer'
          ? `整数范围：${field.minimum}–${field.maximum}` : field.fieldId === 'starts_at' || field.fieldId === 'ends_at'
            ? '输入明确UTC时间，例如2026-10-22T09:00:00.000Z；不自动猜测时区。' : `最多${field.maxLength}字符`)}</p>}
      </div>)}
      <ConfirmAction label={t('提交回答并继续')} prompt={t('确认以上为你的明确回答，并尝试继续原任务？不会自动批准业务操作。')}
        doneLabel={t('原回答已记录')} disabled={busy || locked || expired} onConfirm={() => run('submit')} />
    </fieldset>}
    {expired && <Alert type="warning" title={t('问题已过期，请重新读取；不能沿用旧问题提交。')} />}
    {locked && !original && <Alert type="warning" title={t(saved === 'invalid'
      ? '原回答引用不可读取，已禁止重新提交；请通过原任务和人工流程核对。'
      : '已恢复原回答操作引用。先核对收据，再明确选择是否继续；回答内容未保存在浏览器，不会重发或自动继续。')} />}
    {error && <p id={`${label}-error`} role="alert">{t('本次未获得可靠结果。请核对必填项、数值范围、明确UTC时间、权限或原回答收据；不会自动重发。')}</p>}
    {receipt && <p role="status" aria-live="polite">{t(receipt.receipt.state !== 'observed'
      ? '尚未观察到原回答收据，不代表未提交；请勿另建操作重发。'
      : receipt.continuation.kind === 'run_outcome' && receipt.continuation.status === 'unknown'
        ? '原回答已记录，继续结果仍待核对；不代表业务成功。'
        : receipt.continuation.kind === 'not_started' && receipt.continuation.reason === 'quote_parameters_ready'
          ? '报价参数已齐备，请核对原参数并明确生成报价；尚未批准或创建订单。'
          : '原回答已记录；请读取当前问题或任务状态。回答不等于业务批准或执行成功。')}</p>}
  </section>;
}
