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
test('confirmation phase schema binds original evidence and preserves append-only receipt structure', () => {
  const root = path.resolve(__dirname, '..');
  const schema = fs.readFileSync(path.join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
  const before = schema.replace(/^model AiTaskExecutionPhase(?:Start|Receipt) \{[\s\S]*?^\}\r?\n/gmu, '')
    .split(/\r?\n/u).filter(line => !/\bAiTaskExecutionPhase(?:Start|Receipt)\b/u.test(line)
      && !line.includes('"ai_approvals_scope_task_id"')).join('\n');
  const migration = fs.readFileSync(path.join(root, 'apps/api/prisma/migrations/20261008120000_ai_task_execution_phases/migration.sql'), 'utf8');
  const result = offlinePrismaSchema(schema, before);
  assert.equal(result.violations, '');
  const statements = value => value.replace(/--[^\n]*(?:\n|$)/gu, '').split(';').map(s => s.replace(/\s+/gu, ' ').trim()).filter(Boolean);
  const generated = statements(result.diff), authored = statements(migration);
  assert.deepEqual(authored.slice(0, generated.length), generated);
  assert.equal(generated.filter(s => s.startsWith('CREATE TABLE')).length, 2);
  assert.ok(authored.every(s => /^(CREATE TABLE|CREATE UNIQUE INDEX|ALTER TABLE .* ADD CONSTRAINT) /u.test(s)));
  assert.doesNotMatch(result.diff, /ALTER TABLE `(ai_steps|ai_tasks|ai_task_execution_budgets)`/u);
  assert.match(migration, /FOREIGN KEY \(`scopeId`, `taskId`, `runId`, `stepId`, `previousReceiptId`\) REFERENCES `ai_task_execution_phase_receipts`/u);
  assert.match(migration, /UNIQUE INDEX `ai_exec_phase_start_previous_key`\(`scopeId`, `taskId`, `previousReceiptId`\)/u);
  assert.match(migration, /`sequence` = 2 AND `previousReceiptId` IS NOT NULL AND `decisionRef` IS NOT NULL/u);
  assert.match(migration, /BINARY `kind` IN \('confirmation', 'succeeded', 'failed', 'unknown'\)/u);
  const models = Prisma.dmmf.datamodel.models;
  const start = models.find(m => m.name === 'AiTaskExecutionPhaseStart');
  const receipt = models.find(m => m.name === 'AiTaskExecutionPhaseReceipt');
  assert.ok(start); assert.ok(receipt);
  for (const name of ['activeMs', 'outputBytes', 'runId', 'stepId']) {
    const field = receipt.fields.find(f => f.name === name);
    assert.equal(field.isRequired, true); assert.equal(field.hasDefaultValue, false);
  }
  assert.deepEqual(receipt.fields.find(f => f.name === 'phase').relationFromFields, ['scopeId', 'taskId', 'runId', 'stepId', 'phaseId']);
  assert.deepEqual(start.fields.find(f => f.name === 'previousReceipt').relationFromFields, ['scopeId', 'taskId', 'runId', 'stepId', 'previousReceiptId']);
  assert.ok(!receipt.fields.some(f => f.name === 'updatedAt'));
  assert.ok(!start.fields.some(f => f.name === 'updatedAt' || f.name === 'callsChargeId'));
});

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
    if (k === 'OR') return v.some(w => match(row, w));
    if (k === 'fencingToken') return String(row[k]) === String(v);
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
    if (v && typeof v === 'object' && 'gt' in v) return row[k] > v.gt;
    return row[k] === v;
  });
}
function harness() {
  const state = { aiTask: [{ id: 'task-a', scopeId: 'scope-a', ownerId: 'user-a', status: 'RUNNING', revision: 1, cancelRequestedAt: null }],
    aiRun: [{ id: 'run-a', scopeId: 'scope-a', taskId: 'task-a', sequence: 1, leaseOwnerId: 'worker-a', fencingToken: '1', revision: 1, status: 'RUNNING', leaseExpiresAt: new Date(lease.expiresAt) }],
    aiStep: [{ id: 'step-a', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', status: 'RUNNING', resultRef: null, revision: 1,
      toolCode: 'rental.order.explain', toolVersion: '1', inputRef: 'input-a', actionId: 'action-a', requestFingerprint: 'a'.repeat(64) }],
    aiTaskRunPlan: [], aiTaskRunPreparation: [], aiTaskResultArtifact: [], aiTaskExecutionBudget: [], aiGatewayInvocation: [], aiGatewayAccountingReceipt: [], aiInvocationAdmission: [], aiBudgetReservation: [], aiTaskExecutionCharge: [] };
  const control = { revoked: false, failArtifact: false, loseReply: false, tick: 10, planHash: 'b'.repeat(64) };
  const hydrate = row => row ? { ...clone(row), ...('fencingToken' in row ? { fencingToken: new Prisma.Decimal(row.fencingToken) } : {}) } : null;
  const delegates = data => Object.fromEntries(Object.keys(data).map(name => [name, {
    findFirst: async ({ where, orderBy }) => {
      let found = data[name].filter(row => match(row, where));
      for (const order of [...(Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [])].reverse()) {
        const [field, direction] = Object.entries(order)[0];
        found.sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === 'desc' ? -1 : 1));
      }
      return hydrate(found[0]);
    },
    findUnique: async ({ where }) => hydrate(data[name].find(row => match(row, typeof Object.values(where)[0] === 'object' ? Object.values(where)[0] : where))),
    findMany: async ({ where, take }) => data[name].filter(row => match(row, where)).slice(0, take).map(hydrate),
    upsert: async ({ where, create }) => { let row = data[name].find(row => match(row, Object.values(where)[0]));
      if (!row) { row = { reservedSteps: 0n, consumedSteps: 0n, reservedCalls: 0n, consumedCalls: 0n, reservedActiveMs: 0n, consumedActiveMs: 0n,
        reservedOutputBytes: 0n, consumedOutputBytes: 0n, revision: 1, ...clone(create) }; data[name].push(row); } return hydrate(row); },
    create: async ({ data: value }) => {
      if (name === 'aiTaskResultArtifact' && control.failArtifact) throw Error('write failed');
      if (name === 'aiTaskResultArtifact' && data[name].some(row => ['scopeId', 'taskId', 'runId', 'stepId', 'fencingToken'].every(k => String(row[k]) === String(value[k])))) throw Error('unique generation');
      if (name === 'aiTaskRunPlan' && data[name].some(row => ['scopeId', 'taskId', 'runId'].every(k => row[k] === value[k]))) throw Error('unique plan');
      const stored = { revision: 1, ...clone(value) };
      if (name === 'aiTaskRunPreparation') {
        stored.prepared ??= false;
        for (const field of ['chargeId', 'requestFingerprint', 'completedAt', 'activeMs', 'planHash', 'measurementHash']) stored[field] ??= null;
      }
      data[name].push(stored); return hydrate(stored);
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
  const authority = { authorize: async () => ({ authorityHash: control.planHash, policyVersion: 'policy-a', expiresAt: '2026-10-06T12:01:00Z' }),
    // Explicit metadata-authority double; real hosts use their current stored scene policy.
    authorizePreparation: async () => ({ authorityHash: control.planHash, policyVersion: 'policy-a', expiresAt: '2026-10-06T12:01:00Z' }) };
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
test('original Run preparation reserves before publication and preserves cumulative debt through recovery', async () => {
  const { PrismaTaskRunPreparation, taskPreparationNonEffectChargeIds } = require('../apps/api/src/modules/ai-native/runner/prisma-task-run-preparation');
  const create = async () => {
    const h = harness(); h.state.aiStep[0].status = 'PENDING';
    const evidence = h.make(), preparation = new PrismaTaskRunPreparation(h.db, evidence, h.authority, () => now, () => h.control.tick);
    const tasks = { readMetadata: async () => ({ taskId: 'task-a', revision: 1, status: 'running', cancelRequestedAt: null }) };
    const makeBudget = () => new PrismaTaskExecutionBudgetRepository(h.db, h.scopes,
      new PersistedPlanResourcePolicySource(tasks, h.make(), preparation), {
        read: (request, reconcile) => request.evidenceRef.startsWith('preparation:') ? preparation.read(request, reconcile) : h.make().read(request, reconcile)
      }, () => now);
    const definition = { taskId: plan.taskId, runId: plan.runId, steps: clone(plan.steps), limits: clone(plan.limits), bindingHash: 'e'.repeat(64) };
    return { ...h, evidence, preparation, makeBudget, definition };
  };
  const h = await create(), budget = h.makeBudget();
  const ticket = await h.preparation.begin(lease, h.definition, 300, budget);
  assert.equal(h.state.aiTaskRunPlan.length, 0, 'quota admission must not fabricate an executable plan');
  assert.equal((await budget.load('task-a', lease)).reserved.active_ms, 300n);
  assert.equal(h.state.aiTaskExecutionCharge.length, 1);
  assert.equal(h.state.aiTaskExecutionCharge[0].stepId, null);
  assert.equal(h.state.aiTaskExecutionCharge[0].resource, 'ACTIVE_MS');
  assert.deepEqual(await taskPreparationNonEffectChargeIds(h.db, { scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a' }, lease), [ticket.key]);
  h.control.tick += 25; await h.evidence.savePlan(plan, lease);
  await h.preparation.complete(ticket, lease, budget);
  const first = await h.makeBudget().load('task-a', lease);
  assert.equal(first.consumed.active_ms, 25n); assert.equal(first.reserved.active_ms, 0n);
  assert.equal(first.consumed.steps, 0n); assert.equal(first.consumed.calls, 0n);
  await h.preparation.complete({ ...ticket, prepared: true }, lease, budget);
  assert.equal((await budget.load('task-a', lease)).consumed.active_ms, 25n, 'same receipt does not double count');
  const nextLease = { ...lease, holderId: 'worker-b', revision: 2, fencingToken: '2' };
  Object.assign(h.state.aiRun[0], { leaseOwnerId: nextLease.holderId, revision: 2, fencingToken: '2' });
  const second = await h.preparation.begin(nextLease, h.definition, 300, budget);
  assert.notEqual(second.key, ticket.key, 'new held validation phase gets its own bounded charge, not a reset');
  h.control.tick += 7; await h.evidence.savePlan(plan, nextLease);
  await h.preparation.complete(second, nextLease, budget);
  assert.equal((await h.makeBudget().load('task-a', nextLease)).consumed.active_ms, 32n);
  assert.equal(h.state.aiTaskExecutionCharge.length, 2);
  assert.equal(h.state.aiTaskRunPlan.length, 1);

  const interrupted = await create(), held = interrupted.makeBudget();
  const uncertain = await interrupted.preparation.begin(lease, interrupted.definition, 300, held);
  await interrupted.preparation.abandon(uncertain, lease, held);
  Object.assign(interrupted.state.aiRun[0], { leaseOwnerId: nextLease.holderId, revision: 2, fencingToken: '2' });
  const before = clone(interrupted.state.aiTaskExecutionCharge);
  await assert.rejects(interrupted.preparation.begin(nextLease, interrupted.definition, 300, held), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.deepEqual(interrupted.state.aiTaskExecutionCharge, before);
  assert.equal((await held.load('task-a', nextLease)).reserved.active_ms, 300n);
  assert.equal(interrupted.state.aiTaskRunPlan.length, 0);

  const committed = await create(), original = committed.makeBudget();
  const originalTicket = await committed.preparation.begin(lease, committed.definition, 300, original);
  committed.control.tick += 11; await committed.evidence.savePlan(plan, lease);
  committed.control.loseReply = true;
  await assert.rejects(committed.preparation.complete(originalTicket, lease, original), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.ok(committed.state.aiTaskRunPreparation[0].completedAt, 'original time receipt survived COMMIT reply loss');
  assert.equal(committed.state.aiTaskExecutionCharge[0].status, 'RESERVED');
  Object.assign(committed.state.aiRun[0], { leaseOwnerId: nextLease.holderId, revision: 2, fencingToken: '2' });
  const replay = await committed.preparation.begin(nextLease, committed.definition, 300, original);
  assert.equal((await original.load('task-a', nextLease)).consumed.active_ms, 11n);
  assert.equal(committed.state.aiTaskRunPreparation.length, 2);
  await committed.preparation.abandon(replay, nextLease, original);
  assert.equal((await original.load('task-a', nextLease)).reserved.active_ms, 300n);
  assert.equal(committed.state.aiTaskRunPlan.length, 1);
});

test('successor preparation preserves original debt and rejects broken lineage or phase replacement', async () => {
  const { PrismaTaskRunPreparation } = require('../apps/api/src/modules/ai-native/runner/prisma-task-run-preparation');
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const fixture = createTaskInputStore({ businessWorkspace: ['ACTIVE', 'FROZEN', 'DISABLED']
    .map(status => ({ id: status, tenantId: 'tenant-a', status })) });
  for (const status of ['ACTIVE', 'FROZEN', 'DISABLED']) {
    const rows = await fixture.db.$queryRaw(Prisma.sql`SELECT id, status FROM business_workspaces WHERE tenantId = ${'tenant-a'} AND id = ${status} FOR UPDATE`);
    assert.equal(rows[0].status, status.toLowerCase(), 'raw SQL preserves the actual mapped active/frozen/disabled state');
    assert.equal((await fixture.db.businessWorkspace.findFirst({ where: { id: status } })).status, status, 'Prisma projection is not rewritten');
    assert.equal(rows[0].status === 'active', status === 'ACTIVE');
  }
  assert.deepEqual(await fixture.db.$queryRaw(Prisma.sql`SELECT id, status FROM business_workspaces WHERE tenantId = ${'other'} AND id = ${'ACTIVE'} FOR UPDATE`), []);
  const create = async (negativePhase = false) => {
    const h = harness(); h.state.aiStep[0].status = 'PENDING';
    const evidence = h.make(), preparation = new PrismaTaskRunPreparation(h.db, evidence, h.authority, () => now, () => h.control.tick);
    const policies = new PersistedPlanResourcePolicySource({ readMetadata: async () => ({ taskId: 'task-a', revision: 1,
      status: 'running', cancelRequestedAt: null }) }, evidence, preparation);
    const budget = new PrismaTaskExecutionBudgetRepository(h.db, h.scopes, policies,
      { read: (request, reconcile) => preparation.read(request, reconcile) }, () => now);
    const original = { taskId: plan.taskId, runId: plan.runId, steps: clone(plan.steps), limits: clone(plan.limits), bindingHash: 'e'.repeat(64) };
    const rootTicket = await preparation.begin(lease, original, 100, budget);
    h.control.tick += 5; await evidence.savePlan(plan, lease); await preparation.complete(rootTicket, lease, budget);
    const rootPolicy = await policies.resolve('task-a', lease);
    // Scope, actor, parent and consumed-answer doubles represent the existing
    // persisted lineage. Production preparation/evidence/budget code runs unchanged.
    Object.assign(h.state.aiRun[0], { status: 'SUCCEEDED', actorKind: 'USER', actorId: 'user-a' });
    let held = { ...lease, runId: 'run-b', holderId: 'worker-b', revision: 2, fencingToken: '2' };
    h.state.aiRun.push({ ...clone(h.state.aiRun[0]), id: held.runId, sequence: 2, status: 'RUNNING',
      leaseOwnerId: held.holderId, revision: held.revision, fencingToken: held.fencingToken,
      inputReceiptId: 'answer-a', resourceOriginRunId: 'run-a' });
    h.state.aiTaskInputReceipt = [{ id: 'answer-a', scopeId: 'scope-a', taskId: 'task-a', requestId: 'question-a',
      actorKind: 'USER', actorId: 'user-a', consumedAt: now, consumedTaskRevision: 2, planHash: 'f'.repeat(64) }];
    h.state.aiTaskInputRequest = [{ id: 'question-a', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a',
      status: 'CONSUMED', waitingTaskRevision: 1, planHash: 'f'.repeat(64) }];
    for (const name of ['aiTaskInputReceipt', 'aiTaskInputRequest']) h.db[name] = {
      findUnique: async ({ where }) => clone(h.state[name].find(row => match(row, Object.values(where)[0])) ?? null)
    };
    if (negativePhase) {
      const rejected = await preparation.begin(held, original, 100, budget);
      h.control.tick += 3;
      await assert.rejects(preparation.complete(rejected, held, budget), error => error.code === 'AI_RESULT_UNKNOWN');
      assert.equal(h.state.aiTaskRunPreparation.at(-1).prepared, false);
      assert.ok(h.state.aiTaskRunPreparation.at(-1).completedAt);
      assert.equal(h.state.aiTaskExecutionCharge.at(-1).status, 'RECORDED');
      held = { ...held, holderId: 'worker-c', revision: 3, fencingToken: '3' };
      Object.assign(h.state.aiRun[1], { leaseOwnerId: held.holderId, revision: held.revision, fencingToken: held.fencingToken });
    }
    const definition = { ...original, runId: held.runId, steps: [{ registrationRef: 'registration-order',
      operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: '1' }], bindingHash: 'd'.repeat(64) };
    return { ...h, evidence, preparation, budget, policies, rootPolicy, held, definition };
  };
  for (const negativePhase of [false, true]) {
    const h = await create(negativePhase), priorDebt = negativePhase ? 8n : 5n;
    h.authority.authorizePreparation = async definition => {
      assert.equal(definition.runId, h.held.runId);
      assert.equal(definition.steps[0].toolCode, 'rental.order.commit', 'current admission cannot reuse old model preparation authority');
      return { authorityHash: h.control.planHash, policyVersion: 'policy-a', expiresAt: '2026-10-06T12:01:00Z' };
    };
    const ticket = await h.preparation.begin(h.held, h.definition, 100, h.budget);
    assert.deepEqual(await h.policies.resolve('task-a', h.held), h.rootPolicy, 'current formal action never replaces the original resource origin');
    assert.equal((await h.budget.load('task-a', h.held)).consumed.active_ms, priorDebt);
    h.control.tick += 7;
    await h.evidence.savePlan({ taskId: 'task-a', runId: h.held.runId, taskRevision: 1,
      steps: clone(h.definition.steps), limits: clone(h.definition.limits) }, h.held);
    await h.preparation.complete(ticket, h.held, h.budget);
    const completed = await h.budget.load('task-a', h.held);
    assert.equal(completed.consumed.active_ms, priorDebt + 7n); assert.equal(completed.reserved.active_ms, 0n);
    assert.deepEqual(completed.policy, h.rootPolicy);
    assert.equal(h.state.aiTaskRunPlan.length, 2, 'both immutable Run plans remain, not an overwritten origin');
  }
  for (const mutate of [
    h => { h.definition.limits.maxCalls++; },
    h => { delete h.authority.authorizePreparation; },
    h => { h.state.aiTaskInputReceipt.length = 0; },
    h => { h.state.aiTaskInputReceipt[0].actorId = 'other'; },
    h => { h.state.aiTaskInputRequest[0].scopeId = 'other'; },
    h => { h.state.aiTaskInputRequest[0].planHash = 'a'.repeat(64); },
    h => { h.state.aiRun[0].status = 'UNKNOWN'; },
    h => { h.state.aiRun[1].sequence = 3; },
    h => { h.state.aiRun[1].resourceOriginRunId = 'missing'; }
  ]) {
    const h = await create(), before = clone(h.state.aiTaskExecutionCharge); mutate(h);
    await assert.rejects(h.preparation.begin(h.held, h.definition, 100, h.budget));
    assert.deepEqual(h.state.aiTaskExecutionCharge, before, 'invalid lineage/limits cannot reserve or erase debt');
    assert.equal(h.state.aiTaskRunPreparation.length, 1);
  }
  for (const mutate of [
    h => { h.state.aiTaskRunPreparation.at(-1).completedAt = null; },
    h => { h.state.aiTaskRunPreparation.at(-1).measurementHash = 'a'.repeat(64); },
    h => { h.state.aiTaskRunPreparation.at(-1).prepared = true; },
    h => { h.state.aiTaskRunPreparation.at(-1).fencingToken = h.held.fencingToken; }
  ]) {
    const h = await create(true), before = clone(h.state.aiTaskExecutionCharge); mutate(h);
    await assert.rejects(h.preparation.begin(h.held, h.definition, 100, h.budget));
    assert.deepEqual(h.state.aiTaskExecutionCharge, before, 'unknown or forged earlier phase is not a new preparation allowance');
  }
  const mismatched = await create(), ticket = await mismatched.preparation.begin(mismatched.held, mismatched.definition, 100, mismatched.budget);
  await mismatched.evidence.savePlan({ taskId: 'task-a', runId: mismatched.held.runId, taskRevision: 1,
    steps: clone(plan.steps), limits: clone(plan.limits) }, mismatched.held);
  await assert.rejects(mismatched.preparation.complete(ticket, mismatched.held, mismatched.budget), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(mismatched.state.aiTaskExecutionCharge.at(-1).status, 'RESERVED');
  assert.equal(mismatched.state.aiTaskRunPreparation.at(-1).completedAt, null, 'a different callback plan cannot publish success');
});

test('original preparation reservation subtracts admission time before any callback window', async () => {
  const { PrismaTaskRunPreparation } = require('../apps/api/src/modules/ai-native/runner/prisma-task-run-preparation');
  const create = async delay => {
    const h = harness(); h.state.aiStep[0].status = 'PENDING';
    const evidence = h.make(), preparation = new PrismaTaskRunPreparation(h.db, evidence, h.authority, () => now, () => h.control.tick);
    const budget = new PrismaTaskExecutionBudgetRepository(h.db, h.scopes,
      new PersistedPlanResourcePolicySource({ readMetadata: async () => ({ taskId: 'task-a', revision: 1, status: 'running', cancelRequestedAt: null }) }, evidence, preparation),
      { read: (request, reconcile) => preparation.read(request, reconcile) }, () => now);
    const transaction = h.db.$transaction; let delayed = false;
    h.db.$transaction = async (...args) => { const result = await transaction(...args); if (!delayed) { delayed = true; h.control.tick += delay; } return result; };
    const definition = { taskId: plan.taskId, runId: plan.runId, steps: clone(plan.steps), limits: clone(plan.limits), bindingHash: 'e'.repeat(64) };
    return { ...h, preparation, budget, definition };
  };
  const admitted = await create(40);
  const ticket = await admitted.preparation.begin(lease, admitted.definition, 300, admitted.budget);
  assert.equal(ticket.remainingMs, 260);
  assert.equal((await admitted.budget.load('task-a', lease)).reserved.active_ms, 300n);
  assert.equal(admitted.state.aiTaskRunPlan.length, 0);
  const expired = await create(400);
  await assert.rejects(expired.preparation.begin(lease, expired.definition, 300, expired.budget), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal((await expired.budget.load('task-a', lease)).reserved.active_ms, 300n);
  assert.equal(expired.state.aiTaskExecutionCharge[0].status, 'UNKNOWN');
  assert.equal(expired.state.aiTaskRunPlan.length, 0);
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
test('capture preparation time remains in the original cumulative active budget after restart', async () => {
  const h = harness(), first = plan.steps[0], second = { ...first, registrationRef: 'registration-b' };
  const savedPlan = { ...plan, steps: [first, second], limits: { ...plan.limits, maxTotalMs: 140 } };
  h.state.aiStep.push({ ...clone(h.state.aiStep[0]), id: 'step-b', actionId: 'action-b',
    requestFingerprint: 'b'.repeat(64), status: 'PENDING' });
  const evidence = h.make(); await evidence.savePlan(savedPlan, lease);
  const tasks = { readMetadata: async () => ({ taskId: 'task-a', revision: 1, status: 'running', cancelRequestedAt: null }) };
  const policies = () => new PersistedPlanResourcePolicySource(tasks, h.make());
  const budget = () => new PrismaTaskExecutionBudgetRepository(h.db, h.scopes, policies(), h.make(), () => now);
  const originalBudget = budget(); await originalBudget.initialize('task-a', lease);
  for (const resource of ['steps', 'active_ms', 'output_bytes']) await originalBudget.reserve({ taskId: 'task-a', lease,
    chargeId: `charge-${resource}`, resource, amount: resource === 'steps' ? 1n : resource === 'active_ms' ? 100n : 1000n,
    target: { kind: 'step', stepId: 'step-a', actionId: 'action-a', stepFingerprint: 'a'.repeat(64) } });
  // Explicit clock/transaction doubles account for authorization reads and the
  // original started-marker COMMIT, not just time inside the tool callback.
  let delayedRead = false, delayedMarker = false, effects = 0;
  const resolve = h.scopes.resolve, transaction = h.db.$transaction;
  h.scopes.resolve = async (...args) => {
    const result = await resolve(...args);
    if (!delayedRead) { delayedRead = true; h.control.tick += 7; }
    return result;
  };
  h.db.$transaction = async (...args) => {
    const result = await transaction(...args);
    if (!delayedMarker && h.state.aiTaskResultArtifact.some(row => row.outcome === 'RUNNING')) {
      delayedMarker = true; h.control.tick += 28;
    }
    return result;
  };
  const result = await evidence.capture(lease, 'step-a', new AbortController().signal, async () => {
    effects++; h.control.tick += 12; return { kind: 'succeeded', payload: { synthetic: true } };
  });
  assert.equal(h.state.aiTaskResultArtifact[0].activeMs, 47n);
  h.state.aiStep[0].status = 'SUCCEEDED'; h.state.aiStep[0].resultRef = result.resultRef;
  for (const resource of ['steps', 'active_ms', 'output_bytes']) await originalBudget.record({ taskId: 'task-a', lease,
    chargeId: `charge-${resource}`, evidenceRef: `${result.resultRef}:${resource}` });
  const restarted = budget(), snapshot = await restarted.load('task-a', lease);
  assert.equal(snapshot.consumed.active_ms, 47n); assert.equal(snapshot.policy.limits.active_ms, 140n);
  assert.equal(snapshot.consumed.steps, 1n); assert.equal(snapshot.consumed.calls, 0n);
  const before = clone(h.state.aiTaskExecutionBudget), charges = clone(h.state.aiTaskExecutionCharge);
  const source = new PrismaTaskRunnerResourceSource(h.db, h.scopes, h.make(), { resolve: async () => ({ modelCall: false }) }, () => now);
  const gate = new PersistentTaskRunnerResourceGate(restarted, source);
  await assert.rejects(gate.reserve({ plan: second, registered: { stepId: 'step-b', runId: 'run-a', sequence: 2,
    stepRevision: 1, taskRevision: 1, replayed: false, existingStatus: 'pending' } }, lease), error => error.code === 'AI_RUN_LIMIT');
  assert.deepEqual(h.state.aiTaskExecutionBudget, before); assert.deepEqual(h.state.aiTaskExecutionCharge, charges);
  assert.equal(h.state.aiStep[1].status, 'PENDING'); assert.equal(effects, 1);
  const invalid = harness(); await invalid.reserve(); invalid.control.tick = NaN;
  let invalidEffects = 0;
  await assert.rejects(invalid.make().capture(lease, 'step-a', new AbortController().signal, async () => {
    invalidEffects++; return { kind: 'succeeded', payload: {} };
  }), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(invalidEffects, 0); assert.equal(invalid.state.aiTaskResultArtifact.length, 0);
  assert.equal((await invalid.budget.load('task-a', lease)).reserved.active_ms, 100n);
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
