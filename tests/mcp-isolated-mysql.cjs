"use strict";
/** Opt-in real MySQL DDL/transaction smoke. Uses a new datadir and a supervised
 * local process, never .env, the installed service, source dumps or Prisma output.
 * --native-stores additionally executes compiled original TS stores with a native
 * prepared-SQL test driver, NOT PrismaClient or production identity/goal. Retains
 * this run's data/evidence; only stops its own processes. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const { createOwnedDatabase } = require('./helpers/e2e-database-ownership.cjs');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output');
const basedir = 'C:/Program Files/MySQL/MySQL Server 8.4';
const mysqld = path.join(basedir, 'bin/mysqld.exe'), mysql = path.join(basedir, 'bin/mysql.exe');
const netstat = 'C:/Windows/System32/netstat.exe', powershell = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const psLiteral = value => "'" + value.replaceAll("'", "''") + "'";
function junctionCommand(command) {
  const encoded = Buffer.from("$ErrorActionPreference='Stop'; " + command, 'utf16le').toString('base64');
  execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    // This is owned test-environment setup/teardown, not a business-read timeout.
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
}
function createAsciiAlias(directory) {
  const base = path.join(require('node:os').homedir(), 'AppData/Local/Temp');
  assert.ok(/^[\x20-\x7e]+$/.test(base) && fs.statSync(base).isDirectory(), 'An existing ASCII temporary directory is required');
  const alias = path.join(base, 'rental_os_mcp_' + randomBytes(10).toString('hex'));
  assert.doesNotMatch(alias + directory, /[&|<>^%!\r\n]/);
  try { fs.lstatSync(alias); throw new Error('Refusing an existing alias'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Only the temporary junction is outside the worktree. Its physical data target
  // is this newly-owned run, verified before any native process starts.
  junctionCommand('New-Item -ItemType Junction -Path ' + psLiteral(alias) + ' -Target ' + psLiteral(directory) + ' | Out-Null');
  assert.ok(fs.lstatSync(alias).isSymbolicLink());
  assert.equal(normalized(fs.realpathSync(alias)), normalized(directory));
  return alias;
}
function listeningOn(port) {
  let text;
  try { text = execFileSync(netstat, ['-ano', '-p', 'tcp'], { windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 1048576, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (error) { throw new Error('Cannot verify local test-port ownership: ' + String(error.code)); }
  // Only this candidate port leaves memory; never emit unrelated host connections.
  const rows = [];
  for (const match of text.matchAll(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/gm)) {
    if (match[1].endsWith(':' + port)) rows.push({ address: match[1], pid: Number(match[2]) });
  }
  return rows;
}
const normalized = value => path.resolve(value).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
const hash = value => createHash('sha256').update(value).digest('hex');
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function ownedRun(value) {
  const directory = fs.realpathSync(value), relative = path.relative(fs.realpathSync(output), directory);
  assert.ok(/^mcp-isolated-mysql-[a-zA-Z0-9_-]+$/.test(relative), 'Expected this run under worktree output');
  assert.equal(normalized(directory), normalized(path.join(output, relative)), 'No redirected test datadir');
  return directory;
}
function serverArgs(directory, port) {
  return ['--no-defaults', '--no-monitor', '--standalone', '--console', '--basedir=' + basedir, '--datadir=' + path.join(directory, 'data'),
    '--innodb-data-home-dir=' + path.join(directory, 'data'),
    '--init-file=' + path.join(directory, 'bootstrap.sql'),
    '--port=' + port, '--bind-address=127.0.0.1', '--mysqlx=OFF', '--skip-name-resolve', '--skip-log-bin',
    '--local-infile=OFF', '--secure-file-priv=' + path.join(directory, 'files'), '--tmpdir=' + path.join(directory, 'tmp'),
    '--pid-file=' + path.join(directory, 'server.pid'), '--log-error=' + path.join(directory, 'server.log'),
    '--innodb-buffer-pool-size=32M', '--innodb-redo-log-capacity=64M', '--max-connections=16'];
}

async function compiledStores(directory) {
  const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
  // Reuse only an explicitly selected, fixed artifact in this worktree. Every
  // original source hash and the real package manifest must still match. This
  // does not claim a fresh type check or copy another tree's generated client.
  if (process.env.MCP_VERIFIED_STORE_ARTIFACT) {
    const artifact = fs.realpathSync(process.env.MCP_VERIFIED_STORE_ARTIFACT);
    const relative = path.relative(fs.realpathSync(output), artifact);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    const previous = JSON.parse(fs.readFileSync(path.join(artifact, 'scope.json'), 'utf8'));
    assert.ok(Object.keys(previous.sourceHashes).length >= 14);
    for (const [file, expected] of Object.entries(previous.sourceHashes)) {
      const source = path.resolve(root, file), within = path.relative(root, source);
      assert.ok(within && !within.startsWith('..') && !path.isAbsolute(within));
      assert.equal(hash(fs.readFileSync(source)), expected, file);
    }
    assert.deepEqual(fs.readFileSync(path.join(artifact, 'node_modules/@rental-os/mcp-server/package.json')),
      fs.readFileSync(path.join(root, 'packages/mcp-server/package.json')));
    const build = path.join(directory, 'store-build'); fs.mkdirSync(build, { recursive: true });
    writeJson(path.join(build, 'scope.json'), { ...previous, verifiedReuse: artifact,
      currentSourceHashesMatched: true, freshMcpTypecheck: false });
    return import(pathToFileURL(path.join(artifact, 'consumer-build/consumer.mjs')).href);
  }
  const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
  const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
  const source = path.join(root, 'packages/mcp-server'), build = path.join(directory, 'store-build');
  const staged = path.join(build, 'node_modules/@rental-os/mcp-server'); fs.mkdirSync(staged, { recursive: true });
  fs.copyFileSync(path.join(source, 'package.json'), path.join(staged, 'package.json'));
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'], typeRoots: [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')],
    rootDir: path.join(source, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => {
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    const result = program.emit(); assert.equal(result.emitSkipped, false); assert.equal(result.diagnostics.length, 0);
  };
  const entries = ['prisma-oauth-store.ts', 'prisma-mcp-read-budget.ts', 'prisma-mcp-read-accounting.ts', 'prisma-mcp-read-bindings.ts'];
  const program = ts.createProgram(entries.map(name => path.join(source, 'src', name)), options); check(program);
  const consumer = path.join(build, 'consumer.mts');
  fs.writeFileSync(consumer, [
    'export { createPrismaOAuthStore } from "@rental-os/mcp-server/prisma-oauth-store";',
    'export { createPrismaMcpReadBudget } from "@rental-os/mcp-server/prisma-mcp-read-budget";',
    'export { OriginalMcpReadBudgetError, captureMcpReadInput } from "@rental-os/mcp-server/persistent-read-accounting";',
    'export { createPrismaMcpReadAccounting } from "@rental-os/mcp-server/prisma-mcp-read-accounting";',
    'export { createPrismaMcpReadBindings } from "@rental-os/mcp-server/prisma-mcp-read-bindings";',
    'export { createPersistentOAuthTokenService, createPersistentOAuthResourceVerifier, oauthCredentialDigest } from "@rental-os/mcp-server/persistent-oauth-tokens";',
  ].join('\n'));
  check(ts.createProgram([consumer], { ...options, rootDir: build, outDir: path.join(build, 'consumer-build') }));
  const hashes = {};
  for (const file of program.getSourceFiles()) {
    const relative = path.relative(options.rootDir, file.fileName);
    if (!file.isDeclarationFile && relative && !relative.startsWith('..') && !path.isAbsolute(relative))
      hashes[path.relative(root, file.fileName).replace(/\\/g, '/')] = hash(fs.readFileSync(file.fileName));
  }
  assert.ok(Object.keys(hashes).length >= entries.length);
  writeJson(path.join(build, 'scope.json'), { strict: 'OAuth/read-budget/input-bound accounting actual dependency closure and public NodeNext ESM consumer', sourceHashes: hashes,
    driver: 'owned native SQL prepared statements, NOT PrismaClient', bindings: 'explicit identity/grant/goal fixtures' });
  return import(pathToFileURL(path.join(build, 'consumer-build/consumer.mjs')).href);
}

/** Actual persistence/native SQL behavior only. The fixed grant and goal producers
 * below are TEST metadata, not completed human consent or production authority. */
async function verifyNativeStores(api, databases, receipt) {
  const signal = new AbortController().signal;
  const resource = 'https://mcp.example.invalid/mcp', expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const grant = { id: 'store-fixture-grant', subject: 'store-fixture-user', revision: 1, clientId: 'fixture-client', resource,
    scopes: ['catalog:read'], expiresAt };
  await databases[0].$executeRaw`CREATE TABLE mcp_native_oauth_audit (authorizationId VARCHAR(200) PRIMARY KEY, grantId VARCHAR(200) NOT NULL, revision INT NOT NULL) ENGINE=InnoDB`;
  let failAudit = false;
  const audit = { async record(tx, original) {
    assert.equal(await tx.$executeRaw`INSERT INTO mcp_native_oauth_audit VALUES (${original.authorizationId}, ${original.grantId}, ${original.authorizationRevision})`, 1);
    if (failAudit) throw new Error('fixture audit failure after native insertion');
  } };
  const stores = databases.map(db => api.createPrismaOAuthStore(db, audit));
  const verifierText = 'v'.repeat(43), challenge = createHash('sha256').update(verifierText).digest('base64url');
  const codeFor = name => ({ digest: api.oauthCredentialDigest('fixture-code-' + name), authorizationId: 'fixture-consent-' + name,
    authorizationRevision: 1, grantId: grant.id, subject: grant.subject, grantRevision: 1, clientId: grant.clientId, resource,
    scopes: grant.scopes, redirectUri: 'http://127.0.0.1:49152/callback', codeChallengeMethod: 'S256', codeChallenge: challenge,
    expiresAt, consumedFamilyId: null });
  const failedCode = codeFor('audit-rollback'); failAudit = true;
  await assert.rejects(() => stores[0].transaction(tx => tx.insertCode(failedCode), signal)); failAudit = false;
  assert.deepEqual(await databases[0].$queryRaw`SELECT authorizationId FROM mcp_oauth_codes WHERE authorizationId = ${failedCode.authorizationId}`, []);
  assert.deepEqual(await databases[1].$queryRaw`SELECT authorizationId FROM mcp_native_oauth_audit WHERE authorizationId = ${failedCode.authorizationId}`, []);
  receipt.checks.push('actual native SQL transaction rolls back both code and inserted audit on failure');
  const config = { enabled: true, resourceUrl: resource, allowedScopes: grant.scopes, accessTtlSeconds: 900, refreshTtlSeconds: 3600 };
  const services = stores.map(store => api.createPersistentOAuthTokenService(config, store, {
    current: async () => structuredClone(grant),
    revocationOwner: async (grantId, clientId) => grantId === grant.id && clientId === grant.clientId,
  }));
  const reader = api.createPersistentOAuthResourceVerifier(config, stores[0], { current: async () => structuredClone(grant) });
  const credentials = [], races = [];
  for (const kind of ['code', 'refresh']) {
    const code = codeFor(kind); let escaped;
    await stores[0].transaction(async tx => {
      escaped = tx; await tx.insertCode(code); assert.deepEqual(await tx.readCodeForAuthorization(code.authorizationId), code);
      assert.throws(() => stores[1].native(tx));
    }, signal);
    assert.throws(() => stores[0].native(escaped)); await assert.rejects(() => escaped.readCode(code.digest));
    const input = { clientId: grant.clientId, clientRevision: 1, resource, redirectUri: code.redirectUri,
      code: 'fixture-code-' + kind, codeVerifier: verifierText };
    const before = kind === 'refresh' ? await services[0].exchangeCode(input, signal) : undefined;
    if (before) { credentials.push(before.access_token, before.refresh_token); assert.equal((await reader.verifyAccessToken(before.access_token)).subject, grant.subject); }
    // Independent real clients/transactions compete; no JS queue serializes them.
    const results = await Promise.allSettled(services.map(service => kind === 'code' ? service.exchangeCode(input, signal)
      : service.refresh({ clientId: grant.clientId, clientRevision: 1, resource, refreshToken: before.refresh_token }, signal)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'invalid_grant');
    const tokens = results.find(result => result.status === 'fulfilled').value;
    credentials.push(input.code, tokens.access_token, tokens.refresh_token);
    await assert.rejects(() => reader.verifyAccessToken(tokens.access_token));
    if (before) await assert.rejects(() => reader.verifyAccessToken(before.access_token));
    races.push({ kind, fulfilled: 1, invalidGrant: 1, winnerAccessRejectedAfterReuse: true });
  }
  const families = await databases[1].$queryRaw`SELECT revoked FROM mcp_oauth_families`;
  assert.equal(families.length, 2); assert.ok(families.every(row => row.revoked === 1 || row.revoked === true));
  const persisted = JSON.stringify([
    await databases[0].$queryRaw`SELECT recordJson FROM mcp_oauth_codes`, await databases[0].$queryRaw`SELECT recordJson FROM mcp_oauth_families`,
    await databases[0].$queryRaw`SELECT recordJson FROM mcp_oauth_access`, await databases[0].$queryRaw`SELECT recordJson FROM mcp_oauth_refresh`,
  ]);
  for (const credential of credentials) assert.ok(!persisted.includes(credential), 'Only credential digests may be persisted');
  receipt.nativeStoreOAuth = { bindings: 'fixed grant fixture; no production identity or human consent', rollbackCodeAndAudit: true,
    scopedNativeOwnership: true, races, families: families.length, allRevoked: true, noPlaintextCredentials: true };
  receipt.checks.push('actual two-client code/refresh competition and persisted family reuse containment');

  // A fixed TEST producer holds a real source-row fence. It cannot be mistaken
  // for the still-missing production goal/request association or classification.
  const target = { goalId: 'store-fixture-goal', goalRevision: 1, grantId: grant.id, subject: grant.subject, clientId: grant.clientId,
    resource, scopes: grant.scopes, purpose: 'catalog', originalInputHash: 'b'.repeat(64), policyVersion: 'fixture-1' };
  await databases[0].$executeRaw`CREATE TABLE mcp_native_goal_source (goalId VARCHAR(200) PRIMARY KEY, recordJson JSON NOT NULL) ENGINE=InnoDB`;
  await databases[0].$executeRaw`INSERT INTO mcp_native_goal_source VALUES (${target.goalId}, ${JSON.stringify(target)})`;
  const source = { async resolve(call, tx) {
    const rows = await tx.$queryRaw`SELECT recordJson FROM mcp_native_goal_source WHERE goalId = ${target.goalId} FOR UPDATE`;
    assert.equal(rows.length, 1); return rows[0].recordJson;
  } };
  const budgets = databases.map(db => api.createPrismaMcpReadBudget(db, source));
  const callFor = n => ({ callId: 'store-fixture-call-' + n, toolName: 'catalog', inputHash: 'c'.repeat(64),
    authorization: { subject: grant.subject, clientId: grant.clientId, resource, scopes: grant.scopes, token: 'fixture-private-token-' + n } });
  const calls = [callFor(1), callFor(2)];
  const reservations = await Promise.all(calls.map((call, i) => budgets[i].reserve(call, signal)));
  await assert.rejects(() => budgets[0].reserve(callFor(3), signal), error => error instanceof api.OriginalMcpReadBudgetError && error.kind === 'limit');
  await budgets[1].settle(calls[0], reservations[0], { outcome: 'returned', activeMs: 3 }, signal);
  await budgets[0].markUnknown(calls[1], signal);
  await assert.rejects(() => budgets[1].settle(calls[1], reservations[1], { outcome: 'returned', activeMs: 1 }, signal));
  await budgets[0].settle(calls[0], reservations[0], { outcome: 'returned', activeMs: 3 }, signal);
  const rows = await databases[1].$queryRaw`SELECT consumedCalls, consumedActiveMs, reservedActiveMs, concurrentReads FROM mcp_read_goal_budgets WHERE goalId = ${target.goalId}`;
  assert.deepEqual(rows, [{ consumedCalls: 2, consumedActiveMs: 3, reservedActiveMs: 15000, concurrentReads: 1 }]);
  const states = await databases[0].$queryRaw`SELECT callId, state, activeMs FROM mcp_read_calls ORDER BY callId`;
  assert.deepEqual(states, [{ callId: calls[0].callId, state: 'returned', activeMs: 3 }, { callId: calls[1].callId, state: 'unknown', activeMs: null }]);
  receipt.nativeStoreBudget = { bindings: 'fixed database-row goal fixture, not production goal/classification', ...rows[0], states };
  receipt.checks.push('actual two-client reservations / concurrency refusal / cross-store settlement / unknown hold / idempotent terminal');

  const inputTarget = { ...target, goalId: 'store-input-goal' };
  await databases[0].$executeRaw`INSERT INTO mcp_native_goal_source VALUES (${inputTarget.goalId}, ${JSON.stringify(inputTarget)})`;
  const expected = api.captureMcpReadInput({ query: { keyword: 'private-native-input-fixture', limit: 1 } });
  let lookups = 0, readers = 0;
  const inputSource = { async resolve(call, input, tx) {
    if (JSON.stringify(input) !== JSON.stringify(expected.input)) return undefined; // fixed TEST association, never a caller goal claim
    assert.ok(Object.isFrozen(input) && Object.isFrozen(input.query)); assert.equal(call.inputHash, expected.inputHash); lookups++;
    const found = await tx.$queryRaw`SELECT recordJson FROM mcp_native_goal_source WHERE goalId = ${inputTarget.goalId} FOR UPDATE`;
    assert.equal(found.length, 1); return found[0].recordJson;
  } };
  const inputAccounting = databases.map(db => api.createPrismaMcpReadAccounting(db, inputSource));
  for (const [i, accounting] of inputAccounting.entries()) assert.equal(await accounting.withCall({ ...calls[0].authorization, token: 'private-native-token-' + i },
    'catalog', { query: { limit: 1, keyword: 'private-native-input-fixture' } }, async () => { readers++; return 'ok'; }, signal), 'ok');
  await assert.rejects(() => inputAccounting[0].withCall(calls[0].authorization, 'catalog', { goalId: inputTarget.goalId, human: true }, async () => { readers++; }, signal));
  const inputBudget = await databases[1].$queryRaw`SELECT consumedCalls, consumedActiveMs, reservedActiveMs, concurrentReads FROM mcp_read_goal_budgets WHERE goalId = ${inputTarget.goalId}`;
  assert.equal(inputBudget.length, 1); assert.equal(inputBudget[0].consumedCalls, 2); assert.equal(inputBudget[0].concurrentReads, 0);
  assert.equal(inputBudget[0].reservedActiveMs, 0); assert.equal(readers, 2); assert.equal(lookups, 4);
  const inputCalls = await databases[0].$queryRaw`SELECT recordJson FROM mcp_read_calls WHERE goalId = ${inputTarget.goalId}`;
  assert.equal(inputCalls.length, 2); assert.ok(inputCalls.every(row => row.recordJson.inputHash === expected.inputHash));
  assert.doesNotMatch(JSON.stringify(inputCalls), /private-native-input-fixture|private-native-token/);
  receipt.inputBoundAccounting = { bindings: 'fixed database-row/input fixture, not production goal/classification', goalId: inputTarget.goalId,
    inputHash: expected.inputHash, ...inputBudget[0], lookups, readers, callerClaimRejected: true, noInputOrTokenStored: true };
  receipt.checks.push('input-bound public accounting consumes frozen input / same native source fence / cross-instance persistent counters / caller claim refusal');

  // Real persistence and locks; ORIGINAL writer/locator/subject are still explicit
  // test fixtures, not a production goal creator, Guard or classified request.
  const options = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 };
  const bindingTarget = { ...target, goalId: 'store-binding-goal' };
  const bindingOwner = { userId: 'binding-user', tenantId: 'binding-tenant', workspaceId: 'binding-space', grantId: grant.id, grantRevision: 1 };
  const bindingInput = api.captureMcpReadInput({ query: 'private-native-binding-input', limit: 1 });
  const invocation = { toolName: 'catalog', inputHash: bindingInput.inputHash };
  const publication = { target: bindingTarget, owner: bindingOwner, bindings: [invocation] };
  await databases[0].$executeRaw`CREATE TABLE mcp_native_binding_audit (goalId VARCHAR(200) PRIMARY KEY, keysJson JSON NOT NULL) ENGINE=InnoDB`;
  let auditUnavailable = false, policyCurrent = true, currentEntered;
  const loadPublication = async (goalId, tx) => {
    const found = await tx.$queryRaw`SELECT recordJson FROM mcp_native_goal_source WHERE goalId = ${goalId} FOR UPDATE`;
    if (!found.length) return undefined; assert.equal(found.length, 1); return found[0].recordJson;
  };
  const authority = {
    readExisting: loadPublication,
    locate: async (call, owner) => { assert.equal(owner.dataScope, 'organization'); return bindingTarget.goalId; },
    async current(t, b, owner, tx) {
      currentEntered?.resolve(); assert.equal(owner.dataScope, 'organization');
      const value = await loadPublication(t.goalId, tx); assert.deepEqual(value, publication); assert.deepEqual(b, invocation); return policyCurrent;
    },
    async auditPublished(goalId, keys, tx) {
      assert.equal(await tx.$executeRaw`INSERT INTO mcp_native_binding_audit VALUES (${goalId}, ${JSON.stringify(keys)})`, 1);
      if (auditUnavailable) throw Error('fixture publication audit failure after native write');
    },
  };
  const subjects = { current: () => ({ ...bindingOwner, dataScope: 'organization' }) };
  const associations = [0, 1].map(() => api.createPrismaMcpReadBindings(authority, subjects));
  auditUnavailable = true;
  await assert.rejects(() => databases[0].$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO mcp_native_goal_source VALUES (${bindingTarget.goalId}, ${JSON.stringify(publication)})`;
    await associations[0].publishIn(bindingTarget.goalId, tx, signal);
  }, options)); auditUnavailable = false;
  assert.deepEqual(await databases[1].$queryRaw`SELECT recordJson FROM mcp_native_goal_source WHERE goalId = ${bindingTarget.goalId}`, []);
  assert.deepEqual(await databases[1].$queryRaw`SELECT bindingKey FROM mcp_read_target_bindings WHERE goalId = ${bindingTarget.goalId}`, []);
  assert.deepEqual(await databases[1].$queryRaw`SELECT goalId FROM mcp_native_binding_audit WHERE goalId = ${bindingTarget.goalId}`, []);
  await databases[0].$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO mcp_native_goal_source VALUES (${bindingTarget.goalId}, ${JSON.stringify(publication)})`;
    await associations[0].publishIn(bindingTarget.goalId, tx, signal);
  }, options);
  await databases[1].$transaction(tx => associations[1].publishIn(bindingTarget.goalId, tx, signal), options);
  const boundRows = await databases[0].$queryRaw`SELECT bindingKey, recordJson, recordHash FROM mcp_read_target_bindings WHERE goalId = ${bindingTarget.goalId}`;
  assert.equal(boundRows.length, 1);
  assert.equal((await databases[1].$queryRaw`SELECT goalId FROM mcp_native_binding_audit WHERE goalId = ${bindingTarget.goalId}`).length, 1);
  const key = boundRows[0].bindingKey, record = JSON.stringify(boundRows[0].recordJson);
  await assert.rejects(() => databases[1].$executeRaw`INSERT INTO mcp_read_target_bindings (bindingKey, goalId, grantId, grantRevision, userId, tenantId, workspaceId, toolName, inputHash, recordHash, recordJson) VALUES (${'f'.repeat(64)}, ${bindingTarget.goalId}, ${grant.id}, ${1}, ${bindingOwner.userId}, ${bindingOwner.tenantId}, ${bindingOwner.workspaceId}, ${invocation.toolName}, ${invocation.inputHash}, ${boundRows[0].recordHash}, ${record})`);
  await assert.rejects(() => databases[1].$executeRaw`UPDATE mcp_read_target_bindings SET grantRevision = ${0} WHERE bindingKey = ${key}`);
  await assert.rejects(() => databases[0].$transaction(async tx => {
    await tx.$executeRaw`UPDATE mcp_native_goal_source SET recordJson = ${JSON.stringify({ ...publication, target: { ...bindingTarget, policyVersion: 'retargeted-policy' } })} WHERE goalId = ${bindingTarget.goalId}`;
    await associations[0].publishIn(bindingTarget.goalId, tx, signal);
  }, options));
  assert.deepEqual(await databases[1].$transaction(tx => loadPublication(bindingTarget.goalId, tx), options), publication);
  const boundAccounting = databases.map((db, i) => api.createPrismaMcpReadAccounting(db, associations[i].source));
  let boundReaders = 0;
  for (const [i, accounting] of boundAccounting.entries()) assert.equal(await accounting.withCall({ ...calls[0].authorization, token: 'private-native-binding-token-' + i },
    invocation.toolName, { limit: 1, query: 'private-native-binding-input' }, async () => { boundReaders++; return 'ok'; }, signal), 'ok');
  policyCurrent = false;
  await assert.rejects(() => boundAccounting[0].withCall(calls[0].authorization, invocation.toolName, bindingInput.input, async () => { boundReaders++; }, signal)); policyCurrent = true;
  const boundBudget = await databases[1].$queryRaw`SELECT consumedCalls, reservedActiveMs, concurrentReads FROM mcp_read_goal_budgets WHERE goalId = ${bindingTarget.goalId}`;
  assert.deepEqual(boundBudget, [{ consumedCalls: 2, reservedActiveMs: 0, concurrentReads: 0 }]); assert.equal(boundReaders, 2);
  const bindingCall = { ...calls[0], ...invocation };
  // A real competing row lock must fail NOWAIT, not silently return no target.
  const heldBinding = Promise.withResolvers(), releaseBinding = Promise.withResolvers();
  const holdingBinding = databases[0].$transaction(async tx => {
    await tx.$queryRaw`SELECT bindingKey FROM mcp_read_target_bindings WHERE bindingKey = ${key} FOR UPDATE`;
    heldBinding.resolve(); await releaseBinding.promise;
  }, options);
  try {
    await heldBinding.promise;
    await assert.rejects(() => databases[1].$transaction(tx => associations[1].source.resolve(bindingCall, bindingInput.input, tx, signal), options));
  } finally { releaseBinding.resolve(); await holdingBinding; }
  // Exercise the actual inverse wait: publisher owns goal; reader owns binding
  // and waits on goal. Publisher's NOWAIT must roll back and unblock that reader.
  const heldGoal = Promise.withResolvers(); currentEntered = Promise.withResolvers();
  const publishing = databases[0].$transaction(async tx => {
    await loadPublication(bindingTarget.goalId, tx); heldGoal.resolve(); await currentEntered.promise;
    await associations[0].publishIn(bindingTarget.goalId, tx, signal);
  }, options);
  const publishingRejected = assert.rejects(publishing);
  await heldGoal.promise;
  const concurrentRead = databases[1].$transaction(tx => associations[1].source.resolve(bindingCall, bindingInput.input, tx, signal), options);
  await publishingRejected; assert.deepEqual(await concurrentRead, bindingTarget); currentEntered = undefined;
  const allBindings = await databases[1].$queryRaw`SELECT recordJson FROM mcp_read_target_bindings`;
  assert.equal(allBindings.length, 1); assert.doesNotMatch(JSON.stringify(allBindings), /private-native-binding-input|private-native-binding-token|dataScope/);
  // Error numbers come from retained native client output, not a simulated lock.
  const evidence = fs.readdirSync(receipt.directory).filter(name => /^native-session-.*\.log$/.test(name))
    .map(name => fs.readFileSync(path.join(receipt.directory, name), 'utf8')).join('\n');
  for (const code of [1062, 3819, 3572]) assert.match(evidence, new RegExp('ERROR ' + code + '\\b'));
  receipt.persistentReadBindings = { bindings: 'original writer/locator/subject fixtures, NOT production goal/Guard', goalId: bindingTarget.goalId,
    rows: 1, rollbackGoalBindingAndAudit: true, identicalPublicationAuditRows: 1, retargetRejected: true,
    nativeUniqueAndRevisionCheck: true, nowaitLockCode: 3572, inverseWaitUnblocked: true, ...boundBudget[0], readers: boundReaders, noInputOrTokenStored: true };
  receipt.checks.push('persistent original goal/read publication, triple rollback, immutable metadata, real NOWAIT/inverse wait and current-source accounting across native clients');
  await verifyOriginalRequestParticipant(api, databases, grant, receipt);
}

/** Actual original repository method and native locks. Only its ORM, original
 * policy/resource authority and goal locator are explicitly named facades. The
 * three-column fixture is NOT the production Prisma schema or a new migration. */
async function verifyOriginalRequestParticipant(api, databases, grant, receipt) {
  const original = require('./fixtures/mcp/original-identity.cjs');
  const { PrismaOriginalRequestRepository } = original.source('apps/api/src/modules/ai-native/task-request/prisma-original-request.repository.ts');
  const { originalIdentityHash } = original.source('apps/api/src/modules/ai-native/task-request/original-request.authority.ts');
  const { requestFingerprint } = original.source('apps/api/src/modules/rental-core/rental-idempotency.repository.ts');
  const f = original.fixture(), now = new Date(), signal = new AbortController().signal;
  const options = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 };
  await databases[0].$executeRaw`CREATE TABLE ai_task_original_requests (id VARCHAR(36) PRIMARY KEY, scopeId VARCHAR(36) NOT NULL, recordJson JSON NOT NULL, UNIQUE KEY original_fixture_scope (scopeId, id)) ENGINE=InnoDB`;
  await databases[0].$executeRaw`CREATE TABLE mcp_native_original_request_audit (goalId VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB`;
  await f.run(async current => {
    const context = { contractVersion: original.shared.AI_CONTRACT_DRAFT_VERSION, requestId: 'native-original-request', authorizedAt: now.toISOString(),
      audience: current.audience, actor: { kind: 'user', userId: current.userId }, scope: { kind: 'workspace', tenantId: current.tenantId, workspaceId: current.workspaceId },
      access: { permissions: current.permissions, dataScope: current.dataScope, locationScope: current.locationScope, organizationId: current.organizationId } };
    const row = { id: '00000000-0000-4000-8000-000000000002', scopeId: 'scope-a', audience: 'OPERATOR', ownerKind: 'USER', ownerId: 'user-a',
      contractVersion: original.shared.AI_SCENE_REQUEST_DRAFT_VERSION, sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1,
      requestKey: 'native-original-key', previousRequestId: null, payload: { candidate: { customerType: 'personal' } },
      policyRevision: 1, policyHash: 'c'.repeat(64), authorizationBindingHash: originalIdentityHash(context),
      expiresAt: new Date(now.getTime() + 120000), createdAt: now, status: 'STORED', erasedAt: null, creationClosedAt: null, creationCloseKey: null };
    row.contentHash = requestFingerprint({ version: row.contractVersion, scopeId: row.scopeId, audience: row.audience, ownerKind: row.ownerKind,
      ownerId: row.ownerId, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, revision: row.revision, previousInputRef: null, input: row.payload });
    const ref = { draftVersion: row.contractVersion, inputRef: row.id }, input = api.captureMcpReadInput({ limit: 1 }), invocation = { toolName: 'catalog', inputHash: input.inputHash };
    await databases[0].$executeRaw`INSERT INTO ai_task_original_requests VALUES (${row.id}, ${row.scopeId}, ${JSON.stringify(row)})`;
    let auditFailure = false, policy = row.policyHash;
    const currentAuthority = { async current() { return { scopeId: 'scope-a', context: structuredClone(context) }; },
      async create(body) { assert.equal(body.sceneCode, 'quote_clarification'); return { ...await this.current(), sceneVersion: '1', policyRevision: 1, policyHash: policy, expiresAt: row.expiresAt.toISOString() }; },
      async read() { throw Error('must use original current creation-policy check'); } }; // explicit external policy/resource facade
    const forbidden = () => { throw Error('original request escaped caller-native metadata transaction'); };
    const repository = new PrismaOriginalRequestRepository({ $transaction: forbidden, aiScope: { findFirst: forbidden }, aiTask: { findFirst: forbidden }, aiTaskOriginalRequest: { findFirst: forbidden } }, currentAuthority, () => now);
    const nativeView = tx => ({
      $queryRaw(query) { return tx.$queryRaw(query.strings, ...query.values); },
      aiTaskOriginalRequest: { async findFirst({ where }) {
        const found = await tx.$queryRaw`SELECT recordJson FROM ai_task_original_requests WHERE id = ${where.id} AND scopeId = ${where.scopeId} AND JSON_UNQUOTE(JSON_EXTRACT(recordJson, '$.audience')) = ${where.audience} AND JSON_UNQUOTE(JSON_EXTRACT(recordJson, '$.ownerKind')) = ${where.ownerKind} AND JSON_UNQUOTE(JSON_EXTRACT(recordJson, '$.ownerId')) = ${where.ownerId}`;
        assert.ok(found.length <= 1); if (!found.length) return null;
        const value = found[0].recordJson;
        for (const key of ['createdAt', 'expiresAt', 'erasedAt', 'creationClosedAt']) if (value[key] !== null) value[key] = new Date(value[key]);
        return value;
      } },
    }); // real SQL row/lock; Date/ORM projection is NOT a PrismaClient driver
    const observe = (tx, consume) => repository.withCurrentInputIn(nativeView(tx), ref, consume, signal);
    const subject = { userId: current.userId, tenantId: current.tenantId, workspaceId: current.workspaceId, grantId: grant.id, grantRevision: 1 };
    const publication = value => ({ target: { goalId: value.receipt.inputRef, goalRevision: value.receipt.revision, grantId: grant.id,
      subject: grant.subject, clientId: grant.clientId, resource: grant.resource, scopes: grant.scopes, purpose: value.receipt.sceneCode,
      originalInputHash: value.receipt.contentHash, policyVersion: value.policyHash }, owner: subject, bindings: [invocation] });
    const authority = {
      async readExisting(goalId, tx) { assert.equal(goalId, row.id); return observe(tx, async value => publication(value)); },
      async locate(call) { assert.equal(call.inputHash, input.inputHash); return row.id; }, // fixed TEST locator, not production request association
      async current(target, binding, owner, tx) {
        assert.deepEqual(binding, invocation); assert.deepEqual(owner, subject);
        return observe(tx, async value => { assert.deepEqual(target, publication(value).target); return true; });
      },
      async auditPublished(goalId, keys, tx) {
        assert.equal(keys.length, 1); assert.equal(await tx.$executeRaw`INSERT INTO mcp_native_original_request_audit VALUES (${goalId})`, 1);
        if (auditFailure) throw Error('native original publication audit failed');
      },
    };
    const bindings = api.createPrismaMcpReadBindings(authority, { current: () => subject });
    auditFailure = true;
    await assert.rejects(() => databases[0].$transaction(tx => bindings.publishIn(row.id, tx, signal), options)); auditFailure = false;
    assert.deepEqual(await databases[1].$queryRaw`SELECT bindingKey FROM mcp_read_target_bindings WHERE goalId = ${row.id}`, []);
    assert.deepEqual(await databases[1].$queryRaw`SELECT goalId FROM mcp_native_original_request_audit WHERE goalId = ${row.id}`, []);
    // Preparation commits before the independent budget transaction. Never hold
    // the original goal row in an outer callback while nesting its budget read.
    await databases[0].$transaction(tx => bindings.publishIn(row.id, tx, signal), options);
    const accounting = api.createPrismaMcpReadAccounting(databases[1], bindings.source);
    let readers = 0;
    const authorization = { subject: grant.subject, clientId: grant.clientId, resource: grant.resource, scopes: grant.scopes, token: 'private-original-request-token' };
    assert.equal(await accounting.withCall(authorization, invocation.toolName, input.input, async () => { readers++; return 'ok'; }, signal), 'ok');
    const budget = await databases[0].$queryRaw`SELECT consumedCalls, concurrentReads, reservedActiveMs FROM mcp_read_goal_budgets WHERE goalId = ${row.id}`;
    assert.deepEqual(budget, [{ consumedCalls: 1, concurrentReads: 0, reservedActiveMs: 0 }]);
    policy = 'd'.repeat(64);
    await assert.rejects(() => accounting.withCall(authorization, invocation.toolName, input.input, async () => { readers++; }, signal)); policy = row.policyHash;
    assert.equal(readers, 1);
    const held = Promise.withResolvers(), release = Promise.withResolvers();
    const holder = databases[0].$transaction(tx => observe(tx, async () => { held.resolve(); await release.promise; }), options);
    try {
      await held.promise;
      await assert.rejects(() => databases[1].$transaction(tx => tx.$queryRaw`SELECT id FROM ai_task_original_requests WHERE scopeId = ${row.scopeId} AND id = ${row.id} FOR UPDATE NOWAIT`, options));
    } finally { release.resolve(); await holder; }
    await assert.rejects(() => databases[0].$transaction(tx => observe(tx, async () => {
      await tx.$executeRaw`UPDATE ai_task_original_requests SET recordJson = ${JSON.stringify({ ...row, creationClosedAt: now.toISOString(), creationCloseKey: 'changed-in-participant' })} WHERE id = ${row.id}`;
    }), options));
    const persisted = await databases[1].$queryRaw`SELECT recordJson FROM ai_task_original_requests WHERE id = ${row.id}`;
    assert.equal(persisted.length, 1); assert.equal(persisted[0].recordJson.creationClosedAt, null);
    assert.equal((await databases[1].$queryRaw`SELECT goalId FROM mcp_native_original_request_audit WHERE goalId = ${row.id}`).length, 1);
    receipt.originalRequestNative = { source: 'actual original repository method; SQL/ORM/date and policy/locator facades, NOT production goal/Prisma schema',
      originalInputRef: row.id, rowFenceBusyRejected: true, originalRowChangeRolledBack: true, auditAndBindingRolledBack: true,
      metadataPreparationCommittedBeforeBudget: true, ...budget[0], readers, noTaskOrModel: true };
    receipt.checks.push('actual original-request participant under native row lock, same-native MCP binding/audit rollback, separate committed preparation and current-source budget');
  });
}

if (process.argv[2] === '--inspect-options') {
  const text = execFileSync(mysqld, ['--no-defaults', '--verbose', '--help'], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 2097152, stdio: ['pipe', 'pipe', 'pipe'] });
  console.log(text.split(/\r?\n/).filter(line => /monitor|standalone|restart/i.test(line)).join('\n'));
} else if (process.argv[2] === '--supervise') {
  // The parent owns stdin. Even a killed test process closes that pipe, so this
  // supervisor terminates ONLY the child it spawned; no PID search/service stop.
  const directory = ownedRun(process.argv[3]), config = JSON.parse(fs.readFileSync(path.join(directory, 'instance.json'), 'utf8'));
  assert.ok(Number.isInteger(config.port) && config.port > 1024 && config.port <= 65535);
  assert.ok(typeof config.nativeDirectory === 'string' && /^[\x20-\x7e]+$/.test(config.nativeDirectory));
  assert.equal(normalized(fs.realpathSync(config.nativeDirectory)), normalized(directory));
  // Disable the native monitor so our supervisor owns the real PID. The verified
  // ASCII junction avoids MySQL Windows dictionary/path encoding failures.
  const server = spawn(mysqld, serverArgs(config.nativeDirectory, config.port), { cwd: path.join(config.nativeDirectory, 'data'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  writeJson(path.join(directory, 'process.json'), { supervisorPid: process.pid, serverPid: server.pid, port: config.port });
  const log = data => fs.appendFileSync(path.join(directory, 'launch.log'), data);
  server.stdout.on('data', log); server.stderr.on('data', log);
  const stop = () => { if (server.exitCode === null) server.kill(); };
  process.stdin.on('end', stop); process.stdin.on('error', stop); process.stdin.resume();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  server.once('error', error => { process.stderr.write(error.message + '\n'); process.exit(1); });
  server.once('close', code => process.exit(code === 0 ? 0 : 1));
} else {
  const { test } = require('node:test');
  assert.ok(process.argv[2] === undefined || ['--decision-types', '--native-stores', '--original-request'].includes(process.argv[2]), 'Unknown explicit MySQL smoke mode');
  const decisionTypes = process.argv[2] === '--decision-types', originalRequestOnly = process.argv[2] === '--original-request',
    nativeStores = process.argv[2] === '--native-stores' || originalRequestOnly;
  test(originalRequestOnly ? 'Original request native participant fences metadata and MCP accounting on owned MySQL'
    : nativeStores ? 'Original TS OAuth/read-budget stores execute real prepared SQL and competing transactions on owned MySQL'
    : decisionTypes ? 'MCP decision-time SQL projections preserve safe JSON numbers on owned MySQL' : 'MCP DDL and read-budget invariants on owned native MySQL', { timeout: originalRequestOnly ? 360000 : 180000 }, async () => {
    assert.equal(process.platform, 'win32', 'This explicit smoke requires the verified local Windows MySQL installation');
    assert.ok(fs.statSync(mysqld).isFile() && fs.statSync(mysql).isFile() && fs.statSync(netstat).isFile());
    const directory = fs.mkdtempSync(path.join(output, 'mcp-isolated-mysql-'));
    for (const name of ['data', 'files', 'tmp']) fs.mkdirSync(path.join(directory, name));
    const database = 'rental_os_e2e_mcp_' + randomBytes(8).toString('hex');
    const password = randomBytes(24).toString('hex');
    let authenticated = false, supervisor, port, processRecord, nativeDirectory, storeApi;
    const receipt = { directory, database, bindings: 'SQL metadata fixtures only; no production identity/goal', checks: [] };
    const redact = text => String(text).replaceAll(password, '[test-credential]');
    const assertOwnedConnection = () => {
      assert.ok(supervisor && supervisor.exitCode === null, 'Owned server supervisor is not running');
      const current = JSON.parse(fs.readFileSync(path.join(directory, 'process.json'), 'utf8'));
      assert.equal(current.serverPid, processRecord.serverPid);
      assert.equal(Number(fs.readFileSync(path.join(directory, 'server.pid'), 'utf8').trim()), current.serverPid);
      assert.deepEqual(listeningOn(port), [{ address: '127.0.0.1:' + port, pid: current.serverPid }], 'Only our child may listen on the test port');
    };
    const sql = (text, selected, timeout = 8000) => {
      const started = Date.now(); assertOwnedConnection();
      const args = ['--no-defaults', '--no-login-paths', '--protocol=TCP', '--host=127.0.0.1', '--port=' + port,
        '--user=mcp_native_test', '--connect-timeout=2', '--batch', '--raw', '--skip-column-names', '--default-character-set=utf8mb4'];
      if (selected) { assert.equal(selected, database); args.push('--database=' + selected); }
      try { return execFileSync(mysql, args, { cwd: root, windowsHide: true, encoding: 'utf8', input: text,
        timeout, maxBuffer: 1048576, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MYSQL_PWD: authenticated ? password : '' } }).trim(); }
      catch (error) {
        const detail = redact(String(error.stderr ?? '') || error.message);
        (receipt.sqlErrors ??= []).push({ code: error.code ?? null, status: error.status ?? null, signal: error.signal ?? null, elapsedMs: Date.now() - started, detail });
        throw new Error('Owned MySQL SQL failed [' + String(error.code ?? error.status) + ']: ' + detail);
      }
    };
    const selectedSql = (text, timeout) => sql(text, database, timeout);
    try {
      if (nativeStores) { storeApi = await compiledStores(directory); receipt.storeCompilation = path.join(directory, 'store-build/scope.json'); }
      receipt.serverVersion = execFileSync(mysqld, ['--no-defaults', '--version'], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 10000 }).trim();
      receipt.clientVersion = execFileSync(mysql, ['--no-defaults', '--no-login-paths', '--version'], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 10000 }).trim();
      assert.match(receipt.serverVersion, /Ver\s+8\.4\./); assert.match(receipt.clientVersion, /Ver\s+8\.4\./);
      receipt.binaryHashes = { mysqld: hash(fs.readFileSync(mysqld)), mysql: hash(fs.readFileSync(mysql)) };
      nativeDirectory = createAsciiAlias(directory); receipt.nativeDirectory = nativeDirectory;
      execFileSync(mysqld, ['--no-defaults', '--no-monitor', '--initialize-insecure', '--basedir=' + basedir,
        '--datadir=' + path.join(nativeDirectory, 'data'), '--innodb-data-home-dir=' + path.join(nativeDirectory, 'data'), '--innodb-buffer-pool-size=32M', '--innodb-redo-log-capacity=64M'],
      { cwd: path.join(nativeDirectory, 'data'), windowsHide: true, timeout: originalRequestOnly ? 180000 : 60000, maxBuffer: 1048576 });
      // Preserve the Node DNS/network guard. Check OS bindings instead of opening
      // a Node listener; later verify the owned PID before every CLI connection.
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = 20000 + randomBytes(2).readUInt16BE(0) % 40000;
        if (listeningOn(candidate).length === 0) { port = candidate; break; }
      }
      assert.ok(port, 'No unused local test port was verified');
      // This fresh instance alone creates the fixed loopback test account. Its
      // schema privileges cannot reach other databases; SHUTDOWN is scoped by
      // the verified process/port. No root login or original credentials are used.
      fs.writeFileSync(path.join(directory, 'bootstrap.sql'), "CREATE USER 'mcp_native_test'@'127.0.0.1' IDENTIFIED BY '';\nGRANT ALL PRIVILEGES ON `" + database + "`.* TO 'mcp_native_test'@'127.0.0.1';\nGRANT SHUTDOWN ON *.* TO 'mcp_native_test'@'127.0.0.1';\n");
      writeJson(path.join(directory, 'instance.json'), { port, nativeDirectory });
      supervisor = spawn(process.execPath, [__filename, '--supervise', directory], { cwd: root, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
      supervisor.stderr.on('data', data => fs.appendFileSync(path.join(directory, 'supervisor.log'), data));
      let ready = false;
      for (let attempt = 0; attempt < 400; attempt++) {
        if (supervisor.exitCode !== null) throw new Error('Owned MySQL exited before startup; inspect retained logs');
        const logFile = fs.existsSync(path.join(directory, 'launch.log')) ? path.join(directory, 'launch.log') : path.join(directory, 'server.log');
        if (fs.existsSync(logFile) && fs.existsSync(path.join(directory, 'server.pid')) && fs.existsSync(path.join(directory, 'process.json'))) {
          const log = fs.readFileSync(logFile, 'utf8');
          processRecord = JSON.parse(fs.readFileSync(path.join(directory, 'process.json'), 'utf8'));
          if (new RegExp('ready for connections\\..*port: ' + port + '\\b').test(log)
            && Number(fs.readFileSync(path.join(directory, 'server.pid'), 'utf8').trim()) === processRecord.serverPid) { ready = true; break; }
        }
        await pause(125);
      }
      assert.ok(ready, 'Owned server readiness, port and PID were not verified; no client connection attempted');
      const identity = JSON.parse(sql("SELECT JSON_OBJECT('version', @@version, 'datadir', @@datadir, 'port', @@port, 'uuid', @@server_uuid);"));
      assert.match(identity.version, /^8\.4\./); assert.equal(identity.port, port);
      assert.equal(normalized(fs.realpathSync(identity.datadir)), normalized(fs.realpathSync(path.join(directory, 'data'))));
      receipt.instance = { ...identity, ...processRecord };
      sql("ALTER USER 'mcp_native_test'@'127.0.0.1' IDENTIFIED BY '" + password + "';"); authenticated = true;
      // Reuse the existing no-overwrite ownership check. Keep the created schema
      // and datadir as evidence rather than invoking its returned DROP callback.
      createOwnedDatabase(database, text => sql(text));
      assert.equal(selectedSql('SELECT DATABASE();'), database);
      receipt.checks.push('fresh datadir / loopback port / PID / version / schema ownership');
      const schemas = ['packages/mcp-server/mysql-oauth-schema.sql', 'packages/mcp-server/mysql-read-budget-schema.sql'];
      receipt.schemaHashes = {};
      for (const name of schemas) {
        const source = fs.readFileSync(path.join(root, name), 'utf8'); receipt.schemaHashes[name] = hash(source);
        const masked = source.replace(/'(?:''|\\.|[^'])*'/gs, "'_' ").replace(/^\s*--.*$/gm, '');
        for (const statement of masked.split(';').map(value => value.trim()).filter(Boolean)) {
          if (/^CREATE TABLE /i.test(statement)) {
            assert.match(statement, /^CREATE TABLE mcp_[a-z0-9_]+\s*\(/);
            assert.match(statement, /ENGINE\s*=\s*InnoDB$/i);
          } else {
            assert.match(statement, /^CREATE INDEX mcp_[a-z0-9_]+\s+ON mcp_[a-z0-9_]+\s*\([a-z0-9_,\s]+\)$/i);
          }
          assert.doesNotMatch(statement, /\b(?:USE|DROP|TRUNCATE|LOAD|OUTFILE|INFILE|GRANT|REVOKE|PROCEDURE|TRIGGER|FEDERATED)\b/i);
          assert.doesNotMatch(statement, /\bREFERENCES\s+(?!mcp_)[a-z0-9_]+|\bREFERENCES\s+mcp_[a-z0-9_]+\s*\./i);
        }
        selectedSql(source, 60000); // Schema setup is not a 15-second business read.
      }
      receipt.tableCount = Number(selectedSql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();"));
      assert.ok(receipt.tableCount > 20); receipt.checks.push('both actual MCP InnoDB DDL sources applied');
      if (nativeStores) {
        const { createNativeSqlDatabase } = require('./helpers/mcp-native-sql.cjs');
        assertOwnedConnection();
        const args = ['--no-defaults', '--no-login-paths', '--protocol=TCP', '--host=127.0.0.1', '--port=' + port,
          '--user=mcp_native_test', '--connect-timeout=2', '--batch', '--raw', '--skip-column-names', '--default-character-set=utf8mb4', '--database=' + database];
        const databases = [0, 1].map(() => createNativeSqlDatabase({ executable: mysql, args, env: { ...process.env, MYSQL_PWD: password },
          cwd: root, directory, assertOwned: assertOwnedConnection }));
        if (originalRequestOnly) await verifyOriginalRequestParticipant(storeApi, databases, {
          id: 'original-request-fixture-grant', subject: 'original-request-fixture-subject', revision: 1,
          clientId: 'fixture-client', resource: 'https://mcp.example.invalid/mcp', scopes: ['catalog:read'],
        }, receipt);
        else await verifyNativeStores(storeApi, databases, receipt);
        receipt.nativeSqlDriver = { type: 'native prepared-SQL fixture, NOT PrismaClient', clients: databases.map(db => db.stats()) };
        for (const [name, original] of Object.entries(receipt.schemaHashes)) assert.equal(hash(fs.readFileSync(path.join(root, name))), original);
        receipt.success = true; return;
      }
      if (decisionTypes) {
        // Read the actual production SELECT projection, not a second SQL mapping.
        // The view exposes its native result type without fabricating human consent.
        const readers = [
          ['prisma-oauth-web-consent.ts', 'mcp_oauth_browser_consents'],
          ['prisma-public-client-review.ts', 'mcp_oauth_public_client_review_drafts'],
          ['prisma-oauth-notice-review.ts', 'mcp_oauth_notice_review_drafts'],
        ];
        receipt.decisionProjections = [];
        for (const [index, [file, table]] of readers.entries()) {
          const source = fs.readFileSync(path.join(root, 'packages/mcp-server/src', file), 'utf8');
          const select = source.match(new RegExp('`SELECT ([^`]+) FROM ' + table + ' WHERE'));
          assert.ok(select, 'Original locked SELECT is required');
          const fields = select[1].split(',').map(value => value.trim()).filter(value => /\bdecidedAt\b/.test(value));
          assert.equal(fields.length, 1);
          const projection = fields[0], view = 'mcp_native_decision_type_' + index;
          assert.match(projection, /^(?:decidedAt|CAST\(decidedAt AS DOUBLE\) AS decidedAt)$/);
          selectedSql('CREATE VIEW ' + view + ' AS SELECT ' + projection + ' FROM ' + table + ';');
          const type = selectedSql("SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='" + view + "' AND column_name='decidedAt';");
          const entry = { file, table, projection, sqlType: type, sourceSha256: hash(source), probes: [] };
          receipt.decisionProjections.push(entry); assert.equal(type, 'double', 'BIGINT must not reach the ordinary-JSON row');
          const expression = projection.replace(/ AS decidedAt$/, '');
          for (const literal of ['NULL', '1800000000', '9007199254740991', '9007199254740992', '18446744073709551615']) {
            const value = JSON.parse(selectedSql("SELECT JSON_OBJECT('value'," + expression.replace(/\bdecidedAt\b/g, literal) + ');')).value;
            const safe = Number.isSafeInteger(value) && value > 0;
            entry.probes.push({ literal, value, safe });
            if (literal === 'NULL') assert.equal(value, null);
            else if (literal === '1800000000' || literal === '9007199254740991') { assert.equal(value, Number(literal)); assert.equal(safe, true); }
            else assert.equal(safe, false, 'Unsafe unsigned values cannot become valid decision timestamps');
          }
        }
        receipt.checks.push('three original SELECTs: native DOUBLE / NULL / exact safe boundary / rejected overflow');
        receipt.success = true; return; // Explicit type scope, not a repeated budget behavior run.
      }
      const target = { goalId: 'native-goal', goalRevision: 1, grantId: 'native-grant', subject: 'fixture-user', clientId: 'fixture-client',
        resource: 'https://mcp.example.invalid/mcp', scopes: ['catalog:read'], purpose: 'catalog', originalInputHash: 'b'.repeat(64), policyVersion: 'fixture-1' };
      const binding = hash(JSON.stringify(target)), literal = value => "CONVERT(0x" + Buffer.from(JSON.stringify(value)).toString('hex') + " USING utf8mb4)";
      const reservation = { state: 'reserved', callId: 'native-call', goalId: target.goalId, goalRevision: 1, grantId: target.grantId,
        goalBindingHash: binding, inputHash: 'c'.repeat(64), subject: target.subject, clientId: target.clientId, resource: target.resource,
        scopes: target.scopes, consumedCalls: 1, consumedActiveMs: 0, reservedActiveMs: 15000, concurrentReads: 1, callAllowanceMs: 15000 };
      selectedSql(`INSERT INTO mcp_read_goal_budgets VALUES ('native-goal','native-grant','${binding}',${literal(target)},1,0,0,0,0);
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; START TRANSACTION;
UPDATE mcp_read_goal_budgets SET revision=2,consumedCalls=1,reservedActiveMs=15000,concurrentReads=1 WHERE goalId='native-goal' AND revision=1;
INSERT INTO mcp_read_calls VALUES ('native-call','native-goal','native-grant','${'d'.repeat(64)}',${literal(reservation)},'reserved',NULL); COMMIT;`);
      const rejected = (text, code) => assert.throws(() => selectedSql(text), new RegExp('ERROR ' + code + '\\b'));
      rejected("UPDATE mcp_read_goal_budgets SET consumedCalls=21 WHERE goalId='native-goal';", 3819);
      rejected("UPDATE mcp_read_goal_budgets SET consumedActiveMs=300001 WHERE goalId='native-goal';", 3819);
      rejected("UPDATE mcp_read_goal_budgets SET concurrentReads=3 WHERE goalId='native-goal';", 3819);
      rejected("UPDATE mcp_read_goal_budgets SET concurrentReads=0 WHERE goalId='native-goal';", 3819);
      rejected("UPDATE mcp_read_calls SET state='returned' WHERE callId='native-call';", 3819);
      rejected(`INSERT INTO mcp_read_calls VALUES ('wrong-grant','native-goal','other-grant','${'e'.repeat(64)}',${literal(reservation)},'reserved',NULL);`, 1452);
      rejected("DELETE FROM mcp_read_goal_budgets WHERE goalId='native-goal';", 1451);
      receipt.checks.push('20 calls / 5 minutes / 2 reads / held state / settlement / grant FK / delete restriction');
      selectedSql("START TRANSACTION; UPDATE mcp_read_goal_budgets SET consumedCalls=2 WHERE goalId='native-goal'; ROLLBACK;");
      assert.equal(Number(selectedSql("SELECT consumedCalls FROM mcp_read_goal_budgets WHERE goalId='native-goal';")), 1);
      selectedSql("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; START TRANSACTION; UPDATE mcp_read_goal_budgets SET revision=3,consumedActiveMs=3,reservedActiveMs=0,concurrentReads=0 WHERE goalId='native-goal' AND revision=2; UPDATE mcp_read_calls SET state='returned',activeMs=3 WHERE callId='native-call' AND state='reserved'; COMMIT;");
      receipt.settled = JSON.parse(selectedSql("SELECT JSON_OBJECT('calls',b.consumedCalls,'activeMs',b.consumedActiveMs,'reservedMs',b.reservedActiveMs,'reads',b.concurrentReads,'state',c.state,'callActiveMs',c.activeMs) FROM mcp_read_goal_budgets b JOIN mcp_read_calls c ON c.goalId=b.goalId WHERE c.callId='native-call';"));
      assert.deepEqual(receipt.settled, { calls: 1, activeMs: 3, reservedMs: 0, reads: 0, state: 'returned', callActiveMs: 3 });
      receipt.checks.push('actual SQL rollback and atomic terminal/counter settlement');
      for (const [name, original] of Object.entries(receipt.schemaHashes)) assert.equal(hash(fs.readFileSync(path.join(root, name))), original);
      receipt.success = true;
    } catch (error) { receipt.success = false; receipt.failure = redact(error.message); throw error; }
    finally {
      let shutdownFailure;
      if (supervisor) {
        let accepted = false;
        try { if (processRecord && supervisor.exitCode === null) { sql('SHUTDOWN;'); accepted = true; } } catch (error) { receipt.shutdown = redact(error.message); }
        // SHUTDOWN acceptance is not process completion. Let the native child
        // flush before closing the pipe, which is only the forced-stop fallback.
        if (accepted && supervisor.exitCode === null) await new Promise(resolve => {
          const done = () => { clearTimeout(timer); supervisor.off('close', done); resolve(); };
          const timer = setTimeout(done, 8000); supervisor.once('close', done);
        });
        if (!supervisor.stdin.destroyed) supervisor.stdin.end();
        if (supervisor.exitCode === null) await new Promise(resolve => supervisor.once('close', resolve));
        receipt.supervisorExit = supervisor.exitCode;
        if (receipt.success && supervisor.exitCode !== 0) shutdownFailure = new Error('Owned MySQL did not stop cleanly');
      }
      let aliasFailure;
      if (nativeDirectory) {
        try {
          assert.ok(fs.lstatSync(nativeDirectory).isSymbolicLink());
          assert.equal(normalized(fs.realpathSync(nativeDirectory)), normalized(directory));
          junctionCommand('[System.IO.Directory]::Delete(' + psLiteral(nativeDirectory) + ')');
          assert.ok(fs.statSync(directory).isDirectory(), 'Physical evidence directory must remain');
          receipt.asciiAliasRemoved = !fs.existsSync(nativeDirectory);
          assert.equal(receipt.asciiAliasRemoved, true, 'Only the owned temporary alias must be removed');
        } catch (error) { aliasFailure = error; receipt.aliasCleanupFailure = redact(error.message); }
      }
      const teardownFailure = aliasFailure ?? shutdownFailure;
      if (teardownFailure) { receipt.success = false; receipt.teardownFailure = redact(teardownFailure.message); }
      writeJson(path.join(directory, 'receipt.json'), receipt);
      console.log('Retained isolated MySQL receipt: ' + path.join(directory, 'receipt.json'));
      if (teardownFailure) throw new Error('Owned instance teardown failed: ' + redact(teardownFailure.message));
    }
  });
}
