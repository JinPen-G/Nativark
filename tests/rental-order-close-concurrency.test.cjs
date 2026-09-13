const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// ORDER-CLOSE-01 §4.1 最小真库：只允许在本次创建的专用克隆库上运行。
// 由 tests/helpers/run-order-close-db.cjs 备份→克隆→迁移→注入 DATABASE_URL 后调用。
const url = new URL(process.env.DATABASE_URL || "mysql://invalid/invalid");
assert.match(url.pathname.slice(1), /^rental_os_dedicated_orderclose_\d+$/u, "只允许在本次专用克隆库上运行");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { PrismaService } = require("../apps/api/src/modules/database/prisma.service");
const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
const { RentalCoreConfigRepository } = require("../apps/api/src/modules/rental-core/rental-core-config.repository");
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalIdempotencyRepository } = require("../apps/api/src/modules/rental-core/rental-idempotency.repository");
const { RentalIdempotentActionService } = require("../apps/api/src/modules/rental-core/rental-idempotent-action.service");
const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");

const prisma = new PrismaService();
const facts = new RentalCoreFactRepository(prisma);
// 真实的领域服务：组二要断言「锁内读到的待审事项**真的**拦住关单」，
// 自己再实现一遍闸门只能证明测试自己会拒。
const core = new RentalCoreService(new RentalCoreConfigRepository(prisma), facts);
const idempotent = new RentalIdempotentActionService(prisma, new RentalIdempotencyRepository(prisma));

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PLANNED_END = "2040-03-05T10:00:00.000Z";
const EXTENDED_END = "2040-03-08T10:00:00.000Z";

/**
 * 以克隆库里已有订单为底稿，造一张「租赁中 + 数量库存」的订单。
 *
 * 直接复制底稿再改写字段：订单聚合列很多，手写一份必然和真实写入口径分叉，
 * 而这个专项要验的正是真实写入路径。
 */
async function createRentingOrder(base, target, { quantity = 2 } = {}) {
  const id = randomUUID();
  const lineId = randomUUID();
  const reservationId = randomUUID();
  const order = {
    ...structuredClone(base),
    id,
    orderNo: `orderclose-${id.slice(0, 8)}`,
    status: "renting",
    assignment: undefined,
    feeReviews: undefined,
    fulfillmentLocationId: target.locationId,
    returnLocationId: target.locationId,
    startAt: "2040-03-01T10:00:00.000Z",
    endAt: PLANNED_END,
    effectiveEndAt: PLANNED_END,
    completedAt: undefined,
    cancelledAt: undefined,
    cancellationReason: undefined,
    lines: [{ ...base.lines[0], id: lineId, itemGroupId: target.itemGroupId, inventoryMode: "quantity", quantity }],
    reservations: [{
      id: reservationId,
      orderId: id,
      orderLineId: lineId,
      itemGroupId: target.itemGroupId,
      locationId: target.locationId,
      quantity,
      releasedQuantity: 0,
      status: "fulfilled",
      createdAt: new Date().toISOString()
    }],
    allocations: [{
      id: randomUUID(),
      orderId: id,
      orderLineId: lineId,
      itemGroupId: target.itemGroupId,
      quantity,
      status: "picked_up"
    }]
  };
  await facts.saveOrderAggregate(order);
  return order;
}

const statusOf = async (orderId) =>
  (await prisma.rentalOrder.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status;
const maintenanceOf = async (target) =>
  (await prisma.rentalStockBalance.findFirstOrThrow({
    where: { itemGroupId: target.itemGroupId, locationId: target.locationId },
    select: { maintenanceQuantity: true }
  })).maintenanceQuantity;

void (async () => {
  const created = [];
  try {
    const base = await prisma.rentalOrder.findFirst({ where: { lines: { some: {} } }, include: { lines: true } });
    assert.ok(base, "克隆库需要一份已有订单做底稿");
    const balance = await prisma.rentalStockBalance.findFirstOrThrow({
      select: { itemGroupId: true, locationId: true, onHandQuantity: true, maintenanceQuantity: true }
    });
    const target = { itemGroupId: balance.itemGroupId, locationId: balance.locationId };
    const identity = { tenantId: base.tenantId, workspaceId: base.workspaceId, userId: "order-close-test" };

    await runWithRequestIdentity(identity, async () => {
      const domainBase = await facts.findOrder(base.tenantId, base.id);
      assert.ok(domainBase, "底稿订单必须能按领域对象读出");

      /* ---------- 组一：续租与归还竞争 ---------- */

      {
        const order = await createRentingOrder(domainBase, target);
        created.push(order.id);
        let seenByReturn;
        let lockWaitMs;
        // T1 锁住订单行、把有效归还时间推到续租后的时间，提交前故意停留 300ms。
        const extend = prisma.$transaction(async (tx) => {
          await facts.lockOrder(base.tenantId, order.id, tx);
          await sleep(300);
          await tx.rentalOrder.update({ where: { id: order.id }, data: { effectiveEndAt: new Date(EXTENDED_END) } });
        });
        // T2 晚 80ms 开始，必须在锁上等待，拿到的只能是续租之后的事实。
        const settleBasis = (async () => {
          await sleep(80);
          return prisma.$transaction(async (tx) => {
            const startedAt = process.hrtime.bigint();
            await facts.lockOrder(base.tenantId, order.id, tx);
            lockWaitMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            const locked = await facts.findOrder(base.tenantId, order.id, tx);
            seenByReturn = locked.effectiveEndAt;
          });
        })();
        await Promise.all([extend, settleBasis]);
        assert.equal(new Date(seenByReturn).toISOString(), EXTENDED_END,
          "锁内读到的必须是续租后的有效归还时间；读到计划时间说明归还会按旧租期判逾期");
        // 只断言"读到了新值"不够：机器卡顿时 T2 可能压根没等过锁，断言会变成恒真。
        // T1 持锁 300ms、T2 晚 80ms 起跑，因此真被挡住时等待应在 200ms 量级；
        // 没有行锁的话这一句是个数毫秒的查询。阈值取 150ms，留足抖动余量。
        assert.ok(lockWaitMs > 150,
          `T2 必须真的在订单行锁上等待过，实际只等了 ${lockWaitMs.toFixed(1)}ms——说明没有被锁串行化`);
        ok("续租与归还竞争：归还侧确实被订单行锁挡住并等到续租提交，读到的是新的有效归还时间");
      }

      /* ---------- 组二：费用裁定与结算竞争 ---------- */

      {
        const order = await createRentingOrder(domainBase, target);
        created.push(order.id);
        const pending = [{
          id: randomUUID(), type: "overdue", suggestedAmount: 120, basis: ["逾期 2 小时"],
          status: "pending", createdAt: new Date().toISOString()
        }];
        let unlockedRead;
        let lockedRead;
        // T1 扮演费用裁定：锁住订单行后生成一笔待审事项，提交前停留。
        const raiseReview = prisma.$transaction(async (tx) => {
          await facts.lockOrder(base.tenantId, order.id, tx);
          await sleep(300);
          await tx.rentalOrder.update({ where: { id: order.id }, data: { feeReviews: pending } });
        });
        // T2 扮演结算：先做一次「锁之前」的读（修复前的顺序），再按修复后的顺序锁后再读。
        const settle = (async () => {
          await sleep(80);
          unlockedRead = (await prisma.rentalOrder.findUniqueOrThrow({
            where: { id: order.id }, select: { feeReviews: true }
          })).feeReviews;
          return prisma.$transaction(async (tx) => {
            await facts.lockOrder(base.tenantId, order.id, tx);
            lockedRead = (await tx.rentalOrder.findUniqueOrThrow({
              where: { id: order.id }, select: { feeReviews: true }
            })).feeReviews;
          });
        })();
        await Promise.all([raiseReview, settle]);
        assert.equal(unlockedRead, null, "锁之前读到的还是旧事实：待审事项尚未提交，这正是修复前结算依赖的读");
        assert.equal(Array.isArray(lockedRead) && lockedRead.length, 1, "锁之后必须看到刚生成的待审费用事项");
        assert.equal(lockedRead[0].status, "pending", "待审状态必须可见，否则欠款订单会被直接关掉");
        // 关键补强：证明服务端的关单闸门读的就是这一列、并且真的会拒。
        // 只对比"锁前读不到、锁后读得到"不足以说明结算会被拦住——那两个读都是本专项自己发的。
        // settleOrder 要求订单处于待结算，因此先推进状态再验闸门。
        await prisma.rentalOrder.update({ where: { id: order.id }, data: { status: "SETTLING" } });
        await assert.rejects(
          () => prisma.$transaction((tx) => core.settleOrder(base.tenantId, order.id, tx, "结算员")),
          /费用审核单待处理/u,
          "锁内读到的待审事项必须真的拦住 settleOrder"
        );
        assert.equal(await statusOf(order.id), "SETTLING", "被拦住时订单不能被推进到已完成");
        ok("费用裁定与结算竞争：锁前读不到、锁后读得到，且锁内读到的待审事项真的拦住了 settleOrder");
      }

      /* ---------- 组三：同批重试只归还一次，不同批各归还一次 ---------- */

      {
        const order = await createRentingOrder(domainBase, target);
        created.push(order.id);
        const reservationId = order.reservations[0].id;
        const releaseOne = (batchNo) => idempotent.execute({
          tenantId: base.tenantId,
          action: "order.partial-return",
          key: undefined,
          fallbackKey: `order.partial-return:${order.id}:${batchNo}`,
          request: { orderId: order.id, items: [{ allocationId: order.allocations[0].id, quantity: 1 }], batchNo },
          orderId: order.id,
          run: async (tx) => {
            await facts.lockOrder(base.tenantId, order.id, tx);
            await tx.rentalReservation.update({
              where: { id: reservationId },
              data: { releasedQuantity: { increment: 1 } }
            });
            return { released: batchNo };
          },
          // 与生产同语义：只有目标状态已达成才回放，否则返回 undefined 交回状态机。
          // 早先写成 `response ?? {...}` 永不返回 undefined，正好绕开了这条语义。
          replay: async (response) => (response && response.released === batchNo ? response : undefined)
        });
        await releaseOne("batch-1");
        await releaseOne("batch-1");
        const afterRetry = await prisma.rentalReservation.findUniqueOrThrow({
          where: { id: reservationId }, select: { releasedQuantity: true }
        });
        assert.equal(afterRetry.releasedQuantity, 1, "同一批次重复提交是网络重试，只能归还一次");
        await releaseOne("batch-2");
        const afterSecondBatch = await prisma.rentalReservation.findUniqueOrThrow({
          where: { id: reservationId }, select: { releasedQuantity: true }
        });
        assert.equal(afterSecondBatch.releasedQuantity, 2, "第二个批次是第二次真实归还，数量必须再减一件");
        ok("同批重试只归还一次、不同批相同数量各归还一次——真库里落到 releasedQuantity 上");
      }

      /* ---------- 组四：隔离写入失败整次归还回滚 ---------- */

      {
        const order = await createRentingOrder(domainBase, target);
        created.push(order.id);
        const before = await maintenanceOf(target);
        const returned = structuredClone(order);
        returned.status = "settling";
        returned.reservations[0].status = "released";
        returned.reservations[0].releasedQuantity = returned.reservations[0].quantity;
        returned.allocations[0].status = "returned";
        await assert.rejects(
          () => prisma.$transaction(async (tx) => {
            await facts.saveOrderAggregate(returned, [], tx, [
              // 故意指向没有库存台账的组合：隔离写不进去时整次归还必须回滚，
              // 而不是留下「订单已归还、坏货已回可用池」。
              { itemGroupId: randomUUID(), locationId: target.locationId, quantity: 1 }
            ]);
          }),
          /没有库存台账，无法隔离/u,
          "隔离写不进去必须报错"
        );
        assert.equal(await statusOf(order.id), "RENTING", "整次归还必须回滚，订单不能停在待结算");
        const reservation = await prisma.rentalReservation.findUniqueOrThrow({
          where: { id: order.reservations[0].id }, select: { releasedQuantity: true, status: true }
        });
        assert.equal(reservation.releasedQuantity, 0, "预占释放量必须一起回滚");
        assert.equal(reservation.status, "FULFILLED", "预占状态必须一起回滚");
        assert.equal(await maintenanceOf(target), before, "失败的隔离不能留下半笔维修量");
        ok("隔离写入失败时整次归还回滚：订单状态、预占释放量与维修量都不留半笔");
      }

      console.log(`\n订单事务一致性真库专项：${passed} 项全部通过`);
    });
  } finally {
    for (const id of created) {
      await prisma.rentalOrder.deleteMany({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
