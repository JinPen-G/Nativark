'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const { PrismaGatewayAccountingFacts } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-accounting-facts');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');

const time = new Date('2026-10-05T12:00:00Z');
const config = { configId: 'profile', configRevision: 1, credentialRef: 'vault', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model', serviceMode: 'tenant_managed', tenantId: 'tenant', configurationScope: { kind: 'tenant', tenantId: 'tenant' } };
const association = { requestId: 'call', runId: 'run', stepId: 'step', actionId: 'action', idempotencyKey: 'call', priceVersion: 'price', scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'workspace' }, config };
const call = { context: { actorId: 'actor', tenantId: 'tenant', workspaceId: 'workspace' }, binding: { id: 'admission', actorId: 'actor', callId: 'call', requestHash: 'a'.repeat(64), profileId: 'profile', dispatchId: 'dispatch', scope: { id: 'scope', kind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'workspace' } }, request: { callId: 'call', model: 'model', maxOutputTokens: 32, intentHash: 'b'.repeat(64) }, expiresAt: new Date(time.getTime() + 60000) };

for (const recoverAfterRotation of [false, true]) test(`real task budget authority binds the persisted invocation and rejects forged scope or revoked actor${recoverAfterRotation ? ' after price rotation' : ''}`, { timeout: 15000 }, async () => {
  const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
  const { PrismaTaskBudgetAuthorizationSource } = require('../apps/api/src/modules/ai-native/budget/prisma-task-budget-authorization.source');
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const configuration = { ...config, tenantId: 'tenant-a', model: 'synthetic-model', configurationScope: { kind: 'tenant', tenantId: 'tenant-a' } };
  const scope = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  const assoc = { ...association, runId: 'run-a', stepId: 'step-a', actionId: 'action-a', scope, config: configuration };
  const invocation = { id: 'invocation-a', scopeId: 'scope-a', taskId: 'task-a', actorId: 'user-a', callId: 'call',
    runId: 'run-a', stepId: 'step-a', actionId: 'action-a', sceneCode: 'synthetic-clarification', priceVersion: 'price',
    configuration, configurationHash: requestFingerprint(configuration), intentHash: 'b'.repeat(64), stepFingerprint: 'b'.repeat(64),
    maxOutputTokens: 32, leaseOwnerId: 'bootstrap', fencingToken: new Prisma.Decimal(1), expiresAt: new Date('2026-10-06T12:01:00Z'), registrationHash: 'c'.repeat(64) };
  const h = await authorizedRunnerHarness({ aiGatewayInvocation: [invocation], aiBudgetReservation: [], aiBudgetAllocation: [], aiBudgetLedgerEntry: [],
    aiProviderProfile: [{ id: 'profile', scopeId: 'scope-tenant', scopeKind: 'TENANT', enabled: true, disabledAt: null,
      configRevision: 1, credentialRef: 'vault', protocol: configuration.protocol, provider: configuration.provider,
      model: configuration.model, serviceMode: 'tenant_managed' }],
    aiStep: [{ id: 'step-a', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', status: 'RUNNING', actionId: 'action-a', requestFingerprint: 'b'.repeat(64) }] });
  let managementChecks = 0;
  await h.tasks.claimRun(h.claim());
  h.state.aiGatewayInvocation[0].leaseOwnerId = h.state.aiRun[0].leaseOwnerId;
  h.state.aiGatewayInvocation[0].fencingToken = h.state.aiRun[0].fencingToken;
  const source = new PrismaTaskBudgetAuthorizationSource({ ...h.authorization, db: h.db,
    guard: { canActivate: async () => { managementChecks++; return false; } }, clock: () => h.control.now });
  const current = await source.resolveContext();
  const grant = await source.authorize('reserve', current, { association: assoc });
  assert.match(grant.authorizationKey, /^task-budget:[a-f0-9]{64}$/u);
  const { PrismaGatewayCallPricing } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-call-pricing');
  for (const policy of h.state.aiBudgetPolicy) policy.unitKind = 'calls';
  const pricing = new PrismaGatewayCallPricing(h.db, source.scopes, 'price', () => h.control.now);
  const command = { association: assoc, callId: 'call', sceneCode: 'synthetic-clarification', expiresAt: invocation.expiresAt };
  const authorized = { ...grant, context: current, entitled: true };
  const quote = await pricing.quote(command, authorized);
  assert.deepEqual(quote.quantity, { unit: 'calls', value: 1 });
  assert.deepEqual(quote.policies.map(policy => policy.scopeKind), ['PLATFORM', 'TENANT', 'WORKSPACE']);
  const laterGrant = { ...authorized, expiresAt: new Date(authorized.expiresAt.getTime() + 1000) };
  assert.deepEqual(await pricing.quote(command, laterGrant), quote); // grant lifetime is not a new billing operation
  await assert.rejects(pricing.quote({ ...command, association: { ...assoc, priceVersion: 'other' } }, authorized), { code: 'FORBIDDEN' });
  h.state.aiBudgetPolicy[0].unitKind = 'money';
  await assert.rejects(pricing.quote(command, authorized), { code: 'UNAVAILABLE' });
  h.state.aiBudgetPolicy[0].unitKind = 'calls';
  const { createAuthorizedPersistedGatewayBudget } = require('../apps/api/src/modules/ai-native/budget/gateway-budget.composition');
  const root = createAuthorizedPersistedGatewayBudget({ ...h.authorization, db: h.db, pricing,
    guard: { canActivate: async () => false }, clock: () => h.control.now });
  const accountingCall = { context: { actorId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    binding: { id: 'admission-a', actorId: 'user-a', callId: 'call', requestHash: 'a'.repeat(64), profileId: 'profile',
      dispatchId: 'dispatch-a', scope: { id: 'scope-a', kind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'workspace-a' } },
    request: { callId: 'call', model: configuration.model, maxOutputTokens: 32, intentHash: 'b'.repeat(64) }, expiresAt: invocation.expiresAt };
  h.state.aiInvocationAdmission.push({ ...accountingCall.binding, ...accountingCall.context,
    status: 'admitted', revokedAt: null, completedAt: null, expiresAt: invocation.expiresAt });
  const reserved = await root.budget.reserve(accountingCall);
  assert.equal(h.state.aiBudgetReservation.length, 1);
  assert.equal(h.state.aiBudgetAllocation.length, 3);
  await root.budget.dispatch(accountingCall, reserved.id);
  if (recoverAfterRotation) {
    h.storeControl.beforeWrite = (table, args) => {
      if (table === 'aiBudgetLedgerEntry' && args.data.kind === 'settle') throw Error('synthetic settlement rollback');
    };
    try {
      await assert.rejects(root.budget.settle(accountingCall, reserved.id, 'provider-event', { inputTokens: 2, outputTokens: 3 }), { code: 'ACCOUNTING_PENDING' });
    } finally { h.storeControl.beforeWrite = null; }
    assert.equal(h.state.aiGatewayAccountingReceipt[0].inputTokens, 2n);
    assert.equal(h.state.aiGatewayAccountingReceipt[0].outputTokens, 3n);
    assert.equal(h.state.aiBudgetReservation[0].actualCalls, null);
    await root.budget.abandon(accountingCall, reserved.id, 'settlement_pending');
    assert.equal(h.state.aiBudgetReservation[0].status, 'pending_reconciliation');
    const originalInvocation = h.clone(h.state.aiGatewayInvocation[0]);
    const originalReceipt = h.clone(h.state.aiGatewayAccountingReceipt[0]);
    h.state.aiProviderProfile[0].configRevision = 2;
    h.state.aiProviderProfile[0].enabled = false;
    h.state.aiProviderProfile[0].disabledAt = new Date(h.control.now);
    for (const policy of h.state.aiBudgetPolicy) {
      policy.configRevision++;
      policy.priceVersion = 'price-next';
      policy.enabled = false;
      policy.settingsJson.gates.scene.enabled = false;
    }
    h.control.now = new Date('2026-10-06T12:02:00Z');
    const nextPricing = new PrismaGatewayCallPricing(h.db, source.scopes, 'price-next', () => h.control.now);
    await assert.rejects(nextPricing.quote(command, authorized), { code: 'FORBIDDEN' });
    const { composePersistedTaskCallAccountingRecovery } = require('../apps/api/src/modules/ai-native/task-model-gateway.composition');
    const recovery = composePersistedTaskCallAccountingRecovery({ ...h.authorization, db: h.db,
      guard: { canActivate: async () => false }, taskId: 'task-a', callPriceVersion: 'price-next', clock: () => h.control.now });
    const before = await recovery.readCall({ callId: 'call' });
    assert.equal(before.association.priceVersion, 'price');
    assert.equal(before.association.config.configRevision, 1);
    await assert.rejects(nextPricing.quantity({ ...before, association: { ...before.association, priceVersion: 'price-next' } },
      { inputTokens: 2, outputTokens: 3 }), { code: 'FORBIDDEN' });
    const beforeRecoveryLedgerCount = h.state.aiBudgetLedgerEntry.length;
    h.state.aiGatewayAccountingReceipt[0].inputTokens = null;
    await assert.rejects(recovery.reconcile({ reservationId: reserved.id }), { code: 'PENDING_RECONCILIATION' });
    assert.equal(h.state.aiBudgetLedgerEntry.length, beforeRecoveryLedgerCount);
    h.state.aiGatewayAccountingReceipt[0].inputTokens = originalReceipt.inputTokens;
    const reconciled = await recovery.reconcile({ reservationId: reserved.id });
    assert.deepEqual(reconciled.actual, { unit: 'calls', value: 1 });
    assert.equal(reconciled.association.priceVersion, 'price');
    assert.equal(reconciled.association.config.configRevision, 1);
    const ledgerCount = h.state.aiBudgetLedgerEntry.length;
    await recovery.reconcile({ reservationId: reserved.id });
    assert.equal(h.state.aiBudgetLedgerEntry.length, ledgerCount);
    await assert.rejects(recovery.releaseUnsent({ reservationId: reserved.id }), { code: 'PENDING_RECONCILIATION' });
    assert.deepEqual(h.state.aiGatewayInvocation[0], originalInvocation);
    assert.deepEqual(h.state.aiGatewayAccountingReceipt[0], originalReceipt);
  } else {
    await root.budget.settle(accountingCall, reserved.id, 'provider-event', { inputTokens: 2, outputTokens: 3 });
    await root.budget.settle(accountingCall, reserved.id, 'provider-event', { inputTokens: 2, outputTokens: 3 });
  }
  assert.equal(h.state.aiBudgetReservation[0].status, 'settled');
  assert.equal(h.state.aiBudgetReservation[0].actualCalls, 1);
  assert.equal(h.state.aiBudgetLedgerEntry.filter(entry => entry.kind === (recoverAfterRotation ? 'reconcile' : 'settle')).length, 1);
  const allocations = await h.db.aiBudgetAllocation.findMany({ where: { reservationId: reserved.id },
    select: { reservation: { select: { status: true, actualCalls: true } } } });
  assert.equal(allocations.length, 3);
  assert.ok(allocations.every(row => row.reservation.status === 'settled' && row.reservation.actualCalls === 1));
  const { PrismaBudgetRepository } = require('../apps/api/src/modules/ai-native/budget/prisma-budget.repository');
  const record = await new PrismaBudgetRepository(h.db).get(reserved.id, assoc);
  assert.equal(record.dispatched, true); // completed consumption is still an original dispatched fact, not permission to dispatch again
  assert.deepEqual(await pricing.quantity(record, { inputTokens: 2, outputTokens: 3 }), { unit: 'calls', value: 1 });
  await assert.rejects(pricing.quantity(record, { inputTokens: NaN, outputTokens: 3 }), { code: 'UNAVAILABLE' });
  h.state.aiBudgetReservation[0].unitKind = 'money';
  await assert.rejects(pricing.quantity(record, { inputTokens: 2, outputTokens: 3 }), { code: 'FORBIDDEN' });
  assert.equal(managementChecks, 0); // business step authorization, not config management bypass
  await assert.rejects(source.authorize('reserve', current, { association: { ...assoc, scope: { ...scope, workspaceId: 'other' } } }), { code: 'FORBIDDEN' });
  await assert.rejects(source.authorize('settings_write', current, { policy: { scopeKind: 'WORKSPACE', scopeId: 'scope-a', sceneCode: 'synthetic-clarification' } }), { code: 'FORBIDDEN' });
  assert.equal(managementChecks, 1);
  h.identity.session = false;
  await assert.rejects(source.authorize('reserve', current, { association: assoc }));
  assert.equal(h.state.aiBudgetReservation.length, 1); // one original service reservation, no duplicate settlement/account
});

for (const unit of ['calls', 'tokens', 'money']) test(`customer persisted ${unit} gateway and original recovery share the authorized ledger`, { timeout: 30000 }, async () => {
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const { SubscriptionService } = require('../apps/api/src/modules/subscription/subscription.service');
  const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
  const { composeClientMaterialTasks } = require('../apps/api/src/modules/ai-native/scenes/client-task.composition');
  const { composePersistedClientTaskAuthorization } = require('../apps/api/src/modules/ai-native/scenes/client-task-execution.composition');
  const { composeClientTaskModelConfiguration, composeClientTaskAccountingRecovery } = require('../apps/api/src/modules/ai-native/scenes/client-task-model-configuration.composition');
  const { PrismaGatewayPricingRecords } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-pricing-records');
  const sceneCode = 'synthetic-client-pricing', sceneVersion = '1';
  let now = new Date('2026-10-06T12:00:00Z');
  const clock = () => new Date(now), expiresAt = new Date(now.getTime() + 60000);
  const scopes = [{ id: 'scope-platform', ...aiPersistenceScopeColumns({ kind: 'platform' }) },
    { id: 'scope-tenant', ...aiPersistenceScopeColumns({ kind: 'tenant', tenantId: 'tenant-a' }) },
    { id: 'scope-a', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) }];
  const configuration = { ...config, tenantId: 'tenant-a', configurationScope: { kind: 'tenant', tenantId: 'tenant-a' } };
  const identity = { tenantId: 'tenant-a', workspaceId: 'workspace-a', customerId: 'customer-a', sessionId: 'client-session',
    customerType: 'personal', membershipStatus: 'active' };
  const material = { id: '9425397d-f0f1-4a29-a29e-0daa94fb3302', tenantId: identity.tenantId, workspaceId: identity.workspaceId,
    channel: 'web', principalKind: 'personal', principalHash: requestFingerprint(identity), inputHash: '1'.repeat(64),
    materialHash: '2'.repeat(64), bindingHash: '3'.repeat(64), revision: 1, createdAt: clock(), expiresAt };
  const policy = { id: '0f386eaa-e795-484a-9a79-513933bddae1', tenantId: identity.tenantId, workspaceId: identity.workspaceId,
    channel: 'web', customerType: 'personal', sceneCode, sceneVersion, enabled: true, allowCreate: true, allowRead: true,
    allowExecute: true, revision: 1, expiresAt: new Date('2027-01-01') };
  const quantity = unit === 'money' ? { unit, amount: '1.000000', currency: 'USD', scale: 6 } : { unit, value: 1000 };
  const store = createTaskInputStore({ aiScope: scopes, aiTask: [], aiRun: [], aiStep: [], aiTaskEvent: [], aiTaskRunPlan: [],
    aiBudgetReservation: [], aiBudgetAllocation: [], aiBudgetLedgerEntry: [], aiGatewayInvocation: [],
    aiGatewayAccountingReceipt: [], aiInvocationAdmission: [], operationLog: [], aiGatewayPriceRecord: [], aiGatewayInputBoundRecord: [],
    aiClientTaskPolicy: [policy], aiClientTaskInput: [], aiPlatformModelConnection: [],
    aiTenantModelConfiguration: [], aiProviderCapabilityEvidence: [], systemParameterSet: [],
    aiProviderProfile: [{ id: 'profile', scopeId: 'scope-tenant', scopeKind: 'TENANT', enabled: true, disabledAt: null,
      configRevision: 1, credentialRef: configuration.credentialRef, protocol: configuration.protocol,
      provider: configuration.provider, model: configuration.model, serviceMode: 'tenant_managed' }],
    aiBudgetPolicy: scopes.map(scope => ({ id: `policy-${scope.id}`, scopeId: scope.id, scopeKind: scope.kind,
      sceneCode, configRevision: 1, enabled: true, unitKind: unit, priceVersion: 'price', settingsJson: {
        draftVersion: 'ain-c07-draft-2', scope: scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: 'tenant-a' },
        config: configuration, gates: Object.fromEntries(['platform', 'tenant', 'scene'].map(key => [key, { enabled: true, revision: 1 }])),
        sceneCode, allowedModels: [configuration.model], allowedScenes: [sceneCode], budget: { state: 'limited', quantity },
        maxConcurrent: 1, maxCallsPerRun: 3 } })),
    tenant: [{ id: 'tenant-a', subscription: { id: 'sub-a', tenantId: 'tenant-a', revision: 4, plan: 'PRO', source: 'HISTORICAL_REGISTER',
      startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), serviceTimeZone: 'UTC', billingAnniversary: new Date('2026-01-01') }, subscriptionSegments: [] }],
    subscriptionFeatureCatalog: [{ code: 'ai.native.use', name: 'Synthetic AI feature', module: 'ai', categories: [],
      currentOwnership: 'PRO', defaultOwnership: 'PRO', releaseStatus: 'RELEASED', valueText: null, externalFeeNote: null }], tenantFeatureGrant: [] });
  const { db, state, clone } = { ...store, clone: require('./fixtures/ai-native/task-input-store.cjs').clone };
  const loadMaterial = async ref => { assert.equal(ref, material.id); return { row: clone(material), identity: clone(identity) }; };
  const dependencies = { db, subscriptions: new SubscriptionService(db), sceneCode, sceneVersion, loadMaterial, clock };
  const command = { materialRef: material.id, creationKey: 'client-accounting' };
  const created = await composeClientMaterialTasks(dependencies, loadMaterial, clock).create(command);
  assert.equal(created.state, 'observed');
  const authorization = composePersistedClientTaskAuthorization(dependencies, command, loadMaterial, clock);
  const lease = await authorization.tasks.claimRun({ taskId: created.task.taskId, runId: created.task.runId, holderId: 'client-worker',
    expectedTaskRevision: 1, expectedRunRevision: 1, expectedFencingToken: '0', leaseMs: 100000 });
  const { AiTaskTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-task-transition.repository');
  await new AiTaskTransitionRepository(db, authorization.authority, clock).transition({ taskId: created.task.taskId,
    expectedRevision: state.aiTask[0].revision, to: 'running', reason: 'start',
    lease: { runId: created.task.runId, holderId: 'client-worker', revision: lease.revision, fencingToken: lease.fencingToken } });
  const invocation = { id: 'client-invocation', scopeId: 'scope-a', taskId: created.task.taskId, actorId: identity.customerId,
    runId: created.task.runId, stepId: 'client-step', actionId: 'client-action', callId: 'client-call', sceneCode, priceVersion: 'price',
    configuration, configurationHash: requestFingerprint(configuration), intentHash: 'b'.repeat(64), stepFingerprint: 'b'.repeat(64),
    maxOutputTokens: 32, leaseOwnerId: 'client-worker', fencingToken: new Prisma.Decimal(lease.fencingToken), expiresAt, registrationHash: 'c'.repeat(64) };
  state.aiGatewayInvocation.push(invocation);
  state.aiStep.push({ id: invocation.stepId, scopeId: invocation.scopeId, taskId: invocation.taskId, runId: invocation.runId,
    status: 'RUNNING', actionId: invocation.actionId, requestFingerprint: invocation.stepFingerprint });
  const unavailable = async () => { throw Error('model/credential access is forbidden in accounting verification'); };
  const configured = await composeClientTaskModelConfiguration({ ...dependencies,
    secrets: { encrypt: unavailable, decrypt: unavailable } }, command);
  const selection = { kind: unit === 'calls' ? 'calls' : 'recorded', priceVersion: 'price' };
  const server = { db, routeScene: 'chat', adapters: [{ provider: 'synthetic', features: ['text'], generate: unavailable }], pricing: selection };
  const gateway = configured.createPersistedGateway(server);
  assert.equal(gateway.runtime.ports.budget.constructor.name, 'PersistentGatewayBudget');
  assert.equal(gateway.priceVersion, 'price');
  if (unit === 'calls') {
    const { pricing: _pricing, ...legacy } = server;
    assert.equal(configured.createPersistedCallGateway({ ...legacy, callPriceVersion: 'price' }).callPriceVersion, 'price');
  }
  selection.priceVersion = 'changed-after-composition';
  assert.equal(gateway.priceVersion, 'price');
  assert.throws(() => configured.createPersistedGateway({ ...server, pricing: { kind: 'recorded', priceVersion: 'price', amount: 0 } }), { code: 'CONFIG_INVALID' });
  assert.throws(() => configured.createPersistedGateway({ ...server, pricing: undefined }), { code: 'CONFIG_INVALID' });
  assert.throws(() => configured.createPersistedGateway({ ...server, callPriceVersion: 'price' }), { code: 'CONFIG_INVALID' });
  assert.throws(() => configured.createPersistedCallGateway({ ...server, callPriceVersion: 'price' }), { code: 'CONFIG_INVALID' });
  if (unit !== 'calls') assert.throws(() => configured.createPersistedGateway({ ...server, routeScene: 'vision' }), { code: 'CONFIG_INVALID' });
  const accountingCall = { ...call, context: { actorId: identity.customerId, tenantId: identity.tenantId, workspaceId: identity.workspaceId },
    binding: { ...call.binding, id: 'client-admission', actorId: identity.customerId, callId: invocation.callId,
      scope: { id: 'scope-a', kind: 'WORKSPACE', tenantId: identity.tenantId, workspaceId: identity.workspaceId } },
    request: { ...call.request, callId: invocation.callId }, expiresAt };
  state.aiInvocationAdmission.push({ ...accountingCall.binding, ...accountingCall.context,
    status: 'admitted', revokedAt: null, completedAt: null, expiresAt });
  const { PrismaClientTaskBudgetAuthorizationSource } = require('../apps/api/src/modules/ai-native/budget/prisma-client-task-budget-authorization.source');
  const { PrismaGatewayInvocationBindings } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-invocation-bindings');
  const budgetAuthority = new PrismaClientTaskBudgetAuthorizationSource({ ...dependencies, command });
  const binding = await new PrismaGatewayInvocationBindings(db, budgetAuthority.scopes, clock)
    .resolveForReserve(accountingCall.context, accountingCall.request);
  await budgetAuthority.authorize('reserve', await budgetAuthority.resolveContext(), { association: binding.association });
  if (unit !== 'calls') {
    await assert.rejects(gateway.runtime.ports.budget.reserve(accountingCall), { code: 'BUDGET_UNAVAILABLE' });
    assert.equal(state.aiBudgetReservation.length, 0);
    const records = new PrismaGatewayPricingRecords(db);
    const evidence = { kind: 'gateway-price-1', priceVersion: 'price', configuration,
      usageClass: 'plain_text_input_output_tokens', additionalBillingDimensions: 'none', validFrom: now.toISOString(), expiresAt: expiresAt.toISOString(),
      billing: unit === 'tokens' ? { unit, metric: 'input_plus_output', scale: 0, rounding: 'exact' }
        : { unit, currency: 'USD', scale: 6, inputPerMillion: '2.000000', outputPerMillion: '3.000000', rounding: 'ceil_total_micro_units' },
      provenance: { reference: 'synthetic-price', revision: '1', documentHash: 'd'.repeat(64) } };
    const priceId = records.priceId('scope-a', invocation.configurationHash, 'price'), priceHash = requestFingerprint(evidence);
    state.aiGatewayPriceRecord.push({ id: priceId, scopeId: 'scope-a', configurationHash: invocation.configurationHash,
      priceVersion: 'price', sourceReference: evidence.provenance.reference, payload: evidence, payloadHash: priceHash });
    const bound = { kind: 'gateway-input-bound-1', invocationId: invocation.id, scopeId: 'scope-a', registrationHash: invocation.registrationHash,
      intentHash: invocation.intentHash, configurationHash: invocation.configurationHash, priceVersion: 'price', priceHash,
      maxInputTokens: 10, maxOutputTokens: 32, modality: 'text', additionalBillingDimensions: 'none', method: 'certified_tokenizer_bound',
      validFrom: now.toISOString(), expiresAt: expiresAt.toISOString(), provenance: { reference: 'synthetic-bound', revision: '1', documentHash: 'e'.repeat(64) } };
    state.aiGatewayInputBoundRecord.push({ id: records.boundId('scope-a', invocation.id), scopeId: 'scope-a', invocationId: invocation.id,
      priceRecordId: priceId, payload: bound, payloadHash: requestFingerprint(bound) });
  }
  const reserved = await gateway.runtime.ports.budget.reserve(accountingCall);
  assert.equal(state.aiBudgetReservation.length, 1);
  assert.equal(state.aiBudgetAllocation.length, 3);
  await gateway.runtime.ports.budget.dispatch(accountingCall, reserved.id);
  await gateway.runtime.ports.budget.abandon(accountingCall, reserved.id, 'provider_reply_pending');
  await assert.rejects(gateway.accountingRecovery.reconcile({ reservationId: reserved.id }), { code: 'PENDING_RECONCILIATION' });
  // Late original usage is persisted, but an unknown account must use reconcile.
  await assert.rejects(gateway.runtime.ports.budget.settle(accountingCall, reserved.id, 'late-original-usage',
    { inputTokens: 2, outputTokens: 3 }), { code: 'ACCOUNTING_PENDING' });
  const originalInvocation = clone(state.aiGatewayInvocation[0]), originalPrices = clone(state.aiGatewayPriceRecord);
  state.aiProviderProfile[0].enabled = false; state.aiProviderProfile[0].configRevision = 2;
  state.aiClientTaskPolicy[0].allowExecute = false; state.aiClientTaskPolicy[0].revision++;
  for (const row of state.aiBudgetPolicy) { row.enabled = false; row.priceVersion = 'next-price'; row.configRevision++; }
  now = new Date('2026-10-06T12:02:00Z');
  const recovery = composeClientTaskAccountingRecovery({ ...dependencies, pricing: { ...selection, priceVersion: 'next-price' } }, command);
  const result = await recovery.reconcile({ reservationId: reserved.id });
  const expected = unit === 'money' ? { unit, amount: '0.000013', currency: 'USD', scale: 6 } : { unit, value: unit === 'tokens' ? 5 : 1 };
  assert.equal(result.status, 'settled');
  assert.deepEqual(result.actual, expected);
  assert.equal(result.association.priceVersion, 'price');
  assert.equal(result.association.config.configRevision, 1);
  const ledgerCount = state.aiBudgetLedgerEntry.length;
  await recovery.reconcile({ reservationId: reserved.id });
  assert.equal(state.aiBudgetLedgerEntry.length, ledgerCount);
  assert.equal(state.aiBudgetLedgerEntry.filter(row => row.kind === 'reconcile').length, 1);
  assert.equal(state.aiBudgetReservation.length, 1);
  assert.deepEqual(state.aiGatewayInvocation[0], originalInvocation);
  assert.deepEqual(state.aiGatewayPriceRecord, originalPrices);
  await assert.rejects(recovery.releaseUnsent({ reservationId: reserved.id }), { code: 'PENDING_RECONCILIATION' });
  await assert.rejects(gateway.runtime.ports.budget.reserve(accountingCall));
  for (const key of ['customerId', 'workspaceId']) {
    const original = identity[key]; identity[key] = 'another-principal-or-scope';
    await assert.rejects(recovery.readCall({ callId: invocation.callId }), e => ['AI_ACCESS_DENIED', 'FORBIDDEN'].includes(e.code));
    identity[key] = original;
  }
  state.aiClientTaskPolicy[0].allowRead = false;
  await assert.rejects(recovery.read({ reservationId: reserved.id }), e => ['AI_ACCESS_DENIED', 'FORBIDDEN'].includes(e.code));
});

function harness() {
  const state = { revoked: false, writes: 0, fail: null, onRead: null, pricing: null, rows: {
    aiGatewayInvocation: { id: 'invocation', scopeId: 'scope', taskId: 'task', actorId: 'actor', callId: 'call', runId: 'run', stepId: 'step', actionId: 'action', sceneCode: 'scene', priceVersion: 'price', configuration: config, configurationHash: requestFingerprint(config), intentHash: call.request.intentHash, maxOutputTokens: 32 },
    aiBudgetReservation: { id: 'reservation', scopeId: 'scope', scopeKind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'workspace', actorId: 'actor', callId: 'call', requestId: 'call', runId: 'run', stepId: 'step', actionId: 'action', idempotencyKey: 'call', sceneCode: 'scene', priceVersion: 'price', configRevision: 1, configurationHash: requestFingerprint(config), status: 'reserved', dispatchState: 'dispatched', reservedTokens: 32n, reservedCalls: null, reservedMoney: null, actualTokens: null, actualCalls: null, actualMoney: null, moneyCurrency: null, unknownReason: null, expiresAt: call.expiresAt, updatedAt: time },
    aiInvocationAdmission: { id: 'admission', tenantId: 'tenant', workspaceId: 'workspace', actorId: 'actor', callId: 'call', requestHash: call.binding.requestHash, profileId: 'profile', dispatchId: 'dispatch' },
    aiGatewayAccountingReceipt: { id: 'receipt', invocationId: 'invocation', admissionId: 'admission', reservationId: 'reservation', taskId: 'task', scopeId: 'scope', scopeKind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'workspace', dispatchToken: 'dispatch', requestHash: call.binding.requestHash, state: 'dispatched', usageHash: null, inputTokens: null, outputTokens: null }
  } };
  const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
  function delegates(rows) {
    return Object.fromEntries(Object.keys(rows).map(name => [name, {
      findUnique: async ({ where }) => { state.onRead?.(name); return matches(rows[name], where) ? structuredClone(rows[name]) : null; },
      updateMany: async ({ where, data }) => {
        if (!matches(rows[name], where)) return { count: 0 };
        state.writes++; Object.assign(rows[name], structuredClone(data));
        if (state.fail === 'write') throw Error('synthetic write failure');
        return { count: 1 };
      }
    }]));
  }
  const db = Object.fromEntries(Object.keys(state.rows).map(name => [name, Object.fromEntries(['findUnique', 'updateMany'].map(method => [method, args => delegates(state.rows)[name][method](args)]))]));
  db.$transaction = async fn => {
    const rows = structuredClone(state.rows), result = await fn(delegates(rows));
    if (state.fail === 'commit') throw Error('synthetic rollback');
    state.rows = rows;
    if (state.fail === 'ack') throw Error('synthetic lost commit acknowledgement');
    return result;
  };
  const bindings = { resolveForReserve: async () => ({ actorId: 'actor', association, sceneCode: 'scene', expiresAt: call.expiresAt }), resolveForReservation: async () => {
    if (state.revoked) throw Error('revoked');
    return { actorId: 'actor', association: structuredClone(association), sceneCode: 'scene', expiresAt: call.expiresAt };
  } };
  const scopes = { resolveCurrent: async () => {
    if (state.revoked) throw Error('revoked');
    return { context: { contractVersion: 'ain-c01-c02-draft-1', requestId: 'accounting-current', authorizedAt: time.toISOString(),
      ...(state.customer ? { audience: 'client', actor: { kind: 'customer', customerId: 'actor' } }
        : { audience: 'operator', actor: { kind: 'user', userId: 'actor' }, access: { permissions: ['ai:use'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } }),
      scope: association.scope }, scope: { id: 'scope', kind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'workspace' } };
  } };
  const source = () => new PrismaGatewayAccountingFacts(db, bindings, scopes, { quantity: async (record, usage) => {
    state.pricing?.(record);
    return { unit: 'tokens', value: usage.inputTokens + usage.outputTokens };
  } }, () => time);
  return { state, source };
}

test('actual accounting repository persists usage, replays it after recreation and rejects altered usage', async () => {
  const h = harness();
  assert.equal(await h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 }), 'receipt');
  assert.equal(await h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 }), 'receipt');
  assert.equal(h.state.writes, 1);
  assert.equal((await h.source().readUsage('reservation', 'receipt', false)).quantity.value, 3);
  await assert.rejects(h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 3 }), e => e.code === 'IDEMPOTENCY_CONFLICT');
});

test('customer accounting reads only original dispatch usage and retains revoked-current refusal', async () => {
  const h = harness(); h.state.customer = true;
  await h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 });
  assert.equal((await h.source().readUsage('reservation', 'receipt', false)).quantity.value, 3);
  h.state.revoked = true;
  await assert.rejects(h.source().readUsage('reservation', 'receipt', false));
});
for (const fail of ['write', 'commit', 'ack']) test(`actual accounting transaction ${fail} failure retains accurate persisted state`, async () => {
  const h = harness(); h.state.fail = fail;
  await assert.rejects(h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 }));
  assert.equal(h.state.rows.aiGatewayAccountingReceipt.inputTokens, fail === 'ack' ? 1n : null);
  h.state.fail = null;
  if (fail === 'ack') assert.equal(await h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 }), 'receipt');
});
test('dispatch evidence rechecks authorization after repository reads', async () => {
  const h = harness(); h.state.onRead = () => { h.state.revoked = true; };
  await assert.rejects(h.source().readDispatch('reservation'));
  const changed = harness(); let queued = false;
  changed.state.onRead = name => {
    if (name === 'aiInvocationAdmission' && !queued) {
      queued = true;
      queueMicrotask(() => { changed.state.rows.aiGatewayAccountingReceipt.state = 'cancelled'; });
    }
  };
  await assert.rejects(changed.source().readDispatch('reservation'), e => e.code === 'PENDING_RECONCILIATION');
  assert.equal(changed.state.writes, 0, 'changed evidence is observed, never corrected by a read');
});
test('usage pricing cannot mutate the stored association used in returned evidence', async () => {
  const h = harness(); await h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 });
  h.state.pricing = record => { record.association.priceVersion = 'forged-price'; };
  const evidence = await h.source().readUsage('reservation', 'receipt', false);
  assert.equal(evidence.evidenceHash, requestFingerprint({ usageHash: h.state.rows.aiGatewayAccountingReceipt.usageHash, priceVersion: 'price', quantity: { unit: 'tokens', value: 3 } }));
});
test('linked price binding cannot change while asynchronous pricing resolves', async () => {
  const h = harness(); await h.source().recordUsage(call, 'reservation', { inputTokens: 1, outputTokens: 2 });
  h.state.pricing = () => { h.state.rows.aiGatewayInvocation.priceVersion = 'changed'; h.state.rows.aiBudgetReservation.priceVersion = 'changed'; };
  await assert.rejects(h.source().readUsage('reservation', 'receipt', false));
});
