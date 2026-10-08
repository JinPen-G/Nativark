"use strict";
// C04 offline contract/decision tests, not database fencing, authorization or worker acceptance.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const dns = require("node:dns");
const { createRequire } = require("node:module");
const test = require("node:test");
const ts = require("typescript");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const root = path.resolve(__dirname, "..");
let networkAttempts = 0;
const originals = [net.Socket.prototype.connect, globalThis.fetch, dns.lookup, dns.promises.lookup];
const denyNetwork = () => { networkAttempts++; throw new Error("C04 tests must stay offline"); };
net.Socket.prototype.connect = globalThis.fetch = dns.lookup = dns.promises.lookup = denyNetwork;
test.after(() => {
  [net.Socket.prototype.connect, globalThis.fetch, dns.lookup, dns.promises.lookup] = originals;
  assert.equal(networkAttempts, 0);
});
const apiRequire = createRequire(path.join(root, "apps/api/package.json"));
assert.ok(fs.realpathSync(apiRequire.resolve("@rental-os/shared")).startsWith(fs.realpathSync(path.join(root, "packages/shared")) + path.sep), "Use this worktree's shared build");
const shared = apiRequire("@rental-os/shared");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { AI_NATIVE_COMPONENT_SCHEMAS: foundation } = require("../apps/api/src/contracts/ai-native-schemas");
const { AI_TASK_DRAFT_COMPONENT_SCHEMAS: schemas } = require("../apps/api/src/contracts/ai-task-draft-schemas");
const { OPENAPI_DOCUMENT, API_CONTRACT_OPERATIONS } = require("../apps/api/src/contracts/openapi-document");
const { AI_TASK_TRANSITIONS_DRAFT, evaluateAiTaskTransitionDraft: evaluate, evaluateAiStepTransitionDraft: evaluateStep, matchesAiRunLeaseDraft: matchesLease, isAiTaskEventPageConsistentDraft: consistentPage } = require("../apps/api/src/modules/ai-native/task-transition-draft");
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
function localRefs(value) {
  if (Array.isArray(value)) return value.map(localRefs);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    key === "$ref" ? child.replace("#/components/schemas/", "urn:rental:c04:") : localRefs(child)]));
}
for (const [name, schema] of Object.entries({ ...foundation, ...schemas })) ajv.addSchema({ ...localRefs(schema), $id: `urn:rental:c04:${name}` }, name);
const validators = Object.fromEntries(Object.keys(schemas).map(name => [name, ajv.getSchema(name)]));
const valid = (name, value) => assert.equal(validators[name](value), true, ajv.errorsText(validators[name].errors));
const invalid = (name, value) => assert.equal(validators[name](value), false, `${name} accepted invalid input`);
const clone = value => JSON.parse(JSON.stringify(value));
const version = shared.AI_TASK_DRAFT_VERSION;
const at = "2026-10-03T10:00:00Z";
const context = { contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, requestId: "r1", authorizedAt: at, audience: "operator", actor: { kind: "user", userId: "u1" }, scope: { kind: "workspace", tenantId: "t1", workspaceId: "w1" }, access: { permissions: [], dataScope: "own", locationScope: { mode: "selected", locationIds: [] } } };
const fact = { scope: context.scope, resourceType: "order", resourceId: "o1", observedAt: at, basis: { kind: "snapshot", version: "v1" } };
const outcomes = {
  pending: { status: "pending", effect: "none" }, running: { status: "running", effect: "possible" },
  succeeded: { status: "succeeded", effect: "committed", facts: [fact] },
  read: { status: "succeeded", effect: "none", facts: [] },
  failed: { status: "failed", effect: "none", error: { code: "AI_BUSINESS_REJECTED", message: "Rejected", retryable: false, nextAction: "manual", missingFields: [] } },
  unknown: { status: "unknown", effect: "possible", error: { code: "AI_RESULT_UNKNOWN", message: "Unknown", retryable: false, nextAction: "reconcile", missingFields: [] } },
  cancelled: { status: "cancelled", effect: "none" }
};
const step = (outcome = "pending", n = 1) => ({ stepId: `s${n}`, runId: "run1", sequence: n, revision: 1, toolCode: "rental.order.commit", toolVersion: "draft-1", actionId: `a${n}`, requestFingerprint: "a".repeat(64), outcome: clone(outcomes[outcome]) });
const state = (status = "running", steps = [step()]) => ({ contractVersion: version, taskId: "task1", revision: 3, status, createdContext: clone(context), steps });
const reasonFor = (from, to) => to === "running" ? (from === "queued" ? "start" : "resume") : to === "waiting_input" ? "input_required" : to === "waiting_confirmation" ? "confirmation_required" : to === "waiting_external" ? "external_pending" : to === "cancel_requested" ? "cancel_requested" : from === "cancel_requested" ? "cancel_settled" : to === "failed" ? "execution_failed" : "completed";
const request = (from, to) => ({ contractVersion: version, taskId: "task1", expectedRevision: 3, to, reason: reasonFor(from, to), occurredAt: at, initiator: { kind: "worker", id: "worker1" } });

for (const [name, outcome] of Object.entries(outcomes)) test(`step outcome ${name} compiles as a strict schema branch`, () => valid("AiStepOutcomeDraft", outcome));

test("C04 components are published without a route or worker", () => {
  for (const [name, schema] of Object.entries(schemas)) assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], schema);
  assert.ok(API_CONTRACT_OPERATIONS.every(row => !/\/ai(?:-native)?\//u.test(row.path)));
  assert.ok(!fs.readFileSync(path.join(root, "apps/api/src/app.module.ts"), "utf8").includes("ai-native"));
  valid("AiTaskStateDraft", state());
  valid("AiTaskTransitionRequestDraft", request("running", "waiting_input"));
  valid("AiTaskTransitionDecisionDraft", { allowed: true, nextRevision: 4 });
  valid("AiTaskTransitionDecisionDraft", { allowed: false, reason: "unresolved_steps" });
});

test("outcomes cannot hide committed or unknown effects", () => {
  for (const outcome of [
    { ...outcomes.unknown, effect: "none" }, { ...outcomes.unknown, status: "failed" },
    { ...outcomes.unknown, error: { ...outcomes.unknown.error, retryable: true } },
    { ...outcomes.unknown, error: { ...outcomes.unknown.error, nextAction: "none" } },
    { ...outcomes.succeeded, facts: [] }, { ...outcomes.succeeded, status: "cancelled" },
    { ...outcomes.failed, effect: "committed" }, { ...outcomes.pending, approved: true }
  ]) invalid("AiStepOutcomeDraft", outcome);
});

test("state and request reject unknown fields, versions, unsafe counters and missing identity", () => {
  for (const patch of [{ contractVersion: "future" }, { revision: 0 }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { status: "success" }, { approved: true }, { steps: Array.from({ length: 1001 }, () => step()) }, { createdContext: { ...context, audience: "client" } }]) invalid("AiTaskStateDraft", { ...state(), ...patch });
  for (const patch of [{ expectedRevision: 0 }, { contractVersion: "old" }, { to: "unknown" }, { actor: "admin" }, { occurredAt: "yesterday" }]) invalid("AiTaskTransitionRequestDraft", { ...request("queued", "running"), ...patch });
  invalid("AiStepStateDraft", { ...step(), requestFingerprint: "unhashed" });
  invalid("AiStepStateDraft", { ...step(), toolCode: "arbitrary.http" });
});

test("task transition matrix has no implicit restart or cancellation-intent reset", () => {
  const expected = {
    queued: ["running", "cancel_requested"],
    running: ["waiting_input", "waiting_confirmation", "waiting_external", "cancel_requested", "succeeded", "partially_succeeded", "failed"],
    waiting_input: ["running", "cancel_requested"], waiting_confirmation: ["running", "cancel_requested"], waiting_external: ["running", "cancel_requested"],
    cancel_requested: ["cancelled", "partially_succeeded", "succeeded"], succeeded: [], partially_succeeded: [], failed: [], cancelled: []
  };
  assert.deepEqual(AI_TASK_TRANSITIONS_DRAFT, expected);
  for (const from of shared.AI_TASK_STATUSES_DRAFT) for (const to of shared.AI_TASK_STATUSES_DRAFT) {
    const steps = from === "queued" ? [step()] : to === "waiting_external" ? [step("unknown")]
      : to === "succeeded" ? [step("succeeded")] : to === "partially_succeeded" ? [step("succeeded"), step("failed", 2)]
      : to === "failed" ? [step("failed")] : [step()];
    const result = evaluate(state(from, steps), request(from, to));
    assert.equal(result.allowed, expected[from].includes(to), `${from} -> ${to}`);
    if (result.allowed) assert.equal(result.nextRevision, 4);
  }
});

test("revision and action identities cannot be bypassed by a retry", () => {
  const original = state();
  const before = clone(original);
  assert.deepEqual(evaluate(original, { ...request("running", "waiting_input"), expectedRevision: 2 }), { allowed: false, reason: "revision_conflict" });
  for (const patch of [{ taskId: "other-task" }, { revision: Number.MAX_SAFE_INTEGER }, { revision: NaN }, { contractVersion: "old" }, { steps: [step(), step()] }]) assert.equal(evaluate({ ...original, ...patch }, request("running", "waiting_input")).allowed, false);
  for (const patch of [{ actionId: "a1" }, { stepId: "s1" }, { sequence: 1 }]) assert.equal(evaluate(state("running", [step(), { ...step("pending", 2), ...patch }]), request("running", "waiting_input")).allowed, false);
  assert.equal(evaluate(original, { ...request("running", "waiting_input"), reason: "completed" }).allowed, false);
  assert.deepEqual(original, before);
});

test("unsettled results wait, and accepting cancellation is not successful cancellation", () => {
  for (const outcome of ["running", "unknown"]) {
    const current = state("running", [step(outcome)]);
    assert.equal(evaluate(current, request("running", "waiting_external")).allowed, true);
    assert.equal(evaluate(current, request("running", "cancel_requested")).allowed, true);
    for (const to of ["succeeded", "partially_succeeded", "failed", "waiting_input", "waiting_confirmation"]) assert.equal(evaluate(current, request("running", to)).allowed, false);
    for (const to of ["cancelled", "succeeded", "partially_succeeded", "running", "waiting_external"]) assert.equal(evaluate({ ...current, status: "cancel_requested" }, request("cancel_requested", to)).allowed, false);
    assert.equal(evaluate({ ...current, status: "waiting_external" }, request("waiting_external", "running")).allowed, false);
  }
  assert.equal(evaluate(state("running", [step()]), request("running", "waiting_external")).allowed, false);
});

test("terminal outcomes preserve actual completion and committed facts", () => {
  const mixed = state("running", [step("succeeded"), step("failed", 2)]);
  assert.equal(evaluate(mixed, request("running", "partially_succeeded")).allowed, true);
  for (const to of ["succeeded", "failed"]) assert.equal(evaluate(mixed, request("running", to)).allowed, false);
  assert.equal(evaluate({ ...mixed, status: "cancel_requested" }, request("cancel_requested", "cancelled")).allowed, false);
  assert.equal(evaluate(state("running", []), request("running", "succeeded")).allowed, false);
  assert.equal(evaluate(state("running", []), request("running", "failed")).allowed, true);
  assert.equal(evaluate(state("cancel_requested", [step("read"), step("pending", 2)]), request("cancel_requested", "cancelled")).allowed, true);
  assert.equal(evaluate(state("running", [step("succeeded")]), request("running", "partially_succeeded")).allowed, false);
});

test("step reconciliation never becomes a blind replay or changes action identity", () => {
  const unknown = step("unknown");
  const succeeded = { ...step("succeeded"), revision: 2 };
  const failed = { ...step("failed"), revision: 2 };
  assert.equal(evaluateStep(unknown, succeeded, "reconciled_committed").allowed, true);
  assert.equal(evaluateStep(unknown, failed, "reconciled_not_committed").allowed, true);
  assert.equal(evaluateStep(unknown, succeeded, "result_observed").allowed, false);
  for (const outcome of ["pending", "running", "cancelled", "read"]) assert.equal(evaluateStep(unknown, { ...step(outcome), revision: 2 }, "reconciled_committed").allowed, false);
  for (const patch of [{ actionId: "new-key" }, { requestFingerprint: "b".repeat(64) }, { runId: "run2" }, { toolVersion: "next" }, { sequence: 2 }, { stepId: "new-step" }, { revision: 3 }]) assert.equal(evaluateStep(unknown, { ...succeeded, ...patch }, "reconciled_committed").allowed, false);
  assert.equal(evaluateStep(step("succeeded"), { ...step("running"), revision: 2 }, "start").allowed, false);
  assert.equal(evaluateStep(step("failed"), { ...step("running"), revision: 2 }, "retry_known_failure").allowed, false);
  const retryable = step("failed");
  retryable.outcome.error.retryable = true;
  retryable.outcome.error.nextAction = "retry_later";
  assert.equal(evaluateStep(retryable, { ...step("running"), revision: 2 }, "retry_known_failure").allowed, true);
  assert.equal(evaluateStep(step(), { ...step("running"), revision: 2 }, "start").allowed, true);
  assert.equal(evaluateStep(step(), { ...step("cancelled"), revision: 2 }, "not_started_cancelled").allowed, true);
  const readRunning = step("running");
  readRunning.outcome.effect = "none";
  assert.equal(evaluateStep(readRunning, succeeded, "result_observed").allowed, false);
});

const lease = { contractVersion: version, taskId: "task1", runId: "run1", holderId: "worker1", fencingToken: "9007199254740993", expiresAt: "2026-10-03T10:00:01Z" };
test("run lease comparison rejects stale workers, expiration and numeric precision loss", () => {
  valid("AiRunLeaseDraft", lease);
  assert.equal(matchesLease(lease, clone(lease), at), true);
  for (const patch of [{ taskId: "task2" }, { runId: "run2" }, { holderId: "worker2" }, { fencingToken: "9007199254740992" }, { fencingToken: "9007199254740994" }, { fencingToken: "01" }, { fencingToken: 9007199254740993 }, { expiresAt: "2026-10-04T10:00:01Z" }, { contractVersion: "old" }]) assert.equal(matchesLease(lease, { ...lease, ...patch }, at), false);
  for (const now of [lease.expiresAt, "2026-10-04T10:00:00Z", "invalid", "2026-10-03T10:00:00"]) assert.equal(matchesLease(lease, lease, now), false);
  for (const fencingToken of ["0", "01", "-1", "1.0", "x", "1".repeat(21), 42]) invalid("AiRunLeaseDraft", { ...lease, fencingToken });
});

const event = (cursor = "9007199254740993", taskRevision = 4) => ({ contractVersion: version, taskId: "task1", cursor, taskRevision, occurredAt: at, type: "task.transition", data: { from: "running", to: "waiting_input", reason: "input_required" } });
const page = () => ({ contractVersion: version, taskId: "task1", events: [event(), event("9007199254740995", 5)], nextCursor: "9007199254740995", hasMore: false });
test("SSE/polling share minimal events and do not carry internal contexts or output bodies", () => {
  valid("AiTaskEventPageDraft", page());
  for (const variant of [event(), { ...event(), type: "step.changed", data: { stepId: "s1", runId: "run1", stepRevision: 2, status: "unknown", reason: "result_unknown" } }, { ...event(), type: "task.output_ready", data: { resultId: "result1" } }, { ...event(), type: "access.revoked", data: { code: "AI_SCOPE_CHANGED" } }]) valid("AiTaskEventDraft", variant);
  for (const patch of [{ type: "custom.javascript" }, { cursor: "01" }, { cursor: 9007199254740993 }, { context }, { data: { ...event().data, body: "secret" } }, { data: { ...event().data, apiKey: "synthetic-key" } }]) invalid("AiTaskEventDraft", { ...event(), ...patch });
  valid("AiTaskEventResetDraft", { contractVersion: version, taskId: "task1", status: "reset_required", reason: "cursor_expired" });
});

test("event pages reject duplicates, out-of-order revisions and cross-task replay", () => {
  assert.equal(consistentPage(page(), "9007199254740992"), true);
  const patches = [
    { nextCursor: "9007199254740996" }, { events: [event(), event()] },
    { events: [event("9007199254740995"), event()] }, { events: [event(), { ...event("9007199254740995"), taskId: "task2" }] },
    { events: [event(), event("9007199254740995", 3)] }, { contractVersion: "old" }, { events: [], hasMore: true }
  ];
  for (const patch of patches) assert.equal(consistentPage({ ...page(), ...patch }, "9007199254740992"), false);
  assert.equal(consistentPage(page(), "9007199254740993"), false);
  assert.equal(consistentPage(page(), "01"), false);
  assert.equal(consistentPage({ ...page(), events: [], nextCursor: "0" }, "0"), true);
  assert.equal(consistentPage({ ...page(), events: [], nextCursor: "0" }, "5"), false);
});

test("public task consumers and the real decision module type-check without emit", () => {
  const file = path.join(root, "tests/__ai_task_types__.ts");
  const source = `import type { AiStepOutcomeDraft, AiTaskStateDraft, AiRunLeaseDraft, AiTaskEventDraft } from "../packages/shared/src";
const task: AiTaskStateDraft = ${JSON.stringify(state())};
const lease: AiRunLeaseDraft = ${JSON.stringify(lease)};
const event: AiTaskEventDraft = ${JSON.stringify(event())};
// @ts-expect-error unknown is not a successful/committed outcome
const unknown: AiStepOutcomeDraft = { status: "unknown", effect: "committed", error: ${JSON.stringify(outcomes.unknown.error)} };
// @ts-expect-error write completion must reference at least one business fact
const empty: AiStepOutcomeDraft = { status: "succeeded", effect: "committed", facts: [] };
// @ts-expect-error fencing tokens must retain string precision
const numeric: AiRunLeaseDraft = { ...lease, fencingToken: 9007199254740993 };
`;
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, types: [] };
  const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  host.readFile = name => path.resolve(name) === file ? source : read(name);
  host.fileExists = name => path.resolve(name) === file || exists(name);
  const program = ts.createProgram([file, path.join(root, "apps/api/src/modules/ai-native/task-transition-draft.ts"), path.join(root, "apps/api/src/contracts/ai-task-draft-schemas.ts")], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => "\n" }));
});
