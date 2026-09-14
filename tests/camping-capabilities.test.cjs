const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  buildCampingKitIntegrityHookModule,
  CAMPING_KIT_INTEGRITY_RULESET_VERSION
} = require("../apps/api/src/modules/rental-core/capabilities/camping-kit-integrity");
const {
  buildCampingCleaningTurnaroundHookModule,
  CAMPING_CLEANING_TURNAROUND_RULESET_VERSION
} = require("../apps/api/src/modules/rental-core/capabilities/camping-cleaning-turnaround");
const { RENTAL_CAPABILITY_MODULES, RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");

const kitDefinition = RENTAL_CAPABILITY_MODULES.find((row) => row.code === "camping_kit_integrity");
const cleaningDefinition = RENTAL_CAPABILITY_MODULES.find((row) => row.code === "camping_cleaning_turnaround");
assert.equal(kitDefinition.implementationVersion, CAMPING_KIT_INTEGRITY_RULESET_VERSION);
assert.equal(cleaningDefinition.implementationVersion, CAMPING_CLEANING_TURNAROUND_RULESET_VERSION);
assert.ok(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camping").requiredCapabilities.includes("camping_kit_integrity"));
assert.ok(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camping").requiredCapabilities.includes("camping_cleaning_turnaround"));
assert.ok(!RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera").defaultCapabilities.includes("camping_kit_integrity"));

const kitContext = (point, { bundle = true, countOk, exceptions = [], inspectionSkipped = false } = {}) => ({
  point,
  tenantId: "tenant-test",
  workspaceId: "workspace-test",
  categoryCode: "camping",
  subject: {
    order: { lines: bundle ? [{ inventoryMode: "bundle", itemGroupName: "四人帐篷套装", quantity: 1 }] : [{ inventoryMode: "quantity", itemGroupName: "折叠椅", quantity: 2 }] },
    results: countOk === undefined ? {} : { count_ok: countOk },
    exceptions,
    inspectionSkipped
  },
  capability: { code: "camping_kit_integrity", implementationVersion: CAMPING_KIT_INTEGRITY_RULESET_VERSION, configVersion: "v1", config: {} }
});

const kit = buildCampingKitIntegrityHookModule();
assert.equal(kit.hooks.pickup_delivery(kitContext("pickup_delivery", { bundle: false, countOk: false })).decision, "allow", "非套装露营订单不应被套装能力阻断");
assert.equal(kit.hooks.pickup_delivery(kitContext("pickup_delivery", { countOk: true })).decision, "allow");
assert.equal(kit.hooks.pickup_delivery(kitContext("pickup_delivery", { countOk: false })).blockReasons[0].code, "camping_kit_incomplete");
assert.equal(kit.hooks.return_inspection(kitContext("return_inspection", { countOk: false })).blockReasons[0].code, "camping_kit_missing_exception");
assert.equal(kit.hooks.return_inspection(kitContext("return_inspection", { countOk: false, exceptions: [{ code: "camping_missing_item", description: "缺少地钉" }] })).decision, "warn");
assert.equal(kit.hooks.return_inspection(kitContext("return_inspection", { inspectionSkipped: true })).blockReasons[0].code, "camping_kit_inspection_required");

const cleanContext = (cleanliness, exceptions = [], inspectionSkipped = false) => ({
  point: "return_inspection",
  tenantId: "tenant-test",
  workspaceId: "workspace-test",
  categoryCode: "camping",
  subject: { results: cleanliness === undefined ? {} : { cleanliness }, exceptions, inspectionSkipped },
  capability: { code: "camping_cleaning_turnaround", implementationVersion: CAMPING_CLEANING_TURNAROUND_RULESET_VERSION, configVersion: "v1", config: {} }
});

const cleaning = buildCampingCleaningTurnaroundHookModule();
assert.equal(cleaning.hooks.return_inspection(cleanContext("良好")).decision, "allow");
assert.equal(cleaning.hooks.return_inspection(cleanContext("需清洁")).blockReasons[0].code, "camping_cleaning_exception_required");
const cleaningNotice = cleaning.hooks.return_inspection(cleanContext("需清洁", [{ code: "camping_cleaning_required", description: "需要清洁" }]));
assert.equal(cleaningNotice.decision, "warn");
assert.equal(cleaningNotice.notices[0].code, "camping_cleaning_required");
assert.equal(cleaning.hooks.return_inspection(cleanContext("严重污损", [{ code: "camping_deep_cleaning_required", description: "深度清洁" }])).notices[0].code, "camping_deep_cleaning_required");
assert.equal(cleaning.hooks.return_inspection(cleanContext(undefined, [], true)).decision, "block");

console.log("CAMP-01A 露营套装完整性与清洁周转专项通过：注册表、非套装放行、清点阻断、缺件异常、清洁异常和免检阻断均已覆盖");
