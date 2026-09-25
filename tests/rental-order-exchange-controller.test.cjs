const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");

function fixture(overrides = {}) {
  const order = {
    id: "order_exchange_controller",
    status: "renting",
    fulfillmentLocationId: "loc_pickup",
    assignment: { revision: 4 },
    lines: [{ id: "line_1", itemGroupId: "model_old", quantity: 1, inventoryMode: "serialized" }],
    reservations: [{ id: "reservation_1", orderLineId: "line_1", status: "fulfilled" }],
    allocations: [{ id: "allocation_1", orderLineId: "line_1", status: "picked_up", quantity: 1 }],
    ...overrides.order
  };
  const groups = [
    { id: "model_old", name: "旧型号", status: "enabled", inventoryMode: "serialized" },
    { id: "model_new", name: "新型号", status: "enabled", inventoryMode: "serialized" }
  ];
  for (const group of overrides.groups ?? []) {
    const index = groups.findIndex((row) => row.id === group.id);
    if (index >= 0) groups[index] = group;
    else groups.push(group);
  }
  const controller = Object.create(RentalCoreController.prototype);
  const candidateAsset = { assetId: "asset_new", assetNo: "ASSET-NEW", itemGroupId: "model_new", available: true };
  controller.service = {
    getOrder: async () => order,
    listItemGroups: () => groups
  };
  controller.allocation = {
    candidates: async () => { throw new Error("换货候选不得依赖仅包含 confirmed 预留的普通分配查询"); },
    exchangeAssetCandidates: async (_tenantId, receivedOrder, itemGroupId, locationId, tx) => {
      assert.equal(receivedOrder, order);
      assert.equal(itemGroupId, "model_new");
      assert.equal(locationId, "loc_pickup");
      assert.deepEqual(tx, { transaction: true });
      return [candidateAsset];
    }
  };
  controller.prisma = { $transaction: async (run) => run({ transaction: true }) };
  return { controller, order, candidateAsset };
}

async function run() {
  const { controller, candidateAsset } = fixture();
  const response = await controller.allocationCandidates({ user: { tenantId: "tenant_1" } }, "order_exchange_controller", "line_1", "model_new");
  assert.equal(response.revision, 4);
  assert.equal(response.reservations.length, 1);
  assert.equal(response.reservations[0].reservationId, "reservation_1");
  assert.deepEqual(response.reservations[0].candidates, [candidateAsset]);
  console.log("PASS 换货候选读取 fulfilled 预留并在订单领取地点计算资产冲突");

  const { controller: splitAllocations } = fixture({ order: {
    lines: [{ id: "line_1", itemGroupId: "model_old", quantity: 2, inventoryMode: "serialized" }],
    allocations: [
      { id: "allocation_1", orderLineId: "line_1", status: "picked_up", quantity: 1 },
      { id: "allocation_2", orderLineId: "line_1", status: "picked_up", quantity: 1 }
    ]
  } });
  const splitResponse = await splitAllocations.allocationCandidates({ user: { tenantId: "tenant_1" } }, "order_exchange_controller", "line_1", "model_new");
  assert.equal(splitResponse.reservations[0].assignedQuantity, 2);
  assert.equal(splitResponse.reservations[0].lockedQuantity, 2);
  console.log("PASS 同一订单行分配到两台资产并全部领取后，整行换货候选可正常查询");

  await assert.rejects(
    () => controller.allocationCandidates({ user: { tenantId: "tenant_1" } }, "order_exchange_controller", "line_1", undefined),
    /必须同时指定订单行和替换型号/u
  );
  console.log("PASS 不完整的换货候选筛选条件被拒绝");

  const { controller: wrongMode } = fixture({ groups: [{ id: "model_new", name: "重复项", status: "enabled", inventoryMode: "quantity" }] });
  await assert.rejects(
    () => wrongMode.allocationCandidates({ user: { tenantId: "tenant_1" } }, "order_exchange_controller", "line_1", "model_new"),
    /同类库存型号/u
  );
  console.log("PASS 不同库存方式的型号不能返回换货候选");

  const { controller: notPicked } = fixture({ order: { allocations: [{ id: "allocation_1", orderLineId: "line_1", status: "returned", quantity: 1 }] } });
  await assert.rejects(
    () => notPicked.allocationCandidates({ user: { tenantId: "tenant_1" } }, "order_exchange_controller", "line_1", "model_new"),
    /整行已领取/u
  );
  console.log("PASS 未整行领取的商品不能查询换货候选");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
