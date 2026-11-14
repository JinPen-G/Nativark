/** Cancellation of one original explanation task. This retains only original
 * operation selectors; it neither owns the task cache nor restores execution.
 * A lost reply is read by its saved revision, never retried or re-finalized. */
import { aiClientTaskReadRequestSchema, aiClientTaskCreationReceiptSchema, aiClientTaskCancelRequestSchema,
  aiClientTaskCancelReceiptSchema, aiClientTaskCancellationObservationSchema,
  aiClientTaskInputCancellationReceiptSchema, aiClientTaskUnstartedCancellationReceiptSchema } from '../../vendor/shared-ai-client';
import { clientTaskStorageKey, type ClientTaskContext } from './client-task-session';
import type { ClientTaskCancellationApi } from '../../api/ai-task-cancellation';

type Reference = Parameters<ClientTaskCancellationApi['readCreation']>[0];
type Request = Parameters<ClientTaskCancellationApi['requestCancellation']>[0];
type Task = NonNullable<Awaited<ReturnType<ClientTaskCancellationApi['readCreation']>>['task']>;
type Observation = Awaited<ReturnType<ClientTaskCancellationApi['readRequestReceipt']>>;
type SettlementKind = 'unstarted' | 'released_input_wait';
type Status = 'closed' | 'checking' | 'ready' | 'requested' | 'settled' | 'finished' | 'unknown' | 'unavailable';
interface Locator {
  version: 'client-order-task-cancellation-1'; owner: string; taskId: string; request: Request;
  basis: SettlementKind | null;
  settlement: { kind: SettlementKind; request: Request } | null;
}
export interface ClientTaskCancellationOrigin { reference: Reference; taskId: string }
export interface ClientTaskCancellationObservation {
  taskId: string; taskRevision: number; cursor: string; cancellation: 'requested' | 'settled';
}
export interface ClientTaskCancellationView {
  status: Status; taskStatus: Task['status'] | null; canRequest: boolean; canRead: boolean; canSettle: boolean;
  observation: ClientTaskCancellationObservation | null;
}
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const active: Task['status'][] = ['queued', 'running', 'waiting_input', 'waiting_confirmation', 'waiting_external'];
const terminal: Task['status'][] = ['succeeded', 'partially_succeeded', 'cancelled', 'failed'];
const blank = (): ClientTaskCancellationView => ({ status: 'closed', taskStatus: null,
  canRequest: false, canRead: false, canSettle: false, observation: null });

export function clientTaskCancellationStorageKey(context: Omit<ClientTaskContext, 'current'>, origin: ClientTaskCancellationOrigin): string {
  const reference = aiClientTaskReadRequestSchema.parse(origin.reference);
  const taskId = aiClientTaskCancelReceiptSchema.shape.taskId.parse(origin.taskId);
  return `${clientTaskStorageKey(context)}:cancel:${encodeURIComponent(JSON.stringify([reference.materialRef, reference.creationKey, taskId]))}`;
}
function parseLocator(value: unknown, owner: string, origin: ClientTaskCancellationOrigin): Locator {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('client_cancellation_locator_invalid');
  const row = value as Record<string, unknown>, keys = ['version', 'owner', 'taskId', 'request', 'basis', 'settlement'];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))
    || row.version !== 'client-order-task-cancellation-1' || row.owner !== owner || row.taskId !== origin.taskId
    || row.basis !== null && row.basis !== 'unstarted' && row.basis !== 'released_input_wait') throw Error('client_cancellation_locator_invalid');
  const request = aiClientTaskCancelRequestSchema.parse(row.request);
  if (request.materialRef !== origin.reference.materialRef || request.creationKey !== origin.reference.creationKey)
    throw Error('client_cancellation_origin_changed');
  let settlement: Locator['settlement'] = null;
  if (row.settlement !== null) {
    if (!row.settlement || typeof row.settlement !== 'object' || Array.isArray(row.settlement)) throw Error('client_cancellation_locator_invalid');
    const item = row.settlement as Record<string, unknown>;
    if (Object.keys(item).length !== 2 || !('kind' in item) || !('request' in item)
      || item.kind !== row.basis || item.kind !== 'unstarted' && item.kind !== 'released_input_wait') throw Error('client_cancellation_locator_invalid');
    const selector = aiClientTaskCancelRequestSchema.parse(item.request);
    if (selector.materialRef !== request.materialRef || selector.creationKey !== request.creationKey
      || selector.expectedRevision !== request.expectedRevision + 1) throw Error('client_cancellation_origin_changed');
    settlement = { kind: item.kind, request: selector };
  }
  return { version: 'client-order-task-cancellation-1', owner, taskId: origin.taskId, request, basis: row.basis, settlement };
}

export function createClientTaskCancellationSession(input: {
  context: ClientTaskContext; origin: ClientTaskCancellationOrigin; api: ClientTaskCancellationApi;
  storage: { read(): unknown; write(value: unknown): void }; changed(view: ClientTaskCancellationView): void;
}) {
  const origin = { reference: aiClientTaskReadRequestSchema.parse(input.origin.reference),
    taskId: aiClientTaskCancelReceiptSchema.shape.taskId.parse(input.origin.taskId) };
  const owner = clientTaskCancellationStorageKey(input.context, origin);
  let closed = false, busy = false, opened = false, invalid = false, held: unknown, saved: Locator | null = null;
  let task: Task | null = null, requested: Observation | null = null, settled: Observation | null = null, view = blank();
  const current = () => !closed && input.context.current();
  const report = (): ClientTaskCancellationObservation | null => {
    const observed = settled?.state === 'observed' ? settled : requested?.state === 'observed' ? requested : null;
    return observed?.transition ? { taskId: origin.taskId, taskRevision: observed.transition.taskRevision,
      cursor: observed.transition.cursor, cancellation: observed === settled ? 'settled' : 'requested' } : null;
  };
  const emit = (status: Status) => {
    if (!current()) return;
    view = { status, taskStatus: task?.status ?? null,
      canRequest: !busy && !invalid && !saved && Boolean(task && active.includes(task.status)),
      canRead: !busy && !invalid,
      canSettle: !busy && !invalid && Boolean(saved?.basis && !saved.settlement && requested?.state === 'observed'
        && requested.transition?.status === 'cancel_requested' && task?.status === 'cancel_requested'
        && task.revision <= 4294967294 && task.revision === requested.transition.taskRevision),
      observation: report() };
    input.changed(clone(view));
  };
  const load = () => {
    if (opened) return;
    held = clone(input.storage.read());
    try { saved = held === undefined || held === null ? null : parseLocator(held, owner, origin); }
    catch { invalid = true; throw Error('client_cancellation_locator_invalid'); }
    opened = true;
  };
  const persist = (next: Locator) => {
    if (!current() || !same(input.storage.read(), held)) { invalid = true; throw Error('client_cancellation_locator_changed'); }
    const checked = parseLocator(next, owner, origin);
    input.storage.write(clone(checked));
    if (!same(input.storage.read(), checked)) { invalid = true; throw Error('client_cancellation_locator_changed'); }
    held = clone(checked); saved = checked;
  };
  const accept = (value: unknown, selector: Request, status: 'cancel_requested' | 'settlement') => {
    const observation = aiClientTaskCancellationObservationSchema.parse(value);
    if (observation.taskId !== origin.taskId || observation.expectedRevision !== selector.expectedRevision
      || observation.state === 'observed' && (status === 'settlement'
        ? !['cancelled','succeeded','partially_succeeded'].includes(observation.transition!.status)
        : observation.transition?.status !== status)) throw Error('client_cancellation_receipt_changed');
    return observation;
  };
  const readOriginal = async (): Promise<Status> => {
    task = null; requested = null; settled = null;
    const created = aiClientTaskCreationReceiptSchema.parse(await input.api.readCreation(clone(origin.reference)));
    if (!current()) return 'closed';
    if (created.creationKey !== origin.reference.creationKey || created.materialRef !== origin.reference.materialRef
      || created.state === 'observed' && created.task?.taskId !== origin.taskId) throw Error('client_cancellation_origin_changed');
    if (created.state !== 'observed' || !created.task) return 'unknown';
    task = created.task;
    if (!saved) return terminal.includes(task.status) ? 'finished' : task.status === 'cancel_requested' ? 'unknown' : 'ready';
    requested = accept(await input.api.readRequestReceipt(clone(saved.request)), saved.request, 'cancel_requested');
    if (!current()) return 'closed';
    if (requested.state !== 'observed') return 'unknown';
    // Workers can finish an original stop too. Select only the successor of
    // this saved request, never a fresh version guessed from today's status.
    const settlementRequest = saved.settlement?.request ?? (saved.request.expectedRevision < 4294967294
      ? aiClientTaskCancelRequestSchema.parse({ ...origin.reference, expectedRevision: saved.request.expectedRevision + 1 }) : null);
    if (settlementRequest) {
      settled = accept(await input.api.readSettlementReceipt(clone(settlementRequest)), settlementRequest, 'settlement');
      if (!current()) return 'closed';
      if (settled.state === 'observed') {
        if (task.status !== settled.transition!.status || task.revision < settled.transition!.taskRevision) throw Error('client_cancellation_origin_changed');
        return 'settled';
      }
      if (saved.settlement) return 'unknown';
    }
    // Current terminal status is not the receipt of this unknown operation.
    return requested.state === 'observed' && task.status === 'cancel_requested' ? 'requested' : 'unknown';
  };
  const run = async (work: () => Promise<Status>) => {
    if (!current() || busy || invalid) return;
    busy = true; emit('checking'); let status: Status = 'unavailable';
    try { load(); status = await work(); }
    catch { status = invalid ? 'unavailable' : saved ? 'unknown' : 'unavailable'; }
    finally { busy = false; emit(status); }
  };
  return Object.freeze({
    open: () => run(readOriginal),
    refresh: () => run(readOriginal),
    requestCancellation: () => run(async () => {
      const status = await readOriginal();
      if (!current() || saved || !task || !active.includes(task.status)) return status;
      const request = aiClientTaskCancelRequestSchema.parse({ ...origin.reference, expectedRevision: task.revision });
      // State selects an existing witness entry; it never proves no effects.
      const basis: Locator['basis'] = task.status === 'queued' ? 'unstarted'
        : task.status === 'waiting_input' ? 'released_input_wait' : null;
      persist({ version: 'client-order-task-cancellation-1', owner, taskId: origin.taskId, request, basis, settlement: null });
      if (!current()) return 'closed';
      const receipt = aiClientTaskCancelReceiptSchema.parse(await input.api.requestCancellation(clone(request)));
      if (!current()) return 'closed';
      if (receipt.taskId !== origin.taskId || receipt.taskRevision !== request.expectedRevision + 1) throw Error('client_cancellation_receipt_changed');
      return readOriginal();
    }),
    finishCancellation: () => run(async () => {
      const status = await readOriginal(), locator = saved;
      if (!current() || !locator || locator.settlement || !locator.basis || requested?.state !== 'observed'
        || settled?.state === 'observed' || task?.status !== 'cancel_requested' || task.revision > 4294967294
        || task.revision !== requested.transition?.taskRevision) return status;
      const request = aiClientTaskCancelRequestSchema.parse({ ...origin.reference, expectedRevision: task.revision });
      persist({ ...locator, settlement: { kind: locator.basis, request } });
      if (!current()) return 'closed';
      const receipt = locator.basis === 'unstarted'
        ? aiClientTaskUnstartedCancellationReceiptSchema.parse(await input.api.settleUnstarted(clone(request)))
        : aiClientTaskInputCancellationReceiptSchema.parse(await input.api.settleReleasedInputWait(clone(origin.reference)));
      if (!current()) return 'closed';
      if (receipt.taskId !== origin.taskId || receipt.taskRevision !== request.expectedRevision + 1) throw Error('client_cancellation_receipt_changed');
      return readOriginal();
    }),
    snapshot: () => clone(view),
    dispose() { closed = true; task = null; requested = null; settled = null; view = blank(); },
  });
}
