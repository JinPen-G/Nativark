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
const { RENTAL_CAPABILITY_MODULES, RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");

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
const lens = (mount, covers) => line(`镜头-${mount}`, { role: "lens", mount, coversFormat: covers });
const power = (watts) => line(`电源-${watts}W`, { role: "power", powerSupplyW: watts });
const relation = (relationType, source, target, outcome = "allow", id = `${relationType}-${source.itemGroupId}-${target.itemGroupId}`) => ({
  id,
  relationType,
  source: { kind: "item_group", id: source.itemGroupId },
  target: { kind: "item_group", id: target.itemGroupId },
  outcome,
  sourceName: "单测规格数据",
  reason: `${source.itemGroupName} 与 ${target.itemGroupName} 的已确认关系`
});
const relationConfig = (...relations) => ({ relations });

const hooks = buildCameraCompatibilityHookModule().hooks;
const runPoint = (point, equipment, exceptions = [], config = {}) =>
  hooks[point]({
    point,
    tenantId: "t", workspaceId: "w", categoryCode: "camera", at: "2026-08-28T00:00:00.000Z",
    subject: { equipment, capabilityExceptions: exceptions },
    capability: { code: "camera_compatibility", implementationVersion: CAMERA_COMPATIBILITY_RULESET_VERSION, configVersion: "v1", config }
  });

void (async () => {

// ============ 1. 注册表口径：仅摄影品类适用，且是首期必选能力 ============
const definition = RENTAL_CAPABILITY_MODULES.find((row) => row.code === "camera_compatibility");
assert.ok(definition, "camera_compatibility 必须已登记在能力注册表里");
assert.deepEqual(definition.applicableCategories, ["camera"], "只对摄影品类适用——露营/车辆/工程既不声明也无法启用");
assert.equal(definition.implementationVersion, CAMERA_COMPATIBILITY_RULESET_VERSION, "实现版本必须与规则集版本一致");
assert.equal(definition.kind, "category_required", "兼容性是摄影首期必选能力，缺失时空间不得正式经营");
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
  const bodyZ = body("Z", "full_frame", 20);
  const lensF = lens("F", "full_frame");
  const rig = [bodyZ, lensF, power(100)];
  assert.deepEqual(evaluateCameraCompatibility(rig, relationConfig(relation("mount_adapter", lensF, bodyZ))), [], "结构化关系声明可转接时不应报风险");
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

// ============ 8. 卡口方向性（Review P1-9） ============
{
  // 硬冲突**有方向**：单反机身（长法兰距）+ 无反镜头（短法兰距）无法合焦 → 阻止。
  for (const [bodyMount, lensMount] of [["EF", "E"], ["EF", "Z"], ["EF", "RF"], ["F", "E"], ["F", "Z"], ["F", "RF"]]) {
    const findings = evaluateCameraCompatibility([body(bodyMount, "full_frame", 20), lens(lensMount, "full_frame"), power(100)]);
    const mount = findings.find((row) => row.code.startsWith("mount_"));
    assert.equal(mount?.decision, "block", `${bodyMount} 机身 + ${lensMount} 镜头必须阻止`);
    assert.equal(mount?.code, "mount_incompatible");
  }
  // **反向**组合可以转接：无反机身 + 单反镜头 → 风险（需转接环），不是阻止。
  // 早前同时匹配反向组合，把这些本可转接的组合判死了。
  for (const [bodyMount, lensMount] of [["E", "EF"], ["Z", "EF"], ["RF", "EF"], ["Z", "F"], ["RF", "F"]]) {
    const findings = evaluateCameraCompatibility([body(bodyMount, "full_frame", 20), lens(lensMount, "full_frame"), power(100)]);
    const mount = findings.find((row) => row.code.startsWith("mount_"));
    assert.equal(mount?.decision, "warn", `${bodyMount} 机身 + ${lensMount} 镜头应判为需转接，而不是硬冲突`);
    assert.equal(mount?.code, "mount_needs_adapter");
  }
  // 在版本化关系数据里登记转接关系后连风险都不报。
  const bodyRf = body("RF", "full_frame", 20);
  const lensEf = lens("EF", "full_frame");
  assert.deepEqual(
    evaluateCameraCompatibility([bodyRf, lensEf, power(100)], relationConfig(relation("mount_adapter", lensEf, bodyRf))),
    [],
    "镜头显式声明可转接到该机身卡口时不报风险"
  );
  // 关系未登记的异卡口组合：不能因为"没说不行"就当成能用 → fail-closed。
  const unknown = evaluateCameraCompatibility([body("QQ", "full_frame", 20), lens("ZZ", "full_frame"), power(100)]);
  assert.equal(unknown[0]?.decision, "block", "未登记的卡口关系必须 fail-closed");
  assert.equal(unknown[0]?.code, "mount_relation_unknown");
  console.log("  ✓ 卡口方向性：单反机身+无反镜头阻止、反向可转接判风险、显式声明放行、未登记关系 fail-closed");
}

// ============ 9. 电池与充电器（Review P1-7） ============
{
  const bodyWithBattery = line("机身-Z6", { role: "body", mount: "Z", sensorFormat: "full_frame", powerDrawW: 20, batteryModel: "EN-EL15c", model: "Z6" });
  const battery = (model) => line(`电池-${model}`, { role: "battery", batteryModel: model });
  const charger = (name) => line(`充电器-${name}`, { role: "charger" });
  const okLens = lens("Z", "full_frame");

  // 正常：型号匹配的电池 + 支持该型号的充电器 → 无发现。
  const correctBattery = battery("EN-EL15c");
  const correctCharger = charger("EN-EL15");
  assert.deepEqual(
    evaluateCameraCompatibility(
      [bodyWithBattery, okLens, correctBattery, correctCharger],
      relationConfig(relation("battery_support", correctCharger, correctBattery))
    ),
    [],
    "电池与充电器均匹配时不应有发现"
  );
  // 警告：完全没带电池 → 缺件风险（承租方可能自备）。
  const noBattery = evaluateCameraCompatibility([bodyWithBattery, okLens]);
  assert.equal(noBattery.find((row) => row.code === "battery_missing")?.decision, "warn");
  // 警告：带了电池但没充电器。
  const noCharger = evaluateCameraCompatibility([bodyWithBattery, okLens, battery("EN-EL15c")]);
  assert.equal(noCharger.find((row) => row.code === "charger_missing")?.decision, "warn");
  // 阻止：电池型号与机身不符（装不上）。
  const wrongBattery = evaluateCameraCompatibility([bodyWithBattery, okLens, battery("LP-E6NH"), charger("LP-E6NH")]);
  assert.equal(wrongBattery.find((row) => row.code === "battery_incompatible")?.decision, "block");
  // 阻止：充电器不支持所带电池型号（充不了等于没带）。
  const wrongCharger = evaluateCameraCompatibility([bodyWithBattery, okLens, battery("EN-EL15c"), charger("LP-E6NH")]);
  assert.equal(wrongCharger.find((row) => row.code === "charger_incompatible")?.decision, "block");

  // 权限例外：缺件风险可确认放行；型号不符属 block，带确认也不放行。
  const rigMissing = [bodyWithBattery, okLens];
  assert.equal(runPoint("order_confirmation", rigMissing).decision, "block", "未确认的缺电池风险在下单阶段阻止");
  assert.equal(
    runPoint("order_confirmation", rigMissing, [{ capability: "camera_compatibility", code: "battery_missing", reason: "客户自备原厂电池" }]).decision,
    "warn",
    "带原因确认后缺件风险放行"
  );
  assert.equal(
    runPoint("order_confirmation", [bodyWithBattery, okLens, battery("LP-E6NH")], [
      { capability: "camera_compatibility", code: "battery_incompatible", reason: "硬上" }
    ]).decision,
    "block",
    "电池型号不符即便带确认也必须阻止"
  );
  console.log("  ✓ 电池与充电器：匹配放行、缺电池/缺充电器警告可确认、型号不符与充电器不支持一律阻止");
}

// ============ 10. 存储介质（Review P1-7） ============
{
  const bodyCf = line("机身-R5", { role: "body", mount: "RF", sensorFormat: "full_frame", powerDrawW: 20, model: "R5" });
  const card = (type) => line(`卡-${type}`, { role: "storage", storageType: type });
  const okLens = lens("RF", "full_frame");

  const cf = card("cfexpress_b");
  const sd = card("sd");
  const storageConfig = relationConfig(relation("storage_support", bodyCf, cf), relation("storage_support", bodyCf, sd));
  assert.deepEqual(evaluateCameraCompatibility([bodyCf, okLens, cf], storageConfig), [], "支持的介质不应有发现");
  assert.deepEqual(evaluateCameraCompatibility([bodyCf, okLens, sd], storageConfig), [], "任一受支持介质即可");
  const missingCard = evaluateCameraCompatibility([bodyCf, okLens], storageConfig);
  assert.equal(missingCard.find((row) => row.code === "storage_missing")?.decision, "warn", "完全没带存储卡是缺件风险");
  const wrongCardLine = card("xqd");
  const wrongCard = evaluateCameraCompatibility([bodyCf, okLens, wrongCardLine], storageConfig);
  assert.equal(wrongCard.find((row) => row.code === "storage_incompatible")?.decision, "block", "介质不受支持必须阻止");
  assert.equal(
    runPoint("order_confirmation", [bodyCf, okLens, wrongCardLine], [
      { capability: "camera_compatibility", code: "storage_incompatible", reason: "客户说能用" }
    ], storageConfig).decision,
    "block",
    "介质不兼容带确认也必须阻止"
  );
  console.log("  ✓ 存储介质：受支持放行、缺卡警告、介质不符阻止且不可确认");
}

// ============ 11. 接口（Review P1-7） ============
{
  const bodyPorts = line("机身-FX3", { role: "body", mount: "E", sensorFormat: "full_frame", powerDrawW: 20, model: "FX3" });
  const monitor = (port) => line(`监视器-${port}`, { role: "monitor" });
  const okLens = lens("E", "full_frame");

  const hdmiMonitor = monitor("hdmi");
  const sdiMonitor = monitor("sdi");
  const portConfig = relationConfig(
    relation("port_support", bodyPorts, hdmiMonitor),
    relation("port_support", bodyPorts, sdiMonitor, "block")
  );
  assert.deepEqual(evaluateCameraCompatibility([bodyPorts, okLens, hdmiMonitor], portConfig), [], "机身提供所需接口时不应有发现");
  const missingPort = evaluateCameraCompatibility([bodyPorts, okLens, sdiMonitor], portConfig);
  assert.equal(missingPort.find((row) => row.code === "port_unavailable")?.decision, "block", "机身无该接口必须阻止");
  assert.match(missingPort.find((row) => row.code === "port_unavailable").message, /监视器-sdi/u, "错误必须点明哪个附件不可用");
  assert.equal(
    runPoint("order_confirmation", [bodyPorts, okLens, sdiMonitor], [
      { capability: "camera_compatibility", code: "port_unavailable", reason: "现场再想办法" }
    ], portConfig).decision,
    "block",
    "接口缺失带确认也必须阻止"
  );
  console.log("  ✓ 接口：具备所需接口放行、缺接口阻止且不可确认");
}

// ============ 12. 配件承载与安装（Review P1-7） ============
{
  const bodyRig = line("机身-A7", { role: "body", mount: "E", sensorFormat: "full_frame", powerDrawW: 20, weightG: 650, shoeType: "MI", model: "A7M4" });
  const heavyLens = line("镜头-大三元", { role: "lens", mount: "E", coversFormat: "full_frame", weightG: 900 });
  const stabilizer = (payload) => line(`稳定器-${payload}g`, { role: "accessory", accessoryKind: "stabilizer", maxPayloadG: payload });
  const flash = (shoe) => line(`闪光灯-${shoe}`, { role: "accessory", accessoryKind: "flash", shoeType: shoe });
  const cage = (name) => line(`兔笼-${name}`, { role: "accessory", accessoryKind: "cage" });

  // 稳定器：载重充裕放行、余量不足 10% 警告、超载阻止。
  assert.deepEqual(evaluateCameraCompatibility([bodyRig, heavyLens, stabilizer(3000)]), [], "载重充裕不应有发现");
  const tight = evaluateCameraCompatibility([bodyRig, heavyLens, stabilizer(1600)]);
  assert.equal(tight.find((row) => row.code === "stabilizer_payload_tight")?.decision, "warn", "余量不足 10% 应警告");
  const overload = evaluateCameraCompatibility([bodyRig, heavyLens, stabilizer(1200)]);
  assert.equal(overload.find((row) => row.code === "stabilizer_overload")?.decision, "block", "超载必须阻止");

  // 闪光灯热靴：相同放行、不同警告（需热靴转接件）。
  assert.deepEqual(evaluateCameraCompatibility([bodyRig, heavyLens, stabilizer(3000), flash("MI")]), [], "同热靴不应有发现");
  const shoe = evaluateCameraCompatibility([bodyRig, heavyLens, stabilizer(3000), flash("ISO518")]);
  assert.equal(shoe.find((row) => row.code === "flash_shoe_mismatch")?.decision, "warn", "热靴不同应警告");

  // 兔笼适配机型：命中放行、不命中阻止。
  const cageGood = cage("A7");
  const cageBadLine = cage("R5");
  assert.deepEqual(
    evaluateCameraCompatibility([bodyRig, heavyLens, stabilizer(3000), cageGood], relationConfig(relation("model_fit", cageGood, bodyRig))),
    [],
    "兔笼适配该机型不应有发现"
  );
  const cageBad = evaluateCameraCompatibility(
    [bodyRig, heavyLens, stabilizer(3000), cageBadLine],
    relationConfig(relation("model_fit", cageBadLine, bodyRig, "block"))
  );
  assert.equal(cageBad.find((row) => row.code === "cage_model_mismatch")?.decision, "block", "兔笼不适配必须阻止");

  // 权限例外：警告可确认，阻止不可确认。
  const tightRig = [bodyRig, heavyLens, stabilizer(1600)];
  assert.equal(runPoint("order_confirmation", tightRig).decision, "block", "未确认的载重风险在下单阶段阻止");
  assert.equal(
    runPoint("order_confirmation", tightRig, [
      { capability: "camera_compatibility", code: "stabilizer_payload_tight", reason: "摄影师确认只做静态镜头" }
    ]).decision,
    "warn",
    "带原因确认后载重风险放行"
  );
  console.log("  ✓ 配件：稳定器载重（放行/紧张/超载）、闪光灯热靴、兔笼适配机型，警告可确认、阻止不可");
}

// ============ 12b. 多套器材不得做笛卡尔积 ============
{
  const bodyE = line("机身-E-套装A", { role: "body", mount: "E", sensorFormat: "full_frame", weightG: 600 });
  const bodyRf = line("机身-RF-套装B", { role: "body", mount: "RF", sensorFormat: "full_frame", weightG: 650 });
  const lensE = line("镜头-E-套装A", { role: "lens", mount: "E", coversFormat: "full_frame", weightG: 700 });
  const lensRf = line("镜头-RF-套装B", { role: "lens", mount: "RF", coversFormat: "full_frame", weightG: 750 });
  const gimbalA = line("稳定器-A", { role: "accessory", accessoryKind: "stabilizer", maxPayloadG: 1500 });
  const gimbalB = line("稳定器-B", { role: "accessory", accessoryKind: "stabilizer", maxPayloadG: 1600 });
  const pairing = relationConfig(
    relation("equipment_target", lensE, bodyE),
    relation("equipment_target", lensRf, bodyRf),
    relation("equipment_target", gimbalA, bodyE),
    relation("equipment_target", gimbalA, lensE),
    relation("equipment_target", gimbalB, bodyRf),
    relation("equipment_target", gimbalB, lensRf)
  );
  assert.deepEqual(
    evaluateCameraCompatibility([bodyE, bodyRf, lensE, lensRf, gimbalA, gimbalB], pairing),
    [],
    "两套各自兼容的器材必须按关系分组判定，不能互相交叉造成卡口或载重误报"
  );
  assert.equal(
    evaluateCameraCompatibility([bodyE, bodyRf, lensE, lensRf]).some((row) => row.code === "equipment_target_ambiguous"),
    true,
    "多机身未登记目标关系时必须 fail-closed，不能猜测配对"
  );

  const batteryA = line("电池-A", { role: "battery", batteryModel: "A" });
  const batteryB = line("电池-B", { role: "battery", batteryModel: "B" });
  const chargerA = line("充电器-A", { role: "charger" });
  const chargerB = line("充电器-B", { role: "charger" });
  assert.deepEqual(
    evaluateCameraCompatibility(
      [batteryA, batteryB, chargerA, chargerB],
      relationConfig(relation("battery_support", chargerA, batteryA), relation("battery_support", chargerB, batteryB))
    ),
    [],
    "两种电池各有一个匹配充电器时必须放行，不能要求每个充电器支持全部电池"
  );
  console.log("  ✓ 多套器材：显式分组消除笛卡尔积误判，关系缺失 fail-closed，充电器按集合覆盖");
}

// ============ 13. 资产级属性覆盖商品组（Review P1-8） ============
{
  // 同一商品组、两台资产：一台卡口被改装（资产级覆盖），判定结果必须不同。
  const groupBody = { role: "body", mount: "RF", sensorFormat: "full_frame", powerDrawW: 20, model: "R5" };
  const lensEf = lens("EF", "full_frame");
  const assetNormal = { ...line("机身-R5", { ...groupBody }), assetId: "a1", assetNo: "A-001" };
  const assetModified = { ...line("机身-R5", { ...groupBody, assetMountOverride: "EF" }), assetId: "a2", assetNo: "A-002" };

  const normalAsset = evaluateCameraCompatibility([assetNormal, lensEf, power(100)]);
  assert.equal(normalAsset.find((row) => row.code === "mount_needs_adapter")?.decision, "warn", "原厂 RF 机身配 EF 镜头需转接");
  const modifiedAsset = evaluateCameraCompatibility([assetModified, lensEf, power(100)]);
  assert.deepEqual(modifiedAsset, [], "被改装为 EF 卡口的那台资产配 EF 镜头是原生匹配，不应报风险");

  // 资产级功耗覆盖同样生效：同型号机身改装后功耗更高，供电从足够变为不足。
  const hungry = { ...line("机身-R5", { ...groupBody, assetPowerDrawW: 120 }), assetId: "a3", assetNo: "A-003" };
  const powerTight = evaluateCameraCompatibility([hungry, lens("RF", "full_frame"), power(100)]);
  assert.equal(powerTight.find((row) => row.code === "power_insufficient")?.decision, "block", "资产实际功耗必须参与供电判定");
  console.log("  ✓ 资产级覆盖：同商品组下两台资产属性不同则判定不同（卡口与功耗均生效）");
}

console.log("\nCAM-01A 摄影器材兼容性用例全部通过");
})();
