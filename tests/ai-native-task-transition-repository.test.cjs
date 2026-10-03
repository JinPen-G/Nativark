"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
const fs = require("node:fs"), path = require("node:path"), { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."), apiRequire = createRequire(path.join(root, "apps/api/package.json"));
assert.ok(fs.realpathSync(apiRequire.resolve("@prisma/client")).startsWith(fs.realpathSync(path.join(root, "apps/api/node_modules/@prisma/client")) + path.sep));
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node", target: "es2022" } });
const { AiTaskTransitionRepository } = require("../apps/api/src/modules/ai-native/ai-task-transition.repository");
const { AiTaskRepositoryError } = require("../apps/api/src/modules/ai-native/ai-task.repository");
const { aiPersistenceScopeColumns } = require("../apps/api/src/modules/ai-native/persistence-scope");
const now = new Date("2026-10-03T00:01:00Z");
const command = { taskId: "task-1", expectedRevision: 3, to: "waiting_input", reason: "input_required", lease: { runId: "run-1", holderId: "worker-1", revision: 5, fencingToken: "9007199254740993" } };
const step = (status = "PENDING", effect = "NONE", n = 1) => ({ id: `step-${n}`, runId: "run-1", sequence: n, revision: 1, actionId: `action-${n}`, status, effect });
function setup() {
  const state = {
    task: { id: "task-1", scopeId: "scope-1", revision: 3, status: "RUNNING", contractVersion: "ain-c04-draft-1", eventCursor: 7n, cancelRequestedAt: null },
    steps: [step()], runRevision: 5, events: [], commits: 0, rollbacks: 0,
    context: structuredClone(h.contexts[0]), calls: [], fail: null, denyAt: 0, changeScopeAt: 0
  };
  let resolves = 0;
  const authority = { resolve: async (taskId, operation) => {
    resolves++; state.calls.push({ kind: "authorize", taskId, operation });
    if (state.denyAt === resolves) throw Error("synthetic revoked");
    if (state.changeScopeAt === resolves) return { ...state.context, scope: { ...h.scope, workspaceId: "other-space" } };
    return state.context;
  } };
  const db = {
    aiTask: {}, aiRun: {},
    $transaction: async (callback, options) => {
      state.calls.push({ kind: "transaction", options });
      const working = { task: structuredClone(state.task), runRevision: state.runRevision, events: [] };
      let updates = 0;
      const tx = {
        aiTask: {
          findFirst: async args => { state.calls.push({ kind: "task.read", args }); return state.fail === "hidden" ? null : structuredClone(working.task); },
          updateMany: async args => {
            updates++; state.calls.push({ kind: `task.update.${updates}`, args });
            if (state.fail === `task.update.${updates}` || args.where.revision !== working.task.revision) return { count: 0 };
            if (args.data.revision) working.task.revision += args.data.revision.increment;
            if (args.data.eventCursor) working.task.eventCursor += args.data.eventCursor.increment;
            if (args.data.status) working.task.status = args.data.status;
            if (args.data.cancelRequestedAt) working.task.cancelRequestedAt = args.data.cancelRequestedAt;
            return { count: 1 };
          }
        },
        aiStep: { findMany: async args => { state.calls.push({ kind: "steps.read", args }); return structuredClone(state.steps); } },
        aiRun: { updateMany: async args => { state.calls.push({ kind: "lease.update", args }); if (state.fail === "lease.update") return { count: 0 }; working.runRevision++; return { count: 1 }; } },
        aiTaskEvent: { create: async args => {
          state.calls.push({ kind: "event.create", args });
          if (state.fail === "event.create") throw Error("synthetic private DB failure");
          working.events.push(args.data); return { cursor: args.data.cursor };
        } }
      };
      try {
        const result = await callback(tx);
        if (state.fail === "commit") throw Error("synthetic connection loss at commit");
        state.task = working.task; state.runRevision = working.runRevision; state.events.push(...working.events); state.commits++;
        return result;
      } catch (error) { state.rollbacks++; throw error; }
    }
  };
  return { state, repository: new AiTaskTransitionRepository(db, authority, () => new Date(now)) };
}
const code = expected => error => error instanceof AiTaskRepositoryError && error.code === expected && error.message === expected;
const only = (state, kind) => state.calls.find(call => call.kind === kind).args;

test("state CAS and task-local event append share one bounded transaction", async () => {
  const { state, repository } = setup();
  const result = await repository.transition(command);
  assert.equal(state.commits, 1); assert.equal(state.rollbacks, 0);
  assert.deepEqual(state.calls.map(call => call.kind), ["authorize", "transaction", "task.read", "task.update.1", "steps.read", "authorize", "lease.update", "task.update.2", "event.create"]);
  assert.deepEqual(state.calls[1].options, { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 });
  assert.equal(state.task.status, "WAITING_INPUT"); assert.equal(state.task.revision, 4); assert.equal(state.task.eventCursor, 8n); assert.equal(state.runRevision, 6);
  assert.deepEqual(result, { event: { contractVersion: "ain-c04-draft-1", taskId: "task-1", cursor: "8", taskRevision: 4, occurredAt: now.toISOString(), type: "task.transition", data: { from: "running", to: "waiting_input", reason: "input_required" } }, runRevision: 6 });
  const data = only(state, "event.create").data;
  assert.equal(data.scopeId, "scope-1"); assert.equal(data.taskId, "task-1"); assert.equal(data.cursor, 8n);
  assert.deepEqual(data.payload.data, result.event.data);
  assert.deepEqual(data.payload.initiator, { kind: "worker", id: "worker-1", actorKind: "USER", actorId: "user-test" });
  assert.equal("initiator" in result.event, false);
});

test("every task query uses the same complete scope/owner filter and aggregate reads are bounded", async () => {
  const { state, repository } = setup(); await repository.transition(command);
  for (const kind of ["task.read", "task.update.1", "task.update.2"]) {
    const where = only(state, kind).where;
    assert.equal(where.id, "task-1"); assert.equal(where.ownerId, "user-test"); assert.equal(where.ownerKind, "USER");
    assert.equal(where.audience, "OPERATOR"); assert.equal(where.archivedAt, null);
    assert.deepEqual(where.scope, { is: aiPersistenceScopeColumns(h.scope) });
  }
  assert.deepEqual(only(state, "steps.read").where, { scopeId: "scope-1", taskId: "task-1" });
  assert.equal(only(state, "steps.read").take, 1001);
  const first = only(state, "task.update.1"), last = only(state, "task.update.2");
  assert.equal(first.where.revision, 3); assert.equal(first.where.eventCursor, 7n);
  assert.equal(last.where.revision, 4); assert.equal(last.where.eventCursor, 8n);
  assert.equal(last.where.status, "RUNNING");
});

test("worker transition fences the exact live lease and records the advanced revision", async () => {
  const { state, repository } = setup(); await repository.transition(command);
  const { where, data } = only(state, "lease.update");
  assert.equal(where.scopeId, "scope-1"); assert.equal(where.taskId, "task-1"); assert.equal(where.id, command.lease.runId);
  assert.equal(where.leaseOwnerId, command.lease.holderId); assert.equal(where.revision, 5);
  assert.equal(where.fencingToken.toString(), command.lease.fencingToken);
  assert.deepEqual(where.leaseExpiresAt, { gt: now });
  assert.equal(where.actorKind, "USER"); assert.equal(where.actorId, "user-test");
  assert.deepEqual(data, { revision: { increment: 1 } });
});

for (const failure of ["task.update.1", "lease.update", "task.update.2", "event.create", "commit"]) test(`transaction failure at ${failure} exposes no success and the test store rolls back`, async () => {
  const { state, repository } = setup(), before = structuredClone(state.task);
  state.fail = failure;
  await assert.rejects(repository.transition(command), code(["event.create", "commit"].includes(failure) ? "AI_STORAGE_UNAVAILABLE" : "AI_REVISION_CONFLICT"));
  assert.deepEqual(state.task, before); assert.equal(state.runRevision, 5); assert.equal(state.events.length, 0);
  assert.equal(state.commits, 0); assert.equal(state.rollbacks, 1);
  assert.equal(state.calls.filter(call => call.kind === "transaction").length, 1, "must not automatically retry ambiguous commits");
});

test("authorization loss or scope change after lock/read aborts before state/lease publication", async () => {
  for (const failure of ["denyAt", "changeScopeAt"]) {
    const { state, repository } = setup(); state[failure] = 2;
    await assert.rejects(repository.transition(command), code("AI_ACCESS_DENIED"));
    assert.equal(state.task.revision, 3); assert.equal(state.task.eventCursor, 7n); assert.equal(state.events.length, 0);
    assert.equal(state.calls.some(call => call.kind === "lease.update" || call.kind === "event.create"), false);
  }
  const { state, repository } = setup(); state.denyAt = 1;
  await assert.rejects(repository.transition(command), code("AI_ACCESS_DENIED"));
  assert.equal(state.calls.some(call => call.kind === "transaction"), false);
});

test("cancellation is a request event even with unknown steps, not successful rollback", async () => {
  const { state, repository } = setup(); state.steps = [step("UNKNOWN", "POSSIBLE")];
  const result = await repository.transition({ taskId: "task-1", expectedRevision: 3, to: "cancel_requested", reason: "cancel_requested" });
  assert.equal(result.runRevision, null); assert.equal(state.runRevision, 5);
  assert.equal(state.task.status, "CANCEL_REQUESTED"); assert.deepEqual(state.task.cancelRequestedAt, now);
  assert.equal(state.calls.some(call => call.kind === "lease.update"), false);
  assert.equal(result.event.data.to, "cancel_requested");
});

test("unknown or inconsistent effects cannot be terminal success or cancelled", async () => {
  for (const [from, to, reason, status, effect] of [
    ["RUNNING", "succeeded", "completed", "UNKNOWN", "POSSIBLE"],
    ["CANCEL_REQUESTED", "cancelled", "cancel_settled", "UNKNOWN", "POSSIBLE"],
    ["CANCEL_REQUESTED", "cancelled", "cancel_settled", "SUCCEEDED", "COMMITTED"],
    ["RUNNING", "succeeded", "completed", "UNKNOWN", "NONE"],
    ["RUNNING", "failed", "execution_failed", "FAILED", "COMMITTED"]
  ]) {
    const { state, repository } = setup(); state.task.status = from; state.steps = [step(status, effect)];
    await assert.rejects(repository.transition({ ...command, to, reason }), code("AI_INVALID_INPUT"));
    assert.equal(state.task.revision, 3); assert.equal(state.events.length, 0);
  }
});

test("mixed completed steps allow partial completion without inventing business fact references", async () => {
  const { state, repository } = setup(); state.steps = [step("SUCCEEDED", "COMMITTED"), step("FAILED", "NONE", 2)];
  const result = await repository.transition({ ...command, to: "partially_succeeded", reason: "completed" });
  assert.equal(result.event.data.to, "partially_succeeded");
  assert.equal("facts" in state.steps[0], false);
  assert.deepEqual(Object.keys(only(state, "steps.read").select).sort(), ["actionId", "effect", "id", "revision", "runId", "sequence", "status"]);
});

test("protocol, aggregate cap, revision and cursor overflow are rejected before publication", async () => {
  for (const setupCase of [
    state => { state.task.contractVersion = "old"; },
    state => { state.task.revision = 4; },
    state => { state.task.eventCursor = 18446744073709551615n; },
    state => { state.steps = Array.from({ length: 1001 }, (_, n) => step("PENDING", "NONE", n + 1)); },
    state => { state.steps = [step(), step()]; },
    state => { state.task.status = "SUCCEEDED"; }
  ]) {
    const { state, repository } = setup(); setupCase(state);
    await assert.rejects(repository.transition(command), AiTaskRepositoryError);
    assert.equal(state.events.length, 0); assert.equal(state.commits, 0);
  }
});

test("untrusted transition input cannot supply actor, status facts, clock or bypass worker lease", async () => {
  for (const patch of [
    { actor: "admin" }, { scope: h.scope }, { occurredAt: now.toISOString() }, { steps: [] }, { expectedRevision: 0 },
    { lease: undefined }, { lease: { ...command.lease, fencingToken: "0" } },
    { to: "cancel_requested", reason: "cancel_requested" }
  ]) {
    const { state, repository } = setup();
    await assert.rejects(repository.transition({ ...command, ...patch }), code("AI_INVALID_INPUT"));
    assert.equal(state.calls.length, 0);
  }
});

test("hidden or missing task has a generic failure and no mutation", async () => {
  const { state, repository } = setup(); state.fail = "hidden";
  await assert.rejects(repository.transition(command), code("AI_RESOURCE_UNAVAILABLE"));
  assert.equal(state.calls.some(call => call.kind.startsWith("task.update")), false);
});
