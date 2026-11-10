"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { validateConditionalCapabilities, captureCapabilityRequirements, resolveCapabilityRequirements, capabilityRequirementRoots } = require("../apps/api/dist/modules/rental-core/category-capability-conditions.js");
const { validateQuotedCapabilityRequirements } = require("../apps/api/dist/modules/rental-core/category-capability-facts.js");
const { parsePublishedRentalCategory } = require("../apps/api/dist/modules/rental-core/rental-category-resolver.service.js");
const { patchCategorySection } = require("../apps/api/dist/modules/rental-core/category-governance.service.js");
const { categoryDefinitionDifferences } = require("../apps/api/dist/modules/rental-core/category-definition-diff.js");
const { snapshotInspectionTemplate } = require("../apps/api/dist/modules/rental-core/rental-inspection-template-snapshot.js");

function definition(when = { inventoryModes: ["serialized"], itemAttribute: { code: "role", values: ["body"] } }) {
  const row = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === "camera"));
  row.conditionalCapabilities = [{ code: "camera_compatibility", when }];
  return row;
}
const group = (id, inventoryMode, attributes = {}, bundleComponents = []) => ({ id, inventoryMode, attributes, bundleComponents });
const pickup = "store_pickup_return";

test("conditions come from product facts and distinguish false, missing and unrelated classifiers", () => {
  const policy = definition();
  const body = group("body", "serialized", { role: "body", unrelated: "never projected" });
  const tripod = group("tripod", "serialized", { role: "accessory" });
  const quantity = group("quantity", "quantity");
  const snapshot = captureCapabilityRequirements(policy, [body, tripod, quantity], ["body", "tripod", "quantity"], pickup);
  assert.deepEqual(snapshot.matches, [{ code: "camera_compatibility", itemGroupIds: ["body"] }]);
  assert.equal("unrelated" in snapshot.items[0].attributes, false);
  assert.deepEqual(resolveCapabilityRequirements(policy, snapshot), { required: ["camera_compatibility"], inactive: [] });
  const unaffected = captureCapabilityRequirements(policy, [tripod, quantity], ["tripod", "quantity"], pickup);
  assert.deepEqual(resolveCapabilityRequirements(policy, unaffected), { required: [], inactive: ["camera_compatibility"] });
  for (const attributes of [{}, { role: "unknown-role" }, { role: 0 }]) {
    assert.throws(() => captureCapabilityRequirements(policy, [group("unclassified", "serialized", attributes)], ["unclassified"], pickup), /不能当作未触发/);
  }
});

test("fulfillment and boolean predicates use controlled conjunctions without losing false values", () => {
  const policy = definition({ inventoryModes: ["serialized"], fulfillmentModes: ["delivery"], itemAttribute: { code: "needsAdapter", values: [false] } });
  policy.businessModel.assetFields.push({ code: "needsAdapter", label: "需要转接", type: "boolean", scope: "item_group" });
  const items = [group("one", "serialized", { needsAdapter: false })];
  const selected = captureCapabilityRequirements(policy, items, ["one"], "delivery");
  assert.equal(selected.items[0].attributes.needsAdapter, false);
  assert.deepEqual(resolveCapabilityRequirements(policy, selected).required, ["camera_compatibility"]);
  const outside = captureCapabilityRequirements(policy, [group("one", "serialized")], ["one"], pickup);
  assert.deepEqual(resolveCapabilityRequirements(policy, outside).inactive, ["camera_compatibility"]);
});

test("bundle requirements include required components and exclude unselected substitution options", () => {
  const policy = definition();
  const groups = [group("kit", "bundle", {}, [
    { itemGroupId: "body", quantity: 1 }, { itemGroupId: "optional", quantity: 1, optional: true, substitutionGroup: "spare" }
  ]), group("body", "serialized", { role: "body" }), group("optional", "serialized")];
  const snapshot = captureCapabilityRequirements(policy, groups, ["kit"], pickup);
  assert.deepEqual(snapshot.items.map(row => row.itemGroupId), ["body", "kit"]);
  assert.deepEqual(snapshot.matches[0].itemGroupIds, ["body"]);
  assert.throws(() => captureCapabilityRequirements(policy, [groups[0]], ["kit"], pickup), /实际商品资料不完整/);
  assert.throws(() => captureCapabilityRequirements(policy, [group("cycle", "bundle", {}, [{ itemGroupId: "cycle", quantity: 1 }])], ["cycle"], pickup), /循环/);
});

test("historical evidence survives catalog changes and only narrows through Core-confirmed active roots", () => {
  const policy = definition();
  const groups = [group("body", "serialized", { role: "body" }), group("tripod", "serialized", { role: "accessory" })];
  const snapshot = captureCapabilityRequirements(policy, groups, ["body", "tripod"], pickup);
  const saved = structuredClone(snapshot);
  groups[0].attributes.role = "accessory";
  assert.deepEqual(resolveCapabilityRequirements(policy, snapshot).required, ["camera_compatibility"]);
  assert.deepEqual(resolveCapabilityRequirements(policy, snapshot, ["tripod"]), { required: [], inactive: ["camera_compatibility"] });
  assert.throws(() => resolveCapabilityRequirements(policy, snapshot, ["replacement"]), /自己的条件依据/);
  assert.deepEqual(snapshot, saved);
  // MySQL JSON may reorder object keys; that cannot invalidate an otherwise identical policy.
  const reordered = structuredClone(policy);
  reordered.conditionalCapabilities = [{ when: { itemAttribute: { values: ["body"], code: "role" }, inventoryModes: ["serialized"] }, code: "camera_compatibility" }];
  assert.deepEqual(resolveCapabilityRequirements(reordered, snapshot).required, ["camera_compatibility"]);
  reordered.version = "changed";
  assert.throws(() => resolveCapabilityRequirements(reordered, snapshot), /引用版本不一致/);
});

test("forged result flags, missing evidence and invalid predicate grammar fail closed", () => {
  const policy = definition();
  const snapshot = captureCapabilityRequirements(policy, [group("body", "serialized", { role: "body" })], ["body"], pickup);
  const forged = structuredClone(snapshot); forged.matches[0].itemGroupIds = [];
  assert.throws(() => resolveCapabilityRequirements(policy, forged), /原商品依据不一致/);
  assert.throws(() => resolveCapabilityRequirements(policy, undefined), /快照缺失/);
  for (const when of [{}, { script: "return true" }, { inventoryModes: [] }, { fulfillmentModes: ["invented"] },
    { itemAttribute: { code: "model", values: ["arbitrary text"] } }, { itemAttribute: { code: "role", values: ["invented"] } }]) {
    assert.throws(() => validateConditionalCapabilities(definition(when)), /品类条件不可执行/);
  }
  const core = definition(); core.conditionalCapabilities[0].code = "serialized_inventory";
  assert.throws(() => validateConditionalCapabilities(core), /基础能力/);
  const duplicated = definition(); duplicated.requiredCapabilities = ["camera_compatibility"];
  assert.throws(() => validateConditionalCapabilities(duplicated), /空间必需/);
});

test("published decoding, section saves and differences share the conditional policy grammar", () => {
  const policy = definition();
  policy.businessModel.defaults.inspectionFields.push({ code: "body_checked", label: "机身检查", type: "boolean", required: true, appliesToCapability: "camera_compatibility" });
  assert.deepEqual(parsePublishedRentalCategory(policy, policy.code), policy);
  const base = structuredClone(policy); delete base.conditionalCapabilities;
  const patched = patchCategorySection(base, "capabilities", { conditionalCapabilities: policy.conditionalCapabilities });
  assert.deepEqual(patched, policy);
  assert.throws(() => patchCategorySection(base, "basic", { conditionalCapabilities: policy.conditionalCapabilities }), /其他页签/);
  assert.ok(categoryDefinitionDifferences(base, patched).some(row => row.section === "capabilities" && row.path === "conditionalCapabilities"));
  const invalid = structuredClone(policy); invalid.conditionalCapabilities[0].when.script = "return true";
  assert.throws(() => parsePublishedRentalCategory(invalid, policy.code), /只支持/);
  invalid.conditionalCapabilities = policy.conditionalCapabilities;
  invalid.businessModel.defaults.inspectionFields.at(-1).appliesToCapability = "unknown";
  assert.throws(() => parsePublishedRentalCategory(invalid, policy.code), /检查字段不合法/);
});

test("conditional inspection fields follow frozen active goods, including a later partial return", () => {
  const policy = definition();
  policy.businessModel.defaults.inspectionFields = [{ code: "body_checked", label: "机身检查", type: "boolean", required: true, appliesToCapability: "camera_compatibility" }];
  const items = [group("body", "serialized", { role: "body" }), group("tripod", "serialized", { role: "accessory" })];
  const snapshot = captureCapabilityRequirements(policy, items, ["body", "tripod"], pickup);
  const template = { id: "inspection", code: "CUSTOM_RETURN", stage: "return", fields: structuredClone(policy.businessModel.defaults.inspectionFields), enabled: true };
  assert.equal(snapshotInspectionTemplate(policy, template, snapshot).fields[0].required, true);
  assert.deepEqual(snapshotInspectionTemplate(policy, template, snapshot, ["tripod"]).fields, []);
  assert.equal(template.fields.length, 1, "projections cannot mutate the frozen inspection template");
  assert.throws(() => snapshotInspectionTemplate(policy, template, snapshot, ["replacement"]), /自己的条件依据/);
});

test("pricing-group reservations freeze all eligible models and reject an unresolved member scope", () => {
  const line = { pricingGroupId: "prices", itemGroupId: "representative", reservationPrecision: "group", pricingGroupMemberItemGroupIds: ["tripod", "body"] };
  assert.deepEqual(capabilityRequirementRoots([line]), ["body", "tripod"]);
  assert.deepEqual(capabilityRequirementRoots([{ ...line, reservationPrecision: "exact_model" }]), ["representative"]);
  assert.throws(() => capabilityRequirementRoots([{ ...line, pricingGroupMemberItemGroupIds: undefined }]), /服务端固化/);
});

function quotedFacts() {
  const policy = definition();
  const rows = [group("body", "serialized", { role: "body" })];
  const enabled = [{ code: "camera_compatibility", implementationVersion: "cam-1.0", configVersion: "1", config: {}, status: "enabled" }];
  const quote = { tenantId: "tenant", categoryCode: policy.code, categoryVersionId: "original-v1", request: { lines: [{ itemGroupId: "body" }], fulfillmentMode: pickup },
    capabilityRequirementsSnapshot: captureCapabilityRequirements(policy, rows, ["body"], pickup), capabilitySnapshot: structuredClone(enabled) };
  const reads = [];
  const tx = {
    rentalCategoryVersion: { findUnique: async ({ where }) => { assert.equal(where.id, "original-v1"); reads.push("original-policy"); return { categoryCode: policy.code, status: "published", structureVersion: 1, definition: policy }; } },
    rentalItemGroup: { findMany: async ({ where }) => {
      assert.equal(where.tenantId, "tenant"); assert.equal(where.workspaceId, "space"); reads.push("locked-catalog");
      return rows.filter(row => where.id.in.includes(row.id)).map(row => ({ ...structuredClone(row), inventoryMode: row.inventoryMode.toUpperCase(),
        bundleComponents: row.bundleComponents.map(component => ({ componentItemGroupId: component.itemGroupId, optional: component.optional === true })) }));
    } },
    workspaceCapabilityInstance: { findMany: async ({ where }) => {
      assert.equal(where.tenantId, "tenant"); assert.equal(where.workspaceId, "space"); assert.equal(where.status, "enabled"); reads.push("locked-instances");
      return enabled.filter(row => row.status === "enabled" && where.code.in.includes(row.code));
    } }
  };
  return { quote, policy, rows, enabled, tx, reads };
}

test("quote commit rechecks catalog, original policy and enabled instance evidence in the supplied transaction", async () => {
  const fixture = quotedFacts();
  await validateQuotedCapabilityRequirements(fixture.tx, "space", fixture.quote);
  assert.deepEqual(fixture.reads, ["original-policy", "locked-catalog", "locked-instances"]);
  for (const mutate of [row => { row.rows[0].attributes.role = "accessory"; }, row => { row.rows[0].attributes = {}; },
    row => { row.rows.length = 0; }, row => { row.enabled[0].status = "paused"; }, row => { row.enabled[0].configVersion = "2"; },
    row => { row.enabled[0].implementationVersion = "new-implementation"; }, row => { row.enabled[0].config = { changed: true }; },
    row => { delete row.quote.capabilityRequirementsSnapshot; }, row => { row.quote.capabilityRequirementsSnapshot.matches[0].itemGroupIds = []; }]) {
    const changed = quotedFacts(); mutate(changed);
    await assert.rejects(validateQuotedCapabilityRequirements(changed.tx, "space", changed.quote));
  }
  const unrelated = quotedFacts(); unrelated.rows[0].attributes.role = "accessory"; unrelated.enabled.length = 0;
  unrelated.quote.capabilitySnapshot = [];
  unrelated.quote.capabilityRequirementsSnapshot = captureCapabilityRequirements(unrelated.policy, unrelated.rows, ["body"], pickup);
  await validateQuotedCapabilityRequirements(unrelated.tx, "space", unrelated.quote);
  assert.equal(unrelated.reads.includes("locked-instances"), false);
});

test("required kit membership changes invalidate quote evidence while unselected options stay outside it", async () => {
  const fixture = quotedFacts();
  fixture.rows.push(group("kit", "bundle", {}, [{ itemGroupId: "body" }, { itemGroupId: "optional", optional: true }]));
  fixture.quote.request.lines = [{ itemGroupId: "kit" }];
  fixture.quote.capabilityRequirementsSnapshot = captureCapabilityRequirements(fixture.policy, fixture.rows, ["kit"], pickup);
  await validateQuotedCapabilityRequirements(fixture.tx, "space", fixture.quote);
  fixture.rows[1].bundleComponents.pop();
  await validateQuotedCapabilityRequirements(fixture.tx, "space", fixture.quote);
  fixture.rows[1].bundleComponents.length = 0;
  await assert.rejects(validateQuotedCapabilityRequirements(fixture.tx, "space", fixture.quote), /套装组成/);
});
