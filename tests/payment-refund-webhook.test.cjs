const assert = require("node:assert/strict");
const { createCipheriv, createSign, generateKeyPairSync } = require("node:crypto");
const { PaymentRuntimeService } = require("../apps/api/dist/modules/integrations/payment.runtime.service.js");

const events = new Map();
let applyCount = 0;
const prisma = {
  paymentWebhookEvent: {
    findUnique: async ({ where }) => events.get(`${where.provider_eventId.provider}:${where.provider_eventId.eventId}`) ?? null,
    create: async ({ data }) => {
      const key = `${data.provider}:${data.eventId}`;
      if (events.has(key)) {
        const error = new Error("duplicate");
        error.code = "P2002";
        throw error;
      }
      const row = { id: key, ...data };
      events.set(key, row);
      return row;
    },
    updateMany: async ({ where, data }) => {
      const row = [...events.values()].find((item) => item.id === where.id || (item.provider === where.provider && item.eventId === where.eventId));
      if (!row || (where.status && row.status !== where.status)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }
  }
};

async function main() {
  const service = new PaymentRuntimeService(prisma, {}, {});
  service.applyProviderRefundOutcome = async () => { applyCount += 1; };
  const input = {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    orderId: "order-1",
    refund: { id: "refund-1", paymentIntentId: "intent-1" },
    provider: "wechat_pay",
    eventId: "refund-event-1",
    payloadHash: "hash-1",
    outcome: { status: "succeeded" }
  };

  await service.applyRefundWebhookOutcome(input);
  await service.applyRefundWebhookOutcome(input);
  assert.equal(applyCount, 1, "同一退款回调事件只能处理一次");
  assert.equal(events.get("wechat_pay_refund:refund-event-1").status, "processed");

  await assert.rejects(
    () => service.applyRefundWebhookOutcome({ ...input, payloadHash: "tampered" }),
    /绑定到其他租户或退款单/
  );

  events.get("wechat_pay_refund:refund-event-1").status = "failed";
  events.get("wechat_pay_refund:refund-event-1").payloadHash = "hash-1";
  await service.applyRefundWebhookOutcome(input);
  assert.equal(applyCount, 2, "失败事件允许后续通过查单/重试恢复");

  const refundIntegrity = new PaymentRuntimeService({
    $transaction: async (callback) => callback({
      rentalPaymentRefund: {
        findFirst: async () => ({
          id: "refund-1", tenantId: "tenant-1", workspaceId: "workspace-1", orderId: "order-1",
          paymentIntentId: "intent-1", amount: 10, externalRefundId: "refund-existing", fundedAt: null,
          reason: "测试退款", provider: "wechat_pay", status: "accepted"
        }),
        update: async () => { throw new Error("不应写入冲突退款结果"); }
      }
    })
  }, {}, {});
  await assert.rejects(
    () => refundIntegrity.applyProviderRefundOutcome("tenant-1", "workspace-1", "order-1", "refund-1", { status: "succeeded", externalRefundId: "refund-other" }),
    /已绑定其他第三方退款编号/u,
    "退款单不能被不同第三方退款号覆盖"
  );

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const apiV3Key = Buffer.from("01234567890123456789012345678901", "utf8");
  const decryptedRefund = {
    mchid: "mchid-1",
    out_refund_no: "refund-no-1",
    refund_id: "wx-refund-1",
    refund_status: "SUCCESS",
    amount: { refund: 1000 }
  };
  const associatedData = "refund";
  const resourceNonce = "0123456789ab";
  const cipher = createCipheriv("aes-256-gcm", apiV3Key, Buffer.from(resourceNonce, "utf8"));
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(decryptedRefund), "utf8"), cipher.final()]);
  const envelope = JSON.stringify({
    id: "refund-event-real-shape",
    event_type: "REFUND.SUCCESS",
    resource: {
      algorithm: "AEAD_AES_256_GCM",
      original_type: "refund",
      ciphertext: ciphertext.toString("base64"),
      associated_data: associatedData,
      nonce: resourceNonce,
      tag: cipher.getAuthTag().toString("base64")
    }
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const callbackNonce = "callback-nonce";
  const signatureContent = `${timestamp}\n${callbackNonce}\n${envelope}\n`;
  const signer = createSign("RSA-SHA256");
  signer.update(signatureContent);
  const signature = signer.sign(privateKey).toString("base64");
  let appliedWebhookOutcome;
  const callbackService = new PaymentRuntimeService(
    {
      rentalPaymentRefund: {
        findFirst: async () => ({
          id: "refund-1",
          tenantId: "tenant-1",
          workspaceId: "workspace-1",
          orderId: "order-1",
          paymentIntentId: "intent-1",
          merchantRefundNo: "refund-no-1",
          amount: 10
        })
      }
    },
    {
      runtimeConfigsForCallback: async () => [{
        tenantId: "tenant-1",
        settings: { mchid: "mchid-1", appId: "app-1", platformCertificateSerial: "PLATFORM-1" },
        credentials: { wechatPlatformCertificate: publicKey.export({ type: "spki", format: "pem" }), apiV3Key: apiV3Key.toString("utf8") }
      }]
    },
    {}
  );
  callbackService.applyRefundWebhookOutcome = async (webhookInput) => { appliedWebhookOutcome = webhookInput; };
  const callbackResult = await callbackService.handleWechatRefundCallback({
    rawBody: Buffer.from(envelope, "utf8"),
    headers: {
      "Wechatpay-Timestamp": timestamp,
      "Wechatpay-Nonce": callbackNonce,
      "Wechatpay-Signature": signature,
      "Wechatpay-Serial": "platform-1"
    }
  });
  assert.deepEqual(callbackResult, { code: "SUCCESS", message: "成功" });
  assert.equal(appliedWebhookOutcome.outcome.status, "succeeded", "微信成功通知应推进退款事实");
  assert.equal(appliedWebhookOutcome.outcome.confirmedTotal, undefined, "回调不应把单笔退款金额误当支付单累计退款金额");

  console.log("payment refund webhook tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
