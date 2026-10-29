'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
require('ts-node').register({ transpileOnly: false, compilerOptions: { rootDir: path.resolve(__dirname, '..'), module: 'commonjs', moduleResolution: 'node', target: 'ES2022', lib: ['ES2022'], esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-original-request.cjs');
const { AiOriginalScenesModule } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.module');
const { AiOriginalScenesController, AI_ORIGINAL_SCENES } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
const { AI_SCENE_REQUEST_HTTP_DRAFT } = require('../packages/shared/src/ai-scene-request-draft');
const { AI_SCENE_REQUEST_DRAFT_SCHEMAS } = require('../packages/shared/src/ai-scene-request-draft-schemas');
const Ajv = require('ajv'), addFormats = require('ajv-formats');
const ajv = new Ajv({ strict: true }); addFormats(ajv);
const recoveryValid = ajv.compile(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestRecoveryDraft);

test('fixed order chain exposes closed preparation, actual order facts and a snapshot-bound answer without redispatch', { timeout: 60000 }, async () => {
  const shared = require('../packages/shared/src');
  const { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const { composeAiOriginalSceneModel } = require('../apps/api/src/modules/ai-native/scenes/original-scene-model.composition');
  const { AiOriginalOrderReadController } = require('../apps/api/src/modules/ai-native/scenes/original-order-read.controller');
  const { composePersistedTaskCenter } = require('../apps/api/src/modules/ai-native/task-center.composition');
  const { validateAiOrderReadResponse } = require('../apps/api/src/modules/ai-native/scenes/scene-observation-contracts');
  const tool = { code: 'rental.order.explain', version: shared.AI_TOOL_DRAFT_VERSION };
  const h = await originalModelApplicationHarness('order_explanation', undefined, undefined, [tool], undefined, { maxSteps: 3, maxCalls: 2 });
  const dependencies = { ...h.modelDependencies, gatewayScene: { ...h.modelDependencies.gatewayScene, orderExplainTool: true } };
  const model = composeAiOriginalSceneModel(dependencies);
  const chain = model.createModelOrderApplication({ holderId: 'fixed-order-worker', leaseMs: 100000 },
    { financialEvidence: h.financial }, { answerRoundTrip: true });
  h.execution.beforeTransport = async () => {
    h.execution.result = h.execution.sent.length === 1 ? { text: 'Candidate only', usage: { inputTokens: 1, outputTokens: 2 },
      toolRequests: [{ contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, toolCode: tool.code, toolVersion: tool.version, input: { orderId: 'order-a' } }] }
      : { text: 'Snapshot explanation, not payment evidence', usage: { inputTokens: 3, outputTokens: 4 } };
  };
  const request = { headers: { authorization: (await dependencies.credentials.current()).authorization } };
  const center = composePersistedTaskCenter(dependencies);
  const methods = Object.fromEntries(Object.keys(shared.AI_ORDER_READ_HTTP_CONTRACTS).map(action => [action,
    (_request, command, signal) => action === 'readTaskSnapshot' ? center.events.readSnapshot({ taskId: h.created.task.taskId })
      : chain[action === 'readTaskScene' ? 'readScene' : action === 'reopenModelSource' ? 'reopenOrderSource' : action](command, signal)]));
  const controller = new AiOriginalOrderReadController(methods);
  const before = await controller.readPreparation(request, h.reference);
  assert.deepEqual(before.preparation.missing, ['model_request', 'order_read', 'model_answer']);
  assert.equal(before.preparation.planPublished, false); assert.equal(h.execution.sent.length, 0);
  const started = await controller.start(request, h.reference);
  assert.equal(started.outcome.outcome.status, 'succeeded', JSON.stringify(started));
  assert.equal(h.execution.sent.length, 2); assert.equal(h.state.aiStep.length, 3);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 2n);
  assert.equal((await controller.readPreparation(request, h.reference)).preparation.planPublished, true);
  const facts = await controller.readOrderResult(request, h.reference);
  assert.equal(facts.result.status, 'available'); assert.equal(facts.result.facts.order.amounts.finalPayable, 100);
  assert.equal(facts.result.facts.paymentEvidence, 'not_loaded');
  const answer = await controller.readAnswer(request, h.reference);
  assert.equal(answer.result.status, 'available'); assert.equal(answer.result.textSemantics, 'model_text_not_core_fact');
  assert.equal(answer.result.originalReadResultId, facts.result.resultId);
  assert.equal((await controller.readModelResult(request, h.reference)).toolCandidates.execution, 'not_attempted');
  assert.equal((await controller.reopenModelSource(request, h.reference)).sourceIndex, 0);
  const scene = await controller.readTaskScene(request, h.reference);
  assert.equal(scene.answer.result.originalReadResultId, facts.result.resultId); assert.equal(scene.handoff.approval, 'not_granted');
  assert.equal((await controller.readTaskSnapshot(request, h.reference)).taskId, h.created.task.taskId);
  const stopped = await controller.recover(request, h.reference);
  assert.equal(stopped.outcome.reason, 'task_not_runnable'); assert.equal(h.execution.sent.length, 2);
  for (const [action, value, corrupt] of [
    ['readOrderResult', facts, value => { value.result.facts.sources[0].resourceId = 'another-order'; }],
    ['readAnswer', answer, value => { value.result.facts.order.privateNote = 'must-not-leak'; }],
    ['readAnswer', answer, value => { value.result.text = '界'.repeat(50000); }],
    ['readTaskScene', scene, value => { value.answer.original.inputRef = 'another-original'; }],
    ['readPreparation', before, value => { value.preparation.publishedInputs = 2; }]
  ]) {
    const invalid = structuredClone(value); corrupt(invalid);
    assert.throws(() => validateAiOrderReadResponse(action, invalid, h.reference), error => error.code === 'AI_STORAGE_UNAVAILABLE');
  }
  const independent = structuredClone(scene);
  independent.orderFacts = { ...facts, result: { status: 'candidate_not_executed', facts: null, automaticRetry: false, businessExecution: 'readonly_not_business_commit' } };
  assert.doesNotThrow(() => validateAiOrderReadResponse('readTaskScene', independent, h.reference));
  for (const alter of [value => { value.order.id = 'another-order'; }, value => { value.scope.workspaceId = 'another-workspace'; }]) {
    const mixed = structuredClone(independent); alter(mixed.answer.result.facts);
    assert.throws(() => validateAiOrderReadResponse('readTaskScene', mixed, h.reference), error => error.code === 'AI_STORAGE_UNAVAILABLE');
  }
  const mutated = new AiOriginalOrderReadController({ ...methods, readAnswer: async (_request, command) => {
    command.inputRef = 'another-original'; return { ...answer, original: { ...answer.original, inputRef: command.inputRef } };
  } });
  await assert.rejects(mutated.readAnswer(request, h.reference), error => error.getStatus() === 503);
  assert.equal(answer.original.inputRef, h.reference.inputRef);
  const changedOrder = { ...require('./fixtures/ai-native/authorization-baseline.cjs').order({ tenantId: 'tenant_001' }),
    finalPayableAmount: 101, updatedAt: '2026-01-01T01:00:00Z' };
  h.b.facts.findOrder = async () => structuredClone(changedOrder);
  assert.equal((await controller.readOrderResult(request, h.reference)).result.status, 'stale');
  assert.equal((await controller.readAnswer(request, h.reference)).result.status, 'stale');
  assert.equal(h.execution.sent.length, 2); assert.equal(h.state.aiGatewayInvocation.length, 2);
  h.b.h.identity.session = false;
  await assert.rejects(controller.readOrderResult(request, h.reference), error => error.getStatus() === 403);
  assert.equal(h.execution.sent.length, 2);
});

test('fixed order public receipts preserve cancellation and takeover generations and unknown writes', { timeout: 60000 }, async () => {
  const shared = require('../packages/shared/src'), contracts = require('./fixtures/ai-native/contract-consumer.cjs');
  const { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const { composeAiOriginalSceneModel } = require('../apps/api/src/modules/ai-native/scenes/original-scene-model.composition');
  const { AiOriginalOrderReadController } = require('../apps/api/src/modules/ai-native/scenes/original-order-read.controller');
  const create = async () => {
    const h = await originalModelApplicationHarness('order_explanation', undefined, undefined,
      [{ code: 'rental.order.explain', version: shared.AI_TOOL_DRAFT_VERSION }], undefined, { maxSteps: 2, maxCalls: 1 });
    const deps = { ...h.modelDependencies, gatewayScene: { ...h.modelDependencies.gatewayScene, orderExplainTool: true } };
    const chain = composeAiOriginalSceneModel(deps).createModelOrderApplication({ holderId: 'fixed-recovery-worker', leaseMs: 100000 },
      { financialEvidence: h.financial });
    const request = { headers: { authorization: (await deps.credentials.current()).authorization } };
    const methods = Object.fromEntries(Object.keys(shared.AI_ORDER_READ_HTTP_CONTRACTS).map(action => [action,
      (_request, command, signal) => chain[action](command, signal)]));
    return { ...h, chain, methods, request, controller: new AiOriginalOrderReadController(methods) };
  };
  const h = await create(), cancel = { original: h.reference, expectedRevision: h.state.aiTask[0].revision };
  const missing = await h.controller.readCancellationReceipt(h.request, cancel);
  assert.equal(missing.receipt.status, 'not_observed'); assert.equal(missing.receipt.event, null);
  const receipt = await h.controller.requestCancel(h.request, cancel);
  assert.equal(receipt.receipt.event.taskRevision, cancel.expectedRevision + 1);
  const observed = await h.controller.readCancellationReceipt(h.request, cancel);
  assert.equal(observed.receipt.status, 'observed'); assert.equal(observed.receipt.remoteCancellation, 'not_attested');
  const settle = { original: h.reference, expectedRevision: h.state.aiTask[0].revision };
  assert.equal((await h.controller.readCancellationSettlementReceipt(h.request, settle)).receipt.status, 'not_observed');
  const settled = await h.controller.settleUnstartedCancellation(h.request, settle);
  assert.equal(settled.cancellation, 'unstarted_task_cancelled_not_business_rollback');
  const settlement = await h.controller.readCancellationSettlementReceipt(h.request, settle);
  assert.equal(settlement.receipt.event.data.to, 'cancelled');
  const { validateAiOrderReadResponse } = require('../apps/api/src/modules/ai-native/scenes/scene-observation-contracts');
  const contradictory = structuredClone(settlement); contradictory.receipt.snapshot.status = 'running';
  assert.throws(() => validateAiOrderReadResponse('readCancellationSettlementReceipt', contradictory, settle), error => error.code === 'AI_STORAGE_UNAVAILABLE');
  const later = structuredClone(observed); later.receipt.snapshot = structuredClone(settlement.receipt.snapshot);
  assert.doesNotThrow(() => validateAiOrderReadResponse('readCancellationReceipt', later, cancel));
  assert.equal(h.state.aiTask[0].status, 'CANCELLED'); assert.equal(h.execution.sent.length, 0);
  const signal = new AbortController(); signal.abort();
  assert.deepEqual(await h.chain.start(h.reference, signal.signal), { outcome: { kind: 'not_started', reason: 'host_aborted' } });

  const partial = await create(), priorWrite = partial.control.beforeWrite;
  const { AiTaskRunnerError } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.service');
  partial.control.beforeWrite = async (table, args, data) => {
    await priorWrite?.(table, args, data);
    if (table === 'aiTaskActionInput' && args.data?.toolCode === 'rental.order.explain') throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
  };
  await assert.rejects(partial.controller.start(partial.request, partial.reference), error => error.getStatus() === 503
    && error.getResponse().code === 'AI_STORAGE_UNAVAILABLE');
  const prefix = await partial.controller.readPreparation(partial.request, partial.reference);
  assert.equal(prefix.preparation.publishedInputs, 1); assert.deepEqual(prefix.preparation.missing, ['order_read']);
  const firstInput = partial.state.aiTaskActionInput[0].id;
  partial.control.beforeWrite = priorWrite;
  partial.execution.result.toolRequests = [{ contractVersion: shared.AI_CONTRACT_DRAFT_VERSION,
    toolCode: 'rental.order.explain', toolVersion: shared.AI_TOOL_DRAFT_VERSION, input: { orderId: 'order-a' } }];
  const resumed = await partial.controller.resumePrepared(partial.request, partial.reference);
  assert.equal(resumed.outcome.outcome.status, 'succeeded'); assert.equal(resumed.preparation, 'original_inputs_only');
  assert.equal(partial.state.aiTaskActionInput[0].id, firstInput);
  assert.equal(partial.execution.sent.length, 1); assert.equal(partial.state.aiTaskActionInput.length, 2);
  assert.equal(partial.state.aiTaskExecutionBudget.length, 1);

  const lost = await create(), lostCancel = { original: lost.reference, expectedRevision: lost.state.aiTask[0].revision };
  const originalWrite = lost.control.beforeWrite;
  lost.control.beforeWrite = async (table, args, data) => {
    await originalWrite?.(table, args, data);
    if (table === 'aiTaskEvent' && args.data?.payload?.data?.to === 'cancel_requested') lost.control.loseReply = true;
  };
  await assert.rejects(lost.controller.requestCancel(lost.request, lostCancel), error => error.getStatus() === 409
    && error.getResponse().nextAction === 'read_cancellation_receipt');
  lost.control.beforeWrite = originalWrite;
  assert.equal((await lost.controller.readCancellationReceipt(lost.request, lostCancel)).receipt.status, 'observed');
  assert.equal(lost.execution.sent.length, 0);

  const unknown = await create(); delete unknown.execution.result.usage;
  const started = await unknown.controller.start(unknown.request, unknown.reference);
  assert.equal(started.outcome.outcome.status, 'unknown'); assert.equal(unknown.execution.sent.length, 1);
  assert.equal((await unknown.controller.readOrderResult(unknown.request, unknown.reference)).result.status, 'candidate_not_executed');
  assert.equal((await unknown.controller.recover(unknown.request, unknown.reference)).outcome.outcome.status, 'unknown');
  const policy = unknown.state.aiTaskActionPolicy.find(row => row.operation === 'claim_recovery_run');
  unknown.state.aiTaskActionPolicy.push({ ...structuredClone(policy), operation: 'takeover_run' });
  unknown.state.operationLog = [];
  unknown.db.operationLog = { findFirst: async ({ where }) => structuredClone(unknown.state.operationLog
    .find(row => Object.entries(where).every(([key, value]) => (row[key] ?? null) === value)) ?? null) };
  const run = unknown.state.aiRun[0]; run.leaseOwnerId = 'interrupted-fixed-worker';
  run.leaseExpiresAt = new Date(unknown.dependencies.clock().getTime() + 10000);
  const takeover = { original: unknown.reference, expectedTaskRevision: unknown.state.aiTask[0].revision,
    expectedRunRevision: run.revision, expectedFencingToken: run.fencingToken.toFixed(0) };
  assert.equal((await unknown.controller.readTakeoverReceipt(unknown.request, takeover)).receipt.status, 'not_observed');
  const taken = await unknown.controller.takeover(unknown.request, takeover);
  assert.equal(taken.outcome.outcome.status, 'unknown'); assert.equal(taken.takeover, 'same_owner_recovery_only');
  const takeoverReceipt = await unknown.controller.readTakeoverReceipt(unknown.request, takeover);
  assert.equal(takeoverReceipt.receipt.status, 'observed'); assert.equal(takeoverReceipt.receipt.admission, 'not_granted');
  assert.equal(unknown.execution.sent.length, 1); assert.equal(unknown.state.aiGatewayInvocation.length, 1);
  const invalid = new AiOriginalOrderReadController({ ...h.methods,
    requestCancel: async () => ({ ...receipt, privatePayload: 'must-not-leak' }),
    readTakeoverReceipt: async () => ({ ...takeoverReceipt, receipt: { ...takeoverReceipt.receipt, recordedRunRevision: 1 } }) });
  await assert.rejects(invalid.requestCancel(h.request, cancel), error => error.getStatus() === 409
    && error.getResponse().code === 'AI_RESULT_UNKNOWN' && error.getResponse().nextAction === 'read_cancellation_receipt');
  await assert.rejects(invalid.readTakeoverReceipt(h.request, takeover), error => error.getStatus() === 503);
  assert.throws(() => h.controller.start(h.request, { ...h.reference, actor: 'forged' }), error => error.getStatus() === 400);
  assert.equal(unknown.execution.sent.length, 1);

  const { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document');
  const { aiLeafToOpenApi30 } = require('../apps/api/src/contracts/ai-leaf-openapi');
  const schemas = shared.AI_ORDER_READ_HTTP_SCHEMAS;
  contracts.checkClosed(schemas, OPENAPI_DOCUMENT.components.schemas);
  for (const [name, schema] of Object.entries(schemas)) assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], aiLeafToOpenApi30(schema, name));
  for (const [action, contract] of Object.entries(shared.AI_ORDER_READ_HTTP_CONTRACTS)) {
    const route = OPENAPI_DOCUMENT.paths[`/api/${shared.AI_SCENE_ORDER_READ_HTTP_DRAFT.basePath}/${shared.AI_SCENE_ORDER_READ_HTTP_DRAFT[action]}`].post;
    assert.equal(route.requestBody.content['application/json'].schema.$ref, `#/components/schemas/${contract.request}`);
    assert.equal(route.responses['200'].content['application/json'].schema.properties.data.$ref, `#/components/schemas/${contract.response}`);
    assert.equal(Reflect.getMetadata('path', AiOriginalOrderReadController.prototype[action]), shared.AI_SCENE_ORDER_READ_HTTP_DRAFT[action]);
  }
  assert.deepEqual(contracts.compileConsumer(`import type { AiOrderReadAnswerResponseDraft, AiOrderReadTakeoverReceiptDraft } from '../packages/shared/src';
    declare const answer: AiOrderReadAnswerResponseDraft;
    if (answer.result.status === 'available') { const amount: number | null = answer.result.facts.order.amounts.finalPayable; }
    declare const receipt: AiOrderReadTakeoverReceiptDraft;
    if (receipt.status === 'observed') { const revision: number = receipt.recordedRunRevision; }
    if (receipt.status === 'not_observed') {
      // @ts-expect-error absence cannot supply an acknowledged generation
      const revision: number = receipt.recordedRunRevision;
    }`), []);
});

test('extension HTTP preserves full Core pricing snapshots and read-only authority without redispatch', { timeout: 60000 }, async t => {
  const h = await setup(), { credentials, ...dependencies } = h.dependencies;
  const shared = require('@rental-os/shared'), { RentalCoreController } = require('../apps/api/src/modules/rental-core/rental-core.controller');
  const { composeRequestBoundOriginalScenes } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { validateAiExtensionPreviewResponse } = require('../apps/api/src/modules/ai-native/scenes/extension-preview-http.contract');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const tenantId = 'tenant_001', core = h.b.core, business = h.b.business;
  const ctx = { profile: core.getProfile(tenantId), category: await core.getWorkspaceCategory(tenantId), settings: core.getBusinessSettings(tenantId),
    groups: core.listItemGroups(tenantId), pricingGroups: core.listPricingGroups(tenantId), couponTemplates: core.listCouponTemplates(tenantId),
    locations: core.listLocations(tenantId), operators: core.listOperators(tenantId) };
  const startAt = new Date(Date.now() + 2 * 86400000).toISOString(), endAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const newEndAt = new Date(Date.now() + 4 * 86400000).toISOString(), group = h.b.group, location = h.b.location;
  const quote = await business.createQuote(tenantId, ctx, { customerType: 'personal', customerName: 'Synthetic extension',
    fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: location.id, startAt, endAt,
    lines: [{ itemGroupId: group.id, quantity: 1, pricingUnit: h.b.candidate.items[0].pricingUnit }] });
  quote.ruleSnapshot.extension = { enabled: true, forceImmediateWhenOverdue: true, pricingMode: 'original_total' };
  const row = require('./fixtures/ai-native/authorization-baseline.cjs').order({ tenantId, status: 'renting', startAt, endAt,
    quoteId: quote.id, ruleSnapshot: quote.ruleSnapshot, customerType: 'personal', fulfillmentMode: 'store_pickup_return',
    fulfillmentLocationId: location.id, lines: quote.request.lines.map((line, i) => ({ ...line, id: `line-${i}`, inventoryMode: group.inventoryMode,
      itemGroupName: group.name, amount: quote.rentalAmount })),
    reservations: [{ id: 'reservation-a', orderId: 'order-a', itemGroupId: group.id, locationId: location.id,
      quantity: 1, releasedQuantity: 0, status: 'confirmed', startAt, endAt }], depositAmount: quote.depositAmount, preAuthAmount: quote.preAuthAmount });
  h.b.facts.findOrder = async () => structuredClone(row);
  // The fact-store fixtures expose stock only; Core still decides availability
  // and performs the actual extension pricing. No DB/lock claim is made here.
  h.b.facts.listAssets = async () => [{ id: 'asset-extension', itemGroupId: group.id, locationId: location.id, status: 'available' }];
  h.b.facts.listStockBalances = async () => [{ itemGroupId: group.id, locationId: location.id, onHandQuantity: 10, maintenanceQuantity: 0 }];
  const coreController = new RentalCoreController(core, undefined, business);
  const requests = composeRequestBoundOriginalScenes({ ...dependencies, extensionPreview: coreController }, { enabled: true, audience: 'operator' });
  const http = new AiOriginalScenesController(requests), request = { headers: { authorization: (await credentials.current()).authorization } };
  const create = h.command(); create.input.question = 'next_steps';
  const original = await http.create(request, create), command = { ...h.ref(original.receipt.inputRef), expectedOrderVersion: row.updatedAt,
    extension: { newEndAt, memo: 'Synthetic read-only preview' } };
  const denied = (status, code) => e => e.getStatus() === status && e.getResponse().code === code;
  const permissions = [...h.b.h.identity.user.permissions];
  h.b.h.identity.user.permissions = permissions.filter(code => !['rental-os:order:extend', 'rental-os:order:operate'].includes(code));
  await assert.rejects(http.previewOrderExtension(request, command), denied(403, 'AI_ACCESS_DENIED'));
  h.b.h.identity.user.permissions = permissions; // Original operator fallback remains valid.
  const factsBefore = h.b.facts.writes.length, businessBefore = h.b.businessFacts.writes.length;
  const result = await http.previewOrderExtension(request, command);
  assert.equal(result.result.status, 'previewed', JSON.stringify(result));
  assert.equal(result.taskExecution, 'not_started'); assert.equal(result.result.inventory, 'not_reserved');
  const preview = result.result.preview;
  assert.equal(preview.pricingSnapshot.method, 'original_version_difference');
  assert.ok(preview.pricingSnapshot.context.calendars.length > 0);
  assert.equal(result.result.source.inputFingerprint, requestFingerprint(command.extension));
  assert.equal(h.b.facts.writes.length, factsBefore); assert.equal(h.b.businessFacts.writes.length, businessBefore);
  assert.equal(h.state.aiStep.length, 0); assert.equal(h.state.aiRun[0].status, 'QUEUED');
  const offsetCommand = { ...command, extension: { newEndAt: newEndAt.replace('Z', '+00:00') } };
  assert.equal((await http.previewOrderExtension(request, offsetCommand)).result.status, 'previewed');
  const signed = structuredClone(result);
  signed.result.preview.depositDelta = -0.25; signed.result.preview.preAuthDelta = -1.5;
  signed.result.preview.pricingSnapshot.differenceAmount = -2.75;
  signed.result.preview.chargeLines.push({ code: 'synthetic-refund', name: 'Core difference', type: 'early_return_refund', amount: -2.75 });
  assert.deepEqual(validateAiExtensionPreviewResponse(signed, command), signed);
  // Explicit wire fixtures exercise optional historical branches not present in
  // the seeded quote. They assert preservation/closure, not executed business.
  const historical = structuredClone(result), priced = historical.result.preview;
  priced.executionBasis.categoryPolicySnapshot = structuredClone(ctx.category);
  priced.pricingSnapshot.context.dayRates = [{ id: 'rate-a', itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name,
    unit: 'day_24h', baseAmount: 10.25, weekendMultiplier: 1, holidayMultiplier: 2, depositAmount: 5, minimumUnits: 1,
    maxAmount: 0, usagePrecision: 2, tierMode: 'progressive', tiers: [{ minUnits: 1, unitAmount: 0.25 }],
    dayTypePrices: { workday: 1 }, periodicWindows: [{ fromWeekday: 1, fromTime: '09:00', toWeekday: 1, toTime: '18:00', multiplier: 1 }],
    datetimeOverrides: [{ id: 'price-override', start: startAt, end: endAt, multiplier: 1.5 }] }];
  priced.serviceSnapshots = [{ serviceId: 'service-a', serviceCode: 'SUPPORT', serviceName: 'Historical support', serviceType: 'support',
    serviceVersion: '1', workspaceId: 'workspace-a', billingUnit: 'per_order', selectionMode: 'optional', requiredByRule: false,
    unitPrice: 1.25, quantity: 1, billingUnits: 1, amount: 1.25, formula: '1.25 x 1', termsVersion: '1', terms: 'Original terms',
    eligibility: [{ rule: 'historical', passed: true }], insuredDisplayable: false, requiresCapacity: false,
    scheduledStartAt: startAt, scheduledEndAt: newEndAt, serviceLocationId: location.id, capacityQuantity: 1 }];
  priced.pricingSnapshot.discountEvaluations = [{ planSnapshot: { id: 'plan-a', tenantId, categoryCode: ctx.category.code, code: 'DISCOUNT', name: 'Original plan',
    status: 'enabled', discountType: 'fixed_amount', discountValue: 1, minimumSpend: 0, appliesTo: 'rental', customerScope: 'all',
    applicableItemGroupIds: [], applicableDayTypes: [], priority: 1, stackableWithOtherPlans: false, stackableWithCoupon: true,
    effectiveFrom: startAt, version: '1', createdAt: startAt, updatedAt: startAt }, planId: 'plan-a', planCode: 'DISCOUNT',
    planName: 'Original plan', planVersion: '1', workspaceId: 'workspace-a', appliesTo: 'rental', discountType: 'fixed_amount', priority: 1,
    stackableWithOtherPlans: false, stackableWithCoupon: true, applied: true, eligibility: [], grossAmount: 10, base: 10,
    formula: '10 - 1', candidateAmount: 1, discountAmount: 1, rentalAllocations: { 'line-0': 1 }, capped: false }];
  priced.pricingSnapshot.couponEvaluation = { couponId: 'coupon-a', templateId: 'template-a', templateCode: 'C', templateName: 'Historical coupon',
    templateVersion: '1', appliesTo: 'rental', discountType: 'fixed_amount', discountValue: 1, minimumSpend: 0,
    stackableWithDiscountPlans: true, checkedAt: startAt, rentalStartAt: startAt, baseBeforeDiscount: 10, runningBase: 9,
    formula: '9 - 1', discountAmount: 1, rentalAllocations: { 'line-0': 1 } };
  priced.pricingSnapshot.refundReview = { amount: 2.75, status: 'pending' };
  assert.deepEqual(validateAiExtensionPreviewResponse(historical, command), historical);
  const minimal = structuredClone(result);
  delete minimal.result.preview.pricingSnapshot; delete minimal.result.preview.executionBasis; delete minimal.result.preview.serviceSnapshots;
  assert.deepEqual(validateAiExtensionPreviewResponse(minimal, command), minimal);
  for (const change of [value => { value.original.inputRef = 'wrong'; }, value => { value.result.source.inputFingerprint = '0'.repeat(64); },
    value => { value.result.preview.chargeLines[0].credential = 'internal'; }, value => { value.result.preview.depositDelta = NaN; },
    value => { value.result.preview.pricingSnapshot.context.calendars[0].tenantId = 'other'; },
    value => { value.result.preview.newEndAt = endAt; }, value => { value.taskExecution = 'started'; }]) {
    const invalid = structuredClone(result); change(invalid);
    assert.throws(() => validateAiExtensionPreviewResponse(invalid, command), { code: 'AI_STORAGE_UNAVAILABLE' });
  }
  const corrupt = new AiOriginalScenesController({ ...requests, previewOrderExtension: async (_req, input) => {
    input.extension.newEndAt = endAt;
    return { ...result, result: { ...result.result, source: { ...result.result.source, inputFingerprint: requestFingerprint(input.extension) } } };
  } });
  await assert.rejects(corrupt.previewOrderExtension(request, command), denied(503, 'AI_STORAGE_UNAVAILABLE'));
  const raw = coreController.previewExtension.bind(coreController);
  const late = t.mock.method(coreController, 'previewExtension', async (...args) => { const value = await raw(...args); row.updatedAt = new Date().toISOString(); return value; });
  await assert.rejects(http.previewOrderExtension(request, command), denied(409, 'AI_REVISION_CONFLICT')); late.mock.restore();
  row.updatedAt = command.expectedOrderVersion;
  row.status = 'completed';
  const blocked = await http.previewOrderExtension(request, command);
  assert.equal(blocked.result.status, 'blocked'); assert.equal(blocked.result.coreStatus, 409); assert.equal(blocked.result.preview, undefined);
  row.status = 'renting';
  await assert.rejects(http.previewOrderExtension(request, { ...command, approved: true }), denied(400, 'AI_INVALID_INPUT'));
  const beforeDamaged = t.mock.method(coreController, 'previewExtension', async (...args) => ({ ...await raw(...args), credential: 'internal' }));
  await assert.rejects(http.previewOrderExtension(request, command), denied(503, 'AI_STORAGE_UNAVAILABLE')); beforeDamaged.mock.restore();
  const { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document');
  const route = OPENAPI_DOCUMENT.paths[`/api/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT.previewOrderExtension}`].post;
  assert.equal(route.responses['200'].content['application/json'].schema.properties.data.$ref, '#/components/schemas/AiSceneOrderExtensionPreviewResponseDraft');
  assert.deepEqual(require('./fixtures/ai-native/contract-consumer.cjs').compileConsumer(`
    import type { AiSceneOrderExtensionPreviewResponseDraft, RentalOrderExtensionPreview } from '../packages/shared/src';
    declare const response: AiSceneOrderExtensionPreviewResponseDraft;
    if (response.result.status === 'previewed') { const core: RentalOrderExtensionPreview = response.result.preview; }
    if (response.result.status === 'blocked') {
      // @ts-expect-error Core refusal is not a price or business receipt
      const price: number = response.result.preview.payableAmount;
    }`), []);
  h.b.h.identity.session = false;
  await assert.rejects(http.previewOrderExtension(request, command), denied(403, 'AI_ACCESS_DENIED'));
  assert.equal(h.b.facts.writes.length, factsBefore); assert.equal(h.b.businessFacts.writes.length, businessBefore);
});

test('original policy HTTP contracts preserve current-row CAS and deny damaged responses without execution', { timeout: 60000 }, async () => {
  const h = await setup({ operationLog: [] }); h.b.h.identity.user.permissions.push('system:params:manage');
  const shared = require('@rental-os/shared'), { AiOriginalTaskActionPolicyController, AiScenePlanPolicyController } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
  const { composeRequestBoundOriginalTaskActionPolicies, composeRequestBoundScenePlanPolicies } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { originalPolicyRequest, originalPolicyResponse } = require('../apps/api/src/modules/ai-native/scenes/original-policy-http.contract');
  const { credentials, ...deps } = h.dependencies, request = { headers: { authorization: (await credentials.current()).authorization } };
  const created = await h.app.create(h.command()), original = h.ref(created.receipt.inputRef);
  const app = composeRequestBoundOriginalTaskActionPolicies(deps, { enabled: true, audience: 'operator', ttlMs: 120000,
    templates: [{ operation: 'read_metadata', requiredPermissions: ['rental-os:order:view'] }] });
  const http = new AiOriginalTaskActionPolicyController(app), read = { original, operation: 'read_metadata' };
  assert.equal((await http.read(request, read)).state, 'not_observed');
  const configured = await http.configure(request, { ...read, expectedRevision: null });
  assert.equal(configured.policy.revision, 1); assert.equal(configured.policy.taskId, created.task.taskId);
  assert.equal((await http.read(request, read)).policy.revision, 1);
  await assert.rejects(http.configure(request, { ...read, expectedRevision: null }), e => e.getStatus() === 409);
  await assert.rejects(http.configure(request, { ...read, expectedRevision: 1, permissions: ['forged'] }), e => e.getStatus() === 400);
  await assert.rejects(http.read(request, { ...read, operation: 'claim_run' }), e => e.getStatus() === 404);
  const revoked = await http.clear(request, { ...read, expectedRevision: 1 }); assert.equal(revoked.policy.revision, 2);
  assert.equal(revoked.semantics, 'new_task_actions_denied_not_remote_rollback');
  const damaged = new AiOriginalTaskActionPolicyController({ ...app, read: async () => ({ ...configured, state: 'observed', credential: 'hidden' }) });
  await assert.rejects(damaged.read(request, read), e => e.getStatus() === 503);
  const writeCommand = { ...read, expectedRevision: 2 };
  const altered = new AiOriginalTaskActionPolicyController({ ...app, configure: async (_request, value) => {
    value.original.inputRef = '00000000-0000-4000-8000-000000000002';
    return { ...configured, original: value.original, policy: { ...configured.policy, revision: 3 } };
  } });
  await assert.rejects(altered.configure(request, writeCommand), e => e.getStatus() === 409 && e.getResponse().code === 'AI_RESULT_UNKNOWN');
  assert.equal(writeCommand.original.inputRef, original.inputRef);
  const tools = ['ai.model.text', 'rental.order.explain'], limits = structuredClone(h.b.h.plan.limits);
  const planRow = h.state.aiTaskPlanPolicy.find(row => row.sceneCode === 'order_explanation');
  planRow.limits = limits; planRow.allowedTools = tools.map(code => ({ code, version: shared.AI_TOOL_DRAFT_VERSION }));
  const plans = composeRequestBoundScenePlanPolicies(deps, { enabled: true, audience: 'operator', scenes: [{ scene: { code: 'order_explanation', version: '1' }, tools }] });
  const planHttp = new AiScenePlanPolicyController(plans), key = { sceneCode: 'order_explanation' };
  assert.equal((await planHttp.read(request, key)).state, 'configured');
  const change = { ...key, change: { expectedRevision: 1, enabled: false, limits, expiresAt: '2027-01-01T00:00:00+00:00' } };
  const saved = await planHttp.change(request, change); assert.equal(saved.revision, 2); assert.equal(saved.enabled, false);
  assert.equal((await planHttp.read(request, key)).revision, 2); assert.equal(h.state.operationLog.length, 1);
  await assert.rejects(planHttp.change(request, change), e => e.getStatus() === 409);
  await assert.rejects(planHttp.change(request, { ...change, change: { ...change.change, limits: { ...limits, maxStepMs: limits.maxTotalMs + 1 } } }), e => e.getStatus() === 400);
  for (const patch of [{ tenantId: 'another' }, { tools: ['sql'] }, { sceneCode: 'unknown' }])
    await assert.rejects(planHttp.read(request, { ...key, ...patch }), e => e.getStatus() === 400);
  assert.throws(() => originalPolicyResponse('planChange', { ...saved, revision: 3 }, change), { code: 'AI_RESULT_UNKNOWN' });
  assert.throws(() => originalPolicyRequest('taskRead', { ...read, approved: true }), { code: 'AI_INVALID_INPUT' });
  const { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document'), f = require('./fixtures/ai-native/contract-consumer.cjs');
  const { aiLeafToOpenApi30 } = require('../apps/api/src/contracts/ai-leaf-openapi');
  f.checkClosed(shared.AI_ORIGINAL_POLICY_HTTP_SCHEMAS, OPENAPI_DOCUMENT.components.schemas);
  for (const [name, schema] of Object.entries(shared.AI_ORIGINAL_POLICY_HTTP_SCHEMAS)) assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], aiLeafToOpenApi30(schema, name));
  assert.deepEqual(f.compileConsumer(`import type { AiOriginalTaskPolicyReadResponseDraft, AiOriginalScenePlanReadResponseDraft } from '../packages/shared/src';
    declare const policy: AiOriginalTaskPolicyReadResponseDraft;
    if (policy.state === 'observed') { const id: string = policy.policy.taskId; }
    else { const absent: null = policy.policy; }
    declare const plan: AiOriginalScenePlanReadResponseDraft;
    // @ts-expect-error policy observation cannot authorize model dispatch
    const dispatch: true = plan.taskActionPolicy;`), []);
  h.b.h.identity.session = false; await assert.rejects(http.read(request, read), e => e.getStatus() === 403);
  assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiStep.length, 0);
});

test('conversation metadata and original admission share CAS, owner scope and immutable recovery', { timeout: 60000 }, async () => {
  const h = await setup({ aiConversation: [], aiConversationTurn: [], aiConversationOperation: [], aiTaskExecutionCharge: [],
    aiApprovalConsumption: [], aiGatewayInvocation: [], aiBudgetReservation: [], aiInvocationAdmission: [], aiUsageReservation: [] });
  const { AiConversationRepository } = require('../apps/api/src/modules/ai-native/conversation.repository');
  const { AI_CONVERSATION_DRAFT_VERSION: draftVersion } = require('@rental-os/shared');
  const app = new AiConversationRepository(h.dependencies, h.app.requests);
  const create = { draftVersion, operationKey: 'conversation-create-a', capabilityCode: 'order_explanation' };
  const created = await app.create(create), conversationId = created.conversationId;
  assert.equal((await app.create(create)).conversationId, conversationId); assert.equal(h.state.aiConversation.length, 1);
  assert.equal((await app.readOperation({ draftVersion, operationKey: create.operationKey })).revision, 1);
  assert.equal((await app.readOperation({ draftVersion, operationKey: 'absent' })).status, 'not_observed');
  await assert.rejects(app.create({ ...create, actor: 'forged' }), { code: 'AI_INVALID_INPUT' });
  await assert.rejects(app.create({ ...create, capabilityCode: 'opening_diagnosis' }), { code: 'AI_REVISION_CONFLICT' });
  const ref = { draftVersion, conversationId }, body = { sceneCode: 'order_explanation', input: { orderId: 'order-a', question: 'status' } };
  const command = { ...ref, expectedRevision: 1, admissionKey: 'message-a', request: body };
  const accepted = await app.admit(command);
  assert.equal(accepted.result.status, 'original_bound'); assert.equal(accepted.result.task, null);
  assert.equal(h.state.aiTaskOriginalRequest.length, 1); assert.equal(h.state.aiTask.length, 0);
  assert.equal((await app.admit(command)).result.turnId, accepted.result.turnId);
  await assert.rejects(app.admit({ ...command, expectedRevision: 2 }), { code: 'AI_REVISION_CONFLICT' });
  assert.equal((await app.read(ref)).currentTurn.turnId, accepted.result.turnId);
  const waiting = { ...ref, operationKey: 'release-a', expectedRevision: 2 };
  await assert.rejects(app.releaseTurn(waiting), { code: 'AI_RESOURCE_UNAVAILABLE' });
  await assert.rejects(app.admit({ ...command, expectedRevision: 2, admissionKey: 'message-b' }), { code: 'AI_REVISION_CONFLICT' });
  const task = await h.app.requests.createTask(accepted.result.original);
  await assert.rejects(app.releaseTurn(waiting), { code: 'AI_RESOURCE_UNAVAILABLE' });
  const taskRow = h.state.aiTask.find(row => row.id === task.taskId);
  taskRow.status = 'SUCCEEDED';
  h.state.aiTaskExecutionCharge.push({ scopeId: taskRow.scopeId, taskId: taskRow.id, status: 'UNKNOWN', chargeId: 'unresolved' });
  await assert.rejects(app.releaseTurn(waiting), { code: 'AI_RESOURCE_UNAVAILABLE' });
  h.state.aiTaskExecutionCharge[0].status = 'CONSUMED';
  h.state.aiGatewayInvocation.push({ scopeId: taskRow.scopeId, taskId: taskRow.id, callId: 'original-call' });
  h.state.aiInvocationAdmission.push({ tenantId: 'tenant_001', workspaceId: 'workspace-a', callId: 'original-call', status: 'unknown' });
  const priorRead = h.control.beforeRead;
  h.control.beforeRead = async (table, args, data) => {
    await priorRead?.(table, args, data);
    if (['aiInvocationAdmission', 'aiUsageReservation'].includes(table)) {
      assert.deepEqual(Object.keys(args.where).sort(), ['callId', 'status', 'tenantId', 'workspaceId']);
    }
  };
  await assert.rejects(app.releaseTurn(waiting), { code: 'AI_RESOURCE_UNAVAILABLE' });
  h.state.aiInvocationAdmission[0].status = 'completed';
  h.state.aiUsageReservation.push({ tenantId: 'tenant_001', workspaceId: 'workspace-a', callId: 'original-call', status: 'pending_reconciliation' });
  await assert.rejects(app.releaseTurn(waiting), { code: 'AI_RESOURCE_UNAVAILABLE' });
  h.state.aiUsageReservation[0].status = 'settled';
  const releases = await Promise.all([app.releaseTurn(waiting), app.releaseTurn(waiting)]);
  const release = releases[0]; assert.deepEqual(releases[1], release);
  h.control.beforeRead = priorRead; assert.equal(release.operation, 'release_turn'); assert.equal(release.revision, 3);
  assert.equal((await app.releaseTurn(waiting)).revision, 3);
  const next = { ...command, expectedRevision: 3, admissionKey: 'message-b' };
  const priorWrite = h.control.beforeWrite;
  h.control.beforeWrite = async (table, args, data) => { await priorWrite?.(table, args, data);
    if (table === 'aiConversationTurn') h.control.loseReply = true;
  };
  await assert.rejects(app.admit(next), { code: 'AI_RESULT_UNKNOWN' });
  h.control.beforeWrite = priorWrite;
  const recovered = await app.readAdmission({ ...ref, admissionKey: 'message-b' });
  assert.equal(recovered.result.status, 'original_bound'); assert.equal(h.state.aiTaskOriginalRequest.length, 2);
  assert.equal((await app.admit(next)).result.turnId, recovered.result.turnId);
  assert.equal(h.state.aiTaskOriginalRequest.length, 2);
  const page = await app.turns({ ...ref, limit: 1 }); assert.equal(page.items.length, 1); assert.ok(page.nextBeforeId);
  const summary = await app.list({ draftVersion, status: 'active', limit: 1 }); assert.equal(summary.items[0].conversationId, conversationId);
  const owner = h.b.h.identity.user.id; h.b.h.identity.user.id = 'another-operator';
  await assert.rejects(app.read(ref)); assert.equal((await app.list({ draftVersion, status: 'active', limit: 1 })).items.length, 0);
  h.b.h.identity.user.id = owner;
  const archived = await app.mutate({ ...ref, operationKey: 'archive-a', expectedRevision: 4 }, 'archive');
  assert.equal(archived.revision, 5); assert.equal((await app.read(ref)).status, 'archived');
  const tasksBefore = structuredClone(h.state.aiTask), originalCount = h.state.aiTaskOriginalRequest.length;
  const deleted = await app.mutate({ ...ref, operationKey: 'delete-a', expectedRevision: 5 }, 'delete');
  assert.equal(deleted.taskCancellation, 'not_requested'); await assert.rejects(app.read(ref), { code: 'AI_RESOURCE_UNAVAILABLE' });
  assert.deepEqual(h.state.aiTask, tasksBefore); assert.equal(h.state.aiTaskOriginalRequest.length, originalCount);
  assert.equal((await app.readOperation({ draftVersion, operationKey: 'delete-a' })).revision, 6);
  assert.deepEqual(await app.releaseTurn(waiting), release); // Exact receipt survives history deletion.
  assert.equal((await app.list({ draftVersion, status: 'active', limit: 20 })).items.length, 0);
  // Competing first messages: the losing original request rolls back together
  // with its conversation CAS. No orphan request or second automatic turn.
  const separate = await app.create({ ...create, operationKey: 'conversation-create-b' });
  const race = { ...command, conversationId: separate.conversationId, expectedRevision: 1 };
  const before = h.state.aiTaskOriginalRequest.length;
  const outcomes = await Promise.allSettled([app.admit({ ...race, admissionKey: 'race-a' }), app.admit({ ...race, admissionKey: 'race-b' })]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(h.state.aiTaskOriginalRequest.length, before + 1);
  // A transport can report a typed storage error AFTER the admission committed.
  // Keep it unknown too, then recover without creating another original request.
  const typed = await app.create({ ...create, operationKey: 'conversation-create-typed' });
  const typedCommand = { ...command, conversationId: typed.conversationId, admissionKey: 'typed-reply' };
  const originalTransaction = h.db.$transaction;
  let typedCommit = false;
  h.control.beforeWrite = async (table, args, data) => {
    await priorWrite?.(table, args, data);
    if (table === 'aiConversationTurn') typedCommit = true;
  };
  h.db.$transaction = async (...args) => {
    const result = await originalTransaction(...args);
    if (typedCommit) { typedCommit = false; throw new (require('../apps/api/src/modules/ai-native/ai-task.repository').AiTaskRepositoryError)('AI_STORAGE_UNAVAILABLE'); }
    return result;
  };
  await assert.rejects(app.admit(typedCommand), { code: 'AI_RESULT_UNKNOWN' });
  h.db.$transaction = originalTransaction; h.control.beforeWrite = priorWrite;
  assert.equal((await app.readAdmission({ ...ref, conversationId: typed.conversationId, admissionKey: typedCommand.admissionKey })).result.status, 'original_bound');
  const originalsAfterTyped = h.state.aiTaskOriginalRequest.length;
  assert.equal((await app.admit(typedCommand)).result.status, 'original_bound');
  assert.equal(h.state.aiTaskOriginalRequest.length, originalsAfterTyped);
  h.b.h.identity.session = false;
  await assert.rejects(app.list({ draftVersion, status: 'active', limit: 20 }), { code: 'AI_ACCESS_DENIED' });
});

test('conversation history reopens only attested erased locators under current task authority', { timeout: 60000 }, async () => {
  const h = await setup({ aiConversation: [], aiConversationTurn: [], aiConversationOperation: [], aiDataErasure: [],
    aiTaskExecutionCharge: [], aiApprovalConsumption: [], aiGatewayInvocation: [], aiBudgetReservation: [], aiInvocationAdmission: [], aiUsageReservation: [] });
  const shared = require('@rental-os/shared'), { AiConversationRepository } = require('../apps/api/src/modules/ai-native/conversation.repository');
  const { AiRetentionService } = require('../apps/api/src/modules/ai-native/privacy/retention.service');
  const { conversationResponse } = require('../apps/api/src/modules/ai-native/conversation-contract');
  const app = new AiConversationRepository(h.dependencies, h.app.requests), draftVersion = shared.AI_CONVERSATION_DRAFT_VERSION;
  await assert.rejects(app.create({ draftVersion: 'ain-conversation-draft-1', operationKey: 'legacy-create', capabilityCode: 'order_explanation' }), { code: 'AI_INVALID_INPUT' });
  const created = await app.create({ draftVersion, operationKey: 'retained-create', capabilityCode: 'order_explanation' });
  const ref = { draftVersion, conversationId: created.conversationId }, command = { ...ref, expectedRevision: 1, admissionKey: 'retained-message',
    request: { sceneCode: 'order_explanation', input: { orderId: 'order-a', question: 'status' } } };
  const accepted = await app.admit(command), original = accepted.result.original;
  assert.equal(accepted.result.material, 'retained'); assert.equal(accepted.result.task, null);
  const task = await h.app.requests.createTask(original), taskRow = h.state.aiTask.find(row => row.id === task.taskId);
  taskRow.status = 'SUCCEEDED';
  h.state.aiTaskActionPolicy.push({ scopeId: taskRow.scopeId, taskId: taskRow.id, operation: 'read_metadata', revision: 1,
    requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01T00:00:00Z') });
  h.b.h.identity.user.permissions.push('system:params:manage');
  h.b.h.control.now = new Date(h.b.h.control.now.getTime() + 31 * 86400000);
  const privacy = new AiRetentionService(h.db, h.dependencies.auth, h.dependencies.credentials, undefined, h.dependencies.clock);
  const erased = await privacy.erase('request', original.inputRef);
  assert.equal(erased.state, 'erased');
  const originalRow = h.state.aiTaskOriginalRequest.find(row => row.id === original.inputRef);
  assert.equal(originalRow.payload.retention, 'erased');
  await assert.rejects(h.app.requests.readHistorical(original), { code: 'AI_RESOURCE_UNAVAILABLE' });
  const before = require('./fixtures/ai-native/task-input-store.cjs').clone(h.state), opened = await app.read(ref), page = await app.turns({ ...ref, limit: 20 });
  assert.equal(opened.currentTurn.material, 'erased'); assert.deepEqual(opened.currentTurn.task, { taskId: task.taskId, runId: task.runId });
  const { AiConversationController, composeAiConversationRequests } = require('../apps/api/src/modules/ai-native/conversation.application');
  const { credentials, ...readDependencies } = h.dependencies;
  const readHttp = new AiConversationController(composeAiConversationRequests(readDependencies, true,
    { readModelResult: async () => { throw Error('erased material must not reach a body reader'); } }));
  const downgraded = await readHttp.modelResult({ headers: { authorization: (await credentials.current()).authorization } },
    { ...ref, admissionKey: command.admissionKey, resultId: 'unread-erased-result' });
  assert.equal(downgraded.status, 'material_erased'); assert.equal(downgraded.result, null);
  assert.doesNotThrow(() => conversationResponse('modelResult', downgraded, { ...ref, admissionKey: command.admissionKey, resultId: 'unread-erased-result' }));
  assert.equal(page.items[0].material, 'erased');
  assert.deepEqual((await app.readAdmission({ ...ref, admissionKey: command.admissionKey })).result, opened.currentTurn);
  assert.deepEqual((await app.admit(command)).result, opened.currentTurn, 'replay observes only the original erased locator');
  assert.deepEqual(h.state, before, 'history and replay do not write, recreate input, start a task or remove an erasure');
  assert.doesNotThrow(() => conversationResponse('read', opened, ref));
  assert.throws(() => conversationResponse('read', { ...opened, currentTurn: { ...opened.currentTurn, task: null } }, ref), { code: 'AI_STORAGE_UNAVAILABLE' });
  assert.throws(() => conversationResponse('read', { ...opened, currentTurn: { ...opened.currentTurn, request: command.request } }, ref), { code: 'AI_STORAGE_UNAVAILABLE' });
  const contracts = require('./fixtures/ai-native/contract-consumer.cjs'), { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document');
  const { aiLeafToOpenApi30 } = require('../apps/api/src/contracts/ai-leaf-openapi');
  contracts.checkClosed(shared.AI_CONVERSATION_SCHEMAS, OPENAPI_DOCUMENT.components.schemas);
  for (const [name, schema] of Object.entries(shared.AI_CONVERSATION_SCHEMAS))
    assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], aiLeafToOpenApi30(schema, name));
  assert.deepEqual(contracts.compileConsumer(`import type { AiConversationTurnObservationDraft } from '../packages/shared/src';
    declare const turn: AiConversationTurnObservationDraft;
    if (turn.material === 'erased') { const taskId: string = turn.task.taskId;
      // @ts-expect-error erased history exposes no recovered plaintext
      const request = turn.request;
    }
    // @ts-expect-error erased history needs a currently authorized original task locator
    const absent: AiConversationTurnObservationDraft = { ...turn, material: 'erased', task: null };`), []);
  const receipt = h.state.aiDataErasure[0];
  for (const [key, value] of [['state', 'unknown'], ['tenantId', 'another-tenant'], ['targetHash', '0'.repeat(64)]]) {
    const saved = receipt[key]; receipt[key] = value;
    await assert.rejects(app.read(ref)); receipt[key] = saved;
  }
  h.state.aiDataErasure.pop(); await assert.rejects(app.read(ref)); h.state.aiDataErasure.push(receipt);
  const policy = h.state.aiTaskActionPolicy[0]; policy.requiredPermissions = ['ungranted:permission'];
  await assert.rejects(app.read(ref), { code: 'AI_ACCESS_DENIED' }); policy.requiredPermissions = ['rental-os:order:view'];
  const currentTask = h.state.aiTask.find(row => row.id === task.taskId);
  currentTask.status = 'RUNNING'; await assert.rejects(app.read(ref)); currentTask.status = 'SUCCEEDED';
  const release = await app.releaseTurn({ ...ref, operationKey: 'retained-release', expectedRevision: 2 });
  assert.equal(release.revision, 3); assert.equal((await app.read(ref)).currentTurn, null);
  assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiTaskOriginalRequest.length, 1);
  assert.equal(originalRow.payload.retention, 'erased');
  h.b.h.identity.session = false; await assert.rejects(app.turns({ ...ref, limit: 20 }), { code: 'AI_ACCESS_DENIED' });
});

test('conversation standard provider and Controller preserve explicit admission and original unknown receipts', { timeout: 60000 }, async t => {
  const h = await setup({ aiConversation: [], aiConversationTurn: [], aiConversationOperation: [] });
  const { credentials, ...dependencies } = h.dependencies;
  const { AiConversationController, composeAiConversationRequests } = require('../apps/api/src/modules/ai-native/conversation.application');
  const { AI_NATIVE_CONVERSATION_PROVIDER } = require('../apps/api/src/modules/ai-native/ai-native-application.providers');
  const shared = require('@rental-os/shared'), { draftVersion } = { draftVersion: shared.AI_CONVERSATION_DRAFT_VERSION };
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  const create = { draftVersion, operationKey: 'http-create', capabilityCode: 'order_explanation' };
  const rejected = status => e => e.getStatus() === status && e.getResponse().retryable === false;
  const off = new AiConversationController(AI_NATIVE_CONVERSATION_PROVIDER.useFactory(...[]));
  await assert.rejects(off.create(request, create), rejected(404)); assert.equal(h.state.aiConversation.length, 0);
  const enabled = AI_NATIVE_CONVERSATION_PROVIDER.useFactory(h.db, dependencies.auth, dependencies.guard, dependencies.subscriptions,
    dependencies.core, dependencies.business, dependencies.reports, dependencies.memberships, undefined, { enabled: true });
  const http = new AiConversationController(enabled);
  const created = await http.create(request, create), ref = { draftVersion, conversationId: created.conversationId };
  const read = await http.read(request, ref); assert.equal(read.currentTurn, null);
  assert.equal((await http.list(request, { draftVersion, status: 'active', limit: 20 })).items.length, 1);
  const body = { sceneCode: 'order_explanation', input: { orderId: 'order-a', question: 'status' } };
  const command = { ...ref, expectedRevision: 1, admissionKey: 'http-message', request: body };
  const original = await http.admit(request, command);
  assert.equal(original.result.task, null); assert.equal(h.state.aiTask.length, 0);
  assert.equal((await http.admission(request, { ...ref, admissionKey: command.admissionKey })).result.turnId, original.result.turnId);
  assert.equal((await http.turns(request, { ...ref, limit: 20 })).items.length, 1);
  await assert.rejects(http.release(request, { ...ref, operationKey: 'release', expectedRevision: 2 }), rejected(404));
  const mutation = { ...ref, operationKey: 'archive', expectedRevision: 2 };
  const { AiConversationRepository } = require('../apps/api/src/modules/ai-native/conversation.repository');
  const originalMutate = AiConversationRepository.prototype.mutate;
  const damaged = t.mock.method(AiConversationRepository.prototype, 'mutate', async function(...args) {
    return { ...await originalMutate.apply(this, args), credential: 'internal' };
  });
  await assert.rejects(http.archive(request, mutation), e => e.getStatus() === 409 && e.getResponse().code === 'AI_RESULT_UNKNOWN'
    && e.getResponse().nextAction === 'read_original_operation');
  damaged.mock.restore();
  const { conversationResponse } = require('../apps/api/src/modules/ai-native/conversation-contract');
  const absent = { draftVersion, operationKey: mutation.operationKey, retryable: false, status: 'not_observed',
    nextAction: 'read_original_operation', absence: 'not_proof_of_no_commit' };
  assert.throws(() => conversationResponse('archive', absent, mutation), { code: 'AI_RESULT_UNKNOWN' });
  assert.throws(() => conversationResponse('admit', { ...original, result: null }, command), { code: 'AI_RESULT_UNKNOWN' });
  assert.doesNotThrow(() => conversationResponse('admission', { ...original, result: null }, { ...ref, admissionKey: command.admissionKey }));
  assert.equal((await http.operation(request, { draftVersion, operationKey: 'archive' })).revision, 3);
  assert.equal((await http.read(request, ref)).status, 'archived');
  const erase = await http.delete(request, { ...ref, operationKey: 'delete', expectedRevision: 3 });
  assert.equal(erase.taskCancellation, 'not_requested'); assert.equal(h.state.aiTaskOriginalRequest.length, 1);
  const before = h.state.aiConversation.length;
  await assert.rejects(http.create(request, { ...create, operationKey: 'new', actor: 'forged' }), rejected(400));
  await assert.rejects(http.create({ ...request, aborted: true }, { ...create, operationKey: 'aborted' }));
  assert.equal(h.state.aiConversation.length, before);
  const { requiredPermissions } = require('../apps/api/src/common/api-auth.guard'), { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document');
  for (const [action, contract] of Object.entries(shared.AI_CONVERSATION_HTTP_DRAFT.operations)) {
    const path = `/${shared.AI_CONVERSATION_HTTP_DRAFT.basePath}/${action}`;
    assert.deepEqual(requiredPermissions('POST', path), [...shared.AI_TASK_CENTER_ENTRY_PERMISSIONS]);
    const route = OPENAPI_DOCUMENT.paths[`/api${path}`].post;
    assert.equal(route.requestBody.content['application/json'].schema.$ref, `#/components/schemas/${contract.request}`);
    assert.equal(route.responses['200'].content['application/json'].schema.properties.data.$ref, `#/components/schemas/${contract.response}`);
    assert.equal(Reflect.getMetadata('path', AiConversationController.prototype[action]), action);
  }
  const appSource = require('node:fs').readFileSync(path.join(__dirname, '../apps/api/src/app.module.ts'), 'utf8');
  assert.match(appSource, /\n\s+AiConversationController,/u); assert.match(appSource, /\n\s+AI_NATIVE_CONVERSATION_PROVIDER,/u);
  await assert.rejects(composeAiConversationRequests({ ...dependencies, credentials }, true).consume(request, 'create', create), { code: 'AI_RESOURCE_UNAVAILABLE' });
  h.b.h.identity.session = false;
  await assert.rejects(http.operation(request, { draftVersion, operationKey: 'delete' }), rejected(403));
});

test('opt-in module is inert; strict controller uses current authority without starting HTTP', async () => {
  const h = await setup(), before = h.trace.length;
  const noHttp = AiOriginalScenesModule.register(h.dependencies);
  assert.equal(noHttp.controllers, undefined); assert.deepEqual(noHttp.exports, [AI_ORIGINAL_SCENES]);
  const { credentials, ...dependencies } = h.dependencies;
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  const options = { enabled: true, audience: 'operator' };
  const module = AiOriginalScenesModule.registerHttp(dependencies, options), controller = new AiOriginalScenesController(module.providers[0].useFactory());
  assert.throws(() => AiOriginalScenesModule.registerHttp(h.dependencies, options).providers[0].useFactory(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.throws(() => AiOriginalScenesModule.registerHttp(dependencies, { ...options, enabled: false }).providers[0].useFactory(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.trace.length, before); assert.deepEqual(module.controllers, [AiOriginalScenesController]);
  for (const method of ['create', 'read', 'reissue', 'reconcile', 'reconcileReissue', 'createTask', 'material', 'recovery']) {
    assert.equal(Reflect.getMetadata('path', AiOriginalScenesController.prototype[method]), AI_SCENE_REQUEST_HTTP_DRAFT[method] || '/');
  }
  await assert.rejects(controller.create(request, { ...h.command(), actor: 'forged' }), e => e.getStatus() === 400 && e.getResponse().code === 'AI_INVALID_INPUT');
  const result = await controller.create(request, h.command()); assert.equal(result.stage, 'task_metadata_created');
  await assert.rejects(controller.read({ headers: {} }, h.ref(result.receipt.inputRef)), e => e.getStatus() === 403);
  const loaded = await controller.read(request, h.ref(result.receipt.inputRef));
  assert.equal(loaded.receipt.inputRef, result.receipt.inputRef);
  h.b.h.identity.session = false;
  await assert.rejects(controller.read(request, h.ref(result.receipt.inputRef)), e => e.getStatus() === 403 && e.getResponse().code === 'AI_ACCESS_DENIED');
});

test('request-bound business consumers reopen original citations and prepare only selected opening sections', async () => {
  const h = await setup(), { credentials, ...dependencies } = h.dependencies;
  const { composeRequestBoundOriginalScenes } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const app = composeRequestBoundOriginalScenes(dependencies, { enabled: true, audience: 'operator' });
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  const created = await app.create(request, h.command());
  const ref = h.ref(created.receipt.inputRef), packet = await app.prepareTaskMaterial(request, ref);
  const citation = { ...ref, version: packet.material.payload.orderVersion, field: 'order' };
  const opened = await app.reopenOrderCitation(request, citation);
  assert.equal(opened.source.status, 'available'); assert.equal(opened.execution, 'not_attempted');
  assert.equal(opened.source.orderId, 'order-a');
  await assert.rejects(app.reopenOrderCitation(request, { ...citation, scope: { kind: 'platform' } }), e => e.code === 'AI_INVALID_INPUT');
  const opening = await app.create(request, h.command('opening_diagnosis', 'opening-consumer'));
  const material = await app.prepareTaskMaterial(request, h.ref(opening.receipt.inputRef));
  const section = await app.readOpeningSection(request, { ...h.ref(opening.receipt.inputRef), key: 'item_groups' });
  assert.equal(section.section.key, 'item_groups'); assert.equal(section.execution, 'not_attempted');
  await assert.rejects(app.readOpeningSection(request, { ...h.ref(opening.receipt.inputRef), key: 'workspace_profile' }), e => e.code === 'AI_ACCESS_DENIED');
  const command = { ...h.ref(opening.receipt.inputRef), sections: [{ key: 'item_groups',
    expectedVersion: material.material.configVersion, changes: [{ field: 'itemLabel', value: '合成器材' }] }] };
  const prepared = await app.prepareOpeningSections(request, command);
  assert.equal(prepared.publication, 'not_attempted');
  assert.equal(prepared.proposalPersistence, 'unavailable_no_formal_section_proposal_port');
  assert.ok(Object.isFrozen(prepared));
  await assert.rejects(app.prepareOpeningSections(request, { ...command, sections: [{ ...command.sections[0], key: 'payment' }] }), e => e.code === 'AI_ACCESS_DENIED');
  h.b.h.identity.session = false;
  await assert.rejects(app.reopenOrderCitation(request, citation), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.aiRun.length, 2, 'only initial metadata runs, reads do not execute');
  assert.equal(h.state.aiStep.length, 0, 'business consumers never start a model step');
});

test('original quote review consumes revised formal requests without saving a quote or granting confirmation', async () => {
  const h = await setup(), { credentials, ...dependencies } = h.dependencies;
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  const module = AiOriginalScenesModule.registerHttp(dependencies, { enabled: true, audience: 'operator' });
  const controller = new AiOriginalScenesController(module.providers[0].useFactory());
  assert.equal(Reflect.getMetadata('path', AiOriginalScenesController.prototype.quoteReview), AI_SCENE_REQUEST_HTTP_DRAFT.quoteReview);
  assert.equal(Reflect.getMetadata('path', AiOriginalScenesController.prototype.quoteConfirm), AI_SCENE_REQUEST_HTTP_DRAFT.quoteConfirm);
  assert.equal(Reflect.getMetadata('path', AiOriginalScenesController.prototype.quoteReceipt), AI_SCENE_REQUEST_HTTP_DRAFT.quoteReceipt);
  let quoteWrites = 0;
  const createQuote = h.b.business.createQuote.bind(h.b.business);
  h.b.business.createQuote = (...args) => { quoteWrites++; return createQuote(...args); };
  const first = await controller.create(request, h.command('quote_clarification'));
  const read = await controller.quoteReview(request, h.ref(first.receipt.inputRef));
  assert.equal(read.facts.status, 'missing_input');
  assert.equal(read.facts.next, 'clarify_input');
  const candidate = { ...h.b.candidate, locationId: h.b.location.id, items: [{ ...h.b.candidate.items[0], itemGroupId: h.b.group.id, quantity: 1 }] };
  const revised = await controller.reissue(request, { ...h.command('quote_clarification', 'quote-revised'),
    previousInputRef: first.receipt.inputRef, input: { candidate } });
  const unconfirmed = await controller.quoteReview(request, h.ref(revised.receipt.inputRef));
  assert.deepEqual(unconfirmed.facts.missingFields, ['selectionRevision'], JSON.stringify(unconfirmed));
  const confirmedParameters = await controller.reissue(request, { ...h.command('quote_clarification', 'quote-selected-parameters'),
    previousInputRef: revised.receipt.inputRef,
    input: { candidate: { ...candidate, selectionRevision: unconfirmed.facts.selectionRevision } } });
  const unavailable = await controller.quoteReview(request, h.ref(confirmedParameters.receipt.inputRef));
  assert.equal(unavailable.facts.status, 'unavailable');
  assert.equal(unavailable.facts.reason, 'current_availability_insufficient');
  // Supply a database-execution substitute row; availability is still decided
  // by the real guarded Core reader, not a fake ready preparation response.
  h.b.facts.listAssets = async () => [{ id: 'synthetic-review-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a',
    itemGroupId: h.b.group.id, locationId: h.b.location.id, status: 'available' }];
  const prepared = await controller.quoteReview(request, h.ref(confirmedParameters.receipt.inputRef));
  assert.equal(prepared.facts.status, 'ready');
  assert.equal(prepared.sources.status, 'prepared_input_sources');
  assert.equal(prepared.facts.selectionRevision, prepared.sources.selectionRevision);
  assert.ok(prepared.sources.fields.every(field => field.confirmed === false));
  assert.equal(prepared.quotePersistence, 'not_attempted');
  assert.equal(prepared.humanSelection, 'not_attested');
  assert.equal(prepared.orderApproval, 'not_granted');
  assert.equal(quoteWrites, 0);
  const confirmation = { ...h.ref(confirmedParameters.receipt.inputRef), selectionRevision: prepared.facts.selectionRevision,
    inputFingerprint: prepared.sources.inputFingerprint, confirmQuote: true };
  assert.equal(ajv.compile(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneQuoteConfirmDraft)(confirmation), true);
  await assert.rejects(controller.quoteConfirm(request, { ...confirmation, confirmQuote: false }), e => e.getStatus() === 400);
  await assert.rejects(controller.quoteReceipt({ headers: {} }, { ...confirmation, confirmQuote: undefined }), e => e.getStatus() === 403);
  assert.equal((await controller.read(request, h.ref(first.receipt.inputRef))).request.input.candidate.customerId, undefined);
  assert.equal(confirmedParameters.receipt.previousInputRef, revised.receipt.inputRef);
  await assert.rejects(controller.quoteReview(request, { ...h.ref(first.receipt.inputRef), candidate: h.b.candidate }), e => e.getStatus() === 400);
  h.b.h.identity.session = false;
  await assert.rejects(controller.quoteReview(request, h.ref(confirmedParameters.receipt.inputRef)), e => e.getStatus() === 403);
  assert.equal(quoteWrites, 0);
});

test('request-bound original scenes snapshot commands and never borrow concurrent or ambient identity', { timeout: 30000 }, async () => {
  const h = await setup(), { credentials, ...dependencies } = h.dependencies;
  const { composeRequestBoundOriginalScenes } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const app = composeRequestBoundOriginalScenes(dependencies, { enabled: true, audience: 'operator' });
  const authorization = (await credentials.current()).authorization;
  const request = { headers: { authorization } }, command = h.command();
  let unblock, reached;
  const paused = new Promise(resolve => { reached = resolve; }), resume = new Promise(resolve => { unblock = resolve; });
  let intercepted = false;
  h.control.beforeRead = async table => {
    if (!intercepted && table === 'aiTaskOriginalRequest') { intercepted = true; reached(); await resume; }
  };
  const running = app.create(request, command);
  await paused;
  try {
    request.headers.authorization = 'Bearer replacement'; command.input.orderId = 'another-order';
    command.requestKey = 'mutated-key';
    await runWithRequestIdentity({ tenantId: 'tenant_001', workspaceId: 'workspace-a', userId: h.b.h.identity.user.id }, async () => {
      await assert.rejects(app.create({ headers: {} }, h.command('order_explanation', 'forbidden')), e => e.code === 'AI_ACCESS_DENIED');
      await assert.rejects(app.create({ headers: { authorization: 'Bearer invalid' } }, h.command()), e => e.code === 'AI_ACCESS_DENIED');
    });
  } finally { unblock(); }
  const created = await running;
  assert.equal(created.receipt.requestKey, 'original-a');
  assert.equal(h.state.aiTaskOriginalRequest[0].payload.orderId, 'order-a'); assert.equal(h.state.aiTask.length, 1);
  const beforeRead = h.control.beforeRead;
  h.control.beforeRead = async table => { await beforeRead(table); if (table === 'aiTaskOriginalRequest') h.b.h.identity.session = false; };
  await assert.rejects(app.read({ headers: { authorization } }, h.ref(created.receipt.inputRef)), e => e.code === 'AI_ACCESS_DENIED');
});

test('material handoff reauthorizes originals and contains facts, not stale unavailable preparation wrappers', async () => {
  const h = await setup(), shared = require('@rental-os/shared');
  // The original absorbing fact store lacks the formal bounded inspection
  // port. Supply an explicit empty synthetic page, not an unbounded fallback.
  h.b.facts.listInspectionsPage = async () => ({ items: [], nextCursor: null, coverage: 'page_not_total' });
  const { credentials, ...dependencies } = h.dependencies;
  const { composeRequestBoundOriginalScenes } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const contracts = require('./fixtures/ai-native/contract-consumer.cjs');
  const schemas = shared.AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS;
  const base = { ...shared.AI_SCOPE_DRAFT_SCHEMAS, ...shared.AI_SCENE_REQUEST_DRAFT_SCHEMAS };
  contracts.checkClosed(schemas, { ...base, ...schemas });
  const validators = contracts.validatorsFor(schemas, base);
  const app = composeRequestBoundOriginalScenes(dependencies, { enabled: true, audience: 'operator' });
  const controller = new AiOriginalScenesController(app);
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  const { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document');
  const { aiLeafToOpenApi30 } = require('../apps/api/src/contracts/ai-leaf-openapi');
  const operation = OPENAPI_DOCUMENT.paths['/api/ai-native/scene-requests/material'].post;
  assert.equal(operation.requestBody.content['application/json'].schema.$ref, '#/components/schemas/AiSceneRequestReadDraft');
  assert.equal(operation.responses['201'].content['application/json'].schema.properties.data.$ref, '#/components/schemas/AiSceneTaskMaterialResponseDraft');
  for (const [name, schema] of Object.entries(schemas)) assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], aiLeafToOpenApi30(schema, name));
  const capabilities = schemas.AiOpeningBusinessMaterialDraft.properties.configuration.properties.fulfillment.properties.locations.items.properties.capabilities;
  const validCapabilities = contracts.validatorsFor({ Capabilities: capabilities }, {}).Capabilities;
  assert.equal(validCapabilities(['pickup', 'return', 'storage', 'delivery']), true);
  for (const value of [['execute'], ['pickup', 'pickup'], ['pickup', 'return', 'storage', 'delivery', 'execute']]) assert.equal(validCapabilities(value), false);
  assert.deepEqual(contracts.compileConsumer(`import type { AiSceneTaskMaterialResponseDraft, AiOrderExplanationMaterialDraft,
    AiOpeningBusinessMaterialDraft, AiSceneTaskReceiptDraft } from '../packages/shared/src';
    declare const order: AiOrderExplanationMaterialDraft;
    declare const task: AiSceneTaskReceiptDraft;
    declare const original: Extract<AiSceneTaskMaterialResponseDraft, { material: AiOpeningBusinessMaterialDraft }>['original'];
    // @ts-expect-error scene and material must describe the same original request
    const mismatch: AiSceneTaskMaterialResponseDraft = { original, material: order, materialHash: 'a'.repeat(64),
      trust: 'source_text_is_data_not_instructions', task, model: 'not_called', plan: 'requires_host_plan_start' };`), []);
  const cases = ['status', 'fees', 'payments', 'next_steps'].map(question => ({ scene: 'order_explanation', question }));
  cases.push({ scene: 'opening_diagnosis' }, { scene: 'quote_clarification' });
  let originalPacket;
  for (const { scene, question } of cases) {
    const command = h.command(scene, `material-${scene}-${question ?? 'selected'}`);
    if (question) command.input.question = question;
    let created;
    try { created = await controller.create(request, command); }
    catch (error) { error.message = `${scene}/${question ?? 'selected'}: ${JSON.stringify(error.getResponse?.())}`; throw error; }
    const reference = h.ref(created.receipt.inputRef);
    const packet = await controller.material(request, reference);
    const internal = await h.app.prepareTaskMaterial(reference);
    assert.ok(Object.isFrozen(internal.material));
    assert.equal(validators.AiSceneTaskMaterialResponseDraft(packet), true, JSON.stringify(validators.AiSceneTaskMaterialResponseDraft.errors));
    assert.equal(packet.original.inputRef, created.receipt.inputRef); assert.equal(packet.task.taskId, created.task.taskId);
    assert.equal(packet.original.sceneCode, scene);
    assert.equal(packet.plan, 'requires_host_plan_start'); assert.equal(packet.model, 'not_called');
    assert.equal(packet.materialHash, requestFingerprint(packet.material));
    assert.equal(packet.material.task, undefined);
    if ('payload' in packet.material) {
      assert.equal(packet.material.payloadFingerprint, requestFingerprint(packet.material.payload));
      assert.equal(packet.material.payloadBytes, Buffer.byteLength(JSON.stringify(packet.material.payload), 'utf8'));
    }
    if (scene === 'opening_diagnosis') {
      assert.deepEqual(packet.material.sections.map(s => s.key), ['item_groups']);
      assert.equal(packet.material.configuration.pricing, undefined);
    }
    if (!originalPacket) originalPacket = packet;
  }
  const reference = h.ref(originalPacket.original.inputRef);
  for (const mutate of [packet => { packet.materialHash = 'b'.repeat(64); },
    packet => { packet.material.payloadBytes++; }, packet => { packet.material.payloadFingerprint = 'b'.repeat(64); },
    packet => { packet.original.sceneCode = 'opening_diagnosis'; },
    packet => { packet.material.payload.privateCredential = 'must-not-leak'; },
    packet => { packet.material.payload.gaps = Array(4).fill({ field: 'history', status: 'unavailable' }); }]) {
    const packet = structuredClone(originalPacket); mutate(packet);
    const corrupted = new AiOriginalScenesController({ ...app, prepareTaskMaterial: async () => packet });
    await assert.rejects(corrupted.material(request, reference), error => error.getStatus() === 503
      && error.getResponse().code === 'AI_STORAGE_UNAVAILABLE' && !JSON.stringify(error.getResponse()).includes('must-not-leak'));
  }
  assert.equal(h.state.aiStep.length, 0, 'material reads never start a model or business step');
  await assert.rejects(controller.material({ headers: {} }, reference), e => e.getStatus() === 403);
  const row = h.state.aiTaskOriginalRequest[0]; h.state.aiTaskPlanPolicy[0].enabled = false;
  await assert.rejects(h.app.prepareTaskMaterial(h.ref(row.id)), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(controller.material(request, reference), e => e.getStatus() === 404);
  assert.equal((await h.app.readTaskReceipt(row.id)).state, 'observed');
});

test('recovery reads original action IDs and observed results after cancel or AI shutdown, never dispatches', async () => {
  const h = await setup(), created = await h.app.create(h.command()), task = h.state.aiTask[0];
  h.state.aiTaskActionPolicy.push({ scopeId: task.scopeId, taskId: task.id, operation: 'read_metadata', revision: 1,
    requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') });
  h.state.aiStep.push({ id: 'step-unknown', taskId: task.id, runId: created.task.runId, actionId: 'original-action', status: 'UNKNOWN', effect: 'POSSIBLE', revision: 4, resultRef: 'receipt-unknown', createdAt: new Date(), secretBody: 'must-not-be-returned' },
    { id: 'step-known', taskId: task.id, runId: created.task.runId, actionId: 'committed-action', status: 'SUCCEEDED', effect: 'COMMITTED', revision: 3, resultRef: 'receipt-known', createdAt: new Date() });
  task.status = 'CANCELLED'; task.revision++;
  h.state.aiTaskPlanPolicy[0].enabled = false;
  const before = h.trace.filter(x => x.endsWith('.create')).length;
  const result = await h.app.readRecovery(h.ref(created.receipt.inputRef));
  assert.equal(recoveryValid(result), true, JSON.stringify(recoveryValid.errors));
  assert.equal(result.task.status, 'cancelled'); assert.equal(result.steps.length, 2); assert.equal(result.automaticExecution, false);
  assert.equal(result.steps.find(s => s.actionId === 'original-action').nextAction, 'reconcile_original_action');
  assert.equal(result.steps.find(s => s.actionId === 'committed-action').resultAvailable, true);
  assert.equal(JSON.stringify(result).includes('must-not-be-returned'), false);
  assert.equal(h.trace.filter(x => x.endsWith('.create')).length, before);
  h.state.aiTaskActionPolicy.length = 0;
  await assert.rejects(h.app.readRecovery(h.ref(created.receipt.inputRef)), e => e.code === 'AI_RESOURCE_UNAVAILABLE' || e.code === 'AI_ACCESS_DENIED');
});

test('empty metadata recovery does not create a task or infer a safe replay', async () => {
  const h = await setup(), saved = await h.app.requests.save(h.command());
  const result = await h.app.readRecovery(h.ref(saved.inputRef));
  assert.equal(recoveryValid(result), true); assert.equal(result.task.state, 'not_observed');
  assert.equal(result.task.retryable, false); assert.equal(h.state.aiTask.length, 0);
});

test('persisted scene model result is bound to its original input and current authorized facts', async () => {
  const shared = require('@rental-os/shared'), contracts = require('./fixtures/ai-native/contract-consumer.cjs');
  const { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document');
  const { aiLeafToOpenApi30 } = require('../apps/api/src/contracts/ai-leaf-openapi');
  for (const method of ['reopenModelSource', 'reopenOpeningModelSource']) {
    const contract = shared.AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS[method];
    const operation = OPENAPI_DOCUMENT.paths[`/api/${shared.AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${shared.AI_SCENE_MODEL_HTTP_DRAFT[method]}`].post;
    assert.equal(operation.requestBody.content['application/json'].schema.$ref, `#/components/schemas/${contract.request}`);
    assert.equal(operation.responses['200'].content['application/json'].schema.properties.data.$ref, `#/components/schemas/${contract.response}`);
  }
  const schemas = shared.AI_SCENE_MODEL_OBSERVATION_SCHEMAS;
  contracts.checkClosed(schemas, OPENAPI_DOCUMENT.components.schemas);
  for (const [name, schema] of Object.entries(schemas)) assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], aiLeafToOpenApi30(schema, name));
  assert.deepEqual(contracts.compileConsumer(`import type { AiSceneModelSourceReadResponseDraft, AiSceneOpeningModelSourceReadResponseDraft, AiConversationModelResultResponseDraft } from '../packages/shared/src';
    declare const conversation: AiConversationModelResultResponseDraft;
    if (conversation.status === 'observed') { const id: string = conversation.result.resultId; }
    else { const absent: null = conversation.result; const next: 'original_task_center' = conversation.nextAction; }
    // @ts-expect-error observation is never a model or business execution grant
    const execute: 'start' = conversation.execution;
    declare const source: AiSceneModelSourceReadResponseDraft;
    if (source.sourceKind === 'knowledge') { const text: string = source.source.text; }
    else if (source.source.status === 'available' && source.source.field === 'order') { const order: string = source.source.value.value.orderNo; }
    // @ts-expect-error source observation is never execution authority
    const executed: 'committed' = source.execution;
    declare const opening: AiSceneOpeningModelSourceReadResponseDraft;
    // @ts-expect-error frozen evidence does not contain a current observation time
    const current: string = opening.frozenBasis.reference.observedAt;`), []);
  const { AiOriginalSceneResultService } = require('../apps/api/src/modules/ai-native/scenes/original-scene-result.service');
  const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');
  const { taskModelIntent, taskModelIdentity, taskModelFingerprint, TASK_TEXT_MODEL_TOOL } = require('../apps/api/src/modules/ai-native/model-input/task-model-input');
  const { requestFingerprint: hash } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { AI_TOOL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  const sourceCases = ['status', 'fees', 'payments', 'next_steps'].map(question => ({ sceneCode: 'order_explanation', question }));
  sourceCases.push({ sceneCode: 'opening_diagnosis' }, { sceneCode: 'quote_clarification' });
  for (const { sceneCode, question } of sourceCases) {
  const h = await setup({ aiTaskResultArtifact: [], aiGatewayInvocation: [], aiTaskEvent: [], aiConversation: [], aiConversationTurn: [], aiConversationOperation: [] });
  h.b.facts.listInspectionsPage = async () => ({ items: [], nextCursor: null, coverage: 'page_not_total' });
  const originalCommand = h.command(sceneCode);
  if (question) originalCommand.input.question = question;
  const { AiConversationRepository } = require('../apps/api/src/modules/ai-native/conversation.repository');
  const conversations = new AiConversationRepository(h.dependencies, h.app.requests), conversationVersion = shared.AI_CONVERSATION_DRAFT_VERSION;
  const conversation = await conversations.create({ draftVersion: conversationVersion, operationKey: 'model-conversation', capabilityCode: sceneCode });
  const conversationReference = { draftVersion: conversationVersion, conversationId: conversation.conversationId, admissionKey: 'model-message' };
  const admitted = await conversations.admit({ ...conversationReference, expectedRevision: 1,
    request: { sceneCode: originalCommand.sceneCode, input: originalCommand.input } });
  const ref = admitted.result.original, created = { receipt: (await h.app.requests.readHistorical(ref)).receipt, task: await h.app.requests.createTask(ref) }, task = h.state.aiTask[0];
  const packet = await h.app.prepareTaskMaterial(ref), original = await h.app.requests.readHistorical(ref);
  const policy = { sceneCode, maxOutputTokens: 64 };
  const config = structuredClone(require('./fixtures/ai-native/gateway-contracts.cjs').config);
  config.tenantId = original.context.scope.tenantId; config.configurationScope.tenantId = config.tenantId;
  const input = { mode: 'invoke', intent: taskModelIntent(task.id, created.task.runId, `scene-model:${ref.inputRef}`, policy.sceneCode,
    { maxOutputTokens: 32, messages: [{ role: 'user', content: [{ kind: 'text', text: JSON.stringify({ original: packet.original,
      materialHash: packet.materialHash, trust: packet.trust, facts: packet.material }) }] }] }),
    configuration: config, priceVersion: 'price-1', routingHash: 'a'.repeat(64), identityHash: taskModelIdentity(original.context) };
  const fingerprint = taskModelFingerprint(input, policy), now = new Date(h.b.h.control.now);
  const payload = { ...structuredClone(require('./fixtures/ai-native/gateway-contracts.cjs').completed),
    requestId: input.intent.requestId, actual: config, text: 'Synthetic untrusted explanation' };
  h.state.aiTaskActionPolicy.push({ scopeId: task.scopeId, taskId: task.id, operation: 'read_step_terminal', revision: 1,
    requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') });
  h.state.aiStep.push({ scopeId: task.scopeId, taskId: task.id, runId: created.task.runId, id: 'model-step', actionId: 'model-action',
    inputRef: 'model-input', requestFingerprint: fingerprint, status: 'SUCCEEDED', resultRef: 'model-result',
    toolCode: TASK_TEXT_MODEL_TOOL, toolVersion: AI_TOOL_DRAFT_VERSION });
  h.state.aiTaskActionInput.push({ scopeId: task.scopeId, taskId: task.id, runId: created.task.runId, id: 'model-input',
    registrationRef: `scene-model:${ref.inputRef}`, toolCode: TASK_TEXT_MODEL_TOOL, toolVersion: AI_TOOL_DRAFT_VERSION, fingerprint, payload: input });
  h.state.aiGatewayInvocation.push({ scopeId: task.scopeId, taskId: task.id, runId: created.task.runId, stepId: 'model-step', actionId: 'model-action',
    actorId: task.ownerId, sceneCode: task.sceneCode, callId: input.intent.requestId, mode: 'invoke', stepFingerprint: fingerprint,
    intentHash: fingerprint, priceVersion: input.priceVersion, configurationHash: hash(config) });
  h.state.aiTaskResultArtifact.push({ scopeId: task.scopeId, taskId: task.id, runId: created.task.runId, stepId: 'model-step', actionId: 'model-action',
    id: 'model-result', stepFingerprint: fingerprint, outcome: 'SUCCEEDED', payload, contentHash: hash(payload), errorCode: null,
    outputBytes: BigInt(Buffer.byteLength(JSON.stringify(payload))), activeMs: 1n, completeMeasurement: true, createdAt: now });
  const tasks = composePersistedTaskAuthorization(h.dependencies).tasks;
  const reader = new AiOriginalSceneResultService(h.db, tasks, h.app, policy, h.dependencies.clock);
  const { composeAiTaskCenterScene } = require('../apps/api/src/modules/ai-native/task-center-scene.composition');
  const { AiTaskEventRepository } = require('../apps/api/src/modules/ai-native/ai-task-event.repository');
  const authorization = composePersistedTaskAuthorization(h.dependencies);
  h.state.aiTaskActionPolicy.push({ scopeId: task.scopeId, taskId: task.id, operation: 'read_events', revision: 1,
    requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') });
  h.state.aiTask[0].eventCursor = 9007199254740993n;
  h.state.aiTaskEvent.push({ scopeId: task.scopeId, taskId: task.id, cursor: 9007199254740993n, taskRevision: task.revision,
    type: 'task.output_ready', payload: { data: { resultId: 'model-result' } }, occurredAt: now });
  const center = composeAiTaskCenterScene({ list: { readPage: async () => { throw Error('not used'); } }, scenes: h.app, modelResults: reader,
    events: new AiTaskEventRepository(h.db, authorization.authority, h.dependencies.clock) });
  // Exercise the real task-center consumer, with current original/task
  // repositories intact; only the optional downstream host boundary is fake.
  await assert.rejects(center.readInput({ original: ref }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  let reviews = 0;
  const detail = composeAiTaskCenterScene({ list: { readPage: async () => { throw Error('not used'); } }, scenes: h.app,
    input: { read: async original => { assert.deepEqual(original, ref); return null; } },
    approvals: { readSelectedProposal: async () => { reviews++; throw Error('must not reach another task'); },
      readSelectedDecisionReceipt: async () => { throw Error('not used'); } } });
  assert.equal((await detail.readInput({ original: ref, taskId: task.id })).input, null);
  const another = { selection: { draftVersion: 'ain-quote-selection-draft-1', originalInputRef: ref.inputRef,
    selectionId: '00000000-0000-4000-8000-000000000001', taskId: '00000000-0000-4000-8000-000000000002', runId: created.task.runId, inputHash: 'a'.repeat(64) }, proposal: {} };
  await assert.rejects(detail.readApprovalReview({ original: ref, reference: another }), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(reviews, 0);
  const revoked = composeAiTaskCenterScene({ list: { readPage: async () => { throw Error('not used'); } }, scenes: h.app,
    input: { read: async () => { h.b.h.identity.session = false; return { stale: 'must not return' }; } } });
  await assert.rejects(revoked.readInput({ original: ref }), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  h.b.h.identity.session = true;
  const events = await center.readEvents({ original: ref, after: '9007199254740992', limit: 10 });
  assert.equal(events.nextCursor, '9007199254740993'); assert.equal(events.events[0].data.resultId, 'model-result');
  await assert.rejects(center.readEvents({ original: ref, after: 9007199254740992, limit: 10 }), e => e.code === 'AI_INVALID_INPUT');
  const command = { original: ref, resultId: 'model-result' };
  const result = await center.readModelResult(command);
  const { AiConversationController, composeAiConversationRequests } = require('../apps/api/src/modules/ai-native/conversation.application');
  const { AI_NATIVE_CONVERSATION_PROVIDER, AI_NATIVE_CONVERSATION_CONFIGURATION, AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER } = require('../apps/api/src/modules/ai-native/ai-native-application.providers');
  const { credentials, ...readDependencies } = h.dependencies, httpRequest = { headers: { authorization: (await credentials.current()).authorization } };
  const originalObservations = AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER.useFactory(h.db, readDependencies.auth, readDependencies.guard,
    readDependencies.subscriptions, readDependencies.core, readDependencies.business, readDependencies.reports, readDependencies.memberships, undefined);
  const conversationRequests = AI_NATIVE_CONVERSATION_PROVIDER.useFactory(h.db, readDependencies.auth, readDependencies.guard, readDependencies.subscriptions,
    readDependencies.core, readDependencies.business, readDependencies.reports, readDependencies.memberships, undefined, { enabled: true }, originalObservations);
  const conversationHttp = new AiConversationController(conversationRequests), query = { ...conversationReference, resultId: 'model-result' };
  const readState = require('./fixtures/ai-native/task-input-store.cjs').clone(h.state);
  const modelPacket = await conversationHttp.modelResult(httpRequest, query);
  assert.equal(modelPacket.status, 'observed');
  assert.ok(['available', 'stale'].includes(modelPacket.result.status));
  if (modelPacket.result.status === 'available') {
    assert.deepEqual(modelPacket.result.text, result.text); assert.equal(modelPacket.result.materialHash, result.materialHash);
  } else { assert.equal(modelPacket.result.text, null); assert.equal(modelPacket.result.nextAction, 'reread_facts'); }
  assert.equal(modelPacket.result.original.contentHash, result.original.contentHash); assert.equal(modelPacket.result.original.inputRef, ref.inputRef);
  assert.equal(modelPacket.result.runId, result.runId); assert.equal(modelPacket.result.sceneCode, result.sceneCode);
  if (sceneCode === 'order_explanation') assert.equal(modelPacket.result.status, 'available', 'new request IDs and observation times are not changed order facts');
  // Standard providers use the current clock; original quote availability can
  // become stale. The same-clock reader proves the available payload separately.
  const sameClock = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application').composeRequestBoundOriginalTaskRecoveryReaders(
    readDependencies, { enabled: true, audience: 'operator' }, { policy: { sceneCode, routeScene: 'chat', maxOutputTokens: 64 } });
  const sameClockHttp = new AiConversationController(composeAiConversationRequests(readDependencies, true, sameClock));
  const sameClockResult = (await sameClockHttp.modelResult(httpRequest, query)).result;
  assert.equal(sameClockResult.status, 'available'); assert.deepEqual(sameClockResult.text, result.text);
  const withoutReadEnvelope = value => {
    const copy = structuredClone(value);
    if (copy.facts?.payload?.facts?.history?.value) delete copy.facts.payload.facts.history.value.requestId;
    if (copy.facts) { delete copy.facts.payloadFingerprint; delete copy.facts.payloadBytes; }
    return copy;
  };
  assert.deepEqual(withoutReadEnvelope(sameClockResult), withoutReadEnvelope(result));
  assert.deepEqual(h.state, readState, 'conversation result reads never create artifacts, calls, budgets or tasks');
  if (sceneCode === 'order_explanation' && question === 'fees') {
    const findOrder = h.b.facts.findOrder;
    h.b.facts.findOrder = async (...args) => { const order = await findOrder(...args); return { ...order, pricingPlanVersion: 'changed-historical-price' }; };
    const changedHistory = (await sameClockHttp.modelResult(httpRequest, query)).result;
    assert.equal(changedHistory.status, 'stale'); assert.equal(changedHistory.text, null);
    h.b.facts.findOrder = findOrder;
  }
  assert.equal(modelPacket.execution, 'read_only_no_start_no_dispatch'); assert.equal(modelPacket.turn.task.taskId, task.id);
  const { conversationResponse } = require('../apps/api/src/modules/ai-native/conversation-contract');
  for (const corrupt of [value => { value.result.taskId = 'another-task'; }, value => { value.result.original.inputRef = '00000000-0000-4000-8000-000000000002'; },
    value => { value.result.resultId = 'another-result'; }, value => { value.result.credential = 'internal'; }, value => { value.turn.material = 'erased'; }]) {
    const damaged = structuredClone(modelPacket); corrupt(damaged);
    assert.throws(() => conversationResponse('modelResult', damaged, query), { code: 'AI_STORAGE_UNAVAILABLE' });
  }
  const noReader = new AiConversationController(composeAiConversationRequests(readDependencies, true));
  await assert.rejects(noReader.modelResult(httpRequest, query), e => e.getStatus() === 404);
  await assert.rejects(conversationHttp.modelResult(httpRequest, { ...query, reader: 'arbitrary' }), e => e.getStatus() === 400);
  const { AI_ORIGINAL_SCENE_RECOVERY_REQUESTS } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
  assert.ok(AI_NATIVE_CONVERSATION_PROVIDER.inject.some(item => item.token === AI_NATIVE_CONVERSATION_CONFIGURATION));
  assert.ok(AI_NATIVE_CONVERSATION_PROVIDER.inject.some(item => item.token === AI_ORIGINAL_SCENE_RECOVERY_REQUESTS && item.optional));
  const revokedRead = new AiConversationController(composeAiConversationRequests(readDependencies, true, { readModelResult: async () => {
    h.b.h.identity.session = false; return result;
  } }));
  await assert.rejects(revokedRead.modelResult(httpRequest, query), e => e.getStatus() === 403); h.b.h.identity.session = true;
  const { validateAiSceneModelObservation, AiOriginalSceneObservationController } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
  assert.deepEqual(validateAiSceneModelObservation(result), result);
  const observation = new AiOriginalSceneObservationController({ readModelResult: async () => center.readModelResult(command) });
  assert.deepEqual(await observation.readModelResult({ headers: {} }, command), result);
  for (const mutate of [value => { value.sceneCode = 'other'; }, value => { value.original.sceneCode = 'other'; },
    value => { value.privateCredential = 'must-not-leak'; }, value => { value.text.value = '汉'.repeat(50000); },
    value => { value.status = 'unknown'; }]) {
    const invalid = structuredClone(result); mutate(invalid);
    const corrupted = new AiOriginalSceneObservationController({ readModelResult: async () => invalid });
    await assert.rejects(corrupted.readModelResult({ headers: {} }, command), error => error.getStatus() === 503
      && error.getResponse().code === 'AI_STORAGE_UNAVAILABLE' && !JSON.stringify(error.getResponse()).includes('must-not-leak'));
  }
  assert.equal(result.status, 'available'); assert.equal(result.text.value, payload.text);
  assert.equal(result.sceneCode, sceneCode);
  if (sceneCode === 'order_explanation') {
  assert.equal(result.sources[0].field, 'order');
  if (question === 'fees') assert.ok(result.sources.some(source => source.field === 'rental_period'));
  if (question === 'payments') assert.ok(result.sources.some(source => source.field === 'amounts'));
  const sourceCommand = { ...command, sourceIndex: 0 };
  const reopened = await center.reopenModelSource(sourceCommand);
  assert.equal(reopened.reference.resourceId, 'order-a'); assert.equal(reopened.source.status, 'available');
  assert.equal(typeof reopened.source.value.value.orderNo, 'string', 'source retains the original full order projection');
  const sourceController = new AiOriginalSceneObservationController({ reopenModelSource: (_request, input) => center.reopenModelSource(input) });
  const { validateAiSceneSourceObservation } = require('../apps/api/src/modules/ai-native/scenes/scene-observation-contracts');
  assert.deepEqual(validateAiSceneSourceObservation(reopened, sourceCommand), reopened);
  assert.deepEqual(await sourceController.reopenModelSource({ headers: {} }, sourceCommand), reopened);
  assert.equal((await sourceController.reopenModelSource({ headers: {} }, { ...sourceCommand, sourceKind: 'order' })).sourceKind, undefined);
  // The source reader retains these declared states; fabricated fixtures here
  // prove wire discrimination only, not a real stale/optional-source race.
  for (const source of [{ status: 'stale', field: 'order', reason: 'order_version_changed_reread_material' },
    { status: 'missing', field: 'order', scope: reopened.reference.scope, orderId: 'order-a', reason: 'historical_or_optional_source_not_loaded' }]) {
    const value = { ...reopened, source };
    assert.deepEqual(validateAiSceneSourceObservation(value, sourceCommand), value);
  }
  for (const mutate of [value => { value.resultId = 'another-result'; }, value => { value.sourceIndex = 1; },
    value => { value.source.value.value.credential = 'must-not-leak'; }, value => { value.sourceKind = 'order'; },
    value => { value.source.field = 'amounts'; }, value => { value.source.orderId = 'another-order'; },
    value => { value.source.value.source.version = 'another-version'; }, value => { value.source.value.value.id = 'another-order'; }]) {
    const invalid = structuredClone(reopened); mutate(invalid);
    const corrupted = new AiOriginalSceneObservationController({ reopenModelSource: async () => invalid });
    await assert.rejects(corrupted.reopenModelSource({ headers: {} }, sourceCommand), error => error.getStatus() === 503
      && error.getResponse().code === 'AI_STORAGE_UNAVAILABLE' && !JSON.stringify(error.getResponse()).includes('must-not-leak'));
  }
  await assert.rejects(sourceController.reopenModelSource({ headers: {} }, { ...sourceCommand, sourceKind: 'url' }), error => error.getStatus() === 400);
  for (let sourceIndex = 1; sourceIndex < result.sources.length; sourceIndex++) {
    const query = { ...command, sourceIndex };
    const evidence = await sourceController.reopenModelSource({ headers: {} }, query);
    assert.equal(evidence.reference.field, result.sources[sourceIndex].field);
    assert.equal(evidence.source.field, evidence.reference.field);
    assert.deepEqual(validateAiSceneSourceObservation(evidence, query), evidence);
  }
  } else {
    assert.deepEqual(result.sources, []);
    if (sceneCode === 'opening_diagnosis') {
      assert.deepEqual(result.facts.sections.map(section => section.key), ['item_groups']);
      assert.equal(result.facts.configuration.pricing, undefined);
    } else {
      assert.equal(result.facts.payload.facts.status, 'missing_input');
      assert.equal(result.facts.payload.execution, 'not_attempted');
      assert.ok(result.facts.payload.facts.missingFields.length > 0);
    }
    await assert.rejects(center.reopenModelSource({ ...command, sourceIndex: 0 }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  }
  const absentIndex = result.sources.length < 5 ? result.sources.length : 5;
  await assert.rejects(center.reopenModelSource({ ...command, sourceIndex: absentIndex }),
    e => e.code === (absentIndex === 5 ? 'AI_INVALID_INPUT' : 'AI_RESOURCE_UNAVAILABLE'));
  await assert.rejects(center.reopenModelSource({ ...command, sourceIndex: 0, url: 'https://invalid.example' }), e => e.code === 'AI_INVALID_INPUT');
  assert.equal(JSON.stringify(result).includes('credential-test'), false);
  h.state.aiGatewayInvocation[0].actionId = 'another-call';
  await assert.rejects(reader.read(command), e => e.code === 'AI_ACCESS_DENIED');
  h.state.aiGatewayInvocation[0].actionId = 'model-action';
  h.state.aiTaskResultArtifact[0].outcome = 'UNKNOWN'; h.state.aiStep[0].status = 'UNKNOWN';
  const unknown = await reader.read(command); assert.equal(unknown.status, 'unknown'); assert.equal(unknown.text, null);
  assert.deepEqual(validateAiSceneModelObservation(unknown), unknown);
  const conversationUnknown = await sameClockHttp.modelResult(httpRequest, query);
  assert.equal(conversationUnknown.result.status, 'unknown'); assert.equal(conversationUnknown.result.automaticRetry, false);
  assert.equal(conversationUnknown.result.text, null);
  h.b.h.identity.session = false;
  await assert.rejects(reader.read(command), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  }
});

test('original model application uses the fixed commands and persisted evidence from QUEUED through result readback', async () => {
  const { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  for (const sceneCode of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) {
    const h = await originalModelApplicationHarness(sceneCode);
    assert.equal(h.execution.routeReads, 0); assert.equal(h.state.aiTaskRunPlan.length, 0);
    assert.equal(h.state.aiTask[0].status, 'QUEUED'); assert.equal(h.state.aiRun[0].status, 'QUEUED');
    assert.throws(() => h.model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, {}), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    assert.throws(() => h.model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, { financialEvidence: h.financial }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    await assert.rejects(h.app.start({ ...h.reference, holderId: 'forged' }), e => e.code === 'AI_INVALID_INPUT');
    const result = await h.app.start(h.reference);
    assert.equal(result.execution.kind, 'run_outcome'); assert.equal(result.execution.outcome.status, 'succeeded');
    assert.equal(result.businessExecution, 'not_inferred_from_model_result');
    assert.equal(h.state.aiStep[0].status, 'SUCCEEDED'); assert.equal(h.state.aiStep[0].effect, 'NONE');
    assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), '1'); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
    assert.equal(h.state.aiTaskActionInput.length, 1); assert.equal(h.state.aiTaskRunPlan.length, 1);
    assert.equal(h.execution.sent.length, 1); assert.equal(h.state.aiGatewayInvocation.length, 1);
    assert.equal(h.state.aiGatewayAccountingReceipt[0].state, 'dispatched');
    assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, true);
    assert.equal(h.state.aiTaskExecutionCharge.length, 4); assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
    const frozen = h.state.aiTaskActionInput[0].payload.intent.messages.find(message => message.role === 'user');
    const supplied = JSON.parse(frozen.content.map(part => part.text).join(''));
    assert.equal(supplied.original.inputRef, h.reference.inputRef);
    const read = await h.model.readModelResult({ original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id });
    assert.equal(read.status, 'available'); assert.equal(read.text.value, h.execution.result.text);
    const { composeAiTaskCenterScene } = require('../apps/api/src/modules/ai-native/task-center-scene.composition');
    const { composeAiOriginalScenes } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.composition');
    const { AiTaskEventRepository } = require('../apps/api/src/modules/ai-native/ai-task-event.repository');
    const center = composeAiTaskCenterScene({ list: { readPage: async () => { throw Error('not used'); } },
      scenes: composeAiOriginalScenes(h.dependencies), input: { read: value => h.app.readInput(value) },
      modelResults: { read: value => h.model.readModelResult(value) },
      events: new AiTaskEventRepository(h.db, h.model.runtime.authorization.authority, h.dependencies.clock) });
    const aggregateRequest = { kind: 'original', original: h.reference, taskId: h.state.aiTask[0].id,
      runId: h.state.aiRun[0].id, resultId: h.state.aiTaskResultArtifact[0].id };
    const aggregate = await center.readScene(aggregateRequest);
    const { validateAiTaskSceneObservation } = require('../apps/api/src/modules/ai-native/scenes/scene-observation-contracts');
    assert.deepEqual(validateAiTaskSceneObservation(aggregate), aggregate);
    assert.equal(aggregate.model.status, 'available'); assert.equal(aggregate.snapshot.availability, 'available');
    assert.equal(aggregate.originalInput.receipt.inputRef, h.reference.inputRef);
    assert.equal(aggregate.originalInput.request.sceneCode, sceneCode);
    assert.equal(typeof aggregate.snapshot.value.cursor, 'string'); assert.equal(aggregate.snapshot.value.taskId, aggregateRequest.taskId);
    assert.equal(aggregate.submission, 'not_attested_by_approval'); assert.equal(aggregate.business.availability, 'not_requested');
    assert.equal(aggregate.consistency, 'independent_authorized_reads'); assert.equal(h.execution.sent.length, 1);
    await assert.rejects(center.readScene({ ...aggregateRequest, runId: 'another-run' }), e => e.code === 'AI_ACCESS_DENIED');
    assert.deepEqual(await h.app.reconcile(h.reference), { kind: 'not_started', reason: 'recovery_lease_unavailable' });
    assert.equal(h.execution.sent.length, 1);
    const { AI_TASK_INPUT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
    await assert.rejects(h.app.resume({ original: h.reference, submission: { draftVersion: AI_TASK_INPUT_DRAFT_VERSION,
      taskId: 'another-task', requestId: 'input-request', expectedRevision: 1, submissionKey: 'answer-a',
      answers: [{ fieldId: 'clarification_text', value: 'Synthetic clarification' }] } }), e => e.code === 'AI_ACCESS_DENIED');
    h.b.h.identity.session = false;
    await assert.rejects(center.readScene(aggregateRequest), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
    await assert.rejects(h.app.readInput(h.reference), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  }
});

test('original scenes continue human clarification on the original task and read successive frozen results', { timeout: 30000 }, async () => {
  const { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const { AI_TASK_INPUT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  for (const sceneCode of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) {
    const h = await originalModelApplicationHarness(sceneCode);
    const contract = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, code: 'scene_clarification', version: '1',
      fields: [{ fieldId: 'clarification_text', kind: 'text', label: 'Clarification', required: true, maxLength: 100 }] };
    h.run.inputSource = {
      resolve: async binding => h.state.aiRun.find(r => r.id === binding.runId).sequence <= 2
        ? { kind: 'required', contract, inputRef: binding.inputRef, inputHash: binding.inputHash, expiresAt: '2027-01-01T00:00:00Z' }
        : { kind: 'not_required' },
      validateAnswers: async binding => ({ disposition: 'context_only', planHash: binding.planHash, inputRef: binding.inputRef, inputHash: binding.inputHash })
    };
    const host = () => h.model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, h.run);
    const started = await host().start(h.reference);
    assert.equal(started.execution.outcome.status, 'paused', JSON.stringify(started));
    const firstInput = structuredClone(h.state.aiTaskActionInput[0].payload);
    const budgetFingerprint = h.state.aiTaskExecutionBudget[0].policyFingerprint;
    for (let turn = 1; turn <= 2; turn++) {
      const pending = await host().readInput(h.reference);
      const submission = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: h.created.task.taskId,
        requestId: pending.requestId, expectedRevision: pending.revision, submissionKey: `scene-answer-${turn}`,
        answers: [{ fieldId: 'clarification_text', value: `Explicit answer ${turn}` }] };
      const resumed = await host().resume({ original: h.reference, submission });
      assert.equal(resumed.continuation.kind, 'run_outcome', JSON.stringify(resumed));
      assert.equal(resumed.continuation.outcome.status, turn === 1 ? 'paused' : 'succeeded');
      assert.equal((await host().resume({ original: h.reference, submission })).continuation.reason, 'receipt_replayed');
      const artifact = h.state.aiTaskResultArtifact.at(-1);
      const read = await h.model.readModelResult({ original: h.reference, resultId: artifact.id });
      assert.equal(read.status, 'available');
      assert.equal(read.text.value, h.execution.result.text);
      const { composeAiTaskCenterScene } = require('../apps/api/src/modules/ai-native/task-center-scene.composition');
      const { composeAiOriginalScenes } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.composition');
      const { AiTaskEventRepository } = require('../apps/api/src/modules/ai-native/ai-task-event.repository');
      const center = composeAiTaskCenterScene({ list: { readPage: async () => { throw Error('not used'); } },
        scenes: composeAiOriginalScenes(h.dependencies), input: { read: value => host().readInput(value) },
        modelResults: { read: value => h.model.readModelResult(value) },
        events: new AiTaskEventRepository(h.db, h.model.runtime.authorization.authority, h.dependencies.clock) });
      const request = { kind: 'original', original: h.reference, taskId: artifact.taskId, runId: artifact.runId, resultId: artifact.id };
      const count = h.execution.sent.length, aggregate = await center.readScene(request);
      assert.equal(aggregate.runId, artifact.runId);
      assert.equal(aggregate.originRunId, h.created.task.runId);
      assert.equal(aggregate.model.runId, artifact.runId);
      assert.equal(typeof aggregate.snapshot.value.cursor, 'string');
      assert.equal(h.execution.sent.length, count);
      await assert.rejects(center.readScene({ ...request, runId: h.created.task.runId }), e => e.code === 'AI_ACCESS_DENIED');
      await assert.rejects(center.readScene({ ...request, resultId: undefined }), e => e.code === 'AI_ACCESS_DENIED');
    }
    assert.equal(h.execution.sent.length, 3);
    assert.equal(h.state.aiTaskExecutionBudget.length, 1);
    assert.equal(h.state.aiTaskExecutionBudget[0].policyFingerprint, budgetFingerprint);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 3n);
    assert.deepEqual(h.state.aiTaskActionInput[0].payload, firstInput);
    assert.match(h.execution.sent.at(-1).messages.at(-1).content, /Explicit answer 2/);
    const last = h.state.aiRun.at(-1), origin = last.resourceOriginRunId;
    last.resourceOriginRunId = 'another-task-run';
    await assert.rejects(h.model.readModelResult({ original: h.reference, resultId: h.state.aiTaskResultArtifact.at(-1).id }), e => e.code === 'AI_ACCESS_DENIED');
    last.resourceOriginRunId = origin;
    h.b.h.identity.session = false;
    await assert.rejects(host().readInput(h.reference), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  }
});

test('original quote host uses persisted authorized clarification facts instead of an injected successful source', { timeout: 30000 }, async () => {
  const { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const { AI_TASK_INPUT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  const h = await originalModelApplicationHarness('quote_clarification');
  const host = () => h.model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, { ...h.run, inputSource: 'original_scene' });
  const started = await host().start(h.reference);
  assert.equal(started.execution.outcome.status, 'paused', JSON.stringify(started));
  let pending = await host().readInput(h.reference);
  assert.equal(pending.contract.code, 'original_quote_parameters');
  assert.ok(pending.contract.fields.some(f=>f.fieldId==='starts_at'));
  const fulfillment = pending.contract.fields.find(field => field.fieldId === 'fulfillment_selection');
  assert.ok(fulfillment, 'server-supported fulfillment modes must be offered as persisted choices');
  assert.ok(fulfillment.options.some(option => option.value === 'store_pickup_return'));
  const originalQuestion = structuredClone(pending), savedBudget = require('./fixtures/ai-native/task-input-store.cjs').clone(h.state.aiTaskExecutionBudget);
  const originalModelFingerprint = h.state.aiTaskActionInput[0].fingerprint;
  const settings = h.b.core.state('tenant_001').businessSettings;
  settings.configVersion = `${settings.configVersion}-changed`;
  await assert.rejects(host().readInput(h.reference));
  pending = await host().refreshInput({ original: h.reference, requestId: pending.requestId, expectedRevision: pending.revision });
  assert.equal(pending.revision, originalQuestion.revision + 1);
  assert.notEqual(pending.contract.version, originalQuestion.contract.version);
  assert.equal(h.state.aiRun.length, 1); assert.equal(h.execution.sent.length, 1);
  assert.deepEqual(h.state.aiTaskExecutionBudget, savedBudget);
  const submission = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: h.created.task.taskId,
    requestId: pending.requestId, expectedRevision: pending.revision, submissionKey: 'quote-context-answer',
    answers: pending.contract.fields.map(field=>({fieldId:field.fieldId,value:field.kind==='choice'?field.options[0].value
      :field.kind==='integer'?2:field.fieldId==='starts_at'?'2027-02-01T00:00:00.000Z'
      :field.fieldId==='ends_at'?'2027-02-02T00:00:00.000Z':'Please explain which absolute dates and product I need to select.'})) };
  h.b.h.identity.session = false;
  await assert.rejects(host().resume({ original: h.reference, submission }), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  assert.equal(h.execution.sent.length, 1);
  h.b.h.identity.session = true;
  // Any answer round changes the candidate fingerprint: the contract re-offers
  // the current authorized choices (including the explicit pricing unit) until
  // the exact current candidate is reconfirmed. Each round runs one model call.
  const answersFor = (contract, key) => ({ draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: h.created.task.taskId,
    requestId: contract.requestId, expectedRevision: contract.revision, submissionKey: key,
    answers: contract.contract.fields.map(field=>({fieldId:field.fieldId,value:field.kind==='choice'?field.options[0].value
      :field.kind==='integer'?2:field.fieldId==='starts_at'?'2027-02-01T00:00:00.000Z'
      :field.fieldId==='ends_at'?'2027-02-02T00:00:00.000Z':'Please explain which absolute dates and product I need to select.'})) });
  const resumed = await host().resume({ original: h.reference, submission });
  assert.equal(resumed.continuation.outcome.status, 'paused', JSON.stringify(resumed));
  assert.equal(h.execution.sent.length, 2);
  const reconfirm = await host().readInput(h.reference);
  assert.equal(reconfirm.contract.code, 'original_quote_parameters');
  assert.ok(reconfirm.contract.fields.some(field => field.fieldId === 'pricing_unit_selection'));
  await host().resume({ original: h.reference, submission: answersFor(reconfirm, 'quote-context-reconfirm') });
  const exact = await host().readInput(h.reference);
  assert.equal(exact.contract.code, 'original_quote_parameters');
  const finished = await host().resume({ original: h.reference, submission: answersFor(exact, 'quote-context-exact') });
  assert.equal(finished.continuation.outcome.status, 'succeeded', JSON.stringify(finished));
  assert.equal(h.execution.sent.length, 4);
  const read = await h.model.readModelResult({ original: h.reference, resultId: h.state.aiTaskResultArtifact.at(-1).id });
  assert.equal(read.facts.payload.facts.status, 'missing_input');
  assert.equal(h.state.aiTaskActionInput.length, 4);
  assert.equal(h.state.aiTaskActionInput[0].fingerprint, originalModelFingerprint);
  assert.equal(JSON.parse(h.execution.sent[1].messages.at(-1).content).facts.payload.facts.selectionRevision, pending.contract.version);
  assert.doesNotMatch(h.execution.sent[1].messages.at(-1).content, /Synthetic authorized explanation/);
  assert.match(h.execution.sent[1].messages.at(-1).content, /Please explain which absolute dates/);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 4n);
  assert.equal((await host().resume({ original: h.reference, submission })).continuation.reason, 'receipt_replayed');
  const prepared = await host().readQuotePreparation({ original: h.reference, submission });
  assert.equal(prepared.candidate.fulfillmentMode, 'store_pickup_return');
  assert.ok(!prepared.preparation.missingFields?.includes('fulfillmentMode'));
});

test('original model application retains unknown usage and cancellation without redispatch or invented zero usage', async () => {
  const { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const h = await originalModelApplicationHarness();
  delete h.execution.result.usage;
  const result = await h.app.start(h.reference);
  assert.equal(result.execution.kind, 'run_outcome'); assert.equal(result.execution.outcome.status, 'unknown');
  assert.equal(h.state.aiStep[0].status, 'UNKNOWN'); assert.equal(h.state.aiStep[0].effect, 'POSSIBLE');
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  assert.equal(h.state.aiGatewayAccountingReceipt[0].inputTokens, null);
  assert.equal(h.state.aiBudgetReservation[0].status, 'pending_reconciliation');
  assert.equal(h.execution.sent.length, 1);
  const read = await h.model.readModelResult({ original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id });
  assert.equal(read.status, 'unknown'); assert.equal(read.text, null);
  await h.app.reconcile(h.reference); assert.equal(h.execution.sent.length, 1);
  h.state.aiTaskPlanPolicy[0].enabled = false;
  assert.equal(await h.app.readInput(h.reference), null);
  const cancelled = await h.app.requestCancel({ original: h.reference, expectedRevision: h.state.aiTask[0].revision });
  assert.equal(cancelled.cancellation, 'requested_not_rollback'); assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  assert.equal(h.execution.sent.length, 1); assert.equal(h.state.aiTaskActionInput.length, 1);

  const waiting = await originalModelApplicationHarness('quote_clarification');
  const waitingHost = waiting.model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, { ...waiting.run, inputSource: 'original_scene' });
  assert.equal((await waitingHost.start(waiting.reference)).execution.outcome.status, 'paused');
  assert.equal(waiting.state.aiRun[0].leaseOwnerId, null);
  const retainedCharges = require('./fixtures/ai-native/task-input-store.cjs').clone(waiting.state.aiTaskExecutionCharge);
  await waitingHost.requestCancel({ original: waiting.reference, expectedRevision: waiting.state.aiTask[0].revision });
  assert.equal(waiting.state.aiTask[0].status, 'CANCELLED', 'proved released input wait must converge without a fresh lease');
  assert.equal(waiting.state.aiRun[0].status, 'CANCELLED');
  assert.deepEqual(waiting.state.aiTaskExecutionCharge, retainedCharges);
  assert.equal(await waitingHost.readInput(waiting.reference), null);
  await waitingHost.reconcile(waiting.reference);
  assert.equal(waiting.execution.sent.length, 1);
  assert.equal(waiting.state.aiRun.length, 1);

  const unreleased = await originalModelApplicationHarness('quote_clarification');
  const unreleasedHost = unreleased.model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, { ...unreleased.run, inputSource: 'original_scene' });
  assert.equal((await unreleasedHost.start(unreleased.reference)).execution.outcome.status, 'paused');
  const run = unreleased.state.aiRun[0];
  run.leaseOwnerId = 'expired-worker'; run.leaseExpiresAt = new Date(0);
  await unreleasedHost.requestCancel({ original: unreleased.reference, expectedRevision: unreleased.state.aiTask[0].revision });
  assert.equal(unreleased.state.aiTask[0].status, 'CANCEL_REQUESTED', 'expiry alone is not a released wait');
  assert.equal(run.status, 'RUNNING');
  // Database double exposes the already persisted release, then loses only
  // the final commit response. It never substitutes the runner or transition.
  unreleased.state.aiRun[0].leaseOwnerId = null; unreleased.state.aiRun[0].leaseExpiresAt = null;
  const priorWrite = unreleased.control.beforeWrite;
  unreleased.control.beforeWrite = async (table, args, data) => {
    await priorWrite?.(table, args, data);
    if (table === 'aiTaskEvent' && args.data?.payload?.data?.to === 'cancelled') unreleased.control.loseReply = true;
  };
  await assert.rejects(() => unreleasedHost.reconcile(unreleased.reference), error => error.code === 'AI_RESULT_UNKNOWN');
  unreleased.control.beforeWrite = priorWrite; unreleased.control.loseReply = false;
  assert.equal(unreleased.state.aiTask[0].status, 'CANCELLED');
  await unreleasedHost.reconcile(unreleased.reference);
  assert.equal(unreleased.execution.sent.length, 1);
  assert.equal(unreleased.state.aiTaskExecutionCharge.length, 4);

  const aborted = await originalModelApplicationHarness(), signal = new AbortController(); signal.abort();
  const stopped = await aborted.app.start(aborted.reference, signal.signal);
  assert.deepEqual(stopped.execution, { kind: 'not_started', reason: 'host_aborted' });
  assert.equal(aborted.state.aiTask[0].status, 'QUEUED'); assert.equal(aborted.state.aiTaskRunPlan.length, 0);
  assert.equal(aborted.execution.sent.length, 0);
});

test('scene knowledge stays separate from Core and reauthorizes frozen sources and human preferences', { timeout: 60000 }, async () => {
  const { originalModelApplicationHarness, originalSceneKnowledgeFixture } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  for (const sceneCode of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) {
    const h = await originalModelApplicationHarness(sceneCode, originalSceneKnowledgeFixture), k = h.supplemental;
    const run = await h.app.start(h.reference);
    assert.equal(run.execution.outcome.status, 'succeeded'); assert.equal(h.execution.sent.length, 1);
    const frozen = h.state.aiTaskActionInput[0].payload.intent.messages.find(message => message.role === 'user');
    const envelope = JSON.parse(frozen.content.map(part => part.text).join(''));
    assert.equal(envelope.knowledge.originalInputRef, h.reference.inputRef);
    assert.equal(envelope.materialHash, requestFingerprint(envelope.facts));
    assert.equal(envelope.knowledge.contentHash, requestFingerprint(envelope.knowledge.material));
    assert.equal(envelope.knowledge.material.sources[0].snippet, k.text);
    assert.equal(envelope.knowledge.material.sources[0].trust, 'untrusted_data');
    assert.equal(envelope.knowledge.material.preferences.items[0].preference.value, 'zh-CN');
    assert.equal(envelope.knowledge.material.preferences.semantics, 'preference_not_authority');
    assert.equal(JSON.stringify(envelope.facts).includes('999999'), false);
    assert.ok(Buffer.byteLength(JSON.stringify(envelope.knowledge.material)) <= 16384);
    assert.equal(envelope.knowledge.material.sections.businessFacts, 'core_authoritative_only');
    const searchKeys = new Set(k.policyReads.filter(row => row.domain === 'knowledge' && row.action === 'search').map(row => row.resourceKey));
    assert.ok(searchKeys.size >= 2, 'scope and document search are distinct persisted grants');
    const command = { original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id };
    const read = await h.model.readModelResult(command);
    assert.equal(read.status, 'available'); assert.deepEqual(read.knowledge, envelope.knowledge);
    const { validateAiSceneModelObservation } = require('../apps/api/src/modules/ai-native/scenes/scene-observation-contracts');
    assert.deepEqual(validateAiSceneModelObservation(read), read);
    for (const corrupt of [value => { value.knowledge.contentHash = '0'.repeat(64); },
      value => { value.knowledge.material.sources[0].credential = 'must-not-leak'; },
      value => { value.knowledge.material.preferences.items[0].preference.kind = 'authority'; }]) {
      const invalid = structuredClone(read); corrupt(invalid);
      assert.throws(() => validateAiSceneModelObservation(invalid), error => error.code === 'AI_STORAGE_UNAVAILABLE');
    }
    const searchCount = k.db.queries.filter(query => query.where.text?.contains !== undefined).length;
    assert.ok(searchCount > 0);
    const opened = await h.model.reopenModelSource({ ...command, sourceKind: 'knowledge', sourceIndex: 0 });
    assert.equal(opened.source.text, k.text); assert.equal(opened.reference.documentId, k.document.documentId);
    assert.equal(k.db.queries.filter(query => query.where.text?.contains !== undefined).length, searchCount,
      'readback must not recollect replacement sources');
    assert.equal(k.fileReads(), 1, 'source reopen reads stored chunks, never raw storage');
    await assert.rejects(h.model.reopenModelSource({ ...command, sourceKind: 'knowledge', sourceIndex: 4 }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    await assert.rejects(h.model.reopenModelSource({ ...command, sourceKind: 'knowledge', sourceIndex: 0, url: 'forged' }), e => e.code === 'AI_INVALID_INPUT');
    const sourcePolicy = k.policyRows.find(row => row.domain === 'knowledge' && row.action === 'resolve_source' && row.resource.documentId);
    sourcePolicy.enabled = false;
    await assert.rejects(h.model.readModelResult(command), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    await assert.rejects(h.model.reopenModelSource({ ...command, sourceKind: 'knowledge', sourceIndex: 0 }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    sourcePolicy.enabled = true;
    await k.bundle.memory.revoke({ memoryId: 'scene-preference', expectedRevision: 2 });
    await assert.rejects(h.model.readModelResult(command), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    assert.equal(h.execution.sent.length, 1); assert.equal(h.state.aiTaskResultArtifact.length, 1);
  }
});

test('scene knowledge revocation at final Gateway route check prevents transport without false success', { timeout: 30000 }, async () => {
  const { originalModelApplicationHarness, originalSceneKnowledgeFixture } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const h = await originalModelApplicationHarness('order_explanation', originalSceneKnowledgeFixture);
  let revoked = false;
  h.execution.beforeRouteCheck = async () => {
    if (h.execution.events.includes('dispatch')) {
      revoked = true;
      h.supplemental.policyRows.filter(row => row.action === 'resolve_source').forEach(row => { row.enabled = false; });
    }
  };
  const result = await h.app.start(h.reference);
  assert.equal(revoked, true); assert.equal(h.execution.sent.length, 0);
  assert.notEqual(result.execution.outcome.status, 'succeeded');
  assert.equal(h.state.aiTaskActionInput.length, 1); assert.equal(h.state.aiGatewayInvocation.length, 1);
  assert.ok(h.state.aiTaskResultArtifact.every(row => row.outcome !== 'SUCCEEDED'));
  const read = await h.model.readModelResult({ original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id });
  assert.equal(read.text, null);
});

test('scene knowledge with missing exact policy cannot publish model material or invent empty readiness', { timeout: 30000 }, async () => {
  const { originalModelApplicationHarness, originalSceneKnowledgeFixture } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const h = await originalModelApplicationHarness('order_explanation', originalSceneKnowledgeFixture);
  h.supplemental.policyRows.filter(row => row.action === 'search').forEach(row => { row.enabled = false; });
  await assert.rejects(h.app.start(h.reference), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.state.aiTaskActionInput.length, 0); assert.equal(h.state.aiTaskRunPlan.length, 0);
  assert.equal(h.execution.sent.length, 0); assert.equal(h.state.aiGatewayInvocation.length, 0);
});

test('opt-in model controller executes persisted quote clarification and denies caller execution metadata', { timeout: 30000 }, async () => {
  const { requestBoundOriginalModelHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const { AiOriginalSceneModelController } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
  const { AI_SCENE_MODEL_HTTP_DRAFT } = require('../packages/shared/src/ai-scene-request-draft');
  const shared = require('@rental-os/shared');
  const quoteContracts = require('./fixtures/ai-native/contract-consumer.cjs');
  quoteContracts.checkClosed(shared.AI_SCENE_QUOTE_HTTP_SCHEMAS, {
    ...shared.AI_SCENE_QUOTE_HTTP_SCHEMAS, ...shared.AI_SCENE_REQUEST_DRAFT_SCHEMAS });
  const quoteValidators = quoteContracts.validatorsFor(shared.AI_SCENE_QUOTE_HTTP_SCHEMAS, shared.AI_SCENE_REQUEST_DRAFT_SCHEMAS);
  const validQuote = (name, value) => assert.equal(quoteValidators[name](JSON.parse(JSON.stringify(value))), true,
    JSON.stringify(quoteValidators[name].errors));
  const { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document');
  const { aiLeafToOpenApi30 } = require('../apps/api/src/contracts/ai-leaf-openapi');
  for (const [name, schema] of Object.entries(shared.AI_SCENE_QUOTE_HTTP_SCHEMAS))
    assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], aiLeafToOpenApi30(schema, name));
  for (const [action, name] of [['readQuotePreparation', 'AiSceneModelQuotePreparationResponseDraft'],
    ['confirmClarifiedQuote', 'AiSceneModelQuoteConfirmResponseDraft'], ['readClarifiedQuoteReceipt', 'AiSceneModelQuoteReceiptResponseDraft']])
    assert.equal(OPENAPI_DOCUMENT.paths[`/api/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${AI_SCENE_MODEL_HTTP_DRAFT[action]}`].post.responses['200'].content['application/json'].schema.properties.data.$ref,
      `#/components/schemas/${name}`);
  const { AI_TASK_INPUT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  const quoteIntent={customerType:'personal',customerId:'customer-a',bookingIdentity:{bookingIdentity:'enterprise_employee'},fulfillmentMode:'store_pickup_return',
    start:'2027-02-01T00:00:00.000Z',end:'2027-02-02T00:00:00.000Z'};
  const h = await requestBoundOriginalModelHarness('quote_clarification',undefined,quoteIntent, async b=>{
    quoteIntent.items=[{productName:b.group.name,quantity:2}]; // Pricing remains an unanswered business choice.
    b.membershipRows.corporateCustomers=[{id:'company-a',tenantId:'tenant_001',customerType:'corporate',name:'Synthetic enterprise'}];
    b.membershipRows.corporateLinks=[{tenantId:'tenant_001',customerId:'company-a',status:'active'}];
    b.membershipRows.bookingOptions=[{id:'relationship-a',tenantId:'tenant_001',personalCustomerId:'customer-a',
      corporateCustomerId:'company-a',corporateCustomer:{name:'Synthetic enterprise'},role:'employee',status:'active',
      effectiveFrom:new Date('2020-01-01T00:00:00Z'),effectiveTo:null}];
  });
  const originalFactory = h.options.runServices;
  const options = { ...h.options, runServices: input => ({ ...originalFactory(input), inputSource: 'original_scene' }) };
  const writes = h.trace.length, module = AiOriginalScenesModule.registerHttpModel(h.requestDependencies, options);
  const provider = module.providers.find(p => p.provide === require('../apps/api/src/modules/ai-native/scenes/original-scenes.module').AI_ORIGINAL_SCENE_MODEL_REQUESTS);
  const controller = new AiOriginalSceneModelController(provider.useFactory());
  const request = Object.assign(new (require('node:events').EventEmitter)(), h.request, { aborted: false });
  assert.equal(h.trace.length, writes);
  assert.deepEqual(module.controllers, [AiOriginalScenesController, AiOriginalSceneModelController]);
  for (const method of ['start', 'readInput', 'refreshInput', 'resume', 'readAnswer', 'continueAnswer', 'readQuotePreparation', 'confirmClarifiedQuote', 'readClarifiedQuoteReceipt', 'reconcile', 'requestCancel', 'readModelResult', 'reopenModelSource',
    'readTaskPage', 'readTaskEvents', 'readTaskScene'])
    assert.equal(Reflect.getMetadata('path', AiOriginalSceneModelController.prototype[method]), AI_SCENE_MODEL_HTTP_DRAFT[method]);
  const referenceValid = ajv.compile(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneModelReferenceDraft);
  assert.equal(referenceValid(h.reference), true);
  assert.equal(referenceValid({ ...h.reference, holderId: 'caller-worker' }), false);
  await assert.rejects(controller.start(request, { ...h.reference, holderId: 'caller-worker' }), e => e.getStatus() === 400);
  assert.equal(request.listenerCount('aborted'), 0);
  assert.equal(h.execution.sent.length, 0);
  const started = await controller.start(request, h.reference);
  assert.equal(request.listenerCount('aborted'), 0);
  assert.equal(started.execution.outcome.status, 'paused');
  let pending = await controller.readInput(h.request, h.reference);
  assert.ok(pending.contract.fields.some(field=>field.fieldId==='enterprise_selection'));
  assert.ok(pending.contract.fields.some(field=>field.fieldId==='enterprise_payer_selection'));
  assert.ok(pending.contract.fields.some(field=>field.fieldId==='pricing_unit_selection'&&field.kind==='choice'));
  const refresh = { original: h.reference, requestId: pending.requestId, expectedRevision: pending.revision };
  const refreshValid = ajv.compile(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneModelInputRefreshDraft);
  assert.equal(refreshValid(refresh), true); assert.equal(refreshValid({ ...refresh, actorId: 'other' }), false);
  await assert.rejects(controller.refreshInput({ headers: {} }, refresh), e => e.getStatus() === 403);
  await assert.rejects(controller.refreshInput(h.request, { ...refresh, actorId: 'other' }), e => e.getStatus() === 400);
  const currentSettings = h.b.core.state('tenant_001').businessSettings;
  currentSettings.configVersion = `${currentSettings.configVersion}-http-refreshed`;
  const originalWrite = h.control.beforeWrite;
  h.control.beforeWrite = async (...args) => {
    await originalWrite?.(...args);
    if (args[0] === 'aiTaskEvent' && args[1].data.type === 'task.input_refreshed') h.control.loseReply = true;
  };
  await assert.rejects(controller.refreshInput(h.request, refresh), e => e.getStatus() === 409
    && e.getResponse().code === 'AI_RESULT_UNKNOWN' && e.getResponse().nextAction === 'read_input' && !e.getResponse().retryable);
  h.control.beforeWrite = originalWrite;
  assert.equal(h.execution.sent.length, 1); assert.equal(h.state.aiRun.length, 1);
  pending = await controller.readInput(h.request, h.reference);
  assert.equal(pending.revision, refresh.expectedRevision + 1);
  await assert.rejects(controller.refreshInput(h.request, refresh), e => e.getStatus() === 409 && e.getResponse().code === 'AI_REVISION_CONFLICT');
  assert.equal((await controller.refreshInput(h.request, { ...refresh, expectedRevision: pending.revision })).revision, pending.revision);
  const submission = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: h.created.task.taskId,
    requestId: pending.requestId, expectedRevision: pending.revision, submissionKey: 'http-quote-clarification',
    answers: pending.contract.fields.map(field=>({fieldId:field.fieldId,value:field.kind==='choice'?field.options[0].value
      :field.kind==='integer'?2:field.fieldId==='starts_at'?'2027-02-01T00:00:00.000Z'
      :field.fieldId==='ends_at'?'2027-02-02T00:00:00.000Z':'Explain the required fields without choosing for me.'})) };
  assert.equal(ajv.compile(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneModelResumeDraft)({ original: h.reference, submission }), true);
  const offeredChoice=pending.contract.fields.find(field=>field.kind==='choice');
  assert.ok(offeredChoice);
  await assert.rejects(controller.resume(request,{original:h.reference,submission:{...submission,
    answers:submission.answers.map(answer=>answer.fieldId===offeredChoice.fieldId?{...answer,value:'not-authorized-candidate'}:answer)}}),e=>e.getStatus()===400&&e.getResponse().code==='AI_INVALID_INPUT');
  assert.equal(h.execution.sent.length,1);
  assert.deepEqual(await controller.readAnswer(h.request,{original:h.reference,submission}),{state:'not_observed',retryable:false});
  const noAnswerQuery = { original: h.reference, submission };
  assert.deepEqual(await controller.readQuotePreparation(h.request, noAnswerQuery), {
    receipt: { state: 'not_observed', retryable: false }, preparation: 'unavailable' });
  assert.deepEqual(await controller.readClarifiedQuoteReceipt(h.request, noAnswerQuery), {
    receipt: { state: 'not_observed', retryable: false }, quotation: 'unavailable' });
  const requestValidators = quoteContracts.validatorsFor({
    AiSceneModelQuoteConfirmDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneModelQuoteConfirmDraft }, shared.AI_TASK_INPUT_DRAFT_SCHEMAS);
  assert.equal(requestValidators.AiSceneModelQuoteConfirmDraft({ original: { ...h.reference, draftVersion: 'old-v0' }, submission,
    selectionRevision: 'a'.repeat(64), inputFingerprint: 'b'.repeat(64), confirmQuote: true }), false);
  request.aborted=true;
  const resumed = await controller.resume(request, { original: h.reference, submission });
  assert.equal(request.listenerCount('aborted'), 0);
  assert.equal(resumed.continuation.reason,'host_aborted');
  assert.equal(h.execution.sent.length,1);
  const received=await controller.readAnswer(h.request,{original:h.reference,submission});
  assert.equal(received.state,'observed');assert.equal(received.receiptId,resumed.receipt.receiptId);
  assert.equal(h.execution.sent.length,1);
  assert.deepEqual(await controller.readAnswer(h.request,{original:h.reference,submission}),received);
  const insufficient=await controller.readQuotePreparation(h.request,{original:h.reference,submission});
  assert.equal(insufficient.preparation.status,'unavailable');
  validQuote('AiSceneModelQuotePreparationResponseDraft', insufficient);
  // Only database rows are substituted: availability and quote pricing remain real services.
  h.b.facts.listAssets=async()=>[1,2].map(index=>({id:'clarified-asset-'+index,
    tenantId:'tenant_001',workspaceId:'workspace-a',itemGroupId:h.b.group.id,
    locationId:h.b.location.id,status:'available'}));
  const storedQuotes=[];
  h.b.businessFacts.findQuoteForOriginalOperation=async(tenantId,proof)=>{
    const row=storedQuotes.find(row=>row.quote.tenantId===tenantId&&row.key===proof.key);
    if(row&&row.inputHash!==proof.inputHash)throw new (require('@nestjs/common').ConflictException)('Original input conflict');
    return row&&structuredClone(row.quote);
  };
  h.b.businessFacts.findQuoteForOriginalReference=async(tenantId,key)=>{
    const row=storedQuotes.find(row=>row.quote.tenantId===tenantId&&row.key===key);
    return row&&structuredClone(row.quote);
  };
  h.b.businessFacts.saveQuoteForOriginalOperation=async(quote,proof)=>{
    const previous=await h.b.businessFacts.findQuoteForOriginalOperation(quote.tenantId,proof);
    if(previous)return previous;
    storedQuotes.push({...proof,quote:structuredClone(quote)});return structuredClone(quote);
  };
  const prepared=await controller.readQuotePreparation(h.request,{original:h.reference,submission});
  assert.equal(prepared.candidate.start,'2027-02-01T00:00:00.000Z');
  assert.equal(prepared.candidate.items[0].quantity,2);
  assert.equal(prepared.candidate.items[0].pricingUnit,submission.answers.find(answer=>answer.fieldId==='pricing_unit_selection').value);
  assert.deepEqual(prepared.candidate.bookingIdentity,{bookingIdentity:'enterprise_employee',
    corporateCustomerId:'company-a',enterpriseContractAndPayer:false});
  assert.equal(prepared.quotation,'not_attempted');assert.equal(prepared.orderApproval,'not_granted');
  assert.equal(prepared.receipt.receiptId,received.receiptId);
  assert.equal(prepared.preparation.status,'ready',JSON.stringify(prepared));
  validQuote('AiSceneModelQuotePreparationResponseDraft', prepared);
  assert.equal(quoteValidators.AiSceneModelQuotePreparationResponseDraft({ ...prepared, approval: 'granted' }), false);
  assert.equal(quoteValidators.AiSceneModelQuotePreparationResponseDraft({ ...prepared,
    candidate: { ...prepared.candidate, amount: 999 } }), false);
  assert.equal(quoteValidators.AiSceneModelQuotePreparationResponseDraft({ ...prepared,
    sources: { ...prepared.sources, fields: prepared.sources.fields.map(field => ({ ...field, confirmed: true })) } }), false);
  const confirmation={original:h.reference,submission,selectionRevision:prepared.preparation.selectionRevision,
    inputFingerprint:prepared.formalInputFingerprint,confirmQuote:true};
  assert.equal(ajv.compile(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneModelQuoteConfirmDraft)(confirmation),true);
  await assert.rejects(controller.confirmClarifiedQuote(h.request,{...confirmation,confirmQuote:false}),e=>e.getStatus()===400);
  await assert.rejects(controller.confirmClarifiedQuote(h.request,{...confirmation,inputFingerprint:'0'.repeat(64)}),e=>e.getStatus()===409);
  const absent=await controller.readClarifiedQuoteReceipt(h.request,{original:h.reference,submission});
  assert.equal(absent.result.quotePersistence,'unknown');
  validQuote('AiSceneModelQuoteReceiptResponseDraft', absent);
  await assert.rejects(controller.confirmClarifiedQuote(h.request, {
    ...confirmation, submission: { ...submission, submissionKey: 'nonexistent-answer' } }), error => error.getStatus() === 404);
  assert.equal(storedQuotes.length, 0, 'an unobserved answer cannot confirm or create a quote');
  const saveOriginal=h.b.businessFacts.saveQuoteForOriginalOperation;
  h.b.businessFacts.saveQuoteForOriginalOperation=async(...args)=>{
    await saveOriginal(...args);
    throw new Error('Synthetic commit acknowledgement lost');
  };
  const uncertain=await controller.confirmClarifiedQuote(h.request,confirmation);
  assert.equal(uncertain.result.quotePersistence,'unknown');
  validQuote('AiSceneModelQuoteConfirmResponseDraft', uncertain);
  assert.equal(storedQuotes.length,1);
  const recovered=await controller.readClarifiedQuoteReceipt(h.request,{original:h.reference,submission});
  assert.equal(recovered.result.status,'quoted');assert.equal(storedQuotes.length,1);
  validQuote('AiSceneModelQuoteReceiptResponseDraft', recovered);
  const { AiOriginalQuoteModelExecutionController, validateAiSceneQuoteResponse } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
  const malformed = new AiOriginalQuoteModelExecutionController({ confirmClarifiedQuote: async () => ({ ...uncertain, secretBody: 'must_not_escape' }) });
  await assert.rejects(malformed.confirmClarifiedQuote(h.request, confirmation), error =>
    error.getStatus() === 409 && error.getResponse().code === 'AI_RESULT_UNKNOWN'
      && error.getResponse().nextAction === 'read_clarified_quote_receipt' && !JSON.stringify(error.getResponse()).includes('must_not_escape'));
  assert.throws(() => validateAiSceneQuoteResponse('AiSceneModelQuoteReceiptResponseDraft', { ...recovered,
    result: { ...recovered.result, quote: { ...recovered.result.quote, payableAmount: null } } }), error => error.code === 'AI_STORAGE_UNAVAILABLE');
  const missing = { status: 'missing_input', missingFields: ['items.0.pricingUnit'], clarifications: [] };
  const incomplete = { ...prepared, formalInputFingerprint: null, sources: missing,
    preparation: { ...missing, scope: prepared.preparation.scope, audience: prepared.preparation.audience,
      observedAt: prepared.preparation.observedAt, next: 'clarify_input', authority: 'current_guarded_business_context',
      sideEffects: prepared.preparation.sideEffects } };
  validQuote('AiSceneModelQuotePreparationResponseDraft', incomplete);
  assert.throws(() => validateAiSceneQuoteResponse('AiSceneModelQuotePreparationResponseDraft', {
    ...incomplete, formalInputFingerprint: NaN }), error => error.code === 'AI_STORAGE_UNAVAILABLE');
  validQuote('AiSceneModelQuoteConfirmResponseDraft', { receipt: received, preparation: incomplete.preparation, quotation: 'not_attempted' });
  assert.deepEqual(quoteContracts.compileConsumer(`import type { AiSceneQuoteCandidate, AiSceneModelQuoteConfirmDraft, AiSceneModelQuoteReceiptResponseDraft,
    AiSceneModelQuotePreparationResponseDraft } from '../packages/shared/src/index';
    const confirmation: AiSceneModelQuoteConfirmDraft = ${JSON.stringify(confirmation)};
    const candidate: AiSceneQuoteCandidate = ${JSON.stringify(prepared.candidate)};
    const recovered: AiSceneModelQuoteReceiptResponseDraft = ${JSON.stringify(recovered)};
    const missing: AiSceneModelQuotePreparationResponseDraft = ${JSON.stringify(incomplete)};
    // @ts-expect-error a quote receipt does not grant approval
    const approval: AiSceneModelQuoteReceiptResponseDraft = { ...recovered, orderApproval: 'granted' };
    // @ts-expect-error a failed preparation must name its missing fields
    const malformed: AiSceneModelQuotePreparationResponseDraft = { ...missing, preparation: { status: 'missing_input' } };
  `), []);
  h.b.businessFacts.saveQuoteForOriginalOperation=saveOriginal;
  const quoted=await controller.confirmClarifiedQuote(h.request,confirmation);
  assert.equal(quoted.result.status,'quoted',JSON.stringify(quoted));assert.equal(quoted.orderApproval,'not_granted');
  const sameQuote=await controller.readClarifiedQuoteReceipt(h.request,{original:h.reference,submission});
  assert.equal(sameQuote.result.quote.id,quoted.result.quote.id);
  assert.equal((await controller.confirmClarifiedQuote(h.request,confirmation)).result.quote.id,quoted.result.quote.id);
  const standard = new AiOriginalQuoteModelExecutionController(controller.fullModel);
  assert.equal((await standard.readQuotePreparation(h.request, { original: h.reference, submission })).formalInputFingerprint, prepared.formalInputFingerprint);
  assert.equal((await standard.confirmClarifiedQuote(h.request, confirmation)).result.quote.id, quoted.result.quote.id);
  assert.equal((await standard.readClarifiedQuoteReceipt(h.request, { original: h.reference, submission })).result.quote.id, quoted.result.quote.id);
  assert.equal(storedQuotes.length,1);
  assert.equal(h.execution.sent.length,1);
  await assert.rejects(controller.readAnswer(h.request,{original:h.reference,submission:{...submission,taskId:'wrong-task'}}),e=>e.getStatus()===403);
  request.aborted=false;
  // The confirmed quote freezes its own candidate; the run continuation still
  // re-offers the current authorized choices until the exact fingerprint is
  // reconfirmed, one model call per answer round.
  const answersFor=(contract,key)=>({draftVersion:AI_TASK_INPUT_DRAFT_VERSION,taskId:h.created.task.taskId,
    requestId:contract.requestId,expectedRevision:contract.revision,submissionKey:key,
    answers:contract.contract.fields.map(field=>({fieldId:field.fieldId,value:field.kind==='choice'?field.options[0].value
      :field.kind==='integer'?2:field.fieldId==='starts_at'?'2027-02-01T00:00:00.000Z'
      :field.fieldId==='ends_at'?'2027-02-02T00:00:00.000Z':'Explain the required fields without choosing for me.'}))});
  const continued=await controller.continueAnswer(request,{original:h.reference,submission});
  assert.equal(continued.execution.outcome.status,'paused',JSON.stringify(continued));
  assert.equal(continued.receipt.runId,received.runId);
  assert.equal(request.listenerCount('aborted'),0);
  // The confirmed quote froze its candidate and the pricing unit was already
  // explicit in round one, so one reconfirmation of the current fingerprint
  // converges; the reconfirmation round still runs its own model call.
  const finished=await controller.resume(h.request,{original:h.reference,
    submission:answersFor(await controller.readInput(h.request,h.reference),'reconfirm-2')});
  assert.equal(finished.continuation.outcome.status,'succeeded',JSON.stringify(finished));
  assert.equal(h.state.aiTaskExecutionBudget.length,1);assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,3n);
  await assert.rejects(controller.continueAnswer(request,{original:h.reference,submission}),e=>e.getStatus()===403);
  const read = await controller.readModelResult(h.request, { original: h.reference, resultId: h.state.aiTaskResultArtifact.at(-1).id });
  assert.equal(read.status, 'available'); assert.equal(read.facts.payload.facts.status, 'missing_input');
  assert.equal(h.execution.sent.length, 3);
  const aggregateCommand = { kind: 'original', original: h.reference, taskId: h.created.task.taskId,
    runId: read.runId, resultId: read.resultId };
  assert.equal(ajv.compile(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneModelTaskSceneDraft)(aggregateCommand), true);
  const aggregate = await controller.readTaskScene(h.request, aggregateCommand);
  const { validateAiTaskSceneObservation } = require('../apps/api/src/modules/ai-native/scenes/scene-observation-contracts');
  assert.deepEqual(validateAiTaskSceneObservation(aggregate), aggregate);
  for (const corrupt of [value => { value.snapshot.value.cursor = 9007199254740993; },
    value => { value.model.text.value = '汉'.repeat(50000); }, value => { value.task.privateCredential = 'must-not-leak'; }]) {
    const invalid = structuredClone(aggregate); corrupt(invalid);
    const damaged = new AiOriginalSceneModelController({ readTaskScene: async () => invalid });
    await assert.rejects(damaged.readTaskScene(h.request, aggregateCommand), error => error.getStatus() === 503
      && error.getResponse().code === 'AI_STORAGE_UNAVAILABLE' && !JSON.stringify(error.getResponse()).includes('must-not-leak'));
  }
  const page = await controller.readTaskPage(h.request, { limit: 5 });
  assert.ok(page.items.some(item => item.taskId === h.created.task.taskId));
  await assert.rejects(controller.readTaskPage(h.request, { limit: 51 }), e => e.getStatus() === 400);
  assert.equal(aggregate.runId, read.runId);
  assert.equal(aggregate.originRunId, h.created.task.runId);
  assert.equal(aggregate.snapshot.availability, 'available');
  const events = await controller.readTaskEvents(h.request, { original: h.reference, after: '0', limit: 10 });
  assert.equal(events.taskId, h.created.task.taskId);
  assert.equal(h.execution.sent.length, 3);
  await assert.rejects(controller.readTaskScene(h.request, { ...aggregateCommand, runId: 'wrong-run' }), e => e.getStatus() === 403);
  assert.equal((await controller.resume(h.request, { original: h.reference, submission })).continuation.reason, 'receipt_replayed');
  assert.equal(h.execution.sent.length, 3);
  await assert.rejects(controller.readInput({ headers: {} }, h.reference), e => e.getStatus() === 403);
  h.b.h.identity.session = false;
  await assert.rejects(controller.readTaskScene(h.request, aggregateCommand), e => e.getStatus() === 403);
  await assert.rejects(controller.readModelResult(h.request, { original: h.reference, resultId: read.resultId }), e => e.getStatus() === 403);
  const aborted = await requestBoundOriginalModelHarness();
  const abortedController = new AiOriginalSceneModelController(aborted.requests);
  const stopped = await abortedController.start({ ...aborted.request, aborted: true }, aborted.reference);
  assert.notEqual(stopped.execution.outcome?.status, 'succeeded');
  assert.equal(aborted.execution.sent.length, 0); assert.equal(aborted.state.aiGatewayInvocation.length, 0);
});

test('request-bound model runs original scenes and reads knowledge results without borrowing request identity', { timeout: 60000 }, async () => {
  const { requestBoundOriginalModelHarness, originalSceneKnowledgeFixture } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const { composeRequestBoundOriginalSceneModel } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { AI_TASK_INPUT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  for (const sceneCode of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) {
    const h = await requestBoundOriginalModelHarness(sceneCode, originalSceneKnowledgeFixture), app = h.requests;
    const request = structuredClone(h.request), reference = structuredClone(h.reference);
    assert.equal(h.execution.sent.length, 0); assert.equal(h.factoryCalls.length, 0);
    assert.equal(h.state.aiRun[0].status, 'QUEUED');
    const cursor = h.state.aiTask[0].eventCursor;
    h.state.aiTask[0].eventCursor = 9007199254740993n;
    const snapshot = await app.readTaskSnapshot(request, reference);
    assert.equal(snapshot.taskId, h.created.task.taskId); assert.equal(snapshot.cursor, '9007199254740993');
    assert.equal(snapshot.status, 'queued');
    h.state.aiTask[0].eventCursor = cursor;
    await assert.rejects(app.readTaskSnapshot(request, { ...reference, taskId: h.created.task.taskId }), e => e.code === 'AI_INVALID_INPUT');
    const recovery = await app.readRecovery(request, reference);
    assert.equal(recovery.automaticExecution, false);
    if (sceneCode === 'opening_diagnosis') {
      const section = await app.readOpeningSection(request, { ...reference, key: 'item_groups' });
      assert.equal(section.section.key, 'item_groups');
    }
    if (sceneCode === 'quote_clarification') {
      const review = await app.reviewQuote(request, reference);
      assert.equal(review.quotePersistence, 'not_attempted');
      // A missing exact-operation quote lookup is an explicit unavailable
      // receipt with unknown persistence — never a fabricated quote.
      const absent = await app.readQuoteReceipt(request, reference);
      assert.equal(absent.result.status, 'unavailable'); assert.equal(absent.result.quote ?? null, null);
      // The Core method is real; only the missing exact-operation database
      // lookup is supplied. No quote/result or permission is fabricated.
      h.b.businessFacts.findQuoteForOriginalReference = async (tenantId, key) => {
        assert.equal(tenantId, 'tenant_001'); assert.match(key, /^[a-f0-9]{64}$/u); return null;
      };
      const receipt = await app.readQuoteReceipt(request, reference);
      assert.equal(receipt.observation, 'original_operation_only');
      assert.equal(receipt.result.quotePersistence, 'unknown');
    }
    assert.equal(h.factoryCalls.length, 0, 'business reads must not construct run dependencies');
    assert.equal(h.execution.sent.length, 0, 'recovery/receipt reads never call the model');
    assert.throws(() => composeRequestBoundOriginalSceneModel(h.modelDependencies, h.options), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    assert.throws(() => composeRequestBoundOriginalSceneModel(h.requestDependencies, { ...h.options, enabled: false }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    assert.throws(() => composeRequestBoundOriginalSceneModel(h.requestDependencies, { ...h.options, runServices: h.run }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    for (const method of ['runtime', 'createApplication', 'prepareHeldRun', 'submitSelectedOrder']) assert.equal(app[method], undefined);
    await assert.rejects(app.start(h.request, { ...h.reference, lease: {}, prompt: 'forged' }), e => e.code === 'AI_INVALID_INPUT');
    h.options.host.holderId = 'mutated-after-assembly';
    h.execution.beforeTransport = async () => {
      request.headers.authorization = 'Bearer mutated-after-await'; reference.inputRef = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      await runWithRequestIdentity({ tenantId: 'tenant_001', workspaceId: 'workspace-a', userId: h.b.h.identity.user.id }, async () => {
        await assert.rejects(app.readInput({ headers: {} }, h.reference), e => e.code === 'AI_ACCESS_DENIED');
        await assert.rejects(app.readInput({ headers: { authorization: 'Bearer wrong' } }, h.reference), e => e.code === 'AI_ACCESS_DENIED');
      });
    };
    const run = await app.start(request, reference);
    assert.equal(run.execution.outcome.status, 'succeeded'); assert.equal(run.original.inputRef, h.reference.inputRef);
    assert.equal(h.state.aiGatewayInvocation[0].leaseOwnerId, 'request-worker');
    assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), '1'); assert.equal(h.execution.sent.length, 1);
    assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.state.aiTaskExecutionCharge.length, 4);
    for (const input of h.factoryCalls) await assert.rejects(input.credentials.current(), e => e.code === 'AI_ACCESS_DENIED');
    const resultCommand = { original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id };
    const result = await app.readModelResult(h.request, resultCommand);
    assert.equal(result.status, 'available'); assert.equal(result.knowledge.originalInputRef, h.reference.inputRef);
    const sourceCommand = { ...resultCommand, sourceKind: 'knowledge', sourceIndex: 0 };
    const { AiOriginalSceneObservationController } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
    const controller = new AiOriginalSceneObservationController(app);
    const beforeFactories = h.factoryCalls.length;
    const source = await controller.reopenModelSource(h.request, sourceCommand);
    assert.equal(source.reference.documentId, h.supplemental.document.documentId);
    const { validateAiSceneSourceObservation } = require('../apps/api/src/modules/ai-native/scenes/scene-observation-contracts');
    assert.deepEqual(validateAiSceneSourceObservation(source, sourceCommand), source);
    const { composeRequestBoundTaskCenter } = require('../apps/api/src/modules/ai-native/task-center.application');
    const centerDependencies = { db: h.db, auth: h.dependencies.auth, clock: h.dependencies.clock, originalDb: h.db, originalResults: app };
    const center = composeRequestBoundTaskCenter(centerDependencies);
    const centerQuery = { taskId: h.created.task.taskId, resultId: resultCommand.resultId };
    const observed = await center.result(h.request, centerQuery);
    const centerSource = { ...centerQuery, source: observed.sources.find(item => item.kind === 'knowledge') };
    const openedText = await center.source(h.request, centerSource);
    assert.equal(openedText.content.value, source.source.text); assert.equal(openedText.content.trust, 'source_data_not_instructions');
    assert.equal(openedText.execution, 'read_only_no_start_no_reconnect_side_effect');
    if (sceneCode === 'order_explanation') {
      const orderSource = await center.source(h.request, { ...centerQuery, source: observed.sources.find(item => item.kind === 'order') });
      assert.equal(orderSource.content.format, 'json');
      const order = JSON.parse(orderSource.content.value);
      assert.equal(order.status, 'available'); assert.equal(order.field, 'order'); assert.equal(order.orderId, 'order-a');
    }
    const invalidSource = structuredClone(source); invalidSource.source.credential = 'must-not-leak';
    const corruptedCenter = composeRequestBoundTaskCenter({ ...centerDependencies,
      originalResults: { ...app, reopenModelSource: async () => invalidSource } });
    await assert.rejects(corruptedCenter.source(h.request, centerSource), error => error.code === 'AI_STORAGE_UNAVAILABLE');
    for (const mutate of [value => { value.source.documentId = 'another-document'; },
      value => { value.source.locator = { kind: 'page', page: 2, paragraph: 1 }; },
      value => { value.source.privateCredential = 'must-not-leak'; }, value => { value.source.text = 'a'.repeat(2001); }]) {
      const invalid = structuredClone(source); mutate(invalid);
      const corrupted = new AiOriginalSceneObservationController({ reopenModelSource: async () => invalid });
      await assert.rejects(corrupted.reopenModelSource(h.request, sourceCommand), error => error.getStatus() === 503
        && error.getResponse().code === 'AI_STORAGE_UNAVAILABLE' && !JSON.stringify(error.getResponse()).includes('must-not-leak'));
    }
    if (sceneCode === 'opening_diagnosis') {
      const openingCommand = { ...resultCommand, key: 'item_groups' };
      const opened = await controller.reopenOpeningModelSource(h.request, openingCommand);
      assert.equal(opened.source.key, 'item_groups'); assert.equal(opened.reference.observedAt !== undefined, true);
      assert.equal(opened.frozenBasis.reference.observedAt, undefined); assert.equal(opened.historicalConfiguration, 'not_loaded');
      assert.equal(opened.execution, 'not_attempted'); assert.ok(Array.isArray(opened.source.current.rows));
      for (const mutate of [value => { value.frozenBasis.reference.observedAt = value.reference.observedAt; },
        value => { value.frozenBasis.reference.version = 'other'; }, value => { value.reference.resourceId = 'other'; },
        value => { value.source.current = { fields: [] }; }, value => { value.source.candidate.currentVersion = 'other'; },
        value => { value.source.current.rows[0].privateCredential = 'must-not-leak'; }]) {
        const invalid = structuredClone(opened); mutate(invalid);
        const corrupted = new AiOriginalSceneObservationController({ reopenOpeningModelSource: async () => invalid });
        await assert.rejects(corrupted.reopenOpeningModelSource(h.request, openingCommand), error => error.getStatus() === 503
          && error.getResponse().code === 'AI_STORAGE_UNAVAILABLE' && !JSON.stringify(error.getResponse()).includes('must-not-leak'));
      }
      await assert.rejects(controller.reopenOpeningModelSource(h.request, { ...openingCommand, key: 'unselected' }), error => [403, 404].includes(error.getStatus()));
    }
    assert.equal(h.factoryCalls.length, beforeFactories, 'source reads do not compose execution dependencies');
    assert.equal(h.execution.sent.length, 1, 'source reads do not redispatch');
    assert.equal(await app.readInput(h.request, h.reference), null);
    assert.deepEqual(await app.reconcile(h.request, h.reference), { kind: 'not_started', reason: 'recovery_lease_unavailable' });
    await assert.rejects(app.resume(h.request, { original: h.reference, submission: { draftVersion: AI_TASK_INPUT_DRAFT_VERSION,
      taskId: 'another-task', requestId: 'input-request', expectedRevision: 1, submissionKey: 'answer-a',
      answers: [{ fieldId: 'clarification_text', value: 'Synthetic clarification' }] } }), e => e.code === 'AI_ACCESS_DENIED');
    h.b.h.identity.session = false;
    await assert.rejects(app.readTaskSnapshot(h.request, h.reference), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
    await assert.rejects(app.readModelResult(h.request, resultCommand), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
    await assert.rejects(app.reopenModelSource(h.request, { ...resultCommand, sourceKind: 'knowledge', sourceIndex: 0 }), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
    assert.equal(h.execution.sent.length, 1);
  }
});

test('request-bound model keeps unknown receipts and cancellation distinct from redispatch', { timeout: 30000 }, async () => {
  const { requestBoundOriginalModelHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const h = await requestBoundOriginalModelHarness(), app = h.requests;
  delete h.execution.result.usage;
  const run = await app.start(h.request, h.reference);
  assert.equal(run.execution.outcome.status, 'unknown'); assert.equal(h.execution.sent.length, 1);
  const command = { original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id };
  assert.equal((await app.readModelResult(h.request, command)).text, null);
  await app.reconcile(h.request, h.reference);
  const { composeRequestBoundOriginalSceneModel } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const rebuilt = composeRequestBoundOriginalSceneModel(h.requestDependencies,
    { ...h.options, host: { ...h.options.host, holderId: 'rebuilt-original-worker' } });
  const originalInvocation = h.state.aiGatewayInvocation[0].id;
  const recovered = await rebuilt.recover(h.request, h.reference);
  assert.equal(recovered.kind, 'run_outcome'); assert.equal(recovered.outcome.status, 'unknown');
  assert.equal(h.state.aiGatewayInvocation[0].id, originalInvocation); assert.equal(h.execution.sent.length, 1);
  const { AiOriginalSceneModelController } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
  const controls = new AiOriginalSceneModelController(rebuilt);
  const snapshot = await controls.readExecution(h.request, h.reference);
  const takeover = { original: h.reference, expectedTaskRevision: snapshot.task.revision,
    expectedRunRevision: snapshot.run.revision, expectedFencingToken: snapshot.run.fencingToken };
  await assert.rejects(controls.takeover(h.request, { ...takeover, holderId: 'injected-worker' }), e => e.getStatus() === 400);
  await assert.rejects(controls.takeover(h.request, takeover), e => e.getStatus() === 403);
  // Simulated interrupted worker remains held; the policy is an explicit
  // persisted server decision, never a default granted by the new entrypoint.
  const policy = h.state.aiTaskActionPolicy.find(row => row.operation === 'claim_recovery_run');
  h.state.aiTaskActionPolicy.push({ ...structuredClone(policy), operation: 'takeover_run' });
  h.state.operationLog = [];
  h.state.aiRun[0].leaseOwnerId = 'interrupted-original-worker';
  h.state.aiRun[0].leaseExpiresAt = new Date(h.dependencies.clock().getTime() + 10000);
  const taken = await controls.takeover(h.request, takeover);
  assert.equal(taken.takeover, 'same_owner_recovery_only'); assert.equal(taken.outcome.status, 'unknown');
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), (BigInt(snapshot.run.fencingToken) + 1n).toString());
  assert.equal(h.execution.sent.length, 1); assert.equal(h.state.aiGatewayInvocation[0].id, originalInvocation);
  assert.equal(h.state.operationLog.length, 1);
  h.state.aiTaskPlanPolicy[0].enabled = false;
  const cancel = await app.requestCancel(h.request, { original: h.reference, expectedRevision: h.state.aiTask[0].revision });
  assert.equal(cancel.cancellation, 'requested_not_rollback');
  assert.equal(h.state.aiGatewayAccountingReceipt[0].inputTokens, null);
  assert.equal(h.state.aiBudgetReservation[0].status, 'pending_reconciliation');
  assert.equal(h.execution.sent.length, 1); assert.equal(h.state.aiGatewayInvocation.length, 1);
  const aborted = await requestBoundOriginalModelHarness(), signal = new AbortController(); signal.abort();
  const stopped = await aborted.requests.start(aborted.request, aborted.reference, signal.signal);
  assert.deepEqual(stopped.execution, { kind: 'not_started', reason: 'host_aborted' });
  assert.equal(aborted.state.aiRun[0].status, 'QUEUED'); assert.equal(aborted.state.aiTaskActionInput.length, 0);
  // Formal production assembly must not need the fixture's successful runtime
  // or financial ports. An aborted original action stays entirely inert.
  const { composeRequestBoundPersistedOriginalSceneModel } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { runtime, priceVersion, ...formalDependencies } = aborted.requestDependencies;
  const gateway = { routeScene: 'chat', platformProfileId: 'platform-profile', callPriceVersion: 'calls-v1',
    secrets: { encrypt() { throw new Error('must not encrypt'); }, decrypt() { throw new Error('must not decrypt'); } },
    adapters: [{ provider: 'openai_chat_completions', features: ['text'], async generate() { throw new Error('must not dispatch'); } }],
    audit: { async append() { throw new Error('must not call Gateway'); } } };
  const formalOptions = { enabled: true, audience: 'operator', host: aborted.options.host };
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const records = createTaskInputStore({ aiTenantModelConfiguration: [], systemParameterSet: [], aiPlatformModelConnection: [], aiProviderCapabilityEvidence: [],
    operationLog: [] });
  for (const table of ['aiTenantModelConfiguration', 'systemParameterSet', 'aiPlatformModelConnection', 'aiProviderCapabilityEvidence']) aborted.db[table] = records.db[table];
  aborted.db.operationLog = records.db.operationLog;
  aborted.db.aiProviderProfile ??= { async findFirst() { return null; }, async updateMany() { throw new Error('must not write profile'); } };
  aborted.db.aiProviderProfile.create ??= async () => { throw new Error('must not create profile'); };
  aborted.db.aiPlatformModelConnection ??= { async findUnique() { return null; },
    async create() { throw new Error('must not create connection'); }, async update() { throw new Error('must not update connection'); } };
  aborted.db.aiPlatformModelConnection.update = async () => { throw new Error('must not update connection'); };
  assert.throws(() => composeRequestBoundPersistedOriginalSceneModel({ ...formalDependencies, gateway, runtime }, formalOptions),
    e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  const { AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.module');
  const { AiOriginalSceneModelActionsController } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
  const module = AiOriginalScenesModule.registerHttpPersistedModel({ ...formalDependencies, gateway }, formalOptions);
  const formal = module.providers.find(provider => provider.provide === AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS).useFactory();
  assert.deepEqual(module.controllers, [AiOriginalScenesController, AiOriginalSceneModelActionsController]);
  await assert.rejects(formal.start(aborted.request, { ...aborted.reference, taskId: aborted.created.task.taskId }),
    e => e.code === 'AI_INVALID_INPUT');
  const formalStopped = await new AiOriginalSceneModelActionsController(formal).start({ ...aborted.request, aborted: true }, aborted.reference);
  assert.deepEqual(formalStopped.execution, { kind: 'not_started', reason: 'host_aborted' });
  assert.equal(aborted.state.aiTaskActionInput.length, 0); assert.equal(aborted.state.aiGatewayInvocation.length, 0);
});

test('client scene authenticates through actual client Guard/Auth and rechecks after the business read', async () => {
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { ClientAuthService } = require('../apps/api/src/modules/client/client-auth.service');
  const { ClientApiService } = require('../apps/api/src/modules/client/client-api.service');
  const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { composeAiClientScenes, createAiGuardedClientSession } = require('../apps/api/src/modules/ai-native/client-scene.composition');
  let revoked = false, revokeDuringRead = false, authorization, reads = 0, rateAllowed = true;
  const session = { id: 'session-client', expiresAt: new Date('2027-01-01'), tenant: { code: 'tenant', status: 'ACTIVE' },
    customer: { customerType: 'personal', name: 'Synthetic', phone: 'synthetic' },
    workspace: { tenantId: 'tenant-client', status: 'ACTIVE', code: 'camera', name: 'Synthetic', categoryCode: 'camera' } };
  const auth = Object.assign(Object.create(ClientAuthService.prototype), { secret: () => 'synthetic-offline-secret-not-production', prisma: {
    clientAuthSession: { findFirst: async () => revoked ? null : structuredClone(session), updateMany: async () => ({ count: 1 }) },
    customerAccount: { findFirst: async () => ({ status: 'active', customer: { status: 'active' } }) },
    customerMembership: { findFirst: async () => ({ status: 'active' }) }
  } });
  const token = auth.sign({ typ: 'client', sub: 'person-client', tid: 'tenant-client', sid: session.id,
    wid: 'workspace-client', iat: 1, exp: Math.floor(new Date('2027-01-01').getTime() / 1000) });
  authorization = `Bearer ${token}`;
  const guard = new ApiAuthGuard({ resolveAccessContext: async () => { throw Error('operator auth forbidden'); } }, undefined,
    auth, { assertAllowed: async () => { if (!rateAllowed) throw Error('client policy unavailable'); } });
  const client = Object.assign(Object.create(ClientApiService.prototype), { core: { getOrder: async (tenantId, id) => {
    reads++; assert.equal(tenantId, 'tenant-client'); assert.equal(getRequestIdentity().workspaceId, 'workspace-client');
    if (revokeDuringRead) revoked = true;
    return { id, tenantId, customerId: id === 'other-order' ? 'another-customer' : 'person-client',
      status: 'reserved', quoteId: 'quote-client', currency: 'CNY', payableAmount: 0, rentalAmount: 12,
      lines: [], chargeLines: [], allocations: [], internalNote: 'never expose' };
  } }, feeItems: async (context, id) => {
    assert.equal(context.tenantId, 'tenant-client'); assert.equal(id, 'own-order');
    return { apiVersion: 'client-v1', orderId: id, items: [{ inspectionId: 'inspection-client', exceptionIndex: 0,
      stage: 'return', code: 'damage', description: '待本人核对', amount: 12, currency: 'CNY',
      responseStatus: 'pending', evidenceCount: 1, internalReview: 'private-review' }], pendingCount: 1, internalNote: 'private-fees' };
  } });
  const source = createAiGuardedClientSession(guard, { current: async () => ({ authorization, ip: '127.0.0.1' }) });
  const app = composeAiClientScenes({ client, session: source });
  assert.equal(reads, 0);
  const result = await app.member.order('own-order'); assert.equal(result.id, 'own-order'); assert.equal(result.internalNote, undefined);
  await assert.rejects(app.member.orders({ page: 1, tenantId: 'forged' }), e => e.getStatus?.() === 400);
  await assert.rejects(app.member.order('other-order'), e => e.getStatus?.() === 404);
  authorization = 'Bearer operator-token';
  await assert.rejects(app.member.order('own-order')); authorization = `Bearer ${token}`;
  revokeDuringRead = true;
  await assert.rejects(app.member.order('own-order'), e => e.getStatus?.() === 401);
  revoked = false; revokeDuringRead = false;
  let published = true, now = new Date();
  const workspace = { id: 'workspace-client', code: 'camera', name: 'Synthetic', categoryCode: 'camera', isDefault: true, status: 'ACTIVE' };
  const channelProfile = () => ({ helpIntro: 'Public help only', helpFaqJson: [{ question: 'How?', answer: 'Ask the merchant.' }],
    updatedAt: new Date('2026-10-01'), publishedWorkspaces: published ? [{ workspaceId: workspace.id, workspace }] : [] });
  Object.assign(client, {
    prisma: { tenant: { findFirst: async ({ where }) => where.code === 'tenant' ? { id: 'tenant-client', code: 'tenant', name: 'Synthetic' } : null },
      clientChannelProfile: { findUnique: async () => channelProfile() }, tenantAppearanceProfile: { findUnique: async () => null },
      businessWorkspace: { findMany: async () => [{ id: workspace.id }], findFirst: async ({ where }) => {
        assert.equal(where.clientChannelPublications.some.enabled, true);
        return published && where.tenantId === 'tenant-client' && where.code === 'camera' ? workspace : null;
      } } },
    tenantIntegrations: { catalog: async () => ({ configs: [] }) },
    buildCatalog: async (_tenant, tenantCode, current) => ({ tenantCode, workspace: current, items: [] }),
    profileRow: async context => ({ id: context.customerId, customerType: context.customerType, name: 'Synthetic',
      phoneMasked: '***', identityVerified: false, account: { status: 'active' }, contacts: [], internalReview: 'never expose' }),
    currentWorkspace: async () => workspace,
    context: async () => ({ profile: {}, settings: {} }),
    business: { getQuote: () => ({ id: 'quote-client' }), calculateCancellationCharge: () => 12 }
  });
  Object.assign(client.core, { listCategories: () => [{ code: 'camera', name: 'Synthetic' }],
    getBusinessSettings: () => ({ fulfillment: { enabledModes: [] } }) });
  const { composeRequestBoundClientApplication } = require('../apps/api/src/modules/ai-native/scenes/client-request.application');
  const { createTaskInputStore, clone } = require('./fixtures/ai-native/task-input-store.cjs');
  const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
  const { AsyncLocalStorage } = require('node:async_hooks');
  const scopes = [{ kind: 'platform' }, { kind: 'tenant', tenantId: 'tenant-client' },
    { kind: 'workspace', tenantId: 'tenant-client', workspaceId: 'workspace-client' }].map((scope, index) => ({ id: `client-scope-${index}`, ...aiPersistenceScopeColumns(scope) }));
  const sceneCode = 'client_material', sceneVersion = '1';
  const settingsFor = scope => ({ draftVersion: 'ain-c07-draft-2', config: { configRevision: 1 },
    scope: scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: 'tenant-client' },
    sceneCode, allowedScenes: [sceneCode], allowedModels: ['synthetic-model'], maxConcurrent: 1, maxCallsPerRun: 1,
    budget: { state: 'limited', quantity: { unit: 'calls', value: 10 } },
    gates: Object.fromEntries(['platform', 'tenant', 'scene'].map(kind => [kind, { enabled: true, revision: 1 }])) });
  const taskStore = createTaskInputStore({ aiScope: scopes, aiTask: [], aiRun: [], aiStep: [], aiTaskResultArtifact: [], aiTaskRunPlan: [], aiTaskEvent: [],
    aiTaskExecutionCharge: [], aiTaskExecutionBudget: [],
    aiTaskInputRequest: [], aiTaskInputReceipt: [], aiTaskActionInput: [], aiTaskPlanPolicy: [],
    aiBudgetPolicy: scopes.map(scope => ({ id: `${scope.id}-budget`, scopeId: scope.id, scopeKind: scope.kind, sceneCode,
      configRevision: 1, enabled: true, settingsJson: settingsFor(scope) })) },
    { aiTask: [['id'], ['scopeId', 'audience', 'ownerKind', 'ownerId', 'creationKey']] });
  taskStore.control.beforeWrite = async (table, args) => {
    if (table === 'aiTask') Object.assign(args.data, { scope: clone(scopes[2]), archivedAt: null });
  };
  let materialRows = [], taskInputs = [], taskPolicies = [], lostReply = false, materialWrites = 0;
  let bookingRows = { ai_client_booking_drafts: [], ai_client_booking_draft_operations: [], ai_client_booking_handoffs: [] };
  let loseBookingReply = false;
  let lostInputReply = false, lostTaskReply = false, revokeAfterClaim = false, commercialAvailable = true;
  const materialDb = (transactionRows, transactionInputs, transactionBookings, taskQuery = taskStore.db.$queryRaw) => {
    const rows = () => transactionRows ?? materialRows, inputs = () => transactionInputs ?? taskInputs;
    const bookings = () => transactionBookings ?? bookingRows;
    return { ...client.prisma,
      tenant: { ...client.prisma.tenant, findUnique: async () => ({ subscription: { startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01') }, subscriptionSegments: [] }) },
      $queryRaw: async query => {
        if (/FROM ai_(tasks|runs|task_input_requests)\b/u.test(query.sql)) return taskQuery(query);
        const bookingTable = query.sql.match(/FROM (ai_client_booking_\w+)\b/u)?.[1];
        if (bookingTable) {
          const [tenantId, workspaceId, channel, principalHash, reference] = query.values;
          const field = query.sql.includes('AND operationKey =') ? 'operationKey' : query.sql.includes('AND materialRef =') ? 'materialRef' : 'id';
          return structuredClone(bookings()[bookingTable].filter(row => row.tenantId === tenantId && row.workspaceId === workspaceId
            && row.channel === channel && row.principalHash === principalHash && row[field] === reference));
        }
        if (query.sql.includes('FROM ai_client_task_policies')) {
          const [tenantId, workspaceId, channel, customerType, sceneCode, sceneVersion] = query.values;
          return structuredClone(taskPolicies.filter(row => row.tenantId === tenantId && row.workspaceId === workspaceId
            && row.channel === channel && row.customerType === customerType && row.sceneCode === sceneCode && row.sceneVersion === sceneVersion));
        }
        const taskInput = query.sql.includes('FROM ai_client_task_inputs');
        assert.ok(taskInput || query.sql.includes('FROM ai_client_scene_materials'));
        const [tenantId, workspaceId, channel, principalHash, reference] = query.values;
        const field = taskInput ? 'creationKey' : query.sql.includes('AND operationKey =') ? 'operationKey' : 'id';
        return structuredClone((taskInput ? inputs() : rows()).filter(row => row.tenantId === tenantId && row.workspaceId === workspaceId
          && row.channel === channel && row.principalHash === principalHash && row[field] === reference));
      },
      $executeRaw: async query => {
        const bookingTable = query.sql.match(/(?:INSERT INTO|UPDATE) (ai_client_booking_\w+)\b/u)?.[1];
        if (bookingTable) {
          const table = bookings()[bookingTable];
          if (query.sql.startsWith('INSERT')) {
            const columns = query.sql.match(/\(([^)]+)\)\s+VALUES/u)[1].split(',').map(value => value.trim());
            const row = Object.fromEntries(columns.map((key, index) => [key, structuredClone(query.values[index])]));
            const scopeMatch = other => ['tenantId', 'workspaceId', 'channel', 'principalKind', 'principalHash'].every(key => other[key] === row[key]);
            const key = bookingTable === 'ai_client_booking_drafts' ? 'materialRef' : bookingTable === 'ai_client_booking_handoffs' ? 'draftId' : 'operationKey';
            assert.equal(table.some(other => other.id === row.id || (scopeMatch(other) && other[key] === row[key])), false);
            assert.ok((bookingTable === 'ai_client_booking_drafts' ? rows() : bookings().ai_client_booking_drafts)
              .some(other => scopeMatch(other) && other.id === (row.materialRef ?? row.draftId)));
            table.push(row); return 1;
          }
          const columns = query.sql.match(/SET ([\s\S]+?)\s+WHERE/u)[1].split(',').map(value => value.trim().split(' ')[0]);
          const conditions = [...query.sql.split('WHERE')[1].matchAll(/(\w+)\s*(=|>)\s*\?/gu)];
          const targets = table.filter(row => conditions.every(([_, field, operator], index) => {
            const value = query.values[columns.length + index];
            return operator === '=' ? row[field] === value : row[field] > value;
          }));
          for (const row of targets) columns.forEach((key, index) => { row[key] = structuredClone(query.values[index]); });
          return targets.length;
        }
        const taskInput = query.sql.startsWith('INSERT INTO ai_client_task_inputs');
        assert.ok(taskInput || query.sql.startsWith('INSERT INTO ai_client_scene_materials'));
        const columns = query.sql.match(/\(([^)]+)\)\s+VALUES/u)[1].split(',').map(value => value.trim());
        const row = Object.fromEntries(columns.map((key, index) => [key, structuredClone(query.values[index])]));
        if (!taskInput) for (const key of ['command', 'material', 'publication']) row[key] = JSON.parse(row[key]);
        const key = taskInput ? 'creationKey' : 'operationKey', table = taskInput ? inputs() : rows();
        assert.equal(table.some(current => current.tenantId === row.tenantId && current.workspaceId === row.workspaceId
          && current.channel === row.channel && current.principalHash === row.principalHash && current[key] === row[key]), false);
        table.push(row); if (!taskInput) materialWrites++; return 1;
      } };
  };
  const db = { ...taskStore.db, ...materialDb() }, activeTransaction = new AsyncLocalStorage();
  const taskProjection = client => ({ ...client.aiTask, findFirst: async args => {
    if (!args.select?.runs) return client.aiTask.findFirst(args);
    const row = await client.aiTask.findFirst({ ...args, select: undefined });
    if (!row) return null;
    row.runs = await client.aiRun.findMany({ where: { taskId: row.id, sequence: 1 }, take: 1 });
    return row;
  } });
  db.aiTask = taskProjection(taskStore.db);
  const scopeUpsert = async ({ where }) => clone(scopes.find(scope => scope.scopeKey === where.scopeKey));
  db.aiScope = { ...db.aiScope, upsert: scopeUpsert };
  let transactionTail = Promise.resolve();
  db.$transaction = work => {
    if (activeTransaction.getStore()) return work(activeTransaction.getStore());
    const pending = transactionTail.then(async () => {
      const rows = structuredClone(materialRows), inputs = structuredClone(taskInputs), bookings = structuredClone(bookingRows);
      const priorInputs = inputs.length, priorTasks = taskStore.state.aiTask.length;
      const priorOperations = bookings.ai_client_booking_draft_operations.length;
      const result = await taskStore.db.$transaction(tx => {
        const current = { ...tx, ...materialDb(rows, inputs, bookings, tx.$queryRaw), aiTask: taskProjection(tx), aiScope: { ...tx.aiScope, upsert: scopeUpsert } };
        return activeTransaction.run(current, () => work(current));
      });
      materialRows = rows; taskInputs = inputs; bookingRows = bookings;
      if (revokeAfterClaim && inputs.length > priorInputs) taskPolicies[0].allowCreate = false;
      if ((lostInputReply && inputs.length > priorInputs) || (lostTaskReply && taskStore.state.aiTask.length > priorTasks)) throw Error('synthetic client task COMMIT response lost');
      if (loseBookingReply && bookings.ai_client_booking_draft_operations.length > priorOperations) throw Error('synthetic booking COMMIT response lost');
      if (lostReply) throw Error('synthetic material COMMIT response lost');
      return result;
    });
    transactionTail = pending.catch(() => {});
    return pending;
  };
  const dependencies = { guard, client, db, clock: () => now };
  const configuration = { enabled: true, tenantCode: 'tenant', serviceCode: 'camera', channel: 'app' };
  const requests = composeRequestBoundClientApplication(dependencies, configuration), request = { headers: { authorization } };
  let operation = 0;
  const prepare = (req, command) => requests.prepare(req, { operationKey: `client-operation-${++operation}`, command });
  assert.throws(() => composeRequestBoundClientApplication({ ...dependencies, session: source }, configuration), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  const help = await requests.readPublic({ headers: {} }, { kind: 'help' });
  assert.equal(help.material.intro, 'Public help only'); assert.ok(Object.isFrozen(help.material));
  assert.equal(help.materialRef, null); assert.equal(materialRows.length, 0);
  rateAllowed = false;
  await assert.rejects(requests.readPublic({ headers: {} }, { kind: 'help' }), /client policy unavailable/);
  rateAllowed = true;
  assert.equal((await requests.readPublic({ headers: {} }, { kind: 'catalog' })).material.workspace.workspaceCode, 'camera');
  await assert.rejects(prepare({ headers: {} }, { kind: 'help' }), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  await assert.rejects(prepare({ headers: {} }, { kind: 'profile' }), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  await assert.rejects(prepare(request, { kind: 'order', orderId: 'own-order', tenantId: 'forged' }), /AI_CLIENT_INVALID_INPUT/);
  const own = await prepare(request, { kind: 'order', orderId: 'own-order' });
  assert.equal(own.material.internalNote, undefined);
  const clientExplanation = await requests.readOrderExplanation(request, { orderId: 'own-order', question: 'fees' });
  assert.equal(clientExplanation.facts.inspectionFees.value.items[0].amount, 12);
  assert.equal(clientExplanation.facts.inspectionFees.value.items[0].responseStatus, 'pending');
  assert.equal(JSON.stringify(clientExplanation).includes('private-'), false);
  const originalFees = client.feeItems;
  client.feeItems = undefined;
  const missingFees = await requests.readOrderExplanation(request, { orderId: 'own-order', question: 'fees' });
  assert.equal(missingFees.facts.inspectionFees.coverage, 'unavailable');
  assert.equal(missingFees.facts.amounts.payableAmount.value, 0);
  client.feeItems = async (...args) => ({ ...await originalFees(...args), orderId: 'another-order' });
  await assert.rejects(requests.readOrderExplanation(request, { orderId: 'own-order', question: 'fees' }), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  client.feeItems = originalFees;
  const cancelPreview = await requests.readOrderCancellationPreview(request, { orderId: 'own-order' });
  assert.equal(cancelPreview.preview.cancellationCharge, 12);
  assert.equal(cancelPreview.handoff.execution, 'not_attempted');
  assert.equal(cancelPreview.businessResult, 'not_inferred');
  const explanation = await requests.readOrderExplanation(request, { orderId: 'own-order', question: 'fees' });
  assert.equal(explanation.facts.amounts.payableAmount.value, 0);
  assert.equal(explanation.facts.amounts.depositAmount.coverage, 'unknown');
  assert.equal(explanation.facts.gaps.payments, 'not_loaded_no_received_total_inferred');
  assert.equal(explanation.facts.customerName, undefined); assert.equal(explanation.facts.internalNote, undefined);
  assert.equal((await requests.readOrderExplanation(request, { orderId: 'own-order' })).facts.amounts, undefined);
  await assert.rejects(requests.readOrderExplanation(request, { orderId: 'other-order' }), e => e.getStatus?.() === 404);
  await assert.rejects(requests.readOrderExplanation(request, { orderId: 'own-order', question: 'sql' }), /AI_CLIENT_INVALID_INPUT/);
  revokeDuringRead = true;
  await assert.rejects(requests.readOrderExplanation(request, { orderId: 'own-order' }), e => e.getStatus?.() === 401);
  revoked = false; revokeDuringRead = false;
  assert.equal(own.durability, 'persisted_client_material_not_task_history');
  const restarted = composeRequestBoundClientApplication(dependencies, configuration);
  assert.equal((await restarted.readSource(request, { materialRef: own.materialRef })).materialHash, own.materialHash);
  const originalCommand = { operationKey: own.operationKey, command: { kind: 'order', orderId: 'own-order' } };
  await assert.rejects(restarted.readOperation({ headers: {} }, originalCommand), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  const beforeReplay = materialWrites;
  assert.equal((await restarted.prepare(request, originalCommand)).replayed, true);
  assert.equal(materialWrites, beforeReplay);
  await assert.rejects(restarted.prepare(request, { ...originalCommand, command: { kind: 'profile' } }), e => e.code === 'AI_CLIENT_REVISION_CONFLICT');
  const missing = await restarted.readOperation(request, { ...originalCommand, operationKey: 'not-observed' });
  assert.equal(missing.state, 'unknown'); assert.equal(missing.retryable, false);
  const lostCommand = { ...originalCommand, operationKey: 'client-ack' };
  lostReply = true;
  await assert.rejects(restarted.prepare(request, lostCommand), e => e.code === 'AI_CLIENT_RESULT_UNKNOWN' && e.nextAction === 'readOperation');
  lostReply = false;
  const afterLost = materialWrites, recovered = await requests.readOperation(request, lostCommand);
  assert.equal(recovered.state, 'saved'); assert.equal(materialWrites, afterLost);
  assert.equal((await restarted.readSource(request, { materialRef: recovered.materialRef })).materialHash, recovered.materialHash);
  const distinctCase = await restarted.prepare(request, { ...lostCommand, operationKey: 'CLIENT-ACK' });
  assert.notEqual(distinctCase.materialRef, recovered.materialRef);
  assert.equal(materialRows.some(row => row.principalKind === 'guest'), false);
  assert.equal(JSON.stringify(materialRows).includes(authorization), false);
  assert.equal(JSON.stringify(materialRows).includes('session-client'), false);
  assert.equal((await prepare(request, { kind: 'profile' })).material.internalReview, undefined);
  const preview = await prepare(request, { kind: 'cancellation_preview', orderId: 'own-order' });
  assert.equal(preview.material.cancellationCharge, 12); assert.equal(preview.material.estimated, true);
  assert.equal(preview.handoff.path, '/api/client/v1/orders/own-order/cancel'); assert.equal(preview.handoff.execution, 'not_attempted');
  assert.equal((await requests.readSource(request, { materialRef: preview.materialRef })).materialHash, preview.materialHash);
  await assert.rejects(prepare(request, { kind: 'order', orderId: 'other-order' }), e => e.getStatus?.() === 404);
  const subscriptions = { readCategoryCommercialContext: async (tenantId, _tx, _now, features) => {
    assert.equal(tenantId, 'tenant-client'); assert.deepEqual(features, ['ai.native.use']);
    return { revision: 1, serviceStatus: 'active', newBusinessAllowed: true,
      entitlements: [{ code: 'ai.native.use', available: commercialAvailable, categories: [] }] };
  } };
  const taskDependencies = { ...dependencies, tasks: { db, subscriptions, sceneCode, sceneVersion } };
  const clientTasks = composeRequestBoundClientApplication(taskDependencies, configuration);
  const taskCommand = { creationKey: 'client-create-1', materialRef: own.materialRef };
  await assert.rejects(clientTasks.createTask({ headers: {} }, taskCommand), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  await assert.rejects(clientTasks.createTask(request, { ...taskCommand, sceneCode: 'forged' }), /AI_CLIENT_INVALID_INPUT/);
  await assert.rejects(clientTasks.createTask(request, taskCommand), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(taskInputs.length, 0); assert.equal(taskStore.state.aiTask.length, 0);
  taskPolicies.push({ id: 'b77ec266-e3a2-48a4-98be-d5b49222d5b1', tenantId: 'tenant-client', workspaceId: 'workspace-client',
    channel: 'app', customerType: 'personal', sceneCode, sceneVersion, enabled: 1, allowCreate: 1, allowRead: 1, allowExecute: 1,
    revision: 1, expiresAt: new Date('2027-01-01') });
  taskPolicies[0].allowCreate = 0;
  await assert.rejects(clientTasks.createTask(request, taskCommand), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal((await clientTasks.readTaskCreation(request, taskCommand)).state, 'unknown');
  taskPolicies[0].allowCreate = 1;
  taskStore.state.aiBudgetPolicy[0].enabled = false;
  await assert.rejects(clientTasks.createTask(request, taskCommand), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  taskStore.state.aiBudgetPolicy[0].enabled = true;
  taskStore.state.aiBudgetPolicy[2].settingsJson.maxConcurrent = 0;
  await assert.rejects(clientTasks.createTask(request, taskCommand), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  taskStore.state.aiBudgetPolicy[2].settingsJson.maxConcurrent = 1;
  commercialAvailable = false;
  await assert.rejects(clientTasks.createTask(request, taskCommand), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  commercialAvailable = true;
  assert.equal(taskInputs.length, 0);
  const created = await clientTasks.createTask(request, taskCommand);
  assert.equal(created.state, 'observed'); assert.equal(created.task.status, 'queued');
  assert.equal(taskStore.state.aiTask.length, 1); assert.equal(taskStore.state.aiRun.length, 1);
  assert.equal(taskStore.state.aiTask[0].ownerKind, 'CUSTOMER'); assert.equal(taskStore.state.aiTask[0].ownerId, 'person-client');
  assert.equal(taskStore.state.aiTask[0].audience, 'CLIENT'); assert.equal(taskStore.state.aiTask[0].inputRef, taskInputs[0].id);
  assert.equal(taskStore.state.aiTask[0].inputHash, taskInputs[0].inputHash);
  assert.equal(taskStore.state.aiRun[0].fencingToken.toFixed(0), '0'); assert.equal(taskInputs[0].dispatchState, 'UNKNOWN');
  const countCreates = () => taskStore.trace.filter(value => value === 'aiTask.create').length;
  const { composePersistedClientTaskAuthorization } = require('../apps/api/src/modules/ai-native/scenes/client-task-execution.composition');
  const loadExecutionMaterial = async materialRef => {
    await clientTasks.readSource(request, { materialRef });
    return { row: clone(materialRows.find(row => row.id === materialRef)), identity: await source.current() };
  };
  const executionAuthorization = composePersistedClientTaskAuthorization(taskDependencies.tasks, taskCommand, loadExecutionMaterial, () => now);
  const { composeClientTaskModelConfiguration } = require('../apps/api/src/modules/ai-native/scenes/client-task-model-configuration.composition');
  let configReads = 0;
  const unusedWrite = async () => { throw Error('configuration writes are forbidden'); };
  const customerConfigDb = { ...db,
    operationLog: { create: unusedWrite, findUnique: async () => null },
    aiTenantModelConfiguration: { findUnique: async query => {
      assert.equal(query.where.tenantId, 'tenant-client'); configReads++;
      // Explicit service enablement: the hardened product contract requires
      // serviceEnabled/settings.enabled for invoke selection (default-disabled).
      return { tenantId: 'tenant-client', mode: 'platform_managed', revision: 1, serviceEnabled: true, settings: null, credentialsEncrypted: null };
    }, create: unusedWrite, updateMany: unusedWrite },
    aiProviderProfile: { findFirst: async () => null, create: unusedWrite, updateMany: unusedWrite },
    systemParameterSet: { findFirst: async () => null } };
  const customerConfiguration = await composeClientTaskModelConfiguration({ ...taskDependencies.tasks,
    db: customerConfigDb,
    secrets: { encrypt: () => { throw Error('no credential operation'); }, decrypt: () => { throw Error('no credential operation'); } },
    loadMaterial: loadExecutionMaterial, clock: () => now }, taskCommand);
  const customerConfigContext = { tenantId: 'tenant-client', workspaceId: 'workspace-client', actorId: 'person-client' };
  // Seed only the database running state; the actual original-material/current
  // policy authority and config repository are executed, not a fake grant.
  const priorTaskStatus = taskStore.state.aiTask[0].status;
  await assert.rejects(customerConfiguration.configuration.selectionForInvocation(customerConfigContext));
  assert.equal(configReads, 0);
  taskStore.state.aiTask[0].status = 'RUNNING';
  try {
    const authorizedContext = await executionAuthorization.execution.authorize(created.task.taskId);
    customerConfigContext.workspaceId = authorizedContext.scope.workspaceId;
    assert.deepEqual(await customerConfiguration.configuration.selectionForInvocation(customerConfigContext), { mode: 'platform_managed', revision: 1 });
    const profile = { id: 'client-profile', scopeId: scopes[0].id, scopeKind: 'PLATFORM', profileKey: 'default',
      role: 'DEFAULT', serviceMode: 'platform_managed', protocol: 'openai_chat_completions', provider: 'openai_chat_completions',
      model: 'synthetic-model', credentialRef: 'vault-original', configRevision: 1, enabled: true, disabledAt: null, allowedCapabilities: ['text'] };
    customerConfigDb.aiProviderProfile.findMany = async () => [clone(profile)];
    customerConfigDb.aiProviderCapabilityEvidence = { findMany: async () => [], findUnique: async () => null, upsert: unusedWrite };
    const blockedTransport = { provider: 'openai_chat_completions', features: ['text'], generate: unusedWrite };
    const gatewayServer = { db: customerConfigDb, routeScene: 'chat', callPriceVersion: 'customer-original-calls-1',
      adapters: [blockedTransport], platformConnection: { resolve: unusedWrite }, audit: { append: unusedWrite } };
    assert.throws(() => customerConfiguration.createCallGateway({ ...gatewayServer, db: {} }), e => e.code === 'CONFIG_INVALID');
    const beforeGatewayWrites = taskStore.trace.length;
    const configured = customerConfiguration.createCallGateway(gatewayServer);
    customerConfigDb.aiPlatformModelConnection = { findUnique: async () => null };
    const { platformConnection: _externalConnection, ...persistedServer } = gatewayServer;
    const persistedGateway = customerConfiguration.createPersistedCallGateway(persistedServer);
    assert.equal(persistedGateway.runtime.ports.budget.constructor.name, 'PersistentGatewayBudget');
    await assert.rejects(persistedGateway.runtime.ports.routing.resolve(customerConfigContext, ['text']),
      e => e.code === 'CAPABILITY_UNSUPPORTED');
    assert.equal(configured.runtime.evidence, 'live');
    assert.equal(configured.callPriceVersion, 'customer-original-calls-1');
    assert.equal(configured.runtime.ports.budget.constructor.name, 'PersistentGatewayBudget');
    assert.equal(configured.runtime.ports.admission.constructor.name, 'InvocationAdmissionService');
    assert.equal(configured.runtime.ports.dispatch.constructor.name, 'InvocationDispatchService');
    // Real router + persisted capability consumer reject absent live receipts;
    // this does not make a mock profile into a verified supplier.
    await assert.rejects(configured.runtime.ports.routing.resolve(customerConfigContext, ['text']),
      e => e.code === 'CAPABILITY_UNSUPPORTED');
    assert.equal(taskStore.trace.slice(beforeGatewayWrites).some(value => /\.create|\.update/.test(value)), false);
    await assert.rejects(customerConfiguration.configuration.selection(customerConfigContext), e => e.code === 'FORBIDDEN');
    await assert.rejects(customerConfiguration.configuration.selectionForInvocation({ ...customerConfigContext, actorId: 'another-customer' }), e => e.code === 'FORBIDDEN');
    taskPolicies[0].allowExecute = 0;
    await assert.rejects(customerConfiguration.configuration.selectionForInvocation(customerConfigContext), e => e.code === 'FORBIDDEN');
  } finally { taskPolicies[0].allowExecute = 1; taskStore.state.aiTask[0].status = priorTaskStatus; }
  const { PrismaClientTaskBudgetAuthorizationSource } = require('../apps/api/src/modules/ai-native/budget/prisma-client-task-budget-authorization.source');
  const customerBudgetAuthority = new PrismaClientTaskBudgetAuthorizationSource({ ...taskDependencies.tasks,
    db: { ...taskDependencies.tasks.db, aiGatewayInvocation: { findUnique: async () => null } },
    command: taskCommand, loadMaterial: loadExecutionMaterial, clock: () => now });
  const customerBudgetContext = await customerBudgetAuthority.resolveContext();
  await assert.rejects(customerBudgetAuthority.authorize('settings', customerBudgetContext, {}), e => e.code === 'FORBIDDEN');
  await assert.rejects(customerBudgetAuthority.authorize('reserve', customerBudgetContext,
    { association: { requestId: 'missing-original-invocation', scope: customerBudgetContext.scope } }), e => e.code === 'FORBIDDEN');
  await (async authorization => {
    assert.equal((await authorization.scopes.resolveCurrent()).context.actor.customerId, 'person-client');
    const claim = { taskId: created.task.taskId, runId: created.task.runId, holderId: 'client-worker',
      expectedTaskRevision: 1, expectedRunRevision: 1, expectedFencingToken: '0', leaseMs: 1000 };
    delete taskPolicies[0].allowExecute;
    await assert.rejects(authorization.tasks.claimRun(claim), e => e.code === 'AI_ACCESS_DENIED');
    taskPolicies[0].allowExecute = 1;
    await assert.rejects(authorization.authority.resolve('another-task', 'read_metadata'), e => e.code === 'AI_ACCESS_DENIED');
    await assert.rejects(authorization.authority.resolve(created.task.taskId, 'takeover_run'), e => e.code === 'AI_ACCESS_DENIED');
    assert.equal((await authorization.authority.resolve(created.task.taskId, 'transition_task')).actor.kind, 'customer');
    await assert.rejects(authorization.execution.authorize(created.task.taskId), e => e.code === 'AI_ACCESS_DENIED');
    const lease = await authorization.tasks.claimRun(claim);
    assert.equal(lease.fencingToken, '1'); assert.equal(taskStore.state.aiRun[0].actorKind, 'CUSTOMER');
    taskPolicies[0].allowExecute = 0;
    await assert.rejects(authorization.execution.authorize(created.task.taskId), e => e.code === 'AI_ACCESS_DENIED');
    const { composeClientOriginalTaskModelHost } = require('../apps/api/src/modules/ai-native/scenes/client-task-model-host.composition');
    await assert.rejects(composeClientOriginalTaskModelHost({ db, subscriptions, clientScene: { sceneCode, sceneVersion },
      loadMaterial: loadExecutionMaterial, systemPrompt: 'Explain only the original authorized facts.', clock: () => now,
      gatewayScene: { sceneCode, routeScene: 'chat', maxOutputTokens: 32 },
      limits: { maxSteps: 1, maxCalls: 1, maxConcurrent: 1, maxTotalMs: 1000, maxStepMs: 1000, maxOutputBytes: 1024 },
      host: { holderId: 'client-model-worker', leaseMs: 1000 } }, taskCommand), e => e.code === 'AI_ACCESS_DENIED');
    const { leaseMs: _leaseMs, ...release } = claim;
    assert.equal((await authorization.tasks.releaseRun({ ...release,
      expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken })).released, true);
    taskPolicies[0].allowExecute = 1;
  })(executionAuthorization);
  const originalStatus = taskStore.state.aiTask[0].status;
  taskStore.state.aiTask[0].status = 'RUNNING';
  await assert.rejects(executionAuthorization.authority.resolve(created.task.taskId, 'request_input'), e => e.code === 'AI_ACCESS_DENIED');
  taskStore.state.aiTask[0].status = 'WAITING_INPUT';
  for (const operation of ['submit_input', 'resume_input'])
    await assert.rejects(executionAuthorization.authority.resolve(created.task.taskId, operation), e => e.code === 'AI_ACCESS_DENIED');
  taskPolicies[0].allowSubmitInput = 1;
  assert.equal((await executionAuthorization.authority.resolve(created.task.taskId, 'submit_input')).actor.customerId, 'person-client');
  await assert.rejects(executionAuthorization.authority.resolve(created.task.taskId, 'resume_input'), e => e.code === 'AI_ACCESS_DENIED');
  taskPolicies[0].allowResumeInput = 1; taskPolicies[0].allowExecute = 0;
  assert.equal((await executionAuthorization.authority.resolve(created.task.taskId, 'resume_input')).actor.kind, 'customer');
  await assert.rejects(executionAuthorization.execution.authorize(created.task.taskId), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(executionAuthorization.authority.resolve('another-task', 'submit_input'), e => e.code === 'AI_ACCESS_DENIED');
  taskStore.state.aiTask[0].cancelRequestedAt = now;
  await assert.rejects(executionAuthorization.authority.resolve(created.task.taskId, 'resume_input'), e => e.code === 'AI_ACCESS_DENIED');
  taskStore.state.aiTask[0].cancelRequestedAt = null; taskStore.state.aiTask[0].status = originalStatus;
  taskPolicies[0].allowExecute = 1;
  delete taskPolicies[0].allowSubmitInput; delete taskPolicies[0].allowResumeInput;
  const { AI_TASK_INPUT_DRAFT_VERSION } = require('../packages/shared/src');
  await assert.rejects(clientTasks.resumeOriginalTaskModel(request, taskCommand, {
    draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: created.task.taskId, requestId: 'question', expectedRevision: 1,
    submissionKey: 'answer', answers: [{ fieldId: 'clarification_text', value: 'answer' }] }, {}), e => e.code === 'AI_INVALID_INPUT');
  const readSource = { db, gatewayScene: { sceneCode, routeScene: 'chat', maxOutputTokens: 32 },
    inputSource: { resolve: async () => { throw Error('no question should be read for a queued task'); },
      validateAnswers: async () => { throw Error('read never validates/submits answers'); } } };
  const priorInputReadState = clone(taskStore.state), beforeInputReadWrites = taskStore.trace.length;
  await assert.rejects(clientTasks.readOriginalTaskModelInput(request, taskCommand, readSource), e => e.reason === 'entry_disabled');
  const { composeClientOriginalTaskInputReader } = require('../apps/api/src/modules/ai-native/scenes/client-task-model-host.composition');
  const inputReader = await composeClientOriginalTaskInputReader({ ...readSource, subscriptions,
    clientScene: { sceneCode, sceneVersion }, loadMaterial: loadExecutionMaterial, clock: () => now }, taskCommand);
  assert.equal(await inputReader.readPending(), null);
  assert.deepEqual(taskStore.state, priorInputReadState);
  assert.equal(taskStore.trace.slice(beforeInputReadWrites).some(item => /\.create|\.update/.test(item)), false);
  await assert.rejects(clientTasks.readOriginalTaskModelInput(request, taskCommand, { ...readSource, db: {} }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(clientTasks.readOriginalTaskModelInputReceipt(request, taskCommand, {
    draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: 'forged-task', requestId: 'question', expectedRevision: 1,
    submissionKey: 'answer', answers: [{ fieldId: 'clarification_text', value: 'answer' }] }, readSource), e => e.code === 'AI_INVALID_INPUT');
  // An enabled customer gate alone cannot supply a model plan or its limits.
  // These failures occur before model publication, lease claim or transport.
  const { composeClientOriginalTaskModelHost: composeClientModel } = require('../apps/api/src/modules/ai-native/scenes/client-task-model-host.composition');
  let planRow = null, planReads = 0;
  const planDb = { ...db, aiTaskPlanPolicy: { findFirst: async ({ where }) => {
    planReads++; assert.equal(where.scopeId, scopes[2].id); assert.equal(where.sceneCode, sceneCode);
    return clone(planRow);
  } } };
  const modelInput = { db: planDb, subscriptions, clientScene: { sceneCode, sceneVersion },
    loadMaterial: loadExecutionMaterial, systemPrompt: 'Explain original authorized facts only.', clock: () => now,
    gatewayScene: { sceneCode, routeScene: 'chat', maxOutputTokens: 32 }, host: { holderId: 'client-model-worker', leaseMs: 1000 } };
  const beforeModelWrites = taskStore.trace.length;
  await assert.rejects(composeClientModel(modelInput, taskCommand), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(planReads, 1);
  const planLimits = { maxSteps: 2, maxCalls: 2, maxConcurrent: 1, maxTotalMs: 2000, maxStepMs: 1000, maxOutputBytes: 2048 };
  planRow = { scopeId: scopes[2].id, sceneCode, sceneVersion, revision: 1, enabled: false, limits: planLimits,
    allowedTools: [{ code: require('../apps/api/src/modules/ai-native/model-input/task-model-input').TASK_TEXT_MODEL_TOOL,
      version: require('../packages/shared/src').AI_TOOL_DRAFT_VERSION }], expiresAt: new Date(now.getTime() + 60000) };
  await assert.rejects(composeClientModel(modelInput, taskCommand), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  planRow.enabled = true;
  await assert.rejects(composeClientModel({ ...modelInput, limits: { ...planLimits, maxCalls: 3 } }, taskCommand),
    e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(taskStore.trace.slice(beforeModelWrites).some(value => /\.create|\.update/.test(value)), false);
  const { AI_ENTRY_ACTION_CONTRACT_VERSION } = require('../packages/shared/src/ai-entry-action-draft');
  const entryConfig = { ...configuration, channel: 'web', entry: { enabled: true, releaseRevision: 'entry-1' } };
  client.prisma.websiteChannelProfile = { findUnique: async () => null };
  taskPolicies.push({ ...taskPolicies[0], channel: 'web', id: '70156b36-e02f-4aba-9f41-54d850bc1bdb' });
  const entry = composeRequestBoundClientApplication(taskDependencies, entryConfig);
  const entryMaterial = await entry.prepare(request, { operationKey: 'entry-order', command: { kind: 'order', orderId: 'own-order' } });
  const issued = await entry.issueAction(request, { actionCode: 'OPEN_ORDER', materialRef: entryMaterial.materialRef });
  assert.equal(issued.contractVersion, AI_ENTRY_ACTION_CONTRACT_VERSION);
  assert.equal(issued.surface, 'tenant_website'); assert.equal(issued.audience, 'customer');
  assert.equal(issued.resource.resourceVersion, entryMaterial.materialHash);
  const entryRestart = composeRequestBoundClientApplication(taskDependencies, entryConfig);
  assert.deepEqual(await entryRestart.readAction(request, issued), issued);
  const beforeActionReplay = materialWrites;
  assert.equal((await entryRestart.consumeOrderAction(request, issued)).orderId, 'own-order');
  assert.equal((await entryRestart.consumeOrderAction(request, issued)).execution, 'navigation_not_business_submission');
  assert.equal(materialWrites, beforeActionReplay); assert.equal(countCreates(), 1);
  for (const altered of [{ ...issued, url: 'javascript:alert(1)' }, { ...issued, contractVersion: 'unknown' },
    { ...issued, actionCode: 'OPEN_PAYMENT' }, { ...issued, surface: 'client_miniprogram' },
    { ...issued, resource: { ...issued.resource, id: 'other-order' } }]) await assert.rejects(entryRestart.readAction(request, altered));
  await assert.rejects(requests.readAction(request, issued), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  taskStore.state.aiBudgetPolicy[0].enabled = false;
  await assert.rejects(entry.readAction(request, issued), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  taskStore.state.aiBudgetPolicy[0].enabled = true;
  taskPolicies[1].revision++;
  await assert.rejects(entry.readAction(request, issued), e => ['AI_ACCESS_DENIED', 'AI_PROPOSAL_STALE'].includes(e.code));
  taskPolicies[1].revision--;
  revokeDuringRead = true; await assert.rejects(entry.readAction(request, issued));
  revoked = false; revokeDuringRead = false;
  const taskRestart = composeRequestBoundClientApplication(taskDependencies, configuration), beforeDuplicate = countCreates();
  let bookingAvailable = true, stockObservation = 5, corporateAllowed = true;
  const bookingSelection = { quoteId: 'quote-client', timeZone: 'Asia/Shanghai',
    startAt: new Date(now.getTime() + 86400000).toISOString(), endAt: new Date(now.getTime() + 172800000).toISOString(),
    fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'location-client',
    bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false }, lines: [{ itemGroupId: 'item-client', quantity: 1 }] };
  let bookingQuote = { id: 'quote-client', tenantId: 'tenant-client', categoryCode: 'camera',
    request: { ...bookingSelection, customerType: 'personal', customerId: 'person-client' },
    membershipSnapshot: { bookingIdentity: 'personal', personalCustomerId: 'person-client', enterpriseContractAndPayer: false },
    pricingContext: { timeZone: 'Asia/Shanghai' }, pricingPlanVersion: 'prices-1', ruleVersion: 'rules-1', currency: 'CNY',
    payableAmount: 12, depositAmount: 0, preAuthAmount: 0, chargeLines: [{ type: 'rental', amount: 12 }],
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600000).toISOString() };
  client.auth = auth;
  auth.listPublicWorkspaces = async () => ({ workspaces: [{ ...workspace }] });
  client.memberships = { listBookingOptions: async () => corporateAllowed ? [{ corporateCustomerId: 'corporate-client',
    corporateCustomerName: 'Synthetic Corp', corporateMembershipId: 'relation-client' }] : [] };
  client.buildCatalog = async (_tenant, tenantCode, summary) => ({ tenantCode, workspace: summary, categoryCode: 'camera',
    timeZone: 'Asia/Shanghai', items: [{ id: 'item-client', code: 'item', name: 'Synthetic Item' }], pricingGroups: [], services: [],
    locations: [{ id: 'location-client', code: 'loc', name: 'Synthetic Location', status: 'enabled', capabilities: ['pickup', 'return'] }],
    fulfillment: { enabledModes: ['store_pickup_return'], allowDifferentReturnLocation: false, deliveryDestination: 'customer_address' } });
  client.business.getQuote = (_tenant, _context, id) => ({ ...structuredClone(bookingQuote), id,
    request: { ...structuredClone(bookingQuote.request), customerId: id === 'foreign-quote' ? 'someone-else' : 'person-client' } });
  client.core.availability = async (_tenant, command) => ({ ...command, available: bookingAvailable,
    lines: command.lines.map(line => ({ itemGroupId: line.itemGroupId, requestedQuantity: line.quantity,
      available: bookingAvailable, availableQuantity: stockObservation, reasons: [] })) });
  const bookingApp = composeRequestBoundClientApplication(taskDependencies, entryConfig);
  const { AiClientEntryModule } = require('../apps/api/src/modules/ai-native/scenes/client-entry.module');
  const { AiClientEntryController } = require('../apps/api/src/modules/ai-native/scenes/client-entry.controller');
  const { AI_CLIENT_ENTRY_HTTP_DRAFT } = require('../packages/shared/src/ai-entry-http-draft');
  assert.deepEqual(Reflect.getMetadata('controllers', AiClientEntryModule) ?? [], []);
  const entryModule = AiClientEntryModule.registerHttp(taskDependencies, entryConfig);
  assert.deepEqual(entryModule.controllers, [AiClientEntryController]);
  assert.throws(() => AiClientEntryModule.registerHttp(dependencies, entryConfig).providers[0].useFactory(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.throws(() => AiClientEntryModule.registerHttp(taskDependencies, configuration).providers[0].useFactory(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  const bookingHttp = new AiClientEntryController(entryModule.providers[0].useFactory());
  for (const method of ['readHostCapabilities', 'issueAction', 'createBookingDraft', 'chooseBookingDraft', 'readBookingDraft',
    'handoffBookingDraft', 'readBookingHandoff', 'readBookingOperation',
    'acceptBookingSubmission', 'submitAcceptedBooking', 'readBookingSubmission', 'requestTaskCancellation', 'reconcileTaskInputCancellation',
    'readTaskInput', 'submitTaskInput', 'readTaskInputReceipt', 'startTaskModel', 'recoverTaskModel', 'reconcileTaskModel', 'continueTaskInput',
    'readTaskModelResult']) {
    assert.equal(Reflect.getMetadata('path', AiClientEntryController.prototype[method]), AI_CLIENT_ENTRY_HTTP_DRAFT[method]);
  }
  const { aiClientHostCapabilitiesSchema } = require('../packages/shared/src/ai-client-entry-draft-schemas');
  const hostWrites = materialWrites, hostTasks = countCreates();
  const host = await bookingHttp.readHostCapabilities(request, {});
  assert.equal(aiClientHostCapabilitiesSchema.safeParse(host).success, true);
  const { AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS } = require('../packages/shared/src/ai-entry-management-draft-schemas');
  assert.equal(ajv.compile(AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS.AiClientHostCapabilities)(host), true);
  assert.ok(require('../apps/api/src/contracts/ai-leaf-components').AI_LEAF_COMPONENT_SCHEMAS.AiClientHostCapabilities);
  assert.equal(host.enabled, true); assert.equal(host.surface, 'tenant_website');
  assert.equal(host.customerId, 'person-client'); assert.equal(host.scope.workspaceId, 'workspace-client');
  assert.equal(host.policy.revision, taskPolicies[1].revision); assert.equal(host.releaseRevision, 'entry-1');
  assert.ok(Date.parse(host.expiresAt) <= taskPolicies[1].expiresAt.getTime());
  assert.deepEqual(host.capabilities.entryActions, ['OPEN_ORDER', 'CREATE_BOOKING_DRAFT', 'OPEN_BOOKING']);
  assert.equal(host.capabilities.savedDeliveryAddresses, false);
  assert.equal(host.authorization, 'observation_only_recheck_each_action');
  assert.equal(host.sessionId, undefined); assert.equal(host.phone, undefined);
  await assert.rejects(bookingHttp.readHostCapabilities(request, { materialRef: own.materialRef, enabled: true }), e => e.getStatus() === 400);
  await assert.rejects(bookingHttp.readHostCapabilities({ headers: {} }, {}), e => e.getStatus() === 403);
  await assert.rejects(requests.readHostCapabilities(request, {}), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  for (const key of ['enabled', 'allowRead']) {
    taskPolicies[1][key] = 0;
    await assert.rejects(bookingHttp.readHostCapabilities(request, {}), e => e.getStatus() === 403);
    taskPolicies[1][key] = 1;
  }
  taskPolicies[1].allowCreate = 0;
  const readOnlyHost = await bookingHttp.readHostCapabilities(request, {});
  assert.equal(readOnlyHost.enabled, false); assert.deepEqual(readOnlyHost.capabilities.entryActions, []);
  taskPolicies[1].allowCreate = 1;
  const policyExpiry = taskPolicies[1].expiresAt; taskPolicies[1].expiresAt = new Date(now);
  await assert.rejects(bookingHttp.readHostCapabilities(request, {}), e => e.getStatus() === 403);
  taskPolicies[1].expiresAt = policyExpiry;
  const ownGetQuote = client.getQuote; client.getQuote = undefined;
  assert.deepEqual((await bookingHttp.readHostCapabilities(request, {})).capabilities.entryActions, ['OPEN_ORDER']);
  client.getQuote = ownGetQuote;
  // Host-capability reads authorize 'read', which deliberately never consults
  // budget gates or the commercial entitlement: exhausted usage must not hide
  // the host surface or force an existing task to stay. The creation entry
  // actions still require live gates and degrade to an empty listing.
  taskStore.state.aiBudgetPolicy[1].enabled = false;
  commercialAvailable = false;
  assert.deepEqual((await bookingHttp.readHostCapabilities(request, {})).capabilities.entryActions, []);
  taskStore.state.aiBudgetPolicy[1].enabled = true;
  commercialAvailable = true;
  assert.deepEqual((await bookingHttp.readHostCapabilities(request, {})).capabilities.entryActions,
    ['OPEN_ORDER', 'CREATE_BOOKING_DRAFT', 'OPEN_BOOKING']);
  const commercialRead = subscriptions.readCategoryCommercialContext;
  subscriptions.readCategoryCommercialContext = async (...args) => {
    const value = await commercialRead(...args); taskPolicies[1].revision++; return value;
  };
  await assert.rejects(bookingHttp.readHostCapabilities(request, {}), e => e.getStatus() === 403);
  taskPolicies[1].revision = host.policy.revision;
  subscriptions.readCategoryCommercialContext = async (...args) => {
    const value = await commercialRead(...args); revoked = true; return value;
  };
  await assert.rejects(bookingHttp.readHostCapabilities(request, {}), e => e.getStatus() === 403);
  revoked = false; subscriptions.readCategoryCommercialContext = commercialRead;
  published = false;
  await assert.rejects(bookingHttp.readHostCapabilities(request, {}), e => e.getStatus() === 403);
  published = true;
  assert.equal(materialWrites, hostWrites); assert.equal(countCreates(), hostTasks);
  await assert.rejects(bookingHttp.readBookingOperation({ headers: {} }, { operationKey: 'not-owned' }),
    e => e.getStatus() === 403 && e.getResponse().code === 'AI_ACCESS_DENIED');
  const makeBookingAction = async (key, application = bookingApp, selection = bookingSelection) => {
    const material = await application.prepare(request, { operationKey: key, command: { kind: 'booking_quote', selection } });
    return application.issueAction(request, { actionCode: 'CREATE_BOOKING_DRAFT', materialRef: material.materialRef });
  };
  for (const selection of [{ ...bookingSelection, startAt: '明天下午' }, { ...bookingSelection, source: 'model_candidate' },
    { ...bookingSelection, timeZone: 'UTC' }, { ...bookingSelection, quoteId: 'foreign-quote' }]) {
    await assert.rejects(bookingApp.prepare(request, { operationKey: 'invalid-booking', command: { kind: 'booking_quote', selection } }));
  }
  const draftAction = await makeBookingAction('booking-material-1');
  assert.deepEqual(await bookingHttp.issueAction(request, { actionCode: 'CREATE_BOOKING_DRAFT', materialRef: draftAction.associations.materialRef }), draftAction);
  await assert.rejects(bookingHttp.issueAction(request, { actionCode: 'CREATE_BOOKING_DRAFT', materialRef: draftAction.associations.materialRef,
    actor: 'forged', scope: { tenantId: 'foreign' } }), e => e.getStatus() === 400 && e.getResponse().code === 'AI_INVALID_INPUT');
  const createDraft = { operationKey: 'create-draft-1', action: draftAction };
  const draftCreated = await bookingHttp.createBookingDraft(request, createDraft);
  assert.equal(draftCreated.draft.state, 'draft_created'); assert.equal(draftCreated.draft.action, null);
  const publication = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(
    require('../packages/shared/src/ai-entry-management-draft-schemas').AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS, {});
  assert.equal(publication.AiBookingDraft(draftCreated.draft), true, JSON.stringify(publication.AiBookingDraft.errors));
  assert.equal(draftCreated.draft.material.quote.depositAmount, 0);
  assert.equal(draftCreated.draft.material.sources.returnLocationId, 'core_normalized');
  assert.equal(draftCreated.draft.material.availability, 'available_at_observation_not_reserved');
  assert.equal((await bookingApp.createBookingDraft(request, createDraft)).draft.bookingDraftId, draftCreated.draft.bookingDraftId);
  await assert.rejects(bookingApp.createBookingDraft(request, { ...createDraft, operationKey: 'different-key-same-action' }), e => e.code === 'AI_REVISION_CONFLICT');
  const selectDraft = { bookingDraftId: draftCreated.draft.bookingDraftId, expectedRevision: 1,
    inputFingerprint: draftCreated.draft.inputFingerprint, operationKey: 'select-draft-1', decision: 'continue_booking' };
  await assert.rejects(bookingApp.chooseBookingDraft(request, { ...selectDraft, expectedRevision: 2 }), e => e.code === 'AI_REVISION_CONFLICT');
  const selected = await bookingHttp.chooseBookingDraft(request, selectDraft);
  assert.equal(selected.draft.state, 'user_selected'); assert.equal(selected.draft.selectionRevision, 1);
  assert.equal(selected.draft.action.actionCode, 'OPEN_BOOKING');
  assert.equal((await bookingApp.chooseBookingDraft(request, selectDraft)).replayed, true);
  const handoffCommand = { operationKey: 'handoff-draft-1', action: selected.draft.action };
  const handed = await bookingHttp.handoffBookingDraft(request, handoffCommand);
  assert.equal(handed.handoff.fields.quoteId, bookingSelection.quoteId);
  assert.equal(handed.handoff.submission, 'original_booking_page_required');
  assert.equal(handed.handoff.inventory, 'not_reserved');
  assert.equal(publication.AiBookingHandoff(handed.handoff), true, JSON.stringify(publication.AiBookingHandoff.errors));
  assert.equal(publication.AiEntryActionDraft(selected.draft.action), true, JSON.stringify(publication.AiEntryActionDraft.errors));
  assert.equal(publication.AiBookingHandoff({ ...handed.handoff, url: 'javascript:alert(1)' }), false);
  assert.equal((await bookingHttp.readBookingDraft(request, { bookingDraftId: draftCreated.draft.bookingDraftId })).state, 'handed_to_booking_page');
  assert.equal((await bookingApp.handoffBookingDraft(request, handoffCommand)).handoff.handoffRef, handed.handoff.handoffRef);
  assert.equal((await bookingHttp.readBookingHandoff(request, { handoffRef: handed.handoff.handoffRef })).actionCode, 'OPEN_BOOKING');
  const preparation = await bookingApp.readBookingPreparation(request, { handoffRef: handed.handoff.handoffRef });
  assert.deepEqual(preparation.handoff, handed.handoff);
  assert.equal(preparation.draft.material.quote.quoteId, preparation.handoff.fields.quoteId);
  assert.equal(preparation.draft.inputFingerprint, selected.draft.inputFingerprint);
  assert.equal(preparation.draft.selectionRevision, selected.draft.selectionRevision);
  assert.equal(preparation.draft.action.actionCode, 'OPEN_BOOKING');
  assert.equal(preparation.submission, 'unavailable_original_page_acceptance_receipt_missing');
  assert.equal(preparation.approval, 'not_granted');
  assert.equal(preparation.inventory, 'not_reserved');
  assert.ok(Object.isFrozen(preparation.draft.material.selection.lines));
  await assert.rejects(bookingApp.readBookingPreparation({ headers: {} }, { handoffRef: handed.handoff.handoffRef }));
  await assert.rejects(bookingApp.readBookingPreparation(request, { handoffRef: handed.handoff.handoffRef, submitted: true }));
  await assert.rejects(bookingHttp.readBookingHandoff({ headers: {} }, { handoffRef: handed.handoff.handoffRef }), e => e.getStatus() === 403);
  const quoteReader = client.business.getQuote;
  client.business.getQuote = () => { throw Error('synthetic private database credential'); };
  await assert.rejects(bookingHttp.readBookingHandoff(request, { handoffRef: handed.handoff.handoffRef }),
    e => e.getStatus() === 503 && e.getResponse().code === 'AI_RESOURCE_UNAVAILABLE'
      && !JSON.stringify(e.getResponse()).includes('credential'));
  client.business.getQuote = quoteReader;
  assert.equal(bookingRows.ai_client_booking_drafts.length, 1); assert.equal(bookingRows.ai_client_booking_handoffs.length, 1);
  assert.equal(bookingRows.ai_client_booking_draft_operations.length, 3);
  assert.equal(bookingApp.submitBookingDraft, undefined);
  await assert.rejects(bookingApp.readBookingHandoff(request, { handoffRef: handed.handoff.handoffRef, submitted: true }));
  await assert.rejects(bookingApp.readAction(request, { ...selected.draft.action, surface: 'client_miniprogram' }));
  // Exercise the real client adapter and original Core receipt reader. Only the
  // Core write/storage boundary is substituted; no live order is created.
  const { RentalOrderConfirmationService } = require('../apps/api/src/modules/rental-core/rental-order-confirmation.service');
  const originalReceipts = new Map(); let originalWrites = 0;
  const originalOrderReader = client.core.getOrder;
  const originalOrders = Object.assign(Object.create(RentalOrderConfirmationService.prototype), {
    idempotency: { find: async (tenant, action, key) => {
      assert.equal(tenant, 'tenant-client'); assert.equal(action, 'rental.order.create');
      assert.equal(getRequestIdentity().workspaceId, 'workspace-client');
      return originalReceipts.get(key);
    } },
    coreFacts: { findOrder: async (tenant, id) => originalOrderReader(tenant, id) },
    createOrder: async (tenant, input, actor, _business, key) => {
      assert.equal(actor, 'client:person-client'); assert.equal(input.customerId, 'person-client');
      originalWrites++;
      originalReceipts.set(key, { requestHash: originalOrders.fingerprintOrderRequest(input), orderId: 'own-order' });
      throw Error('synthetic original Core committed; reply lost');
    }
  });
  client.orders = originalOrders;
  const submissionApp = composeRequestBoundClientApplication({ ...taskDependencies, bookingSubmission: client }, entryConfig);
  const submissionPreparation = await submissionApp.readBookingPreparation(request, { handoffRef: handed.handoff.handoffRef });
  assert.equal(submissionPreparation.submission, 'explicit_original_page_submission_and_receipt_only');
  assert.equal(submissionPreparation.approval, 'not_granted');
  assert.equal(submissionPreparation.inventory, 'not_reserved');
  assert.equal(submissionPreparation.draft.execution, 'not_submitted');
  assert.equal(originalWrites, 0);
  assert.ok(Object.isFrozen(submissionPreparation));
  const incompleteSubmission = { prepareOrderSubmission: client.prepareOrderSubmission };
  const incompleteApp = composeRequestBoundClientApplication({ ...taskDependencies, bookingSubmission: incompleteSubmission }, entryConfig);
  assert.equal(incompleteApp.capabilities.bookingSubmission, 'unavailable_original_page_acceptance_receipt_missing');
  assert.equal((await incompleteApp.readBookingPreparation(request, { handoffRef: handed.handoff.handoffRef })).submission,
    'unavailable_original_page_acceptance_receipt_missing');
  const submissionModule = AiClientEntryModule.registerHttp({ ...taskDependencies, bookingSubmission: client }, entryConfig);
  const submissionHttp = new AiClientEntryController(submissionModule.providers[0].useFactory());
  const { ExecutionContextHost } = require('@nestjs/core/helpers/execution-context-host');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const callSubmissionHttp = (method, body, headers = request.headers) => runWithRequestIdentity({}, async () => {
    const url = `/api/${AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath}/${AI_CLIENT_ENTRY_HTTP_DRAFT[method]}`;
    const originalRequest = { method: 'POST', url, originalUrl: url, headers, body, query: {} };
    assert.equal(await guard.canActivate(new ExecutionContextHost([originalRequest])), true);
    assert.equal(originalRequest.client.customerId, 'person-client');
    return submissionHttp[method](originalRequest, body);
  });
  await assert.rejects(bookingApp.acceptBookingSubmission(request, { handoffRef: handed.handoff.handoffRef }),
    e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  const accepted = await callSubmissionHttp('acceptBookingSubmission', { handoffRef: handed.handoff.handoffRef });
  assert.equal(publication.AiBookingSubmissionAcceptance(accepted), true, JSON.stringify(publication.AiBookingSubmissionAcceptance.errors));
  assert.equal(accepted.execution, 'not_attested'); assert.equal(originalWrites, 0);
  assert.equal((await submissionApp.acceptBookingSubmission(request, { handoffRef: handed.handoff.handoffRef })).acceptanceRef, accepted.acceptanceRef);
  await assert.rejects(callSubmissionHttp('submitAcceptedBooking', { acceptanceRef: accepted.acceptanceRef }),
    e => e.getStatus() === 400 && e.getResponse().code === 'AI_INVALID_INPUT');
  const explicitSubmit = { acceptanceRef: accepted.acceptanceRef, decision: 'submit_original_booking' };
  const submitted = await callSubmissionHttp('submitAcceptedBooking', explicitSubmit);
  assert.equal(publication.AiBookingSubmissionReceipt(submitted), true, JSON.stringify(publication.AiBookingSubmissionReceipt.errors));
  assert.equal(publication.AiBookingSubmissionReceipt({ ...submitted, orderId: null }), false);
  assert.equal(publication.AiBookingSubmissionDecision({ ...explicitSubmit, scope: 'forged' }), false);
  const { AI_LEAF_COMPONENT_SCHEMAS } = require('../apps/api/src/contracts/ai-leaf-components');
  assert.ok(AI_LEAF_COMPONENT_SCHEMAS.AiBookingSubmissionReceipt);
  assert.equal(submitted.state, 'observed'); assert.equal(submitted.orderId, 'own-order');
  assert.equal(submitted.payment, 'not_inferred'); assert.equal(originalWrites, 1);
  const receiptLookup = originalOrders.idempotency.find;
  originalOrders.idempotency.find = async (...args) => {
    const receipt = await receiptLookup(...args);
    taskPolicies[1].allowRead = 0;
    return receipt;
  };
  try {
    await assert.rejects(submissionApp.readBookingSubmission(request, { acceptanceRef: accepted.acceptanceRef }),
      e => e.code === 'AI_ACCESS_DENIED');
    assert.equal(originalWrites, 1);
  } finally {
    taskPolicies[1].allowRead = 1;
    originalOrders.idempotency.find = receiptLookup;
  }
  client.business.getQuote = () => { throw Error('quote consumed; current/latest quote must not be substituted'); };
  const submissionRestart = composeRequestBoundClientApplication({ ...taskDependencies, bookingSubmission: client }, entryConfig);
  assert.equal((await submissionRestart.submitAcceptedBooking(request, explicitSubmit)).state, 'observed');
  assert.equal(originalWrites, 1);
  const originalReceipt = originalReceipts.get(accepted.operationKey);
  originalReceipts.set(accepted.operationKey, { ...originalReceipt, requestHash: 'another-request' });
  await assert.rejects(callSubmissionHttp('readBookingSubmission', { acceptanceRef: accepted.acceptanceRef }),
    e => e.getStatus() === 409 && e.getResponse().code === 'AI_REVISION_CONFLICT'
      && !JSON.stringify(e.getResponse()).includes('载荷'));
  await assert.rejects(submissionRestart.readBookingSubmission(request, { acceptanceRef: accepted.acceptanceRef }));
  originalReceipts.delete(accepted.operationKey);
  const absentReceipt = await submissionRestart.submitAcceptedBooking(request, explicitSubmit);
  assert.equal(absentReceipt.state, 'not_observed'); assert.equal(absentReceipt.retryable, false);
  assert.equal(originalWrites, 1);
  await assert.rejects(submissionRestart.readBookingSubmission({ headers: {} }, { acceptanceRef: accepted.acceptanceRef }));
  await assert.rejects(callSubmissionHttp('readBookingSubmission', { acceptanceRef: accepted.acceptanceRef }, {}));
  client.business.getQuote = quoteReader;
  stockObservation++;
  await assert.rejects(bookingApp.readBookingPreparation(request, { handoffRef: handed.handoff.handoffRef }));
  await assert.rejects(bookingApp.readBookingHandoff(request, { handoffRef: handed.handoff.handoffRef }));
  assert.equal(bookingRows.ai_client_booking_drafts[0].state, 'stale'); stockObservation--;
  await assert.rejects(bookingApp.readBookingDraft(request, { bookingDraftId: draftCreated.draft.bookingDraftId }), e => e.code === 'AI_PROPOSAL_STALE');
  const lostDraftAction = await makeBookingAction('booking-material-lost');
  loseBookingReply = true;
  await assert.rejects(bookingHttp.createBookingDraft(request, { action: lostDraftAction, operationKey: 'create-draft-lost' }),
    e => e.getStatus() === 409 && e.getResponse().code === 'AI_RESULT_UNKNOWN' && e.getResponse().nextAction === 'read_booking_operation'
      && !JSON.stringify(e.getResponse()).includes('COMMIT'));
  loseBookingReply = false;
  const afterLostBooking = bookingRows.ai_client_booking_drafts.length;
  const recoveredBooking = await bookingHttp.readBookingOperation(request, { operationKey: 'create-draft-lost' });
  assert.equal(recoveredBooking.state, 'observed'); assert.equal(recoveredBooking.businessSubmission, 'not_attested');
  assert.equal(bookingRows.ai_client_booking_drafts.length, afterLostBooking);
  const recoveredDraft = await bookingApp.readBookingDraft(request, { bookingDraftId: recoveredBooking.bookingDraftId });
  await bookingApp.chooseBookingDraft(request, { bookingDraftId: recoveredDraft.bookingDraftId, expectedRevision: recoveredDraft.revision,
    inputFingerprint: recoveredDraft.inputFingerprint, operationKey: 'abandon-lost-draft', decision: 'abandon' });
  await assert.rejects(bookingApp.readBookingDraft(request, { bookingDraftId: recoveredDraft.bookingDraftId }), e => e.code === 'AI_PROPOSAL_STALE');
  const rejectedAction = await makeBookingAction('rejected-before-draft');
  bookingAvailable = false;
  await assert.rejects(bookingApp.readAction(request, rejectedAction));
  bookingAvailable = true;
  await assert.rejects(bookingApp.createBookingDraft(request, { action: rejectedAction, operationKey: 'revive-rejected-action' }), e => e.code === 'AI_PROPOSAL_STALE');
  const repeatedAction = await makeBookingAction('concurrent-booking');
  const repeatedDrafts = await Promise.all([1, 2].map(() => bookingApp.createBookingDraft(request, { action: repeatedAction, operationKey: 'concurrent-draft' })));
  assert.equal(repeatedDrafts[0].draft.bookingDraftId, repeatedDrafts[1].draft.bookingDraftId);
  assert.deepEqual(repeatedDrafts.map(value => value.replayed).sort(), [false, true]);
  const pickupQuote = structuredClone(bookingQuote), pickupCatalog = client.buildCatalog;
  let address = { id: 'address-client', tenantId: 'tenant-client', customerId: 'person-client', status: 'active',
    revision: 1, updatedAt: new Date(now), recipient: 'Synthetic Recipient', phone: '13800000000', phoneMasked: '138****0000',
    countryCode: 'CN', province: 'Synthetic Province', city: 'Synthetic City', detail: 'Synthetic Street',
    district: null, postalCode: null, latitude: null, longitude: null, deliveryServiceAreaDecision: { allowed: true } };
  const addressPort = { list: async () => ({ items: [{ ...structuredClone(address), updatedAt: address.updatedAt.toISOString() }] }),
    requireOwnAddress: async () => structuredClone(address) };
  client.buildCatalog = async (...args) => {
    const catalog = await pickupCatalog(...args);
    catalog.fulfillment.enabledModes.push('delivery'); catalog.locations[0].capabilities.push('delivery'); return catalog;
  };
  const deliverySelection = { ...bookingSelection, fulfillmentMode: 'delivery', deliveryAddressId: address.id };
  bookingQuote = { ...pickupQuote, request: { ...pickupQuote.request, fulfillmentMode: 'delivery', deliveryAddressId: address.id },
    deliveryAddressSnapshot: { addressId: address.id, recipient: address.recipient, phone: address.phone,
      phoneMasked: address.phoneMasked, countryCode: address.countryCode, province: address.province, city: address.city, detail: address.detail } };
  await assert.rejects(makeBookingAction('address-no-port', bookingApp, deliverySelection), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  const deliveryApp = composeRequestBoundClientApplication({ ...taskDependencies, addresses: addressPort }, entryConfig);
  const deliveryAction = await makeBookingAction('delivery-material', deliveryApp, deliverySelection);
  const deliveryDraft = await deliveryApp.createBookingDraft(request, { action: deliveryAction, operationKey: 'delivery-create' });
  assert.equal(deliveryDraft.draft.material.selection.deliveryAddressId, address.id);
  assert.equal(deliveryDraft.draft.material.deliveryAddress.observedRevision, 1);
  assert.equal(JSON.stringify(deliveryDraft).includes(address.phone), false);
  const deliverySelected = await deliveryApp.chooseBookingDraft(request, { bookingDraftId: deliveryDraft.draft.bookingDraftId,
    expectedRevision: 1, inputFingerprint: deliveryDraft.draft.inputFingerprint, operationKey: 'delivery-select', decision: 'continue_booking' });
  const deliveryHandoff = await deliveryApp.handoffBookingDraft(request, { action: deliverySelected.draft.action, operationKey: 'delivery-handoff' });
  assert.equal(deliveryHandoff.handoff.fields.deliveryAddressId, address.id);
  assert.equal(publication.AiBookingDraft(deliveryDraft.draft), true, JSON.stringify(publication.AiBookingDraft.errors));
  assert.equal(publication.AiBookingHandoff(deliveryHandoff.handoff), true, JSON.stringify(publication.AiBookingHandoff.errors));
  address.revision++;
  await assert.rejects(deliveryApp.readBookingHandoff(request, { handoffRef: deliveryHandoff.handoff.handoffRef }), /AI_CLIENT_MATERIAL_STALE/);
  address.revision--;
  await assert.rejects(deliveryApp.readBookingDraft(request, { bookingDraftId: deliveryDraft.draft.bookingDraftId }), e => e.code === 'AI_PROPOSAL_STALE');
  bookingQuote = pickupQuote; client.buildCatalog = pickupCatalog;
  bookingSelection.bookingIdentity = { bookingIdentity: 'enterprise_employee', corporateCustomerId: 'corporate-client', enterpriseContractAndPayer: true };
  bookingQuote = { ...bookingQuote, request: { ...bookingQuote.request, bookingIdentity: structuredClone(bookingSelection.bookingIdentity) },
    membershipSnapshot: { ...bookingSelection.bookingIdentity, personalCustomerId: 'person-client', corporateMembershipId: 'relation-client' } };
  const corporateAction = await makeBookingAction('corporate-booking');
  const corporateDraft = await bookingApp.createBookingDraft(request, { action: corporateAction, operationKey: 'create-corporate-draft' });
  corporateAllowed = false;
  await assert.rejects(bookingApp.readBookingDraft(request, { bookingDraftId: corporateDraft.draft.bookingDraftId }), e => e.code === 'AI_ACCESS_DENIED');
  corporateAllowed = true;
  assert.equal(bookingRows.ai_client_booking_drafts.find(row => row.id === corporateDraft.draft.bookingDraftId).state, 'stale');
  const persistedBooking = JSON.stringify(bookingRows);
  assert.equal(persistedBooking.includes(authorization), false); assert.equal(persistedBooking.includes('session-client'), false);
  assert.equal(persistedBooking.includes('submitted'), false);
  assert.equal(countCreates(), 1);

  taskPolicies[0].allowCreate = 0; taskStore.state.aiBudgetPolicy[0].enabled = false;
  assert.equal((await taskRestart.createTask(request, taskCommand)).task.taskId, created.task.taskId);
  assert.equal((await taskRestart.readTaskCreation(request, taskCommand)).task.runId, created.task.runId);
  const clientScene = await taskRestart.readTaskScene(request, { ...taskCommand, question: 'fees' });
  assert.equal(clientScene.task.taskId, created.task.taskId);
  assert.equal(clientScene.facts.orderId, 'own-order'); assert.equal(clientScene.facts.amounts.payableAmount.value, 0);
  assert.equal(clientScene.taskOutcome, 'not_inferred_from_order_facts');
  assert.equal(clientScene.execution, 'read_only_no_task_start');
  const taskReaderController = new AiClientEntryController(taskRestart);
  assert.equal((await taskReaderController.readOrderExplanation(request, { orderId: 'own-order', question: 'status' })).facts.orderId, 'own-order');
  await assert.rejects(taskReaderController.readOrderExplanation(request, { orderId: 'other-order', question: 'status' }), e => e.getStatus?.() === 403);
  assert.equal((await taskReaderController.readSource(request, { materialRef: own.materialRef })).materialRef, own.materialRef);
  const snapshot = await taskReaderController.readTaskSnapshot(request, taskCommand);
  assert.equal(snapshot.taskId, created.task.taskId);
  assert.equal(snapshot.cursor, '0'); assert.deepEqual(snapshot.steps, []);
  const page = await taskReaderController.readTaskEvents(request, { ...taskCommand, after: snapshot.cursor, limit: 10 });
  assert.deepEqual(page.events, []); assert.equal(page.nextCursor, '0');
  // Explicit server result reader reuses the actual repository and original
  // client Guard/material authority. No provider or execution capability needed.
  const resultApp = composeRequestBoundClientApplication({ ...taskDependencies, taskInputs: readSource },
    { ...configuration, entry: { enabled: true, releaseRevision: 'result-read-1' } });
  const executionBefore = clone(taskStore.state);
  const inputHttp = new AiClientEntryController(resultApp);
  const modelObservation = await inputHttp.readTaskModelResult(request, taskCommand);
  const { aiClientTaskModelResultReadResponseSchema } = require('../packages/shared/src/ai-client-entry-draft-schemas');
  assert.equal(aiClientTaskModelResultReadResponseSchema.safeParse(modelObservation).success, true);
  assert.equal(modelObservation.state, 'not_observed'); assert.equal(modelObservation.result, null);
  assert.equal(modelObservation.authority, 'generated_text_not_business_fact');
  taskStore.control.beforeRead = async table => { if (table === 'aiRun') revoked = true; };
  await assert.rejects(inputHttp.readTaskModelResult(request, taskCommand), e => e.getStatus?.() === 403);
  taskStore.control.beforeRead = null; revoked = false;
  await assert.rejects(inputHttp.readTaskModelResult(request, { ...taskCommand, resultId: 'caller-selected-result' }),
    e => e.getStatus?.() === 400);
  assert.equal(await resultApp.readOriginalTaskModelInput(request, taskCommand), null);
  const noPending = await inputHttp.readTaskInput(request, taskCommand);
  const beforeUnavailableModel = clone(taskStore.state);
  await assert.rejects(inputHttp.startTaskModel(request, taskCommand), e => e.getStatus?.() === 503);
  await assert.rejects(inputHttp.recoverTaskModel(request, taskCommand), e => e.getStatus?.() === 503);
  assert.deepEqual(taskStore.state, beforeUnavailableModel, 'absent persistent server model root cannot claim or dispatch');
  const { aiClientTaskInputReadResponseSchema } = require('../packages/shared/src/ai-client-entry-draft-schemas');
  assert.equal(aiClientTaskInputReadResponseSchema.safeParse(noPending).success, true);
  assert.equal(noPending.state, 'not_pending'); assert.equal(noPending.question, null);
  assert.equal(noPending.execution, 'not_authorized_by_observation');
  const answerCommand = { ...taskCommand, submission: { draftVersion: AI_TASK_INPUT_DRAFT_VERSION,
    requestId: 'missing-client-question', expectedRevision: 1, submissionKey: 'client-answer-1',
    answers: [{ fieldId: 'clarification_text', value: 'explicit answer' }] } };
  await assert.rejects(inputHttp.submitTaskInput(request, { ...answerCommand,
    submission: { ...answerCommand.submission, taskId: created.task.taskId } }), e => e.getStatus?.() === 400);
  const missingAnswerTrace = taskStore.trace.length;
  await assert.rejects(inputHttp.submitTaskInput(request, answerCommand), e => e.getStatus?.() === 503);
  assert.equal(taskStore.trace.slice(missingAnswerTrace).includes('aiTaskInputRequest.read'), true);
  await assert.rejects(inputHttp.readTaskInputReceipt(request, answerCommand), e => e.getStatus?.() === 503);
  assert.deepEqual(taskStore.state, executionBefore);
  const execution = await resultApp.readOriginalTaskExecution(request, taskCommand, { db });
  assert.equal(execution.task.taskId, created.task.taskId);
  assert.equal(execution.run.runId, created.task.runId);
  assert.deepEqual(execution.steps, []);
  assert.equal(execution.resources, null);
  assert.deepEqual(taskStore.state, executionBefore);
  await assert.rejects(resultApp.readOriginalTaskExecution(request, { ...taskCommand, runId: created.task.runId }, { db }),
    e => e.code === 'AI_INVALID_INPUT');
  taskStore.control.beforeRead = async table => { if (table === 'aiTaskRunPlan') revoked = true; };
  await assert.rejects(resultApp.readOriginalTaskExecution(request, taskCommand, { db }), e => e.code === 'AI_ACCESS_DENIED');
  taskStore.control.beforeRead = null; revoked = false;
  const resultCommand = { ...taskCommand, resultId: 'client-result' };
  await assert.rejects(resultApp.readOriginalTaskResult(request, resultCommand, { db }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  const payload = { explanation: 'Persisted model output, not a booking receipt' };
  const { requestFingerprint: resultHash } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const fingerprint = resultHash(payload), stepFingerprint = resultHash({ input: 'original-customer-input' });
  const originalTask = taskStore.state.aiTask.find(row => row.id === created.task.taskId);
  taskStore.state.aiStep.push({ id: 'client-result-step', scopeId: originalTask.scopeId, taskId: originalTask.id,
    runId: created.task.runId, actionId: 'client-result-action', requestFingerprint: stepFingerprint,
    resultRef: 'client-result', status: 'SUCCEEDED' });
  taskStore.state.aiTaskResultArtifact.push({ id: 'client-result', scopeId: originalTask.scopeId, taskId: originalTask.id,
    runId: created.task.runId, stepId: 'client-result-step', actionId: 'client-result-action', stepFingerprint,
    outcome: 'SUCCEEDED', errorCode: null, payload, contentHash: fingerprint,
    outputBytes: BigInt(Buffer.byteLength(JSON.stringify(payload))), activeMs: 1n, completeMeasurement: true, createdAt: now });
  const beforeResult = clone(taskStore.state), resultTraceStart = taskStore.trace.length;
  const persistedResult = await resultApp.readOriginalTaskResult(request, resultCommand, { db });
  assert.equal(persistedResult.status, 'succeeded'); assert.deepEqual(persistedResult.payload, payload);
  assert.equal(persistedResult.taskId, created.task.taskId);
  assert.deepEqual(taskStore.state, beforeResult);
  assert.deepEqual(taskStore.trace.slice(resultTraceStart).filter(event =>
    /\.(create|createMany|update|upsert)$|^row\.lock$/u.test(event)), []);
  taskStore.state.aiTaskResultArtifact[0].outcome = 'UNKNOWN';
  assert.equal((await resultApp.readOriginalTaskResult(request, resultCommand, { db })).payload, null);
  assert.equal((await resultApp.readOriginalTaskResult(request, resultCommand, { db })).status, 'unknown');
  taskStore.state.aiTaskResultArtifact[0].taskId = 'another-customer-task';
  await assert.rejects(resultApp.readOriginalTaskResult(request, resultCommand, { db }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  taskStore.state.aiTaskResultArtifact[0].taskId = originalTask.id;
  await assert.rejects(resultApp.readOriginalTaskResult(request, { ...resultCommand, taskId: originalTask.id }, { db }), e => e.code === 'AI_INVALID_INPUT');
  taskStore.control.beforeRead = async table => { if (table === 'aiTaskResultArtifact') revoked = true; };
  await assert.rejects(resultApp.readOriginalTaskResult(request, resultCommand, { db }), e => e.code === 'AI_ACCESS_DENIED');
  taskStore.control.beforeRead = null; revoked = false;
  taskStore.state.aiStep.pop(); taskStore.state.aiTaskResultArtifact.pop();
  // The actual persisted watermark is a decimal string, never a Number or an invented cursor.
  taskStore.state.aiTask.find(row => row.id === created.task.taskId).eventCursor = 9007199254740993n;
  const precise = await taskRestart.readTaskSnapshot(request, taskCommand);
  assert.equal(precise.cursor, '9007199254740993');
  assert.equal((await taskRestart.readTaskEvents(request, { ...taskCommand, after: '0', limit: 10 })).status, 'reset_required');
  assert.equal((await taskRestart.readTaskEvents(request, { ...taskCommand, after: precise.cursor, limit: 10 })).nextCursor, precise.cursor);
  await assert.rejects(taskRestart.readTaskSnapshot(request, { ...taskCommand, taskId: 'forged' }), /AI_CLIENT_INVALID_INPUT/);
  taskStore.control.beforeRead = async table => { if (table === 'aiStep') revoked = true; };
  await assert.rejects(taskReaderController.readTaskSnapshot(request, taskCommand), e => e.getStatus?.() === 403);
  taskStore.control.beforeRead = null; revoked = false;
  assert.equal(countCreates(), beforeDuplicate);
  taskPolicies[0].allowRead = 0;
  await assert.rejects(taskRestart.readTaskCreation(request, taskCommand), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(taskRestart.readTaskScene(request, taskCommand), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(taskRestart.readTaskSnapshot(request, taskCommand), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(taskRestart.readTaskEvents(request, { ...taskCommand, after: '0', limit: 10 }), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(taskReaderController.readTaskSnapshot(request, taskCommand), e => e.getStatus?.() === 403);
  taskPolicies[0].allowRead = 1; taskPolicies[0].allowCreate = 1; taskStore.state.aiBudgetPolicy[0].enabled = true;
  await assert.rejects(taskRestart.createTask(request, { ...taskCommand, materialRef: distinctCase.materialRef }), e => e.code === 'AI_REVISION_CONFLICT');
  const taskLost = { ...taskCommand, creationKey: 'task-lost-ack' };
  lostTaskReply = true;
  await assert.rejects(clientTasks.createTask(request, taskLost), e => e.code === 'AI_CLIENT_TASK_RESULT_UNKNOWN');
  lostTaskReply = false;
  const afterTaskLost = countCreates(), taskRecovered = await taskRestart.readTaskCreation(request, taskLost);
  assert.equal(taskRecovered.state, 'observed'); assert.equal(taskRecovered.task.status, 'queued');
  assert.equal(countCreates(), afterTaskLost); assert.equal(taskStore.state.aiTask.length, 2);
  const inputLost = { ...taskCommand, creationKey: 'claim-lost-ack' };
  lostInputReply = true;
  await assert.rejects(clientTasks.createTask(request, inputLost), e => e.code === 'AI_CLIENT_TASK_RESULT_UNKNOWN');
  lostInputReply = false;
  assert.equal((await taskRestart.createTask(request, inputLost)).state, 'unknown');
  assert.equal((await taskRestart.readTaskCreation(request, inputLost)).task, null);
  assert.equal(countCreates(), afterTaskLost);
  const preDispatchRevoked = { ...taskCommand, creationKey: 'policy-revoked-after-claim' };
  revokeAfterClaim = true;
  await assert.rejects(clientTasks.createTask(request, preDispatchRevoked), e => e.code === 'AI_CLIENT_TASK_RESULT_UNKNOWN');
  revokeAfterClaim = false; taskPolicies[0].allowCreate = 1;
  assert.equal((await taskRestart.createTask(request, preDispatchRevoked)).state, 'unknown');
  assert.equal(countCreates(), afterTaskLost); assert.equal(taskStore.state.aiRun.length, 2);
  assert.equal(JSON.stringify(taskInputs).includes(authorization), false); assert.equal(JSON.stringify(taskInputs).includes('session-client'), false);
  assert.equal(clientTasks.capabilities.tasks, 'create_and_read_only'); assert.equal(clientTasks.capabilities.models, 'unavailable');
  const cancelCommand = { ...taskCommand, expectedRevision: taskStore.state.aiTask.find(row => row.id === created.task.taskId).revision };
  await assert.rejects(resultApp.requestOriginalTaskCancellation(request, cancelCommand), e => e.code === 'AI_ACCESS_DENIED');
  const cancellationHttp = new AiClientEntryController(resultApp);
  await assert.rejects(cancellationHttp.requestTaskCancellation(request, cancelCommand), e => e.getStatus?.() === 403);
  taskPolicies[0].allowCancel = 1; taskPolicies[0].allowExecute = 0;
  const priorBudgetEnabled = taskStore.state.aiBudgetPolicy[0].enabled;
  taskStore.state.aiBudgetPolicy[0].enabled = false;
  const cancelCreates = countCreates();
  const cancelReceipt = await cancellationHttp.requestTaskCancellation(request, cancelCommand);
  assert.equal(cancelReceipt.cancellation, 'requested_not_rollback'); assert.equal(cancelReceipt.retryable, false);
  const { aiClientTaskCancelReceiptSchema } = require('../packages/shared/src/ai-client-entry-draft-schemas');
  assert.equal(aiClientTaskCancelReceiptSchema.safeParse(cancelReceipt).success, true);
  assert.equal(cancelReceipt.status, 'cancel_requested'); assert.equal(cancelReceipt.taskId, created.task.taskId);
  assert.equal('receipt' in cancelReceipt, false); assert.equal('runRevision' in cancelReceipt, false);
  assert.equal(taskStore.state.aiTask.find(row => row.id === created.task.taskId).status, 'CANCEL_REQUESTED');
  assert.equal((await resultApp.readOriginalTaskExecution(request, taskCommand, { db })).task.status, 'cancel_requested');
  const beforeMissingWaitProof = clone(taskStore.state);
  const beforeMissingWaitTrace = taskStore.trace.length;
  await assert.rejects(cancellationHttp.reconcileTaskInputCancellation(request, taskCommand),
    e => e.getStatus?.() === 503 && e.getResponse().retryable === false);
  assert.equal(taskStore.trace.slice(beforeMissingWaitTrace).includes('aiTaskInputRequest.readMany'), true,
    'the original persisted wait witness must actually be reached, not a dependency serialization failure');
  await assert.rejects(resultApp.reconcileOriginalTaskInputCancellation(request, { ...taskCommand, taskId: created.task.taskId }),
    e => { assert.equal(e.code, 'AI_INVALID_INPUT', `${e.name}:${e.message}:${e.reason}`); return true; });
  await assert.rejects(cancellationHttp.reconcileTaskInputCancellation(request, { ...taskCommand, taskId: created.task.taskId }),
    e => { assert.equal(e.getStatus?.(), 400, JSON.stringify(e.getResponse?.())); return true; });
  assert.deepEqual(taskStore.state, beforeMissingWaitProof, 'no released measured wait means no cancellation convergence');
  assert.equal(countCreates(), cancelCreates);
  await assert.rejects(resultApp.requestOriginalTaskCancellation(request, cancelCommand), e => e.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(cancellationHttp.requestTaskCancellation(request, cancelCommand), e => e.getStatus?.() === 409);
  const lostCancelTask = taskStore.state.aiTask.find(row => row.id === taskRecovered.task.taskId);
  const lostCancelCommand = { ...taskLost, expectedRevision: lostCancelTask.revision };
  taskStore.control.beforeCommit = async draft => {
    if (draft.aiTask.find(row => row.id === lostCancelTask.id)?.status === 'CANCEL_REQUESTED'
      && taskStore.state.aiTask.find(row => row.id === lostCancelTask.id)?.status !== 'CANCEL_REQUESTED')
      taskStore.control.loseReply = true;
  };
  await assert.rejects(cancellationHttp.requestTaskCancellation(request, lostCancelCommand), e =>
    e.getStatus?.() === 409 && e.getResponse().code === 'AI_RESULT_UNKNOWN'
    && e.getResponse().retryable === false && e.getResponse().nextAction === 'read_original_task');
  taskStore.control.beforeCommit = null;
  assert.equal((await cancellationHttp.readTaskSnapshot(request, taskLost)).status, 'cancel_requested');
  assert.equal(countCreates(), cancelCreates);
  taskStore.state.aiBudgetPolicy[0].enabled = priorBudgetEnabled;
  taskPolicies[0].allowExecute = 1; taskPolicies[0].allowCancel = 0;
  session.customer.customerType = 'corporate';
  assert.equal((await prepare(request, { kind: 'profile' })).material.customerType, 'corporate');
  await assert.rejects(prepare(request, { kind: 'order', orderId: 'other-order' }), e => e.getStatus?.() === 404);
  const beforeSwitchRead = reads;
  await assert.rejects(requests.readSource(request, { materialRef: own.materialRef }), /AI_CLIENT_MATERIAL_STALE/);
  assert.equal(reads, beforeSwitchRead); session.customer.customerType = 'personal';
  session.id = 'new-client-session';
  const switchedRequest = { headers: { authorization: `Bearer ${auth.sign({ typ: 'client', sub: 'person-client', tid: 'tenant-client',
    sid: session.id, wid: 'workspace-client', iat: 1, exp: Math.floor(new Date('2027-01-01').getTime() / 1000) })}` } };
  await assert.rejects(requests.readSource(switchedRequest, { materialRef: own.materialRef }), /AI_CLIENT_MATERIAL_STALE/);
  await assert.rejects(taskRestart.readTaskCreation(switchedRequest, taskCommand), /AI_CLIENT_MATERIAL_STALE/);
  await assert.rejects(taskRestart.readTaskScene(switchedRequest, taskCommand), /AI_CLIENT_MATERIAL_STALE/);
  await assert.rejects(bookingApp.readBookingDraft(switchedRequest, { bookingDraftId: repeatedDrafts[0].draft.bookingDraftId }), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(bookingApp.readBookingHandoff(switchedRequest, { handoffRef: handed.handoff.handoffRef }), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(countCreates(), afterTaskLost);
  session.id = 'session-client';
  published = false;
  await assert.rejects(requests.readSource(request, { materialRef: own.materialRef }), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  published = true; const retainedRows = materialRows.length; now = new Date(now.getTime() + 300001);
  await assert.rejects(bookingApp.readBookingDraft(request, { bookingDraftId: repeatedDrafts[0].draft.bookingDraftId }), e => e.code === 'AI_PROPOSAL_STALE');
  assert.equal(bookingRows.ai_client_booking_drafts.find(row => row.id === repeatedDrafts[0].draft.bookingDraftId).state, 'expired');
  await assert.rejects(requests.readSource(request, { materialRef: own.materialRef }), /AI_CLIENT_MATERIAL_STALE/);
  assert.equal(materialRows.length, retainedRows);
  await assert.rejects(requests.readSource(request, { materialRef: own.materialRef, taskId: 'foreign-history' }), /AI_CLIENT_INVALID_INPUT/);
  for (const feature of ['tasks', 'models', 'events', 'downloads', 'historyMigration']) assert.equal(requests.capabilities[feature], 'unavailable');
  assert.equal(requests.start, undefined); assert.equal(requests.cancelOrder, undefined);
});
