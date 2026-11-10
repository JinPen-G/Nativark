"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { RENTAL_CATEGORY_DEFINITIONS } = require("../packages/shared/dist");
const { writePreparedCategoryEntities } = require("../apps/api/dist/modules/rental-core/category-adoption-entity-writer.js");

function fixture() {
  const source = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === "camera"));
  source.businessModel.assetFields = [
    { code: "proof", label: "核对编码", type: "string", scope: "item_group", unique: true },
    { code: "reference", label: "外部编码", type: "string", scope: "item_group", unique: true },
    { code: "tag", label: "新标签", type: "string", scope: "item_group", unique: false }
  ];
  source.attributeSchema = { proof: "string", reference: "string", tag: "string" };
  const target = structuredClone(source), events = [];
  const groups = [1, 2].map(index => ({ id: `g${index}`, updatedAt: new Date("2026-11-09T00:00:00Z"),
    inventoryMode: "serialized", attributes: { proof: `P${index}`, reference: `R${index}`, tag: `T${index}` } }));
  let claims = groups.flatMap(row => ["proof", "reference"].map(code => ({ id: `original-${code}-${row.id}`,
    entityType: "item_group", fieldCode: code, entityId: row.id, normalizedValue: row.attributes[code] })));
  const tx = {
    $queryRaw: async () => [{ categoryCode: "camera", categoryVersionId: "source", categoryAdoptionRevision: 1, status: "ACTIVE" }],
    rentalCategoryVersion: { findUnique: async () => ({ categoryCode: "camera", status: "published", structureVersion: 1, definition: source }) },
    rentalItemGroup: { findMany: async () => groups, updateMany: async args => { events.push({ update: args }); return { count: 1 }; } },
    rentalAsset: { findMany: async () => [], updateMany: async () => { throw Error("unexpected asset update"); } },
    rentalAttributeUniqueValue: {
      deleteMany: async args => {
        assert.equal(args.where.tenantId, "tenant"); assert.equal(args.where.workspaceId, "workspace");
        assert.ok(args.where.OR.every(scope => scope.fieldCode.in.length > 0));
        events.push({ deleted: args.where.OR });
        claims = claims.filter(row => !args.where.OR.some(scope => row.entityType === scope.entityType && scope.fieldCode.in.includes(row.fieldCode)));
      },
      create: async args => { events.push({ created: args.data.fieldCode }); claims.push(args.data); }
    }
  };
  return { source, target, groups, events, claims: () => claims,
    write: patches => writePreparedCategoryEntities(tx, "tenant", "workspace", { categoryVersionId: "source", adoptionRevision: 1 }, target, patches ?? []) };
}
const patch = (row, values) => ({ entityType: "item_group", entityId: row.id, expectedUpdatedAt: row.updatedAt.toISOString(), values });

test("display-only changes leave every original uniqueness claim untouched", async () => {
  const f = fixture(), before = structuredClone(f.claims());
  f.target.businessModel.assetFields[0].label = "新显示名";
  f.target.businessModel.assetFields[0].clientVisible = true;
  const result = await f.write();
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.claims(), before);
  assert.deepEqual(result.changedUniqueFields, { item_group: [], asset: [] });
});

test("adding uniqueness builds only the new field while preserving other claim IDs", async () => {
  const f = fixture(), before = structuredClone(f.claims());
  f.target.businessModel.assetFields[2].unique = true;
  const result = await f.write();
  assert.deepEqual(result.changedUniqueFields, { item_group: ["tag"], asset: [] });
  assert.deepEqual(f.events.filter(row => row.deleted).map(row => row.deleted), [[{ entityType: "item_group", fieldCode: { in: ["tag"] } }]]);
  assert.deepEqual(f.claims().filter(row => row.fieldCode !== "tag"), before);
  assert.equal(f.claims().filter(row => row.fieldCode === "tag").length, 2);
});

test("swapping values rebuilds the affected field as one set and leaves unrelated constraints intact", async () => {
  const f = fixture(), proof = structuredClone(f.claims().filter(row => row.fieldCode === "proof"));
  const result = await f.write([patch(f.groups[0], { reference: "R2" }), patch(f.groups[1], { reference: "R1" })]);
  assert.deepEqual(result.changedUniqueFields, { item_group: ["reference"], asset: [] });
  assert.deepEqual(f.claims().filter(row => row.fieldCode === "proof"), proof);
  assert.deepEqual(f.claims().filter(row => row.fieldCode === "reference").map(row => [row.entityId, row.normalizedValue]), [["g1", "R2"], ["g2", "R1"]]);
  const deletion = f.events.findIndex(row => row.deleted);
  assert.ok(f.events.findIndex(row => row.created) > deletion);
});

test("retiring uniqueness releases only its field and retains the stored attributes", async () => {
  const f = fixture(), references = structuredClone(f.claims().filter(row => row.fieldCode === "reference")), attributes = structuredClone(f.groups.map(row => row.attributes));
  f.target.businessModel.assetFields[0].unique = false;
  const result = await f.write();
  assert.deepEqual(result.changedUniqueFields, { item_group: ["proof"], asset: [] });
  assert.deepEqual(f.claims(), references);
  assert.deepEqual(f.groups.map(row => row.attributes), attributes);
  assert.equal(f.events.some(row => row.update || row.created), false);
});

test("new normalized collisions reject before entity writes or claim removal", async () => {
  const f = fixture(), before = structuredClone(f.claims());
  f.target.businessModel.assetFields[2].unique = true;
  f.groups[0].attributes.tag = " A "; f.groups[1].attributes.tag = "Ａ";
  await assert.rejects(f.write(), /重复|已存在/);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.claims(), before);
});
