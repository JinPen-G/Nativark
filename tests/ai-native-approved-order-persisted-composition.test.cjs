'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { persistedApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-persisted.cjs');
const { PrismaAiApprovalRepository } = require('../apps/api/src/modules/ai-native/ai-approval-repository');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const rejected = e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_REVISION_CONFLICT', 'AI_STORAGE_UNAVAILABLE', 'AI_INVALID_INPUT', 'AI_RESULT_UNKNOWN'].includes(e.code);

async function harness() {
  const h = await persistedApprovedOrderHarness(), { state, dependencies: d } = h;
  for (const name of ['aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval']) state.records[name] = [];
  state.records.aiApprovedOrderSnapshot = [];
  state.records.aiStep[0].revision = 1;
  Object.assign(state.records.quote[0], { chargeLines: [], rateSnapshot: [], calendarSnapshot: [], calendarWarnings: [],
    appliedDiscountPlanIds: [], discountEvaluations: [], serviceSnapshots: [], rentalAmount: 123, discountAmount: 0,
    couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0, receivableAmount: 123 });
  Object.assign(d.db, h.client(null, false));
  const deps = { ...d, ...h.policyDependencies, inputSource: { read: async ({ context, scopeId, taskId, actionId, runId }) => {
    assert.equal(context.actor.userId, 'operator-a'); assert.equal(scopeId, 'scope-a'); assert.equal(taskId, 'task-a');
    assert.equal(actionId, 'action-a'); assert.equal(runId, 'run-a'); return structuredClone(h.body);
  } } };
  const command = { taskId: 'task-a', proposalId: 'proposal-a', proposalRevision: 1, actionId: 'action-a',
    expiresAt: h.payload.expiresAt, lease: h.command.lease };
  const compose = () => require('../apps/api/src/modules/ai-native/approval-execution/persisted-approved-order.composition').composePersistedApprovedOrder(deps);
  const approve = async root => {
    const pending = await root.prepare(command), payload = state.records.aiProposalVersion[0].payload;
    const approval = await new PrismaAiApprovalRepository(d.db).decide({ scopeId: 'scope-a', taskId: 'task-a', proposalId: 'proposal-a',
      proposalRevision: 1, payload, reviewedPayloadHash: pending.reviewedPayloadHash, decision: 'approved' },
    { actorKind: 'user', actorId: 'operator-a', audience: 'operator', scopeId: 'scope-a' });
    return { ...h.command, reviewedPayloadHash: pending.reviewedPayloadHash, approvalId: approval.approvalId };
  };
  return { ...h, deps, prepareCommand: command, compose, approve };
}

test('prepare persists full Core quote and DTO input with refs only in a pending proposal, never auto-approves', async () => {
  const h = await harness(), root = h.compose(); const pending = await root.prepare(h.prepareCommand);
  assert.equal(h.state.records.aiApproval.length, 0); assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.records.aiProposal[0].status, 'PENDING_CONFIRMATION'); assert.equal(h.state.records.aiProposal[0].currentRevision, null);
  assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 2);
  const [input, preview] = h.state.records.aiApprovedOrderSnapshot;
  assert.equal(input.kind, 'INPUT'); assert.equal(preview.kind, 'PREVIEW');
  assert.equal(input.contentHash, requestFingerprint(h.body)); assert.equal(preview.contentHash, requestFingerprint(h.state.records.quote[0]));
  const payload = h.state.records.aiProposalVersion[0].payload;
  assert.deepEqual(Object.keys(payload.actions[0].input).sort(), ['contentHash', 'recordId', 'revision']);
  assert.equal(pending.reviewedPayloadHash, h.state.records.aiProposalVersion[0].payloadHash);
  assert.deepEqual(await root.prepare(h.prepareCommand), pending); assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 2);
});
test('persisted sources compose through actual approval, Core confirmation and idempotency', async () => {
  const h = await harness(), root = h.compose(), command = await h.approve(root);
  assert.equal((await root.submit(command)).replayed, false);
  assert.equal((await root.submit(command)).replayed, true);
  assert.equal(h.state.records.aiApprovalConsumption[0].status, 'COMMITTED'); assert.equal(h.state.records.rentalOrder.length, 1);
});
for (const [name, mutate] of Object.entries({
  'missing snapshot': s => { s.records.aiApprovedOrderSnapshot.pop(); },
  'wrong scope': s => { s.records.aiApprovedOrderSnapshot[0].scopeId = 'scope-b'; },
  'wrong proposal revision': s => { s.records.aiApprovedOrderSnapshot[0].proposalRevision++; },
  'wrong snapshot revision': s => { s.records.aiApprovedOrderSnapshot[0].revision++; },
  'wrong action': s => { s.records.aiApprovedOrderSnapshot[0].actionId = 'other'; },
  'content changed': s => { s.records.aiApprovedOrderSnapshot[0].payload.customerName = 'changed'; },
  'quote changed': s => { s.records.quote[0].payableAmount++; },
  'quote expired': s => { s.records.quote[0].expiresAt = '2000-01-01T00:00:00Z'; },
  'AI disabled': s => { s.records.aiBudgetPolicy[0].enabled = false; },
  'permission revoked': s => { s.user.permissions = []; }
})) test(`persisted chain fails closed for ${name}`, async () => {
  const h = await harness(), root = h.compose(), command = await h.approve(root); mutate(h.state);
  await assert.rejects(root.submit(command), rejected);
  assert.equal(h.state.records.rentalOrder.length, 0); assert.equal(h.state.records.aiApprovalConsumption.length, 0);
});
for (const [name, mutate] of Object.entries({
  'missing input source': h => { delete h.deps.inputSource; },
  'missing quote validator': h => { h.deps.confirmation = { createApprovedOrder: h.deps.confirmation.createApprovedOrder.bind(h.deps.confirmation) }; }
})) test(`formal factory cannot become ready with ${name}`, async () => {
  const h = await harness(); mutate(h); assert.throws(h.compose, rejected);
});
for (const [name, mutate] of Object.entries({
  'missing original input': h => { h.deps.inputSource.read = async () => null; },
  'unvalidated input': h => { h.deps.inputSource.read = async () => ({ ...h.body, lines: [] }); },
  'risk exceptions': h => { h.deps.inputSource.read = async () => ({ ...h.body, capabilityExceptions: [] }); },
  'different quote request': h => { h.state.records.quote[0].request.customerId = 'other'; },
  'expired quote': h => { h.state.records.quote[0].expiresAt = '2000-01-01T00:00:00Z'; },
  'stale lease': h => { h.prepareCommand.lease.fencingToken = '8'; }
})) test(`prepare denies ${name} without publishing snapshots`, async () => {
  const h = await harness(); mutate(h); await assert.rejects(h.compose().prepare(h.prepareCommand), rejected);
  assert.equal(h.state.records.aiProposal.length, 0); assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 0);
});
for (const key of ['body', 'payload', 'context', 'approved', 'success', 'bookingIdentity']) test(`prepare cannot accept caller-controlled ${key}`, async () => {
  const h = await harness(); await assert.rejects(h.compose().prepare({ ...h.prepareCommand, [key]: {} }), rejected);
  assert.equal(h.state.records.aiProposal.length, 0);
});
test('snapshot insert failure rolls back proposal version and action in the same transaction', async () => {
  const h = await harness(); h.state.failAt = 'aiApprovedOrderSnapshot.create';
  await assert.rejects(h.compose().prepare(h.prepareCommand), rejected);
  assert.deepEqual(h.state.failures, ['aiApprovedOrderSnapshot.create']);
  for (const name of ['aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApprovedOrderSnapshot']) assert.equal(h.state.records[name].length, 0);
});
test('late cancellation during snapshot insertion prevents pending proposal publication', async () => {
  const h = await harness(); let changed = false;
  h.state.onOperation = ({ model, op, records }) => { if (model === 'aiApprovedOrderSnapshot' && op === 'create') {
    changed = true; records.aiTask[0].cancelRequestedAt = new Date();
  } };
  await assert.rejects(h.compose().prepare(h.prepareCommand), rejected); assert.equal(changed, true);
  assert.equal(h.state.records.aiProposal.length, 0); assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 0);
});
test('COMMIT response loss reconciles one persisted order even after AI is disabled and task cancelled', async () => {
  const h = await harness(), root = h.compose(), command = await h.approve(root); h.state.ackLost = true;
  await assert.rejects(root.submit(command), e => e.code === 'AI_RESULT_UNKNOWN' && e.nextAction === 'reconcile');
  h.state.ackLost = false; h.state.records.aiBudgetPolicy = []; h.state.records.subscriptionFeatureCatalog = [];
  h.state.records.aiTask[0].cancelRequestedAt = new Date();
  assert.equal((await root.reconcile(command)).replayed, true); assert.equal(h.state.records.rentalOrder.length, 1); assert.equal(h.state.prepares, 1);
  h.state.session = false; await assert.rejects(root.reconcile(command), rejected);
});
test('simultaneous persisted consumption cannot commit two orders', async () => {
  const h = await harness(), root = h.compose(), command = await h.approve(root);
  const results = await Promise.allSettled([root.submit(command), root.submit(command)]);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  assert.equal(h.state.records.rentalOrder.length, 1); assert.equal(h.state.records.aiApprovalConsumption.length, 1);
});
test('prepare does not leak a source cause or a private key', async () => {
  const h = await harness(); h.deps.inputSource.read = async () => { throw Error('key=offline-private-secret'); };
  await assert.rejects(h.compose().prepare(h.prepareCommand), e => rejected(e) && !String(e).includes('offline-private-secret') && !e.cause);
});

test('prepare checks the real quote only inside the exact Guard-owned ALS', async () => {
  const h = await harness(); const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const find = h.deps.quoteFacts.findQuote; let reads = 0;
  h.deps.quoteFacts.findQuote = async (...args) => {
    assert.equal(getRequestIdentity()?.userId, 'operator-a'); assert.equal(getRequestIdentity()?.workspaceId, 'workspace-a');
    assert.ok(args[2]); reads++; return find(...args);
  };
  await h.compose().prepare(h.prepareCommand); assert.ok(reads >= 2);
});
for (const [name, change] of Object.entries({
  'invalid nested DTO': body => { body.lines = []; },
  'extra caller money': body => { body.payableAmount = 1; }
})) test(`prepare reaches the original DTO boundary for ${name} despite a matching step hash`, async () => {
  const h = await harness(), body = structuredClone(h.body); change(body);
  h.state.records.aiStep[0].requestFingerprint = requestFingerprint(body); h.deps.inputSource.read = async () => body;
  let reads = 0; h.deps.quoteFacts.findQuote = async () => { reads++; throw Error('quote must not be reached'); };
  await assert.rejects(h.compose().prepare(h.prepareCommand), rejected); assert.equal(reads, 0);
  assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 0);
});
test('prepare never guesses bookingIdentity from the current quote', async () => {
  const h = await harness(); h.state.records.quote[0].request.bookingIdentity = { bookingIdentity: 'personal' };
  let checked = 0; const check = h.deps.confirmation.assertOrderMatchesQuote.bind(h.deps.confirmation);
  h.deps.confirmation.assertOrderMatchesQuote = (...args) => { checked++; return check(...args); };
  await assert.rejects(h.compose().prepare(h.prepareCommand), rejected); assert.equal(checked, 1);
  assert.equal(h.body.bookingIdentity, undefined); assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 0);
});
test('preview hashes cover the full stored JSON, not just its consumer Pick fields', async () => {
  const h = await harness(); h.state.records.quote[0].extraCoreEvidence = { immutableVersion: 'original' };
  const root = h.compose(), command = await h.approve(root);
  const stored = h.state.records.aiApprovedOrderSnapshot.find(row => row.kind === 'PREVIEW');
  assert.equal(stored.payload.extraCoreEvidence.immutableVersion, 'original'); stored.payload.extraCoreEvidence.immutableVersion = 'changed';
  await assert.rejects(root.submit(command), rejected); assert.equal(h.state.prepares, 0);
});
test('snapshot query hit is rechecked by exact record identity', async () => {
  const h = await harness(), root = h.compose(), command = await h.approve(root);
  const find = h.deps.db.aiApprovedOrderSnapshot.findFirst;
  h.deps.db.aiApprovedOrderSnapshot.findFirst = async args => { const row = await find(args); return row && { ...row, recordId: 'foreign-record' }; };
  await assert.rejects(root.submit(command), rejected); assert.equal(h.state.prepares, 0);
});
for (const [name, change] of Object.entries({
  'snapshot revision': (records) => { records.aiApprovedOrderSnapshot[0].revision++; },
  'snapshot content': (records) => { records.aiApprovedOrderSnapshot[0].payload.customerName = 'changed'; },
  'snapshot scope': (records) => { records.aiApprovedOrderSnapshot[0].scopeId = 'other'; },
  'session revoked': (_records, state) => { state.session = false; },
  'entitlement revoked': (_records, state) => { state.records.subscriptionFeatureCatalog = []; },
  'tenant AI disabled': (_records, state) => { state.records.aiBudgetPolicy[1].enabled = false; }
})) test(`late ${name} after the Core write rolls back order and consumption`, async () => {
  const h = await harness(), root = h.compose(), command = await h.approve(root); let injected = false;
  h.state.onOperation = ({ model, op, records, inTransaction }) => {
    if (!injected && inTransaction && model === 'rentalOrderIdempotencyRecord' && op === 'create') { injected = true; change(records, h.state); }
  };
  await assert.rejects(root.submit(command), rejected); assert.equal(injected, true);
  assert.equal(h.state.records.rentalOrder.length, 0); assert.equal(h.state.records.aiApprovalConsumption.length, 0);
});
test('simultaneous preparation reuses the same pending proposal and two immutable records', async () => {
  const h = await harness(), root = h.compose();
  const [first, second] = await Promise.all([root.prepare(h.prepareCommand), root.prepare(h.prepareCommand)]);
  assert.deepEqual(first, second); assert.equal(h.state.records.aiProposalVersion.length, 1);
  assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 2); assert.equal(h.state.records.aiApproval.length, 0);
});
test('revocation after preparation commit suppresses publication without deleting pending facts', async () => {
  const h = await harness(), root = h.compose(); let revoked = false;
  h.state.afterTransactionCommit = () => { if (!revoked && h.state.records.aiApprovedOrderSnapshot.length === 2) {
    revoked = true; h.state.session = false;
  } };
  await assert.rejects(root.prepare(h.prepareCommand), rejected); assert.equal(revoked, true);
  assert.equal(h.state.records.aiProposal.length, 1); assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 2);
  assert.equal(h.state.records.aiApproval.length, 0); h.state.session = true;
  await root.prepare(h.prepareCommand); assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 2);
});

test('preparation COMMIT response loss reports unknown and exact replay reads the committed pending evidence', async () => {
  const h = await harness(), root = h.compose(); let lost = false;
  h.state.afterTransactionCommit = () => {
    if (!lost && h.state.records.aiApprovedOrderSnapshot.length === 2) {
      lost = true; throw Error('synthetic preparation COMMIT acknowledgement lost');
    }
  };
  await assert.rejects(root.prepare(h.prepareCommand), e => e.code === 'AI_RESULT_UNKNOWN');
  assert.equal(lost, true);
  assert.equal(h.state.records.aiProposalVersion.length, 1);
  assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 2);
  assert.equal(h.state.records.aiApproval.length, 0);
  assert.equal(h.state.records.rentalOrder.length, 0);
  const recovered = await root.prepare(h.prepareCommand);
  assert.equal(recovered.reviewedPayloadHash, h.state.records.aiProposalVersion[0].payloadHash);
  assert.equal(h.state.records.aiApprovedOrderSnapshot.length, 2);
});

test('preparation unknown never permits a different proposal payload to overwrite committed evidence', async () => {
  const h = await harness(), root = h.compose(); let lost = false;
  h.state.afterTransactionCommit = () => {
    if (!lost && h.state.records.aiApprovedOrderSnapshot.length === 2) { lost = true; throw Error('synthetic lost acknowledgement'); }
  };
  await assert.rejects(root.prepare(h.prepareCommand), e => e.code === 'AI_RESULT_UNKNOWN');
  const before = structuredClone(h.state.records.aiApprovedOrderSnapshot);
  await assert.rejects(root.prepare({ ...h.prepareCommand, expiresAt: '2027-01-01T00:00:00.000Z' }), rejected);
  assert.deepEqual(h.state.records.aiApprovedOrderSnapshot, before);
  assert.equal(h.state.records.aiApproval.length, 0);
});
