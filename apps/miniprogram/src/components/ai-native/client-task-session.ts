/** Original personal order explanation and clarification. Local phases retain
 * operation references, not authority. A read never starts or continues AI;
 * an unknown start/continuation never opens a new request or model call. */
import { AI_TASK_INPUT_DRAFT_VERSION, aiClientHostCapabilitiesSchema, aiClientOrderMaterialRequestSchema,
  aiClientOrderMaterialReceiptSchema, aiClientTaskReadRequestSchema, aiClientTaskCreationReceiptSchema,
  aiClientTaskModelControlResponseSchema, aiClientTaskModelResultReadResponseSchema, aiClientTaskInputReadResponseSchema,
  aiClientTaskInputSubmissionRequestSchema, aiClientTaskInputSubmissionReceiptSchema, aiClientTaskInputReceiptReadResponseSchema,
  isAiTaskInputContractDraft, aiClientTaskEventsReadRequestSchema,
  aiClientTaskSnapshotReadResponseSchema, aiClientTaskEventsReadResponseSchema } from '../../vendor/shared-ai-client';
import type { ClientTaskApi } from '../../api/ai-tasks';

type MaterialRequest = Parameters<ClientTaskApi['prepareMaterial']>[0];
type TaskRequest = Parameters<ClientTaskApi['readCreation']>[0];
type Submission = Parameters<ClientTaskApi['submitInput']>[0];
type Material = Awaited<ReturnType<ClientTaskApi['readMaterial']>>;
type Creation = Awaited<ReturnType<ClientTaskApi['readCreation']>>;
type Question = Awaited<ReturnType<ClientTaskApi['readInput']>>['question'];
type Model = Awaited<ReturnType<ClientTaskApi['readModelResult']>>;
type Receipt = Awaited<ReturnType<ClientTaskApi['readInputReceipt']>>;
type Observation = Awaited<ReturnType<ClientTaskApi['readSnapshot']>>;
type Phase = 'material_pending' | 'material_ready' | 'task_pending' | 'task_created' | 'model_pending' | 'model_active'
  | 'answer_pending' | 'answered' | 'continuation_pending' | 'complete';
interface Locator {
  version: 'client-order-task-operation-1'; owner: string; material: MaterialRequest; task: TaskRequest | null;
  phase: Phase; submission: Submission | null; continued: boolean;
}
export interface ClientTaskContext {
  tenantCode: string; serviceCode: string; customerId: string; orderId: string;
  surface: 'tenant_website' | 'client_miniprogram'; current(): boolean;
}
export interface ClientTaskView {
  status: 'closed' | 'working' | 'ready' | 'waiting_input' | 'input_saved' | 'running' | 'complete' | 'unknown' | 'unavailable';
  task: Creation['task']; modelText: string | null; question: Question; receipt: Receipt['receipt'];
  scope: { kind: 'workspace'; tenantId: string; workspaceId: string } | null;
  canExplain: boolean; canRead: boolean; canSubmit: boolean; canContinue: boolean;
  readOnly: boolean; modelUnavailable: boolean;
  /** Original metadata watermark and a local read generation, never execution authority. */
  observation: Observation | null; observationGeneration: number;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const validCursor = (value: string) => /^(0|[1-9][0-9]{0,19})$/u.test(value)
  && (value.length < 20 || value <= '18446744073709551615');
const cursorAfter = (value: string, prior: string) => value.length > prior.length || value.length === prior.length && value > prior;
const phases: Phase[] = ['material_pending','material_ready','task_pending','task_created','model_pending','model_active','answer_pending','answered','continuation_pending','complete'];
export function clientTaskStorageKey(context: Omit<ClientTaskContext, 'current'>): string {
  return `rental-os:client-order-task:${encodeURIComponent(JSON.stringify([context.tenantCode,context.serviceCode,context.customerId,context.surface,context.orderId]))}`;
}
const initial = (): ClientTaskView => ({ status: 'closed', task: null, modelText: null, question: null, receipt: null, scope: null,
  canExplain: false, canRead: false, canSubmit: false, canContinue: false, readOnly: true, modelUnavailable: false,
  observation: null, observationGeneration: 0 });
function parseLocator(value: unknown, owner: string, orderId: string): Locator {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('client_task_locator_invalid');
  const row = value as Record<string, unknown>, keys = ['version','owner','material','task','phase','submission','continued'];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))
    || row.version !== 'client-order-task-operation-1' || row.owner !== owner || !phases.includes(row.phase as Phase)
    || typeof row.continued !== 'boolean') throw Error('client_task_locator_invalid');
  const material = aiClientOrderMaterialRequestSchema.parse(row.material), task = row.task === null ? null : aiClientTaskReadRequestSchema.parse(row.task);
  const submission = row.submission === null ? null : aiClientTaskInputSubmissionRequestSchema.parse(row.submission), phase = row.phase as Phase;
  if (material.orderId !== orderId || (phases.indexOf(phase) < 2 ? task !== null : task === null)
    || (submission && (!task || submission.creationKey !== task.creationKey || submission.materialRef !== task.materialRef))
    || (['answer_pending','answered','continuation_pending'].includes(phase) && !submission)
    || (row.continued && !['continuation_pending','model_active','complete'].includes(phase))) throw Error('client_task_locator_invalid');
  return { version: row.version, owner, material, task, phase, submission, continued: row.continued };
}

export function createClientTaskSession(input: {
  context: ClientTaskContext; api: ClientTaskApi; readHost(): Promise<unknown>; now(): number; newKey(): string;
  storage: { read(): unknown; write(value: unknown): void }; changed(view: ClientTaskView): void;
}) {
  const owner = clientTaskStorageKey(input.context);
  let closed = false, busy = false, invalidCache = false, saved: Locator | null = null, held: unknown;
  let host: ReturnType<typeof aiClientHostCapabilitiesSchema.parse> | null = null;
  let material: Material | null = null, creation: Creation | null = null, question: Question = null, model: Model | null = null, receipt: Receipt['receipt'] = null;
  let modelUnavailable = false, view = initial();
  let originalTaskId: string | null = null, cancellationReadPending: string | null = null;
  let observation: Observation | null = null, observationGeneration = 0;
  const current = () => !closed && input.context.current();
  const textField = () => question && isAiTaskInputContractDraft(question.contract) && question.contract.fields.length === 1
    && question.contract.fields[0].fieldId === 'clarification_text' && question.contract.fields[0].kind === 'text' ? question.contract.fields[0] : null;
  const emit = (status: ClientTaskView['status']) => {
    if (!current()) return;
    const writeEntry = Boolean(host?.enabled && host.policy.allowCreate), field = textField();
    const task = creation?.state === 'observed' && creation.task ? { ...creation.task,
      ...(observation ? { status: observation.status, revision: observation.revision } : {}) } : null;
    const taskAcceptsInput = task?.status === 'waiting_input', taskCanContinue = task?.status === 'running';
    view = { status, task, question, receipt, scope: host?.scope ?? null, observation, observationGeneration,
      modelText: model?.state === 'observed' && model.resultPurpose === 'answer' && model.result?.status === 'succeeded' ? model.result.text : null,
      readOnly: !writeEntry, modelUnavailable,
      canExplain: !busy && !invalidCache && ((!saved || saved.phase === 'material_ready') ? writeEntry
        && (!saved || material?.state === 'observed' && Boolean(material.expiresAt && Date.parse(material.expiresAt) > input.now()))
        : saved.phase === 'task_created' && creation?.task?.status === 'queued'),
      canRead: !busy && !invalidCache && Boolean(saved && host?.policy.allowRead),
      canSubmit: !busy && !invalidCache && taskAcceptsInput && Boolean(saved?.task && field && question && Date.parse(question.expiresAt) > input.now()
        && (!saved.submission || saved.submission.submission.requestId !== question.requestId)
        && saved.phase !== 'model_pending' && saved.phase !== 'continuation_pending'),
      canContinue: !busy && !invalidCache && taskCanContinue && Boolean(saved?.submission && receipt && !saved.continued && saved.phase === 'answered') };
    input.changed(copy(view));
  };
  const persist = (next: Locator) => {
    if (!current() || !same(input.storage.read(), held)) throw Error('client_task_original_replaced');
    const value = parseLocator(next, owner, input.context.orderId);
    input.storage.write(copy(value)); if (!same(value, input.storage.read())) throw Error('client_task_reference_not_retained');
    saved = copy(value); held = copy(value);
  };
  const recheck = async (purpose: 'read' | 'create' | 'original_control') => {
    if (!current()) throw Error('client_task_context_changed');
    const next = aiClientHostCapabilitiesSchema.parse(await input.readHost());
    if (!current() || next.policy.allowRead !== true || next.customerType !== 'personal'
      || next.customerId !== input.context.customerId || next.tenantCode !== input.context.tenantCode || next.serviceCode !== input.context.serviceCode
      || next.surface !== input.context.surface || Date.parse(next.expiresAt) <= input.now() || (host && !same(host.scope,next.scope))) throw Error('client_task_scope_changed');
    host = next;
    if (purpose === 'create' && (!next.enabled || !next.policy.allowCreate)) throw Error('client_task_creation_unavailable');
    // An original answer/continuation has its own server policy. A publication
    // snapshot cannot grant it, or make allowCreate its substitute authority.
  };
  const acceptMaterial = (value: unknown) => {
    const result = aiClientOrderMaterialReceiptSchema.parse(value);
    if (!saved || result.operationKey !== saved.material.operationKey || (saved.task && result.state === 'observed' && result.materialRef !== saved.task.materialRef)) throw Error('client_material_changed');
    material = result; return result;
  };
  const acceptCreation = (value: unknown) => {
    const result = aiClientTaskCreationReceiptSchema.parse(value);
    if (!saved?.task || result.creationKey !== saved.task.creationKey || result.materialRef !== saved.task.materialRef
      || (originalTaskId && result.task && originalTaskId !== result.task.taskId)
      || (creation?.task && result.task && (creation.task.taskId !== result.task.taskId || creation.inputRef !== result.inputRef || creation.inputHash !== result.inputHash))) throw Error('client_task_origin_changed');
    if (result.state === 'observed' && result.task) originalTaskId = result.task.taskId;
    creation = result; return result;
  };
  const readObservation = async () => {
    if (!saved?.task || !originalTaskId) throw Error('client_task_observation_unavailable');
    const reference = copy(saved.task), taskId = originalTaskId;
    const next = aiClientTaskSnapshotReadResponseSchema.parse(await input.api.readSnapshot(reference));
    if (!current() || !saved.task || !same(reference, saved.task) || !same(input.storage.read(), held)
      || next.taskId !== taskId || !validCursor(next.cursor)
      || (creation?.task && next.revision < creation.task.revision)
      || (observation && (next.revision < observation.revision || cursorAfter(observation.cursor, next.cursor))))
      throw Error('client_task_observation_changed');
    observation = copy(next); observationGeneration++;
  };
  const awaitOriginalControl = async (control: ReturnType<ClientTaskApi['startModel']>) => {
    // The explicit original model request is already in flight. Metadata can
    // make its real event watermark visible without another execution call.
    const reply = control.then(value => ({ value }), () => null);
    try { await readObservation(); } catch { observation = null; }
    emit('working');
    const result = await reply;
    if (!result) throw Error('client_task_original_reply_unknown');
    return result.value;
  };
  const readOriginal = async () => {
    if (!saved) return 'ready' as const;
    const originalMaterial = acceptMaterial(await input.api.readMaterial(copy(saved.material)));
    if (originalMaterial.state !== 'observed') return 'unknown' as const;
    if (!saved.task) {
      if (saved.phase === 'material_pending') persist({ ...saved, phase: 'material_ready' });
      return 'ready' as const;
    }
    const created = acceptCreation(await input.api.readCreation(copy(saved.task)));
    if (created.state !== 'observed' || !created.task) return 'unknown' as const;
    if (saved.phase === 'task_pending') persist({ ...saved, phase: 'task_created' });
    await readObservation();
    // A terminal task cannot consume another answer. Retain the original
    // operation references while removing local answer text after cancellation or failure.
    if (saved.submission && observation && ['cancelled', 'failed'].includes(observation.status))
      persist({ ...saved, phase: 'complete', submission: null, continued: true });
    model = aiClientTaskModelResultReadResponseSchema.parse(await input.api.readModelResult(copy(saved.task)));
    if (model.taskId !== created.task.taskId) throw Error('client_task_result_changed');
    const pending = aiClientTaskInputReadResponseSchema.parse(await input.api.readInput(copy(saved.task)));
    question = pending.state === 'pending' ? pending.question : null;
    receipt = null;
    if (saved.submission) {
      const answer = aiClientTaskInputReceiptReadResponseSchema.parse(await input.api.readInputReceipt(copy(saved.submission)));
      if (answer.state === 'observed') {
        if (answer.receipt.taskId !== created.task.taskId || answer.receipt.requestId !== saved.submission.submission.requestId) throw Error('client_answer_origin_changed');
        receipt = answer.receipt;
        if (saved.phase === 'answer_pending') persist({ ...saved, phase: 'answered' });
      }
    }
    if (model.state === 'observed' && model.resultPurpose === 'answer') {
      persist({ ...saved, phase: 'complete', submission: null, continued: true }); return 'complete' as const;
    }
    if (question && model.resultPurpose === 'clarification' && model.workflowStatus === 'waiting_input') {
      if (saved.phase === 'model_pending') persist({ ...saved, phase: 'model_active' });
      if (saved.submission && saved.continued && saved.submission.submission.requestId !== question.requestId)
        persist({ ...saved, phase: 'model_active', submission: null, continued: false });
      return 'waiting_input' as const;
    }
    if (receipt && !saved.continued) return 'input_saved' as const;
    if (saved.phase === 'task_created' && created.task.status === 'queued') return 'ready' as const;
    if (model.state === 'observed' && model.result?.status !== 'succeeded' || model.workflowStatus === 'failed' || model.workflowStatus === 'cancelled') return 'unavailable' as const;
    return saved.phase === 'model_pending' || saved.phase === 'continuation_pending' ? 'unknown' as const : 'running' as const;
  };
  const run = async (purpose: 'read' | 'create' | 'original_control', action: () => Promise<ClientTaskView['status']>): Promise<void> => {
    if (busy || !current() || invalidCache) return;
    busy = true; emit('working'); let status: ClientTaskView['status'] = 'unavailable';
    try { await recheck(purpose); status = await action(); await recheck('read'); }
    catch { question = null; model = null; receipt = null; creation = null; material = null; observation = null;
      status = saved && ['material_pending','task_pending','model_pending','answer_pending','continuation_pending'].includes(saved.phase) ? 'unknown' : 'unavailable'; }
    finally {
      busy = false; emit(status);
      const pending = cancellationReadPending; cancellationReadPending = null;
      if (pending && session.cancellationHost()?.origin.taskId === pending) await refreshOriginal();
    }
  };
  const refreshOriginal = (): Promise<void> => run('read', readOriginal);
  const session = {
    snapshot: () => copy(view),
    // Only an observed original creation supplies this private host. The ID
    // survives a lost model reply, but is never restored from browser storage.
    cancellationHost() {
      if (!current() || invalidCache || !saved?.task || !originalTaskId) return null;
      try { if (!same(input.storage.read(), held)) return null; } catch { return null; }
      return { context: { ...input.context }, origin: { reference: copy(saved.task), taskId: originalTaskId } };
    },
    async refreshAfterObservation(taskId: string): Promise<void> {
      if (session.cancellationHost()?.origin.taskId !== taskId) return;
      // An original observation can arrive while the original model HTTP
      // request is pending. Drain one read after it; never restart that call.
      if (busy) { cancellationReadPending = taskId; return; }
      await refreshOriginal();
    },
    async readEventPage(after: string) {
      const original = session.cancellationHost();
      if (!original || !validCursor(after)) throw Error('client_task_events_unavailable');
      await recheck('read');
      const command = aiClientTaskEventsReadRequestSchema.parse({ ...original.origin.reference, after, limit: 50 });
      const page = aiClientTaskEventsReadResponseSchema.parse(await input.api.readEvents(command));
      if (session.cancellationHost()?.origin.taskId !== original.origin.taskId || page.taskId !== original.origin.taskId)
        throw Error('client_task_events_changed');
      if ('status' in page) { await recheck('read'); return copy(page); }
      let last = after, revision = 0;
      for (const event of page.events) {
        if (event.taskId !== original.origin.taskId || event.contractVersion !== page.contractVersion
          || !validCursor(event.cursor) || !cursorAfter(event.cursor, last) || event.taskRevision < revision)
          throw Error('client_task_events_changed');
        last = event.cursor; revision = event.taskRevision;
      }
      if (page.nextCursor !== last || page.hasMore && page.events.length === 0) throw Error('client_task_events_changed');
      await recheck('read'); return copy(page);
    },
    async open() {
      if (busy || !current()) return;
      busy = true; let status: ClientTaskView['status'] = 'unavailable';
      try {
        await recheck('read'); const value = input.storage.read(); held = value === undefined || value === null ? undefined : copy(value);
        if (held !== undefined) { try { saved = parseLocator(held, owner, input.context.orderId); } catch { invalidCache = true; throw Error('client_task_locator_invalid'); } status = 'unknown'; }
        else status = 'ready';
      } catch { status = 'unavailable'; }
      finally { busy = false; emit(status); }
    },
    async explain() {
      if (busy || !current() || invalidCache) return;
      if (saved) await session.refresh();
      if (!current() || invalidCache || (saved && !['material_ready','task_created'].includes(saved.phase))) return;
      return run(saved?.phase === 'task_created' ? 'original_control' : 'create', async () => {
        if (!saved) {
          const command = aiClientOrderMaterialRequestSchema.parse({ operationKey: input.newKey(), orderId: input.context.orderId });
          persist({ version: 'client-order-task-operation-1', owner, material: command, task: null, phase: 'material_pending', submission: null, continued: false });
          const observed = acceptMaterial(await input.api.prepareMaterial(copy(command)));
          if (observed.state !== 'observed') return 'unknown';
          persist({ ...saved!, phase: 'material_ready' });
        }
        if (saved!.phase === 'material_ready') {
          if (material?.state !== 'observed' || !material.materialRef) return 'unknown';
          if (!material.expiresAt || Date.parse(material.expiresAt) <= input.now()) return 'unavailable';
          const task = aiClientTaskReadRequestSchema.parse({ creationKey: input.newKey(), materialRef: material.materialRef });
          persist({ ...saved!, task, phase: 'task_pending' });
          const observed = acceptCreation(await input.api.createTask(copy(task)));
          if (observed.state !== 'observed' || !observed.task) return 'unknown';
          persist({ ...saved!, phase: 'task_created' });
        }
        if (saved!.phase !== 'task_created' || !saved!.task || creation?.task?.status !== 'queued') return 'unknown';
        persist({ ...saved!, phase: 'model_pending' });
        emit('working');
        const control = aiClientTaskModelControlResponseSchema.parse(await awaitOriginalControl(input.api.startModel(copy(saved!.task!))));
        if (control.execution.kind === 'not_started') { modelUnavailable = true; return 'unavailable'; }
        persist({ ...saved!, phase: 'model_active' }); modelUnavailable = false; return readOriginal();
      });
    },
    refresh() { return run('read', async () => {
      // Drain committed metadata pages from the held watermark. More pages
      // never authorize writes; a reset requires a fresh original snapshot.
      if (observation) {
        let after = observation.cursor;
        for (let count = 0; count < 20; count++) {
          const page = await session.readEventPage(after);
          if ('status' in page || !page.hasMore) break;
          if (count === 19) throw Error('client_task_events_bound');
          after = page.nextCursor;
        }
      }
      return readOriginal();
    }); },
    async submitClarification(text: string) {
      if (!view.canSubmit || !saved?.task || !question) return;
      const original = copy(question), field = textField();
      if (!field || typeof text !== 'string' || !text.trim() || text.length > field.maxLength) throw Error('client_clarification_invalid');
      return run('original_control', async () => {
        const currentInput = aiClientTaskInputReadResponseSchema.parse(await input.api.readInput(copy(saved!.task!)));
        if (currentInput.state !== 'pending' || !same(currentInput.question,original) || Date.parse(original.expiresAt) <= input.now()) throw Error('client_clarification_changed');
        const submission = aiClientTaskInputSubmissionRequestSchema.parse({ ...saved!.task,
          submission: { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, requestId: original.requestId, expectedRevision: original.revision,
            submissionKey: input.newKey(), answers: [{ fieldId: 'clarification_text', value: text }] } });
        persist({ ...saved!, submission, continued: false, phase: 'answer_pending' });
        const result = aiClientTaskInputSubmissionReceiptSchema.parse(await input.api.submitInput(copy(submission)));
        if (result.requestId !== original.requestId || result.taskId !== creation?.task?.taskId) throw Error('client_answer_origin_changed');
        receipt = { taskId: result.taskId, requestId: result.requestId, receiptId: result.receiptId, taskRevision: result.taskRevision };
        persist({ ...saved!, phase: 'answered' }); return readOriginal();
      });
    },
    async continueAnswer() {
      if (!view.canContinue || !saved?.submission || saved.continued) return;
      return run('original_control', async () => {
        const result = aiClientTaskInputReceiptReadResponseSchema.parse(await input.api.readInputReceipt(copy(saved!.submission!)));
        if (result.state !== 'observed' || result.receipt.requestId !== saved!.submission!.submission.requestId
          || result.receipt.taskId !== creation?.task?.taskId) throw Error('client_answer_unavailable');
        persist({ ...saved!, phase: 'continuation_pending', continued: true });
        const control = aiClientTaskModelControlResponseSchema.parse(await awaitOriginalControl(input.api.continueInput(copy(saved!.submission!))));
        if (control.execution.kind === 'not_started') { modelUnavailable = true; return 'unavailable'; }
        persist({ ...saved!, phase: 'model_active' }); return readOriginal();
      });
    },
    dispose() { closed = true; cancellationReadPending = null; originalTaskId = null;
      question = null; model = null; receipt = null; creation = null; observation = null; view = initial(); input.changed(copy(view)); },
  };
  return Object.freeze(session);
}
