'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns');
const attempts = [];
const block = (object, key) => { object[key] = () => { attempts.push(key); throw new Error('offline network denied'); }; };
block(net.Socket.prototype, 'connect'); block(globalThis, 'fetch');
for (const object of [dns, require('node:dns/promises')]) for (const key of Object.keys(object)) if (/^(lookup|resolve|reverse)/.test(key) && typeof object[key] === 'function') block(object, key);
block(require('node:tls'), 'connect'); block(require('node:dgram'), 'createSocket');
const root = path.resolve(__dirname, '../../..');
assert.equal(fs.realpathSync(path.join(root, 'node_modules/@rental-os/shared')), fs.realpathSync(path.join(root, 'packages/shared')));
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: false });
const shared = require(path.join(root, 'node_modules/@rental-os/shared'));
const dir = path.join(root, 'apps/api/src/modules/ai-native/knowledge');
const load = name => require(path.join(dir, name));
const clone = value => value === undefined ? undefined : structuredClone(value);
const key = (...parts) => JSON.stringify(parts);
const scope = { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'space-1' };
const now = Date.parse('2026-10-03T00:00:00Z');
function context(overrides = {}) { return { contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, requestId: 'request-1', authorizedAt: new Date(now).toISOString(), audience: 'operator', actor: { kind: 'user', userId: 'user-1' }, scope: clone(scope), access: { permissions: ['knowledge'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } }, ...overrides }; }
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
function harness() {
  const { KnowledgeDocumentService } = load('knowledge-document.service');
  const { KnowledgePublicationService } = load('knowledge-publication.service');
  const { actor } = load('knowledge-validation');
  const h = { repo: new MemoryRepository(), now, denied: false, authCalls: [], policyRevision: 1, rule: () => true, fileCalls: 0, text: 'Synthetic paragraph.', parseError: null };
  h.authorization = { authorize: async (ctx, request) => {
    h.authCalls.push(clone(request));
    if (h.denied || !h.rule(ctx, request) || ctx.authorizedAt !== new Date(now).toISOString()) return null;
    return { scope: clone(ctx.scope), actor: actor(ctx), audience: ctx.audience, accessKey: key(actor(ctx), ctx.audience, h.policyRevision, ctx.access) };
  } };
  h.files = { read: async () => { h.fileCalls++; return { mediaType: 'text/plain', bytes: Buffer.from(h.text) }; } };
  h.parser = { parse: (d, f) => {
    if (h.parseError) throw h.parseError;
    return [{ draftVersion: shared.AI_KNOWLEDGE_DRAFT_VERSION, documentId: d.documentId, documentVersion: d.documentVersion, chunkId: 'chunk-1', scope: clone(d.scope), aclRevision: d.aclRevision, locator: { kind: 'section', sectionId: 'section-1', paragraph: 1 }, text: Buffer.from(f.bytes).toString('utf8'), trust: 'untrusted_data' }];
  } };
  h.clock = { now: () => h.now };
  h.ports = { repository: h.repo, authorization: h.authorization, clock: h.clock, files: h.files, parser: h.parser };
  h.documents = new KnowledgeDocumentService(h.ports); h.publication = new KnowledgePublicationService(h.documents);
  return h;
}
async function parsed(h, ctx = context(), input = draft()) {
  await h.documents.create(ctx, input);
  return h.documents.parseDocument(ctx, { documentId: input.documentId, expectedRevision: 1, operationId: 'parse-1' });
}
async function published(h, ctx = context(), input = draft()) {
  const record = await parsed(h, ctx, input);
  record.document.indexing = 'indexed'; h.repo.seed(record);
  return h.publication.publish(ctx, { documentId: input.documentId, expectedRevision: record.revision, operationId: 'publish-1' });
}
function typecheck(emit = false) {
  const ts = require('typescript');
  const options = { strict: true, noEmit: !emit, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, experimentalDecorators: true, outDir: path.join(root, 'apps/api/dist/knowledge-isolated') };
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => path.join(dir, f));
  const program = ts.createProgram(files, options);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  assert.deepEqual(diagnostics, []);
  if (emit) assert.equal(program.emit().emitSkipped, false);
}
if (require.main === module) { typecheck(process.argv.includes('--build')); console.log('knowledge actual TypeScript: zero diagnostics'); }
function retrieval(f) {
  const { KnowledgeSourceService } = load('knowledge-source.service');
  const { KnowledgeRetrievalService } = load('knowledge-retrieval.service');
  f.bodyReads = 0; f.searchCalls = [];
  f.selection = { select: async ctx => {
    const grant = await f.authorization.authorize(ctx, { action: 'search', scope: ctx.scope });
    if (!grant) return null;
    const documents = [];
    for (const r of f.repo.heads.values()) {
      if (key(r.document.scope) !== key(ctx.scope) || !await f.authorization.authorize(ctx, { action: 'search', scope: ctx.scope, document: r.document })) continue;
      documents.push({ documentId: r.document.documentId, documentVersion: r.document.documentVersion, aclRevision: r.document.aclRevision });
    }
    return { grant, documents };
  } };
  f.search = { search: async input => {
    f.searchCalls.push(clone(input)); const result = [];
    for (const ref of input.documents) for (const c of f.repo.chunks.get(key(input.grant.scope, ref.documentId, ref.documentVersion)) ?? []) {
      if (c.aclRevision === ref.aclRevision && c.text.toLowerCase().includes(input.query.toLowerCase())) result.push(source(c));
    }
    return result.slice(0, input.limit);
  } };
  f.content = {
    chunk: async (_, ref) => { f.bodyReads++; return clone((f.repo.chunks.get(key(ref.scope, ref.documentId, ref.documentVersion)) ?? []).find(c => c.chunkId === ref.chunkId) ?? null); },
    downloadReference: async (_, d) => ({ attachmentId: d.attachmentId, documentVersion: d.documentVersion }),
    factReference: async (_, fact) => clone(fact),
  };
  f.sources = new KnowledgeSourceService(f.documents, f.content);
  f.retrieval = new KnowledgeRetrievalService(f.documents, f.sources, f.selection, f.search);
  return f;
}
function source(c) { return { kind: 'document', documentId: c.documentId, documentVersion: c.documentVersion, chunkId: c.chunkId, scope: clone(c.scope), aclRevision: c.aclRevision, locator: clone(c.locator) }; }
const query = overrides => ({ requestId: 'recall-1', query: 'Synthetic', limit: 5, ...overrides });
module.exports = { load, root, clone, key, scope, now, context, draft, harness, parsed, published, typecheck, attempts, shared, MemoryRepository, retrieval, source, query };
