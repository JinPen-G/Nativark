'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
require('ts-node').register({ transpileOnly: false, compilerOptions: { rootDir: path.resolve(__dirname, '..'), module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-original-request.cjs');
const { PrismaQuoteSelectionRepository } = require('../apps/api/src/modules/ai-native/task-request/prisma-quote-selection.repository');
const { composeHumanQuoteOrder } = require('../apps/api/src/modules/ai-native/scenes/human-quote-order.composition');
const { RentalOrderConfirmationService } = require('../apps/api/src/modules/rental-core/rental-order-confirmation.service');
const { AI_QUOTE_SELECTION_DRAFT_VERSION } = require('../packages/shared/src/ai-quote-selection-draft');
const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { AiGuardedQuoteCoreContextSource } = require('../apps/api/src/modules/ai-native/tools/quote-route.composition');

async function harness() {
  const h = await setup({ aiTaskQuoteSelection: [], aiApprovedOrderSnapshot: [], aiProposal: [],
    aiProposalVersion: [], aiProposalAction: [], aiApproval: [], aiApprovalConsumption: [], aiTaskResultArtifact: [] });
  const created = await h.app.create(h.command('quote_clarification', 'quote-original'));
  const candidate = await h.app.tools.quote.candidates.prepare(h.b.candidate);
  const preview = await h.app.tools.quote.previewSelection({ ...h.b.candidate, selectionRevision: candidate.selectionRevision });
  assert.equal(preview.status, 'quoted');
  const routes = new AiBusinessReadRouteAuthority(h.dependencies.guard, h.dependencies.credentials);
  const contexts = new AiGuardedQuoteCoreContextSource(h.b.core, routes);
  const quote = await routes.withRead('quote_context', {}, async current =>
    h.b.business.getQuote('tenant_001', await contexts.current(current.scope), preview.quote.id));
  const confirmation = Object.create(RentalOrderConfirmationService.prototype);
  const dependencies = { ...h.dependencies, originals: h.app.requests, confirmation,
    scene: { code: 'quote_clarification', version: '1' },
    quoteFacts: { findQuote: async (tenant, id) => tenant === quote.tenantId && id === quote.id ? structuredClone(quote) : null } };
  const selections = composeHumanQuoteOrder(dependencies);
  const { fulfillmentMode, fulfillmentLocationId, returnLocationId, startAt, endAt, lines } = quote.request;
  const order = { quoteId: quote.id, customerType: 'personal', customerId: 'customer-a', customerName: 'Synthetic customer',
    ...(quote.request.bookingIdentity ? { bookingIdentity: quote.request.bookingIdentity } : {}),
    fulfillmentMode, fulfillmentLocationId, ...(returnLocationId ? { returnLocationId } : {}), startAt, endAt,
    lines: lines.map(({ itemGroupId, pricingGroupId, quantity, note }) => ({ itemGroupId, quantity,
      ...(pricingGroupId ? { pricingGroupId } : {}), ...(note ? { note } : {}) })) };
  const command = { draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: created.receipt.inputRef,
    taskId: created.task.taskId, runId: created.task.runId, selectionKey: 'selection-a', expectedSelectionRevision: 0, order };
  const Ajv = require('ajv'), ajv = new Ajv({ strict: true }); require('ajv-formats')(ajv);
  const valid = ajv.compile(require('../packages/shared/src/ai-quote-selection-draft-schemas').AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiQuoteSelectionCreateDraft);
  assert.equal(valid(command), true, JSON.stringify(valid.errors));
  return { ...h, selections, command, quote, created, repository: new PrismaQuoteSelectionRepository(dependencies) };
}

test('current human selection is persisted and replayed, but never creates approval/order', { timeout: 30000 }, async () => {
  const h = await harness(), first = await h.selections.select(h.command);
  assert.equal(first.receipt.state, 'selected_not_approved');
  assert.equal(first.receipt.approval, 'not_granted');
  assert.equal((await h.selections.select(h.command)).replayed, true);
  assert.equal(h.state.aiTaskQuoteSelection.length, 1);
  const read = { draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: h.command.originalInputRef, selectionId: first.receipt.selectionId };
  assert.equal((await h.selections.read(read)).inputHash, first.receipt.inputHash);
  const proof = { ...read, taskId: h.command.taskId, runId: h.command.runId, inputHash: first.receipt.inputHash };
  assert.equal((await h.repository.readAuthorized(proof)).quoteId, h.quote.id);
  await assert.rejects(h.selections.publishSelectedInput({ selection: proof, input: h.command.order }), e => e.code === 'AI_INVALID_INPUT');
  await assert.rejects(h.selections.select({ ...h.command, order: { ...h.command.order, customerName: 'Another choice' } }));
  h.b.h.identity.session = false;
  await assert.rejects(h.selections.read(read));
});

test('selected order goes through human review and decision before Core commit and historical recovery', { timeout: 30000 }, async () => {
  const { selectedOrderHarness } = require('./fixtures/ai-native/lane-a-selected-order.cjs');
  const h = await selectedOrderHarness(), review = { selection: h.selection, proposal: h.proposal };
  assert.equal(h.state.records.aiApproval.length, 0); assert.equal(h.state.records.rentalOrder.length, 0);
  const displayed = await h.app.readSelectedProposal(review);
  assert.equal(displayed.deterministic.quoteAmounts.payableAmount, 123); assert.equal(displayed.generatedText, null);
  await assert.rejects(h.app.readSelectedProposal({ ...review, selection: { ...h.selection, inputHash: 'f'.repeat(64) } }), e => e.code === 'AI_ACCESS_DENIED');
  const decision = { ...review, proposal: { ...h.proposal, decision: 'approve' } };
  await assert.rejects(h.app.decideSelectedProposal({ ...decision, actorId: 'forged' }), e => e.code === 'AI_INVALID_INPUT');
  assert.deepEqual(await h.app.readSelectedDecisionReceipt(decision), { kind: 'absent', retryable: false });
  h.state.decisionAckLost = true;
  await assert.rejects(h.app.decideSelectedProposal(decision), e => e.code === 'AI_RESULT_UNKNOWN');
  h.state.decisionAckLost = false;
  const approved = await h.compose().readSelectedDecisionReceipt(decision);
  assert.equal(approved.kind, 'recorded'); assert.equal(approved.record.decision, 'approved');
  assert.equal(h.state.records.aiApproval.length, 1); assert.equal(h.state.records.rentalOrder.length, 0);
  const { expiresAt, ...base } = h.prepareCommand;
  const command = { ...base, approvalId: approved.record.approvalId, reviewedPayloadHash: h.proposal.reviewedPayloadHash };
  h.state.ackLost = true;
  await assert.rejects(h.app.submitSelectedOrder({ selection: h.selection, command }), e => e.code === 'AI_RESULT_UNKNOWN');
  h.state.ackLost = false;
  assert.equal(h.state.records.rentalOrder.length, 1, JSON.stringify(h.state.failures)); assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  h.state.clock = new Date(Date.now() + 7200000); h.state.records.aiTaskPlanPolicy[0].enabled = false;
  const result = await h.compose().reconcileSelectedOrder({ selection: h.selection, command });
  assert.equal(result.replayed, true); assert.equal(result.order.id, h.state.records.aiApprovalConsumption[0].resultRef);
  assert.equal(h.state.commits, 1); assert.equal(h.state.records.rentalOrder.length, 1);
  h.state.session = false;
  await assert.rejects(h.app.readSelectedDecisionReceipt(decision), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
});

test('selected order rejects a human rejection as execution approval', { timeout: 30000 }, async () => {
  const { selectedOrderHarness } = require('./fixtures/ai-native/lane-a-selected-order.cjs');
  const h = await selectedOrderHarness();
  const rejected = await h.app.decideSelectedProposal({ selection: h.selection, proposal: { ...h.proposal, decision: 'reject' } });
  assert.equal(rejected.approval.decision, 'rejected'); assert.equal(rejected.order, 'not_created_by_decision');
  const { expiresAt, ...base } = h.prepareCommand;
  await assert.rejects(h.app.submitSelectedOrder({ selection: h.selection, command: { ...base,
    approvalId: rejected.approval.approvalId, reviewedPayloadHash: h.proposal.reviewedPayloadHash } }));
  assert.equal(h.state.records.rentalOrder.length, 0); assert.equal(h.state.records.aiApprovalConsumption.length, 0);
});

test('lost selection acknowledgement reconciles exact key and mutated quote cannot prove old input', { timeout: 30000 }, async () => {
  const h = await harness();
  h.control.beforeCommit = async draft => { if (draft.aiTaskQuoteSelection.length && !h.state.aiTaskQuoteSelection.length) h.control.loseReply = true; };
  await assert.rejects(h.selections.select(h.command), e => e.code === 'AI_RESULT_UNKNOWN');
  assert.equal((await h.selections.reconcile(h.command)).state, 'observed');
  h.quote.ruleVersion = 'changed';
  await assert.rejects(h.selections.reconcile(h.command), e => e.code === 'AI_REVISION_CONFLICT');
  assert.equal(h.state.aiTaskQuoteSelection.length, 1);
});
