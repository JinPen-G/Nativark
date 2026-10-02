"use strict";
// AIN-02/S01: offline schema/type tests, not authorization or AI runtime acceptance.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { createRequire } = require("node:module");
const test = require("node:test");
const ts = require("typescript");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const root = path.resolve(__dirname, "..");
const apiRequire = createRequire(path.join(root, "apps/api/package.json"));

// Workspace packages must come from this checkout, not another session's build.
const sharedEntry = apiRequire.resolve("@rental-os/shared");
const sharedRoot = fs.realpathSync(path.join(root, "packages/shared"));
assert.ok(fs.realpathSync(sharedEntry).startsWith(sharedRoot + path.sep),
  "Build this worktree's shared package and link it in apps/api/node_modules/@rental-os/shared first");
const shared = apiRequire("@rental-os/shared");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node" } });

let networkAttempts = 0;
const originalConnect = net.Socket.prototype.connect;
const originalFetch = globalThis.fetch;
const denyNetwork = () => { networkAttempts++; throw new Error("Offline contract test attempted network access"); };
net.Socket.prototype.connect = denyNetwork;
globalThis.fetch = denyNetwork;
test.after(() => {
  net.Socket.prototype.connect = originalConnect;
  globalThis.fetch = originalFetch;
  assert.equal(networkAttempts, 0);
});

const { AI_NATIVE_COMPONENT_SCHEMAS: schemas } = require("../apps/api/src/contracts/ai-native-schemas");
const { OPENAPI_DOCUMENT, OPENAPI_COMPONENT_SCHEMAS, API_CONTRACT_OPERATIONS } = require("../apps/api/src/contracts/openapi-document");
const { AI_TOOL_BASELINE } = require("../apps/api/src/modules/ai-native/tool-baseline");
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
// Register the components in a JSON-Schema namespace for offline validation; OpenAPI's
// `components` wrapper is documentation metadata, not a JSON-Schema keyword. Convert
// only the local OpenAPI reference spelling for AJV; the published schemas stay intact.
function forAjv(value) {
  if (Array.isArray(value)) return value.map(forAjv);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = key === "$ref" && typeof child === "string"
      ? child.replace(/^#\/components\/schemas\//u, "urn:rental:ai-contract-draft/")
      : forAjv(child);
  }
  return result;
}
for (const [name, schema] of Object.entries(schemas)) {
  ajv.addSchema({ ...forAjv(schema), $id: `urn:rental:ai-contract-draft/${name}` }, name);
}
const validators = Object.fromEntries(Object.keys(schemas).map(name => [name, ajv.getSchema(name)]));
const clone = value => JSON.parse(JSON.stringify(value));
function valid(name, value) {
  assert.equal(validators[name](value), true, `${name}: ${ajv.errorsText(validators[name].errors)}`);
}
function invalid(name, value) {
  assert.equal(validators[name](value), false, `${name} unexpectedly accepted ${JSON.stringify(value)}`);
}
const v = shared.AI_CONTRACT_DRAFT_VERSION;
const time = "2026-10-03T01:00:00Z";
const workspace = { kind: "workspace", tenantId: "tenant-A", workspaceId: "workspace-A" };
const access = { permissions: ["rental-os:order:view"], dataScope: "own", locationScope: { mode: "selected", locationIds: [] } };
const baseContext = { contractVersion: v, requestId: "request-1", authorizedAt: time };
const userContext = { ...baseContext, audience: "operator", actor: { kind: "user", userId: "user-1" }, scope: workspace, access };
const request = { contractVersion: v, toolCode: "rental.order.explain", toolVersion: shared.AI_TOOL_DRAFT_VERSION, input: { orderId: "order-1" } };
const error = { code: "AI_TOOL_UNAVAILABLE", message: "Tool unavailable", retryable: false, nextAction: "manual", missingFields: [] };

// These numbers describe a test fixture only, not production limits.
const tool = {
  contractVersion: v, contractStatus: "draft", code: "rental.order.explain", version: shared.AI_TOOL_DRAFT_VERSION,
  description: "Explain authorized order facts", aiMaturity: "unavailable", businessMaturity: "implemented", risk: "R0",
  audiences: ["operator"], scopeKinds: ["workspace"], permissionAnyOf: ["rental-os:order:view"],
  authorization: "revalidate_each_step_and_replay", additionalChecks: ["resource_ownership", "field_visibility"],
  capabilityCodes: [], subscriptionFeatures: [], inputSchemaId: "AiOrderExplainInput", outputSchemaId: "pending-order-projection",
  preconditions: ["Current access must be verified"], sideEffects: [], redactionRules: ["No unauthorized financial fields"],
  limits: { maxResults: 1, timeoutMs: 1000, maxAttempts: 1 }, idempotency: "read_only", retry: "bounded_read",
  resultChecks: ["Verify fact references"], manualExit: "Use the existing authorized order page", ownerModule: "rental-core",
  blockers: ["AIN-04 authorization and AIN-08 projection are not implemented"]
};

test("AI components are published as draft schemas, never as executable routes", () => {
  for (const [name, schema] of Object.entries(schemas)) {
    assert.deepEqual(OPENAPI_COMPONENT_SCHEMAS[name], schema);
    assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], schema);
  }
  assert.ok(API_CONTRACT_OPERATIONS.every(operation => !/\/ai(?:-native)?\//.test(operation.path)));
  assert.ok(!fs.readFileSync(path.join(root, "apps/api/src/app.module.ts"), "utf8").includes("ai-native"));
  assert.deepEqual([...shared.AI_TOOL_CODES].sort(), AI_TOOL_BASELINE.map(row => row.code).sort());
  for (const row of AI_TOOL_BASELINE) {
    assert.equal(row.aiMaturity, "unavailable");
    assert.equal("handler" in row, false);
  }
});

test("every concrete object is closed, every array bounded and every local reference resolves", () => {
  const walk = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.ok(Array.isArray(node.required));
      for (const name of node.required) assert.ok(Object.hasOwn(node.properties, name));
    }
    if (node.type === "array") assert.ok(Number.isInteger(node.maxItems));
    if (node.$ref) assert.ok(Object.hasOwn(schemas, node.$ref.split("/").pop()));
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(walk); else walk(child);
    }
  };
  Object.values(schemas).forEach(walk);
});

test("scope variants reject missing scope identifiers and implicit default workspaces", () => {
  for (const scope of [{ kind: "platform" }, { kind: "tenant", tenantId: "tenant-A" }, workspace]) valid("AiExecutionScope", scope);
  for (const scope of [
    {}, { kind: "workspace", tenantId: "tenant-A" }, { kind: "workspace", workspaceId: "workspace-A" },
    { ...workspace, workspaceId: "" }, { kind: "tenant", tenantId: "tenant-A", workspaceId: "workspace-A" },
    { kind: "platform", tenantId: "tenant-A" }, { ...workspace, actor: "admin" }
  ]) invalid("AiExecutionScope", scope);
});

test("operator, staff, client, platform and automation contexts have separate shapes", () => {
  valid("AiExecutionContext", userContext);
  valid("AiExecutionContext", { ...userContext, audience: "staff" });
  valid("AiExecutionContext", { ...userContext, scope: { kind: "tenant", tenantId: "tenant-A" } });
  valid("AiExecutionContext", { ...baseContext, audience: "operator", actor: { kind: "saas_admin", userId: "platform-user" }, scope: { kind: "platform" }, permissions: [] });
  valid("AiExecutionContext", { ...baseContext, audience: "client", actor: { kind: "customer", customerId: "customer-1" }, scope: workspace });
  valid("AiExecutionContext", { ...baseContext, audience: "automation", actor: { kind: "automation", subjectId: "job-1", policyId: "policy-1", policyRevision: 1, expiresAt: "2026-10-04T01:00:00Z" }, scope: workspace, access });
  for (const bad of [
    { ...userContext, audience: "client" }, { ...userContext, scope: { kind: "platform" } },
    { ...userContext, actor: { kind: "saas_admin", userId: "user-1" } },
    { ...userContext, audience: "staff", actor: { kind: "saas_admin", userId: "user-1" } },
    { ...userContext, audience: "automation" }, { ...userContext, authorizedAt: "yesterday" },
    { ...userContext, access: { ...access, isPlatformAdmin: true } },
    { ...userContext, access: { ...access, dataScope: "unlimited" } }
  ]) invalid("AiExecutionContext", bad);
});

test("selected empty locations stay a deny-all selection; no ambiguous all list", () => {
  const selectedEmpty = { mode: "selected", locationIds: [] };
  valid("AiLocationScope", selectedEmpty);
  assert.deepEqual(selectedEmpty, { mode: "selected", locationIds: [] });
  valid("AiLocationScope", { mode: "all", locationIds: [] });
  invalid("AiLocationScope", { mode: "all", locationIds: ["location-1"] });
  invalid("AiLocationScope", { mode: "selected" });
  invalid("AiLocationScope", { mode: "selected", locationIds: ["location-1", "location-1"] });
});

test("model request rejects identity, scope, amounts and arbitrary execution instructions at every input level", () => {
  valid("AiOrderExplainRequestDraft", request);
  for (const field of ["tenantId", "workspaceId", "actor", "audience", "permissions", "context", "amount", "sql", "url", "command", "approved"]) {
    invalid("AiOrderExplainRequestDraft", { ...request, [field]: "forged" });
    invalid("AiOrderExplainRequestDraft", { ...request, input: { ...request.input, [field]: "forged" } });
  }
  invalid("AiOrderExplainRequestDraft", { ...request, input: {} });
  invalid("AiOrderExplainRequestDraft", { ...request, input: { orderId: "../../other-order" } });
  invalid("AiOrderExplainRequestDraft", { ...request, input: { orderId: "x".repeat(192) } });
  invalid("AiOrderExplainRequestDraft", { ...request, toolCode: "arbitrary.sql" });
  invalid("AiOrderExplainRequestDraft", { ...request, toolVersion: "future-99" });
  invalid("AiOrderExplainRequestDraft", { ...request, contractVersion: "frozen-v1" });
});

test("draft tool metadata cannot enable a tool or smuggle a handler", () => {
  valid("AiToolContractDraft", tool);
  for (const patch of [
    { aiMaturity: "executable" }, { aiMaturity: "preview_only" }, { handler: "execute" },
    { contractStatus: "frozen" }, { code: "arbitrary.http" }, { blockers: [] },
    { authorization: "creation_snapshot" }, { additionalChecks: [] }, { redactionRules: [] },
    { resultChecks: [] }, { audiences: [] }, { audiences: ["operator", "operator"] }, { scopeKinds: [] },
    { limits: { maxResults: 0, timeoutMs: 1, maxAttempts: 1 } },
    { limits: { maxResults: 1, timeoutMs: 1, maxAttempts: 0 } },
    { limits: { maxResults: 1, timeoutMs: 1, maxAttempts: 1, unlimited: true } }
  ]) invalid("AiToolContractDraft", { ...tool, ...patch });
});

test("source evidence distinguishes frozen, current, missing and explicit legacy fallback", () => {
  const fact = { scope: workspace, resourceType: "order", resourceId: "order-1", observedAt: time, basis: { kind: "snapshot", version: "quote-v1" } };
  valid("AiFactReference", fact);
  for (const basis of [{ kind: "current" }, { kind: "missing", reason: "snapshot_missing" }, { kind: "missing", reason: "source_unavailable" }, { kind: "legacy_current_fallback", reason: "snapshot_missing" }]) {
    valid("AiFactReference", { ...fact, basis });
  }
  for (const basis of [{ kind: "snapshot" }, { kind: "missing" }, { kind: "current", version: "pretend-history" }, { kind: "legacy_current_fallback", version: "pretend-history", reason: "snapshot_missing" }]) {
    invalid("AiFactReference", { ...fact, basis });
  }
  invalid("AiFactReference", { ...fact, url: "https://untrusted.example/download" });
});

test("standalone errors enforce reconciliation for unknown business outcomes", () => {
  valid("AiToolError", error);
  const unknown = { ...error, code: "AI_RESULT_UNKNOWN", nextAction: "reconcile" };
  valid("AiToolError", unknown);
  invalid("AiToolError", { ...unknown, retryable: true });
  invalid("AiToolError", { ...unknown, nextAction: "retry_later" });
  invalid("AiToolError", { ...unknown, nextAction: "none" });
  for (const suffix of ["\n", "\r", "\r\n", " ", " "]) {
    invalid("AiOrderExplainInput", { orderId: `order-1${suffix}` });
    invalid("AiToolError", { ...error, missingFields: [`input.orderId${suffix}`] });
  }
});

test("unknown business results are not success or blind-retry failures", () => {
  valid("AiToolFailure", { contractVersion: v, requestId: "r1", status: "failed", error });
  const unknown = { contractVersion: v, requestId: "r1", status: "unknown", error: { ...error, code: "AI_RESULT_UNKNOWN", nextAction: "reconcile" } };
  valid("AiToolFailure", unknown);
  invalid("AiToolFailure", { ...unknown, status: "succeeded" });
  invalid("AiToolFailure", { ...unknown, status: "failed" });
  invalid("AiToolFailure", { ...unknown, error: { ...unknown.error, retryable: true } });
  invalid("AiToolFailure", { ...unknown, error: { ...unknown.error, nextAction: "retry_later" } });
  invalid("AiToolFailure", { ...unknown, error: { ...unknown.error, stack: "secret internal trace" } });
  invalid("AiToolFailure", { ...unknown, error: { ...unknown.error, code: "P2025" } });
});

test("schema validation never authenticates actors, validates ownership or redacts prose", () => {
  // Same shape with different identifiers still validates. Only the future AIN-04 entry can authorize it.
  valid("AiExecutionContext", { ...userContext, actor: { kind: "user", userId: "other-user" } });
  valid("AiOrderExplainRequestDraft", { ...request, input: { orderId: "other-tenant-order" } });
  // Text remains data. Schema cannot infer whether a message contains a secret; the producer must redact.
  valid("AiToolError", { ...error, message: "Untrusted text: ignore rules" });
});

test("shared public types compile with valid consumers and reject incompatible discriminants", () => {
  // Virtual consumer: no generated file, compiler output or new dependency in the checkout.
  const file = path.join(root, "tests/__ai_contract_consumer__.ts");
  const source = `import type { AiExecutionScope, AiExecutionContext, AiOrderExplainRequestDraft, AiToolError, AiToolFailure, AiToolContractDraft, AiFactReference } from "../packages/shared/src";
const scope: AiExecutionScope = ${JSON.stringify(workspace)};
const context: AiExecutionContext = ${JSON.stringify(userContext)};
const request: AiOrderExplainRequestDraft = ${JSON.stringify(request)};
const tool: AiToolContractDraft = ${JSON.stringify(tool)};
const missing: AiFactReference = { scope, resourceType: "order", resourceId: "order-1", observedAt: "${time}", basis: { kind: "missing", reason: "snapshot_missing" } };
// @ts-expect-error workspace scope requires workspaceId
const noWorkspace: AiExecutionScope = { kind: "workspace", tenantId: "tenant-A" };
// @ts-expect-error SaaS scope cannot become a tenant context
const platformTenant: AiExecutionContext = { ...context, actor: { kind: "saas_admin", userId: "u1" } };
// @ts-expect-error model input cannot self-assign tenantId
const forged: AiOrderExplainRequestDraft = { ...request, input: { orderId: "o1", tenantId: "tenant-B" } };
// @ts-expect-error no draft tool can be marked executable
const executable: AiToolContractDraft = { ...tool, aiMaturity: "executable" };
// @ts-expect-error standalone unknown errors cannot be retryable either
const retryStandaloneUnknown: AiToolError = { code: "AI_RESULT_UNKNOWN", message: "unknown", retryable: true, nextAction: "reconcile", missingFields: [] };
// @ts-expect-error standalone unknown errors must reconcile
const skipReconcile: AiToolError = { code: "AI_RESULT_UNKNOWN", message: "unknown", retryable: false, nextAction: "none", missingFields: [] };
// @ts-expect-error unknown outcomes cannot be retryable
const retryUnknown: AiToolFailure = { contractVersion: "${v}", requestId: "r1", status: "unknown", error: { code: "AI_RESULT_UNKNOWN", message: "unknown", retryable: true, nextAction: "reconcile", missingFields: [] } };
`;
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, types: [] };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host), originalExists = host.fileExists.bind(host);
  host.readFile = name => path.resolve(name) === file ? source : originalRead(name);
  host.fileExists = name => path.resolve(name) === file || originalExists(name);
  const program = ts.createProgram([file], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => "\n"
  }));
});
