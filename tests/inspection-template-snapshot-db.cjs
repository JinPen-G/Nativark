"use strict";
// Invoked by MySQL E2E only, against its dedicated fresh database.
const assert = require("node:assert/strict");
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
    });
  } finally { await db.$disconnect(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
