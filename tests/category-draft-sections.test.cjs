"use strict";
// Local draft workflow boundary; these checks do not prove browser or Core acceptance.
const assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript"), { test } = require("node:test");
const shared = require("@rental-os/shared");
const source = fs.readFileSync("apps/admin/src/features/platform/categoryDraftSections.ts", "utf8"), exportsObject = {};
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function("exports", "require", javascript)(exportsObject, name => name === "@rental-os/shared" ? shared : require(name));
const { initialCategorySectionDrafts, reconcileCategorySectionDrafts, resetCategoryDraftSection, categoryDefinitionWithLocalSections,
  categorySectionHasInput, categoryInspectionFieldSuggestion, sameCategoryDraftValue } = exportsObject;
const version = (revision = 1) => ({ id: "draft-one", categoryCode: "camera", versionLabel: "next", structureVersion: 1, status: "draft", revision,
  definition: structuredClone(shared.RENTAL_CATEGORY_DEFINITIONS.find(value => value.code === "camera")) });
test("saving one section retains other unsaved values, zero/false, reasons and pending new-field input", () => {
  const previous = version(), drafts = initialCategorySectionDrafts(previous);
  drafts.pricing.values.supportsUsagePricing = false; drafts.pricing.values.overdue.graceMinutes = 0;
  drafts.pricing.dirty = true; drafts.pricing.reason = "keep this price reason";
  drafts.attributes.pendingField = true;
  drafts.basic.values.name = "Changed title"; drafts.basic.dirty = true; drafts.basic.reason = "title reason";
  const next = version(2); next.definition.name = "Changed title";
  const reconciled = reconcileCategorySectionDrafts(drafts, next, { section: "basic", values: structuredClone(drafts.basic.values), reason: drafts.basic.reason });
  assert.equal(categorySectionHasInput(reconciled.basic), false);
  assert.equal(reconciled.pricing.values.supportsUsagePricing, false); assert.equal(reconciled.pricing.values.overdue.graceMinutes, 0);
  assert.equal(reconciled.pricing.reason, "keep this price reason"); assert.equal(reconciled.pricing.baseRevision, 2);
  assert.equal(reconciled.attributes.pendingField, true); assert.equal(reconciled.attributes.baseRevision, 2);
  assert.equal(drafts.basic.reason, "title reason", "the previous client state must remain unchanged");
});
test("a newer saved value marks only the affected dirty section conflicted without erasing its original input", () => {
  const drafts = initialCategorySectionDrafts(version()); drafts.basic.values.name = "local title";
  drafts.basic.dirty = true; drafts.basic.reason = "local reason";
  const next = version(2); next.definition.name = "another editor title"; next.definition.businessModel.supportsHolidayPricing = false;
  const reconciled = reconcileCategorySectionDrafts(drafts, next);
  assert.equal(reconciled.basic.conflict, true); assert.equal(reconciled.basic.baseRevision, 1);
  assert.equal(reconciled.basic.values.name, "local title"); assert.equal(reconciled.basic.reason, "local reason");
  assert.equal(reconciled.pricing.values.supportsHolidayPricing, false); assert.equal(reconciled.pricing.baseRevision, 2);
});
test("a late save response cannot clear input which changed after the submitted snapshot", () => {
  const drafts = initialCategorySectionDrafts(version()); drafts.basic.values.name = "submitted title"; drafts.basic.dirty = true;
  const submitted = { section: "basic", values: structuredClone(drafts.basic.values), reason: "submitted reason" };
  drafts.basic.values.name = "new local title"; drafts.basic.reason = "new local reason";
  const next = version(2); next.definition.name = "submitted title";
  const reconciled = reconcileCategorySectionDrafts(drafts, next, submitted);
  assert.equal(reconciled.basic.values.name, "new local title"); assert.equal(reconciled.basic.reason, "new local reason");
  assert.equal(reconciled.basic.dirty, true); assert.equal(reconciled.basic.conflict, true);
});
test("cross-section explanation uses local fields and conditions while the saved definition stays detached", () => {
  const saved = version(), drafts = initialCategorySectionDrafts(saved);
  drafts.attributes.values.assetFields.push({ code: "kind", label: "Kind", scope: "item_group", type: "select", options: ["kit", "single"] });
  drafts.capabilities.values.conditionalCapabilities = [{ code: "kit_handover", when: { itemAttribute: { code: "kind", values: ["kit"] } } }];
  const combined = categoryDefinitionWithLocalSections(saved, drafts);
  assert.equal(combined.businessModel.assetFields.at(-1).code, "kind");
  assert.equal(combined.conditionalCapabilities[0].when.itemAttribute.code, "kind");
  assert.ok(!saved.definition.businessModel.assetFields.some(field => field.code === "kind"));
  combined.businessModel.assetFields.at(-1).label = "mutated view";
  assert.equal(drafts.attributes.values.assetFields.at(-1).label, "Kind");
});
test("explicitly refilling a conflicted section discards only that section and resets its mounted field generation", () => {
  const drafts = initialCategorySectionDrafts(version()); drafts.basic.dirty = true; drafts.basic.conflict = true; drafts.basic.reason = "discard explicitly";
  drafts.attributes.pendingField = true; drafts.attributes.reason = "retain another page";
  const next = version(2); next.definition.name = "latest title";
  const reset = resetCategoryDraftSection(drafts, next, "basic");
  assert.equal(reset.basic.values.name, "latest title"); assert.equal(reset.basic.baseRevision, 2);
  assert.equal(reset.basic.generation, 1); assert.equal(categorySectionHasInput(reset.basic), false);
  assert.equal(reset.attributes.pendingField, true); assert.equal(reset.attributes.reason, "retain another page");
});
test("Core field suggestions append missing requirements without replacing existing local inspection input", () => {
  const drafts = initialCategorySectionDrafts(version()); drafts.inspection.values.inspectionFields = [{ code: "custom", label: "Local field", type: "text", required: false }];
  const capability = { code: "kit_handover", composition: { version: 1, subjectScope: "equipment", requiredInspectionFields: [
    { code: "kit_complete", label: "Complete kit", type: "boolean", stages: ["pickup", "return"] }
  ] } };
  const suggestion = categoryInspectionFieldSuggestion(drafts, capability);
  assert.equal(suggestion.supported, true); assert.deepEqual(suggestion.conflicts, []);
  assert.deepEqual(suggestion.next[0], drafts.inspection.values.inspectionFields[0]);
  assert.deepEqual(suggestion.additions[0], { code: "kit_complete", label: "Complete kit", type: "boolean", required: true, appliesToCapability: "kit_handover" });
  assert.equal(drafts.inspection.values.inspectionFields.length, 1, "a proposal cannot silently change another section");
  drafts.inspection.values.inspectionFields.push({ code: "kit_complete", type: "text", required: false });
  assert.deepEqual(categoryInspectionFieldSuggestion(drafts, capability).conflicts, ["kit_complete"]);
  capability.composition.requiredInspectionFields[0].stages = ["return"];
  assert.equal(categoryInspectionFieldSuggestion(drafts, capability).supported, false, "a finer stage contract cannot be invented by the editor");
});
test("object key order alone is not a conflict, while ordered arrays retain their actual meaning", () => {
  assert.equal(sameCategoryDraftValue({ required: false, value: 0 }, { value: 0, required: false }), true);
  assert.equal(sameCategoryDraftValue(["pickup", "return"], ["return", "pickup"]), false);
});
