const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  buildCapabilityEquipment,
  buildCapabilityEquipmentFromAssets
} = require("../apps/api/src/modules/rental-core/capability-equipment");

/**
 * P2-1：报价、订单与配货共用的器材富化。
 *
 * 早前报价侧与订单侧各写一份，找不到商品时前者用 id 冒充名称、后者直接抛，
 * 于是同一条脏数据在两处得出不同结果。这里锁住统一后的口径。
 */

const groups = new Map([
  ["g1", { id: "g1", name: "全画幅机身", inventoryMode: "serialized", attributes: { role: "body", mount: "RF" } }],
  ["g2", { id: "g2", name: "三脚架", inventoryMode: "quantity", attributes: {} }]
]);

// ============ 1. 商品级富化 ============
{
  const lines = buildCapabilityEquipment(groups, [{ itemGroupId: "g1", quantity: 2 }, { itemGroupId: "g2", quantity: 3 }]);
  assert.deepEqual(lines, [
    { itemGroupId: "g1", itemGroupName: "全画幅机身", inventoryMode: "serialized", quantity: 2, attributes: { role: "body", mount: "RF" } },
    { itemGroupId: "g2", itemGroupName: "三脚架", inventoryMode: "quantity", quantity: 3, attributes: {} }
  ]);
  // 必须是副本：能力拿到的属性对象被改写不得影响商品组定义。
  lines[0].attributes.mount = "EF";
  assert.equal(groups.get("g1").attributes.mount, "RF", "富化结果必须是属性副本");
  console.log("  ✓ 商品级富化：展开名称/库存模式/属性，且属性为副本");
}

// ============ 2. 找不到商品必须明确报错 ============
{
  // 用 id 顶替名称会把「数据缺失」伪装成「商品就叫这个名字」，
  // 而能力随后基于空属性得出「无风险」——等于把缺失静默转成放行。
  assert.throws(
    () => buildCapabilityEquipment(groups, [{ itemGroupId: "missing", quantity: 1 }]),
    /商品 missing 不存在/u,
    "找不到商品必须报错，不得用 id 冒充名称"
  );
  assert.throws(
    () => buildCapabilityEquipmentFromAssets(groups, [{ id: "a1", assetNo: "A-1", itemGroupId: "missing", attributes: {} }]),
    /无法进行能力兼容性判定/u,
    "资产所属商品缺失同样必须报错"
  );
  console.log("  ✓ 缺失商品：两个入口都明确报错，不静默降级");
}

// ============ 3. 资产级富化：属性合并与资产标识 ============
{
  const lines = buildCapabilityEquipmentFromAssets(groups, [
    { id: "a1", assetNo: "A-001", itemGroupId: "g1", attributes: { assetMountOverride: "EF", serialNo: "SN1" } },
    { id: "a2", assetNo: "A-002", itemGroupId: "g1", attributes: {} }
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].assetId, "a1");
  assert.equal(lines[0].assetNo, "A-001", "必须带资产编号，事后才能解释判的是哪一台");
  assert.equal(lines[0].quantity, 1, "资产按单件展开");
  // 合并顺序：商品组属性 → 资产属性（资产覆盖商品组）。
  assert.equal(lines[0].attributes.mount, "RF", "未被资产覆盖的商品组属性必须保留");
  assert.equal(lines[0].attributes.assetMountOverride, "EF", "资产属性必须进入判定输入");
  assert.equal(lines[0].attributes.serialNo, "SN1");
  assert.equal(lines[1].attributes.assetMountOverride, undefined, "没有覆盖的资产不应凭空多出属性");
  console.log("  ✓ 资产级富化：带 assetId/assetNo、按单件展开、资产属性覆盖商品组属性");
}

console.log("\nP2-1 器材富化收敛用例全部通过");
