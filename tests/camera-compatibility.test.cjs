const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  evaluateCameraCompatibility,
  buildCameraCompatibilityHookModule,
  CAMERA_COMPATIBILITY_RULESET_VERSION
} = require("../apps/api/src/modules/rental-core/capabilities/camera-compatibility");
const { RENTAL_CAPABILITY_MODULES, RENTAL_CATEGORY_DEFINITIONS } = require("@store-rental/shared");

/**
 * CAM-01A：摄影器材兼容性规则集与 Hook 判定。
 *
 * 只覆盖兼容性：卡口、画幅覆盖、供电。附件清点、使用量、检查与养护属 CAM-01，本轮不做。
 */

const line = (name, attributes, quantity = 1) => ({
  itemGroupId: `g_${name}`,
  itemGroupName: name,
  inventoryMode: "serialized",
  quantity,
  attributes
});

const body = (mount, format, powerDrawW) => line(`机身-${mount}`, { role: "body", mount, sensorFormat: format, powerDrawW });
const lens = (mount, covers, adapterMounts) => line(`镜头-${mount}`, { role: "lens", mount, coversFormat: covers, ...(adapterMounts ? { adapterMounts } : {}) });
const power = (watts) => line(`电源-${watts}W`, { role: "power", powerSupplyW: watts });

const hooks = buildCameraCompatibilityHookModule().hooks;
const runPoint = (point, equipment, exceptions = [], config = {}) =>
  hooks[point]({
    point,
    tenantId: "t", workspaceId: "w", categoryCode: "camera", at: "2026-08-28T00:00:00.000Z",
    subject: { equipment, capabilityExceptions: exceptions },
    capability: { code: "camera_compatibility", implementationVersion: CAMERA_COMPATIBILITY_RULESET_VERSION, configVersion: "v1", config }
  });

void (async () => {

// ============ 1. 注册表口径：仅摄影品类适用，且是已实现的可选增强 ============
const definition = RENTAL_CAPABILITY_MODULES.find((row) => row.code === "camera_compatibility");
assert.ok(definition, "camera_compatibility 必须已登记在能力注册表里");
assert.deepEqual(definition.applicableCategories, ["camera"], "只对摄影品类适用——露营/车辆/工程既不声明也无法启用");
assert.equal(definition.implementationVersion, CAMERA_COMPATIBILITY_RULESET_VERSION, "实现版本必须与规则集版本一致");
assert.equal(definition.kind, "category_optional", "兼容性是可选增强，不是品类必选（缺它不影响通用流程）");
// 其他三个品类的 defaultCapabilities 不得声明它。
for (const code of ["camping", "vehicle", "construction"]) {
  const category = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === code);
  assert.ok(
    !category.defaultCapabilities.includes("camera_compatibility"),
    `${code} 品类不得声明摄影兼容性能力`
  );
}
console.log("  ✓ 注册表：仅摄影适用、实现版本与规则集一致、其余三品类未声明");

// ============ 2. 兼容组合放行 ============
{
  const rig = [body("RF", "full_frame", 30), lens("RF", "full_frame"), power(100)];
  assert.deepEqual(evaluateCameraCompatibility(rig), [], "同卡口、像场够、供电充裕：无任何发现");
  assert.equal(runPoint("quote_validation", rig).decision, "allow");
  assert.equal(runPoint("order_confirmation", rig).decision, "allow");
  assert.equal(runPoint("allocation_dispatch", rig).decision, "allow");
  console.log("  ✓ 兼容组合：三个节点一致放行");
}

// ============ 3. 卡口不同但可转接：风险组合需确认 ============
{
  const rig = [body("Z", "full_frame", 20), lens("F", "full_frame"), power(100)];
  const findings = evaluateCameraCompatibility(rig);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].decision, "warn");
  assert.equal(findings[0].code, "mount_needs_adapter");

  // 报价阶段：只提示，报价照出。
  const quoted = runPoint("quote_validation", rig);
  assert.equal(quoted.decision, "warn", "报价阶段风险只提示，不阻止出价");
  assert.equal(quoted.notices[0].code, "mount_needs_adapter");

  // 下单阶段未确认：必须阻止——这是「风险组合需确认才能下单」的落点。
  const unconfirmed = runPoint("order_confirmation", rig);
  assert.equal(unconfirmed.decision, "block", "下单阶段未确认的风险组合必须被阻止");
  assert.match(unconfirmed.blockReasons[0].message, /需填写原因并由具备权限者确认/u);

  // 下单阶段已确认（带原因）：放行并记录确认。
  const confirmed = runPoint("order_confirmation", rig, [
    { capability: "camera_compatibility", code: "mount_needs_adapter", reason: "已备 FTZ 转接环并测试合焦" }
  ]);
  assert.equal(confirmed.decision, "warn", "带原因确认后应放行");
  assert.match(confirmed.notices[0].message, /已确认：带风险放行/u);
  assert.equal(confirmed.notices[0].evidence.confirmed, true, "审计证据里必须留下「已确认」");

  // 空原因不算确认：仍然阻止。
  const blankReason = runPoint("order_confirmation", rig, [
    { capability: "camera_compatibility", code: "mount_needs_adapter", reason: "   " }
  ]);
  assert.equal(blankReason.decision, "block", "空白原因不构成确认");

  // 别的能力的确认不能顶替本能力的确认。
  const otherCapability = runPoint("order_confirmation", rig, [
    { capability: "delivery", code: "mount_needs_adapter", reason: "无关确认" }
  ]);
  assert.equal(otherCapability.decision, "block", "其他能力的确认不得顶替本能力的风险确认");

  // 配货阶段：订单已建、风险已裁决，这里只提示不再阻止。
  assert.equal(runPoint("allocation_dispatch", rig).decision, "warn", "配货阶段风险只提示");
  console.log("  ✓ 风险组合：报价提示、下单未确认阻止、带原因确认放行并留痕、空原因与他能力确认无效");
}

// ============ 4. 显式声明可转接：不再判风险 ============
{
  const rig = [body("Z", "full_frame", 20), lens("F", "full_frame", "Z"), power(100)];
  assert.deepEqual(evaluateCameraCompatibility(rig), [], "镜头显式声明可转接到该机身卡口时不应报风险");
  console.log("  ✓ 显式转接声明：不再判为风险");
}

// ============ 5. 明确不兼容：硬卡口冲突、像场覆盖不足、供电不足——一律阻止且不可确认 ============
{
  const hardMount = [body("EF", "full_frame", 20), lens("E", "full_frame"), power(100)];
  const hardFindings = evaluateCameraCompatibility(hardMount);
  assert.equal(hardFindings[0].decision, "block");
  assert.equal(hardFindings[0].code, "mount_incompatible");
  // 三个节点都必须阻止，且**带确认也不能放行**——不兼容不是可以确认的风险。
  for (const point of ["quote_validation", "order_confirmation", "allocation_dispatch"]) {
    assert.equal(runPoint(point, hardMount).decision, "block", `${point} 必须阻止硬卡口冲突`);
    const withException = runPoint(point, hardMount, [
      { capability: "camera_compatibility", code: "mount_incompatible", reason: "我确认要硬上" }
    ]);
    assert.equal(withException.decision, "block", `${point}：不兼容组合即便带确认也必须阻止`);
  }

  // 像场覆盖不足：APS-C 镜头上全画幅机身。
  const smallCircle = [body("RF", "full_frame", 20), lens("RF", "aps_c"), power(100)];
  const circleFindings = evaluateCameraCompatibility(smallCircle);
  assert.equal(circleFindings[0].code, "image_circle_too_small");
  assert.equal(circleFindings[0].decision, "block");
  assert.equal(runPoint("quote_validation", smallCircle).decision, "block", "像场覆盖不足在报价阶段即阻止");

  // 供电不足：峰值 120W 只给 100W。
  const noPower = [body("RF", "full_frame", 120), lens("RF", "full_frame"), power(100)];
  const powerFindings = evaluateCameraCompatibility(noPower);
  assert.equal(powerFindings[0].code, "power_insufficient");
  assert.equal(powerFindings[0].decision, "block");
  console.log("  ✓ 不兼容组合：硬卡口冲突/像场不足/供电不足三节点全阻止，且带确认也不放行");
}

// ============ 6. 供电余量：阈值来自能力配置，且真的影响判定 ============
{
  // 峰值 100W、供电 105W：默认余量下限 15% → 风险。
  const tight = [body("RF", "full_frame", 100), lens("RF", "full_frame"), power(105)];
  const defaultFindings = evaluateCameraCompatibility(tight);
  assert.equal(defaultFindings.length, 1);
  assert.equal(defaultFindings[0].code, "power_margin_low");
  assert.equal(defaultFindings[0].decision, "warn");
  assert.equal(defaultFindings[0].evidence.marginPercent, 15, "默认余量下限应为 15%");

  // 把阈值调到 2%：105W/100W 的 5% 余量已达标 → 不再报风险。配置必须真的影响判定。
  assert.deepEqual(
    evaluateCameraCompatibility(tight, { powerMarginPercent: 2 }),
    [],
    "调低余量阈值后同一组合不应再报风险（证明配置真的参与计算）"
  );
  // 调到 50%：仍不达标 → 风险，且证据里的阈值随配置变化。
  const strict = evaluateCameraCompatibility(tight, { powerMarginPercent: 50 });
  assert.equal(strict[0].code, "power_margin_low");
  assert.equal(strict[0].evidence.marginPercent, 50);
  console.log("  ✓ 供电余量：默认 15%，配置调整真的改变判定与证据");
}

// ============ 7. 缺属性不得误判 ============
{
  // 没有 role/mount/画幅/供电属性的器材（如露营装备）不产生任何摄影兼容性发现——
  // 这是「其他品类无回退」的模块侧保证：即便被错误地拿来判定，也不会凭空阻止。
  const campingLike = [line("帐篷", { brand: "X", people: 4 }, 2), line("桌椅", { brand: "Y" })];
  assert.deepEqual(evaluateCameraCompatibility(campingLike), [], "无摄影属性的器材不得产生兼容性发现");
  assert.equal(runPoint("order_confirmation", campingLike).decision, "allow");
  // 只有机身没有电源：不判供电（没有供电项就无从比较），避免把「未登记电源」误判成供电不足。
  assert.deepEqual(evaluateCameraCompatibility([body("RF", "full_frame", 50), lens("RF", "full_frame")]), []);
  console.log("  ✓ 缺属性不误判：无摄影属性或未登记电源时不产生发现");
}

console.log("\nCAM-01A 摄影器材兼容性用例全部通过");
})();
