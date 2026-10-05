'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { PrismaTaskExecutionBudgetRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-execution-budget.repository');
const { PrismaTaskExecutionScopeAuthority } = require('../apps/api/src/modules/ai-native/runner/prisma-task-execution-scope.authority');
const { AiTaskRepository } = require('../apps/api/src/modules/ai-native/ai-task.repository');
const { PersistentTaskRunnerResourceGate } = require('../apps/api/src/modules/ai-native/runner/persistent-task-runner-resource-gate');
const { createPersistentAiTaskRunner } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.module');
const apiRequire = require('node:module').createRequire(require('node:path').resolve(__dirname, '../apps/api/package.json'));
const { AI_CONTRACT_DRAFT_VERSION } = apiRequire('@rental-os/shared');

const now = new Date('2026-10-06T10:00:00Z');
const lease = { taskId: 'task-1', runId: 'run-1', holderId: 'holder-1', revision: 1, fencingToken: '9' };
const policy = { version: 'policy-1', fingerprint: 'a'.repeat(64), limits: { steps: 2n, calls: 2n, active_ms: 1000n, output_bytes: 100n } };
const stepTarget = { kind: 'step', stepId: 'step-1', actionId: 'action-1', stepFingerprint: 'c'.repeat(64) };
const chargeRequest = { taskId: 'task-1', lease, chargeId: 'charge-1', resource: 'steps', amount: 1n, target: stepTarget };
const chargeFingerprint = input => requestFingerprint({ taskId: input.taskId, lease: input.lease, chargeId: input.chargeId, resource: input.resource, amount: input.amount.toString(), target: input.target });

function clone(value) {
  if (value instanceof Date) return new Date(value);
  if (value && typeof value === 'object' && typeof value.toFixed === 'function') return String(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}
function equal(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left instanceof Prisma.Decimal || right instanceof Prisma.Decimal) return String(left) === String(right);
  return left === right;
}
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(clause => matches(row, clause));
    if (value && typeof value === 'object' && 'is' in value) return matches(row[key], value.is);
    if (key === 'fencingToken') return String(row[key]) === String(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('gt' in value) return row[key] > value.gt;
      if ('increment' in value || 'decrement' in value) return true;
      if ('scopeId' in value || 'taskId' in value) return matches(row, value);
    }
    return equal(row[key], value);
  });
}
function delegates(state) {
  const delegate = name => ({
    findUnique: async ({ where }) => {
      const row = state[name].find(item => Object.values(where)[0] && typeof Object.values(where)[0] === 'object'
        ? matches(item, Object.values(where)[0]) : matches(item, where));
      return row ? clone(row) : null;
    },
    findFirst: async ({ where }) => { const row = state[name].find(item => matches(item, where)); return row ? clone(row) : null; },
    create: async ({ data }) => { const row = { ...clone(data), revision: data.revision ?? 1 }; state[name].push(row); return clone(row); },
    updateMany: async ({ where, data }) => {
      const row = state[name].find(item => matches(item, where)); if (!row) return { count: 0 };
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && 'increment' in value) row[key] = typeof row[key] === 'bigint' ? row[key] + BigInt(value.increment) : row[key] + Number(value.increment);
        else if (value && typeof value === 'object' && 'decrement' in value) row[key] = typeof row[key] === 'bigint' ? row[key] - BigInt(value.decrement) : row[key] - Number(value.decrement);
        else row[key] = clone(value);
      }
      return { count: 1 };
    },
    upsert: async ({ where, create }) => {
      const key = Object.values(where)[0]; let row = state[name].find(item => matches(item, key));
      if (!row) { row = { reservedSteps: 0n, reservedCalls: 0n, reservedActiveMs: 0n, reservedOutputBytes: 0n, consumedSteps: 0n, consumedCalls: 0n, consumedActiveMs: 0n, consumedOutputBytes: 0n, ...clone(create), revision: 1 }; state[name].push(row); } return clone(row);
    },
  });
  return Object.fromEntries(Object.keys(state).map(name => [name, delegate(name)]));
}
function harness() {
  const state = { aiTask: [{ id: 'task-1', scopeId: 'scope-1', ownerId: 'user-1' }], aiRun: [{ scopeId: 'scope-1', taskId: 'task-1', id: 'run-1', leaseOwnerId: 'holder-1', fencingToken: '9', revision: 1, status: 'RUNNING', leaseExpiresAt: new Date(now.getTime() + 60_000) }],
    aiTaskExecutionBudget: [], aiTaskExecutionCharge: [], aiStep: [{ scopeId: 'scope-1', taskId: 'task-1', id: 'step-1', runId: 'run-1', actionId: 'action-1', requestFingerprint: stepTarget.stepFingerprint }], aiGatewayInvocation: [{ scopeId: 'scope-1', taskId: 'task-1', id: 'invocation-1', runId: 'run-1', stepId: 'step-1', actionId: 'action-1', stepFingerprint: stepTarget.stepFingerprint }] };
  const db = delegates(state);
  const control = { failAfter: null, loseReply: false };
  db.$queryRaw = async () => [];
  let tail = Promise.resolve();
  db.$transaction = fn => {
    const work = tail.then(async () => {
      const draft = clone(state), tx = { ...delegates(draft), $queryRaw: db.$queryRaw };
      for (const name of ['aiTaskExecutionBudget', 'aiTaskExecutionCharge']) for (const method of ['create', 'updateMany']) {
        const original = tx[name][method];
        tx[name][method] = async args => { const result = await original(args); if (control.failAfter === `${name}.${method}`) throw new Error('synthetic_write_failure'); return result; };
      }
      const result = await fn(tx); Object.keys(state).forEach(key => { state[key] = draft[key]; });
      if (control.loseReply) { control.loseReply = false; throw new Error('synthetic_commit_reply_lost'); }
      return result;
    });
    tail = work.catch(() => {}); return work;
  };
  const evidence = { current: null, read: async () => clone(evidence.current) };
  const scopeSource = { resolve: async () => ({ scopeId: 'scope-1', bindingKey: 'owner-user-1', taskWhere: { id: 'task-1', ownerId: 'user-1' } }) };
  const make = () => new PrismaTaskExecutionBudgetRepository(db, scopeSource, { resolve: async () => clone(policy) }, evidence, () => now);
  return { state, db, source: make(), make, evidence, control, scopeSource };
}

test('persistent adapter initializes once and reuses durable counters after recreation', async () => {
  const h = harness();
  const first = await h.source.initialize('task-1', lease);
  assert.deepEqual(first.reserved, { steps: 0n, calls: 0n, active_ms: 0n, output_bytes: 0n });
  await h.source.reserve(chargeRequest);
  const second = h.make();
  assert.equal((await second.initialize('task-1', lease)).reserved.steps, 1n);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1);
});

test('reservation is idempotent, cumulative across a recreated adapter, and rejects a changed payload', async () => {
  const h = harness(); await h.source.initialize('task-1', lease);
  const first = await h.source.reserve(chargeRequest); assert.equal(first.replayed, false); assert.equal(first.budget.reserved.steps, 1n);
  const replay = await h.source.reserve(chargeRequest); assert.equal(replay.replayed, true); assert.equal(replay.budget.reserved.steps, 1n);
  await assert.rejects(h.source.reserve({ ...chargeRequest, amount: 2n }), error => error.code === 'AI_REVISION_CONFLICT');
});

test('unknown retains reservation and reconcile records actual usage without truncating it', async () => {
  const h = harness(); await h.source.initialize('task-1', lease); await h.source.reserve(chargeRequest);
  const unknown = await h.source.markUnknown({ taskId: 'task-1', lease, chargeId: 'charge-1', reason: 'provider_timeout' });
  assert.equal(unknown.charge.status, 'unknown'); assert.equal(unknown.budget.reserved.steps, 1n); assert.equal(unknown.budget.consumed.steps, 0n);
  const evidence = { scopeId: 'scope-1', taskId: 'task-1', runId: 'run-1', chargeId: 'charge-1', requestFingerprint: chargeFingerprint(chargeRequest), resource: 'steps', actualAmount: 2n, evidenceHash: 'b'.repeat(64), evidenceRef: 'fact-1', dispatchToken: null, gatewayInvocationId: null };
  h.evidence.current = evidence;
  const reconciled = await h.source.reconcile({ taskId: 'task-1', lease, chargeId: 'charge-1', evidenceRef: 'fact-1' });
  assert.equal(reconciled.charge.status, 'recorded'); assert.equal(reconciled.charge.actualAmount, 2n); assert.equal(reconciled.budget.reserved.steps, 0n); assert.equal(reconciled.budget.consumed.steps, 2n);
});

test('old fencing holder cannot reserve or settle after lease ownership changes', async () => {
  const h = harness(); await h.source.initialize('task-1', lease);
  h.state.aiRun[0].leaseOwnerId = 'new-holder'; h.state.aiRun[0].fencingToken = '10'; h.state.aiRun[0].revision = 2;
  await assert.rejects(h.source.reserve(chargeRequest), error => error.code === 'AI_ACCESS_DENIED');
});

test('last unit race is serialized by transaction replacement, never by an adapter Map', async () => {
  const h = harness(); await h.source.initialize('task-1', lease);
  const results = await Promise.allSettled([h.source.reserve({ ...chargeRequest, amount: 2n }), h.make().reserve({ ...chargeRequest, chargeId: 'charge-2' })]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'AI_RUN_LIMIT');
  assert.equal(h.state.aiTaskExecutionCharge.length, 1);
  assert.equal((await h.make().load('task-1', lease)).reserved.steps, 2n);
});

for (const stage of ['aiTaskExecutionCharge.create', 'aiTaskExecutionBudget.updateMany']) test(`failure after ${stage} rolls back both occupancy and receipt`, async () => {
  const h = harness(); await h.source.initialize('task-1', lease); h.control.failAfter = stage;
  await assert.rejects(h.source.reserve(chargeRequest), /synthetic_write_failure/);
  assert.equal(h.state.aiTaskExecutionCharge.length, 0);
  assert.equal((await h.source.load('task-1', lease)).reserved.steps, 0n);
});

test('lost commit reply preserves charge and recreation replays without double occupancy', async () => {
  const h = harness(); await h.source.initialize('task-1', lease); h.control.loseReply = true;
  await assert.rejects(h.source.reserve(chargeRequest), /synthetic_commit_reply_lost/);
  const receipt = await h.make().reserve(chargeRequest);
  assert.equal(receipt.replayed, true); assert.equal(receipt.budget.reserved.steps, 1n);
});

test('unknown cannot be settled by ordinary record, expired holder cannot refund it', async () => {
  const h = harness(); await h.source.initialize('task-1', lease); await h.source.reserve(chargeRequest);
  await h.source.markUnknown({ taskId: 'task-1', lease, chargeId: 'charge-1', reason: 'timeout' });
  h.evidence.current = { scopeId: 'scope-1', taskId: 'task-1', runId: 'run-1', chargeId: 'charge-1', requestFingerprint: chargeFingerprint(chargeRequest), resource: 'steps', actualAmount: 0n, evidenceHash: 'b'.repeat(64), evidenceRef: 'fact-1', dispatchToken: null, gatewayInvocationId: null };
  await assert.rejects(h.source.record({ taskId: 'task-1', lease, chargeId: 'charge-1', evidenceRef: 'fact-1' }), error => error.code === 'AI_RESULT_UNKNOWN');
  h.state.aiRun[0].leaseExpiresAt = new Date(now.getTime() - 1);
  await assert.rejects(h.source.reconcile({ taskId: 'task-1', lease, chargeId: 'charge-1', evidenceRef: 'fact-1' }), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 1n);
});

test('record replay binds quantity as well as evidence hash and zero is not unknown', async () => {
  const h = harness(); await h.source.initialize('task-1', lease); await h.source.reserve(chargeRequest);
  h.evidence.current = { scopeId: 'scope-1', taskId: 'task-1', runId: 'run-1', chargeId: 'charge-1', requestFingerprint: chargeFingerprint(chargeRequest), resource: 'steps', actualAmount: 0n, evidenceHash: 'b'.repeat(64), evidenceRef: 'fact-1', dispatchToken: null, gatewayInvocationId: null };
  const input = { taskId: 'task-1', lease, chargeId: 'charge-1', evidenceRef: 'fact-1' };
  assert.equal((await h.source.record(input)).budget.consumed.steps, 0n);
  assert.equal((await h.make().record(input)).replayed, true);
  h.evidence.current.actualAmount = 1n;
  await assert.rejects(h.source.record(input), error => error.code === 'AI_REVISION_CONFLICT');
});

test('policy revision and unsigned bigint boundaries reject before mutation', async () => {
  const h = harness(); await h.source.initialize('task-1', lease);
  h.state.aiTaskExecutionBudget[0].policyFingerprint = 'c'.repeat(64);
  await assert.rejects(h.source.reserve(chargeRequest), error => error.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(h.source.reserve({ ...chargeRequest, amount: 1n << 64n }), error => error.code === 'AI_INVALID_INPUT');
  assert.equal(h.state.aiTaskExecutionCharge.length, 0);
});

for (const resource of ['calls', 'active_ms', 'output_bytes']) test(`${resource} enforces its own durable limit after adapter recreation`, async () => {
  const h = harness(); await h.source.initialize('task-1', lease);
  const target = resource === 'calls' ? { ...stepTarget, gatewayInvocationId: 'invocation-1' } : resource === 'active_ms' ? { kind: 'run' } : stepTarget;
  await h.source.reserve({ ...chargeRequest, resource, target, amount: policy.limits[resource] });
  await assert.rejects(h.make().reserve({ ...chargeRequest, chargeId: 'charge-2', resource, target }), error => error.code === 'AI_RUN_LIMIT');
  assert.equal((await h.source.load('task-1', lease)).reserved[resource], policy.limits[resource]);
});

test('cross invocation evidence and missing step associations cannot settle or reserve', async () => {
  const h = harness(); await h.source.initialize('task-1', lease); await h.source.reserve(chargeRequest);
  h.evidence.current = { scopeId: 'scope-1', taskId: 'task-1', runId: 'run-1', chargeId: 'charge-1', requestFingerprint: chargeFingerprint(chargeRequest), resource: 'steps', actualAmount: 1n, evidenceHash: 'b'.repeat(64), evidenceRef: 'fact-1', dispatchToken: 'token-2', gatewayInvocationId: 'invocation-other' };
  await assert.rejects(h.source.record({ taskId: 'task-1', lease, chargeId: 'charge-1', evidenceRef: 'fact-1' }), error => error.code === 'AI_ACCESS_DENIED');
  await assert.rejects(h.source.reserve({ ...chargeRequest, chargeId: 'charge-2', target: { ...stepTarget, stepId: 'step-other' } }), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.aiTaskExecutionCharge[0].status, 'RESERVED');
});

test('missing trusted policy or evidence dependency never supplies a permissive fallback', async () => {
  const h = harness();
  assert.throws(() => new PrismaTaskExecutionBudgetRepository(h.db, {}, {}), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  await h.source.initialize('task-1', lease); await h.source.reserve(chargeRequest);
  const missing = new PrismaTaskExecutionBudgetRepository(h.db, h.scopeSource, { resolve: async () => clone(policy) }, undefined, () => now);
  await assert.rejects(missing.record({ taskId: 'task-1', lease, chargeId: 'charge-1', evidenceRef: 'fact-1' }), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal((await h.source.load('task-1', lease)).reserved.steps, 1n);
});

test('run charges cannot impersonate steps, model calls or output; calls require persisted invocation', async () => {
  const h = harness(); await h.source.initialize('task-1', lease);
  for (const resource of ['steps', 'calls', 'output_bytes']) await assert.rejects(h.source.reserve({ ...chargeRequest, resource, target: { kind: 'run' } }), error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(h.source.reserve({ ...chargeRequest, resource: 'calls' }), error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(h.source.reserve({ ...chargeRequest, resource: 'calls', target: { ...stepTarget, gatewayInvocationId: 'other-invocation' } }), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.aiTaskExecutionCharge.length, 0);
});

test('real task access resolver and resource scope adapter preserve owner and action checks', async () => {
  const h = harness(), actions = [];
  const context = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: 'request-1', authorizedAt: now.toISOString(), audience: 'operator', actor: { kind: 'user', userId: 'user-1' }, scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'workspace-1' } };
  Object.assign(h.state.aiTask[0], { archivedAt: null, scopeKind: 'WORKSPACE', scope: { kind: 'WORKSPACE', scopeKey: 'workspace:8:tenant-1:11:workspace-1', tenantId: 'tenant-1', workspaceId: 'workspace-1' }, audience: 'OPERATOR', ownerKind: 'USER' });
  const tasks = new AiTaskRepository(h.db, { resolve: async (_task, action) => { actions.push(action); return clone(context); } }, () => now);
  const authority = new PrismaTaskExecutionScopeAuthority(tasks, h.db);
  assert.equal((await authority.resolve('task-1', lease, 'write')).scopeId, 'scope-1');
  assert.deepEqual(actions, ['transition_task', 'transition_task']);
  context.actor.userId = 'other-user';
  await assert.rejects(authority.resolve('task-1', lease, 'write'), error => error.code === 'AI_ACCESS_DENIED');
  context.actor.userId = 'user-1'; context.scope.workspaceId = 'other-space';
  await assert.rejects(authority.resolve('task-1', lease, 'read'), error => error.code === 'AI_ACCESS_DENIED');
});

test('authority changes during policy wait cannot use the old owner or write a charge', async () => {
  const h = harness(); await h.source.initialize('task-1', lease);
  let reads = 0;
  h.scopeSource.resolve = async () => ({ scopeId: 'scope-1', bindingKey: ++reads === 1 ? 'owner-user-1' : 'owner-other-user', taskWhere: { id: 'task-1', ownerId: reads === 1 ? 'user-1' : 'other-user' } });
  await assert.rejects(h.source.reserve(chargeRequest), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.aiTaskExecutionCharge.length, 0);
});

function runnerHarness(options = {}) {
  const h = harness(), trace = [], measured = { steps: 1n, active_ms: 10n, output_bytes: 12n };
  let taskRevision = 1;
  const currentLease = () => ({ ...lease, revision: h.state.aiRun[0].revision, expiresAt: h.state.aiRun[0].leaseExpiresAt.toISOString() });
  const source = {
    charges: async (_step, held) => ({ modelCall: false, requests: ['steps', 'active_ms', 'output_bytes'].map(resource => ({ taskId: held.taskId, lease: held, resource, chargeId: `charge-${resource}`, amount: resource === 'steps' ? 1n : resource === 'active_ms' ? 100n : 50n, target: stepTarget })) }),
    settlements: async (ticket, _step, held) => {
      trace.push('resource_record'); if (options.evidenceMissing) throw new Error('no_persisted_measurement');
      return ticket.chargeIds.map(chargeId => ({ taskId: held.taskId, lease: held, chargeId, evidenceRef: `fact-${chargeId}` }));
    }
  };
  h.evidence.read = async input => {
    const row = h.state.aiTaskExecutionCharge.find(row => row.chargeId === input.chargeId);
    return { scopeId: row.scopeId, taskId: row.taskId, runId: row.runId, chargeId: row.chargeId, requestFingerprint: row.requestFingerprint, resource: row.resource.toLowerCase(), actualAmount: measured[row.resource.toLowerCase()], evidenceHash: 'b'.repeat(64), evidenceRef: input.evidenceRef, gatewayInvocationId: null, dispatchToken: null };
  };
  const commit = async () => { h.state.aiRun[0].revision++; return { lease: currentLease(), taskRevision: ++taskRevision }; };
  const gate = new PersistentTaskRunnerResourceGate(h.source, source);
  const runner = createPersistentAiTaskRunner({
    resources: gate,
    leases: { readMetadata: async () => ({ taskId: 'task-1', status: 'running', revision: taskRevision, cancelRequestedAt: null }), claimRun: async () => currentLease(), claimRecoveryRun: async () => ({ ...currentLease(), purpose: 'recovery_only' }), releaseRun: async () => { trace.push('release'); return { released: true, revision: h.state.aiRun[0].revision + 1 }; } },
    steps: { register: async () => ({ stepId: 'step-1', runId: 'run-1', sequence: 1, stepRevision: 1, taskRevision, replayed: false, existingStatus: 'pending' }), start: async () => { if (options.startFailure) throw new Error('synthetic_start_failure'); return commit(); }, succeed: async () => { trace.push('durable_result'); return commit(); }, fail: commit, pause: commit, unknown: async () => { trace.push('durable_unknown'); return commit(); } },
    plan: { resolve: async () => ({ taskId: 'task-1', runId: 'run-1', taskRevision, steps: [{ registrationRef: 'registration-1', operation: options.unknown ? 'external_unknown' : 'readonly', toolCode: 'orders.read', toolVersion: '1' }], limits: { maxSteps: 2, maxCalls: 2, maxTotalMs: 1000, maxStepMs: 100, maxOutputBytes: 100, maxConcurrent: 1 } }) },
    effects: { execute: async () => { trace.push('effect'); return { kind: options.unknown ? 'unknown' : 'succeeded', resultRef: 'result-1', outputBytes: 12 }; }, reconcile: async () => { trace.push('reconcile'); return { kind: 'succeeded', resultRef: 'result-1', outputBytes: 12 }; } }
  });
  return { ...h, runner, gate, trace, input: { taskId: 'task-1', runId: 'run-1', holderId: 'holder-1', expectedTaskRevision: 1, expectedRunRevision: 1, expectedFencingToken: '8', leaseMs: 1000 } };
}

test('actual runner, resource gate and Prisma adapter record only after persisted step result', async () => {
  const h = runnerHarness();
  assert.equal((await h.runner.run(h.input)).status, 'succeeded');
  assert.deepEqual(h.trace, ['effect', 'durable_result', 'resource_record', 'release']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 10n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedOutputBytes, 12n);
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
});

test('missing persisted measurements cannot turn durable step success into accounted task success', async () => {
  const h = runnerHarness({ evidenceMissing: true });
  assert.equal((await h.runner.run(h.input)).status, 'unknown');
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'UNKNOWN'));
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 1n);
  assert.equal(h.trace.filter(event => event === 'effect').length, 1);
});

test('unknown effect retains all resource charges and recovery cannot mint a new dispatch ticket', async () => {
  const h = runnerHarness({ unknown: true });
  assert.equal((await h.runner.run(h.input)).status, 'unknown');
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'UNKNOWN'));
  assert.equal((await h.runner.run({ ...h.input, recovery: true })).status, 'unavailable');
  assert.equal(h.trace.filter(event => event === 'effect').length, 1);
  assert.equal(h.trace.includes('reconcile'), false);
});

test('resource exhaustion prevents effect invocation, including adapter recreation', async () => {
  const h = runnerHarness(); await h.source.initialize('task-1', lease);
  h.state.aiTaskExecutionBudget[0].consumedSteps = 2n;
  await assert.rejects(h.runner.run(h.input), error => error.code === 'AI_RUN_LIMIT');
  assert.equal(h.trace.includes('effect'), false);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
});

test('persistent composition rejects missing resource gate rather than falling back to counters', () => {
  assert.throws(() => createPersistentAiTaskRunner({}), /AI_RESOURCE_UNAVAILABLE/);
});

test('step start failure keeps reserved resources unknown without running the effect', async () => {
  const h = runnerHarness({ startFailure: true });
  await assert.rejects(h.runner.run(h.input), /synthetic_start_failure/);
  assert.equal(h.trace.includes('effect'), false);
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'UNKNOWN'));
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedOutputBytes, 50n);
});
