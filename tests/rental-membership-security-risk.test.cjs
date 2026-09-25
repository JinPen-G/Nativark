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

  console.log("Member deposit/preauthorization risk gate transaction checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
