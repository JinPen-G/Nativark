'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { PrismaTaskExecutionBudgetRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-execution-budget.repository');

const now = new Date('2026-10-06T10:00:00Z');
const lease = { taskId: 'task-1', runId: 'run-1', holderId: 'holder-1', revision: 1, fencingToken: '9' };
const policy = { version: 'policy-1', fingerprint: 'a'.repeat(64), limits: { steps: 2n, calls: 2n, active_ms: 1000n, output_bytes: 100n } };
const chargeRequest = { taskId: 'task-1', lease, chargeId: 'charge-1', resource: 'steps', amount: 1n, target: { kind: 'run' } };
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
  const state = { aiRun: [{ scopeId: 'scope-1', taskId: 'task-1', id: 'run-1', leaseOwnerId: 'holder-1', fencingToken: '9', revision: 1, status: 'RUNNING', leaseExpiresAt: new Date(now.getTime() + 60_000) }],
    aiTaskExecutionBudget: [], aiTaskExecutionCharge: [], aiStep: [], aiGatewayInvocation: [] };
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
  const make = () => new PrismaTaskExecutionBudgetRepository(db, { resolve: async () => ({ scopeId: 'scope-1' }) }, { resolve: async () => clone(policy) }, evidence, () => now);
  return { state, db, source: make(), make, evidence, control };
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
  await h.source.reserve({ ...chargeRequest, resource, amount: policy.limits[resource] });
  await assert.rejects(h.make().reserve({ ...chargeRequest, chargeId: 'charge-2', resource }), error => error.code === 'AI_RUN_LIMIT');
  assert.equal((await h.source.load('task-1', lease)).reserved[resource], policy.limits[resource]);
});

test('cross invocation evidence and missing step associations cannot settle or reserve', async () => {
  const h = harness(); await h.source.initialize('task-1', lease); await h.source.reserve(chargeRequest);
  h.evidence.current = { scopeId: 'scope-1', taskId: 'task-1', runId: 'run-1', chargeId: 'charge-1', requestFingerprint: chargeFingerprint(chargeRequest), resource: 'steps', actualAmount: 1n, evidenceHash: 'b'.repeat(64), evidenceRef: 'fact-1', dispatchToken: 'token-2', gatewayInvocationId: 'invocation-other' };
  await assert.rejects(h.source.record({ taskId: 'task-1', lease, chargeId: 'charge-1', evidenceRef: 'fact-1' }), error => error.code === 'AI_ACCESS_DENIED');
  await assert.rejects(h.source.reserve({ ...chargeRequest, chargeId: 'charge-2', target: { kind: 'step', stepId: 'step-1', actionId: 'action-1', stepFingerprint: 'c'.repeat(64) } }), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.aiTaskExecutionCharge[0].status, 'RESERVED');
});

test('missing trusted policy or evidence dependency never supplies a permissive fallback', async () => {
  const h = harness();
  assert.throws(() => new PrismaTaskExecutionBudgetRepository(h.db, {}, {}), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  await h.source.initialize('task-1', lease); await h.source.reserve(chargeRequest);
  const missing = new PrismaTaskExecutionBudgetRepository(h.db, { resolve: async () => ({ scopeId: 'scope-1' }) }, { resolve: async () => clone(policy) }, undefined, () => now);
  await assert.rejects(missing.record({ taskId: 'task-1', lease, chargeId: 'charge-1', evidenceRef: 'fact-1' }), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal((await h.source.load('task-1', lease)).reserved.steps, 1n);
});
