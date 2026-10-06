'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { PrismaTaskRunEvidenceRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-run-evidence.repository');
const { PrismaTaskExecutionBudgetRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-execution-budget.repository');
const { PrismaTaskRunnerResourceSource } = require('../apps/api/src/modules/ai-native/runner/prisma-task-runner-resource.source');
const { PersistentTaskRunnerResourceGate } = require('../apps/api/src/modules/ai-native/runner/persistent-task-runner-resource-gate');
const { PrismaTaskMeasuredEffects } = require('../apps/api/src/modules/ai-native/runner/prisma-task-measured-effects');
const { aiTaskAccessFromContext } = require('../apps/api/src/modules/ai-native/ai-task.repository');
const { AI_CONTRACT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
const syntheticExecutionContext = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: 'synthetic-evidence-test',
  authorizedAt: '2026-10-06T12:00:00Z', audience: 'operator', actor: { kind: 'user', userId: 'user-a' },
  scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
  access: { permissions: ['rental-os:order:view'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };
const syntheticExecutionAuthorization = { authorize: async () => structuredClone(syntheticExecutionContext) };
const { PrismaGatewayAccountingFacts } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-accounting-facts');
const { PersistedPlanResourcePolicySource } = require('../apps/api/src/modules/ai-native/runner/persisted-plan-resource-policy.source');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { offlinePrismaSchema } = require('./fixtures/ai-native/prisma-offline.cjs');
const fs = require('node:fs'), path = require('node:path');
const now = new Date('2026-10-06T12:00:00Z'), lease = { taskId: 'task-a', runId: 'run-a', holderId: 'worker-a', revision: 1, fencingToken: '1', expiresAt: '2026-10-06T12:01:00Z' };
const plan = { taskId: 'task-a', runId: 'run-a', taskRevision: 1, steps: [{ registrationRef: 'registration-a', operation: 'readonly', toolCode: 'rental.order.explain', toolVersion: '1' }],
  limits: { maxSteps: 3, maxCalls: 3, maxTotalMs: 1000, maxStepMs: 100, maxOutputBytes: 1000, maxConcurrent: 1 } };
for (const [name, change] of [
  ['duplicate resource', charges => { charges[1].resource = charges[0].resource; }],
  ['missing active measurement', charges => { charges[1].resource = 'CALLS'; charges[1].gatewayInvocationId = 'invocation-a'; }],
  ['unbound calls', charges => { charges.push({ ...charges[0], chargeId: 'charge-calls', resource: 'CALLS', gatewayInvocationId: null }); }]
]) test(`durable recovery rejects ${name} instead of publishing a terminal result`, async () => {
  const h = harness(); await h.reserve();
  await h.make().capture(lease, 'step-a', new AbortController().signal, async () => ({ kind: 'succeeded', payload: { synthetic: true } }));
  change(h.state.aiTaskExecutionCharge);
  await assert.rejects(h.make().recoverResult(lease, 'step-a'), e => e.code === 'AI_ACCESS_DENIED');
});

function clone(value) {
  if (value instanceof Prisma.Decimal) return value.toFixed(0);
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}
function match(row, where) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return v.every(w => match(row, w));
    if (k === 'fencingToken') return String(row[k]) === String(v);
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
    if (v && typeof v === 'object' && 'gt' in v) return row[k] > v.gt;
    return row[k] === v;
  });
}
function harness() {
  const state = { aiTask: [{ id: 'task-a', scopeId: 'scope-a', ownerId: 'user-a', revision: 1, cancelRequestedAt: null }],
    aiRun: [{ id: 'run-a', scopeId: 'scope-a', taskId: 'task-a', leaseOwnerId: 'worker-a', fencingToken: '1', revision: 1, status: 'RUNNING', leaseExpiresAt: new Date(lease.expiresAt) }],
    aiStep: [{ id: 'step-a', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', status: 'RUNNING', resultRef: null, revision: 1,
      toolCode: 'rental.order.explain', toolVersion: '1', inputRef: 'input-a', actionId: 'action-a', requestFingerprint: 'a'.repeat(64) }],
    aiTaskRunPlan: [], aiTaskResultArtifact: [], aiTaskExecutionBudget: [], aiGatewayInvocation: [], aiGatewayAccountingReceipt: [], aiInvocationAdmission: [], aiBudgetReservation: [], aiTaskExecutionCharge: [] };
  const control = { revoked: false, failArtifact: false, loseReply: false, tick: 10, planHash: 'b'.repeat(64) };
  const hydrate = row => row ? { ...clone(row), ...('fencingToken' in row ? { fencingToken: new Prisma.Decimal(row.fencingToken) } : {}) } : null;
  const delegates = data => Object.fromEntries(Object.keys(data).map(name => [name, {
    findFirst: async ({ where }) => hydrate(data[name].find(row => match(row, where))),
    findUnique: async ({ where }) => hydrate(data[name].find(row => match(row, typeof Object.values(where)[0] === 'object' ? Object.values(where)[0] : where))),
    findMany: async ({ where, take }) => data[name].filter(row => match(row, where)).slice(0, take).map(hydrate),
    upsert: async ({ where, create }) => { let row = data[name].find(row => match(row, Object.values(where)[0]));
      if (!row) { row = { reservedSteps: 0n, consumedSteps: 0n, reservedCalls: 0n, consumedCalls: 0n, reservedActiveMs: 0n, consumedActiveMs: 0n,
        reservedOutputBytes: 0n, consumedOutputBytes: 0n, revision: 1, ...clone(create) }; data[name].push(row); } return hydrate(row); },
    create: async ({ data: value }) => {
      if (name === 'aiTaskResultArtifact' && control.failArtifact) throw Error('write failed');
      if (name === 'aiTaskResultArtifact' && data[name].some(row => ['scopeId', 'taskId', 'runId', 'stepId', 'fencingToken'].every(k => String(row[k]) === String(value[k])))) throw Error('unique generation');
      if (name === 'aiTaskRunPlan' && data[name].length) throw Error('unique plan');
      const stored = { revision: 1, ...clone(value) }; data[name].push(stored); return hydrate(stored);
    },
    updateMany: async ({ where, data: changes }) => { const row = data[name].find(row => match(row, where)); if (!row) return { count: 0 };
      for (const [k, v] of Object.entries(changes)) { if (v && typeof v === 'object' && 'increment' in v) row[k] += v.increment;
        else if (v && typeof v === 'object' && 'decrement' in v) row[k] -= v.decrement; else row[k] = clone(v); } return { count: 1 }; }
  }]));
  const db = delegates(state); let tail = Promise.resolve();
  db.$transaction = cb => { const work = tail.then(async () => { const draft = clone(state), result = await cb({ ...delegates(draft), $queryRaw: async () => [] });
    Object.assign(state, draft); if (control.loseReply) { control.loseReply = false; throw Error('lost commit reply'); } return result;
  }); tail = work.catch(() => {}); return work; };
  const scopes = { resolve: async () => { if (control.revoked) throw Error('revoked'); return { scopeId: 'scope-a', bindingKey: 'owner-user-a', taskWhere: { id: 'task-a', ownerId: 'user-a' } }; } };
  const authority = { authorize: async () => ({ authorityHash: control.planHash, policyVersion: 'policy-a', expiresAt: '2026-10-06T12:01:00Z' }) };
  const make = financialEvidence => new PrismaTaskRunEvidenceRepository(db, scopes, authority, () => now, () => control.tick, financialEvidence);
  const budget = new PrismaTaskExecutionBudgetRepository(db, scopes, { resolve: async () => ({ version: 'policy-a', fingerprint: 'c'.repeat(64), limits: { steps: 3n, calls: 3n, active_ms: 1000n, output_bytes: 1000n } }) }, make(), () => now);
  async function reserve() {
    await make().savePlan(plan, lease);
    await budget.initialize('task-a', lease);
    for (const resource of ['steps', 'active_ms', 'output_bytes']) await budget.reserve({ taskId: 'task-a', lease, chargeId: `charge-${resource}`, resource,
      amount: resource === 'steps' ? 1n : 100n, target: { kind: 'step', stepId: 'step-a', actionId: 'action-a', stepFingerprint: 'a'.repeat(64) } });
  }
  return { state, control, db, scopes, authority, make, budget, reserve };
}

async function modelReceipt() {
  const h = harness(); await h.reserve();
  const config = { configId: 'profile-a', configRevision: 1, credentialRef: 'vault-a', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model-a', serviceMode: 'tenant_managed', tenantId: 'tenant-a', configurationScope: { kind: 'tenant', tenantId: 'tenant-a' } };
  const association = { requestId: 'call-a', runId: 'run-a', stepId: 'step-a', actionId: 'action-a', idempotencyKey: 'call-a', priceVersion: 'price-a', scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }, config };
  h.state.aiTaskExecutionCharge.push({ ...h.state.aiTaskExecutionCharge[0], chargeId: 'charge-calls', resource: 'CALLS', gatewayInvocationId: 'invocation-a' });
  const result = await h.make({ readDispatch: async () => assert.fail('capture only checks the supplied dependency, not dispatch') }).capture(lease, 'step-a', new AbortController().signal, async () => ({ kind: 'succeeded', payload: { synthetic: true } }));
  h.state.aiStep[0].status = 'SUCCEEDED'; h.state.aiStep[0].resultRef = result.resultRef;
  h.state.aiGatewayInvocation.push({ id: 'invocation-a', scopeId: 'scope-a', taskId: 'task-a', actorId: 'user-a', callId: 'call-a', runId: 'run-a', stepId: 'step-a', actionId: 'action-a', stepFingerprint: 'a'.repeat(64), sceneCode: 'scene-a', priceVersion: 'price-a', configuration: config, configurationHash: requestFingerprint(config) });
  h.state.aiGatewayAccountingReceipt.push({ id: 'receipt-a', scopeId: 'scope-a', scopeKind: 'WORKSPACE', taskId: 'task-a', invocationId: 'invocation-a', reservationId: 'reservation-a', admissionId: 'admission-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', dispatchToken: 'dispatch-a', requestHash: 'b'.repeat(64), state: 'dispatched' });
  h.state.aiInvocationAdmission.push({ id: 'admission-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'user-a', callId: 'call-a', requestHash: 'b'.repeat(64), dispatchId: 'dispatch-a', profileId: 'profile-a', status: 'completed', revokedAt: null });
  h.state.aiBudgetReservation.push({ id: 'reservation-a', scopeId: 'scope-a', scopeKind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'user-a', callId: 'call-a', requestId: 'call-a', idempotencyKey: 'call-a', runId: 'run-a', stepId: 'step-a', actionId: 'action-a', sceneCode: 'scene-a', priceVersion: 'price-a', configRevision: 1, configurationHash: requestFingerprint(config) });
  h.facts = new PrismaGatewayAccountingFacts(h.db, {
    resolveForReserve: async () => assert.fail('resource read must not reserve money'),
    resolveForReservation: async () => ({ actorId: 'user-a', association, sceneCode: 'scene-a', expiresAt: new Date(lease.expiresAt) })
  }, { resolveCurrent: async () => ({ context: { actor: { kind: 'user', userId: 'user-a' }, scope: association.scope } }) }, {
    quantity: async () => assert.fail('task calls do not price or settle money')
  }, () => now);
  h.read = source => h.make(source).read({ taskId: 'task-a', lease, chargeId: 'charge-calls', evidenceRef: `${result.resultRef}:calls` }, false);
  return h;
}

test('model task-resource evidence is unavailable without the single-ledger evidence source', async () => {
  const h = await modelReceipt();
  await assert.rejects(h.read(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
});

test('missing financial evidence denies a model executor before the started marker or external effect', async () => {
  const h = harness(); await h.reserve();
  h.state.aiTaskExecutionCharge.push({ ...h.state.aiTaskExecutionCharge[0], chargeId: 'charge-calls', resource: 'CALLS', gatewayInvocationId: 'invocation-a' });
  let executed = 0;
  await assert.rejects(h.make().capture(lease, 'step-a', new AbortController().signal, async () => {
    executed++; return { kind: 'succeeded', payload: {} };
  }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(executed, 0); assert.equal(h.state.aiTaskResultArtifact.length, 0);
});

test('actual task evidence consumes actual single-ledger dispatch facts without monetary writes', async () => {
  const h = await modelReceipt(), evidence = await h.read(h.facts);
  assert.equal(evidence.actualAmount, 1n); assert.equal(evidence.dispatchToken, 'dispatch-a');
  assert.equal(evidence.gatewayInvocationId, 'invocation-a');
  assert.equal(h.state.aiBudgetReservation.length, 1);
});
for (const [field, value] of [['actorId', 'other'], ['sceneCode', 'other'], ['priceVersion', 'other'],
  ['runId', 'other'], ['stepId', 'other'], ['actionId', 'other'], ['configRevision', 2], ['configurationHash', 'c'.repeat(64)]]) {
  test(`actual financial/task composition refuses altered reservation ${field}`, async () => {
    const h = await modelReceipt(); h.state.aiBudgetReservation[0][field] = value;
    await assert.rejects(h.read(h.facts));
  });
}
test('reserved or cancelled financial receipt cannot prove a model call occurred', async () => {
  for (const state of ['reserved', 'cancelled']) {
    const h = await modelReceipt(); h.state.aiGatewayAccountingReceipt[0].state = state;
    await assert.rejects(h.read(h.facts));
  }
});
test('immutable persisted plan survives recreation and refuses changed limits or policy', async () => {
  const h = harness(); assert.equal((await h.make().savePlan(plan, lease)).replayed, false);
  assert.equal((await h.make().savePlan(plan, lease)).replayed, true);
  const loaded = await h.make().resolve({ taskId: 'task-a', status: 'running', revision: 2, cancelRequestedAt: null }, lease, true);
  assert.equal(loaded.taskRevision, 2); assert.deepEqual(loaded.steps, plan.steps);
  await assert.rejects(h.make().savePlan({ ...plan, limits: { ...plan.limits, maxStepMs: 99 } }, lease));
  h.control.planHash = 'd'.repeat(64); await assert.rejects(h.make().resolve({ taskId: 'task-a', revision: 2 }, lease, true));
});

test('actual persisted authorized plan supplies stable cumulative resource ceilings across revisions and restart', async () => {
  const h = harness(); await h.make().savePlan(plan, lease);
  let revision = 1;
  const tasks = { readMetadata: async () => ({ taskId: 'task-a', revision, status: 'running', cancelRequestedAt: null }) };
  const source = () => new PersistedPlanResourcePolicySource(tasks, h.make());
  const initial = await source().resolve('task-a', lease);
  assert.deepEqual(initial.limits, { steps: 3n, calls: 3n, active_ms: 1000n, output_bytes: 1000n });
  revision = 2;
  assert.deepEqual(await source().resolve('task-a', lease), initial);
  const repository = new PrismaTaskExecutionBudgetRepository(h.db, h.scopes, source(), h.make(), () => now);
  await repository.initialize('task-a', lease);
  const request = { taskId: 'task-a', lease, chargeId: 'saved-plan-charge', resource: 'steps', amount: 1n,
    target: { kind: 'step', stepId: 'step-a', actionId: 'action-a', stepFingerprint: 'a'.repeat(64) } };
  await repository.reserve(request);
  const restored = new PrismaTaskExecutionBudgetRepository(h.db, h.scopes, source(), h.make(), () => now);
  assert.equal((await restored.load('task-a', lease)).reserved.steps, 1n);
  h.control.planHash = 'e'.repeat(64);
  await assert.rejects(source().resolve('task-a', lease));
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 1n);
});

test('saved-plan policy cannot manufacture limits for missing plans or foreign task metadata', async () => {
  const h = harness();
  const tasks = { readMetadata: async () => ({ taskId: 'task-a', revision: 1, status: 'running', cancelRequestedAt: null }) };
  await assert.rejects(new PersistedPlanResourcePolicySource(tasks, h.make()).resolve('task-a', lease));
  await h.make().savePlan(plan, lease);
  tasks.readMetadata = async () => ({ taskId: 'other', revision: 1, status: 'running', cancelRequestedAt: null });
  await assert.rejects(new PersistedPlanResourcePolicySource(tasks, h.make()).resolve('task-a', lease), e => e.code === 'AI_ACCESS_DENIED');
});
test('actual captured artifact meters UTF8 bytes and server time through the real resource repository', async () => {
  const h = harness(); await h.reserve(); const payload = { answer: '合成事实' };
  const result = await h.make().capture(lease, 'step-a', new AbortController().signal, async () => { h.control.tick = 22; return { kind: 'succeeded', payload }; });
  assert.equal(result.outputBytes, Buffer.byteLength(JSON.stringify(payload))); h.state.aiStep[0].status = 'SUCCEEDED'; h.state.aiStep[0].resultRef = result.resultRef;
  for (const resource of ['steps', 'active_ms', 'output_bytes']) await h.budget.record({ taskId: 'task-a', lease, chargeId: `charge-${resource}`, evidenceRef: `${result.resultRef}:${resource}` });
  const snapshot = await h.budget.load('task-a', lease);
  assert.equal(snapshot.consumed.steps, 1n); assert.equal(snapshot.consumed.active_ms, 12n); assert.equal(snapshot.consumed.output_bytes, BigInt(result.outputBytes));
  assert.equal(h.state.aiTaskResultArtifact.length, 1);
});
test('capture rejects duplicate generation before a second effect, including concurrent calls', async () => {
  const h = harness(); await h.reserve(); let effects = 0, release;
  const wait = new Promise(resolve => { release = resolve; });
  const execute = async () => { effects++; await wait; return { kind: 'succeeded', payload: { synthetic: true } }; };
  const first = h.make().capture(lease, 'step-a', new AbortController().signal, execute);
  const second = h.make().capture(lease, 'step-a', new AbortController().signal, execute);
  // Flush awaited dependency reads without a real sleep.
  for (let i = 0; i < 30; i++) await Promise.resolve();
  release(); await Promise.allSettled([first, second]); assert.equal(effects, 1);
});
test('unknown artifact cannot settle; tampering, cross-step reference and missing durable result are refused', async () => {
  for (const mode of ['unknown', 'tampered', 'other-step', 'not-linked']) {
    const h = harness(); await h.reserve(); const result = await h.make().capture(lease, 'step-a', new AbortController().signal, async () => ({ kind: mode === 'unknown' ? 'unknown' : 'succeeded', payload: { synthetic: true } }));
    h.state.aiStep[0].resultRef = result.resultRef; h.state.aiStep[0].status = mode === 'unknown' ? 'UNKNOWN' : 'SUCCEEDED';
    if (mode === 'tampered') h.state.aiTaskResultArtifact[0].payload = { secret: 'different' };
    if (mode === 'other-step') h.state.aiTaskResultArtifact[0].stepId = 'step-b';
    if (mode === 'not-linked') h.state.aiStep[0].resultRef = null;
    await assert.rejects(h.budget.reconcile({ taskId: 'task-a', lease, chargeId: 'charge-steps', evidenceRef: `${result.resultRef}:steps` }));
    assert.equal((await h.budget.load('task-a', lease)).reserved.steps, 1n);
  }
});
test('revocation and old fencing after the effect cannot persist a late artifact', async () => {
  for (const mode of ['revoke', 'fence']) {
    const h = harness(); await h.reserve(); await assert.rejects(h.make().capture(lease, 'step-a', new AbortController().signal, async () => {
      if (mode === 'revoke') h.control.revoked = true; else h.state.aiRun[0].fencingToken = '2'; return { kind: 'succeeded', payload: { synthetic: true } };
    })); assert.equal(h.state.aiTaskResultArtifact.filter(a => a.completeMeasurement).length, 0);
  }
});
test('missing policy, no reservations and preabort cannot invoke a tool', async () => {
  const h = harness(); assert.throws(() => new PrismaTaskRunEvidenceRepository(h.db, h.scopes, {}));
  let effects = 0; await assert.rejects(h.make().capture(lease, 'step-a', new AbortController().signal, async () => { effects++; return { kind: 'succeeded', payload: {} }; }));
  await h.reserve(); const controller = new AbortController(); controller.abort();
  await assert.rejects(h.make().capture(lease, 'step-a', controller.signal, async () => { effects++; return { kind: 'succeeded', payload: {} }; })); assert.equal(effects, 0);
});

test('actual persisted plan/resource source/capture/settlement chain has no fabricated charge or evidence refs', async () => {
  const h = harness(); await h.make().savePlan(plan, lease); h.state.aiTask[0].status = 'RUNNING'; h.state.aiStep[0].status = 'PENDING';
  const source = new PrismaTaskRunnerResourceSource(h.db, h.scopes, h.make(), { resolve: async () => ({ modelCall: false }) }, () => now);
  const gate = new PersistentTaskRunnerResourceGate(h.budget, source);
  await gate.open(lease, false);
  const ref = { plan: plan.steps[0], registered: { stepId: 'step-a', runId: 'run-a', sequence: 1, stepRevision: 1, taskRevision: 1, replayed: false, existingStatus: 'pending' } };
  const ticket = await gate.reserve(ref, lease); assert.equal(ticket.chargeIds.length, 3);
  h.state.aiStep[0].status = 'RUNNING';
  const result = await h.make().capture(lease, 'step-a', new AbortController().signal, async () => { h.control.tick = 20; return { kind: 'succeeded', payload: { synthetic: true } }; });
  h.state.aiStep[0].status = 'SUCCEEDED'; h.state.aiStep[0].resultRef = result.resultRef;
  await gate.record(ticket, ref, lease, false);
  assert.equal((await h.budget.load('task-a', lease)).consumed.active_ms, 10n);
  assert.equal(h.state.aiTaskExecutionCharge.every(c => c.status === 'RECORDED'), true);
});
test('lost start-marker commit reply leaves incomplete evidence without calling or retrying the tool', async () => {
  const h = harness(); await h.reserve(); h.control.loseReply = true; let calls = 0;
  const execute = async () => { calls++; return { kind: 'succeeded', payload: {} }; };
  await assert.rejects(h.make().capture(lease, 'step-a', new AbortController().signal, execute));
  await assert.rejects(h.make().capture(lease, 'step-a', new AbortController().signal, execute));
  assert.equal(calls, 0); assert.equal(h.state.aiTaskResultArtifact.length, 1);
  assert.equal((await h.make().recoverResult(lease, 'step-a')).kind, 'unknown');
});
test('recovery reads an artifact committed before the step result and does not repeat the effect', async () => {
  const h = harness(); await h.reserve(); let calls = 0;
  const result = await h.make().capture(lease, 'step-a', new AbortController().signal, async () => { calls++; return { kind: 'succeeded', payload: { synthetic: true } }; });
  h.state.aiStep[0].status = 'UNKNOWN'; const recovered = await h.make().recoverResult(lease, 'step-a');
  assert.equal(recovered.resultRef, result.resultRef); assert.equal(recovered.kind, 'succeeded'); assert.equal(calls, 1);
});

test('real measured effects carry the exact lease, persist tool output and recover without calling the executor', async () => {
  const h = harness(), scope = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  await h.reserve();
  const actionId = `ai-action-${requestFingerprint({ version: 'ai-step-registration-1', scope, taskId: 'task-a', registrationRef: plan.steps[0].registrationRef })}`;
  h.state.aiStep[0].actionId = actionId;
  h.state.aiTaskExecutionCharge.forEach(c => { c.actionId = actionId; });
  let calls = 0;
  const tasks = { resolveAccess: async () => ({ ...aiTaskAccessFromContext(syntheticExecutionContext, 'task-a', now), scope, where: { id: 'task-a', ownerId: 'user-a' } }) };
  const effects = new PrismaTaskMeasuredEffects(h.db, tasks, h.make(), { resolve: async () => ({ operation: 'readonly', execute: async input => {
    calls++; assert.deepEqual(input.lease, lease); assert.equal(input.inputRef, 'input-a');
    h.control.tick = 25; return { kind: 'succeeded', payload: { synthetic: true } };
  } }) }, syntheticExecutionAuthorization, undefined, () => now);
  await assert.rejects(effects.execute(plan.steps[0], new AbortController().signal));
  const result = await effects.execute(plan.steps[0], new AbortController().signal, lease);
  assert.deepEqual(await effects.reconcile(plan.steps[0], new AbortController().signal, lease), result);
  await assert.rejects(effects.execute(plan.steps[0], new AbortController().signal, lease));
  assert.equal(calls, 1);
});

test('registered executor cannot be replaced while the real evidence boundary awaits policy', async () => {
  const h = harness(), scope = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  await h.reserve();
  const actionId = `ai-action-${requestFingerprint({ version: 'ai-step-registration-1', scope, taskId: 'task-a', registrationRef: plan.steps[0].registrationRef })}`;
  h.state.aiStep[0].actionId = actionId;
  h.state.aiTaskExecutionCharge.forEach(c => { c.actionId = actionId; });
  let original = 0, replacement = 0;
  const tool = { operation: 'readonly', execute: async () => { original++; return { kind: 'succeeded', payload: { synthetic: true } }; } };
  const authorize = h.authority.authorize;
  h.authority.authorize = async (...args) => {
    tool.execute = async () => { replacement++; return { kind: 'succeeded', payload: { synthetic: 'replaced' } }; };
    return authorize(...args);
  };
  const effects = new PrismaTaskMeasuredEffects(h.db,
    { resolveAccess: async () => ({ ...aiTaskAccessFromContext(syntheticExecutionContext, 'task-a', now), scope, where: { id: 'task-a', ownerId: 'user-a' } }) }, h.make(), { resolve: async () => tool }, syntheticExecutionAuthorization, undefined, () => now);
  await effects.execute(plan.steps[0], new AbortController().signal, lease);
  assert.equal(original, 1); assert.equal(replacement, 0);
  assert.deepEqual(h.state.aiTaskResultArtifact[0].payload, { synthetic: true });
});

test('incomplete recovery returns only a persisted unknown receipt; missing evidence fails closed', async () => {
  const h = harness(); await h.reserve();
  await assert.rejects(h.make().recoverResult(lease, 'step-a'));
  await assert.rejects(h.make().capture(lease, 'step-a', new AbortController().signal, async () => { throw Error('crash'); }));
  const result = await h.make().recoverResult(lease, 'step-a');
  assert.equal(result.kind, 'unknown'); assert.equal(result.resultRef, h.state.aiTaskResultArtifact[0].id);
  assert.equal(h.state.aiTaskExecutionCharge.every(c => c.status === 'RESERVED'), true);
});

test('policy changes during tool execution cannot produce a completed artifact or settle resources', async () => {
  const h = harness(); await h.make().savePlan(plan, lease); await h.reserve();
  await assert.rejects(h.make().capture(lease, 'step-a', new AbortController().signal, async () => {
    h.control.planHash = 'e'.repeat(64); return { kind: 'succeeded', payload: { synthetic: true } };
  }));
  assert.equal(h.state.aiTaskResultArtifact.some(row => row.completeMeasurement), false);
  assert.equal(h.state.aiTaskExecutionCharge.every(row => row.status === 'RESERVED'), true);
});

test('actual resource source defers model-call binding until durable start and never executes a supplier', async () => {
  const h = harness(); await h.make().savePlan(plan, lease); h.state.aiTask[0].status = 'RUNNING'; h.state.aiStep[0].status = 'PENDING';
  let registrations = 0;
  const prepare = { prepare: async (ref, held) => {
    assert.equal(h.state.aiStep[0].status, 'RUNNING'); registrations++;
    h.state.aiGatewayInvocation.push({ id: 'invocation-a', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', stepId: 'step-a',
      actionId: 'action-a', stepFingerprint: 'a'.repeat(64), leaseOwnerId: held.holderId, fencingToken: held.fencingToken, expiresAt: new Date(held.expiresAt) });
    return { invocationId: 'invocation-a' };
  } };
  const catalog = { resolve: async () => ({ modelCall: true }) };
  const source = new PrismaTaskRunnerResourceSource(h.db, h.scopes, h.make(), catalog, () => now, prepare);
  const gate = new PersistentTaskRunnerResourceGate(h.budget, source);
  await gate.open(lease, false);
  const ref = { plan: plan.steps[0], registered: { stepId: 'step-a', runId: 'run-a', sequence: 1, stepRevision: 1, taskRevision: 1, replayed: false, existingStatus: 'pending' } };
  const pending = await gate.reserve(ref, lease);
  assert.equal(pending.modelPending, true); assert.equal(registrations, 0); assert.equal(pending.chargeIds.length, 3);
  h.state.aiStep[0].status = 'RUNNING'; h.state.aiStep[0].revision = 2; ref.registered.stepRevision = 2;
  const complete = await gate.beforeExecute(pending, ref, lease);
  assert.equal(complete.modelPending, undefined); assert.equal(complete.chargeIds.length, 4); assert.equal(registrations, 1);
  assert.equal(h.state.aiTaskExecutionCharge.find(c => c.resource === 'CALLS').gatewayInvocationId, 'invocation-a');
});

test('missing invocation input preparation denies model resource planning, not a silent non-model fallback', async () => {
  const h = harness(); await h.make().savePlan(plan, lease); h.state.aiTask[0].status = 'RUNNING'; h.state.aiStep[0].status = 'PENDING';
  const source = new PrismaTaskRunnerResourceSource(h.db, h.scopes, h.make(), { resolve: async () => ({ modelCall: true }) }, () => now);
  const ref = { plan: plan.steps[0], registered: { stepId: 'step-a', stepRevision: 1 } };
  await assert.rejects(source.charges(ref, lease)); assert.equal(h.state.aiTaskExecutionCharge.length, 0);
});
test('appended plan/result schema validates offline and has scoped compound foreign keys', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../apps/api/prisma/schema.prisma'), 'utf8');
  const before = require('node:child_process').execFileSync('git', ['show', '77d05769:apps/api/prisma/schema.prisma'], { encoding: 'utf8' });
  const result = offlinePrismaSchema(schema, before); assert.equal(result.violations, '');
  assert.match(result.diff, /CREATE TABLE `ai_task_run_plans`/); assert.match(result.diff, /CREATE TABLE `ai_task_result_artifacts`/);
  assert.doesNotMatch(result.diff, /DROP TABLE/);
  const sql = fs.readFileSync(path.join(__dirname, '../apps/api/prisma/migrations/20261006010000_ai_task_plan_result_evidence/migration.sql'), 'utf8');
  for (const name of ['ai_task_run_plans_run_fkey', 'ai_task_result_artifacts_step_fkey', 'ai_result_artifact_step_generation_key']) {
    assert.ok(result.diff.includes('`' + name + '`')); assert.ok(sql.includes('`' + name + '`'));
  }
  const models = Prisma.dmmf.datamodel.models;
  assert.deepEqual(models.find(m => m.name === 'AiTaskRunPlan').primaryKey.fields, ['scopeId', 'taskId', 'runId']);
  assert.deepEqual(models.find(m => m.name === 'AiTaskResultArtifact').fields.find(f => f.name === 'step').relationFromFields, ['scopeId', 'taskId', 'stepId']);
});
