"use strict";
/** Actual registry/AS sources compiled to package exports; original SQL, platform
 * management and audit are explicit external substitutes. No DB or AS listener. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path');
const { createRequire, registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
const signal = () => new AbortController().signal;
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, 'output/mcp-client-registry-verification-'));
  const packageRoot = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(packageRoot, 'package.json'), path.join(staged, 'package.json'));
  const typeRoots = [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')];
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: ['node'], typeRoots,
    rootDir: path.join(packageRoot, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => {
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    assert.equal(program.emit().emitSkipped, false);
  };
  check(ts.createProgram(['prisma-public-client-registry.ts', 'public-client-authorization.ts', 'oauth-token-endpoint.ts']
    .map(file => path.join(packageRoot, 'src', file)), options));
  const consumer = path.join(output, 'consumer.mts');
  fs.writeFileSync(consumer, [
    'export { createPrismaPublicClientRegistry, PublicClientRegistryError } from "@rental-os/mcp-server/prisma-public-client-registry";',
    'export { createPublicClientAuthorization } from "@rental-os/mcp-server/public-client-authorization";',
    'export { createOAuthTokenEndpoint } from "@rental-os/mcp-server/oauth-token-endpoint";',
    'import type { PrismaPublicClientRegistry, PublicClientRegistrationSave, OriginalPublicClientManagement } from "@rental-os/mcp-server/prisma-public-client-registry";',
    'import type { OAuthSqlTransaction } from "@rental-os/mcp-server/prisma-oauth-store";',
    'export const readIn = (registry: PrismaPublicClientRegistry, tx: OAuthSqlTransaction, signal: AbortSignal) => registry.readIn(tx, "client-a", signal);',
    'export const save = (registry: PrismaPublicClientRegistry, input: PublicClientRegistrationSave, signal: AbortSignal) => registry.save(input, signal);',
    'export const management = (value: OriginalPublicClientManagement) => value;',
  ].join('\n'));
  check(ts.createProgram([consumer], { ...options, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  const prefix = pathToFileURL(staged + path.sep).href;
  registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(prefix) && specifier === '@modelcontextprotocol/server') return { url: pathToFileURL(installed.resolve(specifier)).href, shortCircuit: true };
    return next(specifier, context);
  } });
  artifact = await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href);
  fs.writeFileSync(path.join(output, 'scope.json'), JSON.stringify({ strict: 'registry and actual OAuth dependency closure',
    publicConsumer: 'NodeNext declarations and emitted ESM through real package exports', external: 'SQL/management/audit substitutes; no DB, API, migration or business publication' }, null, 2));
  return artifact;
}
function fixture() {
  const f = { state: { clients: {}, operations: {} }, audits: [], calls: [], tail: Promise.resolve(), transactions: 0,
    actor: 'original-admin', deny: false, failAudit: false, loseCommit: false, cancelCommit: undefined, afterAudit: undefined, rawRows: undefined, replay: false };
  f.database = { async $transaction(callback, options) {
    assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
    const previous = f.tail; let release; f.tail = new Promise(resolve => { release = resolve; }); await previous;
    f.transactions++; const working = structuredClone(f.state), audit = [];
    const sql = (parts, values) => { assert.ok(Array.isArray(parts.raw)); const text = parts.join('?').replace(/\s+/g, ' ').trim(); f.calls.push({ text, values: structuredClone(values) }); return text; };
    const tx = {
      async $queryRaw(parts, ...values) {
        const text = sql(parts, values); assert.match(text, /FOR UPDATE$/);
        const row = text.includes('FROM mcp_oauth_public_client_operations') ? working.operations[values[0]] : working.clients[values[0]];
        const rows = row ? [structuredClone(row)] : []; return f.rawRows ? f.rawRows(rows, text) : rows;
      },
      async $executeRaw(parts, ...values) {
        const text = sql(parts, values);
        if (text.startsWith('UPDATE')) {
          const row = working.clients[values[2]]; if (!row || row.revision !== values[3]) return 0;
          row.revision = values[0]; row.recordJson = values[1]; return 1;
        }
        if (text.includes('INTO mcp_oauth_public_client_operations')) {
          if (working.operations[values[0]]) throw new Error('synthetic unique operation');
          assert.ok(working.clients[values[2]], 'synthetic client FK');
          working.operations[values[0]] = { actorId: values[1], clientId: values[2], payloadHash: values[3], resultJson: values[4] }; return 1;
        }
        if (working.clients[values[0]]) throw new Error('synthetic unique client');
        working.clients[values[0]] = { clientId: values[0], revision: values[1], recordJson: values[2] }; return 1;
      },
    };
    f.native = tx; f.pendingAudit = audit;
    try {
      const result = await callback(tx); if (f.replay) await callback(tx);
      f.state = working; f.audits.push(...audit); f.cancelCommit?.abort();
      if (f.loseCommit) throw new Error('synthetic private SQL commit detail'); return result;
    } finally { release(); }
  } };
  f.management = {
    async authorize(tx, request, signal) { assert.equal(tx, f.native); assert.ok(['save', 'read_receipt'].includes(request.action)); assert.equal(signal.aborted, false); return f.deny ? undefined : { actorId: f.actor }; },
    async audit(tx, receipt) { assert.equal(tx, f.native); if (f.failAudit) throw new Error('synthetic secret audit detail'); f.pendingAudit.push(structuredClone(receipt)); f.afterAudit?.(); },
  };
  return f;
}
const scopes = ['rental.catalog.read'];
const command = (key = 'original-save-a', expectedRevision = 0, changes = {}) => ({ operationKey: key, expectedRevision,
  registration: { clientId: 'client-a', enabled: true, expiresAt: Math.floor(Date.now() / 1000) + 600,
    redirectUris: ['http://127.0.0.1:49152/rental/callback'], scopes, ...changes } });
const unavailable = error => ['unavailable', 'unknown'].includes(error.kind) && !/secret|SQL|synthetic/.test(error.message);

test('public-client current SQL producer is consumed by official S256 precheck and retains disabled-client revocation', async () => {
  const api = await compiled(), f = fixture(), registry = api.createPrismaPublicClientRegistry(f.database, f.management);
  assert.equal(await registry.read('client-a', signal()), undefined);
  const saved = await registry.save(command(), signal()); assert.equal(saved.registration.revision, 1);
  const { startAuthorization } = installed('@modelcontextprotocol/client');
  const issuer = 'https://auth.example.invalid/', resource = 'https://mcp.example.invalid/mcp', authorizationEndpoint = issuer + 'authorize';
  const started = await startAuthorization(issuer, { metadata: { issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: issuer + 'token',
    response_types_supported: ['code'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'] },
    clientInformation: { client_id: 'client-a' }, redirectUrl: 'http://127.0.0.1:49153/rental/callback', resource, scope: scopes.join(' '), state: 'fixed-state' });
  const config = { authorizationEndpoint, resourceUrl: resource, allowedScopes: scopes, timeoutMs: 1000 };
  const precheck = api.createPublicClientAuthorization(config, registry);
  const checked = await precheck(new Request(started.authorizationUrl), signal()); assert.equal(checked.clientRevision, 1);
  assert.equal(checked.redirectUri, 'http://127.0.0.1:49153/rental/callback');
  const changed = new URL(started.authorizationUrl); changed.searchParams.set('actor', 'forged-admin');
  const before = f.transactions; await assert.rejects(() => precheck(new Request(changed), signal())); assert.equal(f.transactions, before);
  let visits = 0;
  const changing = api.createPublicClientAuthorization(config, { read: async (clientId, signal) => {
    const current = await registry.read(clientId, signal); if (++visits === 1) await registry.save(command('disable-client', 1, { enabled: false }), signal); return current;
  } });
  await assert.rejects(() => changing(new Request(started.authorizationUrl), signal()));
  assert.equal((await registry.read('client-a', signal())).enabled, false);
  const revoked = [];
  const token = api.createOAuthTokenEndpoint({ enabled: true, tokenEndpoint: issuer + 'token', revocationEndpoint: issuer + 'revoke', resourceUrl: resource,
    allowedOrigins: [], allowedScopes: scopes, timeoutMs: 1000, maxRequestBytes: 4096 }, registry, {
    exchangeCode: async () => { throw new Error('must not exchange'); }, refresh: async () => { throw new Error('must not refresh'); },
    revoke: async input => { revoked.push(input); },
  });
  const response = await token(new Request(issuer + 'revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'client-a', token: 'known-original-token' }) }));
  assert.equal(response.status, 200); assert.equal(await response.text(), ''); assert.equal(revoked.length, 1);
});

test('management CAS preserves original keys, owner binding and immutable historical receipts across two registries', async () => {
  const api = await compiled(), f = fixture(), first = api.createPrismaPublicClientRegistry(f.database, f.management), second = api.createPrismaPublicClientRegistry(f.database, f.management);
  const input = command(), results = await Promise.allSettled([first.save(input, signal()), second.save(command('other-save'), signal())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.kind, 'conflict');
  const actualKey = Object.keys(f.state.operations)[0], actualInput = actualKey === input.operationKey ? input : command(actualKey);
  // Capture the actual original timestamp, not a new input that might cross a second.
  actualInput.registration.expiresAt = JSON.parse(f.state.clients['client-a'].recordJson).expiresAt;
  const replay = await second.save(actualInput, signal()); assert.equal(replay.registration.revision, 1); assert.equal(f.audits.length, 1);
  const reordered = { registration: { scopes: replay.registration.scopes, redirectUris: replay.registration.redirectUris,
    expiresAt: replay.registration.expiresAt, enabled: true, clientId: 'client-a' }, expectedRevision: 0, operationKey: actualKey };
  assert.deepEqual(await first.save(reordered, signal()), replay);
  await assert.rejects(() => first.save({ ...actualInput, registration: { ...actualInput.registration, enabled: false } }, signal()), error => error.kind === 'conflict');
  await assert.rejects(() => first.save({ ...actualInput, registration: { ...actualInput.registration, clientId: 'client-b' } }, signal()), error => error.kind === 'conflict');
  await first.save(command('new-revision', 1, { enabled: false }), signal());
  assert.equal((await first.read('client-a', signal())).revision, 2);
  const observed = await second.operation('client-a', actualKey, signal()); assert.equal(observed.state, 'observed'); assert.equal(observed.result.registration.revision, 1);
  f.actor = 'another-original-admin'; await assert.rejects(() => second.operation('client-a', actualKey, signal()), error => error.kind === 'denied');
  await assert.rejects(() => second.save(actualInput, signal()), error => error.kind === 'conflict');
  assert.ok(f.calls.filter(call => call.text.startsWith('SELECT')).every(call => call.text.endsWith('FOR UPDATE')));
});

test('audit/revocation failures roll back; unknown commit and cancellation never replace the original operation', async () => {
  const api = await compiled(), f = fixture(), registry = api.createPrismaPublicClientRegistry(f.database, f.management);
  const withoutManagement = api.createPrismaPublicClientRegistry(f.database); const before = f.transactions;
  await assert.rejects(() => withoutManagement.save(command(), signal()), unavailable); assert.equal(f.transactions, before);
  f.deny = true; await assert.rejects(() => registry.save(command(), signal()), error => error.kind === 'denied'); assert.deepEqual(f.state.clients, {}); f.deny = false;
  f.failAudit = true; await assert.rejects(() => registry.save(command(), signal()), unavailable); assert.deepEqual(f.state.clients, {}); assert.equal(f.audits.length, 0); f.failAudit = false;
  f.afterAudit = () => { f.deny = true; }; await assert.rejects(() => registry.save(command(), signal()), error => error.kind === 'denied'); assert.deepEqual(f.state.clients, {});
  f.afterAudit = undefined; f.deny = false; f.loseCommit = true; const input = command(); const count = f.transactions;
  await assert.rejects(() => registry.save(input, signal()), error => error.kind === 'unknown'); assert.equal(f.transactions, count + 1); assert.equal(Object.keys(f.state.operations).length, 1);
  f.loseCommit = false; assert.equal((await registry.operation('client-a', input.operationKey, signal())).state, 'observed');
  assert.deepEqual(await registry.operation('client-a', 'missing-original-key', signal()), { state: 'not_observed', retryable: false });
  const controller = new AbortController(); f.cancelCommit = controller;
  await assert.rejects(() => registry.save(command('cancel-after-commit', 1, { enabled: false }), controller.signal), error => error.kind === 'unknown');
  assert.ok(f.state.operations['cancel-after-commit']); f.cancelCommit = undefined;
  f.replay = true; await assert.rejects(() => registry.read('client-a', signal()), unavailable);
});

test('closed client projections reject secrets, unsafe callbacks, corrupt indices and accessors without execution', async () => {
  const api = await compiled(), f = fixture(), registry = api.createPrismaPublicClientRegistry(f.database, f.management);
  for (const registration of [ { ...command().registration, client_secret: 'private-secret' },
    ...['http://localhost/callback', 'http://192.168.0.1/callback', 'https://example.invalid/callback?x=1', 'https://example.invalid/*'].map(uri => ({ ...command().registration, redirectUris: [uri] })),
    { ...command().registration, scopes: [...scopes, ...scopes] } ]) {
    const before = f.transactions; await assert.rejects(() => registry.save({ ...command(), registration }, signal()), error => error.kind === 'invalid'); assert.equal(f.transactions, before);
  }
  let getters = 0; const input = command(); Object.defineProperty(input.registration, 'clientId', { enumerable: true, get() { getters++; return 'client-a'; } });
  await assert.rejects(() => registry.save(input, signal()), error => error.kind === 'invalid'); assert.equal(getters, 0);
  await registry.save(command(), signal()); f.state.clients['client-a'].revision = 2; await assert.rejects(() => registry.read('client-a', signal()), unavailable); f.state.clients['client-a'].revision = 1;
  f.rawRows = rows => rows.map(row => { Object.defineProperty(row, 'recordJson', { enumerable: true, get() { getters++; return '{}'; } }); return row; });
  await assert.rejects(() => registry.read('client-a', signal()), unavailable); assert.equal(getters, 0); f.rawRows = undefined;
  const saved = JSON.parse(f.state.operations['original-save-a'].resultJson); saved.registration.enabled = false;
  f.state.operations['original-save-a'].resultJson = JSON.stringify(saved);
  await assert.rejects(() => registry.operation('client-a', 'original-save-a', signal()), unavailable);
  const text = fs.readFileSync(path.join(root, 'packages/mcp-server/mysql-oauth-schema.sql'), 'utf8');
  assert.match(text, /CREATE TABLE mcp_oauth_public_clients/); assert.match(text, /PRIMARY KEY \(operationKey\)/);
  assert.match(text, /mcp_oauth_public_client_operation_fk FOREIGN KEY \(clientId\)/);
  const registryDdl = text.slice(text.indexOf('CREATE TABLE mcp_oauth_public_clients')).split('-- Current grant/admission storage contract')[0];
  assert.equal((registryDdl.match(/ENGINE=InnoDB/g) || []).length, 2); assert.equal((registryDdl.match(/ON DELETE RESTRICT/g) || []).length, 1);
});
