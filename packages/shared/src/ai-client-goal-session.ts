/** Human goal -> original Task -> unselected public candidates -> original
 * quote. The journal retains only exact recovery requests, never a goal body,
 * model response or authorization. Unknown writes are observed by their original
 * keys; reading never starts a model, continues an answer or confirms a quote. */
import { AI_TASK_INPUT_DRAFT_VERSION } from './ai-task-input-draft';
import { RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES } from './core';
import { aiClientHostCapabilitiesSchema, aiClientTaskReadRequestSchema, aiClientTaskCreationReceiptSchema,
  aiClientTaskSnapshotReadResponseSchema, aiClientTaskModelResultReadResponseSchema, aiClientTaskModelControlResponseSchema,
  aiClientTaskInputReadResponseSchema, aiClientTaskInputSubmissionRequestSchema, aiClientTaskInputSubmissionReceiptSchema,
  aiClientTaskInputReceiptReadResponseSchema } from './ai-client-entry-draft-schemas';
import { aiClientGoalPreparationRequestSchema, aiClientGoalPreparationReadRequestSchema, aiClientGoalPreparationResponseSchema,
  aiClientGoalCandidatesRequestSchema, aiClientGoalProjectionSchema, aiClientGoalQuoteRequestSchema,
  type AiClientGoalProjection, type AiClientGoalQuoteRequest } from './ai-client-goal-draft';
import { aiClientQuotePreparationResponseSchema, aiClientQuotePreparationReadResponseSchema,
  aiClientQuoteConfirmationRequestSchema, aiClientQuoteResultReadResponseSchema, type AiClientQuoteFacts } from './ai-client-quote-draft';
import type { ClientCreateQuoteRequest } from './client';
import type { RentalFulfillmentMode } from './core';
import type { EnterpriseOwnRentalPolicy } from './enterprise-policy';
import { clientGoalTextHash } from './ai-client-goal-fingerprint';

export interface ClientGoalSignal { readonly aborted: boolean }
export interface ClientGoalApi {
  readHost(signal?: ClientGoalSignal): Promise<ReturnType<typeof aiClientHostCapabilitiesSchema.parse>>;
  prepareGoal(input: ReturnType<typeof aiClientGoalPreparationRequestSchema.parse>, signal?: ClientGoalSignal): Promise<unknown>;
  readGoalPreparation(input: ReturnType<typeof aiClientGoalPreparationReadRequestSchema.parse>, signal?: ClientGoalSignal): Promise<unknown>;
  readGoalCandidates(input: ReturnType<typeof aiClientGoalCandidatesRequestSchema.parse>, signal?: ClientGoalSignal): Promise<unknown>;
  prepareGoalQuote(input: AiClientGoalQuoteRequest, signal?: ClientGoalSignal): Promise<unknown>;
  readGoalQuotePreparation(input: AiClientGoalQuoteRequest, signal?: ClientGoalSignal): Promise<unknown>;
  confirmQuoteParameters(input: ReturnType<typeof aiClientQuoteConfirmationRequestSchema.parse>, signal?: ClientGoalSignal): Promise<unknown>;
  readQuoteOriginal(input: ReturnType<typeof aiClientQuoteConfirmationRequestSchema.parse>, signal?: ClientGoalSignal): Promise<unknown>;
  readCatalog(signal?: ClientGoalSignal): Promise<unknown>;
  readEnterprisePolicies(signal?: ClientGoalSignal): Promise<unknown>;
  readAddresses(signal?: ClientGoalSignal): Promise<unknown>;
  createTask(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: ClientGoalSignal): Promise<ReturnType<typeof aiClientTaskCreationReceiptSchema.parse>>;
  readCreation(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: ClientGoalSignal): Promise<ReturnType<typeof aiClientTaskCreationReceiptSchema.parse>>;
  readSnapshot(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: ClientGoalSignal): Promise<ReturnType<typeof aiClientTaskSnapshotReadResponseSchema.parse>>;
  startModel(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: ClientGoalSignal): Promise<ReturnType<typeof aiClientTaskModelControlResponseSchema.parse>>;
  readModelResult(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: ClientGoalSignal): Promise<ReturnType<typeof aiClientTaskModelResultReadResponseSchema.parse>>;
  readInput(input: ReturnType<typeof aiClientTaskReadRequestSchema.parse>, signal?: ClientGoalSignal): Promise<ReturnType<typeof aiClientTaskInputReadResponseSchema.parse>>;
  submitInput(input: ReturnType<typeof aiClientTaskInputSubmissionRequestSchema.parse>, signal?: ClientGoalSignal): Promise<ReturnType<typeof aiClientTaskInputSubmissionReceiptSchema.parse>>;
  readInputReceipt(input: ReturnType<typeof aiClientTaskInputSubmissionRequestSchema.parse>, signal?: ClientGoalSignal): Promise<ReturnType<typeof aiClientTaskInputReceiptReadResponseSchema.parse>>;
  continueInput(input: ReturnType<typeof aiClientTaskInputSubmissionRequestSchema.parse>, signal?: ClientGoalSignal): Promise<ReturnType<typeof aiClientTaskModelControlResponseSchema.parse>>;
}
type GoalRead = Parameters<ClientGoalApi['readGoalPreparation']>[0];
type TaskRead = Parameters<ClientGoalApi['readCreation']>[0];
type Submission = Parameters<ClientGoalApi['submitInput']>[0];
type Creation = Awaited<ReturnType<ClientGoalApi['readCreation']>>;
type Question = Awaited<ReturnType<ClientGoalApi['readInput']>>['question'];
type Receipt = Awaited<ReturnType<ClientGoalApi['readInputReceipt']>>['receipt'];
type Host = Awaited<ReturnType<ClientGoalApi['readHost']>>;
type Snapshot = Awaited<ReturnType<ClientGoalApi['readSnapshot']>>;
type Material = { materialRef: string; materialHash: string; inputHash: string; expiresAt: string };
type Phase = 'goal_pending' | 'goal_ready' | 'task_pending' | 'task_ready' | 'model_pending' | 'model_active'
  | 'answer_pending' | 'answered' | 'continuation_pending' | 'candidates' | 'quote_pending'
  | 'quote_prepared' | 'confirmation_pending' | 'quoted';
interface Locator {
  version: 'client-goal-operation-1'; owner: string; goal: GoalRead; material: Material | null;
  task: TaskRead | null; phase: Phase; answer: Submission | null; continued: boolean;
  quote: { request: AiClientGoalQuoteRequest; material: Material | null; timeZone?: string } | null;
}
/** Observed original quote and the human selection that produced it. These
 * references are host input; the original Booking service rechecks authority. */
export interface ClientGoalBookingSource {
  original: { materialRef: string; expectedMaterialHash: string };
  selection: ClientCreateQuoteRequest;
  timeZone: string;
  quote: AiClientQuoteFacts;
}
export interface ClientGoalContext {
  tenantCode: string; serviceCode: string; customerId: string;
  surface: 'tenant_website' | 'client_miniprogram'; current(): boolean;
}
export interface ClientGoalFormSources {
  fulfillment: { enabledModes: RentalFulfillmentMode[]; allowDifferentReturnLocation: boolean;
    deliveryDestination: 'customer_address' | 'tenant_location' };
  enterprises: EnterpriseOwnRentalPolicy[] | null;
  addresses: { id: string; label: string }[] | null;
}
export interface ClientGoalView {
  status: 'closed' | 'working' | 'ready' | 'running' | 'waiting_input' | 'input_saved'
    | 'candidates' | 'prepared' | 'quoted' | 'unknown' | 'unavailable';
  hasLocator: boolean; task: Creation['task']; question: Question; receipt: Receipt;
  projection: AiClientGoalProjection | null; sources: ClientGoalFormSources | null;
  selection: ClientCreateQuoteRequest | null; quote: AiClientQuoteFacts | null;
  canExtract: boolean; canRead: boolean; canSubmit: boolean; canContinue: boolean;
  canPrepareQuote: boolean; canConfirmQuote: boolean; canSelect: boolean; readOnly: boolean;
  canStartNew: boolean;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const localId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const date = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
const record = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error('client_goal_reference_invalid');
  return value as Record<string, unknown>;
};
const phases: Phase[] = ['goal_pending','goal_ready','task_pending','task_ready','model_pending','model_active',
  'answer_pending','answered','continuation_pending','candidates','quote_pending','quote_prepared','confirmation_pending','quoted'];
const unresolved = (phase: Phase) => ['goal_pending','task_pending','model_pending','answer_pending','continuation_pending','quote_pending','confirmation_pending'].includes(phase);
const blank = (): ClientGoalView => ({ status: 'closed', hasLocator: false, task: null, question: null, receipt: null,
  projection: null, sources: null, selection: null, quote: null, canExtract: false, canRead: false, canSubmit: false,
  canContinue: false, canPrepareQuote: false, canConfirmQuote: false, canSelect: false, canStartNew: false, readOnly: true });
export function clientGoalStorageKey(context: Omit<ClientGoalContext, 'current'>): string {
  return `rental-os:client-goal:${encodeURIComponent(JSON.stringify([context.tenantCode,context.serviceCode,context.customerId,context.surface]))}`;
}
/** Interpret a human date picker in the published merchant time zone, never
 * the browser's zone. An overlapping clock hour remains an explicit choice;
 * a nonexistent or invalid local time has no selectable absolute instant. */
export function clientGoalTimeOptions(local: string, timeZone: string): { value: string; label: string }[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(local);
  if (!match) return [];
  const values = match.slice(1).map(value => Number(value ?? 0));
  const [year, month, day, hour, minute, second] = values, wall = Date.UTC(year, month - 1, day, hour, minute, second);
  if (year < 2000 || year > 9999 || !Number.isFinite(wall)) return [];
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
    || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) return [];
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const wallAt = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  };
  const offsets = new Set<number>(), result: { value: string; label: string }[] = [];
  for (let shift = -48; shift <= 48; shift += 6) { const sample = wall + shift * 3600000; offsets.add(wallAt(sample) - sample); }
  for (const offset of offsets) {
    const instant = wall - offset;
    if (wallAt(instant) !== wall) continue;
    const minutes = Math.abs(offset) / 60000, sign = offset >= 0 ? '+' : '-';
    result.push({ value: new Date(instant).toISOString(), label: `UTC${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` });
  }
  return result.sort((a, b) => a.value.localeCompare(b.value));
}
/** The fields this form actually selects. No free text, full addresses, optional
 * discounts or model values enter the recovery journal. The server DTO/Core
 * still validates the original ClientCreateQuoteRequest and current authority. */
export function clientGoalSelectedInput(value: ClientCreateQuoteRequest): ClientCreateQuoteRequest {
  const plain: unknown = copy(value);
  if (JSON.stringify(plain).length > 16384) throw Error('client_goal_selection_invalid');
  const row = record(plain, ['bookingIdentity','fulfillmentMode','fulfillmentLocationId','returnLocationId','startAt','endAt','lines','deliveryAddressId']);
  if (!RENTAL_FULFILLMENT_MODES.some(mode => mode === row.fulfillmentMode) || !localId(row.fulfillmentLocationId)
    || !date(row.startAt) || !date(row.endAt) || Date.parse(row.endAt) <= Date.parse(row.startAt)
    || row.returnLocationId !== undefined && !localId(row.returnLocationId)
    || row.deliveryAddressId !== undefined && !localId(row.deliveryAddressId)
    || !Array.isArray(row.lines) || row.lines.length < 1 || row.lines.length > 50) throw Error('client_goal_selection_invalid');
  const identity = record(row.bookingIdentity, ['bookingIdentity','corporateCustomerId','enterpriseContractAndPayer','enterpriseDisclosure']);
  if (identity.bookingIdentity === 'personal') {
    if (identity.enterpriseContractAndPayer !== false || identity.corporateCustomerId !== undefined || identity.enterpriseDisclosure !== undefined) throw Error('client_goal_selection_invalid');
  } else if (identity.bookingIdentity === 'enterprise_employee') {
    if (!localId(identity.corporateCustomerId) || typeof identity.enterpriseContractAndPayer !== 'boolean') throw Error('client_goal_selection_invalid');
    const notice = record(identity.enterpriseDisclosure, ['noticeVersion','acknowledged']);
    if (!localId(notice.noticeVersion) || notice.acknowledged !== true) throw Error('client_goal_selection_invalid');
  } else throw Error('client_goal_selection_invalid');
  const targets = new Set<string>();
  for (const raw of row.lines) {
    const line = record(raw, ['itemGroupId','quantity','pricingUnit','usageQuantity']);
    if (!localId(line.itemGroupId) || !Number.isInteger(line.quantity) || Number(line.quantity) < 1 || Number(line.quantity) > 10000
      || !RENTAL_PRICING_UNIT_CODES.some(unit => unit === line.pricingUnit)
      || line.usageQuantity !== undefined && (typeof line.usageQuantity !== 'number' || !Number.isFinite(line.usageQuantity) || line.usageQuantity < 0 || line.usageQuantity > 1000000)
      || line.pricingUnit === 'usage' && line.usageQuantity === undefined) throw Error('client_goal_selection_invalid');
    const target = `${line.itemGroupId}:${line.pricingUnit}`;
    if (targets.has(target)) throw Error('client_goal_selection_invalid');
    targets.add(target);
  }
  return plain as ClientCreateQuoteRequest;
}
const materialLocator = (value: unknown): Material => {
  const row = record(value, ['materialRef','materialHash','inputHash','expiresAt']);
  const ref = aiClientQuoteConfirmationRequestSchema.parse({ materialRef: row.materialRef, expectedMaterialHash: row.materialHash });
  if (typeof row.inputHash !== 'string' || !/^[a-f0-9]{64}$/u.test(row.inputHash) || !date(row.expiresAt)) throw Error('client_goal_reference_invalid');
  return { materialRef: ref.materialRef, materialHash: ref.expectedMaterialHash, inputHash: row.inputHash, expiresAt: row.expiresAt };
};
function parseLocator(value: unknown, owner: string): Locator {
  const row = record(value, ['version','owner','goal','material','task','phase','answer','continued','quote']);
  if (Object.keys(row).length !== 9 || row.version !== 'client-goal-operation-1' || row.owner !== owner
    || !phases.includes(row.phase as Phase) || typeof row.continued !== 'boolean') throw Error('client_goal_reference_invalid');
  const goal = aiClientGoalPreparationReadRequestSchema.parse(row.goal), phase = row.phase as Phase;
  const material = row.material === null ? null : materialLocator(row.material);
  const task = row.task === null ? null : aiClientTaskReadRequestSchema.parse(row.task);
  const answer = row.answer === null ? null : aiClientTaskInputSubmissionRequestSchema.parse(row.answer);
  const quoteRow = row.quote === null ? null : record(row.quote, ['request','material','timeZone']);
  const request = quoteRow ? aiClientGoalQuoteRequestSchema.parse(quoteRow.request) : null;
  if (quoteRow?.timeZone !== undefined) {
    if (typeof quoteRow.timeZone !== 'string' || !quoteRow.timeZone || quoteRow.timeZone.length > 128) throw Error('client_goal_reference_invalid');
    try { new Intl.DateTimeFormat('en', { timeZone: quoteRow.timeZone }).format(0); }
    catch { throw Error('client_goal_reference_invalid'); }
  }
  const quote = request ? { request: { ...request, input: clientGoalSelectedInput(request.input as ClientCreateQuoteRequest) },
    material: quoteRow!.material === null ? null : materialLocator(quoteRow!.material),
    ...(typeof quoteRow!.timeZone === 'string' ? { timeZone: quoteRow!.timeZone } : {}) } : null;
  if ((phase === 'goal_pending' ? material !== null : material === null)
    || (phases.indexOf(phase) < 2 ? task !== null : task === null)
    || task && task.materialRef !== material?.materialRef
    || answer && (!task || answer.creationKey !== task.creationKey || answer.materialRef !== task.materialRef)
    || ['answer_pending','answered','continuation_pending'].includes(phase) && !answer
    || row.continued && (!answer || !['continuation_pending','model_active'].includes(phase))
    || (phases.indexOf(phase) < 10 ? quote !== null : quote === null)
    || quote && (!task || quote.request.creationKey !== task.creationKey || quote.request.materialRef !== task.materialRef
      || quote.request.expectedMaterialHash !== material?.materialHash)
    || quote && (phase === 'quote_pending' ? quote.material !== null : quote.material === null)) throw Error('client_goal_reference_invalid');
  return { version: row.version, owner, goal, material, task, phase, answer, continued: row.continued, quote };
}

export function createClientGoalSession(input: {
  context: ClientGoalContext; api: ClientGoalApi; now(): number; newKey(): string;
  storage: { read(): unknown; write(value: unknown): void; archive?(value: unknown): unknown }; changed(view: ClientGoalView): void;
  cancellation: { signal: ClientGoalSignal; cancel(): void };
}) {
  const owner = clientGoalStorageKey(input.context), abort = input.cancellation;
  let closed = false, busy = false, invalid = false, opened = false, held: unknown = null, saved: Locator | null = null;
  let host: Host | null = null, creation: Creation | null = null, snapshot: Snapshot | null = null;
  let originalTaskId: string | null = null;
  let question: Question = null, receipt: Receipt = null, projection: AiClientGoalProjection | null = null;
  let sources: ClientGoalFormSources | null = null, quote: AiClientQuoteFacts | null = null, view = blank();
  const current = () => !closed && input.context.current();
  const assertHeld = () => {
    if (!current()) throw Error('client_goal_context_changed');
    if (!same(input.storage.read() ?? null, held)) { invalid = true; throw Error('client_goal_original_replaced'); }
  };
  const persist = (value: Locator) => {
    assertHeld(); const next = parseLocator(value, owner);
    // localStorage comparison is not an atomic cross-tab CAS. Verify retention
    // before dispatch and fail closed on any observed replacement.
    input.storage.write(copy(next));
    if (!same(input.storage.read(), next)) { invalid = true; throw Error('client_goal_reference_not_retained'); }
    saved = copy(next); held = copy(next);
  };
  const fresh = (expiresAt: string | null | undefined) => Boolean(expiresAt && Date.parse(expiresAt) > input.now());
  const field = () => question?.contract.fields.length === 1 && question.contract.fields[0].fieldId === 'clarification_text'
    && question.contract.fields[0].kind === 'text' ? question.contract.fields[0] : null;
  const writable = () => Boolean(host?.enabled && host.policy.allowCreate && fresh(host.expiresAt));
  const emit = (status: ClientGoalView['status']) => {
    if (!current()) return;
    const active = !busy && !invalid, write = writable(), task = creation?.task
      ? { ...creation.task, ...(snapshot ? { revision: snapshot.revision, status: snapshot.status } : {}) } : null;
    view = { status, hasLocator: Boolean(saved), task, question, receipt, projection, sources,
      selection: saved?.quote ? copy(saved.quote.request.input) : null, quote,
      canExtract: active && write && status === 'ready' && (!saved || saved.phase === 'goal_ready' && fresh(saved.material?.expiresAt)
        || saved.phase === 'task_ready' && task?.status === 'queued'),
      canRead: active && Boolean(saved && host?.policy.allowRead),
      canSubmit: active && write && status === 'waiting_input' && Boolean(field() && fresh(question?.expiresAt) && saved?.task
        && (!saved.answer || saved.answer.submission.requestId !== question?.requestId) && !unresolved(saved.phase)),
      canContinue: active && write && status === 'input_saved' && Boolean(saved?.answer && receipt && saved.phase === 'answered'
        && !saved.continued && task?.status === 'running'),
      canPrepareQuote: active && write && Boolean(host?.capabilities.bookingDrafts && status === 'candidates'
        && projection?.state === 'requires_input' && sources && saved?.phase === 'candidates' && !saved.quote && fresh(saved.material?.expiresAt)),
      canConfirmQuote: active && write && Boolean(host?.capabilities.bookingDrafts && status === 'prepared'
        && saved?.phase === 'quote_prepared' && fresh(saved.quote?.material?.expiresAt)),
      canSelect: active && write && Boolean(status === 'quoted' && saved?.phase === 'quoted' && quote && fresh(quote.expiresAt)),
      canStartNew: active && write && typeof input.storage.archive === 'function'
        && Boolean(saved?.task && ['candidates','quoted'].includes(saved.phase)),
      readOnly: !write };
    input.changed(copy(view));
  };
  const recheck = async (purpose: 'read' | 'create' | 'control' | 'quote') => {
    assertHeld(); const next = aiClientHostCapabilitiesSchema.parse(await input.api.readHost(abort.signal)); assertHeld();
    if (next.tenantCode !== input.context.tenantCode || next.serviceCode !== input.context.serviceCode
      || next.customerId !== input.context.customerId || next.customerType !== 'personal' || next.surface !== input.context.surface
      || !next.policy.allowRead || !fresh(next.expiresAt) || host && !same(host.scope, next.scope)) throw Error('client_goal_scope_changed');
    host = next;
    if (purpose !== 'read' && !writable() || purpose === 'quote' && !next.capabilities.bookingDrafts) throw Error('client_goal_write_unavailable');
  };
  const acceptGoal = (value: unknown) => {
    assertHeld(); const result = aiClientGoalPreparationResponseSchema.parse(value);
    if (!saved || result.operationKey !== saved.goal.operationKey || result.goalHash !== saved.goal.goalHash) throw Error('client_goal_origin_changed');
    if (result.state === 'observed') {
      const material = materialLocator({ materialRef: result.materialRef, materialHash: result.materialHash, inputHash: result.inputHash, expiresAt: result.expiresAt });
      if (saved.material && !same(saved.material, material)) throw Error('client_goal_origin_changed');
      if (saved.phase === 'goal_pending') persist({ ...saved, material, phase: 'goal_ready' });
    }
    return result;
  };
  const acceptCreation = (value: unknown) => {
    assertHeld(); const result = aiClientTaskCreationReceiptSchema.parse(value);
    if (!saved?.task || result.creationKey !== saved.task.creationKey || result.materialRef !== saved.task.materialRef
      || creation?.task && result.task && (creation.task.taskId !== result.task.taskId || creation.inputRef !== result.inputRef
        || creation.inputHash !== result.inputHash)) throw Error('client_goal_task_changed');
    creation = result;
    if (result.state === 'observed' && result.task) {
      if (originalTaskId && originalTaskId !== result.task.taskId) throw Error('client_goal_task_changed');
      originalTaskId = result.task.taskId;
    }
    if (result.state === 'observed' && saved.phase === 'task_pending') persist({ ...saved, phase: 'task_ready' });
    return result;
  };
  const acceptProjection = (value: unknown, resultId?: string) => {
    assertHeld(); const next = aiClientGoalProjectionSchema.parse(value);
    if (!saved?.material || next.original.materialRef !== saved.material.materialRef || next.original.materialHash !== saved.material.materialHash
      || next.original.goalHash !== saved.goal.goalHash || next.model.taskId !== creation?.task?.taskId
      || snapshot && next.model.taskRevision < snapshot.revision || resultId && next.model.resultId !== resultId
      || new Set(next.choices.map(group => group.field)).size !== next.choices.length
      || next.choices.some(group => new Set(group.choices.map(choice => choice.id)).size !== group.choices.length)) throw Error('client_goal_candidates_changed');
    try { new Intl.DateTimeFormat('en', { timeZone: next.context.timeZone }).format(0); } catch { throw Error('client_goal_time_zone_unavailable'); }
    projection = next; return next;
  };
  const candidatesRequest = () => aiClientGoalCandidatesRequestSchema.parse({ ...saved?.task, expectedMaterialHash: saved?.material?.materialHash });
  const readFormSources = async () => {
    const rows = await Promise.allSettled([input.api.readCatalog(abort.signal), input.api.readEnterprisePolicies(abort.signal),
      host?.capabilities.savedDeliveryAddresses ? input.api.readAddresses(abort.signal) : Promise.resolve(null)]);
    assertHeld();
    if (rows[0].status !== 'fulfilled') throw Error('client_goal_catalog_unavailable');
    const catalog = rows[0].value as Record<string, unknown>, workspace = catalog?.workspace as Record<string, unknown>;
    const fulfillment = catalog?.fulfillment as ClientGoalFormSources['fulfillment'];
    if (!projection || catalog.tenantCode !== input.context.tenantCode || workspace?.workspaceCode !== input.context.serviceCode
      || catalog.categoryCode !== projection.context.categoryCode || catalog.timeZone !== projection.context.timeZone
      || !fulfillment || !Array.isArray(fulfillment.enabledModes) || fulfillment.enabledModes.some(mode => !RENTAL_FULFILLMENT_MODES.includes(mode))
      || typeof fulfillment.allowDifferentReturnLocation !== 'boolean' || !['customer_address','tenant_location'].includes(fulfillment.deliveryDestination)) throw Error('client_goal_catalog_changed');
    let enterprises: EnterpriseOwnRentalPolicy[] | null = null, addresses: { id: string; label: string }[] | null = null;
    if (rows[1].status === 'fulfilled' && Array.isArray(rows[1].value)) {
      const list = rows[1].value as EnterpriseOwnRentalPolicy[];
      if (list.length <= 200 && new Set(list.map(row => row?.corporateCustomerId)).size === list.length
        && list.every(row => row && localId(row.corporateCustomerId) && localId(row.membershipId)
        && row.workspaceId === host?.scope.workspaceId && typeof row.corporateName === 'string' && row.corporateName.length <= 255
        && ['available','personalPaymentAllowed','enterprisePaymentAllowed'].every(key => typeof row[key as keyof EnterpriseOwnRentalPolicy] === 'boolean')
        && (row.noticeVersion === undefined || localId(row.noticeVersion)) && (row.noticeText === undefined || typeof row.noticeText === 'string' && row.noticeText.length <= 20000))) {
        enterprises = list.map(row => ({ corporateCustomerId: row.corporateCustomerId, corporateName: row.corporateName, membershipId: row.membershipId,
          workspaceId: row.workspaceId, available: row.available, personalPaymentAllowed: row.personalPaymentAllowed,
          enterprisePaymentAllowed: row.enterprisePaymentAllowed, approvalMode: row.approvalMode,
          ...(row.noticeVersion ? { noticeVersion: row.noticeVersion } : {}), ...(row.noticeText ? { noticeText: row.noticeText } : {}) }));
      }
    }
    if (rows[2].status === 'fulfilled' && rows[2].value && typeof rows[2].value === 'object') {
      const list = (rows[2].value as { items?: unknown }).items;
      if (Array.isArray(list) && list.length <= 100 && list.every(row => row && localId(row.id) && typeof row.recipient === 'string'
        && typeof row.city === 'string' && typeof row.detail === 'string' && row.detail.length <= 500)) {
        addresses = list.map(row => ({ id: row.id as string, label: `${row.recipient} · ${row.city} ${row.detail}` }));
      }
    }
    sources = { fulfillment: { enabledModes: [...fulfillment.enabledModes], allowDifferentReturnLocation: fulfillment.allowDifferentReturnLocation,
      deliveryDestination: fulfillment.deliveryDestination }, enterprises, addresses };
  };
  const quoteReference = () => aiClientQuoteConfirmationRequestSchema.parse({ materialRef: saved?.quote?.material?.materialRef,
    expectedMaterialHash: saved?.quote?.material?.materialHash });
  const acceptQuoteMaterial = (value: Material) => {
    assertHeld(); if (!saved?.quote || saved.quote.material && !same(saved.quote.material, value)) throw Error('client_goal_quote_material_changed');
    if (saved.phase === 'quote_pending') persist({ ...saved, quote: { ...saved.quote, material: value }, phase: 'quote_prepared' });
  };
  const observeQuote = (value: unknown) => {
    assertHeld(); const result = aiClientQuoteResultReadResponseSchema.parse(value), reference = quoteReference();
    if (result.source.materialRef !== reference.materialRef || result.source.materialHash !== reference.expectedMaterialHash
      || quote && result.quote && quote.quoteId !== result.quote.quoteId) throw Error('client_goal_quote_changed');
    quote = result.quote;
    if (result.state === 'observed') persist({ ...saved!, phase: 'quoted' });
    return result.state === 'observed' ? 'quoted' as const : 'unknown' as const;
  };
  const readQuote = async (): Promise<ClientGoalView['status']> => {
    if (!saved?.quote) return 'unknown';
    const result = aiClientQuotePreparationReadResponseSchema.parse(await input.api.readGoalQuotePreparation(copy(saved.quote.request), abort.signal)); assertHeld();
    if (result.state === 'unknown') {
      if (result.operationKey !== saved.quote.request.operationKey) throw Error('client_goal_quote_origin_changed');
      return 'unknown';
    }
    acceptQuoteMaterial(materialLocator({ materialRef: result.materialRef, materialHash: result.materialHash, inputHash: result.inputHash, expiresAt: result.expiresAt }));
    if (saved.phase === 'confirmation_pending' || saved.phase === 'quoted') return observeQuote(await input.api.readQuoteOriginal(quoteReference(), abort.signal));
    return 'prepared';
  };
  const readOriginal = async (): Promise<ClientGoalView['status']> => {
    if (!saved) return 'ready';
    // Original quote receipts remain readable independently of a later expired
    // goal or changed model candidates. They never revive the old parameters.
    if (saved.quote) return readQuote();
    if (acceptGoal(await input.api.readGoalPreparation(copy(saved.goal), abort.signal)).state !== 'observed') return 'unknown';
    if (!saved.task) return 'ready';
    const created = acceptCreation(await input.api.readCreation(copy(saved.task), abort.signal));
    if (created.state !== 'observed' || !created.task) return 'unknown';
    const nextSnapshot = aiClientTaskSnapshotReadResponseSchema.parse(await input.api.readSnapshot(copy(saved.task), abort.signal)); assertHeld();
    if (nextSnapshot.taskId !== created.task.taskId || nextSnapshot.revision < created.task.revision
      || snapshot && nextSnapshot.revision < snapshot.revision) throw Error('client_goal_task_changed');
    snapshot = nextSnapshot;
    const model = aiClientTaskModelResultReadResponseSchema.parse(await input.api.readModelResult(copy(saved.task), abort.signal)); assertHeld();
    if (model.taskId !== created.task.taskId || model.taskRevision < snapshot.revision) throw Error('client_goal_result_changed');
    const pending = aiClientTaskInputReadResponseSchema.parse(await input.api.readInput(copy(saved.task), abort.signal)); assertHeld();
    question = pending.question; receipt = null; projection = null; sources = null;
    if (saved.answer) {
      const original = aiClientTaskInputReceiptReadResponseSchema.parse(await input.api.readInputReceipt(copy(saved.answer), abort.signal)); assertHeld();
      if (original.state === 'observed') {
        if (original.receipt.taskId !== created.task.taskId || original.receipt.requestId !== saved.answer.submission.requestId
          || original.receipt.taskRevision <= saved.answer.submission.expectedRevision) throw Error('client_goal_answer_changed');
        receipt = original.receipt;
        if (saved.phase === 'answer_pending') persist({ ...saved, phase: 'answered' });
      }
    }
    if (['cancel_requested','cancelled','failed'].includes(snapshot.status) || model.workflowStatus === 'failed' || model.workflowStatus === 'cancelled') {
      question = null; return 'unavailable';
    }
    if (model.state === 'observed' && model.resultPurpose === 'answer' && model.result?.status === 'succeeded') {
      const projected = acceptProjection(await input.api.readGoalCandidates(candidatesRequest(), abort.signal), model.result.resultId);
      if (projected.state !== 'requires_input') return projected.state === 'failed' ? 'unavailable' : 'unknown';
      persist({ ...saved, phase: 'candidates', answer: null, continued: false });
      question = null; receipt = null; await readFormSources(); return 'candidates';
    }
    if (saved.answer && !receipt) return 'unknown';
    if (question) {
      if (saved.phase === 'model_pending' && snapshot.status === 'waiting_input' && model.resultPurpose === 'clarification'
        && model.result?.status === 'succeeded') persist({ ...saved, phase: 'model_active' });
      if (saved.answer && saved.answer.submission.requestId !== question.requestId) {
        if (!saved.continued || !receipt) throw Error('client_goal_question_changed');
        persist({ ...saved, phase: 'model_active', answer: null, continued: false }); receipt = null;
      }
      return 'waiting_input';
    }
    if (receipt && !saved.continued) return 'input_saved';
    if (saved.phase === 'task_ready' && snapshot.status === 'queued') return 'ready';
    return unresolved(saved.phase) ? 'unknown' : 'running';
  };
  const operate = async (purpose: 'read' | 'create' | 'control' | 'quote', action: () => Promise<ClientGoalView['status']>) => {
    if (busy || !opened || !current() || invalid) return;
    busy = true; emit('working'); let status: ClientGoalView['status'] = 'unavailable';
    try { await recheck(purpose); status = await action(); await recheck('read'); }
    catch { creation = null; snapshot = null; question = null; receipt = null; projection = null; sources = null; quote = null;
      status = saved && unresolved(saved.phase) ? 'unknown' : 'unavailable'; }
    finally { busy = false; emit(status); }
  };
  const validateSelection = (selection: ClientCreateQuoteRequest) => {
    const selected = clientGoalSelectedInput(selection), choices = projection?.choices;
    const allowed = (fieldId: string, value: string | undefined) => Boolean(value && choices?.find(group => group.field === fieldId)?.choices.some(choice => choice.id === value));
    if (!projection?.candidates?.conditions.items || selected.lines.length !== projection.candidates.conditions.items.length
      || selected.lines.some((line, index) => !allowed(`items.${index}.itemGroupId`, line.itemGroupId) || !allowed(`items.${index}.pricingUnit`, line.pricingUnit))
      || !allowed('fulfillmentMode', selected.fulfillmentMode) || !allowed('fulfillmentLocationId', selected.fulfillmentLocationId)
      || selected.returnLocationId && !allowed('returnLocationId', selected.returnLocationId)
      || !allowed('bookingIdentity', selected.bookingIdentity?.bookingIdentity === 'personal' ? 'personal' : selected.bookingIdentity?.corporateCustomerId)
      || Date.parse(selected.startAt) <= input.now() || !sources?.fulfillment.enabledModes.includes(selected.fulfillmentMode)
      || selected.returnLocationId && !sources.fulfillment.allowDifferentReturnLocation && selected.returnLocationId !== selected.fulfillmentLocationId) throw Error('client_goal_selection_changed');
    const delivery = ['delivery','onsite_delivery'].includes(selected.fulfillmentMode) && sources.fulfillment.deliveryDestination === 'customer_address';
    if (delivery ? !sources.addresses?.some(row => row.id === selected.deliveryAddressId) : selected.deliveryAddressId !== undefined) throw Error('client_goal_address_unavailable');
    if (selected.bookingIdentity?.bookingIdentity === 'enterprise_employee') {
      const policy = sources.enterprises?.find(row => row.corporateCustomerId === selected.bookingIdentity?.corporateCustomerId);
      if (!policy?.available || !policy.noticeVersion || !policy.noticeText || policy.noticeVersion !== selected.bookingIdentity.enterpriseDisclosure?.noticeVersion
        || (selected.bookingIdentity.enterpriseContractAndPayer ? !policy.enterprisePaymentAllowed : !policy.personalPaymentAllowed)) throw Error('client_goal_enterprise_unavailable');
    }
    return selected;
  };
  const session = {
    snapshot: () => copy(view),
    async open() {
      if (busy || opened || !current()) return;
      busy = true; let status: ClientGoalView['status'] = 'unavailable';
      try { held = copy(input.storage.read() ?? null); if (held !== null) {
        try { saved = parseLocator(held, owner); } catch { invalid = true; throw Error('client_goal_reference_invalid'); }
      }
      opened = true; await recheck('read'); status = saved ? 'unknown' : 'ready'; }
      catch { status = 'unavailable'; }
      finally { busy = false; emit(status); }
    },
    refresh() { return operate('read', readOriginal); },
    async extract(goalText: string) {
      if (!view.canExtract) return;
      return operate('create', async () => {
        if (!saved) {
          const command = aiClientGoalPreparationRequestSchema.parse({ operationKey: input.newKey(), goalText });
          const goalHash = await clientGoalTextHash(command.goalText); assertHeld();
          persist({ version: 'client-goal-operation-1', owner, goal: { operationKey: command.operationKey, goalHash }, material: null,
            task: null, phase: 'goal_pending', answer: null, continued: false, quote: null });
          if (acceptGoal(await input.api.prepareGoal(command, abort.signal)).state !== 'observed') return 'unknown';
        }
        if (saved!.phase === 'goal_ready') {
          await recheck('create'); if (!fresh(saved!.material?.expiresAt)) return 'unavailable';
          const task = aiClientTaskReadRequestSchema.parse({ creationKey: input.newKey(), materialRef: saved!.material!.materialRef });
          persist({ ...saved!, task, phase: 'task_pending' });
          if (acceptCreation(await input.api.createTask(copy(task), abort.signal)).state !== 'observed') return 'unknown';
        }
        if (saved!.phase !== 'task_ready' || creation?.task?.status !== 'queued') return 'unknown';
        await recheck('control'); persist({ ...saved!, phase: 'model_pending' });
        const result = aiClientTaskModelControlResponseSchema.parse(await input.api.startModel(copy(saved!.task!), abort.signal)); assertHeld();
        if (result.execution.kind === 'not_started') return 'unavailable';
        if (result.execution.outcome.status !== 'unknown') persist({ ...saved!, phase: 'model_active' });
        return readOriginal();
      });
    },
    async submitClarification(text: string) {
      if (!view.canSubmit || !saved?.task || !question) return;
      const original = copy(question), textField = field();
      if (!textField || !text.trim() || text.length > textField.maxLength) throw Error('client_goal_clarification_invalid');
      return operate('control', async () => {
        const latest = aiClientTaskInputReadResponseSchema.parse(await input.api.readInput(copy(saved!.task!), abort.signal)); assertHeld();
        if (latest.state !== 'pending' || !same(latest.question, original) || !fresh(original.expiresAt)) throw Error('client_goal_question_changed');
        const answer = aiClientTaskInputSubmissionRequestSchema.parse({ ...saved!.task, submission: { draftVersion: AI_TASK_INPUT_DRAFT_VERSION,
          requestId: original.requestId, expectedRevision: original.revision, submissionKey: input.newKey(), answers: [{ fieldId: 'clarification_text', value: text }] } });
        persist({ ...saved!, answer, phase: 'answer_pending', continued: false });
        const result = aiClientTaskInputSubmissionReceiptSchema.parse(await input.api.submitInput(copy(answer), abort.signal)); assertHeld();
        if (result.taskId !== creation?.task?.taskId || result.requestId !== original.requestId) throw Error('client_goal_answer_changed');
        persist({ ...saved!, phase: 'answered' }); return readOriginal();
      });
    },
    async continueAnswer() {
      if (!view.canContinue || !saved?.answer || saved.continued) return;
      return operate('control', async () => {
        const original = aiClientTaskInputReceiptReadResponseSchema.parse(await input.api.readInputReceipt(copy(saved!.answer!), abort.signal)); assertHeld();
        if (original.state !== 'observed' || original.receipt.taskId !== creation?.task?.taskId
          || original.receipt.requestId !== saved!.answer!.submission.requestId) throw Error('client_goal_answer_unavailable');
        persist({ ...saved!, phase: 'continuation_pending', continued: true });
        const result = aiClientTaskModelControlResponseSchema.parse(await input.api.continueInput(copy(saved!.answer!), abort.signal)); assertHeld();
        if (result.execution.kind === 'not_started') return 'unavailable';
        if (result.execution.outcome.status !== 'unknown') persist({ ...saved!, phase: 'model_active' });
        return readOriginal();
      });
    },
    async prepareQuote(selection: ClientCreateQuoteRequest, expectedProjectionHash: string) {
      if (!view.canPrepareQuote || !saved?.task || !projection || saved.quote) return;
      const originalProjection = projection.projectionHash;
      if (expectedProjectionHash !== originalProjection) throw Error('client_goal_candidates_changed');
      return operate('quote', async () => {
        const latest = acceptProjection(await input.api.readGoalCandidates(candidatesRequest(), abort.signal));
        if (latest.state !== 'requires_input' || latest.projectionHash !== originalProjection) throw Error('client_goal_candidates_changed');
        await readFormSources(); const selected = validateSelection(selection); await recheck('quote');
        const request: AiClientGoalQuoteRequest = { ...candidatesRequest(), operationKey: input.newKey(), expectedProjectionHash: originalProjection,
          decision: 'prepare_original_quote', input: selected };
        persist({ ...saved!, quote: { request, material: null, timeZone: latest.context.timeZone }, phase: 'quote_pending' });
        const result = aiClientQuotePreparationResponseSchema.parse(await input.api.prepareGoalQuote(copy(request), abort.signal)); assertHeld();
        acceptQuoteMaterial(materialLocator({ materialRef: result.materialRef, materialHash: result.materialHash, inputHash: result.inputHash, expiresAt: result.expiresAt }));
        return readQuote();
      });
    },
    async confirmQuote() {
      if (!view.canConfirmQuote || saved?.phase !== 'quote_prepared') return;
      return operate('quote', async () => {
        if (await readQuote() !== 'prepared' || !fresh(saved!.quote?.material?.expiresAt)) return 'unknown';
        await recheck('quote'); persist({ ...saved!, phase: 'confirmation_pending' });
        return observeQuote(await input.api.confirmQuoteParameters(quoteReference(), abort.signal));
      });
    },
    async selectedInput(): Promise<ClientCreateQuoteRequest | null> {
      if (!view.canSelect) return null;
      let selected: ClientCreateQuoteRequest | null = null;
      await operate('quote', async () => {
        if (await readQuote() === 'quoted' && fresh(quote?.expiresAt) && saved?.quote) selected = copy(saved.quote.request.input);
        return quote ? 'quoted' : 'unknown';
      });
      if (!current() || !view.canSelect) return null;
      assertHeld(); return selected;
    },
    async selectedQuote(): Promise<ClientGoalBookingSource | null> {
      if (!view.canSelect) return null;
      let result: ClientGoalBookingSource | null = null;
      await operate('quote', async () => {
        if (await readQuote() !== 'quoted' || !fresh(quote?.expiresAt) || !saved?.quote || !quote) return 'unknown';
        const originalQuote = copy(quote), originalMaterial = copy(saved.quote.material);
        const catalog = await input.api.readCatalog(abort.signal); assertHeld();
        if (!catalog || typeof catalog !== 'object' || !('workspace' in catalog) || !('tenantCode' in catalog)
          || catalog.tenantCode !== input.context.tenantCode || !catalog.workspace || typeof catalog.workspace !== 'object'
          || !('workspaceCode' in catalog.workspace) || catalog.workspace.workspaceCode !== input.context.serviceCode
          || !('timeZone' in catalog) || typeof catalog.timeZone !== 'string' || !catalog.timeZone || catalog.timeZone.length > 128
          || saved.quote.timeZone && catalog.timeZone !== saved.quote.timeZone) throw Error('client_goal_time_zone_changed');
        new Intl.DateTimeFormat('en', { timeZone: catalog.timeZone }).format(0);
        if (await readQuote() !== 'quoted' || !quote || !fresh(quote.expiresAt)
          || !same(quote, originalQuote) || !same(saved.quote.material, originalMaterial)) throw Error('client_goal_quote_changed');
        result = { original: quoteReference(), selection: copy(saved.quote.request.input), timeZone: catalog.timeZone, quote: copy(quote) };
        return 'quoted';
      });
      if (!current() || !view.canSelect) return null;
      assertHeld(); return result;
    },
    /** Supplies the original selector to existing stop controls; it grants no
     * cancellation or execution permission without a current server read. */
    cancellationOrigin() {
      if (!current() || invalid || !saved?.task || !originalTaskId) return null;
      assertHeld(); return { reference: copy(saved.task), taskId: originalTaskId };
    },
    async readCancellationOrigin() {
      if (busy || !opened || !current() || invalid || !saved?.task) return null;
      await recheck('read');
      const created = acceptCreation(await input.api.readCreation(copy(saved.task), abort.signal));
      await recheck('read');
      return created.state === 'observed' ? session.cancellationOrigin() : null;
    },
    /** Original selectors may be used only for receipt recovery. Returning this
     * after expiry does not grant a new draft, confirmation or handoff. */
    quoteRecoveryReference() {
      if (!current() || invalid || !saved?.quote?.material) return null;
      assertHeld(); return quoteReference();
    },
    async beginNewGoal() {
      if (!view.canStartNew || !saved?.task || !input.storage.archive) return;
      return operate('create', async () => {
        const old = saved!;
        if (!['candidates','quoted'].includes(old.phase)) throw Error('client_goal_original_unresolved');
        // Current candidate expiry cannot revoke original result history. A
        // completed extraction can be left for a separately chosen new goal;
        // an unresolved original quote must still be observed before leaving.
        if (old.quote && await readQuote() !== 'quoted') throw Error('client_goal_original_unresolved');
        const created = acceptCreation(await input.api.readCreation(copy(old.task!), abort.signal));
        if (created.state !== 'observed' || !created.task) throw Error('client_goal_original_unresolved');
        const currentTask = aiClientTaskSnapshotReadResponseSchema.parse(await input.api.readSnapshot(copy(old.task!), abort.signal)); assertHeld();
        const model = aiClientTaskModelResultReadResponseSchema.parse(await input.api.readModelResult(copy(old.task!), abort.signal)); assertHeld();
        if (currentTask.taskId !== created.task.taskId || currentTask.revision < created.task.revision || currentTask.status !== 'succeeded'
          || model.taskId !== currentTask.taskId || model.taskRevision < currentTask.revision || model.state !== 'observed'
          || model.resultPurpose !== 'answer' || model.result?.status !== 'succeeded') throw Error('client_goal_original_unresolved');
        const closingTask = aiClientTaskSnapshotReadResponseSchema.parse(await input.api.readSnapshot(copy(old.task!), abort.signal)); assertHeld();
        if (!same(currentTask, closingTask)) throw Error('client_goal_original_changed');
        await recheck('create');
        // An explicit new goal retains the old journal before clearing only
        // this host's active pointer. Unknown operations never reach here.
        const archived = input.storage.archive!(copy(saved)); assertHeld();
        if (!same(archived, saved)) throw Error('client_goal_archive_not_retained');
        input.storage.write(null);
        if ((input.storage.read() ?? null) !== null) { invalid = true; throw Error('client_goal_reference_not_retained'); }
        held = null; saved = null; creation = null; snapshot = null; originalTaskId = null;
        question = null; receipt = null; projection = null; sources = null; quote = null;
        return 'ready';
      });
    },
    dispose() { closed = true; abort.cancel(); creation = null; snapshot = null; originalTaskId = null; question = null; receipt = null;
      projection = null; sources = null; quote = null; host = null; view = blank(); },
  };
  return Object.freeze(session);
}
