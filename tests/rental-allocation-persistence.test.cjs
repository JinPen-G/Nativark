const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const url = new URL(process.env.DATABASE_URL || "mysql://invalid/invalid");
assert.match(url.pathname.slice(1), /^rental_os_dedicated_assignment_\d+$/);
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
  PrismaService,
} = require("../apps/api/src/modules/database/prisma.service");
const {
  RentalCoreFactRepository,
} = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
const {
  RentalAllocationService,
} = require("../apps/api/src/modules/rental-core/rental-allocation.service");
const {
  RentalCoreService,
} = require("../apps/api/src/modules/rental-core/rental-core.service");
const {
  runWithRequestIdentity,
} = require("../apps/api/src/common/request-identity");
const {
  allocationComplete,
} = require("../apps/api/src/modules/rental-core/rental-allocation-policy");
const prisma = new PrismaService();
const facts = new RentalCoreFactRepository(prisma);
const ids = [];
const groupIds = [];
const assetIds = [];
const pricingIds = [];
let context,
  hooks = 0;
(async () => {
  try {
    const seed = await prisma.rentalOrder.findFirst({
      where: { lines: { some: {} } },
    });
    assert.ok(seed, "克隆库需要一份已有订单");
    context = {
      tenantId: seed.tenantId,
      workspaceId: seed.workspaceId,
      userId: "assignment-test",
    };
    await runWithRequestIdentity(context, async () => {
      const assets = await facts.listAssets(seed.tenantId);
      const asset = assets.find((a) => a.status === "available");
      assert.ok(asset);
      const base = await facts.findOrder(seed.tenantId, seed.id);
      const group = await prisma.rentalItemGroup.findFirst({
        where: { id: asset.itemGroupId },
      });
      assert.ok(group);
      const core = {
        listLocations: () => [{ id: asset.locationId, status: "enabled" }],
        listItemGroups: () => [
          {
            id: group.id,
            name: group.name,
            inventoryMode: "serialized",
            status: "enabled",
          },
        ],
        getBusinessSettings: () => ({ allocation: { protectManual: true } }),
        validateAllocationEquipment: async () => {
          hooks++;
        },
      };
      const service = new RentalAllocationService(prisma, facts, core);
      async function create(
        start = "2040-01-01T10:00:00Z",
        end = "2040-01-01T12:00:00Z",
        quantity = 1,
      ) {
        const id = randomUUID(),
          lineId = randomUUID(),
          reservationId = randomUUID();
        ids.push(id);
        const order = {
          ...structuredClone(base),
          id,
          orderNo: `allocation-${id}`,
          status: "reserved",
          assignment: undefined,
          fulfillmentLocationId: asset.locationId,
          returnLocationId: asset.locationId,
          startAt: start,
          endAt: end,
          effectiveEndAt: end,
          ruleSnapshot: {
            ...base.ruleSnapshot,
            fulfillment: {
              ...base.ruleSnapshot.fulfillment,
              pickupBufferMinutes: 30,
              returnBufferMinutes: 30,
            },
          },
          lines: [
            {
              ...base.lines[0],
              id: lineId,
              itemGroupId: group.id,
              inventoryMode: "serialized",
              quantity,
            },
          ],
          reservations: [
            {
              id: reservationId,
              orderLineId: lineId,
              itemGroupId: group.id,
              locationId: asset.locationId,
              quantity,
              releasedQuantity: 0,
              status: "confirmed",
              createdAt: new Date().toISOString(),
            },
          ],
          allocations: [],
        };
        await facts.saveOrderAggregate(order);
        return order;
      }
      const a = await create(),
        b = await create();
      const assign = (order) =>
        prisma.$transaction(
          (tx) =>
            service.manage(
              seed.tenantId,
              order.id,
              {
                action: "preassign",
                expectedRevision: 0,
                selections: [
                  {
                    reservationId: order.reservations[0].id,
                    assetIds: [asset.id],
                  },
                ],
              },
              tx,
              "tester",
            ),
          { isolationLevel: "ReadCommitted" },
        );
      const results = await Promise.allSettled([assign(a), assign(b)]);
      assert.equal(
        results.filter((x) => x.status === "fulfilled").length,
        1,
        "同一资产同时间并发仅一单成功",
      );
      const winner = results.find((x) => x.status === "fulfilled").value;
      assert.equal(
        (await facts.listAssets(seed.tenantId)).find((x) => x.id === asset.id)
          .status,
        "available",
        "未来预分配不改即时状态",
      );
      console.log(
        "PASS concurrent asset assignment 1 success / 1 conflict, physical state unchanged",
      );
      const nonOverlap = await create(
        "2040-01-01T13:00:00Z",
        "2040-01-01T15:00:00Z",
      );
      await assign(nonOverlap);
      console.log("PASS same asset disjoint buffered future order allowed");
      const change = (input) =>
        prisma.$transaction(
          (tx) => service.manage(seed.tenantId, winner.id, input, tx, "tester"),
          { isolationLevel: "ReadCommitted" },
        );
      await assert.rejects(
        () => change({ action: "lock", expectedRevision: 0 }),
        /刷新/,
      );
      const locked = await change({ action: "lock", expectedRevision: 1 });
      assert.equal(locked.status, "ready_for_pickup");
      assert.equal(allocationComplete(locked, true), true);
      await assert.rejects(
        () =>
          change({
            action: "preassign",
            expectedRevision: 2,
            selections: [
              {
                reservationId: winner.reservations[0].id,
                assetIds: [asset.id],
              },
            ],
          }),
        /改配/,
      );
      await assert.rejects(
        () => change({ action: "unlock", expectedRevision: 2 }),
        /原因/,
      );
      const unlocked = await change({
        action: "unlock",
        expectedRevision: 2,
        reason: "测试",
      });
      assert.equal(unlocked.status, "reserved");
      assert.equal(unlocked.assignment.history.length, 3);
      await assert.rejects(
        () =>
          prisma.$transaction(async (tx) => {
            await service.manage(
              seed.tenantId,
              winner.id,
              { action: "release", expectedRevision: 3, reason: "回滚验证" },
              tx,
              "tester",
            );
            throw Error("intentional rollback");
          }),
        /intentional rollback/,
      );
      assert.equal(
        (await facts.findOrder(seed.tenantId, winner.id)).assignment.revision,
        3,
      );
      console.log(
        "PASS revision/reassign/reason/atomic rollback/audit history",
      );
      await prisma.$disconnect();
      await prisma.$connect();
      assert.equal(
        (await facts.findOrder(seed.tenantId, winner.id)).allocations[0]
          .metadata.source,
        "manual",
      );
      await runWithRequestIdentity(
        { ...context, workspaceId: "wrong" },
        async () => {
          await assert.rejects(
            () => service.candidates(seed.tenantId, winner.id),
            /当前经营空间不属于目标租户|不存在/,
          );
          await assert.rejects(
            () => facts.findOrder(seed.tenantId, winner.id),
            /当前经营空间不属于目标租户|不存在/,
          );
        },
      );
      console.log(
        "PASS reconnect metadata persistence and cross-space read rejection",
      );
      await change({ action: "lock", expectedRevision: 3 });
      const lock = await service.operationLock(
        seed.tenantId,
        winner.id,
        "acquire",
        "operator1",
        "张三",
      );
      assert.ok(lock.token);
      await assert.rejects(
        () =>
          service.operationLock(
            seed.tenantId,
            winner.id,
            "acquire",
            "operator2",
            "李四",
          ),
        /张三/,
      );
      await assert.rejects(
        () =>
          service.operationLock(
            seed.tenantId,
            winner.id,
            "release",
            "operator1",
            "张三",
            "stale",
          ),
        /张三|无效/,
      );
      // 直接调用原订单状态机的取锁入口，证明旧页面提交也受凭证约束，而非仅新按钮被挡。
      const coreCheck = Object.create(RentalCoreService.prototype);
      coreCheck.factStore = facts;
      await assert.rejects(
        () =>
          prisma.$transaction((tx) =>
            coreCheck.lockedOrder(seed.tenantId, winner.id, tx),
          ),
        /办理/,
      );
      await runWithRequestIdentity(
        { ...context, userId: "operator1", operationToken: lock.token },
        () =>
          prisma.$transaction((tx) =>
            coreCheck.lockedOrder(seed.tenantId, winner.id, tx),
          ),
      );
      await service.operationLock(
        seed.tenantId,
        winner.id,
        "release",
        "operator1",
        "张三",
        lock.token,
      );
      console.log(
        "PASS operation owner/token fencing and release independent from resources",
      );
      const quantityGroupId = randomUUID();
      groupIds.push(quantityGroupId);
      await prisma.rentalItemGroup.create({
        data: {
          id: quantityGroupId,
          tenantId: seed.tenantId,
          workspaceId: seed.workspaceId,
          categoryCode: seed.categoryCode,
          code: quantityGroupId,
          name: "分配数量专项",
          inventoryMode: "QUANTITY",
          attributes: {},
          status: "enabled",
        },
      });
      await prisma.rentalStockBalance.create({
        data: {
          tenantId: seed.tenantId,
          workspaceId: seed.workspaceId,
          itemGroupId: quantityGroupId,
          locationId: asset.locationId,
          onHandQuantity: 4,
        },
      });
      const originalGroups = core.listItemGroups();
      core.listItemGroups = () => [
        ...originalGroups,
        {
          id: quantityGroupId,
          name: "分配数量专项",
          inventoryMode: "quantity",
          status: "enabled",
        },
      ];
      const quantityOrder = await create(
        "2042-01-01T10:00:00Z",
        "2042-01-01T12:00:00Z",
        3,
      );
      quantityOrder.lines[0].inventoryMode = "quantity";
      quantityOrder.lines[0].itemGroupId = quantityGroupId;
      quantityOrder.reservations[0].itemGroupId = quantityGroupId;
      await facts.saveOrderAggregate(quantityOrder);
      const changeQuantity = (input) =>
        prisma.$transaction(
          (tx) =>
            service.manage(
              seed.tenantId,
              quantityOrder.id,
              input,
              tx,
              "tester",
            ),
          { isolationLevel: "ReadCommitted" },
        );
      const part = await changeQuantity({
        action: "preassign",
        expectedRevision: 0,
        selections: [
          { reservationId: quantityOrder.reservations[0].id, quantity: 2 },
        ],
      });
      assert.equal(part.allocations[0].quantity, 2);
      assert.equal(part.allocations[0].assetId, undefined);
      const partialLock = await changeQuantity({
        action: "lock",
        expectedRevision: 1,
      });
      assert.equal(partialLock.status, "reserved");
      await changeQuantity({ action: "preassign", expectedRevision: 2 });
      const complete = await changeQuantity({
        action: "lock",
        expectedRevision: 3,
      });
      assert.equal(complete.status, "ready_for_pickup");
      assert.equal(complete.payableAmount, quantityOrder.payableAmount);
      await prisma.rentalStockBalance.updateMany({
        where: { itemGroupId: quantityGroupId },
        data: { maintenanceQuantity: 2 },
      });
      await assert.rejects(
        () => changeQuantity({ action: "lock", expectedRevision: 4 }),
        /数量不足/,
      );
      coreCheck.validateAllocationEquipment = async () => {};
      await assert.rejects(
        () =>
          prisma.$transaction((tx) =>
            coreCheck.assertAllocatedPickupReady(seed.tenantId, complete, tx),
          ),
        /数量库存不足/,
      );
      console.log(
        "PASS quantity partial allocation/partial lock/fill/full lock/no repricing/maintenance recheck",
      );
      const quantityIssue = await service.scanOrder(seed.tenantId, complete.id);
      assert.match(quantityIssue.assignment.issue, /数量不足/);
      assert.equal(
        quantityIssue.status,
        "ready_for_pickup",
        "异常不能偷偷解锁",
      );
      const once = quantityIssue.assignment.revision;
      assert.equal(
        (await service.scanOrder(seed.tenantId, complete.id)).assignment
          .revision,
        once,
        "同一异常不刷历史",
      );
      await prisma.rentalStockBalance.updateMany({
        where: { itemGroupId: quantityGroupId },
        data: { maintenanceQuantity: 0 },
      });
      assert.equal(
        (await service.scanOrder(seed.tenantId, complete.id)).assignment.issue,
        undefined,
      );

      const targetId = randomUUID(),
        targetAssetId = randomUUID();
      groupIds.push(targetId);
      assetIds.push(targetAssetId);
      await prisma.rentalItemGroup.create({
        data: {
          id: targetId,
          tenantId: seed.tenantId,
          workspaceId: seed.workspaceId,
          categoryCode: seed.categoryCode,
          code: targetId,
          name: "同组另一型号",
          inventoryMode: "SERIALIZED",
          attributes: {},
          status: "enabled",
        },
      });
      await prisma.rentalAsset.create({
        data: {
          id: targetAssetId,
          tenantId: seed.tenantId,
          workspaceId: seed.workspaceId,
          itemGroupId: targetId,
          locationId: asset.locationId,
          assetNo: targetAssetId,
          attributes: {},
          status: "AVAILABLE",
        },
      });
      const modelList = [
        ...core.listItemGroups(),
        {
          id: targetId,
          name: "同组另一型号",
          inventoryMode: "serialized",
          status: "enabled",
        },
      ];
      core.listItemGroups = () => modelList;
      const moving = await create(
        "2043-02-01T10:00:00Z",
        "2043-02-01T12:00:00Z",
      );
      const pricingId = randomUUID();
      pricingIds.push(pricingId);
      await prisma.rentalPricingGroup.create({
        data: {
          id: pricingId,
          tenantId: seed.tenantId,
          workspaceId: seed.workspaceId,
          categoryCode: seed.categoryCode,
          code: pricingId,
          name: "同组改配专项",
        },
      });
      moving.lines[0].pricingGroupId = pricingId;
      moving.lines[0].pricingGroupMemberItemGroupIds = [group.id, targetId];
      await facts.saveOrderAggregate(moving);
      const competitor = await create(moving.startAt, moving.endAt);
      competitor.lines[0].itemGroupId = targetId;
      competitor.reservations[0].itemGroupId = targetId;
      await facts.saveOrderAggregate(competitor);
      const move = (
        id,
        revision,
        modelId = targetId,
        assetId = targetAssetId,
      ) =>
        prisma.$transaction(
          (tx) =>
            service.manage(
              seed.tenantId,
              id,
              {
                action: "reassign",
                expectedRevision: revision,
                reason: "同组调度",
                selections: [
                  {
                    reservationId: moving.reservations[0].id,
                    itemGroupId: modelId,
                    assetIds: [assetId],
                  },
                ],
              },
              tx,
              "tester",
            ),
          { isolationLevel: "ReadCommitted" },
        );
      const opts = await service.candidates(seed.tenantId, moving.id);
      assert.ok(
        opts.reservations[0].models.some((m) => m.itemGroupId === targetId),
      );
      await assert.rejects(
        () => move(moving.id, 0),
        /数量不足/,
        "目标未指定资产的预约同样占库存",
      );
      let read = await facts.findOrder(seed.tenantId, moving.id);
      assert.equal(
        read.reservations[0].itemGroupId,
        group.id,
        "失败不能留下迁移一半的预留",
      );
      assert.equal(read.allocations.length, 0);
      await prisma.rentalOrder.delete({ where: { id: competitor.id } });
      read = await move(moving.id, 0);
      assert.equal(read.reservations[0].itemGroupId, targetId);
      assert.equal(read.allocations[0].itemGroupId, targetId);
      assert.equal(
        read.lines[0].itemGroupId,
        group.id,
        "不得改写购买型号与价格快照",
      );
      assert.equal(read.finalPayableAmount, moving.finalPayableAmount);
      assert.equal(
        (await facts.activeReservations(seed.tenantId)).find(
          (r) => r.orderId === moving.id,
        ).itemGroupId,
        targetId,
      );
      read = await prisma.$transaction((tx) =>
        service.manage(
          seed.tenantId,
          moving.id,
          { action: "lock", expectedRevision: 1 },
          tx,
          "tester",
        ),
      );
      read = await move(moving.id, 2, group.id, asset.id);
      assert.equal(read.status, "ready_for_pickup");
      assert.equal(
        read.allocations.filter((a) => a.status === "locked")[0].assetId,
        asset.id,
      );
      assert.equal(
        read.allocations.filter((a) => a.status === "released").length,
        1,
      );
      // 新分组成员不能追溯改变订单，套装组件不能使用父级成员范围。
      const limited = await create(
        "2043-03-01T10:00:00Z",
        "2043-03-01T12:00:00Z",
      );
      limited.lines[0].pricingGroupId = pricingId;
      limited.lines[0].pricingGroupMemberItemGroupIds = [group.id];
      await facts.saveOrderAggregate(limited);
      assert.ok(
        !(
          await service.candidates(seed.tenantId, limited.id)
        ).reservations[0].models.some((m) => m.itemGroupId === targetId),
      );
      limited.lines[0].pricingGroupMemberItemGroupIds.push(targetId);
      limited.lines[0].inventoryMode = "bundle";
      await facts.saveOrderAggregate(limited);
      assert.equal(
        (await service.candidates(seed.tenantId, limited.id)).reservations[0]
          .models.length,
        1,
      );
      console.log(
        "PASS cross-model snapshot boundaries / atomic pool transfer / unassigned demand / locked replacement / unchanged prices",
      );

      await prisma.rentalAsset.update({
        where: { id: asset.id },
        data: { status: "MAINTENANCE" },
      });
      const invalid = await service.scanOrder(seed.tenantId, moving.id);
      assert.match(invalid.assignment.issue, /维护/);
      assert.equal(
        invalid.allocations.find((a) => a.status === "locked").assetId,
        asset.id,
      );
      await prisma.rentalAsset.update({
        where: { id: asset.id },
        data: { status: "AVAILABLE" },
      });
      assert.equal(
        (await service.scanOrder(seed.tenantId, moving.id)).assignment.issue,
        undefined,
      );
      console.log(
        "PASS locked asset failure scanning / no silent replacement / recovery / deduplicated audit",
      );

      const config = {
        autoPreassign: false,
        preassignDays: 7,
        autoLock: false,
        lockMinutes: 120,
        protectManual: true,
      };
      const schedulerPrisma = new Proxy(prisma, {
        get(target, key) {
          if (key === "rentalTenantBusinessSettings")
            return {
              findMany: async () => [
                { ...context, settings: { allocation: config } },
              ],
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const scheduler = new RentalAllocationService(
        schedulerPrisma,
        facts,
        core,
      );
      const soon = await create(
        new Date(Date.now() + 3600_000).toISOString(),
        new Date(Date.now() + 7200_000).toISOString(),
      );
      soon.lines[0].itemGroupId = targetId;
      soon.reservations[0].itemGroupId = targetId;
      await facts.saveOrderAggregate(soon);
      await scheduler.runDue();
      assert.equal(
        (await facts.findOrder(seed.tenantId, soon.id)).allocations.length,
        0,
      );
      config.autoPreassign = true;
      config.autoLock = true;
      await scheduler.runDue();
      const scheduled = await facts.findOrder(seed.tenantId, soon.id);
      assert.equal(scheduled.status, "ready_for_pickup");
      assert.equal(scheduled.allocations[0].metadata.source, "automatic");
      assert.equal(scheduled.allocations[0].assetId, targetAssetId);
      config.autoPreassign = false;
      config.autoLock = false;
      await prisma.rentalAsset.update({
        where: { id: targetAssetId },
        data: { status: "MAINTENANCE" },
      });
      await scheduler.runDue();
      assert.match(
        (await facts.findOrder(seed.tenantId, soon.id)).assignment.issue,
        /维护/,
      );
      console.log(
        "PASS scheduler disabled default / automatic fill+lock / failure scan independent of automatic settings",
      );
      assert.ok(hooks >= 3);
      const quantityTarget = randomUUID();
      groupIds.push(quantityTarget);
      await prisma.rentalItemGroup.create({
        data: {
          id: quantityTarget,
          tenantId: seed.tenantId,
          workspaceId: seed.workspaceId,
          categoryCode: seed.categoryCode,
          code: quantityTarget,
          name: "数量改配目标",
          inventoryMode: "QUANTITY",
          attributes: {},
          status: "enabled",
        },
      });
      await prisma.rentalStockBalance.create({
        data: {
          tenantId: seed.tenantId,
          workspaceId: seed.workspaceId,
          itemGroupId: quantityTarget,
          locationId: asset.locationId,
          onHandQuantity: 2,
        },
      });
      modelList.push({
        id: quantityTarget,
        name: "数量改配目标",
        inventoryMode: "quantity",
        status: "enabled",
      });
      const quantityMoves = [];
      for (let i = 0; i < 2; i++) {
        const o = await create(
          "2049-01-01T10:00:00Z",
          "2049-01-01T12:00:00Z",
          2,
        );
        Object.assign(o.lines[0], {
          itemGroupId: quantityGroupId,
          inventoryMode: "quantity",
          pricingGroupId: pricingId,
          pricingGroupMemberItemGroupIds: [quantityGroupId, quantityTarget],
        });
        o.reservations[0].itemGroupId = quantityGroupId;
        await facts.saveOrderAggregate(o);
        quantityMoves.push(o);
      }
      const quantityRace = await Promise.allSettled(
        quantityMoves.map((o) =>
          prisma.$transaction(
            (tx) =>
              service.manage(
                seed.tenantId,
                o.id,
                {
                  action: "reassign",
                  expectedRevision: 0,
                  reason: "数量库存改配",
                  selections: [
                    {
                      reservationId: o.reservations[0].id,
                      itemGroupId: quantityTarget,
                      quantity: 1,
                    },
                  ],
                },
                tx,
                "tester",
              ),
            { isolationLevel: "ReadCommitted" },
          ),
        ),
      );
      assert.equal(
        quantityRace.filter((r) => r.status === "fulfilled").length,
        1,
        "部分实配也要为整条需求转移预留，不能超卖",
      );
      const quantityWinner = quantityRace.find(
        (r) => r.status === "fulfilled",
      ).value;
      assert.equal(quantityWinner.reservations[0].itemGroupId, quantityTarget);
      assert.equal(quantityWinner.reservations[0].quantity, 2);
      assert.equal(quantityWinner.allocations[0].quantity, 1);
      assert.equal(quantityWinner.status, "reserved");
      const loser = quantityMoves.find((o) => o.id !== quantityWinner.id);
      assert.equal(
        (await facts.findOrder(seed.tenantId, loser.id)).reservations[0]
          .itemGroupId,
        quantityGroupId,
      );
      console.log(
        "PASS quantity cross-model concurrent transfer / partial assignment preserves full reservation / loser rollback",
      );
    });
  } finally {
    if (ids.length)
      await prisma.rentalOrder.deleteMany({ where: { id: { in: ids } } });
    if (groupIds.length) {
      await prisma.rentalAsset.deleteMany({ where: { id: { in: assetIds } } });
      await prisma.rentalStockBalance.deleteMany({
        where: { itemGroupId: { in: groupIds } },
      });
      await prisma.rentalItemGroup.deleteMany({
        where: { id: { in: groupIds } },
      });
    }
    if (pricingIds.length)
      await prisma.rentalPricingGroup.deleteMany({
        where: { id: { in: pricingIds } },
      });
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
