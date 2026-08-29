const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * PRICE-03 专项（真库）：空间级不可变价格版本。
 *
 * 为什么必须连真库：PRICE-03 的全部口径都只在 MySQL 数据源下存在——版本追加、
 * (workspaceId, sequence) 唯一键兜并发、计划现值与版本同事务、报价记录命中版本、
 * 以及迁移回填产出的 JSON 是否合法。既有用例 rental-business-v1 走吸收式 store
 * （不落库），rental-price-adjustment 只测纯函数，因此这条链此前没有任何覆盖——
 * 迁移回填拼出非法 JSON、计划写入脱离事务两个缺陷正是这样漏出去的。
 */

const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
const dbName = new URL(env.DATABASE_URL).pathname.slice(1);
if (!/zcode/.test(dbName)) {
  console.error(`拒绝执行：本专项只能跑在本工作树的专用库上，当前指向 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = env.DATABASE_URL;
process.env.PLATFORM_DATA_SOURCE = "mysql";
process.env.STORE_RENTAL_DATA_SOURCE = "mysql";

const { PrismaService } = require(path.join(ROOT, "apps/api/src/modules/database/prisma.service"));
const { RentalCoreConfigRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core-config.repository"));
const { RentalCoreFactRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core-fact.repository"));
const { RentalBusinessConfigRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-business-config.repository"));
const { RentalBusinessFactRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-business-fact.repository"));
const { RentalCoreService } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core.service"));
const { RentalBusinessService } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-business.service"));

const TAG = `P03-${Date.now().toString(36)}`;
const tenantId = "tenant_001";

/** 最小合法费率行。字段齐全是校验要求，本专项只关心版本链，金额取固定值。
 *  带 preAuthAmount：夹具租户的规则要求预授权，缺了它报价会 fail-closed。 */
const rate = (itemGroupId, unit, baseAmount) => ({
  itemGroupId,
  unit,
  baseAmount,
  weekendMultiplier: 1,
  holidayMultiplier: 1,
  depositAmount: 0,
  minimumUnits: 1,
  preAuthAmount: 500
});

const ok = (message) => console.log(`  ✓ ${message}`);

let prisma;
let core;
let business;

function context() {
  const profile = core.getProfile(tenantId);
  return {
    profile,
    category: core.listCategories().find((item) => item.code === profile.categoryCode),
    settings: core.getBusinessSettings(tenantId),
    groups: core.listItemGroups(tenantId),
    couponTemplates: core.listCouponTemplates(tenantId),
    locations: core.listLocations(tenantId),
    operators: core.listOperators(tenantId)
  };
}

async function cleanup(workspaceId) {
  // 只清本专项造的行，按固定前缀而不是本次 TAG——上一轮中途失败留下的行也必须清掉，
  // 否则它的版本序号更大，会把本轮报价的取价拉到一份陈旧（甚至空的）版本上。
  await prisma.rentalPriceVersion.deleteMany({ where: { workspaceId, changeReason: { startsWith: "P03-" } } });
  await prisma.rentalPricingPlan.deleteMany({ where: { workspaceId, code: { startsWith: "P03-" } } });
}

void (async () => {
  prisma = new PrismaService();
  await prisma.$connect();
  const coreConfig = new RentalCoreConfigRepository(prisma);
  const coreFact = new RentalCoreFactRepository(prisma);
  const businessConfig = new RentalBusinessConfigRepository(prisma);
  const businessFact = new RentalBusinessFactRepository(prisma);
  core = new RentalCoreService(coreConfig, coreFact);
  business = new RentalBusinessService(businessConfig, businessFact, coreConfig, undefined, prisma);
  await core.onApplicationBootstrap();
  await business.onApplicationBootstrap();

  const ctx = context();
  const workspaceId = (await prisma.businessWorkspace.findFirst({ where: { tenantId, isDefault: true } })).id;
  await cleanup(workspaceId);

  const group = ctx.groups.find((item) => item.status === "enabled") ?? ctx.groups[0];
  assert.ok(group, "夹具需要至少一个商品组");
  const maxBefore = (await prisma.rentalPriceVersion.aggregate({ _max: { sequence: true }, where: { tenantId, workspaceId } }))._max.sequence ?? 0;
  const ratesBefore = await prisma.rentalPriceVersion.findFirst({
    where: { tenantId, workspaceId }, orderBy: { sequence: "desc" }
  });

  // ============ 1. 保存计划即追加**完整**空间级版本，旧版本原样保留 ============
  // 用 hour 单位避免与夹具里 calendar_day 的价格在「商品 × 单位」上重叠。
  const saved = await business.savePricingPlan(tenantId, ctx, {
    code: `${TAG}-A`, name: "PRICE-03 专项计划", status: "enabled",
    effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
    changeReason: `${TAG} 首次保存`,
    rates: [rate(group.id, "hour", 30)]
  }, "专项用例");
  const keysOf = (rates) => new Set((rates ?? []).map((row) => `${row.itemGroupId}:${row.unit}`));
  const v1 = await prisma.rentalPriceVersion.findFirst({ where: { tenantId, workspaceId }, orderBy: { sequence: "desc" } });
  assert.equal(v1.sequence, maxBefore + 1, "保存计划必须追加下一个序号的版本");
  assert.ok(Array.isArray(v1.rates), "版本 rates 必须是 JSON 数组");
  // 全集口径按「商品 × 计价单位」的键集判断，而不是数组长度：存量数据里可能存在
  // 同键重复行（早于唯一性校验写入），按长度断言会被这类脏数据带偏。
  const beforeKeys = keysOf(ratesBefore?.rates);
  const afterKeys = keysOf(v1.rates);
  for (const key of beforeKeys) {
    assert.ok(afterKeys.has(key), `新版本必须包含既有价格 ${key}——版本是全集，不是差异`);
  }
  assert.ok(afterKeys.has(`${group.id}:hour`), "新保存的费率必须出现在新版本里");
  assert.equal(
    afterKeys.size,
    beforeKeys.size + (beforeKeys.has(`${group.id}:hour`) ? 0 : 1),
    "新版本应等于既有键集加上本次新增键，不得凭空多出或丢掉价格"
  );
  if (ratesBefore) {
    const kept = await prisma.rentalPriceVersion.findFirst({ where: { id: ratesBefore.id } });
    assert.deepEqual(kept.rates, ratesBefore.rates, "旧版本不可变：内容不得被改写");
  }
  ok("保存计划：追加完整空间级版本（全集而非差异），旧版本原样保留");

  // ============ 2. 报价命中版本并把版本引用写进快照（真库读回也带着） ============
  const location = ctx.locations.find((item) => item.status === "enabled") ?? ctx.locations[0];
  assert.ok(location, "夹具需要至少一个履约地点");
  const quote = await business.createQuote(tenantId, ctx, {
    customerType: "personal",
    fulfillmentMode: ctx.settings.fulfillment.enabledModes[0],
    fulfillmentLocationId: location.id,
    startAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    endAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    lines: [{ itemGroupId: group.id, quantity: 1, pricingUnit: "hour" }]
  });
  assert.equal(quote.priceVersionId, v1.id, "报价必须记录命中的空间级价格版本 id");
  assert.equal(quote.priceVersion, `v${v1.sequence}`, "报价必须记录版本号");
  const quoteRow = await prisma.rentalQuote.findFirst({ where: { id: quote.id } });
  assert.ok(quoteRow, "报价必须落库");
  assert.equal(quoteRow.priceVersionId, v1.id, "版本引用必须真的落到库里，而不是只存在于返回值");
  assert.equal(quoteRow.priceVersion, `v${v1.sequence}`);
  ok("报价：命中版本写入快照并落库（priceVersionId / priceVersion）");

  // ============ 3. 事务内任一步失败时，计划现值不得已经落库 ============
  // 注入故障：只让**事务内**那次计划行写入失败。旧实现在进事务前先无条件写过一次，
  // 那一次不会被回滚，于是留下「已变价但没有不可变历史」——正是这条断言要抓的。
  const realUpsert = businessConfig.upsertPricingPlan.bind(businessConfig);
  businessConfig.upsertPricingPlan = async (plan, tx) => {
    if (tx) throw new Error(`${TAG} 注入故障：事务内写计划行失败`);
    return realUpsert(plan, tx);
  };
  const planBefore = await prisma.rentalPricingPlan.findFirst({ where: { workspaceId, code: `${TAG}-A` } });
  await assert.rejects(
    business.savePricingPlan(tenantId, ctx, {
      id: saved.id, code: `${TAG}-A`, name: "PRICE-03 专项计划", status: "enabled",
      effectiveFrom: saved.effectiveFrom, changeReason: `${TAG} 二次保存应失败`,
      rates: [rate(group.id, "hour", 99)]
    }, "专项用例"),
    (error) => {
      assert.match(error.message, /注入故障/u, `应把事务内故障原样抛出，实际 ${error.message}`);
      return true;
    },
    "事务内写入失败时保存必须失败"
  );
  businessConfig.upsertPricingPlan = realUpsert;
  const planAfter = await prisma.rentalPricingPlan.findFirst({ where: { workspaceId, code: `${TAG}-A` } });
  assert.deepEqual(
    planAfter.rates, planBefore.rates,
    "版本事务失败时计划现值必须一并回滚——否则就是「已变价但没有不可变历史」"
  );
  assert.equal(
    await prisma.rentalPriceVersion.count({ where: { tenantId, workspaceId, changeReason: `${TAG} 二次保存应失败` } }),
    0,
    "失败的保存不得留下半截版本"
  );
  ok("原子性：事务内失败时计划现值一并回滚，且不留半截版本");

  await cleanup(workspaceId);
  await prisma.rentalQuote.deleteMany({ where: { id: quote.id } });
  await prisma.$disconnect();
  console.log(`\nPRICE-03 空间级价格版本专项：全部通过`);
})().catch(async (error) => {
  console.error(error);
  if (prisma) await prisma.$disconnect();
  process.exit(1);
});

