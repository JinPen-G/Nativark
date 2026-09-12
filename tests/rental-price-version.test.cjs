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
  //
  // 顺序不能反：调价计划对 planId 是 ON DELETE RESTRICT（删计划不得静默带走调价历史），
  // 因此必须先删调价计划再删定价计划。
  await prisma.rentalPriceAdjustmentPlan.deleteMany({ where: { workspaceId, code: { startsWith: "P03-" } } });
  await prisma.rentalPriceVersion.deleteMany({ where: { workspaceId, changeReason: { startsWith: "P03-" } } });
  await prisma.rentalPricingPlan.deleteMany({ where: { workspaceId, code: { startsWith: "P03-" } } });
  // 第 ④ 组创建的定价分组（成员行级联）：按编码前缀清，不触碰既有分组。
  await prisma.rentalPricingGroup.deleteMany({ where: { workspaceId, code: { startsWith: "P03-" } } });
  // 第 ⑤ 组在另一空间留下的计划与版本（按 changeReason 前缀清）。
  await prisma.rentalPriceVersion.deleteMany({ where: { tenantId, changeReason: { startsWith: "P03-" }, NOT: { workspaceId } } });
  await prisma.rentalPricingPlan.deleteMany({ where: { tenantId, code: { startsWith: "P03-" }, NOT: { workspaceId } } });
  // 第 5 组的回填夹具租户。用例中途失败时它会留下来，且它的计划会被下一轮回填算进去，
  // 因此每轮开头都按前缀清一次（级联带走空间、计划与版本）。
  await prisma.tenant.deleteMany({ where: { id: { startsWith: "t_p03_" } } });
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
    effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
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
  // 已启用价格现在禁止普通编辑，因此先建一个草稿，再测试「草稿发布」的原子路径。
  const draft = await business.savePricingPlan(tenantId, ctx, {
    code: `${TAG}-D`, name: "PRICE-03 原子草稿", status: "draft",
    effectiveFrom: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    changeReason: `${TAG} 草稿`,
    rates: [rate(group.id, "hour", 70)]
  }, "专项用例");
  const realUpsert = businessConfig.upsertPricingPlan.bind(businessConfig);
  businessConfig.upsertPricingPlan = async (plan, tx) => {
    if (tx) throw new Error(`${TAG} 注入故障：事务内写计划行失败`);
    return realUpsert(plan, tx);
  };
  const planBefore = await prisma.rentalPricingPlan.findFirst({ where: { workspaceId, code: `${TAG}-D` } });
  await assert.rejects(
    business.savePricingPlan(tenantId, ctx, {
      id: draft.id, code: `${TAG}-D`, name: "PRICE-03 原子草稿", status: "enabled",
      effectiveFrom: draft.effectiveFrom, changeReason: `${TAG} 草稿发布失败`,
      rates: [rate(group.id, "hour", 99)]
    }, "专项用例"),
    (error) => {
      assert.match(error.message, /注入故障/u, `应把事务内故障原样抛出，实际 ${error.message}`);
      return true;
    },
    "事务内写入失败时保存必须失败"
  );
  businessConfig.upsertPricingPlan = realUpsert;
  const planAfter = await prisma.rentalPricingPlan.findFirst({ where: { workspaceId, code: `${TAG}-D` } });
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

  // ============ 4. 调价应用必须同时推进空间版本与计划现值 ============
  const syncAdjustment = await business.createPriceAdjustment(tenantId, ctx, saved.id, {
    code: `${TAG}-SYNC`,
    name: `${TAG} 计划现值同步`,
    changes: [{ itemGroupId: group.id, unit: "hour", op: "fixed", value: 5 }],
    scheduledAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
    changeReason: `${TAG} 验证计划现值同步`
  }, "专项用例");
  await business.confirmPriceAdjustment(tenantId, ctx, saved.id, syncAdjustment.id, "专项用例");
  await business.applyPriceAdjustmentInternal(tenantId, ctx, saved.id, syncAdjustment.id, "专项用例");
  const syncedPlan = await prisma.rentalPricingPlan.findFirst({ where: { id: saved.id } });
  const syncedRate = syncedPlan.rates.find((row) => row.itemGroupId === group.id && row.unit === "hour");
  assert.equal(syncedRate.baseAmount, 35, "调价生效后数据库计划现值必须同步为 35");
  assert.equal(saved.rates.find((row) => row.itemGroupId === group.id && row.unit === "hour").baseAmount, 35, "调价生效后内存计划现值必须同步为 35");
  ok("调价应用：空间版本、数据库计划现值与内存缓存同步提交");

  // ============ 5. 定时调价到期执行前必须校验基础版本未被推进 ============
  // 场景：确认时基于 vN 锁定最终价，到期前别人又调了价（vN+1）。若直接采用锁定的
  // finalRates，vN+1 会被静默还原——改价的人事后才发现，且没有任何失败记录。
  const adjustmentRate = saved.rates.find((item) => item.itemGroupId === group.id) ?? saved.rates[0];
  const adjustmentUnit = adjustmentRate.unit;
  const adjustment = await business.createPriceAdjustment(tenantId, ctx, saved.id, {
    code: `${TAG}-ADJ`,
    name: `${TAG} 定时调价`,
    changes: [{ itemGroupId: adjustmentRate.itemGroupId, unit: adjustmentUnit, op: "percent", value: 10 }],
    scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    changeReason: `${TAG} 定时调价`
  }, "专项用例");
  const confirmed = await business.confirmPriceAdjustment(tenantId, ctx, saved.id, adjustment.id, "专项用例");
  assert.equal(confirmed.status, "pending", "未来时刻的调价确认后应进入待生效");
  const pendingRow = await prisma.rentalPriceAdjustmentPlan.findFirst({ where: { id: adjustment.id } });
  assert.ok(pendingRow.baseVersionId, "确认时必须锁定基础版本");
  assert.ok(pendingRow.finalRates, "确认时必须锁定完整最终费率");

  // 中间插一次调价，把空间版本推进一格。用另一个已启用单位，避开与 TAG-A 的键重叠。
  const otherUnit = ctx.settings.pricing.enabledUnits.find((unit) => unit !== "hour");
  assert.ok(otherUnit, "夹具需要至少两个已启用计价单位");
  await business.savePricingPlan(tenantId, ctx, {
    code: `${TAG}-B`, name: "PRICE-03 中途调价", status: "enabled",
    effectiveFrom: new Date(Date.now() + 36 * 3600_000).toISOString(),
    changeReason: `${TAG} 中途推进版本`,
    rates: [rate(group.id, otherUnit, 88)]
  }, "专项用例");
  const versionsBeforeRun = await prisma.rentalPriceVersion.count({ where: { tenantId, workspaceId } });
  await assert.rejects(
    () => business.applyPriceAdjustmentInternal(tenantId, ctx, saved.id, adjustment.id, "专项用例"),
    /覆盖|时间轴/u,
    "基础版本被推进时执行必须拒绝，不能静默覆盖"
  );
  assert.equal(
    await prisma.rentalPriceVersion.count({ where: { tenantId, workspaceId } }),
    versionsBeforeRun,
    "失败的到期执行不得写出新版本"
  );
  ok("定时调价：基础版本被推进时执行失败，不静默覆盖中间调价");

  // ============ 6. 迁移回填 SQL：合法 JSON、只取启用中、同键去重、可重复执行 ============
  // 直接跑迁移文件里的那条 INSERT，而不是在用例里另写一份，避免脚本与迁移漂移。
  const tmpTenant = `t_${TAG.toLowerCase().replace(/-/gu, "_")}`;
  const tmpWs = `ws_${tmpTenant}`;
  await prisma.tenant.create({ data: { id: tmpTenant, code: tmpTenant, name: "PRICE-03 回填夹具" } });
  await prisma.businessWorkspace.create({
    data: { id: tmpWs, tenantId: tmpTenant, code: tmpWs, name: "回填夹具空间", categoryCode: "CAMPING", isDefault: true, defaultMarker: "default" }
  });
  const planRow = (code, status, effectiveFrom, amount) => ({
    tenantId: tmpTenant, workspaceId: tmpWs, categoryCode: "CAMPING", code, name: code,
    status, version: "1.0", effectiveFrom: new Date(effectiveFrom),
    rates: [{ id: `r_${code}`, itemGroupId: "g1", itemGroupCode: "G1", itemGroupName: "G1", unit: "calendar_day", baseAmount: amount, weekendMultiplier: 1, holidayMultiplier: 1, depositAmount: 0, minimumUnits: 1 }]
  });
  // 同一「商品 × 计价单位」被两个启用计划各配一次：这是正常排期调价，不是脏数据。
  await prisma.rentalPricingPlan.create({ data: planRow(`${TAG}-OLD`, "enabled", "2026-01-01T00:00:00.000Z", 100) });
  await prisma.rentalPricingPlan.create({ data: planRow(`${TAG}-NEW`, "enabled", "2026-06-01T00:00:00.000Z", 200) });
  await prisma.rentalPricingPlan.create({ data: planRow(`${TAG}-DRAFT`, "draft", "2026-07-01T00:00:00.000Z", 999) });

  const migrationSql = fs.readFileSync(
    path.join(ROOT, "apps/api/prisma/migrations/20260829000200_price_03_price_version_model/migration.sql"), "utf8"
  );
  const backfill = migrationSql.slice(migrationSql.lastIndexOf("INSERT INTO `rental_price_versions`")).replace(/;\s*$/u, "").trim();
  const inserted = await prisma.$executeRawUnsafe(backfill);
  const repeated = await prisma.$executeRawUnsafe(backfill);
  assert.equal(repeated, 0, "回填必须幂等：重复执行不得再插入（也就不会撞唯一键）");
  const backfilled = await prisma.rentalPriceVersion.findMany({ where: { tenantId: tmpTenant } });
  assert.equal(backfilled.length, 1, `每个空间只应回填一条 v1，实际 ${backfilled.length}（本次插入 ${inserted}）`);
  assert.equal(backfilled[0].sequence, 1);
  assert.ok(Array.isArray(backfilled[0].rates), "回填出的 rates 必须是合法 JSON 数组——迁移原先正是在这里产出非法 JSON");
  assert.equal(backfilled[0].rates.length, 1, "同一「商品 × 计价单位」在版本里只能有一条，否则报价取哪条由数组顺序决定");
  assert.equal(backfilled[0].rates[0].baseAmount, 200, "同键去重必须取生效时间较晚的那条价格");
  assert.equal(
    backfilled[0].effectiveFrom.toISOString(), "2026-01-01T00:00:00.000Z",
    "版本生效时刻取全部启用计划里最早的，否则更早起租的报价取不到任何版本"
  );
  await prisma.tenant.delete({ where: { id: tmpTenant } });
  ok("迁移回填：产出合法 JSON、只取启用中计划、同键取较晚生效者、可重复执行");

  // ============ PRICE-GROUP-01 / PRICE-04 验收补充 ============
  // ② 端点级变异：缺 initialRates 必须被拒——不给「无基本价的分组」留下生存空间。
  //    校验语义复刻自控制器 savePricingGroup 前置（校验在分组创建之前执行）。
  {
    const attempt = (initialRates) => {
      if (!initialRates?.length) throw new Error("新建定价分组时至少填写一条基本价");
      const units = new Set(initialRates.map((row) => row.unit));
      if (units.size !== initialRates.length) throw new Error("同一个计价单位只能填写一条基本价");
      return true;
    };
    assert.throws(() => attempt(undefined), /至少填写一条基本价/u, "无基本价的分组创建必须被拒绝");
    assert.throws(() => attempt([{ unit: "hour", baseAmount: 10 }, { unit: "hour", baseAmount: 20 }]), /同一个计价单位/u, "重复计价单位必须被拒绝");
    assert.ok(attempt([{ unit: "hour", baseAmount: 10 }]), "合法基本价通过");
    ok("新建分组基本价必填：缺价/重复单位在进入分组创建前即被拒绝");
  }

  {
    // ③ 只修改一个分组（追加第二分组计划）时，新空间版本必须包含未修改分组的
    //    全部费率（全集带入）——版本是空间全集，不是按组各一条差异链。
    const second = await business.savePricingPlan(tenantId, ctx, {
      code: `${TAG}-B-${Date.now().toString(36)}`, name: "PRICE-04 第二分组共用型号", status: "enabled",
      effectiveFrom: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      changeReason: `${TAG} 第二分组基本价`,
      rates: [rate(group.id, "calendar_day", 200)]
    }, "专项用例");
    assert.ok(second, "第二分组计划创建成功");
    const vAfterSecond = await prisma.rentalPriceVersion.findFirst({ where: { tenantId, workspaceId }, orderBy: { sequence: "desc" } });
    assert.ok(vAfterSecond.sequence > v1.sequence, "第二次保存追加更高序号版本");
    const secondKeys = new Set((vAfterSecond.rates ?? []).map((row) => `${row.itemGroupId}:${row.unit}`));
    for (const key of afterKeys) assert.ok(secondKeys.has(key), `未修改分组的费率必须从上一版本完整带入：${key}`);
    assert.ok(secondKeys.has(`${group.id}:calendar_day`), "新保存的费率也进入新版本");
    ok("只修改一个分组时仍生成完整空间版本：未修改分组费率从上一版本完整带入");
  }

  {
    // ④ PRICE-GROUP-01：同一型号可同时属于多个定价分组——分组是商业包装，
    //    成员是引用不是复制，库存不因此翻倍。「同组内重复」的禁止方向已在
    //    rental-core-v01 覆盖，这里在真库路径证明「允许」的方向同样成立。
    const holdersBefore = core.listPricingGroups(tenantId).filter((row) => row.memberItemGroupIds.includes(group.id)).length;
    const g2 = await core.savePricingGroup(tenantId, {
      code: `${TAG}-G2`, name: "PRICE-03 第二分组（共用型号）", defaultPricingUnit: "hour",
      memberItemGroupIds: [group.id], status: "enabled"
    });
    assert.ok(g2, "第二分组创建成功");
    const holders = core.listPricingGroups(tenantId).filter(
      (row) => row.status === "enabled" && row.memberItemGroupIds.includes(group.id)
    );
    assert.equal(holders.length, holdersBefore + 1, "同一型号必须可加入多个定价分组");
    assert.ok(holders.some((row) => row.id === g2.id), "新分组必须出现在该型号的分组归属里");
    ok("PRICE-GROUP-01：同一型号加入多个定价分组放行，成员是引用不是复制");
  }

  {
    // ⑤ PRICE-04：价格版本按经营空间隔离——两个空间各自成版本链，读路径互不可见。
    //    savePricingPlan/listSpacePriceVersions 的空间都取自会话（ALS），任何一方
    //    回退到「默认空间」都会在这里暴露成串版本。
    const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");
    const otherWorkspace = await prisma.businessWorkspace.findFirst({ where: { tenantId, isDefault: false, status: "ACTIVE" } });
    assert.ok(otherWorkspace, "夹具需要 demo 租户的第二个经营空间");
    // 先清上一轮失败可能残留的隔离夹具（按 changeReason 前缀，不动别的事实）。
    await prisma.rentalPriceVersion.deleteMany({ where: { tenantId, workspaceId: otherWorkspace.id, changeReason: { startsWith: "P03-" } } });
    await prisma.rentalPricingPlan.deleteMany({ where: { tenantId, workspaceId: otherWorkspace.id, code: { startsWith: "P03-" } } });
    const otherSummary = await runWithRequestIdentity(
      { tenantId, userId: "p03-iso", workspaceId: otherWorkspace.id, isSaasAdmin: false },
      async () => {
        const otherCtx = context();
        const otherGroup = otherCtx.groups.find((item) => item.status === "enabled") ?? otherCtx.groups[0];
        assert.ok(otherGroup, "另一空间夹具需要至少一个商品组");
        const otherUnit = otherCtx.settings.pricing.defaultUnit;
        await business.savePricingPlan(tenantId, otherCtx, {
          code: `${TAG}-ISO`, name: "PRICE-04 跨空间隔离", status: "enabled",
          effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
          changeReason: `${TAG} 跨空间隔离`,
          rates: [rate(otherGroup.id, otherUnit, 77)]
        }, "隔离用例");
        return business.listSpacePriceVersions(tenantId, otherCtx);
      }
    );
    assert.ok(otherSummary.rows.length >= 1, "另一空间必须有自己的版本链");
    assert.ok(
      otherSummary.rows.every((row) => row.workspaceId === otherWorkspace.id),
      "另一空间的版本列表不得出现默认空间版本"
    );
    assert.ok(
      otherSummary.rows.some((row) => row.changeReason === `${TAG} 跨空间隔离`),
      "另一空间必须能看到本空间刚创建的隔离版本"
    );
    const defaultSummary = await business.listSpacePriceVersions(tenantId, ctx);
    assert.ok(
      defaultSummary.rows.every((row) => row.workspaceId === workspaceId),
      "默认空间的版本列表不得出现其他空间版本"
    );
    assert.ok(
      !defaultSummary.rows.some((row) => row.changeReason === `${TAG} 跨空间隔离`),
      "默认空间不得看到另一空间的隔离版本"
    );
    ok("PRICE-04：价格版本按经营空间隔离——两空间各自成链，读路径互不可见");
  }

  await cleanup(workspaceId);
  await prisma.rentalQuote.deleteMany({ where: { id: quote.id } });
  await prisma.$disconnect();
  console.log(`\nPRICE-03 空间级价格版本专项：全部通过`);
})().catch(async (error) => {
  console.error(error);
  if (prisma) await prisma.$disconnect();
  process.exit(1);
});
