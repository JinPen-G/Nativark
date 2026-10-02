const assert = require("node:assert/strict");
const { RentalFundingService } = require("../apps/api/dist/modules/rental-core/rental-funding.service.js");

let created = 0;
const tx = {
  $queryRaw: async () => [{ depositAmount: 0, preAuthAmount: 0, finalPayableAmount: 1500, status: "reserved", ruleSnapshot: {} }],
  rentalOrderExtension: { findMany: async () => [] },
  rentalFundingEvent: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async ({ data }) => {
      created += 1;
      return { ...data, at: new Date(), createdAt: new Date() };
    }
  }
};
const funding = new RentalFundingService(null);
const base = {
  instrument: "rental", action: "initiate", amount: 1400,
  idempotencyKey: "callback-underpaid", reason: "已验签的第三方回调"
};

void (async () => {
  await assert.rejects(
    funding.recordEvent("t", "w", "o", base, "provider", tx),
    /支付回调金额与当前订单待收金额不一致/,
    "不得忽略第三方实际回调金额并凭订单应收额入账"
  );
  assert.equal(created, 0, "错误金额不能写资金事件");
  const exact = await funding.recordEvent("t", "w", "o", { ...base, amount: 1500, idempotencyKey: "callback-exact" }, "provider", tx);
  assert.equal(exact.amount, 1500);
  assert.equal(created, 1);
  tx.rentalFundingEvent.findUnique = async () => ({ amount: 1500 });
  await assert.rejects(
    funding.recordEvent("t", "w", "o", { ...base, amount: 1400, idempotencyKey: "callback-exact" }, "provider", tx),
    /相同幂等键已用于不同金额/,
    "同一回调幂等键不能掩盖金额变化"
  );
  tx.rentalFundingEvent.findUnique = async () => null;
  const partial = await funding.recordEvent("t", "w", "o", { ...base, allowPartialInitiate: true, idempotencyKey: "staff-partial" }, "staff", tx);
  assert.equal(partial.amount, 1400, "授权线下部分收款不被全额回调门禁误拦");
  assert.equal(created, 2);
  tx.$queryRaw = async () => [{ depositAmount: 0, preAuthAmount: 0, finalPayableAmount: 25, status: "cancelled", ruleSnapshot: {} }];
  const late = await funding.recordEvent("t", "w", "o", {
    ...base, amount: 1500, provider: "alipay", verifiedExternalReceipt: true, idempotencyKey: "late-verified-payment"
  }, "provider", tx);
  assert.equal(late.amount, 1500, "取消后的已核验原支付到账必须按实收记账，以便退款收尾");
  await assert.rejects(funding.recordEvent("t", "w", "o", {
    ...base, amount: 1500, provider: "mock", verifiedExternalReceipt: true, idempotencyKey: "fake-external"
  }, "provider", tx), /真实到账只能由已核验/u);
  await assert.rejects(funding.recordEvent("t", "w", "o", {
    ...base, amount: 1500, allowPartialInitiate: true, idempotencyKey: "manual-overpayment"
  }, "staff", tx), /收款不能超过/u);
  console.log("funding callback amount gate passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
