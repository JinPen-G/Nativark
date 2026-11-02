const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const { Prisma } = require('@prisma/client');
const commandsModule = { enterpriseJson: value => typeof value === 'string' ? JSON.parse(value) : value };
class HttpError extends Error {}
const exportsForService = {};
const source = ts.transpileModule(fs.readFileSync('apps/api/src/modules/enterprise/enterprise-approval.service.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
vm.runInNewContext(source, { exports: exportsForService, require: name => name === '@nestjs/common' ? { Injectable: () => value => value, ConflictException: HttpError, ForbiddenException: HttpError, NotFoundException: HttpError } : name === '@prisma/client' ? { Prisma } : name === './enterprise-command.service' ? commandsModule : name === '../../common/request-identity' ? { requireRequestWorkspaceId: () => 'w1' } : name.startsWith('node:') ? require(name) : (() => { throw new Error(name); })(), Date, JSON, structuredClone });
const { EnterpriseApprovalService } = exportsForService;
const context = { tenantId: 't1', customerId: 'p1', workspaceId: 'w1' };
function fixture() {
  const quote = { id: 'q1', tenantId: 't1', quoteNo: 'Q1', categoryCode: 'vehicle', expiresAt: '2099-01-01T00:00:00Z', currency: 'CNY', payableAmount: 100, depositAmount: 1000, preAuthAmount: 0,
    request: { customerId: 'p1', bookingIdentity: { bookingIdentity: 'enterprise_employee', corporateCustomerId: 'c1', enterpriseContractAndPayer: true }, lines: [{ itemGroupId: 'g1', quantity: 1 }], deliveryAddress: { street: 'private' } }, chargeLines: [], membershipSnapshot: { personalCustomerId: 'p1', corporateCustomerId: 'c1', corporateMembershipId: 'm1', enterpriseContractAndPayer: true, enterpriseBasis: { approvalMode: 'per_order' } } };
  const state = { customerClosed: false, row: { id: 'a1', corporateCustomerId: 'c1', applicantCustomerId: 'p1', workspaceId: 'w1', quoteId: 'q1', state: 'approved', revision: 2, expiresAt: new Date('2099-01-01T00:00:00Z'), purpose: 'Work', orderId: null, amount: new Prisma.Decimal(100), currency: 'CNY', quote, request: { quoteId: 'q1', customerId: 'p1' }, requestFingerprint: 'fingerprint', basis: quote.membershipSnapshot.enterpriseBasis, executionKey: null, approvedBy: 'reviewer', reviewerMembershipId: 'reviewer-member', reviewerMembershipUpdatedAt: new Date() }, receipts: new Map(), dispatched: 0, orderWrites: 0, revoke: false, loseResponse: false, failCore: false };
  const db = {
    $queryRaw: async strings => { const sql = Array.isArray(strings) ? strings.join('?') : strings.sql; if (sql.includes('enterprise_booking_approvals')) return [state.row]; throw new Error(sql); },
    $executeRaw: async (strings, ...values) => { const sql = strings.join('?'); if (sql.includes("SET state='executing'")) { state.row = { ...state.row, state: 'executing', executionKey: values[0], revision: state.row.revision + 1 }; return 1; }
      if (sql.includes("state='consumed'")) { state.row = { ...state.row, state: 'consumed', orderId: values[0], revision: state.row.revision + 1 }; return 1; }
      if (sql.includes('enterprise_portal_operations')) { state.receipts.set(values[2], JSON.parse(values[0])); return 1; }
      if (sql.includes('SET approvedBy=')) { state.row = { ...state.row, approvedBy: values[0], reviewerMembershipId: values[1], reviewerMembershipUpdatedAt: values[2] }; return 1; }
      if (sql.includes('SET state=')) { state.row = { ...state.row, state: values[0], revision: state.row.revision + 1 }; return 1; } throw new Error(sql); },
    customerCorporateMembership: { findFirst: async () => ({ updatedAt: new Date() }) },
  };
  const policies = { revalidateQuote: async () => { if (state.revoke) throw new HttpError('revoked'); return quote.membershipSnapshot.enterpriseBasis; }, authorize: async () => { if (state.revoke) throw new HttpError('revoked'); return quote.membershipSnapshot.enterpriseBasis; }, assertSameBasis: () => {}, assertQuoteAmount: async () => {}, assertReviewer: async () => { if (state.revoke) throw new HttpError('reviewer revoked'); } };
  const commands = { customer: async () => { if (state.customerClosed) throw new HttpError('customer closed'); }, conflict: () => new HttpError('revision conflict'), execute: async (tenant, actor, action, target, input, apply, verify) => { if (verify) await verify(db); if (state.receipts.has(input.operationKey)) return state.receipts.get(input.operationKey); const value = await apply(db); state.receipts.set(input.operationKey, value); return value; } };
  const access = { requireAction: async () => ({ membershipId: 'reviewer-member', permissionRevision: '1:1' }) };
  const clientApi = { readOrderSubmission: async () => ({ state: state.row.orderId ? 'observed' : 'not_observed', orderId: state.row.orderId, retryable: false }),
    executeApprovedSubmission: async (who, accepted, key, participant) => {
      state.dispatched++;
      const binding = { tenantId: who.tenantId, workspaceId: who.workspaceId, idempotencyKey: key, requestFingerprint: 'fingerprint', request: accepted.request };
      await participant.authorize(binding);
      const before = { ...state.row }, beforeWrites = state.orderWrites;
      try { await participant.prepare(db, binding); state.orderWrites++; if (state.failCore) throw new HttpError('stock conflict'); await participant.commit(db, binding, 'o1'); }
      catch (error) { state.row = before; state.orderWrites = beforeWrites; throw error; }
      if (state.loseResponse) throw new HttpError('response lost after transaction');
      await participant.replay(binding, 'o1'); return { orderId: 'o1' };
    } };
  return { state, db, clientApi, api: new EnterpriseApprovalService(db, commands, policies, access, {}, {}, clientApi) };
}
const submit = { operationKey: 'original', expectedRevision: 2, reason: 'Applicant reviewed quote', approvalId: 'a1', confirm: true };
test('approval decisions neither create an order nor allow self review', async () => {
  const { api, state } = fixture(); state.row.state = 'pending'; state.row.revision = 1; state.row.approvedBy = null;
  await assert.rejects(api.decide(context, 'a1', { operationKey: 'self', expectedRevision: 1, reason: 'self', decision: 'approve' }));
  await api.decide({ ...context, customerId: 'reviewer' }, 'a1', { operationKey: 'review', expectedRevision: 1, reason: 'Verified', decision: 'approve' });
  assert.equal(state.row.state, 'approved'); assert.equal(state.dispatched, 0); assert.equal(state.orderWrites, 0);
});
test('explicit original submission consumes authorization with the Core transaction and repeated original keys read only', async () => {
  const { api, state } = fixture();
  await assert.rejects(api.submit(context, { ...submit, confirm: false }));
  await api.submit(context, submit);
  assert.equal(state.row.state, 'consumed'); assert.equal(state.row.orderId, 'o1'); assert.equal(state.orderWrites, 1);
  await api.submit(context, submit); assert.equal(state.dispatched, 1);
  const result = await api.result(context, 'a1'); assert.equal(result.original.state, 'observed'); assert.equal(result.retryable, false);
  assert.equal(JSON.stringify(result.approval).includes('private'), false);
});
test('lost first Core response reads the same committed order and never dispatches again', async () => {
  const { api, state } = fixture(); state.loseResponse = true;
  await assert.rejects(api.submit(context, submit)); assert.equal(state.row.state, 'consumed');
  await api.submit(context, submit); assert.equal(state.dispatched, 1); assert.equal(state.orderWrites, 1);
});
test('failed Core transaction rolls back consumption and keeps executing original operation nonretryable', async () => {
  const { api, state } = fixture(); state.failCore = true;
  await assert.rejects(api.submit(context, submit)); assert.equal(state.row.state, 'executing'); assert.equal(state.row.orderId, null); assert.equal(state.orderWrites, 0);
  const result = await api.submit(context, submit); assert.equal(result.original.state, 'not_observed'); assert.equal(state.dispatched, 1);
});
test('stored approval projection keeps original names, currency and missing guarantees without private fields or current fallback', async () => {
  const { api, state } = fixture();
  state.row.quote.membershipSnapshot.personalCustomerName = 'Original user';
  state.row.quote.membershipSnapshot.corporateCustomerName = 'Original company';
  state.row.quote.membershipSnapshot.enterpriseBasis.guaranteePayer = 'enterprise';
  state.row.quote.rateSnapshot = [{ itemGroupId: 'g1', itemGroupName: 'Original model' }];
  const result = await api.result(context, 'a1'), quote = result.approval.quote;
  assert.equal(quote.applicantName, 'Original user'); assert.equal(quote.corporateName, 'Original company');
  assert.equal(quote.lines[0].itemGroupName, 'Original model'); assert.equal(quote.taxAmount, null);
  assert.equal(quote.guaranteeSource, 'not_recorded'); assert.equal(quote.settlementMode, null);
  assert.equal(quote.guaranteePayer, 'enterprise'); assert.equal(JSON.stringify(quote).includes('private'), false);
  delete state.row.quote.currency; delete state.row.quote.depositAmount; delete state.row.quote.membershipSnapshot.enterpriseBasis.guaranteePayer;
  const missing = (await api.result(context, 'a1')).approval.quote;
  assert.equal(missing.currency, null); assert.equal(missing.depositAmount, null); assert.equal(missing.guaranteePayer, null);
});
test('original result rechecks current customer and execution linkage after slow reads and projects only the public result fields', async () => {
  for (const change of [f => { f.state.customerClosed = true; }, f => { f.state.row = { ...f.state.row, executionKey: 'changed-key' }; }, f => { f.state.row = { ...f.state.row, orderId: 'wrong-order' }; }]) {
    const f = fixture(); await f.api.submit(context, submit);
    f.clientApi.readOrderSubmission = async () => { change(f); return { state: 'observed', orderId: 'o1', retryable: false }; };
    await assert.rejects(f.api.result(context, 'a1'));
  }
  const f = fixture(); await f.api.submit(context, submit);
  f.clientApi.readOrderSubmission = async () => ({ state: 'observed', orderId: 'o1', retryable: false, payment: 'not_inferred', fulfillment: 'not_inferred' });
  const original = (await f.api.result(context, 'a1')).original;
  assert.deepEqual(Object.keys(original).sort(), ['orderId', 'retryable', 'state']);
});
test('revoked policy, expired quote and wrong applicant/space refuse before execution', async () => {
  for (const change of [f => f.state.revoke = true, f => f.state.row.expiresAt = new Date(0), f => f.state.row.applicantCustomerId = 'other', f => f.state.row.workspaceId = 'other']) {
    const f = fixture(); change(f); await assert.rejects(f.api.submit(context, submit)); assert.equal(f.state.dispatched, 0); assert.equal(f.state.orderWrites, 0);
  }
});
