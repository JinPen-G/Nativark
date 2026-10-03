"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
const path = require("node:path"), fs = require("node:fs"), { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."), apiRequire = createRequire(path.join(root, "apps/api/package.json"));
assert.ok(fs.realpathSync(apiRequire.resolve("@prisma/client")).startsWith(fs.realpathSync(path.join(root, "apps/api/node_modules/@prisma/client")) + path.sep));
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node", target: "es2022" } });
const { AiTaskRepository, AiTaskRepositoryError } = require("../apps/api/src/modules/ai-native/ai-task.repository");
const { aiPersistenceScopeColumns } = require("../apps/api/src/modules/ai-native/persistence-scope");
const { AI_TASK_DRAFT_VERSION } = require("./fixtures/ai-native/local-shared.cjs");
const now = new Date("2026-10-03T00:01:00Z");
const command = { taskId: "task-1", runId: "run-1", holderId: "worker-new", expectedTaskRevision: 3, expectedRunRevision: 4, expectedFencingToken: "9007199254740993", leaseMs: 5000 };
const code = expected => error => error instanceof AiTaskRepositoryError && error.code === expected && error.message === expected;

// Predicate-executing test double, not a MySQL concurrency/transaction simulation.
function matches(value, where) {
  if (where === null || typeof where !== "object") return value === where;
  if (where instanceof Date) return value instanceof Date && value.getTime() === where.getTime();
  if (typeof where.toFixed === "function") return String(value) === where.toFixed(0);
  return Object.entries(where).every(([key, rule]) => {
    if (key === "OR") return rule.some(branch => matches(value, branch));
    if (key === "is") return matches(value, rule);
    if (key === "in") return rule.includes(value);
    if (key === "not") return !matches(value, rule);
    if (key === "gt") return value != null && value > rule;
    if (key === "lte") return value != null && value <= rule;
    return matches(value?.[key], rule);
  });
}
function setup(status = "WAITING_EXTERNAL", context = h.contexts[0]) {
  const actorId = context.actor.userId ?? context.actor.customerId ?? context.actor.subjectId;
  const scope = aiPersistenceScopeColumns(context.scope);
  const task = { id: command.taskId, revision: 3, status, contractVersion: AI_TASK_DRAFT_VERSION,
    scopeKind: scope.kind, scope, audience: context.audience.toUpperCase(), ownerKind: context.actor.kind.toUpperCase(), ownerId: actorId,
    archivedAt: null, cancelRequestedAt: status === "CANCEL_REQUESTED" ? new Date(now) : null, eventCursor: 7n,
    ...(context.actor.kind === "automation" ? { policyId: context.actor.policyId, policyRevision: context.actor.policyRevision, policyExpiresAt: new Date(context.actor.expiresAt) } : {}) };
  const state = { context: structuredClone(context), task, calls: [], authError: false, beforeWrite: null, throwAfterWrite: false,
    steps: [{ id: "step-1", actionId: "original-action", requestFingerprint: "a".repeat(64), status: "UNKNOWN", effect: "POSSIBLE" }],
    run: { id: command.runId, taskId: command.taskId, revision: 4, fencingToken: BigInt(command.expectedFencingToken), status: "RUNNING",
      leaseOwnerId: "worker-old", leaseExpiresAt: new Date(now.getTime() - 1), actorKind: task.ownerKind, actorId } };
  const authority = { resolve: async (taskId, operation) => {
    state.calls.push({ kind: "authorize", taskId, operation });
    if (state.authError) throw new Error("synthetic private auth detail");
    return structuredClone(state.context);
  } };
  const db = { aiTask: {}, aiRun: { updateMany: async args => {
    state.calls.push({ kind: "run.cas", args });
    if (state.beforeWrite) state.beforeWrite(args);
    if (!matches({ ...state.run, task: state.task }, args.where)) return { count: 0 };
    state.run.revision += args.data.revision.increment;
    if (args.data.fencingToken) state.run.fencingToken += BigInt(args.data.fencingToken.increment.toFixed(0));
    for (const key of ["leaseOwnerId", "leaseExpiresAt", "actorKind", "actorId", "authorizedAt"]) if (key in args.data) state.run[key] = args.data[key];
    if (state.throwAfterWrite) throw new Error("synthetic ambiguous acknowledgement with private SQL detail");
    return { count: 1 };
  } } };
  return { state, repository: new AiTaskRepository(db, authority, () => new Date(now)) };
}

for (const status of ["WAITING_INPUT", "WAITING_CONFIRMATION", "WAITING_EXTERNAL", "CANCEL_REQUESTED"]) test(`recovery of ${status} fences the original run without resuming or redispatching`, async () => {
  const { state, repository } = setup(status), task = structuredClone(state.task), steps = structuredClone(state.steps);
  const result = await repository.claimRecoveryRun(command);
  assert.deepEqual(state.calls.map(call => call.kind), ["authorize", "run.cas"]);
  assert.equal(state.calls[0].operation, "claim_recovery_run");
  assert.equal(result.purpose, "recovery_only"); assert.equal(result.runId, command.runId);
  assert.equal(result.fencingToken, "9007199254740994"); assert.equal(result.revision, 5);
  assert.equal(result.expiresAt, "2026-10-03T00:01:05.000Z");
  assert.deepEqual(state.task, task); assert.deepEqual(state.steps, steps);
  assert.equal(state.run.leaseOwnerId, "worker-new"); assert.equal(state.run.actorId, "user-test");
  const { where, data } = state.calls[1].args;
  assert.equal(where.task.is.contractVersion, AI_TASK_DRAFT_VERSION);
  assert.equal(where.task.is.revision, command.expectedTaskRevision);
  assert.equal("status" in data, false); assert.equal("task" in data, false);
  assert.equal("inputRef" in result, false); assert.equal("steps" in result, false);
});

for (const status of ["QUEUED", "RUNNING", "SUCCEEDED", "PARTIALLY_SUCCEEDED", "FAILED", "CANCELLED"]) test(`recovery-only claim does not acquire ${status}`, async () => {
  const { state, repository } = setup(status);
  await assert.rejects(repository.claimRecoveryRun(command), code("AI_REVISION_CONFLICT"));
  assert.equal(state.run.revision, 4); assert.equal(state.calls.length, 2);
});

for (const status of ["WAITING_INPUT", "WAITING_CONFIRMATION", "WAITING_EXTERNAL", "CANCEL_REQUESTED"]) test(`ordinary execution claim still refuses ${status}`, async () => {
  const { state, repository } = setup(status);
  await assert.rejects(repository.claimRun(command), code("AI_REVISION_CONFLICT"));
  assert.equal(state.run.leaseOwnerId, "worker-old");
});

for (const context of h.contexts) test(`recovery scope/owner/audience filter is effective for ${context.actor.kind}/${context.audience}`, async () => {
  const { state, repository } = setup("WAITING_EXTERNAL", context);
  await repository.claimRecoveryRun(command);
  const filter = state.calls[1].args.where.task.is;
  assert.deepEqual(filter.scope, { is: aiPersistenceScopeColumns(context.scope) });
  assert.equal(filter.ownerId, state.task.ownerId); assert.equal(filter.ownerKind, state.task.ownerKind);
  assert.equal(filter.audience, state.task.audience); assert.equal(filter.archivedAt, null);
  assert.equal(state.run.actorId, state.task.ownerId); assert.equal(state.run.actorKind, state.task.ownerKind);
  if (context.actor.kind === "automation") {
    assert.equal(filter.policyId, context.actor.policyId); assert.equal(filter.policyRevision, context.actor.policyRevision);
    assert.deepEqual(filter.policyExpiresAt, { gt: now });
  }
});

for (const [label, mutate] of [
  ["archived", s => { s.task.archivedAt = now; }],
  ["old contract", s => { s.task.contractVersion = "old"; }],
  ["other task", s => { s.run.taskId = "task-other"; }],
  ["other run", s => { s.run.id = "run-other"; }],
  ["other owner", s => { s.task.ownerId = "other-owner"; }],
  ["other audience", s => { s.task.audience = "STAFF"; }],
  ["other tenant", s => { s.task.scope.tenantId = "other-tenant"; }],
  ["other workspace", s => { s.task.scope.workspaceId = "other-space"; }],
  ["live lease", s => { s.run.leaseExpiresAt = new Date(now.getTime() + 1); }],
  ["partial lease", s => { s.run.leaseOwnerId = null; }],
  ["missing lease expiry", s => { s.run.leaseExpiresAt = null; }],
  ["terminal run", s => { s.run.status = "SUCCEEDED"; }],
  ["advanced task revision", s => { s.task.revision++; }],
  ["advanced run revision", s => { s.run.revision++; }],
  ["advanced fence", s => { s.run.fencingToken++; }],
  ["waiting state with cancellation marker", s => { s.task.cancelRequestedAt = now; }],
  ["cancelling state without marker", s => { s.task.status = "CANCEL_REQUESTED"; }]
]) test(`CAS rejects ${label} without another write or read`, async () => {
  const { state, repository } = setup(); mutate(state); const before = structuredClone(state.run);
  await assert.rejects(repository.claimRecoveryRun(command), code("AI_REVISION_CONFLICT"));
  assert.deepEqual(state.run, before); assert.equal(state.calls.length, 2);
});

for (const kind of ["released", "expiry_boundary"]) test(`${kind} lease can be acquired with a new fence`, async () => {
  const { state, repository } = setup();
  if (kind === "released") { state.run.leaseOwnerId = null; state.run.leaseExpiresAt = null; }
  else state.run.leaseExpiresAt = now;
  assert.equal((await repository.claimRecoveryRun(command)).fencingToken, "9007199254740994");
});

test("competing claims have one CAS winner; former holder cannot release the replacement", async () => {
  const { state, repository } = setup();
  const results = await Promise.allSettled([repository.claimRecoveryRun(command), repository.claimRecoveryRun({ ...command, holderId: "worker-racing" })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "AI_REVISION_CONFLICT");
  assert.equal(state.run.fencingToken, 9007199254740994n);
  const { leaseMs, ...release } = command;
  await assert.rejects(repository.releaseRun({ ...release, holderId: "worker-old" }), code("AI_REVISION_CONFLICT"));
  assert.equal(state.run.leaseOwnerId, "worker-new");
  assert.deepEqual(await repository.releaseRun({ ...release, expectedRunRevision: 5, expectedFencingToken: "9007199254740994" }), { released: true, revision: 6 });
});

test("state/cancellation race is evaluated at CAS, not from a prior snapshot", async () => {
  const { state, repository } = setup();
  state.beforeWrite = () => { state.task.status = "CANCEL_REQUESTED"; state.task.cancelRequestedAt = now; state.task.revision++; };
  await assert.rejects(repository.claimRecoveryRun(command), code("AI_REVISION_CONFLICT"));
  assert.equal(state.run.revision, 4); assert.equal(state.task.cancelRequestedAt, now);
});

test("revoked authority and expired automation cannot claim even an expired lease", async () => {
  const denied = setup(); denied.state.authError = true;
  await assert.rejects(denied.repository.claimRecoveryRun(command), code("AI_ACCESS_DENIED"));
  assert.equal(denied.state.calls.length, 1);
  const expired = setup("WAITING_EXTERNAL", h.contexts[4]); expired.state.context.actor.expiresAt = now.toISOString();
  await assert.rejects(expired.repository.claimRecoveryRun(command), code("AI_ACCESS_DENIED"));
  assert.equal(expired.state.calls.length, 1);
  const changed = setup("WAITING_EXTERNAL", h.contexts[4]); changed.state.task.policyRevision++;
  await assert.rejects(changed.repository.claimRecoveryRun(command), code("AI_REVISION_CONFLICT"));
});

test("ambiguous acknowledgement exposes no lease and never retries", async () => {
  const { state, repository } = setup(); state.throwAfterWrite = true;
  await assert.rejects(repository.claimRecoveryRun(command), code("AI_STORAGE_UNAVAILABLE"));
  assert.equal(state.calls.filter(c => c.kind === "run.cas").length, 1);
  assert.equal(state.run.revision, 5, "test models a write that may have committed, not a rollback guarantee");
});

test("untrusted recovery fields and invalid lease ranges are rejected before authorization", async () => {
  for (const patch of [{ tenantId: "forged" }, { actorId: "forged" }, { audience: "operator" }, { purpose: "execute" }, { cancelRequestedAt: null }, { steps: [] }, { expectedFencingToken: "0" }, { expectedFencingToken: "99999999999999999999" }, { expectedFencingToken: 1 }, { expectedRunRevision: 4294967295 }, { expectedTaskRevision: 0 }, { leaseMs: 0 }, { leaseMs: 120001 }]) {
    const { state, repository } = setup();
    await assert.rejects(repository.claimRecoveryRun({ ...command, ...patch }), code("AI_INVALID_INPUT"));
    assert.equal(state.calls.length, 0);
  }
});

test("scope-filter mutation oracle distinguishes a safe claim from a bypassed predicate", async () => {
  const safe = setup(); safe.state.task.scope.tenantId = "other-tenant";
  await assert.rejects(safe.repository.claimRecoveryRun(command), code("AI_REVISION_CONFLICT"));
  const mutant = setup(); mutant.state.task.scope.tenantId = "other-tenant";
  mutant.state.beforeWrite = args => { delete args.where.task.is.scope; };
  assert.equal((await mutant.repository.claimRecoveryRun(command)).purpose, "recovery_only", "unsafe mutant must violate the cross-tenant rejection oracle");
});

test("ordinary execution also refuses an unsupported stored task version", async () => {
  const { state, repository } = setup("RUNNING"); state.task.contractVersion = "old";
  await assert.rejects(repository.claimRun(command), code("AI_REVISION_CONFLICT"));
});
