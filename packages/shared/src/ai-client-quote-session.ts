/** Human-selected client quote parameters and original-operation recovery.
 * Local references isolate delivery, never grant authority. Only explicit
 * prepare/confirm writes; lost acknowledgements are read, never replayed. */
import { aiClientHostCapabilitiesSchema, type AiClientHostCapabilities } from './ai-client-entry-draft-schemas';
import { aiClientQuoteConfirmationRequestSchema, aiClientQuotePreparationRequestSchema, aiClientQuoteReadRequestSchema,
  aiClientQuotePreparationResponseSchema, aiClientQuotePreparationReadResponseSchema, aiClientQuoteResultReadResponseSchema,
  aiClientPersonalQuoteSelectionSchema, type AiClientQuoteSelectionRef, type AiClientQuotePreparationRequest,
  type AiClientQuoteConfirmationRequest, type AiClientQuotePreparationResponse, type AiClientQuoteFacts } from './ai-client-quote-draft';
import type { ClientCreateQuoteRequest } from './client';
import { clientGoalFingerprint } from './ai-client-goal-fingerprint';
import { aiClientQuoteBookingRequestSchema, aiClientQuoteBookingPreparationResponseSchema, aiClientQuoteBookingOperationResponseSchema,
  aiClientBookingReadRequestSchema, clientBookingLegacyShape, type AiClientBookingReadRef, type AiClientQuoteBookingRequest } from './ai-client-quote-booking-draft';
import { aiEntryActionSchema, type AiEntryActionDraft } from './ai-entry-action-draft';
import { aiBookingSelectionSchema, type AiBookingSelection, type AiBookingDraft, type AiBookingHandoff, type AiBookingOperationReadResponse } from './ai-booking-draft';
import { aiBookingDraftSchema, aiBookingHandoffSchema, aiBookingOperationReadResponseSchema } from './ai-booking-validation';

export interface ClientQuoteContext {
  tenantCode: string; serviceCode: string; customerId: string;
  surface: 'tenant_website' | 'client_miniprogram'; current(): boolean;
}
export interface ClientQuoteApi {
  prepare(value: AiClientQuotePreparationRequest): Promise<unknown>;
  readPreparation(value: AiClientQuoteSelectionRef): Promise<unknown>;
  confirm(value: AiClientQuoteConfirmationRequest): Promise<unknown>;
  readOriginal(value: AiClientQuoteConfirmationRequest): Promise<unknown>;
}
export interface ClientQuoteView {
  status: 'closed' | 'opening' | 'ready' | 'preparing' | 'prepared' | 'confirming' | 'checking' | 'quoted' | 'unknown' | 'unavailable' | 'invalidated';
  canPrepare: boolean; canConfirm: boolean; canRead: boolean; pendingCore: boolean; matchesInput: boolean;
  material: AiClientQuotePreparationResponse | null; quote: AiClientQuoteFacts | null;
  /** This original response's server time; display only, never persisted. */
  quoteObservedAt?: string | null;
  readOnly?: boolean;
}
interface Locator {
  version: 'client-quote-operation-1'; owner: string; request: AiClientQuoteSelectionRef;
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
export const clientQuoteRecoveryLocator = (value: unknown, owner: string): Locator => {
  const row = localObject(value, ['version','owner','request','material','phase']);
  if (row.version !== 'client-quote-operation-1' || row.owner !== owner || owner.length > 1024
    || !['preparation_pending','prepared','confirmation_pending','quote_observed'].includes(String(row.phase))) throw Error('quote_reference_unavailable');
  const original = aiClientQuoteReadRequestSchema.parse(row.request);
  const request = 'selectionHash' in original ? original : { operationKey: original.operationKey, selectionHash: clientGoalFingerprint(clientQuoteSelectedInput(original.input as ClientCreateQuoteRequest)) };
  const material = row.material === null ? null : aiClientQuotePreparationResponseSchema.parse(row.material);
  if ((row.phase === 'preparation_pending') !== (material === null)) throw Error('quote_reference_unavailable');
  if (material) delete material.parameterReview;
  return { version: row.version, owner, request, material, phase: row.phase as Locator['phase'] };
};
/** Preserve existing selected IDs/dates/quantities. Free text and full addresses
 * stay in the ordinary form; they must not enter another recovery cache. */
export function clientQuoteSelectedInput(value: ClientCreateQuoteRequest): ClientCreateQuoteRequest {
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 16384) throw Error('quote_parameters_unavailable');
  return aiClientPersonalQuoteSelectionSchema.parse(JSON.parse(serialized)) as ClientCreateQuoteRequest;
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

/** One local deadline withdraws a live observation. It never polls or renews a
 * server grant, and a delayed/adjusted clock can only shorten its local use. */
function createClientQuoteExpiry(now: () => number, withdraw: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined, deadline: number | undefined;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined; deadline = undefined;
  };
  return {
    clear,
    schedule(values: Array<string | null | undefined>): boolean {
      const dates = values.filter((value): value is string => value !== undefined && value !== null).map(value => Date.parse(value));
      const current = now();
      if (!Number.isFinite(current) || dates.some(value => !Number.isFinite(value))) { clear(); return false; }
      if (!dates.length) { clear(); return true; }
      const next = Math.min(...dates);
      if (next <= current) { clear(); return false; }
      if (deadline === next && timer !== undefined) return true;
      clear(); deadline = next;
      timer = setTimeout(() => { timer = undefined; deadline = undefined; withdraw(); }, Math.min(next - current, 300000));
      return true;
    }
  };
}

const preparationBasis = (value: AiClientQuotePreparationResponse) => {
  const { replayed: _replayed, parameterReview: _review, ...basis } = value;
  return basis;
};

export function createClientQuoteSession(input: {
  context: ClientQuoteContext; api: ClientQuoteApi; readHost(): Promise<unknown>; now(): number; newKey(): string;
  selection(): ClientCreateQuoteRequest;
  storage: { read(): unknown; write(value: unknown): void };
  changed(view: ClientQuoteView): void;
}) {
  const owner = clientQuoteOwner(input.context);
  let closed = false, busy = false, locator: Locator | null = null, host: AiClientHostCapabilities | null = null;
  let serverMaterial: AiClientQuotePreparationResponse | null = null, locallyExpired = false;
  let selectedOriginal: ClientCreateQuoteRequest | null = null;
  let quoteObservedAt: string | null = null;
  let view = emptyView();
  const current = () => { try { return !closed && input.context.current(); } catch { return false; } };
  const matches = () => {
    try { return !locator || locator.request.selectionHash === clientGoalFingerprint(clientQuoteSelectedInput(input.selection())); } catch { return false; }
  };
  const withdraw = () => { locallyExpired = true; serverMaterial = null; expiry.clear(); };
  const expiry = createClientQuoteExpiry(input.now, () => { withdraw(); emit(view.status, view.quote); });
  const updateExpiry = () => {
    if (!current()) { withdraw(); return; }
    if (!locallyExpired && !expiry.schedule([host?.expiresAt,
      locator?.phase === 'quote_observed' ? undefined : locator?.material?.expiresAt])) withdraw();
  };
  const assertReference = () => {
    if (!current() || locator && !same(input.storage.read(), locator)) throw Error('quote_reference_changed');
  };
  const checkedMaterial = (value: unknown, selected: ClientCreateQuoteRequest | null) => {
    const material = aiClientQuotePreparationResponseSchema.parse(value);
    if (!selected) throw Error('quote_source_changed');
    const review = material.parameterReview;
    if (review && (review.lines.length !== selected.lines.length || review.lines.some((line, index) => {
      const original = selected.lines[index];
      return line.lineIndex !== index || line.itemGroupId !== original.itemGroupId || line.pricingGroupId !== original.pricingGroupId
        || line.quantity !== original.quantity || (original.pricingUnit !== undefined
          ? line.source !== 'user_explicit' || line.basis !== 'user_input' || line.pricingUnit !== original.pricingUnit
          : line.source !== 'server_default' || line.basis !== (original.pricingGroupId ? 'pricing_group_default' : 'business_settings_default'));
    }))) throw Error('quote_parameter_review_changed');
    return material;
  };
  const readPreparation = async () => {
    assertReference();
    const observed = aiClientQuotePreparationReadResponseSchema.parse(await input.api.readPreparation(copy(locator!.request)));
    assertReference();
    if (observed.state === 'unknown') {
      if (observed.operationKey !== locator!.request.operationKey) throw Error('quote_source_changed');
      return null;
    }
    const { originalSelection, state: _state, retryable: _retryable, execution: _execution, ...packet } = observed;
    const selected = originalSelection ? clientQuoteSelectedInput(originalSelection as ClientCreateQuoteRequest) : selectedOriginal;
    if (!selected || clientGoalFingerprint(selected) !== locator!.request.selectionHash) throw Error('quote_source_changed');
    const material = checkedMaterial({ ...packet, replayed: true }, selected);
    if (locator!.material && !same(preparationBasis(locator!.material), preparationBasis(material))) throw Error('quote_source_changed');
    selectedOriginal = selected;
    return material;
  };
  const emit = (status: ClientQuoteView['status'], quote: AiClientQuoteFacts | null = null) => {
    updateExpiry();
    if (!current()) return;
    const writable = !locallyExpired && Boolean(host?.enabled && host.policy.allowCreate && host.capabilities.bookingDrafts && Date.parse(host.expiresAt) > input.now());
    // A restored packet is a locator. Only a current server response supplies
    // the review shown before a new human confirmation.
    const material = locallyExpired ? null : serverMaterial ?? (locator?.material
      ? { ...locator.material, parameterReview: undefined } : null);
    const reviewed = Boolean(serverMaterial?.parameterReview);
    const matchesInput = matches();
    const pendingCore = locator?.phase === 'confirmation_pending' || (locator?.phase === 'quote_observed' && status !== 'quoted');
    view = { status, material, quote, quoteObservedAt: quote ? quoteObservedAt : null, matchesInput, pendingCore,
      readOnly: !writable || locator?.phase === 'prepared' && !reviewed,
      canPrepare: writable && !busy && ((!locator && status === 'ready') || (!matchesInput && status === 'prepared') || status === 'quoted'),
      canConfirm: writable && !busy && matchesInput && status === 'prepared' && locator?.phase === 'prepared'
        && reviewed && Boolean(material && Date.parse(material.expiresAt) > input.now()),
      canRead: !busy && Boolean(locator && host?.policy.allowRead), };
    input.changed(copy(view));
  };
  const persist = (next: Locator, expected: unknown = locator) => {
    if (!current()) throw Error('quote_context_changed');
    const previous = input.storage.read();
    if (!same(previous ?? null, expected ?? null))
      throw Error('quote_reference_changed');
    const minimal = clientQuoteRecoveryLocator(next, owner);
    input.storage.write(copy(minimal));
    if (!same(input.storage.read(), minimal)) throw Error('quote_reference_not_retained');
    locator = minimal;
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
    locallyExpired = false;
    if (purpose === 'write' && (!host.enabled || !host.policy.allowCreate || !host.capabilities.bookingDrafts)) throw Error('quote_write_unavailable');
  };
  const observe = (value: unknown) => {
    const result = aiClientQuoteResultReadResponseSchema.parse(value), material = locator?.material;
    if (!material || result.source.materialRef !== material.materialRef || result.source.materialHash !== material.materialHash) throw Error('quote_source_changed');
    if (result.state === 'observed') {
      quoteObservedAt = result.observedAt ?? null;
      persist({ ...locator!, phase: 'quote_observed' });
      return result.quote;
    }
    quoteObservedAt = null;
    return null;
  };
  const reference = () => aiClientQuoteConfirmationRequestSchema.parse({ materialRef: locator?.material?.materialRef,
    expectedMaterialHash: locator?.material?.materialHash });
  const operate = async (status: ClientQuoteView['status'], action: () => Promise<{ status: ClientQuoteView['status']; quote?: AiClientQuoteFacts | null }>, purpose: 'read' | 'write' = 'read') => {
    if (busy || !current()) return;
    quoteObservedAt = null; busy = true; emit(status);
    let result: { status: ClientQuoteView['status']; quote?: AiClientQuoteFacts | null } = { status: 'unavailable' };
    try { await recheck(purpose); result = await action(); await recheck('read'); assertReference(); }
    catch { serverMaterial = null; quoteObservedAt = null;
      result = { status: locator && ['preparation_pending', 'confirmation_pending'].includes(locator.phase) ? 'unknown' : 'unavailable' }; }
    finally { busy = false; emit(result.status, result.quote ?? null); }
  };
  return Object.freeze({
    snapshot: () => {
      if (!current()) { withdraw(); return { ...emptyView(), status: 'invalidated' as const }; }
      const wasExpired = locallyExpired; updateExpiry();
      if (!wasExpired && locallyExpired) emit(view.status, view.quote);
      return copy(view);
    },
    originalInput: () => current() && selectedOriginal ? copy(selectedOriginal) : null,
    async open() {
      if (closed || busy || !current()) return;
      serverMaterial = null; selectedOriginal = null; quoteObservedAt = null; locator = null;
      busy = true; emit('opening');
      let status: ClientQuoteView['status'] = 'unavailable';
      try {
        await recheck();
        const saved = input.storage.read();
        if (saved !== undefined && saved !== null) {
          const parsed = clientQuoteRecoveryLocator(saved, owner);
          if (same(saved, parsed)) locator = parsed;
          else persist(parsed, saved);
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
        persist({ version: 'client-quote-operation-1', owner, request: { operationKey: request.operationKey, selectionHash: clientGoalFingerprint(selection) }, material: null, phase: 'preparation_pending' });
        selectedOriginal = selection;
        const material = checkedMaterial(await input.api.prepare(copy(request)), selection);
        if (!current() || !same(selection, clientQuoteSelectedInput(input.selection()))) throw Error('quote_input_changed');
        persist({ ...locator!, material, phase: 'prepared' });
        serverMaterial = material;
        return { status: 'prepared' };
      }, 'write');
    },
    async confirm() {
      updateExpiry();
      if (locallyExpired) { emit(view.status, view.quote); return; }
      if (!view.canConfirm || busy || !current()) return;
      const reviewed = serverMaterial;
      return operate('confirming', async () => {
        if (!matches() || !reviewed?.parameterReview || !locator?.material) throw Error('quote_input_changed');
        const material = await readPreparation();
        if (!material?.parameterReview || !same(preparationBasis(reviewed), preparationBasis(material))
          || !same(reviewed.parameterReview, material.parameterReview)) throw Error('quote_parameter_review_changed');
        updateExpiry();
        if (locallyExpired || !current() || !matches() || Date.parse(material.expiresAt) <= input.now()) throw Error('quote_input_changed');
        serverMaterial = material;
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
          if (quote && !selectedOriginal) {
            try { await readPreparation(); } catch { selectedOriginal = null; }
          }
          return { status: quote ? 'quoted' : 'unknown', quote };
        }
        const material = await readPreparation();
        if (!material) { serverMaterial = null; return { status: 'unknown' }; }
        persist({ ...locator!, material, phase: 'prepared' });
        serverMaterial = material;
        return { status: 'prepared' };
      });
    },
    dispose() {
      closed = true; expiry.clear(); host = null; locator = null; selectedOriginal = null; serverMaterial = null; quoteObservedAt = null;
      view = { ...emptyView(), status: 'invalidated' };
      input.changed(copy(view));
    },
  });
}

type BookingStage = 'preparation_pending' | 'material_ready' | 'draft_pending' | 'draft_ready' | 'selection_pending' | 'selected' | 'handoff_pending' | 'handoff_ready';
interface BookingLocator {
  version: 'client-quote-booking-operation-1'; owner: string; request: AiClientBookingReadRef; stage: BookingStage;
  material: { materialRef: string; materialHash: string; inputHash: string; expiresAt: string } | null;
  createKey: string | null; chooseKey: string | null; handoffKey: string | null; draftId: string | null; handoffRef: string | null;
}
export interface ClientQuoteBookingView {
  status: 'idle' | 'checking' | 'material_ready' | 'draft_ready' | 'selected' | 'handoff_ready' | 'observed' | 'unknown' | 'unavailable' | 'invalidated';
  canPrepare: boolean; canSave: boolean; canChoose: boolean; canHandoff: boolean; canRead: boolean;
  draft: AiBookingDraft | null; handoff: AiBookingHandoff | null;
  readOnly?: boolean; observed?: boolean; operation?: AiBookingOperationReadResponse | null; pendingCore?: boolean;
}
export interface ClientQuoteBookingApi {
  prepareBooking(value: AiClientQuoteBookingRequest): Promise<unknown>;
  readBookingPreparation(value: AiClientBookingReadRef): Promise<unknown>;
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
export function clientBookingRecoveryLocator(value: unknown, owner: string): BookingLocator {
  const keys = ['version','owner','request','stage','material','createKey','chooseKey','handoffKey','draftId','handoffRef'];
  const row = localObject(value, keys);
  if (Object.keys(row).length !== keys.length || row.version !== 'client-quote-booking-operation-1'
    || row.owner !== owner || owner.length > 1024 || !bookingStages.includes(row.stage as BookingStage)) throw Error('booking_locator_changed');
  const source = aiClientBookingReadRequestSchema.parse(row.request), stage = row.stage as BookingStage;
  const request = 'selectionHash' in source ? source : { original: source.original, operationKey: source.operationKey,
    selectionHash: clientGoalFingerprint(source.selection), legacyShape: clientBookingLegacyShape(source.selection) };
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
  return { version: 'client-quote-booking-operation-1', owner, request, stage, material, createKey, chooseKey, handoffKey, draftId, handoffRef };
}
/** Consume the original server booking protocol. Each ambiguous stage reads its
 * original receipt. Only source, digest and operation references survive reload. */
export function createClientQuoteBookingSession(input: {
  context: ClientQuoteContext; original: AiClientQuoteConfirmationRequest; selection(): AiBookingSelection | null;
  api: ClientQuoteBookingApi; readHost(): Promise<unknown>; now(): number; newKey(): string;
  storage: { read(): unknown; write(value: unknown): void }; changed(view: ClientQuoteBookingView): void;
}) {
  const owner = clientQuoteOwner(input.context), selected = input.selection();
  const supplied = selected === null ? null : aiBookingSelectionSchema.parse(selected);
  let originalSelection = supplied;
  let closed = false, busy = false, invalidCache = false, saved: BookingLocator | null = null, host: AiClientHostCapabilities | null = null;
  let action: AiEntryActionDraft | null = null, draft: AiBookingDraft | null = null, handoff: AiBookingHandoff | null = null;
  let observed = false, detailUnavailable = false, operation: AiBookingOperationReadResponse | null = null;
  let locallyExpired = false, pendingCore = true;
  let view: ClientQuoteBookingView = { status: 'idle', canPrepare: false, canSave: false, canChoose: false, canHandoff: false,
    canRead: false, draft: null, handoff: null, readOnly: true, observed: false, operation: null, pendingCore: true };
  const current = () => {
    try { return !closed && input.context.current() && (supplied ? same(supplied, aiBookingSelectionSchema.parse(input.selection())) : input.selection() === null); }
    catch { return false; }
  };
  const writeNow = () => Boolean(host?.enabled && host.policy.allowCreate && host.capabilities.bookingDrafts
    && Date.parse(host.expiresAt) > input.now());
  const sourceUsable = () => Boolean(saved?.material && Date.parse(saved.material.expiresAt) > input.now());
  const draftUsable = () => Boolean(draft && Date.parse(draft.expiresAt) > input.now()
    && ['draft_created','user_selected','handed_to_booking_page'].includes(draft.state));
  const withdraw = () => {
    locallyExpired = true; pendingCore = true; detailUnavailable = true; action = null; draft = null; handoff = null; expiry.clear();
  };
  const expiry = createClientQuoteExpiry(input.now, () => { withdraw(); emit(view.status); });
  const updateExpiry = () => {
    if (!current()) { withdraw(); return; }
    if (!locallyExpired && !expiry.schedule([host?.expiresAt, saved?.material?.expiresAt,
      draft?.expiresAt, draft?.material.quote.expiresAt, action?.expiresAt, handoff?.expiresAt])) withdraw();
  };
  const assertReference = () => {
    if (!current() || saved && !same(input.storage.read(), saved)) throw Error('booking_reference_changed');
  };
  const emit = (status: ClientQuoteBookingView['status']) => {
    updateExpiry();
    if (!current()) return;
    if (locallyExpired) { action = null; draft = null; handoff = null; pendingCore = true; }
    const writable = !locallyExpired && writeNow() && !detailUnavailable && originalSelection !== null;
    view = { status, draft, handoff, observed, operation, pendingCore, readOnly: busy || !writable || Boolean(saved && !sourceUsable())
      || Boolean(draft && !draftUsable()) || Boolean(handoff && Date.parse(handoff.expiresAt) <= input.now()),
      canPrepare: !busy && writable && !saved && !invalidCache && status === 'idle',
      canSave: !busy && writable && sourceUsable() && status === 'material_ready' && !saved?.createKey,
      canChoose: !busy && writable && sourceUsable() && draftUsable() && status === 'draft_ready' && draft?.state === 'draft_created' && !saved?.chooseKey,
      canHandoff: !busy && writable && sourceUsable() && draftUsable() && status === 'selected' && !saved?.handoffKey,
      canRead: !busy && !invalidCache && Boolean(saved && host?.policy.allowRead) };
    input.changed(copy(view));
  };
  const persist = (value: BookingLocator, expected: unknown = saved) => {
    if (!current()) throw Error('booking_context_changed');
    const closedValue = clientBookingRecoveryLocator(value, owner);
    const previous = input.storage.read();
    if (!same(previous ?? null, expected ?? null))
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
    locallyExpired = false;
    if (purpose === 'write' && !writeNow()) throw Error('booking_write_unavailable');
  };
  const hostBasis = () => host && { customerId: host.customerId, customerType: host.customerType,
    tenantCode: host.tenantCode, serviceCode: host.serviceCode, surface: host.surface, scope: host.scope,
    releaseRevision: host.releaseRevision, policy: host.policy, capabilities: host.capabilities };
  const checkAction = (value: AiEntryActionDraft, code: 'CREATE_BOOKING_DRAFT' | 'OPEN_BOOKING') => {
    const result = aiEntryActionSchema.parse(value);
    if (!originalSelection || !saved?.material || !host || result.actionCode !== code || result.surface !== input.context.surface || !same(result.scope, host.scope)
      || result.associations.materialRef !== saved.material.materialRef || result.associations.quoteId !== originalSelection.quoteId
      || result.inputFingerprint !== saved.material.inputHash
      || Date.parse(result.expiresAt) <= input.now() || (code === 'CREATE_BOOKING_DRAFT'
        ? result.resource.id !== originalSelection.quoteId || result.resource.resourceVersion !== saved.material.materialHash
        : result.resource.id !== saved.draftId || result.associations.bookingDraftId !== saved.draftId)) throw Error('booking_action_changed');
    return copy(result);
  };
  const checkDraft = (value: AiBookingDraft, writing = false) => {
    const result = aiBookingDraftSchema.parse(value);
    const initialSelection = originalSelection;
    if (!initialSelection) throw Error('booking_selection_unavailable');
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
      || result.bookingDraftId !== saved.draftId || result.revision !== draft.revision + (writing ? 1 : 0)
      || saved.handoffRef !== null && result.handoffRef !== saved.handoffRef
      || !same(aiBookingSelectionSchema.parse(result.fields), aiBookingSelectionSchema.parse(draft.material.selection))
      || Date.parse(result.expiresAt) <= input.now()
      || writing && !draftUsable()) throw Error('booking_handoff_changed');
    return copy(result);
  };
  const run = async (purpose: 'read' | 'write', work: () => Promise<ClientQuoteBookingView['status']>) => {
    if (busy || !current() || invalidCache) return;
    busy = true; pendingCore = true; observed = false; operation = null; detailUnavailable = false; emit('checking');
    let status: ClientQuoteBookingView['status'] = 'unavailable';
    try {
      await recheck(purpose); assertReference(); const basis = copy(hostBasis());
      status = await work(); await recheck('read'); assertReference();
      if (!same(basis, hostBasis())) throw Error('booking_host_changed');
      // Close the current business reference after the final host wait. Neither
      // a read earlier in this turn nor a cached ready view grants transfer.
      if (status === 'handoff_ready' && saved?.handoffRef && handoff) {
        const expected = copy(handoff);
        draft = { ...checkDraft(await input.api.readBookingDraft({ bookingDraftId: saved.draftId! }), true), action: null };
        handoff = checkHandoff(await input.api.readHandoff({ handoffRef: saved.handoffRef }));
        assertReference();
        if (!same(expected, handoff)) throw Error('booking_handoff_changed');
      } else if (!pendingCore && draft && saved?.draftId) {
        const latest = checkDraft(await input.api.readBookingDraft({ bookingDraftId: saved.draftId }), true);
        assertReference();
        if (!same({ ...latest, action: null }, { ...draft, action: null })) throw Error('booking_revision_changed');
        draft = latest;
      }
    }
    catch { pendingCore = true; action = null; draft = null; handoff = null; observed = false; operation = null;
      status = saved && ['preparation_pending','draft_pending','selection_pending','handoff_pending'].includes(saved.stage) ? 'unknown' : 'unavailable'; }
    finally { busy = false; emit(status); }
  };
  const sourceMatches = (source: { materialRef: string; materialHash: string }) => source.materialRef === input.original.materialRef
    && source.materialHash === input.original.expectedMaterialHash;
  const readOriginalMaterial = async () => {
    assertReference();
    const reference = saved!.request;
    const result = aiClientQuoteBookingOperationResponseSchema.parse(await input.api.readBookingPreparation(copy(reference)));
    assertReference();
    if (result.operationKey !== reference.operationKey || !sourceMatches(result.source)) throw Error('booking_source_changed');
    if (result.state === 'unknown') return null;
    const { materialRef, materialHash, inputHash, expiresAt } = result.material;
    const material = { materialRef, materialHash, inputHash, expiresAt };
    if (saved!.material && !same(saved!.material, material)) throw Error('booking_source_changed');
    const selected = result.originalSelection ?? supplied;
    if (!selected || clientGoalFingerprint(selected) !== reference.selectionHash) throw Error('booking_selection_changed');
    originalSelection = selected;
    return material;
  };
  const session = {
    snapshot: () => {
      if (!current()) { withdraw(); return { ...view, status: 'invalidated' as const, canPrepare: false, canSave: false,
        canChoose: false, canHandoff: false, canRead: false, draft: null, handoff: null, operation: null, observed: false, readOnly: true, pendingCore: true }; }
      const wasExpired = locallyExpired; updateExpiry();
      if (!wasExpired && locallyExpired) emit(view.status);
      return copy(view);
    },
    async open() {
      if (closed || busy || !current()) return;
      pendingCore = true;
      action = null; draft = null; handoff = null; observed = false; operation = null;
      busy = true; emit('checking'); let status: ClientQuoteBookingView['status'] = 'unavailable';
      try {
        await recheck('read');
        const value = input.storage.read();
        if (value !== undefined && value !== null) {
          let record: BookingLocator;
          try { record = clientBookingRecoveryLocator(value, owner); } catch { invalidCache = true; throw Error('booking_locator_changed'); }
          if (!same(record.request.original, input.original) || supplied && record.request.selectionHash !== clientGoalFingerprint(supplied)) throw Error('booking_locator_changed');
          if (same(record, value)) saved = record;
          else persist(record, value);
          invalidCache = false; status = 'unknown';
        } else status = 'idle';
      } catch { status = 'unavailable'; }
      finally { busy = false; emit(status); }
    },
    async prepare() {
      updateExpiry();
      if (locallyExpired) { emit(view.status); return; }
      if (!view.canPrepare || !supplied) return;
      return run('write', async () => {
        const request = aiClientQuoteBookingRequestSchema.parse({ original: input.original, selection: supplied, operationKey: input.newKey() });
        persist({ version: 'client-quote-booking-operation-1', owner, request: { original: request.original, operationKey: request.operationKey, selectionHash: clientGoalFingerprint(supplied) }, stage: 'preparation_pending', material: null,
          createKey: null, chooseKey: null, handoffKey: null, draftId: null, handoffRef: null });
        const result = aiClientQuoteBookingPreparationResponseSchema.parse(await input.api.prepareBooking(copy(request)));
        if (result.operationKey !== saved!.request.operationKey || !sourceMatches(result.source)) throw Error('booking_source_changed');
        if (result.state === 'unknown') return 'unknown';
        persist({ ...saved!, material: result.material, stage: 'material_ready' });
        action = checkAction(result.action, 'CREATE_BOOKING_DRAFT'); pendingCore = false; observed = true; return 'material_ready';
      });
    },
    async saveDraft() {
      updateExpiry();
      if (locallyExpired) { emit(view.status); return; }
      if (!view.canSave || !saved?.material || saved.createKey) return;
      return run('write', async () => {
        action = checkAction(await input.api.issueBookingAction({ materialRef: saved!.material!.materialRef, actionCode: 'CREATE_BOOKING_DRAFT' }), 'CREATE_BOOKING_DRAFT');
        const operationKey = input.newKey(); persist({ ...saved!, stage: 'draft_pending', createKey: operationKey });
        const result = await input.api.createBookingDraft({ action, operationKey });
        if (result.operation !== operationKey) throw Error('booking_operation_changed');
        draft = checkDraft(result.draft, true); persist({ ...saved!, draftId: draft.bookingDraftId, stage: 'draft_ready' });
        const latest = checkDraft(await input.api.readBookingDraft({ bookingDraftId: draft.bookingDraftId }), true);
        if (!same(latest, draft)) throw Error('booking_revision_changed');
        draft = latest;
        pendingCore = draft.state !== 'draft_created' || saved!.chooseKey !== null || saved!.handoffKey !== null;
        observed = true; return 'draft_ready';
      });
    },
    async choose() {
      updateExpiry();
      if (locallyExpired) { emit(view.status); return; }
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
      updateExpiry();
      if (locallyExpired) { emit(view.status); return; }
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
          const material = await readOriginalMaterial();
          if (!material) return 'unknown';
          persist({ ...saved!, stage: 'material_ready', material });
          pendingCore = false; observed = true; return 'material_ready'; // Metadata only; no Action is requested by a read.
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
        if (!originalSelection && writeNow() && sourceUsable()) {
          try { await readOriginalMaterial(); } catch { originalSelection = null; }
        }
        if (expectedKind === 'handoff') {
          if (!receipt.handoffRef) throw Error('booking_handoff_missing');
          persist({ ...saved!, draftId: receipt.bookingDraftId, stage: 'handoff_ready', handoffRef: receipt.handoffRef });
          if (!writeNow() || !sourceUsable() || !originalSelection) { detailUnavailable = true; return 'observed'; }
          try { draft = { ...checkDraft(await input.api.readBookingDraft({ bookingDraftId: receipt.bookingDraftId })), action: null };
            handoff = checkHandoff(await input.api.readHandoff({ handoffRef: receipt.handoffRef })); }
          catch { draft = null; handoff = null; detailUnavailable = true; return 'observed'; }
          return 'handoff_ready';
        }
        persist({ ...saved!, draftId: receipt.bookingDraftId, stage: expectedKind === 'select' ? 'selected' : 'draft_ready' });
        if (!writeNow() || !sourceUsable() || !originalSelection) { detailUnavailable = true; return 'observed'; }
        try { draft = { ...checkDraft(await input.api.readBookingDraft({ bookingDraftId: receipt.bookingDraftId })), action: null }; }
        catch { detailUnavailable = true; return 'observed'; }
        if (expectedKind === 'select') return 'selected';
        // Only this current server read can establish an unselected Draft.
        // TTL, cached state and an operation's mere absence cannot do so.
        pendingCore = draft.state !== 'draft_created' || saved!.chooseKey !== null || saved!.handoffKey !== null;
        return draft.state === 'draft_created' ? 'draft_ready' : 'observed';
      });
    },
    async generateDraft() {
      if (view.canPrepare) await session.prepare();
      if (view.canSave) await session.saveDraft();
      return session.snapshot();
    },
    async continueBooking() {
      if (busy || !current() || invalidCache) return session.snapshot();
      // Once an original handoff attempt exists, every explicit transfer reads
      // that operation and the current server reference. A prior manual recover
      // or cached ready view cannot authorize navigation, selection or reissue.
      if (saved?.handoffKey) { await session.recover(); return session.snapshot(); }
      if (saved && ['draft_pending','selection_pending'].includes(saved.stage)) { await session.recover(); return session.snapshot(); }
      updateExpiry();
      if (locallyExpired) { emit(view.status); return session.snapshot(); }
      if (view.canChoose) await session.choose();
      if (view.canHandoff) await session.handoff();
      return session.snapshot();
    },
    dispose() { closed = true; pendingCore = pendingCore || saved !== null; expiry.clear(); action = null; draft = null; handoff = null; view = { ...view, status: 'invalidated', canPrepare: false,
      canSave: false, canChoose: false, canHandoff: false, canRead: false, draft: null, handoff: null, operation: null, observed: false, readOnly: true };
      view.pendingCore = pendingCore;
      input.changed(copy(view)); },
  };
  return Object.freeze(session);
}
