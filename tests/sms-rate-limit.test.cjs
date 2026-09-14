const assert = require("node:assert/strict");
const { Prisma } = require("@prisma/client");
const { RentalBusinessFactRepository } = require("../apps/api/dist/modules/rental-core/rental-business-fact.repository.js");

const buckets = new Map();
const prisma = {
  businessWorkspace: {
    findFirst: async ({ where }) => where.tenantId === "tenant-1" && ["workspace-1", "workspace-2"].includes(where.id)
      ? { id: where.id }
      : where.tenantId === "tenant-2" && where.id === "workspace-3"
        ? { id: where.id }
        : null
  },
  rentalNotificationRateBucket: {
    create: async ({ data }) => {
      const key = `${data.tenantId}:${data.workspaceId}:${data.scopeKey}:${data.bucketStart.toISOString()}`;
      if (buckets.has(key)) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "5.22.0" });
      }
      buckets.set(key, { ...data, count: 0 });
    },
    updateMany: async ({ where, data }) => {
      const row = [...buckets.values()].find((item) =>
        item.tenantId === where.tenantId &&
        item.workspaceId === where.workspaceId &&
        item.scopeKey === where.scopeKey &&
        item.bucketStart.getTime() === where.bucketStart.getTime() &&
        (where.count?.lt === undefined || item.count < where.count.lt) &&
        (where.count?.gt === undefined || item.count > where.count.gt)
      );
      if (!row) return { count: 0 };
      if (data.count?.increment) row.count += data.count.increment;
      if (data.count?.decrement) row.count -= data.count.decrement;
      return { count: 1 };
    }
  },
  $transaction: async (run) => run(prisma)
};

async function main() {
  const repo = new RentalBusinessFactRepository(prisma);
  const at = "2026-09-14T10:05:00.000Z";
  for (let i = 0; i < 3; i++) {
    const result = await repo.reserveSmsRate("tenant-1", "workspace-1", "fingerprint-1", at);
    assert.equal(result.allowed, true);
  }
  const blocked = await repo.reserveSmsRate("tenant-1", "workspace-1", "fingerprint-1", at);
  assert.equal(blocked.allowed, false, "同一手机号十分钟内超过 3 条必须阻断");
  const otherRecipient = await repo.reserveSmsRate("tenant-1", "workspace-1", "fingerprint-2", at);
  assert.equal(otherRecipient.allowed, true, "不同收件人不应共用手机号频率桶");
  const otherTenant = await repo.reserveSmsRate("tenant-2", "workspace-3", "fingerprint-1", at);
  assert.equal(otherTenant.allowed, true, "不同租户不应共用频率桶");
  const otherWorkspace = await repo.reserveSmsRate("tenant-1", "workspace-2", "fingerprint-1", at);
  assert.equal(otherWorkspace.allowed, true, "同租户不同经营空间不应共用频率桶");
  await repo.releaseSmsRate("tenant-1", "workspace-1", "fingerprint-1", at);
  const released = await repo.reserveSmsRate("tenant-1", "workspace-1", "fingerprint-1", at);
  assert.equal(released.allowed, true, "幂等重复或落库失败释放预留后，不应错误消耗频率额度");
  console.log("sms rate limit tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
