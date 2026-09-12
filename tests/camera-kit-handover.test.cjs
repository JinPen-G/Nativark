const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  buildCameraKitHandoverHookModule,
  CAMERA_KIT_HANDOVER_RULESET_VERSION,
  CAMERA_KIT_HANDOVER_LEGACY_VERSION
} = require("../apps/api/src/modules/rental-core/capabilities/camera-kit-handover");
const { RENTAL_CAPABILITY_MODULES, RENTAL_CATEGORY_DEFINITIONS } = require("@store-rental/shared");

const definition = RENTAL_CAPABILITY_MODULES.find((row) => row.code === "camera_kit_handover");
assert.ok(definition, "摄影套装交接能力必须登记");
assert.equal(definition.implementationVersion, CAMERA_KIT_HANDOVER_RULESET_VERSION);
assert.equal(definition.kind, "category_required");
assert.deepEqual(definition.applicableCategories, ["camera"]);
assert.ok(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera").requiredCapabilities.includes("camera_kit_handover"));
assert.ok(!RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "vehicle").defaultCapabilities.includes("camera_kit_handover"));

const context = (point, { bundle = true, kitComplete, exceptions = [] } = {}) => ({
  point,
  tenantId: "tenant-test",
  workspaceId: "workspace-test",
  categoryCode: "camera",
  subject: {
    order: { lines: bundle ? [{ inventoryMode: "bundle", itemGroupName: "标准拍摄套装", quantity: 1 }] : [{ inventoryMode: "serialized", itemGroupName: "机身", quantity: 1 }] },
    results: kitComplete === undefined ? {} : { kit_complete: kitComplete },
    exceptions
  },
  capability: { code: "camera_kit_handover", implementationVersion: CAMERA_KIT_HANDOVER_RULESET_VERSION, configVersion: "v1", config: {} }
});

const current = buildCameraKitHandoverHookModule();
assert.equal(current.hooks.pickup_delivery(context("pickup_delivery", { bundle: false, kitComplete: false })).decision, "allow", "非套装订单不应被套装清点阻断");
assert.equal(current.hooks.pickup_delivery(context("pickup_delivery")).decision, "allow", "旧模板未提供清点结果时保持兼容");
assert.equal(current.hooks.pickup_delivery(context("pickup_delivery", { kitComplete: true })).decision, "allow");

const pickupIncomplete = current.hooks.pickup_delivery(context("pickup_delivery", { kitComplete: false }));
assert.equal(pickupIncomplete.decision, "block");
assert.equal(pickupIncomplete.blockReasons[0].code, "camera_kit_incomplete");

const returnWithoutException = current.hooks.return_inspection(context("return_inspection", { kitComplete: false }));
assert.equal(returnWithoutException.decision, "block");
assert.equal(returnWithoutException.blockReasons[0].code, "camera_kit_missing_exception");

const returnWithException = current.hooks.return_inspection(context("return_inspection", {
  kitComplete: false,
  exceptions: [{ code: "missing_accessory", description: "缺少电池" }]
}));
assert.equal(returnWithException.decision, "warn");
assert.equal(returnWithException.notices[0].code, "camera_kit_incomplete_recorded");

const invalid = current.hooks.return_inspection(context("return_inspection", { kitComplete: "unknown" }));
assert.equal(invalid.decision, "block");
assert.equal(invalid.blockReasons[0].code, "camera_kit_check_invalid");

const legacy = buildCameraKitHandoverHookModule(CAMERA_KIT_HANDOVER_LEGACY_VERSION);
assert.equal(legacy.implementationVersion, CAMERA_KIT_HANDOVER_LEGACY_VERSION);
assert.equal(legacy.hooks.pickup_delivery(context("pickup_delivery", { kitComplete: false })).decision, "block", "旧快照也必须保留相同的清点语义");

console.log("CAM-01B 摄影套装交接与附件清点专项通过：注册表、旧快照兼容、取件阻断、归还异常与非套装放行均已覆盖");
