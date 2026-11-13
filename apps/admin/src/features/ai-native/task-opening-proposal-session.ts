/** One current human proposal interaction. A journal is read back before the
 * sole prepare dispatch; unknown/reopened work only reads that operation.
 * Original locators persist, while editable values and differences do not. */
import type { AiTaskOpeningProposalQueryDraft, AiTaskOpeningProposalSectionDraft, AiTaskOpeningProposalListDraft,
  AiTaskOpeningProposalPreviewDraft, AiTaskOpeningProposalOperationDraft, AiTaskOpeningProposalOperationReadDraft } from '@rental-os/shared';
import { aiTaskOpeningProposalsApi, validateTaskOpeningProposal } from '@/api/aiTaskOpeningProposals';

type Api = typeof aiTaskOpeningProposalsApi;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type View = { busy: boolean; list: AiTaskOpeningProposalListDraft | null; preview: AiTaskOpeningProposalPreviewDraft | null;
  operation: AiTaskOpeningProposalOperationDraft | null; pending: AiTaskOpeningProposalOperationReadDraft | null;
  error: boolean; unknown: boolean; locked: boolean };
const signature = (value: unknown) => JSON.stringify(value);
export function createTaskOpeningProposalSession(input: { query: AiTaskOpeningProposalQueryDraft; tenantId: string; workspaceId: string;
  current(): boolean; changed(): void; store?: Storage; storageKey: string; api?: Api; newOperationKey?(): string;
  initialList?: AiTaskOpeningProposalListDraft; target?: { key: AiTaskOpeningProposalSectionDraft['key']; targetId: string } }) {
  const query = validateTaskOpeningProposal<AiTaskOpeningProposalQueryDraft>('AiTaskOpeningProposalQueryDraft', input.query), api = input.api ?? aiTaskOpeningProposalsApi;
  let active = true, generation = 0, request: AbortController | null = null;
  const readLocator = () => {
    if (!input.store) return null;
    const raw = input.store.getItem(input.storageKey); if (raw === null) return null;
    if (!raw || raw.length > 1024) throw Error('AI_RESULT_UNKNOWN');
    const locator = validateTaskOpeningProposal<AiTaskOpeningProposalOperationReadDraft>('AiTaskOpeningProposalOperationReadDraft', JSON.parse(raw));
    if (locator.taskId !== query.taskId || query.runId !== undefined && locator.runId !== query.runId) throw Error('AI_RESULT_UNKNOWN');
    return locator;
  };
  let locked = true; try { locked = readLocator() !== null; } catch { /* A damaged/unavailable journal cannot authorize another prepare. */ }
  let view: View = { busy: false, list: input.initialList ? validateTaskOpeningProposal<AiTaskOpeningProposalListDraft>('AiTaskOpeningProposalListDraft', input.initialList) : null,
    preview: null, operation: null, pending: null, error: false, unknown: locked, locked };
  const current = () => active && input.current();
  const check = (serial = generation) => { if (!current() || serial !== generation || request?.signal.aborted) throw Error('AI_SCOPE_CHANGED'); };
  const publish = (patch: Partial<View>) => { if (current()) { view = { ...view, ...patch }; input.changed(); } };
  const source = (value: AiTaskOpeningProposalListDraft['source']) => {
    if (value.taskId !== query.taskId || query.runId !== undefined && value.runId !== query.runId
      || value.scope.tenantId !== input.tenantId || value.scope.workspaceId !== input.workspaceId) throw Error('AI_SCOPE_CHANGED');
  };
  const sameOriginal = (left: AiTaskOpeningProposalListDraft['source'], right: AiTaskOpeningProposalListDraft['source']) =>
    signature([left.taskId, left.runId, left.original, left.contentHash, left.receiptRevision, left.sceneVersion, left.scope])
      === signature([right.taskId, right.runId, right.original, right.contentHash, right.receiptRevision, right.sceneVersion, right.scope]);
  const run = async <T>(work: (signal: AbortSignal, serial: number) => Promise<T>) => {
    check(); if (request) throw Error('AI_OPERATION_BUSY'); const serial = ++generation, controller = new AbortController(); request = controller;
    publish({ busy: true, error: false });
    try { return await work(controller.signal, serial); }
    catch (cause) { if (current() && serial === generation) publish({ list: null, preview: null, operation: null, error: true }); throw cause; }
    finally { if (request === controller) { request = null; if (current()) publish({ busy: false }); } }
  };
  const acceptOperation = (response: AiTaskOpeningProposalOperationDraft, locator: AiTaskOpeningProposalOperationReadDraft, serial: number) => {
    check(serial);
    const value = validateTaskOpeningProposal<AiTaskOpeningProposalOperationDraft>('AiTaskOpeningProposalOperationDraft', response);
    if (value.diagnosisTaskId !== locator.taskId || locator.runId !== undefined && value.diagnosisRunId !== locator.runId
      || value.operationKey !== locator.operationKey || signature(readLocator()) !== signature(locator)) throw Error('AI_RESULT_UNKNOWN');
    if (value.receipt && (value.receipt.material.scope.tenantId !== input.tenantId || value.receipt.material.scope.workspaceId !== input.workspaceId)) throw Error('AI_SCOPE_CHANGED');
    if (value.receipt && input.target && (value.receipt.material.key !== input.target.key || value.receipt.material.targetId !== input.target.targetId)) throw Error('AI_SCOPE_CHANGED');
    publish({ pending: locator, operation: value, locked: true, unknown: value.state !== 'observed' }); return value;
  };
  const observe = async (locator: AiTaskOpeningProposalOperationReadDraft, signal: AbortSignal, serial: number) =>
    acceptOperation(await api.operation(locator, signal), locator, serial);
  return {
    get view() { return view; }, isCurrent: current,
    async read() { return run(async (signal, serial) => {
      const locator = readLocator(); if (locator) return observe(locator, signal, serial);
      if (view.locked) throw Error('AI_RESULT_UNKNOWN');
      const value = await api.list(query, signal); check(serial); source(value.source);
      if (readLocator() !== null) throw Error('AI_RESULT_UNKNOWN');
      publish({ list: value, preview: null, operation: null, unknown: false }); return value;
    }); },
    async preview(section: AiTaskOpeningProposalSectionDraft) { return run(async (signal, serial) => {
      if (view.locked || readLocator() !== null || !view.list) throw Error('AI_RESULT_UNKNOWN');
      source(view.list.source);
      if (input.target && (section.key !== input.target.key || section.key === 'item_groups' && section.targetId !== input.target.targetId)) throw Error('AI_SCOPE_CHANGED');
      const before = view.list.source, value = await api.preview({ ...query, section: structuredClone(section) }, signal); check(serial); source(value.source);
      if (!sameOriginal(before, value.source) || signature(value.section) !== signature(section) || readLocator() !== null) throw Error('AI_REVISION_CONFLICT');
      publish({ preview: value, operation: null }); return value;
    }); },
    async prepare() { return run(async (signal, serial) => {
      const reviewed = view.preview;
      if (!input.store) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      if (view.locked || readLocator() !== null || !reviewed || reviewed.material.status !== 'difference_ready') throw Error('AI_RESULT_UNKNOWN');
      const closing = await api.preview({ ...query, section: reviewed.section }, signal); check(serial); source(closing.source);
      if (!sameOriginal(closing.source, reviewed.source) || closing.material.materialHash !== reviewed.material.materialHash
        || closing.material.status !== 'difference_ready' || readLocator() !== null) { publish({ preview: closing }); throw Error('AI_RECONFIRM_OPENING'); }
      const locator = { taskId: query.taskId, runId: closing.source.runId, operationKey: input.newOperationKey?.() ?? crypto.randomUUID() };
      validateTaskOpeningProposal('AiTaskOpeningProposalOperationReadDraft', locator);
      const raw = signature(locator); if (raw.length > 1024 || !input.store || readLocator() !== null) throw Error('AI_RESULT_UNKNOWN');
      publish({ locked: true, unknown: true, pending: locator, list: null, preview: null });
      input.store.setItem(input.storageKey, raw);
      if (input.store.getItem(input.storageKey) !== raw) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      check(serial);
      try {
        const value = await api.prepare({ ...query, runId: closing.source.runId, section: closing.section,
          operationKey: locator.operationKey, reviewedMaterialHash: closing.material.materialHash }, signal);
        return acceptOperation(value, locator, serial);
      } catch (cause) { if (current() && serial === generation) publish({ unknown: true, operation: null }); throw cause; }
    }); },
    async operation() { return run((signal, serial) => { const locator = readLocator(); if (!locator) throw Error('AI_RESULT_UNKNOWN'); return observe(locator, signal, serial); }); },
    edit() { check(); if (request || view.locked) throw Error('AI_OPERATION_BUSY'); publish({ preview: null, operation: null, error: false }); },
    clear() { generation++; request?.abort(); request = null; publish({ list: null, preview: null, operation: null, busy: false }); },
    activate() { active = true; generation++; },
    dispose() { active = false; generation++; request?.abort(); request = null; view = { ...view, list: null, preview: null, operation: null, busy: false }; }
  };
}
