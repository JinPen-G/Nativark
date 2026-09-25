const assert = require("node:assert/strict");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
  },
});
const {
  allocationConflict,
  allocationComplete,
} = require("../apps/api/src/modules/rental-core/rental-allocation-policy");
const { rentalAllocationProgress } = require("@rental-os/shared");
const { RentalAllocationService } = require("../apps/api/src/modules/rental-core/rental-allocation.service");
const order = {
  id: "o",
  startAt: "2030-01-01T10:00:00Z",
  endAt: "2030-01-01T12:00:00Z",
  fulfillmentLocationId: "loc",
  ruleSnapshot: {
    fulfillment: { pickupBufferMinutes: 30, returnBufferMinutes: 30 },
  },
  reservations: [
    {
      id: "r",
      orderLineId: "l",
      itemGroupId: "g",
      status: "confirmed",
      quantity: 2,
      releasedQuantity: 0,
    },
  ],
  allocations: [],
};
const asset = { id: "a", locationId: "loc", status: "available" };
const booking = {
  orderId: "other",
  assetId: "a",
  startAt: "2030-01-01T08:00:00Z",
  endAt: "2030-01-01T09:30:00Z",
  status: "locked",
  returnLocationId: "loc",
};
assert.equal(
  allocationConflict(order, asset, [booking]),
  undefined,
  "缓冲端点相接不冲突",
);
assert.match(
  allocationConflict(order, asset, [
    { ...booking, endAt: "2030-01-01T09:31:00Z" },
  ]),
  /缓冲/,
);
assert.equal(
  allocationConflict(order, asset, [
    { ...booking, orderId: "o", endAt: "2030-01-01T12:30:00Z" },
  ]),
  undefined,
  "自己不重复占用",
);
assert.match(
  allocationConflict(order, { ...asset, status: "maintenance" }, []),
  /维护/,
);
assert.match(
  allocationConflict(order, asset, [
    { ...booking, returnLocationId: "elsewhere" },
  ]),
  /地点/,
);
assert.equal(
  allocationConflict(
    order,
    { ...asset, status: "rented" },
    [{ ...booking, status: "picked_up" }],
    Date.parse("2029-12-31"),
  ),
  undefined,
  "目前在租可排未来",
);
assert.match(
  allocationConflict(
    order,
    { ...asset, status: "rented" },
    [],
    Date.parse("2029-12-31"),
  ),
  /前序/,
);
assert.equal(allocationComplete(order), false);
order.allocations.push({
  id: "a1",
  orderLineId: "l",
  itemGroupId: "g",
  quantity: 1,
  status: "pre_assigned",
});
assert.deepEqual(rentalAllocationProgress(order), {
  required: 2,
  assigned: 1,
  locked: 0,
  label: "部分分配",
});
assert.equal(allocationComplete(order, true), false);
order.allocations.push({
  id: "a2",
  orderLineId: "l",
  itemGroupId: "g",
  quantity: 1,
  status: "locked",
});
assert.equal(allocationComplete(order), true);
assert.equal(allocationComplete(order, true), false);
order.allocations[0].status = "allocated";
assert.equal(allocationComplete(order, true), true, "历史配货视为锁定");
order.allocations.push({
  id: "old",
  orderLineId: "l",
  itemGroupId: "g",
  quantity: 1,
  status: "released",
});
assert.equal(allocationComplete(order, true), true, "历史释放行不重复计算");
const allocation = new RentalAllocationService(null, null, null);
const scopedOrder = {
  lines: [{ id: "l", pricingGroupId: "pg", inventoryMode: "serialized", itemGroupId: "g",
    pricingGroupMemberItemGroupIds: ["g", "alternate"], reservationPrecision: "exact_model" }]
};
assert.deepEqual(allocation.allowedModels(scopedOrder, order.reservations[0]), ["g"], "准确型号预约不得替换为组内其他型号");
scopedOrder.lines[0].reservationPrecision = "group";
assert.deepEqual(allocation.allowedModels(scopedOrder, order.reservations[0]), ["g", "alternate"], "按组预约仍可使用快照内型号");
console.log(
  "PASS allocation policy: 14 assertions, buffers/future availability/location/partial/legacy/released",
);
