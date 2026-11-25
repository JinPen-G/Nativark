/** Notification draft UI lifecycle. Only the original operation key is stored;
 * customer content and variables remain memory-only. An uncertain save permits
 * original receipt reads, never another key, replay or implicit sending. */
import { aiEntryNotificationDraftPrepareSchema, aiEntryNotificationDraftResponseSchema,
  type AiEntryNotificationDraftPrepare, type AiEntryNotificationDraftResponse } from '@rental-os/shared';
import type { AiNotificationDraftsApi } from "../api/aiNotificationDrafts";
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export interface NotificationDraftStore {
  read(): string | null;
  write(key: string, expected: string | null): void;
  clear(expected: string): void;
}
export function notificationDraftStore(name: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): NotificationDraftStore {
  const read = () => {
    if (!storage) throw Error('AI_STORAGE_UNAVAILABLE');
    const raw = storage.getItem(name); if (raw === null) return null;
    if (!KEY.test(raw)) throw Error('AI_ORIGINAL_LOCATOR_DAMAGED'); return raw;
  };
  return { read, write(key, expected) {
    if (!KEY.test(key) || read() !== expected) throw Error('AI_ORIGINAL_LOCATOR_CHANGED');
    storage!.setItem(name, key); if (read() !== key) throw Error('AI_ORIGINAL_LOCATOR_DAMAGED');
  }, clear(expected) {
    if (read() !== expected) throw Error('AI_ORIGINAL_LOCATOR_CHANGED');
    storage!.removeItem(name); if (read() !== null) throw Error('AI_ORIGINAL_LOCATOR_DAMAGED');
  } };
}
export function createNotificationDraftSession(d: { current(): boolean; changed(): void; customerId: string;
  scope: { tenantId: string; workspaceId: string }; api: AiNotificationDraftsApi; store: NotificationDraftStore;
  clock?(): number }) {
  type Prepared = Extract<AiEntryNotificationDraftResponse, { state: 'prepared' }>;
  let active = true, request: AbortController | null = null, preparedInput: AiEntryNotificationDraftPrepare | null = null;
  let view: { frame: AiEntryNotificationDraftResponse | null; operationKey: string | null;
    pending: boolean; damaged: boolean; busy: string | null; error: unknown } = {
      frame: null, operationKey: null, pending: false, damaged: false, busy: null, error: null };
  try { view.operationKey = d.store.read(); view.pending = view.operationKey !== null; }
  catch (error) { view.damaged = true; view.error = error; }
  const now = d.clock ?? Date.now;
  const check = () => { if (!active || !d.current() || request?.signal.aborted) throw Error('AI_SCOPE_CHANGED'); };
  const update = (change: Partial<typeof view>) => { if (active && d.current()) { view = { ...view, ...change }; d.changed(); } };
  const validate = (value: unknown, key: string) => {
    const response = aiEntryNotificationDraftResponseSchema.parse(value);
    const material = response.state === 'prepared' ? response.material : response.state === 'saved' ? response.draft : null;
    if (response.operationKey !== key || response.scope.tenantId !== d.scope.tenantId || response.scope.workspaceId !== d.scope.workspaceId
      || material && material.customerId !== d.customerId) throw Error('AI_SCOPE_CHANGED');
    return response;
  };
  const releaseResolved = (key: string) => {
    try {
      const stored = d.store.read();
      if (stored !== null && stored !== key) throw Error('AI_ORIGINAL_LOCATOR_CHANGED');
      if (stored === key) d.store.clear(key);
    } catch (error) { update({ damaged: true }); throw error; }
  };
  const run = async <T>(name: string, work: (signal: AbortSignal) => Promise<T>) => {
    check(); if (request) throw Error('AI_OPERATION_BUSY');
    const controller = new AbortController(); request = controller; update({ busy: name, error: null });
    try { const result = await work(controller.signal); check(); return result; }
    catch (error) { preparedInput = null; update({ frame: null, error }); throw error; }
    finally { if (request === controller) { request = null; update({ busy: null }); } }
  };
  const receipt = async (key: string, signal: AbortSignal) => {
    const result = validate(await d.api.read(key, signal), key); check();
    if (result.state === 'prepared') throw Error('AI_RESOURCE_UNAVAILABLE');
    if (result.state === 'saved') releaseResolved(key);
    preparedInput = null; update({ frame: result, operationKey: key, pending: result.state === 'unknown' }); return result;
  };
  return Object.freeze({ get view() { return view; }, current: () => active && d.current(),
    activate() {
      if (active) return;
      active = true;
      try { const key = d.store.read(); view = { ...view, operationKey: key, pending: key !== null,
        frame: null, busy: null, error: null, damaged: false }; }
      catch (error) { view = { ...view, frame: null, busy: null, damaged: true, error }; }
    },
    prepare(value: AiEntryNotificationDraftPrepare) {
      return run('prepare', async signal => {
        if (view.damaged || view.pending || view.operationKey) throw Error('AI_RESULT_UNKNOWN');
        const input = aiEntryNotificationDraftPrepareSchema.parse(structuredClone(value));
        if (input.customerId !== d.customerId) throw Error('AI_SCOPE_CHANGED');
        preparedInput = null; update({ frame: null });
        const result = validate(await d.api.prepare(input, signal), input.operationKey); check();
        if (result.state === 'prepared') {
          if (Date.parse(result.expiresAt) <= now()) throw Error('AI_RESOURCE_UNAVAILABLE');
          preparedInput = structuredClone(input); update({ frame: result });
        } else { update({ frame: result, operationKey: input.operationKey, pending: result.state === 'unknown' }); }
        return result;
      });
    },
    save() {
      return run('save', async signal => {
        const frame = view.frame?.state === 'prepared' ? structuredClone(view.frame) as Prepared : null;
        const input = preparedInput && structuredClone(preparedInput);
        if (!frame || !input || view.pending || view.damaged || view.operationKey || Date.parse(frame.expiresAt) <= now()) throw Error('AI_RESULT_UNKNOWN');
        // Preserve the locator and read it back before the first possible write.
        try { d.store.write(input.operationKey, null); } catch (error) { update({ damaged: true }); throw error; }
        check();
        update({ operationKey: input.operationKey, pending: true, frame: null }); preparedInput = null;
        const existing = await receipt(input.operationKey, signal);
        if (existing.state === 'saved') return existing;
        // This read was before the first dispatch, not evidence permitting a
        // retry of a prior unknown operation. There is only one save call here.
        if (Date.parse(frame.expiresAt) <= now()) throw Error('AI_RESULT_UNKNOWN');
        try { if (d.store.read() !== input.operationKey) throw Error('AI_ORIGINAL_LOCATOR_CHANGED'); }
        catch (error) { update({ damaged: true }); throw error; }
        check();
        const result = validate(await d.api.save({ action: frame.action, command: { ...input,
          reviewHash: frame.reviewHash, expiresAt: frame.expiresAt, decision: 'save_unsent_notification_draft' } }, signal), input.operationKey);
        check(); if (result.state === 'prepared') throw Error('AI_RESOURCE_UNAVAILABLE');
        if (result.state === 'saved') releaseResolved(input.operationKey);
        update({ frame: result, pending: result.state === 'unknown' }); return result;
      });
    },
    read() { return run('read', async signal => {
      if (view.damaged) throw Error('AI_ORIGINAL_LOCATOR_DAMAGED');
      const key = view.operationKey ?? d.store.read(); if (!key) throw Error('AI_INVALID_INPUT');
      update({ frame: null }); return receipt(key, signal);
    }); },
    newDraft() {
      check(); if (request || view.pending || view.damaged) throw Error('AI_RESULT_UNKNOWN');
      if (view.operationKey) {
        if (view.frame?.state !== 'saved') throw Error('AI_RESULT_UNKNOWN');
        releaseResolved(view.operationKey);
      }
      preparedInput = null; update({ frame: null, operationKey: null, error: null });
    },
    invalidate() { preparedInput = null; update({ frame: null }); },
    dispose() { active = false; request?.abort(); request = null; preparedInput = null; view = { ...view, frame: null, busy: null }; },
  });
}
