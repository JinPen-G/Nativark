'use strict';
const assert = require('node:assert/strict');
const { persistedApprovedOrderHarness } = require('./approved-order-persisted.cjs');
const { PrismaAiApprovalRepository } = require('../../../apps/api/src/modules/ai-native/ai-approval-repository');
async function businessApprovedHarness() {
  const h = await persistedApprovedOrderHarness(), { state, dependencies: d } = h;
  for (const name of ['aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval']) state.records[name] = [];
  state.records.aiApprovedOrderSnapshot = [];
  state.records.aiStep[0].revision = 1;
  Object.assign(state.records.quote[0], { chargeLines: [], rateSnapshot: [], calendarSnapshot: [], calendarWarnings: [],
    appliedDiscountPlanIds: [], discountEvaluations: [], serviceSnapshots: [], rentalAmount: 123, discountAmount: 0,
    couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0, receivableAmount: 123 });
  Object.assign(d.db, h.client(null, false));
  // Pre-existing immutable input is the external dependency under simulation.
  // This is NOT evidence that the missing first-request producer is complete.
  const deps = { ...d, ...h.policyDependencies, inputSource: { read: async ({ context, scopeId, taskId, actionId, runId }) => {
    assert.equal(context.actor.userId, 'operator-a'); assert.equal(scopeId, 'scope-a'); assert.equal(taskId, 'task-a');
    assert.equal(actionId, 'action-a'); assert.equal(runId, 'run-a'); return structuredClone(h.body);
  } } };
  const prepareCommand = { taskId: 'task-a', proposalId: 'proposal-a', proposalRevision: 1, actionId: 'action-a',
    expiresAt: h.payload.expiresAt, lease: h.command.lease };
  const approve = async pending => {
    const payload = state.records.aiProposalVersion[0].payload;
    const approval = await new PrismaAiApprovalRepository(d.db).decide({ scopeId: 'scope-a', taskId: 'task-a', proposalId: 'proposal-a',
      proposalRevision: 1, payload, reviewedPayloadHash: pending.reviewedPayloadHash, decision: 'approved' },
      { actorKind: 'user', actorId: 'operator-a', audience: 'operator', scopeId: 'scope-a' });
    return { ...h.command, reviewedPayloadHash: pending.reviewedPayloadHash, approvalId: approval.approvalId };
  };
  return { ...h, deps, prepareCommand, approve };
}
module.exports = { businessApprovedHarness };
