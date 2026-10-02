"use strict";
const version = "ain-c01-c02-draft-1", time = "2026-10-03T00:00:00Z";
const scope = { kind: "workspace", tenantId: "tenant-test", workspaceId: "space-test" };
const access = { permissions: ["rental-os:order:view"], dataScope: "own", locationScope: { mode: "selected", locationIds: [] } };
const base = { contractVersion: version, requestId: "request-test", authorizedAt: time };
const contexts = [
  { ...base, audience: "operator", actor: { kind: "user", userId: "user-test" }, scope, access },
  { ...base, audience: "staff", actor: { kind: "user", userId: "staff-test" }, scope, access },
  { ...base, audience: "client", actor: { kind: "customer", customerId: "customer-test" }, scope },
  { ...base, audience: "operator", actor: { kind: "saas_admin", userId: "saas-test" }, scope: { kind: "platform" }, permissions: [] },
  { ...base, audience: "automation", actor: { kind: "automation", subjectId: "subject-test", policyId: "policy-test", policyRevision: 1, expiresAt: "2026-10-04T00:00:00Z" }, scope, access }
];
const request = { contractVersion: version, toolCode: "rental.order.explain", toolVersion: "draft-1", input: { orderId: "order-test" } };
const unknown = { code: "AI_RESULT_UNKNOWN", message: "Reconcile", retryable: false, nextAction: "reconcile", missingFields: [] };
const denied = { contractVersion: version, requestId: "request-test", status: "failed", error: { code: "AI_ACCESS_DENIED", message: "Unavailable", retryable: false, nextAction: "reauthorize", missingFields: [] } };
const fact = { scope, resourceType: "order", resourceId: "order-test", observedAt: time, basis: { kind: "snapshot", version: "snapshot-1" } };
const tool = { contractVersion: version, contractStatus: "draft", code: "rental.order.explain", version: "draft-1", description: "Synthetic read", aiMaturity: "unavailable", businessMaturity: "implemented", risk: "R0", audiences: ["operator"], scopeKinds: ["workspace"], permissionAnyOf: ["rental-os:order:view"], authorization: "revalidate_each_step_and_replay", additionalChecks: ["resource_ownership"], capabilityCodes: [], subscriptionFeatures: [], inputSchemaId: "AiOrderExplainInput", outputSchemaId: "pending-projection", preconditions: [], sideEffects: [], redactionRules: ["Minimal fields"], limits: { maxResults: 1, timeoutMs: 1000, maxAttempts: 1 }, idempotency: "read_only", retry: "no_retry", resultChecks: ["Read actual state"], manualExit: "Existing order page", ownerModule: "rental-core", blockers: ["AIN-04 pending"] };

/** Offline test utilities; no production authorization, transport or runtime logic. */
function blockNetwork(test) {
  const net = require("node:net"), dns = require("node:dns"), promises = require("node:dns/promises");
  const attempts = [], restores = [];
  const patch = (owner, key) => { const original = owner[key]; owner[key] = () => { attempts.push(key); throw new Error("Offline test attempted external access"); }; restores.push(() => { owner[key] = original; }); };
  patch(net.Socket.prototype, "connect"); patch(globalThis, "fetch");
  for (const key of ["lookup", "resolve", "resolve4", "resolve6"]) { patch(dns, key); patch(promises, key); }
  test.after(() => { restores.reverse().forEach(fn => fn()); require("node:assert/strict").deepEqual(attempts, []); });
}
function validatorsFor(leaf, baseSchemas) {
  const Ajv = require("ajv"), addFormats = require("ajv-formats");
  const ajv = new Ajv({ strict: true, allErrors: true }); addFormats(ajv);
  const convert = value => {
    if (Array.isArray(value)) return value.map(convert);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === "$ref" ? child.replace(/^#\/components\/schemas\//u, "urn:rental:consumer/") : convert(child)]));
  };
  for (const [name, schema] of Object.entries({ ...baseSchemas, ...leaf })) ajv.addSchema({ ...convert(schema), $id: `urn:rental:consumer/${name}` }, name);
  return Object.fromEntries(Object.keys(leaf).map(name => [name, ajv.getSchema(name)]));
}
function compileConsumer(source) {
  const ts = require("typescript"), path = require("node:path");
  const root = path.resolve(__dirname, "../../.."), file = path.join(root, "tests/__virtual_ai_consumer__.ts");
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, types: [] };
  const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  host.readFile = name => path.resolve(name) === file ? source : read(name);
  host.fileExists = name => path.resolve(name) === file || exists(name);
  return ts.getPreEmitDiagnostics(ts.createProgram([file], options, host)).map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") }));
}
function checkClosed(schema, available) {
  const assert = require("node:assert/strict");
  const walk = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") { assert.equal(node.additionalProperties, false); assert.ok(Array.isArray(node.required)); }
    if (node.type === "array") assert.ok(Number.isInteger(node.maxItems));
    if (node.$ref) assert.ok(Object.hasOwn(available, node.$ref.split("/").pop()));
    Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(walk) : walk(value));
  };
  Object.values(schema).forEach(walk);
}
module.exports = { version, time, scope, access, contexts, request, unknown, denied, fact, tool, blockNetwork, validatorsFor, compileConsumer, checkClosed };
