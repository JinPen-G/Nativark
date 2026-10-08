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

test('CB08 real failure transactions produce bounded authorized candidate material', async () => {
  const { composeBusinessFailureEvents } = require('../apps/api/src/modules/ai-native/business-events/business-failure.composition');
  const { RentalBusinessFactRepository } = require('../apps/api/src/modules/rental-core/rental-business-fact.repository');
  const { PaymentProviderDefinitiveError, PaymentProviderUnknownError } = require('../apps/api/src/modules/integrations/payment.runtime.service');
  const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
  let now = new Date(), failOutbox = false, active = true;
  const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  const actor = user({ permissions: ['system:integration:manage', 'rental-os:finance:view', 'rental-os:order:view'] });
  const state = { notifications: new Map(), refunds: new Map(), events: new Map() };
  const clone = value => structuredClone(value);
  const match = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => match(row, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, v]) => op === 'in' ? v.includes(row[key]) : op === 'gt' ? row[key] > v : op === 'lt' ? row[key] < v : op === 'lte' ? row[key] <= v : false);
    return value instanceof Date ? row[key]?.getTime() === value.getTime() : value === undefined || row[key] === value;
  });
  const project = (row, select) => row ? clone(select ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row) : null;
  const delegate = name => {
    const api = {
      async findFirst({ where, select }) { return project([...state[name].values()].find(row => match(row, where)), select); },
      async findFirstOrThrow(args) { const row = await api.findFirst(args); if (!row) throw Error('missing'); return row; },
      async findMany({ where, take, select }) { assert.ok(take <= 10); return [...state[name].values()].filter(row => match(row, where)).slice(0, take).map(row => project(row, select)); },
      async create({ data }) { const row = { revision: 1, nextAttemptAt: null, leaseUntil: null, sentAt: null, ...clone(data) }; state[name].set(row.id, row); return clone(row); },
      async updateMany({ where, data }) { let count = 0; for (const row of state[name].values()) if (match(row, where)) {
        for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : clone(value); count++;
      } return { count }; },
      async update(args) { await api.updateMany(args); return api.findFirstOrThrow({ where: { id: args.where.id } }); },
      async upsert({ where, create }) {
        if (failOutbox) throw Error('outbox store unavailable');
        const existing = [...state[name].values()].find(row => match(row, where.tenantId_workspaceId_deduplicationKey));
        if (existing) return clone(existing);
        const row = { status: 'pending', attempts: 0, fence: 0, leaseOwner: null, leaseUntil: null, lastErrorCode: null, createdAt: now, updatedAt: now, ...clone(create) };
        state[name].set(row.id, row); return clone(row);
      }
    }; return api;
  };
  let queue = Promise.resolve();
  const db = { rentalNotificationLog: delegate('notifications'), rentalPaymentRefund: delegate('refunds'), aiBusinessFailureOutbox: delegate('events'),
    businessWorkspace: { findFirst: async () => ({ id: scope.workspaceId, tenantId: scope.tenantId }) },
    $transaction: callback => { const work = queue.then(async () => { const before = clone(state); try { return await callback(db); } catch (error) { Object.assign(state, before); throw error; } }); queue = work.catch(() => {}); return work; } };
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
  active = false; await assert.rejects(app.candidates.read({ eventId: refundEvent.id })); active = true;
  await app.payments.applyProviderRefundOutcome(scope.tenantId, scope.workspaceId, 'order-a', 'refund-a', { status: 'succeeded', responseJson: {} });
  assert.equal((await app.candidates.read({ eventId: refundEvent.id })).status, 'expired');
  const count = state.events.size;
  await run(() => new RentalBusinessFactRepository(db).updateNotificationDelivery(scope.tenantId, 'notice-a', { status: 'failed' })); assert.equal(state.events.size, count);
  assert.equal((await app.candidates.preparePending({ limit: 2 })).workerStarted, false);
});
