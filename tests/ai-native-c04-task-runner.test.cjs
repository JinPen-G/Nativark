"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node", target: "es2022" } });
const { AiTaskRunner, AiTaskRunnerError } = require(path.join(root, "apps/api/src/modules/ai-native/runner/ai-task-runner.service"));

const input = { taskId: "task-1", runId: "run-1", holderId: "worker-1", expectedTaskRevision: 3, expectedRunRevision: 4, expectedFencingToken: "8", leaseMs: 1000 };
const step = (registrationRef, operation = "readonly") => ({ registrationRef, operation, toolCode: "orders.read", toolVersion: "1" });
const limits = { maxSteps: 8, maxTotalMs: 1000, maxStepMs: 100, maxOutputBytes: 4096, maxConcurrent: 1, maxCalls: 8 };

function harness({ steps = [step("s1")], recovery = false, metadata = {}, effects = {}, clock } = {}) {
  let lease = { taskId: "task-1", runId: "run-1", holderId: "worker-1", revision: 5, fencingToken: "9", expiresAt: "2026-10-04T00:00:01.000Z" };
  let taskRevision = 3, reads = 0;
  const calls = [], commits = [];
  const leases = {
    readMetadata: async () => { reads += 1; return { taskId: "task-1", status: "running", revision: taskRevision, cancelRequestedAt: metadata.cancelAfterRead && reads > metadata.cancelAfterRead ? "2026-10-04T00:00:00.000Z" : null }; },
    claimRun: async () => { calls.push("claim"); return structuredClone(lease); },
    claimRecoveryRun: async () => { calls.push("recover"); return { ...structuredClone(lease), purpose: "recovery_only" }; },
    releaseRun: async value => { calls.push({ release: value }); return { released: true, revision: value.expectedRunRevision + 1 }; }
  };
  const registered = new Map();
  const stepPort = {
    register: async (plan, held) => { calls.push(["register", plan.registrationRef]); const value = registered.get(plan.registrationRef) ?? { stepId: `id-${plan.registrationRef}`, runId: held.runId, sequence: registered.size + 1, stepRevision: 1, taskRevision: ++taskRevision, replayed: false, existingStatus: null }; registered.set(plan.registrationRef, value); return structuredClone(value); },
    start: async (ref, held) => { calls.push(["start", ref.plan.registrationRef]); const result = { lease: { ...held, revision: held.revision + 1 }, taskRevision: ++taskRevision }; commits.push(result); return result; },
    succeed: async (ref, held, resultRef) => { calls.push(["succeed", ref.plan.registrationRef, resultRef]); const result = { lease: { ...held, revision: held.revision + 1 }, taskRevision: ++taskRevision }; commits.push(result); return result; },
    fail: async (ref, held, errorCode) => { calls.push(["fail", ref.plan.registrationRef, errorCode]); const result = { lease: { ...held, revision: held.revision + 1 }, taskRevision: ++taskRevision }; commits.push(result); return result; },
    pause: async (ref, held, pause) => { calls.push(["pause", ref.plan.registrationRef, pause]); const result = { lease: { ...held, revision: held.revision + 1 }, taskRevision: ++taskRevision }; commits.push(result); return result; },
    unknown: async (ref, held) => { calls.push(["unknown", ref.plan.registrationRef]); const result = { lease: { ...held, revision: held.revision + 1 }, taskRevision: ++taskRevision }; commits.push(result); return result; }
  };
  const effectCalls = [];
  const effectPort = { execute: async (plan, signal) => { effectCalls.push(["execute", plan.registrationRef, signal.aborted]); return { kind: "succeeded", resultRef: `result-${plan.registrationRef}`, outputBytes: 12 }; }, ...effects };
  const runner = new AiTaskRunner({ leases, steps: stepPort, plan: { resolve: async () => ({ taskId: "task-1", runId: "run-1", taskRevision, steps, limits }) }, effects: effectPort, clock });
  return { runner, calls, effectCalls, registered, commits, get lease() { return lease; }, recovery };
}

test("runner composes persisted lifecycle ports and releases the current fenced lease", async () => {
  const h = harness({ steps: [step("s1"), step("s2")] });
  assert.deepEqual(await h.runner.run(input), { status: "succeeded", completedSteps: 2, cleanupFailed: 0 });
  assert.deepEqual(h.effectCalls.map(value => value[1]), ["s1", "s2"]);
  assert.deepEqual(h.calls.filter(value => Array.isArray(value)).map(value => value[0]), ["register", "start", "succeed", "register", "start", "succeed"]);
  const release = h.calls.find(value => value && value.release).release;
  assert.equal(release.expectedRunRevision, 9, "release uses the latest step CAS revision");
  assert.equal(release.expectedTaskRevision, 9, "release uses the latest persisted task revision");
});

test("cancel request stops the next step without inventing rollback or a second effect", async () => {
  const h = harness({ steps: [step("s1", "idempotent"), step("s2", "idempotent")], metadata: { cancelAfterRead: 2 } });
  assert.deepEqual(await h.runner.run(input), { status: "cancel_requested", completedSteps: 1, cleanupFailed: 0 });
  assert.deepEqual(h.effectCalls.map(value => value[1]), ["s1"]);
  assert.equal(h.calls.some(value => Array.isArray(value) && value[1] === "s2"), false);
});

test("external timeout is persisted as unknown and is never retried", async () => {
  const timers = [];
  const clock = { now: () => 0, setTimeout: callback => { timers.push(callback); return callback; }, clearTimeout: () => {} };
  let resolveEffect;
  const h = harness({ steps: [step("network", "external_unknown")], clock, effects: { execute: () => new Promise(resolve => { resolveEffect = resolve; }) } });
  const pending = h.runner.run(input);
  for (let i = 0; i < 8 && timers.length === 0; i++) await Promise.resolve();
  assert.equal(timers.length > 0, true);
  timers.shift()();
  assert.deepEqual(await pending, { status: "unknown", completedSteps: 0, cleanupFailed: 0 });
  assert.deepEqual(h.calls.filter(value => Array.isArray(value)).map(value => value[0]), ["register", "start", "unknown"]);
  assert.equal(h.effectCalls.length, 0);
  resolveEffect?.({ kind: "succeeded", resultRef: "late", outputBytes: 1 });
});

test("recovery reconciles an unknown external step and never calls execute", async () => {
  const h = harness({ steps: [step("network", "external_unknown")], effects: { execute: async () => { throw new Error("must not dispatch"); }, reconcile: async () => ({ kind: "succeeded", resultRef: "observed", outputBytes: 2 }) } });
  assert.deepEqual(await h.runner.run({ ...input, recovery: true }), { status: "succeeded", completedSteps: 1, cleanupFailed: 0 });
  assert.deepEqual(h.calls.filter(value => Array.isArray(value)).map(value => value[0]), ["register", "succeed"]);
  assert.equal(h.effectCalls.length, 0);
});

test("missing reconcile capability and invalid limits fail closed", async () => {
  const unavailable = harness({ steps: [step("network", "external_unknown")], recovery: true });
  assert.deepEqual(await unavailable.runner.run({ ...input, recovery: true }), { status: "unavailable", completedSteps: 0, cleanupFailed: 0 });
  const bad = harness({ steps: [step("s1")] });
  bad.runner.deps.plan = { resolve: async () => ({ taskId: "task-1", runId: "run-1", taskRevision: 3, steps: [step("s1")], limits: { ...limits, maxConcurrent: 2 } }) };
  await assert.rejects(bad.runner.run(input), error => error instanceof AiTaskRunnerError && error.code === "AI_RUN_LIMIT");
});

test("runner dependencies are explicit and do not provide an allow-all fallback", () => {
  assert.throws(() => new AiTaskRunner({}), error => error instanceof AiTaskRunnerError && error.code === "AI_RESOURCE_UNAVAILABLE");
});

