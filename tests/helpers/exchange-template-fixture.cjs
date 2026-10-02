"use strict";
// Isolated MySQL E2E fixture only. Parent always drops the dedicated database in finally.
const { PrismaClient, RentalOrderV1Status } = require("@prisma/client");
const { resolveDedicatedTarget } = require("../../scripts/ops/dedicated-env.cjs");
resolveDedicatedTarget(process.env.DATABASE_URL);
const db = new PrismaClient();
void (async () => {
  try {
    const order = await db.rentalOrder.findUniqueOrThrow({ where: { id: process.env.EXCHANGE_ORDER_ID } });
    if (order.status !== RentalOrderV1Status.RENTING) throw Error("Exchange fixture requires an actually picked-up order");
    const template = await db.rentalInspectionTemplate.findFirstOrThrow({ where: { tenantId: order.tenantId, workspaceId: order.workspaceId, stage: "return" }, orderBy: { id: "asc" } });
    if (process.env.EXCHANGE_FIXTURE_MODE === "prepare") {
      await db.rentalInspectionTemplate.update({ where: { id: template.id }, data: {
        fields: [...template.fields.filter((row) => row.code !== "replacement_check"), { code: "replacement_check", label: "Replacement-only check", type: "boolean", required: true }]
      } });
    } else if (process.env.EXCHANGE_FIXTURE_MODE === "disable") {
      await db.rentalInspectionTemplate.update({ where: { id: template.id }, data: { enabled: false, fields: [] } });
    } else throw Error("Unknown exchange fixture mode");
    console.log("Dedicated exchange template fixture applied.");
  } finally { await db.$disconnect(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
