const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// MKT-02C §4.3 最小验收：两单争抢最后一份容量只能一个成功；容量失败不改变有效结束时间与费用。
// 只允许在本次创建的专用克隆库上运行，由 tests/helpers/run-order-close-db.cjs 调用。
const url = new URL(process.env.DATABASE_URL || "mysql://invalid/invalid");
assert.match(url.pathname.slice(1), /^rental_os_dedicated_orderclose_\d+$/u, "只允许在本次专用克隆库上运行");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { PrismaService } = require("../apps/api/src/modules/database/prisma.service");
const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
const { RentalServiceCapacityService } = require("../apps/api/src/modules/rental-core/rental-service-capacity.service");
const { extensionRequestKey, serviceReservationKey, stampOccurrences } = require("../apps/api/src/modules/rental-core/rental-service-occurrence");
const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");

const prisma = new PrismaService();
const facts = new RentalCoreFactRepository(prisma);
const capacities = new RentalServiceCapacityService(prisma);

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const WINDOW_START = "2040-04-01T00:00:00.000Z";
const WINDOW_END = "2040-04-10T00:00:00.000Z";
const SLOT_START = "2040-04-02T00:00:00.000Z";
const SLOT_END = "2040-04-03T00:00:00.000Z";

const snapshotFor = (serviceId, locationId) => ({
  serviceId, serviceCode: "CAP", serviceName: "驻场助理", serviceType: "other",
  serviceVersion: "1.0", termsVersion: "1.0", workspaceId: "ws",
  unitPrice: 100, quantity: 1, billingUnits: 1, amount: 100,
  requiresCapacity: true, capacityQuantity: 1,
  scheduledStartAt: SLOT_START, scheduledEndAt: SLOT_END, serviceLocationId: locationId
});

void (async () => {
  const createdOrders = [];
  let capacityId;
  let serviceId;
  try {
    const base = await prisma.rentalOrder.findFirst({ where: { lines: { some: {} } }, include: { lines: true } });
    assert.ok(base, "克隆库需要一份已有订单做底稿");
    // 容量对服务与网点都是 (tenantId, workspaceId, id) 复合外键，两者必须同空间，
    // 否则建容量时报的是首列 tenantId 的外键失败，很容易误判成租户不存在。
    const service = await prisma.rentalValueAddedService.findFirst({
      where: { tenantId: base.tenantId, workspaceId: base.workspaceId }
    });
    assert.ok(service, "克隆库需要一个同空间的增值服务做容量归属");
    serviceId = service.id;
    const location = await prisma.rentalFulfillmentLocation.findFirstOrThrow({
      where: { tenantId: base.tenantId, workspaceId: base.workspaceId }
    });
    const identity = { tenantId: base.tenantId, workspaceId: base.workspaceId, userId: "capacity-contention-test" };

    await runWithRequestIdentity(identity, async () => {
      // 只留一份容量：两张订单抢它，必须只有一个成功。
      capacityId = randomUUID();
      await prisma.rentalServiceCapacity.create({
        data: {
          id: capacityId, tenantId: base.tenantId, workspaceId: base.workspaceId,
          serviceId, locationId: location.id,
          windowStart: new Date(WINDOW_START), windowEnd: new Date(WINDOW_END),
          totalCapacity: 1, reservedQuantity: 0, usedQuantity: 0, status: "enabled"
        }
      });

      const makeOrder = async () => {
        const id = randomUUID();
        const lineId = randomUUID();
        const domainBase = await facts.findOrder(base.tenantId, base.id);
        const order = {
          ...structuredClone(domainBase),
          id,
          orderNo: `capacity-${id.slice(0, 8)}`,
          status: "renting",
          assignment: undefined,
          feeReviews: undefined,
          startAt: WINDOW_START,
          endAt: SLOT_END,
          effectiveEndAt: SLOT_END,
          completedAt: undefined,
          cancelledAt: undefined,
          cancellationReason: undefined,
          serviceSnapshots: undefined,
          lines: [{ ...domainBase.lines[0], id: lineId, quantity: 1 }],
          reservations: [],
          allocations: []
        };
        await facts.saveOrderAggregate(order);
        createdOrders.push(id);
        return order;
      };

      /* ---------- 两单争抢最后一份容量 ---------- */

      let capacityWinner;
      {
        const first = await makeOrder();
        const second = await makeOrder();
        const snapshot = snapshotFor(serviceId, location.id);
        // 不加人为延迟：两边同时开事务真抢。早先在事务内 reserveForOrder 之前 sleep(60)，
        // 快的一方早就提交完了，两方实际串行，容量的乐观并发条件一次都没被触发。
        const attempt = (order) => prisma.$transaction(async (tx) => {
          await capacities.reserveForOrder(
            base.tenantId,
            { id: order.id, serviceSnapshots: [snapshot], reservations: [] },
            extensionRequestKey(`ext-${order.id}`),
            tx
          );
          return order.id;
        }).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error: error.message }));

        const [a, b] = await Promise.all([attempt(first), attempt(second)]);
        const winners = [a, b].filter((row) => row.ok);
        assert.equal(winners.length, 1, `最后一份容量只能被一个订单占走，实际 ${winners.length} 个成功`);
        capacityWinner = winners[0].value;
        const loser = [a, b].find((row) => !row.ok);
        assert.match(loser.error, /容量/u, "失败的一方必须明确报容量原因");
        const capacity = await prisma.rentalServiceCapacity.findUniqueOrThrow({ where: { id: capacityId } });
        assert.equal(capacity.reservedQuantity, 1, "容量账必须只加一次");
        const rows = await prisma.rentalServiceReservation.findMany({ where: { capacityId } });
        assert.equal(rows.length, 1, "只能留下一条预留流水");
        assert.equal(rows[0].orderId, capacityWinner, "留下的那条必须属于成功的那张订单");
        ok("两单真并发抢最后一份容量只有一个成功，容量账与预留流水都只加一次");
      }

      /* ---------- 容量失败时有效结束时间与费用一起回滚 ---------- */

      {
        const order = await makeOrder();
        const beforeEnd = (await prisma.rentalOrder.findUniqueOrThrow({ where: { id: order.id }, select: { effectiveEndAt: true } })).effectiveEndAt;
        const extended = structuredClone(order);
        extended.effectiveEndAt = "2040-04-09T00:00:00.000Z";
        extended.chargeLines = [...(extended.chargeLines ?? []), { code: "extension:1:service", name: "本次新增服务费", type: "service", amount: 100 }];
        extended.serviceSnapshots = stampOccurrences([snapshotFor(serviceId, location.id)], {
          origin: "extension", ownerId: "ext_fail", requestKey: extensionRequestKey("ext_fail"), extensionId: "ext_fail", extensionSequence: 1
        });
        await assert.rejects(
          () => prisma.$transaction(async (tx) => {
            // 与续租生效同一顺序：先写订单聚合（租期 + 费用），再占容量。
            await facts.saveOrderAggregate(extended, [], tx);
            await capacities.reserveForOrder(
              base.tenantId,
              { id: order.id, serviceSnapshots: extended.serviceSnapshots, reservations: [] },
              extensionRequestKey("ext_fail"),
              tx
            );
          }),
          /容量/u,
          "容量已被占满时续租生效必须失败"
        );
        const after = await prisma.rentalOrder.findUniqueOrThrow({
          where: { id: order.id }, select: { effectiveEndAt: true, chargeLines: true, serviceSnapshots: true }
        });
        assert.equal(after.effectiveEndAt.toISOString(), beforeEnd.toISOString(), "容量失败不能留下已延长的有效结束时间");
        assert.equal((after.chargeLines ?? []).some((row) => row.code === "extension:1:service"), false, "服务费必须一起回滚");
        assert.equal(after.serviceSnapshots, null, "发生项必须一起回滚，不能留下没有容量的履约承诺");
        ok("容量失败时租期、服务费与服务发生项一起回滚，不留半笔");
      }

      /* ---------- 重复释放不污染别次预留 ---------- */

      {
        // 先把容量放宽到 2 并给**另一张订单**也占一份：只有存在别次预留，才能证明
        // 释放一单不会顺手把别人的放掉。早先只有一条预留，这一组其实什么都没证明。
        await prisma.rentalServiceCapacity.update({ where: { id: capacityId }, data: { totalCapacity: 3 } });
        const bystander = await makeOrder();
        await prisma.$transaction((tx) => capacities.reserveForOrder(
          base.tenantId,
          { id: bystander.id, serviceSnapshots: [snapshotFor(serviceId, location.id)], reservations: [] },
          extensionRequestKey(`ext-bystander-${bystander.id}`),
          tx
        ));
        const before = await prisma.rentalServiceCapacity.findUniqueOrThrow({ where: { id: capacityId } });
        assert.equal(before.reservedQuantity, 2, "此时应有两条占用：抢赢那单与旁观那单");

        await prisma.$transaction((tx) => capacities.releaseForOrder(base.tenantId, capacityWinner, "test_release", new Date().toISOString(), tx));
        const afterFirst = await prisma.rentalServiceCapacity.findUniqueOrThrow({ where: { id: capacityId } });
        await prisma.$transaction((tx) => capacities.releaseForOrder(base.tenantId, capacityWinner, "test_release_again", new Date().toISOString(), tx));
        const afterSecond = await prisma.rentalServiceCapacity.findUniqueOrThrow({ where: { id: capacityId } });
        assert.equal(afterFirst.reservedQuantity, 1, "释放抢赢那单只还回一份，旁观那单的占用必须留着");
        assert.equal(afterSecond.reservedQuantity, 1, "重复释放是幂等的，不能把容量账继续往下减");
        const bystanderRow = await prisma.rentalServiceReservation.findFirstOrThrow({ where: { capacityId, orderId: bystander.id } });
        assert.equal(bystanderRow.status, "reserved", "别次预留的状态不能被这次释放改掉");
        assert.equal(bystanderRow.releasedAt, null, "别次预留不能被标记成已释放");
        ok("释放一单的容量只还回它自己那份：重复释放幂等，别次预留的额度与状态都不受影响");
      }

      console.log(`\n服务容量争抢与回滚真库专项：${passed} 项全部通过`);
    });
  } finally {
    for (const id of createdOrders) {
      await prisma.rentalOrder.deleteMany({ where: { id } }).catch(() => {});
    }
    if (capacityId) {
      await prisma.rentalServiceReservation.deleteMany({ where: { capacityId } }).catch(() => {});
      await prisma.rentalServiceCapacity.deleteMany({ where: { id: capacityId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
