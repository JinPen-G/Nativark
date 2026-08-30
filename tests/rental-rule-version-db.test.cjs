const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
const dbName = new URL(databaseUrl).pathname.slice(1);
if (!/zcode/.test(dbName)) {
  console.error(`拒绝执行：规则版本真库专项只能使用带 zcode 标记的专用库，当前 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = databaseUrl;

const { PrismaService } = require(path.join(ROOT, "apps/api/src/modules/database/prisma.service"));
const { RentalBusinessConfigRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-business-config.repository"));

const tenantId = "tenant_001";
const tag = `R01A-${Date.now().toString(36)}`;
let prisma;

void (async () => {
  prisma = new PrismaService();
  await prisma.$connect();
  const repository = new RentalBusinessConfigRepository(prisma);
  const workspace = await prisma.businessWorkspace.findFirst({ where: { tenantId, isDefault: true } });
  assert.ok(workspace, "夹具需要默认经营空间");
  const now = new Date().toISOString();
  const effectiveFrom = "2050-01-01T00:00:00.000Z";
  const base = (suffix) => ({
    id: `${tag}-${suffix}`,
    tenantId,
    categoryCode: workspace.categoryCode.toLowerCase(),
    version: `${tag}-${suffix}`,
    status: "draft",
    config: {},
    changeReason: "并发发布专项",
    createdBy: "rule-db-test",
    createdAt: now
  });
  const drafts = [base("a"), base("b")];
  await repository.upsertRuleVersion(drafts[0]);
  await repository.upsertRuleVersion(drafts[1]);
  const publish = (draft) => repository.writeRuleVersionWithAudit(
    { ...draft, status: "pending", effectiveFrom, publishedAt: now, publishedBy: "rule-db-test" },
    {
      id: `${draft.id}-audit`, tenantId, workspaceId: workspace.id, ruleVersionId: draft.id,
      version: draft.version, action: "publish", fromStatus: "draft", toStatus: "pending",
      reason: "并发发布专项", operator: "rule-db-test", at: now
    }
  );
  const results = await Promise.allSettled(drafts.map(publish));
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1, "同空间同生效时点只能发布一个版本");
  assert.equal(results.filter((row) => row.status === "rejected").length, 1, "冲突发布必须明确失败");
  assert.equal(await prisma.rentalRuleVersion.count({
    where: { workspaceId: workspace.id, effectiveFrom: new Date(effectiveFrom), status: { in: ["pending", "published", "superseded"] } }
  }), 1, "数据库中只能留下一个参与匹配的版本");
  console.log("Rule version DB concurrency assertions passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (prisma) {
    await prisma.rentalRuleVersionAudit.deleteMany({ where: { ruleVersionId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.rentalRuleVersion.deleteMany({ where: { id: { startsWith: tag } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
