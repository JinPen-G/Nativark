"use strict";
/** Admission CAS sources/ESM with explicit SQL and original-management substitutes.
 * No real management Guard, DB, migration, consent or business publication. */
const assert = require('node:assert/strict'), { test, after } = require('node:test');
const fs = require('node:fs'), path = require('node:path');
const { createRequire, registerHooks, isBuiltin } = require('node:module'), { pathToFileURL } = require('node:url');
const root = path.resolve(process.env.MCP_TEST_SOURCE_ROOT || path.join(__dirname, ".."));
const toolchainRoot = path.resolve(process.env.MCP_TEST_TOOLCHAIN_ROOT || root);
const dependencyDirectory = path.join(toolchainRoot, "node_modules");
const dependencyRequire = createRequire(path.join(dependencyDirectory, "typescript/package.json"));
// Resolve each third-party package from the chosen installation. A missing
// prerequisite cannot fall through to an ancestor or a private Harness checkout.
function resolveDependency(specifier) {
  if (isBuiltin(specifier)) return specifier;
  const packageName = specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
  const packageDirectory = path.join(dependencyDirectory, packageName);
  if (!fs.existsSync(path.join(packageDirectory, "package.json"))) {
    const error = new Error(`MCP test prerequisite ${packageName} is missing from ${dependencyDirectory}. Set MCP_TEST_TOOLCHAIN_ROOT to an existing installation containing this package.`);
    error.code = "MCP_TEST_PREREQUISITE";
    throw error;
  }
  const resolved = dependencyRequire.resolve(specifier);
  const relative = path.relative(fs.realpathSync(packageDirectory), fs.realpathSync(resolved));
  assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `MCP test dependency ${specifier} resolved outside its selected package`);
  return resolved;
}
function installed(specifier) { return dependencyRequire(resolveDependency(specifier)); }
installed.resolve = resolveDependency;
const ts = installed("typescript");
installed.resolve("@types/node/package.json");
installed.resolve("@modelcontextprotocol/server");
const temporaryRoot = path.join(root, "output/.tmp");
const owner = path.basename(process.argv[1] || "mcp-tests").replace(/[^A-Za-z0-9._-]/gu, "_");
const outputParent = path.resolve(process.env.MCP_TEST_OUTPUT_ROOT || path.join(temporaryRoot, `mcp-test-toolchain-${process.pid}`));
const outputDirectory = path.join(outputParent, `mcp-admission-cas-${owner}-${process.pid}`);
let ownsOutput = false, runtimeHooks;
function within(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function checkOutputPath() {
  assert.ok(within(temporaryRoot, outputParent), "MCP test output must stay in this worktree's output/.tmp");
  for (let current = outputDirectory; current !== root; current = path.dirname(current)) {
    assert.ok(within(root, current), "MCP test output escaped its worktree");
    if (fs.existsSync(current)) assert.equal(fs.lstatSync(current).isSymbolicLink(), false, "MCP test must not follow output links");
  }
}
function prepareOutput() {
  if (!ownsOutput) {
    checkOutputPath();
    fs.mkdirSync(outputParent, { recursive: true });
    fs.mkdirSync(outputDirectory);
    ownsOutput = true;
  }
  return outputDirectory;
}
function cleanupOutput() {
  if (!ownsOutput) return;
  checkOutputPath();
  assert.equal(fs.realpathSync(outputDirectory), outputDirectory, "MCP test output was redirected");
  const checkChildren = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false, "MCP test cleanup must not enter a link");
      if (entry.isDirectory()) checkChildren(path.join(directory, entry.name));
    }
  };
  checkChildren(outputDirectory);
  runtimeHooks?.deregister();
  fs.rmSync(outputDirectory, { recursive: true });
  assert.equal(fs.existsSync(outputDirectory), false, "MCP test output was not removed");
  ownsOutput = false;
  if (!process.env.MCP_TEST_OUTPUT_ROOT) {
    try { fs.rmdirSync(outputParent); }
    catch (error) { if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error; }
  }
}
// Register before compilation so failed and cancelled runs release their own output.
after(cleanupOutput);
process.once("exit", cleanupOutput);
for (const [name, status] of [["SIGINT", 130], ["SIGTERM", 143]]) process.once(name, () => {
  try { cleanupOutput(); } finally { process.exit(status); }
});
const signal = () => new AbortController().signal;
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = prepareOutput();
  const packageRoot = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(packageRoot, 'package.json'), path.join(staged, 'package.json'));
  const typeRoots = [path.join(dependencyDirectory, '@types')];
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: ['node'], typeRoots,
    rootDir: path.join(packageRoot, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => { const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    assert.equal(program.emit().emitSkipped, false); };
  check(ts.createProgram([path.join(packageRoot, 'src/prisma-oauth-admission-store.ts')], options));
  const consumer = path.join(output, 'consumer.mts');
  fs.writeFileSync(consumer, [
    'export { createPrismaOAuthAdmissionStore } from "@rental-os/mcp-server/prisma-oauth-admission-store";',
    'export { createPrismaOAuthGrantAuthority, captureOAuthAdmission } from "@rental-os/mcp-server/prisma-oauth-grant-authority";',
    'export { createPrismaOAuthStore } from "@rental-os/mcp-server/prisma-oauth-store";',
    'export { createPrismaPublicClientRegistry } from "@rental-os/mcp-server/prisma-public-client-registry";',
    'import type { PrismaOAuthAdmissionStore, OAuthAdmissionSave } from "@rental-os/mcp-server/prisma-oauth-admission-store";',
    'export const save = (store: PrismaOAuthAdmissionStore, input: OAuthAdmissionSave, signal: AbortSignal) => store.save(input, signal);',
  ].join('\n'));
  check(ts.createProgram([consumer], { ...options, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  artifact = await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href);
  fs.writeFileSync(path.join(output, 'scope.json'), JSON.stringify({ strict: 'admission/grant/OAuth dependency closure and formal NodeNext consumer',
    external: 'SQL/current management/audit and grant identity are explicit fixtures; no actual DB/management API/consent or business publication' }, null, 2));
  return artifact;
}
const resource = 'https://mcp.example.invalid/mcp', scopes = ['rental.catalog.read'];
const platformTarget = { kind: 'platform' }, workspaceTarget = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
function command(operationKey = 'original-platform-save', expectedRevision = 0, target = platformTarget, changes = {}) {
  return { operationKey, expectedRevision, target: { ...target }, policy: { enabled: true, expiresAt: Math.floor(Date.now() / 1000) + 600,
    clientIds: ['client-a'], scopes, ...(target.kind === 'platform' ? { clientType: 'public' } : {}), ...changes } };
}
function fixture(api) {
  const f = { state: { platforms: {}, workspaces: {}, operations: {} }, tail: Promise.resolve(), calls: [], transactions: 0,
    manager: { actorId: 'platform-admin', kind: 'platform' }, audit: [], failAudit: false, loseCommit: false, cancelCommit: undefined, afterAudit: undefined, queryHook: undefined, rekeyManager: false };
  f.database = { async $transaction(callback, options) {
    assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
    const previous = f.tail; let release; f.tail = new Promise(resolve => { release = resolve; }); await previous;
    f.transactions++; const working = structuredClone(f.state), audit = [];
    const text = (parts, values) => { const sql = parts.join('?').replace(/\s+/g, ' ').trim(); f.calls.push({ sql, values: structuredClone(values) }); return sql; };
    const tx = {
      async $queryRaw(parts, ...values) {
        const sql = text(parts, values); assert.match(sql, /FOR UPDATE$/);
        const table = sql.includes('FROM mcp_oauth_admission_operations') ? 'operations' : sql.includes('FROM mcp_oauth_workspace_admissions') ? 'workspaces' : 'platforms';
        const key = table === 'workspaces' ? values.join('|') : values[0];
        const rows = working[table][key] ? [structuredClone(working[table][key])] : [];
        return f.queryHook ? f.queryHook(rows, table) : rows;
      },
      async $executeRaw(parts, ...values) {
        const sql = text(parts, values);
        if (sql.includes('INTO mcp_oauth_admission_operations')) {
          if (working.operations[values[0]]) throw new Error('synthetic unique operation');
          assert.ok(working.platforms[values[3]], 'synthetic platform FK');
          if (values[2] === 'workspace') assert.ok(working.workspaces[[values[3], values[4], values[5]].join('|')], 'synthetic workspace FK');
          working.operations[values[0]] = { actorId: values[1], targetKind: values[2], resource: values[3], tenantId: values[4], workspaceId: values[5], payloadHash: values[6], resultJson: values[7] }; return 1;
        }
        const table = sql.includes('mcp_oauth_workspace_admissions') ? 'workspaces' : 'platforms';
        if (sql.startsWith('INSERT')) {
          const key = table === 'platforms' ? values[0] : values.slice(0, 3).join('|'); if (working[table][key]) throw new Error('synthetic unique policy');
          if (table === 'platforms') working[table][key] = { resource: values[0], revision: values[1], recordJson: values[2] };
          else { assert.ok(working.platforms[values[0]], 'synthetic platform FK'); working[table][key] = { resource: values[0], tenantId: values[1], workspaceId: values[2], revision: values[3], recordJson: values[4] }; }
          return 1;
        }
        const key = table === 'platforms' ? values[2] : values.slice(2, 5).join('|'), row = working[table][key], expected = values.at(-1);
        if (!row || row.revision !== expected) return 0; row.revision = values[0]; row.recordJson = values[1]; return 1;
      },
    };
    f.native = tx; f.pendingAudit = audit;
    try { const result = await callback(tx); f.state = working; f.audit.push(...audit); f.cancelCommit?.abort(); if (f.loseCommit) throw new Error('synthetic secret commit detail'); return result; }
    finally { release(); }
  } };
  f.management = {
    async authorize(tx) { assert.equal(tx, f.native); if (!f.manager) return undefined;
      return f.rekeyManager ? { kind: f.manager.kind, ...Object.fromEntries(Object.entries(f.manager).filter(([key]) => key !== 'kind')) } : structuredClone(f.manager); },
    async audit(tx, value) { assert.equal(tx, f.native); if (f.failAudit) throw new Error('synthetic secret audit failure'); f.pendingAudit.push(value); f.afterAudit?.(); },
  };
  f.registry = { readIn: async (tx, clientId) => { assert.equal(tx, f.native); return clientId === 'client-a' ? { clientId } : undefined; } };
  f.store = api.createPrismaOAuthAdmissionStore({ resourceUrl: resource, allowedScopes: scopes }, f.database, f.registry, f.management);
  f.seed = async () => { await f.store.save(command(), signal()); f.manager = { actorId: 'workspace-admin', ...workspaceTarget }; await f.store.save(command('original-workspace-save', 0, workspaceTarget), signal()); };
  return f;
}
const safeFailure = error => ['unknown', 'unavailable'].includes(error.kind) && !/secret|synthetic/.test(error.message);

test('admission CAS writes are consumed by the same capture validator and current grant reader', async () => {
  const api = await compiled(), f = fixture(api); await f.seed();
  const current = await f.store.read(workspaceTarget, signal()); assert.equal(current.state, 'configured'); assert.equal(current.policy.revision, 1);
  const grant = { id: 'grant-a', subject: 'issuer-subject', revision: 1, enabled: true, expiresAt: Math.floor(Date.now() / 1000) + 300,
    clientId: 'client-a', resource, scopes, userId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a',
    clientRevision: 1, platformRevision: 1, workspaceRevision: 1, consentRef: 'original-consent', consentRevision: 1 };
  f.queryHook = (rows, table) => rows;
  const originalDatabase = f.database.$transaction;
  // Extend only the explicit SQL fixture's grant SELECT, not production authority.
  f.database.$transaction = async (callback, options) => originalDatabase.call(f.database, async tx => {
    const originalQuery = tx.$queryRaw.bind(tx);
    tx.$queryRaw = async (parts, ...values) => parts.join('?').includes('FROM mcp_oauth_grants')
      ? [{ id: grant.id, subject: grant.subject, userId: grant.userId, clientId: grant.clientId, resource, tenantId: grant.tenantId, workspaceId: grant.workspaceId, recordJson: JSON.stringify(grant) }]
      : originalQuery(parts, ...values);
    return callback(tx);
  }, options);
  const grantStore = api.createPrismaOAuthStore(f.database, { record: async () => { throw new Error('read must not issue'); } });
  const authority = api.createPrismaOAuthGrantAuthority({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, grantStore,
    { readIn: async () => ({ clientId: 'client-a', revision: 1, enabled: true, expiresAt: grant.expiresAt, scopes, redirectUris: ['https://client.example.invalid/callback'] }) },
    { assertCurrent: async (tx, current) => Boolean(await current()) });
  assert.equal((await grantStore.transaction(tx => authority.access.current(grant.id, tx, signal()), signal())).id, grant.id);
  await f.store.save(command('disable-workspace', 1, workspaceTarget, { enabled: false }), signal());
  assert.equal(await grantStore.transaction(tx => authority.access.current(grant.id, tx, signal()), signal()), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(api.captureOAuthAdmission(current.policy, true))), JSON.parse(JSON.stringify(current.policy)), 'save/current reader share full projection constraints');
});

test('platform and exact workspace manager scopes are enforced; unknown fields and getter claims cannot authorize', async () => {
  const api = await compiled(), f = fixture(api);
  f.manager = { actorId: 'workspace-admin', ...workspaceTarget };
  await assert.rejects(() => f.store.save(command(), signal()), error => error.kind === 'denied'); assert.deepEqual(f.state.platforms, {});
  f.manager = { actorId: 'platform-admin', kind: 'platform' }; await f.store.save(command(), signal());
  await assert.rejects(() => f.store.save(command('not-tenant-authority', 0, workspaceTarget), signal()), error => error.kind === 'denied');
  f.manager = { actorId: 'workspace-admin', kind: 'workspace', tenantId: 'other-tenant', workspaceId: 'workspace-a' };
  await assert.rejects(() => f.store.read(workspaceTarget, signal()), error => error.kind === 'denied');
  let getters = 0; const request = command(); Object.defineProperty(request.target, 'kind', { enumerable: true, get() { getters++; return 'platform'; } });
  await assert.rejects(() => f.store.save(request, signal()), error => error.kind === 'invalid'); assert.equal(getters, 0);
  f.manager = { actorId: 'platform-admin', kind: 'platform' };
  await assert.rejects(() => f.store.save({ ...command('forged-fields'), actorId: 'forged' }, signal()), error => error.kind === 'invalid');
  await assert.rejects(() => f.store.save(command('expanded', 1, platformTarget, { scopes: ['rental.order.commit'] }), signal()), error => error.kind === 'invalid');
});

test('same original key and normalized field order return one receipt; concurrent CAS and changed input stay distinct', async () => {
  const api = await compiled(), f = fixture(api), input = command();
  const other = api.createPrismaOAuthAdmissionStore({ resourceUrl: resource, allowedScopes: scopes }, f.database, f.registry, f.management);
  const outcomes = await Promise.allSettled([f.store.save(input, signal()), other.save({ ...input, operationKey: 'another-operation' }, signal())]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1); assert.equal(outcomes.find(value => value.status === 'rejected').reason.kind, 'conflict');
  const originalKey = Object.keys(f.state.operations)[0], originalInput = { ...input, operationKey: originalKey };
  f.rekeyManager = true; assert.equal((await other.save(originalInput, signal())).policy.revision, 1); assert.equal(f.audit.length, 1);
  await assert.rejects(() => f.store.save({ ...originalInput, policy: { ...input.policy, enabled: false } }, signal()), error => error.kind === 'conflict');
  await f.store.save(command('revision-two', 1, platformTarget, { enabled: false }), signal());
  const observed = await other.operation(platformTarget, originalKey, signal()); assert.equal(observed.result.policy.revision, 1);
  assert.equal((await other.read(platformTarget, signal())).policy.revision, 2);
  f.manager = { actorId: 'other-admin', kind: 'platform' }; await assert.rejects(() => other.operation(platformTarget, originalKey, signal()), error => error.kind === 'denied');
});

test('unknown commit, cancellation and audit/scope failures preserve original-key evidence without automatic retry', async () => {
  const api = await compiled(), f = fixture(api);
  assert.throws(() => api.createPrismaOAuthAdmissionStore({ resourceUrl: resource, allowedScopes: scopes }, f.database, f.registry), safeFailure);
  f.failAudit = true; await assert.rejects(() => f.store.save(command(), signal()), safeFailure); assert.deepEqual(f.state.platforms, {}); assert.equal(f.audit.length, 0); f.failAudit = false;
  f.afterAudit = () => { f.manager = undefined; }; await assert.rejects(() => f.store.save(command(), signal()), error => error.kind === 'denied'); assert.deepEqual(f.state.platforms, {}); f.afterAudit = undefined;
  f.manager = { actorId: 'platform-admin', kind: 'platform' }; f.loseCommit = true; const before = f.transactions;
  await assert.rejects(() => f.store.save(command(), signal()), error => error.kind === 'unknown'); assert.equal(f.transactions, before + 1); assert.ok(f.state.operations['original-platform-save']);
  f.loseCommit = false; assert.equal((await f.store.operation(platformTarget, 'original-platform-save', signal())).state, 'observed');
  assert.deepEqual(await f.store.operation(platformTarget, 'missing-original-key', signal()), { state: 'not_observed', retryable: false });
  const controller = new AbortController(); f.cancelCommit = controller;
  await assert.rejects(() => f.store.save(command('cancelled-commit', 1, platformTarget, { enabled: false }), controller.signal), error => error.kind === 'unknown'); assert.ok(f.state.operations['cancelled-commit']);
  f.cancelCommit = undefined;
  const saved = JSON.parse(f.state.operations['original-platform-save'].resultJson); saved.policy.enabled = false; f.state.operations['original-platform-save'].resultJson = JSON.stringify(saved);
  await assert.rejects(() => f.store.operation(platformTarget, 'original-platform-save', signal()), safeFailure);
  const corrupt = fixture(api); await corrupt.seed();
  const workspaceRow = corrupt.state.workspaces[[resource, 'tenant-a', 'workspace-a'].join('|')];
  workspaceRow.recordJson = JSON.stringify({ ...JSON.parse(workspaceRow.recordJson), tenantId: 'foreign-tenant' });
  await assert.rejects(() => corrupt.database.$transaction(tx => corrupt.store.readIn(tx, workspaceTarget, signal()), { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 }), safeFailure);
  let getters = 0;
  const noAccessorManager = api.createPrismaOAuthAdmissionStore({ resourceUrl: resource, allowedScopes: scopes }, corrupt.database, corrupt.registry, {
    authorize: async () => ({ actorId: 'platform-admin', get kind() { getters++; return 'platform'; } }), audit: corrupt.management.audit,
  });
  await assert.rejects(() => noAccessorManager.save(command('accessor-authority'), signal()), safeFailure); assert.equal(getters, 0);
  const ddl = fs.readFileSync(path.join(root, 'packages/mcp-server/mysql-oauth-schema.sql'), 'utf8').split('-- Admission management original-operation receipts')[1].split('-- Completed original Web consent')[0];
  assert.equal((ddl.match(/ENGINE=InnoDB/g) || []).length, 1); assert.equal((ddl.match(/ON DELETE RESTRICT/g) || []).length, 2);
});
