'use strict';
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { Prisma } = require('../../../apps/api/node_modules/@prisma/client');
const { persistedApprovedOrderHarness } = require('./approved-order-persisted.cjs');
const { clone, matches } = require('./task-input-store.cjs');
const { composeControlledApprovedOrder } = require('../../../apps/api/src/modules/ai-native/approval-execution/controlled-approved-order.composition');
const { AiApprovedOrderRouteAuthority } = require('../../../apps/api/src/modules/ai-native/approval-execution/approved-order-route.authority');
const { AiCurrentOriginalRequestAuthority } = require('../../../apps/api/src/modules/ai-native/task-request/original-request.authority');
const { PrismaOriginalRequestRepository } = require('../../../apps/api/src/modules/ai-native/task-request/prisma-original-request.repository');
const { composeHumanQuoteOrder } = require('../../../apps/api/src/modules/ai-native/scenes/human-quote-order.composition');
const { AI_SCENE_REQUEST_DRAFT_VERSION } = require('../../../packages/shared/src/ai-scene-request-draft');
const { AI_QUOTE_SELECTION_DRAFT_VERSION } = require('../../../packages/shared/src/ai-quote-selection-draft');
const { AI_TOOL_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION } = require('./local-shared.cjs');

exports.selectedOrderHarness = async ({ initializeOnly = false, runPreparationEvidence = false } = {}) => {
  const h = await persistedApprovedOrderHarness(), { state } = h;
  state.user.permissions.push('system:params:manage');
  for (const table of ['aiTask', 'aiRun', 'aiStep', 'aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval',
    'aiApprovalConsumption', 'aiApprovedOrderSnapshot', 'aiTaskOriginalRequest', 'aiTaskQuoteSelection', 'aiTaskActionInput',
    'aiTaskPlanPolicy', 'aiTaskRunPlan', 'aiTaskEvent', 'aiTaskResultArtifact', 'aiTaskActionPolicy', 'aiApprovalReprepare',
    'aiTaskExecutionBudget', 'aiTaskExecutionCharge', 'aiTaskExecutionPhaseStart', 'aiTaskExecutionPhaseReceipt',
    'aiTaskInputRequest', 'aiTaskInputReceipt', 'aiDataErasure', 'aiGatewayInvocation', 'aiUsageReservation',
    'aiBudgetReservation', 'aiInvocationAdmission']) state.records[table] = [];
  // Only new runner ACK cases opt into the real preparation table; absence
  // stays unavailable in older fixtures instead of being silently successful.
  if (runPreparationEvidence) state.records.aiTaskRunPreparation = [];
  for (const row of state.records.aiBudgetPolicy) {
    row.sceneCode = 'quote_clarification'; row.settingsJson.sceneCode = 'quote_clarification'; row.settingsJson.allowedScenes = ['quote_clarification'];
  }
  Object.assign(state.records.quote[0], { chargeLines: [], rateSnapshot: [], calendarSnapshot: [], calendarWarnings: [],
    appliedDiscountPlanIds: [], discountEvaluations: [], serviceSnapshots: [], rentalAmount: 123, discountAmount: 0,
    couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0, receivableAmount: 123 });
  function client(records) {
    const rows = name => (records ?? state.records)[name];
    const related = (name, row) => !row ? row : name === 'aiTask' ? { ...row, runs: rows('aiRun').filter(r => r.taskId === row.id)
      .map(run => ({ ...run, steps: rows('aiStep').filter(step => step.runId === run.id),
        executionPlan: rows('aiTaskRunPlan').find(p => p.runId === run.id) ?? null })) }
      : name === 'aiRun' ? { ...row, task: related('aiTask', rows('aiTask').find(task => task.id === row.taskId)) }
      : name === 'aiProposalAction' ? { ...row, step: rows('aiStep').find(s => s.actionId === row.actionId && s.scopeId === row.scopeId) }
      : name === 'aiProposal' ? { ...row, currentVersion: rows('aiProposalVersion').find(v => v.proposalId === row.id && v.revision === row.currentRevision) ?? null }
      : name === 'aiTaskResultArtifact' ? { ...row, step: rows('aiStep').find(step => step.id === row.stepId) } : row;
    const project = (row, select) => !row ? null : !select ? clone(row) : Array.isArray(row) ? row.map(value => project(value, select))
      : Object.fromEntries(Object.entries(select).filter(([, rule]) => rule).map(([key, rule]) => [key, rule === true ? clone(row[key]) : project(row[key], rule.select)]));
    const db = { records: records ?? state.records,
      $queryRaw: async query => query.sql.includes('FROM ai_approval_reprepares')
        ? clone(rows('aiApprovalReprepare').filter(row => row.scopeId === query.values[0] && row.operationKey === query.values[1]))
        : query.sql.includes('FROM ai_scopes') ? rows('aiScope').filter(row => row.id === query.values[0]
          && row.kind === 'WORKSPACE' && row.tenantId === query.values[1] && row.workspaceId === query.values[2]).map(row => ({ id: row.id })) : [],
      $executeRaw: async query => {
        assert.ok(query.sql.startsWith('INSERT INTO ai_approval_reprepares'));
        const columns = query.sql.match(/\(([^)]+)\) VALUES/u)[1].match(/`([^`]+)`/gu).map(key => key.slice(1, -1));
        const row = Object.fromEntries(columns.map((key, index) => [key, clone(query.values[index])]));
        assert.equal(rows('aiApprovalReprepare').some(existing => existing.scopeId === row.scopeId && existing.operationKey === row.operationKey), false);
        rows('aiApprovalReprepare').push(row); return 1;
      } };
    for (const model of Object.keys(state.records)) db[model] = {
      findFirst: async (args = {}) => project(related(model, rows(model).find(r => matches(related(model, r), args.where ?? {}))), args.select),
      findUnique: async args => {
        const where = Object.keys(args.where).length === 1 && Object.keys(args.where)[0].includes('_') ? Object.values(args.where)[0] : args.where;
        return project(related(model, rows(model).find(r => matches(r, where))), args.select);
      },
      findMany: async (args = {}) => {
        let found = rows(model).filter(r => matches(related(model, r), args.where ?? {}));
        if (args.orderBy) for (const [key, direction] of Object.entries(args.orderBy)) found = found.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (direction === 'desc' ? -1 : 1));
        return found.slice(0, args.take).map(r => project(related(model, r), args.select));
      },
      create: async args => {
        const row = { ...(model.startsWith('aiTaskExecutionPhase') ? {} : { revision: 1, createdAt: h.dependencies.clock(), updatedAt: h.dependencies.clock() }), ...clone(args.data) };
        if (model === 'aiTask') Object.assign(row, { scope: clone(rows('aiScope').find(s => s.id === row.scopeId)), archivedAt: null, cancelRequestedAt: null, resultRef: null });
        if (model === 'aiRun') Object.assign(row, { leaseOwnerId: null, leaseExpiresAt: null });
        if (model === 'aiTaskRunPreparation') Object.assign(row, { chargeId: null, requestFingerprint: null,
          completedAt: null, activeMs: null, prepared: false, planHash: null, measurementHash: null, ...clone(args.data) });
        if (model === 'aiTaskExecutionBudget') for (const prefix of ['reserved', 'consumed']) for (const resource of ['Steps', 'Calls', 'ActiveMs', 'OutputBytes']) row[`${prefix}${resource}`] ??= 0n;
        if (model === 'aiTaskExecutionCharge') Object.assign(row, { gatewayInvocationId: null, actualAmount: null, evidenceRef: null, outcomeFingerprint: null, ...row });
        if (model === 'rentalOrderIdempotencyRecord') Object.assign(row, { id: 'idempotency-a', status: 'succeeded' });
        if (model === 'aiApprovalConsumption') assert.equal(rows(model).some(r => r.scopeId === row.scopeId && r.taskId === row.taskId && r.actionId === row.actionId), false);
        rows(model).push(row); return project(related(model, row), args.select);
      },
      updateMany: async args => {
        let count = 0;
        for (const row of rows(model)) if (matches(related(model, row), args.where)) {
          count++;
          for (const [key, value] of Object.entries(args.data)) {
            if (value && typeof value === 'object' && 'increment' in value) row[key] = row[key] instanceof Prisma.Decimal ? row[key].add(value.increment) : row[key] + value.increment;
            else if (value && typeof value === 'object' && 'decrement' in value) row[key] = row[key] instanceof Prisma.Decimal ? row[key].sub(value.decrement) : row[key] - value.decrement;
            else row[key] = clone(value);
          }
        }
        return { count };
      },
      upsert: async args => {
        const where = Object.keys(args.where).length === 1 && Object.keys(args.where)[0].includes('_') ? Object.values(args.where)[0] : args.where;
        const row = rows(model).find(r => matches(r, where));
        if (!row) return db[model].create({ data: args.create, select: args.select });
        await db[model].updateMany({ where, data: args.update });
        return project(related(model, row), args.select);
      }
    };
    return db;
  }
  const active = new AsyncLocalStorage(); let queue = Promise.resolve();
  const db = client();
  db.$transaction = callback => {
    // A nested transaction inside a queued transaction must read and write the
    // OUTER draft: writing the live records here would be overwritten when the
    // outer transaction publishes its own committed draft (lost approval or
    // order writes).
    const draft = active.getStore();
    if (draft) return callback(client(draft.records));
    const work = queue.then(() => {
      const records = clone(state.records);
      return active.run({ records }, async () => {
        let result;
        try { result = await callback(client(records)); }
        catch (error) { state.failures.push(error.stack); throw error; }
        const wrote = records.rentalOrder.length > state.records.rentalOrder.length;
        const decided = records.aiApproval.length > state.records.aiApproval.length;
        const reprepared = records.aiApprovalReprepare.length > state.records.aiApprovalReprepare.length;
        state.records = records;
        if (reprepared && state.reprepareAckLost) throw Error('synthetic reprepare commit reply lost');
        if (wrote) state.commits++;
        if (wrote && state.ackLost) throw Error('synthetic order commit reply lost');
        if (decided && state.decisionAckLost) throw Error('synthetic approval commit reply lost');
        return result;
      });
    });
    queue = work.catch(() => {}); return work;
  };
  Object.assign(h.dependencies.db, db);
  const dependencies = { ...h.dependencies, ...h.policyDependencies, scene: { code: 'quote_clarification', version: '1' } };
  // The deferred scene assembly composes the full business-tools surface,
  // which requires more of core/business than the approval chain does. Build
  // a SEPARATE scene core so the approval chain's own core object is not
  // mutated (an availability echo on the shared core regressed committed
  // approval outcomes). Scene-only additions fail closed on use:
  // resolvePricingGroupQuoteRequest and createQuote are financial ports that
  // this harness must not fake — the selected flow's quote already exists in
  // the approval chain, and no scene endpoint here creates a new one.
  // Unspecified ports delegate to the real synthetic Core/Business instance:
  // a class-instance spread would silently drop its prototype methods (e.g.
  // getQuote/getOrder) and fail the scene assembly's declared-port check.
  const sceneCore = Object.create(dependencies.core);
  Object.assign(sceneCore, {
    getProfile: () => ({ tenantId: 'tenant-a', categoryCode: 'camera' }),
    getWorkspaceCategory: async () => ({ code: 'camera', businessModel: { pricingUnits: ['day'], fulfillmentModes: ['store_pickup_return'] } }),
    getBusinessSettings: () => ({ tenantId: 'tenant-a', calendar: { timeZone: 'UTC' }, pricing: { enabledUnits: ['day'] },
      fulfillment: { enabledModes: ['store_pickup_return'] }, configVersion: 1 }),
    listItemGroups: () => [], listPricingGroups: () => [], listCouponTemplates: () => [],
    // The formal catalog read is bounded-only (listItemGroupsPage); the legacy
    // unbounded method is never called by AI reads. The scene catalog is
    // intentionally empty and the version only satisfies the 64-hex format
    // check — it is a synthetic constant carrying no business fact.
    listItemGroupsPage: async (_tenantId, query) => {
      const rows = [], truncated = false;
      return { rows, truncated, nextCursor: null,
        source: 'persisted_workspace_configuration', configurationVersion: '0'.repeat(64) };
    },
    listLocations: () => [], listOperators: () => [], resolveWorkspaceId: () => 'workspace-a',
    readAvailability: async (_tenantId, request) => ({ available: false, locationId: request.locationId,
      startAt: request.startAt, endAt: request.endAt,
      lines: request.lines.map(line => ({ itemGroupId: line.itemGroupId, itemGroupCode: line.itemGroupId,
        itemGroupName: line.itemGroupId, inventoryMode: 'quantity', requestedQuantity: line.quantity,
        availableQuantity: 0, available: false, reasons: ['synthetic_fixture_unavailable'] })) }),
    resolvePricingGroupQuoteRequest: async () => { throw new Error('pricing_group_resolution_not_available_in_harness'); } });
  const sceneBusiness = Object.create(dependencies.business);
  sceneBusiness.createQuote = async () => { throw new Error('quote_creation_not_available_in_harness'); };
  dependencies.core = sceneCore;
  dependencies.business = sceneBusiness;
  const route = new AiApprovedOrderRouteAuthority(dependencies.guard, dependencies.credentials, dependencies.clock);
  const identity = new (require('../../../apps/api/src/modules/ai-native/task-current-identity.authority').AiTaskCurrentIdentityAuthority)(h.auth, dependencies.credentials, dependencies.clock);
  const authority = new AiCurrentOriginalRequestAuthority(dependencies.db, { ...dependencies,
    creationRules: [{ sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1, audiences: ['operator'], requiredPermissions: ['rental-os:order:create'], maxInputAgeMs: 3600000 }],
    authorizeResources: async () => route.withOrderPreparation(await identity.resolve(), h.body, async context => context)
  }, dependencies.clock);
  const originals = new PrismaOriginalRequestRepository(dependencies.db, authority, dependencies.clock);
  const formal = composeControlledApprovedOrder(dependencies);
  const limits = { maxSteps: 4, maxCalls: 4, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 4096, maxConcurrent: 1 };
  await formal.policy.put({ expectedRevision: null, enabled: true, limits, expiresAt: '2099-01-01T00:00:00Z' });
  const original = await originals.save({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: 'selected-order-original',
    sceneCode: 'quote_clarification', input: { candidate: { customerType: 'personal' } } });
  const task = await originals.createTask({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: original.inputRef });
  for (const operation of ['read_metadata', 'transition_task', 'decide_approval']) state.records.aiTaskActionPolicy.push({ scopeId: 'scope-a', taskId: task.taskId,
    operation, revision: 1, requiredPermissions: [operation === 'read_metadata' ? 'rental-os:order:view' : 'rental-os:order:create'], expiresAt: new Date('2099-01-01') });
  const compose = () => composeHumanQuoteOrder({ ...dependencies, originals }), app = compose();
  const selected = await app.select({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: original.inputRef,
    taskId: task.taskId, runId: task.runId, selectionKey: 'human-choice', expectedSelectionRevision: 0, order: h.body });
  const selection = { draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: original.inputRef,
    taskId: task.taskId, runId: task.runId, selectionId: selected.receipt.selectionId, inputHash: selected.receipt.inputHash };
  if (initializeOnly) {
    for (const operation of ['claim_run', 'claim_recovery_run', 'release_run', 'read_step_terminal', 'read_events']) state.records.aiTaskActionPolicy.push({
      scopeId: 'scope-a', taskId: task.taskId, operation, revision: 1, expiresAt: new Date('2099-01-01'),
      requiredPermissions: ['rental-os:order:create'] });
    return { ...h, app, compose, selection, selected, originals, sceneDependencies: { ...dependencies, originals }, limits };
  }
  // Lease and step-start are explicit runner preconditions; no approval or order is fabricated for this application test.
  Object.assign(state.records.aiTask[0], { status: 'RUNNING' });
  Object.assign(state.records.aiRun[0], { status: 'RUNNING', leaseOwnerId: 'worker-a', fencingToken: new Prisma.Decimal('1'), leaseExpiresAt: new Date(Date.now() + 120000) });
  const lease = () => ({ taskId: task.taskId, runId: task.runId, holderId: 'worker-a', revision: state.records.aiRun[0].revision,
    fencingToken: '1', expiresAt: state.records.aiRun[0].leaseExpiresAt.toISOString() });
  const published = await app.publishSelectedInput({ selection, expectedTaskRevision: state.records.aiTask[0].revision, lease: lease() });
  await formal.plans.savePlan({ taskId: task.taskId, runId: task.runId, taskRevision: state.records.aiTask[0].revision, limits,
    steps: [{ registrationRef: published.registrationRef, operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }] }, lease());
  const { taskId, expiresAt, ...held } = lease();
  const registered = await formal.registrations.register({ taskId, registrationRef: published.registrationRef, expectedTaskRevision: state.records.aiTask[0].revision, lease: held });
  const step = state.records.aiStep.find(s => s.id === registered.stepId);
  step.status = 'RUNNING';
  const prepareCommand = { taskId, proposalId: 'proposal-selected', proposalRevision: 1, actionId: step.actionId,
    expiresAt: new Date(Date.now() + 60000).toISOString(), lease: { ...held, revision: state.records.aiRun[0].revision } };
  const pending = await app.prepareSelectedProposal({ selection, command: prepareCommand });
  const proposal = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: prepareCommand.proposalId, proposalRevision: 1, reviewedPayloadHash: pending.proposal.reviewedPayloadHash };
  return { ...h, app, compose, selection, proposal, prepareCommand, selected, originals,
    sceneDependencies: { ...dependencies, originals }, limits };
};

exports.selectedReprepareHarness = async ({ exposeAcknowledgedLease = false } = {}) => {
  const h = await exports.selectedOrderHarness(), { state } = h;
  const { composeFormalApprovedOrderReprepareServices } = require('../../../apps/api/src/modules/ai-native/approval-execution/formal-approved-order-reprepare.composition');
  Object.assign(h.sceneDependencies.core, {
    getProfile: () => ({ tenantId: 'tenant-a', categoryCode: 'camera' }),
    getWorkspaceCategory: async () => ({ code: 'camera', businessModel: { pricingUnits: ['day'], fulfillmentModes: ['store_pickup_return'] } }),
    getBusinessSettings: () => ({ tenantId: 'tenant-a', calendar: { timeZone: 'UTC' }, pricing: { enabledUnits: ['day'] },
      fulfillment: { enabledModes: ['store_pickup_return'] }, configVersion: 1 })
  });
  const configuration = { holderId: 'worker-a', creationRules: [{ sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1,
    audiences: ['operator'], requiredPermissions: ['rental-os:order:create'], maxInputAgeMs: 3600000 }],
    memberships: { listPersonalOptions: async () => [],
      listPersonalOptionsPage: async () => ({ rows: [], truncated: false }) } };
  const services = composeFormalApprovedOrderReprepareServices(h.sceneDependencies, configuration);
  const dependencies = { ...h.sceneDependencies, originals: services.originals,
    reprepareServices: current => composeFormalApprovedOrderReprepareServices(current, configuration) };
  const app = composeHumanQuoteOrder(dependencies), formal = composeControlledApprovedOrder(dependencies);
  const original = await services.originals.save({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: 'new-human-material',
    sceneCode: 'quote_clarification', input: { candidate: { customerType: 'personal' } }, previousInputRef: h.selection.originalInputRef }, true);
  const task = await services.originals.createTask({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: original.inputRef });
  for (const taskId of [h.selection.taskId, task.taskId]) {
    for (const operation of ['read_metadata', 'transition_task', 'claim_run', 'decide_approval', 'reprepare_approval']) {
      if (!state.records.aiTaskActionPolicy.some(row => row.taskId === taskId && row.operation === operation)) state.records.aiTaskActionPolicy.push({
        scopeId: 'scope-a', taskId, operation, revision: 1, requiredPermissions: [operation === 'read_metadata' ? 'rental-os:order:view' : 'rental-os:order:create'],
        expiresAt: new Date('2099-01-01') });
    }
  }
  const body = { ...clone(h.body), quoteId: 'quote-new-material' };
  state.records.quote.push({ ...clone(state.records.quote[0]), id: body.quoteId, request: clone(body) });
  const selected = await app.select({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: original.inputRef,
    taskId: task.taskId, runId: task.runId, selectionKey: 'new-human-choice', expectedSelectionRevision: 0, order: body });
  const selection = { draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: original.inputRef,
    taskId: task.taskId, runId: task.runId, selectionId: selected.receipt.selectionId, inputHash: selected.receipt.inputHash };
  const held = await formal.tasks.claimRun({ taskId: task.taskId, runId: task.runId, holderId: configuration.holderId,
    expectedTaskRevision: 1, expectedRunRevision: 1, expectedFencingToken: '0', leaseMs: 120000 });
  const run = () => state.records.aiRun.find(row => row.id === task.runId);
  state.records.aiTask.find(row => row.id === task.taskId).status = 'RUNNING'; run().status = 'RUNNING';
  const lease = () => ({ ...held, revision: run().revision });
  const published = await app.publishSelectedInput({ selection, expectedTaskRevision: 1, lease: lease() });
  const plan = await formal.plans.savePlan({ taskId: task.taskId, runId: task.runId, taskRevision: 1, limits: h.limits,
    steps: [{ registrationRef: published.registrationRef, operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }] }, lease());
  const { taskId, expiresAt, ...preRegistration } = lease();
  const registered = await formal.registrations.register({ taskId, registrationRef: published.registrationRef, expectedTaskRevision: 1, lease: preRegistration });
  const step = state.records.aiStep.find(row => row.id === registered.stepId); step.status = 'RUNNING';
  const command = { draftVersion: 'ain-approval-application-draft-1', operationKey: 'selected-reprepare', originalTaskId: h.selection.taskId,
    original: h.proposal, reason: 'rejected', replacement: { taskId, runId: task.runId, stepId: step.id, actionId: step.actionId,
      inputRef: published.inputRef, fingerprint: selected.receipt.inputHash, originalInputRef: original.inputRef,
      quoteSelectionRef: selection.selectionId, planHash: plan.planHash } };
  return { ...h, app, dependencies, configuration, replacementSelection: selection, command,
    // Only the new full reprepare consumer exposes its already acknowledged
    // claim + registration CAS. A later database lease read grants nothing.
    ...(exposeAcknowledgedLease ? { replacementLease: { ...held, revision: registered.runRevision } } : {}) };
};
