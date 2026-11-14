/** One current human category interaction. Only original IDs, revisions and
 * input fingerprints persist before writes. Lost replies are reconciled by
 * original receipts/audits; absence, expiry and current state never allow retry.
 * Platform governance and tenant-space adoption remain separate identities. */
import { CATEGORY_GOVERNANCE_PERMISSIONS as P, isRentalCategoryCode,
  type CategoryDraftSection, type CategoryVersionView, type RentalCategoryDefinition,
  type PreviewRentalCategoryCreationRequest, type CreateRentalCategoryRequest,
  type SaveCategoryOpeningRequest, type SaveCategoryVersionPolicyRequest,
  type CategoryPreparationOperation, type SaveCategoryPreparationBatchRequest,
  type AdoptRentalCategoryRequest, type CategoryAdoptionResult, type CategoryPreparationSaveResult } from '@rental-os/shared';
import type { AiCategoryProposalSource, AiCategoryProposalReference, AiCategoryProposalRead } from '@rental-os/shared';
import { aiCategoryDraftApi, readCategoryProposalReference, readCategoryProposalSource,
  type CategoryProposalPolicy, type CategoryVersionEvidence, type CategoryDraftReview } from '@/api/aiCategoryDraft';
import type { CategoryGovernanceAudit } from '@/api/categoryGovernance';

type Api = typeof aiCategoryDraftApi;
type Kind = 'create' | 'copy' | 'patch' | 'publish' | 'policy' | 'opening' | 'preparation' | 'adopt';
export interface CategoryAssistOwner { tenantId: string; actorId: string; workspaceId: string | null; mode: 'platform' | 'workspace' }
interface Pending {
  kind: Kind; key: string; code: string; intentHash: string;
  versionId?: string; sourceVersionId?: string; versionLabel?: string; expectedRevision?: number;
  definitionHash?: string; section?: CategoryDraftSection; fields?: string[]; explicitRecommendation?: boolean;
  operation?: CategoryPreparationOperation; sourceRevision?: number; preparationRevision?: number; targetPolicyRevision?: number;
}
type Receipt = { kind: Kind; version?: CategoryVersionView; audit?: CategoryGovernanceAudit;
  preparation?: CategoryPreparationSaveResult; adoption?: CategoryAdoptionResult; opening?: Record<string, unknown> };
type ProposalJournal = { phase: 'preparing' | 'prepared' | 'generating' | 'read_only' | 'observed';
  operationKey: string; source: AiCategoryProposalSource; reference?: AiCategoryProposalReference };
type PolicyJournal = { expectedRevision: number | null; inputHash: string };
type View = {
  categories: Awaited<ReturnType<Api['list']>> | null;
  tenants: Awaited<ReturnType<Api['tenants']>> | null;
  catalog: Awaited<ReturnType<Api['catalog']>> | null;
  detail: Awaited<ReturnType<Api['detail']>> | null; selectedVersionId: string | null;
  review: CategoryDraftReview | null;
  creation: { input: PreviewRentalCategoryCreationRequest; result: Awaited<ReturnType<Api['previewCreation']>> } | null;
  candidates: Awaited<ReturnType<Api['candidates']>> | null;
  preparation: Awaited<ReturnType<Api['preparation']>> | null; operation: CategoryPreparationOperation;
  entities: Awaited<ReturnType<Api['entities']>> | null;
  pending: Pending | null; receipt: Receipt | null; damaged: boolean; busy: string | null; error: unknown;
  proposal: ProposalJournal | null; proposalMaterial: Record<string, unknown> | null; proposalResult: AiCategoryProposalRead | null;
  proposalPolicy: CategoryProposalPolicy | null; proposalDamaged: boolean; policyPending: PolicyJournal | null;
  proposalPolicyReceipt: Extract<CategoryProposalPolicy, { state: 'configured' }> | null;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function normalized(value: unknown, depth = 0): unknown {
  if (depth > 32) throw Error('AI_INVALID_INPUT');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(child => normalized(child, depth + 1));
  if (record(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('AI_INVALID_INPUT');
      return [key, normalized(value[key], depth + 1)];
    }));
  }
  throw Error('AI_INVALID_INPUT');
}
async function digest(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
    .map(value => value.toString(16).padStart(2, '0')).join('');
}
export const categoryAssistFingerprint = (value: unknown) => digest(JSON.stringify(normalized(value)));
const definitionDigest = (value: unknown) => digest(JSON.stringify(value));
const reason = (value: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw Error('AI_CATEGORY_REASON_REQUIRED');
  return value.trim();
};
const pendingKeys = ['kind', 'key', 'code', 'intentHash', 'versionId', 'sourceVersionId', 'versionLabel', 'expectedRevision',
  'definitionHash', 'section', 'fields', 'explicitRecommendation', 'operation', 'sourceRevision', 'preparationRevision', 'targetPolicyRevision'];
function readPending(value: unknown): Pending {
  if (!record(value) || Object.keys(value).some(key => !pendingKeys.includes(key)) || !id(value.key) || !isRentalCategoryCode(value.code)
    || !hash(value.intentHash) || !['create', 'copy', 'patch', 'publish', 'policy', 'opening', 'preparation', 'adopt'].includes(String(value.kind))) throw Error('AI_RESULT_UNKNOWN');
  for (const field of ['versionId', 'sourceVersionId']) if (value[field] !== undefined && !id(value[field])) throw Error('AI_RESULT_UNKNOWN');
  for (const field of ['expectedRevision', 'sourceRevision', 'preparationRevision', 'targetPolicyRevision']) if (value[field] !== undefined && !revision(value[field])) throw Error('AI_RESULT_UNKNOWN');
  if (value.definitionHash !== undefined && !hash(value.definitionHash) || value.versionLabel !== undefined && (typeof value.versionLabel !== 'string' || !value.versionLabel || value.versionLabel.length > 64)
    || value.fields !== undefined && (!Array.isArray(value.fields) || !value.fields.length || value.fields.length > 32 || value.fields.some(field => typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/u.test(field)))
    || value.explicitRecommendation !== undefined && typeof value.explicitRecommendation !== 'boolean') throw Error('AI_RESULT_UNKNOWN');
  if (['copy', 'create'].includes(String(value.kind)) && (!value.versionLabel || value.kind === 'copy' && !value.sourceVersionId || value.kind === 'create' && !hash(value.definitionHash))) throw Error('AI_RESULT_UNKNOWN');
  if (['patch', 'publish', 'policy'].includes(String(value.kind)) && (!value.versionId || !revision(value.expectedRevision))) throw Error('AI_RESULT_UNKNOWN');
  if (value.kind === 'patch' && (!['basic', 'attributes', 'inventory', 'pricing', 'inspection', 'capabilities'].includes(String(value.section)) || !value.fields)) throw Error('AI_RESULT_UNKNOWN');
  if (value.kind === 'publish' && !hash(value.definitionHash) || value.kind === 'opening' && !revision(value.expectedRevision)) throw Error('AI_RESULT_UNKNOWN');
  if (['adopt', 'preparation'].includes(String(value.kind)) && (!value.versionId || !value.sourceVersionId || !revision(value.sourceRevision)
    || !revision(value.preparationRevision) || !['upgrade', 'restore'].includes(String(value.operation)))) throw Error('AI_RESULT_UNKNOWN');
  if (value.kind === 'adopt' && !revision(value.targetPolicyRevision)) throw Error('AI_RESULT_UNKNOWN');
  return structuredClone(value) as unknown as Pending;
}
export function categoryAssistStore(owner: CategoryAssistOwner, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  // Object construction order must not create another journal for the same
  // actor/space after remount, including original-result recovery consumers.
  const binding = JSON.stringify([owner.tenantId, owner.actorId, owner.workspaceId, owner.mode]);
  const key = `rental-os-category-assist:${binding}`;
  const encode = (pending: Pending) => JSON.stringify({ version: 1, owner: binding, operation: readPending(pending) });
  const proposalKey = `${key}:proposal`, policyKey = `${key}:proposal-policy`;
  const readProposal = (value: unknown): ProposalJournal => {
    if (!record(value) || Object.keys(value).some(field => !['phase', 'operationKey', 'source', 'reference'].includes(field))
      || !['preparing', 'prepared', 'generating', 'read_only', 'observed'].includes(String(value.phase))
      || !id(value.operationKey) || value.operationKey.length > 128) throw Error('AI_RESULT_UNKNOWN');
    const source = readCategoryProposalSource(value.source), reference = value.reference === undefined ? undefined : readCategoryProposalReference(value.reference);
    if (reference && reference.operationKey !== value.operationKey || value.phase !== 'preparing' && !reference) throw Error('AI_RESULT_UNKNOWN');
    return { phase: value.phase as ProposalJournal['phase'], operationKey: value.operationKey, source, ...(reference ? { reference } : {}) };
  };
  const proposalEncode = (value: ProposalJournal) => JSON.stringify({ version: 1, owner: binding, operation: readProposal(value) });
  const policyEncode = (value: PolicyJournal) => {
    if (value.expectedRevision !== null && !revision(value.expectedRevision) || !hash(value.inputHash)) throw Error('AI_RESULT_UNKNOWN');
    return JSON.stringify({ version: 1, owner: binding, operation: value });
  };
  const readJournal = (journalKey: string) => {
    if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    const raw = storage.getItem(journalKey); if (raw === null) return null;
    if (!raw || raw.length > 4096) throw Error('AI_RESULT_UNKNOWN');
    const value = JSON.parse(raw) as unknown;
    if (!record(value) || Object.keys(value).length !== 3 || value.version !== 1 || value.owner !== binding) throw Error('AI_RESULT_UNKNOWN');
    return value.operation;
  };
  return {
    key,
    read(): Pending | null {
      if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      const raw = storage.getItem(key); if (raw === null) return null;
      if (!raw || raw.length > 4096) throw Error('AI_RESULT_UNKNOWN');
      let value: unknown; try { value = JSON.parse(raw); } catch { throw Error('AI_RESULT_UNKNOWN'); }
      if (!record(value) || Object.keys(value).length !== 3 || value.version !== 1 || value.owner !== binding) throw Error('AI_RESULT_UNKNOWN');
      return readPending(value.operation);
    },
    reserve(pending: Pending) {
      if (!storage || storage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN');
      const raw = encode(pending); storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    },
    matches(pending: Pending) { return !!storage && storage.getItem(key) === encode(pending); },
    settle(pending: Pending) {
      if (!storage || storage.getItem(key) !== encode(pending)) throw Error('AI_RESULT_UNKNOWN');
      storage.removeItem(key); if (storage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN');
    },
    readProposal(): ProposalJournal | null { const value = readJournal(proposalKey); return value === null ? null : readProposal(value); },
    writeProposal(value: ProposalJournal, expected: ProposalJournal | null) {
      if (!storage || storage.getItem(proposalKey) !== (expected ? proposalEncode(expected) : null)) throw Error('AI_RESULT_UNKNOWN');
      const raw = proposalEncode(value); storage.setItem(proposalKey, raw);
      if (storage.getItem(proposalKey) !== raw) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    },
    readPolicy(): PolicyJournal | null {
      const value = readJournal(policyKey); if (value === null) return null;
      if (!record(value) || Object.keys(value).length !== 2 || value.expectedRevision !== null && !revision(value.expectedRevision)
        || !hash(value.inputHash)) throw Error('AI_RESULT_UNKNOWN');
      return value as unknown as PolicyJournal;
    },
    reservePolicy(value: PolicyJournal) {
      if (!storage || storage.getItem(policyKey) !== null) throw Error('AI_RESULT_UNKNOWN');
      const raw = policyEncode(value); storage.setItem(policyKey, raw);
      if (storage.getItem(policyKey) !== raw) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    },
    settlePolicy(value: PolicyJournal) {
      if (!storage || storage.getItem(policyKey) !== policyEncode(value)) throw Error('AI_RESULT_UNKNOWN');
      storage.removeItem(policyKey); if (storage.getItem(policyKey) !== null) throw Error('AI_RESULT_UNKNOWN');
    }
  };
}
const policyFields = ['createScope', 'createTenantIds', 'upgradeScope', 'upgradeTenantIds', 'restoreScope', 'restoreTenantIds'] as const;
const sectionRoots = new Set(['name', 'description', 'terminology', 'display', 'attributeSchema', 'supportedInventoryModes', 'defaultCapabilities', 'requiredCapabilities', 'conditionalCapabilities']);
const defaultFields = new Set(['payment', 'overdue', 'fulfillment', 'rules', 'inspectionFields']);
function projection(definition: RentalCategoryDefinition, fields: string[]) {
  const root = definition as unknown as Record<string, unknown>, business = root.businessModel as Record<string, unknown>, defaults = business.defaults as Record<string, unknown>;
  return Object.fromEntries(fields.map(field => [field, structuredClone((sectionRoots.has(field) ? root : defaultFields.has(field) ? defaults : business)[field])]));
}

export function createCategoryAssistSession(input: { owner: CategoryAssistOwner; api?: Api;
  store: ReturnType<typeof categoryAssistStore>; current(): boolean; permission(permission: string): boolean; changed(): void }) {
  const api = input.api ?? aiCategoryDraftApi, owner = structuredClone(input.owner);
  let active = true, request: AbortController | null = null;
  let view: View = { categories: null, tenants: null, catalog: null, detail: null, selectedVersionId: null, review: null, creation: null, candidates: null,
    preparation: null, entities: null, operation: 'upgrade', pending: null, receipt: null, damaged: false, busy: null, error: null,
    proposal: null, proposalMaterial: null, proposalResult: null, proposalPolicy: null, proposalDamaged: false, policyPending: null,
    proposalPolicyReceipt: null };
  function restore() { try { view.pending = input.store.read(); view.damaged = false; } catch (error) { view.damaged = true; view.error = error; } }
  restore();
  function restoreProposal() {
    try { view.proposal = input.store.readProposal(); view.policyPending = input.store.readPolicy(); view.proposalDamaged = false; }
    catch (error) { view.proposalDamaged = true; view.error = error; }
  }
  restoreProposal();
  const check = (signal?: AbortSignal) => {
    if (!active || !input.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED');
  };
  const allowed = (permission: string, mode: CategoryAssistOwner['mode']) => {
    check(); if (owner.mode !== mode || !input.permission(permission)) throw Error('AI_ACCESS_DENIED');
  };
  const notify = () => { if (active && input.current()) input.changed(); };
  const selected = (): CategoryVersionEvidence => {
    const version = view.detail?.versions.find(row => row.id === view.selectedVersionId);
    if (!version) throw Error('AI_CATEGORY_SOURCE_UNAVAILABLE');
    return version;
  };
  async function run<T>(label: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    check(); if (request) throw Error('AI_OPERATION_PENDING');
    const controller = new AbortController(); request = controller; view.busy = label; view.error = null; notify();
    try { const result = await work(controller.signal); check(controller.signal); return result; }
    catch (error) { if (request === controller && active && input.current()) view.error = error; throw error; }
    finally { if (request === controller) { request = null; view.busy = null; notify(); } }
  }
  async function reserve(pending: Pending, signal: AbortSignal) {
    check(signal); restoreProposal();
    if (view.damaged || view.proposalDamaged || view.pending || view.policyPending || input.store.read()
      || view.proposal && ['preparing', 'generating', 'read_only'].includes(view.proposal.phase)) throw Error('AI_RESULT_UNKNOWN');
    // The native lock coordinates participating tabs. Storage readback still
    // checks ownership when Web Locks is unavailable; it is not an atomic DB CAS.
    const save = () => { check(signal); restoreProposal();
      if (view.proposalDamaged || view.policyPending || view.proposal && ['preparing', 'generating', 'read_only'].includes(view.proposal.phase)) throw Error('AI_RESULT_UNKNOWN');
      input.store.reserve(pending); view.pending = pending; check(signal); };
    if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(input.store.key, { signal }, save);
    else save();
    if (!input.store.matches(pending)) throw Error('AI_RESULT_UNKNOWN');
    notify();
  }
  async function write<T>(kind: Kind, command: unknown, metadata: Omit<Pending, 'kind' | 'key' | 'intentHash'> & { key?: string },
    signal: AbortSignal, dispatch: (key: string) => Promise<T>, accept: (result: T, pending: Pending) => Promise<Receipt> | Receipt) {
    const pending = readPending({ ...metadata, kind, key: metadata.key ?? crypto.randomUUID(), intentHash: await categoryAssistFingerprint(command) });
    const permission = kind === 'adopt' || kind === 'preparation' ? 'rental-os:category:adopt' : kind === 'opening' ? P.opening
      : kind === 'publish' || kind === 'policy' ? P.publish : P.edit;
    const mode = kind === 'adopt' || kind === 'preparation' ? 'workspace' : 'platform';
    allowed(permission, mode); check(signal);
    await reserve(pending, signal);
    allowed(permission, mode);
    check(signal);
    const result = await dispatch(pending.key); check(signal);
    allowed(permission, mode);
    if (!input.store.matches(pending)) throw Error('AI_RESULT_UNKNOWN');
    const receipt = await accept(result, pending); check(signal); allowed(permission, mode);
    input.store.settle(pending); view.pending = null; view.receipt = receipt; notify();
    return result;
  }
  async function refreshPlatform(code: string, signal: AbortSignal) {
    const detail = await api.detail(code, signal); check(signal);
    view.detail = detail; return detail;
  }
  function matchAdoption(result: CategoryAdoptionResult, pending: Pending) {
    if (!result || result.outcome !== 'adopted' || result.categoryCode !== pending.code || result.operation !== pending.operation
      || result.sourceVersionId !== pending.sourceVersionId || result.sourceRevision !== pending.sourceRevision
      || result.targetVersionId !== pending.versionId || result.adoptionRevision !== Number(pending.sourceRevision) + 1
      || result.preparationRevision !== pending.preparationRevision || result.targetPolicyRevision !== pending.targetPolicyRevision
      || !id(result.auditId) || !Number.isFinite(Date.parse(result.adoptedAt))) throw Error('AI_RESULT_UNKNOWN');
  }
  function matchPreparation(result: CategoryPreparationSaveResult, pending: Pending) {
    if (!result || result.preparedOnly !== true || result.batchId !== pending.key || result.targetVersionId !== pending.versionId
      || result.sourceRevision !== pending.sourceRevision || result.revision !== Number(pending.preparationRevision) + 1
      || !id(result.id) || typeof result.adoptionImplemented !== 'boolean') throw Error('AI_RESULT_UNKNOWN');
  }
  function consumeVersion(version: CategoryVersionView) {
    if (view.detail?.code !== version.categoryCode.toLowerCase()) return;
    const existing = view.detail.versions.some(row => row.id === version.id);
    view.detail.versions = existing ? view.detail.versions.map(row => row.id === version.id ? structuredClone(version) : row)
      : [...view.detail.versions, structuredClone(version)];
    view.selectedVersionId = version.id;
  }
  async function refreshAfterWrite(code: string, signal: AbortSignal) {
    try { await refreshPlatform(code, signal); }
    catch (error) { check(signal); view.error = error; }
  }
  async function reconcilePlatform(pending: Pending, signal: AbortSignal): Promise<Receipt | null> {
    if (pending.kind === 'create') {
      allowed(P.edit, 'platform');
      const original = await api.creationReceipt(pending.key, signal); check(signal);
      if (original.outcome !== 'created') return null;
      const version = original.version;
      if (version.categoryCode !== pending.code || version.versionLabel !== pending.versionLabel || version.revision !== 0
        || version.status !== 'draft' || await categoryAssistFingerprint(version.definition) !== pending.definitionHash) throw Error('AI_RESULT_UNKNOWN');
      return { kind: pending.kind, version };
    }
    allowed(P.audit, 'platform');
    const audits = await api.audits(pending.code, signal); check(signal);
    const own = audits.filter(row => row.actorId === owner.actorId && row.categoryCode.toLowerCase() === pending.code);
    for (const audit of own) {
      const before = record(audit.before) ? audit.before : {}, after = record(audit.after) ? audit.after : {};
      if (pending.kind === 'publish' && audit.action === 'publish' && audit.id === `publish:${pending.versionId}` && audit.versionId === pending.versionId
        && after.idempotencyKey === pending.key && after.expectedRevision === pending.expectedRevision && after.digest === pending.definitionHash
        && before.revision === pending.expectedRevision
        && await categoryAssistFingerprint({ code: pending.code, id: pending.versionId,
          body: { expectedRevision: pending.expectedRevision, idempotencyKey: pending.key, reason: audit.reason } }) === pending.intentHash) return { kind: 'publish', audit };
      if (pending.kind === 'policy' && audit.action === 'version_policy' && audit.versionId === pending.versionId
        && before.revision === pending.expectedRevision && after.revision === Number(pending.expectedRevision) + 1) {
        const body = { ...Object.fromEntries(policyFields.map(field => [field, after[field]])), expectedRevision: pending.expectedRevision, reason: audit.reason };
        if (await categoryAssistFingerprint({ code: pending.code, id: pending.versionId, body }) === pending.intentHash) return { kind: 'policy', audit };
      }
      if (pending.kind === 'opening' && audit.action === 'opening_policy' && audit.versionId === null
        && before.openingRevision === pending.expectedRevision && after.openingRevision === Number(pending.expectedRevision) + 1) {
        const body = { expectedRevision: pending.expectedRevision, scope: after.openingScope, tenantIds: after.openingTenantIds,
          ...(pending.explicitRecommendation ? { recommendedVersionId: after.recommendedVersionId } : {}), reason: audit.reason };
        if (await categoryAssistFingerprint({ code: pending.code, body }) === pending.intentHash) return { kind: 'opening', audit };
      }
      if (pending.kind === 'copy' && audit.action === 'draft_create' && after.sourceVersionId === pending.sourceVersionId && after.revision === 0) {
        const detail = await refreshPlatform(pending.code, signal), version = detail.versions.find(row => row.id === audit.versionId);
        if (version && version.versionLabel === pending.versionLabel && version.sourceVersionId === pending.sourceVersionId
          && await categoryAssistFingerprint({ code: pending.code, body: { sourceVersionId: pending.sourceVersionId,
            versionLabel: pending.versionLabel, reason: audit.reason } }) === pending.intentHash) return { kind: 'copy', audit, version };
      }
      if (pending.kind === 'patch' && audit.action === 'draft_patch' && audit.versionId === pending.versionId
        && before.revision === pending.expectedRevision && after.revision === Number(pending.expectedRevision) + 1 && after.section === pending.section) {
        const detail = await refreshPlatform(pending.code, signal), version = detail.versions.find(row => row.id === pending.versionId);
        if (!version || version.revision !== after.revision || await definitionDigest(version.definition) !== after.digest) continue;
        const body = { expectedRevision: pending.expectedRevision, reason: audit.reason, values: projection(version.definition, pending.fields!) };
        if (await categoryAssistFingerprint({ code: pending.code, versionId: pending.versionId, section: pending.section, body }) === pending.intentHash) return { kind: 'patch', audit, version };
      }
    }
    return null;
  }
  function proposalReady() {
    check(); restoreProposal();
    if (view.damaged || view.proposalDamaged || view.pending || input.store.read() || view.policyPending) throw Error('AI_RESULT_UNKNOWN');
  }
  async function materialFor(source: AiCategoryProposalSource, signal: AbortSignal) {
    const value = await api.proposalMaterial(source, signal); check(signal);
    if (!record(value.principal) || value.principal.actorId !== owner.actorId || value.principal.tenantId !== owner.tenantId
      || value.principal.isSaasAdmin !== true || !hash(value.materialHash)
      || await categoryAssistFingerprint(value.source) !== await categoryAssistFingerprint(source)) throw Error('AI_CATEGORY_SOURCE_UNAVAILABLE');
    const { materialHash, ...payload } = value;
    if (await categoryAssistFingerprint(payload) !== materialHash) throw Error('AI_CATEGORY_SOURCE_UNAVAILABLE');
    check(signal); return value;
  }
  async function observeProposal(journal: ProposalJournal, signal: AbortSignal) {
    if (!journal.reference) throw Error('AI_RESULT_UNKNOWN');
    const result = await api.readProposal(journal.reference, signal); check(signal);
    if (await categoryAssistFingerprint(result.reference) !== await categoryAssistFingerprint(journal.reference)) throw Error('AI_RESULT_UNKNOWN');
    if (result.state === 'candidate' && (result.candidate.materialHash !== journal.reference.materialHash
      || await categoryAssistFingerprint(result.candidate.source) !== await categoryAssistFingerprint(journal.source))) throw Error('AI_RESULT_UNKNOWN');
    check(signal); allowed(P.view, 'platform');
    const next: ProposalJournal = { ...journal, phase: result.state === 'unknown' ? journal.phase === 'prepared' ? 'prepared' : 'read_only' : 'observed' };
    input.store.writeProposal(next, journal); view.proposal = next; view.proposalResult = result; notify(); return result;
  }
  async function policyFieldsHash(value: Extract<CategoryProposalPolicy, { state: 'configured' }>) {
    return categoryAssistFingerprint({ enabled: value.enabled, limits: value.limits, expiresAt: new Date(value.expiresAt).toISOString() });
  }
  const session = {
    // Axios failures can contain a non-cloneable request object. Buffered facts
    // are copied independently; the UI uses the error only as a failure signal.
    get view() { return { ...structuredClone({ ...view, error: null }), error: view.error }; },
    async readProposalMaterial(source: AiCategoryProposalSource) {
      allowed(P.view, 'platform'); const selection = readCategoryProposalSource(source);
      return run('proposal-material', async signal => { const value = await materialFor(selection, signal);
        view.proposalMaterial = value; notify(); return value; });
    },
    async prepareProposal(goal: string, source: AiCategoryProposalSource) {
      allowed(P.edit, 'platform'); proposalReady();
      if (view.proposal && view.proposal.phase !== 'observed') throw Error('AI_RESULT_UNKNOWN');
      if (typeof goal !== 'string' || !goal.trim() || goal.length > 2000) throw Error('AI_INVALID_INPUT');
      const selection = readCategoryProposalSource(source);
      return run('proposal-prepare', async signal => {
        const material = await materialFor(selection, signal), previous = input.store.readProposal();
        if (previous && previous.phase !== 'observed') throw Error('AI_RESULT_UNKNOWN');
        const journal: ProposalJournal = { phase: 'preparing', operationKey: crypto.randomUUID(), source: selection };
        allowed(P.edit, 'platform'); check(signal);
        input.store.writeProposal(journal, previous); view.proposal = journal; view.proposalResult = null; view.proposalMaterial = null; notify();
        const prepared = await api.prepareProposal({ operationKey: journal.operationKey, goal: goal.trim(), source: selection }, signal); check(signal);
        allowed(P.edit, 'platform');
        if (prepared.reference.operationKey !== journal.operationKey || prepared.reference.materialHash !== material.materialHash
          || prepared.material.materialHash !== prepared.reference.materialHash
          || !record(prepared.material.principal) || prepared.material.principal.actorId !== owner.actorId
          || prepared.material.principal.tenantId !== owner.tenantId) throw Error('AI_RESULT_UNKNOWN');
        const { materialHash, ...payload } = prepared.material;
        if (await categoryAssistFingerprint(payload) !== materialHash
          || await categoryAssistFingerprint(prepared.material.source) !== await categoryAssistFingerprint(selection)) throw Error('AI_RESULT_UNKNOWN');
        check(signal); allowed(P.edit, 'platform');
        const next: ProposalJournal = { ...journal, phase: 'prepared', reference: readCategoryProposalReference(prepared.reference) };
        input.store.writeProposal(next, journal); view.proposal = next; view.proposalMaterial = prepared.material; notify(); return prepared;
      });
    },
    async generateProposal() {
      allowed(P.edit, 'platform'); proposalReady(); const journal = view.proposal;
      if (journal?.phase !== 'prepared' || !journal.reference) throw Error('AI_RESULT_UNKNOWN');
      return run('proposal-generate', async signal => {
        const material = await materialFor(journal.source, signal);
        if (material.materialHash !== journal.reference!.materialHash) throw Error('AI_CATEGORY_SOURCE_UNAVAILABLE');
        allowed(P.edit, 'platform'); check(signal);
        const dispatch: ProposalJournal = { ...journal, phase: 'generating' };
        input.store.writeProposal(dispatch, journal); view.proposal = dispatch; view.proposalMaterial = null; view.proposalResult = null; notify();
        const result = await api.generateProposal(journal.reference!, signal); check(signal); allowed(P.edit, 'platform');
        if (await categoryAssistFingerprint(result.reference) !== await categoryAssistFingerprint(journal.reference)) throw Error('AI_RESULT_UNKNOWN');
        if (result.state === 'candidate' && (result.candidate.materialHash !== journal.reference!.materialHash
          || await categoryAssistFingerprint(result.candidate.source) !== await categoryAssistFingerprint(journal.source))) throw Error('AI_RESULT_UNKNOWN');
        check(signal); allowed(P.edit, 'platform');
        const next: ProposalJournal = { ...dispatch, phase: result.state === 'unknown' ? 'read_only' : 'observed' };
        input.store.writeProposal(next, dispatch); view.proposal = next; view.proposalResult = result; notify(); return result;
      });
    },
    async readProposal() {
      allowed(P.view, 'platform'); check(); restoreProposal(); const journal = view.proposal;
      if (view.proposalDamaged || !journal) throw Error('AI_RESULT_UNKNOWN');
      return run('proposal-read', async signal => {
        let original = journal;
        if (!original.reference) {
          const operation = await api.proposalOperation(original.operationKey, signal); check(signal);
          if (operation.state !== 'stored') return null;
          if (operation.reference.operationKey !== original.operationKey) throw Error('AI_RESULT_UNKNOWN');
          allowed(P.view, 'platform'); check(signal);
          const next: ProposalJournal = { ...original, phase: 'read_only', reference: readCategoryProposalReference(operation.reference) };
          input.store.writeProposal(next, original); view.proposal = next; original = next;
        }
        return observeProposal(original, signal);
      });
    },
    async acceptProposalCandidate() {
      const result = await session.readProposal(); check();
      if (result?.state !== 'candidate') throw Error('AI_CATEGORY_SOURCE_UNAVAILABLE');
      return structuredClone(result.candidate);
    },
    async readProposalPolicy() {
      allowed(P.edit, 'platform');
      return run('proposal-policy-read', async signal => {
        const value = await api.proposalPolicy(signal); check(signal); allowed(P.edit, 'platform');
        restoreProposal();
        // The public policy reader returns current configuration, not an
        // actor-bound original operation receipt. Equal fields do not settle
        // a lost policy ACK; preserve the original journal for reconciliation.
        view.proposalPolicy = value; notify(); return value;
      });
    },
    async changeProposalPolicy(value: { enabled: boolean; limits: Extract<CategoryProposalPolicy, { state: 'configured' }>['limits']; expiresAt: string }) {
      allowed(P.edit, 'platform'); proposalReady();
      if (!view.proposalPolicy || view.proposal && view.proposal.phase !== 'observed') throw Error('AI_CATEGORY_REVIEW_REQUIRED');
      const body = { ...structuredClone(value), expiresAt: new Date(value.expiresAt).toISOString(),
        expectedRevision: view.proposalPolicy.state === 'configured' ? view.proposalPolicy.revision : null };
      return run('proposal-policy-change', async signal => {
        const journal: PolicyJournal = { expectedRevision: body.expectedRevision,
          inputHash: await categoryAssistFingerprint({ enabled: body.enabled, limits: body.limits, expiresAt: body.expiresAt }) };
        allowed(P.edit, 'platform'); check(signal); input.store.reservePolicy(journal); view.policyPending = journal; notify();
        const next = await api.changeProposalPolicy(body, signal); check(signal); allowed(P.edit, 'platform');
        if (next.state !== 'configured' || next.revision !== (body.expectedRevision ?? 0) + 1 || await policyFieldsHash(next) !== journal.inputHash) throw Error('AI_RESULT_UNKNOWN');
        check(signal); input.store.settlePolicy(journal); view.policyPending = null; view.proposalPolicy = next;
        view.proposalPolicyReceipt = next; notify(); return next;
      });
    },
    async reconcileProposalPolicy() {
      allowed(P.edit, 'platform'); restoreProposal(); const journal = view.policyPending;
      if (view.proposalDamaged || !journal) throw Error('AI_RESULT_UNKNOWN');
      return run('proposal-policy-operation', async signal => {
        const original = await api.proposalPolicyOperation(journal, signal); check(signal); allowed(P.edit, 'platform');
        if (original.retryable !== false) throw Error('AI_RESULT_UNKNOWN');
        if (original.state === 'not_observed') return null;
        if (original.policy.revision !== (journal.expectedRevision ?? 0) + 1
          || await policyFieldsHash(original.policy) !== journal.inputHash) throw Error('AI_RESULT_UNKNOWN');
        check(signal); allowed(P.edit, 'platform'); input.store.settlePolicy(journal); view.policyPending = null;
        // The actor-bound receipt can describe an older revision. Require a
        // fresh current-policy read before preparing another policy decision.
        view.proposalPolicyReceipt = original.policy; view.proposalPolicy = null; notify(); return original;
      });
    },
    async readPlatform(code?: string) {
      allowed(P.view, 'platform');
      return run('read', async signal => {
        const categories = await api.list(signal); check(signal); view.categories = categories;
        const catalog = await api.catalog(signal); check(signal); view.catalog = catalog;
        if (code) { await refreshPlatform(code, signal); if (!view.detail?.versions.some(row => row.id === view.selectedVersionId)) view.selectedVersionId = null; }
        view.creation = null; view.review = null; notify(); return view.detail;
      });
    },
    async selectVersion(code: string, versionId: string) {
      allowed(P.view, 'platform');
      return run('review', async signal => {
        const detail = await refreshPlatform(code, signal), version = detail.versions.find(row => row.id === versionId);
        if (!version) throw Error('AI_CATEGORY_SOURCE_UNAVAILABLE');
        view.selectedVersionId = versionId;
        const review = await api.reviewVersion(code, versionId, signal); check(signal);
        if (review.revision !== version.revision) throw Error('AI_CATEGORY_SOURCE_UNAVAILABLE');
        view.review = review; notify(); return version;
      });
    },
    async readTenants() {
      check(); if (owner.mode !== 'platform' || !input.permission(P.publish) && !input.permission(P.opening)) throw Error('AI_ACCESS_DENIED');
      return run('tenants', async signal => { const tenants = await api.tenants(signal); check(signal); view.tenants = tenants; notify(); return tenants; });
    },
    async previewCreation(value: PreviewRentalCategoryCreationRequest) {
      allowed(P.edit, 'platform');
      const command = structuredClone(value);
      return run('preview', async signal => {
        const catalog = await api.catalog(signal); check(signal); view.catalog = catalog;
        if (!catalog.dynamicCreationEnabled) throw Error('AI_RESOURCE_UNAVAILABLE');
        const result = await api.previewCreation(command, signal); check(signal);
        view.creation = { input: command, result }; notify(); return result;
      });
    },
    async createCategory(why: string) {
      allowed(P.edit, 'platform');
      return run('create', async signal => {
        const prepared = view.creation;
        if (!prepared?.result.valid) throw Error('AI_CATEGORY_REVIEW_REQUIRED');
        const catalog = await api.catalog(signal); check(signal);
        if (!catalog.dynamicCreationEnabled) throw Error('AI_RESOURCE_UNAVAILABLE');
        const key = crypto.randomUUID(), body: CreateRentalCategoryRequest = { ...structuredClone(prepared.input),
          expectedDefinitionHash: prepared.result.definitionHash, idempotencyKey: key, reason: reason(why) };
        const created = await write('create', body, { code: body.code, key, versionLabel: body.versionLabel, definitionHash: body.expectedDefinitionHash }, signal,
          () => api.createCategory(body, signal), async version => {
            if (version.categoryCode !== body.code || version.versionLabel !== body.versionLabel || version.status !== 'draft' || version.revision !== 0
              || await categoryAssistFingerprint(version.definition) !== body.expectedDefinitionHash) throw Error('AI_RESULT_UNKNOWN');
            return { kind: 'create', version };
          });
        view.creation = null; consumeVersion(created); await refreshAfterWrite(body.code, signal);
        if (view.detail?.code === body.code) view.selectedVersionId = created.id;
        notify(); return created;
      });
    },
    async copyVersion(code: string, sourceVersionId: string, versionLabel: string, why: string) {
      allowed(P.edit, 'platform');
      return run('copy', async signal => {
        const detail = await refreshPlatform(code, signal), source = detail.versions.find(row => row.id === sourceVersionId);
        if (!source || !['published', 'legacy_baseline'].includes(source.status) || detail.versions.some(row => row.versionLabel === versionLabel)
          || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(versionLabel)) throw Error('AI_CATEGORY_SOURCE_UNAVAILABLE');
        const command = { code, body: { sourceVersionId, versionLabel, reason: reason(why) } };
        const created = await write('copy', command, { code, sourceVersionId, versionLabel }, signal,
          () => api.copyVersion(code, command.body, signal), version => ({ kind: 'copy', version }));
        consumeVersion(created); await refreshAfterWrite(code, signal); view.review = null; notify(); return created;
      });
    },
    async patch(section: CategoryDraftSection, values: Record<string, unknown>, why: string, expectedRevision?: number) {
      allowed(P.edit, 'platform');
      const version = selected(), code = version.categoryCode.toLowerCase(), submitted = structuredClone(values);
      return run('patch', async signal => {
        if (version.status !== 'draft' || !Object.keys(submitted).length
          || expectedRevision !== undefined && version.revision !== expectedRevision) throw Error('AI_CATEGORY_REVIEW_REQUIRED');
        const command = { code, versionId: version.id, section, body: { expectedRevision: version.revision, values: submitted, reason: reason(why) } };
        const result = await write('patch', command, { code, versionId: version.id, expectedRevision: version.revision, section, fields: Object.keys(submitted) }, signal,
          () => api.patchVersion(code, version.id, section, command.body, signal), next => ({ kind: 'patch', version: next }));
        consumeVersion(result); await refreshAfterWrite(code, signal); view.review = null; notify(); return result;
      });
    },
    async publish(why: string, expected?: { versionId: string; revision: number; report?: CategoryDraftReview }) {
      allowed(P.publish, 'platform'); const version = selected(), code = version.categoryCode.toLowerCase();
      const confirmedReport = structuredClone(expected?.report ?? view.review);
      return run('publish', async signal => {
        if (version.status !== 'draft' || expected && (expected.versionId !== version.id || expected.revision !== version.revision)) {
          throw Error('AI_CATEGORY_REVIEW_REQUIRED');
        }
        const review = await api.reviewVersion(code, version.id, signal); check(signal);
        // A fresh report may include a changed affected-space count even when
        // the draft CAS revision is unchanged. Show that report and require a
        // new explicit confirmation before reserving a publication operation.
        const reviewed = confirmedReport && await categoryAssistFingerprint(confirmedReport);
        const latest = await categoryAssistFingerprint(review); check(signal);
        if (!review.valid || review.revision !== version.revision || !confirmedReport?.valid
          || confirmedReport.revision !== version.revision || reviewed !== latest) {
          view.review = review; notify(); throw Error('AI_CATEGORY_REVIEW_REQUIRED');
        }
        const key = crypto.randomUUID(), body = { expectedRevision: version.revision, idempotencyKey: key, reason: reason(why) }, command = { code, id: version.id, body };
        const originalDigest = await definitionDigest(version.definition); check(signal);
        const next = await write('publish', command, { code, key, versionId: version.id, expectedRevision: version.revision, definitionHash: originalDigest }, signal,
          () => api.publish(code, version.id, body, signal), async result => {
            if (result.id !== version.id || result.status !== 'published' || result.revision !== version.revision + 1
              || await definitionDigest(result.definition) !== originalDigest) throw Error('AI_RESULT_UNKNOWN');
            return { kind: 'publish', version: result };
          });
        consumeVersion(next); await refreshAfterWrite(code, signal); view.review = null; notify(); return next;
      });
    },
    async savePolicy(values: Omit<SaveCategoryVersionPolicyRequest, 'expectedRevision' | 'reason'>, why: string,
      expected?: { versionId: string; revision: number }) {
      allowed(P.publish, 'platform'); const version = selected(), code = version.categoryCode.toLowerCase();
      if (!['published', 'legacy_baseline'].includes(version.status) || !version.policy
        || expected && (expected.versionId !== version.id || expected.revision !== version.policy.revision)) throw Error('AI_CATEGORY_REVIEW_REQUIRED');
      const body = { ...structuredClone(values), expectedRevision: version.policy.revision, reason: reason(why) };
      return run('policy', async signal => {
        const result = await write('policy', { code, id: version.id, body }, { code, versionId: version.id, expectedRevision: body.expectedRevision }, signal,
          () => api.policy(code, version.id, body, signal), next => {
            if (next.id !== version.id || !next.policy || next.policy.revision !== body.expectedRevision + 1
              || policyFields.some(field => JSON.stringify(next.policy![field]) !== JSON.stringify(body[field]))) throw Error('AI_RESULT_UNKNOWN');
            return { kind: 'policy', version: next };
          });
        consumeVersion(result); await refreshAfterWrite(code, signal); notify(); return result;
      });
    },
    async saveOpening(code: string, values: Omit<SaveCategoryOpeningRequest, 'expectedRevision' | 'reason'>, why: string, expectedRevision?: number) {
      allowed(P.opening, 'platform');
      if (view.detail?.code !== code || expectedRevision !== undefined && view.detail.openingRevision !== expectedRevision) throw Error('AI_CATEGORY_REVIEW_REQUIRED');
      const body = { ...structuredClone(values), expectedRevision: view.detail.openingRevision, reason: reason(why) };
      return run('opening', async signal => {
        const result = await write('opening', { code, body }, { code, expectedRevision: body.expectedRevision, explicitRecommendation: values.recommendedVersionId !== undefined }, signal,
          () => api.opening(code, body, signal), next => ({ kind: 'opening', opening: next }));
        await refreshAfterWrite(code, signal); notify(); return result;
      });
    },
    async readWorkspace(operation: CategoryPreparationOperation = 'upgrade') {
      allowed('rental-os:category:adopt', 'workspace');
      if (!owner.workspaceId) throw Error('AI_SCOPE_CHANGED');
      return run('read', async signal => { const candidates = await api.candidates(operation, signal); check(signal); view.candidates = candidates;
        view.operation = operation; view.preparation = null; view.entities = null; notify(); return view.candidates; });
    },
    async inspectTarget(targetId: string) {
      allowed('rental-os:category:adopt', 'workspace');
      return run('review', async signal => { const result = await api.preparation(targetId, view.operation, signal); check(signal);
        if (view.candidates && (result.sourceVersionId !== view.candidates.sourceVersionId || result.sourceRevision !== view.candidates.sourceRevision)) throw Error('AI_CATEGORY_SOURCE_UNAVAILABLE');
        view.preparation = result; view.entities = null; notify(); return result; });
    },
    async readEntities(entityType: 'item_group' | 'asset', after?: string, search?: string) {
      allowed('rental-os:category:adopt', 'workspace'); const preview = view.preparation;
      if (!preview) throw Error('AI_CATEGORY_REVIEW_REQUIRED');
      return run('entities', async signal => {
        const page = await api.entities(preview.targetVersionId, { operation: view.operation, entityType, limit: 20,
          ...(after ? { after } : {}), ...(search?.trim() ? { search: search.trim() } : {}) }, signal); check(signal);
        if (page.sourceVersionId !== preview.sourceVersionId || page.sourceRevision !== preview.sourceRevision
          || page.preparationRevision !== (preview.preparation?.revision ?? 0)) throw Error('AI_CATEGORY_SOURCE_UNAVAILABLE');
        view.entities = page; notify(); return page;
      });
    },
    async savePreparation(patches: SaveCategoryPreparationBatchRequest['patches'], why: string,
      capabilityPatches?: SaveCategoryPreparationBatchRequest['capabilityPatches'],
      expected?: { sourceVersionId: string; sourceRevision: number; preparationRevision: number },
      changes?: Pick<SaveCategoryPreparationBatchRequest, 'removals' | 'removeCapabilityCodes' | 'resetPreparation'>) {
      allowed('rental-os:category:adopt', 'workspace'); const preview = view.preparation;
      if (!preview || preview.stale && !changes?.resetPreparation || expected && (expected.sourceVersionId !== preview.sourceVersionId
        || expected.sourceRevision !== preview.sourceRevision || expected.preparationRevision !== (preview.preparation?.revision ?? 0))) {
        throw Error('AI_CATEGORY_REVIEW_REQUIRED');
      }
      return run('preparation', async signal => {
        const key = crypto.randomUUID(), body: SaveCategoryPreparationBatchRequest = { batchId: key, operation: view.operation,
          expectedSourceVersionId: preview.sourceVersionId, expectedSourceRevision: preview.sourceRevision,
          expectedPreparationRevision: preview.preparation?.revision ?? 0, patches: structuredClone(patches), reason: reason(why),
          ...(capabilityPatches ? { capabilityPatches: structuredClone(capabilityPatches) } : {}),
          ...(changes ? structuredClone(changes) : {}) };
        const result = await write('preparation', { targetId: preview.targetVersionId, body }, { code: preview.targetDefinition.code, key,
          versionId: preview.targetVersionId, sourceVersionId: preview.sourceVersionId, sourceRevision: preview.sourceRevision,
          preparationRevision: body.expectedPreparationRevision, operation: view.operation }, signal,
          () => api.saveBatch(preview.targetVersionId, body, signal), (next, pending) => { matchPreparation(next, pending); return { kind: 'preparation', preparation: next }; });
        try { const updated = await api.preparation(preview.targetVersionId, view.operation, signal); check(signal); view.preparation = updated; }
        catch (error) { check(signal); view.error = error; view.preparation = null; }
        view.entities = null; notify(); return result;
      });
    },
    async adopt(why: string) {
      allowed('rental-os:category:adopt', 'workspace'); const preview = view.preparation;
      if (!preview?.preparation?.revision || preview.stale || !preview.adoptionImplemented || !preview.validation.valid
        || !preview.businessCompatibility.valid || !preview.businessCompatibility.complete || !preview.commercialContext.newBusinessAllowed
        || !revision(preview.targetPolicyRevision)) throw Error('AI_CATEGORY_REVIEW_REQUIRED');
      return run('adopt', async signal => {
        const fresh = await api.preparation(preview.targetVersionId, view.operation, signal); check(signal);
        if (fresh.sourceVersionId !== preview.sourceVersionId || fresh.sourceRevision !== preview.sourceRevision
          || fresh.preparation?.revision !== preview.preparation!.revision || fresh.targetPolicyRevision !== preview.targetPolicyRevision
          || fresh.stale || !fresh.validation.valid || !fresh.businessCompatibility.valid || !fresh.businessCompatibility.complete
          || !fresh.commercialContext.newBusinessAllowed || !fresh.adoptionImplemented) throw Error('AI_CATEGORY_REVIEW_REQUIRED');
        if (await categoryAssistFingerprint({ definition: fresh.targetDefinition, registered: fresh.registeredCapabilityVersions,
          preparation: fresh.preparation, validation: fresh.validation, business: fresh.businessCompatibility, commercial: fresh.commercialContext })
          !== await categoryAssistFingerprint({ definition: preview.targetDefinition, registered: preview.registeredCapabilityVersions,
            preparation: preview.preparation, validation: preview.validation, business: preview.businessCompatibility, commercial: preview.commercialContext })) {
          throw Error('AI_CATEGORY_REVIEW_REQUIRED');
        }
        check(signal);
        const key = crypto.randomUUID(), body: AdoptRentalCategoryRequest = { expectedSourceVersionId: fresh.sourceVersionId, expectedSourceRevision: fresh.sourceRevision,
          expectedPreparationRevision: fresh.preparation!.revision, expectedTargetPolicyRevision: fresh.targetPolicyRevision!, operation: view.operation,
          idempotencyKey: key, reason: reason(why) };
        return write('adopt', { targetId: fresh.targetVersionId, body }, { code: fresh.targetDefinition.code, key, versionId: fresh.targetVersionId,
          sourceVersionId: fresh.sourceVersionId, sourceRevision: fresh.sourceRevision, preparationRevision: fresh.preparation!.revision,
          targetPolicyRevision: fresh.targetPolicyRevision, operation: view.operation }, signal,
          () => api.adopt(fresh.targetVersionId, body, signal), (result, pending) => { matchAdoption(result, pending); view.preparation = null;
            return { kind: 'adopt', adoption: result }; });
      });
    },
    async reconcile() {
      check(); restore(); const pending = view.pending;
      if (view.damaged || !pending) throw Error('AI_RESULT_UNKNOWN');
      return run('reconcile', async signal => {
        let receipt: Receipt | null;
        if (pending.kind === 'adopt') {
          allowed('rental-os:category:adopt', 'workspace');
          const original = await api.adoptionReceipt(pending.key, signal); check(signal);
          if (original.outcome !== 'adopted') return null;
          matchAdoption(original.result, pending); receipt = { kind: 'adopt', adoption: original.result };
        } else if (pending.kind === 'preparation') {
          allowed('rental-os:category:adopt', 'workspace');
          const original = await api.readBatch(pending.versionId!, pending.key, signal); check(signal);
          if (original.outcome !== 'saved') return null;
          matchPreparation(original.result, pending); receipt = { kind: 'preparation', preparation: original.result };
        } else receipt = await reconcilePlatform(pending, signal);
        check(signal); if (!receipt) return null;
        if (!input.store.matches(pending)) throw Error('AI_RESULT_UNKNOWN');
        input.store.settle(pending); view.pending = null; view.receipt = receipt;
        // A recovered historical operation proves its receipt, not that the
        // buffered current draft or preparation is still the active revision.
        view.review = null; view.creation = null;
        if (owner.mode === 'platform') { view.detail = null; view.selectedVersionId = null; }
        else { view.preparation = null; view.entities = null; }
        notify(); return receipt;
      });
    },
    activate() { active = true; restore(); restoreProposal(); notify(); },
    clearCreationReview() { view.creation = null; notify(); },
    clearFacts() { request?.abort(); request = null; view = { ...view, categories: null, tenants: null, catalog: null, detail: null, selectedVersionId: null, review: null,
      creation: null, candidates: null, preparation: null, entities: null, receipt: null, proposalMaterial: null, proposalResult: null,
      proposalPolicy: null, proposalPolicyReceipt: null, busy: null, error: null }; notify(); },
    dispose() { active = false; session.clearFacts(); }
  };
  return Object.freeze(session);
}
export type CategoryAssistSession = ReturnType<typeof createCategoryAssistSession>;
