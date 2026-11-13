/** A current-human review driver. Storage contains original references and CAS
 * commands only, never resource facts, model text or authority. Unknown writes
 * recover through the original event/creation/operation reads; no replay.
 * Human grants keep a separate original locator, never a cached permission.
 * Pending-candidate batches record their key before calling the server. A lost
 * or partial reply is observed through the original batch, never prepared again. */
import { z } from 'zod';
import type {
  AiAutomationCandidateDraft, AiAutomationEventTaskResponseDraft,
  AiAutomationPendingCandidatesRequestDraft, AiAutomationPendingCandidatesDraft,
  AiAutomationPendingBatchObservationDraft,
  AiAutomationReviewCloseDraft, AiAutomationReviewCloseReasonDraft, AiAutomationReviewDraft,
  AiAutomationReviewFeedbackCodeDraft, AiAutomationReviewFeedbackDraft, AiAutomationReviewOperationDraft,
  AiAutomationReviewQueueFiltersDraft, AiAutomationReviewQueueResponseDraft, AiAutomationReviewsForEventDraft,
  AiAutomationTaskCreationObservationDraft,
  AiAutomationReviewGrantKeyDraft, AiAutomationReviewGrantPreparationDraft,
  AiAutomationReviewGrantEnableDraft, AiAutomationReviewGrantObservationDraft,
  AiAutomationReviewGrantReceiptDraft, AiAutomationReviewGrantReadDraft,
} from '@rental-os/shared';
import { validateAutomationReview, type AutomationReviewsApi } from '@/api/aiAutomationReviews';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().min(1).max(4294967293), fence = z.number().int().min(0).max(4294967293);
const scopeSchema = z.object({ tenantId: id, workspaceId: id, actorId: id, audience: z.literal('operator') }).strict();
export type AutomationReviewScope = z.infer<typeof scopeSchema>;
const batchSchema = z.object({ kind: z.literal('automation-pending-candidates-1'), scope: scopeSchema,
  status: z.enum(['dispatched', 'observed']), limit: z.number().int().min(1).max(10), eventIds: z.array(uuid).max(10),
  operationKey: id.max(128).optional(), batchId: uuid.optional() }).strict()
  .refine(value => value.eventIds.length <= value.limit && new Set(value.eventIds).size === value.eventIds.length);
type CandidateBatch = z.infer<typeof batchSchema>;
const command = { scope: scopeSchema, status: z.enum(['pending', 'observed']), eventId: uuid, inputRef: uuid,
  inputHash: hash, creationKey: id, operationKey: id.max(128), expectedRevision: revision,
  expectedEventFence: fence, expectedTaskId: uuid.nullable(), expectedRunId: uuid.nullable() };
const journalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('from_event'), status: z.literal('pending'), scope: scopeSchema,
    eventId: uuid, inputRef: uuid.nullable(), creationKey: id.nullable() }).strict(),
  z.object({ kind: z.literal('close'), ...command,
    reason: z.enum(['resolved', 'dismissed', 'duplicate', 'not_applicable']) }).strict(),
  z.object({ kind: z.literal('feedback'), ...command,
    code: z.enum(['helpful', 'not_helpful', 'incorrect', 'not_applicable']) }).strict(),
]);
type Journal = z.infer<typeof journalSchema>;
type MutationJournal = Exclude<Journal, { kind: 'from_event' }>;
const grantLocatorSchema = z.object({ inputRef: uuid, action: z.enum(['close', 'feedback']),
  expectedRevision: revision, preparedRef: hash }).strict();
export type AutomationReviewGrantLocator = z.infer<typeof grantLocatorSchema>;
type GrantAction = AutomationReviewGrantLocator['action'];
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const unavailable = () => Error('AI_RESOURCE_UNAVAILABLE');

export interface AutomationReviewStore {
  read(): Journal | null;
  write(next: Journal, expected: Journal | null): void;
  clear(expected: Journal): void;
  batch: {
    read(): CandidateBatch | null;
    write(next: CandidateBatch, expected: CandidateBatch | null): void;
  };
  grant: {
    read(): AutomationReviewGrantLocator | null;
    write(next: AutomationReviewGrantLocator, expected: AutomationReviewGrantLocator | null): void;
    clear(expected: AutomationReviewGrantLocator): void;
  };
}
export const automationReviewGrantStorageName = (name: string) => `${name}:grant`;
export const automationReviewBatchStorageName = (name: string) => `${name}:pending-candidates`;
export function automationReviewStore(name: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): AutomationReviewStore {
  const encode = (value: Journal) => JSON.stringify(journalSchema.parse(value));
  const grantName = automationReviewGrantStorageName(name);
  const encodeGrant = (value: AutomationReviewGrantLocator) => JSON.stringify(grantLocatorSchema.parse(value));
  const batchName = automationReviewBatchStorageName(name);
  const encodeBatch = (value: CandidateBatch) => JSON.stringify(batchSchema.parse(value));
  return {
    read() {
      const raw = storage?.getItem(name);
      if (raw === null || raw === undefined) return null;
      if (!raw || raw.length > 4096) throw Error('AI_OPERATION_LOCATOR_DAMAGED');
      try {
        const parsed = journalSchema.parse(JSON.parse(raw));
        if (encode(parsed) !== raw || parsed.kind === 'from_event' && Boolean(parsed.inputRef) !== Boolean(parsed.creationKey)) throw Error();
        return parsed;
      } catch { throw Error('AI_OPERATION_LOCATOR_DAMAGED'); }
    },
    write(next, expected) {
      if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      if (storage.getItem(name) !== (expected ? encode(expected) : null)) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
      const raw = encode(next); storage.setItem(name, raw);
      if (storage.getItem(name) !== raw) throw Error('AI_OPERATION_LOCATOR_UNCONFIRMED');
    },
    clear(expected) {
      if (!storage || storage.getItem(name) !== encode(expected)) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
      storage.removeItem(name);
      if (storage.getItem(name) !== null) throw Error('AI_OPERATION_LOCATOR_UNCONFIRMED');
    },
    batch: {
      read() {
        const raw = storage?.getItem(batchName);
        if (raw === null || raw === undefined) return null;
        try {
          if (!raw || raw.length > 2048) throw Error();
          const parsed = batchSchema.parse(JSON.parse(raw));
          if (encodeBatch(parsed) !== raw) throw Error();
          return parsed;
        } catch { throw Error('AI_BATCH_LOCATOR_DAMAGED'); }
      },
      write(next, expected) {
        if (!storage) throw Error('AI_BATCH_LOCATOR_UNAVAILABLE');
        if (storage.getItem(batchName) !== (expected ? encodeBatch(expected) : null)) throw Error('AI_BATCH_LOCATOR_ALREADY_EXISTS');
        const raw = encodeBatch(next); storage.setItem(batchName, raw);
        if (storage.getItem(batchName) !== raw) throw Error('AI_BATCH_LOCATOR_UNCONFIRMED');
      },
    },
    grant: {
      read() {
        const raw = storage?.getItem(grantName);
        if (raw === null || raw === undefined) return null;
        try {
          if (!raw || raw.length > 512) throw Error();
          const parsed = grantLocatorSchema.parse(JSON.parse(raw));
          if (encodeGrant(parsed) !== raw) throw Error();
          return parsed;
        } catch { throw Error('AI_GRANT_LOCATOR_DAMAGED'); }
      },
      write(next, expected) {
        if (!storage) throw Error('AI_GRANT_LOCATOR_UNAVAILABLE');
        if (storage.getItem(grantName) !== (expected ? encodeGrant(expected) : null)) throw Error('AI_GRANT_LOCATOR_ALREADY_EXISTS');
        const raw = encodeGrant(next); storage.setItem(grantName, raw);
        if (storage.getItem(grantName) !== raw) throw Error('AI_GRANT_LOCATOR_UNCONFIRMED');
      },
      clear(expected) {
        if (!storage || storage.getItem(grantName) !== encodeGrant(expected)) throw Error('AI_GRANT_LOCATOR_ALREADY_EXISTS');
        storage.removeItem(grantName);
        if (storage.getItem(grantName) !== null) throw Error('AI_GRANT_LOCATOR_UNCONFIRMED');
      },
    },
  };
}

/** Parent-owned registered navigation/model entry. No AUTOMATION Task ID or URL
 * crosses this port. Opening an entry does not attest model/business execution. */
export type AutomationReviewOriginalTarget = {
  scope: AutomationReviewScope; eventId: string; eventType: AiAutomationReviewDraft['event']['type'];
  resourceRevision: number; currentRevision: number | null; sourceHash?: string;
  resource: AiAutomationReviewsForEventDraft['originalResource']; inputRef: string | null;
};
export type AutomationReviewOriginalEntry = (target: AutomationReviewOriginalTarget, signal: AbortSignal) =>
  Promise<{ state: 'opened' | 'unavailable' }>;

export type AutomationReviewView = {
  eventId: string | null; inputRef: string | null;
  queue: AiAutomationReviewQueueResponseDraft | null; queueFilters: AiAutomationReviewQueueFiltersDraft;
  candidateBatch: AiAutomationPendingCandidatesDraft | null; batch: CandidateBatch | null; batchLocatorDamaged: boolean;
  batchObservation: AiAutomationPendingBatchObservationDraft | null;
  event: AiAutomationReviewsForEventDraft | null; candidate: AiAutomationCandidateDraft | null;
  review: AiAutomationReviewDraft | null; creation: AiAutomationTaskCreationObservationDraft | null;
  operation: AiAutomationReviewOperationDraft | null; pending: Journal | null; lastOperation: MutationJournal | null;
  grantPreparation: AiAutomationReviewGrantPreparationDraft | null;
  grantObservation: AiAutomationReviewGrantObservationDraft | null;
  pendingGrant: AutomationReviewGrantLocator | null; grantLocatorDamaged: boolean;
  recheck: { eventId: string; resource: AiAutomationReviewsForEventDraft['originalResource'];
    source: AiAutomationReviewsForEventDraft['currentSource']; readAt: string } | null;
  openedEntry: 'explanation' | 'business' | null;
  locatorDamaged: boolean; busy: string | null; error: string | null;
};

export function createAutomationReviewSession(input: {
  scope: AutomationReviewScope; current(): boolean; api: AutomationReviewsApi; store: AutomationReviewStore;
  changed(): void; eventId?: string; newKey?: () => string; clock?: () => number;
  explainOriginal?: AutomationReviewOriginalEntry; openOriginal?: AutomationReviewOriginalEntry;
}) {
  const scope = scopeSchema.parse(structuredClone(input.scope));
  let active = true, owner: AbortController | null = null, record: Journal | null = null;
  let damaged = false, initialError: string | null = null;
  let grantRecord: AutomationReviewGrantLocator | null = null, grantDamaged = false;
  let batchRecord: CandidateBatch | null = null, batchDamaged = false;
  let preparedReview: string | null = null;
  let verifiedGrant: { locator: AutomationReviewGrantLocator; review: string; expiresAt: string } | null = null;
  try {
    record = input.store.read();
    if (record && !same(record.scope, scope)) throw Error('AI_OPERATION_LOCATOR_DAMAGED');
  } catch { record = null; damaged = true; initialError = 'AI_OPERATION_LOCATOR_DAMAGED'; }
  try { grantRecord = input.store.grant.read(); }
  catch { grantDamaged = true; initialError ??= 'AI_GRANT_LOCATOR_DAMAGED'; }
  try {
    batchRecord = input.store.batch.read();
    if (batchRecord && !same(batchRecord.scope, scope)) throw Error('AI_BATCH_LOCATOR_DAMAGED');
  } catch { batchRecord = null; batchDamaged = true; initialError ??= 'AI_BATCH_LOCATOR_DAMAGED'; }
  let view: AutomationReviewView = {
    eventId: record?.eventId ?? (uuid.safeParse(input.eventId).success ? input.eventId! : null),
    inputRef: record?.inputRef ?? grantRecord?.inputRef ?? null, queue: null, queueFilters: {}, event: null, candidate: null,
    candidateBatch: null, batchObservation: null, batch: batchRecord, batchLocatorDamaged: batchDamaged,
    review: null, creation: null, operation: null,
    pending: record?.status === 'pending' ? record : null,
    lastOperation: record?.status === 'observed' ? record : null,
    grantPreparation: null, grantObservation: null, pendingGrant: grantRecord, grantLocatorDamaged: grantDamaged,
    recheck: null, openedEntry: null, locatorDamaged: damaged, busy: null, error: initialError,
  };
  const clock = input.clock ?? Date.now;
  const assert = () => {
    if (!active || !input.current()) { owner?.abort(); scrub(); throw Error('AI_SCOPE_CHANGED'); }
  };
  const publish = (next: Partial<AutomationReviewView>) => {
    if (active && input.current()) { view = { ...view, ...next }; input.changed(); }
  };
  const retractGrant = () => {
    preparedReview = null; verifiedGrant = null;
    view = { ...view, grantPreparation: null, grantObservation: null };
  };
  const scrub = () => { retractGrant(); view = { ...view, queue: null, candidateBatch: null, batchObservation: null, event: null, candidate: null, review: null,
    creation: null, operation: null, recheck: null, openedEntry: null }; };
  const store = (next: Journal) => {
    assert();
    try { input.store.write(next, record); record = next; publish({ pending: next.status === 'pending' ? next : null,
      lastOperation: next.status === 'observed' ? next : null }); }
    catch (error) { damaged = true; publish({ locatorDamaged: true }); throw error; }
  };
  const clear = () => {
    assert();
    try { if (record) input.store.clear(record); record = null; publish({ pending: null, lastOperation: null }); }
    catch (error) { damaged = true; publish({ locatorDamaged: true }); throw error; }
  };
  const writeBatch = (next: CandidateBatch) => {
    assert();
    try { input.store.batch.write(next, batchRecord); batchRecord = next; publish({ batch: next }); }
    catch (error) { batchDamaged = true; publish({ batchLocatorDamaged: true }); throw error; }
  };
  const run = async <T>(name: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    assert(); if (view.busy) throw Error('AI_OPERATION_BUSY');
    const request = new AbortController(); owner = request; publish({ busy: name, error: null });
    try { const result = await work(request.signal); assert(); if (request.signal.aborted) throw Error('AI_SCOPE_CHANGED'); return result; }
    catch (error) {
      const publicCode = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
      const knownCodes = ['AI_RESOURCE_UNAVAILABLE', 'AI_ACCESS_DENIED', 'AI_REVISION_CONFLICT', 'AI_INVALID_INPUT', 'AI_RESULT_UNKNOWN'];
      scrub(); const code = typeof publicCode === 'string' && knownCodes.includes(publicCode) ? publicCode
        : error instanceof Error && /^AI_[A-Z_]+$/u.test(error.message) ? error.message
        : record?.status === 'pending' || grantRecord || batchRecord?.status === 'dispatched' ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE';
      publish({ error: code }); throw error;
    } finally { if (owner === request) { owner = null; publish({ busy: null }); } }
  };
  const assertWritable = () => {
    assert(); if (damaged || grantDamaged || batchDamaged || batchRecord?.status === 'dispatched'
      || record?.status === 'pending' || grantRecord) throw Error('AI_RESULT_UNKNOWN');
    if (!same(input.store.read(), record)) { damaged = true; publish({ locatorDamaged: true }); throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS'); }
    if (!same(input.store.grant.read(), grantRecord)) { grantDamaged = true; publish({ grantLocatorDamaged: true }); throw Error('AI_GRANT_LOCATOR_ALREADY_EXISTS'); }
    if (!same(input.store.batch.read(), batchRecord)) { batchDamaged = true; publish({ batchLocatorDamaged: true }); throw Error('AI_BATCH_LOCATOR_ALREADY_EXISTS'); }
  };
  const parsedReview = (value: unknown, inputRef: string, eventId: string) => {
    const result = validateAutomationReview<AiAutomationReviewDraft>('AiAutomationReviewDraft', value);
    const original = result.actionResource;
    if (result.inputRef !== inputRef || result.event.eventId !== eventId || original.inputRef !== inputRef
      || original.eventId !== eventId || original.inputHash !== result.inputHash
      || original.resourceRevision !== result.event.resourceRevision || original.expectedRevision !== result.review.revision
      || original.eventFence !== result.event.fence || original.taskId !== result.task.taskId || original.runId !== result.task.runId) throw unavailable();
    return result;
  };
  const reviewStamp = (value: AiAutomationReviewDraft) => JSON.stringify([
    value.inputRef, value.inputStatus, value.inputHash, value.inputMode, value.actionResource,
    value.event, value.task, value.currentSource, value.resourceHash,
  ]);
  const freshReview = async (inputRef: string, signal: AbortSignal) => {
    const value = validateAutomationReview<AiAutomationReviewDraft>('AiAutomationReviewDraft', await input.api.review(inputRef, signal)); assert();
    return parsedReview(value, inputRef, value.event.eventId);
  };
  const grantKeyFields = ['tenantId', 'workspaceId', 'scopeId', 'userId', 'actorKind', 'actorId', 'audience',
    'inputId', 'eventId', 'action', 'expectedRevision'] as const;
  const sameGrantKey = (left: AiAutomationReviewGrantKeyDraft, right: AiAutomationReviewGrantKeyDraft) =>
    grantKeyFields.every(key => left[key] === right[key]);
  const assertGrantKey = (key: AiAutomationReviewGrantKeyDraft, query: AiAutomationReviewGrantReadDraft, review?: AiAutomationReviewDraft) => {
    if (key.tenantId !== scope.tenantId || key.workspaceId !== scope.workspaceId || key.userId !== scope.actorId
      || key.actorKind !== 'user' || key.actorId !== scope.actorId || key.audience !== scope.audience
      || key.inputId !== query.inputRef || key.action !== query.action || key.expectedRevision !== query.expectedRevision
      || review && key.eventId !== review.event.eventId) throw unavailable();
  };
  const preparedGrant = (value: unknown, review: AiAutomationReviewDraft, action: GrantAction) => {
    const result = validateAutomationReview<AiAutomationReviewGrantPreparationDraft>('AiAutomationReviewGrantPreparationDraft', value);
    assertGrantKey(result.key, { inputRef: review.inputRef, action, expectedRevision: review.review.revision }, review);
    if (result.inputHash !== review.inputHash || result.resourceHash !== review.resourceHash
      || result.creationKey !== review.actionResource.creationKey) throw unavailable();
    return result;
  };
  const receiptMatchesPreparation = (receipt: AiAutomationReviewGrantReceiptDraft, preparation: AiAutomationReviewGrantPreparationDraft) => {
    const fields = ['version', 'preparedRef', 'grantId', 'expectedGrantRevision', 'previousGrantFingerprint',
      'targetFingerprint', 'principalFingerprint', 'sourceFingerprint', 'resourceHash', 'inputHash',
      'creationKey', 'preparedAt', 'expiresAt'] as const;
    return fields.every(key => receipt[key] === preparation[key]) && sameGrantKey(receipt.key, preparation.key)
      && receipt.policy.policyId === preparation.policy.policyId && receipt.policy.revision === preparation.policy.revision
      && receipt.policy.fingerprint === preparation.policy.fingerprint
      && same(receipt.requiredPermissions, preparation.requiredPermissions)
      && receipt.grantRevision === (preparation.expectedGrantRevision ?? 0) + 1;
  };
  const writeGrant = (original: AutomationReviewGrantLocator) => {
    assert();
    try {
      input.store.grant.write(original, grantRecord); grantRecord = structuredClone(original);
      publish({ pendingGrant: grantRecord });
      if (!same(input.store.grant.read(), grantRecord)) throw Error('AI_GRANT_LOCATOR_UNCONFIRMED');
    } catch (error) { grantDamaged = true; publish({ grantLocatorDamaged: true }); throw error; }
  };
  const clearGrant = (original: AutomationReviewGrantLocator) => {
    assert();
    try {
      input.store.grant.clear(original); grantRecord = null; publish({ pendingGrant: null });
    } catch (error) { grantDamaged = true; publish({ grantLocatorDamaged: true }); throw error; }
  };
  const usableGrant = (action: GrantAction) => Boolean(active && input.current() && !damaged && !grantDamaged && !batchDamaged
    && batchRecord?.status !== 'dispatched'
    && record?.status !== 'pending' && !grantRecord && view.review && view.review.currentSource.failed !== null && verifiedGrant
    && verifiedGrant.locator.action === action && verifiedGrant.locator.inputRef === view.review.inputRef
    && verifiedGrant.locator.expectedRevision === view.review.review.revision
    && verifiedGrant.review === reviewStamp(view.review) && Date.parse(verifiedGrant.expiresAt) > clock()
    && (action !== 'close' || view.review.review.status === 'open'));
  const readGrant = async (query: AiAutomationReviewGrantReadDraft, signal: AbortSignal,
    preparation?: AiAutomationReviewGrantPreparationDraft, originalOnly = false) => {
    if (originalOnly && (query.preparedRef === undefined || preparation !== undefined || !grantRecord
      || !same(grantRecord, query))) throw unavailable();
    const before = originalOnly ? undefined : await freshReview(query.inputRef, signal);
    const result = validateAutomationReview<AiAutomationReviewGrantObservationDraft>('AiAutomationReviewGrantObservationDraft', await input.api.readGrant(query, signal)); assert();
    assertGrantKey(result.key, query, before);
    if (query.preparedRef !== undefined && result.preparedRef !== query.preparedRef) throw unavailable();
    if (result.state !== 'unknown' && result.grant && !sameGrantKey(result.grant.key, result.key)) throw unavailable();
    const receipt = result.state === 'observed' ? result.receipt : null;
    if (receipt && (!sameGrantKey(receipt.key, result.key) || receipt.preparedRef !== result.preparedRef
      || result.state !== 'observed' || receipt.grantId !== result.grant.id || receipt.grantRevision > result.grant.revision)) throw unavailable();
    if (receipt && preparation && !receiptMatchesPreparation(receipt, preparation)) throw unavailable();
    if (result.state === 'observed' && result.active && (!receipt || !result.grant.enabled
      || receipt.grantRevision !== result.grant.revision || receipt.resourceHash !== result.grant.resourceHash
      || receipt.expiresAt !== result.grant.expiresAt || !same(receipt.requiredPermissions, result.grant.requiredPermissions))) throw unavailable();
    if (originalOnly) {
      // A recovered enable receipt resolves delivery. It does not revalidate an
      // old risk card or grant a new close/feedback without a fresh review.
      retractGrant();
      view = { ...view, event: null, candidate: null, review: null, creation: null, recheck: null, openedEntry: null };
      if (result.state === 'observed' && receipt && grantRecord && same(grantRecord,
        { inputRef: query.inputRef, action: query.action, expectedRevision: query.expectedRevision, preparedRef: receipt.preparedRef })) {
        clearGrant(grantRecord);
      }
      publish({ eventId: result.key.eventId, inputRef: query.inputRef, grantObservation: result });
      return result;
    }
    const after = await freshReview(query.inputRef, signal);
    if (!before || reviewStamp(before) !== reviewStamp(after)) throw Error('AI_REVISION_CONFLICT');
    if (!view.event || view.event.event.eventId !== after.event.eventId || view.event.event.fence !== after.event.fence
      || !same(view.event.currentSource, after.currentSource)) {
      view = { ...view, event: null, candidate: null, recheck: null, openedEntry: null };
    }
    retractGrant();
    if (result.state === 'observed' && receipt && result.active && result.key.expectedRevision === after.review.revision
      && receipt.resourceHash === after.resourceHash && receipt.inputHash === after.inputHash
      && receipt.creationKey === after.actionResource.creationKey && Date.parse(result.grant.expiresAt) > clock()) {
      verifiedGrant = { locator: grantLocatorSchema.parse({ inputRef: query.inputRef, action: query.action,
        expectedRevision: query.expectedRevision, preparedRef: receipt.preparedRef }), review: reviewStamp(after), expiresAt: result.grant.expiresAt };
    }
    // A known original receipt resolves delivery even if its current grant is
    // disabled. Absence/unknown never clears an attempted enable locator.
    if (grantRecord && query.preparedRef === grantRecord.preparedRef && result.state === 'observed' && receipt
      && same(grantRecord, { inputRef: query.inputRef, action: query.action, expectedRevision: query.expectedRevision, preparedRef: receipt.preparedRef })) {
      clearGrant(grantRecord);
    }
    publish({ eventId: after.event.eventId, inputRef: after.inputRef, review: after, grantObservation: result });
    return result;
  };
  const readEvent = async (eventId: string, signal: AbortSignal, after?: string) => {
    retractGrant();
    const query = { eventId: uuid.parse(eventId), limit: 10, ...(after ? { after: uuid.parse(after) } : {}) };
    const initial = validateAutomationReview<AiAutomationReviewsForEventDraft>('AiAutomationReviewsForEventDraft', await input.api.forEvent(query, signal)); assert();
    if (initial.event.eventId !== eventId) throw unavailable();
    // Current candidate reads may expire a stale marker. An unavailable source
    // instead keeps the independent original review and never attempts capture.
    const candidate = initial.currentSource.failed === null ? null
      : validateAutomationReview<AiAutomationCandidateDraft>('AiAutomationCandidateDraft', await input.api.candidate(eventId, signal)); assert();
    const first = candidate ? validateAutomationReview<AiAutomationReviewsForEventDraft>('AiAutomationReviewsForEventDraft', await input.api.forEvent(query, signal)) : initial; assert();
    if (first.event.eventId !== eventId) throw unavailable();
    const latest = validateAutomationReview<AiAutomationReviewsForEventDraft>('AiAutomationReviewsForEventDraft', await input.api.forEvent(query, signal)); assert();
    if (latest.event.eventId !== eventId || !same(first.currentSource, latest.currentSource)
      || !same(first.originalResource, latest.originalResource) || !same(first.inputs, latest.inputs)
      || candidate && (candidate.eventId !== eventId || candidate.fence !== latest.event.fence)) throw unavailable();
    if (candidate?.material) {
      const event = candidate.material.event;
      if (event.eventId !== eventId || event.type !== latest.event.type || event.resource.version !== latest.event.resourceRevision
        || event.scope.kind !== 'workspace' || event.scope.tenantId !== scope.tenantId || event.scope.workspaceId !== scope.workspaceId
        || event.resource.id !== latest.originalResource.id) throw unavailable();
    }
    for (const row of latest.inputs.items) parsedReview(row, row.inputRef, eventId);
    const selected = latest.inputs.items.find(row => row.inputRef === view.inputRef)
      ?? (latest.inputs.items.length === 1 ? latest.inputs.items[0] : null);
    const recheck = view.recheck?.eventId === eventId && same(view.recheck.resource, latest.originalResource)
      && same(view.recheck.source, latest.currentSource) ? view.recheck : null;
    publish({ eventId, event: latest, candidate, inputRef: selected?.inputRef ?? null, review: selected,
      recheck, openedEntry: null });
    return latest;
  };
  const readCreation = async (original: Extract<Journal, { kind: 'from_event' }>, event: AiAutomationReviewsForEventDraft, signal: AbortSignal) => {
    // The approved from-event read locator can discover existing work. An
    // ambiguous window never selects a policy or infers a missing receipt.
    const row = original.inputRef ? event.inputs.items.find(row => row.inputRef === original.inputRef)
        ?? parsedReview(await input.api.review(original.inputRef, signal), original.inputRef, original.eventId)
      : !event.inputs.hasMore && event.inputs.items.length === 1 ? event.inputs.items[0] : undefined;
    assert();
    if (!row) return;
    const creationKey = original.creationKey ?? row.actionResource.creationKey;
    if (row.actionResource.creationKey !== creationKey) throw unavailable();
    const result = validateAutomationReview<AiAutomationTaskCreationObservationDraft>('AiAutomationTaskCreationObservationDraft', await input.api.creation(row.inputRef, signal)); assert();
    if (result.inputRef !== row.inputRef || result.creationKey !== creationKey) throw unavailable();
    publish({ creation: result, inputRef: row.inputRef, review: row });
    if (result.state === 'observed') {
      const latest = parsedReview(await input.api.review(row.inputRef, signal), row.inputRef, original.eventId); assert();
      if (latest.task.state !== 'observed' || result.task.taskId !== latest.task.taskId || result.task.runId !== latest.task.runId
        || result.task.status !== latest.task.status || result.task.revision !== latest.task.revision
        || latest.actionResource.creationKey !== creationKey || !same(row.policyReference, latest.policyReference)) throw unavailable();
      publish({ review: latest }); clear();
    } else if (!original.inputRef) store({ ...original, inputRef: row.inputRef, creationKey });
  };
  const observedOperation = (value: unknown, original: MutationJournal) => {
    const result = validateAutomationReview<AiAutomationReviewOperationDraft>('AiAutomationReviewOperationDraft', value);
    if (result.inputRef !== original.inputRef || result.operationKey !== original.operationKey) throw unavailable();
    if (result.state === 'observed' && (result.eventId !== original.eventId || result.action !== original.kind
      || result.taskId !== original.expectedTaskId || result.runId !== original.expectedRunId
      || result.revision !== original.expectedRevision + 1 || result.eventFence < original.expectedEventFence
      || result.eventFence > original.expectedEventFence + (original.kind === 'close' ? 1 : 0)
      || original.kind === 'close' && (result.status !== 'closed' || result.closeReason !== original.reason)
      || original.kind === 'feedback' && result.feedbackCode !== original.code)) throw unavailable();
    return result;
  };
  const operation = async (original: MutationJournal, signal: AbortSignal) => {
    // The original-operation endpoint independently verifies current business
    // access and frozen input/event/task bindings. Current failure or trigger
    // policy is unnecessary for an already recorded human operation.
    const result = observedOperation(await input.api.operation({ inputRef: original.inputRef, operationKey: original.operationKey }, signal), original); assert();
    scrub(); publish({ operation: result, eventId: original.eventId, inputRef: original.inputRef });
    if (result.state === 'observed' && original.status === 'pending') {
      store({ ...original, status: 'observed' }); publish({ queue: null });
    }
    return result;
  };
  const target = async (signal: AbortSignal): Promise<AutomationReviewOriginalTarget> => {
    if (!view.eventId) throw unavailable();
    const event = await readEvent(view.eventId, signal);
    return { scope: structuredClone(scope), eventId: event.event.eventId, eventType: event.event.type,
      resourceRevision: event.event.resourceRevision, currentRevision: event.currentSource.revision,
      ...('sourceHash' in event.currentSource && event.currentSource.sourceHash ? { sourceHash: event.currentSource.sourceHash } : {}),
      resource: structuredClone(event.originalResource), inputRef: view.inputRef };
  };
  const candidateForScope = (value: unknown, eventId?: string) => {
    const result = validateAutomationReview<AiAutomationCandidateDraft>('AiAutomationCandidateDraft', value);
    if (eventId !== undefined && result.eventId !== eventId) throw unavailable();
    if (result.material && (result.material.event.eventId !== result.eventId || result.material.event.scope.kind !== 'workspace'
      || result.material.event.scope.tenantId !== scope.tenantId || result.material.event.scope.workspaceId !== scope.workspaceId)) throw unavailable();
    return result;
  };
  const acceptBatch = (value: unknown, original: CandidateBatch) => {
    const result = validateAutomationReview<AiAutomationPendingBatchObservationDraft>('AiAutomationPendingBatchObservationDraft', value);
    if (!original.operationKey || result.operationKey !== original.operationKey || result.limit !== original.limit) throw unavailable();
    if (result.state !== 'observed') {
      if (original.status === 'observed') writeBatch(batchSchema.parse({ ...original, status: 'dispatched' }));
      publish({ batchObservation: result, candidateBatch: null });
      return result;
    }
    const eventIds = result.events.map(event => event.eventId);
    if (eventIds.length > original.limit || new Set(eventIds).size !== eventIds.length
      || original.batchId !== undefined && original.batchId !== result.batchId
      || (original.batchId !== undefined || original.eventIds.length > 0) && !same(original.eventIds, eventIds)
      || result.complete !== result.events.every(event => event.preparationState === 'observed')) throw unavailable();
    const items = result.events.map(event => candidateForScope(event.candidate, event.eventId));
    writeBatch(batchSchema.parse({ ...original, status: result.complete ? 'observed' : 'dispatched', eventIds, batchId: result.batchId }));
    publish({ batchObservation: result, candidateBatch: { items, coverage: 'bounded_authorized_window', workerStarted: false, batch: result } });
    return result;
  };
  const mutate = async (kind: 'close' | 'feedback', value: AiAutomationReviewCloseReasonDraft | AiAutomationReviewFeedbackCodeDraft, preparedRef: string) =>
    run(kind, async signal => {
      assertWritable();
      if (!usableGrant(kind) || verifiedGrant?.locator.preparedRef !== preparedRef) throw Error('AI_REVIEW_GRANT_INACTIVE');
      const grant = structuredClone(verifiedGrant!.locator);
      if (!view.eventId || !view.inputRef || !view.review) throw unavailable();
      const shown = view.review, current = parsedReview(await input.api.review(shown.inputRef, signal), shown.inputRef, view.eventId); assert();
      if (!same(current.actionResource, shown.actionResource) || current.resourceHash !== shown.resourceHash
        || kind === 'close' && current.review.status === 'closed') throw Error('AI_REVISION_CONFLICT');
      await readGrant(grant, signal); assertWritable();
      if (!usableGrant(kind) || verifiedGrant?.locator.preparedRef !== preparedRef
        || !view.review || reviewStamp(view.review) !== reviewStamp(current)) throw Error('AI_REVIEW_GRANT_INACTIVE');
      const base = { scope, status: 'pending' as const, eventId: current.event.eventId, inputRef: current.inputRef,
        inputHash: current.inputHash, creationKey: current.actionResource.creationKey,
        operationKey: (input.newKey ?? (() => crypto.randomUUID()))(), expectedRevision: current.review.revision,
        expectedEventFence: current.event.fence, expectedTaskId: current.task.taskId, expectedRunId: current.task.runId };
      const original = journalSchema.parse(kind === 'close' ? { ...base, kind, reason: value } : { ...base, kind, code: value }) as MutationJournal;
      store(original); assert();
      const body = { inputRef: original.inputRef, operationKey: original.operationKey,
        expectedRevision: original.expectedRevision, expectedEventFence: original.expectedEventFence, expectedTaskId: original.expectedTaskId };
      const response = original.kind === 'close'
        ? await input.api.close(validateAutomationReview<AiAutomationReviewCloseDraft>('AiAutomationReviewCloseDraft', { ...body, reason: original.reason }), signal)
        : await input.api.feedback(validateAutomationReview<AiAutomationReviewFeedbackDraft>('AiAutomationReviewFeedbackDraft', { ...body, code: original.code }), signal);
      assert(); const result = observedOperation(response, original); publish({ operation: result });
      if (result.state !== 'observed') throw Error('AI_RESULT_UNKNOWN');
      store({ ...original, status: 'observed' });
      publish({ queue: null });
      await readEvent(original.eventId, signal);
      return result;
    });

  return {
    get view(): AutomationReviewView {
      if (!active || !input.current()) scrub();
      return structuredClone(view);
    },
    isCurrent: () => active && input.current(),
    canPreparePending: () => active && input.current() && !view.busy && !damaged && !grantDamaged && !batchDamaged
      && record?.status !== 'pending' && !grantRecord && batchRecord?.status !== 'dispatched',
    preparePending: (limit = 10) => run('prepare-pending', async signal => {
      assertWritable();
      const operationKey = (input.newKey ?? (() => crypto.randomUUID()))();
      const command = validateAutomationReview<AiAutomationPendingCandidatesRequestDraft>('AiAutomationPendingCandidatesRequestDraft', { limit, operationKey });
      const original = batchSchema.parse({ kind: 'automation-pending-candidates-1', scope, status: 'dispatched', limit, eventIds: [], operationKey });
      // Persist and read back the key before the single write request. Restored
      // sessions can only call readPendingBatch until this batch is complete.
      writeBatch(original);
      assert();
      const result = validateAutomationReview<AiAutomationPendingCandidatesDraft>('AiAutomationPendingCandidatesDraft',
        await input.api.preparePending(command, signal)); assert();
      const items = result.items.map(item => candidateForScope(item));
      if (items.length > limit || new Set(items.map(item => item.eventId)).size !== items.length) throw unavailable();
      if (!result.batch) throw Error('AI_RESULT_UNKNOWN');
      const observation = validateAutomationReview<AiAutomationPendingBatchObservationDraft>('AiAutomationPendingBatchObservationDraft', result.batch);
      if (observation.state === 'observed' && !same(items, observation.events.filter(event => event.preparationState === 'observed').map(event => event.candidate))
        || observation.state !== 'observed' && items.length > 0) throw unavailable();
      const batch = acceptBatch(observation, original);
      retractGrant();
      if (batch.state !== 'observed') throw Error('AI_RESULT_UNKNOWN');
      return result;
    }),
    readPendingCandidates: () => run('pending-read', async signal => {
      assert();
      if (batchDamaged || !batchRecord?.operationKey) throw Error('AI_BATCH_ORIGINAL_READ_UNAVAILABLE');
      const original = structuredClone(batchRecord);
      const result = await input.api.readPendingBatch({ limit: original.limit, operationKey: original.operationKey! }, signal); assert();
      if (!same(original, batchRecord) || !same(input.store.batch.read(), original)) throw Error('AI_BATCH_LOCATOR_ALREADY_EXISTS');
      return acceptBatch(result, original);
    }),
    selectPendingCandidate: (eventId: string) => run('event', async signal => {
      if (batchDamaged || !batchRecord || !batchRecord.eventIds.includes(eventId)) throw unavailable();
      scrub(); publish({ eventId, inputRef: null }); return readEvent(eventId, signal);
    }),
    queue: (filters: AiAutomationReviewQueueFiltersDraft = {}, after?: string) => run('queue', async signal => {
      const query = validateAutomationReview<{ limit: number; filters: AiAutomationReviewQueueFiltersDraft; after?: string }>('AiAutomationReviewQueueRequestDraft', { limit: 10, filters, ...(after ? { after } : {}) });
      const result = validateAutomationReview<AiAutomationReviewQueueResponseDraft>('AiAutomationReviewQueueResponseDraft', await input.api.queue(query, signal)); assert();
      publish({ queue: result, queueFilters: structuredClone(filters) }); return result;
    }),
    select: (eventId: string, inputRef?: string) => run('event', async signal => {
      uuid.parse(eventId); if (inputRef) uuid.parse(inputRef);
      scrub(); publish({ eventId, inputRef: inputRef ?? null }); return readEvent(eventId, signal);
    }),
    nextInputs: () => run('event', async signal => {
      if (!view.eventId || !view.event?.inputs.nextAfter) throw unavailable();
      return readEvent(view.eventId, signal, view.event.inputs.nextAfter);
    }),
    selectInput: (inputRef: string) => run('review', async signal => {
      if (!view.eventId || !view.event?.inputs.items.some(row => row.inputRef === inputRef)) throw unavailable();
      retractGrant();
      const result = parsedReview(await input.api.review(inputRef, signal), inputRef, view.eventId); assert();
      publish({ inputRef, review: result, operation: null, openedEntry: null }); return result;
    }),
    fromEvent: () => run('create', async signal => {
      assertWritable(); if (!view.eventId || !view.event || !view.candidate || !['pending', 'ready'].includes(view.candidate.status)
        || view.event.nextAction !== 'human_business_review'
        || view.event.inputs.state !== 'not_observed' || view.event.inputs.hasMore) throw unavailable();
      const original: Extract<Journal, { kind: 'from_event' }> = { kind: 'from_event', status: 'pending', scope,
        eventId: view.eventId, inputRef: null, creationKey: null };
      store(original); assert();
      const result = validateAutomationReview<AiAutomationEventTaskResponseDraft>('AiAutomationEventTaskResponseDraft', await input.api.fromEvent(original.eventId, signal)); assert();
      if (result.eventId !== original.eventId) throw unavailable();
      const reference = { ...original, inputRef: result.inputRef, creationKey: result.creationKey }; store(reference);
      const event = await readEvent(original.eventId, signal); await readCreation(reference, event, signal);
      if (record?.status === 'pending') throw Error('AI_RESULT_UNKNOWN');
      return result;
    }),
    recover: () => run('operation', async signal => {
      if (damaged || !record) throw unavailable();
      const original = structuredClone(record);
      if (original.kind === 'from_event') {
        const event = await readEvent(original.eventId, signal);
        return readCreation(original, event, signal);
      }
      return operation(original, signal);
    }),
    prepareGrant: (action: GrantAction) => run('grant-prepare', async signal => {
      assertWritable();
      if (!view.review || view.review.currentSource.failed === null) throw unavailable();
      const shown = view.review, before = await freshReview(shown.inputRef, signal);
      if (reviewStamp(before) !== reviewStamp(shown) || action === 'close' && before.review.status === 'closed') throw Error('AI_REVISION_CONFLICT');
      const preparation = preparedGrant(await input.api.prepareGrant({ inputRef: before.inputRef, action }, signal), before, action); assert();
      const after = await freshReview(before.inputRef, signal);
      if (reviewStamp(before) !== reviewStamp(after)) throw Error('AI_REVISION_CONFLICT');
      retractGrant(); preparedReview = reviewStamp(after);
      publish({ review: after, grantPreparation: preparation }); return preparation;
    }),
    canEnableGrant: () => Boolean(active && input.current() && !view.busy && !damaged && !grantDamaged && !batchDamaged
      && batchRecord?.status !== 'dispatched'
      && record?.status !== 'pending' && !grantRecord && view.review && view.grantPreparation
      && preparedReview === reviewStamp(view.review) && Date.parse(view.grantPreparation.expiresAt) > clock()),
    enableGrant: (preparedRef: string) => run('grant-enable', async signal => {
      assertWritable();
      const preparation = view.grantPreparation;
      if (!preparation || preparation.preparedRef !== preparedRef || !view.review
        || preparedReview !== reviewStamp(view.review) || !(Date.parse(preparation.expiresAt) > clock())) throw Error('AI_RECONFIRM_GRANT');
      const before = await freshReview(preparation.key.inputId, signal);
      if (reviewStamp(before) !== preparedReview) throw Error('AI_REVISION_CONFLICT');
      preparedGrant(preparation, before, preparation.key.action);
      const original = grantLocatorSchema.parse({ inputRef: preparation.key.inputId, action: preparation.key.action,
        expectedRevision: preparation.key.expectedRevision, preparedRef });
      // Only the minimal original locator reaches storage. The complete fixed
      // preparation stays in this live view and is sent once after read-back.
      writeGrant(original); assert();
      const result = validateAutomationReview<AiAutomationReviewGrantEnableDraft>('AiAutomationReviewGrantEnableDraft',
        await input.api.enableGrant(structuredClone(preparation), signal)); assert();
      if (result.state === 'unknown') {
        if (!same(original, { inputRef: result.inputRef, action: result.action, expectedRevision: result.expectedRevision, preparedRef: result.preparedRef })) throw unavailable();
        throw Error('AI_RESULT_UNKNOWN');
      }
      if (!receiptMatchesPreparation(result.receipt, preparation)) throw unavailable();
      const observed = await readGrant(original, signal, preparation);
      if (observed.state !== 'observed' || !observed.receipt) throw Error('AI_RESULT_UNKNOWN');
      return observed;
    }),
    readGrant: (action: GrantAction) => run('grant-read', async signal => {
      if (grantDamaged || grantRecord) throw Error('AI_RESULT_UNKNOWN');
      if (!view.review) throw unavailable();
      if (!same(input.store.grant.read(), grantRecord)) { grantDamaged = true; publish({ grantLocatorDamaged: true }); throw Error('AI_GRANT_LOCATOR_ALREADY_EXISTS'); }
      const current = view.review;
      return readGrant({ inputRef: current.inputRef, action, expectedRevision: current.review.revision }, signal);
    }),
    recoverGrant: () => run('grant-read', async signal => {
      if (grantDamaged || !grantRecord) throw unavailable();
      // Recover only the grant's own receipt plus the terminal read authority;
      // do not expire an event marker, create work or replay either write log.
      const original = structuredClone(grantRecord);
      const result = await readGrant(original, signal, undefined, true);
      if (result.state !== 'observed' || !result.receipt) throw Error('AI_RESULT_UNKNOWN');
      return result;
    }),
    clearGrantPreview() {
      assert(); if (view.busy) throw Error('AI_OPERATION_BUSY');
      retractGrant(); publish({ grantPreparation: null, grantObservation: null });
    },
    canMutate: (action: GrantAction) => !view.busy && usableGrant(action),
    close: (reason: AiAutomationReviewCloseReasonDraft, preparedRef: string) => mutate('close', reason, preparedRef),
    feedback: (code: AiAutomationReviewFeedbackCodeDraft, preparedRef: string) => mutate('feedback', code, preparedRef),
    recheck: () => run('recheck', async signal => {
      if (!view.eventId) throw unavailable();
      const event = await readEvent(view.eventId, signal);
      const result = { eventId: event.event.eventId, resource: structuredClone(event.originalResource),
        source: structuredClone(event.currentSource), readAt: new Date(clock()).toISOString() };
      publish({ recheck: result }); return result;
    }),
    openEntry: (kind: 'explanation' | 'business') => run(kind, async signal => {
      const open = kind === 'explanation' ? input.explainOriginal : input.openOriginal;
      if (!open) throw Error('AI_CAPABILITY_UNAVAILABLE');
      const original = await target(signal); assert();
      const result = await open(structuredClone(original), signal); assert();
      if (!result || Object.keys(result).length !== 1 || result.state !== 'opened') throw Error('AI_CAPABILITY_UNAVAILABLE');
      // The parent opens its original guarded entry. Neither this response nor
      // the existence of a callback attests that a model/business action ran.
      publish({ openedEntry: kind, recheck: null }); return result;
    }),
    dispose() { active = false; owner?.abort(); owner = null; scrub(); view = { ...view, busy: null }; },
  };
}

export type AutomationReviewSession = ReturnType<typeof createAutomationReviewSession>;
