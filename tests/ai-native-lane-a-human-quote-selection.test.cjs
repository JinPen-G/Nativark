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

async function harness(prepareProposal = false) {
  const h = await setup({ aiTaskQuoteSelection: [], aiApprovedOrderSnapshot: [], aiProposal: [],
    aiProposalVersion: [], aiProposalAction: [], aiApproval: [], aiApprovalConsumption: [], aiTaskResultArtifact: [], aiTaskEvent: [] });
  if (prepareProposal) {
    h.b.h.control.now = Date.now();
    const policy = h.state.aiTaskPlanPolicy.find(row => row.sceneCode === 'quote_clarification');
    policy.allowedTools = [{ code: 'rental.order.commit', version: require('./fixtures/ai-native/local-shared.cjs').AI_TOOL_DRAFT_VERSION }];
    policy.limits = { maxSteps: 4, maxCalls: 4, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 4096, maxConcurrent: 1 };
    const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
    for (const [id, scope] of [['scope-platform', { kind: 'platform' }], ['scope-tenant', { kind: 'tenant', tenantId: 'tenant_001' }]]) h.state.aiScope.push({ id, ...aiPersistenceScopeColumns(scope) });
    h.state.aiBudgetPolicy = h.b.h.state.aiBudgetPolicy.map(row => JSON.parse(JSON.stringify(row)
      .replaceAll('tenant-a', 'tenant_001').replaceAll('synthetic-clarification', 'quote_clarification')));
  }
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
  return { ...h, selections, command, quote, created, orderDependencies: dependencies, repository: new PrismaQuoteSelectionRepository(dependencies) };
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
  const selectedOrder = h.selections.selectedOrderSource(proof);
  assert.deepEqual(await selectedOrder.read(), h.command.order);
  assert.equal(selectedOrder.taskId, proof.taskId); assert.equal(selectedOrder.runId, proof.runId);
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
  assert.equal(displayed.draftVersion, 'ain-approval-application-draft-1'); assert.equal(displayed.facts, undefined);
  const shared = require('./fixtures/ai-native/local-shared.cjs');
  assert.equal(shared.AI_QUOTE_SELECTION_DRAFT_VERSION, AI_QUOTE_SELECTION_DRAFT_VERSION);
  const components = require('../apps/api/src/contracts/ai-leaf-components').AI_LEAF_COMPONENT_SCHEMAS;
  assert.deepEqual(components.AiApprovalApplicationReviewDraft.properties.generatedText, { type: 'string', nullable: true, enum: [null] });
  const eligibility = { selection: h.selection, request: { draftVersion: displayed.draftVersion, original: h.proposal, intent: 'inspect' } };
  assert.equal((await h.app.readSelectedReprepareEligibility(eligibility)).state, 'pending');
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
  await assert.rejects(h.app.readSelectedOrderResult({ selection: h.selection, command }));
  assert.equal(h.state.records.rentalOrder.length, 0);
  h.state.ackLost = true;
  await assert.rejects(h.app.submitSelectedOrder({ selection: h.selection, command }), e => e.code === 'AI_RESULT_UNKNOWN');
  h.state.ackLost = false;
  assert.equal(h.state.records.rentalOrder.length, 1, JSON.stringify(h.state.failures)); assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  h.state.clock = new Date(Date.now() + 7200000); h.state.records.aiTaskPlanPolicy[0].enabled = false;
  const result = await h.compose().reconcileSelectedOrder({ selection: h.selection, command });
  assert.equal(result.replayed, true); assert.equal(result.order.id, h.state.records.aiApprovalConsumption[0].resultRef);
  assert.equal(h.state.commits, 1); assert.equal(h.state.records.rentalOrder.length, 1);
  Object.assign(h.sceneDependencies.core, {
    getProfile: () => ({ tenantId: 'tenant-a', categoryCode: 'camera' }),
    getWorkspaceCategory: async () => ({ code: 'camera', businessModel: { pricingUnits: ['day'], fulfillmentModes: ['store_pickup_return'] } }),
    getBusinessSettings: () => ({ tenantId: 'tenant-a', calendar: { timeZone: 'UTC' }, pricing: { enabledUnits: ['day'] },
      fulfillment: { enabledModes: ['store_pickup_return'] }, configVersion: 1 })
  });
  const { credentials, originals, ...dependencies } = h.sceneDependencies;
  const requests = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application').composeRequestBoundHumanQuoteOrder(
    dependencies, { enabled: true, audience: 'operator' }, { holderId: 'worker-a',
      creationRules: [{ sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1, audiences: ['operator'],
        requiredPermissions: ['rental-os:order:create'], maxInputAgeMs: 3600000 }], memberships: { listPersonalOptions: async () => [] } });
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  assert.equal(requests.submitSelectedOrder, undefined);
  const humanController = new (require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller').AiHumanQuoteOrderController)(requests);
  const execution = { selection: h.selection, command }, outcome = await humanController.readSelectedOrderResult(request, execution);
  assert.equal(outcome.status, 'committed'); assert.equal(outcome.order.id, result.order.id);
  assert.equal(outcome.payment, 'not_inferred'); assert.equal(outcome.taskOutcome, 'owned_by_runner');
  assert.deepEqual(Object.keys(outcome.order).sort(), ['id', 'quoteId', 'status']);
  assert.equal(h.state.commits, 1);
  const { composeAiTaskCenterScene } = require('../apps/api/src/modules/ai-native/task-center-scene.composition');
  const centerDependencies = { list: { readPage: async () => { throw Error('not used'); } },
    scenes: { requests: h.originals, readTaskReceipt: h.originals.readTaskReceipt.bind(h.originals),
      readRecovery: async () => { throw Error('not used'); } } };
  const center = composeAiTaskCenterScene({ ...centerDependencies, orders: h.app });
  const centerRead = { original: { draftVersion: 'ain-scene-request-draft-1', inputRef: h.selection.originalInputRef }, reference: execution };
  assert.equal((await center.readOrderResult(centerRead)).result.order.id, outcome.order.id);
  await assert.rejects(composeAiTaskCenterScene(centerDependencies).readOrderResult(centerRead), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(center.readOrderResult({ ...centerRead, reference: { ...execution, selection: { ...h.selection,
    taskId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } } }), e => e.code === 'AI_ACCESS_DENIED');
  h.state.resourceAccess = false;
  const uncertain = await humanController.readSelectedOrderResult(request, execution);
  assert.equal(uncertain.status, 'unknown'); assert.equal(uncertain.retryable, false); assert.equal(uncertain.order, undefined);
  h.state.resourceAccess = true;
  await assert.rejects(requests.readSelectedOrderResult(request, { ...execution, selection: { ...h.selection, taskId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } }));
  await assert.rejects(requests.readSelectedOrderResult({ headers: {} }, execution), e => e.code === 'AI_ACCESS_DENIED');
  const closed = await h.app.readSelectedReprepareEligibility(eligibility);
  assert.equal(closed.state, 'committed'); assert.equal(closed.canRequestReprepare, false);
  h.state.session = false;
  await assert.rejects(requests.readSelectedOrderResult(request, execution), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  await assert.rejects(h.app.readSelectedDecisionReceipt(decision), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
});

test('selected order rejects a human rejection as execution approval', { timeout: 30000 }, async () => {
  const { selectedOrderHarness } = require('./fixtures/ai-native/lane-a-selected-order.cjs');
  const h = await selectedOrderHarness();
  const rejected = await h.app.decideSelectedProposal({ selection: h.selection, proposal: { ...h.proposal, decision: 'reject' } });
  assert.equal(rejected.approval.decision, 'rejected'); assert.equal(rejected.order, 'not_created_by_decision');
  const eligibility = await h.app.readSelectedReprepareEligibility({ selection: h.selection,
    request: { draftVersion: 'ain-approval-application-draft-1', original: h.proposal, intent: 'change_plan' } });
  assert.equal(eligibility.state, 'rejected'); assert.equal(eligibility.canRequestReprepare, true);
  assert.equal(eligibility.nextAction, 'provide_new_materials');
  const { expiresAt, ...base } = h.prepareCommand;
  await assert.rejects(h.app.submitSelectedOrder({ selection: h.selection, command: { ...base,
    approvalId: rejected.approval.approvalId, reviewedPayloadHash: h.proposal.reviewedPayloadHash } }));
  assert.equal(h.state.records.rentalOrder.length, 0); assert.equal(h.state.records.aiApprovalConsumption.length, 0);
});

test('request-bound quote selection and human decision share only the current request identity', { timeout: 30000 }, async () => {
  const h = await harness(true), { credentials, originals, ...dependencies } = h.orderDependencies;
  const { AiHumanQuoteSelectionModule, AI_HUMAN_QUOTE_ORDER_REQUESTS } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.module');
  const { AiHumanQuoteSelectionController, AI_HUMAN_QUOTE_SELECTION_REQUESTS } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
  const { AI_TOOL_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  const options = { enabled: true, audience: 'operator' }, request = { headers: { authorization: (await credentials.current()).authorization } };
  const module = AiHumanQuoteSelectionModule.registerHttp(dependencies, options);
  assert.deepEqual(module.exports, [AI_HUMAN_QUOTE_SELECTION_REQUESTS]);
  const controller = new AiHumanQuoteSelectionController(module.providers[0].useFactory());
  assert.throws(() => AiHumanQuoteSelectionModule.registerHttp(h.orderDependencies, options).providers[0].useFactory(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(controller.select({ headers: {} }, h.command), e => e.getStatus() === 403);
  const first = await controller.select(request, h.command);
  assert.equal(first.receipt.approval, 'not_granted'); assert.equal(h.state.aiApproval.length, 0);
  const selection = { draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: h.command.originalInputRef,
    taskId: h.command.taskId, runId: h.command.runId, selectionId: first.receipt.selectionId, inputHash: first.receipt.inputHash };
  assert.equal((await controller.read(request, { draftVersion: selection.draftVersion, originalInputRef: selection.originalInputRef,
    selectionId: selection.selectionId })).selectionId, selection.selectionId);
  for (const operation of ['read_metadata', 'transition_task', 'decide_approval']) h.state.aiTaskActionPolicy.push({ scopeId: 'scope-a', taskId: selection.taskId,
    operation, revision: 1, requiredPermissions: [operation === 'read_metadata' ? 'rental-os:order:view' : 'rental-os:order:create'], expiresAt: new Date('2027-01-01') });
  // Runner lease and step start are explicit preconditions, not HTTP operations.
  Object.assign(h.state.aiTask[0], { status: 'RUNNING', cancelRequestedAt: null });
  Object.assign(h.state.aiRun[0], { status: 'RUNNING', leaseOwnerId: 'worker-a', fencingToken: new (require('../apps/api/node_modules/@prisma/client').Prisma.Decimal)('1'),
    leaseExpiresAt: new Date(h.dependencies.clock().getTime() + 120000) });
  const lease = () => ({ taskId: selection.taskId, runId: selection.runId, holderId: 'worker-a', fencingToken: '1',
    revision: h.state.aiRun[0].revision, expiresAt: h.state.aiRun[0].leaseExpiresAt.toISOString() });
  const published = await h.selections.publishSelectedInput({ selection, expectedTaskRevision: h.state.aiTask[0].revision, lease: lease() });
  const formal = require('../apps/api/src/modules/ai-native/approval-execution/controlled-approved-order.composition').composeControlledApprovedOrder(h.orderDependencies);
  await formal.plans.savePlan({ taskId: selection.taskId, runId: selection.runId, taskRevision: h.state.aiTask[0].revision,
    limits: h.state.aiTaskPlanPolicy.find(row => row.sceneCode === 'quote_clarification').limits,
    steps: [{ registrationRef: published.registrationRef, operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }] }, lease());
  const { taskId, expiresAt, ...held } = lease();
  const registered = await formal.registrations.register({ taskId, registrationRef: published.registrationRef, expectedTaskRevision: h.state.aiTask[0].revision, lease: held });
  const step = h.state.aiStep.find(row => row.id === registered.stepId); step.status = 'RUNNING';
  const pending = await h.selections.prepareSelectedProposal({ selection, command: { taskId, proposalId: 'request-bound-proposal', proposalRevision: 1,
    actionId: step.actionId, expiresAt: new Date(h.dependencies.clock().getTime() + 60000).toISOString(), lease: { ...held, revision: h.state.aiRun[0].revision } } });
  const humanModule = AiHumanQuoteSelectionModule.registerRequestBoundApplication(dependencies, options);
  assert.deepEqual(humanModule.exports, [AI_HUMAN_QUOTE_ORDER_REQUESTS]); assert.equal(humanModule.controllers, undefined);
  const app = humanModule.providers[0].useFactory();
  assert.equal(app.submitSelectedOrder, undefined); assert.equal(app.publishSelectedInput, undefined);
  const http = AiHumanQuoteSelectionModule.registerHttpApplication(dependencies, options);
  const { AiHumanQuoteOrderController } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
  const human = new AiHumanQuoteOrderController(http.providers.find(p => p.provide === AI_HUMAN_QUOTE_ORDER_REQUESTS).useFactory());
  assert.deepEqual(http.controllers, [AiHumanQuoteSelectionController, AiHumanQuoteOrderController]);
  const paths = require('../packages/shared/src/ai-quote-selection-draft').AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT;
  for (const method of ['readSelectedProposal', 'decideSelectedProposal', 'readSelectedDecisionReceipt', 'readSelectedOrderResult',
    'readSelectedReprepareEligibility', 'reprepareSelectedProposal', 'readSelectedReprepareReceipt'])
    assert.equal(Reflect.getMetadata('path', AiHumanQuoteOrderController.prototype[method]), paths[method]);
  assert.equal(human.submitSelectedOrder, undefined); assert.equal(human.publishSelectedInput, undefined);
  const proposal = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: 'request-bound-proposal', proposalRevision: 1,
    reviewedPayloadHash: pending.proposal.reviewedPayloadHash };
  const view = await human.readSelectedProposal(request, { selection, proposal });
  assert.equal(view.facts, undefined); assert.equal(view.generatedText, null);
  const decision = { selection, proposal: { ...proposal, decision: 'approve' } };
  const Ajv = require('ajv'), schemaAjv = new Ajv({ strict: false }); require('ajv-formats')(schemaAjv);
  const validDecision = schemaAjv.compile(require('../packages/shared/src/ai-quote-selection-draft-schemas').AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiHumanQuoteOrderDecisionRequestDraft);
  assert.equal(validDecision(decision), true); assert.equal(validDecision({ ...decision, lease: held }), false);
  await assert.rejects(human.decideSelectedProposal({ headers: {} }, decision), e => e.getStatus() === 403);
  await assert.rejects(human.decideSelectedProposal(request, { ...decision, lease: held }), e => e.getStatus() === 400);
  const approved = await human.decideSelectedProposal(request, decision);
  assert.equal(approved.approval.decision, 'approved'); assert.equal(approved.order, 'not_created_by_decision');
  assert.equal((await human.readSelectedDecisionReceipt(request, decision)).record.approvalId, approved.approval.approvalId);
  assert.equal(h.state.aiApproval.length, 1);
  assert.equal(h.state.rentalOrder?.length ?? 0, 0);
  h.b.h.identity.session = false;
  await assert.rejects(human.readSelectedDecisionReceipt(request, decision), e => e.getStatus() === 403);
});

test('selected new human materials reprepare through the formal factory and retain the receipt before a new decision', { timeout: 30000 }, async () => {
  const { selectedReprepareHarness } = require('./fixtures/ai-native/lane-a-selected-order.cjs');
  const { AiHumanQuoteSelectionModule } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.module');
  const h = await selectedReprepareHarness();
  const { credentials, originals, reprepareServices, ...dependencies } = h.dependencies;
  const options = { enabled: true, audience: 'operator' };
  const module = AiHumanQuoteSelectionModule.registerHttpApplication(dependencies, options, h.configuration);
  const { AiHumanQuoteOrderController, AI_HUMAN_QUOTE_ORDER_REQUESTS } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
  const app = new AiHumanQuoteOrderController(module.providers.find(p => p.provide === AI_HUMAN_QUOTE_ORDER_REQUESTS).useFactory());
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  assert.equal(app.submitSelectedOrder, undefined);
  assert.throws(() => AiHumanQuoteSelectionModule.registerRequestBoundApplication({ ...dependencies, reprepareServices }, options, h.configuration)
    .providers[0].useFactory(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await app.decideSelectedProposal(request, { selection: h.selection, proposal: { ...h.proposal, decision: 'reject' } });
  const input = { selection: h.selection, command: h.command };
  await assert.rejects(h.compose().reprepareSelectedProposal(input), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(app.reprepareSelectedProposal(request, { ...input, lease: {} }), e => e.getStatus() === 400);
  await assert.rejects(app.reprepareSelectedProposal({ headers: {} }, input), e => e.getStatus() === 403);
  h.state.reprepareAckLost = true;
  await assert.rejects(app.reprepareSelectedProposal(request, input), e => e.getStatus() === 409 && e.getResponse().code === 'AI_RESULT_UNKNOWN'
    && e.getResponse().retryable === false && e.getResponse().nextAction === 'read_reprepare_receipt');
  h.state.reprepareAckLost = false;
  const result = await app.readSelectedReprepareReceipt(request, input);
  assert.equal(result.receipt.state, 'prepared', JSON.stringify(h.state.failures));
  assert.equal(result.order, 'not_created_by_reprepare');
  assert.deepEqual(result.replacement.selection, h.replacementSelection);
  assert.equal(result.replacement.review.generatedText, null); assert.equal(result.replacement.review.facts, undefined);
  assert.equal(result.replacement.review.deterministic.quoteAmounts.payableAmount, 123);
  assert.equal(h.state.records.aiProposal.find(row => row.id === h.proposal.proposalId).status, 'SUPERSEDED');
  assert.equal(h.state.records.aiApprovalReprepare.length, 1); assert.equal(h.state.records.aiTaskOriginalRequest.length, 2);
  assert.equal(h.state.records.aiTaskQuoteSelection.length, 2); assert.equal(h.state.records.rentalOrder.length, 0);
  assert.deepEqual(await app.reprepareSelectedProposal(request, input), result);
  const approved = await app.decideSelectedProposal(request, { selection: result.replacement.selection,
    proposal: { ...result.receipt.proposal, decision: 'approve' } });
  assert.equal(approved.approval.decision, 'approved'); assert.equal(approved.order, 'not_created_by_decision');
  assert.equal(h.state.records.aiApproval.length, 2); assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.records.aiApprovalReprepare.length, 1);
  h.state.session = false;
  await assert.rejects(app.readSelectedReprepareReceipt(request, input), e => [403, 404].includes(e.getStatus()));
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
