"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { RentalCoreConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-core-config.repository.js");
const { adoptionFixture } = require("./fixtures/category-adoption-fixture.cjs");
function fixture() {
  const f = adoptionFixture(), events = [];
  const raw = f.db.$queryRaw;
  f.db.$queryRaw = async query => { if (query.sql.includes("business_workspaces")) events.push("space-lock"); return raw(query); };
  const settings = f.db.rentalTenantBusinessSettings.findFirst;
  f.db.rentalTenantBusinessSettings.findFirst = async args => { events.push("settings"); return settings(args); };
  f.db.rentalPricingGroup.findUnique = async ({ where }) => f.state.configurations.rentalPricingGroup.find(row => row.id === where.id) ?? null;
  f.db.rentalPricingGroup.upsert = async ({ create }) => { events.push("group-write"); f.state.configurations.rentalPricingGroup.push(create); return create; };
  f.db.rentalPricingGroupMember.deleteMany = async ({ where }) => { events.push("member-delete"); f.state.members = f.state.members.filter(row => row.pricingGroupId !== where.pricingGroupId); };
  f.db.rentalPricingGroupMember.createMany = async ({ data }) => { events.push("member-write"); f.state.members.push(...data); };
  const group = { id: "pricing-own", tenantId: "tenant", categoryCode: "camera", code: "P", name: "Price group", defaultPricingUnit: "hour",
    memberItemGroupIds: f.state.groups.map(row => row.id), status: "enabled", version: 1, createdAt: "2026-11-09T00:00:00Z" };
  const repository = new RentalCoreConfigRepository(f.db);
  return { f, events, group, write: (body = group, tx) => f.within(() => repository.upsertPricingGroup(body, tx, { categoryVersionId: "v1", adoptionRevision: 1 })) };
}
test("pricing-group writes obtain the adoption space lock before checking settings and replacing members", async () => {
  const t = fixture(); await t.write();
  assert.deepEqual(t.events, ["space-lock", "settings", "group-write", "member-delete", "member-write"]);
  assert.equal(t.f.state.configurations.rentalPricingGroup.length, 1); assert.equal(t.f.state.members.length, 2);
});
test("a changed category binding rejects the previously prepared group before any group/member write", async () => {
  const t = fixture(); t.f.state.workspace.categoryVersionId = "v2"; t.f.state.workspace.categoryAdoptionRevision = 2;
  await assert.rejects(t.write(), /版本已变化/);
  assert.deepEqual(t.events, ["space-lock"]); assert.equal(t.f.state.members.length, 0);
});
test("the fresh enabled-unit setting, disabled members and mixed inventory cannot race past the group write", async () => {
  for (const change of [
    t => { t.f.state.configurations.rentalTenantBusinessSettings[0].settings.pricing.enabledUnits = ["day_24h"]; },
    t => { t.f.state.groups[0].status = "disabled"; },
    t => { t.f.state.groups[0].inventoryMode = "QUANTITY"; }
  ]) {
    const t = fixture(); change(t); await assert.rejects(t.write(), /不兼容|成员在等待期间已变化/);
    assert.equal(t.f.state.configurations.rentalPricingGroup.length, 0); assert.equal(t.f.state.members.length, 0);
  }
});
test("a supplied transaction is reused and a space-external member cannot be written", async () => {
  const t = fixture(); t.f.db.$transaction = () => assert.fail("must reuse supplied transaction");
  await t.write(t.group, t.f.db);
  const outside = fixture(); await assert.rejects(outside.write({ ...outside.group, memberItemGroupIds: ["foreign"] }), /其他租户或经营空间/);
  assert.equal(outside.f.state.configurations.rentalPricingGroup.length, 0);
});
