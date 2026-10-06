'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { persistedApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-persisted.cjs');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { PrismaApprovedOrderOriginalInputSource } = require('../apps/api/src/modules/ai-native/approval-execution/prisma-approved-order-original-input.source');
async function setup() {
  const h = await persistedApprovedOrderHarness();
  h.state.records.aiStep[0].inputRef = 'input-a';
  h.state.records.aiTaskActionInput = [{ scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', id: 'input-a',
    registrationRef: 'order-a', toolCode: 'rental.order.commit', toolVersion: '1', payload: structuredClone(h.body),
    fingerprint: requestFingerprint(h.body), policyRevision: 1, expiresAt: new Date('2099-01-01') }];
  Object.assign(h.dependencies.db, h.client(null, false));
  const source = new PrismaApprovedOrderOriginalInputSource(h.policy(), '1', h.dependencies.clock);
  const read = () => source.read({ context: h.context, scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', actionId: 'action-a' }, h.dependencies.db);
  return { ...h, source, read };
}
test('actual authorized source reads the registered immutable Core input, not the current quote', async () => {
  const h = await setup(); h.state.records.quote[0].request = { forged: true };
  const result = await h.read(); assert.deepEqual(result, h.body);
  result.customerName = 'modified'; assert.equal(h.state.records.aiTaskActionInput[0].payload.customerName, h.body.customerName);
  const rebuilt = new PrismaApprovedOrderOriginalInputSource(h.policy(), '1', h.dependencies.clock);
  assert.deepEqual(await rebuilt.read({ context: h.context, scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', actionId: 'action-a' }, h.dependencies.db), h.body);
  assert.equal(h.state.records.rentalOrder.length, 0);
});
for (const [label, change] of [
  ['missing input', h => { h.state.records.aiTaskActionInput = []; }],
  ['missing reference', h => { h.state.records.aiStep[0].inputRef = null; }],
  ['wrong scope', h => { h.state.records.aiTaskActionInput[0].scopeId = 'other'; }],
  ['wrong run', h => { h.state.records.aiTaskActionInput[0].runId = 'other'; }],
  ['wrong tool', h => { h.state.records.aiTaskActionInput[0].toolCode = 'rental.catalog.search'; }],
  ['wrong version', h => { h.state.records.aiTaskActionInput[0].toolVersion = '2'; }],
  ['changed payload', h => { h.state.records.aiTaskActionInput[0].payload.customerName = 'changed'; }],
  ['expired', h => { h.state.records.aiTaskActionInput[0].expiresAt = new Date('2000-01-01'); }],
  ['permission revoked', h => { h.state.user.permissions = []; }],
  ['AI gate revoked', h => { h.state.records.aiBudgetPolicy[0].enabled = false; }],
  ['malformed DTO with matching fingerprint', h => { const row = h.state.records.aiTaskActionInput[0]; row.payload.lines = []; row.fingerprint = requestFingerprint(row.payload); h.state.records.aiStep[0].requestFingerprint = row.fingerprint; }],
  ['unknown field with matching fingerprint', h => { const row = h.state.records.aiTaskActionInput[0]; row.payload.sql = 'synthetic'; row.fingerprint = requestFingerprint(row.payload); h.state.records.aiStep[0].requestFingerprint = row.fingerprint; }],
  ['capability exceptions', h => { const row = h.state.records.aiTaskActionInput[0]; row.payload.capabilityExceptions = []; row.fingerprint = requestFingerprint(row.payload); h.state.records.aiStep[0].requestFingerprint = row.fingerprint; }]
]) test(`original input rejects ${label}`, async () => {
  const h = await setup(); change(h);
  await assert.rejects(h.read(), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  assert.equal(h.state.records.rentalOrder.length, 0);
});
test('input change while current authority is awaited cannot return stale input', async () => {
  const h = await setup(); let count = 0;
  h.state.onOperation = ({ model, op }) => {
    if (model === 'aiTaskActionInput' && op === 'findFirst' && ++count === 2) h.state.records.aiTaskActionInput[0].payload.customerName = 'late change';
  };
  await assert.rejects(h.read(), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(count, 2);
});
test('withdrawal after reading input suppresses the response', async () => {
  const h = await setup();
  h.state.onOperation = ({ model, op }) => {
    if (model === 'aiTaskActionInput' && op === 'findFirst') h.state.user.permissions = [];
  };
  await assert.rejects(h.read(), e => e.code === 'AI_ACCESS_DENIED');
});
test('caller context cannot substitute another actor for the current authorized owner', async () => {
  const h = await setup(), context = structuredClone(h.context);
  context.actor.userId = 'other-user';
  await assert.rejects(h.source.read({ context, scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', actionId: 'action-a' }, h.dependencies.db), e => e.code === 'AI_ACCESS_DENIED');
});
test('the actual preparation service consumes stored input and persists only a pending proposal', async () => {
  const h = await setup();
  for (const model of ['aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval']) h.state.records[model] = [];
  h.state.records.aiApprovedOrderSnapshot = [];
  h.state.records.aiStep[0].revision = 1;
  Object.assign(h.state.records.quote[0], { chargeLines: [], rateSnapshot: [], calendarSnapshot: [], calendarWarnings: [],
    appliedDiscountPlanIds: [], discountEvaluations: [], serviceSnapshots: [], rentalAmount: 123, discountAmount: 0,
    couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0, receivableAmount: 123 });
  Object.assign(h.dependencies.db, h.client(null, false));
  const root = require('../apps/api/src/modules/ai-native/approval-execution/persisted-approved-order.composition')
    .composePersistedApprovedOrder({ ...h.dependencies, ...h.policyDependencies, inputSource: h.source });
  await root.prepare({ taskId: 'task-a', proposalId: 'proposal-a', proposalRevision: 1, actionId: 'action-a',
    expiresAt: h.payload.expiresAt, lease: h.command.lease });
  assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 2);
  assert.deepEqual(h.state.records.aiApprovedOrderSnapshot.find(row => row.kind === 'INPUT').payload, h.body);
  assert.equal(h.state.records.aiProposal[0].status, 'PENDING_CONFIRMATION');
  assert.equal(h.state.records.aiApproval.length, 0);
  assert.equal(h.state.records.rentalOrder.length, 0);
});
