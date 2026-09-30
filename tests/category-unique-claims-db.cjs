"use strict";

// Invoked only by the category migration clone test after DATABASE_URL points
// to its owned dedicated database. Verifies the real model-level unique claim.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { resolveDedicatedTarget } = require("../scripts/ops/dedicated-env.cjs");
const { RentalCoreConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-core-config.repository.js");
const { RentalCoreFactRepository } = require("../apps/api/dist/modules/rental-core/rental-core-fact.repository.js");
const { RentalBusinessFactRepository } = require("../apps/api/dist/modules/rental-core/rental-business-fact.repository.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");

resolveDedicatedTarget(process.env.DATABASE_URL);
const db = new PrismaClient();
const repository = new RentalCoreConfigRepository(db);
const facts = new RentalCoreFactRepository(db);
const businessFacts = new RentalBusinessFactRepository(db);
const suffix = randomUUID().replace(/-/gu, "").slice(0, 12);

void (async () => {
  try {
    const workspace = await db.businessWorkspace.findFirst({
      where: { tenantId: "tenant_001", categoryCode: "CAMERA" }, select: { id: true }
    });
    assert.ok(workspace, "缺少摄影测试空间");
    const scope = { tenantId: "tenant_001", workspaceId: workspace.id };
    const makeGroup = (letter, value) => ({
      id: `catgov_model_${suffix}_${letter}`, tenantId: scope.tenantId,
      categoryCode: "camera", code: `CATGOV-${suffix}-${letter}`,
      name: `CAT-GOV 并发型号 ${letter}`, inventoryMode: "serialized", unit: "件",
      attributes: { probeSerial: value }, images: [], bundleComponents: [], status: "enabled",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    const first = makeGroup("A", "SAME");
    const second = makeGroup("B", "SAME");
    const claim = (value) => [{ fieldCode: "probeSerial", label: "测试序号", normalizedValue: value }];
    const save = (group, value) => runWithRequestIdentity(scope, () => repository.upsertItemGroup(group, undefined, claim(value)));
    const attempts = await Promise.allSettled([save(first, "SAME"), save(second, "SAME")]);
    assert.equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1, "同一唯一值并发仅能成功一笔");
    const winner = attempts[0].status === "fulfilled" ? first : second;
    const loser = winner === first ? second : first;
    assert.equal(await db.rentalItemGroup.count({ where: { id: { in: [first.id, second.id] } } }), 1);
    await save({ ...winner, attributes: { probeSerial: "CHANGED" } }, "CHANGED");
    await save(loser, "SAME");
    assert.equal(await db.rentalItemGroup.count({ where: { id: { in: [first.id, second.id] } } }), 2);
    assert.equal(await db.rentalAttributeUniqueValue.count({ where: {
      workspaceId: workspace.id, entityType: "item_group", fieldCode: "probeSerial",
      entityId: { in: [first.id, second.id] }
    } }), 2, "改值须释放旧声明并建立新声明");
    const seedAsset = await db.rentalAsset.findFirst({
      where: { tenantId: scope.tenantId, workspaceId: workspace.id },
      select: { itemGroupId: true, locationId: true }
    });
    assert.ok(seedAsset, "缺少资产唯一性测试所需的摄影资产夹具");
    const makeAsset = (letter, serial) => ({
      id: `catgov_asset_${suffix}_${letter}`, tenantId: scope.tenantId,
      itemGroupId: seedAsset.itemGroupId, locationId: seedAsset.locationId,
      assetNo: `CATGOV-ASSET-${suffix}-${letter}`, serialNo: serial,
      status: "available", attributes: { serialNo: serial }, createdAt: new Date().toISOString()
    });
    const firstAsset = makeAsset("A", `SERIAL-${suffix}`);
    const secondAsset = makeAsset("B", `SERIAL-${suffix}`);
    const saveAsset = (asset) => runWithRequestIdentity(scope, () => facts.upsertAsset(asset, [
      { fieldCode: "serialNo", label: "资产序列号", normalizedValue: asset.serialNo }
    ]));
    const assetAttempts = await Promise.allSettled([saveAsset(firstAsset), saveAsset(secondAsset)]);
    assert.equal(assetAttempts.filter((entry) => entry.status === "fulfilled").length, 1, "同一资产唯一值并发仅能成功一笔");
    const assetWinner = assetAttempts[0].status === "fulfilled" ? firstAsset : secondAsset;
    const assetLoser = assetWinner === firstAsset ? secondAsset : firstAsset;
    await saveAsset({ ...assetWinner, serialNo: `CHANGED-${suffix}`, attributes: { serialNo: `CHANGED-${suffix}` } });
    await saveAsset(assetLoser);
    assert.equal(await db.rentalAttributeUniqueValue.count({ where: {
      workspaceId: workspace.id, entityType: "asset", fieldCode: "serialNo",
      entityId: { in: [firstAsset.id, secondAsset.id] }
    } }), 2, "资产改值须释放旧声明并建立新声明");
    console.log("Category model and asset unique-value concurrency and replacement passed.");
    await runWithRequestIdentity(scope, async () => {
      const binding = await db.businessWorkspace.findUnique({ where: { id: workspace.id } });
      const sourceQuote = await db.rentalQuote.findFirst({ where: { tenantId: scope.tenantId, workspaceId: workspace.id } });
      assert.ok(sourceQuote && binding.categoryVersionId, "缺少品类版本报价夹具");
      const legacyQuote = await businessFacts.findQuote(scope.tenantId, sourceQuote.id);
      assert.equal(legacyQuote.categoryVersionId, undefined, "迁移不得伪造旧报价的版本证据");
      assert.equal(legacyQuote.inspectionTemplateSnapshots, undefined, "迁移不得回填当前模板充当历史快照");
      const templates = await repository.listInspectionTemplates(scope.tenantId, workspace.id);
      assert.ok(templates.length, "缺少检查模板夹具");
      const quote = { ...legacyQuote, id: `catgov_quote_${suffix}`, quoteNo: `CATGOV-Q-${suffix}`, categoryVersionId: binding.categoryVersionId, inspectionTemplateSnapshots: structuredClone(templates) };
      const expectedBinding = { categoryVersionId: binding.categoryVersionId, adoptionRevision: binding.categoryAdoptionRevision };
      const staleQuote = { ...quote, id: `${quote.id}_stale`, quoteNo: `${quote.quoteNo}-S` };
      await assert.rejects(businessFacts.upsertQuote(staleQuote, { ...expectedBinding, adoptionRevision: expectedBinding.adoptionRevision + 1 }), /报价期间已变化/u);
      assert.equal(await db.rentalQuote.count({ where: { id: staleQuote.id } }), 0, "绑定检查失败不能留下报价事实");
      await businessFacts.upsertQuote(quote, expectedBinding);
      assert.equal((await businessFacts.findQuote(scope.tenantId, quote.id)).categoryVersionId, binding.categoryVersionId, "报价版本写入/读回不能丢失");
      assert.deepEqual((await businessFacts.findQuote(scope.tenantId, quote.id)).inspectionTemplateSnapshots, templates, "完整模板 JSON 写入/读回不能丢失");
      await assert.rejects(businessFacts.upsertQuote({ ...quote, inspectionTemplateSnapshots: [] }), /检查模板快照不可改写/u);
      await assert.rejects(businessFacts.upsertQuote({ ...quote, inspectionTemplateSnapshots: undefined }), /检查模板快照不可改写/u);
      await assert.rejects(businessFacts.upsertQuote({ ...quote, categoryVersionId: undefined }), /版本依据不可改写/u);
      await db.businessWorkspace.update({ where: { id: workspace.id }, data: { categoryAdoptionRevision: { increment: 1 } } });
      await assert.rejects(businessFacts.upsertQuote(staleQuote, expectedBinding), /报价期间已变化/u, "其他进程采用新版后旧请求必须立即被拒绝");
      assert.equal(await db.rentalQuote.count({ where: { id: staleQuote.id } }), 0);
      const sourceOrder = await db.rentalOrder.findFirst({ where: { tenantId: scope.tenantId, workspaceId: workspace.id } });
      assert.ok(sourceOrder, "缺少历史订单夹具");
      const legacyOrder = await facts.findOrder(scope.tenantId, sourceOrder.id);
      assert.equal(legacyOrder.categoryVersionId, undefined, "迁移不得伪造旧订单的版本证据");
      assert.equal(legacyOrder.inspectionTemplateSnapshots, undefined, "旧订单无检查证据时保持缺省");
      // 仅在一次性克隆库构造有版本证据的订单夹具，验证真实聚合仓储的持久化链。
      await db.rentalOrder.update({ where: { id: sourceOrder.id }, data: { categoryVersionId: binding.categoryVersionId, inspectionTemplateSnapshots: templates } });
      await facts.saveOrderAggregate({ ...legacyOrder, categoryVersionId: binding.categoryVersionId, inspectionTemplateSnapshots: templates });
      const restored = await facts.findOrder(scope.tenantId, sourceOrder.id);
      assert.equal(restored.categoryVersionId, binding.categoryVersionId);
      assert.deepEqual(restored.inspectionTemplateSnapshots, templates);
      await assert.rejects(facts.saveOrderAggregate({ ...restored, inspectionTemplateSnapshots: [] }), /检查模板快照不可改写/u);
      await assert.rejects(facts.saveOrderAggregate({ ...restored, inspectionTemplateSnapshots: undefined }), /检查模板快照不可改写/u);
      await assert.rejects(facts.saveOrderAggregate({ ...restored, categoryVersionId: undefined }), /版本依据不可改写/u);
      for (const field of ["rentalAmount", "payableAmount", "finalPayableAmount", "depositAmount", "preAuthAmount"]) {
        assert.equal(typeof legacyOrder[field], "number", `金额断言必须有真实值：${field}`);
        assert.equal(restored[field], legacyOrder[field], `记录版本不能重算订单金额：${field}`);
      }
      const otherVersion = await db.rentalCategoryVersion.findFirst({ where: { categoryCode: "CAMPING", status: "published" } });
      assert.ok(otherVersion);
      await assert.rejects(db.rentalOrder.update({ where: { id: sourceOrder.id }, data: { categoryVersionId: otherVersion.id } }), (error) => error.code === "P2003", "数据库必须拒绝跨品类版本引用");
      await db.rentalQuote.delete({ where: { id: quote.id } });
      console.log("Category quote/order version persistence, legacy NULL and cross-category FK protection passed.");
    });
  } finally {
    await db.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
