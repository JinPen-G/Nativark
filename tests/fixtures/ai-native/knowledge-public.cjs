'use strict';
/** Public C06 factory with finite ACL, file and repository ports. Business Auth,
 * persisted file bindings and the Rental compatibility host use their own tests. */
const assert = require('node:assert/strict');
const path = require('node:path');
const attempts = [];
const block = (object, key) => { object[key] = () => { attempts.push(key); throw new Error('offline network denied'); }; };
block(require('node:net').Socket.prototype, 'connect'); block(globalThis, 'fetch');
for (const object of [require('node:dns'), require('node:dns/promises')]) for (const key of Object.keys(object)) if (/^(lookup|resolve|reverse)/.test(key) && typeof object[key] === 'function') block(object, key);
block(require('node:tls'), 'connect'); block(require('node:dgram'), 'createSocket');
const { createControllerSourceLoader } = require('../../../scripts/controller-sources.cjs');
const loader = createControllerSourceLoader(path.resolve(__dirname, '../../..'));
const load = name => loader.load(loader.resolveSource(__filename, name, true));
const contracts = load('@rental-os/platform-contracts');
const { AI_CONTRACT_DRAFT_VERSION } = load('@rental-os/platform-contracts/ai-gateway');
const { composeKnowledgeServices } = load('@rental-os/ai-native-server/knowledge-persistence');
const clone = value => value === undefined ? undefined : structuredClone(value);
const key = (...parts) => JSON.stringify(parts);
const scope = { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'space-1' };
const now = Date.parse('2026-10-03T00:00:00Z');
function context(overrides = {}) { return { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: 'request-1', authorizedAt: new Date(now).toISOString(), audience: 'operator', actor: { kind: 'user', userId: 'user-1' }, scope: clone(scope), access: { permissions: ['knowledge'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } }, ...overrides }; }
function draft(overrides = {}) { return { documentId: 'doc-1', documentVersion: 'v1', attachmentId: 'attachment-1', title: 'Synthetic SOP', validFrom: new Date(now).toISOString(), operationId: 'create-1', ...overrides }; }
class MemoryRepository {
  heads = new Map(); versions = new Map(); receipts = new Map(); chunks = new Map(); commits = 0;
  async read(scope, id) { return clone(this.heads.get(key(scope, id)) ?? null); }
  async operation(scope, id, op) { return clone(this.receipts.get(key(scope, id, op)) ?? null); }
  async commit(input) {
    const { scope, documentId, operation, next, expectedRevision, newVersion, chunks } = input;
    const k = key(scope, documentId), vk = key(scope, documentId, next.document.documentVersion), rk = key(scope, documentId, operation.id);
    if ((this.heads.get(k)?.revision ?? 0) !== expectedRevision || this.receipts.has(rk) || (newVersion && this.versions.has(vk))) return 'conflict';
    if (chunks && this.chunks.has(vk)) return 'conflict';
    assert.equal(next.revision, expectedRevision + 1);
    this.heads.set(k, clone(next)); this.receipts.set(rk, clone(operation));
    if (newVersion) this.versions.set(vk, clone(next.document));
    if (chunks) this.chunks.set(vk, clone(chunks));
    this.commits++; return 'committed';
  }
  seed(record, chunks) { this.heads.set(key(record.document.scope, record.document.documentId), clone(record)); if (chunks) this.chunks.set(key(record.document.scope, record.document.documentId, record.document.documentVersion), clone(chunks)); }
}
const source = c => ({ kind: 'document', documentId: c.documentId, documentVersion: c.documentVersion, chunkId: c.chunkId, scope: clone(c.scope), aclRevision: c.aclRevision, locator: clone(c.locator) });
const query = overrides => ({ requestId: 'recall-1', query: 'Synthetic', limit: 5, ...overrides });
function harness() {
  const h = { repo: new MemoryRepository(), now, denied: false, authCalls: [], policyRevision: 1, rule: () => true,
    fileCalls: 0, text: 'Synthetic paragraph.', parseError: null, bodyReads: 0, searchCalls: [] };
  h.authorization = { authorize: async (ctx, request) => {
    h.authCalls.push(clone(request));
    if (h.denied || !h.rule(ctx, request) || ctx.authorizedAt !== new Date(now).toISOString()) return null;
    const actorId = ctx.actor.userId ?? ctx.actor.customerId;
    if (!actorId || !['user', 'customer', 'saas_admin'].includes(ctx.actor.kind)) return null;
    const actor = { actorKind: ctx.actor.kind, actorId };
    return { scope: clone(ctx.scope), actor, audience: ctx.audience, accessKey: key(actor, ctx.audience, h.policyRevision, ctx.access) };
  } };
  h.files = { read: async () => {
    h.fileCalls++;
    // The factory owns the real parser; inject the original failure at its input port.
    if (h.parseError) throw h.parseError;
    return { mediaType: 'text/plain', bytes: Buffer.from(h.text) };
  } };
  h.clock = { now: () => h.now };
  h.selection = { select: async ctx => {
    const grant = await h.authorization.authorize(ctx, { action: 'search', scope: ctx.scope });
    if (!grant) return null;
    const documents = [];
    for (const r of h.repo.heads.values()) {
      if (key(r.document.scope) !== key(ctx.scope) || !await h.authorization.authorize(ctx, { action: 'search', scope: ctx.scope, document: r.document })) continue;
      documents.push({ documentId: r.document.documentId, documentVersion: r.document.documentVersion, aclRevision: r.document.aclRevision });
    }
    return { grant, documents };
  } };
  h.search = { search: async input => {
    h.searchCalls.push(clone(input)); const result = [];
    for (const ref of input.documents) for (const c of h.repo.chunks.get(key(input.grant.scope, ref.documentId, ref.documentVersion)) ?? []) {
      if (c.text.toLowerCase().includes(input.query.toLowerCase())) result.push(source({ ...c, aclRevision: ref.aclRevision }));
    }
    return result.slice(0, input.limit);
  } };
  h.content = {
    chunk: async (_, ref) => {
      h.bodyReads++;
      const chunk = (h.repo.chunks.get(key(ref.scope, ref.documentId, ref.documentVersion)) ?? []).find(c => c.chunkId === ref.chunkId);
      const record = await h.repo.read(ref.scope, ref.documentId);
      return chunk && record?.document.documentVersion === ref.documentVersion ? clone({ ...chunk, aclRevision: record.document.aclRevision }) : null;
    },
    downloadReference: async (_, d) => ({ attachmentId: d.attachmentId, documentVersion: d.documentVersion }),
    factReference: async (_, fact) => clone(fact),
  };
  const unused = () => { throw new Error('This ACL fixture does not provide model, index or memory execution'); };
  const modulePorts = {
    documents: { repository: h.repo, authorization: h.authorization, clock: h.clock, files: h.files },
    content: h.content, selection: h.selection, search: h.search, index: { apply: unused },
    memory: { repository: { read: unused, operation: unused, commit: unused }, authorization: h.authorization,
      clock: h.clock, confirmations: { read: unused } },
    gateway: { invoke: unused, stream: unused }, cache: { maxEntries: 32, maxBytes: 65536, ttlMs: 1000 },
    policy: { sceneCode: 'knowledge_acl_fixture', maxOutputTokens: 100 },
  };
  const services = composeKnowledgeServices(modulePorts);
  return Object.assign(h, { modulePorts, documents: services.documents, publication: services.publication,
    sources: services.sources, retrieval: services.retrieval });
}
async function published(h, ctx = context(), input = draft()) {
  await h.documents.create(ctx, input);
  const record = await h.documents.parseDocument(ctx, { documentId: input.documentId, expectedRevision: 1, operationId: 'parse-1' });
  record.document.indexing = 'indexed'; h.repo.seed(record);
  return h.publication.publish(ctx, { documentId: input.documentId, expectedRevision: record.revision, operationId: 'publish-1' });
}
/** Original finite memory CAS and confirmation records, consumed through the
 * public service factory. This does not grant knowledge-body deletion. */
function memoryHarness(f = harness()) {
  f.memories = new Map(); f.memoryReceipts = new Map(); f.confirmations = new Map(); f.confirmationReads = 0;
  f.memoryRepository = {
    read: async (scope, owner, id) => clone(f.memories.get(key(scope, owner, id)) ?? null),
    operation: async (scope, owner, id, op) => clone(f.memoryReceipts.get(key(scope, owner, id, op)) ?? null),
    commit: async input => {
      const k = key(input.scope, input.owner, input.memoryId), op = key(input.scope, input.owner, input.memoryId, input.operation.id);
      if ((f.memories.get(k)?.revision ?? 0) !== input.expectedRevision || f.memoryReceipts.has(op)) return 'conflict';
      if (input.confirmation && key(f.confirmations.get(input.confirmation.id)) !== key(input.confirmation)) return 'conflict';
      f.memories.set(k, clone(input.next)); f.memoryReceipts.set(op, clone(input.operation)); return 'committed';
    },
  };
  f.memoryPorts = { repository: f.memoryRepository, authorization: f.authorization, clock: f.clock,
    confirmations: { read: async (_, id) => { f.confirmationReads++; return clone(f.confirmations.get(id) ?? null); } } };
  f.memory = composeKnowledgeServices({ ...f.modulePorts, memory: f.memoryPorts }).memory;
  f.confirm = (memory, overrides = {}) => {
    const record = { id: 'confirm-1', memoryId: memory.memoryId, revision: memory.revision, aclRevision: memory.aclRevision,
      owner: clone(memory.owner), scope: clone(memory.scope), audience: 'operator', preference: clone(memory.preference),
      memoryExpiresAt: memory.expiresAt, status: 'confirmed', issuedAt: new Date(f.now).toISOString(), expiresAt: memory.expiresAt, ...overrides };
    f.confirmations.set(record.id, record); return record;
  };
  return f;
}
const memoryProposal = overrides => ({ memoryId: 'memory-1', operationId: 'propose-1', expiresAt: '2026-10-04T00:00:00Z', preference: { kind: 'locale', value: 'zh-CN' }, ...overrides });
const memoryChange = (operation, expectedRevision, extra = {}) => ({ draftVersion: contracts.AI_KNOWLEDGE_DRAFT_VERSION, memoryId: 'memory-1', expectedRevision, operation, ...extra });
module.exports = { contracts, attempts, clone, key, scope, now, context, draft, harness, published, source, query,
  memoryHarness, memoryProposal, memoryChange };
