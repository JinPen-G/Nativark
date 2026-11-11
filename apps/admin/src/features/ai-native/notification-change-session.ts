/** Human notification preparation -> original creation/start receipts. Only
 * original keys and the uncertain stage enter storage. Recovery reads never
 * dispatch the next stage; approval and Core commit belong to the task host. */
import { z } from 'zod';
import { AI_APPROVED_SETTINGS_DRAFT_VERSION, type AiApprovedSettingsCurrentDraft,
  type AiApprovedSettingsChangePrepareDraft, type AiApprovedSettingsChangeReviewDraft,
  type AiApprovedSettingsCreatedTaskDraft, type AiApprovedSettingsTaskCreationDraft,
  type AiApprovedSettingsTaskConfirmationReadDraft, type AiApprovedSettingsTaskResultDraft } from '@rental-os/shared';
import type { aiNotificationChangesApi } from '@/api/aiNotificationChanges';

type Original = AiApprovedSettingsTaskCreationDraft;
type Notifications = AiApprovedSettingsChangePrepareDraft['notifications'];
type Stage = 'prepare' | 'create' | 'start';
const key = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const journalSchema = z.object({ original: z.object({ changeKey: key, creationKey: key }).strict(),
  stage: z.enum(['prepare', 'create', 'start']) }).strict();
type Journal = z.infer<typeof journalSchema>;
export interface NotificationChangeStore {
  read(): Journal | null;
  write(value: Journal, expected: Journal | null): void;
  clear(expected: Journal): void;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function notificationChangeStore(name: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): NotificationChangeStore {
  const encode = (value: Journal) => JSON.stringify(journalSchema.parse(value));
  return { read() {
    const raw = storage?.getItem(name); if (raw === undefined || raw === null) return null;
    if (!raw || raw.length > 512) throw Error('AI_OPERATION_LOCATOR_DAMAGED');
    try { return journalSchema.parse(JSON.parse(raw)); } catch { throw Error('AI_OPERATION_LOCATOR_DAMAGED'); }
  }, write(value, expected) {
    if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    if (storage.getItem(name) !== (expected ? encode(expected) : null)) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
    const next = encode(value); storage.setItem(name, next);
    if (storage.getItem(name) !== next) throw Error('AI_OPERATION_LOCATOR_UNCONFIRMED');
  }, clear(expected) {
    if (!storage || storage.getItem(name) !== encode(expected)) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
    storage.removeItem(name);
    if (storage.getItem(name) !== null) throw Error('AI_OPERATION_LOCATOR_UNCONFIRMED');
  } };
}
const validId = (value: unknown, maximum = 36) => typeof value === 'string' && value.length <= maximum
  && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
const validRevision = (value: unknown) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 4294967294;
const channels = ['sms', 'app_push', 'wechat', 'email'] as const;
function notifications(value: Notifications): Notifications {
  if (!value || !Array.isArray(value.enabledEvents) || value.enabledEvents.length > 64
    || value.enabledEvents.some(item => typeof item !== 'string' || !item || item.length > 191)
    || new Set(value.enabledEvents).size !== value.enabledEvents.length || !Array.isArray(value.editableChannels)
    || value.editableChannels.length < 1 || value.editableChannels.length > 4
    || value.editableChannels.some(item => !channels.includes(item))
    || new Set(value.editableChannels).size !== value.editableChannels.length) throw Error('AI_INVALID_INPUT');
  return structuredClone(value);
}
function current(value: AiApprovedSettingsCurrentDraft) {
  if (!value || !validRevision(value.settingsRevision)) throw Error('AI_RESOURCE_UNAVAILABLE');
  return { settingsRevision: value.settingsRevision, notifications: notifications(value.notifications) };
}
function change(value: AiApprovedSettingsChangeReviewDraft) {
  if (!value || !validId(value.changeId) || !/^[a-f0-9]{64}$/u.test(value.changeHash)
    || !validRevision(value.baseRevision) || !Number.isFinite(Date.parse(value.expiresAt))) throw Error('AI_RESOURCE_UNAVAILABLE');
  notifications({ enabledEvents: value.diff['notifications.enabledEvents'].before,
    editableChannels: value.diff['notifications.editableChannels'].before });
  notifications({ enabledEvents: value.diff['notifications.enabledEvents'].after,
    editableChannels: value.diff['notifications.editableChannels'].after });
  return structuredClone(value);
}
const invalid = () => Error('AI_RESOURCE_UNAVAILABLE');

export function createNotificationChangeSession(input: { current(): boolean; api: typeof aiNotificationChangesApi;
  store: NotificationChangeStore; changed(): void; clock?: () => Date }) {
  let active = true, owner: AbortController | null = null, pending: Journal | null = null;
  let damaged = false, initialError: unknown = null;
  try { pending = input.store.read(); } catch (error) { damaged = true; initialError = error; }
  let view: { current: AiApprovedSettingsCurrentDraft | null;
    review: { before: AiApprovedSettingsCurrentDraft; after: Notifications; expiresAt: string } | null;
    original: Original | null; change: AiApprovedSettingsChangeReviewDraft | null; task: AiApprovedSettingsCreatedTaskDraft | null;
    confirmation: AiApprovedSettingsTaskConfirmationReadDraft | null; result: AiApprovedSettingsTaskResultDraft | null;
    creationObserved: boolean | null; pending: Journal | null; locatorDamaged: boolean; busy: string | null; error: unknown } = {
      current: null, review: null, original: pending?.original ?? null, change: null, task: null,
      confirmation: null, result: null, creationObserved: null, pending, locatorDamaged: damaged, busy: null, error: initialError };
  const assert = () => { if (!active || !input.current()) throw Error('AI_SCOPE_CHANGED'); };
  const publish = (next: Partial<typeof view>) => { if (active && input.current()) { view = { ...view, ...next }; input.changed(); } };
  const persist = (original: Original, stage: Stage) => {
    const next = journalSchema.parse({ original, stage });
    try { input.store.write(next, pending); pending = next; publish({ pending, original: next.original }); }
    catch (error) { damaged = true; publish({ locatorDamaged: true }); throw error; }
  };
  const complete = () => {
    if (pending) input.store.clear(pending); pending = null; publish({ pending: null });
  };
  const run = async <T>(name: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    assert(); if (view.busy) throw Error('AI_OPERATION_BUSY');
    const request = new AbortController(); owner = request; publish({ busy: name, error: null });
    try { const result = await work(request.signal); assert(); if (request.signal.aborted) throw Error('AI_SCOPE_CHANGED'); return result; }
    catch (error) { publish({ error }); throw error; }
    finally { if (owner === request) { owner = null; publish({ busy: null }); } }
  };
  const read = async (original: Original, signal: AbortSignal) => {
    assert();
    const prepared = await input.api.change(original.changeKey, signal); assert();
    if (prepared.state === 'not_observed') return;
    if (prepared.state !== 'prepared_not_approved') throw invalid();
    const material = change(prepared.change); publish({ original, change: material });
    const created = await input.api.creation(original, signal); assert();
    if (!created || created.receipt.creationKey !== original.creationKey || created.original.changeId !== material.changeId
      || created.original.changeHash !== material.changeHash || created.execution !== 'not_attested' || created.approval !== 'not_granted') throw invalid();
    if (created.receipt.state !== 'observed') {
      publish({ creationObserved: created.receipt.state === 'not_observed' ? false : null }); return;
    }
    const task = created.receipt.task;
    if (!task || !validId(task.taskId) || !validId(task.runId) || !validRevision(task.revision)) throw invalid();
    if (view.task && (view.task.taskId !== task.taskId || view.task.runId !== task.runId)) throw invalid();
    publish({ task, creationObserved: true });
    // Before the first start there are deliberately no task read policies.
    // The original creation receipt can acknowledge creation; the NEXT start
    // still has to pass the server's untouched Task/Run admission checks.
    if (pending?.stage === 'create' && task.status === 'queued' && task.revision === 1) return;
    const result = await input.api.result(original, signal); assert();
    if (result.snapshot.task.taskId !== task.taskId || result.snapshot.run.runId !== task.runId
      || result.execution !== 'not_invoked' || result.automaticRetry !== false) throw invalid();
    if (result.operation && (result.businessOutcome !== 'committed' || result.operation.changeId !== material.changeId
      || result.operation.changeHash !== material.changeHash || result.operation.baseRevision !== material.baseRevision
      || result.operation.resultRevision !== material.baseRevision + 1)) throw invalid();
    // The original Core receipt closes this operation independently. A completed
    // change does not need an obsolete confirmation snapshot or another action.
    if (result.operation) { publish({ result, confirmation: null }); complete(); return; }
    if (result.snapshot.task.status !== 'waiting_confirmation') { publish({ result, confirmation: null }); return; }
    const confirmation = await input.api.confirmation(original, signal); assert();
    if (confirmation.state === 'waiting_confirmation') {
      if (confirmation.checkpoint.taskId !== task.taskId || confirmation.checkpoint.runId !== task.runId
        || confirmation.reference.taskId !== task.taskId || !validId(confirmation.checkpoint.stepId)
        || confirmation.reference.proposalId !== confirmation.checkpoint.proposal.proposalId
        || confirmation.reference.proposalRevision !== confirmation.checkpoint.proposal.proposalRevision
        || confirmation.reference.reviewedPayloadHash !== confirmation.checkpoint.proposal.reviewedPayloadHash
        || confirmation.review.draftVersion !== AI_APPROVED_SETTINGS_DRAFT_VERSION
        || !same(change(confirmation.review.change), material) || confirmation.continuation !== 'not_invoked') throw invalid();
    } else if (confirmation.state !== 'not_waiting' || confirmation.snapshot.taskId !== task.taskId) throw invalid();
    publish({ result, confirmation });
    // The actual wait or Core receipt positively observes the original start.
    // Queued/absent/failed reads do not prove it safe to send that start again.
    if (confirmation.state === 'waiting_confirmation' || result.operation) complete();
  };
  const canContinue = () => !view.busy && !!view.change && !damaged && !!pending && (
    pending.stage === 'prepare' && view.creationObserved === false
    || pending.stage === 'create' && view.creationObserved === true && view.task?.status === 'queued'
      && view.task.revision === 1);
  const start = async (original: Original, signal: AbortSignal) => {
    persist(original, 'start'); await input.api.start(original, signal); assert();
    await read(original, signal); if (pending) throw Error('AI_RESULT_UNKNOWN');
  };
  const create = async (original: Original, material: AiApprovedSettingsChangeReviewDraft, signal: AbortSignal) => {
    persist(original, 'create');
    const created = await input.api.create(original, signal); assert();
    if (created.original.changeId !== material.changeId || created.original.changeHash !== material.changeHash
      || created.execution !== 'not_attested' || created.approval !== 'not_granted'
      || !validId(created.receipt.taskId) || !validId(created.receipt.runId) || !validRevision(created.receipt.revision)) throw invalid();
    publish({ task: created.receipt });
    if (created.receipt.replayed) { await read(original, signal); return; }
    await start(original, signal);
  };
  return Object.freeze({ get view() { return { ...view, canContinue: canContinue() }; },
    clearReview() {
      assert(); if (view.busy || pending || view.original) throw Error('AI_RESULT_UNKNOWN');
      publish({ review: null });
    },
    load() { return run('load', async signal => {
      if (pending || damaged) throw Error('AI_RESULT_UNKNOWN');
      if (input.store.read() !== null) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
      const found = current(await input.api.current(signal)); assert(); publish({ current: found, review: null }); return found;
    }); },
    inspect(value: Notifications, expiresAt: string) {
      assert(); if (view.busy || pending || damaged || !view.current) throw invalid();
      const after = notifications(value), at = (input.clock ?? (() => new Date()))();
      if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= at.getTime()) throw Error('AI_INVALID_INPUT');
      if (same(after, view.current.notifications)) throw Error('AI_INVALID_INPUT');
      publish({ review: { before: structuredClone(view.current), after, expiresAt } });
    },
    prepare(original: Original) { return run('prepare', async signal => {
      if (pending || damaged || !view.review || view.original || input.store.read() !== null) throw Error('AI_RESULT_UNKNOWN');
      const keys = journalSchema.parse({ original, stage: 'prepare' }).original, reviewed = structuredClone(view.review);
      const fresh = current(await input.api.current(signal)); assert();
      if (!same(fresh, reviewed.before)) throw Error('AI_REVISION_CONFLICT');
      persist(keys, 'prepare');
      const saved = await input.api.prepare({ changeKey: keys.changeKey, baseRevision: fresh.settingsRevision,
        notifications: reviewed.after, expiresAt: reviewed.expiresAt }, signal); assert();
      const material = change(saved.change);
      if (saved.task !== 'not_created' || saved.approval !== 'not_granted' || saved.activeSettings !== 'not_modified'
        || material.baseRevision !== fresh.settingsRevision || Date.parse(material.expiresAt) !== Date.parse(reviewed.expiresAt)
        || !same(material.diff['notifications.enabledEvents'], { before: fresh.notifications.enabledEvents, after: reviewed.after.enabledEvents })
        || !same(material.diff['notifications.editableChannels'], { before: fresh.notifications.editableChannels, after: reviewed.after.editableChannels })) throw invalid();
      publish({ change: material });
      await create(keys, material, signal);
    }); },
    continuePreparation() {
      assert(); if (!canContinue() || !view.original || !view.change) throw Error('AI_RESULT_UNKNOWN');
      const original = structuredClone(view.original), material = structuredClone(view.change), stage = pending!.stage;
      return run('continue', async signal => {
        await read(original, signal);
        if (!same(view.change, material) || pending?.stage !== stage) throw Error('AI_REVISION_CONFLICT');
        // A positive original preparation/creation receipt can permit the NEXT
        // never-delegated stage after another explicit human confirmation.
        // An uncertain create/start is never resent from an absence response.
        if (stage === 'prepare' && view.creationObserved === false) await create(original, material, signal);
        else if (stage === 'create' && view.creationObserved === true && view.task?.status === 'queued'
          && view.task.revision === 1) await start(original, signal);
        else throw Error('AI_RESULT_UNKNOWN');
      });
    },
    read() { return run('read', async signal => {
      if (damaged || !view.original) throw invalid();
      const current = input.store.read();
      if (current && !same(current.original, view.original)) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
      await read(view.original, signal);
    }); },
    dispose() { active = false; owner?.abort(); owner = null; view = { ...view, current: null, review: null,
      change: null, confirmation: null, result: null, task: null, busy: null, error: null }; }
  });
}
