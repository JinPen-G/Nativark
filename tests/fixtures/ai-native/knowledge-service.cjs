'use strict';
// Original mixed-host fixtures require an explicitly prepared independent Rental
// workspace. Public ACL consumers use knowledge-public.cjs and the public factory.
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
assert.ok(process.env.AI_NATIVE_TEST_SOURCE_ROOT,
  'Knowledge compatibility tests require AI_NATIVE_TEST_SOURCE_ROOT from prepare:rental-workspace --profile full --fresh-ai --with-tests (or a fixed historical AI workspace)');
const root = fs.realpathSync(path.resolve(process.env.AI_NATIVE_TEST_SOURCE_ROOT));
const { createControllerSourceLoader, checkedPath } = require('../../../scripts/controller-sources.cjs');
const receipt = JSON.parse(fs.readFileSync(checkedPath(root, 'development.workspace.json'), 'utf8'));
assert.equal(receipt.format, 'nativark-core-development-source-2');
assert.equal(receipt.profile, 'full'); assert.equal(receipt.mode, 'development');
assert.equal(receipt.host, 'rental'); assert.equal(receipt.ai, true);
assert.equal(receipt.verification?.suite, 'rental-original');
for (const source of [receipt.platform?.source, receipt.core?.source]) {
  assert.match(source?.commit ?? '', /^[a-f0-9]{40}$/u);
  assert.ok(source?.repository, 'Prepared test sources need their original repository identity');
}
assert.notEqual(receipt.platform.source.repository.toLowerCase(), receipt.core.source.repository.toLowerCase());
for (const [directory, name] of [['ai-native-server', '@rental-os/ai-native-server'], ['shared', '@rental-os/shared']]) {
  const manifest = JSON.parse(fs.readFileSync(checkedPath(root, `packages/${directory}/package.json`), 'utf8'));
  assert.equal(manifest.name, name); assert.equal(manifest.version, '0.1.0', 'Mixed fixtures require the independent compatibility package');
}
const dependencyDirectory = path.join(path.resolve(process.env.AI_NATIVE_TEST_TOOLCHAIN_ROOT || root), 'node_modules');
const loader = createControllerSourceLoader(root, dependencyDirectory);
const from = path.join(root, 'package.json');
const shared = loader.load(loader.resolveSource(from, '@rental-os/shared', true));
const knowledgeEntry = name => loader.resolveSource(from, `@rental-os/ai-native-server/runtime/knowledge/${name}`, true);
const dir = path.dirname(knowledgeEntry('knowledge.module'));
const load = name => loader.load(knowledgeEntry(name));
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

// The original workspace lifecycle now deletes through its real relational
// repository and source-retention participant. Only SQL execution is finite.
function retainedRepository(h) {
  const { dbFactory } = require('./knowledge-persistent-content.cjs');
  const { createTaskInputStore } = require('./task-input-store.cjs');
  const { PrismaKnowledgeRepository } = load('prisma-knowledge.repository');
  const { createPrismaKnowledgeRetention } = load('prisma-knowledge-retention');
  const { aiPersistenceScopeColumns } = loader.load(loader.resolveSource(from,
    '@rental-os/ai-native-server/runtime/persistence-scope', true));
  const source = createTaskInputStore({
    aiScope: [{ id: 'knowledge-scope', ...aiPersistenceScopeColumns(scope) }],
    aiTask: [], aiStep: [], aiRun: [], aiApprovalConsumption: [], aiTaskExecutionCharge: [],
    aiBudgetReservation: [], aiInvocationAdmission: [], aiUsageReservation: [], aiGatewayInvocation: [], aiTaskActionInput: [],
  });
  const db = dbFactory();
  for (const name of Object.keys(source.state)) {
    if (db[name] === undefined) db[name] = source.db[name];
  }
  db.$queryRaw = (...args) => source.db.$queryRaw(...args);
  db.aiKnowledgeChunk.deleteMany = async ({ where }) => {
    let count = 0;
    for (const [id, chunk] of db.state.chunks) {
      const version = db.state.versions.get(chunk.versionId), document = db.state.documents.get(version?.documentId);
      if (version?.documentId !== where.version.documentId || !document
        || !Object.entries(where.version.document).every(([key, value]) => document[key] === value)) continue;
      db.state.chunks.delete(id); count++;
    }
    return { count };
  };
  db.aiDataErasure.updateMany = async ({ where, data }) => {
    const row = db.state.erasures.get(where.id);
    if (!row || !Object.entries(where).every(([key, value]) => row[key] === value)) return { count: 0 };
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value
      ? row[key] + value.increment : clone(value);
    return { count: 1 };
  };
  const transaction = db.$transaction, queue = { tail: Promise.resolve() };
  db.$transaction = work => {
    const result = queue.tail.then(() => transaction(work));
    queue.tail = result.catch(() => {});
    return result;
  };
  const repository = new PrismaKnowledgeRepository(db, () => new Date(h.now));
  h.db = db; h.retentionSource = source;
  h.retention = createPrismaKnowledgeRetention(db, () => new Date(h.now));
  return {
    commits: 0,
    read: repository.read.bind(repository), operation: repository.operation.bind(repository),
    async commit(input) { const result = await repository.commit(input); if (result === 'committed') this.commits++; return result; },
    get heads() { return new Map([...db.state.documents.values()].map(row => [key(row.state.document.scope, row.id), clone(row.state)])); },
    get versions() { return db.state.versions; },
    get receipts() { return db.state.operations; },
    get chunks() {
      const result = new Map();
      for (const row of db.state.chunks.values()) {
        const chunk = clone(row.state.chunk), id = key(chunk.scope, chunk.documentId, chunk.documentVersion);
        if (!result.has(id)) result.set(id, []);
        result.get(id).push(chunk);
      }
      return result;
    },
    seed(record) {
      const row = db.state.documents.get(record.document.documentId);
      assert.ok(row); assert.equal(row.tenantId, record.document.scope.tenantId); assert.equal(row.workspaceId, record.document.scope.workspaceId);
      Object.assign(row, { state: clone(record), revision: record.revision, status: record.document.publication, title: record.document.title });
    },
  };
}
function harness() {
  const { KnowledgeDocumentService } = load('knowledge-document.service');
  const { KnowledgePublicationService } = load('knowledge-publication.service');
  const { actor } = load('knowledge-validation');
  const h = { now, denied: false, authCalls: [], policyRevision: 1, rule: () => true, fileCalls: 0, text: 'Synthetic paragraph.', parseError: null };
  h.repo = retainedRepository(h);
  h.authorization = { authorize: async (ctx, request) => {
    h.authCalls.push(clone(request));
    if (h.denied || !h.rule(ctx, request) || ctx.authorizedAt !== new Date(now).toISOString()) return null;
    return { scope: clone(ctx.scope), actor: actor(ctx), audience: ctx.audience, accessKey: key(actor(ctx), ctx.audience, h.policyRevision, ctx.access) };
  } };
  const attachments = new Map(['attachment-1', 'file-v2', 'file-v3'].map(id => [id,
    { documentId: 'doc-1', tenantId: scope.tenantId, workspaceId: scope.workspaceId }]));
  h.files = {
    read: async () => { h.fileCalls++; return { mediaType: 'text/plain', bytes: Buffer.from(h.text) }; },
    assertBound: async (ctx, binding) => {
      const attachment = attachments.get(binding.attachmentId);
      assert.ok(attachment); assert.equal(binding.documentId, attachment.documentId);
      assert.equal(ctx.scope.tenantId, attachment.tenantId); assert.equal(ctx.scope.workspaceId, attachment.workspaceId);
      assert.equal(binding.workspaceId, attachment.workspaceId);
    },
  };
  h.parser = { parse: (d, f) => {
    if (h.parseError) throw h.parseError;
    return [{ draftVersion: shared.AI_KNOWLEDGE_DRAFT_VERSION, documentId: d.documentId, documentVersion: d.documentVersion, chunkId: 'chunk-1', scope: clone(d.scope), aclRevision: d.aclRevision, locator: { kind: 'section', sectionId: 'section-1', paragraph: 1 }, text: Buffer.from(f.bytes).toString('utf8'), trust: 'untrusted_data' }];
  } };
  h.clock = { now: () => h.now };
  h.ports = { repository: h.repo, authorization: h.authorization, clock: h.clock, files: h.files, parser: h.parser };
  h.documents = new KnowledgeDocumentService(h.ports, h.retention); h.publication = new KnowledgePublicationService(h.documents);
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
  const ts = loader.requireDependency('typescript');
  assert.ok(process.env.AI_NATIVE_TEST_PRISMA_TYPES && process.env.AI_NATIVE_TEST_SCHEMA,
    'Knowledge type checks require the selected workspace Prisma declaration and schema');
  const clientTypes = checkedPath(root, process.env.AI_NATIVE_TEST_PRISMA_TYPES);
  const schema = checkedPath(root, process.env.AI_NATIVE_TEST_SCHEMA);
  assert.deepEqual(fs.readFileSync(checkedPath(root, path.join(path.dirname(clientTypes), 'schema.prisma'))), fs.readFileSync(schema));
  const options = { strict: true, noEmit: !emit, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, experimentalDecorators: true, outDir: path.join(root, 'output/.tmp/knowledge-types'), typeRoots: [path.join(dependencyDirectory, '@types')] };
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => path.join(dir, f));
  const host = ts.createCompilerHost(options), outputs = new Map();
  host.resolveModuleNames = (names, containingFile) => names.map(name => {
    if (name === '@prisma/client') return { resolvedFileName: clientTypes, extension: ts.Extension.Dts };
    if (name.startsWith('@rental-os/')) return { resolvedFileName: loader.resolveSource(containingFile, name), extension: ts.Extension.Ts };
    return ts.resolveModuleName(name, containingFile, options, host).resolvedModule
      ?? ts.resolveModuleName(name, path.join(dependencyDirectory, '__knowledge_types__.ts'), options, host).resolvedModule;
  });
  // Optional emit is collected in memory; no shared dist or generated Client is overwritten.
  host.writeFile = (file, text) => outputs.set(file, text);
  const program = ts.createProgram(files, options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  assert.deepEqual(diagnostics, []);
  if (emit) assert.equal(program.emit().emitSkipped, false);
  return outputs;
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
      if (c.text.toLowerCase().includes(input.query.toLowerCase())) result.push(source({ ...c, aclRevision: ref.aclRevision }));
    }
    return result.slice(0, input.limit);
  } };
  f.content = {
    chunk: async (_, ref) => {
      f.bodyReads++;
      const chunk = (f.repo.chunks.get(key(ref.scope, ref.documentId, ref.documentVersion)) ?? []).find(c => c.chunkId === ref.chunkId);
      const record = await f.repo.read(ref.scope, ref.documentId);
      return chunk && record?.document.documentVersion === ref.documentVersion ? clone({ ...chunk, aclRevision: record.document.aclRevision }) : null;
    },
    downloadReference: async (_, d) => ({ attachmentId: d.attachmentId, documentVersion: d.documentVersion }),
    factReference: async (_, fact) => clone(fact),
  };
  f.sources = new KnowledgeSourceService(f.documents, f.content);
  f.retrieval = new KnowledgeRetrievalService(f.documents, f.sources, f.selection, f.search);
  return f;
}
function source(c) { return { kind: 'document', documentId: c.documentId, documentVersion: c.documentVersion, chunkId: c.chunkId, scope: clone(c.scope), aclRevision: c.aclRevision, locator: clone(c.locator) }; }
const query = overrides => ({ requestId: 'recall-1', query: 'Synthetic', limit: 5, ...overrides });
function memoryHarness(f = harness()) {
  const { StructuredMemoryService } = load('structured-memory.service');
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
  f.memoryPorts = { repository: f.memoryRepository, authorization: f.authorization, clock: f.clock, confirmations: { read: async (_, id) => { f.confirmationReads++; return clone(f.confirmations.get(id) ?? null); } } };
  f.memory = new StructuredMemoryService(f.memoryPorts);
  f.confirm = (memory, overrides = {}) => {
    const record = { id: 'confirm-1', memoryId: memory.memoryId, revision: memory.revision, aclRevision: memory.aclRevision, owner: clone(memory.owner), scope: clone(memory.scope), audience: 'operator', preference: clone(memory.preference), memoryExpiresAt: memory.expiresAt, status: 'confirmed', issuedAt: new Date(f.now).toISOString(), expiresAt: memory.expiresAt, ...overrides };
    f.confirmations.set(record.id, record); return record;
  };
  return f;
}
const memoryProposal = overrides => ({ memoryId: 'memory-1', operationId: 'propose-1', expiresAt: '2026-10-04T00:00:00Z', preference: { kind: 'locale', value: 'zh-CN' }, ...overrides });
const memoryChange = (operation, expectedRevision, extra = {}) => ({ draftVersion: shared.AI_KNOWLEDGE_DRAFT_VERSION, memoryId: 'memory-1', expectedRevision, operation, ...extra });
module.exports = { load, root, clone, key, scope, now, context, draft, harness, parsed, published, typecheck, attempts, shared, MemoryRepository, retrieval, source, query, memoryHarness, memoryProposal, memoryChange };
