const assert = require("node:assert/strict");
const { createCipheriv, createSign, generateKeyPairSync } = require("node:crypto");
const { PaymentRuntimeService } = require("../apps/api/dist/modules/integrations/payment.runtime.service.js");

function refundWebhookHarness(status) {
  const refund = {
    id: "refund-1", tenantId: "tenant-1", workspaceId: "workspace-1", orderId: "order-1",
    paymentIntentId: "intent-1", provider: "stripe", method: "stripe", amount: 10, currency: "USD",
    merchantRefundNo: "RR-1", reason: "测试退款", status: "pending", revision: 1, fundedAt: null,
    createdAt: new Date(), updatedAt: new Date()
  };
  const receipt = { status: "succeeded", externalRefundId: "re_original", externalStatus: "SUCCESS" };
  const input = {
    tenantId: refund.tenantId, workspaceId: refund.workspaceId, orderId: refund.orderId, refund,
    provider: refund.provider, eventId: "refund-event-1", payloadHash: "hash-1", outcome: receipt
  };
  let persisted = {
    refund, funding: [], failures: [],
    event: status ? { id: "event-row", tenantId: refund.tenantId, paymentIntentId: refund.paymentIntentId,
      provider: "stripe_refund", eventId: input.eventId, payloadHash: input.payloadHash, status } : null
  };
  let tail = Promise.resolve();
  let loseCommit = false;
  let failFunding = false;
  let applyCount = 0;
  const prisma = {
    $transaction(consume, options) {
      assert.equal(options.isolationLevel, "ReadCommitted");
      // 模拟同一原退款行的互斥与原子提交。每次请求仍创建独立运行实例。
      const next = tail.then(async () => {
        const draft = structuredClone(persisted);
        let lockIndex = 0;
        const patchRefund = (data) => {
          for (const [key, value] of Object.entries(data)) {
            if (value === undefined) continue;
            draft.refund[key] = key === "revision" ? draft.refund.revision + value.increment : value;
          }
          return { ...draft.refund };
        };
        const result = await consume({
          draft,
          $queryRaw: async ({ sql }) => {
            assert.match(sql, [/FROM Tenant/, /FROM rental_orders/, /FROM rental_payment_refunds/][lockIndex++]);
            if (lockIndex === 3) return [{ ...draft.refund }];
            return [{ id: lockIndex === 1 ? refund.tenantId : refund.orderId }];
          },
          paymentWebhookEvent: {
            findUnique: async ({ where }) => {
              assert.equal(lockIndex, 3);
              assert.deepEqual(where.provider_eventId, { provider: "stripe_refund", eventId: input.eventId });
              return draft.event;
            },
            create: async ({ data }) => {
              assert.equal(draft.event, null);
              draft.event = { id: "event-row", ...data };
            },
            update: async ({ where, data }) => {
              assert.equal(where.id, draft.event.id);
              Object.assign(draft.event, data);
            }
          },
          rentalPaymentRefund: {
            update: async ({ data }) => patchRefund(data),
            updateMany: async ({ where, data }) => {
              assert.equal(where.revision, draft.refund.revision);
              patchRefund(data);
              return { count: 1 };
            },
            findFirstOrThrow: async () => ({ ...draft.refund })
          }
        });
        persisted = draft;
        if (loseCommit) { loseCommit = false; throw new Error("commit response lost"); }
        return result;
      });
      tail = next.catch(() => {});
      return next;
    }
  };
  const funding = {
    recordEvent: async (tenantId, workspaceId, orderId, event, operator, tx) => {
      assert.deepEqual([tenantId, workspaceId, orderId], [refund.tenantId, refund.workspaceId, refund.orderId]);
      assert.equal(event.idempotencyKey, "payment-refund:refund-1");
      assert.equal(event.verifiedExternalReceipt, true);
      assert.equal(operator, "provider-webhook");
      applyCount++;
      tx.draft.funding.push(event.idempotencyKey);
      if (failFunding) { failFunding = false; throw new Error("funding transaction rolled back"); }
    }
  };
  const failureEvents = { refund: async (tx, scope, id) => tx.draft.failures.push({ scope, id }) };
  return {
    input,
    send: (value = input) => new PaymentRuntimeService(prisma, {}, funding, {}, failureEvents).applyRefundWebhookOutcome(value),
    persisted: () => persisted,
    applyCount: () => applyCount,
    loseCommitResponse: () => { loseCommit = true; },
    failNextFunding: () => { failFunding = true; }
  };
}

async function main() {
  const historical = refundWebhookHarness("processing");
  await Promise.all([historical.send(), historical.send()]);
  assert.equal(historical.applyCount(), 1, "重启后可恢复旧处理中事件，同一事件只入账一次");
  assert.equal(historical.persisted().event.status, "processed");
  assert.deepEqual(historical.persisted().funding, ["payment-refund:refund-1"]);
  await assert.rejects(() => historical.send({ ...historical.input, payloadHash: "tampered" }), /绑定到其他租户或退款单/);

  const failed = refundWebhookHarness("failed");
  await failed.send();
  assert.equal(failed.persisted().event.status, "processed", "原失败事件仍可按原键恢复");
  assert.equal(failed.applyCount(), 1);

  const committed = refundWebhookHarness();
  committed.loseCommitResponse();
  await committed.send();
  await committed.send();
  assert.equal(committed.persisted().event.status, "processed");
  assert.ok(committed.persisted().refund.fundedAt);
  assert.equal(committed.applyCount(), 1, "原提交应答丢失时复读已处理事件，不重新记账");

  const pending = refundWebhookHarness();
  pending.failNextFunding();
  await assert.rejects(() => pending.send(), /funding transaction rolled back/);
  assert.equal(pending.persisted().event, null, "资金回滚时不能确认回调完成");
  assert.deepEqual(pending.persisted().funding, []);
  assert.equal(pending.persisted().refund.status, "funding_pending");
  assert.equal(pending.persisted().refund.externalRefundId, "re_original", "保留 Stripe 原退款号供查单");
  await pending.send();
  assert.deepEqual(pending.persisted().funding, ["payment-refund:refund-1"]);

  const declined = refundWebhookHarness("processing");
  const declinedInput = { ...declined.input, outcome: { ...declined.input.outcome, status: "failed", externalStatus: "FAILED" } };
  await Promise.all([declined.send(declinedInput), declined.send(declinedInput)]);
  assert.equal(declined.persisted().refund.status, "failed");
  assert.equal(declined.persisted().event.status, "processed");
  assert.deepEqual(declined.persisted().failures, [{ scope: { tenantId: "tenant-1", workspaceId: "workspace-1" }, id: "refund-1" }]);
  assert.deepEqual(declined.persisted().funding, []);

  const originalRefund = {
    id: "refund-1", tenantId: "tenant-1", workspaceId: "workspace-1", orderId: "order-1",
    paymentIntentId: "intent-1", amount: 10, externalRefundId: "refund-existing", fundedAt: null,
    reason: "测试退款", provider: "wechat_pay", method: "wechat_pay", currency: "CNY", merchantRefundNo: "RR-1", status: "accepted"
  };
  const refundIntegrity = new PaymentRuntimeService({
    rentalPaymentRefund: { findFirst: async () => ({ ...originalRefund }) },
    $transaction: async (callback) => callback({
      $queryRaw: async (query) => query.sql.includes("FROM rental_payment_refunds") ? [{ ...originalRefund }]
        : [{ id: query.sql.includes("FROM Tenant") ? "tenant-1" : "order-1" }],
      rentalPaymentRefund: {
        findFirst: async () => ({ ...originalRefund }),
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
      ciphertext: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString("base64"),
      associated_data: associatedData,
      nonce: resourceNonce
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

  await assert.rejects(
    () => callbackService.handleWechatRefundCallback({
      body: JSON.parse(envelope),
      headers: {
        "Wechatpay-Timestamp": timestamp,
        "Wechatpay-Nonce": callbackNonce,
        "Wechatpay-Signature": signature,
        "Wechatpay-Serial": "platform-1"
      }
    }),
    /缺少原始请求体/u,
    "微信退款回调不能用重新序列化后的 JSON 代替原始请求体验签"
  );

  console.log("payment refund webhook tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
