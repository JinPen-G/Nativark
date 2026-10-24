'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
require('ts-node').register({ transpileOnly: false, compilerOptions: { rootDir: path.resolve(__dirname, '..'), module: 'commonjs', moduleResolution: 'node', target: 'ES2022', lib: ['ES2022'], esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-original-request.cjs');
const { PrismaQuoteSelectionRepository } = require('../apps/api/src/modules/ai-native/task-request/prisma-quote-selection.repository');
const { composeHumanQuoteOrder } = require('../apps/api/src/modules/ai-native/scenes/human-quote-order.composition');
const { RentalOrderConfirmationService } = require('../apps/api/src/modules/rental-core/rental-order-confirmation.service');
const { AI_QUOTE_SELECTION_DRAFT_VERSION } = require('../packages/shared/src/ai-quote-selection-draft');
const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { AiGuardedQuoteCoreContextSource } = require('../apps/api/src/modules/ai-native/tools/quote-route.composition');

async function harness(prepareProposal = false, withMembership = false, enterprise = false) {
  const h = await setup({ aiTaskQuoteSelection: [], aiApprovedOrderSnapshot: [], aiProposal: [],
    aiProposalVersion: [], aiProposalAction: [], aiApproval: [], aiApprovalConsumption: [], aiTaskResultArtifact: [], aiTaskEvent: [] }, withMembership);
  if (enterprise) {
    const rows=h.b.membershipRows;
    rows.corporateCustomers=[{id:'company-a',tenantId:'tenant_001',customerType:'corporate',name:'Synthetic enterprise'}];
    rows.corporateLinks=[{tenantId:'tenant_001',customerId:'company-a',status:'active'}];
    rows.bookingOptions=[{id:'relationship-a',tenantId:'tenant_001',personalCustomerId:'customer-a',corporateCustomerId:'company-a',
      corporateCustomer:{name:'Synthetic enterprise'},role:'employee',status:'active',effectiveFrom:new Date('2020-01-01T00:00:00Z'),effectiveTo:null}];
    h.b.candidate.bookingIdentity={bookingIdentity:'enterprise_employee',corporateCustomerId:'company-a',enterpriseContractAndPayer:false};
  }
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

test('human enterprise quote selection persists the exact identity without approval and rejects another enterprise', async () => {
  const h=await harness(false,true,true);
  const selected=await h.repository.select(h.command);
  assert.equal(selected.receipt.state,'selected_not_approved');assert.equal(selected.receipt.approval,'not_granted');
  const row=h.state.aiTaskQuoteSelection[0];
  assert.deepEqual(row.payload.bookingIdentity,h.command.order.bookingIdentity);
  const count=h.state.aiTaskQuoteSelection.length;
  await assert.rejects(h.repository.select({...h.command,selectionKey:'another-enterprise',
    expectedSelectionRevision:1,order:{...h.command.order,bookingIdentity:{...h.command.order.bookingIdentity,corporateCustomerId:'company-b'}}}));
  assert.equal(h.state.aiTaskQuoteSelection.length,count);
  assert.equal(h.state.aiApproval.length,0);
});
test('selected quote task HTTP uses normal runner and current human decision without caller execution authority', { timeout: 60000 }, async () => {
  const { selectedOrderHarness } = require('./fixtures/ai-native/lane-a-selected-order.cjs');
  const controllers = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
  const { AiHumanQuoteSelectionModule } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.module');
  for (const mode of ['approve', 'reject', 'cancel', 'unknown']) {
    const h = await selectedOrderHarness({ initializeOnly: true });
    Object.assign(h.sceneDependencies.core, {
      getProfile: () => ({ tenantId: 'tenant-a', categoryCode: 'camera' }),
      getWorkspaceCategory: async () => ({ code: 'camera', businessModel: { pricingUnits: ['day'], fulfillmentModes: ['store_pickup_return'] } }),
      getBusinessSettings: () => ({ tenantId: 'tenant-a', calendar: { timeZone: 'UTC' }, pricing: { enabledUnits: ['day'] },
        fulfillment: { enabledModes: ['store_pickup_return'] }, configVersion: 1 })
    });
    const configuration = { holderId: 'selected-host', creationRules: [{ sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1,
      audiences: ['operator'], requiredPermissions: ['rental-os:order:create'], maxInputAgeMs: 3600000 }], memberships: { listPersonalOptions: async () => [] } };
    const { credentials, originals, ...dependencies } = h.sceneDependencies;
    Object.assign(dependencies, { creationRules: configuration.creationRules, memberships: configuration.memberships });
    let ticks = 0;
    const options = { enabled: true, audience: 'operator' }, taskOptions = {
      host: { holderId: configuration.holderId, leaseMs: 100000 }, limits: h.limits, monotonic: () => ++ticks };
    const module = AiHumanQuoteSelectionModule.registerHttpTask(dependencies, options, taskOptions, configuration);
    assert.ok(module.controllers.includes(controllers.AiSelectedQuoteTaskController));
    assert.equal(Reflect.getMetadata('controllers', AiHumanQuoteSelectionModule)?.length ?? 0, 0);
    const requests = module.providers.find(p => p.provide === controllers.AI_SELECTED_QUOTE_TASK_REQUESTS).useFactory();
    const task = new controllers.AiSelectedQuoteTaskController(requests);
    const human = new controllers.AiHumanQuoteOrderController(module.providers.find(p => p.provide === controllers.AI_HUMAN_QUOTE_ORDER_REQUESTS).useFactory());
    const request = new (require('node:events').EventEmitter)();
    request.headers = { authorization: (await credentials.current()).authorization };
    const command = { selection: h.selection };
    const schemas = require('../packages/shared/src/ai-quote-selection-draft-schemas').AI_QUOTE_SELECTION_DRAFT_SCHEMAS;
    const Ajv = require('ajv'), ajv = new Ajv({ strict: true }); require('ajv-formats')(ajv);
    const valid = ajv.compile(schemas.AiSelectedQuoteTaskRequestDraft);
    assert.equal(valid(command), true); assert.equal(valid({ ...command, order: h.body }), false);
    assert.equal(valid({ ...command, lease: {} }), false);
    assert.equal(h.state.records.aiTask[0].status, 'QUEUED'); assert.equal(h.state.records.aiRun[0].leaseOwnerId, null);
    assert.equal(h.state.records.aiStep.length, 0);
    await assert.rejects(requests.start(request, { ...command, lease: {} }), e => e.code === 'AI_INVALID_INPUT');
    await assert.rejects(requests.start({ headers: {} }, command), e => e.code === 'AI_ACCESS_DENIED');
    await assert.rejects(requests.start(request, { selection: { ...h.selection, inputHash: 'f'.repeat(64) } }), e => e.code === 'AI_ACCESS_DENIED');
    request.aborted = true;
    assert.equal((await task.start(request, command)).reason, 'host_aborted');
    assert.equal(h.state.records.aiStep.length, 0); request.aborted = false;
    const started = await task.start(request, command);
    assert.equal(started.outcome.status, 'paused', JSON.stringify({ started, failures: h.state.failures }));
    assert.equal(request.listenerCount('aborted'), 0);
    const r = h.state.records, wait = await task.readConfirmation(request, { ...command, stepId: r.aiStep[0].id });
    assert.equal(wait.execution, 'not_attested'); assert.equal(wait.lease, undefined);
    assert.equal(r.aiTask[0].status, 'WAITING_CONFIRMATION'); assert.equal(r.aiApproval.length, 0); assert.equal(r.rentalOrder.length, 0);
    assert.equal(r.aiTaskActionInput[0].registrationRef, `quote-selection:${h.selection.selectionId}`);
    const page = await task.readTaskPage(request, { limit: 5 });
    assert.ok(page.items.some(row => row.taskId === h.selection.taskId));
    await assert.rejects(requests.readTaskPage(request, { limit: 51 }), e => e.code === 'AI_INVALID_INPUT');
    await assert.rejects(requests.readResult(request, { ...command, lease: {} }), e => e.code === 'AI_INVALID_INPUT');
    await assert.rejects(requests.readResult(request, { selection: { ...h.selection, inputHash: 'f'.repeat(64) } }), e => e.code === 'AI_ACCESS_DENIED');
    const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
    const beforeRead = clone(h.state.records), observed = await task.readResult(request, command);
    assert.equal(observed.status, 'not_observed'); assert.equal(observed.retryable, false); assert.equal(observed.sideEffect, 'not_attested');
    assert.deepEqual(h.state.records, beforeRead);
    const original = { draftVersion: require('../packages/shared/src/ai-scene-request-draft').AI_SCENE_REQUEST_DRAFT_VERSION,
      inputRef: h.selection.originalInputRef };
    const events = await task.readTaskEvents(request, { original, after: '0', limit: 20 });
    assert.equal(events.taskId, h.selection.taskId);
    const snapshot = await requests.readTaskSnapshot(request, original);
    assert.equal(snapshot.taskId, h.selection.taskId); assert.equal(snapshot.status, 'waiting_confirmation');
    assert.equal(typeof snapshot.cursor, 'string');
    await assert.rejects(requests.readTaskSnapshot(request, { ...original, runId: h.selection.runId }), e => e.code === 'AI_INVALID_INPUT');
    const sceneRequest = { kind: 'original', original, taskId: h.selection.taskId,
      runId: h.selection.runId, review: { selection: h.selection, proposal: wait.proposal }, order: command };
    const sceneValid = ajv.compile(require('../packages/shared/src/ai-scene-request-draft-schemas').AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneModelTaskSceneDraft);
    assert.equal(sceneValid(sceneRequest), true);
    assert.equal(sceneValid({ ...sceneRequest, order: { ...command, command: {} } }), false);
    const scene = await task.readScene(request, sceneRequest);
    assert.equal(scene.business.result.status, 'not_observed');
    assert.equal(scene.execution, 'read_only_no_start_no_reconnect_side_effect');
    assert.deepEqual(h.state.records, beforeRead);
    if (mode === 'approve') {
      const { requestBoundOriginalModelHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
      const modelHost = await requestBoundOriginalModelHarness('quote_clarification');
      dependencies.core.availability = modelHost.requestDependencies.core.availability.bind(modelHost.requestDependencies.core);
      dependencies.core.resolvePricingGroupQuoteRequest = modelHost.requestDependencies.core.resolvePricingGroupQuoteRequest.bind(modelHost.requestDependencies.core);
      dependencies.business = modelHost.requestDependencies.business;
      const modelDependencies = { ...modelHost.requestDependencies, ...dependencies };
      const modelOptions = { ...modelHost.options, quoteTask: { dependencies, configuration: taskOptions } };
      const { AiOriginalScenesModule, AI_ORIGINAL_SCENE_MODEL_REQUESTS } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.module');
      const modelModule = AiOriginalScenesModule.registerHttpModel(modelDependencies, modelOptions);
      const modelRequests = modelModule.providers.find(p => p.provide === AI_ORIGINAL_SCENE_MODEL_REQUESTS).useFactory();
      const unified = await modelRequests.readTaskScene(request, { kind: 'original', original, taskId: h.selection.taskId,
        runId: h.selection.runId, review: { selection: h.selection, proposal: wait.proposal }, order: command });
      assert.equal(unified.business.result.status, 'not_observed');
      assert.equal(unified.pendingInput.availability, 'not_requested');
      assert.equal(modelHost.execution.sent.length, 0);
      assert.equal(modelHost.factoryCalls.length, 0, 'business reads do not construct the model execution host');
      assert.deepEqual(h.state.records, beforeRead);
      const { composeRequestBoundOriginalSceneModel } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
      assert.throws(() => composeRequestBoundOriginalSceneModel(modelDependencies, { ...modelOptions,
        quoteTask: { ...modelOptions.quoteTask, dependencies: { ...dependencies, db: modelHost.requestDependencies.db } } }),
        e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    }
    const transaction = dependencies.db.$transaction;
    dependencies.db.$transaction = (work, ...options) => transaction(async tx => {
      const read = tx.aiApprovalConsumption.findFirst;
      tx.aiApprovalConsumption.findFirst = async args => {
        const row = await read(args); h.state.session = false; return row;
      };
      return work(tx);
    }, ...options);
    try { await assert.rejects(requests.readResult(request, command), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code)); }
    finally { h.state.session = true; dependencies.db.$transaction = transaction; }
    const frozen = JSON.stringify(r.aiTaskRunPlan[0].payload), actionId = r.aiStep[0].actionId;
    const charges = r.aiTaskExecutionCharge.map(row => row.chargeId);
    const continuation = { ...command, checkpointRef: wait.checkpointRef };
    await assert.rejects(requests.continueConfirmation(request, continuation));
    assert.equal(h.state.records.aiRun[0].leaseOwnerId, null);
    await assert.rejects(requests.continueConfirmation(request, { ...continuation, checkpointRef: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }));
    if (mode === 'cancel') {
      const cancelled = await task.requestCancel(request, { ...command, expectedRevision: wait.taskRevision });
      assert.equal(cancelled.cancellation, 'requested_not_rollback');
      await assert.rejects(requests.continueConfirmation(request, continuation));
      const result = await task.reconcile(request, command);
      assert.notEqual(result.outcome.status, 'succeeded'); assert.equal(h.state.records.rentalOrder.length, 0);
      assert.equal((await task.readResult(request, command)).status, 'not_observed');
    } else if (mode === 'reject') {
      await human.decideSelectedProposal(request, { ...command, proposal: { ...wait.proposal, decision: 'reject' } });
      const result = await task.continueConfirmation(request, continuation);
      assert.equal(result.outcome.status, 'failed'); assert.equal(h.state.records.rentalOrder.length, 0);
      assert.equal((await task.readResult(request, command)).status, 'not_observed');
    } else {
      const decision = await human.decideSelectedProposal(request, { ...command, proposal: { ...wait.proposal, decision: 'approve' } });
      assert.equal(decision.order, 'not_created_by_decision'); assert.equal(h.state.records.rentalOrder.length, 0);
      h.state.ackLost = mode === 'unknown';
      const continued = await task.continueConfirmation(request, continuation);
      assert.equal(continued.outcome.status, mode === 'unknown' ? 'unknown' : 'succeeded', JSON.stringify({ continued, failures: h.state.failures }));
      assert.equal(h.state.records.rentalOrder.length, 1); assert.equal(h.state.commits, 1);
      if (mode === 'unknown') {
        const unresolved = clone(h.state.records);
        assert.equal((await task.readResult(request, command)).status, 'committed');
        assert.deepEqual(h.state.records, unresolved);
        dependencies.db.$transaction = (work, ...options) => transaction(async tx => {
          tx.aiApprovalConsumption.findFirst = async () => null;
          return work(tx);
        }, ...options);
        try {
          const missing = await task.readResult(request, command);
          assert.equal(missing.status, 'unknown'); assert.equal(missing.retryable, false);
          assert.equal(missing.order, undefined); assert.equal(missing.sideEffect, 'may_have_committed');
          assert.deepEqual(h.state.records, unresolved);
        } finally { dependencies.db.$transaction = transaction; }
        h.state.ackLost = false;
        const recovered = await task.reconcile(request, command);
        assert.equal(recovered.outcome.status, 'succeeded', JSON.stringify({ recovered, failures: h.state.failures }));
        assert.equal(h.state.commits, 1);
      }
      const beforeCommittedRead = clone(h.state.records);
      const { PrismaApprovedOrderSource } = require('../apps/api/src/modules/ai-native/approval-execution/prisma-approved-order.source');
      const sourceRead = PrismaApprovedOrderSource.prototype.read, presented = [];
      PrismaApprovedOrderSource.prototype.read = function(command, ...args) {
        presented.push(clone(command.lease)); return sourceRead.call(this, command, ...args);
      };
      let committed;
      try { committed = await task.readResult(request, command); }
      finally { PrismaApprovedOrderSource.prototype.read = sourceRead; }
      assert.deepEqual(h.state.records, beforeCommittedRead);
      const executed = h.state.records.aiTaskExecutionPhaseStart.find(row => row.sequence === 2);
      assert.ok(executed); assert.ok(presented.length > 0);
      for (const lease of presented) assert.deepEqual(lease, { runId: h.selection.runId, holderId: executed.leaseOwnerId,
        revision: executed.runRevision, fencingToken: executed.fencingToken.toFixed(0) });
      assert.equal(committed.status, 'committed', JSON.stringify({ committed, failures: h.state.failures }));
      assert.equal(committed.order.id, h.state.records.rentalOrder[0].id);
      assert.equal(committed.order.quoteId, h.body.quoteId);
      assert.equal(committed.replayed, true);
      const terminalState = clone(h.state.records);
      const terminalResult = await task.reconcile(request, command);
      assert.deepEqual(terminalResult, committed, 'terminal recovery returns only the original authorized order result');
      assert.deepEqual(h.state.records, terminalState, 'terminal recovery must not reclaim execution or write');
      assert.equal(h.state.commits, 1);
      assert.equal(committed.payment, 'not_inferred'); assert.equal(committed.fulfillment, 'not_inferred');
      assert.equal(committed.taskOutcome, 'owned_by_runner'); assert.equal(committed.source.resourceId, committed.order.id);
      const sceneState = clone(h.state.records), completedScene = await task.readScene(request, sceneRequest);
      assert.equal(completedScene.business.result.order.id, committed.order.id);
      assert.equal(completedScene.submission, 'not_attested_by_approval');
      assert.deepEqual(h.state.records, sceneState);
      assert.deepEqual(Object.keys(committed).sort(), ['status', 'replayed', 'order', 'source', 'payment', 'fulfillment', 'taskOutcome'].sort());
      for (const [field, forged] of [['planHash', 'f'.repeat(64)], ['decisionRef', 'foreign-approval']]) {
        const phase = h.state.records.aiTaskExecutionPhaseStart.find(row => row.sequence === 2), saved = phase[field];
        phase[field] = forged;
        try { await assert.rejects(requests.readResult(request, command), e => e.code === 'AI_ACCESS_DENIED'); }
        finally { h.state.records.aiTaskExecutionPhaseStart.find(row => row.sequence === 2)[field] = saved; }
      }
      h.state.resourceAccess = false;
      assert.equal((await task.readResult(request, command)).status, 'unknown');
      h.state.resourceAccess = true;
      await assert.rejects(requests.continueConfirmation(request, continuation));
      assert.equal(h.state.records.rentalOrder.length, 1);
      assert.ok(h.state.records.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
      assert.equal(h.state.records.aiTaskExecutionBudget[0].consumedSteps, 1n);
      h.state.clock = new Date(Date.now() + 7200000); h.state.records.aiTaskPlanPolicy[0].enabled = false;
      const historical = clone(h.state.records);
      assert.equal((await task.readResult(request, command)).status, 'committed');
      assert.deepEqual(h.state.records, historical);
    }
    assert.equal(h.state.records.aiStep[0].actionId, actionId);
    assert.equal(JSON.stringify(h.state.records.aiTaskRunPlan[0].payload), frozen);
    assert.deepEqual(h.state.records.aiTaskExecutionCharge.map(row => row.chargeId), charges);
    assert.equal(h.state.records.aiTaskExecutionBudget.length, 1);
    h.state.session = false;
    await assert.rejects(requests.readResult(request, command));
    await assert.rejects(requests.reconcile(request, command));
  }
});

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
  const center = composeAiTaskCenterScene({ ...centerDependencies,
    orders: { readResult: ({ selection }) => h.app.readSelectedOrderResult({ selection, command }) } });
  const centerRead = { original: { draftVersion: 'ain-scene-request-draft-1', inputRef: h.selection.originalInputRef }, reference: { selection: h.selection } };
  assert.equal((await center.readOrderResult(centerRead)).result.order.id, outcome.order.id);
  await assert.rejects(center.readOrderResult({ ...centerRead, reference: execution }), e => e.code === 'AI_INVALID_INPUT');
  await assert.rejects(composeAiTaskCenterScene(centerDependencies).readOrderResult(centerRead), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(center.readOrderResult({ ...centerRead, reference: { selection: { ...h.selection,
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

test('human quote selection binds consumed model answers and prevents a competing model plan', { timeout: 60000 }, async () => {
  for (const mode of ['reject', 'approve', 'lost_commit', 'cancel', 'enterprise_approve']) {
  const decision=mode==='reject'?'reject':'approve';
  const { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const h=await originalModelApplicationHarness('quote_clarification',undefined,{customerType:'personal'},
    [{code:'rental.order.commit',version:require('./fixtures/ai-native/local-shared.cjs').AI_TOOL_DRAFT_VERSION}]);
  const policy=h.state.aiTaskPlanPolicy.find(row=>row.sceneCode==='quote_clarification');
  const app=h.model.createApplication({holderId:'clarified-choice',leaseMs:100000},{...h.run,inputSource:'original_scene'});
  assert.equal((await app.start(h.reference)).execution.outcome.status,'paused');
  const pending=await app.readInput(h.reference);
  const submission={draftVersion:require('./fixtures/ai-native/local-shared.cjs').AI_TASK_INPUT_DRAFT_VERSION,
    taskId:h.created.task.taskId,requestId:pending.requestId,expectedRevision:pending.revision,submissionKey:'choose-successor',
    answers:pending.contract.fields.map(field=>({fieldId:field.fieldId,value:field.kind==='choice'?field.options[0].value:
      field.kind==='integer'?1:field.fieldId==='starts_at'?'2027-02-01T00:00:00.000Z':
      field.fieldId==='ends_at'?'2027-02-02T00:00:00.000Z':'Explicit human answer'}))};
  await app.resume({original:h.reference,submission},AbortSignal.abort());
  const received={receipt:await app.readAnswer({original:h.reference,submission})};
  const quoted=await harness(false,true,mode==='enterprise_approve');
  quoted.b.facts.listAssets = async () => [1,2].map(index => ({id:`asset-${index}`,tenantId:'tenant_001',workspaceId:'workspace-a',
    itemGroupId:quoted.b.group.id,locationId:quoted.b.location.id,status:'available'}));
  // Only persistence is simulated: preparation and inventory decisions use Rental Core.
  const coreFacts=Object.assign(quoted.b.facts,{
    findOrder:async (tenant,id,tx)=> (tx??h.db).rentalOrder.findFirst({where:{tenantId:tenant,id}}),
    countOrders:async (tenant)=>(await h.db.rentalOrder.findMany({where:{tenantId:tenant}})).length,
    saveOrderAggregate:async (order,_lines,tx)=>tx.rentalOrder.create({data:{...structuredClone(order),
      workspaceId:require('../apps/api/src/common/request-identity').getRequestWorkspaceId()}})});
  await h.db.rentalQuote.create({data:{id:quoted.quote.id,tenantId:quoted.quote.tenantId,
    snapshot:structuredClone(quoted.quote),consumedAt:null,consumedOrderId:null}});
  const quoteFacts={
    findQuote:async (tenant,id,tx)=>{const row=await (tx??h.db).rentalQuote.findFirst({where:{tenantId:tenant,id}});
      return row?{...row.snapshot,...(row.consumedAt?{consumedAt:row.consumedAt,consumedOrderId:row.consumedOrderId}:{})}:null;},
    consumeQuoteIfAvailable:async (tenant,id,orderId,at,tx)=>(await tx.rentalQuote.updateMany({
      where:{tenantId:tenant,id,consumedAt:null},data:{consumedAt:at,consumedOrderId:orderId}})).count===1};
  const {RentalIdempotencyRepository}=require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const confirmation=new RentalOrderConfirmationService(h.db,quoted.b.core,quoted.b.business,coreFacts,quoteFacts,
    new RentalIdempotencyRepository(h.db),undefined,undefined,undefined,undefined,quoted.b.memberships);
  const coreErrors=[],createApprovedOrder=confirmation.createApprovedOrder.bind(confirmation);
  confirmation.createApprovedOrder=async (...args)=>{try{return await createApprovedOrder(...args);}
    catch(error){coreErrors.push(error.message);throw error;}};
  const dependencies={...h.dependencies,originals:h.model.scenes.requests,
    scene:{code:'quote_clarification',version:'1'},
    core:quoted.b.core,business:quoted.b.business,memberships:quoted.b.memberships,confirmation, quoteFacts};
  // The quoted fact is an actual Core quote; only its repository read is a DB substitute.
  const repository=new PrismaQuoteSelectionRepository(dependencies);
  const command={...quoted.command,originalInputRef:h.reference.inputRef,taskId:h.created.task.taskId,
    runId:received.receipt.runId,selectionKey:'clarified-choice'};
  await assert.rejects(repository.select({...command,runId:require('node:crypto').randomUUID()}),e=>e.code==='AI_ACCESS_DENIED');
  const selected=await repository.select(command);
  assert.equal(selected.receipt.runId,received.receipt.runId);assert.equal(selected.receipt.approval,'not_granted');
  assert.equal(h.state.aiTaskQuoteSelection.length,1);
  assert.equal((await repository.reconcile(command)).receipt.selectionId,selected.receipt.selectionId);
  await assert.rejects(app.continueAnswer({original:h.reference,submission}),e=>e.code==='AI_REVISION_CONFLICT');
  assert.equal(h.state.aiTaskRunPlan.some(row=>row.runId===received.receipt.runId),false);
  assert.equal(h.execution.sent.length,1);
  const {composeSelectedQuoteTaskApplication}=require('../apps/api/src/modules/ai-native/scenes/human-quote-order.composition');
  const selection={draftVersion:selected.receipt.draftVersion,originalInputRef:selected.receipt.originalInputRef,
    selectionId:selected.receipt.selectionId,taskId:selected.receipt.taskId,runId:selected.receipt.runId,inputHash:selected.receipt.inputHash};
  const limits=structuredClone(policy.limits);let ticks=0;
  const orderTask=composeSelectedQuoteTaskApplication(dependencies,{host:{holderId:'clarified-order',leaseMs:100000},limits,monotonic:()=>++ticks});
  const started=await orderTask.start({selection});
  assert.equal(started.outcome.status,'paused',JSON.stringify(started));
  assert.equal(h.state.aiTaskExecutionBudget.length,1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,1n);
  const step=h.state.aiStep.find(row=>row.runId===selection.runId);
  const waiting=await orderTask.readConfirmation({selection,stepId:step.id});
  assert.equal(waiting.execution,'not_attested');
  assert.equal(h.state.aiApproval.length,0);
  h.state.aiTaskActionPolicy.push({scopeId:'scope-a',taskId:selection.taskId,operation:'decide_approval',revision:1,
    requiredPermissions:['rental-os:order:create'],expiresAt:new Date('2027-01-01')});
  const human=composeHumanQuoteOrder(dependencies);
  if(mode==='cancel') {
    const cancelled=await orderTask.requestCancel({selection,expectedRevision:h.state.aiTask[0].revision});
    assert.equal(cancelled.cancellation,'requested_not_rollback');
    await assert.rejects(human.decideSelectedProposal({selection,proposal:{...waiting.proposal,decision:'approve'}}));
    const phases=structuredClone(h.state.aiTaskExecutionPhaseReceipt);
    h.state.aiTaskExecutionPhaseReceipt=h.state.aiTaskExecutionPhaseReceipt.filter(row=>row.stepId!==step.id);
    try {
      const withoutEvidence=await orderTask.reconcile({selection});
      assert.notEqual(withoutEvidence.outcome?.status,'cancelled');
      assert.equal(h.state.aiTask[0].status,'CANCEL_REQUESTED');
      assert.equal(h.state.rentalOrder.length,0);
    } finally {h.state.aiTaskExecutionPhaseReceipt=phases;}
    const stopped=await orderTask.reconcile({selection});
    assert.equal(stopped.outcome?.status,'cancelled',JSON.stringify(stopped));
    assert.equal(h.state.aiTask[0].status,'CANCELLED');
    assert.equal(h.state.rentalOrder.length,0);
    assert.equal(h.state.aiApprovalConsumption.length,0);
    assert.equal(h.state.aiTaskExecutionBudget.length,1);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,1n);
    assert.equal(h.execution.sent.length,1);
    continue;
  }
  const declined=await human.decideSelectedProposal({selection,proposal:{...waiting.proposal,decision}});
  assert.equal(declined.approval.decision,decision==='approve'?'approved':'rejected');
  if(mode==='lost_commit') h.control.beforeCommit=async draft=>{
    if(draft.rentalOrder.length===1 && h.state.rentalOrder.length===0) {
      h.control.loseReply=true; h.control.beforeCommit=null;
    }
  };
  let finished=await orderTask.continueConfirmation({selection,checkpointRef:waiting.checkpointRef});
  if(mode==='lost_commit') {
    assert.equal(finished.outcome?.status,'unknown',JSON.stringify({finished,coreErrors}));
    assert.equal(h.state.rentalOrder.length,1);
    assert.equal((await orderTask.readResult({selection})).status,'committed');
    finished=await orderTask.reconcile({selection});
  }
  assert.equal(finished.outcome?.status,decision==='approve'?'succeeded':'partially_succeeded',JSON.stringify({finished,coreErrors}));
  assert.equal(h.state.aiStep.find(row=>row.runId===selection.runId).status,decision==='approve'?'SUCCEEDED':'FAILED');
  assert.equal(h.state.aiStep.find(row=>row.runId===selection.runId).effect,decision==='approve'?'COMMITTED':'NONE');
  assert.equal(h.state.aiTaskExecutionBudget.length,1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,1n);
  assert.equal(h.state.aiApprovalConsumption.length,decision==='approve'?1:0);
  assert.equal(h.state.rentalOrder.length,decision==='approve'?1:0);
  if(decision==='approve') {
    if(mode==='enterprise_approve') {
      assert.equal(h.state.rentalOrder[0].membershipSnapshot.bookingIdentity,'enterprise_employee');
      assert.equal(h.state.rentalOrder[0].membershipSnapshot.corporateCustomerId,'company-a');
      assert.equal(h.state.rentalOrder[0].membershipSnapshot.personalCustomerId,'customer-a');
    }
    const originalResult=await orderTask.readResult({selection});
    assert.equal(originalResult.status,'committed');
    assert.deepEqual(await orderTask.readResult({selection}),originalResult);
    assert.equal(h.state.rentalOrder.length,1);
    assert.equal(h.state.rentalOrderIdempotencyRecord.length,1);
    assert.equal(h.state.aiApprovalConsumption.length,1);
    assert.equal(h.state.rentalOrderIdempotencyRecord[0].orderId,h.state.rentalOrder[0].id);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,1n);
    const {composeAiTaskCenterScene}=require('../apps/api/src/modules/ai-native/task-center-scene.composition');
    const center=composeAiTaskCenterScene({list:{readPage:async()=>{throw Error('not used');}},
      scenes:h.model.scenes,selections:repository,orders:orderTask});
    const displayed=await center.readOrderResult({original:h.reference,reference:{selection}});
    assert.equal(displayed.result.order.id,h.state.rentalOrder[0].id);
    assert.equal(displayed.runId,selection.runId);
    assert.equal(h.state.rentalOrder.length,1);
    if(mode==='approve') {
      const aggregate=await center.readScene({kind:'original',taskId:selection.taskId,runId:selection.runId,
        original:h.reference,order:{selection}});
      assert.equal(aggregate.business.result.order.id,h.state.rentalOrder[0].id);
      assert.equal(aggregate.originRunId,h.created.task.runId);
      assert.equal(aggregate.pendingInput.availability,'not_requested');
      await assert.rejects(center.readScene({kind:'original',taskId:selection.taskId,runId:h.created.task.runId,
        original:h.reference,order:{selection}}),error=>error.code==='AI_ACCESS_DENIED');
      await assert.rejects(center.readOrderResult({original:h.reference,reference:{selection:{...selection,
        runId:require('node:crypto').randomUUID()}}}),error=>error.code==='AI_ACCESS_DENIED');
      const noSelectionReader=composeAiTaskCenterScene({list:{readPage:async()=>{throw Error('not used');}},
        scenes:h.model.scenes,orders:orderTask});
      await assert.rejects(noSelectionReader.readOrderResult({original:h.reference,reference:{selection}}),
        error=>error.code==='AI_RESOURCE_UNAVAILABLE');
      assert.equal(h.state.rentalOrder.length,1);
    }
  }
  assert.equal(h.execution.sent.length,1);
  }
});
