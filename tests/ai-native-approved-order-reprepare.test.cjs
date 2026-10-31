'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { reprepareHarness } = require('./fixtures/ai-native/approved-order-reprepare.cjs');
const { composeRequestBoundApprovedOrderApplication } = require('../apps/api/src/modules/ai-native/approval-execution/request-bound-approved-order.application.ts');

async function requestApi(h) {
  const { credentials, ...dependencies } = h.dependencies;
  return { api: composeRequestBoundApprovedOrderApplication(dependencies, { enabled: true, audience: 'operator' }),
    request: { headers: { authorization: (await credentials.current()).authorization } } };
}

test('real human rejection -> new formal input/plan -> atomic prepare -> new human approval -> Core receipt (external ports doubled)', async () => {
  const h = await reprepareHarness();
  await h.root.approvals.decide('task-a', { ...h.review, decision: 'reject' });
  h.state.records.aiTask.find(row => row.id === 'task-a').status = 'FAILED';
  h.command.reason = 'rejected';
  const { api, request } = await requestApi(h);
  const result = await api.reprepare(request, 'task-a', h.command);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.state, 'prepared');
  assert.equal(h.state.records.aiProposal.find(row => row.id === h.review.proposalId).status, 'SUPERSEDED');
  assert.equal(h.state.records.aiApprovalReprepare.length, 1);
  assert.equal(h.state.records.aiApproval.length, 1);
  assert.equal(h.state.records.rentalOrder.length, 0);
  const recorded = await api.readReprepareReceipt(request, 'task-a', h.command);
  assert.deepEqual(recorded, result);
  const approved = await api.decide(request, 'task-b', { ...result.value.proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' });
  assert.equal(approved.ok, true);
  assert.equal(h.state.records.rentalOrder.length, 0);
  h.prepareCore();
  const executed = await h.compose().waiting.execute(h.executorInput(), new AbortController().signal);
  assert.equal(executed.kind, 'succeeded');
  assert.equal((await h.compose().waiting.reconcile(h.executorInput())).payload.businessResultRef, executed.payload.businessResultRef);
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption[0].taskId, 'task-b');
  assert.equal(h.state.records.aiApproval.length, 2);
});

test('expired original requires distinct valid replacement and a fresh pending proposal', async () => {
  const h = await reprepareHarness({ decisionExpiresAt: new Date(Date.now() + 30000).toISOString() });
  h.state.clock = new Date(Date.now() + 60000);
  h.command.reason = 'expired';
  const result = await h.compose().application.reprepare('task-a', h.command);
  assert.equal(result.state, 'prepared');
  assert.equal(h.state.records.aiProposal.find(row => row.id === result.proposal.proposalId).status, 'PENDING_CONFIRMATION');
  assert.equal(h.state.records.aiApproval.length, 0);
});

test('same operation is idempotent across concurrency, and another operation cannot reuse the original', async () => {
  const h = await reprepareHarness(), app = h.compose().application;
  const [one, two] = await Promise.all([app.reprepare('task-a', h.command), app.reprepare('task-a', h.command)]);
  assert.deepEqual(one, two);
  assert.equal(h.state.records.aiProposal.length, 2);
  assert.equal(h.state.records.aiApprovalReprepare.length, 1);
  await assert.rejects(app.reprepare('task-a', { ...h.command, reason: 'expired' }), e => e.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(app.reprepare('task-a', { ...h.command, operationKey: 'another-operation' }), e => e.code === 'AI_REVISION_CONFLICT');
  assert.equal(h.state.records.rentalOrder.length, 0);
});

test('lost prepare ACK retains the original operation and reads the one committed preparation', async () => {
  const h = await reprepareHarness(), { api, request } = await requestApi(h);
  h.state.reprepareAckLost = true;
  const lost = await api.reprepare(request, 'task-a', h.command);
  assert.deepEqual(lost, { ok: false, error: { code: 'result_unknown', retryable: false, nextAction: 'read_reprepare_receipt' } });
  const recovered = await api.readReprepareReceipt(request, 'task-a', h.command);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.value.state, 'prepared');
  assert.deepEqual(await api.reprepare(request, 'task-a', h.command), recovered);
  assert.equal(h.state.records.aiApprovalReprepare.length, 1);
  assert.equal(h.state.records.aiProposal.length, 2);
  assert.equal(h.state.records.rentalOrder.length, 0);
});

test('ledger failure and commit-point revocation roll back new proposal and old supersede together', async () => {
  for (const failure of ['prepare', 'insert', 'revoke']) {
    const h = await reprepareHarness();
    let reached = false;
    h.state.onOperation = async ({ model, op }) => {
      if (failure === 'prepare' && model === 'aiApprovedOrderSnapshot' && op === 'create') {
        reached = true;
        throw Error('synthetic preparation storage failure');
      }
      if (model === 'aiApprovalReprepare' && op === 'insert') {
        reached = true;
        if (failure === 'insert') throw Error('synthetic receipt write failure');
        h.state.user.permissions = h.state.user.permissions.filter(value => value !== 'rental-os:order:create');
      }
    };
    await assert.rejects(h.compose().application.reprepare('task-a', h.command), error => failure === 'revoke'
      ? error.code === 'AI_ACCESS_DENIED' : error.code === 'AI_RESULT_UNKNOWN' && error.nextAction === 'read_reprepare_receipt');
    assert.equal(reached, true);
    assert.equal(h.state.records.aiApprovalReprepare.length, 0);
    assert.equal(h.state.records.aiProposal.length, 1);
    assert.equal(h.state.records.aiProposal[0].status, 'PENDING_CONFIRMATION');
    const unresolved = await h.compose().application.readReprepareReceipt('task-a', h.command);
    assert.equal(unresolved.state, 'unknown');
    assert.equal(unresolved.retryable, false);
  }
});

test('missing services, wrong proof, stale lease or old plan cannot write a replacement', async () => {
  for (const failure of ['source', 'lease', 'proof', 'plan', 'scope', 'policy']) {
    const h = await reprepareHarness();
    if (failure === 'source') delete h.dependencies.reprepareServices;
    if (failure === 'lease') h.state.leaseUnavailable = true;
    if (failure === 'proof') h.state.proofOverrides = { originalInputHash: 'e'.repeat(64) };
    if (failure === 'plan') h.command.replacement.planHash = h.state.records.aiTaskRunPlan.find(row => row.taskId === 'task-a').planHash;
    if (failure === 'scope') h.state.records.aiTask.find(row => row.id === 'task-b').ownerId = 'other-user';
    if (failure === 'policy') h.state.records.aiTaskActionPolicy = h.state.records.aiTaskActionPolicy.filter(row => row.operation !== 'reprepare_approval');
    await assert.rejects(h.compose().application.reprepare('task-a', h.command));
    assert.equal(h.state.records.aiApprovalReprepare.length, 0);
    assert.equal(h.state.records.aiProposal.length, 1);
    assert.equal(h.state.records.aiApproval.length, 0);
    assert.equal(h.state.records.rentalOrder.length, 0);
  }
});

test('unknown and COMMITTED original effects are never erased by a change of plan', async () => {
  for (const effect of ['unknown', 'committed']) {
    const h = await reprepareHarness();
    if (effect === 'unknown') h.state.records.aiStep.find(row => row.taskId === 'task-a').effect = 'POSSIBLE';
    else {
      await h.root.submit(await h.approve());
      h.state.records.aiStep.find(row => row.taskId === 'task-a').resultRef = 'runner-result-artifact';
      assert.equal((await h.root.application.readReprepareEligibility('task-a', {
        draftVersion: h.command.draftVersion, original: h.review, intent: 'inspect'
      })).state, 'committed');
    }
    const consumption = structuredClone(h.state.records.aiApprovalConsumption);
    await assert.rejects(h.compose().application.reprepare('task-a', h.command), e => e.code === 'AI_RESULT_UNKNOWN');
    assert.deepEqual(h.state.records.aiApprovalConsumption, consumption);
    assert.equal(h.state.records.aiApprovalReprepare.length, 0);
    assert.equal(h.state.records.aiProposal.length, 1);
    assert.equal(h.state.records.rentalOrder.length, effect === 'committed' ? 1 : 0);
  }
});

test('append-only migration contains only the new table, three unique keys and five restricted relations', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../apps/api/prisma/migrations/20261007213000_ai_approval_reprepare/migration.sql'), 'utf8');
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 1);
  assert.equal((sql.match(/UNIQUE INDEX/g) ?? []).length, 3);
  assert.equal((sql.match(/FOREIGN KEY/g) ?? []).length, 5);
  assert.equal((sql.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g) ?? []).length, 5);
  assert.equal(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE `)/.test(sql), false);
  assert.ok(sql.includes('`operationKey` VARCHAR(191) COLLATE utf8mb4_bin'));
});
