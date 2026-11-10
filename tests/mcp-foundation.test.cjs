"use strict";
/** Real official SDKs and new package sources; all HTTP stays in-process with synthetic identity evidence. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire, registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const toolchainRoot = path.resolve(process.env.MCP_TEST_TOOLCHAIN_ROOT || path.join(root, "clients/agent-desktop/harness"));
const ts = require(path.join(toolchainRoot, "node_modules/typescript/lib/typescript.js"));
// Test-only resolution of this tree's existing, fixed SDK installation. Product
// sources use package exports, never this Harness path or copied node_modules.
const installed = createRequire(path.join(toolchainRoot, "packages/mcp/mcp-client/package.json"));
const sourceCache = new Map();
function source(relative) {
  const file = path.join(root, relative);
  if (sourceCache.has(file)) return sourceCache.get(file);
  const javascript = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
    fileName: file,
  }).outputText;
  const module = { exports: {} };
  const localRequire = specifier => specifier === "@rental-os/shared" ? source("packages/shared/src/index.ts")
    : specifier.startsWith(".")
      ? source(path.relative(root, path.resolve(path.dirname(file), specifier.endsWith(".js") ? specifier.replace(/\.js$/, ".ts") : `${specifier}.ts`)))
      : file.startsWith(path.join(root, "packages/shared/src")) ? require(specifier) : installed(specifier);
  new Function("require", "module", "exports", javascript)(localRequire, module, module.exports);
  sourceCache.set(file, module.exports);
  return module.exports;
}
const { createProtectedMcpEndpoint, createIntrospectionVerifier, ResourceAuthorizationError } = source("packages/mcp-server/src/index.ts");
const { inspectRentalMcpConnection, ConnectionInspectionError } = source("clients/harness-plugin/src/connection.ts");
const { Client, StreamableHTTPClientTransport } = installed("@modelcontextprotocol/client");
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

async function verifyBusinessCapabilityMapping(t, mapping) {
  const expected = [
    ["rental.catalog.search", "rental_catalog_search", "read"],
    ["rental.availability.check", "rental_availability_check", "read"],
    ["membership.customer.resolve", "rental_customer_selection_read", "read"],
    ["rental.order.explain", "rental_order_explain", "read"],
    ["rental.quote.preview", "rental_quote_prepare", "quote_save"],
    ["rental.order.propose", "rental_order_propose", "proposal_save"],
    ["rental.order.commit", "rental_order_commit", "approved_order_commit"],
  ];
  assert.deepEqual(mapping.MCP_BUSINESS_CAPABILITIES.map(item => [item.code, item.name, item.operation]), expected);
  assert.equal(mapping.MCP_CAPABILITY_MAPPING_VERSION, "rental-mcp-capability-map-1");
  assert.deepEqual(mapping.MCP_BUSINESS_CAPABILITIES.map(item => item.risk), ["R0", "R0", "R0", "R0", "R1", "R1", "R2"]);
  const originalBaseline = source("apps/api/src/modules/ai-native/tool-baseline.ts").AI_TOOL_BASELINE;
  for (const item of mapping.MCP_BUSINESS_CAPABILITIES) {
    const original = originalBaseline.find(row => row.code === item.code);
    assert.equal(item.risk, original.risk);
    assert.equal(item.operation === "read", original.sideEffects.length === 0);
  }
  assert.equal(Object.isFrozen(mapping.MCP_BUSINESS_CAPABILITIES), true);
  const publicCodes = source("packages/shared/src/index.ts").AI_TOOL_CODES;
  for (const item of mapping.MCP_BUSINESS_CAPABILITIES) {
    assert.ok(publicCodes.includes(item.code));
    assert.equal(item.mappingVersion, mapping.MCP_CAPABILITY_MAPPING_VERSION);
    assert.equal(Object.isFrozen(item), true);
    assert.match(item.name, /^[A-Za-z0-9_-]{1,48}$/);
    assert.throws(() => { item.operation = "read"; }, TypeError);
  }
  assert.equal(new Set(expected.map(item => item[1])).size, expected.length);
  let reads = 0, published = true;
  const called = [], accounting = [];
  const schema = { type: "object", properties: {}, additionalProperties: false };
  const outputSchema = { type: "object", properties: { fact: { type: "string" } }, required: ["fact"], additionalProperties: false };
  const binding = { description: "Synthetic mapping fixture only; not a production business reader.", inputSchema: schema, outputSchema,
    async read() { reads++; return { fact: "fixture fact", private_field: "not-released" }; } };
  for (const code of ["rental.quote.preview", "rental.order.propose", "rental.order.commit", "tenant.config.propose", "rental_order_commit", "unknown"]) {
    assert.throws(() => mapping.createMappedBusinessRead(code, binding), /not a mapped read/);
  }
  const tools = expected.filter(item => item[2] === "read").map(([code]) => mapping.createMappedBusinessRead(code, binding));
  assert.equal(reads, 0, "mapping construction never invokes a producer or grants publication");
  assert.notEqual(tools[0].inputSchema, schema);
  binding.read = async () => { throw new Error("Replaced original reader must not run"); };
  const endpoint = fixture(t, undefined, { readTools: { tools,
    publication: { allows: async () => published },
    authority: { withRead: async (_auth, name, _input, consume) => { called.push(name); return consume(); } },
    accounting: { withCall: async (_auth, name, _input, consume) => { accounting.push(name); return consume(); } },
    release: { project: async (_auth, _name, value) => ({ fact: value.fact }) },
  } });
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    published = true;
    const client = new Client({ name: "mapped-business-fixture", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: inProcess(endpoint), authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      const listed = (await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools;
      assert.deepEqual(listed.map(tool => tool.name), tools.map(tool => tool.name));
      assert.ok(listed.every(tool => tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint === false));
      for (const tool of tools) {
        const result = await client.callTool({ name: tool.name, arguments: {} });
        assert.deepEqual(result.structuredContent, { fact: "fixture fact" });
        assert.doesNotMatch(JSON.stringify(result), /private_field|not-released/);
      }
      const beforeDenied = reads;
      for (const name of ["rental_quote_prepare", "rental_order_propose", "rental_order_commit", "rental.catalog.search"]) {
        await assert.rejects(() => client.callTool({ name, arguments: {} }));
      }
      published = false;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: tools[0].name, arguments: {} }));
      assert.equal(reads, beforeDenied, "side-effect names and withdrawn mapped reads never dispatch");
    } finally { await client.close(); }
  }
  assert.deepEqual(called, accounting);
  assert.deepEqual(called, [...tools, ...tools].map(tool => tool.name));
}

test("fixed business mapping keeps public codes and refuses side effects in read construction", async t => {
  await verifyBusinessCapabilityMapping(t, source("packages/mcp-server/src/capability-mapping.ts"));
});

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

function compileSharedExport(output) {
  const packageRoot = path.join(root, "packages/shared");
  const staged = path.join(output, "node_modules/@rental-os/shared");
  fs.mkdirSync(staged, { recursive: true });
  fs.copyFileSync(path.join(packageRoot, "package.json"), path.join(staged, "package.json"));
  const parsed = ts.readConfigFile(path.join(packageRoot, "tsconfig.json"), ts.sys.readFile);
  assert.equal(parsed.error, undefined);
  const configured = ts.parseJsonConfigFileContent(parsed.config, ts.sys, packageRoot);
  const program = ts.createProgram(configured.fileNames, { ...configured.options,
    module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, composite: false,
    rootDir: path.join(packageRoot, "src"), outDir: path.join(staged, "dist"),
    paths: { zod: [path.join(path.dirname(require.resolve("zod/package.json")), "index.d.cts")] },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  assert.equal(program.emit().emitSkipped, false);
  return staged;
}

function conversationResult(status = "unknown", sceneCode = "order_explanation") {
  const draftVersion = "ain-conversation-draft-2", createdAt = "2026-10-29T00:00:00Z";
  const original = { draftVersion: "ain-scene-request-draft-1", inputRef: "00000000-0000-4000-8000-000000000001" };
  const turn = { admissionKey: "admission-a", turnId: "turn-a", originalRequestKey: "request-a", requestHash: "a".repeat(64),
    capabilityCode: sceneCode, capabilityVersion: "scene-1", createdAt, automaticRetry: false,
    status: "original_bound", original, execution: "not_inferred_from_association", material: "retained", task: { taskId: "task-a", runId: "run-a" } };
  const result = { original: { ...original, revision: 1, contentHash: "a".repeat(64), sceneCode, sceneVersion: "scene-1", requestKey: "request-a",
    previousInputRef: null, expiresAt: "2026-11-01T00:00:00Z", createdAt, state: "stored" }, sceneCode,
    taskId: "task-a", runId: "run-a", resultId: "result-a", observedAt: createdAt, businessExecution: "not_inferred_from_model_result",
    status, text: null, automaticRetry: false,
    nextAction: status === "unknown" ? "reconcile" : status === "failed" ? "manual_review" : "reread_facts" };
  if (status === "available") {
    const scope = { kind: "workspace", tenantId: "tenant-a", workspaceId: "workspace-a" };
    const source = { scope, resourceType: "order", resourceId: "order-a", version: createdAt, observedAt: createdAt, field: "order" };
    const payload = { scope, audience: "operator", observedAt: createdAt, status: "facts_only", orderId: "order-a", orderVersion: createdAt, question: "status",
      facts: { order: { coverage: "partial", value: { id: "order-a", status: "renting", updatedAt: createdAt }, source } }, gaps: [],
      model: { status: "not_requested", answer: "not_generated" }, handoff: { status: "manual_review_only", resource: { kind: "order_resource", scope, orderId: "order-a" },
        candidates: [], allowedActions: "not_queried", blockers: ["not_approved", "no_execution"], informationNeeded: [], execution: "not_attempted" } };
    delete result.automaticRetry;
    Object.assign(result, { text: { value: "Existing unverified answer.", trust: "unverified_model_text_not_execution_evidence" }, materialHash: "b".repeat(64), callId: "call-a",
      facts: { version: "lane-a-business-content-1", scenario: "order_explanation", payload, payloadFingerprint: "b".repeat(64), payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
        trust: "source_text_is_data_not_instructions", authority: "none_reauthorize_before_consumption" }, sources: [source],
      citationValidation: "supplied_sources_only_text_not_validated", nextAction: "read_only" });
  }
  return { draftVersion, conversationId: "conversation-a", admissionKey: "admission-a", turn,
    status: "observed", result, execution: "read_only_no_start_no_dispatch" };
}

async function verifyConversationRead(t, createRead) {
  const command = { draftVersion: "ain-conversation-draft-2", conversationId: "conversation-a", admissionKey: "admission-a", resultId: "result-a" };
  let current = conversationResult(), readCalls = 0, published = true;
  let afterRead;
  const order = [];
  let hold;
  const originals = source("apps/api/src/contracts/ai-native-schemas.ts").AI_NATIVE_COMPONENT_SCHEMAS;
  const originalSchemas = { AiOrderExplainRequestDraft: originals.AiOrderExplainRequestDraft, AiOrderExplainInput: originals.AiOrderExplainInput };
  const outputSchema = { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false };
  assert.throws(() => createRead({ name: "missing_schema", description: "No publication.", originalSchemas: {}, outputSchema, read: async () => current }), /schema reference unavailable/);
  const binding = { name: "synthetic_original_model_result", description: "Read an existing authorized result; this does not start a model or grant approval.", originalSchemas, outputSchema,
    read: async (input, signal) => {
      assert.deepEqual(input, command);
      readCalls++; order.push("read");
      if (hold) { const held = hold; held.started.resolve(); await held.release.promise; held.settled.resolve(); }
      queueMicrotask(() => queueMicrotask(() => afterRead?.()));
      return current;
    } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Original reader replacement must not run"); };
  const mutableInput = { ...command };
  const inputRead = read.read(mutableInput, signal());
  queueMicrotask(() => { mutableInput.resultId = "changed-after-validation"; });
  assert.deepEqual(await inputRead, current, "the direct input remains the original validated snapshot across its await");
  assert.equal(mutableInput.resultId, "changed-after-validation");
  let inputGetterCalls = 0;
  const inputAccessor = { ...command };
  Object.defineProperty(inputAccessor, "resultId", { enumerable: true, get() { inputGetterCalls++; return command.resultId; } });
  const beforeInputAccessor = readCalls;
  await assert.rejects(() => read.read(inputAccessor, signal()));
  assert.equal(inputGetterCalls, 0);
  assert.equal(readCalls, beforeInputAccessor, "a direct getter input never enters the original adapter");
  assert.equal(read.inputSchema.properties.admissionKey.maxLength, 128);
  assert.equal(read.inputSchema.properties.resultId.pattern, "^[A-Za-z0-9][A-Za-z0-9._:-]*$");
  assert.throws(() => installed("@deepseek-ai/dsh-tools").assertSupportedJsonSchema(read.inputSchema), error => error.code === "UNSUPPORTED_SCHEMA",
    "the original Host rejects the actual shared constraints instead of dropping them");
  assert.throws(() => createRead({ name: "override_schema", description: "No override.", outputSchema, originalSchemas: {
    ...originalSchemas, AiConversationModelResultReadDraft: { type: "object", additionalProperties: true },
  }, read: async () => current }), /must not override/);
  const endpoint = fixture(t, async () => verified(), { readTools: {
    tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (auth, _name, _input, consume) => { assert.equal(auth.subject, "synthetic-actor"); order.push("authority"); return consume(); } },
    accounting: { withCall: async (_auth, _name, _input, consume) => { order.push("accounting"); return consume(); } },
    // This permissive test projection is not a production field policy. The
    // original private result was already checked before this test release.
    release: { project: async (_auth, _name, value) => { order.push("release"); return { observation: value }; } },
  } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "original-result-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
        fetch: inProcess(endpoint), authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw",
      }));
      const tools = (await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools;
      assert.deepEqual(tools.map(tool => tool.name), [read.name]);
      const beforeInvalid = readCalls;
      for (const input of [{ ...command, actor: "forged" }, { ...command, reader: "arbitrary" }, { ...command, draftVersion: "old" },
        { ...command, admissionKey: "" }, { ...command, resultId: "https://not-a-result.invalid/" }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: input })).isError, true);
      }
      assert.equal(readCalls, beforeInvalid);
      await assert.rejects(() => read.read({ ...command, tool: "arbitrary" }, signal()));
      assert.equal(readCalls, beforeInvalid, "the original adapter also rejects a direct malformed invocation");
      for (const scene of ["order_explanation", "opening_diagnosis", "quote_clarification"]) {
        for (const status of ["unknown", "failed", "stale"]) {
          current = conversationResult(status, scene);
          const result = await client.callTool({ name: read.name, arguments: command });
          assert.deepEqual(result.structuredContent.observation, current);
          assert.equal(result.structuredContent.observation.result.text, null);
          assert.equal(result.structuredContent.observation.result.automaticRetry, false);
          assert.deepEqual(order.slice(-4), ["authority", "accounting", "read", "release"]);
        }
      }
      current = conversationResult("available");
      const available = await client.callTool({ name: read.name, arguments: command });
      assert.deepEqual(available.structuredContent.observation, current);
      assert.equal(available.structuredContent.observation.result.text.trust, "unverified_model_text_not_execution_evidence");
      assert.deepEqual(JSON.parse(available.content[0].text), available.structuredContent);
      current.result.text.value = "界".repeat(2001);
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true, "a valid larger Web result is not truncated into an MCP fact");
      for (const change of [
        value => { value.conversationId = "other"; }, value => { value.turn.admissionKey = "other"; },
        value => { value.result.resultId = "other"; }, value => { value.result.taskId = "other"; },
        value => { value.result.original.inputRef = "00000000-0000-4000-8000-000000000002"; },
        value => { value.result.original.sceneVersion = "other"; }, value => { value.result.original.requestKey = "other"; },
        value => { value.result.sceneCode = "opening_diagnosis"; value.result.original.sceneCode = "opening_diagnosis"; },
        value => { value.result.status = "unknown"; value.result.text = { value: "synthetic-private-result", trust: "unverified_model_text_not_execution_evidence" }; },
      ]) {
        current = conversationResult(); change(current);
        const releases = order.filter(step => step === "release").length;
        const rejected = await client.callTool({ name: read.name, arguments: command });
        assert.equal(rejected.isError, true);
        assert.doesNotMatch(JSON.stringify(rejected), /synthetic-private-result/);
        assert.equal(order.filter(step => step === "release").length, releases, "mismatched original bindings cannot reach external projection");
      }
      current = conversationResult(); current.turn.material = "erased";
      current.status = "material_erased"; current.result = null; current.nextAction = "original_task_center";
      assert.deepEqual((await client.callTool({ name: read.name, arguments: command })).structuredContent.observation, current);
      current.turn.material = "retained";
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
      let getterCalls = 0;
      const accessor = conversationResult();
      Object.defineProperty(accessor.result, "text", { enumerable: true, get() { getterCalls++; return null; } });
      const invisible = conversationResult();
      Object.defineProperty(invisible, "private", { value: "synthetic-invisible-original" });
      for (current of [accessor, invisible, { ...conversationResult(), toJSON() { getterCalls++; return conversationResult(); } },
        { ...conversationResult(), lost: undefined }, { ...conversationResult(), money: NaN }]) {
        const releases = order.filter(step => step === "release").length;
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
        assert.equal(order.filter(step => step === "release").length, releases, "non-JSON original data cannot reach external projection");
      }
      assert.equal(getterCalls, 0, "private validation never invokes a getter or custom JSON conversion");
      current = conversationResult("available");
      current.result.text.value = "界".repeat(45_000);
      const releases = order.filter(step => step === "release").length;
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
      assert.equal(order.filter(step => step === "release").length, releases, "the original complete 128 KiB limit precedes field projection");
      current = conversationResult("available");
      current.result.text.value = "";
      current.result.text.value = "x".repeat(131_072 - Buffer.byteLength(JSON.stringify(current), "utf8"));
      assert.equal(Buffer.byteLength(JSON.stringify(current), "utf8"), 131_072);
      assert.deepEqual(await read.read(command, signal()), current, "exact original observation byte limit stays valid privately");
      current.result.text.value += "x";
      await assert.rejects(() => read.read(command, signal()), /Original result unavailable/);
      current = conversationResult();
      const expectedSnapshot = structuredClone(current);
      let changed = false;
      afterRead = () => { changed = true; current.result.status = "failed"; current.result.nextAction = "manual_review"; };
      const detached = await read.read(command, signal());
      assert.equal(changed, true, "the provider's object changes across the validator await");
      assert.deepEqual(detached, expectedSnapshot, "the validated result is detached before that await");
      afterRead = undefined;
      published = false;
      const beforeWithdrawal = readCalls;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(readCalls, beforeWithdrawal);
      published = true;
      const held = { started: Promise.withResolvers(), release: Promise.withResolvers(), settled: Promise.withResolvers() };
      hold = held;
      const abort = new AbortController();
      const pending = read.read(command, abort.signal);
      await held.started.promise;
      const outcome = assert.rejects(pending, /Original result unavailable/);
      abort.abort(); held.release.resolve(); await held.settled.promise; await outcome;
      hold = undefined;
    } finally { await client.close(); }
  }
}

test("original conversation result read preserves public references without dispatch", async t => {
  const { createConversationResultRead } = source("packages/mcp-server/src/conversation-result-read.ts");
  await verifyConversationRead(t, createConversationResultRead);
});

function taskRecovery(state = "observed") {
  if (state === "not_observed") return { task: { state, retryable: false }, nextAction: "reconcile_request_or_explicit_create_task", automaticExecution: false };
  return { task: { state, taskId: "00000000-0000-4000-8000-000000000002", runId: "00000000-0000-4000-8000-000000000003",
    status: "cancelled", revision: 1, plan: "stored", resultAvailable: false, execution: "not_inferred_from_metadata" },
    steps: [{ stepId: "step-a", runId: "00000000-0000-4000-8000-000000000003", actionId: "action-a", revision: 1,
      status: "unknown", effect: "possible", resultAvailable: true, nextAction: "reconcile_original_action" }], hasMore: false,
    automaticExecution: false, nextAction: "existing_runner_recovery", observedResults: "preserved_even_if_task_cancelled", snapshot: "bounded_sequential_read" };
}

async function verifyTaskRecoveryRead(t, createRead) {
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

function selectedProposalReview(status = "pending_confirmation") {
  const selection = quoteSelectionReceipt();
  const target = { resourceType: "quote", resourceId: selection.quoteId, version: "original-quote-version" };
  return { draftVersion: "ain-approval-application-draft-1", proposal: { payloadHash: "c".repeat(64), status,
    payload: { contractVersion: "ain-c05-draft-1", proposalId: "proposal-a", taskId: selection.taskId, revision: 1,
      audience: "operator", scope: { kind: "workspace", tenantId: "tenant-a", workspaceId: "workspace-a" },
      atomicity: "single_action", failurePolicy: "stop_and_reconcile", expiresAt: "2026-10-31T23:59:00.000Z",
      actions: [{ actionId: "original-action", toolCode: "rental.order.commit", toolVersion: "draft-1", target,
        input: { recordId: "input-a", revision: 1, contentHash: selection.inputHash },
        preview: { recordId: "preview-a", revision: 1, contentHash: selection.quoteHash } }] } },
    deterministic: { target: { ...target }, quoteAmounts: { rentalAmount: 123, discountAmount: 0, couponAmount: 0,
      serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0, payableAmount: 123, receivableAmount: 123 },
      currency: "CNY", quoteExpiresAt: "2026-10-31T23:59:00.000Z", decisionExpiresAt: "2026-10-31T23:59:00.000Z" }, generatedText: null };
}

async function verifySelectedProposalRead(t, createRead) {
  const selection = quoteSelectionReceipt(), review = selectedProposalReview();
  const command = { selection: { draftVersion: selection.draftVersion, originalInputRef: selection.originalInputRef,
    selectionId: selection.selectionId, taskId: selection.taskId, runId: selection.runId, inputHash: selection.inputHash },
    proposal: { contractVersion: review.proposal.payload.contractVersion, proposalId: review.proposal.payload.proposalId,
      proposalRevision: review.proposal.payload.revision, reviewedPayloadHash: review.proposal.payloadHash } };
  const outputSchema = { type: "object", properties: { status: { type: "string" }, facts: { type: "object" } },
    required: ["status", "facts"], additionalProperties: false };
  let current = review, calls = 0, releases = 0, published = true, hold;
  const binding = { name: "synthetic_selected_proposal_read", description: "Read the original review, not approval or execution.", outputSchema,
    read: async input => { assert.deepEqual(input, command); calls++; if (hold) { hold.started.resolve(); await hold.release.promise; } return current; } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Replacement review must not run"); };
  assert.equal(calls, 0);
  assert.throws(() => installed("@deepseek-ai/dsh-tools").assertSupportedJsonSchema(read.inputSchema), error => error.code === "UNSUPPORTED_SCHEMA");
  const endpoint = fixture(t, undefined, { readTools: { tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    // Test-only projection deliberately omits scope and immutable snapshot locators.
    release: { project: async (_auth, _name, value) => { releases++; return { status: value.proposal.status, facts: value.deterministic }; } } } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "selected-proposal-read-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      const beforeInput = calls;
      for (const input of [{ ...command, decision: "approve" }, { ...command, proposal: { ...command.proposal, decision: "approve" } },
        { ...command, confirmed: true }, { ...command, lease: {} }, { ...command, actor: "forged" }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: input })).isError, true);
      }
      assert.equal(calls, beforeInput);
      for (const status of ["pending_confirmation", "confirmed", "cancelled", "expired", "superseded"]) {
        current = selectedProposalReview(status);
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.deepEqual(result.structuredContent, { status, facts: current.deterministic });
        assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
        assert.doesNotMatch(JSON.stringify(result), /workspace-a|input-a|preview-a|original-action/);
      }
      let getters = 0;
      for (const change of [value => { value.proposal.payloadHash = "f".repeat(64); }, value => { value.proposal.payload.taskId = "other-task"; },
        value => { value.proposal.payload.revision = 2; }, value => { value.proposal.payload.actions[0].input.contentHash = "f".repeat(64); },
        value => { value.proposal.payload.actions[0].toolCode = "tenant.config.propose"; }, value => { value.deterministic.target.resourceId = "other-quote"; },
        value => { value.generatedText = "synthetic-private-review"; }, value => { value.deterministic.quoteAmounts.payableAmount = null; },
        value => { Object.defineProperty(value, "proposal", { enumerable: true, get() { getters++; return review.proposal; } }); }]) {
        current = selectedProposalReview(); change(current); const beforeRelease = releases;
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.isError, true); assert.equal(releases, beforeRelease);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-review/);
      }
      assert.equal(getters, 0); current = selectedProposalReview();
      current.deterministic.target = Object.fromEntries(Object.entries(current.deterministic.target).reverse());
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, undefined);
      published = false; const beforeWithdrawal = calls;
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(calls, beforeWithdrawal); published = true;
      hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const controller = new AbortController(), pending = read.read(command, controller.signal);
      const refused = assert.rejects(pending, /Original proposal unavailable/);
      await hold.started.promise; controller.abort(); hold.release.resolve(); await refused; hold = undefined;
    } finally { await client.close(); }
  }
}

test("selected proposal read preserves original review without approval or execution", async t => {
  await verifySelectedProposalRead(t, source("packages/mcp-server/src/selected-proposal-read.ts").createSelectedProposalRead);
});

function quoteSelectionReceipt(state = "selected_not_approved") {
  return { draftVersion: "ain-quote-selection-draft-1", originalInputRef: "00000000-0000-4000-8000-000000000001",
    selectionId: "00000000-0000-4000-8000-000000000002", selectionKey: "original-selection-key", revision: 1,
    taskId: "00000000-0000-4000-8000-000000000003", runId: "00000000-0000-4000-8000-000000000004",
    quoteId: "quote-a", quoteHash: "b".repeat(64), inputHash: "a".repeat(64), expiresAt: "2026-10-31T23:59:00.000Z",
    state, approval: "not_granted", order: "not_created_by_selection" };
}

async function verifyQuoteSelectionRead(t, createRead) {
  const { draftVersion, originalInputRef, selectionId } = quoteSelectionReceipt();
  const command = { draftVersion, originalInputRef, selectionId };
  const outputSchema = { type: "object", properties: { selection: {} }, required: ["selection"], additionalProperties: false };
  let current = quoteSelectionReceipt(), calls = 0, releases = 0, published = true, hold;
  const binding = { name: "synthetic_quote_selection_read", description: "Read an existing human selection receipt, never select or approve.", outputSchema,
    read: async input => {
      assert.deepEqual(input, command); assert.equal(Object.isFrozen(input), true); calls++;
      if (hold) { hold.started.resolve(); await hold.release.promise; }
      return current;
    } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Replacement reader must not execute"); };
  assert.equal(calls, 0);
  assert.equal(read.inputSchema.properties.selectionId.format, "uuid");
  assert.throws(() => installed("@deepseek-ai/dsh-tools").assertSupportedJsonSchema(read.inputSchema), error => error.code === "UNSUPPORTED_SCHEMA");
  const mutable = { ...command }, pending = read.read(mutable, signal());
  mutable.selectionId = "00000000-0000-4000-8000-000000000005";
  assert.deepEqual(await pending, current);
  let getters = 0;
  const accessor = Object.defineProperty({ ...command }, "selectionId", { enumerable: true,
    get() { getters++; return selectionId; } });
  const beforeInvalid = calls;
  await assert.rejects(() => read.read(accessor, signal())); assert.equal(getters, 0); assert.equal(calls, beforeInvalid);
  const endpoint = fixture(t, undefined, { readTools: { tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, _name, value) => { releases++; return { selection: value }; } } } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "quote-selection-read-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools.map(tool => tool.name), [read.name]);
      const beforeInputs = calls;
      for (const input of [{ ...command, actor: "forged" }, { ...command, confirmed: true }, { ...command, order: {} },
        { ...command, taskId: "caller-selected" }, { ...command, draftVersion: "old" }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: input })).isError, true);
      }
      assert.equal(calls, beforeInputs);
      for (current of [quoteSelectionReceipt(), quoteSelectionReceipt("expired"), quoteSelectionReceipt("superseded")]) {
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.deepEqual(result.structuredContent.selection, current);
        assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
        assert.equal(result.structuredContent.selection.approval, "not_granted");
        assert.equal(result.structuredContent.selection.order, "not_created_by_selection");
      }
      for (const change of [value => { value.selectionId = "00000000-0000-4000-8000-000000000005"; },
        value => { value.originalInputRef = "00000000-0000-4000-8000-000000000005"; }, value => { value.inputHash = "bad"; },
        value => { value.approval = "approved"; }, value => { value.private = "synthetic-private-selection"; },
        value => { Object.defineProperty(value, "quoteId", { enumerable: true, get() { getters++; return "quote-a"; } }); }]) {
        current = quoteSelectionReceipt(); change(current); const beforeRelease = releases;
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.isError, true); assert.equal(releases, beforeRelease);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-selection/);
      }
      current = undefined;
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true, "missing selection cannot authorize making another selection");
      assert.equal(getters, 0);
      current = quoteSelectionReceipt(); published = false; const beforeWithdrawal = calls;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(calls, beforeWithdrawal); published = true;
      hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const controller = new AbortController(), late = read.read(command, controller.signal);
      const refused = assert.rejects(late, /Original selection unavailable/);
      await hold.started.promise; controller.abort(); hold.release.resolve(); await refused; hold = undefined;
    } finally { await client.close(); }
  }
}

test("quote selection read preserves trusted receipt without selecting or approval", async t => {
  await verifyQuoteSelectionRead(t, source("packages/mcp-server/src/quote-selection-read.ts").createQuoteSelectionRead);
});

function selectedOrderResult(status = "committed") {
  if (status === "unknown") return { status, errorCode: "AI_RESULT_UNKNOWN", retryable: false,
    nextAction: "read_selected_order_result", sideEffect: "may_have_committed" };
  if (status === "not_observed") return { status, retryable: false, nextAction: "read_selected_order_result", sideEffect: "not_attested",
    taskOutcome: "owned_by_runner", payment: "not_inferred", fulfillment: "not_inferred" };
  return { status, replayed: true, order: { id: "order-a", status: "reserved", quoteId: "quote-a" },
    source: { resourceType: "order", resourceId: "order-a" }, payment: "not_inferred", fulfillment: "not_inferred", taskOutcome: "owned_by_runner" };
}

async function verifySelectedOrderResultRead(t, createRead) {
  const command = { selection: { draftVersion: "ain-quote-selection-draft-1", originalInputRef: "00000000-0000-4000-8000-000000000001",
    selectionId: "00000000-0000-4000-8000-000000000002", taskId: "00000000-0000-4000-8000-000000000003",
    runId: "00000000-0000-4000-8000-000000000004", inputHash: "a".repeat(64) } };
  const outputSchema = { type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false };
  let current = selectedOrderResult(), calls = 0, releases = 0, published = true, hold;
  const binding = { name: "synthetic_selected_order_result", description: "Read the original selected-order receipt, without execution or retry.", outputSchema,
    read: async input => {
      assert.deepEqual(input, command); assert.equal(Object.isFrozen(input.selection), true); calls++;
      if (hold) { hold.started.resolve(); await hold.release.promise; }
      return current;
    } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Replaced reader must not execute"); };
  assert.equal(calls, 0);
  assert.equal(read.inputSchema.properties.selection.properties.originalInputRef.format, "uuid");
  assert.throws(() => installed("@deepseek-ai/dsh-tools").assertSupportedJsonSchema(read.inputSchema), error => error.code === "UNSUPPORTED_SCHEMA");
  const mutable = structuredClone(command), pendingSnapshot = read.read(mutable, signal());
  mutable.selection.inputHash = "f".repeat(64);
  assert.deepEqual(await pendingSnapshot, current);
  let getters = 0;
  const accessor = structuredClone(command);
  Object.defineProperty(accessor.selection, "inputHash", { enumerable: true, get() { getters++; return command.selection.inputHash; } });
  const beforeInvalid = calls;
  await assert.rejects(() => read.read(accessor, signal())); assert.equal(calls, beforeInvalid); assert.equal(getters, 0);
  const endpoint = fixture(t, undefined, { readTools: { tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, _name, value) => { releases++; return { result: value }; } } } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "selected-order-result-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools.map(tool => tool.name), [read.name]);
      const reads = calls;
      for (const input of [{ ...command, lease: {} }, { ...command, confirmed: true }, { ...command, approvalId: "forged" },
        { ...command, actor: "forged" }, { ...command, selection: { ...command.selection, inputHash: "bad" } }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: input })).isError, true);
      }
      assert.equal(calls, reads, "execution and identity parameters cannot reach the reader");
      for (current of [selectedOrderResult(), selectedOrderResult("unknown"), selectedOrderResult("not_observed")]) {
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.deepEqual(result.structuredContent.result, current);
        assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      }
      for (const change of [value => { value.source.resourceId = "other-order"; }, value => { value.payment = "paid"; },
        value => { value.fulfillment = "completed"; }, value => { value.private = "synthetic-private-order-result"; },
        value => { Object.defineProperty(value.order, "id", { enumerable: true, get() { getters++; return "order-a"; } }); }]) {
        current = selectedOrderResult(); change(current); const beforeRelease = releases;
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.isError, true); assert.equal(releases, beforeRelease);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-order-result/);
      }
      current = { ...selectedOrderResult("unknown"), order: selectedOrderResult().order };
      assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
      assert.equal(getters, 0);
      current = selectedOrderResult(); published = false; const beforeWithdrawal = calls;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(calls, beforeWithdrawal); published = true;
      hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const controller = new AbortController(), pending = read.read(command, controller.signal);
      const refused = assert.rejects(pending, /Original order result unavailable/);
      await hold.started.promise; controller.abort(); hold.release.resolve(); await refused; hold = undefined;
    } finally { await client.close(); }
  }
}

test("selected order result read preserves original receipt and uncertainty without execution", async t => {
  await verifySelectedOrderResultRead(t, source("packages/mcp-server/src/selected-order-result-read.ts").createSelectedOrderResultRead);
});

function conversationOperation(status = "observed", operation = "create") {
  const base = { draftVersion: "ain-conversation-draft-2", operationKey: "operation-a", retryable: false, status };
  return status === "observed" ? { ...base, conversationId: "conversation-a", revision: 1, operation,
    taskCancellation: "not_requested", businessRecords: "not_modified" }
    : { ...base, nextAction: "read_original_operation", absence: "not_proof_of_no_commit" };
}

async function verifyOperationRead(t, createRead) {
  const command = { draftVersion: "ain-conversation-draft-2", operationKey: "operation-a" };
  const outputSchema = { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false };
  let current = conversationOperation(), calls = 0, releases = 0, published = true, hold, afterRead;
  const binding = { name: "synthetic_original_operation", description: "Read an exact original receipt; absence is not permission to retry.", outputSchema,
    read: async input => { assert.deepEqual(input, command); calls++;
      if (hold) { hold.started.resolve(); await hold.release.promise; }
      queueMicrotask(() => queueMicrotask(() => afterRead?.()));
      return current;
    } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Original reader replacement must not run"); };
  assert.equal(read.inputSchema.properties.operationKey.maxLength, 128);
  assert.throws(() => installed("@deepseek-ai/dsh-tools").assertSupportedJsonSchema(read.inputSchema), error => error.code === "UNSUPPORTED_SCHEMA");
  const input = { ...command }, pendingInput = read.read(input, signal());
  queueMicrotask(() => { input.operationKey = "changed-after-validation"; });
  assert.deepEqual(await pendingInput, current);
  let getters = 0;
  const accessor = { ...command };
  Object.defineProperty(accessor, "operationKey", { enumerable: true, get() { getters++; return command.operationKey; } });
  const beforeAccessor = calls;
  await assert.rejects(() => read.read(accessor, signal()));
  assert.equal(getters, 0); assert.equal(calls, beforeAccessor);
  const endpoint = fixture(t, async () => verified(), { readTools: { tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, _name, value) => { releases++; return { observation: value }; } } } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "original-operation-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      const beforeInvalid = calls;
      for (const value of [{ ...command, actor: "forged" }, { ...command, operation: "delete" }, { ...command, conversationId: "caller-selected" },
        { ...command, draftVersion: "old" }, { ...command, operationKey: "" }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: value })).isError, true);
      }
      assert.equal(calls, beforeInvalid);
      for (current of [conversationOperation("not_observed"), ...["create", "archive", "delete", "release_turn"].map(value => conversationOperation("observed", value))]) {
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.deepEqual(result.structuredContent.observation, current);
        assert.equal(result.structuredContent.observation.retryable, false);
        assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      }
      for (const change of [value => { value.operationKey = "other-operation"; }, value => { value.retryable = true; },
        value => { value.taskCancellation = "requested"; }, value => { value.operation = "approve"; },
        value => { value.private = "synthetic-private-operation"; },
        value => { Object.defineProperty(value, "status", { enumerable: true, get() { getters++; return "observed"; } }); }]) {
        current = conversationOperation(); change(current);
        const beforeRelease = releases;
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.isError, true); assert.equal(releases, beforeRelease);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-operation/);
      }
      assert.equal(getters, 0);
      current = conversationOperation(); const expected = structuredClone(current);
      let changed = false;
      afterRead = () => { changed = true; current.operation = "delete"; };
      assert.deepEqual(await read.read(command, signal()), expected);
      assert.equal(changed, true); afterRead = undefined;
      published = false;
      const beforeWithdraw = calls;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(calls, beforeWithdraw); published = true;
      hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const abort = new AbortController(), pending = read.read(command, abort.signal);
      await hold.started.promise;
      const cancelled = assert.rejects(pending, /Original operation unavailable/);
      abort.abort(); hold.release.resolve(); await cancelled; hold = undefined;
    } finally { await client.close(); }
  }
}

test("original conversation operation read keeps exact keys without replay", async t => {
  await verifyOperationRead(t, source("packages/mcp-server/src/conversation-operation-read.ts").createConversationOperationRead);
});

function conversationPage(count = 1, status = "active") {
  return { draftVersion: "ain-conversation-draft-2", items: Array.from({ length: count }, (_, index) => ({ conversationId: `conversation-${count - index}`,
    revision: 1, capabilityCode: "order_explanation", status, createdAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z" })),
    nextBeforeId: null, coverage: "page_not_total" };
}

async function verifyConversationList(t, createRead) {
  let current = conversationPage(), calls = 0, releases = 0, published = true, hold;
  const outputSchema = { type: "object", properties: { page: {} }, required: ["page"], additionalProperties: false };
  const binding = { name: "synthetic_conversation_page", description: "Read one authorized metadata page, not all conversations.", outputSchema,
    read: async () => { calls++; if (hold) { hold.started.resolve(); await hold.release.promise; } return current; } };
  const read = createRead(binding);
  binding.read = async () => { throw new Error("Original reader replacement must not run"); };
  const command = { draftVersion: "ain-conversation-draft-2", status: "active", limit: 1 };
  assert.equal(read.inputSchema.properties.limit.maximum, 20);
  assert.throws(() => installed("@deepseek-ai/dsh-tools").assertSupportedJsonSchema(read.inputSchema), error => error.code === "UNSUPPORTED_SCHEMA");
  const endpoint = fixture(t, async () => verified(), { readTools: { tools: [read], publication: { allows: async () => published },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, _name, value) => { releases++; return { page: value }; } } } });
  t.after(() => hold?.release.resolve());
  for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
    const client = new Client({ name: "original-page-test", version: "1" }, { capabilities: {}, versionNegotiation });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
        authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
      const beforeInvalid = calls;
      for (const input of [{ ...command, limit: 0 }, { ...command, limit: 21 }, { ...command, ownerId: "forged" },
        { ...command, status: "deleted" }, { ...command, beforeId: "https://not-a-cursor.invalid/" }]) {
        assert.equal((await client.callTool({ name: read.name, arguments: input })).isError, true);
      }
      assert.equal(calls, beforeInvalid);
      for (const status of ["active", "archived"]) {
        current = conversationPage(20, status); current.nextBeforeId = current.items.at(-1).conversationId;
        const beforeCall = calls;
        const result = await client.callTool({ name: read.name, arguments: { ...command, status, limit: 20 } });
        assert.deepEqual(result.structuredContent.page, current);
        assert.equal(calls, beforeCall + 1, "one tool call never fetches the next original page");
        assert.equal(result.structuredContent.page.coverage, "page_not_total");
      }
      current = conversationPage(0);
      assert.deepEqual((await client.callTool({ name: read.name, arguments: command })).structuredContent.page, current);
      for (const change of [value => { value.items.push({ ...value.items[0], conversationId: "other" }); },
        value => { value.items[0].status = "archived"; }, value => { value.coverage = "total"; },
        value => { value.nextBeforeId = "not-in-page"; }, value => { value.items[0].ownerId = "synthetic-private-page"; }]) {
        current = conversationPage(); change(current);
        const beforeRelease = releases;
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.isError, true); assert.equal(releases, beforeRelease);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-private-page/);
      }
      current = conversationPage(2); current.items[1].conversationId = current.items[0].conversationId;
      await assert.rejects(() => read.read({ ...command, limit: 2 }, signal()));
      current = conversationPage(); current.nextBeforeId = current.items[0].conversationId;
      await assert.rejects(() => read.read({ ...command, beforeId: current.nextBeforeId }, signal()));
      published = false; const beforeWithdraw = calls;
      assert.deepEqual((await client.listTools({ cursor: "" }, { cacheMode: "bypass" })).tools, []);
      await assert.rejects(() => client.callTool({ name: read.name, arguments: command }));
      assert.equal(calls, beforeWithdraw); published = true;
      current = conversationPage(); hold = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      const abort = new AbortController(), pending = read.read(command, abort.signal);
      await hold.started.promise;
      const cancelled = assert.rejects(pending, /Original list unavailable/);
      abort.abort(); hold.release.resolve(); await cancelled; hold = undefined;
    } finally { await client.close(); }
  }
}

test("original conversation list reads one bounded page without totals", async t => {
  await verifyConversationList(t, source("packages/mcp-server/src/conversation-list-read.ts").createConversationListRead);
});

async function verifyOriginalSelectedOrderComposition(t, createRead, createSelectionRead, createProposalRead) {
  // Original request-bound APIs and Core/approval readers run here. Identity,
  // database and external release are fixtures, not a production MCP adapter.
  const { selectedOrderHarness } = require("./fixtures/ai-native/lane-a-selected-order.cjs");
  const { composeRequestBoundSelectedQuoteTask, composeRequestBoundHumanQuoteOrder, composeRequestBoundQuoteSelections } = require("../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application.ts");
  const { clone } = require("./fixtures/ai-native/task-input-store.cjs");
  const h = await selectedOrderHarness({ initializeOnly: true });
  const { credentials, originals: _originals, ...dependencies } = h.sceneDependencies;
  dependencies.creationRules = [{ sceneCode: "quote_clarification", sceneVersion: "1", revision: 1, audiences: ["operator"],
    requiredPermissions: ["rental-os:order:create"], maxInputAgeMs: 3600000 }];
  dependencies.memberships = { listPersonalOptions: async () => [], listPersonalOptionsPage: async () => ({ rows: [], truncated: false }) };
  let ticks = 0;
  const tasks = composeRequestBoundSelectedQuoteTask(dependencies, { enabled: true, audience: "operator" },
    { host: { holderId: "mcp-order-read-fixture", leaseMs: 100000 }, limits: h.limits, monotonic: () => ++ticks });
  const human = composeRequestBoundHumanQuoteOrder(dependencies, { enabled: true, audience: "operator" });
  const webRequest = { headers: { authorization: (await credentials.current()).authorization } }, command = { selection: h.selection };
  const started = await tasks.start(webRequest, command);
  assert.equal(started.outcome.status, "paused");
  const wait = await tasks.readConfirmation(webRequest, { ...command, stepId: h.state.records.aiStep[0].id });
  let calls = 0;
  const read = createRead({ name: "original_selected_order_fixture", description: "Read only the exact original selected-order result.",
    outputSchema: { type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false },
    read: async value => { calls++; return tasks.readResult(webRequest, value); } });
  const selections = composeRequestBoundQuoteSelections(dependencies, { enabled: true, audience: "operator" });
  const selectionCommand = { draftVersion: h.selection.draftVersion, originalInputRef: h.selection.originalInputRef, selectionId: h.selection.selectionId };
  const selectionRead = createSelectionRead({ name: "original_quote_selection_fixture", description: "Read the existing original human selection.",
    outputSchema: { type: "object", properties: { result: {} }, required: ["result"], additionalProperties: false },
    read: value => selections.read(webRequest, value) });
  const proposalCommand = { ...command, proposal: wait.proposal };
  const proposalRead = createProposalRead({ name: "original_selected_proposal_fixture", description: "Read original selected proposal without deciding.",
    outputSchema: { type: "object", properties: { status: { type: "string" }, facts: { type: "object" } },
      required: ["status", "facts"], additionalProperties: false },
    read: value => human.readSelectedProposal(webRequest, value) });
  const endpoint = fixture(t, undefined, { readTools: { tools: [read, selectionRead, proposalRead], publication: { allows: async () => true },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() }, accounting: { withCall: async (_auth, _name, _input, consume) => consume() },
    release: { project: async (_auth, name, value) => name === proposalRead.name
      ? { status: value.proposal.status, facts: value.deterministic } : { result: value } } } });
  const transaction = dependencies.db.$transaction;
  let hideConsumption = false, loseSession = false;
  dependencies.db.$transaction = (work, ...options) => transaction(async tx => {
    if (hideConsumption) tx.aiApprovalConsumption.findFirst = async () => null;
    if (loseSession) {
      const find = tx.aiStep.findMany;
      tx.aiStep.findMany = async args => { const value = await find(args); h.state.session = false; return value; };
    }
    return work(tx);
  }, ...options);
  try {
    for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
      const client = new Client({ name: "original-selected-order-test", version: "1" }, { capabilities: {}, versionNegotiation });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
          authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
        const before = clone(h.state.records);
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.structuredContent.result.status, h.state.commits ? "committed" : "not_observed");
        assert.deepEqual(h.state.records, before, "original result reads never claim a lease, resume or write a receipt");
        const selectionResult = (await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).structuredContent.result;
        assert.equal(selectionResult.selectionId, selectionCommand.selectionId);
        assert.equal(selectionResult.originalInputRef, selectionCommand.originalInputRef);
        assert.equal(selectionResult.inputHash, h.selection.inputHash); assert.equal(selectionResult.quoteId, h.body.quoteId);
        assert.equal(selectionResult.approval, "not_granted"); assert.equal(selectionResult.order, "not_created_by_selection");
        assert.deepEqual(h.state.records, before, "selection receipt reads cannot save a new choice or change approval");
        const reviewed = await client.callTool({ name: proposalRead.name, arguments: proposalCommand });
        assert.equal(reviewed.structuredContent.status, h.state.commits ? "confirmed" : "pending_confirmation");
        assert.equal(reviewed.structuredContent.facts.quoteAmounts.payableAmount, h.state.records.quote[0].payableAmount);
        assert.equal(reviewed.structuredContent.facts.currency, h.state.records.quote[0].currency);
        assert.doesNotMatch(JSON.stringify(reviewed), /customerName|contactPhone|workspace-a|ownerId/);
        assert.deepEqual(h.state.records, before, "review reads cannot decide a proposal or execute Core");
        for (const proposal of [{ ...wait.proposal, proposalRevision: wait.proposal.proposalRevision + 1 },
          { ...wait.proposal, reviewedPayloadHash: "f".repeat(64) }]) {
          assert.equal((await client.callTool({ name: proposalRead.name, arguments: { ...command, proposal } })).isError, true);
        }
        if (!h.state.commits) {
          await human.decideSelectedProposal(webRequest, { ...command, proposal: { ...wait.proposal, decision: "approve" } });
          h.state.ackLost = true;
          const executed = await tasks.continueConfirmation(webRequest, { ...command, checkpointRef: wait.checkpointRef });
          assert.equal(executed.outcome.status, "unknown"); assert.equal(h.state.commits, 1);
          h.state.ackLost = false;
        }
        const committedState = clone(h.state.records);
        const committed = (await client.callTool({ name: read.name, arguments: command })).structuredContent.result;
        assert.equal(committed.status, "committed"); assert.equal(committed.order.id, h.state.records.rentalOrder[0].id);
        assert.equal(committed.order.quoteId, h.body.quoteId); assert.equal(committed.source.resourceId, committed.order.id);
        assert.equal(committed.payment, "not_inferred"); assert.equal(committed.fulfillment, "not_inferred");
        hideConsumption = true;
        const unresolved = (await client.callTool({ name: read.name, arguments: command })).structuredContent.result;
        assert.deepEqual(unresolved, selectedOrderResult("unknown")); hideConsumption = false;
        for (const change of [value => { value.selection.inputHash = "f".repeat(64); }, value => { value.selection.runId = "00000000-0000-4000-8000-000000000009"; },
          value => { value.selection.selectionId = "00000000-0000-4000-8000-000000000009"; }]) {
          const changed = structuredClone(command); change(changed);
          assert.equal((await client.callTool({ name: read.name, arguments: changed })).isError, true);
        }
        const workspace = h.state.workspace;
        h.state.workspace = "different-workspace";
        try { assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true); }
        finally { h.state.workspace = workspace; }
        h.state.workspace = "different-workspace";
        try {
          assert.equal((await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).isError, true);
          assert.equal((await client.callTool({ name: proposalRead.name, arguments: proposalCommand })).isError, true);
        } finally { h.state.workspace = workspace; }
        const userId = h.state.user.id;
        h.state.user.id = "different-operator";
        try {
          assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
          assert.equal((await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).isError, true);
          assert.equal((await client.callTool({ name: proposalRead.name, arguments: proposalCommand })).isError, true);
        } finally { h.state.user.id = userId; }
        loseSession = true;
        try { assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true); }
        finally { loseSession = false; h.state.session = true; }
        for (const state of ["expired", "superseded"]) {
          const stored = h.state.records.aiTaskQuoteSelection[0], expiry = stored.expiresAt, supersededAt = stored.supersededAt;
          if (state === "expired") stored.expiresAt = new Date(0); else stored.supersededAt = new Date();
          try {
            const observed = (await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).structuredContent.result;
            assert.equal(observed.state, state); assert.equal(observed.approval, "not_granted");
          } finally { Object.assign(h.state.records.aiTaskQuoteSelection[0], { expiresAt: expiry, supersededAt }); }
        }
        const selectionLookup = dependencies.db.aiTaskQuoteSelection.findFirst;
        dependencies.db.aiTaskQuoteSelection.findFirst = async args => {
          const row = await selectionLookup(args); h.state.session = false; return row;
        };
        try { assert.equal((await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).isError, true); }
        finally { dependencies.db.aiTaskQuoteSelection.findFirst = selectionLookup; h.state.session = true; }
        const proposalLookup = dependencies.db.aiProposalVersion.findFirst;
        dependencies.db.aiProposalVersion.findFirst = async args => {
          const row = await proposalLookup(args); h.state.session = false; return row;
        };
        try { assert.equal((await client.callTool({ name: proposalRead.name, arguments: proposalCommand })).isError, true); }
        finally { dependencies.db.aiProposalVersion.findFirst = proposalLookup; h.state.session = true; }
        const storedHash = h.state.records.aiTaskQuoteSelection[0].inputHash;
        h.state.records.aiTaskQuoteSelection[0].inputHash = "f".repeat(64);
        try { assert.equal((await client.callTool({ name: selectionRead.name, arguments: selectionCommand })).isError, true); }
        finally { h.state.records.aiTaskQuoteSelection[0].inputHash = storedHash; }
        for (const changed of [{ ...selectionCommand, selectionId: "00000000-0000-4000-8000-000000000009" },
          { ...selectionCommand, originalInputRef: "00000000-0000-4000-8000-000000000009" }]) {
          assert.equal((await client.callTool({ name: selectionRead.name, arguments: changed })).isError, true);
        }
        assert.deepEqual(h.state.records, committedState, "mismatched inputs and read-after authorization loss cannot recover or rewrite the original order");
        assert.equal(h.state.commits, 1);
      } finally { await client.close(); }
    }
    assert.ok(calls > 0);
  } finally { dependencies.db.$transaction = transaction; hideConsumption = false; loseSession = false; h.state.session = true; }
}

async function verifyOriginalConversationComposition(t, createRead, createRecoveryRead, createOperationRead, createListRead, createOrderRead, createSelectionRead, createProposalRead, stagedShared) {
  // Only the existing fixture's shared resolver is replaced; production APIs
  // still import the public package, backed here by this run's private artifact.
  const resolver = path.join(path.dirname(stagedShared), "fixture-shared.cjs");
  fs.writeFileSync(resolver, 'module.exports = require("@rental-os/shared");\n');
  const sharedFile = path.join(stagedShared, "dist/index.js");
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === "@rental-os/shared") return { url: pathToFileURL(sharedFile).href, shortCircuit: true };
    if (context.parentURL?.includes("/tests/fixtures/ai-native/") && specifier === "./local-shared.cjs") {
      return { url: pathToFileURL(resolver).href, shortCircuit: true };
    }
    return next(specifier, context);
  } });
  const extensions = new Map(Object.getOwnPropertyNames(require.extensions).map(name => [name, Object.getOwnPropertyDescriptor(require.extensions, name)]));
  const runtime = require("ts-node").register({ transpileOnly: true, compiler: path.join(root, "clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js"),
    compilerOptions: { module: "Node16", moduleResolution: "Node16", target: "ES2022", experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true } });
  const restore = () => {
    runtime.enabled(false); hooks.deregister();
    for (const name of Object.getOwnPropertyNames(require.extensions)) if (!extensions.has(name)) delete require.extensions[name];
    for (const [name, descriptor] of extensions) Object.defineProperty(require.extensions, name, descriptor);
  };
  t.after(restore);
  try {
    const { setup } = require("./fixtures/ai-native/lane-a-original-request.cjs");
    const { composeAiConversationRequests } = require("../apps/api/src/modules/ai-native/conversation.application.ts");
    const { composeRequestBoundOriginalTaskRecoveryReaders, composeRequestBoundOriginalScenes } = require("../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application.ts");
    const { requestFingerprint } = require("../apps/api/src/modules/rental-core/rental-idempotency.repository.ts");
    const shared = require(sharedFile);
    const h = await setup({ aiConversation: [], aiConversationTurn: [], aiConversationOperation: [], aiTaskResultArtifact: [] });
    const { credentials, ...dependencies } = h.dependencies;
    const webRequest = { headers: { authorization: (await credentials.current()).authorization } };
    let bodyReads = 0, duringRead;
    const recovery = composeRequestBoundOriginalTaskRecoveryReaders(dependencies, { enabled: true, audience: "operator" },
      { policy: { sceneCode: "order_explanation", routeScene: "chat", maxOutputTokens: 64 } });
    const observations = { readModelResult: async (request, command) => {
      bodyReads++;
      const result = await recovery.readModelResult(request, command);
      await duringRead?.();
      return result;
    } };
    const app = composeAiConversationRequests(dependencies, true, observations);
    const draftVersion = shared.AI_CONVERSATION_DRAFT_VERSION;
    const created = await app.consume(webRequest, "create", { draftVersion, operationKey: "mcp-consumer-create", capabilityCode: "order_explanation" });
    const reference = { draftVersion, conversationId: created.conversationId };
    const admitted = await app.consume(webRequest, "admit", { ...reference, expectedRevision: 1, admissionKey: "mcp-consumer-turn",
      request: { sceneCode: "order_explanation", input: { orderId: "order-a", question: "status" } } });
    const task = await h.app.requests.createTask(admitted.result.original);
    const taskRow = h.state.aiTask.find(row => row.id === task.taskId);
    h.state.aiTaskActionPolicy.push({ scopeId: taskRow.scopeId, taskId: task.taskId, operation: "read_step_terminal", revision: 1,
      requiredPermissions: ["rental-os:order:view"], expiresAt: new Date("2027-01-01T00:00:00Z") });
    const payload = { incomplete: true }, stepFingerprint = "c".repeat(64);
    h.state.aiTaskActionPolicy.push({ scopeId: taskRow.scopeId, taskId: task.taskId, operation: "read_metadata", revision: 1,
      requiredPermissions: ["rental-os:order:view"], expiresAt: new Date("2027-01-01T00:00:00Z") });
    h.state.aiStep.push({ id: "original-model-step", scopeId: taskRow.scopeId, taskId: task.taskId, runId: task.runId,
      actionId: "original-model-action", requestFingerprint: stepFingerprint, resultRef: "original-result-candidate", revision: 1, status: "UNKNOWN", effect: "POSSIBLE" });
    h.state.aiTaskResultArtifact.push({ id: "original-result-candidate", scopeId: taskRow.scopeId, taskId: task.taskId,
      runId: task.runId, stepId: "original-model-step", actionId: "original-model-action", stepFingerprint, outcome: "UNKNOWN",
      errorCode: null, payload, contentHash: requestFingerprint(payload), outputBytes: BigInt(Buffer.byteLength(JSON.stringify(payload))),
      activeMs: 0n, completeMeasurement: false, createdAt: h.dependencies.clock() });
    const command = { ...reference, admissionKey: admitted.admissionKey, resultId: "original-result-candidate" };
    const originals = source("apps/api/src/contracts/ai-native-schemas.ts").AI_NATIVE_COMPONENT_SCHEMAS;
    const read = createRead({ name: "original_conversation_fixture", description: "Read the existing original conversation result.",
      originalSchemas: { AiOrderExplainRequestDraft: originals.AiOrderExplainRequestDraft, AiOrderExplainInput: originals.AiOrderExplainInput },
      outputSchema: { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false },
      // The Web identity is test-only. Production needs a fixed MCP-to-original
      // identity adapter; this test must not imply MCP bearer passthrough.
      read: (value, signal) => app.consume(webRequest, "modelResult", value, signal) });
    const originalScenes = composeRequestBoundOriginalScenes(dependencies, { enabled: true, audience: "operator" });
    const recoveryRead = createRecoveryRead({ name: "original_task_recovery_fixture", description: "Read original task and step observations without recovery execution.",
      outputSchema: { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false },
      read: (value, signal) => originalScenes.readRecovery(webRequest, value, signal) });
    const operationRead = createOperationRead({ name: "original_operation_fixture", description: "Read the exact original conversation operation receipt.",
      outputSchema: { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false },
      read: (value, signal) => app.consume(webRequest, "operation", value, signal) });
    const listRead = createListRead({ name: "original_conversation_list_fixture", description: "Read one authorized original conversation metadata page.",
      outputSchema: { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false },
      read: (value, signal) => app.consume(webRequest, "list", value, signal) });
    const endpoint = fixture(t, async () => verified(), { readTools: { tools: [read, recoveryRead, operationRead, listRead],
      publication: { allows: async () => true }, authority: { withRead: async (_auth, _name, _value, consume) => consume() },
      accounting: { withCall: async (_auth, _name, _value, consume) => consume() },
      release: { project: async (_auth, _name, value) => ({ observation: value }) } } });
    const { clone } = require("./fixtures/ai-native/task-input-store.cjs");
    const before = clone(h.state);
    const recoveryCommand = admitted.result.original;
    const operationCommand = { draftVersion, operationKey: "mcp-consumer-create" };
    for (const versionNegotiation of [{ mode: { pin: "2026-07-28" } }, { mode: "legacy" }]) {
      const client = new Client({ name: "original-composition-consumer", version: "1" }, { capabilities: {}, versionNegotiation });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: inProcess(endpoint),
          authProvider: { token: async () => "synthetic-only" }, onInsufficientScope: "throw" }));
        const page = await client.callTool({ name: listRead.name, arguments: { draftVersion, status: "active", limit: 1 } });
        assert.equal(page.structuredContent.observation.coverage, "page_not_total");
        assert.equal(page.structuredContent.observation.items[0].conversationId, created.conversationId);
        assert.equal(page.structuredContent.observation.nextBeforeId, null);
        assert.deepEqual(h.state, before, "original metadata list never mutates conversation or task state");
        const receipt = await client.callTool({ name: operationRead.name, arguments: operationCommand });
        assert.equal(receipt.structuredContent.observation.operationKey, operationCommand.operationKey);
        assert.equal(receipt.structuredContent.observation.conversationId, created.conversationId);
        assert.equal(receipt.structuredContent.observation.operation, "create");
        assert.equal(receipt.structuredContent.observation.taskCancellation, "not_requested");
        const missing = await client.callTool({ name: operationRead.name, arguments: { ...operationCommand, operationKey: "not-observed-key" } });
        assert.equal(missing.structuredContent.observation.status, "not_observed");
        assert.equal(missing.structuredContent.observation.absence, "not_proof_of_no_commit");
        assert.equal(missing.structuredContent.observation.retryable, false);
        assert.deepEqual(h.state, before, "receipt observation does not recreate a missing operation");
        const result = await client.callTool({ name: read.name, arguments: command });
        assert.equal(result.structuredContent.observation.result.status, "unknown");
        assert.equal(result.structuredContent.observation.result.text, null);
        assert.equal(result.structuredContent.observation.turn.original.inputRef, admitted.result.original.inputRef);
        assert.deepEqual(h.state, before, "original conversation result reads make no persistent mutation, task or model run");
        const recovered = await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand });
        assert.equal(recovered.structuredContent.observation.task.taskId, task.taskId);
        assert.equal(recovered.structuredContent.observation.task.execution, "not_inferred_from_metadata");
        assert.equal(recovered.structuredContent.observation.steps[0].status, "unknown");
        assert.equal(recovered.structuredContent.observation.steps[0].effect, "possible");
        assert.equal(recovered.structuredContent.observation.steps[0].nextAction, "reconcile_original_action");
        assert.equal(recovered.structuredContent.observation.automaticExecution, false);
        assert.deepEqual(h.state, before);
        const originalTaskHash = h.state.aiTask[0].inputHash;
        h.state.aiTask[0].inputHash = "d".repeat(64);
        assert.equal((await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand })).isError, true);
        h.state.aiTask[0].inputHash = originalTaskHash;
        const savedTask = h.state.aiTask.splice(0, 1)[0];
        const absent = await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand });
        assert.deepEqual(absent.structuredContent.observation.task, { state: "not_observed", retryable: false });
        h.state.aiTask.push(savedTask);
        assert.deepEqual(h.state, before);
        const beforeRead = h.control.beforeRead;
        h.control.beforeRead = async (name, args) => {
          await beforeRead?.(name, args);
          if (name === "aiStep") h.b.h.identity.session = false;
        };
        try {
          assert.equal((await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand })).isError, true,
            "the original recovery reader rechecks identity after reading steps");
        } finally { h.b.h.identity.session = true; h.control.beforeRead = beforeRead; }
        const beforeListRead = h.control.beforeRead;
        h.control.beforeRead = async (name, args) => {
          await beforeListRead?.(name, args);
          if (name === "aiConversation") h.b.h.identity.session = false;
        };
        try {
          assert.equal((await client.callTool({ name: listRead.name, arguments: { draftVersion, status: "active", limit: 1 } })).isError, true,
            "the original list reader checks current identity after page lookup");
        } finally { h.b.h.identity.session = true; h.control.beforeRead = beforeListRead; }
        const originalPayload = h.state.aiTaskResultArtifact[0].payload;
        h.state.aiTaskResultArtifact[0].payload = { incomplete: false };
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true, "the original artifact hash is revalidated, not accepted by schema alone");
        h.state.aiTaskResultArtifact[0].payload = originalPayload;
        const originalRunId = h.state.aiTaskResultArtifact[0].runId;
        h.state.aiTaskResultArtifact[0].runId = "unbound-run";
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true, "an artifact cannot select another run");
        h.state.aiTaskResultArtifact[0].runId = originalRunId;
        const beforeReceiptRead = h.control.beforeRead;
        h.control.beforeRead = async (name, args) => {
          await beforeReceiptRead?.(name, args);
          if (name === "aiConversationOperation") h.b.h.identity.session = false;
        };
        try {
          assert.equal((await client.callTool({ name: operationRead.name, arguments: operationCommand })).isError, true,
            "the original operation reader rechecks identity after receipt lookup");
        } finally { h.b.h.identity.session = true; h.control.beforeRead = beforeReceiptRead; }
        const callsAfterInvalid = bodyReads;
        const actor = h.b.h.identity.user.id;
        h.b.h.identity.user.id = "other-operator";
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
        assert.equal((await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand })).isError, true);
        assert.equal((await client.callTool({ name: operationRead.name, arguments: operationCommand })).isError, true);
        h.b.h.identity.user.id = actor;
        assert.equal(bodyReads, callsAfterInvalid, "the original owner authority rejects before body lookup");
        const workspace = h.b.h.identity.workspace;
        h.b.h.identity.workspace = "other-workspace";
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
        assert.equal((await client.callTool({ name: recoveryRead.name, arguments: recoveryCommand })).isError, true);
        assert.equal((await client.callTool({ name: operationRead.name, arguments: operationCommand })).isError, true);
        h.b.h.identity.workspace = workspace;
        assert.equal(bodyReads, callsAfterInvalid);
        duringRead = async () => { h.b.h.identity.session = false; };
        assert.equal((await client.callTool({ name: read.name, arguments: command })).isError, true);
        h.b.h.identity.session = true; duringRead = undefined;
        assert.deepEqual(h.state, before, "read-after-body identity loss cannot write or recover an operation");
      } finally { await client.close(); }
    }
    assert.equal(h.state.aiStep.length, 1, "only the explicitly seeded existing artifact step remains");
    assert.equal(h.state.aiRun.length, 1, "only the explicit fixture setup task has a metadata run");
    await verifyOriginalSelectedOrderComposition(t, createOrderRead, createSelectionRead, createProposalRead);
  } finally { restore(); }
}

test("compiled MCP package exports load and serve both eras without source transpilation", async t => {
  const packageRoot = path.join(root, "packages/mcp-server");
  const output = fs.mkdtempSync(path.join(root, "output/mcp-package-consumer-"));
  const stagedShared = compileSharedExport(output);
  const staged = path.join(output, "node_modules/@rental-os/mcp-server");
  fs.mkdirSync(staged, { recursive: true });
  fs.copyFileSync(path.join(packageRoot, "package.json"), path.join(staged, "package.json"));
  const parsed = ts.readConfigFile(path.join(packageRoot, "tsconfig.json"), ts.sys.readFile);
  assert.equal(parsed.error, undefined);
  const configured = ts.parseJsonConfigFileContent(parsed.config, ts.sys, packageRoot);
  const serverTypes = path.join(path.dirname(installed.resolve("@modelcontextprotocol/server")), "index.d.mts");
  const typeRoots = [path.join(root, "clients/agent-desktop/harness/node_modules/@types")];
  const program = ts.createProgram(configured.fileNames, {
    ...configured.options, outDir: path.join(staged, "dist"), typeRoots,
    paths: { "@modelcontextprotocol/server": [serverTypes], "@rental-os/shared": [path.join(stagedShared, "dist/index.d.ts")] },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  const emitted = program.emit();
  assert.equal(emitted.emitSkipped, false);
  assert.equal(emitted.diagnostics.length, 0);
  const consumer = path.join(output, "consumer.mts");
  fs.writeFileSync(consumer, [
    'import { createProtectedMcpEndpoint, ResourceAuthorizationError } from "@rental-os/mcp-server";',
    'import * as businessMapping from "@rental-os/mcp-server/capability-mapping";',
    'export { businessMapping };',
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
    'import type { McpBusinessReadCode } from "@rental-os/mcp-server/capability-mapping";',
    'const readCode: McpBusinessReadCode = "rental.catalog.search";',
    'void readCode;',
    'import { createConversationResultRead } from "@rental-os/mcp-server/conversation-result-read";',
    'import type { ConversationResultReadBinding } from "@rental-os/mcp-server/conversation-result-read";',
    'export const resultRead = (binding: ConversationResultReadBinding) => createConversationResultRead(binding);',
    'import { createOriginalTaskRecoveryRead } from "@rental-os/mcp-server/original-task-recovery-read";',
    'import type { OriginalTaskRecoveryReadBinding } from "@rental-os/mcp-server/original-task-recovery-read";',
    'export const recoveryRead = (binding: OriginalTaskRecoveryReadBinding) => createOriginalTaskRecoveryRead(binding);',
    'import { createSelectedOrderResultRead } from "@rental-os/mcp-server/selected-order-result-read";',
    'import type { SelectedOrderResultReadBinding } from "@rental-os/mcp-server/selected-order-result-read";',
    'export const selectedOrderRead = (binding: SelectedOrderResultReadBinding) => createSelectedOrderResultRead(binding);',
    'import { createQuoteSelectionRead } from "@rental-os/mcp-server/quote-selection-read";',
    'import type { QuoteSelectionReadBinding } from "@rental-os/mcp-server/quote-selection-read";',
    'export const selectionRead = (binding: QuoteSelectionReadBinding) => createQuoteSelectionRead(binding);',
    'import { createSelectedProposalRead } from "@rental-os/mcp-server/selected-proposal-read";',
    'import type { SelectedProposalReadBinding } from "@rental-os/mcp-server/selected-proposal-read";',
    'export const proposalRead = (binding: SelectedProposalReadBinding) => createSelectedProposalRead(binding);',
    'import { createConversationOperationRead } from "@rental-os/mcp-server/conversation-operation-read";',
    'import type { ConversationOperationReadBinding } from "@rental-os/mcp-server/conversation-operation-read";',
    'export const operationRead = (binding: ConversationOperationReadBinding) => createConversationOperationRead(binding);',
    'import { createConversationListRead } from "@rental-os/mcp-server/conversation-list-read";',
    'import type { ConversationListReadBinding } from "@rental-os/mcp-server/conversation-list-read";',
    'export const listRead = (binding: ConversationListReadBinding) => createConversationListRead(binding);',
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
    paths: { "@modelcontextprotocol/server": [serverTypes], "@rental-os/shared": [path.join(stagedShared, "dist/index.d.ts")] },
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
    if (context.parentURL?.startsWith(pathToFileURL(stagedShared + path.sep).href) && specifier === "zod") {
      return { url: pathToFileURL(require.resolve("zod")).href, shortCircuit: true };
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
  await verifyBusinessCapabilityMapping(t, compiled.businessMapping);
  await verifyPublicClientAuthorization(t, compiled.createPublicClientAuthorization);
  await verifyAuthorizationEndpoint(t, compiled.createPublicClientAuthorizationEndpoint);
  await verifyPersistentOAuthTokens(t, compiled.persistentTokens, compiled.oauthTokens, compiled.persistentAuthorization, compiled.createRentalMcpService);
  await verifyAuthorizationCodeBinding(t, compiled.assertAuthorizationCodeBinding, compiled.oauthTokens.OAuthTokenRequestError);
  await verifyOAuthTokenEndpoint(t, compiled.oauthTokens, compiled.assertAuthorizationCodeBinding);
  await verifyAuthorizationMetadata(t, compiled.createAuthorizationServerMetadata);
  await verifyConversationRead(t, compiled.resultRead);
  await verifyTaskRecoveryRead(t, compiled.recoveryRead);
  await verifySelectedOrderResultRead(t, compiled.selectedOrderRead);
  await verifyQuoteSelectionRead(t, compiled.selectionRead);
  await verifySelectedProposalRead(t, compiled.proposalRead);
  await verifyOperationRead(t, compiled.operationRead);
  await verifyConversationList(t, compiled.listRead);
  await verifyOriginalConversationComposition(t, compiled.resultRead, compiled.recoveryRead, compiled.operationRead, compiled.listRead, compiled.selectedOrderRead, compiled.selectionRead, compiled.proposalRead, stagedShared);
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
