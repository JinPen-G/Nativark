"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node", target: "es2022" } });
const { AiTaskEventRepository } = require("../apps/api/src/modules/ai-native/ai-task-event.repository");
const { AiTaskRepositoryError } = require("../apps/api/src/modules/ai-native/ai-task.repository");
const { aiPersistenceScopeColumns } = require("../apps/api/src/modules/ai-native/persistence-scope");
const now = new Date("2026-10-03T00:01:00Z");
const event = (cursor = 1n, taskRevision = 2) => ({ scopeId: "scope-1", taskId: "task-1", cursor, taskRevision, type: "task.transition", occurredAt: now, payload: { data: { from: "queued", to: "running", reason: "start" }, initiator: { actorId: "internal-actor", holderId: "internal-worker" }, privateAudit: "neverReturn" } });
const input = { taskId: "task-1", after: "0", limit: 1 };
function setup() {
  const state = {
    task: { id: "task-1", scopeId: "scope-1", revision: 3, contractVersion: "ain-c04-draft-1", eventCursor: 2n },
    rows: [event(), event(2n, 3)], context: structuredClone(h.contexts[0]), calls: [], denyAt: 0, changeAt: 0, fail: null
  };
  let resolutions = 0;
  const authority = { resolve: async (taskId, operation) => {
    resolutions++; state.calls.push({ kind: "authorize", taskId, operation });
    if (state.denyAt === resolutions) throw Error("private auth reason");
    if (state.changeAt === resolutions) return { ...state.context, scope: { ...h.scope, workspaceId: "other-space" } };
    return state.context;
  } };
  const db = { aiTask: {}, aiRun: {}, $transaction: async (callback, options) => {
    state.calls.push({ kind: "transaction", options });
    const result = await callback({
      aiTask: { findFirst: async args => { state.calls.push({ kind: "task.read", args }); return state.task; } },
      aiTaskEvent: { findMany: async args => { state.calls.push({ kind: "events.read", args }); if (state.fail === "events") throw Error("SQL or raw private error"); return state.rows; } }
    });
    state.calls.push({ kind: "read.finished" });
    return result;
  } };
  return { state, repository: new AiTaskEventRepository(db, authority, () => new Date(now)) };
}
const code = expected => error => error instanceof AiTaskRepositoryError && error.code === expected && error.message === expected;
const get = (state, kind) => state.calls.find(call => call.kind === kind);

test("event page uses current scope/owner and a fixed task-local high-water cursor", async () => {
  const { state, repository } = setup();
  const page = await repository.readPage(input);
  assert.deepEqual(state.calls.map(call => call.kind), ["authorize", "transaction", "task.read", "events.read", "read.finished", "authorize"]);
  assert.equal(state.calls[0].operation, "read_events");
  assert.deepEqual(get(state, "transaction").options, { isolationLevel: "RepeatableRead", maxWait: 2500, timeout: 5000 });
  const taskWhere = get(state, "task.read").args.where;
  assert.deepEqual(taskWhere.scope, { is: aiPersistenceScopeColumns(h.scope) });
  assert.equal(taskWhere.ownerId, "user-test"); assert.equal(taskWhere.audience, "OPERATOR"); assert.equal(taskWhere.archivedAt, null);
  const query = get(state, "events.read").args;
  assert.deepEqual(query.where, { scopeId: "scope-1", taskId: "task-1", cursor: { gt: 0n, lte: 2n } });
  assert.deepEqual(query.orderBy, { cursor: "asc" }); assert.equal(query.take, 2);
  assert.equal(page.events.length, 1); assert.equal(page.nextCursor, "1"); assert.equal(page.hasMore, true);
  assert.equal(page.events[0].cursor, "1"); assert.equal(page.events[0].taskRevision, 2);
  assert.equal(JSON.stringify(page).includes("internal-actor"), false);
  assert.equal(JSON.stringify(page).includes("internal-worker"), false);
  assert.equal(JSON.stringify(page).includes("neverReturn"), false);
});

test("all declared event variants decode only their permitted wire fields", async () => {
  const variants = [
    ["task.transition", { from: "running", to: "cancel_requested", reason: "cancel_requested" }],
    ["step.changed", { stepId: "step-1", runId: "run-1", stepRevision: 2, status: "unknown", reason: "result_unknown" }],
    ["task.output_ready", { resultId: "result-1" }],
    ["access.revoked", { code: "AI_SCOPE_CHANGED" }]
  ];
  for (const [type, data] of variants) {
    const { state, repository } = setup(); state.rows = [{ ...event(), type, payload: { data, initiator: { secret: "not-wire" } } }];
    const page = await repository.readPage({ ...input, limit: 100 });
    assert.equal(page.events[0].type, type); assert.deepEqual(page.events[0].data, data);
    assert.equal("payload" in page.events[0], false); assert.equal("initiator" in page.events[0], false);
  }
});

test("empty caught-up page preserves cursor and is also reauthorized", async () => {
  const { state, repository } = setup(); state.rows = [];
  const page = await repository.readPage({ ...input, after: "2" });
  assert.deepEqual(page, { contractVersion: "ain-c04-draft-1", taskId: "task-1", events: [], nextCursor: "2", hasMore: false });
  assert.equal(state.calls.filter(c => c.kind === "authorize").length, 2);
});

test("empty unavailable history requires reset, and unsupported versions are never silently upgraded", async () => {
  const a = setup(); a.state.rows = [];
  assert.deepEqual(await a.repository.readPage(input), { contractVersion: "ain-c04-draft-1", taskId: "task-1", status: "reset_required", reason: "cursor_expired" });
  const b = setup(); b.state.task.contractVersion = "old-v0";
  assert.deepEqual(await b.repository.readPage(input), { contractVersion: "ain-c04-draft-1", taskId: "task-1", status: "reset_required", reason: "unsupported_version" });
  assert.equal(b.state.calls.some(c => c.kind === "events.read"), false);
  assert.equal(b.state.calls.filter(c => c.kind === "authorize").length, 2);
});

test("reauthorization loss or scope change after database read withholds buffered events", async () => {
  for (const field of ["denyAt", "changeAt"]) {
    const { state, repository } = setup(); state[field] = 2;
    await assert.rejects(repository.readPage(input), code("AI_ACCESS_DENIED"));
    assert.ok(get(state, "events.read")); assert.ok(get(state, "read.finished"));
  }
  const { state, repository } = setup(); state.denyAt = 1;
  await assert.rejects(repository.readPage(input), code("AI_ACCESS_DENIED"));
  assert.equal(state.calls.some(c => c.kind === "transaction"), false);
});

test("invalid page controls or foreign fields never reach authorization or the database", async () => {
  for (const patch of [{ after: "01" }, { after: "-1" }, { after: "18446744073709551616" }, { after: 1 }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { scopeId: "other" }, { audience: "operator" }, { tenantId: "forged" }, { taskId: "" }]) {
    const { state, repository } = setup();
    await assert.rejects(repository.readPage({ ...input, ...patch }), code("AI_INVALID_INPUT"));
    assert.equal(state.calls.length, 0);
  }
});

test("future cursor cannot manufacture progress beyond the visible task snapshot", async () => {
  const { state, repository } = setup();
  await assert.rejects(repository.readPage({ ...input, after: "3" }), code("AI_INVALID_INPUT"));
  assert.equal(state.calls.some(c => c.kind === "events.read"), false);
});

test("cross-task rows, duplicates, backwards revisions and above-snapshot rows fail closed", async () => {
  for (const rows of [
    [{ ...event(), taskId: "task-2" }], [{ ...event(), scopeId: "scope-2" }],
    [event(), event()], [event(2n), event(1n)], [event(1n, 3), event(2n, 2)],
    [event(3n)], [event(1n, 4)], [event(1n, 0)]
  ]) {
    const { state, repository } = setup(); state.rows = rows;
    await assert.rejects(repository.readPage({ ...input, limit: 100 }), code("AI_STORAGE_UNAVAILABLE"));
  }
});

test("invalid stored payloads cannot emit arbitrary data or raw parse errors", async () => {
  for (const patch of [
    { payload: { data: { resultId: "r1", apiKey: "synthetic" } }, type: "task.output_ready" },
    { payload: { data: { url: "https://untrusted.invalid" } }, type: "task.output_ready" },
    { type: "arbitrary.html" }, { payload: "synthetic private text" },
    { payload: { data: { code: "P2025" } }, type: "access.revoked" },
    { occurredAt: new Date(NaN) }
  ]) {
    const { state, repository } = setup(); state.rows = [{ ...event(), ...patch }];
    await assert.rejects(repository.readPage(input), code("AI_STORAGE_UNAVAILABLE"));
  }
});

test("large cursors remain exact strings and legitimate gaps do not become duplicates", async () => {
  const { state, repository } = setup(); state.task.eventCursor = 9007199254740995n;
  state.rows = [event(9007199254740993n, 2), event(9007199254740995n, 3)];
  const page = await repository.readPage({ ...input, after: "9007199254740992", limit: 100 });
  assert.deepEqual(page.events.map(e => e.cursor), ["9007199254740993", "9007199254740995"]);
  assert.equal(page.nextCursor, "9007199254740995"); assert.equal(page.hasMore, false);
});

test("platform tasks do not invent a tenant and missing tasks use generic errors", async () => {
  const a = setup(); a.state.context = h.contexts[3]; await a.repository.readPage(input);
  assert.deepEqual(get(a.state, "task.read").args.where.scope, { is: { kind: "PLATFORM", scopeKey: "platform", tenantId: null, workspaceId: null } });
  const b = setup(); b.state.task = null;
  await assert.rejects(b.repository.readPage(input), code("AI_RESOURCE_UNAVAILABLE"));
  const c = setup(); c.state.fail = "events";
  await assert.rejects(c.repository.readPage(input), code("AI_STORAGE_UNAVAILABLE"));
});
