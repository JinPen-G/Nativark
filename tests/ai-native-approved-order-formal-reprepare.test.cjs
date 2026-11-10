'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { formalReprepareHarness } = require('./fixtures/ai-native/approved-order-formal-reprepare.cjs');
const { composeFormalApprovedOrderReprepareServices } = require('../apps/api/src/modules/ai-native/approval-execution/formal-approved-order-reprepare.composition');
const { composeRequestBoundFormalApprovedOrderApplication } = require('../apps/api/src/modules/ai-native/approval-execution/request-bound-approved-order.application');
const { PrismaQuoteSelectionRepository } = require('../apps/api/src/modules/ai-native/task-request/prisma-quote-selection.repository');
const { PrismaOriginalRequestRepository } = require('../apps/api/src/modules/ai-native/task-request/prisma-original-request.repository');
const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
test('formal reprepare complete dates use the original guarded rate/configuration ports without creating a quote', async () => {
  const h = await formalReprepareHarness();
  const category = require('../packages/shared/src/index.ts').RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === 'camera');
  const facts = { tenantId: 'tenant-a', workspaceId: 'workspace-a', profile: { tenantId: 'tenant-a', categoryCode: 'camera' },
    category, settings: { tenantId: 'tenant-a', calendar: { timeZone: 'UTC' }, configVersion: 1,
      pricing: { enabledUnits: ['day_24h'], defaultUnit: 'day_24h' }, fulfillment: { enabledModes: ['store_pickup_return'] } },
    groups: [], pricingGroups: [], couponTemplates: [], locations: [], operators: [] };
  // Declared transport rows only, not a database or pricing simulation.
  h.dependencies.core.readQuoteConfiguration = async () => clone(facts);
  h.dependencies.core.resolvePricingGroupQuoteRequest = async (_tenant, value) => value;
  let ratesRead = 0, quotesCreated = 0;
  const business = { createQuote: async () => { quotesCreated++; throw Error('resource read must not create a quote'); },
    readQuoteRateTargets: async (tenant, context, at) => {
      assert.equal(tenant, 'tenant-a'); assert.deepEqual(context.category, category);
      assert.equal(at, '2026-10-10T00:00:00.000Z'); ratesRead++; return [];
    } };
  const sources = composeFormalApprovedOrderReprepareServices({ ...h.dependencies, business }, h.configuration);
  const body = { sceneCode: 'quote_clarification', input: { candidate: { customerType: 'personal',
    start: '2026-10-10T00:00:00Z', end: '2026-10-11T00:00:00Z' } } };
  assert.equal((await sources.originals.authority.read(body, '1')).context.scope.workspaceId, 'workspace-a');
  assert.ok(ratesRead > 0); assert.equal(quotesCreated, 0);
  const missing = composeFormalApprovedOrderReprepareServices({ ...h.dependencies, business: undefined }, h.configuration);
  await assert.rejects(missing.originals.authority.read(body, '1'), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
});

async function requestApp(h) {
  const { credentials, reprepareServices, ...dependencies } = h.dependencies;
  return { api: composeRequestBoundFormalApprovedOrderApplication(dependencies, { enabled: true, audience: 'operator' }, h.configuration),
    request: { headers: { authorization: (await credentials.current()).authorization } } };
}

test('formal original/selection repositories and claimed lease reach reprepare, new human decision and Core (database/runner states are fixtures)', async () => {
  const h = await formalReprepareHarness(), { api, request } = await requestApp(h);
  assert.ok(h.sources.originals instanceof PrismaOriginalRequestRepository);
  assert.ok(h.sources.selection instanceof PrismaQuoteSelectionRepository);
  assert.equal(h.state.records.aiTaskOriginalRequest.length, 2);
  assert.equal(h.state.records.aiTaskQuoteSelection.length, 2);
  assert.equal(h.state.records.aiTask.length, 2);
  const rejected = await api.decide(request, h.command.originalTaskId, { ...h.command.original, decision: 'reject' });
  assert.equal(rejected.ok, true);
  h.command.reason = 'rejected';
  const pending = await api.reprepare(request, h.command.originalTaskId, h.command);
  assert.equal(pending.ok, true, JSON.stringify(pending));
  assert.equal(pending.value.state, 'prepared');
  assert.equal(h.state.records.aiApproval.length, 1);
  assert.equal(h.state.records.rentalOrder.length, 0);
  const approved = await api.decide(request, h.second.reference.taskId, { ...pending.value.proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' });
  assert.equal(approved.ok, true);
  const result = await h.compose().waiting.execute(h.second.executor(), new AbortController().signal);
  assert.equal(result.kind, 'succeeded');
  assert.equal((await h.compose().waiting.reconcile(h.second.executor())).payload.businessResultRef, result.payload.businessResultRef);
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption[0].taskId, h.second.reference.taskId);
  assert.deepEqual(await api.readReprepareReceipt(request, h.command.originalTaskId, h.command), pending);
});

test('native UInt reprepare revisions read as bounded numbers without widening writes', async () => {
  const h = await formalReprepareHarness(), { api, request } = await requestApp(h);
  assert.equal((await api.reprepare(request, h.command.originalTaskId, h.command)).ok, true);
  const stored = h.state.records.aiApprovalReprepare[0]; assert.ok(stored);
  const { PrismaApprovedOrderReprepareRepository, reprepareRowSchema } = require('../apps/api/src/modules/ai-native/approval-execution/prisma-approved-order-reprepare.repository');
  let raw = { ...clone(stored), originalRevision: BigInt(stored.originalRevision), replacementRevision: BigInt(stored.replacementRevision) };
  const repository = new PrismaApprovedOrderReprepareRepository({ $queryRaw: async () => [raw] });
  const observed = await repository.find(stored.scopeId, stored.operationKey);
  assert.deepEqual(observed, stored);
  assert.equal(typeof observed.originalRevision, 'number'); assert.equal(typeof observed.replacementRevision, 'number');
  assert.equal(reprepareRowSchema.safeParse(raw).success, false, 'write contract must remain numeric');
  for (const value of [0n, -1n, 4294967295n, 2n ** 100n, '1', 1.5]) {
    raw = { ...clone(stored), originalRevision: value, replacementRevision: BigInt(stored.replacementRevision) };
    await assert.rejects(repository.find(stored.scopeId, stored.operationKey));
    raw = { ...clone(stored), originalRevision: BigInt(stored.originalRevision), replacementRevision: value };
    await assert.rejects(repository.find(stored.scopeId, stored.operationKey));
  }
});

test('held lease source only reads current ownership and cannot claim a missing or changed lease', async () => {
  const h = await formalReprepareHarness();
  const before = clone(h.state.records.aiRun);
  const held = await h.dependencies.db.$transaction(tx => h.sources.lease.current(h.second.reference, tx));
  assert.equal(held.holderId, h.configuration.holderId);
  assert.equal(held.fencingToken, '1');
  assert.deepEqual(h.state.records.aiRun, before);
  for (const change of [{ leaseOwnerId: 'other-holder' }, { leaseExpiresAt: new Date(0) }, { actorId: 'other-user' }, { status: 'CANCELLED' }]) {
    const run = h.state.records.aiRun.find(row => row.id === h.second.reference.runId), original = clone(run);
    Object.assign(run, change);
    assert.equal(await h.dependencies.db.$transaction(tx => h.sources.lease.current(h.second.reference, tx)), null);
    Object.assign(h.state.records.aiRun.find(row => row.id === original.id), original);
  }
  const other = composeFormalApprovedOrderReprepareServices(h.dependencies, { ...h.configuration, holderId: 'unrelated-host' });
  assert.equal(await h.dependencies.db.$transaction(tx => other.lease.current(h.second.reference, tx)), null);
});

test('actual stored selection invalidation blocks replacement without synthesized evidence', async () => {
  const h = await formalReprepareHarness(), { api, request } = await requestApp(h);
  h.state.records.aiTaskQuoteSelection.find(row => row.id === h.second.reference.quoteSelectionRef).supersededAt = new Date();
  const result = await api.reprepare(request, h.command.originalTaskId, h.command);
  assert.equal(result.ok, false);
  assert.equal(h.state.records.aiApprovalReprepare.length, 0);
  assert.equal(h.state.records.aiProposal.length, 1);
  assert.equal(h.state.records.rentalOrder.length, 0);
});

test('lost ACK reads one original operation without consulting fresh selection eligibility or acquiring another lease', async () => {
  const h = await formalReprepareHarness(), { api, request } = await requestApp(h);
  h.state.reprepareAckLost = true;
  const lost = await api.reprepare(request, h.command.originalTaskId, h.command);
  assert.deepEqual(lost, { ok: false, error: { code: 'result_unknown', retryable: false, nextAction: 'read_reprepare_receipt' } });
  h.state.records.aiTaskQuoteSelection.find(row => row.id === h.second.reference.quoteSelectionRef).supersededAt = new Date();
  h.state.records.aiRun.find(row => row.id === h.second.reference.runId).leaseExpiresAt = new Date(0);
  const recorded = await api.readReprepareReceipt(request, h.command.originalTaskId, h.command);
  assert.equal(recorded.ok, true);
  assert.equal(recorded.value.state, 'prepared');
  assert.deepEqual(await api.reprepare(request, h.command.originalTaskId, h.command), recorded);
  assert.equal(h.state.records.aiApprovalReprepare.length, 1);
  assert.equal(h.state.records.rentalOrder.length, 0);
});

test('missing creation rules or business resources has no permissive fallback', async () => {
  const h = await formalReprepareHarness();
  for (const change of [{ creationRules: [] }, { memberships: null }, { holderId: '' }]) {
    assert.throws(() => composeFormalApprovedOrderReprepareServices(h.dependencies, { ...h.configuration, ...change }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  }
  h.state.session = false;
  const { api, request } = await requestApp(h);
  assert.equal((await api.reprepare(request, h.command.originalTaskId, h.command)).ok, false);
  assert.equal(h.state.records.aiApprovalReprepare.length, 0);
});

test('request body cannot provide the holder, fence or alternate credentials', async () => {
  const h = await formalReprepareHarness(), { api, request } = await requestApp(h);
  for (const extra of [{ holderId: h.configuration.holderId }, { fencingToken: '1' }, { credentials: {} }]) {
    const result = await api.reprepare(request, h.command.originalTaskId, { ...h.command, ...extra });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid_request');
  }
  const missing = await api.reprepare({ headers: {} }, h.command.originalTaskId, h.command);
  assert.equal(missing.error.code, 'access_denied');
  assert.equal(h.state.records.aiApprovalReprepare.length, 0);
});
