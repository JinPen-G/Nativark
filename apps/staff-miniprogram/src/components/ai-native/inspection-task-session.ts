/** One current staff inspection draft -> original frozen input -> original
 * Task/answer/result locators. Reads do not execute or submit an inspection;
 * uncertain writes retain their original selectors and are never repeated. */
import type { AiInspectionDraftReadRequest, AiInspectionRecognitionRequest, AiInspectionRecognitionTaskReference,
  AiInspectionRecognitionTaskResumeRequest, AiInspectionTaskCreationResponse, AiInspectionTaskPendingInputResponse,
  AiInspectionResultReadRequest, AiInspectionTaskAnswerObservation, AiTaskInputFieldDraft } from '@rental-os/shared';
import type { StaffInspectionTaskApi } from '../../api/ai-inspection-tasks';
import { validateInspectionWire, validateInspectionTaskWire } from './inspection-wire';
import { readInspectionHumanHandoff } from './inspection-human-form';

export interface StaffInspectionTaskContext {
  tenantId: string; workspaceId: string; ownerId: string; source: AiInspectionDraftReadRequest; current(): boolean;
}
type Phase = 'input_pending' | 'input_prepared' | 'task_pending' | 'task_created' | 'model_pending' | 'model_active' | 'answer_pending' | 'continue_pending' | 'complete';
interface Locator {
  version: 'staff-inspection-task-1'; owner: string; source: AiInspectionDraftReadRequest;
  input: AiInspectionRecognitionRequest | null; reference: AiInspectionRecognitionTaskReference | null;
  submission: AiInspectionRecognitionTaskResumeRequest | null; phase: Phase; modelAttempted: boolean; continueAttempted: boolean;
}
export interface StaffInspectionTaskView {
  status: 'closed' | 'working' | 'ready' | 'running' | 'waiting_input' | 'answer_saved' | 'result_reference' | 'ended' | 'unknown' | 'unavailable';
  task: AiInspectionTaskCreationResponse['task'] | null; question: AiInspectionTaskPendingInputResponse;
  result: AiInspectionResultReadRequest | null; canBegin: boolean; canStart: boolean; canRead: boolean; canSubmit: boolean; canContinue: boolean;
}
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const phases: Phase[] = ['input_pending','input_prepared','task_pending','task_created','model_pending','model_active','answer_pending','continue_pending','complete'];
const empty = (): StaffInspectionTaskView => ({ status: 'closed', task: null, question: null, result: null,
  canBegin: false, canStart: false, canRead: false, canSubmit: false, canContinue: false });
export function staffInspectionTaskStorageKey(context: Omit<StaffInspectionTaskContext, 'current'>): string {
  return `rental-os-staff:ai-inspection-task:${encodeURIComponent(JSON.stringify([context.tenantId,context.workspaceId,context.ownerId,
    context.source.orderId,context.source.allocationId,context.source.templateId,context.source.stage,context.source.draftId]))}`;
}
function parseLocator(value: unknown, owner: string, source: AiInspectionDraftReadRequest): Locator {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('staff_inspection_locator_unavailable');
  const row = value as Record<string, unknown>, keys = ['version','owner','source','input','reference','submission','phase','modelAttempted','continueAttempted'];
  if (Object.keys(row).length !== (row.continueAttempted === undefined ? keys.length - 1 : keys.length)
    || Object.keys(row).some(key => !keys.includes(key))
    || row.version !== 'staff-inspection-task-1' || row.owner !== owner || !same(row.source,source)
    || !phases.includes(row.phase as Phase) || typeof row.modelAttempted !== 'boolean'
    || row.continueAttempted !== undefined && typeof row.continueAttempted !== 'boolean'
    || row.input !== null && !validateInspectionWire('input-prepare','request',row.input)
    || row.reference !== null && !validateInspectionTaskWire('readCreation','request',row.reference)
    || row.submission !== null && !validateInspectionTaskWire('readAnswer','request',row.submission)) throw Error('staff_inspection_locator_unavailable');
  // Older locators still identify the original operation. The new flag records
  // only this explicit continuation attempt; current server receipts gate it.
  const parsed = { continueAttempted: false, ...clone(row) } as unknown as Locator;
  if (parsed.input && Object.entries(source).some(([key, expected]) => parsed.input?.[key as keyof AiInspectionRecognitionRequest] !== expected)
    || parsed.reference && Object.entries(source).some(([key, expected]) => parsed.reference?.[key as keyof AiInspectionRecognitionTaskReference] !== expected)
    || parsed.submission && !same(parsed.submission.reference,parsed.reference)
    || parsed.phase === 'input_pending' && (!parsed.input || parsed.reference)
    || parsed.phase !== 'input_pending' && !parsed.reference
    || ['answer_pending','continue_pending'].includes(parsed.phase) && !parsed.submission
    || ['model_pending','answer_pending','continue_pending'].includes(parsed.phase) && !parsed.modelAttempted
    || parsed.phase === 'continue_pending' && !parsed.continueAttempted) throw Error('staff_inspection_locator_unavailable');
  return parsed;
}
function answer(field: AiTaskInputFieldDraft, value: unknown): string | number {
  if (field.kind === 'integer') {
    const number = typeof value === 'number' ? value : typeof value === 'string' && /^-?[0-9]+$/u.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(number) || number < field.minimum || number > field.maximum) throw Error('staff_inspection_answer_invalid');
    return number;
  }
  if (typeof value !== 'string' || field.required && !value.trim()) throw Error('staff_inspection_answer_invalid');
  if (field.kind === 'text' && value.length > field.maxLength || field.kind === 'choice' && !field.options.some(option => option.value === value))
    throw Error('staff_inspection_answer_invalid');
  return value;
}
export function createStaffInspectionTaskSession(input: {
  context: StaffInspectionTaskContext; api: StaffInspectionTaskApi; now(): number; newKey(): string;
  storage: { read(): unknown; write(value: unknown): void }; changed(view: StaffInspectionTaskView): void;
}) {
  const owner = staffInspectionTaskStorageKey(input.context), source = clone(input.context.source);
  if (!validateInspectionWire('draft-read','request',source)) throw Error('staff_inspection_source_unavailable');
  let closed = false, busy = false, invalid = false, opened = false, held: unknown, saved: Locator | null = null;
  let task: StaffInspectionTaskView['task'] = null, question: StaffInspectionTaskView['question'] = null;
  let result: StaffInspectionTaskView['result'] = null, originalTaskId: string | null = null, view = empty();
  let resultState: 'observed' | 'not_observed' | null = null;
  let answerReceipt: Extract<AiInspectionTaskAnswerObservation, { state: 'observed' }> | null = null;
  let creationState: 'unseen' | 'observed' | 'not_observed' | 'unknown' = 'unseen';
  const current = () => !closed && input.context.current();
  const canContinueOriginal = () => Boolean(saved?.submission && !saved.continueAttempted && task?.status === 'running'
    && resultState === 'not_observed' && answerReceipt && answerReceipt.taskId === originalTaskId
    && answerReceipt.requestId === saved.submission.submission.requestId);
  const emit = (status: StaffInspectionTaskView['status']) => {
    if (!current()) return;
    view = { status, task, question, result,
      canBegin: !busy && !invalid && (!saved || saved.phase === 'input_prepared' && creationState === 'not_observed'),
      canRead: !busy && !invalid && Boolean(saved),
      canStart: !busy && !invalid && saved?.phase === 'task_created' && !saved.modelAttempted && task?.status === 'queued',
      canContinue: !busy && !invalid && canContinueOriginal(),
      canSubmit: !busy && !invalid && task?.status === 'waiting_input' && Boolean(saved?.reference && question
        && Date.parse(question.expiresAt) > input.now() && (!saved.submission || saved.submission.submission.requestId !== question.requestId)) };
    input.changed(clone(view));
  };
  const load = () => {
    if (opened) return;
    const raw = input.storage.read(); held = raw === undefined || raw === null ? undefined : clone(raw);
    if (held !== undefined) { try { saved = parseLocator(held,owner,source); } catch { invalid = true; throw Error('staff_inspection_locator_unavailable'); } }
    opened = true;
  };
  const persist = (value: Locator) => {
    if (!current() || !same(input.storage.read(),held)) { invalid = true; throw Error('staff_inspection_original_replaced'); }
    const checked = parseLocator(value,owner,source);
    input.storage.write(clone(checked));
    if (!same(input.storage.read(),checked)) { invalid = true; throw Error('staff_inspection_locator_not_retained'); }
    held = clone(checked); saved = checked;
  };
  const acceptTask = (value: NonNullable<StaffInspectionTaskView['task']>) => {
    if (!current() || originalTaskId && value.taskId !== originalTaskId) throw Error('staff_inspection_task_changed');
    originalTaskId = value.taskId; task = clone(value); return task;
  };
  const acceptInput = (inputId: string, revision: number) => {
    const reference: AiInspectionRecognitionTaskReference = { ...source, inputId, expectedRevision: revision };
    if (!validateInspectionTaskWire('readCreation','request',reference)) throw Error('staff_inspection_input_changed');
    persist({ ...saved!, reference, input: null, phase: 'input_prepared' });
  };
  const readOriginal = async (): Promise<StaffInspectionTaskView['status']> => {
    task = null; question = null; result = null; resultState = null; answerReceipt = null;
    if (!saved) return 'ready';
    if (!saved.reference && saved.input) {
      const receipt = await input.api.readInputPreparation(clone(saved.input));
      if (!current() || receipt.status !== 'found' || receipt.result.draftId !== source.draftId) return 'unknown';
      acceptInput(receipt.inputId,receipt.result.revision);
    }
    if (!saved.reference) return 'unknown';
    const created = await input.api.readCreation(clone(saved.reference));
    creationState = created.state;
    if (!current() || created.state !== 'observed') return 'unknown';
    task = acceptTask(created.task);
    if (saved.phase === 'task_pending') persist({ ...saved, phase: 'task_created' });
    const lookup = await input.api.readResultReference(clone(saved.reference));
    resultState = lookup.state;
    if (!current() || lookup.task && lookup.task.taskId !== originalTaskId) throw Error('staff_inspection_result_changed');
    if (lookup.task) task = acceptTask(lookup.task);
    if (lookup.state === 'observed') {
      if (lookup.reference.taskId !== originalTaskId || Object.entries(saved.reference)
        .some(([key, expected]) => lookup.reference[key as keyof AiInspectionResultReadRequest] !== expected)) throw Error('staff_inspection_result_changed');
      result = clone(lookup.reference);
    }
    if (task?.status === 'waiting_input') {
      question = await input.api.readInput(clone(saved.reference));
      if (!current()) throw Error('staff_inspection_question_changed');
      if (question) result = null;
    }
    if (task && ['succeeded','partially_succeeded','failed','cancelled'].includes(task.status)) {
      // An original terminal Task cannot continue this answer. Keep its exact
      // locator, while dropping local input/answer bodies no longer needed.
      persist({ ...saved, input: null, submission: null, phase: 'complete' });
      return result ? 'result_reference' : 'ended';
    }
    if (saved.submission) {
      const receipt = await input.api.readAnswer(clone(saved.submission));
      if (!current()) throw Error('staff_inspection_context_changed');
      if (receipt.state === 'observed') {
        if (receipt.taskId !== originalTaskId || receipt.requestId !== saved.submission.submission.requestId) throw Error('staff_inspection_answer_changed');
        answerReceipt = clone(receipt);
        if (question && question.requestId !== receipt.requestId) {
          persist({ ...saved, submission: null, continueAttempted: false, phase: 'model_active' }); answerReceipt = null;
        }
      }
    }
    if (result) {
      return 'result_reference';
    }
    if (question) return 'waiting_input';
    if (task?.status === 'waiting_external') return 'unknown';
    if (canContinueOriginal()) return 'answer_saved';
    if (saved.phase === 'model_pending' || saved.phase === 'answer_pending' || saved.phase === 'continue_pending') return 'unknown';
    return saved.phase === 'task_created' && task?.status === 'queued' ? 'ready' : 'running';
  };
  const run = async (work: () => Promise<StaffInspectionTaskView['status']>): Promise<void> => {
    if (!current() || busy || invalid) return;
    busy = true; emit('working'); let status: StaffInspectionTaskView['status'] = 'unavailable';
    try { load(); status = await work(); }
    catch { task = null; question = null; result = null;
      resultState = null; answerReceipt = null;
      status = saved && ['input_pending','task_pending','model_pending','answer_pending','continue_pending'].includes(saved.phase) ? 'unknown' : 'unavailable'; }
    finally { busy = false; emit(status); }
  };
  const session = {
    snapshot: () => clone(view),
    hasOriginal: () => current() && Boolean(saved),
    open: () => run(async () => saved ? 'unknown' : 'ready'),
    refresh: () => run(readOriginal),
    async readHumanValues() {
      if (!current() || busy || invalid) throw Error('staff_inspection_context_changed');
      const status = view.status;
      busy = true; emit('working');
      try {
        load();
        return await readInspectionHumanHandoff({ ...input.context, source: clone(source),
          current: () => current() && !invalid && same(input.storage.read(), held) }, input.api);
      } finally { busy = false; emit(status); }
    },
    async observe(): Promise<void> {
      if (!current() || invalid || !saved?.reference) return;
      const reference = clone(saved.reference);
      const receipt = await input.api.readCreation(reference);
      if (!current() || !same(reference,saved?.reference) || !same(input.storage.read(),held)) throw Error('staff_inspection_context_changed');
      if (receipt.state !== 'observed') throw Error('staff_inspection_task_unavailable');
      if (!busy && (!task || receipt.task.revision !== task.revision || receipt.task.status !== task.status
        || ['succeeded','partially_succeeded','failed','cancelled'].includes(receipt.task.status) && !result)) return session.refresh();
      acceptTask(receipt.task);
      // Polling while the original model POST waits reads metadata only. A
      // terminal result reference is also read-only and cannot change a key.
      if (['succeeded','partially_succeeded','failed','cancelled'].includes(receipt.task.status)) {
        const lookup = await input.api.readResultReference(reference);
        if (!current() || !same(reference,saved?.reference) || !same(input.storage.read(),held)
          || lookup.task?.taskId !== originalTaskId) throw Error('staff_inspection_result_changed');
        if (lookup.state === 'observed') {
          if (lookup.reference.taskId !== originalTaskId || Object.entries(reference)
            .some(([key, expected]) => lookup.reference[key as keyof AiInspectionResultReadRequest] !== expected)) throw Error('staff_inspection_result_changed');
          result = clone(lookup.reference);
        }
      }
      emit(busy ? 'working' : view.status);
    },
    async begin(inputId?: string) {
      return run(async () => {
        if (saved && saved.phase !== 'input_prepared') return readOriginal();
        if (!saved) {
        const draft = await input.api.readDraft(clone(source));
        if (!current() || draft.draftId !== source.draftId || (['orderId','allocationId','templateId','stage'] as const)
          .some(key => draft.target[key] !== source[key]) || !['draft_saved','prepared'].includes(draft.status)) throw Error('staff_inspection_draft_changed');
        const frozen = draft.state.recognitionInputs ?? [];
        if (inputId && !frozen.some(row => row.inputId === inputId) || !inputId && frozen.length > 1) throw Error('staff_inspection_input_selection_required');
        const selected = inputId ?? (frozen.length === 1 ? frozen[0].inputId : null);
        if (selected) {
          const reference = { ...source, inputId: selected, expectedRevision: draft.revision };
          persist({ version: 'staff-inspection-task-1', owner, source, input: null, reference, submission: null, phase: 'input_prepared', modelAttempted: false, continueAttempted: false });
        } else {
          if (!draft.state.evidence.length || draft.state.evidence.length > 8) throw Error('staff_inspection_evidence_unavailable');
          const command = { ...source, operationId: input.newKey(), expectedRevision: draft.revision,
            question: '识别当前检查证据中的原模板字段；缺项留空，候选由员工逐项核实。' };
          persist({ version: 'staff-inspection-task-1', owner, source, input: command, reference: null, submission: null, phase: 'input_pending', modelAttempted: false, continueAttempted: false });
          const prepared = await input.api.prepareInput(clone(command));
          if (!current() || prepared.draftId !== source.draftId || prepared.status !== 'draft_saved') throw Error('staff_inspection_input_changed');
          acceptInput(prepared.inputId,prepared.revision);
        }
        }
        const prior = await input.api.readCreation(clone(saved!.reference!));
        creationState = prior.state;
        if (!current()) throw Error('staff_inspection_context_changed');
        if (prior.state === 'observed') { acceptTask(prior.task); persist({ ...saved!, phase: 'task_created', modelAttempted: prior.task.status !== 'queued' }); return readOriginal(); }
        if (prior.state === 'unknown') return 'unknown';
        persist({ ...saved!, phase: 'task_pending' });
        const created = await input.api.create(clone(saved!.reference!));
        acceptTask(created.task); persist({ ...saved!, phase: 'task_created' }); return readOriginal();
      });
    },
    start: () => run(async () => {
      const status = await readOriginal();
      if (!saved?.reference || saved.modelAttempted || saved.phase !== 'task_created' || task?.status !== 'queued') return status;
      persist({ ...saved, phase: 'model_pending', modelAttempted: true }); emit('working');
      const response = await input.api.start(clone(saved.reference));
      if (!current()) throw Error('staff_inspection_context_changed');
      if (response.kind === 'not_started') return 'unavailable';
      persist({ ...saved, phase: 'model_active' }); return readOriginal();
    }),
    async submitAndContinue(values: Record<string, unknown>) {
      if (!view.canSubmit || !question || !saved?.reference) return;
      const original = clone(question);
      const taskId = originalTaskId;
      if (!taskId) return;
      return run(async () => {
        const pending = await input.api.readInput(clone(saved!.reference!));
        if (!current() || !pending || !same(pending,original) || Date.parse(original.expiresAt) <= input.now()) throw Error('staff_inspection_question_changed');
        const fields = original.contract.fields;
        if (!values || typeof values !== 'object' || Object.keys(values).some(key => !fields.some(field => field.fieldId === key))) throw Error('staff_inspection_answer_invalid');
        const submission: AiInspectionRecognitionTaskResumeRequest = { reference: clone(saved!.reference!), submission: {
          draftVersion: original.contract.draftVersion, taskId, requestId: original.requestId,
          expectedRevision: original.revision, submissionKey: input.newKey(),
          answers: fields.filter(field => field.required || values[field.fieldId] !== undefined && values[field.fieldId] !== '')
            .map(field => ({ fieldId: field.fieldId, value: answer(field,values[field.fieldId]) })) } };
        persist({ ...saved!, submission, phase: 'answer_pending', modelAttempted: true, continueAttempted: false });
        const response = await input.api.submitAndContinue(clone(submission));
        if (!current() || response.receipt.taskId !== taskId || response.receipt.requestId !== original.requestId) throw Error('staff_inspection_answer_changed');
        persist({ ...saved!, phase: 'model_active' }); return readOriginal();
      });
    },
    continueAnswer: () => run(async () => {
      const status = await readOriginal();
      if (!canContinueOriginal() || !saved?.submission || !answerReceipt) return status;
      const submission = clone(saved.submission), receipt = clone(answerReceipt);
      // Mark before POST. A lost reply cannot repeat resume or this explicit
      // continuation; the original runner owns lease/dispatch/unknown checks.
      persist({ ...saved, phase: 'continue_pending', continueAttempted: true }); emit('working');
      const response = await input.api.continueAnswer(submission);
      if (!current() || response.receipt.state !== 'observed' || response.receipt.taskId !== originalTaskId
        || response.receipt.requestId !== receipt.requestId || response.receipt.runId !== receipt.runId) throw Error('staff_inspection_answer_changed');
      persist({ ...saved!, phase: 'model_active' }); return readOriginal();
    }),
    dispose() { closed = true; task = null; question = null; result = null; resultState = null; answerReceipt = null;
      originalTaskId = null; view = empty(); input.changed(clone(view)); },
  };
  return Object.freeze(session);
}
