'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { controlledApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-controlled.cjs');
const { approvedOrderReviewMaterial } = require('../apps/api/src/modules/ai-native/approval-execution/approved-order-review-material');
const { approvalApplicationContract } = require('../apps/api/src/modules/ai-native/approval-execution/approval-application-contracts');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');

test('opt-in application exposes typed original review facts and completes explicit decision through the original action', async () => {
  const h = await controlledApprovedOrderHarness({ prepare: false }), input = h.executorInput();
  const waiting = await h.root.waiting.execute(input, new AbortController().signal);
  const api = h.root.approvals, reference = waiting.payload.proposal;
  const review = await api.readProposal(input.taskId, reference);
  assert.equal(review.deterministic.target.resourceType, 'quote');
  assert.equal(review.deterministic.target.resourceId, 'quote-a');
  assert.equal(review.deterministic.currency, 'CNY');
  assert.equal(review.deterministic.quoteAmounts.payableAmount, 123);
  assert.equal(review.deterministic.quoteAmounts.receivableAmount, 123);
  assert.equal(review.deterministic.quoteAmounts.depositAmount, 0);
  assert.equal(review.deterministic.decisionExpiresAt, review.proposal.payload.expiresAt);
  assert.equal(review.deterministic.quoteExpiresAt, review.facts.preview.payload.expiresAt);
  assert.equal(review.generatedText, null);
  assert.deepEqual(review.deterministic.order.customer, { id: 'customer-a', type: 'personal', name: 'Synthetic customer' });
  assert.deepEqual(review.deterministic.order.period, { startAt: h.body.startAt, endAt: h.body.endAt });
  assert.equal(review.deterministic.order.lines[0].itemGroupId, 'item-a');
  assert.equal(review.deterministic.order.lines[0].quantity, 1);
  assert.equal(review.deterministic.order.fulfillment.pickupLocationId, 'location-a');
  assert.equal(review.deterministic.order.fulfillment.returnLocationId, 'location-a');
  await assert.rejects(api.decide(input.taskId, { ...reference, decision: 'approve' }), error => error.code === 'AI_INVALID_INPUT');
  assert.equal(h.state.records.aiApproval.length, 0);
  const command = { ...reference, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' };
  const approval = await api.decide(input.taskId, command);
  assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal((await h.compose().approvals.readReceipt(input.taskId, command)).record.approvalId, approval.approvalId);
  const committed = await h.root.waiting.execute(input, new AbortController().signal);
  assert.equal(committed.kind, 'succeeded');
  assert.equal((await h.compose().waiting.reconcile(input)).payload.businessResultRef, committed.payload.businessResultRef);
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApproval.length, 1);
});

test('review amount and expiry projection never substitutes the latest quote or requires new execution eligibility', async () => {
  const h = await controlledApprovedOrderHarness(), original = await h.root.approvals.readProposal('task-a', h.review);
  h.state.records.quote[0].payableAmount = 9999;
  h.state.records.quote[0].currency = 'USD';
  h.state.records.quote[0].expiresAt = '2098-01-01T00:00:00.000Z';
  h.state.records.aiBudgetPolicy = [];
  h.state.records.aiTaskPlanPolicy[0].enabled = false;
  h.state.user.permissions = h.state.user.permissions.filter(p => p !== 'rental-os:order:create');
  const current = await h.root.approvals.readProposal('task-a', h.review);
  h.state.records.quote[0].request.customerId = 'changed-current-customer';
  h.state.records.quote[0].request.lines[0].quantity = 9;
  const again = await h.root.approvals.readProposal('task-a', h.review);
  assert.deepEqual(again.deterministic.order, original.deterministic.order);
  assert.deepEqual(current.deterministic, original.deterministic);
  assert.equal(current.deterministic.quoteAmounts.payableAmount, 123);
  assert.equal(current.deterministic.currency, 'CNY');
  assert.equal(current.generatedText, null);
  await assert.rejects(h.root.approvals.decide('task-a', { ...h.review, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' }),
    e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
});

test('shared decision input does not accept generated text or caller-supplied review amounts', async () => {
  const h = await controlledApprovedOrderHarness();
  for (const extra of [{ generatedText: 'approved' }, { quoteAmounts: { payableAmount: 1 } }, { context: h.context }]) {
    await assert.rejects(h.root.approvals.decide('task-a', { ...h.review, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2', ...extra }), e => e.code === 'AI_INVALID_INPUT');
  }
  assert.equal(h.state.records.aiApproval.length, 0);
  assert.equal(h.state.records.rentalOrder.length, 0);
});

test('material projection distinguishes original objects and never returns private qualification or address fields', async () => {
  const h = await controlledApprovedOrderHarness();
  const quote = structuredClone(h.state.records.quote[0]);
  quote.rateSnapshot = [{ itemGroupId: 'item-a', itemGroupName: 'Frozen rental name' }];
  quote.request.deliveryAddressId = 'address-a';
  quote.deliveryAddressSnapshot = { recipient: 'Recipient', countryCode: 'CN', province: 'Province', city: 'City', detail: 'Original street',
    phone: 'private-phone', phoneMasked: 'masked', latitude: 1, longitude: 2 };
  quote.serviceSnapshots = [{ serviceId: 'service-a', serviceName: 'Original delivery service', quantity: 2,
    scheduledStartAt: h.body.startAt, scheduledEndAt: h.body.endAt, serviceLocationId: 'service-location-a', requiredByRule: true }];
  quote.serviceAmount = 10;
  quote.membershipSnapshot = { personalCustomerId: 'customer-a', personalCustomerName: 'Frozen customer name', bookingIdentity: 'personal',
    enterpriseContractAndPayer: false, qualifications: [{ sensitive: 'private-certificate' }] };
  const material = approvedOrderReviewMaterial(h.body, quote);
  assert.equal(material.customer.name, 'Frozen customer name'); assert.equal(material.lines[0].name, 'Frozen rental name');
  assert.equal(material.fulfillment.deliveryAddress.detail, 'Original street'); assert.equal(material.services[0].locationId, 'service-location-a');
  for (const text of ['private-phone', 'private-certificate', 'phoneMasked', 'latitude', 'qualifications']) assert.equal(JSON.stringify(material).includes(text), false);
  const different = structuredClone(quote), body = structuredClone(h.body);
  different.request.lines[0].quantity = body.lines[0].quantity = 2;
  different.request.endAt = body.endAt = '2026-10-09T10:00:00Z';
  different.request.returnLocationId = body.returnLocationId = 'different-return';
  different.request.customerId = body.customerId = 'customer-b'; delete different.membershipSnapshot;
  const changed = approvedOrderReviewMaterial(body, different);
  assert.notDeepEqual(changed, material); assert.equal(changed.customer.id, 'customer-b');
  assert.equal(changed.lines[0].quantity, 2); assert.equal(changed.period.endAt, body.endAt);
  assert.equal(changed.fulfillment.returnLocationId, 'different-return');
});

test('missing immutable fulfillment evidence blocks new approval, not original recorded receipt reads', async () => {
  const h = await controlledApprovedOrderHarness();
  const preview = h.state.records.aiApprovedOrderSnapshot.find(row => row.kind === 'PREVIEW');
  preview.payload.serviceAmount = 10; preview.payload.serviceSnapshots = [];
  preview.contentHash = requestFingerprint(preview.payload);
  const version = h.state.records.aiProposalVersion[0];
  version.payload.actions[0].preview.contentHash = preview.contentHash;
  version.payloadHash = requestFingerprint(version.payload);
  const reference = { ...h.review, reviewedPayloadHash: version.payloadHash };
  await assert.rejects(h.root.application.readProposal('task-a', reference), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(h.root.approvals.decide('task-a', { ...reference, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' }),
    error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.state.records.aiApproval.length, 0); assert.equal(h.state.records.rentalOrder.length, 0);
  const recorded = await h.root.approvals.decide('task-a', { ...reference, decision: 'reject' });
  assert.equal((await h.root.approvals.readReceipt('task-a', { ...reference, decision: 'reject' })).record.approvalId, recorded.approvalId);
  const missingAddress = structuredClone(h.state.records.quote[0]); missingAddress.request.deliveryAddressId = 'address-a';
  assert.throws(() => approvedOrderReviewMaterial(h.body, missingAddress), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  const deliveryBody = { ...h.body, fulfillmentMode: 'delivery' }, deliveryQuote = structuredClone(h.state.records.quote[0]);
  deliveryQuote.request.fulfillmentMode = 'delivery';
  assert.throws(() => approvedOrderReviewMaterial(deliveryBody, deliveryQuote), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  deliveryQuote.categoryCode = 'vehicle';
  assert.equal(approvedOrderReviewMaterial(deliveryBody, deliveryQuote).fulfillment.pickupLocationId, 'location-a');
  // A pre-v2 approval may already exist for a snapshot lacking service details.
  // Seed it through the original decision repository, not the new human host.
  const legacy = await controlledApprovedOrderHarness({ prepare: false });
  legacy.state.records.quote[0].serviceAmount = 10;
  const wait = await legacy.root.waiting.execute(legacy.executorInput(), new AbortController().signal);
  const original = wait.payload.proposal, payload = legacy.state.records.aiProposalVersion[0].payload;
  const { PrismaAiApprovalRepository } = require('../apps/api/src/modules/ai-native/ai-approval-repository');
  const historic = await new PrismaAiApprovalRepository(legacy.dependencies.db, legacy.dependencies.clock).decide({ scopeId: 'scope-a',
    taskId: 'task-a', proposalId: original.proposalId, proposalRevision: original.proposalRevision,
    reviewedPayloadHash: original.reviewedPayloadHash, payload, decision: 'approved' },
    { scopeId: 'scope-a', actorKind: 'user', actorId: 'operator-a', audience: 'operator' });
  assert.equal((await legacy.root.approvals.readReceipt('task-a', { ...original, decision: 'approve' })).record.approvalId, historic.approvalId);
  assert.equal((await legacy.root.waiting.readWaiting(legacy.executorInput())).receipt.record.approvalId, historic.approvalId);
  await assert.rejects(legacy.root.application.readProposal('task-a', original), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
});

test('old review contract remains distinct and cannot pass the new executable host contract', async () => {
  const h = await controlledApprovedOrderHarness(), review = await h.root.application.readProposal('task-a', h.review);
  const { order, ...deterministic } = review.deterministic;
  const old = { ...review, draftVersion: 'ain-approval-application-draft-1', deterministic };
  assert.doesNotThrow(() => approvalApplicationContract('AiApprovalApplicationReviewDraftV1', old));
  assert.throws(() => approvalApplicationContract('AiApprovalApplicationReviewDraft', old), error => error.code === 'AI_INVALID_INPUT');
  assert.throws(() => approvalApplicationContract('AiApprovalApplicationReviewDraft', { ...review, deterministic: { ...deterministic, order: { ...order, privateNote: 'bad' } } }), error => error.code === 'AI_INVALID_INPUT');
});
