'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { approvedOrderHarness } = require('./fixtures/ai-native/approved-order-composition.cjs');
const { composeAiApprovedOrder } = require('../apps/api/src/modules/ai-native/approval-execution/approved-order.composition');

test('historical original receipt source has no lease or execution admission and retains exact bindings', async () => {
  const h = await approvedOrderHarness(), application = composeAiApprovedOrder(h.dependencies);
  const committed = await application.submit(h.command);
  const { PrismaApprovedOrderSource } = require('../apps/api/src/modules/ai-native/approval-execution/prisma-approved-order.source');
  const source = new PrismaApprovedOrderSource(h.dependencies), { lease, ...base } = h.command;
  const reference = { ...base, runId: lease.runId }, before = structuredClone(h.state.records), commits = h.state.commits;
  // The archived worker lease is not a desktop read grant. The new observation
  // query has no lease at all and still checks current policy/approval/snapshots.
  const original = await source.readCommitted(reference);
  assert.equal(original.committedId, committed.order.id); assert.equal('lease' in original.input, false);
  assert.equal(original.operation, 'replay'); assert.equal(h.state.commits, commits);
  assert.deepEqual(h.state.records, before);
  await assert.rejects(source.readCommitted({ ...reference, runId: 'another-run' }), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(source.readCommitted({ ...reference, reviewedPayloadHash: '0'.repeat(64) }), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(source.readCommitted({ ...reference, lease }), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.commits, commits); assert.deepEqual(h.state.records, before);
});

test('real quote fact port is never called before Guard-owned ALS exists', async () => {
  const h = await approvedOrderHarness();
  const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const find = h.dependencies.quoteFacts.findQuote.bind(h.dependencies.quoteFacts); let reads = 0;
  h.dependencies.quoteFacts.findQuote = async (...args) => {
    assert.equal(getRequestIdentity()?.workspaceId, 'workspace-a');
    assert.equal(getRequestIdentity()?.userId, 'operator-a'); reads++;
    return find(...args);
  };
  assert.equal((await composeAiApprovedOrder(h.dependencies).submit(h.command)).replayed, false);
  assert.ok(reads > 0);
});

for (const key of ['policy', 'snapshots', 'guard', 'credentials', 'confirmation', 'core', 'quoteFacts']) {
  test(`missing ${key} never becomes an executable default`, async () => {
    const h = await approvedOrderHarness(); delete h.dependencies[key];
    assert.throws(() => composeAiApprovedOrder(h.dependencies), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  });
}

test('standalone approved input observation has a finite authorization window and never replaces the Core transaction', { timeout: 30000 }, async () => {
  const h = await approvedOrderHarness(), transaction = h.dependencies.db.$transaction.bind(h.dependencies.db), options = [];
  let inputReads = 0;
  h.dependencies.executionInput = {
    read: async () => structuredClone(h.body),
    readAuthorized: async (reference, tx) => {
      assert.ok(tx); assert.equal(reference.taskId, h.command.taskId); assert.equal(reference.runId, h.command.lease.runId);
      assert.equal(reference.context.actor.userId, 'operator-a'); inputReads++;
      return { body: structuredClone(h.body), bindingHash: 'a'.repeat(64) };
    }
  };
  // A deterministic transport-cost fixture, not a wall-clock sleep or a
  // claim that the synthetic adapter proves native SQL latency.
  h.dependencies.db.$transaction = async (callback, option) => {
    options.push(option);
    if (option?.isolationLevel === 'RepeatableRead') {
      if (option.timeout < 6000) {
        throw Object.assign(Error('synthetic authorization reads exceeded their transaction window'), { code: 'P2028' });
      }
      // The original write harness serializes transactions. A separate
      // non-locking observation must not wait on that synthetic write mutex;
      // it sees committed fixture rows and may not publish any mutation.
      const rows = structuredClone(h.state.records), before = structuredClone(rows);
      const observed = await callback(h.client(rows, true));
      assert.deepEqual(rows, before, 'observation cannot merge writes or grant a transaction');
      return observed;
    }
    return transaction(callback, option);
  };
  const result = await composeAiApprovedOrder(h.dependencies).submit(h.command);
  assert.equal(result.replayed, false); assert.equal(h.state.prepares, 1); assert.ok(inputReads > 0);
  assert.ok(options.some(option => option?.isolationLevel === 'RepeatableRead' && option.maxWait === 2500 && option.timeout === 15000));
  assert.ok(options.some(option => option?.isolationLevel === 'ReadCommitted' && option.timeout === 30000));
  assert.equal(h.state.records.rentalOrder.length, 1); assert.equal(h.state.records.aiApprovalConsumption.length, 1);
});

test('uncertain Core submission signals reconcile, not access denial or rollback', async () => {
  const h = await approvedOrderHarness(), options = [], transaction = h.dependencies.db.$transaction.bind(h.dependencies.db);
  h.dependencies.db.$transaction = async (...args) => { options.push(args[1]); return transaction(...args); };
  const service = composeAiApprovedOrder(h.dependencies); h.state.ackLost = true;
  await assert.rejects(service.submit(h.command), e => e.code === 'AI_RESULT_UNKNOWN' && e.nextAction === 'reconcile');
  assert.ok(options.some(option => option?.isolationLevel === 'ReadCommitted' && option.timeout === 30000),
    'approved Core creation keeps a finite participant-aware transaction window');
  assert.ok(options.some(option => option?.isolationLevel === 'RepeatableRead' && option.timeout === 15000),
    'original consumption observation is finite and non-locking, never a new grant');
  assert.equal(h.state.records.rentalOrder.length, 1);
  h.state.ackLost = false;
  const result = await service.reconcile(h.command);
  assert.equal(result.replayed, true); assert.equal(h.state.prepares, 1);
});

test('reconcile without a committed consumption never invokes Core creation', async () => {
  const h = await approvedOrderHarness(); const service = composeAiApprovedOrder(h.dependencies);
  assert.equal(typeof service.reconcile, 'function');
  await assert.rejects(service.reconcile(h.command));
  assert.equal(h.state.prepares, 0); assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.trace.includes('policy.execute'), false);
});

test('risk exceptions with otherwise valid persisted hashes stay unavailable', async () => {
  const h = await approvedOrderHarness();
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { fingerprintAiProposalDraft } = require('../apps/api/src/modules/ai-native/proposal-binding-draft');
  h.state.snapshots.input.payload.capabilityExceptions = [];
  const hash = requestFingerprint(h.state.snapshots.input.payload);
  h.state.snapshots.input.contentHash = hash;
  const version = h.state.records.aiProposalVersion[0]; version.payload.actions[0].input.contentHash = hash;
  version.payloadHash = fingerprintAiProposalDraft(version.payload);
  h.state.records.aiApproval[0].payloadHash = version.payloadHash; h.command.reviewedPayloadHash = version.payloadHash;
  h.state.records.aiProposalAction[0].requestFingerprint = hash; h.state.records.aiStep[0].requestFingerprint = hash;
  await assert.rejects(composeAiApprovedOrder(h.dependencies).submit(h.command), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.state.prepares, 0);
});

for (const [name, mutate] of Object.entries({
  cancellation: records => { records.aiTask[0].cancelRequestedAt = new Date(); },
  takeover: records => { records.aiRun[0].leaseOwnerId = 'other-holder'; records.aiRun[0].fencingToken = '10'; },
  'proposal revision': records => { records.aiProposal[0].currentRevision = 2; },
  'approval expiry': records => { records.aiApproval[0].expiresAt = new Date('2000-01-01'); },
  'quote changed': records => { records.quote[0].payableAmount = 456; },
  'session revoked': (_records, state) => { state.session = false; },
  'AI entitlement revoked': (_records, state) => { state.entitled = false; }
})) test(`late ${name} after Core write prevents transaction commit`, async () => {
  const h = await approvedOrderHarness(); let injected = false;
  h.state.onOperation = ({ model, op, records, inTransaction }) => {
    if (!injected && inTransaction && model === 'rentalOrderIdempotencyRecord' && op === 'create') { injected = true; mutate(records, h.state); }
  };
  await assert.rejects(composeAiApprovedOrder(h.dependencies).submit(h.command));
  assert.equal(injected, true); assert.equal(h.state.commits, 0);
  assert.equal(h.state.records.rentalOrder.length, 0); assert.equal(h.state.records.aiApprovalConsumption.length, 0);
});

for (const mode of ['session', 'snapshot']) test(`enclosed committed replay rejects ${mode} changes during consumption read`, async () => {
  const h = await approvedOrderHarness(), service = composeAiApprovedOrder(h.dependencies);
  await service.submit(h.command);
  let changed = false;
  h.state.onOperation = ({ model, op, inTransaction }) => {
    if (!changed && inTransaction && model === 'aiApprovalConsumption' && op === 'findFirst') {
      changed = true;
      if (mode === 'session') h.state.session = false;
      else h.state.snapshots.input.recordId = 'different-snapshot-reference';
    }
  };
  await assert.rejects(service.reconcile(h.command), error => ['AI_ACCESS_DENIED', 'AI_RESULT_UNKNOWN'].includes(error.code));
  assert.equal(changed, true);
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  assert.equal(h.state.prepares, 1, 'a failed historical read never re-submits Core');
});

test('changed snapshot identity cannot borrow identical payload bytes', async () => {
  const h = await approvedOrderHarness(); h.state.snapshots.input.taskId = 'other-task';
  await assert.rejects(composeAiApprovedOrder(h.dependencies).submit(h.command)); assert.equal(h.state.prepares, 0);
});

test('query hit with different exact approval identity is rejected', async () => {
  const h = await approvedOrderHarness(); const find = h.dependencies.db.aiApproval.findFirst;
  h.dependencies.db.aiApproval.findFirst = async args => { const row = await find(args); return row && { ...row, id: row.id.toUpperCase() }; };
  await assert.rejects(composeAiApprovedOrder(h.dependencies).submit(h.command)); assert.equal(h.state.prepares, 0);
});

for (const dependency of ['policy', 'snapshots', 'business context', 'committed order read']) test(`internal ${dependency} errors never escape the composition boundary`, async () => {
  const h = await approvedOrderHarness();
  const secret = 'private SQL credential=synthetic-do-not-publish';
  const fail = () => { throw new Error(secret); };
  if (dependency === 'policy') h.dependencies.policy.resolve = fail;
  if (dependency === 'snapshots') h.dependencies.snapshots.read = fail;
  if (dependency === 'business context') h.dependencies.core.getProfile = fail;
  if (dependency === 'committed order read') h.dependencies.core.getOrder = fail;
  const service = composeAiApprovedOrder(h.dependencies);
  await assert.rejects(service.submit(h.command), error => {
    assert.equal(String(error.stack).includes(secret), false);
    assert.equal(error.message, error.code);
    assert.ok(['AI_RESOURCE_UNAVAILABLE', 'AI_RESULT_UNKNOWN'].includes(error.code));
    if (dependency === 'committed order read') {
      assert.equal(error.code, 'AI_RESULT_UNKNOWN'); assert.equal(error.nextAction, 'reconcile');
    }
    return true;
  });
  assert.equal(h.state.records.rentalOrder.length, dependency === 'committed order read' ? 1 : 0);
});
