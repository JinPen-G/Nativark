"use strict";
// Invoked by MySQL E2E only, against its dedicated fresh database.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { resolveDedicatedTarget } = require("../scripts/ops/dedicated-env.cjs");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const { RentalBusinessFactRepository } = require("../apps/api/dist/modules/rental-core/rental-business-fact.repository.js");
const { RentalCoreFactRepository } = require("../apps/api/dist/modules/rental-core/rental-core-fact.repository.js");
resolveDedicatedTarget(process.env.DATABASE_URL);
const db = new PrismaClient();
void (async () => {
  try {
    const row = await db.rentalOrder.findUniqueOrThrow({ where: { id: process.env.SNAPSHOT_ORDER_ID } });
    await runWithRequestIdentity({ tenantId: row.tenantId, workspaceId: row.workspaceId }, async () => {
      const business = new RentalBusinessFactRepository(db);
      const core = new RentalCoreFactRepository(db);
      const quote = await business.findQuote(row.tenantId, row.quoteId);
      const order = await core.findOrder(row.tenantId, row.id);
      assert.ok(quote.inspectionTemplateSnapshots.length > 0);
      assert.deepEqual(order.inspectionTemplateSnapshots, quote.inspectionTemplateSnapshots);
      for (const replacement of [undefined, [], [{ ...quote.inspectionTemplateSnapshots[0], fields: [] }]]) {
        await assert.rejects(business.upsertQuote({ ...quote, inspectionTemplateSnapshots: replacement }), /检查模板快照不可改写/u);
        await assert.rejects(core.saveOrderAggregate({ ...order, inspectionTemplateSnapshots: replacement }), /检查模板快照不可改写/u);
      }
      await business.upsertQuote(quote);
      await core.saveOrderAggregate(order);
      assert.deepEqual((await core.findOrder(row.tenantId, row.id)).inspectionTemplateSnapshots, quote.inspectionTemplateSnapshots);
      console.log("Inspection snapshot quote/order persistence, immutable guards and unchanged saves passed.");
      const definition = await db.rentalCategoryVersion.findUniqueOrThrow({ where: { id: quote.categoryVersionId } });
      const ids = [randomUUID(), randomUUID()];
      const at = new Date().toISOString();
      const basis = {
        pricingMode: "original_total", policySource: "original_quote", categoryCode: quote.categoryCode,
        originalCategoryVersionId: quote.categoryVersionId, categoryVersionId: quote.categoryVersionId,
        categoryPolicySnapshot: definition.definition,
        pricingStrategies: [...new Set(quote.rateSnapshot.map((rate) => rate.unit))].map((unit) => ({ unit, implementationVersion: "1" }))
      };
      try {
        for (let index = 0; index < ids.length; index += 1) {
          await core.insertExtension({
            id: ids[index], tenantId: row.tenantId, workspaceId: row.workspaceId, orderId: row.id, sequence: index + 1,
            status: "pending_payment", originalEndAt: order.endAt, newEndAt: new Date(Date.parse(order.endAt) + 86400000).toISOString(),
            billableUnits: 1, rentalAmount: 0, serviceAmount: 0, depositDelta: 0, preAuthDelta: 0, payableAmount: 0,
            currency: quote.currency, priceVersionId: quote.priceVersionId, priceVersion: quote.priceVersion, ruleVersion: quote.ruleVersion,
            rateSnapshot: quote.rateSnapshot, ruleSnapshot: quote.ruleSnapshot, calendarSnapshot: quote.calendarSnapshot ?? [],
            settlementMode: "immediate", idempotencyKey: ids[index], createdBy: "snapshot-probe", createdAt: at,
            executionBasis: index === 0 ? basis : undefined
          });
        }
        const read = () => core.listExtensions(row.tenantId, row.id);
        assert.deepEqual((await read()).find((entry) => entry.id === ids[0]).executionBasis, basis);
        assert.equal((await read()).find((entry) => entry.id === ids[1]).executionBasis, undefined);
        await core.markExtensionEffective(row.tenantId, ids[0], at, at);
        await core.cancelExtensions(row.tenantId, [ids[1]]);
        assert.deepEqual((await read()).find((entry) => entry.id === ids[0]).executionBasis, basis, "续租生效不能追改动作依据");
        assert.equal((await read()).find((entry) => entry.id === ids[1]).executionBasis, undefined, "取消无证据记录不能伪造依据");
        console.log("Extension execution-basis persistence, status-only updates and legacy NULL passed (repository fixture, not renewal API acceptance).");
      } finally { await db.rentalOrderExtension.deleteMany({ where: { id: { in: ids } } }); }
    });
  } finally { await db.$disconnect(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
