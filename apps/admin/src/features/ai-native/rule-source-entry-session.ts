/** Stable owner/object journal for original rule Task creation. Configuration
 * revisions stay in server material, never the storage key. Positive entry ACKs
 * remain locatable; a new round requires a fresh original Core receipt read. */
import { aiTaskRuleSourceEntryReference, type AiTaskRuleSourceEntryReference, type AiTaskRuleSourceInput,
  type AiTaskRuleSourceResponse, type AiTaskRuleSourceEntryInput, type AiTaskRuleSourceEntryResponse,
  type AiTaskRuleDraftReference, type AiTaskRuleDraftOperationResponse } from '@rental-os/shared';

export function ruleSourceEntryStore(key: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const read = (): AiTaskRuleSourceEntryReference | null => {
    if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); const text = storage.getItem(key);
    if (text === null) return null; if (!text || text.length > 512) throw Error('AI_RESULT_UNKNOWN');
    return aiTaskRuleSourceEntryReference.parse(JSON.parse(text));
  };
  return { read, write(value: AiTaskRuleSourceEntryReference) {
    if (!storage || storage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN');
    const encoded = JSON.stringify(aiTaskRuleSourceEntryReference.parse(value)); storage.setItem(key, encoded);
    if (storage.getItem(key) !== encoded) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  }, clear(expected: AiTaskRuleSourceEntryReference) {
    if (!storage || storage.getItem(key) !== JSON.stringify(aiTaskRuleSourceEntryReference.parse(expected))) throw Error('AI_RESULT_UNKNOWN');
    storage.removeItem(key); if (storage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN');
  } };
}
type Api = {
  source(value: AiTaskRuleSourceInput, signal: AbortSignal): Promise<AiTaskRuleSourceResponse>;
  entry(value: AiTaskRuleSourceEntryInput, signal: AbortSignal): Promise<AiTaskRuleSourceEntryResponse>;
  entryOperation(value: AiTaskRuleSourceEntryReference, signal: AbortSignal): Promise<AiTaskRuleSourceEntryResponse>;
  operation(value: AiTaskRuleDraftReference, signal: AbortSignal): Promise<AiTaskRuleDraftOperationResponse>;
};
export function createRuleSourceEntrySession(input: { targetId: string; version: string; tenantId: string; workspaceId: string;
  current(): boolean; changed(): void; api: Api; store: ReturnType<typeof ruleSourceEntryStore> }) {
  let active = true, request: AbortController | null = null;
  let view: { source: AiTaskRuleSourceResponse | null; pending: AiTaskRuleSourceEntryReference | null;
    operation: AiTaskRuleSourceEntryResponse | null; prepared: AiTaskRuleDraftReference | null; committed: AiTaskRuleDraftReference | null;
    invalid: boolean; busy: boolean; error: unknown } = { source: null, pending: null, operation: null, prepared: null, committed: null, invalid: false, busy: false, error: null };
  const check = (signal?: AbortSignal) => { if (!active || !input.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); };
  const publish = (next: Partial<typeof view>) => { if (active && input.current()) { view = { ...view, ...next }; input.changed(); } };
  const restore = () => { if (view.invalid) return; try { const pending = input.store.read();
    if (view.pending && (!pending || pending.operationKey !== view.pending.operationKey)) throw Error('AI_RESULT_UNKNOWN');
    view = { ...view, pending }; } catch { view = { ...view, invalid: true }; } };
  restore();
  const run = async (work: (signal: AbortSignal) => Promise<void>) => { check(); if (request) throw Error('AI_OPERATION_BUSY');
    const controller = new AbortController(); request = controller; publish({ busy: true, error: null });
    try { await work(controller.signal); check(controller.signal); }
    catch (error) { if (request === controller && !controller.signal.aborted) publish({ error }); throw error; }
    finally { if (request === controller) { request = null; publish({ busy: false }); } } };
  const scope = (value: { tenantId: string; workspaceId: string }) => {
    if (value.tenantId !== input.tenantId || value.workspaceId !== input.workspaceId) throw Error('AI_SCOPE_CHANGED');
  };
  const observe = (value: AiTaskRuleSourceEntryResponse, reference: AiTaskRuleSourceEntryReference) => {
    scope(value.scope); if (value.reference.operationKey !== reference.operationKey) throw Error('AI_SCOPE_CHANGED');
    if (value.operation.state === 'original_request_recorded' && value.operation.target.id !== input.targetId) throw Error('AI_SCOPE_CHANGED');
    publish({ operation: value });
  };
  return Object.freeze({ get view() { return view; },
    async read() { check(); restore(); if (view.pending || view.invalid) throw Error('AI_RESULT_UNKNOWN'); return run(async signal => {
      publish({ source: null }); const value = await input.api.source({ targetId: input.targetId, version: input.version }, signal);
      check(signal); scope(value.scope); if (value.target.id !== input.targetId || value.target.version !== input.version) throw Error('AI_REVISION_CONFLICT');
      restore(); if (view.pending || view.invalid) throw Error('AI_RESULT_UNKNOWN'); publish({ source: value }); }); },
    async create(operationKey: string) { check(); restore(); const source = view.source; if (!source || view.pending || view.invalid) throw Error('AI_RESOURCE_UNAVAILABLE');
      return run(async signal => { const reference = aiTaskRuleSourceEntryReference.parse({ operationKey });
        view = { ...view, pending: reference }; input.changed(); input.store.write(reference);
        if (input.store.read()?.operationKey !== operationKey) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); check(signal);
        const value = await input.api.entry({ targetId: source.target.id, version: source.target.version, sourceHash: source.target.sourceHash,
          operationKey, decision: 'create_original_rule_task' }, signal); check(signal); observe(value, reference); }); },
    async operation() { check(); const reference = view.pending; if (!reference) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      return run(async signal => { const value = await input.api.entryOperation(reference, signal); check(signal); observe(value, reference); }); },
    prepared(reference: AiTaskRuleDraftReference) { check();
      const operation = view.operation?.operation;
      if (operation?.state !== 'original_request_recorded' || operation.task.state !== 'observed'
        || reference.taskId === operation.task.taskId) throw Error('AI_SCOPE_CHANGED');
      publish({ prepared: structuredClone(reference), committed: null });
    },
    confirmed(value: AiTaskRuleDraftOperationResponse) { check();
      const operation = view.operation?.operation;
      if (operation?.state !== 'original_request_recorded' || operation.task.state !== 'observed' || value.operation.state !== 'committed'
        || value.operation.source.id !== input.targetId || !view.prepared || value.reference.taskId !== view.prepared.taskId
        || value.reference.runId !== view.prepared.runId || value.reference.stepId !== view.prepared.stepId) throw Error('AI_SCOPE_CHANGED');
      publish({ committed: structuredClone(value.reference) });
    },
    async beginNext() { check(); const reference = view.pending, committed = view.committed; restore();
      if (!reference || !committed || view.invalid) throw Error('AI_RESULT_UNKNOWN'); return run(async signal => {
        const original = await input.api.entryOperation(reference, signal); check(signal); observe(original, reference);
        const receipt = await input.api.operation(committed, signal); check(signal);
        if (receipt.reference.taskId !== committed.taskId || receipt.reference.runId !== committed.runId || receipt.reference.stepId !== committed.stepId
          || receipt.operation.state !== 'committed' || receipt.operation.source.id !== input.targetId) throw Error('AI_RESULT_UNKNOWN');
        input.store.clear(reference); view = { ...view, pending: null, source: null, operation: null, prepared: null, committed: null }; input.changed(); }); },
    activate() { active = true; restore(); input.changed(); },
    clear() { request?.abort(); request = null; view = { ...view, source: null, operation: null, prepared: null, committed: null, busy: false, error: null }; if (active && input.current()) input.changed(); },
    dispose() { active = false; request?.abort(); request = null; view = { ...view, source: null, operation: null, prepared: null, committed: null, busy: false, error: null }; }
  });
}
