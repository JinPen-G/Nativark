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
const basePackage = createRequire(path.join(harness, "packages/bundle/base/package.json"));
const publicResolve = name => (name.startsWith("@modelcontextprotocol/") ? mcp
  : name === "@deepseek-ai/dsh-commands" ? commandPackage
    : ["@deepseek-ai/dsh-storage", "@deepseek-ai/dsh-storage-domain", "@deepseek-ai/dsh-storage-json"].includes(name) ? basePackage
      : ["@deepseek-ai/dsh-mcp-client", "@deepseek-ai/dsh-scope", "@deepseek-ai/dsh-tools"].includes(name) ? mcp : cli).resolve(name);

const { buildBundle } = require("../clients/harness-plugin/scripts/build-bundle.cjs");
const { createHash } = require("node:crypto");
const npmCli = path.join(root, "output/agent-desktop-install-20261023-q16gtnf6/node-extracted/node-v24.21.0-win-x64/node_modules/npm/bin/npm-cli.js");
const tar = createRequire(npmCli)("tar");

function transportSource(name) {
  const load = specifier => {
    if (!specifier.startsWith("./")) return mcp(specifier);
    const file = path.join(root, "packages/mcp-server/src", specifier.replace(/\.js$/, ".ts"));
    const module = { exports: {} };
    new Function("require", "module", "exports", ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText)(load, module, module.exports);
    return module.exports;
  };
  return load(`./${name}.js`);
}

function syntheticEndpoint(verifyAccessToken = async () => { throw new Error("The pre-login path must not verify a token"); }, overrides = {}) {
  return transportSource("index").createProtectedMcpEndpoint({
    enabled: true, resourceUrl: "https://mcp.example.invalid/mcp", authorizationServerUrl: "https://auth.example.invalid/",
    allowedOrigins: [], maxRequestBytes: 4096, authorizationTimeoutMs: 1000, ...overrides,
  }, { verifyAccessToken });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

test("Bundle pack refuses an incomplete archive report before recording delivery", async () => {
  const output = fs.mkdtempSync(path.join(root, "output/harness-plugin-pack-denial-"));
  // The packer is the external subprocess boundary; compilation still uses real installed declarations.
  const packer = path.join(output, "incomplete-pack.cjs");
  fs.writeFileSync(packer, `console.log(JSON.stringify([{ filename: ${JSON.stringify(`${manifest.name.replace(/^@/, "").replace(/\//g, "-")}-${manifest.version}.tgz`)}, files: [] }]));\n`);
  await assert.rejects(buildBundle({ outputDir: path.join(output, "delivery"), harnessRoot: harness, npmCli: packer }),
    /archive file set does not match/);
  assert.equal(fs.existsSync(path.join(output, "delivery/bundle-manifest.json")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, "delivery/pack.log"), "utf8")).status, 0,
    "a successful pack process does not attest a complete Bundle");
});

// One owner contains global resolver/fetch changes; no unrelated tests run inside it.
test("Rental bundle loads through real profile and Loader without granting business access", async t => {
  const output = fs.mkdtempSync(path.join(root, "output/harness-plugin-loader-"));
  const profile = path.join(output, "profile");
  const staged = path.join(profile, "node_modules/@rental-os/harness-plugin");
  const bundle = await buildBundle({ outputDir: path.join(output, "delivery"), harnessRoot: harness, npmCli });
  const archive = fs.readFileSync(bundle.tarball);
  assert.equal(createHash("sha256").update(archive).digest("hex"), bundle.sha256);
  assert.equal(`sha512-${createHash("sha512").update(archive).digest("base64")}`, bundle.integrity);
  const expectedFiles = ["package.json", "README.md", "cordis.patch.yml",
    ...fs.readdirSync(path.join(pluginRoot, "src")).filter(name => name.endsWith(".ts"))
      .flatMap(name => [`dist/${name.replace(/\.ts$/, ".js")}`, `dist/${name.replace(/\.ts$/, ".d.ts")}`])].sort();
  assert.deepEqual(bundle.files, expectedFiles);
  const deliveryManifest = JSON.parse(fs.readFileSync(path.join(output, "delivery/bundle-manifest.json"), "utf8"));
  assert.equal(deliveryManifest.tarball, path.basename(bundle.tarball));
  assert.equal(deliveryManifest.buildDependencies.typescript, manifest.devDependencies.typescript);
  assert.equal(deliveryManifest.hostVersion, manifest.engines.dsh);
  assert.deepEqual(deliveryManifest.sourceHashes["scripts/build-bundle.cjs"],
    createHash("sha256").update(fs.readFileSync(path.join(pluginRoot, "scripts/build-bundle.cjs"))).digest("hex"));
  const entries = [];
  tar.t({ file: bundle.tarball, sync: true, strict: true, onReadEntry(entry) {
    assert.equal(entry.type, "File");
    assert.match(entry.path, /^package\//);
    assert.ok(!entry.path.split("/").includes(".."));
    assert.ok(!entry.path.includes("\\"));
    entries.push(entry.path.slice("package/".length));
  } });
  assert.deepEqual(entries.sort(), expectedFiles);
  fs.mkdirSync(staged, { recursive: true });
  tar.x({ file: bundle.tarball, cwd: staged, strip: 1, sync: true, strict: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(staged, "package.json"), "utf8")), manifest);
  assert.ok(!fs.existsSync(path.join(staged, "node_modules")), "Host peers are not embedded");
  assert.ok(!fs.existsSync(path.join(staged, "src")), "precompiled Bundle needs no source checkout");
  for (const name of expectedFiles) {
    assert.deepEqual(fs.readFileSync(path.join(staged, name)), fs.readFileSync(path.join(output, "delivery/package", name)));
  }
  await assert.rejects(buildBundle({ outputDir: path.join(output, "delivery"), harnessRoot: harness, npmCli }), { code: "EEXIST" });
  assert.deepEqual(fs.readFileSync(bundle.tarball), archive, "a repeated build cannot overwrite delivered artifacts");
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

  // Timing barriers wrap the actual JSON backend, not domain semantics or durability.
  const storageFixture = path.join(output, "storage-fixture.mjs");
  fs.writeFileSync(storageFixture, `import { apply as applyJson, Config } from ${JSON.stringify(pathToFileURL(publicResolve("@deepseek-ai/dsh-storage-json")).href)};
export { Config };
export const name = 'storage-json-barrier', inject = ['storage'];
const boundaries = new Map();
export function setBoundary(root, boundary) { boundaries.set(root, boundary); return () => boundaries.delete(root); }
export function apply(ctx, config) {
  applyJson(ctx, config);
  const backend = ctx.storage.backend.get('json'), open = backend.kv.open.bind(backend.kv);
  backend.kv.open = async descriptor => {
    const unit = await open(descriptor), load = unit.loadAll.bind(unit), set = unit.setGlobal.bind(unit);
    unit.loadAll = async () => {
      await boundaries.get(config.root)?.beforeLoad?.();
      const result = await load(); boundaries.get(config.root)?.afterLoad?.(); return result;
    };
    unit.setGlobal = async value => {
      await boundaries.get(config.root)?.beforeSet?.(value);
      await set(value); await boundaries.get(config.root)?.afterSet?.(value);
    };
    return unit;
  };
}
`);
  const storageBoundary = await import(pathToFileURL(storageFixture).href);
  const storageRoots = new Map();
  async function open(overrides = [], storageRoot) {
    const loginEnabled = overrides.some(row => row.id === "rental-os" && row.config?.login?.enabled);
    const storage = [];
    if (loginEnabled && storageRoot !== false) {
      storageRoot ??= fs.mkdtempSync(path.join(output, "oauth-recovery-"));
      storage.push({ insert: [
        { id: "storage", name: pathToFileURL(publicResolve("@deepseek-ai/dsh-storage")).href },
        { id: "storage-json", name: pathToFileURL(publicResolve("@deepseek-ai/dsh-storage-json")).href, config: { root: storageRoot } },
        { id: "storage-domain", name: pathToFileURL(publicResolve("@deepseek-ai/dsh-storage-domain")).href, config: { backend: "json" } },
      ] });
    }
    const ctx = await boot.boot("offline-rental", configFile, structuredClone([...patches, ...storage, ...overrides]));
    running.add(ctx);
    if (storage.length) storageRoots.set(ctx, storageRoot);
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
  const assertPrivacyNotice = (text, language) => {
    const clauses = language === "zh-CN"
      ? [/Rental 使用提醒：/, /普通聊天可能在 Rental 工具执行前发送给模型/, /姓名、电话、证件、详细地址、银行账户、密码、令牌、模型 Key 或敏感附件/, /选择和批准请在可信 Rental 页面完成/, /断开或卸载不会删除 Harness 普通历史、生成文件或外部副本/, /不是全局敏感信息过滤器/, /自配模型费用由用户承担/, /服务端模型任务另走原 Gateway/]
      : [/Rental privacy notice:/, /Ordinary chat may reach your model before any Rental tool runs/, /names, phone numbers, identity documents, detailed addresses, bank accounts, passwords, tokens, model keys or sensitive attachments/, /Make choices and approvals in trusted Rental pages/, /Disconnecting or uninstalling does not delete ordinary Harness history, generated files or external copies/, /not a global sensitive-input filter/, /You pay for your configured model/, /Server model tasks use the original Gateway separately/];
    for (const clause of clauses) assert.match(text, clause);
  };
  assert.deepEqual(ctx.commands.list(agent).map(x => x.name), ["rental"]);
  const initialStatus = await invoke("/rental status");
  assert.match(initialStatus.result.text, /尚未配置/);
  assertPrivacyNotice(initialStatus.result.text, "zh-CN");
  assert.equal(agent.session.snapshotEvents().at(-1).data.text, initialStatus.result.text, "human notice is retained by the original command outcome");
  assert.deepEqual(agent.session.deriveMessages(), [], "human connection notice is not model material or a consent message");
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
  assertPrivacyNotice(checked.result.text, "zh-CN");
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
  const englishStatus = await active.commands.execute(other, "/rental status", [], new AbortController().signal);
  assert.match(englishStatus.result.text, /settings are present/);
  assertPrivacyNotice(englishStatus.result.text, "en");
  assert.equal(other.session.snapshotEvents().at(-1).data.text, englishStatus.result.text);
  assert.deepEqual(other.session.deriveMessages(), []);

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
export let failClose = false;
export function setFailClose(value) { failClose = value; }
export default class extends Service {
  constructor(ctx) { super(ctx, 'webServer'); }
  getOrigin() { return 'http://127.0.0.1:49152'; }
  register(route) { if (routes.has(route.path)) throw new Error('duplicate route'); routes.set(route.path, route); return () => { routes.delete(route.path); if (failClose) throw new Error('synthetic-private-callback-close'); }; }
}\n`);
  const listener = await import(pathToFileURL(listenerFixture).href);
  let guidance = { version: "reviewed-v1", text: "Choose the user's format. {{literal}} is data, not a variable." };
  const authenticatedEndpoint = syntheticEndpoint(async token => {
    assert.equal(token, "synthetic-access");
    return { subject: "synthetic-actor", clientId: oauthSettings.clientId, resource: configured[0].config.connection.resourceUrl,
      scopes: oauthSettings.scopes, expiresAt: Date.now() / 1000 + 60 };
  }, { instructions: { read: async () => guidance } });
  t.after(() => authenticatedEndpoint.close());
  const loginRows = [
    { insert: [
      { id: "oauth-listener-fixture", name: pathToFileURL(listenerFixture).href },
      { id: "system-prompt", name: pathToFileURL(cli.resolve("@deepseek-ai/dsh-system-prompt")).href },
    ] },
    { id: "rental-os", config: { ...configured[0].config, oauth: oauthSettings,
      login: { enabled: true, attemptTimeoutMs: 2000, sessionLifetimeMs: 120000, maxAccessTtlSeconds: 300, callbackMode: "host" } } },
  ];
  const withoutStorage = await open(loginRows, false);
  const storageLessAgent = { id: SessionId("storage-unavailable"), session: withoutStorage.sessions.create(SessionId("storage-unavailable")) };
  const beforeStorageDenial = calls;
  assert.match((await withoutStorage.commands.execute(storageLessAgent, "/rental status", [], new AbortController().signal)).result.text, /持久恢复存储/);
  assert.equal((await withoutStorage.commands.execute(storageLessAgent, "/rental login", [], new AbortController().signal)).result.kind, "error");
  assert.equal(calls, beforeStorageDenial, "missing recovery storage cannot start discovery or OAuth");
  await withoutStorage.fiber.dispose(); running.delete(withoutStorage);

  const malformedRoot = fs.mkdtempSync(path.join(output, "oauth-recovery-malformed-"));
  const malformedFile = path.join(malformedRoot, "rental_oauth_recovery.json");
  const malformedBytes = JSON.stringify({ unit: { name: "rental_oauth_recovery", version: 1 }, global: { state: "unknown-private-value" }, tables: {} });
  fs.writeFileSync(malformedFile, malformedBytes);
  const malformedHost = await open(loginRows, malformedRoot);
  const malformedAgent = { id: SessionId("malformed-recovery"), session: malformedHost.sessions.create(SessionId("malformed-recovery")) };
  assert.match((await malformedHost.commands.execute(malformedAgent, "/rental status", [], new AbortController().signal)).result.text, /可能已经签发授权/);
  assert.equal((await malformedHost.commands.execute(malformedAgent, "/rental login", [], new AbortController().signal)).result.kind, "error");
  assert.equal(calls, beforeStorageDenial);
  assert.equal(fs.readFileSync(malformedFile, "utf8"), malformedBytes, "a malformed journal remains intact, not reset to clear");
  await malformedHost.fiber.dispose(); running.delete(malformedHost);

  const failedWriteHost = await open(loginRows);
  const failedWriteAgent = { id: SessionId("recovery-write-failure"), session: failedWriteHost.sessions.create(SessionId("recovery-write-failure")) };
  await failedWriteHost.commands.execute(failedWriteAgent, "/rental status", [], new AbortController().signal);
  const failedWriteFile = path.join(storageRoots.get(failedWriteHost), "rental_oauth_recovery.json");
  fs.mkdirSync(failedWriteFile);
  assert.match((await failedWriteHost.commands.execute(failedWriteAgent, "/rental login", [], new AbortController().signal)).result.text, /可能已经签发授权/);
  assert.equal((await failedWriteHost.commands.execute(failedWriteAgent, "/rental login", [], new AbortController().signal)).result.kind, "error");
  assert.equal(calls, beforeStorageDenial, "failed durable reservation cannot reach discovery or the browser");
  assert.equal(fs.statSync(failedWriteFile).isDirectory(), true);
  await failedWriteHost.fiber.dispose(); running.delete(failedWriteHost);

  const { RentalOAuthRecovery } = await import(stagedUrl + "dist/oauth-recovery.js");
  async function recoveryHost() {
    const storageRoot = fs.mkdtempSync(path.join(output, "recovery-drain-"));
    const host = await open([{ insert: [
      { id: "storage", name: pathToFileURL(publicResolve("@deepseek-ai/dsh-storage")).href },
      { id: "storage-json", name: pathToFileURL(storageFixture).href, config: { root: storageRoot } },
      { id: "storage-domain", name: pathToFileURL(publicResolve("@deepseek-ai/dsh-storage-domain")).href, config: { backend: "json" } },
    ] }], false);
    return { host, storageRoot, file: path.join(storageRoot, "rental_oauth_recovery.json") };
  }
  await t.test("recovery close drains an opening read and shares one disposal", async () => {
    const { host, storageRoot } = await recoveryHost();
    const reading = Promise.withResolvers(), releaseRead = Promise.withResolvers();
    const events = [];
    const remove = storageBoundary.setBoundary(storageRoot, {
      async beforeLoad() { reading.resolve(); await releaseRead.promise; },
      afterLoad() { events.push("read"); },
    });
    const recovery = new RentalOAuthRecovery();
    const opening = recovery.open(host.get("storageDomain"));
    let closing;
    try {
      await reading.promise;
      closing = recovery.close().then(() => events.push("closed"));
      assert.equal(recovery.available, false);
      releaseRead.resolve();
      await Promise.all([opening, closing]);
      assert.deepEqual(events, ["read", "closed"], "close cannot finish while the backend read still owns the unit");
      const next = new RentalOAuthRecovery();
      await next.open(host.get("storageDomain"));
      await next.close();
    } finally {
      releaseRead.resolve();
      await opening.catch(() => {});
      await closing;
      await recovery.close();
      remove(); await host.fiber.dispose(); running.delete(host);
    }
  });
  for (const cancel of [true, false]) await t.test(`${cancel ? "cancelled" : "closed"} clear stays unresolved after late durability`, async () => {
    const { host, storageRoot, file } = await recoveryHost();
    const writing = Promise.withResolvers(), releaseClear = Promise.withResolvers();
    const states = [];
    const remove = storageBoundary.setBoundary(storageRoot, {
      async beforeSet(value) {
        states.push(value.state);
        if (value.state === "clear") { writing.resolve(); await releaseClear.promise; }
      },
    });
    const recovery = new RentalOAuthRecovery(), cancelled = new AbortController();
    await recovery.open(host.get("storageDomain"));
    await recovery.begin(new AbortController().signal);
    const settling = recovery.settle(cancelled.signal);
    const rejected = assert.rejects(settling, { code: "unknown" });
    let closing;
    try {
      await writing.promise;
      await assert.rejects(recovery.settle(new AbortController().signal), { code: "busy" });
      if (cancel) {
        cancelled.abort();
        await rejected;
        assert.equal(recovery.blocked, true);
      }
      assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).global.state, "unresolved");
      closing = recovery.close();
      assert.equal(recovery.close(), closing, "all disposers share the in-flight drain");
      releaseClear.resolve();
      await rejected;
      await closing;
      assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).global.state, "unresolved");
      assert.deepEqual(states, ["unresolved", "clear", "unresolved"]);
      assert.equal(recovery.close(), closing, "all disposers wait for the same owned drain");
      const next = new RentalOAuthRecovery();
      try {
        await next.open(host.get("storageDomain"));
        await assert.rejects(next.waitReady(new AbortController().signal), { code: "unknown" });
      } finally { await next.close(); }
    } finally {
      cancelled.abort(); releaseClear.resolve();
      await rejected; await closing; await recovery.close();
      remove(); await host.fiber.dispose(); running.delete(host);
    }
  });

  for (const failRepair of [false, true]) await t.test(`failed clear acknowledgement ${failRepair ? "reports failed compensation" : "restores unresolved"}`, async () => {
    const { host, storageRoot, file } = await recoveryHost();
    let unresolvedWrites = 0;
    const remove = storageBoundary.setBoundary(storageRoot, {
      beforeSet(value) {
        if (value.state === "unresolved" && ++unresolvedWrites === 2 && failRepair) throw new Error("synthetic-repair-failure");
      },
      afterSet(value) { if (value.state === "clear") throw new Error("synthetic-lost-write-acknowledgement"); },
    });
    const recovery = new RentalOAuthRecovery();
    try {
      await recovery.open(host.get("storageDomain"));
      await recovery.begin(new AbortController().signal);
      await assert.rejects(recovery.settle(new AbortController().signal), { code: "unknown" });
      assert.equal(recovery.blocked, true);
      const closing = recovery.close();
      if (failRepair) await assert.rejects(closing, { code: "unknown" });
      else await closing;
      assert.equal(unresolvedWrites, 2, "one compensation only, not a retry loop");
      assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).global.state, failRepair ? "clear" : "unresolved");
      await assert.rejects(recovery.waitReady(new AbortController().signal), { code: "unavailable" });
      remove();
      const next = new RentalOAuthRecovery();
      try { await next.open(host.get("storageDomain")); }
      finally { await next.close(); }
    } finally {
      if (failRepair) await assert.rejects(recovery.close(), { code: "unknown" });
      else await recovery.close();
      remove(); await host.fiber.dispose(); running.delete(host);
    }
  });

  let login = await open(loginRows);
  let loginAgent = { id: SessionId("login-owner"), session: login.sessions.create(SessionId("login-owner")) };
  const recoveryFile = host => path.join(storageRoots.get(host), "rental_oauth_recovery.json");
  const recoveryState = host => JSON.parse(fs.readFileSync(recoveryFile(host), "utf8")).global.state;
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
    assert.equal(recoveryState(login), "unresolved", "the real Host backend commits the marker before the browser is invoked");
    authorizationUrl = new URL(target);
    assert.equal(authorizationUrl.origin + authorizationUrl.pathname, oauthSettings.authorizationEndpoint);
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorizationUrl.searchParams.get("resource"), configured[0].config.connection.resourceUrl);
    assert.equal(authorizationUrl.searchParams.get("client_id"), oauthSettings.clientId);
    assert.ok(!authorizationUrl.searchParams.has("code_verifier"));
    callbackHandler = listener.routes.get("/rental/callback").handler;
    const authorized = await authorizationHandle(new Request(authorizationUrl, { headers: { Cookie: "original-web-fixture" } }));
    assert.equal(authorized.status, 303);
    const callback = new URL(authorized.headers.get("location"));
    assert.equal(callback.searchParams.get("code"), "synthetic-code");
    const wrongState = new URL(callback);
    wrongState.searchParams.set("state", "wrong");
    assert.equal(deliverCallback(wrongState), 400);
    const wrongIssuer = new URL(callback);
    wrongIssuer.searchParams.set("iss", "https://different.invalid/");
    assert.equal(deliverCallback(wrongIssuer), 400);
    assert.equal(deliverCallback(callback), 204);
    assert.equal(deliverCallback(callback), 410);
  });
  const tokenRegistration = { clientId: oauthSettings.clientId, revision: 1, enabled: true,
    expiresAt: Date.now() / 1000 + 60, redirectUris: [oauthSettings.redirectUri], scopes: oauthSettings.scopes };
  let originalCodeBinding;
  const authorizationHandle = transportSource("public-client-authorization-endpoint").createPublicClientAuthorizationEndpoint({ enabled: true,
    issuer: asMetadata.issuer, authorizationEndpoint: oauthSettings.authorizationEndpoint,
    resourceUrl: configured[0].config.connection.resourceUrl, allowedScopes: oauthSettings.scopes,
    allowedOrigins: [], timeoutMs: 1000 }, { read: async () => tokenRegistration }, {
      authorize: async (input, request) => {
        assert.equal(input.clientId, oauthSettings.clientId);
        assert.equal(input.clientRevision, 1);
        assert.equal(request.headers.get("cookie"), "original-web-fixture");
        originalCodeBinding = { clientId: input.clientId, resource: input.resource, redirectUri: input.redirectUri,
          codeChallengeMethod: "S256", codeChallenge: input.codeChallenge };
        return { kind: "code", code: "synthetic-code" };
      },
    });
  const tokenHandle = transportSource("oauth-token-endpoint").createOAuthTokenEndpoint({ enabled: true,
    tokenEndpoint: oauthSettings.tokenEndpoint, revocationEndpoint: oauthSettings.revocationEndpoint,
    resourceUrl: configured[0].config.connection.resourceUrl, allowedScopes: oauthSettings.scopes,
    allowedOrigins: [], timeoutMs: 1000, maxRequestBytes: 32768 }, { read: async () => tokenRegistration }, {
      // Actual transport/SDK, but no synthetic implementation is claimed as a
      // durable authorization server. These are its external issuance boundaries.
      exchangeCode: async command => {
        assert.equal(command.clientId, oauthSettings.clientId);
        assert.equal(command.code, "synthetic-code");
        assert.equal(command.resource, configured[0].config.connection.resourceUrl);
        transportSource("authorization-code-binding").assertAuthorizationCodeBinding(command, originalCodeBinding);
        return { access_token: "synthetic-access", refresh_token: "synthetic-refresh", token_type: "Bearer", expires_in: 60, scope: oauthSettings.scopes.join(" ") };
      },
      refresh: async () => { throw new Error("This external refresh fixture is supplied separately below"); },
      revoke: async command => { assert.equal(command.token, "synthetic-refresh"); },
    });
  const asMetadataHandle = transportSource("authorization-server-metadata").createAuthorizationServerMetadata({ enabled: true,
    issuer: asMetadata.issuer, authorizationEndpoint: oauthSettings.authorizationEndpoint,
    tokenEndpoint: oauthSettings.tokenEndpoint, revocationEndpoint: oauthSettings.revocationEndpoint,
    allowedScopes: oauthSettings.scopes, allowedOrigins: [], timeoutMs: 1000, maxMetadataBytes: 4096 }, { read: async () => asMetadata });
  const protocolRequests = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    wire.push(request);
    if (request.url === configured[0].config.connection.resourceUrl && request.method === "POST") {
      const body = await request.clone().json();
      protocolRequests.push({ body, protocol: request.headers.get("mcp-protocol-version"), session: request.headers.get("mcp-session-id") });
    }
    if (request.url === "https://auth.example.invalid/.well-known/oauth-authorization-server") return asMetadataHandle(request);
    if (request.url === oauthSettings.tokenEndpoint || request.url === oauthSettings.revocationEndpoint) return tokenHandle(request);
    return authenticatedEndpoint.fetch(request);
  };
  const loggedIn = await loginInvoke("login");
  assert.equal(loggedIn.result.kind, "success", loggedIn.result.text);
  assert.match(loggedIn.result.text, /当前会话完成 MCP 握手/);
  const discoveryRequest = protocolRequests.find(request => request.body.method === "server/discover");
  assert.ok(discoveryRequest, "the real SDK connects through the pinned modern discovery path");
  const clientInfo = Object.values(discoveryRequest.body.params._meta).find(value => value && typeof value === "object" && value.name === "rental-os-harness");
  assert.deepEqual(clientInfo, { name: "rental-os-harness", version: manifest.version }, "MCP client metadata follows the actual published Bundle version");
  assert.equal(protocolRequests.some(request => request.body.method === "initialize"), false, "modern connect does not fall back to the legacy handshake");
  assert.ok(protocolRequests.every(request => request.session === null), "modern requests do not create legacy protocol session credentials");
  await t.test("missing Bundle version fails without reporting local metadata contents", async () => {
    const file = path.join(staged, "package.json"), original = fs.readFileSync(file);
    try {
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(original.toString("utf8")), version: "", privateFixture: "private-package-marker" }));
      await assert.rejects(import(stagedUrl + "dist/oauth-session.js?invalid-version"), error => error.message === "Rental Bundle metadata is unavailable");
    } finally { fs.writeFileSync(file, original); }
  });
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
  assert.equal(recoveryState(login), "clear", "normal original revocation acceptance settles this live reservation");
  for (const language of ["zh-CN", "en"]) for (const failCleanup of [false, true]) await t.test(`explicit AS denial remains human-only: ${language}, cleanup=${failCleanup}`, async () => {
    const previousFetch = globalThis.fetch, previousBrowser = browserModule.opened;
    const previousCallback = callbackHandler, previousBinding = originalCodeBinding;
    const requests = [];
    let host, acceptedDenial = false;
    const denyAuthorization = transportSource("public-client-authorization-endpoint").createPublicClientAuthorizationEndpoint({ enabled: true,
      issuer: asMetadata.issuer, authorizationEndpoint: oauthSettings.authorizationEndpoint,
      resourceUrl: configured[0].config.connection.resourceUrl, allowedScopes: oauthSettings.scopes,
      allowedOrigins: [], timeoutMs: 1000 }, { read: async () => tokenRegistration }, {
      authorize: async () => ({ kind: "denied", error: "access_denied" }),
    });
    try {
      host = await open(loginRows.map(row => row.id === "rental-os" ? { ...row, config: { ...row.config, language } } : row));
      const id = SessionId(`explicit-denial-${language}-${failCleanup}`);
      const agent = { id, session: host.sessions.create(id) };
      const invokeDenied = action => host.commands.execute(agent, `/rental ${action}`, [], new AbortController().signal);
      globalThis.fetch = async (input, init) => { requests.push(new Request(input, init)); return previousFetch(input, init); };
      browserModule.setOpen(async target => {
        assert.equal(recoveryState(host), "unresolved");
        callbackHandler = listener.routes.get("/rental/callback").handler;
        const response = await denyAuthorization(new Request(target, { headers: { Cookie: "original-web-fixture" } }));
        assert.equal(response.status, 303);
        const callback = new URL(response.headers.get("location"));
        assert.equal(callback.searchParams.get("error"), "access_denied");
        assert.equal(callback.searchParams.has("code"), false);
        const wrongState = new URL(callback); wrongState.searchParams.set("state", "incorrect");
        assert.equal(deliverCallback(wrongState), 400);
        const wrongIssuer = new URL(callback); wrongIssuer.searchParams.set("iss", "https://different.invalid/");
        assert.equal(deliverCallback(wrongIssuer), 400);
        const mixed = new URL(callback); mixed.searchParams.set("code", "synthetic-private-code");
        assert.equal(deliverCallback(mixed), 400);
        callback.searchParams.set("error_description", "synthetic-private-denial-detail");
        callback.searchParams.set("error_uri", "https://different.invalid/private-denial");
        assert.equal(deliverCallback(callback), 204);
        assert.equal(deliverCallback(callback), 410);
        acceptedDenial = true;
      });
      listener.setFailClose(failCleanup);
      const denied = await invokeDenied("login");
      assert.equal(acceptedDenial, true, "the denial callback completed; swallowed browser assertions cannot satisfy this test");
      assert.equal(denied.result.kind, "error");
      assertPrivacyNotice(denied.result.text, language);
      assert.equal(requests.some(request => request.url === oauthSettings.tokenEndpoint || request.url === oauthSettings.revocationEndpoint), false,
        "validated denial does not exchange a code or invent a token to revoke");
      assert.equal(listener.routes.size, 0);
      assert.deepEqual(agent.session.deriveMessages(), []);
      assert.doesNotMatch(JSON.stringify(agent.session.snapshotEvents()), /synthetic-private|private-denial|code_verifier|code_challenge|state=/);
      if (failCleanup) {
        assert.match(denied.result.text, language === "zh-CN" ? /可能已经签发授权/ : /authorization may have been issued/);
        assert.doesNotMatch(denied.result.text, /明确拒绝本次授权请求|explicitly denied this request/);
        assert.equal(recoveryState(host), "unresolved");
        const beforeRetry = requests.length;
        assert.equal((await invokeDenied("login")).result.kind, "error");
        assert.equal(requests.length, beforeRetry, "cleanup uncertainty cannot become a safe reauthorization");
      } else {
        assert.match(denied.result.text, language === "zh-CN" ? /授权服务器明确拒绝本次授权请求/ : /authorization server explicitly denied this request/);
        assert.equal(recoveryState(host), "clear");
        assert.match((await invokeDenied("status")).result.text, language === "zh-CN" ? /已配置/ : /settings are present/);
        assert.equal(requests.some(request => request.url === oauthSettings.tokenEndpoint), false, "status cannot restart the denied login");
        browserModule.setOpen(async target => {
          callbackHandler = listener.routes.get("/rental/callback").handler;
          const response = await authorizationHandle(new Request(target, { headers: { Cookie: "original-web-fixture" } }));
          assert.equal(response.status, 303);
          assert.equal(deliverCallback(new URL(response.headers.get("location"))), 204);
        });
        assert.equal((await invokeDenied("login")).result.kind, "success", "only a new explicit human command starts another authorization");
        assert.equal(requests.filter(request => request.url === oauthSettings.tokenEndpoint).length, 1);
        assert.equal((await invokeDenied("disconnect")).result.kind, "success");
      }
    } finally {
      listener.setFailClose(false);
      try { if (host) { await host.fiber.dispose(); running.delete(host); } }
      finally {
        globalThis.fetch = previousFetch; browserModule.setOpen(previousBrowser);
        callbackHandler = previousCallback; originalCodeBinding = previousBinding;
      }
    }
  });
  await t.test("pinned modern MCP refusal never falls back or publishes an uncertain connection", async () => {
    for (const language of ["zh-CN", "en"]) {
      const assertProtocolFeedback = text => {
        assert.match(text, language === "zh-CN" ? /不支持本插件固定协议（2026-07-28）/ : /does not support this plugin's fixed protocol \(2026-07-28\)/);
        assert.match(text, language === "zh-CN" ? /服务管理员核对服务端与插件支持版本/ : /service administrator to verify the supported server and plugin versions/);
        assert.match(text, language === "zh-CN" ? /不要启用旧协议回退/ : /do not enable a legacy fallback/);
        assertPrivacyNotice(text, language);
      };
      const previousFetch = globalThis.fetch, previousBrowser = browserModule.opened;
      const previousCallback = callbackHandler, previousBinding = originalCodeBinding;
      const requests = [];
      let refusedHost, refusalReplies = 0;
      try {
        globalThis.fetch = async (input, init) => {
          const request = new Request(input, init);
          const body = request.url === configured[0].config.connection.resourceUrl && request.method === "POST"
            ? await request.clone().json() : undefined;
          requests.push({ url: request.url, method: request.method, body, session: request.headers.get("mcp-session-id"),
            expectedBearer: request.headers.get("authorization") === "Bearer synthetic-access" });
          if (body?.method === "server/discover" && request.headers.has("authorization")) {
            refusalReplies++;
            return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32022,
              message: "synthetic-private-protocol-detail", data: { supported: ["2025-11-25"], requested: "2026-07-28" } } }, { status: 400 });
          }
          if (request.url === "https://auth.example.invalid/.well-known/oauth-authorization-server") return asMetadataHandle(request);
          if (request.url === oauthSettings.tokenEndpoint || request.url === oauthSettings.revocationEndpoint) return tokenHandle(request);
          return authenticatedEndpoint.fetch(request);
        };
        refusedHost = await open(loginRows.map(row => row.id === "rental-os" ? { ...row, config: { ...row.config, language } } : row));
        const refusalRoot = storageRoots.get(refusedHost);
        assert.notEqual(refusalRoot, storageRoots.get(login), "this refusal owns a separate recovery root");
        const refusedId = SessionId(`pin-refusal-owner-${language}`);
        const refusedAgent = { id: refusedId, session: refusedHost.sessions.create(refusedId) };
        const invokeRefused = action => refusedHost.commands.execute(refusedAgent, `/rental ${action}`, [], new AbortController().signal);
        browserModule.setOpen(async target => {
          assert.equal(recoveryState(refusedHost), "unresolved");
          callbackHandler = listener.routes.get("/rental/callback").handler;
          const authorized = await authorizationHandle(new Request(target, { headers: { Cookie: "original-web-fixture" } }));
          assert.equal(authorized.status, 303);
          assert.equal(deliverCallback(authorized.headers.get("location")), 204);
        });
        const rejected = await invokeRefused("login");
        assert.equal(rejected.result.kind, "error");
        assertProtocolFeedback(rejected.result.text);
        assert.match(rejected.result.text, language === "zh-CN" ? /可能已经签发授权/ : /authorization may have been issued/);
        const refusalStatus = await invokeRefused("status");
        assertProtocolFeedback(refusalStatus.result.text);
        assert.match(refusalStatus.result.text, language === "zh-CN" ? /可能已经签发授权/ : /authorization may have been issued/);
        const strangerId = SessionId(`pin-refusal-stranger-${language}`);
        const stranger = { id: strangerId, session: refusedHost.sessions.create(strangerId) };
        const strangerStatus = await refusedHost.commands.execute(stranger, "/rental status", [], new AbortController().signal);
        assert.match(strangerStatus.result.text, language === "zh-CN" ? /另一个会话/ : /another session/);
        assert.doesNotMatch(strangerStatus.result.text, /固定协议|fixed protocol/);
        assert.equal(recoveryState(refusedHost), "unresolved");
        const unresolvedBytes = fs.readFileSync(recoveryFile(refusedHost));
        const refusedGuidance = () => refusedHost.systemPrompt.assemble({ scope: refusedAgent });
        assert.deepEqual((await refusedGuidance()).sections.filter(section => section.name === "mcp:rental-os" && section.text), []);
        assert.equal(refusedHost.get("tools"), undefined);
        const probes = requests.filter(request => request.body?.method === "server/discover");
        assert.equal(probes.length, 1, "the real SDK rejects the old-only offer without a second probe");
        assert.equal(refusalReplies, 1, "the refusal fixture actually returned the protocol error, not a network failure");
        assert.equal(probes[0].expectedBearer, true);
        assert.equal(probes[0].body.params._meta["io.modelcontextprotocol/protocolVersion"], "2026-07-28");
        assert.equal(requests.filter(request => request.url === oauthSettings.tokenEndpoint).length, 1);
        assert.ok(requests.every(request => request.session === null));
        assert.equal(requests.some(request => ["initialize", "notifications/initialized", "tools/list", "tools/call"].includes(request.body?.method)), false);
        assert.equal(listener.routes.size, 0, "failed negotiation still releases its one-shot callback");
        const beforeRetry = requests.length;
        for (const action of ["check", "login"]) {
          const blocked = await invokeRefused(action);
          assert.equal(blocked.result.kind, "error");
          assertProtocolFeedback(blocked.result.text);
        }
        assert.equal(requests.length, beforeRetry, "unknown cannot renegotiate or exchange another code");
        assert.deepEqual(fs.readFileSync(recoveryFile(refusedHost)), unresolvedBytes);
        // The code exchange already issued credentials. Revocation acceptance
        // cannot erase the original uncertainty established by failed connect.
        const refusalDisconnect = await invokeRefused("disconnect");
        assert.equal(refusalDisconnect.result.kind, "error");
        assertProtocolFeedback(refusalDisconnect.result.text);
        assert.match(refusalDisconnect.result.text, language === "zh-CN" ? /远端 grant 撤销尚未确认/ : /Remote grant revocation is not confirmed/);
        assert.equal(requests.filter(request => request.url === oauthSettings.revocationEndpoint).length, 1);
        const afterDisconnect = await invokeRefused("status");
        assertProtocolFeedback(afterDisconnect.result.text);
        assert.match(afterDisconnect.result.text, language === "zh-CN" ? /可能已经签发授权/ : /authorization may have been issued/);
        assert.deepEqual(refusedAgent.session.deriveMessages(), [], "compatibility feedback is human/log-only");
        assert.deepEqual(fs.readFileSync(recoveryFile(refusedHost)), unresolvedBytes);
        assert.doesNotMatch(JSON.stringify(refusedAgent.session.snapshotEvents()),
          /synthetic-private-protocol-detail|synthetic-(?:code|access|refresh)|code_verifier|code_challenge|state=/);
        await refusedHost.fiber.dispose();
        running.delete(refusedHost);
        assert.deepEqual(fs.readFileSync(recoveryFile(refusedHost)), unresolvedBytes);
        assert.equal(requests.length, beforeRetry + 1, "disposal does not reissue the grant or repeat an accepted revoke");
        refusedHost = undefined;
        refusedHost = await open(loginRows.map(row => row.id === "rental-os" ? { ...row, config: { ...row.config, language } } : row), refusalRoot);
        const restoredId = SessionId(`pin-refusal-restored-${language}`);
        const restoredAgent = { id: restoredId, session: refusedHost.sessions.create(restoredId) };
        for (const action of ["status", "check", "login"]) {
          const restored = await refusedHost.commands.execute(restoredAgent, `/rental ${action}`, [], new AbortController().signal);
          assert.match(restored.result.text, language === "zh-CN" ? /可能已经签发授权/ : /authorization may have been issued/);
          assert.doesNotMatch(restored.result.text, /固定协议|fixed protocol/, "the recovery marker cannot reconstruct an in-memory protocol diagnosis");
        }
        assert.equal(requests.length, beforeRetry + 1, "a fresh Loader keeps unresolved without a new probe or login");
        await refusedHost.fiber.dispose();
        running.delete(refusedHost);
        refusedHost = undefined;
      } finally {
        try {
          if (refusedHost) { await refusedHost.fiber.dispose(); running.delete(refusedHost); }
        } finally {
          globalThis.fetch = previousFetch;
          browserModule.setOpen(previousBrowser);
          callbackHandler = previousCallback;
          originalCodeBinding = previousBinding;
        }
      }
    }
  });
  for (const scenario of ["accepted", "revoke-failed", "pending-exchange"]) await t.test(`plain OAuth follows real Agent disposal: ${scenario}`, async () => {
    const previousFetch = globalThis.fetch, previousBrowser = browserModule.opened;
    const previousCallback = callbackHandler, previousBinding = originalCodeBinding;
    const requests = [], exchangeStarted = Promise.withResolvers(), releaseExchange = Promise.withResolvers();
    const revocationStarted = Promise.withResolvers();
    let host, handle, otherHandle, tokenSignal;
    try {
      host = await open([...loginRows, { insert: [
        { id: "tools", name: pathToFileURL(publicResolve("@deepseek-ai/dsh-tools")).href, config: { mode: "native" } },
        { id: "agents", name: pathToFileURL(cli.resolve("@deepseek-ai/dsh-agent")).href },
        { id: "llm", name: pathToFileURL(cli.resolve("@deepseek-ai/dsh-llm")).href },
        { id: "session-projection", name: pathToFileURL(loopPackage.resolve("@deepseek-ai/dsh-session-projection")).href },
        { id: "agent-loop", name: pathToFileURL(loopPackage.resolve("@deepseek-ai/dsh-agent-loop")).href, config: { agents: [] } },
      ] }]);
      handle = await host.agents.create({ sessionId: SessionId(`plain-owner-${scenario}`), agentOptions: {} });
      otherHandle = await host.agents.create({ sessionId: SessionId(`plain-other-${scenario}`), agentOptions: {} });
      const invokePlain = (action, agent = handle.agent) => host.commands.execute(agent, `/rental ${action}`, [], new AbortController().signal);
      browserModule.setOpen(async target => {
        assert.equal(recoveryState(host), "unresolved");
        callbackHandler = listener.routes.get("/rental/callback").handler;
        const authorized = await authorizationHandle(new Request(target, { headers: { Cookie: "original-web-fixture" } }));
        assert.equal(authorized.status, 303);
        assert.equal(deliverCallback(new URL(authorized.headers.get("location"))), 204);
      });
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url === oauthSettings.tokenEndpoint && scenario === "pending-exchange") {
          tokenSignal = request.signal;
          exchangeStarted.resolve();
          return releaseExchange.promise;
        }
        if (request.url === oauthSettings.revocationEndpoint) {
          revocationStarted.resolve();
          if (scenario === "revoke-failed") return new Response(null, { status: 503 });
        }
        return previousFetch(input, init);
      };
      const loggingIn = invokePlain("login");
      if (scenario === "pending-exchange") {
        await Promise.race([exchangeStarted.promise, loggingIn.then(result => assert.fail(`login ended before the exchange barrier: ${result.result.kind}`))]);
        await handle.dispose();
        assert.equal(tokenSignal.aborted, true, "destroying the real owner cancels its pending exchange, not merely the model loop");
        assert.equal((await loggingIn).result.kind, "error");
        releaseExchange.resolve(Response.json({ access_token: "synthetic-late-owner-access", token_type: "Bearer", expires_in: 60 }));
        await releaseExchange.promise;
        assert.equal(requests.filter(request => request.url === oauthSettings.revocationEndpoint).length, 0, "an unreceived token cannot be invented for revocation");
      } else {
        const result = await loggingIn;
        assert.equal(result.result.kind, "success", result.result.text);
        assert.equal(host.tools.schemas(handle.agent).some(tool => tool.name.startsWith("mcp__rental_os__")), false,
          "the original AgentLoop's Tools dependency does not register a Rental consumer");
        const beforeOtherDisposal = requests.length;
        await otherHandle.dispose();
        assert.equal(requests.length, beforeOtherDisposal, "another Agent's disposal cannot close the exact owner's connection");
        assert.match((await invokePlain("status")).result.text, /当前会话完成 MCP 握手/);
        await handle.dispose();
        const sections = await host.systemPrompt.assemble({ scope: handle.agent });
        assert.equal(sections.sections.some(section => section.name === "mcp:rental-os" && section.text), false,
          "actual Agent disposal withdraws local guidance before async revocation settles");
        // Original AgentHandle disposal emits, but does not await, async listeners.
        // Observe its automatic revoke before joining that same owned drain.
        await revocationStarted.promise;
        assert.equal((await invokePlain("disconnect")).result.kind, scenario === "accepted" ? "success" : "error");
        assert.equal(requests.filter(request => request.url === oauthSettings.revocationEndpoint).length, 1, "one owner sends one original revocation after actual Agent disposal");
      }
      assert.equal(host.agents.get(handle.agent.id), undefined);
      assert.equal(listener.routes.size, 0);
      assert.equal(recoveryState(host), scenario === "accepted" ? "clear" : "unresolved");
      const status = await invokePlain("status");
      assert.match(status.result.text, scenario === "accepted" ? /已配置/ : /可能已经签发授权/);
      const beforeReuse = requests.length;
      assert.equal((await invokePlain("login")).result.kind, "error", "a disposed Agent cannot obtain a new connection");
      assert.equal(requests.length, beforeReuse);
      await handle.dispose();
      assert.equal(requests.length, beforeReuse, "repeated Agent disposal does not repeat OAuth");
      assert.deepEqual(handle.agent.session.deriveMessages(), []);
      assert.doesNotMatch(JSON.stringify(handle.agent.session.snapshotEvents()), /synthetic-(?:code|access|refresh|late-owner-access)|code_verifier/);
    } finally {
      releaseExchange.resolve(Response.json({ access_token: "synthetic-late-owner-access", token_type: "Bearer", expires_in: 60 }));
      try {
        await handle?.dispose(); await otherHandle?.dispose();
        if (host) { await host.fiber.dispose(); running.delete(host); }
      } finally {
        globalThis.fetch = previousFetch;
        browserModule.setOpen(previousBrowser);
        callbackHandler = previousCallback; originalCodeBinding = previousBinding;
      }
    }
  });
  t.after(() => listener.setFailClose(false));
  listener.setFailClose(true);
  const failedCallbackClose = await loginInvoke("login");
  assert.equal(failedCallbackClose.result.kind, "error");
  assert.doesNotMatch(failedCallbackClose.result.text, /固定协议|fixed protocol/, "callback cleanup failure is not a protocol diagnosis");
  assert.match((await loginInvoke("status")).result.text, /可能已经签发授权/,
    "failed callback cleanup cannot leave a usable connected identity after a failed login");
  assert.deepEqual(await rentalGuidance(loginAgent), []);
  const beforeCallbackRecovery = wire.length;
  assert.equal((await loginInvoke("check")).result.kind, "error");
  assert.equal((await loginInvoke("login")).result.kind, "error");
  assert.equal(wire.length, beforeCallbackRecovery, "unknown cleanup cannot reuse or reissue the grant");
  listener.setFailClose(false);
  assert.equal((await loginInvoke("disconnect")).result.kind, "error", "revocation acceptance does not erase cleanup uncertainty");
  assert.equal(wire.at(-1).url, oauthSettings.revocationEndpoint, "known credentials remain available only for original revocation");
  assert.doesNotMatch(JSON.stringify(loginAgent.session.snapshotEvents()), /synthetic-private-callback-close|synthetic-refresh/);
  const unresolvedRoot = storageRoots.get(login), unresolvedBytes = fs.readFileSync(recoveryFile(login));
  assert.equal(recoveryState(login), "unresolved");
  const loginEntry = [...login.loader.entries()].find(entry => entry.options?.id === "rental-os");
  await loginEntry.update({ config: { ...loginEntry.options.config,
    login: { ...loginEntry.options.config.login, sessionLifetimeMs: 119000 } } });
  await login.loader.await(); await loginEntry.fiber.await();
  const beforeReloadLogin = wire.length;
  assert.match((await loginInvoke("status")).result.text, /可能已经签发授权/);
  assert.equal((await loginInvoke("login")).result.kind, "error");
  assert.equal((await loginInvoke("disconnect")).result.kind, "error");
  assert.equal(wire.length, beforeReloadLogin, "reload cannot clear uncertainty or send another authorization request");
  assert.deepEqual(fs.readFileSync(recoveryFile(login)), unresolvedBytes);
  await login.fiber.dispose(); running.delete(login);
  const restoredHost = await open(loginRows, unresolvedRoot);
  const restoredAgent = { id: SessionId("restored-oauth-owner"), session: restoredHost.sessions.create(SessionId("restored-oauth-owner")) };
  assert.match((await restoredHost.commands.execute(restoredAgent, "/rental status", [], new AbortController().signal)).result.text, /可能已经签发授权/);
  assert.equal((await restoredHost.commands.execute(restoredAgent, "/rental login", [], new AbortController().signal)).result.kind, "error");
  assert.equal(wire.length, beforeReloadLogin, "a fresh Loader and Session reading the same durable store remain blocked");
  assert.deepEqual(fs.readFileSync(recoveryFile(restoredHost)), unresolvedBytes);
  assert.doesNotMatch(unresolvedBytes.toString("utf8"), /synthetic-|token|client|subject|code|verifier|https/);
  await restoredHost.fiber.dispose(); running.delete(restoredHost);
  // Refresh uses a separate external authorization scenario and private profile,
  // not a new attempt to reconcile the unresolved grant above.
  login = await open(loginRows);
  loginAgent = { id: SessionId("refresh-owner"), session: login.sessions.create(SessionId("refresh-owner")) };
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
  const discoverStarted = Promise.withResolvers();
  const releaseDiscover = Promise.withResolvers();
  globalThis.fetch = async (input, init) => {
    deniedRequests++;
    if (deniedRequests === 1) {
      const response = await normalFetch(input, init);
      discoverStarted.resolve();
      await releaseDiscover.promise;
      return response;
    }
    return new Response(null, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  };
  const lateDiscover = loginInvoke("check");
  const lateOutcome = lateDiscover.then(value => value);
  try {
    await Promise.race([discoverStarted.promise, lateOutcome.then(result => assert.fail(`check completed before response barrier: ${JSON.stringify(result.result)}`))]);
    assert.equal((await loginInvoke("check")).result.kind, "error");
    releaseDiscover.resolve();
    assert.equal((await lateOutcome).result.kind, "error", "a late successful discovery cannot commit after another request invalidated the connection");
  } finally { releaseDiscover.resolve(); }
  assert.deepEqual(await rentalGuidance(loginAgent), [], "failed discovery withdraws guidance");
  assert.equal(deniedRequests, 2, "each concurrent request is sent once; 401 does not reauthorize or resend");
  assert.equal((await loginInvoke("check")).result.kind, "error");
  assert.equal(deniedRequests, 2, "invalidated token is not sent again");
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), oauthSettings.revocationEndpoint);
    assert.equal(new URLSearchParams(init.body).get("token"), "rotated-refresh");
    return new Response(null, { status: 200 });
  };
  assert.equal((await loginInvoke("disconnect")).result.kind, "success");
  Date.now = realNow;

  await t.test("request cancellation reaches the shared refresh without a late MCP dispatch", async () => {
    const previousLogin = login, previousAgent = loginAgent, previousFetch = globalThis.fetch;
    const started = Promise.withResolvers(), late = Promise.withResolvers(), drained = Promise.withResolvers();
    let refreshSignal, refreshCount = 0, mcpCount = 0, lateBodyCancelled = false;
    try {
      login = await open(loginRows);
      loginAgent = { id: SessionId("cancelled-refresh-owner"), session: login.sessions.create(SessionId("cancelled-refresh-owner")) };
      globalThis.fetch = normalFetch;
      assert.equal((await loginInvoke("login")).result.kind, "success");
      clock = realNow() + 61_000; Date.now = () => clock;
      globalThis.fetch = async (input, init) => {
        if (String(input) === oauthSettings.tokenEndpoint) {
          refreshCount++; refreshSignal = init.signal; started.resolve();
          const response = await late.promise; drained.resolve(); return response;
        }
        if (String(input) === configured[0].config.connection.resourceUrl) mcpCount++;
        return normalFetch(input, init);
      };
      const cancel = new AbortController();
      const check = login.commands.execute(loginAgent, "/rental check", [], cancel.signal);
      const outcome = check.then(value => value, error => error);
      await Promise.race([started.promise, outcome.then(() => assert.fail("check ended before refresh"))]);
      const other = loginInvoke("check");
      cancel.abort();
      const result = await outcome;
      assert.ok(result.name === "AbortError" || result.result?.kind === "error");
      assert.equal((await other).result.kind, "error");
      assert.equal(refreshSignal.aborted, true, "refresh inherits the initiating request cancellation, not only connection lifetime");
      assert.equal(refreshCount, 1); assert.equal(mcpCount, 0);
      late.resolve(new Response(new ReadableStream({ cancel() { lateBodyCancelled = true; } })));
      await drained.promise;
      // Yield only to the owned late-response cleanup, without a clock sleep.
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(lateBodyCancelled, true);
      assert.match((await loginInvoke("status")).result.text, /可能已经签发授权/);
      assert.equal((await loginInvoke("check")).result.kind, "error");
      assert.equal(refreshCount, 1); assert.equal(mcpCount, 0, "late refresh cannot send the cancelled or concurrent request");
      assert.equal(recoveryState(login), "unresolved");
      assert.doesNotMatch(JSON.stringify(loginAgent.session.snapshotEvents()), /synthetic-(?:access|refresh)|rotated-refresh/);
    } finally {
      late.resolve(new Response(null)); Date.now = realNow;
      await login.fiber.dispose(); running.delete(login);
      login = previousLogin; loginAgent = previousAgent; globalThis.fetch = previousFetch;
    }
  });

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
    const authorized = await authorizationHandle(new Request(authorizationUrl, { headers: { Cookie: "original-web-fixture" } }));
    assert.equal(authorized.status, 303);
    const callback = new URL(authorized.headers.get("location"));
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
  let changeToolsReply, holdToolsList;
  let holdPrompt;
  let resourcePublished = true, resourceVersion = "resource-v1", resourceText = "Released original reference, not approval or execution.";
  let resourceReads = 0, resourceLists = 0, holdResource, changeResourceReply;
  const resourceUri = "https://mcp.example.invalid/resources/original-reference";
  const readSchema = { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false };
  const readOutput = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  const readsEndpoint = syntheticEndpoint(async () => ({ subject: "synthetic-actor", clientId: oauthSettings.clientId, resource: configured[0].config.connection.resourceUrl,
    scopes: oauthSettings.scopes, expiresAt: Date.now() / 1000 + 60 }), { readTools: {
    tools: [{ name: "rental_catalog_search", description: "Synthetic mapping fixture only; not a production catalog reader or schema.", inputSchema: readSchema, outputSchema: readOutput,
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
  }, resources: {
    list: async () => { resourceLists++; return resourcePublished ? [
      { name: "original_reference", uri: resourceUri, version: resourceVersion, description: "Original released reference." },
      { name: "not_configured", uri: resourceUri + "/other", version: resourceVersion, description: "Not selected locally." },
    ] : []; },
    read: async (_auth, _descriptor, signal) => {
      resourceReads++;
      const held = holdResource;
      if (held) {
        signal.addEventListener("abort", () => held.stopped.resolve(), { once: true });
        if (signal.aborted) held.stopped.resolve();
        held.started.resolve(); await held.release.promise; held.settled.resolve();
      }
      return { text: resourceText, private: "synthetic-private-resource" };
    },
    authority: { withRead: async (_auth, _descriptor, consume) => consume() },
    accounting: { withRead: async (_auth, _descriptor, consume) => consume() },
    release: { project: async (_auth, _descriptor, value) => ({ version: resourceVersion, text: value.text }) },
  } });
  t.after(async () => { holdToolsList?.release.resolve(); holdPrompt?.release.resolve(); holdResource?.release.resolve(); await readsEndpoint.close(); });
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
      readTools: ["rental_catalog_search"], readPrompts: ["synthetic_optional_prompt"], readResources: ["original_reference"] } },
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
  const publicName = "mcp__rental_os__rental_catalog_search";
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
    if (changeResourceReply && request.method === "POST" && ["resources/list", "resources/read"].includes(JSON.parse(init.body).method)) {
      const reply = await response.json();
      changeResourceReply(reply.result, JSON.parse(init.body).method);
      return Response.json(reply);
    }
    if (holdToolsList && request.method === "POST" && JSON.parse(init.body).method === "tools/list") {
      const held = holdToolsList; held.started.resolve(); await held.release.promise;
    }
    if (changeToolsReply && request.method === "POST" && JSON.parse(init.body).method === "tools/list") {
      const reply = await response.json();
      changeToolsReply(reply.result);
      return Response.json(reply);
    }
    return response;
  };
  const publicationCopy = {
    zh: "Rental OAuth 和 MCP 握手已完成，但最近一次完整同步没有找到配置内可注册的只读工具；本插件未启用任何 Rental 业务工具。请在可信 Rental 页面核对已发布能力与授权，变更后用 /rental check 同步，不要通过重复登录判断业务就绪",
    en: "Rental OAuth and the MCP handshake succeeded, but the last complete synchronization found no configured read tool to register. No Rental business tool is enabled by this plugin. Check published capabilities and authorization in trusted Rental pages; after they change, use /rental check to synchronize, not repeated login to establish business readiness.",
  };
  const bridgeLogin = await human("login");
  assert.equal(bridgeLogin.result.kind, "success");
  assert.match(bridgeLogin.result.text, /最近一次完整同步已在本地注册配置内/);
  assert.match(bridgeLogin.result.text, /这不证明当前业务访问权/);
  assert.deepEqual(bridge.tools.schemas(owner).map(tool => tool.name), [publicName]);
  assert.deepEqual(bridge.tools.schemas(stranger), []);
  const { LlmAdapter, createUserMessage, createSystemMessage, markAgentLoopRequest } = await import(pathToFileURL(cli.resolve("@deepseek-ai/dsh-llm")).href);
  let modelDispatches = 0, lastModelOptions;
  bridge.llm.registerAdapter(["synthetic-model-provider"], new class extends LlmAdapter {
    async *stream(options) { lastModelOptions = options; modelDispatches++; yield { type: "finish", reason: { kind: "stop" } }; }
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
  await t.test("Rental file occurrences are bounded after original Host handle projection", async () => {
    const { projectFilesToText } = await import(pathToFileURL(cli.resolve("@deepseek-ai/dsh-llm")).href);
    const { admitModelMaterial } = await import(stagedUrl + "dist/model-material.js");
    const attachment = { attachmentId: `sha256:${"ab".repeat(32)}`, name: '账目\n".txt', bytes: 3 };
    const fileBlock = { type: "file", attachment };
    const handle = bridge.llm.fileRequestText(attachment);
    assert.match(handle, /current execution environment cannot access a readable path/);
    const fileRequest = { ...boundedRequest, messages: [createUserMessage({ source: { kind: "user" }, content: [fileBlock] })] };
    // This real profile has no attachment path provider. The public Host projection
    // is the oracle; even inaccessible handles contribute text for each occurrence.
    const project = options => ({ ...options, messages: projectFilesToText(options.messages, () => undefined) });
    const extraBytes = neutralBytes({ type: "text", text: handle }) + 1;
    const count = Math.floor((262144 - neutralBytes(project(fileRequest))) / extraBytes) + 2;
    const repeated = { ...fileRequest, messages: [{ ...fileRequest.messages[0], content: Array.from({ length: count }, () => fileBlock) }] };
    const before = modelDispatches, inputBefore = structuredClone(repeated), logBefore = JSON.stringify(owner.session.snapshotEvents());
    assert.ok(neutralBytes(repeated) < 262144);
    assert.ok(neutralBytes(project(repeated)) > 262144);
    await assert.rejects(() => bridge.agents.withInitiator(owner, () => collectModel(repeated)), { code: "RENTAL_MATERIAL_UNAVAILABLE" });
    assert.equal(modelDispatches, before, "raw small references cannot reach the adapter with oversized handles");
    assert.deepEqual(repeated, inputBefore);
    assert.equal(JSON.stringify(owner.session.snapshotEvents()), logBefore, "accounting does not inject projected text into the log");

    const exact = { ...fileRequest, messages: [{ ...fileRequest.messages[0], content: [fileBlock, fileBlock] }], system: "界" };
    exact.system += "x".repeat(262144 - neutralBytes(project(exact)));
    assert.equal(neutralBytes(project(exact)), 262144);
    assert.ok(neutralBytes(exact) < 262144);
    const exactBefore = structuredClone(exact);
    await bridge.agents.withInitiator(owner, () => collectModel(exact));
    assert.equal(modelDispatches, before + 1);
    assert.deepEqual(lastModelOptions.messages[0].content, [{ type: "text", text: handle }, { type: "text", text: handle }]);
    assert.deepEqual(exact, exactBefore);
    await assert.rejects(() => collectModel({ ...exact, system: exact.system + "x" }), { code: "RENTAL_MATERIAL_UNAVAILABLE" });
    await assert.rejects(() => collectModel({ ...exact, system: exact.system + "界" }), { code: "RENTAL_MATERIAL_UNAVAILABLE" });
    assert.equal(modelDispatches, before + 1);

    let resolutions = 0;
    const oversizedOriginal = { ...fileRequest, messages: [{ ...fileRequest.messages[0], content: [{ type: "file", attachment: { ...attachment, name: "x".repeat(262144) } }] }] };
    assert.throws(() => admitModelMaterial(oversizedOriginal, "bounded rejection", () => { resolutions++; return "small"; }), { code: "RENTAL_MATERIAL_UNAVAILABLE" });
    assert.equal(resolutions, 0, "a smaller projection cannot bypass the original full request bound");
    assert.throws(() => admitModelMaterial(fileRequest, "bounded rejection", () => { throw new Error("private-resolver-detail"); }), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE" && !error.message.includes("private-resolver-detail"));
    await bridge.agents.withInitiator(stranger, () => collectModel({ ...repeated, tools: [] }));
    assert.equal(modelDispatches, before + 2, "unrelated personal requests retain the Host's file projection behavior");
  });
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
  const emptyCheck = await human("check");
  assert.equal(emptyCheck.result.kind, "success");
  assert.equal(emptyCheck.result.text.split("\n\n")[0], publicationCopy.zh);
  assert.equal(bridge.tools.get(publicName, owner), undefined);
  const beforeEmptyStatus = { requests: resourceRequests, reads: actualReads, models: modelDispatches };
  const emptyStatus = await human("status");
  assert.equal(emptyStatus.result.text, emptyCheck.result.text);
  assert.ok(owner.session.snapshotEvents().some(event => event.type === "command/done" && event.data.text === emptyStatus.result.text));
  assert.deepEqual({ requests: resourceRequests, reads: actualReads, models: modelDispatches }, beforeEmptyStatus, "local status does not discover, read or dispatch a model");
  publishedRead = true;
  // The endpoint captures fixed definitions. Change only this owned wire reply
  // to exercise a Host-incompatible future publication, not the old source object.
  changeToolsReply = result => { result.tools[0].inputSchema.properties.query.minLength = 1; };
  assert.equal((await human("check")).result.kind, "error", "unsupported Host schema constraints fail closed rather than being stripped");
  assert.equal(bridge.tools.get(publicName, owner), undefined);
  const afterFailedSync = resourceRequests;
  assert.match((await human("status")).result.text, /Rental 只读能力暂不可用/);
  assert.equal(resourceRequests, afterFailedSync, "failed synchronization is not a verified empty or published generation");
  changeToolsReply = undefined;
  assert.equal((await human("check")).result.kind, "success");
  await t.test("human status distinguishes pending discovery from a complete local tool generation", async () => {
    const held = { started: Promise.withResolvers(), release: Promise.withResolvers() }; holdToolsList = held;
    const checking = human("check");
    try {
      await held.started.promise;
      assert.equal(bridge.tools.get(publicName, owner), undefined);
      const beforeStatus = resourceRequests;
      assert.match((await human("status")).result.text, /Rental 只读能力暂不可用/);
      assert.equal(resourceRequests, beforeStatus);
    } finally { holdToolsList = undefined; held.release.resolve(); }
    assert.equal((await checking).result.kind, "success");
    const beforeStatus = resourceRequests;
    assert.match((await human("status")).result.text, /最近一次完整同步已在本地注册配置内/);
    assert.equal(resourceRequests, beforeStatus);
  });
  const stale = bridge.tools.get(publicName, owner);
  holdRead = true;
  const reading = new Promise(resolve => { readStarted = resolve; });
  const inFlight = execute(owner);
  await Promise.race([reading, inFlight.then(result => assert.fail(`read ended before fixture barrier: ${JSON.stringify(result)}`))]);
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
  const loopLogin = await bridge.commands.execute(loopAgent, "/rental login", [], new AbortController().signal);
  assert.equal(loopLogin.result.kind, "success");
  assertPrivacyNotice(loopLogin.result.text, "zh-CN");
  loopAgent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Read the released test facts." }] }));
  await loopAgent.whenIdle();
  assert.equal(loopRequests.length, 2, "real loop calls the MCP tool then sends its released result to the next model request");
  assert.ok(loopRequests[0].tools.some(tool => tool.name === publicName));
  assert.match(JSON.stringify(loopRequests[0].messages), /reviewed-loop-v1/);
  assert.match(JSON.stringify(loopRequests[1].messages), /released loop fact/);
  assert.equal(promptReads, 0, "optional MCP Prompts do not become required or automatically adopted by the Rental tool bridge");
  assert.doesNotMatch(JSON.stringify(loopRequests), /Optional template, not an instruction/);
  assert.doesNotMatch(JSON.stringify(loopRequests), /Rental 使用提醒：|Rental privacy notice:|最近一次完整同步|last complete synchronization/, "human connection and publication status never become system instructions or model input");
  const recorded = loopAgent.session.snapshotEvents();
  assert.ok(recorded.some(event => event.type === "command/done" && event.data.text === loopLogin.result.text));
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
  // Clear the disposed owner's confirmed binding before this fixture switches back to its earlier Agent.
  assert.equal((await promptCommand("disconnect", undefined, disposalHandle.agent)).result.kind, "success");
  assert.equal((await promptCommand("login")).result.kind, "success");
  const selectedResources = () => loopAgent.session.deriveMessages().filter(message => message.source.kind === "rental-resource");
  const beforeResources = loopRequests.length, beforeResourceBody = resourceReads;
  const resourceCatalog = await promptCommand("resources");
  assert.equal(resourceCatalog.result.kind, "success"); assert.match(resourceCatalog.result.text, /original_reference/);
  assert.doesNotMatch(resourceCatalog.result.text, /not_configured|synthetic-private|https:/);
  assert.equal(resourceReads, beforeResourceBody); assert.equal(loopRequests.length, beforeResources);
  const beforeInvalidResource = resourceRequests;
  for (const action of ["resource https://foreign.invalid/private", "resource not_configured", "resource original_reference extra"]) {
    assert.equal((await promptCommand(action)).result.kind, "error");
  }
  assert.equal((await promptCommand("resource original_reference", undefined, stranger)).result.kind, "error");
  assert.equal((await promptCommand("resource original_reference", undefined, sameSessionStranger)).result.kind, "error");
  assert.equal(resourceRequests, beforeInvalidResource);
  assert.equal((await promptCommand("resource original_reference")).result.kind, "success"); await loopAgent.whenIdle();
  assert.equal(resourceReads, beforeResourceBody + 1); assert.equal(loopRequests.length, beforeResources + 1);
  assert.deepEqual(selectedResources()[0].source, { kind: "rental-resource", name: "original_reference", version: "resource-v1", uri: resourceUri, form: "relay" });
  assert.equal(selectedResources()[0].content[0].text, `Rental OS resource (resource-v1)\n${resourceText}`);
  assert.doesNotMatch(JSON.stringify(loopRequests.at(-1)), /synthetic-private-resource|synthetic-access|synthetic-refresh/);
  const resourceEvents = loopAgent.session.snapshotEvents();
  const resourcesRestored = Session.create(loopAgent.session.id, JSON.parse(JSON.stringify(resourceEvents)), loopAgent.session.header);
  assert.deepEqual(resourcesRestored.deriveMessages(), loopAgent.session.deriveMessages());
  const resourceOnly = { ...personalRequest, messages: [selectedResources()[0]], system: "界".repeat(90000) };
  await assert.rejects(() => collectModel(resourceOnly), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  resourcePublished = false; assert.equal((await promptCommand("resource original_reference")).result.kind, "error"); resourcePublished = true;
  const afterResourceCount = selectedResources().length, afterResourceModel = loopRequests.length;
  for (const rewrite of [
    (result, method) => { if (method === "resources/read") result.contents[0].uri = resourceUri + "/wrong"; },
    (result, method) => { if (method === "resources/read") result.contents[0].mimeType = "text/html"; },
    (result, method) => { if (method === "resources/read") { delete result.contents[0].text; result.contents[0].blob = "cHJpdmF0ZQ=="; } },
    (result, method) => { if (method === "resources/read") result.contents[0].text = "Rental OS resource (resource-v1)\n" + "x".repeat(2000); },
    (result, method) => { if (method === "resources/read") result.contents.push({ ...result.contents[0] }); },
    (result, method) => { if (method === "resources/read") result.contents[0].text = "Rental OS resource (different-version)\nprivate body"; },
    (result, method) => { if (method === "resources/list") result.resources[0].uri = "https://foreign.invalid/private"; },
    (result, method) => { if (method === "resources/list") result.nextCursor = "unexpected"; },
  ]) {
    changeResourceReply = rewrite;
    assert.equal((await promptCommand("resource original_reference")).result.kind, "error");
    assert.equal(selectedResources().length, afterResourceCount); assert.equal(loopRequests.length, afterResourceModel);
  }
  changeResourceReply = undefined;
  const resourceMaintenanceStarted = Promise.withResolvers(), resourceMaintenanceRelease = Promise.withResolvers();
  const resourceMaintenance = loopAgent.runMaintenance(async () => { resourceMaintenanceStarted.resolve(); await resourceMaintenanceRelease.promise; });
  await resourceMaintenanceStarted.promise;
  const beforeResourceBusy = resourceRequests;
  assert.equal((await promptCommand("resource original_reference")).result.kind, "error");
  assert.equal(resourceRequests, beforeResourceBusy, "busy resource selection never reads or queues");
  resourceMaintenanceRelease.resolve(); await resourceMaintenance;
  resourceVersion = "resource-v2";
  assert.equal((await promptCommand("resource original_reference")).result.kind, "success"); await loopAgent.whenIdle();
  assert.equal(selectedResources().at(-1).source.version, "resource-v2");
  const currentResourceCount = selectedResources().length, currentResourceModel = loopRequests.length;
  function holdResourceRead() {
    holdResource = { started: Promise.withResolvers(), stopped: Promise.withResolvers(), release: Promise.withResolvers(), settled: Promise.withResolvers() };
    return holdResource;
  }
  async function releaseResourceRead(held) {
    await held.stopped.promise; held.release.resolve(); await held.settled.promise; holdResource = undefined;
    // Command cancellation can return before its original maintenance operation
    // drains. A new selection must not race that still-owned busy claim.
    await loopAgent.whenIdle();
  }
  holdResourceRead();
  const resourceAbort = new AbortController(), resourceSelection = promptCommand("resource original_reference", resourceAbort.signal);
  await holdResource.started.promise;
  assert.equal((await promptCommand("prompt synthetic_optional_prompt")).result.kind, "error", "templates and resources share one pending owner");
  const resourceCancelled = assert.rejects(resourceSelection, error => error.name === "AbortError"); resourceAbort.abort(); await resourceCancelled;
  await releaseResourceRead(holdResource);
  assert.equal(selectedResources().length, currentResourceCount); assert.equal(loopRequests.length, currentResourceModel);
  const disconnectedResource = holdResourceRead(), disconnectResourceSelection = promptCommand("resource original_reference");
  await disconnectedResource.started.promise;
  await promptCommand("disconnect");
  assert.equal((await disconnectResourceSelection).result.kind, "error"); await releaseResourceRead(disconnectedResource);
  assert.equal(selectedResources().length, currentResourceCount); assert.equal(loopRequests.length, currentResourceModel);
  assert.equal((await promptCommand("resource original_reference")).result.kind, "error");
  const beforeOversized = loopRequests.length;
  loopAgent.followup(createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "界".repeat(90000) }] }));
  await loopAgent.whenIdle();
  assert.equal(loopRequests.length, beforeOversized, "real loop rejection happens before the model adapter starts");
  const rejectedTurn = loopAgent.session.snapshotEvents().filter(event => event.type === "turn/end").at(-1);
  assert.equal(rejectedTurn.data.reason.kind, "error");
  assert.equal(rejectedTurn.data.reason.error.code, "RENTAL_MATERIAL_UNAVAILABLE");
  const rentalEntry = [...bridge.loader.entries()].find(entry => entry.options?.id === "rental-os");
  assert.ok(rentalEntry);
  assert.equal((await promptCommand("login")).result.kind, "success");
  const reloadedResource = holdResourceRead(), reloadResourceSelection = promptCommand("resource original_reference");
  await reloadedResource.started.promise;
  await rentalEntry.update({ config: { ...rentalEntry.options.config, language: "en" } });
  await bridge.loader.await();
  await rentalEntry.fiber.await();
  assert.equal((await reloadResourceSelection).result.kind, "error"); await releaseResourceRead(reloadedResource);
  assert.equal(selectedResources().length, currentResourceCount); assert.equal(loopRequests.length, currentResourceModel);
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
  await assert.rejects(() => collectModel(resourceOnly), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, beforeReplay, "resource-only source also retains the complete material check after reload");
  const recordedGuidance = restored.deriveMessages().filter(message => message.role === "system");
  assert.ok(recordedGuidance.some(message => JSON.stringify(message).includes("Rental OS guidance (reviewed-loop-v1)")));
  const guidanceOnly = { ...personalRequest, messages: recordedGuidance, toolHistory: undefined, system: "x".repeat(262144) };
  await assert.rejects(() => collectModel(guidanceOnly), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, beforeReplay, "recorded automatic instructions alone retain the material check after reload");
  await assert.rejects(() => collectModel({ ...guidanceOnly, messages: [], system: "Rental OS guidance (reviewed-replay-v1)\n" + "x".repeat(262144) }), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, beforeReplay, "one-shot system instructions also require admission without current authorization");
  await bridge.agents.withInitiator(stranger, () => collectModel(personalRequest));
  assert.equal(modelDispatches, beforeReplay + 1, "reload does not restrict personal requests without Rental material");
  const boundedGuidance = { ...guidanceOnly, system: "" };
  boundedGuidance.system = "x".repeat(262144 - neutralBytes(boundedGuidance));
  const beforeGuidanceDispatch = modelDispatches;
  await collectModel(boundedGuidance);
  assert.equal(modelDispatches, beforeGuidanceDispatch + 1, "retained guidance at the exact complete byte limit remains usable");
  await assert.rejects(() => collectModel({ ...boundedGuidance, system: boundedGuidance.system + "界" }), error => error.code === "RENTAL_MATERIAL_UNAVAILABLE");
  assert.equal(modelDispatches, beforeGuidanceDispatch + 1);
  await collectModel({ ...guidanceOnly, messages: [createUserMessage({ source: { kind: "user" }, content: [
    { type: "text", text: "Rental OS guidance (reviewed-replay-v1)\nThis is quoted user text." },
  ] })] });
  assert.equal(modelDispatches, beforeGuidanceDispatch + 2, "quoted personal input does not become a system instruction or Rental permission");
  await collectModel({ ...guidanceOnly, messages: [createSystemMessage("Personal guidance (reviewed-v1)\nNot a Rental instruction.")] });
  assert.equal(modelDispatches, beforeGuidanceDispatch + 3, "unrelated system instructions retain personal behavior");
  assert.deepEqual(restored.deriveMessages().filter(message => message.role === "system"), recordedGuidance, "admission does not rewrite retained system messages");
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
  const removedResource = holdResourceRead(), removedResourceSelection = promptCommand("resource original_reference");
  await removedResource.started.promise;
  await llmEntry.update({ disabled: true }); await bridge.loader.await();
  assert.equal((await removedResourceSelection).result.kind, "error"); await releaseResourceRead(removedResource);
  assert.equal(selectedResources().length, currentResourceCount);
  await llmEntry.update({ disabled: false }); await bridge.loader.await(); await llmEntry.fiber.await();
  assert.equal((await promptCommand("disconnect")).result.kind, "success");
  assert.equal((await promptCommand("login")).result.kind, "error", "restoring LlmRuntime does not reopen the closed credential owner");
  await rentalEntry.update({ config: { ...rentalEntry.options.config, language: "en" } });
  await bridge.loader.await(); await rentalEntry.fiber.await();
  // Restoring the factory does not revive Agents disposed with its model dependency.
  const restartedHandle = await bridge.agents.create({ sessionId: SessionId("resource-model-restored"), agentOptions: { provider: "synthetic-loop-model", model: "synthetic-model" } });
  t.after(() => restartedHandle.dispose());
  const restartedLogin = await promptCommand("login", undefined, restartedHandle.agent);
  assert.equal(restartedLogin.result.kind, "success");
  assert.match(restartedLogin.result.text, /last complete synchronization registered configured MCP reads locally/);
  publishedRead = false;
  const englishEmpty = await promptCommand("check", undefined, restartedHandle.agent);
  assert.equal(englishEmpty.result.kind, "success");
  assert.equal(englishEmpty.result.text.split("\n\n")[0], publicationCopy.en);
  const beforeEnglishStatus = { requests: resourceRequests, reads: actualReads, models: loopRequests.length };
  const englishPublicationStatus = await promptCommand("status", undefined, restartedHandle.agent);
  assert.equal(englishPublicationStatus.result.text, englishEmpty.result.text);
  assert.deepEqual({ requests: resourceRequests, reads: actualReads, models: loopRequests.length }, beforeEnglishStatus);
  publishedRead = true;
  assert.equal((await promptCommand("check", undefined, restartedHandle.agent)).result.kind, "success");
  const removalTemplate = holdTemplate();
  const removalSelection = promptCommand("prompt synthetic_optional_prompt", undefined, restartedHandle.agent);
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

  // Product lifecycle/SDK plus the real AS token service. Only original Web
  // consent/current grant and serializable persistence remain external fixtures.
  const persistentGrant = { id: "original-host-grant", subject: "original-host-subject", revision: 5,
    clientId: oauthSettings.clientId, resource: configured[0].config.connection.resourceUrl,
    scopes: oauthSettings.scopes, expiresAt: Math.floor(realNow() / 1000) + 3600 };
  let persistentState = { code: [], family: [], access: [], refresh: [] }, transactionTail = Promise.resolve();
  const persistentStore = { async transaction(consume) {
    const previous = transactionTail, done = Promise.withResolvers(); transactionTail = done.promise;
    await previous;
    const draft = structuredClone(persistentState);
    const find = (name, key, value) => draft[name].find(row => row[key] === value);
    const insert = (name, key, value) => { assert.equal(find(name, key, value[key]), undefined); draft[name].push(structuredClone(value)); };
    const tx = {
      readCode: async digest => find("code", "digest", digest),
      readCodeForAuthorization: async id => find("code", "authorizationId", id),
      insertCode: async value => { assert.equal(find("code", "authorizationId", value.authorizationId), undefined); insert("code", "digest", value); },
      readRefresh: async digest => find("refresh", "digest", digest),
      readAccess: async digest => find("access", "digest", digest),
      readFamily: async id => find("family", "id", id),
      insertFamily: async value => insert("family", "id", value),
      consumeCode: async (digest, familyId) => { const row = find("code", "digest", digest); assert.equal(row.consumedFamilyId, null); row.consumedFamilyId = familyId; },
      consumeRefresh: async digest => { const row = find("refresh", "digest", digest); assert.equal(row.used, false); row.used = true; },
      insertAccess: async value => insert("access", "digest", value),
      insertRefresh: async value => insert("refresh", "digest", value),
      revokeFamily: async id => { find("family", "id", id).revoked = true; },
    };
    try { const value = await consume(tx); persistentState = draft; return value; }
    finally { done.resolve(); }
  } };
  const registration = { read: async () => tokenRegistration };
  let originalConsent;
  const persistentResource = transportSource("service").createRentalMcpService({ enabled: true,
    resource: { resourceUrl: persistentGrant.resource, authorizationServerUrl: asMetadata.issuer,
      allowedOrigins: [], maxRequestBytes: 4096, authorizationTimeoutMs: 1000 },
    authorization: { issuer: asMetadata.issuer, authorizationEndpoint: oauthSettings.authorizationEndpoint,
      tokenEndpoint: oauthSettings.tokenEndpoint, revocationEndpoint: oauthSettings.revocationEndpoint,
      allowedScopes: oauthSettings.scopes, allowedOrigins: [], timeoutMs: 1000, maxMetadataBytes: 4096 },
    tokens: { tokenEndpoint: oauthSettings.tokenEndpoint, revocationEndpoint: oauthSettings.revocationEndpoint,
      resourceUrl: persistentGrant.resource, allowedScopes: oauthSettings.scopes, allowedOrigins: [], timeoutMs: 1000, maxRequestBytes: 32768 },
    lifetimes: { codeTtlSeconds: 60, accessTtlSeconds: 60, refreshTtlSeconds: 600 },
  }, { store: persistentStore, registrations: registration, metadata: { read: async () => asMetadata },
    consent: { current: async () => originalConsent },
    issuance: {
      current: async (grantId, clientId, revision) => grantId === persistentGrant.id && clientId === oauthSettings.clientId && revision === 1 ? persistentGrant : undefined,
      revocationOwner: async (grantId, clientId) => grantId === persistentGrant.id && clientId === oauthSettings.clientId,
    }, access: { current: async () => persistentGrant } });
  t.after(() => persistentResource.close());
  browserModule.setOpen(async target => {
    const url = new URL(target), server = httpModule.listeners.at(-1);
    callbackHandler = (req, res) => server.emit("request", req, res);
    const browserRequest = new Request(url);
    const selected = await transportSource("public-client-authorization").createPublicClientAuthorization({
      authorizationEndpoint: oauthSettings.authorizationEndpoint, resourceUrl: persistentGrant.resource,
      allowedScopes: oauthSettings.scopes, timeoutMs: 1000 }, registration)(browserRequest, new AbortController().signal);
    // Original authenticated Web consent is the external boundary, never model input.
    originalConsent = { kind: "approved", id: "original-host-consent", revision: 1,
      expiresAt: Math.floor(realNow() / 1000) + 60, request: selected, grant: persistentGrant };
    const authorized = await persistentResource.fetch(browserRequest);
    assert.equal(authorized.status, 303);
    assert.equal(deliverCallback(authorized.headers.get("location")), 204);
  });
  let observedAccess;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.headers.has("authorization")) observedAccess = request.headers.get("authorization").slice("Bearer ".length);
    return persistentResource.fetch(request);
  };
  const persistentHost = await open([{ id: "rental-os", config: { ...configured[0].config, oauth: oauthSettings,
    login: { enabled: true, attemptTimeoutMs: 2000, sessionLifetimeMs: 120000, maxAccessTtlSeconds: 300, callbackMode: "loopback" } } }]);
  const persistentAgent = { id: SessionId("persistent-oauth-owner"), session: persistentHost.sessions.create(SessionId("persistent-oauth-owner")) };
  const persistentLogin = await persistentHost.commands.execute(persistentAgent, "/rental login", [], new AbortController().signal);
  assert.equal(persistentLogin.result.kind, "success", persistentLogin.result.text);
  assert.match(observedAccess, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(persistentState.family.length, 1);
  assert.equal(persistentState.access.length, 1);
  assert.equal(persistentState.refresh.length, 1);
  assert.ok(!JSON.stringify(persistentState).includes(observedAccess));
  assert.ok(!JSON.stringify(persistentAgent.session.snapshotEvents()).includes(observedAccess));
  const persistentDisconnect = await persistentHost.commands.execute(persistentAgent, "/rental disconnect", [], new AbortController().signal);
  assert.equal(persistentDisconnect.result.kind, "success", persistentDisconnect.result.text);
  assert.equal(persistentState.family[0].revoked, true);
  const revokedAccess = await persistentResource.fetch(new Request(persistentGrant.resource, { method: "POST",
    headers: { Authorization: `Bearer ${observedAccess}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) }));
  assert.equal(revokedAccess.status, 401);
  await persistentHost.fiber.dispose(); running.delete(persistentHost);
  await persistentResource.close();

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
    ...[ ["duplicate", "duplicate"], ["invalid/name"], ["x".repeat(65)], Array.from({ length: 51 }, (_, index) => `resource_${index}`), ["without_login"] ]
      .map(readResources => ({ ...configured[0].config, readResources })),
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

  await t.test("startup-only Bundle selection takes effect on the next profile boot without deleting personal data", async () => {
    // The archive is fixture-seeded, not installed. Manager operations below
    // only save Bundle selection; every boot reads that selection from disk.
    // Cordis 4.0.5 exports FiberState as a const enum in its public declarations;
    // its artifact has no runtime enum object. Keep the declared ACTIVE value exact.
    const activeFiberState = 2;
    const home = fs.mkdtempSync(path.join(output, "startup-only-home-"));
    const installAnchor = path.join(home, "package.json");
    writeJson(installAnchor, { name: "offline-installation", private: true, dependencies: {} });
    const personalFile = path.join(home, "personal-notes.txt");
    fs.writeFileSync(personalFile, "Personal file retained across Rental Bundle selection.\n", { flag: "wx" });
    const personalBytes = fs.readFileSync(personalFile);
    const personalPlugin = path.join(home, "personal-command.mjs");
    fs.writeFileSync(personalPlugin, `export const name = 'personal-command', inject = ['commands'];
export function apply(ctx) {
  ctx.effect(() => ctx.commands.register({ name: 'personal', description: 'Offline personal command',
    handler: ({ rawInput }) => ({ kind: 'success', text: rawInput.trim() }) }));
}
`, { flag: "wx" });
    const profileManifestPath = path.join(profile, "package.json");
    const originalManifest = fs.readFileSync(profileManifestPath);
    const originalConfig = fs.readFileSync(configFile);
    const previousFetch = globalThis.fetch;
    let automaticHttp = 0, browserOpens = 0;
    const listenerCount = httpModule.listeners.length;
    const savedDependency = `file:${bundle.tarball}`;
    const lifecycleConfig = [
      { id: "session", name: pathToFileURL(cli.resolve("@deepseek-ai/dsh-session")).href },
      { id: "commands", name: pathToFileURL(publicResolve("@deepseek-ai/dsh-commands")).href },
      { id: "manager", name: pathToFileURL(cli.resolve("@deepseek-ai/dsh-plugin-manager")).href },
      { id: "personal", name: pathToFileURL(personalPlugin).href },
    ];
    let configBytes;
    const packageBytes = new Map(expectedFiles.map(name => [name, fs.readFileSync(path.join(staged, name))]));
    const hosts = new Set();
    async function startProfile() {
      const loaded = boot.loadProfileDirectory("offline-rental", profile, installAnchor);
      assert.deepEqual(loaded.skippedBundles, []);
      const profileContext = { name: "offline-rental", dir: profile,
        patchPath: path.join(profile, "cordis.patch.yml"), installAnchor, cwd: home, home,
        startedBundles: loaded.layers.map(row => row.packageName), overlays: [], telemetryDisabledEnv: undefined };
      const host = await boot.boot("offline-rental", configFile,
        boot.readProfilePatches("offline-rental", profileContext, loaded), context => {
          hosts.add(context); running.add(context);
          context.provide("profileContext", profileContext);
        });
      assert.ok(host.get("pluginManager"), "original Manager activated through the Loader");
      assert.equal(host.get("hmr"), undefined);
      return host;
    }
    async function stopProfile(host) {
      const commands = host.commands;
      await host.fiber.dispose();
      hosts.delete(host); running.delete(host);
      assert.deepEqual(commands.list({ id: SessionId("startup-personal") }), [], "disposed registries retain no commands");
    }
    function assertFilesRetained(historyFile, historyBytes) {
      assert.deepEqual(fs.readFileSync(personalFile), personalBytes);
      assert.deepEqual(fs.readFileSync(historyFile), historyBytes);
      assert.deepEqual(fs.readFileSync(configFile), configBytes);
      assert.deepEqual(fs.readFileSync(bundle.tarball), archive);
      for (const [name, bytes] of packageBytes) assert.deepEqual(fs.readFileSync(path.join(staged, name)), bytes);
      assert.equal(JSON.parse(fs.readFileSync(profileManifestPath, "utf8")).dependencies[manifest.name], savedDependency);
    }
    try {
      globalThis.fetch = async () => { automaticHttp++; throw new Error("unexpected lifecycle HTTP"); };
      browserModule.setOpen(() => { browserOpens++; throw new Error("unexpected lifecycle browser launch"); });
      writeJson(profileManifestPath, { name: "rental-loader-fixture", private: true,
        dependencies: { [manifest.name]: savedDependency }, dsh: { profile: { bundles: [manifest.name] } } });
      writeJson(configFile, lifecycleConfig);
      configBytes = fs.readFileSync(configFile);
      const first = await startProfile();
      const personalId = SessionId("startup-personal");
      const personalSession = first.sessions.create(personalId);
      personalSession.append("user/message", createUserMessage({ source: { kind: "user" },
        content: [{ type: "text", text: "Keep my personal conversation." }] }), { surfaceOp: "append" });
      const personalAgent = { id: personalId, session: personalSession };
      const personalCommand = host => host.commands.execute(personalAgent, "/personal still available", [], new AbortController().signal);
      assert.equal((await personalCommand(first)).result.text, "still available");
      assert.equal(first.commands.list(personalAgent).filter(row => row.name === "rental").length, 1);
      const rentalEntry = [...first.loader.entries()].find(row => row.options?.id === "rental-os");
      const rentalHandler = first.commands.find(personalAgent, "rental").handler;
      assert.ok(rentalEntry?.fiber);
      assert.equal(rentalEntry.fiber.state, activeFiberState);
      // This snapshot is a test-owned disk copy of the original Session log,
      // not evidence that the user's persistence plugin has been installed.
      const historyFile = path.join(home, "personal-history.json");
      writeJson(historyFile, { id: personalSession.id, header: personalSession.header, events: personalSession.snapshotEvents() });
      const historyBytes = fs.readFileSync(historyFile);
      const messages = personalSession.deriveMessages();
      const off = await first.pluginManager.setBundleEnabled(manifest.name, false);
      assert.equal(off.application, "restart-required");
      assert.equal(off.restartReason, "no-hmr");
      assert.equal(off.changed, true);
      assert.deepEqual(JSON.parse(fs.readFileSync(profileManifestPath, "utf8")).dsh.profile.bundles, []);
      assert.equal((await first.pluginManager.listBundles()).find(row => row.name === manifest.name).enabled, false);
      assert.equal(first.commands.find(personalAgent, "rental").handler, rentalHandler, "saved Off is not live disposal");
      assert.equal([...first.loader.entries()].find(row => row.options?.id === "rental-os"), rentalEntry);
      await rentalEntry.fiber.await();
      assert.equal(rentalEntry.fiber.state, activeFiberState, "startup-only Off leaves the old instance active");
      assertFilesRetained(historyFile, historyBytes);
      await stopProfile(first);

      const second = await startProfile();
      assert.equal(second.commands.find(personalAgent, "rental"), undefined);
      assert.equal([...second.loader.entries()].some(row => row.options?.id === "rental-os"), false);
      const stored = JSON.parse(fs.readFileSync(historyFile, "utf8"));
      personalAgent.session = Session.create(SessionId(stored.id), stored.events, stored.header);
      assert.deepEqual(personalAgent.session.deriveMessages(), messages);
      assert.equal((await personalCommand(second)).result.text, "still available");
      const on = await second.pluginManager.setBundleEnabled(manifest.name, true);
      assert.equal(on.application, "restart-required");
      assert.equal(on.restartReason, "no-hmr");
      assert.equal(on.changed, true);
      assert.deepEqual(JSON.parse(fs.readFileSync(profileManifestPath, "utf8")).dsh.profile.bundles, [manifest.name]);
      assert.equal(second.commands.find(personalAgent, "rental"), undefined, "saved On waits for a fresh boot too");
      assertFilesRetained(historyFile, historyBytes);
      await stopProfile(second);

      const third = await startProfile();
      assert.equal(third.commands.list(personalAgent).filter(row => row.name === "rental").length, 1);
      assert.equal([...third.loader.entries()].filter(row => row.options?.id === "rental-os").length, 1);
      const unchanged = await third.pluginManager.setBundleEnabled(manifest.name, true);
      assert.equal(unchanged.changed, false, "repeated enablement does not duplicate the persisted layer");
      assert.equal(third.commands.list(personalAgent).filter(row => row.name === "rental").length, 1);
      assert.deepEqual(personalAgent.session.deriveMessages(), messages);
      assert.equal((await personalCommand(third)).result.text, "still available");
      assertFilesRetained(historyFile, historyBytes);
      await stopProfile(third);
      assert.equal(automaticHttp, 0, "Bundle selection and startup do not replay HTTP or OAuth");
      assert.equal(browserOpens, 0);
      assert.equal(httpModule.listeners.length, listenerCount);
    } finally {
      try { for (const host of hosts) await stopProfile(host); }
      finally {
        fs.writeFileSync(profileManifestPath, originalManifest);
        fs.writeFileSync(configFile, originalConfig);
        globalThis.fetch = previousFetch;
        browserModule.setOpen(() => { throw new Error("unexpected browser launch"); });
      }
    }
  });
});
