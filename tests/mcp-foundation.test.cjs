"use strict";
/** Real official SDKs and new package sources; all HTTP stays in-process with synthetic identity evidence. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire, registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js"));
// Test-only resolution of this tree's existing, fixed SDK installation. Product
// sources use package exports, never this Harness path or copied node_modules.
const installed = createRequire(path.join(root, "clients/agent-desktop/harness/packages/mcp/mcp-client/package.json"));
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
  const order = [];
  let hold;
  const originals = source("apps/api/src/contracts/ai-native-schemas.ts").AI_NATIVE_COMPONENT_SCHEMAS;
  const originalSchemas = { AiOrderExplainRequestDraft: originals.AiOrderExplainRequestDraft, AiOrderExplainInput: originals.AiOrderExplainInput };
  const outputSchema = { type: "object", properties: { observation: {} }, required: ["observation"], additionalProperties: false };
  assert.throws(() => createRead({ name: "missing_schema", description: "No publication.", originalSchemas: {}, outputSchema, read: async () => current }), /schema reference unavailable/);
  const read = createRead({ name: "synthetic_original_model_result", description: "Read an existing authorized result; this does not start a model or grant approval.", originalSchemas, outputSchema,
    read: async (input, signal) => {
      assert.deepEqual(input, command);
      readCalls++; order.push("read");
      if (hold) { const held = hold; held.started.resolve(); await held.release.promise; held.settled.resolve(); }
      return structuredClone(current);
    } });
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
    'import { createConversationResultRead } from "@rental-os/mcp-server/conversation-result-read";',
    'import type { ConversationResultReadBinding } from "@rental-os/mcp-server/conversation-result-read";',
    'export const resultRead = (binding: ConversationResultReadBinding) => createConversationResultRead(binding);',
    'import type { ProtectedMcpConfig, ResourceTokenVerifier, VerifiedResourceToken, McpInstructionsProvider, McpPromptsProvider } from "@rental-os/mcp-server";',
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
  await verifyConversationRead(t, compiled.resultRead);
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
