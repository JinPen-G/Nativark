"use strict";
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { RentalCoreConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-core-config.repository.js");
const { RentalCoreFactRepository } = require("../apps/api/dist/modules/rental-core/rental-core-fact.repository.js");
const { WorkspaceCapabilityRepository } = require("../apps/api/dist/modules/rental-core/workspace-capability.repository.js");
const { RentalBusinessConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-business-config.repository.js");
const { RentalBusinessFactRepository } = require("../apps/api/dist/modules/rental-core/rental-business-fact.repository.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const { validateActiveCategoryWrite } = require("../apps/api/dist/modules/rental-core/category-active-write.js");
if (!/^rental_os_e2e_/u.test(new URL(process.env.DATABASE_URL).pathname.slice(1))) throw new Error("仅允许专用 E2E 库");
const db = new PrismaClient();
const fixture = `catwrite_${randomUUID()}`;
const workspaceId = fixture;
const versionId = `${fixture}_v2`;
const repo = new RentalCoreConfigRepository(db);
const capabilities = new WorkspaceCapabilityRepository(db);
const business = new RentalBusinessConfigRepository(db);
const context = (fn) => runWithRequestIdentity({ tenantId: "tenant_001", workspaceId }, fn);
(async () => {
  try {
    const baseline = await db.rentalCategoryDefinition.findUniqueOrThrow({ where: { code: "CAMERA" } });
    const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
    definition.businessModel.assetFields = [
      { code: "identity", scope: "item_group", label: "型号身份", type: "string", required: true, unique: true },
      { code: "serialNo", scope: "asset", label: "序列号", type: "string", required: true, unique: true }
    ];
    await db.rentalCategoryVersion.create({ data: { id: versionId, categoryCode: "CAMERA", versionLabel: fixture, sourceKind: "test", status: "published", structureVersion: 1, definition } });
    await db.businessWorkspace.create({ data: { id: workspaceId, tenantId: "tenant_001", code: fixture, name: "并发写入专用空间", categoryCode: "CAMERA", categoryVersionId: baseline.recommendedVersionId, defaultMarker: fixture } });
    const oldBinding = { categoryVersionId: baseline.recommendedVersionId, adoptionRevision: 0 };
    const input = { id: `${fixture}_g1`, tenantId: "tenant_001", categoryCode: "camera", code: "G1", name: "专项型号", inventoryMode: "serialized", unit: "件", attributes: { identity: " abc " }, status: "enabled", bundleComponents: [], createdAt: new Date().toISOString() };
    // Deliberately minimal repository fixtures, not a claim of usable business settings.
    const settings = { tenantId: "tenant_001", categoryCode: "camera", configVersion: "fixture", pricing: { enabledUnits: ["hour"], defaultUnit: "hour", holidayPricingEnabled: false }, calendar: { holidayPricingEnabled: false }, fulfillment: { enabledModes: ["store_pickup_return"] } };
    const location = { id: `${fixture}_location`, tenantId: "tenant_001", code: "L", name: "专项地点", type: "store", status: "enabled", capabilities: ["pickup", "return"] };
    const capability = { tenantId: "tenant_001", workspaceId, code: "camera_compatibility", status: "enabled", implementationVersion: "cam-1.0", configVersion: "v1", config: { relations: [] }, revision: 1 };
    const capabilityAudit = { code: "camera_compatibility", action: "enable", toStatus: "enabled", reason: "仓储锁专项夹具", at: new Date().toISOString() };
    // Hold the exact lock used by active writes, then switch while an old request is waiting.
    let locked; const ready = new Promise((resolve) => { locked = resolve; });
    let unlock; const release = new Promise((resolve) => { unlock = resolve; });
    const switching = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM business_workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      locked(); await release;
      await tx.businessWorkspace.update({ where: { id: workspaceId }, data: { categoryVersionId: versionId, categoryAdoptionRevision: 1 } });
    });
    await ready;
    const stale = context(() => repo.upsertItemGroup(input, undefined, [], oldBinding));
    const rejected = assert.rejects(stale, /版本已变化/);
    const staleSettings = assert.rejects(context(() => repo.upsertBusinessSettings(settings, "fixture", undefined, oldBinding)), /版本已变化/);
    const staleLocation = assert.rejects(context(() => repo.upsertLocation(location, undefined, oldBinding)), /版本已变化/);
    const staleCapability = assert.rejects(capabilities.saveInstance(capability, capabilityAudit, undefined, oldBinding), /版本已变化/);
    const rule = { id: `${fixture}_rule`, tenantId: "tenant_001", categoryCode: "camera", version: "1.0", status: "draft", config: { fixture: true }, changeReason: "fixture", createdBy: "fixture", createdAt: new Date().toISOString() };
    const ruleAudit = { id: `${fixture}_ruleaudit`, tenantId: "tenant_001", workspaceId, ruleVersionId: rule.id, version: rule.version, action: "publish", fromStatus: "draft", toStatus: "pending", reason: "fixture", at: rule.createdAt };
    const nextRule = { ...rule, status: "pending", effectiveFrom: "2030-01-01T00:00:00Z" };
    const price = { id: `${fixture}_price`, tenantId: "tenant_001", categoryCode: "camera", code: "P", name: "专项价格", currency: "CNY", status: "draft", version: "1.0", effectiveFrom: rule.createdAt, createdAt: rule.createdAt, rates: [{ itemGroupId: input.id, unit: "hour", amount: 10 }] };
    const discount = { id: `${fixture}_discount`, tenantId: "tenant_001", categoryCode: "camera", code: "D", name: "专项优惠", status: "enabled", discountType: "percentage", discountValue: 10, minimumSpend: 0, appliesTo: "rental", customerScope: "all", applicableItemGroupIds: [], applicableDayTypes: [], priority: 100, stackableWithOtherPlans: false, stackableWithCoupon: true, effectiveFrom: rule.createdAt, version: "1.0", createdAt: rule.createdAt, updatedAt: rule.createdAt };
    const service = { id: `${fixture}_service`, tenantId: "tenant_001", categoryCode: "camera", code: "S", name: "专项服务", serviceType: "other", billingUnit: "per_order", price: 10, minimumQuantity: 1, maximumQuantity: 5, termsVersion: "1.0", terms: "专项条款", applicableItemGroupIds: [], applicableFulfillmentModes: [], applicableLocationIds: [], customerScope: "all", selectionMode: "optional", requiresCapacity: false, status: "enabled", version: "1.0", createdAt: rule.createdAt, updatedAt: rule.createdAt };
    const staleDiscount = assert.rejects(context(() => business.upsertDiscountPlan(discount, oldBinding)), /版本已变化/);
    const staleService = assert.rejects(context(() => business.upsertService(service, oldBinding)), /版本已变化/);
    const stalePrice = assert.rejects(context(() => business.upsertPricingPlan(price, undefined, oldBinding)), /版本已变化/);
    const staleRule = assert.rejects(context(() => business.upsertRuleVersion(rule, oldBinding)), /版本已变化/);
    const stalePublish = assert.rejects(context(() => business.writeRuleVersionWithAudit(nextRule, ruleAudit, [], oldBinding)), /版本已变化/);
    unlock(); await switching; await Promise.all([rejected, staleSettings, staleLocation, staleCapability, staleRule, stalePublish, stalePrice, staleDiscount, staleService]);
    assert.equal(await db.rentalDiscountPlan.count({ where: { workspaceId } }), 0);
    assert.equal(await db.rentalValueAddedService.count({ where: { workspaceId } }), 0);
    assert.equal(await db.rentalValueAddedServiceVersion.count({ where: { workspaceId } }), 0);
    assert.equal(await db.rentalPricingPlan.count({ where: { workspaceId } }), 0);
    assert.equal(await db.rentalItemGroup.count({ where: { workspaceId } }), 0, "旧请求不能在切换后写入");
    assert.equal(await db.rentalTenantBusinessSettings.count({ where: { workspaceId } }), 0);
    assert.equal(await db.rentalFulfillmentLocation.count({ where: { workspaceId } }), 0);
    assert.equal(await db.workspaceCapabilityInstance.count({ where: { workspaceId } }), 0);
    assert.equal(await db.workspaceCapabilityAuditEntry.count({ where: { workspaceId } }), 0);
    assert.equal(await db.rentalRuleVersion.count({ where: { workspaceId } }), 0);
    assert.equal(await db.rentalRuleVersionAudit.count({ where: { workspaceId } }), 0);
    const currentBinding = { categoryVersionId: versionId, adoptionRevision: 1 };
    await context(() => business.upsertDiscountPlan(discount, currentBinding));
    await context(() => business.upsertService(service, currentBinding));
    await assert.rejects(context(() => business.upsertService({ ...service, version: "2.0", applicableFulfillmentModes: ["onsite_delivery"] })), /不支持/);
    await assert.rejects(context(() => business.upsertService({ ...service, version: "2.0", selectionMode: "mandatory", mandatoryRule: { fulfillmentModes: ["onsite_delivery"] } })), /不支持/);
    assert.equal(await db.rentalValueAddedServiceVersion.count({ where: { workspaceId } }), 1);
    await context(() => business.upsertService({ ...service, version: "2.0", price: 20 }, currentBinding));
    await assert.rejects(context(() => business.upsertService(service, currentBinding)), /历史版本不可覆盖/);
    assert.equal((await db.rentalValueAddedService.findUnique({ where: { id: service.id } })).version, "2.0", "旧服务重放不得退回主档");
    assert.equal(await db.rentalValueAddedServiceVersion.count({ where: { workspaceId } }), 2, "旧快照保留且拒绝请求不新增快照");
    await context(() => business.upsertPricingPlan(price, undefined, currentBinding));
    await assert.rejects(context(() => business.upsertPricingPlan({ ...price, rates: [{ itemGroupId: input.id, unit: "shift", amount: 10 }] })), /不支持/);
    await assert.rejects(context(() => business.upsertPricingPlan({ ...price, fulfillmentFees: [{ mode: "onsite_delivery", amount: 1 }] })), /不支持/);
    assert.equal((await db.rentalPricingPlan.findUnique({ where: { id: price.id } })).rates[0].unit, "hour", "拒绝不适用价格不能覆盖已提交费率");
    await context(() => business.upsertRuleVersion(rule, currentBinding));
    await context(() => business.upsertRuleVersion({ ...rule, config: { fixture: "updated" } }, currentBinding));
    await assert.rejects(context(() => business.writeRuleVersionWithAudit(nextRule, ruleAudit, [], currentBinding)), /正文已变化/);
    assert.equal(await db.rentalRuleVersionAudit.count({ where: { workspaceId } }), 0);
    await context(() => business.writeRuleVersionWithAudit({ ...nextRule, config: { fixture: "updated" } }, ruleAudit, [], currentBinding));
    await assert.rejects(context(() => business.upsertRuleVersion({ ...rule, config: {} }, currentBinding)), /不可覆盖/);
    assert.equal((await db.rentalRuleVersion.findUnique({ where: { id: rule.id } })).status, "pending");
    assert.equal(await db.rentalRuleVersionAudit.count({ where: { workspaceId } }), 1);
    await capabilities.saveInstance(capability, capabilityAudit, undefined, currentBinding);
    assert.equal(await db.workspaceCapabilityInstance.count({ where: { workspaceId } }), 1);
    assert.equal(await db.workspaceCapabilityAuditEntry.count({ where: { workspaceId } }), 1);
    await assert.rejects(capabilities.saveInstance({ ...capability, status: "paused", revision: 2 }, { ...capabilityAudit, action: "pause", toStatus: "paused" }, 1, oldBinding), /版本已变化/);
    assert.equal((await db.workspaceCapabilityInstance.findFirst({ where: { workspaceId } })).status, "enabled");
    assert.equal(await db.workspaceCapabilityAuditEntry.count({ where: { workspaceId } }), 1, "拒绝不能留下审计或状态变化");
    await context(() => repo.upsertBusinessSettings(settings, "fixture", undefined, currentBinding));
    await assert.rejects(context(() => repo.upsertBusinessSettings({ ...settings, pricing: { enabledUnits: ["shift"], defaultUnit: "shift" } }, "fixture")), /不支持/);
    assert.deepEqual((await db.rentalTenantBusinessSettings.findUnique({ where: { workspaceId } })).settings.pricing.enabledUnits, ["hour"], "被拒绝的设置不能覆盖已提交事实");
    await context(() => repo.upsertLocation(location, undefined, currentBinding));
    await assert.rejects(context(() => repo.upsertLocation({ ...location, type: "project_site" })), /不支持/);
    assert.equal((await db.rentalFulfillmentLocation.findUnique({ where: { id: location.id } })).type, "store");
    await assert.rejects(context(() => repo.upsertItemGroup({ ...input, attributes: {} }, undefined, [])), /不能为空/);
    await context(() => repo.upsertItemGroup(input, undefined, []));
    assert.equal(await db.rentalAttributeUniqueValue.count({ where: { workspaceId, entityId: input.id } }), 1, "调用方给空声明也必须按当前版本建立唯一声明");
    const duplicate = { ...input, id: `${fixture}_g2`, code: "G2", attributes: { identity: "ＡＢＣ" } };
    await assert.rejects(context(() => repo.upsertItemGroup(duplicate, undefined, [])), /已存在/);
    assert.equal(await db.rentalItemGroup.count({ where: { workspaceId } }), 1);
    await context(() => repo.upsertItemGroup({ ...input, attributes: { identity: "DEF" } }));
    await context(() => repo.upsertItemGroup(duplicate));
    assert.equal(await db.rentalAttributeUniqueValue.count({ where: { workspaceId } }), 2, "改值应释放旧唯一声明");
    await assert.rejects(db.$transaction((tx) => validateActiveCategoryWrite(tx, "tenant_001", workspaceId, { id: "a", scope: "asset", attributes: {} })), /不能为空/);
    const assetClaims = await db.$transaction((tx) => validateActiveCategoryWrite(tx, "tenant_001", workspaceId, { id: "a", scope: "asset", serialNo: " SN1 ", attributes: {} }));
    assert.equal(assetClaims.claims[0].normalizedValue, "SN1");
    await db.rentalItemGroup.update({ where: { id: input.id }, data: { attributes: { identity: "DEF", retiredProof: { original: true } } } });
    await context(() => repo.upsertItemGroup({ ...input, attributes: { identity: "GHI" } }));
    assert.deepEqual((await db.rentalItemGroup.findUnique({ where: { id: input.id } })).attributes, { identity: "GHI", retiredProof: { original: true } });
    await assert.rejects(context(() => repo.upsertItemGroup({ ...input, attributes: { identity: "GHI", retiredProof: null } })), /不可修改/);
    assert.deepEqual((await db.rentalItemGroup.findUnique({ where: { id: input.id } })).attributes.retiredProof, { original: true });
    await context(() => repo.upsertItemGroup({ ...input, attributes: { identity: "GHI", __itemGroupMedia: { images: ["new"] } } }, undefined, undefined, undefined, true));
    assert.deepEqual((await db.rentalItemGroup.findUnique({ where: { id: input.id } })).attributes.__itemGroupMedia, { images: ["new"] }, "受控上传写穿到库");
    await context(() => repo.upsertItemGroup({ ...input, attributes: { identity: "GHI", __itemGroupMedia: { images: ["stale"] } } }));
    assert.deepEqual((await db.rentalItemGroup.findUnique({ where: { id: input.id } })).attributes.__itemGroupMedia, { images: ["new"] }, "普通资料保存不能覆盖最新图片");
    // Force the scope SELECT to finish before a concurrent locked upload commits.
    // REPEATABLE READ used to preserve the pre-upload media and overwrite it.
    let scopeRead; const scopeReady = new Promise((resolve) => { scopeRead = resolve; });
    let uploadLocked; const uploadReady = new Promise((resolve) => { uploadLocked = resolve; });
    let releaseUpload; const uploadRelease = new Promise((resolve) => { releaseUpload = resolve; });
    const upload = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM business_workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      uploadLocked(); await uploadRelease;
      const latest = await tx.rentalItemGroup.findUniqueOrThrow({ where: { id: input.id } });
      await tx.rentalItemGroup.update({ where: { id: input.id }, data: { attributes: { ...latest.attributes, __itemGroupMedia: { images: ["concurrent-upload"] } } } });
    });
    await uploadReady;
    const observed = new RentalCoreConfigRepository({
      $transaction: (write, options) => db.$transaction((tx) => write(new Proxy(tx, {
        get(target, key) {
          if (key === "businessWorkspace") return { ...target.businessWorkspace, findFirst: async (args) => { const row = await target.businessWorkspace.findFirst(args); scopeRead(); return row; } };
          return Reflect.get(target, key);
        }
      })), options)
    });
    const editing = context(() => observed.upsertItemGroup({ ...input, attributes: { identity: "JKL" } }));
    await scopeReady; releaseUpload(); await upload; await editing;
    assert.deepEqual((await db.rentalItemGroup.findUnique({ where: { id: input.id } })).attributes.__itemGroupMedia, { images: ["concurrent-upload"] }, "锁前范围读取不能使锁后资料仍来自旧快照");
    const facts = new RentalCoreFactRepository(db);
    const asset = { id: `${fixture}_asset`, tenantId: "tenant_001", itemGroupId: input.id, assetNo: "A1", serialNo: "SN1", locationId: location.id, status: "available", attributes: {}, createdAt: rule.createdAt };
    await context(() => facts.upsertAsset(asset, [], undefined, currentBinding));
    assert.equal(await db.rentalAttributeUniqueValue.count({ where: { workspaceId, entityType: "asset", entityId: asset.id } }), 1);
    await assert.rejects(context(() => facts.upsertAsset({ ...asset, id: `${fixture}_duplicate_asset`, assetNo: "A2" })), /已存在/);
    assert.equal(await db.rentalAsset.count({ where: { workspaceId } }), 1, "资产唯一声明冲突必须回滚资产和历史");
    let assetScopeRead; const assetScopeReady = new Promise((resolve) => { assetScopeRead = resolve; });
    let assetLocked; const assetReady = new Promise((resolve) => { assetLocked = resolve; });
    let releaseAsset; const assetRelease = new Promise((resolve) => { releaseAsset = resolve; });
    const assetUpdate = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM business_workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      assetLocked(); await assetRelease;
      await tx.rentalAsset.update({ where: { id: asset.id }, data: { attributes: { retiredProof: { evidence: "latest" } } } });
    });
    await assetReady;
    const observedFacts = new RentalCoreFactRepository({
      $transaction: (write, options) => {
        assert.equal(options?.isolationLevel, "ReadCommitted", "资产自建事务必须避免锁前旧快照");
        return db.$transaction((tx) => write(new Proxy(tx, {
          get(target, key) {
            if (key === "businessWorkspace") return { ...target.businessWorkspace, findFirst: async (args) => { const row = await target.businessWorkspace.findFirst(args); assetScopeRead(); return row; } };
            return Reflect.get(target, key);
          }
        })), options);
      }
    });
    const assetEditing = context(() => observedFacts.upsertAsset(asset, [], undefined, currentBinding));
    await assetScopeReady; releaseAsset(); await assetUpdate; await assetEditing;
    assert.deepEqual((await db.rentalAsset.findUniqueOrThrow({ where: { id: asset.id } })).attributes.retiredProof, { evidence: "latest" }, "资产资料编辑必须保留锁后最新的退役字段证据");
    await assert.rejects(context(() => facts.upsertAsset({ ...asset, attributes: { retiredProof: null } })), /不可修改/);
    assert.equal(await db.rentalAttributeUniqueValue.count({ where: { workspaceId, entityType: "asset", entityId: asset.id } }), 1, "被拒绝的编辑不得删除原唯一声明");
    const coupon = { id: `${fixture}_coupon`, tenantId: "tenant_001", code: "C", name: "专项券", discountType: "amount", discountValue: 10, minimumSpend: 0, appliesTo: "rental", stackableWithDiscountPlans: true, totalQuota: 10, claimedQuantity: 0, perCustomerLimit: 2, perCustomerUseLimit: 1, totalBudget: 100, lockedBudget: 0, redeemedBudget: 0, claimFrom: "2020-01-01T00:00:00Z", claimTo: "2126-01-01T00:00:00Z", effectiveFrom: "2020-01-01T00:00:00Z", effectiveTo: "2126-01-01T00:00:00Z", applicableItemGroupIds: [input.id], status: "active", version: "1.0", createdAt: rule.createdAt };
    await assert.rejects(context(() => repo.upsertCouponTemplate(coupon, undefined, oldBinding)), /版本已变化/);
    assert.equal(await db.rentalCouponTemplate.count({ where: { workspaceId } }), 0);
    await context(() => repo.upsertCouponTemplate(coupon, undefined, currentBinding));
    await db.rentalCouponTemplate.update({ where: { id: coupon.id }, data: { claimedQuantity: 2, lockedBudget: 15, redeemedBudget: 5 } });
    await assert.rejects(context(() => repo.upsertCouponTemplate({ ...coupon, version: "2.0" }, undefined, currentBinding)), /配额或预算已变化/);
    const freshCoupon = { ...coupon, claimedQuantity: 2, lockedBudget: 15, redeemedBudget: 5, version: "2.0" };
    await assert.rejects(context(() => repo.upsertCouponTemplate({ ...freshCoupon, totalQuota: 1 }, undefined, currentBinding)), /发行量/);
    await assert.rejects(context(() => repo.upsertCouponTemplate({ ...freshCoupon, totalBudget: 19 }, undefined, currentBinding)), /总预算/);
    await context(() => repo.upsertCouponTemplate(freshCoupon, undefined, currentBinding));
    await assert.rejects(context(() => repo.upsertCouponTemplate(freshCoupon, undefined, currentBinding)), /其他人员修改/);
    // Establish an outer RR snapshot, then commit a newer claim from another connection.
    await db.$transaction(async (tx) => {
      assert.equal((await tx.rentalCouponTemplate.findUniqueOrThrow({ where: { id: coupon.id } })).claimedQuantity, 2);
      await db.rentalCouponTemplate.update({ where: { id: coupon.id }, data: { claimedQuantity: 3 } });
      const lockedCoupon = await context(() => repo.lockCouponTemplateForClaim("tenant_001", coupon.id, tx));
      assert.equal(lockedCoupon.claimedQuantity, 3, "锁定读必须返回最新配额而不是外层旧快照");
      assert.deepEqual(lockedCoupon.applicableItemGroupIds, [input.id]);
      assert.equal(lockedCoupon.stackableWithDiscountPlans, true);
      await context(() => repo.upsertCouponTemplate({ ...lockedCoupon, claimedQuantity: 4 }, tx));
    });
    const storedCoupon = await db.rentalCouponTemplate.findUniqueOrThrow({ where: { id: coupon.id } });
    assert.equal(storedCoupon.claimedQuantity, 4);
    assert.equal(Number(storedCoupon.lockedBudget), 15);
    assert.equal(Number(storedCoupon.redeemedBudget), 5);
    assert.equal(storedCoupon.version, "2.0", "陈旧保存不得覆盖主档版本");
    const businessFacts = new RentalBusinessFactRepository(db);
    const claimCustomer = `${fixture}_claim_customer`;
    await context(() => db.$transaction(async (tx) => {
      assert.equal(await businessFacts.countCustomerCoupons("tenant_001", coupon.id, claimCustomer, tx), 0);
      await db.rentalCustomerCoupon.create({ data: {
        id: `${fixture}_customer_coupon`, tenantId: "tenant_001", workspaceId, customerId: claimCustomer,
        templateId: coupon.id, templateCode: coupon.code, templateName: coupon.name, templateVersion: "2.0",
        discountType: "amount", discountValue: 10, minimumSpend: 0, applicableItemGroupIds: [input.id],
        grantReason: "fixture", status: "claimed", effectiveFrom: new Date(coupon.effectiveFrom), effectiveTo: new Date(coupon.effectiveTo)
      } });
      await repo.lockCouponTemplateForClaim("tenant_001", coupon.id, tx);
      assert.equal(await businessFacts.countCustomerCoupons("tenant_001", coupon.id, claimCustomer, tx), 1, "RC 事务必须看到锁前并发提交的客户领券事实");
    }, { isolationLevel: "ReadCommitted" }));
    assert.equal((await repo.listCouponTemplates("tenant_001", workspaceId))[0].claimedQuantity, 4);
    assert.deepEqual(await repo.listCouponTemplates("tenant_002", workspaceId), [], "定向配置读取不能跨租户空间");
    const calendar = { tenantId: "tenant_001", year: 2030, version: "1.0", region: "CN", status: "draft", days: [], revision: 1 };
    const calendarAudit = { date: "2030-01-01", action: "override", reason: "calendar fixture", at: new Date().toISOString() };
    await context(() => business.upsertCalendar(calendar));
    const writes = await Promise.allSettled([
      context(() => business.upsertCalendar({ ...calendar, revision: 2 }, 1, [calendarAudit])),
      context(() => business.upsertCalendar({ ...calendar, revision: 2 }, 1, [calendarAudit]))
    ]);
    assert.equal(writes.filter((row) => row.status === "fulfilled").length, 1, "同年度旧修订竞争只能有一条成功");
    assert.equal(await db.rentalCalendarOverrideAuditEntry.count({ where: { workspaceId } }), 1, "竞争失败不留覆盖审计");
    const nextCalendar = { ...calendar, version: "2.0", revision: 1 };
    await context(() => business.upsertCalendar(nextCalendar));
    await assert.rejects(context(() => business.publishCalendarVersion(
      { ...nextCalendar, status: "published", revision: 2 },
      { ...calendar, status: "superseded", revision: 3 },
      { next: 1, superseded: 1 }
    )), /其他人修改/);
    assert.equal((await db.rentalBusinessCalendar.findUnique({ where: { workspaceId_year_version: { workspaceId, year: 2030, version: "2.0" } } })).status, "draft", "第二行修订冲突必须回滚已写第一行");
    await context(() => business.publishCalendarVersion(
      { ...nextCalendar, status: "published", revision: 2 },
      { ...calendar, status: "superseded", revision: 3 },
      { next: 1, superseded: 2 }
    ));
    assert.equal(await db.rentalBusinessCalendar.count({ where: { workspaceId, status: "published" } }), 1);
    await assert.rejects(context(() => business.upsertCalendar({ ...nextCalendar, revision: 3 }, 2, [{ ...calendarAudit, year: 2031 }])), /本次写入/);
    assert.equal(await db.rentalCalendarOverrideAuditEntry.count({ where: { workspaceId } }), 1);
    console.log("category-active-write-db: 型号/设置/地点/能力绑定保护、日历竞争与双行发布回滚、审计原子性及唯一声明/媒体边界通过");
  } finally {
    await db.rentalCustomerCoupon.deleteMany({ where: { workspaceId } });
    await db.businessWorkspace.deleteMany({ where: { id: workspaceId } });
    await db.rentalCategoryVersion.deleteMany({ where: { id: versionId } });
    await db.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
