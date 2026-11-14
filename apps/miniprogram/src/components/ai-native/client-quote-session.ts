/** Human-selected client quote parameters and original-operation recovery.
 * Local references isolate delivery, never grant authority. Only explicit
 * prepare/confirm writes; lost acknowledgements are read, never replayed. */
import {
  aiClientHostCapabilitiesSchema, aiClientQuoteConfirmationRequestSchema, aiClientQuotePreparationRequestSchema,
  aiClientQuotePreparationResponseSchema, aiClientQuotePreparationReadResponseSchema, aiClientQuoteResultReadResponseSchema,
} from '../../vendor/shared-ai-client';
import type { AiClientHostCapabilities, AiClientQuotePreparationRequest, AiClientQuoteConfirmationRequest,
  AiClientQuotePreparationResponse, AiClientQuoteFacts, ClientCreateQuoteRequest, AiClientQuoteBookingRequest, AiBookingSelection,
  AiEntryActionDraft, AiBookingDraft, AiBookingHandoff, AiBookingOperationReadResponse } from '@rental-os/shared';
import { aiClientQuoteBookingRequestSchema, aiClientQuoteBookingPreparationResponseSchema, aiClientQuoteBookingOperationResponseSchema,
  aiEntryActionSchema, aiBookingSelectionSchema, aiBookingDraftSchema, aiBookingHandoffSchema,
  aiBookingOperationReadResponseSchema } from '../../vendor/shared-ai-client';

export interface ClientQuoteContext {
  tenantCode: string; serviceCode: string; customerId: string;
  surface: 'tenant_website' | 'client_miniprogram'; current(): boolean;
}
export interface ClientQuoteApi {
  prepare(value: AiClientQuotePreparationRequest): Promise<unknown>;
  readPreparation(value: AiClientQuotePreparationRequest): Promise<unknown>;
  confirm(value: AiClientQuoteConfirmationRequest): Promise<unknown>;
  readOriginal(value: AiClientQuoteConfirmationRequest): Promise<unknown>;
}
export interface ClientQuoteView {
  status: 'closed' | 'opening' | 'ready' | 'preparing' | 'prepared' | 'confirming' | 'checking' | 'quoted' | 'unknown' | 'unavailable' | 'invalidated';
  canPrepare: boolean; canConfirm: boolean; canRead: boolean; pendingCore: boolean; matchesInput: boolean;
  material: AiClientQuotePreparationResponse | null; quote: AiClientQuoteFacts | null;
  readOnly?: boolean;
}
interface Locator {
  version: 'client-quote-operation-1'; owner: string; request: AiClientQuotePreparationRequest;
  material: AiClientQuotePreparationResponse | null;
  phase: 'preparation_pending' | 'prepared' | 'confirmation_pending' | 'quote_observed';
}
const localObject = (value: unknown, keys: string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error('quote_reference_unavailable');
  return value as Record<string, unknown>;
};
const localId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const localDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
const optionalLocal = (record: Record<string, unknown>, keys: string[], validate: (value: unknown) => boolean) => keys.every(key => record[key] === undefined || validate(record[key]));
const parseLocator = (value: unknown): Locator => {
  const row = localObject(value, ['version','owner','request','material','phase']);
  if (row.version !== 'client-quote-operation-1' || typeof row.owner !== 'string' || row.owner.length > 1024
    || !['preparation_pending','prepared','confirmation_pending','quote_observed'].includes(String(row.phase))) throw Error('quote_reference_unavailable');
  const request = aiClientQuotePreparationRequestSchema.parse(row.request);
  return { version: row.version, owner: row.owner, request: { operationKey: request.operationKey, input: clientQuoteSelectedInput(request.input as ClientCreateQuoteRequest) },
    material: row.material === null ? null : aiClientQuotePreparationResponseSchema.parse(row.material), phase: row.phase as Locator['phase'] };
};
/** Preserve existing selected IDs/dates/quantities. Free text and full addresses
 * stay in the ordinary form; they must not enter another recovery cache. */
export function clientQuoteSelectedInput(value: ClientCreateQuoteRequest): ClientCreateQuoteRequest {
  const plain = JSON.parse(JSON.stringify(value)) as unknown;
  if (JSON.stringify(plain).length > 16384) throw Error('quote_parameters_unavailable');
  const row = localObject(plain, ['bookingIdentity','fulfillmentMode','fulfillmentLocationId','returnLocationId','startAt','endAt',
    'pricingPlanId','discountPlanId','customerCouponId','deliveryAddressId','lines','services']);
  if (!localId(row.fulfillmentMode) || !localId(row.fulfillmentLocationId) || !localDate(row.startAt) || !localDate(row.endAt)
    || !optionalLocal(row, ['returnLocationId','pricingPlanId','discountPlanId','customerCouponId','deliveryAddressId'], localId)
    || !Array.isArray(row.lines) || row.lines.length < 1 || row.lines.length > 100) throw Error('quote_parameters_unavailable');
  if (row.bookingIdentity !== undefined) {
    const identity = localObject(row.bookingIdentity, ['bookingIdentity','enterpriseContractAndPayer']);
    if (identity.bookingIdentity !== 'personal' || (identity.enterpriseContractAndPayer !== undefined && identity.enterpriseContractAndPayer !== false)) throw Error('quote_parameters_unavailable');
  }
  for (const value of row.lines) {
    const line = localObject(value, ['itemGroupId','pricingGroupId','quantity','usageQuantity','note']);
    if (!localId(line.itemGroupId) || !optionalLocal(line, ['pricingGroupId'], localId) || typeof line.quantity !== 'number'
      || !Number.isFinite(line.quantity) || line.quantity <= 0 || (line.note !== undefined && line.note !== '')
      || (line.usageQuantity !== undefined && (typeof line.usageQuantity !== 'number' || !Number.isFinite(line.usageQuantity) || line.usageQuantity < 0))) throw Error('quote_parameters_unavailable');
  }
  if (row.services !== undefined) {
    if (!Array.isArray(row.services) || row.services.length > 100) throw Error('quote_parameters_unavailable');
    for (const value of row.services) {
      const service = localObject(value, ['serviceId','quantity','scheduledStartAt','scheduledEndAt','serviceLocationId']);
      if (!localId(service.serviceId) || typeof service.quantity !== 'number' || !Number.isFinite(service.quantity) || service.quantity <= 0
        || !optionalLocal(service, ['scheduledStartAt','scheduledEndAt'], localDate) || !optionalLocal(service, ['serviceLocationId'], localId)) throw Error('quote_parameters_unavailable');
    }
  }
  return row as unknown as ClientCreateQuoteRequest;
}
export function clientQuoteOwner(context: Pick<ClientQuoteContext, 'tenantCode' | 'serviceCode' | 'customerId' | 'surface'>): string {
  return JSON.stringify([context.tenantCode, context.serviceCode, context.customerId, context.surface]);
}
export function clientQuoteStorageKey(context: Parameters<typeof clientQuoteOwner>[0]): string {
  return `rental-os:client-quote:${encodeURIComponent(clientQuoteOwner(context))}`;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const emptyView = (): ClientQuoteView => ({ status: 'closed', canPrepare: false, canConfirm: false, canRead: false,
  pendingCore: false, matchesInput: true, material: null, quote: null });

export function createClientQuoteSession(input: {
  context: ClientQuoteContext; api: ClientQuoteApi; readHost(): Promise<unknown>; now(): number; newKey(): string;
  selection(): ClientCreateQuoteRequest;
  storage: { read(): unknown; write(value: unknown): void };
  changed(view: ClientQuoteView): void;
}) {
  const owner = clientQuoteOwner(input.context);
  let closed = false, busy = false, locator: Locator | null = null, host: AiClientHostCapabilities | null = null;
  let view = emptyView();
  const current = () => !closed && input.context.current();
  const matches = () => {
    try { return !locator || same(locator.request.input, clientQuoteSelectedInput(input.selection())); } catch { return false; }
  };
  const emit = (status: ClientQuoteView['status'], quote: AiClientQuoteFacts | null = null) => {
    if (!current()) return;
    const writable = Boolean(host?.enabled && host.policy.allowCreate && host.capabilities.bookingDrafts && Date.parse(host.expiresAt) > input.now());
    const matchesInput = matches(), material = locator?.material ?? null;
    const pendingCore = locator?.phase === 'confirmation_pending' || (locator?.phase === 'quote_observed' && status !== 'quoted');
    view = { status, material, quote, matchesInput, pendingCore, readOnly: !writable,
      canPrepare: writable && !busy && ((!locator && status === 'ready') || (!matchesInput && status === 'prepared') || status === 'quoted'),
      canConfirm: writable && !busy && matchesInput && status === 'prepared' && locator?.phase === 'prepared'
        && Boolean(material && Date.parse(material.expiresAt) > input.now()),
      canRead: !busy && Boolean(locator && host?.policy.allowRead), };
    input.changed(copy(view));
  };
  const persist = (next: Locator) => {
    if (!current()) throw Error('quote_context_changed');
    const previous = input.storage.read();
    if (locator ? !same(previous, locator) : previous !== undefined && previous !== null)
      throw Error('quote_reference_changed');
    input.storage.write(copy(next));
    if (!same(input.storage.read(), next)) throw Error('quote_reference_not_retained');
    locator = copy(next);
  };
  const validateHost = (value: unknown) => {
    const serialized = JSON.stringify(value);
    if (!current() || !serialized || serialized.length > 8192) throw Error('quote_host_unavailable');
    const next = aiClientHostCapabilitiesSchema.parse(value);
    if (next.customerType !== 'personal' || next.customerId !== input.context.customerId || next.policy.allowRead !== true
      || next.tenantCode !== input.context.tenantCode || next.serviceCode !== input.context.serviceCode
      || next.surface !== input.context.surface || Date.parse(next.expiresAt) <= input.now()
      || (host && (next.scope.tenantId !== host.scope.tenantId || next.scope.workspaceId !== host.scope.workspaceId))) throw Error('quote_host_changed');
    return next;
  };
  const recheck = async (purpose: 'read' | 'write' = 'read') => {
    host = validateHost(await input.readHost());
    if (purpose === 'write' && (!host.enabled || !host.policy.allowCreate || !host.capabilities.bookingDrafts)) throw Error('quote_write_unavailable');
  };
  const observe = (value: unknown) => {
    const result = aiClientQuoteResultReadResponseSchema.parse(value), material = locator?.material;
    if (!material || result.source.materialRef !== material.materialRef || result.source.materialHash !== material.materialHash) throw Error('quote_source_changed');
    if (result.state === 'observed') {
      persist({ ...locator!, phase: 'quote_observed' });
      return result.quote;
    }
    return null;
  };
  const reference = () => aiClientQuoteConfirmationRequestSchema.parse({ materialRef: locator?.material?.materialRef,
    expectedMaterialHash: locator?.material?.materialHash });
  const operate = async (status: ClientQuoteView['status'], action: () => Promise<{ status: ClientQuoteView['status']; quote?: AiClientQuoteFacts | null }>, purpose: 'read' | 'write' = 'read') => {
    if (busy || !current()) return;
    busy = true; emit(status);
    let result: { status: ClientQuoteView['status']; quote?: AiClientQuoteFacts | null } = { status: 'unavailable' };
    try { await recheck(purpose); result = await action(); await recheck('read'); }
    catch { result = { status: locator && ['preparation_pending', 'confirmation_pending'].includes(locator.phase) ? 'unknown' : 'unavailable' }; }
    finally { busy = false; emit(result.status, result.quote ?? null); }
  };
  return Object.freeze({
    snapshot: () => copy(view),
    originalInput: () => locator ? copy(locator.request.input) : null,
    async open() {
      if (closed || busy || !current()) return;
      busy = true; emit('opening');
      let status: ClientQuoteView['status'] = 'unavailable';
      try {
        await recheck();
        const saved = input.storage.read();
        if (saved !== undefined && saved !== null) {
          const parsed = parseLocator(saved);
          if (parsed.owner !== owner) throw Error('quote_owner_changed');
          locator = { ...parsed, request: { operationKey: parsed.request.operationKey,
            input: clientQuoteSelectedInput(parsed.request.input as ClientCreateQuoteRequest) } };
          if (!same(saved, locator)) throw Error('quote_reference_changed');
          status = 'unknown'; // Reopening restores a locator, never a confirmation grant or old display.
        } else { clientQuoteSelectedInput(input.selection()); status = 'ready'; }
      } catch { status = 'unavailable'; }
      finally { busy = false; emit(status); }
    },
    async prepare() {
      if (!view.canPrepare || busy || !current()) return;
      const selection = clientQuoteSelectedInput(input.selection());
      return operate('preparing', async () => {
        if (!same(selection, clientQuoteSelectedInput(input.selection()))) throw Error('quote_input_changed');
        const request = { operationKey: input.newKey(), input: selection };
        aiClientQuotePreparationRequestSchema.parse(request);
        persist({ version: 'client-quote-operation-1', owner, request, material: null, phase: 'preparation_pending' });
        const material = aiClientQuotePreparationResponseSchema.parse(await input.api.prepare(copy(request)));
        if (!current() || !same(selection, clientQuoteSelectedInput(input.selection()))) throw Error('quote_input_changed');
        persist({ ...locator!, material, phase: 'prepared' });
        return { status: 'prepared' };
      }, 'write');
    },
    async confirm() {
      if (!view.canConfirm || busy || !current()) return;
      return operate('confirming', async () => {
        if (!matches() || !locator?.material || Date.parse(locator.material.expiresAt) <= input.now()) throw Error('quote_input_changed');
        persist({ ...locator, phase: 'confirmation_pending' });
        const result = await input.api.confirm(reference());
        if (!current() || !matches()) throw Error('quote_input_changed');
        const quote = observe(result);
        return { status: quote ? 'quoted' : 'unknown', quote };
      }, 'write');
    },
    async recover() {
      if (!view.canRead || busy || !current() || !locator) return;
      return operate('checking', async () => {
        if (locator!.phase === 'confirmation_pending' || locator!.phase === 'quote_observed') {
          const quote = observe(await input.api.readOriginal(reference()));
          return { status: quote ? 'quoted' : 'unknown', quote };
        }
        const observed = aiClientQuotePreparationReadResponseSchema.parse(await input.api.readPreparation(copy(locator!.request)));
        if (!current()) throw Error('quote_context_changed');
        if (observed.state === 'unknown') {
          if (observed.operationKey !== locator!.request.operationKey) throw Error('quote_source_changed');
          return { status: 'unknown' };
        }
        const material = aiClientQuotePreparationResponseSchema.parse(copy({ ...observed, state: undefined,
          retryable: undefined, execution: undefined, replayed: true }));
        if (locator!.material && !same({ ...locator!.material, replayed: true }, material)) throw Error('quote_source_changed');
        persist({ ...locator!, material, phase: 'prepared' });
        return { status: 'prepared' };
      });
    },
    dispose() {
      closed = true; host = null; locator = null; view = { ...emptyView(), status: 'invalidated' };
      input.changed(copy(view));
    },
  });
}

type BookingStage = 'preparation_pending' | 'material_ready' | 'draft_pending' | 'draft_ready' | 'selection_pending' | 'selected' | 'handoff_pending' | 'handoff_ready';
interface BookingLocator {
  version: 'client-quote-booking-operation-1'; owner: string; request: AiClientQuoteBookingRequest; stage: BookingStage;
  material: { materialRef: string; materialHash: string; inputHash: string; expiresAt: string } | null;
  createKey: string | null; chooseKey: string | null; handoffKey: string | null; draftId: string | null; handoffRef: string | null;
}
export interface ClientQuoteBookingView {
  status: 'idle' | 'checking' | 'material_ready' | 'draft_ready' | 'selected' | 'handoff_ready' | 'observed' | 'unknown' | 'unavailable' | 'invalidated';
  canPrepare: boolean; canSave: boolean; canChoose: boolean; canHandoff: boolean; canRead: boolean;
  draft: AiBookingDraft | null; handoff: AiBookingHandoff | null;
  readOnly?: boolean; observed?: boolean; operation?: AiBookingOperationReadResponse | null;
}
export interface ClientQuoteBookingApi {
  prepareBooking(value: AiClientQuoteBookingRequest): Promise<unknown>;
  readBookingPreparation(value: AiClientQuoteBookingRequest): Promise<unknown>;
  issueBookingAction(value: { materialRef: string; actionCode: 'CREATE_BOOKING_DRAFT' }): Promise<AiEntryActionDraft>;
  createBookingDraft(value: { action: AiEntryActionDraft; operationKey: string }): Promise<{ draft: AiBookingDraft; operation: string; replayed: boolean }>;
  readBookingDraft(value: { bookingDraftId: string }): Promise<AiBookingDraft>;
  chooseBookingDraft(value: { bookingDraftId: string; expectedRevision: number; inputFingerprint: string; operationKey: string; decision: 'continue_booking' }): Promise<{ draft: AiBookingDraft; replayed: boolean }>;
  handoffBookingDraft(value: { action: AiEntryActionDraft; operationKey: string }): Promise<{ handoff: AiBookingHandoff; replayed: boolean }>;
  readBookingOperation(value: { operationKey: string }): Promise<AiBookingOperationReadResponse>;
  readHandoff(value: { handoffRef: string }): Promise<AiBookingHandoff>;
}
const bookingStages: BookingStage[] = ['preparation_pending','material_ready','draft_pending','draft_ready','selection_pending','selected','handoff_pending','handoff_ready'];
const localUuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);
const localHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function parseBookingLocator(value: unknown): BookingLocator {
  const keys = ['version','owner','request','stage','material','createKey','chooseKey','handoffKey','draftId','handoffRef'];
  const row = localObject(value, keys);
  if (Object.keys(row).length !== keys.length || row.version !== 'client-quote-booking-operation-1'
    || typeof row.owner !== 'string' || row.owner.length > 1024 || !bookingStages.includes(row.stage as BookingStage)) throw Error('booking_locator_changed');
  const request = aiClientQuoteBookingRequestSchema.parse(row.request), stage = row.stage as BookingStage;
  const key = (field: string): string | null => {
    const value = row[field]; if (value === null) return null;
    if (!localId(value)) throw Error('booking_locator_changed'); return value;
  };
  const ref = (field: string): string | null => {
    const value = row[field]; if (value === null) return null;
    if (!localUuid(value)) throw Error('booking_locator_changed'); return value;
  };
  let material: BookingLocator['material'] = null;
  if (row.material !== null) {
    const source = localObject(row.material, ['materialRef','materialHash','inputHash','expiresAt']);
    if (Object.keys(source).length !== 4 || !localUuid(source.materialRef) || !localHash(source.materialHash)
      || !localHash(source.inputHash) || !localDate(source.expiresAt)) throw Error('booking_locator_changed');
    material = { materialRef: source.materialRef, materialHash: source.materialHash, inputHash: source.inputHash, expiresAt: source.expiresAt };
  }
  const createKey = key('createKey'), chooseKey = key('chooseKey'), handoffKey = key('handoffKey'), draftId = ref('draftId'), handoffRef = ref('handoffRef');
  const index = bookingStages.indexOf(stage);
  if ((index === 0 ? material !== null : material === null) || (index < 2 && (createKey || chooseKey || handoffKey || draftId || handoffRef))
    || (index >= 2 && !createKey) || (index >= 3 && !draftId) || (index >= 4 && !chooseKey) || (index >= 6 && !handoffKey)
    || (index === 7 && !handoffRef) || (index < 4 && chooseKey !== null) || (index < 6 && handoffKey !== null)
    || (index < 7 && handoffRef !== null) || (index < 3 && draftId !== null)) throw Error('booking_locator_changed');
  return { version: 'client-quote-booking-operation-1', owner: row.owner, request, stage, material, createKey, chooseKey, handoffKey, draftId, handoffRef };
}
export function clientQuoteBookingStoredRequest(value: unknown): AiClientQuoteBookingRequest {
  return copy(parseBookingLocator(value).request);
}
/** Consume the original server booking protocol. Persist only source/operation
 * references and selected inputs, never cached Actions or authority. Every
 * ambiguous stage observes its original operation before any successor. */
export function createClientQuoteBookingSession(input: {
  context: ClientQuoteContext; original: AiClientQuoteConfirmationRequest; selection(): AiBookingSelection;
  api: ClientQuoteBookingApi; readHost(): Promise<unknown>; now(): number; newKey(): string;
  storage: { read(): unknown; write(value: unknown): void }; changed(view: ClientQuoteBookingView): void;
}) {
  const owner = clientQuoteOwner(input.context), initialSelection = copy(aiBookingSelectionSchema.parse(input.selection()));
  let closed = false, busy = false, invalidCache = false, saved: BookingLocator | null = null, host: AiClientHostCapabilities | null = null;
  let action: AiEntryActionDraft | null = null, draft: AiBookingDraft | null = null, handoff: AiBookingHandoff | null = null;
  let observed = false, detailUnavailable = false, operation: AiBookingOperationReadResponse | null = null;
  let view: ClientQuoteBookingView = { status: 'idle', canPrepare: false, canSave: false, canChoose: false, canHandoff: false,
    canRead: false, draft: null, handoff: null, readOnly: true, observed: false, operation: null };
  const current = () => {
    try { return !closed && input.context.current() && same(initialSelection, aiBookingSelectionSchema.parse(input.selection())); }
    catch { return false; }
  };
  const writeNow = () => Boolean(host?.enabled && host.policy.allowCreate && host.capabilities.bookingDrafts
    && Date.parse(host.expiresAt) > input.now());
  const sourceUsable = () => Boolean(saved?.material && Date.parse(saved.material.expiresAt) > input.now());
  const draftUsable = () => Boolean(draft && Date.parse(draft.expiresAt) > input.now()
    && ['draft_created','user_selected','handed_to_booking_page'].includes(draft.state));
  const emit = (status: ClientQuoteBookingView['status']) => {
    if (!current()) return;
    const writable = writeNow() && !detailUnavailable;
    view = { status, draft, handoff, observed, operation, readOnly: !writable || Boolean(saved && !sourceUsable())
      || Boolean(draft && !draftUsable()) || Boolean(handoff && Date.parse(handoff.expiresAt) <= input.now()),
      canPrepare: !busy && writable && !saved && !invalidCache && status === 'idle',
      canSave: !busy && writable && sourceUsable() && status === 'material_ready' && !saved?.createKey,
      canChoose: !busy && writable && sourceUsable() && draftUsable() && status === 'draft_ready' && draft?.state === 'draft_created' && !saved?.chooseKey,
      canHandoff: !busy && writable && sourceUsable() && draftUsable() && status === 'selected' && !saved?.handoffKey,
      canRead: !busy && !invalidCache && Boolean(saved && host?.policy.allowRead) };
    input.changed(copy(view));
  };
  const persist = (value: BookingLocator) => {
    if (!current()) throw Error('booking_context_changed');
    const closedValue = parseBookingLocator(value);
    const previous = input.storage.read();
    if (saved ? !same(previous, saved) : previous !== undefined && previous !== null)
      throw Error('booking_reference_changed');
    input.storage.write(copy(closedValue)); if (!same(closedValue, input.storage.read())) throw Error('booking_reference_not_retained');
    saved = copy(closedValue);
  };
  const recheck = async (purpose: 'read' | 'write') => {
    if (!current()) throw Error('booking_context_changed');
    const next = aiClientHostCapabilitiesSchema.parse(await input.readHost());
    if (!current() || next.policy.allowRead !== true || next.customerType !== 'personal'
      || next.customerId !== input.context.customerId || next.surface !== input.context.surface
      || next.tenantCode !== input.context.tenantCode || next.serviceCode !== input.context.serviceCode
      || Date.parse(next.expiresAt) <= input.now() || (host && !same(host.scope, next.scope))) throw Error('booking_host_changed');
    host = next;
    if (purpose === 'write' && !writeNow()) throw Error('booking_write_unavailable');
  };
  const checkAction = (value: AiEntryActionDraft, code: 'CREATE_BOOKING_DRAFT' | 'OPEN_BOOKING') => {
    const result = aiEntryActionSchema.parse(value);
    if (!saved?.material || !host || result.actionCode !== code || result.surface !== input.context.surface || !same(result.scope, host.scope)
      || result.associations.materialRef !== saved.material.materialRef || result.associations.quoteId !== initialSelection.quoteId
      || Date.parse(result.expiresAt) <= input.now() || (code === 'CREATE_BOOKING_DRAFT'
        ? result.resource.id !== initialSelection.quoteId || result.resource.resourceVersion !== saved.material.materialHash || result.inputFingerprint !== saved.material.inputHash
        : result.resource.id !== saved.draftId || result.associations.bookingDraftId !== saved.draftId)) throw Error('booking_action_changed');
    return copy(result);
  };
  const checkDraft = (value: AiBookingDraft, writing = false) => {
    const result = aiBookingDraftSchema.parse(value);
    // The journal retains human input; the bound material retains Core facts.
    // Only an omitted field with its original Core source can be filled. An
    // aggregate legacy label cannot confer missing service-field provenance.
    const suppliedServices = initialSelection.services ?? [], actualServices = result.material.selection.services ?? [];
    if (suppliedServices.length !== actualServices.length
      || new Set(suppliedServices.map(row => row.serviceId)).size !== suppliedServices.length
      || new Set(actualServices.map(row => row.serviceId)).size !== actualServices.length) throw Error('booking_draft_changed');
    const expectedServices = result.material.selection.services?.map(actual => {
      const matches = suppliedServices.filter(row => row.serviceId === actual.serviceId);
      if (matches.length !== 1 || matches[0].quantity !== actual.quantity) throw Error('booking_draft_changed');
      const chosen = matches[0], sources = result.material.serviceSources?.filter(row => row.serviceId === actual.serviceId);
      if (sources && sources.length !== 1) throw Error('booking_draft_changed');
      const fields = sources?.[0].fields;
      const expected = { ...chosen };
      for (const field of ['scheduledStartAt', 'scheduledEndAt', 'serviceLocationId'] as const) {
        if (chosen[field] === undefined && actual[field] !== undefined) {
          if (fields?.[field] !== 'core_normalized') throw Error('booking_draft_changed');
          expected[field] = actual[field];
        } else if (fields && fields[field] !== 'user_explicit') throw Error('booking_draft_changed');
      }
      return expected;
    });
    const originalReturn = initialSelection.returnLocationId === undefined
      && (result.material.sources.returnLocationId === 'core_normalized'
        || !writing && result.material.serviceSources === undefined && result.material.sources.returnLocationId === 'user_explicit');
    const expectedSelection = aiBookingSelectionSchema.parse({ ...initialSelection,
      ...(originalReturn ? { returnLocationId: result.material.selection.returnLocationId } : {}),
      ...(initialSelection.services !== undefined && expectedServices !== undefined ? { services: expectedServices } : {}) });
    if (!saved?.material || !host || result.surface !== input.context.surface || !same(result.scope, host.scope)
      || result.materialRef !== saved.material.materialRef || result.inputFingerprint !== saved.material.inputHash
      || !same(aiBookingSelectionSchema.parse(result.material.selection), expectedSelection)
      || (saved.draftId && result.bookingDraftId !== saved.draftId)
      || (writing && (Date.parse(result.expiresAt) <= input.now()
        || !['draft_created','user_selected','handed_to_booking_page'].includes(result.state)))) throw Error('booking_draft_changed');
    return copy(result);
  };
  const checkHandoff = (value: AiBookingHandoff, writing = false) => {
    const result = aiBookingHandoffSchema.parse(value);
    if (!host || !saved?.draftId || !draft || result.surface !== input.context.surface || !same(result.scope, host.scope)
      || result.bookingDraftId !== saved.draftId
      || !same(aiBookingSelectionSchema.parse(result.fields), aiBookingSelectionSchema.parse(draft.material.selection))
      || (writing && Date.parse(result.expiresAt) <= input.now())) throw Error('booking_handoff_changed');
    return copy(result);
  };
  const run = async (purpose: 'read' | 'write', work: () => Promise<ClientQuoteBookingView['status']>) => {
    if (busy || !current() || invalidCache) return;
    busy = true; observed = false; operation = null; detailUnavailable = false; emit('checking');
    let status: ClientQuoteBookingView['status'] = 'unavailable';
    try { await recheck(purpose); status = await work(); await recheck('read'); }
    catch { action = null; draft = null; handoff = null; observed = false; operation = null;
      status = saved && ['preparation_pending','draft_pending','selection_pending','handoff_pending'].includes(saved.stage) ? 'unknown' : 'unavailable'; }
    finally { busy = false; emit(status); }
  };
  const sourceMatches = (source: { materialRef: string; materialHash: string }) => source.materialRef === input.original.materialRef
    && source.materialHash === input.original.expectedMaterialHash;
  const session = {
    snapshot: () => copy(view),
    async open() {
      if (closed || busy || !current()) return;
      busy = true; let status: ClientQuoteBookingView['status'] = 'unavailable';
      try {
        await recheck('read');
        const value = input.storage.read();
        if (value !== undefined && value !== null) {
          let record: BookingLocator;
          try { record = parseBookingLocator(value); } catch { invalidCache = true; throw Error('booking_locator_changed'); }
          if (record.owner !== owner || !same(record.request.original, input.original)
            || !same(record.request.selection, initialSelection)) throw Error('booking_locator_changed');
          saved = record; invalidCache = false; status = 'unknown';
        } else status = 'idle';
      } catch { status = 'unavailable'; }
      finally { busy = false; emit(status); }
    },
    async prepare() {
      if (!view.canPrepare) return;
      return run('write', async () => {
        const request = aiClientQuoteBookingRequestSchema.parse({ original: input.original, selection: initialSelection, operationKey: input.newKey() });
        persist({ version: 'client-quote-booking-operation-1', owner, request, stage: 'preparation_pending', material: null,
          createKey: null, chooseKey: null, handoffKey: null, draftId: null, handoffRef: null });
        const result = aiClientQuoteBookingPreparationResponseSchema.parse(await input.api.prepareBooking(copy(request)));
        if (result.operationKey !== saved!.request.operationKey || !sourceMatches(result.source)) throw Error('booking_source_changed');
        if (result.state === 'unknown') return 'unknown';
        persist({ ...saved!, material: result.material, stage: 'material_ready' });
        action = checkAction(result.action, 'CREATE_BOOKING_DRAFT'); observed = true; return 'material_ready';
      });
    },
    async saveDraft() {
      if (!view.canSave || !saved?.material || saved.createKey) return;
      return run('write', async () => {
        action = checkAction(await input.api.issueBookingAction({ materialRef: saved!.material!.materialRef, actionCode: 'CREATE_BOOKING_DRAFT' }), 'CREATE_BOOKING_DRAFT');
        const operationKey = input.newKey(); persist({ ...saved!, stage: 'draft_pending', createKey: operationKey });
        const result = await input.api.createBookingDraft({ action, operationKey });
        if (result.operation !== operationKey) throw Error('booking_operation_changed');
        draft = checkDraft(result.draft, true); persist({ ...saved!, draftId: draft.bookingDraftId, stage: 'draft_ready' });
        observed = true; return 'draft_ready';
      });
    },
    async choose() {
      if (!view.canChoose || !draft || saved?.chooseKey) return;
      const previous = copy(draft);
      return run('write', async () => {
        const original = checkDraft(await input.api.readBookingDraft({ bookingDraftId: previous.bookingDraftId }), true);
        if (original.state !== 'draft_created' || original.revision !== previous.revision) throw Error('booking_revision_changed');
        const operationKey = input.newKey(); persist({ ...saved!, stage: 'selection_pending', chooseKey: operationKey });
        draft = checkDraft((await input.api.chooseBookingDraft({ bookingDraftId: original.bookingDraftId, expectedRevision: original.revision,
          inputFingerprint: original.inputFingerprint, operationKey, decision: 'continue_booking' })).draft, true);
        if (!draft.action) throw Error('booking_selection_unavailable'); draft.action = checkAction(draft.action, 'OPEN_BOOKING');
        persist({ ...saved!, stage: 'selected' }); observed = true; return 'selected';
      });
    },
    async handoff() {
      if (!view.canHandoff || !saved?.draftId || saved.handoffKey) return;
      return run('write', async () => {
        const original = checkDraft(await input.api.readBookingDraft({ bookingDraftId: saved!.draftId! }), true);
        if (!original.action) throw Error('booking_selection_unavailable');
        draft = original;
        const operationKey = input.newKey(); persist({ ...saved!, stage: 'handoff_pending', handoffKey: operationKey });
        handoff = checkHandoff((await input.api.handoffBookingDraft({ action: checkAction(original.action, 'OPEN_BOOKING'), operationKey })).handoff, true);
        persist({ ...saved!, stage: 'handoff_ready', handoffRef: handoff.handoffRef }); observed = true; return 'handoff_ready';
      });
    },
    async recover() {
      if (!view.canRead || !saved) return;
      return run('read', async () => {
        action = null; draft = null; handoff = null;
        if (['preparation_pending', 'material_ready'].includes(saved!.stage)) {
          const result = aiClientQuoteBookingOperationResponseSchema.parse(await input.api.readBookingPreparation(copy(saved!.request)));
          if (result.operationKey !== saved!.request.operationKey || !sourceMatches(result.source)) throw Error('booking_source_changed');
          if (result.state === 'unknown') return 'unknown';
          persist({ ...saved!, stage: 'material_ready', material: { materialRef: result.material.materialRef, materialHash: result.material.materialHash,
            inputHash: result.material.inputHash, expiresAt: result.material.expiresAt } });
          observed = true; return 'material_ready'; // Metadata only; no Action is requested by a read.
        }
        const stage = saved!.stage, operationKey = ['handoff_pending','handoff_ready'].includes(stage) ? saved!.handoffKey
          : ['selection_pending','selected'].includes(stage) ? saved!.chooseKey : saved!.createKey;
        if (!operationKey) throw Error('booking_operation_missing');
        const receipt = aiBookingOperationReadResponseSchema.parse(await input.api.readBookingOperation({ operationKey }));
        if (receipt.operationKey !== operationKey) throw Error('booking_operation_changed');
        if (receipt.state === 'unknown') return 'unknown';
        const expectedKind = ['handoff_pending','handoff_ready'].includes(stage) ? 'handoff' : ['selection_pending','selected'].includes(stage) ? 'select' : 'create';
        if (receipt.kind !== expectedKind || (saved!.draftId && receipt.bookingDraftId !== saved!.draftId)) throw Error('booking_operation_changed');
        operation = receipt; observed = true;
        if (expectedKind === 'handoff') {
          if (!receipt.handoffRef) throw Error('booking_handoff_missing');
          persist({ ...saved!, draftId: receipt.bookingDraftId, stage: 'handoff_ready', handoffRef: receipt.handoffRef });
          if (!writeNow() || !sourceUsable()) { detailUnavailable = true; return 'observed'; }
          try { draft = { ...checkDraft(await input.api.readBookingDraft({ bookingDraftId: receipt.bookingDraftId })), action: null };
            handoff = checkHandoff(await input.api.readHandoff({ handoffRef: receipt.handoffRef })); }
          catch { detailUnavailable = true; return 'observed'; }
          return 'handoff_ready';
        }
        persist({ ...saved!, draftId: receipt.bookingDraftId, stage: expectedKind === 'select' ? 'selected' : 'draft_ready' });
        if (!writeNow() || !sourceUsable()) { detailUnavailable = true; return 'observed'; }
        try { draft = { ...checkDraft(await input.api.readBookingDraft({ bookingDraftId: receipt.bookingDraftId })), action: null }; }
        catch { detailUnavailable = true; return 'observed'; }
        if (expectedKind === 'select') return 'selected';
        return draft.state === 'draft_created' ? 'draft_ready' : 'observed';
      });
    },
    async generateDraft() {
      if (view.canPrepare) await session.prepare();
      if (view.canSave) await session.saveDraft();
      return session.snapshot();
    },
    async continueBooking() {
      if (view.canChoose) await session.choose();
      if (view.canHandoff) await session.handoff();
      return session.snapshot();
    },
    dispose() { closed = true; action = null; draft = null; handoff = null; view = { ...view, status: 'invalidated', canPrepare: false,
      canSave: false, canChoose: false, canHandoff: false, canRead: false, draft: null, handoff: null, operation: null, observed: false, readOnly: true };
      input.changed(copy(view)); },
  };
  return Object.freeze(session);
}
