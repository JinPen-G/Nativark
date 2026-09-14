const assert = require("node:assert/strict");
const { PaymentRuntimeService } = require("../apps/api/dist/modules/integrations/payment.runtime.service.js");

function makeHarness({ intentStatus = "pending", externalTransactionId = null, existingEvent = null } = {}) {
  const events = new Map();
  const updates = [];
  let fundingCalls = 0;
  const intent = {
    id: "intent-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    orderId: "order-1",
    provider: "alipay",
    method: "alipay",
    status: intentStatus,
    externalTransactionId,
    paidAt: intentStatus === "paid" ? new Date("2026-09-14T00:00:00Z") : null
  };
  const eventKey = "alipay:event-1";
  if (existingEvent) events.set(eventKey, { id: eventKey, ...existingEvent });

  const paymentWebhookEvent = {
    findUnique: async () => events.get(eventKey) ?? null,
    create: async ({ data }) => {
      if (events.has(eventKey)) {
        const error = new Error("duplicate");
        error.code = "P2002";
        throw error;
      }
      const row = { id: eventKey, ...data };
      events.set(eventKey, row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = [...events.values()].find((item) => item.id === where.id);
      if (!row) throw new Error("event not found");
      Object.assign(row, data);
      return row;
    }
  };
  const tx = {
    paymentWebhookEvent,
    rentalPaymentIntent: {
      findFirst: async () => intent,
      update: async ({ data }) => {
        updates.push(data);
        Object.assign(intent, data);
        return intent;
      }
    }
  };
  const prisma = {
    $transaction: async (callback) => callback(tx),
    rentalPaymentIntent: {
      updateMany: async () => ({ count: 0 })
    }
  };
  const service = new PaymentRuntimeService(prisma, {}, {
    recordEvent: async () => {
      fundingCalls += 1;
      return { id: "funding-1" };
    }
  });
  return { service, events, updates, intent, get fundingCalls() { return fundingCalls; } };
}

const baseInput = {
  tenantId: "tenant-1",
  provider: "alipay",
  eventId: "event-1",
  externalTransactionId: "trade-1",
  intentId: "intent-1",
  amount: 12.34,
  payloadHash: "hash-1"
};

async function main() {
  const mismatch = makeHarness({ intentStatus: "paid", externalTransactionId: "trade-existing" });
  await assert.rejects(
    () => mismatch.service.settleVerifiedPayment({ ...baseInput, externalTransactionId: "trade-other" }),
    /已绑定其他第三方交易编号/u,
    "已支付单不能吞掉不同第三方交易号"
  );
  assert.equal(mismatch.events.size, 0, "冲突交易不能写入新的回调事件");
  assert.equal(mismatch.fundingCalls, 0, "冲突交易不能重复入账");

  const replay = makeHarness({ intentStatus: "paid", externalTransactionId: "trade-1" });
  await replay.service.settleVerifiedPayment(baseInput);
  assert.equal(replay.events.get("alipay:event-1").status, "processed", "已支付单的新事件仍应留下可追溯事件");
  assert.equal(replay.fundingCalls, 0, "已支付回放不能再次写资金事件");

  const processing = makeHarness({
    intentStatus: "pending",
    existingEvent: {
      tenantId: "tenant-1",
      provider: "alipay",
      eventId: "event-1",
      paymentIntentId: "intent-1",
      payloadHash: "hash-1",
      status: "processing"
    }
  });
  await processing.service.settleVerifiedPayment(baseInput);
  assert.equal(processing.intent.status, "pending", "已有处理中事件不能被第二个请求重复推进");
  assert.equal(processing.fundingCalls, 0, "已有处理中事件不能重复入账");

  const first = makeHarness();
  await first.service.settleVerifiedPayment(baseInput);
  assert.equal(first.intent.status, "paid");
  assert.equal(first.intent.externalTransactionId, "trade-1");
  assert.equal(first.events.get("alipay:event-1").status, "processed");
  assert.equal(first.fundingCalls, 1);

  console.log("payment callback integrity tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
