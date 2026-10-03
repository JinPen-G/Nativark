"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
const fs = require("node:fs"), path = require("node:path"), { execFileSync } = require("node:child_process"), { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."), apiRequire = createRequire(path.join(root, "apps/api/package.json"));
const { Prisma } = apiRequire("@prisma/client");
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node", target: "es2022", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AiTaskCreationRepository } = require("../apps/api/src/modules/ai-native/ai-task-creation.repository");
const { AiTaskRepositoryError } = require("../apps/api/src/modules/ai-native/ai-task.repository");
const { offlinePrismaSchema } = require("./fixtures/ai-native/prisma-offline.cjs");
const now = new Date("2026-10-03T00:01:00Z");
const input = { creationKey: "client-operation-1", sceneCode: "order-explain", inputRef: "frozen-input-1" };
const duplicate = () => new Prisma.PrismaClientKnownRequestError("private unique detail", { code: "P2002", clientVersion: "5.22.0" });
function setup(context = h.contexts[0]) {
  const state = { tasks: [], runs: [], calls: [], commits: 0, rollbacks: 0, fail: null, denyAt: 0, changeAt: 0, corruptScope: false,
    grant: { context: structuredClone(context), creationAllowed: true, sceneCode: input.sceneCode, sceneVersion: "v1", inputRef: input.inputRef, inputRevision: 1, inputHash: "1".repeat(64) } };
  let resolves = 0, sequence = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  const authority = { resolve: async (sceneCode, inputRef) => {
    resolves++; state.calls.push({ kind: "authorize", sceneCode, inputRef });
    if (state.denyAt === resolves) throw Error("private revoked");
    if (state.changeAt === resolves) return { ...state.grant, context: { ...state.grant.context, scope: { ...h.scope, workspaceId: "other-space" } } };
    return state.grant;
  } };
  const find = (tasks, runs, args) => {
    state.calls.push({ kind: "task.read", args });
    const task = tasks.find(t => t.creationKey === args.where.creationKey && t.ownerId === args.where.ownerId && t.audience === args.where.audience);
    return task ? { ...task, archivedAt: task.archivedAt ?? null, runs: runs.filter(r => r.taskId === task.id && r.sequence === 1).map(r => ({ id: r.id })) } : null;
  };
  const db = { aiScope: {}, aiTask: { findFirst: async args => find(state.tasks, state.runs, args) }, $transaction: async (callback, options) => {
    state.calls.push({ kind: "transaction", options });
    const tasks = structuredClone(state.tasks), runs = structuredClone(state.runs);
    let currentTask;
    const tx = {
      aiScope: { upsert: async args => { state.calls.push({ kind: "scope.upsert", args }); return { id: "scope-1", ...args.create, ...(state.corruptScope ? { scopeKey: args.create.scopeKey.toUpperCase() } : {}) }; } },
      aiTask: {
        findFirst: async args => find(tasks, runs, args),
        create: async args => {
          state.calls.push({ kind: "task.create", args }); currentTask = { ...args.data };
          if (state.fail === "winner") {
            state.tasks.push({ ...args.data, id: "winner-task" });
            state.runs.push({ id: "winner-run", taskId: "winner-task", sequence: 1 });
            throw duplicate();
          }
          if (state.fail === "unique-no-winner") throw duplicate();
          tasks.push(currentTask); return { id: currentTask.id };
        }
      },
      aiRun: { create: async args => { state.calls.push({ kind: "run.create", args }); if (state.fail === "run") throw Error("private DB detail"); runs.push({ ...args.data, fencingToken: args.data.fencingToken.toString() }); return { id: args.data.id }; } }
    };
    try {
      const result = await callback(tx);
      if (state.fail === "commit") throw Error("response lost at commit");
      state.tasks = tasks; state.runs = runs; state.commits++; return result;
    } catch (error) { state.rollbacks++; throw error; }
  } };
  return { state, repository: new AiTaskCreationRepository(db, authority, () => new Date(now), newId) };
}
const code = expected => error => error instanceof AiTaskRepositoryError && error.code === expected && error.message === expected;
const normal = value => value.replace(/\r\n/gu, "\n");

test("creation-key migration is additive and independently reproducible without DB execution", { timeout: 120000 }, () => {
  const before = execFileSync("git", ["show", "de6fd4b:apps/api/prisma/schema.prisma"], { cwd: root, encoding: "utf8" });
  // Reproduce this immutable migration from its committed target schema, not future schema additions.
  const schema = execFileSync("git", ["show", "616ff60:apps/api/prisma/schema.prisma"], { cwd: root, encoding: "utf8" });
  const result = offlinePrismaSchema(schema, before);
  assert.equal(result.violations, "");
  const sql = fs.readFileSync(path.join(root, "apps/api/prisma/migrations/20261003070000_ai_task_creation_identity/migration.sql"), "utf8");
  const checks = fs.readFileSync(path.join(__dirname, "fixtures/ai-native/task-creation-checks.sql"), "utf8");
  assert.equal(normal(sql), normal("-- AIN-03/S06 creation identity; additive and unapplied.\n" + result.diff + "\n" + checks));
  assert.match(sql, /CREATE UNIQUE INDEX `ai_tasks_creation_key` ON `ai_tasks`\(`scopeId`, `audience`, `ownerKind`, `ownerId`, `creationKey`\)/u);
  assert.match(sql, /`creationKey` IS NULL AND `creationFingerprint` IS NULL/u);
  assert.doesNotMatch(sql, /\b(?:DROP\s|DELETE\s+FROM|UPDATE\s+`)/iu);
});

test("current schema remains independently validated as later migrations evolve", { timeout: 120000 }, () => {
  const current = fs.readFileSync(path.join(root, "apps/api/prisma/schema.prisma"), "utf8");
  const result = offlinePrismaSchema(current);
  assert.match(result.validation, /schema.*valid/iu);
  assert.equal(result.violations, "");
});

test("task and first run are created atomically with identity and frozen input resolved by the server", async () => {
  const { state, repository } = setup();
  const result = await repository.create(input);
  assert.equal(result.replayed, false); assert.equal(result.status, "queued");
  assert.equal(state.tasks.length, 1); assert.equal(state.runs.length, 1);
  const task = state.tasks[0], run = state.runs[0];
  assert.equal(task.id, result.taskId); assert.equal(run.id, result.runId); assert.equal(run.taskId, task.id);
  assert.equal(task.ownerId, "user-test"); assert.equal(task.scopeKind, "WORKSPACE"); assert.equal(task.audience, "OPERATOR");
  assert.equal(task.inputRevision, 1); assert.equal(task.inputHash, "1".repeat(64)); assert.equal(task.sceneVersion, "v1");
  assert.equal(task.eventCursor, 0n); assert.equal(run.sequence, 1); assert.equal(run.fencingToken.toString(), "0");
  assert.equal(run.leaseOwnerId, null); assert.equal(run.leaseExpiresAt, null);
  assert.deepEqual(state.calls.map(c => c.kind), ["authorize", "transaction", "scope.upsert", "task.read", "task.create", "run.create", "authorize"]);
  assert.equal(state.commits, 1);
});

test("same creation key replays the same task/run even after completion, without another create", async () => {
  const { state, repository } = setup();
  const first = await repository.create(input);
  state.tasks[0].status = "SUCCEEDED"; state.tasks[0].revision = 7;
  // Request IDs are trace metadata and may change on retry; they are not fingerprint input.
  state.grant.context.requestId = "retry-request";
  const replay = await repository.create({ inputRef: input.inputRef, sceneCode: input.sceneCode, creationKey: input.creationKey });
  assert.deepEqual(replay, { ...first, replayed: true, status: "succeeded", revision: 7 });
  assert.equal(state.tasks.length, 1); assert.equal(state.runs.length, 1);
  assert.equal(state.calls.filter(c => c.kind === "task.create").length, 1);
});

test("same key with changed frozen input or scene revision conflicts without creating another task", async () => {
  for (const patch of [{ inputHash: "2".repeat(64) }, { inputRevision: 2 }, { sceneVersion: "v2" }]) {
    const { state, repository } = setup(); await repository.create(input); Object.assign(state.grant, patch);
    await assert.rejects(repository.create(input), code("AI_REVISION_CONFLICT"));
    assert.equal(state.tasks.length, 1); assert.equal(state.runs.length, 1);
  }
});

test("run failure or commit failure returns no success and does not auto-repeat writes", async () => {
  for (const failure of ["run", "commit"]) {
    const { state, repository } = setup(); state.fail = failure;
    await assert.rejects(repository.create(input), code("AI_STORAGE_UNAVAILABLE"));
    assert.equal(state.tasks.length, 0); assert.equal(state.runs.length, 0); assert.equal(state.rollbacks, 1);
    assert.equal(state.calls.filter(c => c.kind === "transaction").length, 1);
  }
});

test("unique race reads a reauthorized winner and never retries creation", async () => {
  const { state, repository } = setup(); state.fail = "winner";
  const result = await repository.create(input);
  assert.deepEqual(result, { taskId: "winner-task", runId: "winner-run", status: "queued", revision: 1, replayed: true });
  assert.equal(state.calls.filter(c => c.kind === "transaction").length, 1);
  assert.equal(state.calls.filter(c => c.kind === "task.create").length, 1);
  assert.equal(state.calls.filter(c => c.kind === "authorize").length, 3);
  const lastRead = state.calls.filter(c => c.kind === "task.read").at(-1).args.where;
  assert.equal(lastRead.ownerId, "user-test"); assert.equal(lastRead.audience, "OPERATOR"); assert.equal(lastRead.creationKey, input.creationKey);
  assert.equal(lastRead.scope.is.tenantId, "tenant-test");
  const noWinner = setup(); noWinner.state.fail = "unique-no-winner";
  await assert.rejects(noWinner.repository.create(input), code("AI_REVISION_CONFLICT"));
});

test("reauthorization change inside creation rolls back and denied initial grant does no DB work", async () => {
  for (const field of ["denyAt", "changeAt"]) {
    const { state, repository } = setup(); state[field] = 2;
    await assert.rejects(repository.create(input), code("AI_ACCESS_DENIED"));
    assert.equal(state.tasks.length, 0); assert.equal(state.runs.length, 0);
  }
  const { state, repository } = setup(); state.denyAt = 1;
  await assert.rejects(repository.create(input), code("AI_ACCESS_DENIED"));
  assert.equal(state.calls.length, 1);
});

for (const context of [h.contexts[2], h.contexts[3], h.contexts[4]]) test(`creation preserves ${context.actor.kind} scope without using a default workspace`, async () => {
  const { state, repository } = setup(context); await repository.create(input);
  const task = state.tasks[0];
  assert.equal(task.ownerKind, context.actor.kind.toUpperCase()); assert.equal(task.audience, context.audience.toUpperCase());
  const scope = state.calls.find(c => c.kind === "scope.upsert").args.create;
  assert.equal(scope.kind, context.scope.kind.toUpperCase());
  if (context.scope.kind === "platform") { assert.equal(scope.tenantId, null); assert.equal(scope.workspaceId, null); }
  if (context.actor.kind === "automation") { assert.equal(task.policyId, context.actor.policyId); assert.equal(task.policyRevision, context.actor.policyRevision); }
});

test("invalid inputs or malformed creation grants cannot write metadata", async () => {
  for (const patch of [{ tenantId: "forged" }, { actor: "admin" }, { sceneVersion: "v9" }, { model: "fixed-model" }, { amount: 1 }, { creationKey: "" }, { creationKey: "x".repeat(129) }]) {
    const { state, repository } = setup();
    await assert.rejects(repository.create({ ...input, ...patch }), code("AI_INVALID_INPUT")); assert.equal(state.calls.length, 0);
  }
  for (const patch of [{ creationAllowed: false }, { sceneCode: "different" }, { inputRef: "other-input" }, { inputHash: "unhashed" }, { inputRevision: 0 }, { context: { ...h.contexts[0], audience: "client" } }]) {
    const { state, repository } = setup(); Object.assign(state.grant, patch);
    await assert.rejects(repository.create(input), code("AI_ACCESS_DENIED")); assert.equal(state.calls.length, 1);
  }
});

test("archived or unsupported historical tasks never reactivate, and incomplete first runs fail", async () => {
  for (const change of [
    s => { s.tasks[0].archivedAt = now; },
    s => { s.tasks[0].contractVersion = "future"; },
    s => { s.runs = []; }
  ]) {
    const { state, repository } = setup(); await repository.create(input); change(state);
    await assert.rejects(repository.create(input), AiTaskRepositoryError);
    assert.equal(state.calls.filter(c => c.kind === "task.create").length, 1);
  }
});

test("case-insensitive database scope matches do not silently become authority", async () => {
  const { state, repository } = setup(); state.corruptScope = true;
  await assert.rejects(repository.create(input), code("AI_ACCESS_DENIED"));
  assert.equal(state.tasks.length, 0); assert.equal(state.calls.some(c => c.kind === "task.create"), false);
});
