"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
const fs = require("node:fs"), path = require("node:path"), { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."), apiRequire = createRequire(path.join(root, "apps/api/package.json"));
assert.ok(fs.realpathSync(apiRequire.resolve("@prisma/client")).startsWith(fs.realpathSync(path.join(root, "apps/api/node_modules/@prisma/client")) + path.sep));
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node", target: "es2022" } });
const { AiTaskRepository, AiTaskRepositoryError } = require("../apps/api/src/modules/ai-native/ai-task.repository");
const { aiPersistenceScopeColumns } = require("../apps/api/src/modules/ai-native/persistence-scope");
const now = new Date("2026-10-03T00:01:00Z");
const row = { id: "task-1", status: "RUNNING", revision: 3, sceneCode: "order-explain", sceneVersion: "1", createdAt: now, updatedAt: now, cancelRequestedAt: null };
const claim = { taskId: "task-1", runId: "run-1", holderId: "worker-1", expectedTaskRevision: 3, expectedRunRevision: 4, expectedFencingToken: "9007199254740993", leaseMs: 5000 };
function setup(context = h.contexts[0]) {
  const calls = [], state = { context: structuredClone(context), row: { ...row }, count: 1, authError: null, storageError: null };
  const authority = { resolve: async (taskId, operation) => { calls.push({ method: "authorize", taskId, operation }); if (state.authError) throw state.authError; return state.context; } };
  const db = {
    aiTask: { findFirst: async args => { calls.push({ method: "findFirst", args }); if (state.storageError) throw state.storageError; return state.row; } },
    aiRun: { updateMany: async args => { calls.push({ method: "updateMany", args }); if (state.storageError) throw state.storageError; return { count: state.count }; } }
  };
  return { repository: new AiTaskRepository(db, authority, () => new Date(now)), calls, state, db, authority };
}
const code = expected => error => error instanceof AiTaskRepositoryError && error.code === expected && error.message === expected;

for (const context of h.contexts) test(`metadata query is scope/owner restricted for ${context.actor.kind}/${context.audience}`, async () => {
  const s = setup(context);
  const result = await s.repository.readMetadata("task-1");
  assert.equal(s.calls[0].method, "authorize");
  assert.equal(s.calls[0].operation, "read_metadata");
  const query = s.calls[1].args;
  assert.equal(query.where.id, "task-1");
  assert.equal(query.where.archivedAt, null);
  assert.deepEqual(query.where.scope, { is: aiPersistenceScopeColumns(context.scope) });
  assert.equal(query.where.scopeKind, context.scope.kind.toUpperCase());
  assert.equal(query.where.audience, context.audience.toUpperCase());
  assert.equal(query.where.ownerKind, context.actor.kind.toUpperCase());
  assert.equal(query.where.ownerId, context.actor.userId ?? context.actor.customerId ?? context.actor.subjectId);
  if (context.actor.kind === "automation") {
    assert.equal(query.where.policyId, context.actor.policyId);
    assert.equal(query.where.policyRevision, context.actor.policyRevision);
    assert.deepEqual(query.where.policyExpiresAt, { gt: now });
  }
  assert.deepEqual(Object.keys(query.select).sort(), Object.keys(row).sort());
  assert.equal(result.status, "running");
  assert.equal(result.createdAt, now.toISOString());
  assert.equal("ownerId" in result, false);
  assert.equal("inputRef" in result, false);
  assert.equal("resultRef" in result, false);
});

test("missing authority fails closed and every call resolves current authorization", async () => {
  assert.throws(() => new AiTaskRepository({}, null), code("AI_ACCESS_DENIED"));
  const s = setup();
  await s.repository.readMetadata("task-1");
  s.state.authError = new Error("sensitive denial");
  await assert.rejects(s.repository.readMetadata("task-1"), code("AI_ACCESS_DENIED"));
  assert.equal(s.calls.filter(c => c.method === "authorize").length, 2);
  assert.equal(s.calls.filter(c => c.method === "findFirst").length, 1);
});

test("forged or incomplete returned identity and expired automation never reach the database", async () => {
  for (const context of [
    { ...h.contexts[0], audience: "client" },
    { ...h.contexts[0], scope: { kind: "platform" } },
    { ...h.contexts[0], scope: { kind: "workspace", tenantId: "tenant-test" } },
    { ...h.contexts[3], scope: h.scope },
    { ...h.contexts[0], contractVersion: "old" },
    { ...h.contexts[0], authorizedAt: "2026-10-03T00:02:00Z" },
    { ...h.contexts[4], actor: { ...h.contexts[4].actor, expiresAt: now.toISOString() } }
  ]) {
    const s = setup(context);
    await assert.rejects(s.repository.readMetadata("task-1"), code("AI_ACCESS_DENIED"));
    assert.equal(s.calls.length, 1);
  }
});

test("missing rows do not disclose existence and storage errors do not leak provider details", async () => {
  const s = setup(); s.state.row = null;
  await assert.rejects(s.repository.readMetadata("task-1"), code("AI_RESOURCE_UNAVAILABLE"));
  s.state.storageError = new Error("SQL server address and private input");
  await assert.rejects(s.repository.readMetadata("task-1"), code("AI_STORAGE_UNAVAILABLE"));
});

test("claim is a single conditional write tied to task/owner/revision and expired or absent lease", async () => {
  const s = setup(), original = structuredClone(claim);
  const result = await s.repository.claimRun(claim);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].operation, "claim_run");
  const { where, data } = s.calls[1].args;
  assert.equal(where.id, claim.runId); assert.equal(where.taskId, claim.taskId);
  assert.equal(where.revision, claim.expectedRunRevision);
  assert.equal(where.fencingToken.toString(), claim.expectedFencingToken);
  assert.deepEqual(where.status, { in: ["QUEUED", "RUNNING"] });
  assert.equal(where.task.is.revision, claim.expectedTaskRevision);
  assert.deepEqual(where.task.is.status, { in: ["QUEUED", "RUNNING"] });
  assert.equal(where.task.is.cancelRequestedAt, null);
  assert.equal(where.task.is.ownerId, h.contexts[0].actor.userId);
  assert.deepEqual(where.task.is.scope, { is: aiPersistenceScopeColumns(h.scope) });
  assert.deepEqual(where.OR, [{ leaseOwnerId: null, leaseExpiresAt: null }, { leaseOwnerId: { not: null }, leaseExpiresAt: { lte: now } }]);
  assert.deepEqual(data.revision, { increment: 1 });
  assert.equal(data.fencingToken.increment.toString(), "1");
  assert.equal(data.actorId, h.contexts[0].actor.userId); assert.equal(data.actorKind, "USER");
  assert.equal(data.leaseOwnerId, claim.holderId);
  assert.deepEqual(data.authorizedAt, new Date(h.contexts[0].authorizedAt));
  assert.deepEqual(result, { taskId: claim.taskId, runId: claim.runId, holderId: claim.holderId, revision: 5, fencingToken: "9007199254740994", expiresAt: "2026-10-03T00:01:05.000Z" });
  assert.deepEqual(claim, original);
});

test("CAS zero match never reports a claimed run and does not retry or read another holder", async () => {
  const s = setup(); s.state.count = 0;
  await assert.rejects(s.repository.claimRun(claim), code("AI_REVISION_CONFLICT"));
  assert.equal(s.calls.filter(c => c.method === "updateMany").length, 1);
  assert.equal(s.calls.filter(c => c.method === "findFirst").length, 0);
  s.state.count = 2;
  await assert.rejects(s.repository.claimRun(claim), code("AI_REVISION_CONFLICT"));
});

test("identity, effect and unlimited-lease fields cannot be smuggled into claim inputs", async () => {
  for (const patch of [
    { taskId: "" }, { actorId: "forged" }, { tenantId: "other" }, { audience: "operator" }, { status: "RUNNING" },
    { leaseMs: 0 }, { leaseMs: 120001 }, { leaseMs: NaN }, { expectedRunRevision: 4294967295 },
    { expectedTaskRevision: 0 }, { expectedFencingToken: "01" }, { expectedFencingToken: "99999999999999999999" },
    { expectedFencingToken: 9007199254740993 }
  ]) {
    const s = setup();
    await assert.rejects(s.repository.claimRun({ ...claim, ...patch }), code("AI_INVALID_INPUT"));
    assert.equal(s.calls.length, 0);
  }
});

test("live scope changes are reflected in subsequent queries instead of retaining creation scope", async () => {
  const s = setup(); await s.repository.readMetadata("task-1");
  s.state.context = { ...s.state.context, scope: { ...h.scope, workspaceId: "new-space" } };
  await s.repository.claimRun(claim);
  const previous = s.calls.find(c => c.method === "findFirst").args.where.scope.is;
  const current = s.calls.find(c => c.method === "updateMany").args.where.task.is.scope.is;
  assert.equal(previous.workspaceId, "space-test"); assert.equal(current.workspaceId, "new-space");
  assert.notEqual(previous.scopeKey, current.scopeKey);
});

test("release checks the exact holder, live expiry, revision and fence, preserving the fence", async () => {
  const s = setup(), { leaseMs, ...input } = claim;
  const result = await s.repository.releaseRun(input);
  const { where, data } = s.calls[1].args;
  assert.equal(s.calls[0].operation, "release_run");
  assert.equal(where.revision, input.expectedRunRevision);
  assert.equal(where.fencingToken.toString(), input.expectedFencingToken);
  assert.equal(where.leaseOwnerId, input.holderId);
  assert.deepEqual(where.leaseExpiresAt, { gt: now });
  assert.equal(where.task.is.revision, input.expectedTaskRevision);
  assert.deepEqual(where.task.is.scope, { is: aiPersistenceScopeColumns(h.scope) });
  assert.deepEqual(data, { revision: { increment: 1 }, leaseOwnerId: null, leaseExpiresAt: null });
  assert.deepEqual(result, { released: true, revision: 5 });
  s.state.count = 0;
  await assert.rejects(s.repository.releaseRun(input), code("AI_REVISION_CONFLICT"));
  await assert.rejects(s.repository.releaseRun({ ...input, expectedFencingToken: "0" }), code("AI_INVALID_INPUT"));
});

test("denied claim or release does no conditional write", async () => {
  const s = setup(); s.state.authError = new Error("revoked");
  await assert.rejects(s.repository.claimRun(claim), code("AI_ACCESS_DENIED"));
  const { leaseMs, ...input } = claim;
  await assert.rejects(s.repository.releaseRun(input), code("AI_ACCESS_DENIED"));
  assert.equal(s.calls.filter(c => c.method === "updateMany").length, 0);
});
