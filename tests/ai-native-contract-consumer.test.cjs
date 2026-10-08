"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const f = require("./fixtures/ai-native/contract-consumer.cjs"); f.blockNetwork(test);
const fs = require("node:fs"), path = require("node:path"), { createRequire } = require("node:module"), { execFileSync } = require("node:child_process"), ts = require("typescript"), vm = require("node:vm");
const root = path.resolve(__dirname, ".."), dependency = "96f8cbbd3a5cd43163f08226b9a9fa70fe9d3f74";
const apiRequire = createRequire(path.join(root, "apps/api/package.json"));
assert.ok(fs.realpathSync(apiRequire.resolve("@rental-os/shared")).startsWith(fs.realpathSync(path.join(root, "packages/shared")) + path.sep));
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const shared = require("../packages/shared/src/ai-native");
const { AI_NATIVE_COMPONENT_SCHEMAS: schemas } = require("../apps/api/src/contracts/ai-native-schemas");
const { OPENAPI_DOCUMENT } = require("../apps/api/src/contracts/openapi-document");
const validators = f.validatorsFor(schemas, {}), clone = x => structuredClone(x);
const valid = (name, value) => assert.equal(validators[name](value), true, JSON.stringify(validators[name].errors));
const invalid = (name, value) => assert.equal(validators[name](value), false, `${name} accepted ${JSON.stringify(value)}`);

test("scene, selection and approval applications publish closed contracts through the shared barrel", () => {
  const shared = require("../packages/shared/src/index");
  const { aiLeafToOpenApi30 } = require("../apps/api/src/contracts/ai-leaf-openapi");
  const leaves = [shared.AI_SCENE_REQUEST_DRAFT_SCHEMAS, shared.AI_QUOTE_SELECTION_DRAFT_SCHEMAS, shared.AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS];
  for (const leaf of leaves) {
    assert.ok(leaf);
    for (const [name, schema] of Object.entries(leaf)) assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], aiLeafToOpenApi30(schema, name));
  }
  const published = Object.assign({}, ...leaves), dependencies = { ...schemas, ...shared.AI_PROPOSAL_DRAFT_SCHEMAS };
  f.checkClosed(published, { ...dependencies, ...published });
  const validators = f.validatorsFor(published, dependencies);
  const original = { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: "original-request", sceneCode: "order_explanation", input: { orderId: "order-a", question: "status" } };
  assert.equal(validators.AiSceneRequestCreateDraft(original), true);
  assert.equal(validators.AiSceneRequestCreateDraft({ ...original, actor: "forged" }), false);
  const uuid = "00000000-0000-4000-8000-000000000001";
  const selection = { draftVersion: shared.AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: uuid, selectionId: uuid,
    selectionKey: "selected-quote", revision: 1, taskId: uuid, runId: uuid, quoteId: "quote-a", quoteHash: "a".repeat(64),
    inputHash: "b".repeat(64), expiresAt: f.time, state: "selected_not_approved", approval: "not_granted", order: "not_created_by_selection" };
  assert.equal(validators.AiQuoteSelectionReceiptDraft(selection), true);
  assert.equal(validators.AiQuoteSelectionReceiptDraft({ ...selection, approval: "granted" }), false);
  const unknown = { code: "result_unknown", retryable: false, nextAction: "read_decision_receipt" };
  assert.equal(validators.AiApprovalApplicationErrorDraft(unknown), true);
  assert.equal(validators.AiApprovalApplicationErrorDraft({ ...unknown, retryable: true }), false);
  assert.equal(validators.AiApprovalApplicationErrorDraft({ ...unknown, nextAction: "retry_later" }), false);
  assert.deepEqual(f.compileConsumer(`import type { AiSceneRequestCreateDraft, AiQuoteSelectionReceiptDraft, AiApprovalApplicationErrorDraft, AiInspectionTarget } from "../packages/shared/src/index";
const original: AiSceneRequestCreateDraft = ${JSON.stringify(original)};
const selection: AiQuoteSelectionReceiptDraft = ${JSON.stringify(selection)};
const unknown: AiApprovalApplicationErrorDraft = ${JSON.stringify(unknown)};
const target: AiInspectionTarget = { orderId: "order-a", allocationId: "allocation-a", templateId: "template-a", stage: "pickup" };
// @ts-expect-error human selection cannot grant approval
const approved: AiQuoteSelectionReceiptDraft = { ...selection, approval: "granted" };
// @ts-expect-error unknown approval cannot automatically retry
const retry: AiApprovalApplicationErrorDraft = { ...unknown, retryable: true };
`), []);
});

test("consumer preserves the submitted C01/C02 leaf sources in its own worktree", () => {
  // Pin this dependency, not the entire shared OpenAPI aggregator: later C04+ components
  // may be added. The next test still compares paths and every published C01/C02 schema.
  for (const file of ["packages/shared/src/ai-native.ts", "apps/api/src/contracts/ai-native-schemas.ts"]) {
    assert.equal(fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/gu, "\n"), execFileSync("git", ["show", `${dependency}:${file}`], { cwd: root, encoding: "utf8" }).replace(/\r\n/gu, "\n"));
  }
  assert.equal(shared.AI_CONTRACT_DRAFT_VERSION, f.version); assert.equal(shared.AI_TOOL_DRAFT_VERSION, "draft-1");
  f.checkClosed(schemas, schemas);
});
test("publication adds components but zero paths relative to pre-dependency OpenAPI", () => {
  const original = execFileSync("git", ["show", `${dependency}^:apps/api/src/contracts/openapi-document.ts`], { cwd: root, encoding: "utf8" });
  const code = ts.transpileModule(original, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {} }; vm.runInNewContext(code, context, { timeout: 1000 });
  assert.deepEqual(JSON.parse(JSON.stringify(OPENAPI_DOCUMENT.paths)), JSON.parse(JSON.stringify(context.exports.OPENAPI_DOCUMENT.paths)));
  const app = fs.readFileSync(path.join(root, "apps/api/src/app.module.ts"), "utf8"); assert.equal(app.includes("ModelGatewayModule"), false);
  for (const name of Object.keys(schemas)) assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], schemas[name]);
});
for (const context of f.contexts) test(`valid shape for ${context.actor.kind}/${context.audience}, not authentication`, () => valid("AiExecutionContext", context));
test("identity discriminants reject audience/actor/platform mismatches and extra authority", () => {
  for (const context of f.contexts) {
    invalid("AiExecutionContext", { ...context, audience: "root" });
    invalid("AiExecutionContext", { ...context, permanentAuthorization: true });
    invalid("AiExecutionContext", { ...context, contractVersion: "old-v0" });
  }
  invalid("AiExecutionContext", { ...f.contexts[0], audience: "client" });
  invalid("AiExecutionContext", { ...f.contexts[3], scope: f.scope });
  invalid("AiExecutionContext", { ...f.contexts[1], actor: f.contexts[3].actor });
  invalid("AiExecutionContext", { ...f.contexts[4], actor: f.contexts[0].actor });
});
test("empty selected remains deny-all metadata; all cannot contain selected IDs", () => {
  valid("AiLocationScope", f.access.locationScope); assert.deepEqual(f.access.locationScope.locationIds, []);
  valid("AiLocationScope", { mode: "all", locationIds: [] });
  invalid("AiLocationScope", { mode: "all", locationIds: ["location-test"] });
  invalid("AiLocationScope", { mode: "selected", locationIds: ["l", "l"] });
});
test("input and tool declarations reject identities, authority, unknown codes and versions", () => {
  valid("AiOrderExplainRequestDraft", f.request); valid("AiToolContractDraft", f.tool);
  for (const field of ["actor", "scope", "audience", "tenantId", "workspaceId", "apiKey", "sql", "url", "approved"]) {
    invalid("AiOrderExplainRequestDraft", { ...f.request, [field]: "forged" });
    invalid("AiOrderExplainRequestDraft", { ...f.request, input: { ...f.request.input, [field]: "forged" } });
  }
  for (const patch of [{ toolCode: "arbitrary.sql" }, { toolVersion: "v0" }, { contractVersion: "v0" }]) invalid("AiOrderExplainRequestDraft", { ...f.request, ...patch });
  for (const patch of [{ aiMaturity: "executable" }, { code: "unknown" }, { handler: "eval" }, { limits: { ...f.tool.limits, maxResults: 0 } }]) invalid("AiToolContractDraft", { ...f.tool, ...patch });
});
test("every error code is consumable and UNKNOWN forces reconciliation standalone and enveloped", () => {
  valid("AiToolFailure", f.denied);
  valid("AiToolFailure", { ...f.denied, error: { ...f.denied.error, code: "AI_SCOPE_CHANGED" } });
  for (const code of shared.AI_ERROR_CODES) valid("AiToolError", code === "AI_RESULT_UNKNOWN" ? f.unknown : { ...f.denied.error, code });
  const result = { contractVersion: f.version, requestId: "request-test", status: "unknown", error: f.unknown };
  valid("AiToolFailure", result);
  for (const patch of [{ retryable: true }, { nextAction: "none" }, { nextAction: "retry_later" }, { code: "unknown-code" }]) {
    invalid("AiToolError", { ...f.unknown, ...patch }); invalid("AiToolFailure", { ...result, error: { ...f.unknown, ...patch } });
  }
  invalid("AiToolFailure", { ...result, status: "failed" });
});
test("all fact branches express source absence/legacy without inventing snapshot evidence", () => {
  for (const basis of [{ kind: "snapshot", version: "v1" }, { kind: "current" }, { kind: "missing", reason: "source_unavailable" }, { kind: "missing", reason: "snapshot_missing" }, { kind: "legacy_current_fallback", reason: "snapshot_missing" }]) valid("AiFactReference", { ...f.fact, basis });
  for (const basis of [{ kind: "snapshot" }, { kind: "missing" }, { kind: "current", version: "old" }, { kind: "legacy_current_fallback", reason: "snapshot_missing", version: "old" }]) invalid("AiFactReference", { ...f.fact, basis });
  invalid("AiFactReference", { ...f.fact, downloadUrl: "https://untrusted.test" });
});
test("TypeScript consumers agree on every branch and reject incompatible union/required fields", () => {
  const assignments = f.contexts.map((value, i) => `const c${i}: AiExecutionContext = ${JSON.stringify(value)};`).join("\n");
  const source = `import type { AiExecutionContext, AiToolError, AiToolFailure, AiOrderExplainRequestDraft, AiFactReference, AiToolContractDraft } from "../packages/shared/src/ai-native";
${assignments}
const request: AiOrderExplainRequestDraft = ${JSON.stringify(f.request)};
const tool: AiToolContractDraft = ${JSON.stringify(f.tool)};
const fact: AiFactReference = ${JSON.stringify(f.fact)};
const failure: AiToolFailure = ${JSON.stringify(f.denied)};
const unknown: AiToolError = ${JSON.stringify(f.unknown)};
// @ts-expect-error wrong audience/actor
const bad: AiExecutionContext = { ...c0, audience: "client" };
// @ts-expect-error unknown outcome must not retry
const retry: AiToolError = { ...unknown, retryable: true };
// @ts-expect-error unknown outcome must reconcile
const skip: AiToolError = { ...unknown, nextAction: "manual" };
// @ts-expect-error unknown cannot use failed envelope
const wrong: AiToolFailure = { contractVersion: "${f.version}", requestId: "r", status: "failed", error: unknown };
// @ts-expect-error missing source version
const missing: AiFactReference = { ...fact, basis: { kind: "snapshot" } };
// @ts-expect-error drafts cannot execute
const enabled: AiToolContractDraft = { ...tool, aiMaturity: "executable" };
`;
  assert.deepEqual(f.compileConsumer(source), []);
  // No suppression: prove the compiler actually rejects a bad literal.
  assert.ok(f.compileConsumer('import type { AiToolError } from "../packages/shared/src/ai-native"; const x: AiToolError = { code: "AI_RESULT_UNKNOWN", message: "unknown", missingFields: [], retryable: true, nextAction: "reconcile" };').some(d => d.code === 2322));
});
test("KNOWN LIMIT: structurally valid identifiers or stale dates do not prove authorization", () => {
  valid("AiExecutionContext", { ...clone(f.contexts[0]), authorizedAt: "2000-01-01T00:00:00Z", scope: { ...f.scope, tenantId: "other-tenant" } });
  valid("AiToolError", { ...f.unknown, message: "Untrusted prose cannot grant permission" });
});
