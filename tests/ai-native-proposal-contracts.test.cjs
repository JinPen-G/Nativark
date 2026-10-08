"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
const path = require("node:path"), fs = require("node:fs"), ts = require("typescript"), { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."), apiRequire = createRequire(path.join(root, "apps/api/package.json"));
assert.ok(fs.realpathSync(apiRequire.resolve("@rental-os/shared")).startsWith(fs.realpathSync(path.join(root, "packages/shared")) + path.sep));
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const shared = apiRequire("@rental-os/shared");
const { AI_NATIVE_COMPONENT_SCHEMAS: base } = require("../apps/api/src/contracts/ai-native-schemas");
const { fingerprintAiProposalDraft: fingerprint, checkAiApprovalBindingDraft: check } = require("../apps/api/src/modules/ai-native/proposal-binding-draft");
const { requestFingerprint: coreFingerprint } = require("../apps/api/src/modules/rental-core/rental-idempotency.repository");
const { OPENAPI_DOCUMENT } = require("../apps/api/src/contracts/openapi-document");
const validators = h.validatorsFor(shared.AI_PROPOSAL_DRAFT_SCHEMAS, base);
const yes = (name, value) => assert.equal(validators[name](value), true, JSON.stringify(validators[name].errors));
const no = (name, value) => assert.equal(validators[name](value), false, `${name} accepted invalid input`);
const clone = value => structuredClone(value);
const version = shared.AI_PROPOSAL_DRAFT_VERSION;
const snapshot = { recordId: "immutable-input", revision: 1, contentHash: "1".repeat(64) };
const action = { actionId: "action-1", toolCode: "rental.order.commit", toolVersion: "draft-1", input: snapshot, preview: { ...snapshot, recordId: "core-preview" }, target: { resourceType: "quote", resourceId: "quote-1", version: "1" } };
const payload = { contractVersion: version, proposalId: "proposal-1", taskId: "task-1", revision: 1, audience: "operator", scope: h.scope, actions: [action], atomicity: "single_action", failurePolicy: "stop_and_reconcile", expiresAt: "2026-10-03T00:05:00Z" };
const record = () => ({ payload: clone(payload), payloadHash: fingerprint(payload), status: "confirmed" });
const approval = () => ({ contractVersion: version, approvalId: "approval-1", proposalId: payload.proposalId, proposalRevision: 1, payloadHash: fingerprint(payload), audience: payload.audience, scope: h.scope, actor: h.contexts[0].actor, decision: "approved", issuedAt: "2026-10-03T00:00:00Z", expiresAt: payload.expiresAt });
const now = "2026-10-03T00:01:00Z";

test("proposal, review decision and persisted approval are distinct strict contracts", () => {
  yes("AiProposalPayloadDraft", payload); yes("AiProposalRecordDraft", record()); yes("AiApprovalRecordDraft", approval());
  const decision = { contractVersion: version, proposalId: payload.proposalId, proposalRevision: 1, reviewedPayloadHash: fingerprint(payload), decision: "approve" };
  yes("AiProposalDecisionRequestDraft", decision);
  for (const field of ["actor", "scope", "tenantId", "audience", "expiresAt", "approved", "approvalId", "apiKey"]) no("AiProposalDecisionRequestDraft", { ...decision, [field]: "forged" });
  no("AiApprovalRecordDraft", { ...approval(), actor: h.contexts[4].actor, audience: "automation" });
  no("AiApprovalRecordDraft", { ...approval(), audience: "client" });
  for (const name of Object.keys(shared.AI_PROPOSAL_DRAFT_SCHEMAS)) assert.ok(OPENAPI_DOCUMENT.components.schemas[name]);
});

test("fingerprint reuses Core canonicalization and preserves operation order", () => {
  const original = JSON.stringify(payload);
  const reordered = Object.fromEntries(Object.entries(payload).reverse());
  assert.equal(fingerprint(payload), coreFingerprint(payload));
  assert.equal(fingerprint(reordered), fingerprint(payload));
  const plan = { ...payload, atomicity: "ordered_partial", actions: [action, { ...action, actionId: "action-2" }] };
  assert.notEqual(fingerprint(plan), fingerprint({ ...plan, actions: [...plan.actions].reverse() }));
  assert.equal(JSON.stringify(payload), original);
});

test("strict validation prevents lossy hashes and ambiguous action plans", () => {
  for (const patch of [{ revision: NaN }, { revision: Infinity }, { revision: 0 }, { revision: 1.5 }, { scope: { kind: "platform" }, audience: "staff" }, { expiresAt: new Date(now) }, { expiresAt: undefined }, { extra: "not-hashed-away" }, { actions: [] }, { actions: [action, action] }, { contractVersion: "old" }]) assert.throws(() => fingerprint({ ...payload, ...patch }), /^Error: AI_INVALID_PROPOSAL$/u);
  assert.throws(() => fingerprint({ ...payload, atomicity: "ordered_partial", actions: [action, { ...action, toolCode: "tenant.config.propose" }] }), /AI_INVALID_PROPOSAL/u);
  no("AiProposalPayloadDraft", { ...payload, actions: [action, { ...action, actionId: "action-2" }] });
  no("AiProposalActionDraft", { ...action, amount: 1 });
  no("AiProposalActionDraft", { ...action, toolCode: "arbitrary.sql" });
  no("AiProposalActionDraft", { ...action, input: { ...snapshot, contentHash: "raw-value" } });
});

test("binding succeeds only for an active reviewed record and its current actor/scope", () => {
  assert.deepEqual(check(record(), approval(), h.contexts[0], action.actionId, now), { valid: true });
  for (const status of ["pending_confirmation", "superseded", "cancelled", "expired"]) assert.deepEqual(check({ ...record(), status }, approval(), h.contexts[0], action.actionId, now), { valid: false, reason: "proposal_inactive" });
  assert.deepEqual(check(record(), { ...approval(), decision: "rejected" }, h.contexts[0], action.actionId, now), { valid: false, reason: "approval_rejected" });
  assert.deepEqual(check(record(), approval(), h.contexts[0], "another-action", now), { valid: false, reason: "action_missing" });
});

test("any effect-bearing revision or input/preview/target change invalidates prior approval", () => {
  const mutations = [
    p => { p.revision++; }, p => { p.proposalId = "other-proposal"; }, p => { p.taskId = "other-task"; },
    p => { p.actions[0].input.contentHash = "2".repeat(64); }, p => { p.actions[0].preview.revision++; },
    p => { p.actions[0].target.version = "2"; }, p => { p.actions[0].target.resourceId = "other-quote"; },
    p => { p.actions[0].toolVersion = "next"; }, p => { p.expiresAt = "2026-10-03T00:06:00Z"; }
  ];
  for (const mutate of mutations) {
    const changed = record(); mutate(changed.payload);
    assert.deepEqual(check(changed, approval(), h.contexts[0], action.actionId, now), { valid: false, reason: "proposal_changed" });
    changed.payloadHash = fingerprint(changed.payload);
    assert.equal(check(changed, approval(), h.contexts[0], action.actionId, now).valid, false);
  }
});

test("cross-person, tenant, workspace, audience and automation contexts do not reuse approval", () => {
  const changedContexts = [
    { ...h.contexts[0], actor: { kind: "user", userId: "another-user" } },
    { ...h.contexts[0], scope: { ...h.scope, tenantId: "other-tenant" } },
    { ...h.contexts[0], scope: { ...h.scope, workspaceId: "other-space" } },
    h.contexts[1], h.contexts[2], h.contexts[3], h.contexts[4]
  ];
  for (const context of changedContexts) assert.equal(check(record(), approval(), context, action.actionId, now).valid, false);
  assert.equal(check(record(), { ...approval(), scope: { kind: "tenant", tenantId: h.scope.tenantId } }, h.contexts[0], action.actionId, now).valid, false);
  // A binding check is not permission evaluation; AIN-04 must still reject a revoked actor.
  assert.equal(check(record(), approval(), { ...h.contexts[0], access: { ...h.access, permissions: [] } }, action.actionId, now).valid, true);
});

test("expiry includes exact deadline, future issuance and extension past reviewed deadline", () => {
  for (const clock of [payload.expiresAt, "2026-10-03T00:06:00Z", "2026-10-02T23:59:00Z", "invalid"]) assert.equal(check(record(), approval(), h.contexts[0], action.actionId, clock).valid, false);
  for (const patch of [{ expiresAt: "2026-10-03T00:06:00Z" }, { issuedAt: "2026-10-03T00:02:00Z" }, { expiresAt: "2026-10-03T00:00:00Z" }]) assert.equal(check(record(), { ...approval(), ...patch }, h.contexts[0], action.actionId, now).valid, false);
});

test("platform approvals need the platform actor, not a fabricated workspace", () => {
  const p = { ...payload, scope: { kind: "platform" }, actions: [{ ...action, toolCode: "platform.category.propose", target: { resourceType: "category", resourceId: "camera", version: "1" } }] };
  const r = { payload: p, payloadHash: fingerprint(p), status: "confirmed" };
  const a = { ...approval(), scope: p.scope, actor: h.contexts[3].actor, payloadHash: r.payloadHash };
  yes("AiApprovalRecordDraft", a);
  assert.equal(check(r, a, h.contexts[3], action.actionId, now).valid, true);
  assert.equal(check(r, a, h.contexts[0], action.actionId, now).valid, false);
});

test("consumption records retain action identity and unknown outcomes must reconcile", () => {
  const b = { contractVersion: version, approvalId: "approval-1", proposalId: payload.proposalId, proposalRevision: 1, actionId: action.actionId, actionFingerprint: fingerprint(payload), businessIdempotencyKey: "same-stable-key" };
  for (const state of [{ status: "reserved" }, { status: "committed", result: snapshot }, { status: "unknown", retryable: false, nextAction: "reconcile" }, { status: "failed_no_effect", nextAction: "revalidate_or_manual" }]) yes("AiApprovalConsumptionDraft", { ...b, ...state });
  no("AiApprovalConsumptionDraft", { ...b, status: "unknown", retryable: true, nextAction: "retry_later" });
  no("AiApprovalConsumptionDraft", { ...b, status: "committed" });
  no("AiApprovalConsumptionDraft", { ...b, status: "reserved", executed: true });
});

test("malformed records and ordinary messages do not become usable approvals", () => {
  for (const bad of [null, {}, "yes", { ...approval(), approved: true }, { ...approval(), actor: { kind: "model", id: "model" } }]) assert.deepEqual(check(record(), bad, h.contexts[0], action.actionId, now), { valid: false, reason: "invalid_record" });
});

test("public C05 types and actual binding module compile without emitting", () => {
  const file = path.join(root, "tests/__ai_proposal_types__.ts");
  const source = `import type { AiProposalPayloadDraft, AiApprovalRecordDraft, AiApprovalConsumptionDraft } from "../packages/shared/src";
  const payload: AiProposalPayloadDraft = ${JSON.stringify(payload)};
  const approval: AiApprovalRecordDraft = ${JSON.stringify(approval())};
  // @ts-expect-error automation is not a human confirmation actor
  const forged: AiApprovalRecordDraft = { ...approval, actor: { kind: "automation", subjectId: "job", policyId: "p", policyRevision: 1, expiresAt: "${payload.expiresAt}" } };
  // @ts-expect-error unknown business outcomes cannot be retried blindly
  const retry: AiApprovalConsumptionDraft = { contractVersion: "${version}", approvalId: "a", proposalId: "p", proposalRevision: 1, actionId: "x", actionFingerprint: "x", businessIdempotencyKey: "x", status: "unknown", retryable: true, nextAction: "reconcile" };`;
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true };
  const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  host.readFile = name => path.resolve(name) === file ? source : read(name);
  host.fileExists = name => path.resolve(name) === file || exists(name);
  const program = ts.createProgram([file, path.join(root, "apps/api/src/modules/ai-native/proposal-binding-draft.ts")], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => "\n" }));
});
