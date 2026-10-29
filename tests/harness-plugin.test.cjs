"use strict";
/** Bundle/profile/Loader and CommandRuntime integration; transport alone is an offline substitute. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire, registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const harness = path.join(root, "clients/agent-desktop/harness");
const cli = createRequire(path.join(harness, "apps/cli/package.json"));
const mcp = createRequire(path.join(harness, "packages/mcp/mcp-client/package.json"));
const ts = require(path.join(harness, "node_modules/typescript/lib/typescript.js"));
const pluginRoot = path.join(root, "clients/harness-plugin");
const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
const commandPackage = createRequire(path.join(harness, "packages/interaction/commands/package.json"));
const loopPackage = createRequire(path.join(harness, "packages/core/agent-loop/package.json"));
const publicResolve = name => (name.startsWith("@modelcontextprotocol/") ? mcp
  : name === "@deepseek-ai/dsh-commands" ? commandPackage
    : ["@deepseek-ai/dsh-mcp-client", "@deepseek-ai/dsh-scope", "@deepseek-ai/dsh-tools"].includes(name) ? mcp : cli).resolve(name);

function compilePlugin(destination) {
  const dependencyTypes = {
    "@modelcontextprotocol/client": path.join(path.dirname(mcp.resolve("@modelcontextprotocol/client")), "index.d.mts"),
    "@deepseek-ai/cordis": path.join(harness, "vendor/cordis/lib/types/index.d.ts"),
    "@deepseek-ai/schemastery": path.join(harness, "vendor/schemastery/lib/types/index.d.ts"),
    "@deepseek-ai/dsh-commands": path.join(harness, "packages/interaction/commands/lib/types/index.d.ts"),
    "@deepseek-ai/dsh-host-webserver": path.join(harness, "packages/host/webserver/lib/types/index.d.ts"),
    "@deepseek-ai/dsh-system-prompt": path.join(harness, "packages/core/system-prompt/lib/types/index.d.ts"),
    "@deepseek-ai/dsh-agent": path.join(harness, "packages/core/agent/lib/types/index.d.ts"),
    "@deepseek-ai/dsh-llm": path.join(harness, "packages/llm/llm/lib/types/index.d.ts"),
    "@deepseek-ai/dsh-scope": path.join(harness, "packages/core/scope/lib/types/index.d.ts"),
    "@deepseek-ai/dsh-tools": path.join(harness, "packages/core/tools/lib/types/index.d.ts"),
    "@deepseek-ai/dsh-mcp-client": path.join(harness, "packages/mcp/mcp-client/lib/types/index.d.ts"),
    "open": path.join(harness, "node_modules/.pnpm/open@11.0.4/node_modules/open/index.d.ts"),
  };
  const parsed = ts.readConfigFile(path.join(pluginRoot, "tsconfig.json"), ts.sys.readFile);
  assert.equal(parsed.error, undefined);
  const config = ts.parseJsonConfigFileContent(parsed.config, ts.sys, pluginRoot);
  const program = ts.createProgram(config.fileNames, {
    ...config.options, outDir: path.join(destination, "dist"),
    typeRoots: [path.join(harness, "node_modules/@types")],
    paths: Object.fromEntries(Object.entries(dependencyTypes).map(([key, value]) => [key, [value]])),
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: x => x, getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
  const emitted = program.emit();
  assert.equal(emitted.emitSkipped, false);
  assert.equal(emitted.diagnostics.length, 0);
}

function syntheticEndpoint(verifyAccessToken = async () => { throw new Error("The pre-login path must not verify a token"); }, overrides = {}) {
  const source = fs.readFileSync(path.join(root, "packages/mcp-server/src/index.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const load = specifier => {
    if (!specifier.startsWith("./")) return mcp(specifier);
    const file = path.join(root, "packages/mcp-server/src", specifier.replace(/\.js$/, ".ts"));
    const nested = { exports: {} };
    new Function("require", "module", "exports", ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText)(load, nested, nested.exports);
    return nested.exports;
  };
  new Function("require", "module", "exports", compiled)(load, module, module.exports);
  return module.exports.createProtectedMcpEndpoint({
    enabled: true, resourceUrl: "https://mcp.example.invalid/mcp", authorizationServerUrl: "https://auth.example.invalid/",
    allowedOrigins: [], maxRequestBytes: 4096, authorizationTimeoutMs: 1000, ...overrides,
  }, { verifyAccessToken });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

// One owner contains global resolver/fetch changes; no unrelated tests run inside it.
test("Rental bundle loads through real profile and Loader without granting business access", async t => {
  const output = fs.mkdtempSync(path.join(root, "output/harness-plugin-loader-"));
  const profile = path.join(output, "profile");
  const staged = path.join(profile, "node_modules/@rental-os/harness-plugin");
  writeJson(path.join(staged, "package.json"), manifest);
  fs.copyFileSync(path.join(pluginRoot, "cordis.patch.yml"), path.join(staged, "cordis.patch.yml"));
  fs.copyFileSync(path.join(pluginRoot, "README.md"), path.join(staged, "README.md"));
  compilePlugin(staged);
  const consumerFile = path.join(profile, "consumer.mts");
  fs.writeFileSync(consumerFile, [
    'import { name, inject, Config, apply } from "@rental-os/harness-plugin";',
    'import type { Context } from "@deepseek-ai/cordis";',
    'const configuration: Config = Config({ language: "en" });',
    'declare const ctx: Context;',
    'const hostEntry: (ctx: Context, config: Config) => void = apply;',
    'hostEntry(ctx, configuration);',
    'const pluginName: string = name;',
    'const dependencies: readonly string[] = inject;',
    'void pluginName; void dependencies;',
    '',
  ].join("\n"));
  const consumerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, types: ["node"],
    typeRoots: [path.join(harness, "node_modules/@types")],
    paths: {
      "@deepseek-ai/cordis": [path.join(harness, "vendor/cordis/lib/types/index.d.ts")],
      "@deepseek-ai/schemastery": [path.join(harness, "vendor/schemastery/lib/types/index.d.ts")],
    },
  };
  const consumerDiagnostics = ts.getPreEmitDiagnostics(ts.createProgram([consumerFile], consumerOptions));
  assert.equal(consumerDiagnostics.length, 0, consumerDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  const stagedUrl = pathToFileURL(staged + path.sep).href;
  // External OS-browser boundary only; the authorization logic and MCP SDK stay real.
  const browserFixture = path.join(output, "browser-fixture.mjs");
  fs.writeFileSync(browserFixture, 'export let opened; export function setOpen(value) { opened = value; } export default function open(url) { return opened(url); }\n');
  const browserModule = await import(pathToFileURL(browserFixture).href);
  browserModule.setOpen(() => { throw new Error("unexpected browser launch"); });
  const httpFixture = path.join(output, "http-fixture.mjs");
  fs.writeFileSync(httpFixture, `import { EventEmitter } from 'node:events';
export const listeners = [];
export function createServer(options) {
  const server = new EventEmitter(); listeners.push(server); server.options = options;
  server.listen = (settings, ready) => {
    server.settings = settings;
    settings.signal.addEventListener('abort', () => server.emit('close'), { once: true });
    queueMicrotask(() => { if (settings.signal.aborted) server.emit('close'); else ready(); });
  };
  server.address = () => ({ port: 49153, address: '127.0.0.1', family: 'IPv4' });
  server.close = done => { server.closed = true; queueMicrotask(() => { server.emit('close'); done(); }); };
  server.closeAllConnections = () => { server.connectionsClosed = true; };
  return server;
}\n`);
  const httpModule = await import(pathToFileURL(httpFixture).href);
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL === stagedUrl + "dist/oauth-host.js" && specifier === "node:http") {
        return { url: pathToFileURL(httpFixture).href, shortCircuit: true };
      }
      if (context.parentURL?.startsWith(stagedUrl) && specifier === "open") {
        return { url: pathToFileURL(browserFixture).href, shortCircuit: true };
      }
      if (context.parentURL?.startsWith(stagedUrl) && (specifier.startsWith("@deepseek-ai/") || specifier.startsWith("@modelcontextprotocol/"))) {
        return { url: pathToFileURL(publicResolve(specifier)).href, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  const running = new Set();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  t.after(async () => {
    try { for (const ctx of running) await ctx.fiber.dispose(); }
    finally {
      Object.defineProperty(globalThis, "fetch", descriptor);
      hooks.deregister();
    }
  });
  const boot = await import(pathToFileURL(cli.resolve("@deepseek-ai/dsh-app-boot")).href);
  const { SessionId } = await import(pathToFileURL(cli.resolve("@deepseek-ai/dsh-session")).href);
  assert.equal(boot.evaluatePluginCompatibility(manifest, {}, "0.2.1-rc.2"), undefined);
  assert.ok(boot.evaluatePluginCompatibility(manifest, {}, "0.2.0"));
  assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");

  writeJson(path.join(profile, "package.json"), { name: "rental-loader-fixture", private: true, dsh: { profile: { bundles: [manifest.name] } } });
  const configFile = path.join(profile, "cordis.yml");
  writeJson(configFile, [
    { id: "session", name: pathToFileURL(cli.resolve("@deepseek-ai/dsh-session")).href },
    { id: "commands", name: pathToFileURL(publicResolve("@deepseek-ai/dsh-commands")).href },
  ]);
  const layer = boot.loadProfileDirectory("offline-rental", profile, path.join(harness, "apps/cli/package.json"));
  assert.deepEqual(layer.skippedBundles, []);
  assert.deepEqual(layer.layers.map(x => x.packageName), [manifest.name]);
  const patches = layer.layers.flatMap(x => x.patches);

  async function open(overrides = []) {
    const ctx = await boot.boot("offline-rental", configFile, structuredClone([...patches, ...overrides]));
    running.add(ctx);
    assert.ok(ctx.get("sessions"), "real SessionStore activated");
    assert.ok(ctx.get("commands"), "real CommandRuntime activated");
    return ctx;
  }
  let calls = 0;
  // Replacing only the HTTP boundary leaves the offline preload's socket/DNS
  // blocks active, and the exact original fetch property is restored at teardown.
  globalThis.fetch = async () => { calls++; throw new Error("unexpected automatic HTTP"); };

  const ctx = await open();
  const agent = { id: SessionId("offline-rental-session"), session: ctx.sessions.create(SessionId("offline-rental-session")) };
  const invoke = (line, signal = new AbortController().signal) => ctx.commands.execute(agent, line, [], signal);
  assert.deepEqual(ctx.commands.list(agent).map(x => x.name), ["rental"]);
  assert.match((await invoke("/rental status")).result.text, /尚未配置/);
  assert.match((await invoke("/rental check")).result.text, /尚未配置/);
  assert.match((await invoke("/rental oauth-check")).result.text, /尚未配置/);
  await invoke("/rental secret-synthetic-token");
  assert.equal(calls, 0);
  assert.doesNotMatch(JSON.stringify(agent.session.snapshotEvents()), /secret-synthetic-token/);
  assert.ok(agent.session.snapshotEvents().every(event => event.type === "command/run" || event.type === "command/done"));
  await ctx.fiber.dispose();
  running.delete(ctx);

  const configured = [{ id: "rental-os", config: {
    language: "zh-CN", connection: { resourceUrl: "https://mcp.example.invalid/mcp", authorizationServerUrl: "https://auth.example.invalid/" },
  } }];
  const active = await open(configured);
  const other = { id: SessionId("configured-rental"), session: active.sessions.create(SessionId("configured-rental")) };
  assert.equal(calls, 0);
  assert.match((await active.commands.execute(other, "/rental oauth-check", [], new AbortController().signal)).result.text, /尚未配置 OAuth/);
  assert.equal(calls, 0);
  const endpoint = syntheticEndpoint();
  t.after(() => endpoint.close());
  globalThis.fetch = async (input, init) => { calls++; return endpoint.fetch(new Request(input, init)); };
  const checked = await active.commands.execute(other, "/rental check", [], new AbortController().signal);
  assert.equal(checked.result.kind, "success");
  assert.match(checked.result.text, /仍需完成授权/);
  assert.equal(calls, 2);
  assert.equal(active.get("tools"), undefined);
  assert.equal(active.get("authorization"), undefined);

  const entry = [...active.loader.entries()].find(entry => entry.options?.id === "rental-os");
  assert.ok(entry, "real Loader owns Rental entry");
  assert.equal("default" in entry.moduleNamespace, false);
  assert.deepEqual(Object.keys(entry.moduleNamespace).sort(), ["Config", "apply", "inject", "name"]);
  assert.equal(active.loader.unwrapExports(entry.moduleNamespace), entry.moduleNamespace);
  const previousHandler = active.commands.find(other, "rental").handler;
  await entry.update({ config: { ...configured[0].config, language: "en" } });
  await active.loader.await();
  await entry.fiber.await();
  // Cordis may restart in the same Fiber; the owned command contribution is replaced.
  assert.notEqual(active.commands.find(other, "rental").handler, previousHandler);
  assert.equal(active.commands.list(other).filter(x => x.name === "rental").length, 1);
  assert.equal(calls, 2, "configuration reload does not fetch automatically");
  assert.match((await active.commands.execute(other, "/rental status", [], new AbortController().signal)).result.text, /settings are present/);

  let release;
  let started;
  let requestSignal;
  const pending = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (_input, init) => { calls++; requestSignal = init.signal; started(); return pending; };
  const checking = active.commands.execute(other, "/rental check", [], new AbortController().signal);
  await waiting;
  const busy = await active.commands.execute(other, "/rental check", [], new AbortController().signal);
  assert.equal(busy.result.kind, "error");
  assert.match(busy.result.text, /already running/);
  assert.equal(calls, 3);
  await entry.fiber.dispose();
  assert.equal(requestSignal.aborted, true);
  assert.equal((await checking).result.kind, "error");
  assert.equal(active.commands.find(other, "rental"), undefined);
  release(new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://mcp.example.invalid/.well-known/oauth-protected-resource/mcp"' } }));
  await pending;
  assert.equal(calls, 3, "late challenge cannot start metadata discovery after unload");
  await active.fiber.dispose();
  running.delete(active);

  // OAuth checking exercises the same real command and Loader, but must never
  // call authorize/token/revoke or put remote metadata into the session log.
  const oauthSettings = {
    clientId: "registered-offline-client", redirectUri: "http://127.0.0.1:49152/rental/callback",
    scopes: ["rental.catalog.read"], authorizationEndpoint: "https://auth.example.invalid/authorize",
    tokenEndpoint: "https://auth.example.invalid/token", revocationEndpoint: "https://auth.example.invalid/revoke",
  };
  const asMetadata = {
    issuer: "https://auth.example.invalid/", authorization_endpoint: oauthSettings.authorizationEndpoint,
    token_endpoint: oauthSettings.tokenEndpoint, revocation_endpoint: oauthSettings.revocationEndpoint,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"], scopes_supported: oauthSettings.scopes,
  };
  const oauth = await open([{ id: "rental-os", config: { ...configured[0].config, oauth: oauthSettings } }]);
  const oauthAgent = { id: SessionId("oauth-inspection"), session: oauth.sessions.create(SessionId("oauth-inspection")) };
  const requests = [];
  let document = asMetadata;
  let oauth404 = false;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url === "https://auth.example.invalid/.well-known/oauth-authorization-server") {
      return oauth404 ? new Response(null, { status: 404 }) : Response.json(document);
    }
    if (request.url === "https://auth.example.invalid/.well-known/openid-configuration") {
      return Response.json({ ...document, jwks_uri: "https://auth.example.invalid/jwks", subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"] });
    }
    assert.ok(request.url.startsWith("https://mcp.example.invalid/"));
    return endpoint.fetch(request);
  };
  const oauthInvoke = () => oauth.commands.execute(oauthAgent, "/rental oauth-check", [], new AbortController().signal);
  assert.equal(requests.length, 0);
  const compatible = await oauthInvoke();
  assert.equal(compatible.result.kind, "success");
  assert.match(compatible.result.text, /客户端登记及回调归属仍未验证/);
  assert.match(compatible.result.text, /本次未开始登录或交换令牌/);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.credentials === "omit" && request.redirect === "error"
    && !request.headers.has("authorization") && !request.headers.has("cookie")));
  oauth404 = true;
  assert.equal((await oauthInvoke()).result.kind, "success", "only 404 permits standard OIDC discovery");
  assert.equal(requests.length, 7);
  oauth404 = false;
  for (const override of [
    { issuer: "https://different.invalid/" },
    { token_endpoint: "https://different.invalid/token" },
    { code_challenge_methods_supported: ["plain"] },
    { grant_types_supported: ["implicit"] },
    { scopes_supported: [] },
    { revocation_endpoint_auth_methods_supported: ["client_secret_basic"] },
    { ignored_blob: "sensitive-remote-marker".repeat(1000) },
  ]) {
    document = { ...asMetadata, ...override };
    assert.equal((await oauthInvoke()).result.kind, "error");
  }
  assert.doesNotMatch(JSON.stringify(oauthAgent.session.snapshotEvents()), /sensitive-remote-marker|registered-offline-client|49152|code_verifier/);
  assert.equal(oauth.get("credentials"), undefined);
  assert.equal(oauth.get("tools"), undefined);
  for (const status of [302, 403, 500]) {
    let asRequests = 0;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith("https://mcp.example.invalid/")) return endpoint.fetch(request);
      asRequests++;
      return new Response("untrusted-error-body", { status, headers: { Location: "https://different.invalid/discovery" } });
    };
    assert.equal((await oauthInvoke()).result.kind, "error");
    assert.equal(asRequests, 1, "failure or redirect must not retry or fall back");
    assert.doesNotMatch(JSON.stringify(oauthAgent.session.snapshotEvents()), /untrusted-error-body|different\.invalid/);
  }
  // Cancel while AS metadata is already streaming; observe real stream cleanup
  // and verify the old result cannot publish a compatible status after unload.
  let bodyStarted;
  let bodyCancelled;
  const readingBody = new Promise(resolve => { bodyStarted = resolve; });
  const cancelledBody = new Promise(resolve => { bodyCancelled = resolve; });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.startsWith("https://mcp.example.invalid/")) return endpoint.fetch(request);
    assert.equal(request.url, "https://auth.example.invalid/.well-known/oauth-authorization-server");
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"issuer":')); bodyStarted(); },
      cancel() { bodyCancelled(); },
    }), { headers: { "Content-Type": "application/json" } });
  };
  const waitingOAuth = oauthInvoke();
  await readingBody;
  await oauth.fiber.dispose();
  await cancelledBody;
  assert.equal((await waitingOAuth).result.kind, "error");
  running.delete(oauth);

  // Shipped Host adapter, real Loader and real OAuth/MCP SDK, with only the
  // browser, callback-listener boundary and remote HTTP replaced. No socket binds.
  const listenerFixture = path.join(output, "listener-fixture.mjs");
  fs.writeFileSync(listenerFixture, `import { Service } from ${JSON.stringify(pathToFileURL(cli.resolve("@deepseek-ai/cordis")).href)};
export const routes = new Map();
export default class extends Service {
  constructor(ctx) { super(ctx, 'webServer'); }
  getOrigin() { return 'http://127.0.0.1:49152'; }
  register(route) { if (routes.has(route.path)) throw new Error('duplicate route'); routes.set(route.path, route); return () => routes.delete(route.path); }
}\n`);
  const listener = await import(pathToFileURL(listenerFixture).href);
  let guidance = { version: "reviewed-v1", text: "Choose the user's format. {{literal}} is data, not a variable." };
  const authenticatedEndpoint = syntheticEndpoint(async token => {
    assert.equal(token, "synthetic-access");
    return { subject: "synthetic-actor", clientId: oauthSettings.clientId, resource: configured[0].config.connection.resourceUrl,
      scopes: oauthSettings.scopes, expiresAt: Date.now() / 1000 + 60 };
  }, { instructions: { read: async () => guidance } });
  t.after(() => authenticatedEndpoint.close());
  const login = await open([
    { insert: [
      { id: "oauth-listener-fixture", name: pathToFileURL(listenerFixture).href },
      { id: "system-prompt", name: pathToFileURL(cli.resolve("@deepseek-ai/dsh-system-prompt")).href },
    ] },
    { id: "rental-os", config: { ...configured[0].config, oauth: oauthSettings,
      login: { enabled: true, attemptTimeoutMs: 2000, sessionLifetimeMs: 120000, maxAccessTtlSeconds: 300, callbackMode: "host" } } },
  ]);
  const loginAgent = { id: SessionId("login-owner"), session: login.sessions.create(SessionId("login-owner")) };
  const wrongAgent = { id: SessionId("not-login-owner"), session: login.sessions.create(SessionId("not-login-owner")) };
  const loginInvoke = action => login.commands.execute(loginAgent, `/rental ${action}`, [], new AbortController().signal);
  const rentalGuidance = async scope => (await login.systemPrompt.assemble({ scope })).sections.filter(section => section.name === "mcp:rental-os" && section.text);
  assert.deepEqual(await rentalGuidance(loginAgent), []);
  let authorizationUrl;
  const wire = [];
  let callbackHandler;
  function deliverCallback(url) {
    const parsed = new URL(url);
    let status;
    let headers;
    const response = { writeHead(code, values) { status = code; headers = values; return this; }, end() {} };
    callbackHandler({ url: parsed.pathname + parsed.search, method: "GET", headers: { host: parsed.host } }, response);
    assert.equal(headers["cache-control"] ?? headers["Cache-Control"], "no-store");
    return status;
  }
  browserModule.setOpen(async target => {
    authorizationUrl = new URL(target);
    assert.equal(authorizationUrl.origin + authorizationUrl.pathname, oauthSettings.authorizationEndpoint);
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorizationUrl.searchParams.get("resource"), configured[0].config.connection.resourceUrl);
    assert.equal(authorizationUrl.searchParams.get("client_id"), oauthSettings.clientId);
    assert.ok(!authorizationUrl.searchParams.has("code_verifier"));
    callbackHandler = listener.routes.get("/rental/callback").handler;
    const callback = new URL(oauthSettings.redirectUri);
    callback.searchParams.set("code", "synthetic-code");
    callback.searchParams.set("state", "wrong");
    assert.equal(deliverCallback(callback), 400);
    callback.searchParams.set("state", authorizationUrl.searchParams.get("state"));
    callback.searchParams.set("iss", "https://different.invalid/");
    assert.equal(deliverCallback(callback), 400);
    callback.searchParams.set("iss", asMetadata.issuer);
    assert.equal(deliverCallback(callback), 204);
    assert.equal(deliverCallback(callback), 410);
  });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    wire.push(request);
    if (request.url === "https://auth.example.invalid/.well-known/oauth-authorization-server") return Response.json(asMetadata);
    if (request.url === oauthSettings.tokenEndpoint) {
      const params = new URLSearchParams(await request.text());
      assert.equal(params.get("grant_type"), "authorization_code");
      assert.equal(params.get("code"), "synthetic-code");
      assert.equal(params.get("resource"), configured[0].config.connection.resourceUrl);
      assert.equal(require("node:crypto").createHash("sha256").update(params.get("code_verifier")).digest("base64url"), authorizationUrl.searchParams.get("code_challenge"));
      return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", token_type: "Bearer", expires_in: 60, scope: oauthSettings.scopes.join(" ") });
    }
    if (request.url === oauthSettings.revocationEndpoint) {
      const params = new URLSearchParams(await request.text());
      assert.equal(params.get("token"), "synthetic-refresh");
      return new Response(null, { status: 200 });
    }
    return authenticatedEndpoint.fetch(request);
  };
  const loggedIn = await loginInvoke("login");
  assert.equal(loggedIn.result.kind, "success", loggedIn.result.text);
  assert.match(loggedIn.result.text, /当前会话完成 MCP 握手/);
  assert.equal(listener.routes.size, 0);
  const sections = await rentalGuidance(loginAgent);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].text, `Rental OS guidance (${guidance.version})\n${guidance.text}`);
  assert.equal(sections[0].interpolate, false);
  assert.deepEqual(await rentalGuidance(wrongAgent), []);
  assert.deepEqual(await rentalGuidance({ session: loginAgent.session }), [], "another agent does not inherit the session's guidance");
  const originalSession = loginAgent.session;
  loginAgent.session = wrongAgent.session;
  assert.deepEqual(await rentalGuidance(loginAgent), [], "a rebound agent does not carry guidance to a different session");
  loginAgent.session = originalSession;
  guidance = { version: "reviewed-v2", text: "Do not invent missing facts." };
  assert.equal((await loginInvoke("check")).result.kind, "success");
  assert.match((await rentalGuidance(loginAgent))[0].text, /reviewed-v2/);
  guidance = undefined;
  assert.equal((await loginInvoke("check")).result.kind, "success");
  assert.deepEqual(await rentalGuidance(loginAgent), [], "withdrawn guidance is not retained");
  guidance = { version: "reviewed-v3", text: "Use original facts." };
  assert.equal((await loginInvoke("check")).result.kind, "success");
  assert.match((await loginInvoke("status")).result.text, /仅在内存/);
  assert.equal((await login.commands.execute(wrongAgent, "/rental disconnect", [], new AbortController().signal)).result.kind, "error");
  assert.equal(wire.filter(request => request.url === oauthSettings.tokenEndpoint).length, 1);
  assert.equal(login.get("credentials"), undefined);
  assert.equal(login.get("tools"), undefined);
  assert.doesNotMatch(JSON.stringify(loginAgent.session.snapshotEvents()), /synthetic-(?:code|access|refresh)|code_verifier|code_challenge|state=/);
  assert.equal((await loginInvoke("disconnect")).result.kind, "success");
  assert.deepEqual(await rentalGuidance(loginAgent), []);
  assert.equal(wire.filter(request => request.url === oauthSettings.revocationEndpoint).length, 1);
  assert.match((await loginInvoke("status")).result.text, /已配置/);
  // Use the original clock only to advance token expiry deterministically; no sleep.
  const realNow = Date.now;
  let clock = realNow();
  t.after(() => { Date.now = realNow; });
  Date.now = () => clock;
  const normalFetch = globalThis.fetch;
  let refreshStarted;
  let releaseRefresh;
  const refreshWaiting = new Promise(resolve => { refreshStarted = resolve; });
  const refreshResponse = new Promise(resolve => { releaseRefresh = resolve; });
  let refreshCalls = 0;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === oauthSettings.tokenEndpoint && new URLSearchParams(await request.clone().text()).get("grant_type") === "refresh_token") {
      refreshCalls++;
      refreshStarted();
      return refreshResponse;
    }
    return normalFetch(input, init);
  };
  assert.equal((await loginInvoke("login")).result.kind, "success");
  clock += 61_000;
  const checkingOne = loginInvoke("check");
  const checkingTwo = loginInvoke("check");
  await Promise.race([refreshWaiting, checkingOne.then(result => assert.fail(`check completed before refresh: ${JSON.stringify(result.result)}`))]);
  assert.equal(refreshCalls, 1, "concurrent callers share one refresh request");
  releaseRefresh(Response.json({ access_token: "synthetic-access", refresh_token: "rotated-refresh", token_type: "Bearer", expires_in: 60, scope: oauthSettings.scopes.join(" ") }));
  assert.equal((await checkingOne).result.kind, "success");
  assert.equal((await checkingTwo).result.kind, "success");
  let deniedRequests = 0;
  globalThis.fetch = async () => { deniedRequests++; return new Response(null, { status: 401, headers: { "WWW-Authenticate": "Bearer" } }); };
  assert.equal((await loginInvoke("check")).result.kind, "error");
  assert.deepEqual(await rentalGuidance(loginAgent), [], "failed discovery withdraws guidance");
  assert.equal(deniedRequests, 1, "401 does not reauthorize or resend");
  assert.equal((await loginInvoke("check")).result.kind, "error");
  assert.equal(deniedRequests, 1, "invalidated token is not sent again");
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), oauthSettings.revocationEndpoint);
    assert.equal(new URLSearchParams(init.body).get("token"), "rotated-refresh");
    return new Response(null, { status: 200 });
  };
  assert.equal((await loginInvoke("disconnect")).result.kind, "success");
  Date.now = realNow;

  // Token exchange may commit remotely while the Host cancels. Do not retry it,
  // accept its late token, or announce remote revocation without a known token.
  let exchangeStarted;
  let releaseExchange;
  const exchanging = new Promise(resolve => { exchangeStarted = resolve; });
  const lateExchange = new Promise(resolve => { releaseExchange = resolve; });
  let tokenRequests = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input) === oauthSettings.tokenEndpoint) { tokenRequests++; exchangeStarted(); return lateExchange; }
    return normalFetch(input, init);
  };
  const lateLogin = loginInvoke("login");
  await Promise.race([exchanging, lateLogin.then(result => assert.fail(`login completed before exchange: ${JSON.stringify(result.result)}`))]);
  const disconnected = await loginInvoke("disconnect");
  assert.equal(disconnected.result.kind, "error");
  assert.match(disconnected.result.text, /远端 grant 撤销尚未确认/);
  assert.equal((await lateLogin).result.kind, "error");
  releaseExchange(Response.json({ access_token: "late-access", token_type: "Bearer", expires_in: 60 }));
  await lateExchange;
  assert.equal((await loginInvoke("login")).result.kind, "error", "unknown grant blocks repeated login in this owner");
  assert.equal(tokenRequests, 1);
  assert.match((await loginInvoke("status")).result.text, /可能已经签发授权/);
  assert.doesNotMatch(JSON.stringify(loginAgent.session.snapshotEvents()), /late-access|synthetic-access|rotated-refresh/);
  const promptRuntime = login.systemPrompt;
  await login.fiber.dispose();
  assert.deepEqual((await promptRuntime.assemble({ scope: loginAgent })).sections.filter(section => section.name === "mcp:rental-os"), [], "unload removes the registration, not only its text");
  running.delete(login);

  const native = await open([{ id: "rental-os", config: { ...configured[0].config, oauth: oauthSettings,
    login: { enabled: true, attemptTimeoutMs: 2000, sessionLifetimeMs: 120000, maxAccessTtlSeconds: 300, callbackMode: "loopback" } } }]);
  const nativeAgent = { id: SessionId("native-oauth"), session: native.sessions.create(SessionId("native-oauth")) };
  browserModule.setOpen(async target => {
    authorizationUrl = new URL(target);
    const server = httpModule.listeners.at(-1);
    assert.equal(server.settings.host, "127.0.0.1");
    assert.equal(server.settings.port, 0, "native callback requests atomic OS port allocation");
    assert.equal(server.options.maxHeaderSize, 8192);
    assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "http://127.0.0.1:49153/rental/callback");
    callbackHandler = (req, res) => server.emit("request", req, res);
    const callback = new URL(authorizationUrl.searchParams.get("redirect_uri"));
    callback.searchParams.set("code", "synthetic-code");
    callback.searchParams.set("state", authorizationUrl.searchParams.get("state"));
    callback.searchParams.set("iss", asMetadata.issuer);
    assert.equal(deliverCallback(callback), 204);
  });
  globalThis.fetch = normalFetch;
  assert.equal((await native.commands.execute(nativeAgent, "/rental login", [], new AbortController().signal)).result.kind, "success");
  assert.equal(httpModule.listeners.at(-1).closed, true);
  assert.equal(httpModule.listeners.at(-1).connectionsClosed, true);
  assert.equal(native.get("webServer"), undefined, "native loopback does not require Host webserver");
  const { Client: OfficialClient } = await import(pathToFileURL(mcp.resolve("@modelcontextprotocol/client")).href);
  const originalClose = OfficialClient.prototype.close;
  const nativeRevokeCount = wire.filter(request => request.url === oauthSettings.revocationEndpoint).length;
  t.after(() => { OfficialClient.prototype.close = originalClose; });
  // Inject a transport-close failure only while this exact client is being closed.
  OfficialClient.prototype.close = async function () { await originalClose.call(this); throw new Error("synthetic-close-private-detail"); };
  try {
    const result = await native.commands.execute(nativeAgent, "/rental disconnect", [], new AbortController().signal);
    assert.equal(result.result.kind, "error");
    assert.doesNotMatch(result.result.text, /synthetic-close-private-detail/);
    assert.equal(wire.filter(request => request.url === oauthSettings.revocationEndpoint).length, nativeRevokeCount + 1, "remote revoke is attempted despite local transport-close failure");
    const sent = wire.length;
    assert.equal((await native.commands.execute(nativeAgent, "/rental check", [], new AbortController().signal)).result.kind, "error");
    assert.equal(wire.length, sent, "no cleared credential is used after failed close");
  } finally { OfficialClient.prototype.close = originalClose; }
  await native.fiber.dispose();
  running.delete(native);

  // The original ToolRuntime/bridge and SDK remain real; only business providers
  // and the OAuth HTTP/browser/listener boundaries below are synthetic.
  let publishedRead = true;
  let readStarted;
  let readRelease;
  let holdRead = false;
  let actualReads = 0;
  let accountingCalls = 0;
  let promptReads = 0;
  let publishedPrompt = true;
  let promptVersion = "reviewed-prompt-v1";
  let promptText = "Optional template, not an instruction loaded by the Host.";
  let promptFailure = false;
  let changePromptReply;
  let holdPrompt;
  const readSchema = { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false };
  const readOutput = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  const readsEndpoint = syntheticEndpoint(async () => ({ subject: "synthetic-actor", clientId: oauthSettings.clientId, resource: configured[0].config.connection.resourceUrl,
    scopes: oauthSettings.scopes, expiresAt: Date.now() / 1000 + 60 }), { readTools: {
    tools: [{ name: "synthetic_read", description: "Read the currently released test facts.", inputSchema: readSchema, outputSchema: readOutput,
      read: async input => {
        actualReads++;
        if (holdRead) { readStarted(); await new Promise(resolve => { readRelease = resolve; }); }
        return { answer: input.query, private_field: "synthetic-private-never-release" };
      } }],
    publication: { allows: async () => publishedRead },
    authority: { withRead: async (_auth, _name, _input, consume) => consume() },
    accounting: { withCall: async (_auth, _name, _input, consume) => { accountingCalls++; return consume(); } },
    release: { project: async (_auth, _name, value) => ({ answer: value.answer }) },
  }, instructions: { read: async () => ({ version: "reviewed-loop-v1", text: "Keep released facts and missing facts distinct." }) },
  prompts: {
    list: async () => publishedPrompt ? [
      { name: "synthetic_optional_prompt", version: promptVersion, description: "Optional starting guidance." },
      { name: "synthetic_not_configured", version: promptVersion, description: "Not selected by this client." },
    ] : [],
    read: async (_auth, _name, signal) => {
      promptReads++;
      if (promptFailure) throw new Error("synthetic-private-prompt-detail");
      const held = holdPrompt;
      if (held) {
        signal.addEventListener("abort", () => held.stopped.resolve(), { once: true });
        if (signal.aborted) held.stopped.resolve();
        held.started.resolve();
        await held.release.promise;
        held.settled.resolve();
      }
      return { version: promptVersion, text: promptText };
    },
  } });
  t.after(async () => { holdPrompt?.release.resolve(); await readsEndpoint.close(); });
  const bridge = await open([
    { insert: [
      { id: "system-prompt", name: pathToFileURL(cli.resolve("@deepseek-ai/dsh-system-prompt")).href },
      { id: "tools", name: pathToFileURL(publicResolve("@deepseek-ai/dsh-tools")).href, config: { mode: "native" } },
      { id: "agents", name: pathToFileURL(cli.resolve("@deepseek-ai/dsh-agent")).href },
      { id: "llm", name: pathToFileURL(cli.resolve("@deepseek-ai/dsh-llm")).href, disabled: true },
      { id: "session-projection", name: pathToFileURL(loopPackage.resolve("@deepseek-ai/dsh-session-projection")).href },
      { id: "agent-loop", name: pathToFileURL(loopPackage.resolve("@deepseek-ai/dsh-agent-loop")).href, config: { agents: [] }, disabled: true },
    ] },
    { id: "rental-os", config: { ...configured[0].config, oauth: oauthSettings,
      login: { enabled: true, attemptTimeoutMs: 2000, sessionLifetimeMs: 120000, maxAccessTtlSeconds: 300, callbackMode: "loopback" },
      readTools: ["synthetic_read"], readPrompts: ["synthetic_optional_prompt"] } },
  ]);
  const owner = { id: SessionId("bridge-owner"), session: bridge.sessions.create(SessionId("bridge-owner")) };
  const stranger = { id: SessionId("bridge-other"), session: bridge.sessions.create(SessionId("bridge-other")) };
  const { createScope, bindScopeParent } = await import(pathToFileURL(publicResolve("@deepseek-ai/dsh-scope")).href);
  owner.ctx = createScope(bridge, owner).ctx;
  stranger.ctx = createScope(bridge, stranger).ctx;
  const stopOwner = bridge.agents.enter(owner, undefined);
  await bridge.agents.announce(owner, "startup");
  await bridge.agents.register(stranger);
  const human = action => bridge.commands.execute(owner, `/rental ${action}`, [], new AbortController().signal);
  const publicName = "mcp__rental_os__synthetic_read";
  const execute = (agent, query = "bounded facts", abort = new AbortController().signal) => bridge.tools.execute({
    name: publicName, callId: "synthetic-call", arguments: { query }, agent, signal: abort,
  });
  assert.equal(bridge.tools.get(publicName, owner), undefined);
  assert.equal(bridge.get("llm"), undefined);
  assert.equal((await human("login")).result.kind, "error", "read-enabled login requires the real model-material admission service");
  const llmEntry = [...bridge.loader.entries()].find(entry => entry.options?.id === "llm");
  assert.ok(llmEntry);
  await llmEntry.update({ disabled: false });
  await bridge.loader.await();
  await llmEntry.fiber.await();
  const loopEntry = [...bridge.loader.entries()].find(entry => entry.options?.id === "agent-loop");
  assert.ok(loopEntry);
  await loopEntry.update({ disabled: false });
  await bridge.loader.await();
  await loopEntry.fiber.await();
  let resourceRequests = 0;
  globalThis.fetch = async (input, init) => {
    resourceRequests++;
    const address = String(input);
    if (address === oauthSettings.tokenEndpoint || address === oauthSettings.revocationEndpoint
      || address === "https://auth.example.invalid/.well-known/oauth-authorization-server") return normalFetch(input, init);
    const request = new Request(input, init);
    const response = await readsEndpoint.fetch(request);
    if (changePromptReply && request.method === "POST" && JSON.parse(init.body).method === "prompts/get") {
      const reply = await response.json();
      changePromptReply(reply.result);
      return Response.json(reply);
    }
    return response;
  };
  assert.equal((await human("login")).result.kind, "success");
  assert.deepEqual(bridge.tools.schemas(owner).map(tool => tool.name), [publicName]);
  assert.deepEqual(bridge.tools.schemas(stranger), []);
  const { LlmAdapter, createUserMessage, markAgentLoopRequest } = await import(pathToFileURL(cli.resolve("@deepseek-ai/dsh-llm")).href);
  let modelDispatches = 0;
  bridge.llm.registerAdapter(["synthetic-model-provider"], new class extends LlmAdapter {
    async *stream() { modelDispatches++; yield { type: "finish", reason: { kind: "stop" } }; }
  }());
  const message = createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "界".repeat(90000) }] });
  const materialRequest = { provider: "synthetic-model-provider", model: "synthetic-model", messages: [message], tools: bridge.tools.schemas(owner) };
  const collectModel = async options => { for await (const _chunk of bridge.llm.stream(options)) {} };
  await assert.rejects(() => bridge.agents.withInitiator(owner, () => collectModel(markAgentLoopRequest(materialRequest))), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, 0, "oversized neutral material never reaches the model adapter");
  const personalRequest = { ...materialRequest, tools: [] };
  await bridge.agents.withInitiator(stranger, () => collectModel(personalRequest));
  assert.equal(modelDispatches, 1, "unbound personal agent keeps its original model behavior");
  await assert.rejects(() => collectModel(materialRequest), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, 1, "copied Rental declarations require admission without an initiator or inherited authorization");
  const boundedRequest = { ...materialRequest, messages: [createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "bounded facts" }] })] };
  await bridge.agents.withInitiator(owner, () => collectModel(boundedRequest));
  assert.equal(modelDispatches, 2);
  const neutralBytes = options => Buffer.byteLength(JSON.stringify(options), "utf8");
  const exactRequest = { ...boundedRequest, system: "" };
  exactRequest.system = "x".repeat(262144 - neutralBytes(exactRequest));
  assert.equal(neutralBytes(exactRequest), 262144);
  await bridge.agents.withInitiator(owner, () => collectModel(exactRequest));
  assert.equal(modelDispatches, 3, "exact serialized neutral byte limit remains valid");
  await assert.rejects(() => bridge.agents.withInitiator(owner, () => collectModel({ ...exactRequest, system: exactRequest.system + "x" })), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, 3);
  const delivered = await execute(owner);
  assert.equal(delivered.isError, false);
  assert.deepEqual(delivered.value.structuredContent, { answer: "bounded facts" });
  assert.doesNotMatch(JSON.stringify(delivered), /private_field|synthetic-private|synthetic-access|synthetic-refresh/);
  assert.equal(actualReads, 1);
  assert.equal(accountingCalls, 1);
  const badArguments = await bridge.tools.execute({ name: publicName, callId: "synthetic-invalid", arguments: { query: "bounded", actor: "forged" }, agent: owner, signal: new AbortController().signal });
  assert.equal(badArguments.isError, true);
  assert.equal(actualReads, 1, "unknown identity arguments are rejected before the business reader");
  const child = { id: SessionId("bridge-child"), session: bridge.sessions.create(SessionId("bridge-child")) };
  bindScopeParent(child, owner);
  child.ctx = createScope(bridge, child).ctx;
  const stopChild = bridge.agents.enter(child, owner);
  await bridge.agents.announce(child, "startup");
  assert.deepEqual(bridge.tools.schemas(child), [], "a newly created child does not inherit Rental tools");
  const retainedDefinition = bridge.tools.get(publicName, owner);
  await assert.rejects(() => retainedDefinition.execute({ query: "forged owner" }, { agent: stranger, signal: new AbortController().signal }));
  assert.equal((await execute(child)).isError, true);
  assert.equal((await execute(stranger)).isError, true);
  assert.equal(actualReads, 1);
  stopChild();
  publishedRead = false;
  assert.equal((await execute(owner)).isError, true, "cached registration is still refused at the server");
  assert.equal(actualReads, 1);
  assert.equal((await human("check")).result.kind, "success");
  assert.equal(bridge.tools.get(publicName, owner), undefined);
  publishedRead = true;
  readSchema.properties.query.minLength = 1;
  assert.equal((await human("check")).result.kind, "error", "unsupported Host schema constraints fail closed rather than being stripped");
  assert.equal(bridge.tools.get(publicName, owner), undefined);
  delete readSchema.properties.query.minLength;
  assert.equal((await human("check")).result.kind, "success");
  const stale = bridge.tools.get(publicName, owner);
  holdRead = true;
  const reading = new Promise(resolve => { readStarted = resolve; });
  const inFlight = execute(owner);
  await reading;
  assert.equal((await human("disconnect")).result.kind, "success");
  assert.equal(bridge.tools.get(publicName, owner), undefined);
  readRelease();
  assert.equal((await inFlight).isError, true, "late read cannot reappear after disconnect");
  const beforeStale = actualReads;
  await assert.rejects(() => stale.execute({ query: "stale" }, { agent: owner, signal: new AbortController().signal }));
  assert.equal(actualReads, beforeStale);
  const beforeDisconnectedModel = modelDispatches;
  await assert.rejects(() => bridge.agents.withInitiator(owner, () => collectModel(materialRequest)), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, beforeDisconnectedModel, "disconnect does not remove the size restriction from retained Session material");
  await bridge.agents.withInitiator(stranger, () => collectModel(personalRequest));
  assert.equal(modelDispatches, beforeDisconnectedModel + 1, "disconnect does not restrict an unrelated personal Session");
  await bridge.agents.withInitiator(owner, () => collectModel(boundedRequest));
  assert.equal(modelDispatches, beforeDisconnectedModel + 2, "bounded personal use remains available in the disconnected Session");
  holdRead = false;
  assert.equal((await human("login")).result.kind, "success");
  assert.ok(bridge.tools.get(publicName, owner));
  stopOwner();
  assert.equal(bridge.tools.get(publicName, owner), undefined, "agent disposal withdraws registered tools immediately");
  assert.equal((await human("check")).result.kind, "error", "a disposed Agent cannot republish tools");
  assert.equal(bridge.tools.get(publicName, owner), undefined);
  // After the former owner's revocation settles, drive the real AgentLoop with
  // a scripted model. Only its provider output is synthetic, not loop/log code.
  await human("disconnect");
  const loopRequests = [];
  let loopStep = 0;
  bridge.llm.registerAdapter(["synthetic-loop-model"], new class extends LlmAdapter {
    async *stream(options) {
      loopRequests.push(options);
      if (loopStep++ === 0) {
        const id = "synthetic-loop-tool";
        const args = JSON.stringify({ query: "released loop fact" });
        yield { type: "block-start", index: 0, blockType: "tool-call" };
        yield { type: "tool-call-delta", index: 0, id, name: publicName, argumentsDelta: args };
        yield { type: "block-end", index: 0, block: { type: "tool-call", id, name: publicName, arguments: args } };
        yield { type: "finish", reason: { kind: "tool-calls" } };
      } else {
        yield { type: "block-start", index: 0, blockType: "text" };
        yield { type: "text-delta", index: 0, text: "Released facts are available." };
        yield { type: "block-end", index: 0, block: { type: "text", text: "Released facts are available." } };
        yield { type: "finish", reason: { kind: "stop" } };
      }
    }
  }());
  const loopHandle = await bridge.agents.create({ sessionId: SessionId("real-loop-rental"), agentOptions: { provider: "synthetic-loop-model", model: "synthetic-model" } });
  const loopAgent = loopHandle.agent;
  assert.equal((await bridge.commands.execute(loopAgent, "/rental login", [], new AbortController().signal)).result.kind, "success");
  loopAgent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Read the released test facts." }] }));
  await loopAgent.whenIdle();
  assert.equal(loopRequests.length, 2, "real loop calls the MCP tool then sends its released result to the next model request");
  assert.ok(loopRequests[0].tools.some(tool => tool.name === publicName));
  assert.match(JSON.stringify(loopRequests[0].messages), /reviewed-loop-v1/);
  assert.match(JSON.stringify(loopRequests[1].messages), /released loop fact/);
  assert.equal(promptReads, 0, "optional MCP Prompts do not become required or automatically adopted by the Rental tool bridge");
  assert.doesNotMatch(JSON.stringify(loopRequests), /Optional template, not an instruction/);
  const recorded = loopAgent.session.snapshotEvents();
  assert.ok(recorded.some(event => event.type === "tool/result"));
  assert.ok(recorded.some(event => event.type === "request/header"));
  assert.ok(recorded.some(event => event.type === "system/message" && JSON.stringify(event.data).includes("reviewed-loop-v1")));
  assert.doesNotMatch(JSON.stringify(recorded), /synthetic-private|synthetic-access|synthetic-refresh|code_verifier/);
  const { Session } = await import(pathToFileURL(cli.resolve("@deepseek-ai/dsh-session")).href);
  const restored = Session.create(loopAgent.session.id, JSON.parse(JSON.stringify(recorded)), loopAgent.session.header);
  assert.deepEqual(restored.deriveMessages(), loopAgent.session.deriveMessages(), "recorded model material reconstructs without an in-memory tool result");
  const promptCommand = (action, signal = new AbortController().signal, selectedAgent = loopAgent) =>
    bridge.commands.execute(selectedAgent, `/rental ${action}`, [], signal);
  const selectedMessages = () => loopAgent.session.deriveMessages().filter(message => message.source.kind === "rental-prompt");
  const beforePrompt = loopRequests.length;
  const listedPrompts = await promptCommand("prompts");
  assert.equal(listedPrompts.result.kind, "success");
  assert.match(listedPrompts.result.text, /synthetic_optional_prompt \(reviewed-prompt-v1\)/);
  assert.doesNotMatch(listedPrompts.result.text, /synthetic_not_configured/);
  assert.equal(promptReads, 0, "listing reads no template body");
  assert.equal(loopRequests.length, beforePrompt, "listing starts no model turn");
  const beforeInvalidPrompt = resourceRequests;
  for (const command of ["prompt synthetic_not_configured", "prompt synthetic_optional_prompt actor=secret-synthetic-token", "prompt", "prompt synthetic_optional_prompt extra"]) {
    assert.equal((await promptCommand(command)).result.kind, "error");
  }
  assert.equal((await promptCommand("prompt synthetic_optional_prompt", undefined, stranger)).result.kind, "error");
  const sameSessionStranger = { ...stranger, session: loopAgent.session };
  assert.equal((await promptCommand("prompt synthetic_optional_prompt", undefined, sameSessionStranger)).result.kind, "error");
  assert.equal(resourceRequests, beforeInvalidPrompt, "invalid names, arguments and another Agent cannot reach MCP");
  assert.doesNotMatch(JSON.stringify(loopAgent.session.snapshotEvents()), /secret-synthetic-token/);
  const maintenanceStarted = Promise.withResolvers();
  const maintenanceRelease = Promise.withResolvers();
  const maintenance = loopAgent.runMaintenance(async () => { maintenanceStarted.resolve(); await maintenanceRelease.promise; });
  await maintenanceStarted.promise;
  assert.equal(loopAgent.status, "idle", "public idle does not imply the maintenance claim is available");
  assert.match((await promptCommand("prompt synthetic_optional_prompt")).result.text, /本次没有排队/);
  assert.equal(resourceRequests, beforeInvalidPrompt);
  maintenanceRelease.resolve();
  await maintenance;
  assert.equal((await promptCommand("prompt synthetic_optional_prompt")).result.kind, "success");
  await loopAgent.whenIdle();
  assert.equal(promptReads, 1);
  assert.equal(loopRequests.length, beforePrompt + 1, "one selected template opens one original model turn");
  assert.equal(selectedMessages().length, 1);
  assert.deepEqual(selectedMessages()[0].source, { kind: "rental-prompt", name: "synthetic_optional_prompt", version: "reviewed-prompt-v1", form: "instructions" });
  assert.equal(selectedMessages()[0].content[0].text, `Rental OS guidance (reviewed-prompt-v1)\n${promptText}`);
  assert.match(JSON.stringify(loopRequests.at(-1).messages), /rental-prompt/);
  const promptRecorded = loopAgent.session.snapshotEvents();
  assert.equal(promptRecorded.filter(event => event.type === "user/message" && event.data.source?.kind === "rental-prompt").length, 1);
  const promptRestored = Session.create(loopAgent.session.id, JSON.parse(JSON.stringify(promptRecorded)), loopAgent.session.header);
  assert.deepEqual(promptRestored.deriveMessages(), loopAgent.session.deriveMessages());
  const promptOnly = { ...personalRequest, messages: [selectedMessages()[0]], system: "界".repeat(90000) };
  const beforePromptReplay = modelDispatches;
  await assert.rejects(() => collectModel(promptOnly), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, beforePromptReplay, "Prompt source alone requires complete material admission without a current initiator");
  publishedPrompt = false;
  assert.match((await promptCommand("prompts")).result.text, /没有已配置/);
  assert.equal((await promptCommand("prompt synthetic_optional_prompt")).result.kind, "error");
  assert.equal(promptReads, 1, "a withdrawn cached name cannot fetch its body");
  publishedPrompt = true;
  promptFailure = true;
  const failedPrompt = await promptCommand("prompt synthetic_optional_prompt");
  assert.equal(failedPrompt.result.kind, "error");
  assert.doesNotMatch(failedPrompt.result.text, /synthetic-private-prompt-detail/);
  assert.equal(selectedMessages().length, 1);
  assert.equal(loopRequests.length, beforePrompt + 1);
  promptFailure = false;
  for (const rewrite of [
    result => { result.messages[0].content.text = "Rental OS guidance (unexpected-version)\nsynthetic-private-prompt-detail"; },
    result => { result.messages[0].role = "assistant"; },
    result => { result.messages[0].content.text = "Rental OS guidance (reviewed-prompt-v1)\n" + "x".repeat(2000); },
  ]) {
    changePromptReply = rewrite;
    assert.equal((await promptCommand("prompt synthetic_optional_prompt")).result.kind, "error");
    assert.equal(selectedMessages().length, 1, "malformed, oversized or mismatched guidance never enters the inbox");
    assert.equal(loopRequests.length, beforePrompt + 1);
  }
  changePromptReply = undefined;
  assert.doesNotMatch(JSON.stringify(loopAgent.session.snapshotEvents()), /synthetic-private-prompt-detail/);
  promptVersion = "reviewed-prompt-v2";
  promptText = "Keep missing facts distinct; preserve {{literal_variable}}.";
  assert.equal((await promptCommand("prompt synthetic_optional_prompt")).result.kind, "success");
  await loopAgent.whenIdle();
  assert.equal(selectedMessages().at(-1).source.version, "reviewed-prompt-v2");
  assert.match(selectedMessages().at(-1).content[0].text, /\{\{literal_variable\}\}/);
  function holdTemplate() {
    holdPrompt = { started: Promise.withResolvers(), stopped: Promise.withResolvers(), release: Promise.withResolvers(), settled: Promise.withResolvers() };
    return holdPrompt;
  }
  async function releaseTemplate(held) {
    await held.stopped.promise;
    held.release.resolve();
    await held.settled.promise;
    holdPrompt = undefined;
    await loopAgent.whenIdle();
  }
  const cancelledTemplate = holdTemplate();
  const promptAbort = new AbortController();
  const cancellingPrompt = promptCommand("prompt synthetic_optional_prompt", promptAbort.signal);
  await cancelledTemplate.started.promise;
  const beforeCancelledTemplate = selectedMessages().length;
  const beforeCancelledModel = loopRequests.length;
  assert.equal((await promptCommand("prompt synthetic_optional_prompt")).result.kind, "error", "a second selection is never queued");
  const cancelledOutcome = assert.rejects(cancellingPrompt, error => error.name === "AbortError");
  promptAbort.abort();
  await cancelledOutcome;
  await releaseTemplate(cancelledTemplate);
  assert.equal(selectedMessages().length, beforeCancelledTemplate);
  assert.equal(loopRequests.length, beforeCancelledModel);
  const changedSession = loopAgent.session;
  loopAgent.session = stranger.session;
  const beforeChangedSession = resourceRequests;
  assert.equal((await promptCommand("prompt synthetic_optional_prompt")).result.kind, "error");
  assert.equal(resourceRequests, beforeChangedSession, "changing the exact Agent's Session cannot reuse this connection");
  loopAgent.session = changedSession;
  const agentCancelledTemplate = holdTemplate();
  const agentCancellingPrompt = promptCommand("prompt synthetic_optional_prompt");
  await agentCancelledTemplate.started.promise;
  loopAgent.cancel({ kind: "user" });
  assert.equal((await agentCancellingPrompt).result.kind, "error");
  await releaseTemplate(agentCancelledTemplate);
  assert.equal(selectedMessages().length, beforeCancelledTemplate, "Agent cancellation also prevents late input");
  const disconnectTemplate = holdTemplate();
  const disconnectingPrompt = promptCommand("prompt synthetic_optional_prompt");
  await disconnectTemplate.started.promise;
  assert.equal((await promptCommand("disconnect")).result.kind, "success");
  assert.equal((await disconnectingPrompt).result.kind, "error");
  await releaseTemplate(disconnectTemplate);
  assert.equal(selectedMessages().length, beforeCancelledTemplate, "disconnect drains selection without removing already logged history");
  assert.equal(loopRequests.length, beforeCancelledModel);
  const disposalHandle = await bridge.agents.create({ sessionId: SessionId("real-loop-prompt-disposal"), agentOptions: { provider: "synthetic-loop-model", model: "synthetic-model" } });
  t.after(() => disposalHandle.dispose());
  assert.equal((await promptCommand("login", undefined, disposalHandle.agent)).result.kind, "success");
  const disposalTemplate = holdTemplate();
  const disposalSelection = promptCommand("prompt synthetic_optional_prompt", undefined, disposalHandle.agent);
  await disposalTemplate.started.promise;
  await disposalHandle.dispose();
  assert.equal((await disposalSelection).result.kind, "error");
  await releaseTemplate(disposalTemplate);
  assert.equal(disposalHandle.agent.session.deriveMessages().some(message => message.source.kind === "rental-prompt"), false, "disposing the original Agent prevents late Prompt history");
  assert.equal(loopRequests.length, beforeCancelledModel);
  assert.equal(bridge.tools.get(publicName, loopAgent), undefined);
  const beforeOversized = loopRequests.length;
  loopAgent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "界".repeat(90000) }] }));
  await loopAgent.whenIdle();
  assert.equal(loopRequests.length, beforeOversized, "real loop rejection happens before the model adapter starts");
  const rejectedTurn = loopAgent.session.snapshotEvents().filter(event => event.type === "turn/end").at(-1);
  assert.equal(rejectedTurn.data.reason.kind, "error");
  assert.equal(rejectedTurn.data.reason.error.code, "RENTAL_MATERIAL_UNAVAILABLE");
  const rentalEntry = [...bridge.loader.entries()].find(entry => entry.options?.id === "rental-os");
  assert.ok(rentalEntry);
  await rentalEntry.update({ config: { ...rentalEntry.options.config, language: "en" } });
  await bridge.loader.await();
  await rentalEntry.fiber.await();
  const beforeReplay = modelDispatches;
  const replay = { ...personalRequest, messages: restored.deriveMessages(), toolHistory: restored.toolHistory(), system: "x".repeat(262144) };
  await assert.rejects(() => collectModel(replay), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, beforeReplay, "reloaded plugin rejects oversized recorded Rental material without a login or initiator");
  await assert.rejects(() => collectModel({ ...replay, messages: [message] }), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, beforeReplay, "historical tool declarations alone retain the size check");
  await assert.rejects(() => collectModel({ ...replay, toolHistory: undefined }), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, beforeReplay, "recorded tool calls retain the size check without declarations");
  await assert.rejects(() => collectModel({ ...promptOnly, tools: [], toolHistory: undefined }), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, beforeReplay, "a reloaded plugin recognizes Prompt-only logged material without restoring access");
  await bridge.agents.withInitiator(stranger, () => collectModel(personalRequest));
  assert.equal(modelDispatches, beforeReplay + 1, "reload does not restrict personal requests without Rental material");
  const beforeReplayAccess = resourceRequests;
  assert.equal(bridge.tools.get(publicName, loopAgent), undefined);
  assert.equal((await execute(loopAgent)).isError, true);
  assert.equal(resourceRequests, beforeReplayAccess, "historical materials do not restore business access");
  assert.equal((await bridge.commands.execute(loopAgent, "/rental login", [], new AbortController().signal)).result.kind, "success");
  const unloadTemplate = holdTemplate();
  const unloadSelection = promptCommand("prompt synthetic_optional_prompt");
  await unloadTemplate.started.promise;
  await rentalEntry.update({ config: { ...rentalEntry.options.config, language: "zh-CN" } });
  await bridge.loader.await();
  await rentalEntry.fiber.await();
  assert.equal((await unloadSelection).result.kind, "error");
  await releaseTemplate(unloadTemplate);
  assert.equal(selectedMessages().length, beforeCancelledTemplate, "plugin reload cancels and drains old selections");
  const afterPromptUnload = resourceRequests;
  assert.equal((await promptCommand("prompt synthetic_optional_prompt")).result.kind, "error");
  assert.equal(resourceRequests, afterPromptUnload, "reloading does not restore the former connection");
  assert.equal((await promptCommand("login")).result.kind, "success");
  const bridgeRuntime = bridge.tools;
  const beforeLlmRemoval = bridgeRuntime.get(publicName, loopAgent);
  assert.ok(beforeLlmRemoval);
  const removalTemplate = holdTemplate();
  const removalSelection = promptCommand("prompt synthetic_optional_prompt");
  await removalTemplate.started.promise;
  await llmEntry.update({ disabled: true });
  await bridge.loader.await();
  assert.equal(bridge.get("llm"), undefined);
  assert.equal((await removalSelection).result.kind, "error");
  await releaseTemplate(removalTemplate);
  assert.equal(selectedMessages().length, beforeCancelledTemplate, "model service removal cannot inject late guidance");
  assert.equal(bridgeRuntime.get(publicName, loopAgent), undefined, "removing model admission also withdraws Rental reads");
  const afterLlmRemoval = resourceRequests;
  await assert.rejects(() => beforeLlmRemoval.execute({ query: "stale after llm removal" }, { agent: loopAgent, signal: new AbortController().signal }));
  assert.equal((await bridge.commands.execute(loopAgent, "/rental login", [], new AbortController().signal)).result.kind, "error");
  assert.equal(resourceRequests, afterLlmRemoval, "missing admission cannot start login or execute a retained reader");
  await loopHandle.dispose();
  await bridge.fiber.dispose();
  running.delete(bridge);
  assert.equal(bridgeRuntime.get(publicName, owner), undefined);

  const disabled = await open([{ id: "rental-os", disabled: true }]);
  const disabledAgent = { id: SessionId("disabled-rental"), session: disabled.sessions.create(SessionId("disabled-rental")) };
  assert.equal(disabled.commands.find(disabledAgent, "rental"), undefined);
  assert.equal(calls, 3);
  await disabled.fiber.dispose();
  running.delete(disabled);

  // A third-party plugin failure must not kill the user's whole Harness. The
  // Loader reports the failed fiber; test that fiber, not boot() rejection.
  for (const config of [
    { connection: { resourceUrl: "http://wrong.invalid/", authorizationServerUrl: "https://auth.example.invalid/" } },
    { token: "not-a-real-token" },
    ...[
      { redirectUri: "http://localhost:49152/rental/callback" },
      { redirectUri: "https://trusted.invalid/callback?token=synthetic" },
      { tokenEndpoint: "http://auth.example.invalid/token" },
      { scopes: ["rental.catalog.read", "rental.catalog.read"] },
      { clientSecret: "not-a-real-secret" },
    ].map(override => ({ ...configured[0].config, oauth: { ...oauthSettings, ...override } })),
    { oauth: oauthSettings },
    ...[ ["duplicate", "duplicate"], ["invalid/name"], ["x".repeat(65)], Array.from({ length: 51 }, (_, index) => `prompt_${index}`), ["without_login"] ]
      .map(readPrompts => ({ ...configured[0].config, readPrompts })),
  ]) {
    const invalid = await open([{ id: "rental-os", config }]);
    const failed = [...invalid.loader.entries()].find(entry => entry.options?.id === "rental-os");
    assert.ok(failed?.fiber);
    await assert.rejects(() => failed.fiber.await(), /Unsupported|configuration|HTTPS|plugin|schema|OAuth inspection requires MCP connection settings|allowlist|enabled OAuth login/i);
    const invalidAgent = { id: SessionId("invalid-rental"), session: invalid.sessions.create(SessionId("invalid-rental")) };
    assert.equal(invalid.commands.find(invalidAgent, "rental"), undefined);
    await invalid.fiber.dispose();
    running.delete(invalid);
  }
});
