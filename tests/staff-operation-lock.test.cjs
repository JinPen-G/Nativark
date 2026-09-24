"use strict";

const test = require("node:test");
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

const { ConflictException, BadRequestException } = require("@nestjs/common");
const { RentalAllocationService } = require("../apps/api/src/modules/rental-core/rental-allocation.service");
const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");

const identity = {
  tenantId: "tenant-one",
  workspaceId: "workspace-one",
  userId: "manager-one",
  isSaasAdmin: false,
};

function fixture(lockOverrides = {}) {
  const lock = {
    ownerId: "employee-one",
    ownerName: "员工甲",
    token: "private-lock-token",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    ...lockOverrides,
  };
  const order = {
    id: "order-one",
    status: "ready_for_pickup",
    assignment: { revision: 8, history: [], operationLock: lock },
  };
  const saved = [];
  const audit = [];
  const transactions = [];
  const tx = { operationLog: { create: async (input) => { audit.push(input); return input; } } };
  const facts = {
    lockOrder: async () => undefined,
    findOrder: async () => structuredClone(order),
    saveOrderAggregate: async (nextOrder) => { saved.push(structuredClone(nextOrder)); },
  };
  const prisma = {
    $transaction: async (run, options) => {
      transactions.push(options);
      return run(tx);
    },
  };
  return {
    service: new RentalAllocationService(prisma, facts, {}),
    order,
    saved,
    audit,
    transactions,
  };
}

test("主管可带原因、在同一事务内解除他人未过期交接锁并留下双重审计", async () => {
  const state = fixture();
  const result = await runWithRequestIdentity(identity, () => state.service.operationLock(
    "tenant-one", "order-one", "force-release", "manager-one", "主管乙", undefined,
    undefined, "员工离岗，由主管接手",
  ));

  assert.deepEqual(result, {
    released: true,
    releasedOwnerName: "员工甲",
    expiresAt: state.order.assignment.operationLock.expiresAt,
  });
  assert.equal(state.transactions.length, 1);
  assert.equal(state.transactions[0].isolationLevel, "ReadCommitted");
  assert.equal(state.saved.length, 1);
  assert.equal(state.saved[0].assignment.revision, 9);
  assert.equal(state.saved[0].assignment.operationLock, undefined);
  assert.equal(state.saved[0].assignment.history[0].action, "operation_force_release");
  assert.match(state.saved[0].assignment.history[0].reason, /员工离岗，由主管接手/);
  assert.equal(state.audit.length, 1);
  assert.equal(state.audit[0].data.action, "rental.order.operation_lock.force_release");
  assert.equal(state.audit[0].data.workspaceId, "workspace-one");
  assert.equal(state.audit[0].data.userId, "manager-one");
  assert.deepEqual(state.audit[0].data.detail, {
    operator: "主管乙",
    reason: "员工离岗，由主管接手",
    releasedOwnerId: "employee-one",
    releasedOwnerName: "员工甲",
    expiresAt: state.order.assignment.operationLock.expiresAt,
    revision: 9,
  });
});

test("人工解除拒绝无原因、本人锁、无锁及过期锁", async () => {
  const missingReason = fixture();
  await assert.rejects(
    () => runWithRequestIdentity(identity, () => missingReason.service.operationLock(
      "tenant-one", "order-one", "force-release", "manager-one", "主管乙",
    )),
    BadRequestException,
  );

  const ownLock = fixture({ ownerId: "manager-one", ownerName: "主管乙" });
  await assert.rejects(
    () => runWithRequestIdentity(identity, () => ownLock.service.operationLock(
      "tenant-one", "order-one", "force-release", "manager-one", "主管乙", undefined,
      undefined, "本人锁不得强制释放",
    )),
    ConflictException,
  );

  const noLock = fixture();
  noLock.order.assignment.operationLock = undefined;
  noLock.service.facts.findOrder = async () => structuredClone(noLock.order);
  await assert.rejects(
    () => runWithRequestIdentity(identity, () => noLock.service.operationLock(
      "tenant-one", "order-one", "force-release", "manager-one", "主管乙", undefined,
      undefined, "已不存在",
    )),
    ConflictException,
  );

  const expiredLock = fixture({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
  await assert.rejects(
    () => runWithRequestIdentity(identity, () => expiredLock.service.operationLock(
      "tenant-one", "order-one", "force-release", "manager-one", "主管乙", undefined,
      undefined, "锁已过期",
    )),
    ConflictException,
  );

  for (const state of [missingReason, ownLock, noLock, expiredLock]) {
    assert.equal(state.saved.length, 0, "拒绝的请求不得修改订单状态");
    assert.equal(state.audit.length, 0, "拒绝的请求不得留下成功解除审计");
  }
});
