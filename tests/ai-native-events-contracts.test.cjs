"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
require("ts-node").register({ project: require('node:path').resolve(__dirname, '../apps/api/tsconfig.json'), transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { AI_NATIVE_COMPONENT_SCHEMAS: base } = require("../apps/api/src/contracts/ai-native-schemas"), { AI_EVENTS_DRAFT_SCHEMAS: schemas } = require("../packages/shared/src/ai-events-draft-schemas"), { AI_TOOL_CODES } = require("../packages/shared/src/ai-native"), f = require("./fixtures/ai-native/events-contracts.cjs");
const validators = h.validatorsFor(schemas, base), yes = (n, x) => assert.equal(validators[n](x), true, JSON.stringify(validators[n].errors)), no = (n, x) => assert.equal(validators[n](x), false, n);
test("C08 schema is closed business input, not task UI event or scheduler", () => h.checkClosed(schemas, { ...base, ...schemas }));
for (const event of f.events) test(`C08 event ${event.type} minimal payload and resource binding shape`, () => {
  yes("AiBusinessEventDraft", event); no("AiBusinessEventDraft", { ...event, type: "arbitrary.business_event" });
  no("AiBusinessEventDraft", { ...event, resource: { ...event.resource, kind: "anything" } });
  no("AiBusinessEventDraft", { ...event, payload: { ...event.payload, fullSnapshot: { privateCustomer: "secret" } } });
  no("AiBusinessEventDraft", { ...event, eventVersion: "0" });
});
for (const delivery of f.deliveries) test(`C08 delivery ${delivery.state} expresses recheck/manual rather than repeat action`, () => {
  yes("AiBusinessDeliveryDraft", delivery); no("AiBusinessDeliveryDraft", { ...delivery, attemptsUnlimited: true });
  if (delivery.nextAction) no("AiBusinessDeliveryDraft", { ...delivery, nextAction: "execute_without_read" });
});
for (const mode of ["draft", "disabled", "shadow", "manual_confirmation"]) test(`C08 policy ${mode} never authorizes unattended R3`, () => {
  yes("AiAutomationPolicyDraft", { ...f.policy, mode });
  no("AiAutomationPolicyDraft", { ...f.policy, mode, r3Policy: "auto_execute" });
});
test("C08 tool references bind catalogue version and have no caller-settable risk", () => {
  for (const toolCode of AI_TOOL_CODES) yes("AiAutomationToolReferenceDraft", { ...f.tools[0], toolCode });
  for (const toolCode of ["refund.execute", "arbitrary.sql", "arbitrary.http"]) no("AiAutomationToolReferenceDraft", { ...f.tools[0], toolCode });
  no("AiAutomationToolReferenceDraft", { ...f.tools[0], risk: "R0" });
  no("AiAutomationToolReferenceDraft", { ...f.tools[0], catalogRevision: undefined });
});
test("C08 strict scope/expiry/counters/causal-depth boundaries reject, not runtime loop protection", () => {
  no("AiAutomationPolicyDraft", { ...f.policy, mode: "auto_execute" });
  no("AiAutomationPolicyDraft", { ...f.policy, scope: { kind: "platform" } });
  no("AiAutomationPolicyDraft", { ...f.policy, subject: { ...f.policy.subject, superuser: true } });
  no("AiAutomationPolicyDraft", { ...f.policy, allowedRecipientIds: ["r", "r"] });
  no("AiAutomationPolicyDraft", { ...f.policy, expiresAt: undefined });
  for (const field of Object.keys(f.policy.limits)) no("AiAutomationPolicyDraft", { ...f.policy, limits: { ...f.policy.limits, [field]: field === "maxCausalDepth" ? -1 : 0 } });
  no("AiBusinessEventDraft", { ...f.events[0], causalDepth: 21 });
  no("AiBusinessEventDraft", { ...f.events[0], deduplicationKey: undefined });
});
test("C08 TS all event/delivery/policy branches compile without arbitrary R3 or event input", () => {
  assert.deepEqual(h.compileConsumer(`import type { AiBusinessEventDraft, AiBusinessDeliveryDraft, AiAutomationPolicyDraft, AiAutomationToolReferenceDraft } from "../packages/shared/src/ai-events-draft";
const events: AiBusinessEventDraft[] = ${JSON.stringify(f.events)};
const deliveries: AiBusinessDeliveryDraft[] = ${JSON.stringify(f.deliveries)};
const policy: AiAutomationPolicyDraft = ${JSON.stringify(f.policy)};
const tools: AiAutomationToolReferenceDraft[] = ${JSON.stringify(f.tools)};
// @ts-expect-error no unattended auto-execute
const auto: AiAutomationPolicyDraft = { ...policy, mode: "auto_execute" };
// @ts-expect-error catalogue owns risk
const risk: AiAutomationToolReferenceDraft = { ...tools[0], risk: "R0" };
// @ts-expect-error arbitrary event names unavailable
const unknown: AiBusinessEventDraft = { ...events[0], type: "anything" };
// @ts-expect-error dead letter must use manual exit
const retry: AiBusinessDeliveryDraft = { draftVersion: "${f.version}", eventId: "e", attempt: 1, state: "dead_letter", reason: "attempts_exhausted", nextAction: "execute" };
`), []);
});

test('CB08/CB09 real failures produce authorized candidates and original automation tasks', async () => {
  const { composeBusinessFailureEvents, composeBusinessFailureAutomation } = require('../apps/api/src/modules/ai-native/business-events/business-failure.composition');
  const { RentalBusinessFactRepository } = require('../apps/api/src/modules/rental-core/rental-business-fact.repository');
  const { PaymentProviderDefinitiveError, PaymentProviderUnknownError } = require('../apps/api/src/modules/integrations/payment.runtime.service');
  const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
  let now = new Date(), failOutbox = false, active = true, loseTaskCommitReply = false, writes = 0, taskCreates = 0;
  const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  const actor = user({ permissions: ['system:integration:manage', 'rental-os:finance:view', 'rental-os:order:view'] });
  const state = Object.fromEntries(['notifications', 'refunds', 'events', 'subjects', 'policies', 'inputs', 'scopes', 'budgets', 'plans', 'tasks', 'runs'].map(name => [name, new Map()]));
  const clone = value => structuredClone(value);
  const match = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => match(row, part));
    if (key === 'scope') return match(state.scopes.get(row.scopeId), value.is);
    if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, v]) => op === 'in' ? v.includes(row[key]) : op === 'gt' ? row[key] > v : op === 'lt' ? row[key] < v : op === 'lte' ? row[key] <= v : false);
    return value instanceof Date ? row[key]?.getTime() === value.getTime() : value === undefined || row[key] === value;
  });
  const project = (row, select) => row ? clone(select ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row) : null;
  const delegate = name => {
    const api = {
      async findFirst({ where, select }) {
        let row = [...state[name].values()].find(row => match(row, where));
        if (row && name === 'tasks') row = { ...row, runs: [...state.runs.values()].filter(run => run.taskId === row.id && run.sequence === 1).slice(0, 1).map(run => ({ id: run.id })) };
        return project(row, select);
      },
      async findUnique({ where, select }) { return api.findFirst({ where: where.scopeId_scopeKind_sceneCode ?? where, select }); },
      async findFirstOrThrow(args) { const row = await api.findFirst(args); if (!row) throw Error('missing'); return row; },
      async findMany({ where, take, select }) { assert.ok(take <= 10); return [...state[name].values()].filter(row => match(row, where)).slice(0, take).map(row => project(row, select)); },
      async create({ data }) { writes++; if (name === 'tasks') taskCreates++;
        const plain = name === 'runs' ? { ...data, fencingToken: data.fencingToken.toString() } : data;
        const row = { revision: 1, archivedAt: null, nextAttemptAt: null, leaseUntil: null, sentAt: null, ...clone(plain) }; state[name].set(row.id, row); return clone(row); },
      async updateMany({ where, data }) { writes++; let count = 0; for (const row of state[name].values()) if (match(row, where)) {
        for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : clone(value); count++;
      } return { count }; },
      async update(args) { await api.updateMany(args); return api.findFirstOrThrow({ where: { id: args.where.id } }); },
      async upsert({ where, create }) {
        writes++;
        if (failOutbox) throw Error('outbox store unavailable');
        const existing = [...state[name].values()].find(row => match(row, where.tenantId_workspaceId_deduplicationKey ?? where));
        if (existing) return clone(existing);
        const row = { status: 'pending', attempts: 0, fence: 0, leaseOwner: null, leaseUntil: null, lastErrorCode: null, createdAt: now, updatedAt: now, ...clone(create) };
        state[name].set(row.id, row); return clone(row);
      }
    }; return api;
  };
  let queue = Promise.resolve(), lastTransactionError = null;
  const transactionContext = new (require('node:async_hooks').AsyncLocalStorage)();
  const db = { rentalNotificationLog: delegate('notifications'), rentalPaymentRefund: delegate('refunds'), aiBusinessFailureOutbox: delegate('events'),
    aiAutomationSubject: delegate('subjects'), aiAutomationPolicy: delegate('policies'), aiAutomationInput: delegate('inputs'),
    aiScope: delegate('scopes'), aiBudgetPolicy: delegate('budgets'), aiTaskPlanPolicy: delegate('plans'), aiTask: delegate('tasks'), aiRun: delegate('runs'),
    rentalOrder: { findFirst: async () => ({ id: 'order-a', ...scope, fulfillmentLocationId: 'location-a', returnLocationId: null }) },
    businessWorkspace: { findFirst: async () => ({ id: scope.workspaceId, tenantId: scope.tenantId, status: 'ACTIVE' }) },
    tenant: { findUnique: async () => ({ subscription: { startAt: new Date(now.getTime() - 1000), endAt: new Date(now.getTime() + 86400000) }, subscriptionSegments: [] }) },
    $queryRaw: async () => [],
    $transaction: callback => {
      if (transactionContext.getStore()) return callback(db);
      const work = queue.then(() => transactionContext.run(true, async () => {
        const before = clone(state); let result;
        try { result = await callback(db); } catch (error) { lastTransactionError = error.message; Object.assign(state, before); throw error; }
        if (loseTaskCommitReply && state.tasks.size > before.tasks.size) { loseTaskCommitReply = false; throw Error('task commit reply lost'); }
        return result;
      })); queue = work.catch(() => {}); return work;
    } };
  const auth = new AuthService({ getAuthSession: async () => active ? { id: 'event-session', userId: actor.id, audience: 'operator', currentWorkspaceId: scope.workspaceId } : undefined,
    findUserById: async () => actor, findWorkspaceScopedUser: async () => actor, listUserWorkspaces: async () => [] }, { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-test-secret' : undefined });
  const credentials = { current: async () => ({ audience: 'operator', requestId: 'event-request', authorization: `Bearer ${auth.signAccessToken({ sub: actor.id, tid: scope.tenantId, sid: 'event-session', aud: 'operator', exp: Math.floor(Date.now() / 1000) + 600 })}` }) };
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, { rentalOrder: { findFirst: async () => ({ id: 'order-a' }) } });
  const core = { getOrder: async (tenantId, id) => { assert.equal(tenantId, scope.tenantId); assert.equal(id, 'order-a'); return { id, ...scope }; } };
  const app = composeBusinessFailureEvents({ db, auth, credentials, guard, core, funding: { recordEvent: async () => {} }, integrations: {}, clock: () => now });
  const run = work => runWithRequestIdentity({ ...scope, userId: actor.id, dataScope: 'all', locationScope: { mode: 'all', locationIds: [] }, staffApi: false }, work);
  await run(() => app.notifications.insertNotificationLog({ id: 'notice-a', tenantId: scope.tenantId, templateId: 'template-a', templateVersion: '1', eventCode: 'order.created', channel: 'sms', recipient: 'masked', renderedTitle: 'notice', renderedBody: 'private-body', variables: {}, status: 'queued', provider: 'aliyun_sms', attempts: 0, createdAt: now.toISOString() }));
  failOutbox = true;
  await assert.rejects(run(() => app.notifications.updateNotificationDelivery(scope.tenantId, 'notice-a', { status: 'failed', nextAttemptAt: null })), /outbox store/);
  assert.equal(state.notifications.get('notice-a').status, 'queued'); assert.equal(state.notifications.get('notice-a').revision, 1); assert.equal(state.events.size, 0);
  failOutbox = false;
  await run(() => app.notifications.updateNotificationDelivery(scope.tenantId, 'notice-a', { status: 'delivery_uncertain' })); assert.equal(state.events.size, 0);
  await run(() => app.notifications.updateNotificationDelivery(scope.tenantId, 'notice-a', { status: 'failed', nextAttemptAt: null }));
  const event = [...state.events.values()][0]; assert.equal(event.resourceRevision, 3);
  const results = await Promise.all([app.candidates.prepare({ eventId: event.id }), app.candidates.prepare({ eventId: event.id })]);
  const ready = results.find(row => row.status === 'ready'); assert.ok(ready); assert.equal(state.events.get(event.id).attempts, 1);
  yes('AiBusinessEventDraft', ready.material.event); assert.equal(ready.taskCreated, false); assert.ok(!JSON.stringify(ready).includes('private-body'));
  await run(() => app.notifications.updateNotificationDelivery(scope.tenantId, 'notice-a', { status: 'delivered' }));
  assert.equal((await app.candidates.read({ eventId: event.id })).status, 'expired');
  state.refunds.set('refund-a', { ...scope, id: 'refund-a', revision: 1, orderId: 'order-a', paymentIntentId: 'intent-a', status: 'pending', provider: 'alipay', method: 'alipay', amount: 10, currency: 'CNY', merchantRefundNo: 'RR-a', reason: 'synthetic', externalRefundId: null, externalStatus: null, responseJson: null, failureReason: null, acceptedAt: null, succeededAt: null, fundedAt: null, createdAt: now, updatedAt: now });
  await app.payments.markRefundProviderCallPending(scope.tenantId, scope.workspaceId, 'order-a', 'refund-a', new PaymentProviderUnknownError()); assert.equal(state.events.size, 1);
  await app.payments.markRefundProviderCallPending(scope.tenantId, scope.workspaceId, 'order-a', 'refund-a', new PaymentProviderDefinitiveError('REJECTED', 'private-provider-detail'));
  const refundEvent = [...state.events.values()].find(row => row.refundId === 'refund-a');
  const refundCandidate = await app.candidates.prepare({ eventId: refundEvent.id }); yes('AiBusinessEventDraft', refundCandidate.material.event);
  assert.ok(!JSON.stringify(refundCandidate).includes('private-provider-detail'));
  const subscriptions = { readCategoryCommercialContext: async () => ({ revision: 1, serviceStatus: 'active', newBusinessAllowed: true,
    entitlements: [{ code: 'ai.native.use', available: true, categories: [] }] }) };
  const automation = composeBusinessFailureAutomation({ db, auth, credentials, guard, core, funding: { recordEvent: async () => {} }, integrations: {},
    subscriptions, policyId: 'policy-a', clock: () => now }).automation;
  await assert.rejects(automation.prepare({ eventId: refundEvent.id }), /unavailable/);
  state.subjects.set('automation-a', { id: 'automation-a', ...scope, enabled: false, authorizationRevision: 1,
    permissions: [...actor.permissions], locationScope: { mode: 'all', locationIds: [] }, revokedAt: null, expiresAt: new Date(now.getTime() + 3600000) });
  state.policies.set('policy-a', { id: 'policy-a', ...scope, subjectId: 'automation-a', revision: 1, mode: 'disabled',
    sceneCode: 'failure.review', sceneVersion: '1', allowedEventTypes: ['notification.failed', 'refund.failed'],
    maxTasksPerDay: 2, cooldownSeconds: 1, counterDay: null, preparedCount: 0, lastPreparedAt: null,
    validFrom: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 3600000), revokedAt: null });
  const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
  const { AI_TOOL_DRAFT_VERSION } = require('../packages/shared/src/ai-native');
  for (const selected of [{ kind: 'platform' }, { kind: 'tenant', tenantId: scope.tenantId }, { kind: 'workspace', ...scope }]) {
    const columns = aiPersistenceScopeColumns(selected), scopeId = `scope-${selected.kind}`;
    state.scopes.set(scopeId, { id: scopeId, ...columns });
    state.budgets.set(scopeId, { id: `budget-${selected.kind}`, scopeId, scopeKind: columns.kind, sceneCode: 'failure.review', enabled: true, configRevision: 1,
      settingsJson: { draftVersion: 'ain-c07-draft-2', config: { configRevision: 1 }, scope: selected.kind === 'platform' ? selected : { kind: 'tenant', tenantId: scope.tenantId },
        sceneCode: 'failure.review', allowedScenes: ['failure.review'], allowedModels: ['synthetic-model'], maxConcurrent: 1, maxCallsPerRun: 1,
        gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
        budget: { state: 'limited', quantity: { unit: 'calls', value: 5 } } } });
  }
  state.plans.set('plan-a', { scopeId: 'scope-workspace', sceneCode: 'failure.review', sceneVersion: '1', revision: 1, enabled: true,
    allowedTools: [{ code: 'rental.catalog.search', version: AI_TOOL_DRAFT_VERSION }], expiresAt: new Date(now.getTime() + 3600000),
    limits: { maxSteps: 1, maxCalls: 1, maxConcurrent: 1, maxTotalMs: 1000, maxStepMs: 1000, maxOutputBytes: 4096 } });
  await assert.rejects(automation.prepare({ eventId: refundEvent.id }), /unavailable/);
  state.subjects.get('automation-a').enabled = true;
  await assert.rejects(automation.prepare({ eventId: refundEvent.id }), /unavailable/);
  state.policies.get('policy-a').mode = 'shadow';
  const prepared = await automation.prepare({ eventId: refundEvent.id }); assert.equal(prepared.state, 'prepared');
  assert.equal((await automation.prepare({ eventId: refundEvent.id })).inputRef, prepared.inputRef);
  assert.equal(state.policies.get('policy-a').preparedCount, 1); assert.equal(state.inputs.size, 1);
  const frozen = state.inputs.get(prepared.inputRef); yes('AiBusinessEventDraft', frozen.payload.event);
  assert.equal(frozen.payload.trust, 'untrusted_data'); assert.ok(!JSON.stringify(frozen).includes('private-provider-detail'));
  const unobservedWrites = writes;
  assert.equal((await automation.reconcile({ inputRef: prepared.inputRef })).state, 'not_observed'); assert.equal(writes, unobservedWrites);
  loseTaskCommitReply = true;
  const receipts = await Promise.all([automation.create({ inputRef: prepared.inputRef }), automation.create({ inputRef: prepared.inputRef })]);
  assert.ok(receipts.some(receipt => receipt.state === 'observed'), JSON.stringify({ receipts, taskCreates, taskCount: state.tasks.size, lastTransactionError })); assert.equal(taskCreates, 1); assert.equal(state.tasks.size, 1); assert.equal(state.runs.size, 1);
  const task = [...state.tasks.values()][0]; assert.equal(task.ownerKind, 'AUTOMATION'); assert.equal(task.ownerId, 'automation-a');
  assert.notEqual(task.ownerId, actor.id); assert.equal(task.policyId, 'policy-a'); assert.equal(task.inputHash, frozen.inputHash);
  const readOnlyWrites = writes;
  const receipt = await automation.reconcile({ inputRef: prepared.inputRef }); assert.equal(receipt.task.taskId, task.id);
  assert.equal(receipt.retryable, false); assert.equal(receipt.dispatchRequested, false); assert.equal(receipt.inputStatus, 'creation_unknown');
  assert.equal((await automation.create({ inputRef: prepared.inputRef })).task.taskId, task.id); assert.equal(writes, readOnlyWrites); assert.equal(taskCreates, 1);
  state.budgets.get('scope-platform').enabled = false;
  await assert.rejects(automation.reconcile({ inputRef: prepared.inputRef }), /unavailable|AI_ACCESS_DENIED/);
  state.budgets.get('scope-platform').enabled = true;
  now = new Date(now.getTime() + 2000);
  await run(() => app.notifications.updateNotificationDelivery(scope.tenantId, 'notice-a', { status: 'failed', nextAttemptAt: null }));
  const secondEvent = [...state.events.values()].find(row => row.notificationId === 'notice-a' && row.resourceRevision === state.notifications.get('notice-a').revision);
  const second = await automation.prepare({ eventId: secondEvent.id }); assert.equal(second.state, 'prepared');
  state.inputs.get(second.inputRef).status = 'creation_unknown';
  const crashed = await automation.create({ inputRef: second.inputRef }); assert.equal(crashed.state, 'not_observed');
  assert.equal(crashed.retryable, false); assert.equal(taskCreates, 1);
  state.subjects.get('automation-a').authorizationRevision++;
  await assert.rejects(automation.reconcile({ inputRef: prepared.inputRef }), /unavailable|AI_ACCESS_DENIED/);
  active = false; await assert.rejects(app.candidates.read({ eventId: refundEvent.id })); active = true;
  await app.payments.applyProviderRefundOutcome(scope.tenantId, scope.workspaceId, 'order-a', 'refund-a', { status: 'succeeded', responseJson: {} });
  assert.equal((await app.candidates.read({ eventId: refundEvent.id })).status, 'expired');
  const count = state.events.size;
  await run(() => new RentalBusinessFactRepository(db).updateNotificationDelivery(scope.tenantId, 'notice-a', { status: 'failed' })); assert.equal(state.events.size, count);
  assert.equal((await app.candidates.preparePending({ limit: 2 })).workerStarted, false);
});
