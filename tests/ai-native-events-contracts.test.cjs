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
  let now = new Date(), failOutbox = false, active = true, loseTaskCommitReply = false, loseReviewCommitReply = false, loseManagementCommitReply = false, writes = 0, taskCreates = 0;
  const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  const actor = user({ permissions: ['system:integration:manage', 'rental-os:finance:view', 'rental-os:order:view'] });
  const state = Object.fromEntries(['notifications', 'refunds', 'events', 'subjects', 'policies', 'inputs', 'scopes', 'budgets', 'plans', 'tasks', 'runs', 'reviewGrants', 'reviewOperations', 'managementGrants', 'policyPreparations', 'managementOperations'].map(name => [name, new Map()]));
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
        if (row && name === 'tasks') row = { ...row, runs: [...state.runs.values()].filter(run => run.taskId === row.id && run.sequence === 1).slice(0, select?.runs?.take ?? 1).map(run => project(run, select?.runs?.select)) };
        return project(row, select);
      },
      async findUnique({ where, select }) { return api.findFirst({ where: where.scopeId_scopeKind_sceneCode ?? where, select }); },
      async findFirstOrThrow(args) { const row = await api.findFirst(args); if (!row) throw Error('missing'); return row; },
      async findMany({ where, take, select, orderBy }) { assert.ok(take <= 11); const rows=[...state[name].values()].filter(row => match(row, where));
        if(orderBy?.id==='asc')rows.sort((a,b)=>a.id.localeCompare(b.id));return rows.slice(0, take).map(row => project(row, select)); },
      async create({ data }) { writes++; if (name === 'tasks') taskCreates++;
        const plain = name === 'runs' ? { ...data, fencingToken: data.fencingToken.toString() } : data;
        const row = { revision: 1, createdAt: now, archivedAt: null, nextAttemptAt: null, leaseUntil: null, sentAt: null,
          ...(name === 'inputs' ? { reviewRevision: 1, reviewStatus: 'open', closeReason: null, feedbackCode: null, reviewedAt: null } : {}),
          ...clone(plain) }; state[name].set(row.id, row); return clone(row); },
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
    aiAutomationReviewGrant: delegate('reviewGrants'), aiAutomationReviewOperation: delegate('reviewOperations'),
    aiAutomationManagementGrant: delegate('managementGrants'), aiAutomationPolicyPreparation: delegate('policyPreparations'), aiAutomationPolicyManagementOperation: delegate('managementOperations'),
    rentalFulfillmentLocation: { findMany: async () => [{ id: 'location-a', ...scope }] },
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
        if (loseReviewCommitReply && state.reviewOperations.size > before.reviewOperations.size) { loseReviewCommitReply = false; throw Error('review commit reply lost'); }
        if (loseManagementCommitReply && state.managementOperations.size > before.managementOperations.size) { loseManagementCommitReply = false; throw Error('management commit reply lost'); }
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
  const beforeInputWrites=writes;
  const manualEvent=await app.reviews.forEvent({eventId:refundEvent.id,limit:2});
  assert.equal(manualEvent.inputs.state,'not_observed');assert.deepEqual(manualEvent.inputs.items,[]);
  assert.equal(manualEvent.originalResource.kind,'refund');assert.equal(manualEvent.originalResource.id,'refund-a');
  assert.equal(manualEvent.executionPermission,false);assert.equal(writes,beforeInputWrites);
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
  const eventView=await app.reviews.forEvent({eventId:refundEvent.id,limit:1});
  assert.equal(eventView.inputs.items[0].inputRef,prepared.inputRef);
  assert.equal(eventView.inputs.items[0].inputMode,'shadow');assert.equal(eventView.inputs.items[0].task.taskId,task.id);
  assert.equal(eventView.inputs.items[0].nextAction,'read_original_creation');assert.equal(eventView.inputs.hasMore,false);
  assert.equal(writes,readOnlyWrites);
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
  state.policies.get('policy-a').mode = 'disabled';
  state.policies.get('policy-a').expiresAt = new Date(now.getTime() - 1);
  const review = await app.reviews.read({ inputRef: prepared.inputRef });
  assert.equal(review.task.taskId, task.id); assert.equal(review.inputStatus, 'creation_unknown');
  assert.equal(review.currentSource.failed, false); assert.equal(review.executionPermission, false);
  const closeCommand = { inputRef: prepared.inputRef, expectedRevision: review.review.revision,
    expectedEventFence: review.event.fence, expectedTaskId: review.task.taskId, operationKey: 'close-review', reason: 'resolved' };
  await assert.rejects(app.reviews.close(closeCommand), /unavailable/);
  assert.equal(state.inputs.get(prepared.inputRef).reviewRevision, 1); assert.equal(state.reviewOperations.size, 0);
  const provisionReviewGrant = (view, action) => {
    const id = require('node:crypto').randomUUID();
    state.reviewGrants.set(id, { id, ...scope, scopeId: 'scope-workspace', inputId: view.inputRef, eventId: view.event.eventId,
      actorKind: 'user', actorId: actor.id, audience: 'operator', action, expectedRevision: view.review.revision,
      resourceHash: view.resourceHash, requiredPermissions: ['system:integration:manage'], revision: 1,
      enabled: true, expiresAt: new Date(now.getTime() + 3600000) });
    return id;
  };
  const closeGrant = provisionReviewGrant(review, 'close');
  const originalFacts = clone({ notifications: state.notifications, refunds: state.refunds, tasks: state.tasks, runs: state.runs });
  loseReviewCommitReply = true;
  const unknownClose = await app.reviews.close(closeCommand);
  assert.equal(unknownClose.state, 'unknown'); assert.equal(unknownClose.retryable, false);
  assert.equal(state.reviewOperations.size, 1); assert.equal(state.inputs.get(prepared.inputRef).reviewRevision, 2);
  assert.equal(state.inputs.get(prepared.inputRef).status, 'creation_unknown'); assert.equal(state.events.get(refundEvent.id).status, 'closed');
  state.reviewGrants.get(closeGrant).enabled = false;
  const writesBeforeRecovery = writes;
  const closeReceipt = await app.reviews.operation({ inputRef: prepared.inputRef, operationKey: closeCommand.operationKey });
  assert.equal(closeReceipt.state, 'observed'); assert.equal(closeReceipt.status, 'closed'); assert.equal(closeReceipt.taskId, task.id);
  assert.equal(closeReceipt.inputStatusAtCommit, 'creation_unknown');
  assert.equal((await app.reviews.close(closeCommand)).operationId, closeReceipt.operationId);
  await assert.rejects(app.reviews.close({ ...closeCommand, reason: 'dismissed' }), /conflict/);
  assert.equal(writes, writesBeforeRecovery);
  const closedView = await app.reviews.read({ inputRef: prepared.inputRef });
  const historicalEvent=await app.reviews.forEvent({eventId:refundEvent.id,limit:2});
  assert.equal(historicalEvent.inputs.items[0].review.status,'closed');assert.equal(historicalEvent.currentSource.failed,false);
  assert.equal(historicalEvent.inputs.items[0].nextAction,'read_review_operation');
  const feedbackCommand = { inputRef: prepared.inputRef, operationKey: 'review-feedback', expectedRevision: closedView.review.revision,
    expectedEventFence: closedView.event.fence, expectedTaskId: closedView.task.taskId, code: 'helpful' };
  await assert.rejects(app.reviews.feedback(feedbackCommand), /unavailable/);
  provisionReviewGrant(closedView, 'feedback');
  const feedbackReceipt = await app.reviews.feedback(feedbackCommand);
  assert.equal(feedbackReceipt.state, 'observed'); assert.equal(feedbackReceipt.revision, 3); assert.equal(feedbackReceipt.status, 'closed');
  assert.equal((await app.reviews.feedback(feedbackCommand)).operationId, feedbackReceipt.operationId);
  assert.deepEqual({ notifications: state.notifications, refunds: state.refunds, tasks: state.tasks, runs: state.runs }, originalFacts);
  const unseen = await app.reviews.read({ inputRef: second.inputRef }); assert.equal(unseen.task.state, 'not_observed');
  provisionReviewGrant(unseen, 'close');
  const closedUnseen = await app.reviews.close({ inputRef: second.inputRef, operationKey: 'close-unobserved', expectedRevision: unseen.review.revision,
    expectedEventFence: unseen.event.fence, expectedTaskId: null, reason: 'dismissed' });
  assert.equal(closedUnseen.state, 'observed'); assert.equal(closedUnseen.taskId, null); assert.equal(closedUnseen.inputStatusAtCommit, 'creation_unknown');
  assert.equal(state.inputs.get(second.inputRef).status, 'creation_unknown'); assert.equal(taskCreates, 1);
  await assert.rejects(automation.create({ inputRef: second.inputRef }), /unavailable/);
  active = false;
  await assert.rejects(app.reviews.read({ inputRef: prepared.inputRef }));
  await assert.rejects(app.reviews.operation({ inputRef: prepared.inputRef, operationKey: closeCommand.operationKey }));
  await assert.rejects(app.reviews.forEvent({eventId:refundEvent.id,limit:2}));
  active = true;
  const count = state.events.size;
  await run(() => new RentalBusinessFactRepository(db).updateNotificationDelivery(scope.tenantId, 'notice-a', { status: 'failed' })); assert.equal(state.events.size, count);
  assert.equal((await app.candidates.preparePending({ limit: 2 })).workerStarted, false);
  const management = app.policyManagement;
  const createPolicy = { operationKey: 'create-managed-policy', subjectId: null, policyId: null, expectedSubjectRevision: null, expectedPolicyRevision: null,
    subject: { enabled: false, revoked: false, permissions: ['system:integration:manage'], locationScope: { mode: 'all', locationIds: [] }, expiresAt: new Date(now.getTime() + 86400000).toISOString() },
    policy: { mode: 'disabled', revoked: false, sceneCode: 'failure.review', sceneVersion: '1', allowedEventTypes: ['notification.failed'], maxTasksPerDay: 2,
      cooldownSeconds: 1, validFrom: new Date(now.getTime() - 1000).toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString() } };
  await assert.rejects(management.preview(createPolicy));
  actor.permissions.push('system:params:manage');
  const preview = await management.preview(createPolicy);
  await assert.rejects(management.prepare(createPolicy), /unavailable/);
  await assert.rejects(management.preview({ ...createPolicy, subject: { ...createPolicy.subject, enabled: true } }), /invalid_input/);
  const provisionManagementGrant = (action, resourceHash) => {
    const id = require('node:crypto').randomUUID();
    state.managementGrants.set(id, { id, ...scope, scopeId: 'scope-workspace', actorKind: 'user', actorId: actor.id, audience: 'operator', action,
      resourceHash, requiredPermissions: ['system:params:manage'], revision: 1, enabled: true, expiresAt: new Date(now.getTime() + 3600000) });
    return id;
  };
  provisionManagementGrant('prepare', preview.prepareResourceHash);
  const disabledDraft = await management.prepare(createPolicy); assert.equal(disabledDraft.state, 'prepared');
  assert.equal((await management.preparation({ operationKey: createPolicy.operationKey })).preparationId, disabledDraft.preparationId);
  const commitCommand = draft => ({ preparationId: draft.preparationId, changeHash: draft.changeHash, confirm: 'apply_automation_policy_change' });
  await assert.rejects(management.commit(commitCommand(disabledDraft)), /unavailable/);
  provisionManagementGrant('commit', disabledDraft.commitResourceHash);
  const disabledReceipt = await management.commit(commitCommand(disabledDraft)); assert.equal(disabledReceipt.state, 'observed');
  const managedSubjectId = disabledReceipt.result.subject.id, managedPolicyId = disabledReceipt.result.policy.id;
  assert.equal(disabledReceipt.result.subject.enabled, false); assert.equal(disabledReceipt.result.policy.mode, 'disabled');
  assert.equal(disabledReceipt.result.subject.enabledBy, null);
  const configured = await management.read({ subjectId: managedSubjectId, policyId: managedPolicyId });
  assert.equal(configured.state, 'configured'); assert.equal(configured.policy.revision, 1);
  const enablePolicy = { ...clone(createPolicy), operationKey: 'enable-managed-policy', subjectId: managedSubjectId, policyId: managedPolicyId,
    expectedSubjectRevision: 1, expectedPolicyRevision: 1, subject: { ...createPolicy.subject, enabled: true }, policy: { ...createPolicy.policy, mode: 'manual_confirmation' } };
  const enablePreview = await management.preview(enablePolicy);
  await assert.rejects(management.prepare(enablePolicy), /unavailable/);
  provisionManagementGrant('prepare', enablePreview.prepareResourceHash);
  const enableDraft = await management.prepare(enablePolicy);
  const enableGrant = provisionManagementGrant('commit', enableDraft.commitResourceHash);
  loseManagementCommitReply = true;
  assert.equal((await management.commit(commitCommand(enableDraft))).state, 'unknown');
  state.managementGrants.get(enableGrant).enabled = false;
  const managementRecoveryWrites = writes;
  const enabledReceipt = await management.operation({ operationKey: enablePolicy.operationKey });
  assert.equal(enabledReceipt.state, 'observed'); assert.equal(enabledReceipt.result.subject.enabledBy, actor.id);
  assert.equal(enabledReceipt.result.subject.enabledAt, now.toISOString()); assert.equal(enabledReceipt.result.policy.enabledBy, actor.id);
  assert.equal((await management.commit(commitCommand(enableDraft))).operationId, enabledReceipt.operationId); assert.equal(writes, managementRecoveryWrites);
  await assert.rejects(management.prepare({ ...enablePolicy, policy: { ...enablePolicy.policy, maxTasksPerDay: 10 } }), /conflict/);
  await run(() => app.notifications.updateNotificationDelivery(scope.tenantId, 'notice-a', { status: 'failed', nextAttemptAt: null }));
  const managedEvent = [...state.events.values()].find(row => row.notificationId === 'notice-a' && row.resourceRevision === state.notifications.get('notice-a').revision);
  const managedAutomation = composeBusinessFailureAutomation({ db, auth, credentials, guard, core, funding: { recordEvent: async () => {} }, integrations: {},
    subscriptions, policyId: managedPolicyId, clock: () => now }).automation;
  const managedInput = await managedAutomation.prepare({ eventId: managedEvent.id }); assert.equal(managedInput.state, 'prepared');
  const managedView=await app.reviews.forEvent({eventId:managedEvent.id,limit:1});
  assert.equal(managedView.inputs.items[0].inputRef,managedInput.inputRef);assert.equal(managedView.inputs.items[0].task.state,'not_observed');
  assert.equal(managedView.inputs.items[0].inputMode,'manual_confirmation');assert.equal(managedView.executionPermission,false);
  assert.equal(managedView.inputs.items[0].nextAction,'human_review');
  const preservedCount = clone({ day: state.policies.get(managedPolicyId).counterDay, count: state.policies.get(managedPolicyId).preparedCount,
    last: state.policies.get(managedPolicyId).lastPreparedAt }); assert.equal(preservedCount.count, 1);
  const lowerPolicy = { ...enablePolicy, operationKey: 'lower-managed-limit', expectedSubjectRevision: 2, expectedPolicyRevision: 2,
    policy: { ...enablePolicy.policy, maxTasksPerDay: 1 } };
  const lowerPreview = await management.preview(lowerPolicy);
  await assert.rejects(management.prepare(lowerPolicy), /unavailable/);
  provisionManagementGrant('prepare', lowerPreview.prepareResourceHash);
  const lowerDraft = await management.prepare(lowerPolicy); provisionManagementGrant('commit', lowerDraft.commitResourceHash);
  const lowerReceipt = await management.commit(commitCommand(lowerDraft)); assert.equal(lowerReceipt.state, 'observed');
  assert.equal(lowerReceipt.result.policy.revision, 3); assert.equal(lowerReceipt.result.subject.authorizationRevision, 2);
  assert.deepEqual({ day: state.policies.get(managedPolicyId).counterDay, count: state.policies.get(managedPolicyId).preparedCount,
    last: state.policies.get(managedPolicyId).lastPreparedAt }, preservedCount);
  const inputCount = state.inputs.size;
  await assert.rejects(managedAutomation.prepare({ eventId: managedEvent.id }), /unavailable/);
  assert.equal(state.inputs.size, inputCount); assert.equal(state.policies.get(managedPolicyId).preparedCount, 1);
  now = new Date(now.getTime() + 7200000);
  const revokePolicy = { ...lowerPolicy, operationKey: 'revoke-managed-policy', expectedPolicyRevision: 3,
    subject: { ...lowerPolicy.subject, enabled: false, revoked: true }, policy: { ...lowerPolicy.policy, mode: 'disabled', revoked: true } };
  const revokePreview = await management.preview(revokePolicy); provisionManagementGrant('prepare', revokePreview.prepareResourceHash);
  const revokeDraft = await management.prepare(revokePolicy); provisionManagementGrant('commit', revokeDraft.commitResourceHash);
  const revokedReceipt = await management.commit(commitCommand(revokeDraft)); assert.equal(revokedReceipt.state, 'observed');
  assert.equal(revokedReceipt.result.subject.revoked, true); assert.equal(revokedReceipt.result.policy.revoked, true);
  assert.equal(revokedReceipt.result.policy.preparedCount, 1);
  await assert.rejects(management.preview({ ...revokePolicy, operationKey: 'cannot-unrevoke', expectedSubjectRevision: 3, expectedPolicyRevision: 4,
    subject: { ...revokePolicy.subject, revoked: false } }), /unavailable/);
  assert.equal(state.inputs.get(prepared.inputRef).status, 'creation_unknown'); assert.equal(state.inputs.get(second.inputRef).status, 'creation_unknown');
  assert.equal(taskCreates, 1); assert.equal(state.runs.size, 1);
  active = false; await assert.rejects(management.operation({ operationKey: enablePolicy.operationKey })); active = true;
});
