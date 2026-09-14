const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalInventoryMode, RentalCoreOrderStatus, RentalReservationStatus } = require("@rental-os/shared");
const { createAbsorbingConfigStore, createAbsorbingFactStore } = require("./helpers/absorbing-config-store.cjs");

void (async () => {
  const factStore = createAbsorbingFactStore();
  const service = new RentalCoreService(createAbsorbingConfigStore(), factStore);
  await service.onApplicationBootstrap();

  const tenantId = "tenant_002";
  const state = service["state"](tenantId);
  const consumable = {
    id: "camp-consumable-test",
    tenantId,
    workspaceId: "ws_tenant_002",
    categoryCode: "camping",
    code: "CAMP-FUEL-TEST",
    name: "一次性燃料包",
    inventoryMode: RentalInventoryMode.Consumable,
    unit: "包",
    attributes: {},
    bundleComponents: [],
    status: "enabled",
    images: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.itemGroups.push(consumable);

  const snapshot = {
    assets: [],
    stocks: [{ itemGroupId: consumable.id, locationId: "loc-camp", onHandQuantity: 5, maintenanceQuantity: 0 }],
    // 耗材预占不按租期重叠折算：即使这条预占的时间不在本次查询区间，也必须扣除。
    reservations: [{ orderId: "other-order", itemGroupId: consumable.id, locationId: "loc-camp", quantity: 2, startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-02T00:00:00.000Z" }]
  };
  assert.equal(
    service["availableQuantity"](state, snapshot, consumable, "loc-camp", "2026-09-20T00:00:00.000Z", "2026-09-21T00:00:00.000Z", new Set()),
    3,
    "耗材预占必须按全生命周期扣除，不能因日期不重叠而重复销售"
  );

  const consumedCalls = [];
  factStore.consumeStockForOrder = async (...args) => consumedCalls.push(args);
  const order = {
    id: "order-consumable-test",
    status: RentalCoreOrderStatus.ReadyForPickup,
    fulfillmentLocationId: "loc-camp",
    assignment: undefined,
    reservations: [{
      id: "reservation-consumable-test",
      orderId: "order-consumable-test",
      orderLineId: "line-consumable-test",
      itemGroupId: consumable.id,
      locationId: "loc-camp",
      quantity: 2,
      releasedQuantity: 0,
      status: RentalReservationStatus.Confirmed
    }],
    allocations: [{
      id: "allocation-consumable-test",
      orderId: "order-consumable-test",
      orderLineId: "line-consumable-test",
      itemGroupId: consumable.id,
      quantity: 2,
      status: "locked",
      metadata: { locationId: "loc-camp" }
    }]
  };

  await service["markPickedUp"](tenantId, order, [], {}, "测试员");
  assert.equal(consumedCalls.length, 1, "领取耗材必须调用事务内扣减库存"
  );
  assert.deepEqual(consumedCalls[0][2], [{ itemGroupId: consumable.id, locationId: "loc-camp", quantity: 2 }]);
  assert.equal(order.status, RentalCoreOrderStatus.Renting);
  assert.equal(order.reservations[0].status, RentalReservationStatus.Released);
  assert.equal(order.reservations[0].releasedQuantity, 2);
  assert.equal(order.allocations[0].status, "consumed");

  service["finishReturn"](order, 0, []);
  assert.equal(order.status, RentalCoreOrderStatus.Settling);
  assert.equal(order.allocations[0].status, "consumed", "一次性耗材不应在归还时重新进入库存或归还状态");

  const migration = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../apps/api/prisma/migrations/20260914001200_consumable_inventory_mode/migration.sql"),
    "utf8"
  );
  assert.match(migration, /'consumable'/, "迁移必须允许一次性耗材库存模式");
  assert.ok(require("@rental-os/shared").RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camping").supportedInventoryModes.includes(RentalInventoryMode.Consumable));

  console.log("CAMP-01B 一次性耗材专项通过：全生命周期预占、领取事务扣减、领取后不可归还和露营品类声明均已覆盖");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
