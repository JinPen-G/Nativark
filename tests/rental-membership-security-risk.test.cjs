const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalOrderConfirmationService } = require("../apps/api/src/modules/rental-core/rental-order-confirmation.service");
const { MembershipService } = require("../apps/api/src/modules/platform/membership.service");

async function main() {
  // 订单确认必须在同一个写事务内重新检查报价使用的会员资金减免。
  const tx = {};
  const request = {
    quoteId: "quote-security-risk",
    customerId: "member-1",
    customerType: "personal",
    bookingIdentity: { bookingIdentity: "enterprise_employee", corporateCustomerId: "corp-1" },
    fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: "location-1",
    returnLocationId: "location-1",
    startAt: "2030-01-01T00:00:00.000Z",
    endAt: "2030-01-02T00:00:00.000Z",
    lines: [{ itemGroupId: "group-1", quantity: 1 }]
  };
  const membershipSnapshot = {
    bookingIdentity: "enterprise_employee",
    personalCustomerId: "member-1",
    personalCustomerName: "会员",
    corporateCustomerId: "corp-1",
    corporateCustomerName: "企业",
    corporateMembershipId: "employment-1",
    enterpriseContractAndPayer: false,
    benefitSource: "corporate",
    qualifications: [],
    resolvedAt: new Date().toISOString()
  };
  const quote = {
    id: request.quoteId,
    tenantId: 'tenant-1', categoryCode: 'camera', sourceSnapshot: { version: 'rental-quote-source-1', tenantId: 'tenant-1',
      workspaceId: 'workspace-1', actor: { kind: 'user', id: 'operator' }, audience: 'operator' },
    ruleSnapshot: { qualification: { required: false, documentTypes: [], minimumValidityDays: 0 } },
    request: structuredClone(request),
    membershipSnapshot,
    membershipBenefitEvaluations: [{ appliesTo: "deposit", appliedAmount: 30 }],
    chargeLines: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
  let savedOrder = false;
  let riskCheckUsedTransaction = false;
  const service = new RentalOrderConfirmationService(
    { $transaction: (callback) => callback(tx) },
    {
      resolveWorkspaceId: () => "workspace-1",
      prepareOrder: async () => ({ id: "order-1", lines: [], capabilitySnapshot: [] }),
      assertAvailabilityWithLocks: async () => assert.fail("Risk gate must run before inventory reservation")
    },
    {
      consumeQuote: () => quote,
      validateCouponForOrder: () => undefined,
      assertOrderDaysOpenForConfirmation: () => undefined,
      applyOrderConfirmationToCache: () => undefined
    },
    { saveOrderAggregate: async () => { savedOrder = true; } },
    { findQuote: async () => quote, consumeQuoteIfAvailable: async () => true },
    { find: async () => undefined, record: async () => undefined },
    undefined,
    undefined,
    {
      assertTransactable: async () => ({ allowed: true }),
      assertTransactableForNewBusiness: async () => ({ allowed: true })
    },
    undefined,
    {
      resolveBookingIdentity: async () => ({
        bookingIdentity: membershipSnapshot.bookingIdentity,
        personalCustomerId: membershipSnapshot.personalCustomerId,
        personalCustomerName: membershipSnapshot.personalCustomerName,
        corporateCustomerId: membershipSnapshot.corporateCustomerId,
        corporateCustomerName: membershipSnapshot.corporateCustomerName,
        corporateMembershipId: membershipSnapshot.corporateMembershipId,
        enterpriseContractAndPayer: membershipSnapshot.enterpriseContractAndPayer,
        benefitSource: "corporate",
        qualifications: [],
        resolvedAt: new Date().toISOString()
      }),
      assertBookingQualificationForAction: async (_tenant, _space, _snapshot, _rule, _action, _window, transaction) => {
        assert.equal(transaction, tx); return { ok: true };
      },
      hasOpenRiskForBooking: async (_tenantId, _workspaceId, _snapshot, transaction) => {
        riskCheckUsedTransaction = transaction === tx;
        return true;
      }
    }
  );

  await assert.rejects(
    service.createOrder("tenant-1", request, "管理员", { category: { code: "camera" } }),
    /会员风控状态已变化/u
  );
  assert.equal(riskCheckUsedTransaction, true, "会员风险必须在提交订单的事务上下文中复查");
  assert.equal(savedOrder, false, "风险状态变化后不得写入订单聚合");

  // 个人与企业均是权益/付款链上的主体；企业员工预约不能只检查个人的风险记录。
  const trace = [];
  const membershipService = new MembershipService({}, {
    lockCustomerBusinessGate: async (_tenantId, customerId, transaction) => {
      assert.equal(transaction, tx);
      trace.push(`lock:${customerId}`);
      return true;
    },
    hasOpenRisk: async (_tenantId, customerId, workspaceId, transaction) => {
      assert.equal(workspaceId, "workspace-1");
      assert.equal(transaction, tx);
      trace.push(`risk:${customerId}`);
      return customerId === "corp-1";
    }
  });
  const hasRisk = await membershipService.hasOpenRiskForBooking("tenant-1", "workspace-1", membershipSnapshot, tx);
  assert.equal(hasRisk, true, "企业主档存在开放风险时应阻止企业会员减免");
  assert.deepEqual(trace, ["lock:member-1", "risk:member-1", "lock:corp-1", "risk:corp-1"]);

  // Actual membership readers and relation writer share canonical customer gates.
  // The delegates below expose explicit current facts, not MySQL lock evidence.
  let relationshipActive = true, qualificationApproved = true, qualificationReads = 0;
  const lockTrace = [], reads = [];
  const profile = id => ({ id, tenantId: 'tenant-1', customerType: id === 'corp-1' ? 'corporate' : 'personal', name: id, mergedIntoCustomerId: null });
  const relation = { id: 'employment-1', tenantId: 'tenant-1', corporateCustomerId: 'corp-1', personalCustomerId: 'member-1',
    role: 'employee', status: 'active', effectiveFrom: new Date('2020-01-01'), effectiveTo: null, createdAt: new Date(), updatedAt: new Date(), reason: null };
  const currentDb = {
    businessWorkspace: { findFirst: async () => ({ id: 'workspace-1', categoryCode: 'camera' }) },
    customerProfile: { findFirst: async ({ where }) => { reads.push(`profile:${where.id}`); return profile(where.id); } },
    customerMembership: { findUnique: async () => ({ id: 'member-link', status: 'active' }) },
    customerQualificationRef: { findMany: async () => { qualificationReads++; return qualificationApproved ? [{ id: 'license', tenantId: 'tenant-1',
      customerId: 'member-1', qualificationType: 'driver_license', status: 'approved', currentRevisionId: null, expiresAt: new Date('2031-01-01'),
      verifiedAt: new Date(), issuedAt: null, evidenceRef: null, source: 'admin', createdAt: new Date(), updatedAt: new Date() }] : []; } },
    customerMembershipQualificationType: { findMany: async () => [{ code: 'driver_license', status: 'enabled' }] },
    customerMembershipPlanAssignment: { findFirst: async () => null },
    customerCorporateMembership: {
      findFirst: async () => relationshipActive ? structuredClone(relation) : null,
      upsert: async ({ update }) => { assert.deepEqual(lockTrace.slice(-2), ['corp-1', 'member-1']);
        Object.assign(relation, update); relationshipActive = update.status === 'active';
        return { ...relation, personalCustomer: { name: 'member-1' } }; }
    }
  };
  const currentTx = currentDb;
  currentDb.$transaction = async work => work(currentTx);
  const actualMemberships = new MembershipService({ ...currentDb, customerProfile: { findFirst: async () => { throw Error('ambient client used in transaction'); } } }, {
    lockCustomerBusinessGate: async (_t, id, transaction) => { assert.equal(transaction, currentTx); lockTrace.push(id); return true; }
  });
  const current = await actualMemberships.resolveBookingIdentity('tenant-1', 'workspace-1', 'member-1', request.bookingIdentity, currentTx);
  assert.equal(current.corporateMembershipId, 'employment-1');
  assert.deepEqual(lockTrace.slice(0, 2), ['corp-1', 'member-1']); assert.equal(qualificationReads, 1);
  const required = { required: true, documentTypes: ['driver_license'], minimumValidityDays: 0 };
  const window = { validThroughAt: request.endAt, minimumValidityFromAt: request.startAt };
  await actualMemberships.assertBookingQualificationForAction('tenant-1', 'workspace-1', membershipSnapshot, required, 'submit', window, currentTx);
  qualificationApproved = false;
  await assert.rejects(actualMemberships.assertBookingQualificationForAction('tenant-1', 'workspace-1', membershipSnapshot, required, 'submit', window, currentTx), /资格校验未通过/);
  qualificationApproved = true; relationshipActive = false;
  await assert.rejects(actualMemberships.assertBookingQualificationForAction('tenant-1', 'workspace-1', membershipSnapshot,
    { required: false }, 'extension', window, currentTx), /有效员工/);
  relationshipActive = true; relation.id = 'new-employment';
  await assert.rejects(actualMemberships.assertBookingQualificationForAction('tenant-1', 'workspace-1', membershipSnapshot,
    { required: false }, 'pickup', window, currentTx), /后继新关系/);
  relation.id = 'employment-1';
  const writer = new MembershipService(currentDb, { lockCustomerBusinessGate: async (_t, id, transaction) => {
    assert.equal(transaction, currentTx); lockTrace.push(id); return true;
  } });
  await writer.saveCorporateEmployee('tenant-1', 'corp-1', { personalCustomerId: 'member-1', role: 'employee', status: 'exited' });
  assert.equal(relationshipActive, false); assert.deepEqual(lockTrace.slice(-2), ['corp-1', 'member-1']);
  console.log('Actual transaction-scoped relationship/qualification readers and canonical relation writer locks passed.');

  // Deterministic preflight-to-transaction revocation. The confirmation service
  // must re-read before allocation, aggregate save or original quote consumption.
  relationshipActive = true;
  const transactionalConfirmation = Object.create(RentalOrderConfirmationService.prototype);
  transactionalConfirmation.normalizeOrderInput = value => value;
  transactionalConfirmation.idempotency = { find: async () => undefined };
  transactionalConfirmation.core = { resolveWorkspaceId: () => 'workspace-1',
    prepareOrder: async () => { relationshipActive = false; return { id: 'new-order', membershipSnapshot, lines: [] }; },
    assertAvailabilityWithLocks: async () => { throw Error('must reject before inventory'); } };
  transactionalConfirmation.businessFacts = { findQuote: async () => quote };
  transactionalConfirmation.business = { assertOrderDaysOpenForConfirmation: () => {}, validateCouponForOrder: () => undefined };
  transactionalConfirmation.prisma = { $transaction: async work => work(currentTx) };
  transactionalConfirmation.memberships = writer;
  await assert.rejects(transactionalConfirmation.createOrder('tenant-1', request, 'operator', { category: { code: 'camera' } }), /有效员工/);
  assert.equal(savedOrder, false);
  console.log('Original order confirmation rejects relationship revoked after preparation before any business write.');

  console.log("Member deposit/preauthorization risk gate transaction checks passed.");
}

require('../apps/api/src/common/request-identity').runWithRequestIdentity({ tenantId: 'tenant-1', workspaceId: 'workspace-1',
  userId: 'operator', audience: 'operator', isSaasAdmin: false, dataScope: 'all' }, main).catch((error) => {
  console.error(error);
  process.exit(1);
});
