const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalServiceCapacityService } = require("../apps/api/src/modules/rental-core/rental-service-capacity.service");
const { RentalCoreOrderStatus } = require("@rental-os/shared");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

function partialOrder() {
  return {
    id: "order_partial", status: RentalCoreOrderStatus.Renting,
    allocations: [
      { id: "allocation_a", orderId: "order_partial", orderLineId: "line_1", itemGroupId: "group_1", assetId: "asset_a", quantity: 1, status: "picked_up" },
      { id: "allocation_b", orderId: "order_partial", orderLineId: "line_1", itemGroupId: "group_1", assetId: "asset_b", quantity: 1, status: "picked_up" }
    ],
    reservations: [{ orderLineId: "line_1", itemGroupId: "group_1", quantity: 2, releasedQuantity: 0, status: "fulfilled" }]
  };
}

function partialService() {
  const service = Object.create(RentalCoreService.prototype);
  service.factStore = { listAssets: async () => [{ id: "asset_a", itemGroupId: "group_1" }, { id: "asset_b", itemGroupId: "group_1" }] };
  service.group = () => ({ inventoryMode: "serialized" });
  return service;
}

void (async () => {
  // 逐批归还检查和无检查的部分归还都共用同一库存释放原子逻辑。
  {
    const service = partialService();
    const order = partialOrder();
    const changes = [];
    await service.applyPartialReturnItems("tenant", {}, order, [{ allocationId: "allocation_a", quantity: 1 }], undefined, changes);
    assert.equal(order.allocations[0].status, "returned");
    assert.equal(order.allocations[1].status, "picked_up", "其余实物必须继续在租");
    assert.deepEqual(order.reservations[0], { orderLineId: "line_1", itemGroupId: "group_1", quantity: 2, releasedQuantity: 1, status: "fulfilled" });
    assert.deepEqual(changes, [{ assetId: "asset_a", status: "available" }]);
    ok("部分归还只释放本批资产与对应数量，剩余分配继续在租");
  }

  // 最后一批不能先写回资产状态、再报错；否则内存实现和失败事务都会留下脏状态。
  {
    const service = partialService();
    const order = partialOrder();
    const before = structuredClone(order);
    await assert.rejects(
      () => service.applyPartialReturnItems("tenant", {}, order, [
        { allocationId: "allocation_a", quantity: 1 }, { allocationId: "allocation_b", quantity: 1 }
      ], undefined, []),
      /最后一批/u
    );
    assert.deepEqual(order, before, "最后一批被拒绝时不得提前改变分配或预占");
    ok("最后一批在写入前被拒绝，必须改走整单归还结算");
  }

  // 检查员填的建议额不能越过订单损坏上限；有免赔服务时只把客户实际承担部分入账。
  {
    const service = Object.create(RentalCoreService.prototype);
    const baseOrder = () => ({
      id: "order_damage", status: RentalCoreOrderStatus.Settling, ruleVersion: "rule_v1",
      payableAmount: 1000, finalPayableAmount: 1000, totalAmount: 1000, adjustmentAmount: 0, taxRate: 0,
      chargeLines: [], serviceSnapshots: [{ serviceType: "damage_waiver", deductible: 100, coverageLimit: 1000 }],
      ruleSnapshot: { damage: { chargeLimit: 300 } }
    });
    let order = baseOrder();
    service.lockedOrder = async () => order;
    service.factStore = { saveOrderAggregate: async () => undefined };
    const approved = await service.approveInspectionException("tenant", order.id, "inspection_1", 0, 250, "划痕", {});
    assert.equal(approved.approvedChargeAmount, 100, "免赔额之外被保障的部分不应再向客户收费");
    assert.equal(order.finalPayableAmount, 1100);
    order = baseOrder();
    await assert.rejects(
      () => service.approveInspectionException("tenant", order.id, "inspection_2", 0, 1500, "重大损坏", {}),
      /超过订单规则上限/u
    );
    assert.equal(order.chargeLines.length, 0, "超上限审核不得留下任何费用行");
    order = baseOrder();
    order.serviceSnapshots[0].scheduledStartAt = "2026-09-10T00:00:00.000Z";
    order.serviceSnapshots[0].scheduledEndAt = "2026-09-11T00:00:00.000Z";
    const lateReview = await service.approveInspectionException(
      "tenant", order.id, "inspection_3", 0, 250, "保障期内发现、期后审核", {}, "2026-09-10T12:00:00.000Z"
    );
    assert.equal(lateReview.approvedChargeAmount, 100, "延迟审核不能让保障期内的异常失去免赔");
    order = baseOrder();
    order.serviceSnapshots[0].scheduledStartAt = "2026-09-10T00:00:00.000Z";
    order.serviceSnapshots[0].scheduledEndAt = "2026-09-11T00:00:00.000Z";
    const outside = await service.approveInspectionException(
      "tenant", order.id, "inspection_4", 0, 250, "保障期外发现", {}, "2026-09-12T12:00:00.000Z"
    );
    assert.equal(outside.approvedChargeAmount, 250, "保障期外的异常不能因审核时刻改变而命中免赔");
    ok("检查异常计费同时受免赔服务和订单损坏上限约束");
  }

  // 提前归还不能把未来服务伪造成“已履约”：已开始的留历史，未开始的释放容量。
  {
    const service = Object.create(RentalServiceCapacityService.prototype);
    const rows = [
      { id: "reservation_due", serviceId: "service_due", capacityId: "capacity_due", quantity: 1, status: "confirmed" },
      { id: "reservation_future", serviceId: "service_future", capacityId: "capacity_future", quantity: 2, status: "confirmed" }
    ];
    service.lockOrderReservations = async () => rows;
    const writes = [];
    const tx = {
      businessWorkspace: { findFirst: async () => ({ id: "ws_1" }) },
      rentalServiceReservation: { updateMany: async (input) => { writes.push({ kind: "reservation", input }); return { count: 1 }; } },
      rentalServiceCapacity: { updateMany: async (input) => { writes.push({ kind: "capacity", input }); return { count: 1 }; } }
    };
    const outcome = await service.settleReturnForOrder("tenant", {
      id: "order_service",
      serviceSnapshots: [
        { serviceId: "service_due", requiresCapacity: true, scheduledStartAt: "2026-09-01T09:00:00.000Z" },
        { serviceId: "service_future", requiresCapacity: true, scheduledStartAt: "2026-09-03T09:00:00.000Z" }
      ]
    }, "2026-09-02T09:00:00.000Z", tx);
    assert.deepEqual(outcome, { usedServiceIds: ["service_due"], releasedServiceIds: ["service_future"] });
    assert.equal(writes.filter((row) => row.kind === "capacity").length, 1, "只有未开始服务回收容量");
    assert.equal(writes.find((row) => row.kind === "reservation" && row.input.data.status === "released").input.data.releaseReason, "not_started_at_return");
    ok("归还时已开始服务保留履约历史，未开始服务释放容量");
  }

  console.log(`\n订单归还与结算专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
