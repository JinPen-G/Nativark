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

test("workbench display protocol keeps code inert and sandbox candidates distinct from trusted human actions", () => {
  const shared = require('@rental-os/shared'), { createHash } = require('node:crypto');
  const { inspectAiWorkbenchPresentation, inspectAiWorkbenchMessage } = require('../apps/api/src/modules/ai-native/workbench-display.contract');
  const { aiLeafToOpenApi30 } = require('../apps/api/src/contracts/ai-leaf-openapi');
  const { AI_WORKBENCH_DISPLAY_SCHEMAS: leaf, AI_WORKBENCH_DISPLAY_DRAFT_VERSION: version, AI_WORKBENCH_DISPLAY_LIMITS: limits } = shared;
  const deps = { AiSceneRequestReadDraft: shared.AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReadDraft,
    AiApprovalApplicationReferenceDraft: shared.AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS.AiApprovalApplicationReferenceDraft };
  f.checkClosed(leaf, { ...deps, ...leaf });
  const validators = f.validatorsFor(leaf, deps);
  for (const [name, schema] of Object.entries(leaf)) assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], aiLeafToOpenApi30(schema, name));
  const binding = { conversationId: 'conversation-a', turnId: 'turn-a', capabilityCode: 'order_explanation', capabilityVersion: '1',
    original: { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: '00000000-0000-4000-8000-000000000001' },
    taskId: 'task-a', inputFingerprint: 'a'.repeat(64), materialRevision: 1, materialHash: 'b'.repeat(64), presentationRevision: 1 };
  const source = '<main><script>globalThis.__workbenchMustStayInert = true; while(true){}</script></main>';
  const packet = { draftVersion: version, binding, code: { language: 'html', complete: true, source,
    sha256: createHash('sha256').update(source, 'utf8').digest('hex') },
    generation: { runId: 'run-a', stepId: 'step-a', resultId: 'result-a', resultHash: 'd'.repeat(64), promptVersion: '1', displayApiVersion: '1', isolationVersion: '1' },
    retention: { expiresAt: '2026-11-01T00:00:00Z', sourceExpiresAt: '2026-11-02T00:00:00Z', aclRevision: 'acl-1', policyVersion: 'policy-1' },
    trust: 'untrusted_display_code', execution: 'not_admitted' };
  const lifetime = { now: '2026-10-29T00:00:00Z', sourceExpiresAt: packet.retention.sourceExpiresAt, aclRevision: 'acl-1', policyVersion: 'policy-1' };
  assert.deepEqual(inspectAiWorkbenchPresentation(packet, binding, lifetime), packet);
  assert.equal(globalThis.__workbenchMustStayInert, undefined);
  const invalid = value => assert.throws(() => inspectAiWorkbenchPresentation(value, binding, lifetime), { code: 'AI_INVALID_INPUT' });
  invalid({ ...packet, retention: { ...packet.retention, expiresAt: '2026-11-03T00:00:00Z' } });
  invalid({ ...packet, retention: { ...packet.retention, aclRevision: 'stale' } });
  assert.throws(() => inspectAiWorkbenchPresentation(packet, binding, { ...lifetime, now: packet.retention.expiresAt }), { code: 'AI_INVALID_INPUT' });
  invalid({ ...packet, draftVersion: 'old' }); invalid({ ...packet, execution: 'admitted' });
  invalid({ ...packet, code: { ...packet.code, complete: false } }); invalid({ ...packet, code: { ...packet.code, sha256: '0'.repeat(64) } });
  const large = '界'.repeat(Math.floor(limits.codeBytes / 3) + 1);
  invalid({ ...packet, code: { ...packet.code, source: large, sha256: createHash('sha256').update(large).digest('hex') } });
  for (const key of ['conversationId', 'turnId', 'capabilityVersion', 'taskId', 'inputFingerprint', 'materialHash'])
    invalid({ ...packet, binding: { ...binding, [key]: 'different' } });
  const mount = { ...binding, instanceId: 'mount-a', channelId: 'channel-a' };
  const proposal = { contractVersion: shared.AI_PROPOSAL_DRAFT_VERSION, proposalId: 'proposal-a', proposalRevision: 1, reviewedPayloadHash: 'c'.repeat(64) };
  const current = { binding: mount, lastSequence: 0, sourceIds: ['source-a'], proposals: [proposal], input: { revision: 1,
    contract: { draftVersion: shared.AI_TASK_INPUT_DRAFT_VERSION, code: 'quantity', version: '1',
      fields: [{ fieldId: 'quantity', kind: 'integer', label: 'Quantity', required: true, minimum: 1, maximum: 10 }] } } };
  const base = { draftVersion: version, binding: mount, sequence: 1 };
  const candidate = { ...base, kind: 'candidate_input', fieldRevision: 1, answers: [{ fieldId: 'quantity', value: 2 }] };
  const observed = inspectAiWorkbenchMessage(candidate, current);
  assert.equal(observed.kind, 'input_candidate'); assert.equal(observed.humanChoice, 'not_attested');
  assert.equal(validators.AiWorkbenchMessageObservationDraft(observed), true);
  observed.answers[0].value = 3; assert.equal(candidate.answers[0].value, 2);
  assert.equal(inspectAiWorkbenchMessage({ ...base, kind: 'request_source', sourceId: 'source-a' }, current).authorization, 'required_at_original_reader');
  assert.equal(inspectAiWorkbenchMessage({ ...base, kind: 'request_confirmation', proposal }, current).approval, 'not_granted');
  for (const kind of ['ready', 'rendered', 'render_failed']) {
    const response = inspectAiWorkbenchMessage({ ...base, kind, ...(kind === 'render_failed' ? { reason: 'resource_limit' } : {}) }, current);
    assert.equal(response.execution, 'not_attested'); assert.equal(validators.AiWorkbenchMessageObservationDraft(response), true);
  }
  const rejected = value => assert.throws(() => inspectAiWorkbenchMessage(value, current), { code: 'AI_INVALID_INPUT' });
  rejected({ ...candidate, actor: 'forged' }); rejected({ ...candidate, humanChoice: true }); rejected({ ...candidate, sequence: 2 });
  rejected({ ...candidate, fieldRevision: 2 }); rejected({ ...candidate, answers: [{ fieldId: 'quantity', value: 11 }] });
  rejected({ ...candidate, answers: [{ fieldId: 'quantity', value: 2 }, { fieldId: 'quantity', value: 2 }] });
  rejected({ ...candidate, binding: { ...mount, instanceId: 'old' } }); rejected({ ...candidate, binding: { ...mount, channelId: 'other' } });
  rejected({ ...base, kind: 'request_source', sourceId: 'unregistered' }); rejected({ ...base, kind: 'request_source', sourceId: 'https://example.com' });
  rejected({ ...base, kind: 'request_confirmation', proposal: { ...proposal, reviewedPayloadHash: '0'.repeat(64) } });
  for (const kind of ['approve', 'submit', 'cancel_task', 'navigate', 'fetch', 'tool']) rejected({ ...base, kind });
  assert.throws(() => inspectAiWorkbenchMessage(candidate, { ...current, lastSequence: 1 }), { code: 'AI_INVALID_INPUT' });
  assert.throws(() => inspectAiWorkbenchMessage(candidate, { ...current, input: undefined }), { code: 'AI_INVALID_INPUT' });
  assert.deepEqual(f.compileConsumer(`import type { AiWorkbenchSandboxMessageDraft, AiWorkbenchMessageObservationDraft } from '../packages/shared/src';
    declare const message: AiWorkbenchSandboxMessageDraft;
    // @ts-expect-error sandbox does not carry an approval decision
    const decision: 'approve' = message.decision;
    declare const result: AiWorkbenchMessageObservationDraft;
    if (result.kind === 'input_candidate') {
      const origin: 'not_attested' = result.humanChoice;
      // @ts-expect-error a schema-valid sandbox value is not a human receipt
      const trusted: true = result.humanChoice;
    }`), []);
});

test("API schema validators and their transitive packages are production dependencies", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/api/package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const semver = require('semver');
  const visited = new Set();
  function check(name, range, from = 'apps/api') {
    let at = from, key;
    while (true) {
      const candidate = path.posix.join(at, 'node_modules', name);
      if (lock.packages[candidate]) { key = candidate; break; }
      if (at === '.') break;
      at = path.posix.dirname(at);
    }
    assert.ok(key, `missing locked dependency ${name} from ${from}`);
    const row = lock.packages[key];
    assert.equal(semver.satisfies(row.version, range), true, `${key} version mismatch`);
    assert.notEqual(row.dev, true, `${key} would disappear with omit=dev`);
    assert.notEqual(row.devOptional, true, `${key} must be required by the API`);
    if (visited.has(key)) return;
    visited.add(key);
    for (const [dependency, version] of Object.entries(row.dependencies ?? {})) check(dependency, version, key);
  }
  for (const name of ['ajv', 'ajv-formats']) {
    assert.ok(manifest.dependencies[name], `${name} must belong to the API runtime`);
    assert.equal(lock.packages['apps/api'].dependencies[name], manifest.dependencies[name]);
    check(name, manifest.dependencies[name]);
  }
  assert.ok(visited.size >= 2);
});

test("scene, selection and approval applications publish closed contracts through the shared barrel", () => {
  const shared = require("../packages/shared/src/index");
  const { aiLeafToOpenApi30 } = require("../apps/api/src/contracts/ai-leaf-openapi");
  const leaves = [shared.AI_SCENE_REQUEST_DRAFT_SCHEMAS, shared.AI_QUOTE_SELECTION_DRAFT_SCHEMAS, shared.AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS];
  for (const leaf of leaves) {
    assert.ok(leaf);
    for (const [name, schema] of Object.entries(leaf)) assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], aiLeafToOpenApi30(schema, name));
  }
  const published = Object.assign({}, ...leaves), available = { ...schemas,
    ...require('../apps/api/src/contracts/ai-task-draft-schemas').AI_TASK_DRAFT_COMPONENT_SCHEMAS,
    ...Object.assign({}, ...Object.entries(shared).filter(([name, value]) => name.endsWith('SCHEMAS') && value && typeof value === 'object').map(([, value]) => value)),
    ...published };
  // Follow the actual transitive closure, not a hand-maintained dependency list
  // that silently omits newly published material/recovery references.
  const dependencies = {};
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      const name = value.$ref.split('/').pop();
      assert.ok(available[name], `missing schema dependency ${name}`);
      if (!Object.hasOwn(dependencies, name)) { dependencies[name] = available[name]; collect(available[name]); }
    }
    for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(collect); else collect(child);
  }
  Object.values(published).forEach(collect);
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

function evaluateContract(source, imports) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, require: name => { assert.ok(Object.hasOwn(imports, name), `unexpected contract import ${name}`); return imports[name]; } };
  vm.runInNewContext(code, context, { timeout: 1000 });
  return JSON.parse(JSON.stringify(context.exports));
}
test("C01/C02 wire compatibility survives the approved additive tool and shared scope extraction", () => {
  const historical = file => execFileSync('git', ['show', `${dependency}:${file}`], { cwd: root, encoding: 'utf8' });
  const oldShared = evaluateContract(historical('packages/shared/src/ai-native.ts'), {});
  const oldSchemas = evaluateContract(historical('apps/api/src/contracts/ai-native-schemas.ts'), { '@rental-os/shared': oldShared }).AI_NATIVE_COMPONENT_SCHEMAS;
  assert.equal(shared.AI_CONTRACT_DRAFT_VERSION, oldShared.AI_CONTRACT_DRAFT_VERSION);
  assert.equal(shared.AI_TOOL_DRAFT_VERSION, oldShared.AI_TOOL_DRAFT_VERSION);
  const additions = shared.AI_TOOL_CODES.filter(code => !oldShared.AI_TOOL_CODES.includes(code));
  assert.deepEqual(additions, ['tenant.notifications.commit']);
  assert.deepEqual(shared.AI_TOOL_CODES.filter(code => !additions.includes(code)), oldShared.AI_TOOL_CODES);
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description' && key !== 'x-ai-contract-draft')
      .map(([key, child]) => [key, normalize(child)]));
  };
  const current = normalize(clone(schemas)), previous = normalize(oldSchemas);
  current.AiToolContractDraft.properties.code.enum = current.AiToolContractDraft.properties.code.enum.filter(code => !additions.includes(code));
  // Same-version additions retain the old shape; no unknown tool or executable
  // maturity is accepted. Scope extraction must preserve the schema exactly.
  assert.deepEqual(current, previous);
  f.checkClosed(schemas, schemas);
});
test("schema publication cannot register handlers or change independently declared HTTP paths", () => {
  const source = fs.readFileSync(path.join(root, 'apps/api/src/contracts/openapi-document.ts'), 'utf8');
  const ownedRequire = createRequire(path.join(root, 'apps/api/src/contracts/openapi-document.ts'));
  const sourceFile = ts.createSourceFile('openapi.ts', source, ts.ScriptTarget.Latest, true);
  const schemaImports = new Set(['./ai-native-schemas', './ai-task-draft-schemas', './ai-leaf-components']);
  const imported = {};
  for (const statement of sourceFile.statements) if (ts.isImportDeclaration(statement)) {
    const name = statement.moduleSpecifier.text;
    imported[name] = schemaImports.has(name) ? Object.fromEntries(Object.keys(ownedRequire(name)).map(key => [key, {}])) : ownedRequire(name);
  }
  const withoutComponents = evaluateContract(source, imported).OPENAPI_DOCUMENT;
  assert.deepEqual(JSON.parse(JSON.stringify(OPENAPI_DOCUMENT.paths)), withoutComponents.paths);
  // Contract modules have no Nest registration, timers or filesystem/network
  // imports. Runtime entrypoint opt-in behaviour has its own host tests.
  for (const file of ['apps/api/src/contracts/ai-native-schemas.ts', 'apps/api/src/contracts/ai-task-draft-schemas.ts',
    'apps/api/src/contracts/ai-leaf-components.ts', 'packages/shared/src/ai-workbench-display-draft.ts']) {
    const ast = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const imports = ast.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text);
    assert.ok(imports.every(name => name === '@rental-os/shared' || name.startsWith('./')), `${file} imports executable runtime`);
    const forbidden = new Set(['Controller', 'Module', 'Injectable', 'setTimeout', 'setInterval', 'fetch', 'eval', 'Function']);
    const walk = node => { if (ts.isIdentifier(node)) assert.equal(forbidden.has(node.text), false, `${file}: ${node.text}`); ts.forEachChild(node, walk); };
    walk(ast);
  }
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
