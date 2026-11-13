/** Human policy proposals retain only original operation locators in storage.
 * Reads never prepare/apply a change. Unknown delivery cannot unlock a new key,
 * and an acknowledged preparation still needs a separate current human save. */
import { z } from 'zod';
import type {
  AiAutomationPolicyChangeDraft, AiAutomationPolicySettingsDraft, AiAutomationSubjectSettingsDraft,
  AiAutomationPolicyDiscoveryDraft, AiAutomationPolicyPreviewDraft, AiAutomationPolicyReviewDraft,
  AiAutomationPolicyOperationDraft, AiAutomationPolicyPreparationDraft, AiAutomationPolicyPreparationReadDraft, AiAutomationPolicyCurrentDraft,
} from '@rental-os/shared';
import { validateAutomationPolicy, type AutomationPoliciesApi } from '@/api/aiAutomationPolicies';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const scopeSchema = z.object({ tenantId: id, workspaceId: id, actorId: id, audience: z.literal('operator') }).strict();
export type AutomationPolicyScope = z.infer<typeof scopeSchema>;
const locatorSchema = z.object({ version: z.literal('automation-policy-locator-1'), scope: scopeSchema,
  phase: z.enum(['prepare_sent', 'prepared', 'commit_sent']), operationKey: id.max(128), changeHash: hash,
  preparationId: z.string().uuid().optional() }).strict().refine(value => value.phase === 'prepare_sent' || !!value.preparationId);
export type AutomationPolicyLocator = z.infer<typeof locatorSchema>;
export type AutomationPolicyStore = { read(): AutomationPolicyLocator | null;
  write(value: AutomationPolicyLocator, expected: AutomationPolicyLocator | null): void; clear(expected: AutomationPolicyLocator): void;
  writesAvailable: boolean; exclusive<T>(work: () => T | Promise<T>): Promise<T> };
const same = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => same(value, right[index]));
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>, keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};
const unavailable = () => Error('AI_RESOURCE_UNAVAILABLE');
const unknown = () => Error('AI_RESULT_UNKNOWN');
export function automationPolicyStore(name: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  locks?: Pick<LockManager, 'request'>): AutomationPolicyStore {
  const encode = (value: AutomationPolicyLocator) => JSON.stringify(locatorSchema.parse(value));
  return {
    writesAvailable: !!storage && typeof locks?.request === 'function',
    async exclusive(work) {
      if (!storage || typeof locks?.request !== 'function') throw Error('AI_POLICY_WRITES_UNAVAILABLE');
      return await locks.request(name, { mode: 'exclusive' }, async () => work());
    },
    read() {
      if (!storage) throw Error('AI_POLICY_LOCATOR_UNAVAILABLE');
      const raw = storage.getItem(name);
      if (raw === null) return null;
      try { if (!raw || raw.length > 2048) throw Error(); return locatorSchema.parse(JSON.parse(raw)); }
      catch { throw Error('AI_POLICY_LOCATOR_DAMAGED'); }
    },
    write(value, expected) {
      if (!storage) throw Error('AI_POLICY_LOCATOR_UNAVAILABLE');
      if (!same(this.read(), expected)) throw Error('AI_POLICY_LOCATOR_CONFLICT');
      const raw = encode(value); storage.setItem(name, raw);
      if (storage.getItem(name) !== raw) throw Error('AI_POLICY_LOCATOR_UNCONFIRMED');
    },
    clear(expected) {
      if (!storage || !same(this.read(), expected)) throw Error('AI_POLICY_LOCATOR_CONFLICT');
      storage.removeItem(name);
      if (storage.getItem(name) !== null) throw Error('AI_POLICY_LOCATOR_UNCONFIRMED');
    },
  };
}

export type AutomationPolicyDraft = Omit<AiAutomationPolicyChangeDraft, 'operationKey'>;
type Selection = { subjectId: string | null; policyId: string | null };
type Busy = 'discover' | 'read' | 'preview' | 'prepare' | 'commit' | 'recover' | 'finish';
export type AutomationPolicyView = { discovery: AiAutomationPolicyDiscoveryDraft | null; selection: Selection | null;
  draft: AutomationPolicyDraft | null; preview: AiAutomationPolicyPreviewDraft | null;
  review: AiAutomationPolicyReviewDraft | null; operation: AiAutomationPolicyOperationDraft | null;
  locator: AutomationPolicyLocator | null; damaged: boolean; busy: Busy | null; error: string | null };

export function createAutomationPolicySession(input: { scope: AutomationPolicyScope; current(): boolean; changed(): void;
  api: AutomationPoliciesApi; store: AutomationPolicyStore; permissions: AiAutomationSubjectSettingsDraft['permissions'];
  locationScope: AiAutomationSubjectSettingsDraft['locationScope']; newKey?: () => string; clock?: () => number }) {
  const scope = scopeSchema.parse(structuredClone(input.scope)), clock = input.clock ?? Date.now;
  let active = true, generation = 0, request: AbortController | null = null, previewReceivedAt = 0;
  let attemptedCommand: AiAutomationPolicyChangeDraft | null = null;
  let view: AutomationPolicyView = { discovery: null, selection: null, draft: null, preview: null, review: null,
    operation: null, locator: null, damaged: false, busy: null, error: null };
  const scrub = () => { attemptedCommand = null; view = { ...view, discovery: null, selection: null, draft: null, preview: null, review: null, operation: null }; };
  const assert = (owner = generation) => {
    if (!active || !input.current() || owner !== generation || request?.signal.aborted) { scrub(); throw Error('AI_SCOPE_CHANGED'); }
  };
  const publish = (next: Partial<AutomationPolicyView>) => { assert(); view = { ...view, ...next }; input.changed(); };
  const restore = () => {
    try {
      const stored = input.store.read();
      if (stored && !same(stored.scope, scope) || view.locator && !same(stored, view.locator)) throw Error('AI_POLICY_LOCATOR_CONFLICT');
      view = { ...view, locator: stored, damaged: false };
    } catch { view = { ...view, damaged: true, preview: null }; }
  };
  restore();
  const idle = () => { assert(); if (view.busy) throw Error('AI_OPERATION_BUSY'); restore(); if (view.damaged) throw Error('AI_POLICY_LOCATOR_DAMAGED'); };
  const editable = () => { idle(); if (view.locator) throw unknown(); };
  const remember = async (value: AutomationPolicyLocator) => {
    const expected = view.locator, next = locatorSchema.parse(structuredClone(value));
    // Retain the attempted locator even when the storage acknowledgement fails.
    // Only verified storage may permit the first server write; recovery uses it.
    const owner = generation;
    await input.store.exclusive(() => {
      assert(owner); view = { ...view, locator: next, preview: null };
      try { input.store.write(next, expected); if (!same(input.store.read(), next)) throw unknown(); }
      catch (error) { view = { ...view, damaged: true }; throw error; }
    });
  };
  const complete = async (result: Extract<AiAutomationPolicyOperationDraft, { state: 'observed' }>, locator: AutomationPolicyLocator,
    command = attemptedCommand ?? (view.review && view.review.state !== 'observed' ? view.review.proposal : null)) => {
    if (result.operationKey !== locator.operationKey || result.changeHash !== locator.changeHash
      || locator.preparationId && result.preparationId !== locator.preparationId) throw unknown();
    if (command) {
      const { id: subjectId, authorizationRevision: _subjectRevision, enabledBy: _subjectActor,
        enabledAt: _subjectTime, enabledAudience: _subjectAudience, ...subject } = result.result.subject;
      const { id: policyId, subjectId: policySubjectId, revision: _policyRevision, enabledBy: _policyActor,
        enabledAt: _policyTime, enabledAudience: _policyAudience, counterDay: _day, preparedCount: _count,
        lastPreparedAt: _last, ...policy } = result.result.policy;
      if (policySubjectId !== subjectId || command.subjectId && command.subjectId !== subjectId
        || command.policyId && command.policyId !== policyId || !same(subject, command.subject) || !same(policy, command.policy)) throw unknown();
    }
    const owner = generation;
    assert(owner); view = { ...view, operation: result, review: result, draft: null, preview: null };
    if (!input.store.writesAvailable) return;
    await input.store.exclusive(() => {
      assert(owner);
      try { input.store.clear(locator); view = { ...view, locator: null, damaged: false }; }
      catch { view = { ...view, locator, damaged: true }; }
    });
  };
  const acceptPreparation = async (value: AiAutomationPolicyPreparationDraft, locator: AutomationPolicyLocator) => {
    const result = validateAutomationPolicy<AiAutomationPolicyPreparationDraft>('AiAutomationPolicyPreparationDraft', value);
    if (result.operationKey !== locator.operationKey) throw unknown();
    if (result.state === 'unknown') {
      if (locator.preparationId && result.preparationId && locator.preparationId !== result.preparationId) throw unknown();
      if (result.preparationId && !locator.preparationId) await remember({ ...locator, preparationId: result.preparationId });
      throw unknown();
    }
    if (result.changeHash !== locator.changeHash || locator.preparationId && result.preparationId !== locator.preparationId) throw unknown();
    if (result.state === 'observed') { await complete(result, locator); return result; }
    if (result.proposal.operationKey !== locator.operationKey
      || result.proposal.subjectId && result.proposal.subjectId !== result.subjectId
      || result.proposal.policyId && result.proposal.policyId !== result.policyId
      || attemptedCommand && !same(result.proposal, attemptedCommand)) throw unknown();
    const next = { ...locator, phase: 'prepared' as const, preparationId: result.preparationId };
    if (!same(next, locator) && input.store.writesAvailable) await remember(next);
    view = { ...view, review: result, draft: null, preview: null };
    return result;
  };
  const run = async <T>(kind: Busy, work: (signal: AbortSignal, owner: number) => Promise<T>): Promise<T> => {
    assert(); if (view.busy) throw Error('AI_OPERATION_BUSY');
    const owner = ++generation, controller = new AbortController(); request = controller; publish({ busy: kind, error: null });
    try { const result = await work(controller.signal, owner); assert(owner); return result; }
    catch (error) {
      if (active && input.current() && owner === generation) {
        const code = (error as { response?: { data?: { code?: unknown } }; code?: unknown })?.response?.data?.code
          ?? (error as { code?: unknown })?.code ?? (error instanceof Error ? error.message : '');
        view = { ...view, preview: null, error: typeof code === 'string' && /^AI_[A-Z_]+$/u.test(code) ? code
          : view.locator ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE' }; input.changed();
      }
      throw error;
    } finally { if (request === controller) { request = null; if (active && input.current()) { view = { ...view, busy: null }; input.changed(); } } }
  };
  const draftValid = (draft: AutomationPolicyDraft) => {
    let command: AiAutomationPolicyChangeDraft;
    try { command = validateAutomationPolicy<AiAutomationPolicyChangeDraft>('AiAutomationPolicyChangeDraft', { ...draft, operationKey: 'validation' }); }
    catch { throw Error('AI_POLICY_DRAFT_INVALID'); }
    command.subject.permissions.sort();
    command.subject.locationScope.locationIds.sort();
    command.policy.allowedEventTypes.sort();
    const { subject, policy } = command, constraints = policy.constraints;
    const permissions = new Set<string>(input.permissions), locations = new Set<string>(input.locationScope.locationIds);
    if (subject.permissions.some(code => !permissions.has(code))
      || input.locationScope.mode === 'selected' && (subject.locationScope.mode !== 'selected'
        || subject.locationScope.locationIds.some(location => !locations.has(location)))
      || !command.subjectId && (subject.enabled || subject.revoked) || !command.policyId && (policy.mode !== 'disabled' || policy.revoked)
      || subject.revoked && subject.enabled || policy.revoked && policy.mode !== 'disabled'
      || policy.mode !== 'disabled' && (!subject.enabled || subject.revoked || policy.maxTasksPerDay < 1)
      || !constraints || constraints.allowedTools.length || constraints.allowedRecipientIds.length || policy.maxTasksPerDay < 1 || policy.maxTasksPerDay > 1000
      || Date.parse(policy.validFrom) >= Date.parse(policy.expiresAt) || Date.parse(policy.expiresAt) > Date.parse(subject.expiresAt)
      || (!command.subjectId || subject.enabled) && (Date.parse(subject.expiresAt) <= clock() || Date.parse(subject.expiresAt) > clock() + 366 * 86400000)
      || (!command.policyId || policy.mode !== 'disabled') && Date.parse(policy.expiresAt) <= clock()) throw Error('AI_POLICY_DRAFT_INVALID');
    return command;
  };
  const setSelection = (selection: Selection, discovery: AiAutomationPolicyDiscoveryDraft, current?: AiAutomationPolicyCurrentDraft) => {
    const subject = current?.subject ?? discovery.subjects.find(row => row.id === selection.subjectId);
    const policy = current?.policy ?? discovery.policies.find(row => row.id === selection.policyId);
    if (selection.subjectId && !subject || selection.policyId && (!policy || !subject || policy.subjectId !== subject.id)) throw unavailable();
    const scene = policy ? discovery.scenes.find(row => row.sceneCode === policy.sceneCode && row.sceneVersion === policy.sceneVersion)
      : discovery.scenes.find(row => Date.parse(row.expiresAt) > clock() && row.tools.some(tool => tool.code === 'ai.model.text'))
        ?? discovery.scenes.find(row => Date.parse(row.expiresAt) > clock());
    if (!scene) throw Error('AI_POLICY_SCENE_UNAVAILABLE');
    const expiresAt = new Date(Math.min(clock() + 86400000, Date.parse(scene.expiresAt))).toISOString();
    const subjectSettings: AiAutomationSubjectSettingsDraft = subject ? { enabled: subject.enabled, revoked: subject.revoked,
      permissions: [...subject.permissions], locationScope: structuredClone(subject.locationScope), expiresAt: subject.expiresAt }
      : { enabled: false, revoked: false, permissions: [...input.permissions], locationScope: structuredClone(input.locationScope), expiresAt };
    const policySettings: AiAutomationPolicySettingsDraft = policy ? { mode: policy.mode, revoked: policy.revoked, sceneCode: policy.sceneCode,
      sceneVersion: policy.sceneVersion, allowedEventTypes: [...policy.allowedEventTypes], maxTasksPerDay: policy.maxTasksPerDay,
      cooldownSeconds: policy.cooldownSeconds, validFrom: policy.validFrom, expiresAt: policy.expiresAt,
      constraints: { allowedTools: [], allowedRecipientIds: [], limits: policy.constraints ? structuredClone(policy.constraints.limits)
        : { maxActionsPerRun: 1, maxQuantity: 1, maxCausalDepth: 1 } } }
      : { mode: 'disabled', revoked: false, sceneCode: scene.sceneCode, sceneVersion: scene.sceneVersion,
        allowedEventTypes: [], maxTasksPerDay: 1, cooldownSeconds: 60, validFrom: new Date(clock()).toISOString(), expiresAt,
        constraints: { allowedTools: [], allowedRecipientIds: [], limits: { maxActionsPerRun: 1, maxQuantity: 1, maxCausalDepth: 1 } } };
    const draft: AutomationPolicyDraft = { subjectId: selection.subjectId, policyId: selection.policyId,
      expectedSubjectRevision: subject?.authorizationRevision ?? null, expectedPolicyRevision: policy?.revision ?? null,
      subject: subjectSettings, policy: policySettings };
    publish({ selection, draft, preview: null, review: null, operation: null });
  };
  return Object.freeze({
    get view() { if (!active || !input.current()) scrub(); return structuredClone(view); },
    isCurrent: () => active && input.current(),
    writesAvailable: () => input.store.writesAvailable,
    canEdit: () => active && input.current() && !view.busy && !view.locator && !view.damaged && input.store.writesAvailable,
    async discover() {
      assert(); if (view.busy) throw Error('AI_OPERATION_BUSY'); restore();
      return run('discover', async (signal, owner) => {
        const discovery = validateAutomationPolicy<AiAutomationPolicyDiscoveryDraft>('AiAutomationPolicyDiscoveryDraft', await input.api.discover(signal));
        assert(owner); restore();
        if (new Set(discovery.subjects.map(row => row.id)).size !== discovery.subjects.length
          || new Set(discovery.policies.map(row => row.id)).size !== discovery.policies.length
          || new Set(discovery.scenes.map(row => JSON.stringify([row.sceneCode, row.sceneVersion]))).size !== discovery.scenes.length
          || discovery.policies.some(row => !discovery.subjects.some(subject => subject.id === row.subjectId))) throw unavailable();
        publish({ discovery, preview: null }); return discovery;
      });
    },
    async select(selection: Selection) {
      editable(); const discovery = view.discovery;
      if (!discovery) throw unavailable();
      if (selection.subjectId && !discovery.subjects.some(row => row.id === selection.subjectId)
        || selection.policyId && !discovery.policies.some(row => row.id === selection.policyId && row.subjectId === selection.subjectId)) throw unavailable();
      return run('read', async (signal, owner) => {
        const current = selection.policyId && selection.subjectId
          ? validateAutomationPolicy<AiAutomationPolicyCurrentDraft>('AiAutomationPolicyCurrentDraft',
            await input.api.read({ subjectId: selection.subjectId, policyId: selection.policyId }, signal)) : undefined;
        assert(owner); restore(); if (view.locator || view.damaged) throw unknown();
        if (current && (current.subject.id !== selection.subjectId || current.policy.id !== selection.policyId
          || current.policy.subjectId !== current.subject.id)) throw unavailable();
        setSelection(selection, discovery, current);
      });
    },
    edit(draft: AutomationPolicyDraft) { editable(); if (!view.selection || !view.draft) throw unavailable();
      const next = structuredClone(draft);
      if (next.subjectId !== view.draft.subjectId || next.policyId !== view.draft.policyId
        || next.expectedSubjectRevision !== view.draft.expectedSubjectRevision || next.expectedPolicyRevision !== view.draft.expectedPolicyRevision) throw unavailable();
      publish({ draft: next, preview: null, review: null, error: null });
    },
    async preview() {
      editable(); if (!view.draft || !view.discovery) throw unavailable();
      const draft = structuredClone(view.draft), discovery = structuredClone(view.discovery);
      return run('preview', async (signal, owner) => {
        publish({ preview: null });
        const validated = draftValid(draft), scene = discovery.scenes.find(row => row.sceneCode === validated.policy.sceneCode
          && row.sceneVersion === validated.policy.sceneVersion);
        if (!scene || (!validated.policyId || validated.policy.mode !== 'disabled') && Date.parse(scene.expiresAt) <= clock()) throw Error('AI_POLICY_SCENE_UNAVAILABLE');
        const command = { ...validated, operationKey: (input.newKey ?? (() => crypto.randomUUID()))() };
        const result = validateAutomationPolicy<AiAutomationPolicyPreviewDraft>('AiAutomationPolicyPreviewDraft', await input.api.preview(command, signal));
        assert(owner); restore(); if (view.locator || view.damaged || !same(result.command, command)) throw unknown();
        if ((result.before.subject?.id ?? null) !== command.subjectId || (result.before.policy?.id ?? null) !== command.policyId
          || (result.before.subject?.revision ?? null) !== command.expectedSubjectRevision
          || (result.before.policy?.revision ?? null) !== command.expectedPolicyRevision
          || result.before.scene.sceneCode !== command.policy.sceneCode || result.before.scene.sceneVersion !== command.policy.sceneVersion) throw unavailable();
        previewReceivedAt = clock(); publish({ preview: result }); return result;
      });
    },
    async prepare() {
      editable(); const preview = view.preview; if (!preview || !view.draft) throw unavailable();
      const draft = structuredClone(view.draft);
      return run('prepare', async (signal, owner) => {
        const elapsed = clock() - previewReceivedAt;
        if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 600000) throw Error('AI_REVISION_CONFLICT');
        draftValid(draft);
        const current = validateAutomationPolicy<AiAutomationPolicyPreviewDraft>('AiAutomationPolicyPreviewDraft', await input.api.preview(preview.command, signal));
        assert(owner); restore(); if (view.locator || view.damaged || !same(current, preview)) throw Error('AI_REVISION_CONFLICT');
        const locator: AutomationPolicyLocator = { version: 'automation-policy-locator-1', scope, phase: 'prepare_sent',
          operationKey: preview.command.operationKey, changeHash: preview.changeHash };
        attemptedCommand = structuredClone(preview.command);
        await remember(locator); assert(owner);
        const result = await input.api.prepareConfirmed({ decision: 'prepare_original_automation_policy', command: preview.command,
          changeHash: preview.changeHash, sourceHash: preview.sourceHash }, signal);
        assert(owner); return acceptPreparation(result, locator);
      });
    },
    async commit() {
      idle(); const locator = view.locator, review = view.review;
      if (!locator || locator.phase !== 'prepared' || !locator.preparationId || !review || review.state !== 'prepared') throw unavailable();
      return run('commit', async (signal, owner) => {
        const fresh = validateAutomationPolicy<AiAutomationPolicyReviewDraft>('AiAutomationPolicyReviewDraft', await input.api.review(locator.preparationId!, signal));
        assert(owner); restore(); if (view.damaged || !same(view.locator, locator)) throw unknown();
        if (fresh.preparationId !== locator.preparationId || fresh.operationKey !== locator.operationKey || fresh.changeHash !== locator.changeHash) throw unknown();
        if (fresh.state === 'observed') { await complete(fresh, locator); return fresh; }
        if (fresh.state !== 'prepared' || !same(fresh, review) || Date.parse(fresh.expiresAt) <= clock()) {
          publish({ review: fresh }); throw Error('AI_REVISION_CONFLICT');
        }
        const next = { ...locator, phase: 'commit_sent' as const }; await remember(next); assert(owner);
        const result = validateAutomationPolicy<AiAutomationPolicyOperationDraft>('AiAutomationPolicyCommitResultDraft',
          await input.api.commitConfirmed({ decision: 'apply_original_automation_policy', preparationId: fresh.preparationId, changeHash: fresh.changeHash }, signal));
        assert(owner); if (result.state !== 'observed') { publish({ operation: result }); throw unknown(); }
        await complete(result, next, fresh.proposal); return result;
      });
    },
    async recover() {
      assert(); if (view.busy) throw Error('AI_OPERATION_BUSY'); restore(); const locator = view.locator;
      if (!locator || !same(locator.scope, scope)) throw Error('AI_POLICY_LOCATOR_UNAVAILABLE');
      return run('recover', async (signal, owner) => {
        if (locator.phase === 'commit_sent') {
          const result = validateAutomationPolicy<AiAutomationPolicyOperationDraft>('AiAutomationPolicyOperationDraft', await input.api.operation(locator.operationKey, signal));
          assert(owner); if (result.operationKey !== locator.operationKey) throw unknown();
          if (result.state === 'observed') await complete(result, locator); else publish({ operation: result, review: null });
          return result;
        }
        const result = validateAutomationPolicy<AiAutomationPolicyPreparationReadDraft>(
          'AiAutomationPolicyPreparationReadDraft', await input.api.preparation(locator.operationKey, signal));
        assert(owner); if (result.operationKey !== locator.operationKey) throw unknown();
        if (result.state === 'not_observed') { publish({ review: null }); return result; }
        return acceptPreparation(result, locator);
      });
    },
    async finishPreparation() {
      idle(); const locator = view.locator, review = view.review;
      if (!locator || locator.phase !== 'prepared' || !locator.preparationId || !review
        || review.state !== 'expired' && review.state !== 'stale') throw unavailable();
      return run('finish', async (signal, owner) => {
        const operation = validateAutomationPolicy<AiAutomationPolicyOperationDraft>('AiAutomationPolicyOperationDraft',
          await input.api.operation(locator.operationKey, signal));
        assert(owner); restore(); if (view.damaged || !same(view.locator, locator) || operation.operationKey !== locator.operationKey) throw unknown();
        if (operation.state === 'observed') { await complete(operation, locator, review.proposal); return operation; }
        if (operation.state !== 'not_observed') throw unknown();
        const fresh = validateAutomationPolicy<AiAutomationPolicyReviewDraft>('AiAutomationPolicyReviewDraft',
          await input.api.review(locator.preparationId!, signal));
        assert(owner); restore();
        if (view.damaged || !same(view.locator, locator) || fresh.operationKey !== locator.operationKey
          || fresh.preparationId !== locator.preparationId || fresh.changeHash !== locator.changeHash) throw unknown();
        if (fresh.state === 'observed') { await complete(fresh, locator, review.proposal); return fresh; }
        if (fresh.state !== 'expired' && fresh.state !== 'stale') throw Error('AI_REVISION_CONFLICT');
        // A never-dispatched save and a currently unusable preparation can leave
        // this editor. A commit_sent locator never takes this path. This neither
        // proves rollback nor changes the server's original preparation/receipt.
        await input.store.exclusive(() => { assert(owner); input.store.clear(locator); }); attemptedCommand = null;
        publish({ locator: null, damaged: false, selection: null, draft: null, preview: null, review: null,
          operation: null, error: null });
        return fresh;
      });
    },
    activate() { active = true; restore(); },
    invalidate() { generation++; request?.abort(); request = null; attemptedCommand = null; scrub(); view = { ...view, busy: null }; restore(); if (active && input.current()) input.changed(); },
    dispose() { active = false; generation++; request?.abort(); request = null; attemptedCommand = null; scrub(); view = { ...view, busy: null }; },
  });
}
export type AutomationPolicySession = ReturnType<typeof createAutomationPolicySession>;
