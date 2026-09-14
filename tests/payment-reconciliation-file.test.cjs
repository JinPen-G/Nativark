const assert = require("node:assert/strict");
const { BadRequestException, NotFoundException } = require("@nestjs/common");
const {
  PaymentReconciliationFileService,
  parsePaymentStatementCsv
} = require("../apps/api/dist/modules/integrations/payment-reconciliation-file.service");

function csv() {
  return Buffer.from([
    "kind,status,amount,currency,merchant_order_no,merchant_refund_no,external_id",
    "payment,PAID,100.00,CNY,order-1,,,trade-1",
    "refund,REFUND_SUCCESS,20.00,CNY,order-1,refund-1,refund-trade-1",
    "payment,PROVIDER_REVIEW,99.00,CNY,order-1,,,trade-1",
    "payment,PAID,30.00,CNY,missing-order,,,trade-missing"
  ].join("\n"));
}

class FakePrisma {
  constructor() {
    this.batches = [];
    this.lines = [];
    this.intents = [{
      id: "intent-1",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      merchantOrderNo: "order-1",
      provider: "alipay",
      status: "paid",
      amount: 100,
      currency: "CNY",
      externalTransactionId: "trade-1"
    }];
    this.refunds = [{
      id: "refund-1",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      merchantRefundNo: "refund-1",
      provider: "alipay",
      status: "succeeded",
      amount: 20,
      currency: "CNY",
      externalRefundId: "refund-trade-1"
    }];
    this.rentalPaymentIntent = {
      findMany: async ({ where }) => this.intents.filter((row) => where.merchantOrderNo.in.includes(row.merchantOrderNo))
    };
    this.rentalPaymentRefund = {
      findMany: async ({ where }) => this.refunds.filter((row) => where.merchantRefundNo.in.includes(row.merchantRefundNo))
    };
    this.paymentReconciliationBatch = {
      findFirst: async ({ where, include }) => {
        const row = this.batches.find((item) => Object.entries(where).every(([key, value]) => item[key] === value));
        if (!row) return null;
        return include ? { ...row, lines: this.lines.filter((line) => line.batchId === row.id).sort((a, b) => a.rowNumber - b.rowNumber) } : row;
      },
      findMany: async ({ where }) => this.batches.filter((row) => row.tenantId === where.tenantId && row.workspaceId === where.workspaceId),
      create: async ({ data }) => {
        const row = { ...data, acknowledgedRows: data.acknowledgedRows ?? 0, id: `batch-${this.batches.length + 1}`, importedAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
        this.batches.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const row = this.batches.find((item) => item.id === where.id && item.tenantId === where.tenantId && item.workspaceId === where.workspaceId);
        if (!row) return { count: 0 };
        if (data.acknowledgedRows?.increment) row.acknowledgedRows += data.acknowledgedRows.increment;
        if (data.status) row.status = data.status;
        return { count: 1 };
      }
    };
    this.paymentReconciliationLine = {
      createMany: async ({ data }) => {
        for (const item of data) this.lines.push({ ...item, id: `line-${this.lines.length + 1}`, createdAt: new Date(), updatedAt: new Date() });
        return { count: data.length };
      },
      findFirst: async ({ where }) => {
        const line = this.lines.find((item) => item.id === where.id && item.batchId === where.batchId);
        const batch = line && this.batches.find((item) => item.id === line.batchId && item.tenantId === where.batch.tenantId && item.workspaceId === where.batch.workspaceId);
        return line && batch ? line : null;
      },
      updateMany: async ({ where, data }) => {
        const line = this.lines.find((item) => item.id === where.id && item.batchId === where.batchId && where.reviewStatus.in.includes(item.reviewStatus));
        if (!line) return { count: 0 };
        Object.assign(line, data);
        return { count: 1 };
      },
      count: async ({ where }) => this.lines.filter((item) => item.batchId === where.batchId && where.reviewStatus.in.includes(item.reviewStatus)).length
    };
  }

  async $transaction(callback) {
    return callback(this);
  }
}

function assertBadRequest(action) {
  return assert.rejects(async () => action(), (error) => error instanceof BadRequestException);
}

async function main() {
  const parsed = parsePaymentStatementCsv(csv(), "alipay");
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].normalizedStatus, "paid");
  assert.equal(parsed[1].normalizedStatus, "succeeded");
  assert.equal(parsed[2].normalizedStatus, "unknown");
  await assertBadRequest(() => parsePaymentStatementCsv(Buffer.from("kind,status,amount,currency\npayment,PAID,1,CNY"), "alipay"));
  await assertBadRequest(() => parsePaymentStatementCsv(Buffer.from("kind,status,amount,currency,merchant_order_no\n\"payment,PAID,1,CNY,order"), "alipay"));

  const prisma = new FakePrisma();
  const service = new PaymentReconciliationFileService(prisma);
  const beforeFacts = JSON.stringify({ intents: prisma.intents, refunds: prisma.refunds });
  const first = await service.importStatement("tenant-a", "workspace-a", "alipay", { originalname: "statement.csv", size: csv().length, buffer: csv() }, "operator-a");
  assert.equal(first.totalRows, 4);
  assert.equal(first.matchedRows, 2);
  assert.equal(first.differenceRows, 2);
  assert.equal(first.status, "needs_review");
  assert.equal(prisma.batches.length, 1);
  assert.equal(prisma.lines.length, 4);
  assert.equal(JSON.stringify({ intents: prisma.intents, refunds: prisma.refunds }), beforeFacts, "导入不能改写支付或退款事实");

  const duplicate = await service.importStatement("tenant-a", "workspace-a", "alipay", { originalname: "renamed.csv", size: csv().length, buffer: csv() }, "operator-b");
  assert.equal(duplicate.id, first.id);
  assert.equal(prisma.batches.length, 1, "同租户、同空间、同平台、同文件必须幂等");
  assert.equal(prisma.lines.length, 4);

  const detail = await service.getBatch("tenant-a", "workspace-a", first.id);
  const unknownStatusLine = detail.lines.find((line) => line.rowNumber === 3);
  const missingLocalLine = detail.lines.find((line) => line.rowNumber === 4);
  assert.deepEqual(unknownStatusLine.differenceCodes.sort(), ["amount_mismatch", "duplicate_statement_key", "unsupported_status"]);
  assert.deepEqual(missingLocalLine.differenceCodes, ["local_record_missing"]);

  await assert.rejects(() => service.getBatch("tenant-b", "workspace-a", first.id), (error) => error instanceof NotFoundException);
  await service.reviewLine("tenant-a", "workspace-a", first.id, unknownStatusLine.id, { decision: "query_provider", reason: "请平台确认状态" }, "operator-a");
  let reviewed = await service.getBatch("tenant-a", "workspace-a", first.id);
  assert.equal(reviewed.lines.find((line) => line.id === unknownStatusLine.id).reviewStatus, "query_pending");
  assert.equal(reviewed.status, "needs_review");
  await service.reviewLine("tenant-a", "workspace-a", first.id, unknownStatusLine.id, { decision: "acknowledge", reason: "已登记平台差异" }, "operator-a");
  await service.reviewLine("tenant-a", "workspace-a", first.id, missingLocalLine.id, { decision: "acknowledge", reason: "已补查本地记录" }, "operator-a");
  reviewed = await service.getBatch("tenant-a", "workspace-a", first.id);
  assert.equal(reviewed.acknowledgedRows, 2);
  assert.equal(reviewed.status, "reviewed");
  assert.equal(reviewed.lines.filter((line) => line.reviewStatus === "acknowledged").length, 2);
  console.log("payment reconciliation file tests passed: parser, idempotency, immutable facts, scope isolation and review state");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
