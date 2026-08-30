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
if (!/claude/.test(dbName)) {
  console.error(`拒绝执行：通知专项只能使用带 claude 标记的专用库，当前 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = databaseUrl;
process.env.PLATFORM_DATA_SOURCE = "mysql";
process.env.STORE_RENTAL_DATA_SOURCE = "mysql";

const { PrismaService } = require(path.join(ROOT, "apps/api/src/modules/database/prisma.service"));
const { RentalCoreConfigRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core-config.repository"));
const { RentalCoreFactRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core-fact.repository"));
const { RentalBusinessConfigRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-business-config.repository"));
const { RentalBusinessFactRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-business-fact.repository"));
const { RentalCoreService } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core.service"));
const { RentalBusinessService } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-business.service"));

const tenantId = "tenant_001";
const tag = `N01A-${Date.now().toString(36)}`;
let prisma;
let templateId;

void (async () => {
  prisma = new PrismaService();
  await prisma.$connect();
  const coreConfig = new RentalCoreConfigRepository(prisma);
  const coreFact = new RentalCoreFactRepository(prisma);
  const businessConfig = new RentalBusinessConfigRepository(prisma);
  const businessFact = new RentalBusinessFactRepository(prisma);
  const core = new RentalCoreService(coreConfig, coreFact);
  const business = new RentalBusinessService(businessConfig, businessFact, coreConfig, undefined, prisma);
  await core.onApplicationBootstrap();
  await business.onApplicationBootstrap();
  const profile = core.getProfile(tenantId);
  const context = {
    profile,
    category: core.listCategories().find((row) => row.code === profile.categoryCode),
    settings: core.getBusinessSettings(tenantId),
    groups: core.listItemGroups(tenantId),
    couponTemplates: core.listCouponTemplates(tenantId),
    locations: core.listLocations(tenantId),
    operators: core.listOperators(tenantId)
  };
  const occupied = new Set(
    business.listNotificationTemplates(tenantId, context)
      .filter((row) => row.status === "enabled")
      .map((row) => `${row.eventCode}:${row.channel}`)
  );
  const pair = context.settings.notifications.enabledEvents
    .flatMap((eventCode) => context.settings.notifications.editableChannels.map((channel) => ({ eventCode, channel })))
    .find((row) => !occupied.has(`${row.eventCode}:${row.channel}`));
  const eventCode = pair?.eventCode;
  const channel = pair?.channel;
  assert.ok(eventCode && channel, "夹具需要至少一个可用事件和渠道");
  const template = await business.saveNotificationTemplate(tenantId, context, {
    eventCode,
    channel,
    name: tag,
    title: "订单 {{orderNo}}",
    body: "{{customerName}} 的订单已更新",
    variableSchema: {
      orderNo: { label: "订单号", required: true },
      customerName: { label: "客户", required: true }
    },
    status: "enabled"
  });
  templateId = template.id;

  const manual = await business.sendNotification(tenantId, context, {
    templateId, recipient: "13900003333", variables: { orderNo: "N-1", customerName: "测试客户" }
  });
  assert.equal(manual.status, "simulated", "未接 Provider 时只能记录模拟状态");
  assert.equal(manual.recipient, "139****3333", "发送目标必须脱敏落库");
  assert.equal(manual.provider, "simulation");
  assert.equal(manual.providerMessageId, undefined, "模拟发送不得伪造外部回执号");
  assert.equal(manual.sentAt, undefined, "模拟记录不得伪造真实发送时间");

  await assert.rejects(
    business.sendNotification(tenantId, context, {
      templateId, recipient: "13900003333", variables: { orderNo: "N-2", customerName: "测试", typo: "x" }
    }),
    /未在模板注册/,
    "未知变量必须明确失败"
  );
  const key = `${tag}:order:1`;
  const raced = await Promise.all([
    business.sendNotification(tenantId, context, {
      templateId, recipient: "13900004444", variables: { orderNo: "N-3", customerName: "并发" }
    }, undefined, { businessObjectType: "order", businessObjectId: "1", idempotencyKey: key }),
    business.sendNotification(tenantId, context, {
      templateId, recipient: "13900004444", variables: { orderNo: "N-3", customerName: "并发" }
    }, undefined, { businessObjectType: "order", businessObjectId: "1", idempotencyKey: key })
  ]);
  assert.equal(raced.filter(Boolean).length, 1, "同一业务事件并发模拟只能新增一条记录");
  assert.equal(await prisma.rentalNotificationLog.count({ where: { idempotencyKey: key } }), 1);

  const nextTemplate = await business.saveNotificationTemplate(tenantId, context, {
    id: templateId,
    eventCode,
    channel,
    name: tag,
    title: "新版订单 {{orderNo}}",
    body: "{{customerName}} 的订单已更新",
    variableSchema: {
      orderNo: { label: "订单号", required: true },
      customerName: { label: "客户", required: true }
    },
    status: "enabled"
  });
  assert.notEqual(nextTemplate.id, templateId, "修改模板必须追加新版本行，不能原地覆盖");
  assert.ok(Number.parseFloat(nextTemplate.version) > Number.parseFloat(template.version), "新版本号必须前进");
  const oldTemplate = await prisma.rentalNotificationTemplate.findUnique({ where: { id: templateId } });
  assert.equal(oldTemplate.title, "订单 {{orderNo}}", "旧版本正文必须保持不变");
  assert.equal(oldTemplate.status, "disabled", "新版本启用后旧版本退出发送选择");
  await assert.rejects(
    business.saveNotificationTemplate(tenantId, context, {
      eventCode, channel, name: `${tag}-duplicate`, title: "重复 {{orderNo}}", body: "{{customerName}}",
      variableSchema: { orderNo: { label: "订单号", required: true }, customerName: { label: "客户", required: true } },
      status: "enabled"
    }),
    /已有启用模板/,
    "同一事件与渠道不能并存两个启用模板"
  );
  console.log("Notification simulation DB assertions passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (prisma) {
    const templates = await prisma.rentalNotificationTemplate.findMany({ where: { tenantId, name: tag }, select: { id: true } }).catch(() => []);
    const templateIds = templates.map((row) => row.id);
    if (templateIds.length) await prisma.rentalNotificationLog.deleteMany({ where: { templateId: { in: templateIds } } }).catch(() => undefined);
    if (templateIds.length) await prisma.rentalNotificationTemplate.deleteMany({ where: { id: { in: templateIds } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
