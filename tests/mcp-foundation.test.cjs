"use strict";
/** Public MCP transport, OAuth and original work-center contracts.
 * Uses declared packages and in-process HTTP; no Rental source, database or listener. */
const assert = require("node:assert/strict");
const { test, after } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire, registerHooks, isBuiltin } = require("node:module");
const { pathToFileURL, fileURLToPath } = require("node:url");
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
const outputDirectory = path.join(outputParent, `foundation-${owner}-${process.pid}`);
let ownsOutput = false;
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
const { createControllerSourceLoader } = require(path.join(root, "scripts/controller-sources.cjs"));
const sourceResolver = createControllerSourceLoader(root, dependencyDirectory, { controllerRoots: [] });
const formalSource = specifier => source(sourceResolver.resolveSource(__filename, specifier, true));
const sourceCache = new Map();
function source(relative) {
  const file = path.resolve(root, relative);
  if (sourceCache.has(file)) return sourceCache.get(file);
  const javascript = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
    fileName: file,
  }).outputText;
  const module = { exports: {} };
  sourceCache.set(file, module.exports);
  const localRequire = specifier => {
    const dependency = sourceResolver.resolveSource(file, specifier, true);
    return dependency ? source(path.relative(root, dependency)) : installed(specifier);
  };
  try {
    new Function("require", "module", "exports", javascript)(localRequire, module, module.exports);
    sourceCache.set(file, module.exports);
    return module.exports;
  } catch (error) { sourceCache.delete(file); throw error; }
}
const { createProtectedMcpEndpoint, createIntrospectionVerifier, ResourceAuthorizationError } = source("packages/mcp-server/src/index.ts");
test("source loader resolves public exports without reading the retired API or selecting a schema", async () => {
  const originalRead = fs.readFileSync, originalList = fs.readdirSync;
  const rejectLegacy = file => assert.ok(!["apps/api/src", "apps/api/prisma"].some(directory =>
    path.resolve(String(file)).startsWith(path.join(root, directory))), "resolve-only loader must not read the retired host source/schema");
  try {
    fs.readFileSync = function (file, ...args) { rejectLegacy(file); return originalRead.call(this, file, ...args); };
    fs.readdirSync = function (file, ...args) { rejectLegacy(file); return originalList.call(this, file, ...args); };
    const loader = createControllerSourceLoader(root, dependencyDirectory);
    assert.deepEqual(loader.files, []);
    assert.ok(loader.resolveSource(__filename, "@rental-os/platform-contracts/ai-work-center", true).endsWith("ai-work-center.ts"));
    assert.throws(() => loader.resolveSource(__filename, "@rental-os/platform-contracts/src/index", true), /未声明/);
    assert.throws(() => loader.resolveSource(__filename, "@rental-os/missing-package", true), /缺少正式包/);
    assert.throws(() => loader.load(path.resolve(root, "../outside.ts")), /越出/);
    assert.throws(() => createControllerSourceLoader(root, dependencyDirectory, { controllerRoots: ["missing-source"] }), /缺失/);
    assert.throws(() => createControllerSourceLoader(root, dependencyDirectory, { schemaPath: "../outside.prisma" }), /越出/);
    await assert.rejects(loader.prepareOfflinePrisma(), /显式选择 schemaPath/);
  } finally { fs.readFileSync = originalRead; fs.readdirSync = originalList; }
});
// Harness discovery has its own source prerequisite, independent of the official SDK.
function harnessConnection() {
  const connectionSource = "clients/harness-plugin/src/connection.ts";
  assert.ok(fs.existsSync(path.join(root, connectionSource)),
    `MCP test prerequisite Harness connection source is missing: ${connectionSource}`);
  return source(connectionSource);
}
const resource = "https://mcp.example.invalid/mcp";
const issuer = "https://auth.example.invalid/";
const metadata = "https://mcp.example.invalid/.well-known/oauth-protected-resource/mcp";
const config = { enabled: true, resourceUrl: resource, authorizationServerUrl: issuer, allowedOrigins: [], maxRequestBytes: 4096, authorizationTimeoutMs: 1000 };
const inspection = { resourceUrl: resource, authorizationServerUrl: issuer, timeoutMs: 1000, maxMetadataBytes: 4096 };
const signal = () => new AbortController().signal;
const verified = () => ({ subject: "synthetic-actor", clientId: "synthetic-client", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 60, resource });
const body = (method, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params: {} });
function post(text, headers = {}) {
  return new Request(resource, { method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", ...headers }, body: text });
}
function fixture(t, verify = async () => verified(), overrides = {}) {
  const endpoint = createProtectedMcpEndpoint({ ...config, ...overrides }, { verifyAccessToken: verify });
  t.after(() => endpoint.close());
  return endpoint;
}
function inProcess(endpoint, calls = []) {
  return async (input, init) => {
    const request = new Request(input, init);
    calls.push(request);
    return endpoint.fetch(request);
  };
}





async function verifyPublicClientAuthorization(t, create) {
  const { startAuthorization } = installed("@modelcontextprotocol/client");
  const { OAuthError } = installed("@modelcontextprotocol/server");
  const authorizationEndpoint = "https://auth.example.invalid/authorize";
  const scopes = ["rental.catalog.read"];
  const metadata = { issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: "https://auth.example.invalid/token",
    response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"] };
  const started = await startAuthorization(issuer, { metadata, clientInformation: { client_id: "registered-fixture" },
    redirectUrl: "http://127.0.0.1:49153/rental/callback", resource, scope: scopes.join(" "), state: "synthetic-state" });
  const request = () => new Request(started.authorizationUrl);
  let registered = { clientId: "registered-fixture", revision: 1, enabled: true, expiresAt: Date.now() / 1000 + 60,
    redirectUris: ["http://127.0.0.1:49152/rental/callback"], scopes };
  let visits = 0, changeOnSecond, hold;
  const originalRead = async (clientId, signal) => {
    assert.equal(clientId, "registered-fixture"); visits++;
    if (hold) { hold.signal = signal; hold.started.resolve(); await hold.release.promise; }
    if (visits % 2 === 0 && changeOnSecond) changeOnSecond();
    return registered;
  };
  const registrations = { read: originalRead };
  const configuration = { authorizationEndpoint, resourceUrl: resource, allowedScopes: scopes, timeoutMs: 1000 };
  const validate = create(configuration, registrations);
  registrations.read = async () => { throw new Error("Replaced provider must not run"); };
  const observed = await validate(request(), signal());
  assert.deepEqual(observed, { clientId: registered.clientId, clientRevision: 1, redirectUri: "http://127.0.0.1:49153/rental/callback",
    resource, scopes, state: "synthetic-state", codeChallenge: started.authorizationUrl.searchParams.get("code_challenge") });
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(Object.isFrozen(observed.scopes), true);
  assert.equal(visits, 2, "current registration is rechecked, not cached as an issuance permit");
  assert.doesNotMatch(JSON.stringify(observed), /codeVerifier|expiresAt|redirectUris|enabled|token/);
  const editRequest = change => { const url = new URL(started.authorizationUrl); change(url); return new Request(url); };
  const invalid = [
    url => url.searchParams.set("response_type", "token"),
    url => url.searchParams.set("code_challenge_method", "plain"),
    url => url.searchParams.delete("code_challenge"),
    url => url.searchParams.set("code_challenge", "a".repeat(42) + "B"),
    url => url.searchParams.set("scope", scopes[0] + " " + scopes[0]),
    url => url.searchParams.set("scope", "rental.order.commit"),
    url => url.searchParams.set("resource", "https://other.example.invalid/mcp"),
    url => url.searchParams.append("resource", resource),
    url => url.searchParams.append("state", "other-state"),
    url => url.searchParams.set("state", ""),
    url => url.searchParams.set("state", "x".repeat(1025)),
    url => url.searchParams.set("actor", "forged"),
    url => url.searchParams.set("workspaceId", "forged"),
    url => url.searchParams.set("client_secret", "synthetic-private-secret"),
    url => { url.pathname = "/other-authorize"; },
  ];
  const beforeInvalid = visits;
  for (const change of invalid) await assert.rejects(() => validate(editRequest(change), signal()), error => error instanceof OAuthError);
  assert.equal(visits, beforeInvalid, "bad protocol and self-authorizing fields never reach registration");
  for (const uri of ["http://localhost:49153/rental/callback", "http://192.168.0.1/rental/callback", "dsh://callback",
    "http://127.0.0.1:49153/other", "http://127.0.0.1:49153/rental/callback/", "http://127.0.0.1:49153/rental/callback?state=other",
    "http://127.0.0.1:49153/rental/callback#x", "https://other.example.invalid/callback"]) {
    await assert.rejects(() => validate(editRequest(url => url.searchParams.set("redirect_uri", uri)), signal()), error => error instanceof OAuthError);
  }
  const baseline = registered;
  for (registered of [undefined, { ...baseline, enabled: false }, { ...baseline, expiresAt: 0 }, { ...baseline, clientId: "another" },
    { ...baseline, scopes: ["different.read"] }, { ...baseline, revision: 0 }, { ...baseline, redirectUris: ["http://localhost/callback"] }]) {
    await assert.rejects(() => validate(request(), signal()), error => error instanceof OAuthError);
  }
  registered = { ...baseline, redirectUris: ["http://[::1]:49152/rental/callback"] };
  assert.equal((await validate(editRequest(url => url.searchParams.set("redirect_uri", "http://[::1]:55000/rental/callback")), signal())).redirectUri,
    "http://[::1]:55000/rental/callback");
  await assert.rejects(() => validate(request(), signal()), error => error instanceof OAuthError);
  registered = { ...baseline, redirectUris: ["https://app.example.invalid/oauth/callback"] };
  const httpsRequest = () => editRequest(url => url.searchParams.set("redirect_uri", registered.redirectUris[0]));
  assert.equal((await validate(httpsRequest(), signal())).redirectUri, registered.redirectUris[0]);
  await assert.rejects(() => validate(editRequest(url => url.searchParams.set("redirect_uri", "https://app.example.invalid:8443/oauth/callback")), signal()));
  registered = baseline; visits = 0;
  changeOnSecond = () => { registered = Object.fromEntries(Object.entries(baseline).reverse()); };
  assert.deepEqual(await validate(request(), signal()), observed, "registration key order does not change its current facts");
  assert.equal(visits, 2);
  const multiple = { ...baseline, scopes: [...baseline.scopes, "rental.order.read"],
    redirectUris: [...baseline.redirectUris, "http://127.0.0.1:49152/other-callback"] };
  for (const change of [row => ({ ...row, scopes: [...row.scopes].reverse() }),
    row => ({ ...row, redirectUris: [...row.redirectUris].reverse() }), row => ({ ...row, extra: true })]) {
    registered = multiple; visits = 0;
    changeOnSecond = () => { registered = change(multiple); };
    await assert.rejects(() => validate(request(), signal()), error => error instanceof OAuthError,
      "array order and extra registration facts still change the captured record");
  }
  registered = baseline;
  visits = 0;
  changeOnSecond = () => { registered = { ...baseline, revision: 2 }; };
  await assert.rejects(() => validate(request(), signal()), error => error instanceof OAuthError);
  registered = baseline; visits = 0;
  changeOnSecond = () => { registered = { ...baseline, enabled: false }; };
  await assert.rejects(() => validate(request(), signal()), error => error instanceof OAuthError);
  changeOnSecond = undefined; registered = baseline;
  let getterCalls = 0;
  registered = Object.defineProperty({ ...baseline }, "enabled", { enumerable: true, get() { getterCalls++; return true; } });
  await assert.rejects(() => validate(request(), signal()), error => error instanceof OAuthError);
  assert.equal(getterCalls, 0);
  registered = baseline;
  hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
  const controller = new AbortController();
  const pending = validate(request(), controller.signal);
  const outcome = pending.then(() => false, () => true);
  await hold.started.promise;
  const beforeAbort = visits;
  controller.abort();
  assert.equal(await outcome, true);
  assert.equal(hold.signal.aborted, true);
  hold.release.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(visits, beforeAbort, "cancelled registration read cannot recheck or issue after its late reply");
  hold = undefined;
  const failed = create(configuration, { read: async () => { throw new Error("synthetic-private-registration token SQL"); } });
  await assert.rejects(() => failed(request(), signal()), error => error instanceof OAuthError && !/synthetic-private|token|SQL/.test(error.message));
}

test("public client authorization precheck accepts SDK S256 and refuses unregistered or changed clients", async t => {
  await verifyPublicClientAuthorization(t, source("packages/mcp-server/src/public-client-authorization.ts").createPublicClientAuthorization);
});

async function verifyPersistentOAuthTokens(t, module, endpointModule, authorizationModule = source("packages/mcp-server/src/persistent-oauth-authorization.ts"),
  createService = source("packages/mcp-server/src/service.ts").createRentalMcpService) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  const { startAuthorization, exchangeAuthorization, refreshAuthorization } = installed("@modelcontextprotocol/client");
  const clientId = "persistent-client-fixture", scopes = ["rental.catalog.read"];
  const redirectUri = "http://127.0.0.1:49153/rental/callback";
  const metadata = { issuer, authorization_endpoint: "https://auth.example.invalid/authorize", token_endpoint: "https://auth.example.invalid/token",
    response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] };
  const started = await startAuthorization(issuer, { metadata, clientInformation: { client_id: clientId }, redirectUrl: redirectUri, resource });
  const now = Math.floor(Date.now() / 1000), codeText = "original-persistent-code-fixture";
  const grant = { id: "original-grant", subject: "original-subject", revision: 5, clientId, resource, scopes, expiresAt: now + 3600 };
  const code = { digest: module.oauthCredentialDigest(codeText), grantId: grant.id, subject: grant.subject, grantRevision: grant.revision, clientId, resource, scopes,
    redirectUri, codeChallengeMethod: "S256", codeChallenge: started.authorizationUrl.searchParams.get("code_challenge"),
    expiresAt: now + 60, consumedFamilyId: null };
  let state = { code: [code], family: [], access: [], refresh: [] }, tail = Promise.resolve();
  let transactions = 0, permitted = true, owner = true, currentReads = 0, withdrawOnSecond = false;
  let failInsert = false, loseCommit = false, holdCommit, accessReadRecord;
  // External transaction fixture only, NOT production persistence. Two service
  // instances share one serialized store; rollback and ambiguous commit differ.
  const store = { async transaction(consume, signal) {
    transactions++;
    const previous = tail, released = Promise.withResolvers(); tail = released.promise;
    await previous;
    const draft = structuredClone(state);
    const find = (table, key, value) => draft[table].find(row => row[key] === value);
    const insert = (table, key, value) => { assert.equal(find(table, key, value[key]), undefined); draft[table].push(structuredClone(value)); };
    const tx = {
      readCode: async digest => find("code", "digest", digest),
      readCodeForAuthorization: async id => find("code", "authorizationId", id),
      insertCode: async value => { assert.equal(find("code", "authorizationId", value.authorizationId), undefined); insert("code", "digest", value); },
      readRefresh: async digest => find("refresh", "digest", digest),
      readAccess: async digest => accessReadRecord ?? find("access", "digest", digest),
      readFamily: async id => find("family", "id", id),
      insertFamily: async value => insert("family", "id", value),
      consumeCode: async (digest, familyId) => { const row = find("code", "digest", digest); assert.equal(row.consumedFamilyId, null); row.consumedFamilyId = familyId; },
      consumeRefresh: async digest => { const row = find("refresh", "digest", digest); assert.equal(row.used, false); row.used = true; },
      insertAccess: async value => insert("access", "digest", value),
      insertRefresh: async value => { if (failInsert) throw new Error("synthetic-private-storage-failure"); insert("refresh", "digest", value); },
      revokeFamily: async id => { const row = find("family", "id", id); assert.ok(row); row.revoked = true; },
    };
    try {
      const result = await consume(tx);
      if (holdCommit) { holdCommit.signal = signal; holdCommit.started.resolve(); await holdCommit.release.promise; }
      state = draft;
      if (loseCommit) throw new Error("synthetic-private-unknown-commit");
      return result;
    } finally { released.resolve(); }
  } };
  const authority = { async current(grantId, caller, revision, _tx, signal) {
    assert.equal(signal.aborted, false); currentReads++;
    if (!permitted || withdrawOnSecond && currentReads % 2 === 0 || grantId !== grant.id || caller !== clientId || revision !== 2) return undefined;
    return grant;
  }, revocationOwner: async (grantId, caller) => owner && grantId === grant.id && caller === clientId };
  const configuration = { enabled: true, resourceUrl: resource, allowedScopes: scopes, accessTtlSeconds: 60, refreshTtlSeconds: 600 };
  const service = module.createPersistentOAuthTokenService(configuration, store, authority);
  const secondService = module.createPersistentOAuthTokenService(configuration, store, authority);
  const exchange = { clientId, clientRevision: 2, code: codeText, codeVerifier: started.codeVerifier, redirectUri, resource };
  const invalid = operation => assert.rejects(operation, error => error.code === "invalid_grant");
  const registrations = { read: async () => ({ clientId, revision: 2, enabled: permitted, expiresAt: now + 3600, redirectUris: [redirectUri], scopes }) };
  const tokenEndpoint = endpointModule.createOAuthTokenEndpoint({ enabled: true, tokenEndpoint: metadata.token_endpoint,
    revocationEndpoint: "https://auth.example.invalid/revoke", resourceUrl: resource, allowedOrigins: [], allowedScopes: scopes,
    timeoutMs: 1000, maxRequestBytes: 32768 }, registrations, service);
  const sdk = { metadata, clientInformation: { client_id: clientId }, resource,
    fetchFn: (input, init) => tokenEndpoint(new Request(input, init)) };
  const issued = await exchangeAuthorization(issuer, { ...sdk, authorizationCode: codeText, codeVerifier: started.codeVerifier, redirectUri });
  assert.match(issued.access_token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(issued.refresh_token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.token_type, "Bearer"); assert.equal(issued.scope, scopes[0]);
  assert.ok(issued.expires_in > 0 && issued.expires_in <= 60);
  assert.equal(state.family.length, 1); assert.equal(state.access.length, 1); assert.equal(state.refresh.length, 1);
  assert.equal(state.code[0].consumedFamilyId, state.family[0].id);
  assert.equal(state.refresh[0].digest, module.oauthCredentialDigest(issued.refresh_token));
  assert.ok(state.family[0].expiresAt <= now + 600 && state.family[0].expiresAt <= grant.expiresAt);
  assert.ok(!JSON.stringify(state).includes(issued.access_token) && !JSON.stringify(state).includes(issued.refresh_token));
  const renewed = await refreshAuthorization(issuer, { ...sdk, refreshToken: issued.refresh_token });
  assert.notEqual(renewed.refresh_token, issued.refresh_token);
  assert.equal(state.refresh[0].used, true); assert.equal(state.refresh[1].used, false);
  assert.equal(state.family.length, 1);
  let readGrant = grant, accessReads = 0, revokeOnRead = false;
  const verifier = module.createPersistentOAuthResourceVerifier(configuration, store, { current: async () => {
    accessReads++;
    if (revokeOnRead && accessReads % 2 === 0) return undefined;
    return permitted ? readGrant : undefined;
  } });
  const readOptions = () => ({ signal: signal() });
  const beforeVerify = structuredClone(state);
  assert.deepEqual(await verifier.verifyAccessToken(renewed.access_token, readOptions()), {
    subject: grant.subject, clientId, resource, scopes, expiresAt: state.access[1].expiresAt,
  });
  assert.deepEqual(state, beforeVerify, "resource verification never issues or changes tokens");
  assert.equal(accessReads, 2);
  const families = state.family;
  state.family = [];
  try {
    await assert.rejects(() => verifier.verifyAccessToken(renewed.access_token, readOptions()), error => error.kind === "unavailable",
      "an access record with missing family evidence is unavailable, not proof of invalid authorization");
  } finally { state.family = families; }
  for (const changed of [{ ...grant, subject: "different-subject" }, { ...grant, clientId: "different-client" },
    { ...grant, revision: 6 }, { ...grant, resource: "https://other.example.invalid/mcp" }, { ...grant, scopes: ["rental.other.read"] }]) {
    readGrant = changed;
    await assert.rejects(() => verifier.verifyAccessToken(renewed.access_token, readOptions()), error => error.kind === "invalid");
  }
  readGrant = grant;
  const protectedEndpoint = createProtectedMcpEndpoint(config, verifier);
  try {
    const sdkClient = new Client({ name: "persistent-as-client-fixture", version: "1" }, { capabilities: {} });
    try {
      await sdkClient.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(protectedEndpoint),
        authProvider: { token: async () => renewed.access_token }, onInsufficientScope: "throw" }));
      assert.deepEqual((await sdkClient.listTools()).tools, []);
    } finally { await sdkClient.close(); }
  } finally { await protectedEndpoint.close(); }
  revokeOnRead = true; accessReads = 0;
  await assert.rejects(() => verifier.verifyAccessToken(renewed.access_token, readOptions()), error => error.kind === "invalid");
  assert.equal(accessReads, 2, "second current grant read catches withdrawn authorization");
  revokeOnRead = false;
  let getterCalls = 0;
  // Inject at the durable read, not before structuredClone in the transaction
  // fixture: that clone would execute the getter and erase the invalid record.
  accessReadRecord = Object.defineProperty({ ...state.access[1] }, "expiresAt", { enumerable: true,
    get() { getterCalls++; return now + 60; } });
  try {
    await assert.rejects(() => verifier.verifyAccessToken(renewed.access_token, readOptions()), error => error.kind === "unavailable");
    assert.equal(getterCalls, 0);
  } finally { accessReadRecord = undefined; }
  await invalid(() => secondService.refresh({ clientId, clientRevision: 2, refreshToken: issued.refresh_token, resource }, signal()));
  assert.equal(state.family[0].revoked, true, "reuse revocation commits even though invalid_grant is returned");
  await assert.rejects(() => verifier.verifyAccessToken(renewed.access_token, readOptions()), error => error.kind === "invalid");
  await invalid(() => service.refresh({ clientId, clientRevision: 2, refreshToken: renewed.refresh_token, resource }, signal()));
  const reset = () => { state = { code: [structuredClone(code)], family: [], access: [], refresh: [] }; currentReads = 0; };
  reset();
  const concurrentCodes = await Promise.allSettled([service.exchangeCode(exchange, signal()), secondService.exchangeCode(exchange, signal())]);
  assert.equal(concurrentCodes.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(state.family.length, 1); assert.equal(state.access.length, 1); assert.equal(state.refresh.length, 1);
  assert.equal(state.family[0].revoked, true, "replayed code revokes its previously issued tokens without issuing another family");
  reset(); const first = await service.exchangeCode(exchange, signal());
  const refreshInput = { clientId, clientRevision: 2, refreshToken: first.refresh_token, resource };
  const concurrentRefresh = await Promise.allSettled([service.refresh(refreshInput, signal()), secondService.refresh(refreshInput, signal())]);
  assert.equal(concurrentRefresh.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(state.family.length, 1); assert.equal(state.refresh.length, 2);
  assert.equal(state.family[0].revoked, true);
  for (const replay of ["code", "refresh"]) {
    reset(); const previouslyIssued = await service.exchangeCode(exchange, signal());
    const replayInput = { clientId, clientRevision: 2, refreshToken: previouslyIssued.refresh_token, resource };
    if (replay === "refresh") await service.refresh(replayInput, signal());
    const replayCall = (client = clientId, revision = 2, target = resource) => replay === "code"
      ? service.exchangeCode({ ...exchange, clientId: client, clientRevision: revision, resource: target }, signal())
      : service.refresh({ ...replayInput, clientId: client, clientRevision: revision, resource: target }, signal());
    const beforeReplay = structuredClone(state);
    await invalid(() => replayCall("other-client"));
    await invalid(() => replayCall(clientId, 2, "https://other.example.invalid/mcp"));
    assert.deepEqual(state, beforeReplay, "foreign client/resource cannot use a stored credential to revoke another family");
    owner = false;
    try { await invalid(() => replayCall()); assert.deepEqual(state, beforeReplay); }
    finally { owner = true; }
    permitted = false;
    try {
      await invalid(() => replayCall(clientId, 9));
      assert.equal(state.family[0].revoked, true, "proven credential reuse revokes its family even without current issuance permission or registration revision");
      assert.equal(state.access.length, beforeReplay.access.length);
      assert.equal(state.refresh.length, beforeReplay.refresh.length);
    } finally { permitted = true; }
    await assert.rejects(() => verifier.verifyAccessToken(previouslyIssued.access_token, readOptions()), error => error.kind === "invalid");
  }
  reset(); const revocable = await service.exchangeCode(exchange, signal());
  owner = false;
  await service.revoke({ clientId: "other-client", clientRevision: 2, token: revocable.refresh_token }, signal());
  assert.equal(state.family[0].revoked, false, "foreign client revocation is indistinguishable from unknown, without changing the family");
  owner = true; permitted = false;
  await service.revoke({ clientId, clientRevision: 2, token: revocable.refresh_token, tokenTypeHint: "access_token" }, signal());
  assert.equal(state.family[0].revoked, true, "disabled clients revoke without a current issuance permit and wrong hints do not hide tokens");
  permitted = true;
  const beforeUnknown = structuredClone(state);
  await service.revoke({ clientId, clientRevision: 2, token: "unknown-token" }, signal());
  assert.deepEqual(state, beforeUnknown);
  reset(); const beforeRejected = structuredClone(state);
  for (const changed of [{ ...exchange, clientId: "other" }, { ...exchange, clientRevision: 9 },
    { ...exchange, codeVerifier: "=".repeat(43) }, { ...exchange, resource: "https://other.example.invalid/mcp" },
    { ...exchange, redirectUri: "http://127.0.0.1:55000/rental/callback" }]) {
    await invalid(() => service.exchangeCode(changed, signal())); assert.deepEqual(state, beforeRejected);
  }
  state.code[0].expiresAt = now - 1;
  await invalid(() => service.exchangeCode(exchange, signal()));
  reset(); failInsert = true;
  await assert.rejects(() => service.exchangeCode(exchange, signal()));
  assert.deepEqual(state, beforeRejected, "known transaction failure rolls back consumption and partial inserts in the fixture");
  failInsert = false; withdrawOnSecond = true; currentReads = 0;
  await assert.rejects(() => service.exchangeCode(exchange, signal()));
  assert.deepEqual(state, beforeRejected, "current grant loss before commit prevents partial issuance");
  withdrawOnSecond = false;
  reset(); loseCommit = true; const beforeTransactions = transactions;
  await assert.rejects(() => service.exchangeCode(exchange, signal()));
  assert.equal(transactions, beforeTransactions + 1);
  assert.equal(state.family.length, 1); assert.notEqual(state.code[0].consumedFamilyId, null);
  loseCommit = false;
  reset(); holdCommit = { started: Promise.withResolvers(), release: Promise.withResolvers() };
  const controller = new AbortController(), late = service.exchangeCode(exchange, controller.signal);
  const result = late.then(value => ({ value }), error => ({ error }));
  try {
    await holdCommit.started.promise; controller.abort(); holdCommit.release.resolve();
    assert.ok((await result).error);
    assert.equal(state.family.length, 1, "cancel after transaction work can still commit; no token is released or retry attempted");
  } finally { holdCommit.release.resolve(); await result; holdCommit = undefined; }
  state = { code: [], family: [], access: [], refresh: [] };
  const authorizationInput = Object.freeze({ clientId, clientRevision: 2, resource, scopes: Object.freeze([...scopes]),
    redirectUri, codeChallenge: started.authorizationUrl.searchParams.get("code_challenge"), state: "original-state" });
  const consent = { kind: "approved", id: "original-consent", revision: 7, expiresAt: now + 60, request: authorizationInput, grant };
  let currentConsent = consent, consentReads = 0, changeConsentOnSecond = false, reorderConsentOnSecond = false;
  const consentAuthority = { current: async () => {
    consentReads++;
    if (changeConsentOnSecond && consentReads % 2 === 0) return undefined;
    if (reorderConsentOnSecond && consentReads % 2 === 0) return Object.fromEntries(Object.entries({ ...currentConsent,
      request: Object.fromEntries(Object.entries(currentConsent.request).reverse()),
      grant: Object.fromEntries(Object.entries(currentConsent.grant).reverse()) }).reverse());
    return currentConsent;
  } };
  const authConfig = { enabled: true, resourceUrl: resource, allowedScopes: scopes, codeTtlSeconds: 60 };
  const authorizer = authorizationModule.createPersistentOAuthAuthorization(authConfig, store, consentAuthority);
  const anotherAuthorizer = authorizationModule.createPersistentOAuthAuthorization(authConfig, store, consentAuthority);
  const browser = new Request(metadata.authorization_endpoint);
  const authorizationOrder = { ...consent, request: Object.fromEntries(Object.entries(authorizationInput).reverse()) };
  currentConsent = authorizationOrder; reorderConsentOnSecond = true;
  const authorized = await authorizer.authorize(authorizationInput, browser, signal());
  currentConsent = consent; reorderConsentOnSecond = false;
  assert.equal(authorized.kind, "code"); assert.match(authorized.code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(state.code.length, 1); assert.equal(state.code[0].digest, module.oauthCredentialDigest(authorized.code));
  assert.equal(state.code[0].authorizationId, consent.id);
  assert.equal(state.code[0].authorizationRevision, consent.revision);
  assert.ok(!JSON.stringify(state).includes(authorized.code));
  const originalIssued = await service.exchangeCode({ ...exchange, code: authorized.code }, signal());
  assert.match(originalIssued.access_token, /^[A-Za-z0-9_-]{43}$/);
  await assert.rejects(() => anotherAuthorizer.authorize(authorizationInput, browser, signal()));
  assert.equal(state.code.length, 1, "repeated original consent never issues a second code");
  state = { code: [], family: [], access: [], refresh: [] };
  const concurrentAuthorization = await Promise.allSettled([authorizer.authorize(authorizationInput, browser, signal()),
    anotherAuthorizer.authorize(authorizationInput, browser, signal())]);
  assert.equal(concurrentAuthorization.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(state.code.length, 1);
  for (currentConsent of [undefined, { ...consent, request: { ...authorizationInput, state: "other" } },
    { ...consent, request: { ...authorizationInput, extra: "not-authorized" } },
    { ...consent, request: { ...authorizationInput, scopes: [...scopes, "rental.other.read"] } },
    { ...consent, request: { ...authorizationInput, clientRevision: 3 } },
    { ...consent, grant: { ...grant, clientId: "other" } }, { ...consent, expiresAt: 1 }]) {
    state = { code: [], family: [], access: [], refresh: [] };
    await assert.rejects(() => authorizer.authorize(authorizationInput, browser, signal()));
    assert.equal(state.code.length, 0);
  }
  currentConsent = { kind: "denied", error: "access_denied" };
  assert.deepEqual(await authorizer.authorize(authorizationInput, browser, signal()), currentConsent);
  assert.equal(state.code.length, 0);
  currentConsent = consent; consentReads = 0; changeConsentOnSecond = true;
  await assert.rejects(() => authorizer.authorize(authorizationInput, browser, signal()));
  assert.equal(state.code.length, 0, "current consent loss rolls back the fixture's code insertion");
  changeConsentOnSecond = false;
  loseCommit = true; const beforeCodeCommit = transactions;
  await assert.rejects(() => authorizer.authorize(authorizationInput, browser, signal()));
  assert.equal(transactions, beforeCodeCommit + 1); assert.equal(state.code.length, 1);
  loseCommit = false;
  await assert.rejects(() => authorizer.authorize(authorizationInput, browser, signal()));
  assert.equal(state.code.length, 1, "unknown original code commit cannot be resolved by reissuing");
  state = { code: [], family: [], access: [], refresh: [] };
  holdCommit = { started: Promise.withResolvers(), release: Promise.withResolvers() };
  const cancelled = new AbortController();
  const pendingCode = authorizer.authorize(authorizationInput, browser, cancelled.signal);
  const stoppedCode = pendingCode.then(value => ({ value }), error => ({ error }));
  try {
    await holdCommit.started.promise;
    cancelled.abort(); holdCommit.release.resolve();
    assert.ok((await stoppedCode).error);
    assert.equal(state.code.length, 1, "cancel after original commit suppresses delivery without undoing issuance");
  } finally { holdCommit.release.resolve(); await stoppedCode; holdCommit = undefined; }
  state = { code: [], family: [], access: [], refresh: [] };
  currentConsent = consent; consentReads = 0;
  const serviceMetadata = { ...metadata, grant_types_supported: ["authorization_code", "refresh_token"],
    revocation_endpoint: "https://auth.example.invalid/revoke", revocation_endpoint_auth_methods_supported: ["none"], scopes_supported: scopes };
  const serviceConfig = { enabled: true, resource: config,
    authorization: { issuer, authorizationEndpoint: metadata.authorization_endpoint, tokenEndpoint: metadata.token_endpoint,
      revocationEndpoint: serviceMetadata.revocation_endpoint, allowedScopes: scopes, allowedOrigins: [], timeoutMs: 1000, maxMetadataBytes: 4096 },
    tokens: { tokenEndpoint: metadata.token_endpoint, revocationEndpoint: serviceMetadata.revocation_endpoint, resourceUrl: resource,
      allowedScopes: scopes, allowedOrigins: [], timeoutMs: 1000, maxRequestBytes: 32768 },
    lifetimes: { codeTtlSeconds: 60, accessTtlSeconds: 60, refreshTtlSeconds: 600 } };
  const absent = createService(serviceConfig);
  try {
    for (const url of [resource, metadata.authorization_endpoint, metadata.token_endpoint, serviceMetadata.revocation_endpoint,
      "https://auth.example.invalid/.well-known/oauth-authorization-server"]) {
      assert.equal((await absent.fetch(new Request(url))).status, url === resource ? 405 : 503);
    }
  } finally { await absent.close(); }
  assert.throws(() => createService({ ...serviceConfig, resource: { ...config, authorizationServerUrl: "https://other.example.invalid/" } }), /share exact/);
  assert.throws(() => createService({ ...serviceConfig, authorization: { ...serviceConfig.authorization, authorizationEndpoint: resource } }), /distinct/);
  const composed = createService(serviceConfig, { store, registrations, metadata: { read: async () => serviceMetadata },
    consent: consentAuthority, issuance: authority, access: { current: async () => permitted ? grant : undefined } });
  t.after(() => composed.close());
  try {
    const discovery = await composed.fetch(new Request("https://auth.example.invalid/.well-known/oauth-authorization-server"));
    assert.equal(discovery.status, 200); assert.deepEqual(await discovery.json(), serviceMetadata);
    const attempt = await startAuthorization(issuer, { metadata: serviceMetadata, clientInformation: { client_id: clientId },
      redirectUrl: redirectUri, resource, scope: scopes.join(" "), state: "composed-original-state" });
    currentConsent = { ...consent, id: "composed-original-consent", request: { ...authorizationInput,
      codeChallenge: attempt.authorizationUrl.searchParams.get("code_challenge"), state: attempt.authorizationUrl.searchParams.get("state") } };
    const callback = await composed.fetch(new Request(attempt.authorizationUrl));
    assert.equal(callback.status, 303);
    const callbackUrl = new URL(callback.headers.get("Location"));
    assert.equal(callbackUrl.searchParams.get("state"), currentConsent.request.state); assert.equal(callbackUrl.searchParams.get("iss"), issuer);
    const composedSdk = { metadata: serviceMetadata, clientInformation: { client_id: clientId }, resource,
      fetchFn: (input, init) => composed.fetch(new Request(input, init)) };
    const credential = await exchangeAuthorization(issuer, { ...composedSdk, authorizationCode: callbackUrl.searchParams.get("code"),
      codeVerifier: attempt.codeVerifier, redirectUri });
    const rotated = await refreshAuthorization(issuer, { ...composedSdk, refreshToken: credential.refresh_token });
    const protocol = new Client({ name: "composed-original-service-test", version: "1" }, { capabilities: {} });
    try {
      await protocol.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(composed),
        authProvider: { token: async () => rotated.access_token }, onInsufficientScope: "throw" }));
      assert.deepEqual((await protocol.listTools()).tools, []);
    } finally { await protocol.close(); }
    const revoked = await composed.fetch(new Request(serviceMetadata.revocation_endpoint, { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, token: rotated.refresh_token }) }));
    assert.equal(revoked.status, 200); assert.equal(state.family[0].revoked, true);
    assert.equal((await composed.fetch(post(body("tools/list"), { Authorization: `Bearer ${rotated.access_token}` }))).status, 401);
    const closing = composed.close(); assert.equal(composed.close(), closing); await closing;
    assert.equal((await composed.fetch(new Request(metadata.authorization_endpoint))).status, 503);
    const consentWait = { started: Promise.withResolvers(), release: Promise.withResolvers(), settled: Promise.withResolvers() };
    let consentSignal;
    const shuttingDown = createService(serviceConfig, { store, registrations, metadata: { read: async () => serviceMetadata },
      issuance: authority, access: { current: async () => grant }, consent: { current: async (_input, _request, _tx, signal) => {
        consentSignal = signal; consentWait.started.resolve(); await consentWait.release.promise;
        consentWait.settled.resolve(); return currentConsent;
      } } });
    const beforeShutdown = structuredClone(state);
    try {
      const pending = shuttingDown.fetch(new Request(attempt.authorizationUrl));
      await consentWait.started.promise;
      const closed = shuttingDown.close(); assert.equal(shuttingDown.close(), closed);
      assert.equal((await pending).status, 503); await closed;
      assert.equal(consentSignal.aborted, true);
      consentWait.release.resolve(); await consentWait.settled.promise;
      await tail;
      assert.deepEqual(state, beforeShutdown, "late consent after service close cannot persist a code or revive authorization");
      assert.equal((await shuttingDown.fetch(new Request(metadata.authorization_endpoint))).status, 503);
    } finally { consentWait.release.resolve(); await shuttingDown.close(); }
  } finally { await composed.close(); }
}

test("persistent OAuth token lifecycle serializes code consumption and refresh reuse without retrying unknown commits", async t => {
  await verifyPersistentOAuthTokens(t, source("packages/mcp-server/src/persistent-oauth-tokens.ts"), source("packages/mcp-server/src/oauth-token-endpoint.ts"));
});

async function verifyAuthorizationCodeBinding(t, check, ErrorType) {
  const { startAuthorization } = installed("@modelcontextprotocol/client");
  const { createHash } = require("node:crypto");
  const started = await startAuthorization(issuer, { metadata: { issuer, authorization_endpoint: "https://auth.example.invalid/authorize",
    token_endpoint: "https://auth.example.invalid/token", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] },
    clientInformation: { client_id: "binding-client" }, redirectUrl: "http://127.0.0.1:49153/rental/callback", resource });
  const input = { clientId: "binding-client", clientRevision: 3, code: "original-code", codeVerifier: started.codeVerifier,
    redirectUri: "http://127.0.0.1:49153/rental/callback", resource };
  let getterCalls = 0;
  const original = { clientId: input.clientId, resource, redirectUri: input.redirectUri,
    codeChallengeMethod: "S256", codeChallenge: started.authorizationUrl.searchParams.get("code_challenge") };
  const privateRecord = Object.defineProperty({ ...original }, "internal_secret", { enumerable: true,
    get() { getterCalls++; return "synthetic-private"; } });
  const before = JSON.stringify(original), inputBefore = JSON.stringify(input);
  assert.equal(check(input, privateRecord), undefined);
  assert.equal(getterCalls, 0);
  assert.equal(JSON.stringify(original), before); assert.equal(JSON.stringify(input), inputBefore);
  for (const verifier of ["a".repeat(43), "~".repeat(128)]) {
    check({ ...input, codeVerifier: verifier }, { ...original, codeChallenge: createHash("sha256").update(verifier).digest("base64url") });
  }
  const rejected = action => assert.throws(action, error => error instanceof ErrorType
    && error.code === "invalid_grant" && !/binding-client|original-code|synthetic-private/.test(error.message));
  for (const changed of [{ ...input, clientId: "other" }, { ...input, resource: "https://other.example.invalid/mcp" },
    { ...input, redirectUri: "http://127.0.0.1:55000/rental/callback" }, { ...input, codeVerifier: "a".repeat(42) },
    { ...input, codeVerifier: "a".repeat(129) }, { ...input, codeVerifier: "=".repeat(43) },
    { ...input, codeVerifier: "different-verifier-" + "a".repeat(43) }]) rejected(() => check(changed, original));
  for (const changed of [undefined, null, { ...original, clientId: "other" }, { ...original, codeChallengeMethod: "plain" },
    { ...original, codeChallenge: "a".repeat(42) + "B" }, { ...original, codeChallenge: "a".repeat(44) },
    Object.defineProperty({ ...original }, "codeChallenge", { enumerable: true, get() { getterCalls++; return original.codeChallenge; } }),
    Object.create(original)]) rejected(() => check(input, changed));
  assert.equal(getterCalls, 0);
}

test("authorization code binding checks original S256 and exact client resource callback without consuming", async t => {
  await verifyAuthorizationCodeBinding(t, source("packages/mcp-server/src/authorization-code-binding.ts").assertAuthorizationCodeBinding,
    source("packages/mcp-server/src/oauth-token-endpoint.ts").OAuthTokenRequestError);
});

async function verifyAuthorizationEndpoint(t, create) {
  const { startAuthorization } = installed("@modelcontextprotocol/client");
  const endpoint = "https://auth.example.invalid/authorize", redirectUri = "http://127.0.0.1:49153/rental/callback";
  const clientId = "registered-authorization-fixture", scopes = ["rental.catalog.read"];
  const configuration = { enabled: true, issuer, authorizationEndpoint: endpoint, resourceUrl: resource,
    allowedScopes: scopes, allowedOrigins: [], timeoutMs: 1000 };
  const metadata = { issuer, authorization_endpoint: endpoint, token_endpoint: "https://auth.example.invalid/token",
    response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] };
  const started = await startAuthorization(issuer, { metadata, clientInformation: { client_id: clientId },
    redirectUrl: redirectUri, resource, scope: scopes.join(" "), state: "state-which-must-not-be-logged" });
  const request = () => new Request(started.authorizationUrl, { headers: { Cookie: "original-web-fixture" } });
  const baseline = { clientId, revision: 3, enabled: true, expiresAt: Date.now() / 1000 + 60,
    redirectUris: ["http://127.0.0.1:49152/rental/callback"], scopes };
  let registration = baseline, reads = 0, calls = 0, outcome = { kind: "code", code: "original-code" }, hold;
  const registry = { read: async () => { reads++; return registration; } };
  const original = { async authorize(input, browserRequest, signal) {
    calls++;
    assert.equal(Object.isFrozen(input), true);
    assert.equal(Object.isFrozen(input.scopes), true);
    assert.equal(input.clientRevision, 3);
    assert.equal(input.redirectUri, redirectUri);
    assert.equal(input.resource, resource);
    assert.equal(input.codeChallenge, started.authorizationUrl.searchParams.get("code_challenge"));
    assert.equal(browserRequest.headers.get("cookie"), "original-web-fixture");
    if (hold) { hold.signal = signal; hold.started.resolve(); await hold.release.promise; }
    return outcome;
  } };
  const handle = create(configuration, registry, original);
  original.authorize = async () => { throw new Error("Replaced AS method must not run"); };
  const approved = await handle(request());
  assert.equal(approved.status, 303);
  assert.equal(approved.headers.get("cache-control"), "no-store");
  assert.equal(approved.headers.get("referrer-policy"), "no-referrer");
  assert.equal(await approved.text(), "");
  const callback = new URL(approved.headers.get("location"));
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.deepEqual(Object.fromEntries(callback.searchParams), { code: "original-code", state: "state-which-must-not-be-logged", iss: issuer });
  assert.equal(calls, 1); assert.equal(reads, 4);
  outcome = { kind: "denied", error: "access_denied" };
  const denied = await handle(request());
  assert.equal(denied.status, 303);
  assert.deepEqual(Object.fromEntries(new URL(denied.headers.get("location")).searchParams),
    { error: "access_denied", state: "state-which-must-not-be-logged", iss: issuer });
  const beforeInvalid = calls;
  for (const change of [url => url.searchParams.set("redirect_uri", "https://other.example.invalid/callback"),
    url => url.searchParams.set("actor", "forged"), url => url.searchParams.append("state", "other"),
    url => url.searchParams.set("scope", "rental.order.commit"), url => url.searchParams.set("code_challenge_method", "plain")]) {
    const url = new URL(started.authorizationUrl); change(url);
    const rejected = await handle(new Request(url));
    assert.equal(rejected.status, 400); assert.equal(rejected.headers.has("location"), false);
    assert.doesNotMatch(await rejected.text(), /original-code|state-which|original-web/);
  }
  assert.equal((await handle(new Request(started.authorizationUrl, { headers: { Origin: "https://other.example.invalid" } }))).status, 403);
  const post = await handle(new Request(started.authorizationUrl, { method: "POST" }));
  assert.equal(post.status, 405); assert.equal(post.headers.get("allow"), "GET");
  assert.equal((await handle(new Request("https://auth.example.invalid/other"))).status, 404);
  assert.equal(calls, beforeInvalid);
  assert.equal((await create(configuration, registry)(request())).status, 503);
  assert.equal((await create({ ...configuration, enabled: false }, registry, original)(request())).status, 503);
  let getterCalls = 0;
  for (outcome of [{ kind: "code", code: "" }, { kind: "code", code: "original-code", token: "private-token" },
    { kind: "redirect", url: "https://other.example.invalid/" }, { kind: "denied", error: "private-error" },
    Object.defineProperty({ kind: "code" }, "code", { enumerable: true, get() { getterCalls++; return "original-code"; } })]) {
    const rejected = await handle(request());
    assert.equal(rejected.status, 503); assert.equal(rejected.headers.has("location"), false);
    assert.doesNotMatch(await rejected.text(), /private-token|private-error|original-code/);
  }
  assert.equal(getterCalls, 0);
  outcome = { kind: "code", code: "original-code" };
  for (const changed of [undefined, { ...baseline, enabled: false }, { ...baseline, expiresAt: 0 }, { ...baseline, revision: 4 }]) {
    hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
    const before = calls, pending = handle(request());
    try {
      await hold.started.promise; registration = changed; hold.release.resolve();
      const rejected = await pending;
      assert.equal(rejected.status, 503); assert.equal(rejected.headers.has("location"), false);
      assert.equal(calls, before + 1, "changed registration suppresses redirect without reissuing a code");
    } finally { hold.release.resolve(); await pending; hold = undefined; registration = baseline; }
  }
  hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
  const controller = new AbortController();
  const pending = handle(new Request(request(), { signal: controller.signal }));
  try {
    await hold.started.promise; const before = calls; controller.abort();
    const rejected = await pending;
    assert.equal(rejected.status, 503); assert.equal(rejected.headers.has("location"), false);
    assert.equal(hold.signal.aborted, true);
    hold.release.resolve(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, before, "late AS completion neither redirects nor retries");
  } finally { hold.release.resolve(); await pending; hold = undefined; }
}

test("public authorization endpoint returns only the original registered callback without reissuing", async t => {
  await verifyAuthorizationEndpoint(t, source("packages/mcp-server/src/public-client-authorization-endpoint.ts").createPublicClientAuthorizationEndpoint);
});

async function verifyAuthorizationMetadata(t, create) {
  const { discoverAuthorizationServerMetadata } = installed("@modelcontextprotocol/client");
  const configuration = { enabled: true, issuer, authorizationEndpoint: "https://auth.example.invalid/authorize",
    tokenEndpoint: "https://auth.example.invalid/token", revocationEndpoint: "https://auth.example.invalid/revoke",
    allowedScopes: ["rental.catalog.read"], allowedOrigins: [], timeoutMs: 1000, maxMetadataBytes: 4096 };
  const baseline = { issuer, authorization_endpoint: configuration.authorizationEndpoint, token_endpoint: configuration.tokenEndpoint,
    revocation_endpoint: configuration.revocationEndpoint, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"], scopes_supported: configuration.allowedScopes };
  const endpoint = "https://auth.example.invalid/.well-known/oauth-authorization-server";
  let current = baseline, reads = 0, hold, withdrawOnSecond = false, changeOnSecond;
  const original = { async read(signal) {
    reads++;
    if (hold) { hold.signal = signal; hold.started.resolve(); await hold.release.promise; }
    if (withdrawOnSecond && reads % 2 === 0) return undefined;
    if (reads % 2 === 0 && changeOnSecond) changeOnSecond();
    return current;
  } };
  const handle = create(configuration, original);
  original.read = async () => { throw new Error("Replaced metadata method must not run"); };
  for (const protocolVersion of ["2026-07-28", "2025-11-25"]) {
    const visited = [];
    const found = await discoverAuthorizationServerMetadata(issuer, { protocolVersion, fetchFn: async (input, init) => {
      const request = new Request(input, init); visited.push(request.url); return handle(request);
    } });
    assert.deepEqual(found, baseline);
    assert.deepEqual(visited, [endpoint]);
  }
  assert.equal(reads, 4, "each discovery rechecks the current AS rather than caching publication");
  reads = 0;
  changeOnSecond = () => { current = Object.fromEntries(Object.entries(baseline).reverse()); };
  const reordered = await handle(new Request(endpoint));
  assert.equal(reordered.status, 200, "metadata object key order is not a publication change");
  assert.deepEqual(await reordered.json(), baseline);
  assert.equal(reads, 2);
  current = baseline; reads = 0;
  changeOnSecond = () => { current = { ...baseline, grant_types_supported: ["authorization_code"] }; };
  assert.equal((await handle(new Request(endpoint))).status, 503, "a supported grant removal still changes the published document");
  const expanded = { ...baseline, scopes_supported: ["rental.catalog.read", "rental.order.read"] };
  let scopeReads = 0;
  const changedScopes = create({ ...configuration, allowedScopes: expanded.scopes_supported }, { read: async () =>
    ++scopeReads % 2 === 0 ? { ...expanded, scopes_supported: [...expanded.scopes_supported].reverse() } : expanded });
  assert.equal((await changedScopes(new Request(endpoint))).status, 503, "scope array order still participates in exact publication comparison");
  changeOnSecond = undefined; current = baseline;
  const ordinary = await handle(new Request(endpoint));
  assert.equal(ordinary.status, 200); assert.equal(ordinary.headers.get("cache-control"), "no-store");
  const byteLimit = Buffer.byteLength(JSON.stringify(baseline), "utf8");
  const boundedProvider = { read: async () => baseline };
  assert.equal((await create({ ...configuration, maxMetadataBytes: byteLimit }, boundedProvider)(new Request(endpoint))).status, 200);
  assert.equal((await create({ ...configuration, maxMetadataBytes: byteLimit - 1 }, boundedProvider)(new Request(endpoint))).status, 503);
  assert.equal((await create(configuration)(new Request(endpoint))).status, 503);
  assert.equal((await create({ ...configuration, enabled: false }, boundedProvider)(new Request(endpoint))).status, 503);
  const beforeRejected = reads;
  assert.equal((await handle(new Request(endpoint + "?issuer=other"))).status, 404);
  assert.equal((await handle(new Request("https://other.example.invalid/.well-known/oauth-authorization-server"))).status, 404);
  const wrongMethod = await handle(new Request(endpoint, { method: "POST" }));
  assert.equal(wrongMethod.status, 405); assert.equal(wrongMethod.headers.get("allow"), "GET");
  assert.equal((await handle(new Request(endpoint, { headers: { Origin: "https://other.example.invalid" } }))).status, 403);
  assert.equal(reads, beforeRejected);
  let getterCalls = 0;
  const invalid = [undefined, { ...baseline, issuer: "https://other.example.invalid/" },
    { ...baseline, token_endpoint: "https://other.example.invalid/token" }, { ...baseline, response_types_supported: ["token"] },
    { ...baseline, code_challenge_methods_supported: ["plain"] }, { ...baseline, token_endpoint_auth_methods_supported: ["client_secret_post"] },
    { ...baseline, scopes_supported: ["rental.order.commit"] }, { ...baseline, scopes_supported: ["rental.catalog.read", "rental.catalog.read"] },
    { ...baseline, registration_endpoint: "https://auth.example.invalid/register" }, { ...baseline, internal_secret: "synthetic-private" },
    Object.defineProperty({ ...baseline }, "issuer", { enumerable: true, get() { getterCalls++; return issuer; } })];
  for (current of invalid) {
    const rejected = await handle(new Request(endpoint));
    assert.equal(rejected.status, 503); assert.doesNotMatch(await rejected.text(), /synthetic-private|internal_secret/);
  }
  assert.equal(getterCalls, 0);
  current = baseline; reads = 0; withdrawOnSecond = true;
  assert.equal((await handle(new Request(endpoint))).status, 503, "publication withdrawn during the read is not served");
  withdrawOnSecond = false;
  hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
  const controller = new AbortController(), beforeCancel = reads;
  const pending = handle(new Request(endpoint, { signal: controller.signal }));
  try {
    await hold.started.promise; controller.abort();
    assert.equal((await pending).status, 503); assert.equal(hold.signal.aborted, true);
    hold.release.resolve(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, beforeCancel + 1, "late publication does not start a second read or return the document");
  } finally { hold.release.resolve(); await pending; hold = undefined; }
  const scopedIssuer = "https://auth.example.invalid/tenant/";
  const scoped = create({ ...configuration, issuer: scopedIssuer }, { read: async () => ({ ...baseline, issuer: scopedIssuer }) });
  assert.equal((await scoped(new Request("https://auth.example.invalid/.well-known/oauth-authorization-server/tenant"))).status, 200);
  assert.equal((await scoped(new Request("https://auth.example.invalid/tenant/.well-known/oauth-authorization-server"))).status, 404);
  const protectedResource = fixture(t);
  const { inspectRentalOAuthConfiguration } = source("clients/harness-plugin/src/oauth-discovery.ts");
  const inspected = await inspectRentalOAuthConfiguration(inspection, { clientId: "registered-metadata-fixture",
    redirectUri: "http://127.0.0.1:49152/rental/callback", scopes: configuration.allowedScopes,
    authorizationEndpoint: configuration.authorizationEndpoint, tokenEndpoint: configuration.tokenEndpoint,
    revocationEndpoint: configuration.revocationEndpoint }, (input, init) => {
      const request = new Request(input, init);
      return request.url === endpoint ? handle(request) : protectedResource.fetch(request);
    }, signal());
  assert.deepEqual(inspected, { status: "oauth_metadata_compatible" });
}

test("AS metadata publishes only current pinned capabilities to official SDK discovery", async t => {
  await verifyAuthorizationMetadata(t, source("packages/mcp-server/src/authorization-server-metadata.ts").createAuthorizationServerMetadata);
});

async function verifyOAuthTokenEndpoint(t, module, checkBinding = source("packages/mcp-server/src/authorization-code-binding.ts").assertAuthorizationCodeBinding) {
  const { startAuthorization, exchangeAuthorization, refreshAuthorization } = installed("@modelcontextprotocol/client");
  const tokenEndpoint = "https://auth.example.invalid/token", revocationEndpoint = "https://auth.example.invalid/revoke";
  const redirectUri = "http://127.0.0.1:49153/rental/callback", clientId = "registered-token-fixture";
  const metadata = { issuer, authorization_endpoint: "https://auth.example.invalid/authorize", token_endpoint: tokenEndpoint,
    token_endpoint_auth_methods_supported: ["none"], response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] };
  const started = await startAuthorization(issuer, { metadata, clientInformation: { client_id: clientId }, redirectUrl: redirectUri,
    resource, scope: "rental.catalog.read", state: "synthetic-state" });
  const configuration = { enabled: true, tokenEndpoint, revocationEndpoint, resourceUrl: resource, allowedOrigins: [],
    allowedScopes: ["rental.catalog.read"], timeoutMs: 1000, maxRequestBytes: 32768 };
  const baseline = { clientId, revision: 2, enabled: true, expiresAt: Date.now() / 1000 + 60,
    redirectUris: ["http://127.0.0.1:49152/rental/callback"], scopes: ["rental.catalog.read"] };
  let client = baseline;
  const calls = [];
  const tokens = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", token_type: "Bearer", expires_in: 60, scope: "rental.catalog.read" };
  let issued = tokens, failed = false, hold;
  const original = {
    async exchangeCode(input, signal) {
      calls.push({ kind: "code", input });
      checkBinding(input, { clientId, resource, redirectUri, codeChallengeMethod: "S256",
        codeChallenge: started.authorizationUrl.searchParams.get("code_challenge") });
      if (failed) throw new module.OAuthTokenRequestError("invalid_grant");
      if (hold) { hold.signal = signal; hold.started.resolve(); await hold.release.promise; }
      return issued;
    },
    async refresh(input, signal) {
      calls.push({ kind: "refresh", input });
      if (hold) { hold.signal = signal; hold.started.resolve(); await hold.release.promise; }
      return issued;
    },
    async revoke(input) { calls.push({ kind: "revoke", input }); },
  };
  let registrationReads = 0;
  const registration = { read: async () => { registrationReads++; return client; } };
  const handle = module.createOAuthTokenEndpoint(configuration, registration, original);
  original.exchangeCode = original.refresh = original.revoke = async () => { throw new Error("Replaced AS method must not run"); };
  const fetch = (input, init) => handle(new Request(input, init));
  const sdkArgs = { metadata, clientInformation: { client_id: clientId }, resource, fetchFn: fetch };
  const exchanged = await exchangeAuthorization(issuer, { ...sdkArgs, authorizationCode: "synthetic-code", codeVerifier: started.codeVerifier, redirectUri });
  assert.deepEqual(exchanged, tokens);
  assert.deepEqual(calls[0], { kind: "code", input: { clientId, clientRevision: 2, code: "synthetic-code", codeVerifier: started.codeVerifier, redirectUri, resource } });
  assert.equal(Object.isFrozen(calls[0].input), true);
  issued = { ...tokens, refresh_token: "rotated-refresh" };
  assert.deepEqual(await refreshAuthorization(issuer, { ...sdkArgs, refreshToken: "synthetic-refresh" }), issued);
  assert.deepEqual(calls[1], { kind: "refresh", input: { clientId, clientRevision: 2, refreshToken: "synthetic-refresh", resource } });
  const form = { grant_type: "authorization_code", client_id: clientId, code: "synthetic-code", code_verifier: started.codeVerifier, redirect_uri: redirectUri, resource };
  const post = (values = form, endpoint = tokenEndpoint, headers = {}) => new Request(endpoint, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(values) });
  const revoke = await handle(post({ client_id: clientId, token: "unknown-token", token_type_hint: "refresh_token" }, revocationEndpoint));
  assert.equal(revoke.status, 200);
  assert.equal(await revoke.text(), "");
  assert.equal(revoke.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls[2], { kind: "revoke", input: { clientId, clientRevision: 2, token: "unknown-token", tokenTypeHint: "refresh_token" } });
  const beforeInvalid = calls.length;
  for (const values of [
    { ...form, actor: "forged" }, { ...form, workspaceId: "forged" }, { ...form, client_secret: "synthetic-private" },
    { ...form, resource: "https://other.example.invalid/mcp" }, { ...form, code_verifier: "short" },
    { ...form, redirect_uri: "http://localhost/callback" }, { ...form, redirect_uri: "https://app.example.invalid/other" },
    { grant_type: "client_credentials", client_id: clientId, refresh_token: "not-refresh", resource },
  ]) assert.equal((await handle(post(values))).status, 400);
  const duplicate = post(); const duplicateText = await duplicate.text();
  assert.equal((await handle(new Request(tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: duplicateText + "&client_id=" + clientId }))).status, 400);
  for (const headers of [{ Authorization: "Bearer synthetic-web" }, { Cookie: "session=synthetic-web" }, { DPoP: "synthetic-proof" }, { "Content-Type": "application/json" }]) {
    assert.equal((await handle(post(form, tokenEndpoint, headers))).status, 400);
  }
  assert.equal((await handle(post(form, tokenEndpoint, { Origin: "https://other.example.invalid" }))).status, 403);
  assert.equal((await handle(new Request(tokenEndpoint))).status, 405);
  assert.equal((await handle(post(form, tokenEndpoint + "?token=synthetic"))).status, 404);
  assert.equal((await handle(post({ client_id: clientId, token: "unknown", token_type_hint: "custom" }, revocationEndpoint))).status, 400);
  const beforeMalformed = registrationReads;
  const malformed = await handle(new Request(tokenEndpoint, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new Uint8Array([0xff]) }));
  assert.equal(malformed.status, 400, "invalid UTF-8 is a malformed request, not a service failure");
  assert.deepEqual(await malformed.json(), { error: "invalid_request" });
  assert.equal(registrationReads, beforeMalformed);
  assert.equal(calls.length, beforeInvalid, "invalid public-client forms never dispatch the AS");
  const absent = module.createOAuthTokenEndpoint(configuration, registration);
  assert.equal((await absent(post())).status, 503);
  const disabled = module.createOAuthTokenEndpoint({ ...configuration, enabled: false }, registration, original);
  assert.equal((await disabled(post())).status, 503);
  const bounded = module.createOAuthTokenEndpoint({ ...configuration, maxRequestBytes: 1 }, registration, original);
  assert.equal((await bounded(post())).status, 413);
  for (client of [undefined, { ...baseline, enabled: false }, { ...baseline, expiresAt: 0 }, { ...baseline, clientId: "other" }]) {
    assert.ok([400, 503].includes((await handle(post())).status));
  }
  assert.equal(calls.length, beforeInvalid);
  client = baseline;
  const beforeWrongProof = calls.length;
  const wrongProof = await handle(post({ ...form, code_verifier: started.codeVerifier === "a".repeat(43) ? "b".repeat(43) : "a".repeat(43) }));
  assert.equal(wrongProof.status, 400);
  assert.deepEqual(await wrongProof.json(), { error: "invalid_grant" });
  assert.equal(calls.length, beforeWrongProof + 1, "original binding rejection does not retry exchange");
  failed = true;
  const invalidGrant = await handle(post());
  assert.equal(invalidGrant.status, 400); assert.deepEqual(await invalidGrant.json(), { error: "invalid_grant" });
  failed = false;
  let getterCalls = 0;
  const invalidTokens = [
    { ...tokens, internal_grant: "synthetic-private" }, { ...tokens, scope: "rental.order.commit" }, { ...tokens, expires_in: 901 },
    { ...tokens, access_token: "space token" },
    Object.defineProperty({ ...tokens }, "access_token", { enumerable: true, get() { getterCalls++; return "synthetic-access"; } }),
  ];
  for (issued of invalidTokens) {
    const result = await handle(post());
    assert.equal(result.status, 503);
    assert.doesNotMatch(await result.text(), /synthetic-private|synthetic-access|internal_grant/);
  }
  assert.equal(getterCalls, 0);
  issued = tokens;
  await assert.rejects(() => refreshAuthorization(issuer, { ...sdkArgs, refreshToken: "synthetic-refresh" }),
    "missing original refresh rotation is unavailable, not a reusable token");
  hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
  const controller = new AbortController();
  const pending = handle(new Request(post(), { signal: controller.signal }));
  const outcome = pending.then(response => response);
  try {
    await hold.started.promise;
    const dispatched = calls.length;
    controller.abort();
    const stopped = await outcome;
    assert.equal(stopped.status, 503);
    assert.equal(hold.signal.aborted, true);
    assert.doesNotMatch(await stopped.text(), /synthetic-access|synthetic-refresh/);
    hold.release.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, dispatched, "late issuance is not retried or returned as a token");
  } finally { hold.release.resolve(); }
  hold = undefined;
  // Current registration can change while the original AS commits. A refused
  // response proves no token was released, not that issuance was rolled back.
  for (const values of [form, { grant_type: "refresh_token", client_id: clientId, refresh_token: "synthetic-refresh", resource }]) {
    client = baseline;
    issued = { ...tokens, refresh_token: "rotated-refresh" };
    hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
    const before = calls.length;
    const pending = handle(post(values));
    try {
      await hold.started.promise;
      client = Object.fromEntries(Object.entries(baseline).reverse());
      hold.release.resolve();
      const result = await pending;
      assert.equal(result.status, 200, "unchanged registration facts may release the original token despite object key order");
      assert.deepEqual(await result.json(), issued);
      assert.equal(calls.length, before + 1, "a key-order difference never reissues code or refresh");
    } finally { hold.release.resolve(); await pending; hold = undefined; client = baseline; }
  }
  for (const values of [form, { grant_type: "refresh_token", client_id: clientId, refresh_token: "synthetic-refresh", resource }]) {
    for (const changed of [undefined, { ...baseline, enabled: false }, { ...baseline, expiresAt: 0 },
      { ...baseline, revision: 3 }, { ...baseline, scopes: ["rental.other.read"] }]) {
      client = baseline;
      issued = { ...tokens, refresh_token: "rotated-refresh" };
      hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const before = calls.length;
      const pending = handle(post(values));
      try {
        await hold.started.promise;
        client = changed;
        hold.release.resolve();
        const result = await pending;
        assert.equal(result.status, 503, "lost or changed registration suppresses late tokens");
        assert.doesNotMatch(await result.text(), /synthetic-access|rotated-refresh/);
        assert.equal(calls.length, before + 1, "registration changes never cause a second AS call");
      } finally { hold.release.resolve(); await pending; hold = undefined; client = baseline; }
    }
  }
  const beforeDisabledRevoke = calls.length;
  client = { ...baseline, enabled: false, expiresAt: 0 };
  const disabledRevoke = await handle(post({ client_id: clientId, token: "known-refresh" }, revocationEndpoint));
  assert.equal(disabledRevoke.status, 200, "disabled registered clients can still ask the original AS to revoke");
  assert.equal(await disabledRevoke.text(), "");
  assert.deepEqual(calls[beforeDisabledRevoke], { kind: "revoke", input: { clientId, clientRevision: 2, token: "known-refresh" } });
  client = baseline;
}

test("OAuth token transport serves SDK exchange and refresh once without inventing grant outcomes", async t => {
  await verifyOAuthTokenEndpoint(t, source("packages/mcp-server/src/oauth-token-endpoint.ts"));
});

function compilePublicContracts(output) {
  const { createBuild } = require(path.join(root, "scripts/check-rental-package-build.cjs"));
  const build = createBuild(dependencyDirectory);
  for (const name of ["platform-contracts", "core-contracts", "core-host"])
    build.compile("packages/" + name + "/tsconfig.json");
  // MCP data metadata consumes these public SQL observers, without a platform
  // application or generated Prisma Client. Keep the owners' package boundaries.
  const observerConfig = path.join(root, "packages/platform-core-host/tsconfig.mcp-test.json");
  build.virtual.set(observerConfig.split(path.sep).join("/"), JSON.stringify({ extends: "./tsconfig.json",
    files: ["src/mysql-structure.ts", "src/mysql-physical.ts"], include: [] }));
  build.compile(observerConfig);
  for (const name of ["platform-contracts", "core-contracts", "core-host", "platform-core-host"]) {
    const pkg = build.packages.get("@rental-os/" + name), target = path.join(output, "node_modules", pkg.metadata.name);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(path.join(pkg.directory, "package.json"), path.join(target, "package.json"));
    for (const [file, text] of build.outputs) {
      if (!within(pkg.directory, file)) continue;
      const destination = path.join(target, path.relative(pkg.directory, file));
      fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, text);
    }
  }
  return path.join(output, "node_modules/@rental-os/platform-contracts");
}

function taskRecovery(state = "observed") {
  if (state === "not_observed") return { task: { state, retryable: false }, nextAction: "reconcile_request_or_explicit_create_task", automaticExecution: false };
  return { task: { state, taskId: "00000000-0000-4000-8000-000000000002", runId: "00000000-0000-4000-8000-000000000003",
    status: "cancelled", revision: 1, plan: "stored", resultAvailable: false, execution: "not_inferred_from_metadata" },
    steps: [{ stepId: "step-a", runId: "00000000-0000-4000-8000-000000000003", actionId: "action-a", revision: 1,
      status: "unknown", effect: "possible", resultAvailable: true, nextAction: "reconcile_original_action" }], hasMore: false,
    automaticExecution: false, nextAction: "existing_runner_recovery", observedResults: "preserved_even_if_task_cancelled", snapshot: "bounded_sequential_read" };
}

async function verifyPublicWorkCenterReads(create) {
  const version = "ain-conversation-draft-2", observedAt = "2026-11-27T00:00:00.000Z";
  const { AI_TASK_DRAFT_VERSION: taskVersion } = source("packages/platform-contracts/src/ai-task.ts");
  const task = { taskId: "task-a", runId: "run-a" }, conversation = { draftVersion: version, conversationId: "conversation-a" };
  const turn = { ...conversation, admissionKey: "admission-a" };
  const originalResult = { contractVersion: taskVersion, ...task, resultId: "result-a", status: "unknown", diagnostic: null,
    contentHash: "a".repeat(64), activeMs: "42", outputBytes: "0", observedAt,
    execution: "read_only_no_start_no_reconnect_side_effect", businessExecution: "not_inferred_from_model_result" };
  const cases = {
    task: [task, { contractVersion: taskVersion, ...task, status: "running", runStatus: "running", revision: 1,
      resultId: originalResult.resultId, execution: "observed_original_task" }, "runId"],
    taskResult: [{ taskId: task.taskId, resultId: originalResult.resultId }, originalResult, "taskId"],
    conversation: [conversation, { ...conversation, capabilityCode: "ai.capability.text", status: "active", revision: 1,
      createdAt: observedAt, updatedAt: observedAt, currentTurn: null, taskCancellation: "separate_original_operation", businessRecords: "not_modified" }, "conversationId"],
    conversationResult: [{ ...turn, resultId: originalResult.resultId }, { ...turn, status: "observed", result: originalResult,
      execution: "read_only_no_start_no_dispatch" }, "admissionKey"],
  };
  const projection = { type: "object", additionalProperties: false, properties: { status: { type: "string" } }, required: ["status"] };
  for (const [kind, [command, original, locator]] of Object.entries(cases)) {
    let calls = 0, observed = original;
    const tool = create(kind, { name: "original_read_fixture", description: "Original work-center observation.", outputSchema: projection,
      async read(value) { assert.deepEqual(value, command); assert(Object.isFrozen(value)); calls++; return observed; } });
    await assert.rejects(tool.read({ ...command, actorId: "caller-supplied" }, signal()));
    assert.equal(calls, 0);
    assert.deepEqual(await tool.read(command, signal()), original);
    assert.deepEqual(tool.outputSchema, projection);
    observed = { ...original, [locator]: "other-original" };
    await assert.rejects(tool.read(command, signal()));
    observed = { ...original, payload: "private original data" };
    await assert.rejects(tool.read(command, signal()));
    if (kind === "conversationResult") {
      observed = { ...original, result: null, status: "not_observed" };
      assert.deepEqual(await tool.read(command, signal()), observed);
      observed = { ...original, status: "not_observed" };
      await assert.rejects(tool.read(command, signal()));
      observed = { ...original, result: { ...originalResult, resultId: "other-result" } };
      await assert.rejects(tool.read(command, signal()));
    }
  }
  assert.throws(() => create("reconcile", {}), /unavailable/u);
}

test("public work-center reads preserve original locators, unknown and closed fields", async () => {
  await verifyPublicWorkCenterReads(source("packages/mcp-server/src/work-center-read.ts").createWorkCenterOriginalRead);
});

test("public original Task read preserves closed request and nested recovery branches", async () => {
  const { createOriginalTaskRecoveryRead } = source("packages/mcp-server/src/original-task-recovery-read.ts");
  const command = { draftVersion: "ain-scene-request-draft-1", inputRef: "00000000-0000-4000-8000-000000000001" };
  let observation = taskRecovery("not_observed"), reads = 0;
  const reader = createOriginalTaskRecoveryRead({ name: "synthetic_original_task", description: "Read the original task.",
    outputSchema: { type: "object", properties: {}, additionalProperties: false },
    read: async input => { assert.deepEqual(input, command); reads++; return observation; } });
  await assert.rejects(() => reader.read({ ...command, userId: "caller-selected" }, signal()));
  assert.equal(reads, 0);
  assert.deepEqual(await reader.read(command, signal()), observation);
  observation = taskRecovery();
  assert.deepEqual(await reader.read(command, signal()), observation);
  for (const change of [value => { value.task.private = true; }, value => { value.steps[0].private = true; },
    value => { value.task = taskRecovery("not_observed").task; }, value => { value.task.revision = 4294967295; }]) {
    observation = taskRecovery(); change(observation);
    await assert.rejects(() => reader.read(command, signal()), /Original recovery unavailable/u);
  }
});

async function verifyTaskRecoveryRead(t, createRead) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  const command = { draftVersion: "ain-scene-request-draft-1", inputRef: "00000000-0000-4000-8000-000000000001" };
  const outputSchema = { type: "object", properties: { recovery: {} }, required: ["recovery"], additionalProperties: false };
  let current = taskRecovery(), calls = 0, releases = 0, published = true, afterRead, hold;
  const binding = { name: "synthetic_original_recovery", description: "Observe original task metadata; no execution or automatic retry.", outputSchema,
    read: async input => {
      assert.deepEqual(input, command); calls++;
      if (hold) { hold.started.resolve(); await hold.release.promise; }
      queueMicrotask(() => queueMicrotask(() => afterRead?.()));
      return current;
    } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Original reader replacement must not run"); };
  assert.throws(() => createRead({ name: "bad_projection", description: "No loose projection.", outputSchema: { type: "object" }, read: async () => current }), /closed object/);
  assert.equal(read.inputSchema.properties.inputRef.format, "uuid");
  installed.resolve("@deepseek-ai/dsh-tools");
  assert.throws(() => installed("@deepseek-ai/dsh-tools").assertSupportedJsonSchema(read.inputSchema), error => error.code === "UNSUPPORTED_SCHEMA");
  const mutable = { ...command }, initial = read.read(mutable, signal());
  queueMicrotask(() => { mutable.inputRef = "00000000-0000-4000-8000-000000000004"; });
  assert.deepEqual(await initial, current);
  let getterCalls = 0;
  const accessor = { ...command };
  Object.defineProperty(accessor, "inputRef", { enumerable: true, get() { getterCalls++; return command.inputRef; } });
  const beforeAccessor = calls;
  await assert.rejects(() => read.read(accessor, signal()));
  assert.equal(getterCalls, 0); assert.equal(calls, beforeAccessor);
  const endpoint = fixture(t, async () => verified(), { readTools: { tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    // Synthetic release only; the product does not approve or define these fields.
    release: { project: async (_auth, _name, value) => { releases++; return { recovery: value }; } } } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "original-recovery-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools.map(tool => tool.name), [read.name]);
      const beforeInvalid = calls;
      for (const input of [{ ...command, actor: "forged" }, { ...command, taskId: "caller-selected" }, { ...command, reader: "arbitrary" },
        { ...command, draftVersion: "old" }, { ...command, inputRef: "not-a-uuid" }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: input })).isError, true);
      }
      assert.equal(calls, beforeInvalid);
      for (current of [taskRecovery("not_observed"), taskRecovery()]) {
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.deepEqual(result.structuredContent.recovery, current);
        assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
        assert.equal(result.structuredContent.recovery.automaticExecution, false);
      }
      const expected = taskRecovery(); current = structuredClone(expected);
      let changed = false;
      afterRead = () => { changed = true; current.steps[0].status = "failed"; };
      assert.deepEqual(await read.read(command, signal()), expected);
      assert.equal(changed, true); afterRead = undefined;
      for (const change of [value => { value.automaticExecution = true; }, value => { value.task.status = "unknown"; },
        value => { value.steps[0].nextAction = "retry"; }, value => { value.steps = Array.from({ length: 51 }, () => value.steps[0]); },
        value => { value.private = "synthetic-private-recovery"; },
        value => { Object.defineProperty(value.steps[0], "status", { enumerable: true, get() { getterCalls++; return "unknown"; } }); }]) {
        current = taskRecovery(); change(current);
        const beforeRelease = releases;
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.isError, true); assert.equal(releases, beforeRelease);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-recovery/);
      }
      assert.equal(getterCalls, 0);
      current = taskRecovery(); published = false;
      const beforeWithdrawal = calls;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(calls, beforeWithdrawal); published = true;
      hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const abort = new AbortController(), pending = read.read(command, abort.signal);
      await hold.started.promise;
      const cancelled = assert.rejects(pending, /Original recovery unavailable/);
      abort.abort(); hold.release.resolve(); await cancelled; hold = undefined;
    } finally { await client.close(); }
  }
}

test("original task recovery read preserves unknown and absence without execution", async t => {
  await verifyTaskRecoveryRead(t, source("packages/mcp-server/src/original-task-recovery-read.ts").createOriginalTaskRecoveryRead);
});



































test("compiled MCP package exports load and serve both eras without source transpilation", async t => {
  const packageRoot = path.join(root, "packages/mcp-server");
  const output = prepareOutput();
  const stagedContracts = compilePublicContracts(output);
  const publicResultTypes = path.join(stagedContracts, "dist/ai-original-result.d.ts");
  const staged = path.join(output, "node_modules/@rental-os/mcp-server");
  fs.mkdirSync(staged, { recursive: true });
  fs.copyFileSync(path.join(packageRoot, "package.json"), path.join(staged, "package.json"));
  const parsed = ts.readConfigFile(path.join(packageRoot, "tsconfig.json"), ts.sys.readFile);
  assert.equal(parsed.error, undefined);
  const configured = ts.parseJsonConfigFileContent(parsed.config, ts.sys, packageRoot);
  const serverTypes = path.join(path.dirname(installed.resolve("@modelcontextprotocol/server")), "index.d.mts");
  const typeRoots = [path.join(dependencyDirectory, "@types")];
  const publicPaths = Object.fromEntries(["core-contracts", "core-host", "platform-core-host"].flatMap(name => {
    const directory = path.join(output, "node_modules/@rental-os", name), manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    return Object.entries(manifest.exports).filter(([key, value]) => !key.includes("*") && typeof value === "object" && value.types)
      .map(([key, value]) => ["@rental-os/" + name + (key === "." ? "" : key.slice(1)), [path.join(directory, value.types)]]);
  }));
  const program = ts.createProgram(configured.fileNames, {
    ...configured.options, outDir: path.join(staged, "dist"), typeRoots,
    paths: { ...publicPaths, "@modelcontextprotocol/server": [serverTypes],
      "@rental-os/platform-contracts/ai-original-result": [publicResultTypes],
      "@rental-os/platform-contracts/ai-work-center": [path.join(path.dirname(publicResultTypes), "ai-work-center.d.ts")],
      zod: [path.join(path.dirname(installed.resolve("zod/package.json")), "index.d.cts")] },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  const emitted = program.emit();
  assert.equal(emitted.emitSkipped, false);
  assert.equal(emitted.diagnostics.length, 0);
  const consumer = path.join(output, "consumer.mts");
  fs.writeFileSync(consumer, [
    'import { createProtectedMcpEndpoint, ResourceAuthorizationError } from "@rental-os/mcp-server";',
    'import { createPublicClientAuthorization } from "@rental-os/mcp-server/public-client-authorization";',
    'export { createPublicClientAuthorization };',
    'import { createPublicClientAuthorizationEndpoint } from "@rental-os/mcp-server/public-client-authorization-endpoint";',
    'export { createPublicClientAuthorizationEndpoint };',
    'import * as oauthTokens from "@rental-os/mcp-server/oauth-token-endpoint";',
    'export { oauthTokens };',
    'import * as persistentTokens from "@rental-os/mcp-server/persistent-oauth-tokens";',
    'export { persistentTokens };',
    'import * as persistentAuthorization from "@rental-os/mcp-server/persistent-oauth-authorization";',
    'export { persistentAuthorization };',
    'import { createRentalMcpService } from "@rental-os/mcp-server/service";',
    'export { createRentalMcpService };',
    'import { assertAuthorizationCodeBinding } from "@rental-os/mcp-server/authorization-code-binding";',
    'export { assertAuthorizationCodeBinding };',
    'import { createAuthorizationServerMetadata } from "@rental-os/mcp-server/authorization-server-metadata";',
    'export { createAuthorizationServerMetadata };',
    'import { createWorkCenterOriginalRead } from "@rental-os/mcp-server/work-center-read";',
    'export { createWorkCenterOriginalRead };',
    'import { createOriginalTaskRecoveryRead } from "@rental-os/mcp-server/original-task-recovery-read";',
    'import type { OriginalTaskRecoveryReadBinding } from "@rental-os/mcp-server/original-task-recovery-read";',
    'export const recoveryRead = (binding: OriginalTaskRecoveryReadBinding) => createOriginalTaskRecoveryRead(binding);',
    'import type { ProtectedMcpConfig, ResourceTokenVerifier, VerifiedResourceToken, McpInstructionsProvider, McpPromptsProvider, McpResources, McpResourceDescriptor } from "@rental-os/mcp-server";',
    'export const resourceUri = (descriptor: McpResourceDescriptor): string => descriptor.uri;',
    'export function resourceEndpoint(configuration: ProtectedMcpConfig, resources: McpResources, verifier: ResourceTokenVerifier) { return createProtectedMcpEndpoint({ ...configuration, resources }, verifier); }',
    'export function create(configuration: ProtectedMcpConfig, verifier: ResourceTokenVerifier) { return createProtectedMcpEndpoint(configuration, verifier); }',
    'export const invalid = new ResourceAuthorizationError("invalid");',
    'export const subjectOf = (identity: VerifiedResourceToken): string => identity.subject;',
    'export const guidance: McpInstructionsProvider = { read: async authorization => { void authorization.subject; return undefined; } };',
    'export const prompts: McpPromptsProvider = { list: async authorization => { void authorization.subject; return [{ name: "synthetic_artifact_prompt", version: "reviewed-artifact-v1", description: "Use the released facts." }]; }, read: async () => ({ version: "reviewed-artifact-v1", text: "Keep missing facts distinct." }) };',
    '',
  ].join("\n"));
  const consumerProgram = ts.createProgram([consumer], {
    strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ["node"], typeRoots, rootDir: output, outDir: path.join(output, "consumer-build"),
    paths: { "@modelcontextprotocol/server": [serverTypes],
      zod: [path.join(path.dirname(installed.resolve("zod/package.json")), "index.d.cts")] },
  });
  const consumerDiagnostics = ts.getPreEmitDiagnostics(consumerProgram);
  assert.equal(consumerDiagnostics.length, 0, consumerDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  assert.equal(consumerProgram.emit().emitSkipped, false);
  const stagedUrl = pathToFileURL(staged + path.sep).href;
  // Only this artifact's external SDK import is redirected to the existing
  // installation. Relative imports still resolve its own emitted files.
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(stagedUrl) && specifier === "@modelcontextprotocol/server") {
      return { url: pathToFileURL(installed.resolve(specifier)).href, shortCircuit: true };
    }
    if (context.parentURL?.startsWith(pathToFileURL(output + path.sep).href) && specifier === "zod") {
      return { url: pathToFileURL(installed.resolve("zod")).href, shortCircuit: true };
    }
    return next(specifier, context);
  } });
  t.after(() => hooks.deregister());
  const compiled = await import(pathToFileURL(path.join(output, "consumer-build/consumer.mjs")).href);
  assert.equal(compiled.invalid.kind, "invalid");
  assert.equal(compiled.subjectOf(verified()), "synthetic-actor");
  await verifySafeInputErrors(t, compiled.create);
  await verifyProtocolPins(t, compiled.create);
  await verifyResources(t, compiled.create);
  await verifyPublicClientAuthorization(t, compiled.createPublicClientAuthorization);
  await verifyAuthorizationEndpoint(t, compiled.createPublicClientAuthorizationEndpoint);
  await verifyPersistentOAuthTokens(t, compiled.persistentTokens, compiled.oauthTokens, compiled.persistentAuthorization, compiled.createRentalMcpService);
  await verifyAuthorizationCodeBinding(t, compiled.assertAuthorizationCodeBinding, compiled.oauthTokens.OAuthTokenRequestError);
  await verifyOAuthTokenEndpoint(t, compiled.oauthTokens, compiled.assertAuthorizationCodeBinding);
  await verifyAuthorizationMetadata(t, compiled.createAuthorizationServerMetadata);
  await verifyPublicWorkCenterReads(compiled.createWorkCenterOriginalRead);
  await verifyTaskRecoveryRead(t, compiled.recoveryRead);
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  const endpoint = compiled.create({ ...config, instructions: compiled.guidance, prompts: compiled.prompts, readTools: {
    tools: [{ name: "synthetic_artifact_read", description: "Read the released artifact test value.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
      read: async () => ({ value: "compiled released fact", private: "synthetic-artifact-private" }) }],
    publication: { allows: async authorization => authorization.subject === "synthetic-actor" },
    authority: { withRead: async (authorization, _name, _input, consume) => { assert.equal(authorization.subject, "synthetic-actor"); return consume(); } },
    accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, _name, value) => ({ value: value.value }) },
  } }, { verifyAccessToken: async () => verified() });
  t.after(() => endpoint.close());
  assert.equal((await endpoint.fetch(post(body("tools/list")))).status, 401);
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "compiled-package-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: inProcess(endpoint), authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ["synthetic_artifact_read"]);
      const result = await client.callTool({ name: "synthetic_artifact_read", arguments: {} });
      assert.deepEqual(result.structuredContent, { value: "compiled released fact" });
      assert.doesNotMatch(JSON.stringify(result), /synthetic-actor|synthetic-artifact-private/);
      assert.equal(client.getInstructions(), undefined);
      assert.deepEqual((await client.listPrompts({ cursor: "" })).prompts.map(prompt => prompt.name), ["synthetic_artifact_prompt"]);
      const prompt = await client.getPrompt({ name: "synthetic_artifact_prompt" });
      assert.equal(prompt.messages[0].content.text, "Rental OS guidance (reviewed-artifact-v1)\nKeep missing facts distinct.");
    } finally { await client.close(); }
  }
});

// The existing offline preload remains active. These tests do not patch fetch,
// open a port, start Harness or install either new package.
test("MCP foundation refuses disabled, unconfigured, foreign-origin and malformed credential requests", async t => {
  let visits = 0;
  const endpoint = fixture(t, async () => { visits++; return verified(); });
  const disabled = fixture(t, async () => { visits++; return verified(); }, { enabled: false });
  assert.equal((await disabled.fetch(post("{}"))).status, 503);
  const absent = createProtectedMcpEndpoint(config);
  t.after(() => absent.close());
  assert.equal((await absent.fetch(post("{}"))).status, 503);
  assert.equal((await absent.fetch(new Request(metadata))).status, 503);
  assert.equal((await endpoint.fetch(post("{}", { Origin: "https://other.example.invalid" }))).status, 403);
  assert.equal((await endpoint.fetch(new Request(resource + "?access_token=not-a-real-secret", { method: "POST" }))).status, 404);
  for (const authorization of ["Basic fake", "Bearer fake extra", "Bearer first,Bearer second"]) {
    const rejected = await endpoint.fetch(post("{}", { Authorization: authorization }));
    assert.equal(rejected.status, 401);
    assert.match(rejected.headers.get("www-authenticate"), /resource_metadata=/);
  }
  assert.equal(visits, 0);
  for (const resourceUrl of ["http://mcp.example.invalid/mcp", "https://user:secret@mcp.example.invalid/mcp", resource + "#x"]) {
    assert.throws(() => createProtectedMcpEndpoint({ ...config, resourceUrl }), TypeError);
  }
});

test("standard challenge and RFC 9728 metadata are consumed without granting access or leaking credentials", async t => {
  const { inspectRentalMcpConnection } = harnessConnection();
  let visits = 0;
  const endpoint = fixture(t, async () => { visits++; return verified(); });
  const challenge = await endpoint.fetch(post("{}"));
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get("www-authenticate"), /resource_metadata=/);
  assert.equal(challenge.headers.get("cache-control"), "no-store");
  const calls = [];
  assert.deepEqual(await inspectRentalMcpConnection(inspection, inProcess(endpoint, calls), signal()), {
    status: "authorization_required", resourceUrl: resource, authorizationServerUrl: issuer, resourceMetadataUrl: metadata,
  });
  assert.deepEqual(calls.map(x => [x.method, x.url]), [["POST", resource], ["GET", metadata]]);
  assert.ok(calls.every(x => !x.headers.has("authorization") && !x.headers.has("cookie") && x.redirect === "error" && x.credentials === "omit"));
  assert.equal(visits, 0);
  assert.equal((await endpoint.fetch(new Request("https://mcp.example.invalid/.well-known/oauth-authorization-server"))).status, 404);
});

async function verifyProtocolPins(t, create) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  let reads = 0;
  const endpoint = create({ ...config, readTools: {
    tools: [{ name: "synthetic_version_read", description: "Protocol fixture only, not a production capability.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"], additionalProperties: false },
      read: async () => { reads++; return { fact: "released version fixture" }; } }],
    publication: { allows: async () => true },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() },
    accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, _name, value) => ({ fact: value.fact }) },
  } }, { verifyAccessToken: async () => verified() });
  t.after(() => endpoint.close());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const requests = [];
    const client = new Client({ name: "protocol-pin-fixture", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: async (input, init) => {
          requests.push({ method: JSON.parse(init.body).method, text: init.body });
          return endpoint.fetch(new Request(input, init));
        }, authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      if (client.getNegotiatedProtocolVersion() === "2026-07-28") {
        assert.deepEqual((await client.discover()).supportedVersions, ["2026-07-28"]);
      } else assert.equal(client.getNegotiatedProtocolVersion(), "2025-11-25");
      await client.callTool({ name: "synthetic_version_read", arguments: {} });
      const text = requests.find(request => request.method === "tools/call").text;
      const before = reads;
      for (const version of ["2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07", "2099-01-01"]) {
        const response = await endpoint.fetch(post(text, { Authorization: "Bearer synthetic-only", "MCP-Protocol-Version": version,
          ...(client.getNegotiatedProtocolVersion() === "2026-07-28" ? { "Mcp-Method": "tools/call", "Mcp-Name": "synthetic_version_read" } : {}) }));
        assert.equal(response.status, 400, `undeclared protocol header ${version} must refuse before the reader`);
        assert.equal(reads, before);
        assert.doesNotMatch(await response.text(), /released version fixture|synthetic-actor|synthetic-only/);
      }
      if (client.getNegotiatedProtocolVersion() === "2025-11-25") {
        // Legacy initialize may counter-offer before business execution; it may
        // never select a revision merely because the SDK supports it by default.
        for (const protocolVersion of ["2025-06-18", "2099-01-01"]) {
          const response = await endpoint.fetch(post(JSON.stringify({ jsonrpc: "2.0", id: 90, method: "initialize",
            params: { protocolVersion, capabilities: {}, clientInfo: { name: "legacy-offer", version: "1" } } }),
          { Authorization: "Bearer synthetic-only" }));
          const payload = await response.text();
          assert.match(payload, /"protocolVersion":"2025-11-25"/);
          assert.equal(reads, before);
        }
      }
    } finally { await client.close(); }
  }
}

test("MCP protocol pins reject undeclared request revisions without reading business facts", async t => {
  await verifyProtocolPins(t, createProtectedMcpEndpoint);
});

test("real official MCP client negotiates both supported eras with zero business tools", async t => {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  for (const [versionNegotiation, expectedVersion] of [[{ mode: { pin: "2026-07-28" } }, "2026-07-28"], [{ mode: "legacy" }, "2025-11-25"]]) {
    let visits = 0;
    const endpoint = fixture(t, async token => {
      assert.equal(token, "synthetic-only"); visits++; return verified();
    });
    const client = new Client({ name: "offline-rental-fixture", version: "1" }, { capabilities: {}, versionNegotiation });
    const transport = new StreamableHTTPClientTransport(new URL(resource), {
      fetch: inProcess(endpoint), requestInit: { headers: { Authorization: "Bearer synthetic-only" } },
      onInsufficientScope: "throw",
    });
    try {
      await client.connect(transport);
      assert.equal(client.getNegotiatedProtocolVersion(), expectedVersion);
      assert.deepEqual((await client.listTools()).tools, []);
      await assert.rejects(() => client.callTool({ name: "rental_order_commit", arguments: {} }));
      assert.ok(visits >= 2);
      const get = await endpoint.fetch(new Request(resource));
      assert.equal(get.status, 405);
      assert.equal(get.headers.get("mcp-session-id"), null);
    } finally { await client.close(); }
  }
});

test("resource audience, current expiration and verifier failures fail closed with safe errors", async t => {
  for (const verify of [
    async () => ({ ...verified(), resource: "https://another.example.invalid/mcp" }),
    async () => ({ ...verified(), expiresAt: Math.floor(Date.now() / 1000) - 1 }),
    async () => ({ ...verified(), expiresAt: Infinity }),
    async () => ({ ...verified(), subject: undefined }),
    async () => ({ ...verified(), subject: "" }),
    async () => { throw new Error("synthetic-sensitive-secret SQL backend failure"); },
  ]) {
    const endpoint = fixture(t, verify);
    const response = await endpoint.fetch(post(body("tools/list"), { Authorization: "Bearer synthetic-only" }));
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.doesNotMatch(text, /synthetic-sensitive|SQL|backend|another\.example/);
  }
});

test("late identity verification cannot dispatch after cancellation or close", async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const endpoint = fixture(t, () => pending);
  const controller = new AbortController();
  const request = new Request(post(body("tools/list"), { Authorization: "Bearer synthetic-only" }), { signal: controller.signal });
  const response = endpoint.fetch(request);
  controller.abort();
  assert.equal((await response).status, 503);
  release(verified());
  const closing = endpoint.close();
  assert.equal(endpoint.close(), closing);
  await closing;
  assert.equal((await endpoint.fetch(post("{}"))).status, 503);
});

test("client discovery rejects substituted issuer, resource, metadata target and oversized UTF-8 before authorizing", async t => {
  const { inspectRentalMcpConnection, ConnectionInspectionError } = harnessConnection();
  const endpoint = fixture(t);
  for (const altered of [
    { resource: "https://other.example.invalid/mcp" },
    { authorization_servers: ["https://other.example.invalid/"] },
    { bearer_methods_supported: ["query"] },
    { resource_name: "界".repeat(2000) },
  ]) {
    const fetch = async (input, init) => {
      if (String(input) === resource) return endpoint.fetch(new Request(input, init));
      const normal = await (await endpoint.fetch(new Request(metadata))).json();
      return Response.json({ ...normal, ...altered });
    };
    await assert.rejects(() => inspectRentalMcpConnection(inspection, fetch, signal()), ConnectionInspectionError);
  }
  let calls = 0;
  await assert.rejects(() => inspectRentalMcpConnection(inspection, async () => {
    calls++;
    return new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://other.example.invalid/metadata"' } });
  }, signal()), error => error.code === "untrusted_discovery");
  assert.equal(calls, 1);
});

test("client cancellation does not fetch metadata or publish a late authorization state", async () => {
  const { inspectRentalMcpConnection } = harnessConnection();
  const controller = new AbortController();
  let release;
  let calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const inspecting = inspectRentalMcpConnection(inspection, async () => { calls++; return pending; }, controller.signal);
  controller.abort();
  await assert.rejects(() => inspecting, error => error.code === "cancelled");
  release(new Response(null, { status: 401 }));
  await Promise.resolve();
  assert.equal(calls, 1);
});

test("client metadata stream is cancelled when inspection loses its caller", async () => {
  const { inspectRentalMcpConnection } = harnessConnection();
  const controller = new AbortController();
  let started;
  let cancelled;
  const reading = new Promise(resolve => { started = resolve; });
  const ended = new Promise(resolve => { cancelled = resolve; });
  const inspecting = inspectRentalMcpConnection(inspection, async input => {
    if (String(input) === resource) {
      return new Response(null, { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadata}"` } });
    }
    return new Response(new ReadableStream({
      pull() { started(); },
      cancel() { cancelled(); },
    }), { headers: { "Content-Type": "application/json" } });
  }, controller.signal);
  await reading;
  controller.abort();
  await assert.rejects(() => inspecting, error => error.code === "cancelled");
  await ended;
});

test("transport bounds request bytes and does not expose a ready business capability", async t => {
  const endpoint = fixture(t);
  const response = await endpoint.fetch(post(" ".repeat(4097), { Authorization: "Bearer synthetic-only" }));
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const metadataResponse = await endpoint.fetch(new Request(metadata));
  const value = await metadataResponse.json();
  assert.equal(value.scopes_supported, undefined);
  assert.equal(value.tools, undefined);
});

test("fixed RFC7662 introspection verifies current resource tokens without caches or identity leaks", async t => {
  const endpointUrl = "https://auth.example.invalid/introspect";
  const configuration = { issuer, resourceUrl: resource, endpoint: endpointUrl, allowedClientIds: ["registered-client"],
    allowedScopes: ["rental.catalog.read"], timeoutMs: 1000, maxResponseBytes: 4096 };
  const active = { active: true, iss: issuer, aud: resource, sub: "synthetic-actor", client_id: "registered-client",
    token_type: "Bearer", exp: Math.floor(Date.now() / 1000) + 60, scope: "rental.catalog.read", ignored_secret: "private-AS-field" };
  let result = active;
  let requests = 0;
  const authentication = { headers: async () => new Headers({ Authorization: "Basic synthetic-AS-only" }) };
  const verifier = createIntrospectionVerifier(configuration, authentication, async (input, init) => {
    requests++;
    const request = new Request(input, init);
    assert.equal(request.url, endpointUrl);
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("authorization"), "Basic synthetic-AS-only");
    assert.equal(request.credentials, "omit");
    assert.equal(request.redirect, "error");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(await request.text())), { token: "synthetic-resource-only", token_type_hint: "access_token" });
    return Response.json(result);
  });
  const endpoint = createProtectedMcpEndpoint(config, verifier);
  t.after(() => endpoint.close());
  const expected = { subject: "synthetic-actor", clientId: "registered-client", scopes: ["rental.catalog.read"], expiresAt: active.exp, resource };
  assert.deepEqual(await verifier.verifyAccessToken("synthetic-resource-only"), expected);
  assert.deepEqual(await verifier.verifyAccessToken("synthetic-resource-only"), expected);
  assert.equal(requests, 2, "no cached active verdict");
  assert.equal((await endpoint.fetch(post(body("tools/list"), { Authorization: "Bearer synthetic-resource-only" }))).status, 200);
  for (const override of [
    { active: false }, { active: "true" }, { iss: "https://other.invalid/" }, { aud: [resource, "another"] },
    { client_id: "not-allowed" }, { sub: "" }, { sub: "x".repeat(201) }, { exp: 0 }, { nbf: active.exp + 60 }, { token_type: "DPoP" },
    { scope: "rental.catalog.read rental.order.commit" }, { scope: "rental.catalog.read rental.catalog.read" },
  ]) {
    result = { ...active, ...override };
    const denied = await endpoint.fetch(post(body("tools/list"), { Authorization: "Bearer synthetic-resource-only" }));
    assert.equal(denied.status, 401);
    assert.doesNotMatch(await denied.text(), /synthetic-actor|private-AS-field|not-allowed|other\.invalid/);
  }
  const broken = createIntrospectionVerifier(configuration, authentication, async () => new Response("private-AS-error", { status: 500 }));
  const unavailable = createProtectedMcpEndpoint(config, broken);
  t.after(() => unavailable.close());
  const denied = await unavailable.fetch(post(body("tools/list"), { Authorization: "Bearer synthetic-resource-only" }));
  assert.equal(denied.status, 500, "unavailable evidence is not reported as a revoked credential");
  assert.doesNotMatch(await denied.text(), /private-AS-error/);
  for (const response of [
    () => Response.json({ ...active, ignored_secret: "界".repeat(2000) }),
    () => new Response("{}", { status: 302, headers: { Location: "https://other.invalid/" } }),
    () => new Response("not JSON"),
  ]) {
    let attempts = 0;
    const bounded = createIntrospectionVerifier(configuration, authentication, async () => { attempts++; return response(); });
    await assert.rejects(() => bounded.verifyAccessToken("synthetic-resource-only"), error => error instanceof ResourceAuthorizationError && error.kind === "unavailable");
    assert.equal(attempts, 1, "no retry or alternate introspection endpoint");
  }
});

async function verifySafeInputErrors(t, create) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  const visits = { authority: 0, accounting: 0, read: 0 };
  const inputSchema = { type: "object", properties: { entries: { type: "object",
    additionalProperties: { type: "integer", minimum: 1, maximum: 50 } } }, required: ["entries"], additionalProperties: false };
  const endpoint = create({ ...config, readTools: {
    tools: [{ name: "synthetic_input_error_read", description: "Input error fixture only, not a production schema.", inputSchema,
      outputSchema: { type: "object", properties: { count: { type: "integer" } }, required: ["count"], additionalProperties: false },
      read: async () => { visits.read++; return { count: 1 }; } }],
    publication: { allows: async () => true },
    authority: { withRead: async (_auth, _name, _input, consume) => { visits.authority++; return consume(); } },
    accounting: { withCall: async (_auth, _name, _input, consume) => { visits.accounting++; return consume(); } },
    release: { project: async (_auth, _name, value) => ({ count: value.count }) },
  } }, { verifyAccessToken: async () => verified() });
  t.after(() => endpoint.close());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "safe-input-error-fixture", version: "1" }, { capabilities: {}, versionNegotiation });
    let wire;
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: async (input, init) => {
          const response = await endpoint.fetch(new Request(input, init));
          wire = await response.clone().text();
          return response;
        }, authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      assert.deepEqual((await client.listTools()).tools[0].inputSchema, inputSchema, "safe errors retain the complete advertised schema");
      assert.deepEqual((await client.callTool({ name: "synthetic_input_error_read", arguments: { entries: { count: 2 } } })).structuredContent, { count: 1 });
      const before = { ...visits };
      for (const arguments_ of [
        { entries: { "synthetic-sensitive-customer-path": "synthetic-sensitive-value" } },
        { entries: { count: 0 } }, { entries: { count: 51 } },
        { entries: {}, actor: "synthetic-sensitive-actor" }, {},
      ]) {
        const rejected = await client.callTool({ name: "synthetic_input_error_read", arguments: arguments_ });
        assert.equal(rejected.isError, true);
        assert.doesNotMatch(wire, /synthetic-sensitive|data\/entries|minimum|maximum/);
        assert.match(rejected.content[0].text, /Read unavailable\. Check current authorization in Rental OS\./);
        assert.deepEqual(visits, before, "invalid inputs are refused before original authority, accounting or reader");
      }
    } finally { await client.close(); }
  }
}

test("MCP read input errors do not echo rejected field paths or values", async t => {
  await verifySafeInputErrors(t, createProtectedMcpEndpoint);
});

test("read registration keeps original authority, accounting and released values on the actual MCP path", async t => {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  let published = true;
  let identityValid = true;
  let large = false;
  let wrappedLarge = false;
  let fieldLarge = false;
  let listLarge = false;
  let exactFields = false;
  let invalidOutput = false;
  let loseAfterRead = false;
  let reads = 0;
  let count = 0;
  let insideAuthority = false;
  const log = [];
  const schema = { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["limit"], additionalProperties: false };
  const outputSchema = { type: "object", properties: { summary: { type: "string" }, items: { type: "array", items: { type: "string" } } }, required: ["summary"], additionalProperties: false };
  const bindings = {
    tools: [{ name: "synthetic_catalog_read", description: "Read a bounded test projection; not a production catalog tool.", inputSchema: schema, outputSchema,
      read: async input => {
        assert.equal(insideAuthority, true, "read runs under the injected original authority");
        reads++;
        log.push("read");
        if (loseAfterRead) identityValid = false;
        // Escaping inflates the textual JSON nested in the protocol envelope.
        const summary = fieldLarge ? "界".repeat(2001) : exactFields ? "界".repeat(2000) : `page ${input.limit}`;
        const items = wrappedLarge ? Array(15).fill("\"".repeat(1000)) : large ? Array(12).fill("界".repeat(1000))
          : listLarge ? Array(51).fill("item") : exactFields ? Array(50).fill("item") : undefined;
        return { summary, ...(items ? { items } : {}), private_field: "never-release-this" };
      } }],
    publication: { allows: async () => published },
    authority: { withRead: async (_auth, name, input, consume) => {
      assert.equal(name, "synthetic_catalog_read");
      assert.equal(input.limit, 2);
      log.push("authority");
      insideAuthority = true;
      try { return await consume(); } finally { insideAuthority = false; }
    } },
    accounting: { withCall: async (_auth, _name, _input, consume) => { count++; log.push("accounting"); return consume(); } },
    release: { project: async (_auth, _name, value) => {
      log.push("release");
      return invalidOutput ? { summary: 42, private_result: "synthetic-private-invalid" }
        : { summary: value.summary, ...(value.items ? { items: value.items } : {}) };
    } },
  };
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const endpoint = createProtectedMcpEndpoint({ ...config, readTools: bindings }, {
      verifyAccessToken: async () => {
        if (!identityValid) throw new ResourceAuthorizationError("invalid");
        return verified();
      },
    });
    t.after(() => endpoint.close());
    const client = new Client({ name: "read-bridge-test", version: "1" }, { capabilities: {}, versionNegotiation });
    let lastStatus;
    const transport = new StreamableHTTPClientTransport(new URL(resource), {
      fetch: async (input, init) => {
        const response = await inProcess(endpoint)(input, init);
        lastStatus = response.status;
        return response;
      }, authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
    });
    try {
      await client.connect(transport);
      assert.deepEqual((await client.listTools(undefined, { cacheMode: "bypass" })).tools.map(tool => tool.name), ["synthetic_catalog_read"]);
      const before = reads;
      const value = await client.callTool({ name: "synthetic_catalog_read", arguments: { limit: 2 } });
      assert.deepEqual(value.structuredContent, { summary: "page 2" });
      assert.doesNotMatch(JSON.stringify(value), /private_field|never-release-this/);
      assert.equal(reads, before + 1);
      assert.deepEqual(log.slice(-4), ["authority", "accounting", "read", "release"]);
      const invalid = await client.callTool({ name: "synthetic_catalog_read", arguments: { limit: 2, actor: "forged" } });
      assert.equal(invalid.isError, true);
      assert.equal(reads, before + 1, "unknown model identity fields never reach the reader");
      published = false;
      assert.deepEqual((await client.listTools(undefined, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: "synthetic_catalog_read", arguments: { limit: 2 } }));
      assert.equal(reads, before + 1, "cached tool name cannot bypass publication");
      published = true;
      large = true;
      const oversized = await client.callTool({ name: "synthetic_catalog_read", arguments: { limit: 2 } });
      assert.equal(oversized.isError, true);
      assert.ok(Buffer.byteLength(JSON.stringify(oversized), "utf8") < 65536);
      large = false;
      wrappedLarge = true;
      assert.ok(Buffer.byteLength(JSON.stringify({ summary: "page 2", items: Array(15).fill("\"".repeat(1000)) }), "utf8") < 32000);
      await assert.rejects(() => client.callTool({ name: "synthetic_catalog_read", arguments: { limit: 2 } }));
      assert.equal(lastStatus, 503, "the complete text/structured protocol wrapper, not just its projection, is bounded");
      wrappedLarge = false;
      fieldLarge = true;
      assert.equal((await client.callTool({ name: "synthetic_catalog_read", arguments: { limit: 2 } })).isError, true);
      fieldLarge = false;
      listLarge = true;
      assert.equal((await client.callTool({ name: "synthetic_catalog_read", arguments: { limit: 2 } })).isError, true);
      listLarge = false;
      exactFields = true;
      const exact = await client.callTool({ name: "synthetic_catalog_read", arguments: { limit: 2 } });
      assert.equal(exact.structuredContent.summary.length, 2000);
      assert.equal(exact.structuredContent.items.length, 50);
      assert.deepEqual(JSON.parse(exact.content[0].text), exact.structuredContent);
      exactFields = false;
      invalidOutput = true;
      const badOutput = await client.callTool({ name: "synthetic_catalog_read", arguments: { limit: 2 } });
      assert.equal(badOutput.isError, true);
      assert.doesNotMatch(JSON.stringify(badOutput), /private_result|synthetic-private-invalid|must be string/);
      invalidOutput = false;
      loseAfterRead = true;
      await assert.rejects(() => client.callTool({ name: "synthetic_catalog_read", arguments: { limit: 2 } }));
      identityValid = true;
      loseAfterRead = false;
    } finally { await client.close(); }
  }
  assert.equal(count, reads, "all actual reads use the injected accounting path");
  assert.throws(() => createProtectedMcpEndpoint({ ...config, readTools: { ...bindings, tools: [bindings.tools[0], bindings.tools[0]] } }), /unique/);
  assert.throws(() => createProtectedMcpEndpoint({ ...config, readTools: { ...bindings, tools: [{ ...bindings.tools[0], inputSchema: { type: "object" } }] } }), /closed objects/);
});

test("read definitions stay fixed across publication while current policy still withdraws", async t => {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const entered = Promise.withResolvers(), resume = Promise.withResolvers();
    let held = false, published = true, reads = 0, replacements = 0;
    const original = { name: "fixed_read", description: "Read the original approved test projection.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
      read: async () => { reads++; return { value: "original" }; } };
    const bindings = { tools: [original],
      publication: { allows: async () => { if (!held) { held = true; entered.resolve(); await resume.promise; } return published; } },
      authority: { withRead: async (_auth, _name, _value, consume) => consume() },
      accounting: { withCall: async (_auth, _name, _value, consume) => consume() },
      release: { project: async (_auth, _name, value) => value } };
    const endpoint = fixture(t, async () => verified(), { readTools: bindings });
    t.after(() => resume.resolve());
    const client = new Client({ name: "fixed-definition-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      const connecting = client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      await entered.promise;
      original.name = "changed_read";
      original.description = "Changed while publication was awaiting.";
      original.outputSchema.properties.value.type = "number";
      original.read = async () => { replacements++; return { value: 1 }; };
      bindings.tools.push({ ...original, name: "injected_read" });
      bindings.release.project = async () => { replacements++; return { value: 2 }; };
      bindings.publication.allows = async () => true;
      resume.resolve(); await connecting;
      const tools = (await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools;
      assert.deepEqual(tools.map(tool => tool.name), ["fixed_read"]);
      assert.equal(tools[0].outputSchema.properties.value.type, "string");
      const result = await client.callTool({ name: "fixed_read", arguments: {} });
      assert.deepEqual(result.structuredContent, { value: "original" });
      assert.equal(reads, 1); assert.equal(replacements, 0);
      published = false;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, [], "captured policy methods still read current revocation state");
      await assert.rejects(() => client.callTool({ name: "fixed_read", arguments: {} }));
      assert.equal(reads, 1);
    } finally { resume.resolve(); await client.close(); }
  }
});

test("released JSON snapshots reject values that stringify would silently change", async t => {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  let output = { value: null };
  let getterCalls = 0;
  let toJsonCalls = 0;
  const repeated = { amount: 12.5 };
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get() { getterCalls++; return null; } });
  const custom = { value: null, toJSON() { toJsonCalls++; return { value: null }; } };
  const cyclic = { value: {} };
  cyclic.value.self = cyclic;
  const hidden = Object.defineProperty({ value: null }, "private", { value: "synthetic-private-json" });
  const candidates = [
    { value: NaN }, { value: Infinity }, { value: -0 }, { value: undefined },
    { value: new Date(0) }, { value: Array(1) }, { value: 1n }, accessor, custom, cyclic, hidden,
  ];
  const schema = { type: "object", properties: {}, additionalProperties: false };
  const endpoint = fixture(t, async () => verified(), { readTools: {
    tools: [{ name: "synthetic_json_read", description: "Read the approved JSON projection.", inputSchema: schema,
      outputSchema: { type: "object", properties: { value: {} }, required: ["value"], additionalProperties: false },
      read: async () => output }],
    publication: { allows: async () => true },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() },
    accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, _name, value) => value },
  } });
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "json-snapshot-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: inProcess(endpoint), authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      output = { value: [repeated, repeated, null, true, "bounded"] };
      const value = await client.callTool({ name: "synthetic_json_read", arguments: {} });
      assert.deepEqual(value.structuredContent, output);
      assert.deepEqual(JSON.parse(value.content[0].text), value.structuredContent);
      for (output of candidates) {
        const rejected = await client.callTool({ name: "synthetic_json_read", arguments: {} });
        assert.equal(rejected.isError, true, "non-JSON projection is unavailable, not a changed valid value");
        assert.equal(rejected.structuredContent, undefined);
        assert.doesNotMatch(JSON.stringify(rejected), /synthetic-private-json|TypeError|NaN|toJSON/);
      }
      assert.equal(getterCalls, 0, "serialization never invokes a projection getter");
      assert.equal(toJsonCalls, 0, "serialization never invokes a custom JSON conversion");
    } finally { await client.close(); }
  }
});

test("trusted subjects stay internal and cannot change across publication or released reads", async t => {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    let subject = "synthetic-actor";
    let changeAt;
    let reads = 0;
    const seen = [];
    const check = (authorization, stage) => {
      assert.equal(authorization.subject, "synthetic-actor");
      assert.equal(Object.isFrozen(authorization), true);
      assert.equal(Object.isFrozen(authorization.scopes), true);
      seen.push(stage);
    };
    const schema = { type: "object", properties: {}, additionalProperties: false };
    const endpoint = fixture(t, async () => ({ ...verified(), subject }), {
      instructions: { read: async authorization => { check(authorization, "instructions"); return undefined; } },
      readTools: {
        tools: [{ name: "synthetic_subject_read", description: "Read the released test value.", inputSchema: schema,
          outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
          read: async () => { reads++; return { value: "released fact" }; } }],
        publication: { allows: async authorization => {
          check(authorization, "publication");
          if (changeAt === "publication") subject = "synthetic-other-actor";
          return true;
        } },
        authority: { withRead: async (authorization, _name, _input, consume) => { check(authorization, "authority"); return consume(); } },
        accounting: { withCall: async (authorization, _name, _input, consume) => { check(authorization, "accounting"); return consume(); } },
        release: { project: async (authorization, _name, value) => {
          check(authorization, "release");
          if (changeAt === "release") subject = "synthetic-other-actor";
          return value;
        } },
      },
    });
    let lastResponse;
    const client = new Client({ name: "subject-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: async (input, init) => {
          const response = await endpoint.fetch(new Request(input, init));
          lastResponse = response.clone();
          return response;
        }, authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      const value = await client.callTool({ name: "synthetic_subject_read", arguments: {} });
      assert.deepEqual(value.structuredContent, { value: "released fact" });
      assert.deepEqual(seen.slice(-4), ["authority", "accounting", "release", "publication"]);
      assert.doesNotMatch(await lastResponse.text(), /synthetic-actor|subject|synthetic-only/);
      const before = reads;
      changeAt = "publication";
      await assert.rejects(() => client.callTool({ name: "synthetic_subject_read", arguments: {} }));
      assert.equal(reads, before, "same client/scope with a changed subject cannot dispatch the reader");
      assert.doesNotMatch(await lastResponse.text(), /synthetic-actor|synthetic-other|subject|released fact/);
      subject = "synthetic-actor";
      changeAt = "release";
      await assert.rejects(() => client.callTool({ name: "synthetic_subject_read", arguments: {} }));
      assert.equal(reads, before + 1);
      assert.equal(lastResponse.status, 503);
      assert.doesNotMatch(await lastResponse.text(), /synthetic-actor|synthetic-other|subject|released fact/);
    } finally { await client.close(); }
  }
});

async function verifyGuidanceSnapshots(t, create) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    let entered, resume;
    const begun = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { resume = resolve; });
    let held = false;
    let allowed = true;
    let replacements = 0;
    const instructions = { async read() {
      if (!held) { held = true; entered(); await gate; }
      return allowed ? { version: "reviewed-v1", text: "Original reviewed guidance." } : undefined;
    } };
    const prompts = {
      async list() { return allowed ? [{ name: "fixed_prompt", version: "reviewed-v1", description: "Original descriptor." }] : []; },
      async read() { return allowed ? { version: "reviewed-v1", text: "Original template." } : undefined; },
    };
    const endpoint = create({ ...config, instructions, prompts }, { verifyAccessToken: async () => verified() });
    t.after(() => endpoint.close());
    const client = new Client({ name: "fixed-guidance-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      const pending = client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: inProcess(endpoint), authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      // Hold an actual SDK request while replacing the source methods, not policy
      // state. A fixed endpoint must never adopt these unapproved replacements.
      const outcome = pending.then(() => undefined, error => error);
      await Promise.race([begun, outcome.then(error => {
        throw error ?? new Error("SDK request completed without reaching its owned provider barrier");
      })]);
      instructions.read = async () => { replacements++; return { version: "injected-v1", text: "Injected guidance." }; };
      prompts.list = async () => { replacements++; return [{ name: "injected_prompt", version: "injected-v1", description: "Injected descriptor." }]; };
      prompts.read = async () => { replacements++; return { version: "injected-v1", text: "Injected template." }; };
      resume();
      assert.equal(await outcome, undefined);
      assert.equal(client.getInstructions(), "Rental OS guidance (reviewed-v1)\nOriginal reviewed guidance.");
      assert.deepEqual((await client.listPrompts({ cursor: "" }, { cacheMode: "bypass" })).prompts,
        [{ name: "fixed_prompt", description: "Rental OS guidance (reviewed-v1)\nOriginal descriptor." }]);
      assert.equal((await client.getPrompt({ name: "fixed_prompt" })).messages[0].content.text,
        "Rental OS guidance (reviewed-v1)\nOriginal template.");
      assert.equal(replacements, 0);
      allowed = false;
      assert.deepEqual((await client.listPrompts({ cursor: "" }, { cacheMode: "bypass" })).prompts, []);
      await assert.rejects(() => client.getPrompt({ name: "fixed_prompt" }), error => error.code === -32602);
      assert.equal(replacements, 0, "captured methods still observe current revocation");
    } finally { resume(); await client.close(); }

    let getterCalls = 0;
    let conversions = 0;
    const valid = { version: "reviewed-v1", text: "Ordinary reviewed guidance." };
    const descriptor = { name: "snapshot_prompt", version: valid.version, description: "Ordinary descriptor." };
    const getter = (value, key) => Object.defineProperty({ ...value }, key, { enumerable: true, get() { getterCalls++; return value[key]; } });
    const extraGetter = value => Object.defineProperty({ ...value }, "private_field", { enumerable: true, get() { getterCalls++; return "synthetic-private-guidance"; } });
    const coercible = { toString() { conversions++; return "reviewed-v1"; } };
    const hidden = (value, key) => Object.defineProperty({ ...value }, key, { value: value[key], enumerable: false });
    const custom = value => Object.assign(Object.create({}), value);
    let guidance = valid;
    let descriptors = [descriptor];
    let template = valid;
    const snapshotEndpoint = create({ ...config,
      instructions: { read: async () => guidance },
      prompts: { list: async () => descriptors, read: async () => template },
    }, { verifyAccessToken: async () => verified() });
    t.after(() => snapshotEndpoint.close());
    const snapshotClient = new Client({ name: "guidance-snapshot-test", version: "1" }, { capabilities: {}, versionNegotiation });
    let responseText;
    try {
      await snapshotClient.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: async (input, init) => {
          const response = await snapshotEndpoint.fetch(new Request(input, init));
          responseText = await response.clone().text();
          return response;
        }, authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      const invalidGuidance = [getter(valid, "version"), getter(valid, "text"), hidden(valid, "version"), custom(valid),
        { version: coercible, text: valid.text }, { version: 123, text: valid.text }, { version: valid.version, text: null }];
      for (guidance of invalidGuidance) {
        await assert.rejects(() => snapshotClient.listTools({ cursor: "" }, { cacheMode: "bypass" }));
        assert.doesNotMatch(responseText, /Ordinary reviewed|synthetic-private-guidance/);
      }
      guidance = extraGetter(valid);
      assert.deepEqual((await snapshotClient.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      const accessorArray = [descriptor];
      Object.defineProperty(accessorArray, "0", { enumerable: true, get() { getterCalls++; return descriptor; } });
      const customArray = [descriptor]; Object.setPrototypeOf(customArray, Object.create(Array.prototype));
      for (descriptors of [[getter(descriptor, "name")], [getter(descriptor, "version")], [getter(descriptor, "description")],
        [hidden(descriptor, "name")], [custom(descriptor)], [{ ...descriptor, name: 123 }], accessorArray, customArray, new Array(1), null]) {
        await assert.rejects(() => snapshotClient.listPrompts({ cursor: "" }, { cacheMode: "bypass" }));
        assert.doesNotMatch(responseText, /Ordinary descriptor|synthetic-private-guidance/);
      }
      descriptors = [extraGetter(descriptor)];
      assert.deepEqual((await snapshotClient.listPrompts({ cursor: "" }, { cacheMode: "bypass" })).prompts,
        [{ name: descriptor.name, description: "Rental OS guidance (reviewed-v1)\nOrdinary descriptor." }]);
      for (template of invalidGuidance) {
        await assert.rejects(() => snapshotClient.getPrompt({ name: descriptor.name }));
        assert.doesNotMatch(responseText, /Ordinary reviewed|synthetic-private-guidance/);
      }
      template = extraGetter(valid);
      assert.equal((await snapshotClient.getPrompt({ name: descriptor.name })).messages[0].content.text,
        "Rental OS guidance (reviewed-v1)\nOrdinary reviewed guidance.");
      assert.equal(getterCalls, 0, "neither released fields nor ignored private fields execute accessors");
      assert.equal(conversions, 0, "versions and names must be strings, not coerced provider objects");
    } finally { await snapshotClient.close(); }
  }
  assert.throws(() => create({ ...config, instructions: {} }), /providers/);
}

test("guidance methods and ordinary snapshots remain fixed without freezing current policy", async t => {
  await verifyGuidanceSnapshots(t, createProtectedMcpEndpoint);
});

async function verifyResources(t, create) {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    let published = true, version = "resource-v1", subject = "synthetic-actor", text = "Original receipt reference, not approval or execution.";
    let descriptors, released, missing = false, hold, deny, mutate, reads = 0, lists = 0, getters = 0;
    const uri = "https://mcp.example.invalid/resources/original-receipt", order = [];
    const original = {
      list: async authorization => {
        assert.equal(authorization.subject, "synthetic-actor"); assert.equal(Object.isFrozen(authorization), true); lists++;
        return descriptors ?? (published ? [{ name: "original_receipt", uri, version, description: "Read an original reference only.", private: "synthetic-resource-private" }] : []);
      },
      read: async (_auth, descriptor, signal) => {
        reads++; order.push("read"); assert.equal(Object.isFrozen(descriptor), true); assert.equal(descriptor.uri, uri);
        if (hold) { const barrier = hold; barrier.signal = signal; barrier.started.resolve(); await barrier.release.promise; barrier.settled.resolve(); }
        if (mutate) mutate();
        return { text, private: "synthetic-resource-private" };
      },
      authority: { withRead: async (_auth, _descriptor, consume) => { order.push("authority"); if (deny === "authority") throw new Error("synthetic-private-authority"); return consume(); } },
      accounting: { withRead: async (_auth, _descriptor, consume) => { order.push("accounting"); if (deny === "accounting") throw new Error("synthetic-private-accounting"); return consume(); } },
      release: { project: async (_auth, _descriptor, value) => { order.push("release"); return missing ? undefined : released ?? { version, text: value.text }; } },
    };
    const endpoint = create({ ...config, resources: original }, { verifyAccessToken: async () => ({ ...verified(), subject }) });
    t.after(() => endpoint.close());
    assert.equal((await endpoint.fetch(post(body("resources/list")))).status, 401); assert.equal(lists, 0);
    let lastStatus, lastText;
    const client = new Client({ name: "resources-fixture", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: async (input, init) => {
        const response = await endpoint.fetch(new Request(input, init)); lastStatus = response.status; lastText = await response.clone().text(); return response;
      }, authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      assert.deepEqual(client.getServerCapabilities().resources, { subscribe: false, listChanged: false });
      const listing = await client.listResources({ cursor: "" }, { cacheMode: "bypass" });
      assert.deepEqual(listing.resources, [{ name: "original_receipt", uri, mimeType: "text/plain", description: "Rental OS resource (resource-v1)\nRead an original reference only." }]);
      assert.equal(reads, 0); assert.deepEqual((await client.listResourceTemplates()).resourceTemplates, []);
      const result = await client.readResource({ uri });
      assert.deepEqual(result.contents, [{ uri, mimeType: "text/plain", text: `Rental OS resource (${version})\n${text}` }]);
      assert.deepEqual(order, ["authority", "accounting", "read", "release"]);
      assert.doesNotMatch(JSON.stringify(result.contents), /synthetic-actor|synthetic-only|"private"|synthetic-resource-private/);
      if (versionNegotiation.mode !== "legacy") { assert.equal(result.ttlMs, 0); assert.equal(result.cacheScope, "private"); }
      await client.readResource({ uri }); assert.equal(reads, 2, "zero TTL resource reads must not bypass current authority through the SDK cache");
      const beforeUnknown = reads;
      for (const other of ["file:///etc/passwd", "https://foreign.example.invalid/private", uri + "?token=private", uri + "#private", uri + "/"]) {
        await assert.rejects(() => client.readResource({ uri: other }, { cacheMode: "bypass" }));
      }
      await assert.rejects(() => client.listResources({ cursor: "unknown" }, { cacheMode: "bypass" }));
      await assert.rejects(() => client.subscribeResource({ uri })); assert.equal(reads, beforeUnknown);
      published = false; assert.deepEqual((await client.listResources({}, { cacheMode: "bypass" })).resources, []);
      await assert.rejects(() => client.readResource({ uri })); assert.equal(reads, beforeUnknown); published = true;
      for (deny of ["authority", "accounting"]) { await assert.rejects(() => client.readResource({ uri })); assert.equal(reads, beforeUnknown); }
      deny = undefined;
      for (mutate of [() => { published = false; }, () => { version = "resource-v2"; }, () => { subject = "other-subject"; }]) {
        await assert.rejects(() => client.readResource({ uri }));
        assert.doesNotMatch(lastText, /Original receipt reference|synthetic-private/);
        published = true; version = "resource-v1"; subject = "synthetic-actor";
      }
      mutate = undefined;
      const prefix = `Rental OS resource (${version})\n`;
      text = "界".repeat(2000 - [...prefix].length);
      assert.equal([...(await client.readResource({ uri })).contents[0].text].length, 2000);
      text += "界"; await assert.rejects(() => client.readResource({ uri })); text = "Released original reference.";
      for (released of [{ version: "wrong-version", text }, { version, text: "" }, { version, text: undefined },
        Object.defineProperty({ version }, "text", { enumerable: true, get() { getters++; return text; } })]) {
        await assert.rejects(() => client.readResource({ uri }));
      }
      released = undefined;
      missing = true; await assert.rejects(() => client.readResource({ uri })); missing = false;
      const descriptor = { name: "original_receipt", uri, version, description: "Released description." };
      descriptors = [descriptor];
      mutate = () => { descriptors = [{ ...descriptor, description: "Changed policy description." }]; };
      await assert.rejects(() => client.readResource({ uri })); mutate = undefined;
      descriptors = Array.from({ length: 50 }, (_, index) => ({ ...descriptor, name: `r${index}`, uri: `${uri}/${index}` }));
      assert.equal((await client.listResources({}, { cacheMode: "bypass" })).resources.length, 50);
      for (descriptors of [[{ ...descriptor, uri: "file:///private" }], [{ ...descriptor, uri: uri + "?secret=private" }],
        [{ ...descriptor, uri: "https://foreign.example.invalid/private" }], [descriptor, descriptor],
        [Object.defineProperty({ ...descriptor }, "description", { enumerable: true, get() { getters++; return "unsafe"; } })],
        Array.from({ length: 51 }, (_, index) => ({ ...descriptor, name: `r${index}`, uri: `${uri}/${index}` }))]) {
        await assert.rejects(() => client.listResources({}, { cacheMode: "bypass" }));
      }
      assert.equal(getters, 0);
      descriptors = Array.from({ length: 50 }, (_, index) => ({ ...descriptor, name: `r${index}`, uri: `${uri}/${index}`, description: "界".repeat(1800) }));
      await assert.rejects(() => client.listResources({}, { cacheMode: "bypass" })); assert.equal(lastStatus, 503, "complete envelope exceeds 64 KiB");
      descriptors = undefined;
      const saved = { list: original.list, read: original.read };
      original.list = original.read = async () => { throw new Error("replacement-provider-must-not-run"); };
      await client.readResource({ uri }); Object.assign(original, saved);
      hold = { started: Promise.withResolvers(), release: Promise.withResolvers(), settled: Promise.withResolvers() };
      const controller = new AbortController(), pending = client.readResource({ uri }, { signal: controller.signal });
      const cancelled = pending.then(() => false, () => true); await hold.started.promise; controller.abort(); assert.equal(await cancelled, true);
      await endpoint.close(); assert.equal(hold.signal.aborted, true); hold.release.resolve(); await hold.settled.promise;
    } finally { await client.close(); }
  }
  assert.throws(() => create({ ...config, resources: { list: async () => [], read: async () => "body" } }), /providers/);
}

test("optional resources require current exact publication and original read owners", async t => {
  await verifyResources(t, createProtectedMcpEndpoint);
});

test("optional prompts publish current versioned guidance without business inputs or effects", async t => {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    let published = true;
    let version = "reviewed-prompt-v1";
    let text = "Choose the user's requested format. Missing facts are not zero. {{literal}}";
    let listCount = 1;
    let duplicate = false;
    let largeDescriptions = false;
    let failed = false;
    let withdrawDuringRead = false;
    let changeDuringRead = false;
    let changeSubject = false;
    let subject = "synthetic-actor";
    let missing = false;
    let reads = 0;
    let listVisits = 0;
    let hold = false;
    let readStarted;
    let readRelease;
    let readSignal;
    let readStopped;
    let readSettled;
    const endpoint = fixture(t, async () => ({ ...verified(), subject }), { prompts: {
      list: async authorization => {
        assert.equal(authorization.subject, "synthetic-actor");
        assert.equal(Object.isFrozen(authorization), true);
        listVisits++;
        if (failed) throw new Error("synthetic-private-prompt-policy");
        return published ? Array.from({ length: listCount }, (_, index) => ({
          name: duplicate ? "synthetic_prompt" : index === 0 ? "synthetic_prompt" : `synthetic_prompt_${index}`,
          version, description: largeDescriptions ? "界".repeat(1800) : "Use the reviewed starting guidance.",
          private_field: "synthetic-prompt-secret",
        })) : [];
      },
      read: async (authorization, name, signal) => {
        assert.equal(authorization.subject, "synthetic-actor");
        assert.equal(name, "synthetic_prompt");
        reads++;
        if (failed) throw new Error("synthetic-private-prompt-policy");
        if (hold) {
          readSignal = signal;
          signal.addEventListener("abort", () => readStopped(), { once: true });
          readStarted();
          await new Promise(resolve => { readRelease = resolve; });
          readSettled();
        }
        const released = { version, text, private_field: "synthetic-prompt-secret" };
        if (withdrawDuringRead) published = false;
        if (changeDuringRead) version = "reviewed-prompt-v2";
        if (changeSubject) subject = "synthetic-other-actor";
        return missing ? undefined : released;
      },
    } });
    assert.equal((await endpoint.fetch(post(body("prompts/list")))).status, 401);
    assert.equal(listVisits, 0, "unauthenticated prompt discovery never calls its provider");
    let lastStatus;
    let lastText;
    const client = new Client({ name: "prompts-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: async (input, init) => {
          const response = await endpoint.fetch(new Request(input, init));
          lastStatus = response.status;
          lastText = await response.clone().text();
          return response;
        }, authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      assert.equal(client.getServerCapabilities().prompts.listChanged, false);
      assert.equal(client.getServerCapabilities().resources, undefined);
      assert.deepEqual((await client.listTools()).tools, []);
      const listing = await client.listPrompts({ cursor: "" }, { cacheMode: "bypass" });
      assert.equal(listing.nextCursor, undefined);
      assert.deepEqual(listing.prompts, [{ name: "synthetic_prompt", description: `Rental OS guidance (${version})\nUse the reviewed starting guidance.` }]);
      assert.equal(reads, 0, "prompt listing cannot read a template or run business code");
      const value = await client.getPrompt({ name: "synthetic_prompt" });
      assert.deepEqual(value.messages, [{ role: "user", content: { type: "text", text: `Rental OS guidance (${version})\n${text}` } }]);
      assert.doesNotMatch(JSON.stringify(value), /synthetic-actor|private_field|synthetic-prompt-secret|synthetic-only/);
      const beforeInvalid = reads;
      for (const arguments_ of [{ actor: "forged" }, { query: "personal data" }]) {
        await assert.rejects(() => client.getPrompt({ name: "synthetic_prompt", arguments: arguments_ }), error => error.code === -32602);
      }
      await assert.rejects(() => client.getPrompt({ name: "unknown_prompt" }), error => error.code === -32602);
      await assert.rejects(() => client.listPrompts({ cursor: "forged" }, { cacheMode: "bypass" }), error => error.code === -32602);
      assert.equal(reads, beforeInvalid);
      published = false;
      assert.deepEqual((await client.listPrompts({ cursor: "" }, { cacheMode: "bypass" })).prompts, []);
      await assert.rejects(() => client.getPrompt({ name: "synthetic_prompt" }), error => error.code === -32602);
      assert.equal(reads, beforeInvalid, "cached prompt names cannot bypass a withdrawn publication");
      published = true;
      version = "reviewed-prompt-v2";
      assert.match((await client.getPrompt({ name: "synthetic_prompt" })).messages[0].content.text, /reviewed-prompt-v2/);
      const prefix = `Rental OS guidance (${version})\n`;
      text = "界".repeat(2000 - [...prefix].length);
      assert.equal([...(await client.getPrompt({ name: "synthetic_prompt" })).messages[0].content.text].length, 2000);
      text += "界";
      await assert.rejects(() => client.getPrompt({ name: "synthetic_prompt" }));
      text = "Reviewed facts and missing facts stay distinct.";
      withdrawDuringRead = true;
      await assert.rejects(() => client.getPrompt({ name: "synthetic_prompt" }));
      assert.doesNotMatch(lastText, /Reviewed facts/);
      published = true;
      withdrawDuringRead = false;
      changeDuringRead = true;
      version = "reviewed-prompt-v1";
      await assert.rejects(() => client.getPrompt({ name: "synthetic_prompt" }));
      changeDuringRead = false;
      changeSubject = true;
      await assert.rejects(() => client.getPrompt({ name: "synthetic_prompt" }));
      assert.equal(lastStatus, 503, "the same client/scope cannot receive guidance after its subject changes");
      assert.doesNotMatch(lastText, /Reviewed facts|synthetic-other-actor/);
      changeSubject = false;
      subject = "synthetic-actor";
      missing = true;
      await assert.rejects(() => client.getPrompt({ name: "synthetic_prompt" }));
      missing = false;
      listCount = 50;
      assert.equal((await client.listPrompts({ cursor: "" }, { cacheMode: "bypass" })).prompts.length, 50);
      listCount = 51;
      await assert.rejects(() => client.listPrompts({ cursor: "" }, { cacheMode: "bypass" }));
      listCount = 2;
      duplicate = true;
      await assert.rejects(() => client.listPrompts({ cursor: "" }, { cacheMode: "bypass" }));
      duplicate = false;
      listCount = 50;
      largeDescriptions = true;
      await assert.rejects(() => client.listPrompts({ cursor: "" }, { cacheMode: "bypass" }));
      assert.equal(lastStatus, 503, "individually valid descriptions cannot exceed the complete 64 KiB response");
      largeDescriptions = false;
      listCount = 1;
      failed = true;
      await assert.rejects(() => client.listPrompts({ cursor: "" }, { cacheMode: "bypass" }));
      assert.doesNotMatch(lastText, /synthetic-private-prompt-policy|synthetic-prompt-secret/);
      failed = false;
      hold = true;
      const begun = new Promise(resolve => { readStarted = resolve; });
      const stopped = new Promise(resolve => { readStopped = resolve; });
      const settled = new Promise(resolve => { readSettled = resolve; });
      const controller = new AbortController();
      const pending = client.getPrompt({ name: "synthetic_prompt" }, { signal: controller.signal });
      const outcome = pending.then(() => false, () => true);
      await begun;
      controller.abort();
      assert.equal(await outcome, true);
      // Modern cancellation closes its request; legacy stateless notification
      // does not abort another handler instance. Its owner still bounds shutdown.
      if (versionNegotiation.mode !== "legacy") await stopped;
      await endpoint.close();
      await stopped;
      assert.equal(readSignal.aborted, true);
      readRelease();
      await settled;
    } finally { await client.close(); }
  }
  assert.throws(() => createProtectedMcpEndpoint({ ...config, prompts: { list: async () => [] } }), /providers/);
});

test("versioned instructions use the approved provider without granting tools or prompts", async t => {
  const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
  let text = "Choose the format the user needs. Missing facts are not zero. {{literal}}";
  let version = "reviewed-v1";
  let allowed = true;
  let visits = 0;
  let failed = false;
  const endpoint = fixture(t, async () => verified(), { instructions: { read: async (auth, signal) => {
    assert.equal(auth.clientId, "synthetic-client");
    assert.equal(signal.aborted, false);
    visits++;
    if (failed) throw new Error("synthetic-secret-policy-body");
    return allowed ? { version, text } : undefined;
  } } });
  assert.equal((await endpoint.fetch(post(body("server/discover")))).status, 401);
  assert.equal(visits, 0, "unauthenticated discovery never reads released guidance");
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "instructions-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: inProcess(endpoint), authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      assert.equal(client.getInstructions(), `Rental OS guidance (${version})\n${text}`);
      assert.deepEqual((await client.listTools()).tools, []);
      assert.equal(client.getServerCapabilities().prompts, undefined);
    } finally { await client.close(); }
  }
  const current = new Client({ name: "instructions-update", version: "1" }, { capabilities: {}, versionNegotiation: { mode: { pin: "2026-07-28" } } });
  try {
    await current.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint), authProvider: { token: async () => "synthetic-only" } }));
    version = "reviewed-v2";
    text = "No generated approval controls.";
    const updated = await current.discover();
    assert.equal(updated.instructions, `Rental OS guidance (${version})\n${text}`);
    allowed = false;
    assert.equal((await current.discover()).instructions, undefined);
    allowed = true;
    text = "界".repeat(2001);
    await assert.rejects(() => current.discover());
    text = "Guidance body";
    version = "not a version";
    await assert.rejects(() => current.discover());
    failed = true;
    const rejected = await endpoint.fetch(post(body("server/discover"), { Authorization: "Bearer synthetic-only" }));
    assert.doesNotMatch(await rejected.text(), /synthetic-secret-policy-body/);
  } finally { await current.close(); }
});

test("introspection cancellation reaches its AS adapter and late active replies cannot dispatch", async t => {
  let started;
  let release;
  let observedSignal;
  const begun = new Promise(resolve => { started = resolve; });
  const late = new Promise(resolve => { release = resolve; });
  const verifier = createIntrospectionVerifier({ issuer, resourceUrl: resource, endpoint: "https://auth.example.invalid/introspect",
    allowedClientIds: ["registered-client"], allowedScopes: [], timeoutMs: 1000, maxResponseBytes: 4096 },
  { headers: async () => new Headers({ Authorization: "Basic synthetic-AS-only" }) }, async (_input, init) => {
    observedSignal = init.signal; started(); return late;
  });
  const endpoint = createProtectedMcpEndpoint(config, verifier);
  t.after(() => endpoint.close());
  const controller = new AbortController();
  const pending = endpoint.fetch(new Request(post(body("tools/list"), { Authorization: "Bearer synthetic-resource-only" }), { signal: controller.signal }));
  await begun;
  controller.abort();
  const stopped = await pending;
  assert.ok([500, 503].includes(stopped.status));
  assert.equal(observedSignal.aborted, true);
  release(Response.json({ active: true, iss: issuer, aud: resource, sub: "synthetic-actor", client_id: "registered-client",
    token_type: "Bearer", exp: Math.floor(Date.now() / 1000) + 60, scope: "" }));
  await late;
  assert.doesNotMatch(await stopped.text(), /synthetic-actor|tools/);
});
