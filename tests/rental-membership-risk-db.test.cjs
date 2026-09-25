const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const { resolveDedicatedTarget } = require("../scripts/ops/dedicated-env.cjs");

const target = resolveDedicatedTarget(process.env.DATABASE_URL);
assert.match(target.database, /^rental_os_dedicated_member_risk_\d+$/u,
  "会员风控真库专项只允许运行在本次创建的专用克隆库");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
    experimentalDecorators: true,
    emitDecoratorMetadata: true
  }
});

const { PrismaClient } = require("@prisma/client");
const { MembershipService } = require("../apps/api/src/modules/platform/membership.service");
const { CustomerOperationsRepository } = require("../apps/api/src/modules/platform/customer-operations.repository");

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/gu, "").slice(0, 12);
const tenantId = `mbrisk_${suffix}`;
const otherTenantId = `mbrisk_other_${suffix}`;
const cameraId = `mbrisk_camera_${suffix}`;
const campingId = `mbrisk_camping_${suffix}`;
const otherCameraId = `mbrisk_other_camera_${suffix}`;
const operations = new CustomerOperationsRepository(prisma);
const memberships = new MembershipService(prisma, operations);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function phone() {
  const suffixDigits = String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, "0");
  return `139${suffixDigits}`;
}

async function createCustomer(ownerTenantId, name) {
  const value = phone();
  return prisma.customerProfile.create({
    data: {
      tenantId: ownerTenantId,
      customerType: "personal",
      name,
      phone: value,
      phoneMasked: `${value.slice(0, 3)}****${value.slice(-4)}`,
      qualifications: {}
    }
  });
}

async function createRisk(customer, { workspaceId = null, status = "open", riskType = "deposit_review" } = {}) {
  return prisma.customerRiskRecord.create({
    data: {
      tenantId: customer.tenantId,
      customerId: customer.id,
      workspaceId,
      riskType,
      level: "high",
      detail: "会员押金权益风控真库专项",
      source: "manual",
      status,
      raisedAt: new Date()
    }
  });
}

async function seed() {
  await prisma.tenant.create({ data: { id: tenantId, code: tenantId, name: "会员风险隔离真库专项" } });
  await prisma.tenant.create({ data: { id: otherTenantId, code: otherTenantId, name: "会员风险租户隔离对照" } });

  for (const workspace of [
    { id: cameraId, tenantId, code: "camera", categoryCode: "CAMERA", isDefault: true },
    { id: campingId, tenantId, code: "camping", categoryCode: "CAMPING", isDefault: false },
    { id: otherCameraId, tenantId: otherTenantId, code: "camera", categoryCode: "CAMERA", isDefault: true }
  ]) {
    await prisma.businessWorkspace.create({
      data: {
        ...workspace,
        name: workspace.code,
        isDefault: workspace.isDefault,
        defaultMarker: workspace.isDefault ? "default" : workspace.id
      }
    });
  }
}

async function cleanup() {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
}

async function main() {
  let passed = 0;
  const pass = (message) => {
    passed += 1;
    console.log(`PASS ${message}`);
  };

  try {
    await seed();
    const actualDatabase = await prisma.$queryRaw`SELECT DATABASE() AS name`;
    assert.equal(actualDatabase[0].name, target.database, "Prisma 实际连接库必须是本次专用克隆库");
    const personal = await createCustomer(tenantId, "风险测试个人会员");
    const unrelated = await createCustomer(tenantId, "无关会员");
    const corporate = await createCustomer(tenantId, "企业主体");
    const otherTenantCustomer = await createCustomer(otherTenantId, "另一租户会员");

    const personalSnapshot = { personalCustomerId: personal.id };
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, cameraId, personalSnapshot), false);
    pass("无风险会员通过数据库查询，空结果不会误拦");

    await createRisk(personal, { workspaceId: campingId });
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, cameraId, personalSnapshot), false,
      "其他空间的风险不得串入当前空间");
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, campingId, personalSnapshot), true,
      "当前空间的开放风险必须拦截权益");
    pass("空间级风险仅影响所属经营空间");

    await prisma.customerRiskRecord.updateMany({ where: { tenantId, customerId: personal.id }, data: { status: "reviewing" } });
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, campingId, personalSnapshot), true,
      "reviewing 仍属于未关闭风险");
    await prisma.customerRiskRecord.updateMany({ where: { tenantId, customerId: personal.id }, data: { status: "closed" } });
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, campingId, personalSnapshot), false,
      "closed 风险不得继续阻止权益");
    pass("reviewing 拦截、closed 释放，状态判定符合未关闭定义");

    await createRisk(personal, { workspaceId: null });
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, cameraId, personalSnapshot), true);
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, campingId, personalSnapshot), true);
    pass("租户级风险同时作用于该租户全部经营空间");

    await prisma.customerRiskRecord.deleteMany({ where: { tenantId, customerId: personal.id } });
    await createRisk(corporate, { workspaceId: cameraId });
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, cameraId, personalSnapshot), false,
      "个人会员无风险时，不得误读同租户其他客户的风险");
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, cameraId, {
      personalCustomerId: personal.id,
      corporateCustomerId: corporate.id
    }), true, "企业预约必须同时检查个人与企业主体");
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, cameraId, {
      personalCustomerId: unrelated.id
    }), false);
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, cameraId, {
      personalCustomerId: otherTenantCustomer.id
    }), false, "另一租户客户的风险不得跨租户命中");
    pass("个人/企业双主体、客户隔离和租户隔离均由实际 repository 查询验证");

    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, cameraId, {
      personalCustomerId: `missing_${suffix}`
    }, prisma), true, "事务内主体不存在时必须 fail-closed");
    pass("订单事务内会员主档缺失按有风险处理");

    const raceCustomer = await createCustomer(tenantId, "风险并发会员");
    let releaseTransaction;
    let announceLock;
    const holdTransaction = new Promise((resolve) => { releaseTransaction = resolve; });
    const lockReady = new Promise((resolve) => { announceLock = resolve; });
    const gateTransaction = prisma.$transaction(async (tx) => {
      const blocked = await memberships.hasOpenRiskForBooking(tenantId, cameraId, {
        personalCustomerId: raceCustomer.id
      }, tx);
      assert.equal(blocked, false, "插入风险前，锁内复查应读到无风险");
      const connection = await tx.$queryRaw`SELECT CONNECTION_ID() AS id, DATABASE() AS name`;
      assert.equal(connection[0].name, target.database);
      announceLock();
      await holdTransaction;
    });

    let insertSettled = false;
    let updateSettled = false;
    let announceInsertStarted;
    let announceUpdateStarted;
    const insertStarted = new Promise((resolve) => { announceInsertStarted = resolve; });
    const updateStarted = new Promise((resolve) => { announceUpdateStarted = resolve; });
    let insertPromise;
    let updatePromise;
    try {
      await Promise.race([
        lockReady,
        pause(5000).then(() => { throw new Error("会员风控事务未能取得客户主档行锁"); })
      ]);
      insertPromise = prisma.$transaction(async (tx) => {
        const connection = await tx.$queryRaw`SELECT CONNECTION_ID() AS id, DATABASE() AS name`;
        assert.equal(connection[0].name, target.database);
        announceInsertStarted();
        if (!(await operations.lockCustomerBusinessGate(tenantId, raceCustomer.id, tx))) {
          throw new Error("并发风险写入未能锁定客户主档");
        }
        return tx.customerRiskRecord.create({
          data: {
            tenantId,
            customerId: raceCustomer.id,
            workspaceId: cameraId,
            riskType: "concurrent_risk",
            level: "high",
            detail: "并发插入验证",
            source: "manual",
            status: "open",
            raisedAt: new Date()
          }
        });
      }).then((row) => {
        insertSettled = true;
        return { row };
      }, (error) => {
        insertSettled = true;
        return { error };
      });
      updatePromise = prisma.$transaction(async (tx) => {
        const connection = await tx.$queryRaw`SELECT CONNECTION_ID() AS id, DATABASE() AS name`;
        assert.equal(connection[0].name, target.database);
        announceUpdateStarted();
        return tx.customerProfile.update({
          where: { id: raceCustomer.id },
          data: { region: "row_lock_probe" }
        });
      }).then((row) => {
        updateSettled = true;
        return { row };
      }, (error) => {
        updateSettled = true;
        return { error };
      });
      await Promise.race([
        Promise.all([insertStarted, updateStarted]),
        pause(5000).then(() => { throw new Error("会员风控并发写入未到达数据库连接"); })
      ]);
      const blocked = await Promise.race([
        Promise.all([insertPromise, updatePromise]).then((results) => ({ state: "settled", results })),
        pause(300).then(() => ({ state: "waiting" }))
      ]);
      if (blocked.state === "settled") {
        for (const result of blocked.results) assert.ifError(result.error);
      }
      assert.equal(blocked.state, "waiting", "同一客户主档行锁必须阻止风险写入与主档并发更新");
      if (updateSettled) {
        const result = await updatePromise;
        assert.ifError(result.error);
      }
      assert.equal(updateSettled, false, "测试必须先证明同一主档的行锁确实阻止并发更新");
      if (insertSettled) {
        const result = await insertPromise;
        assert.ifError(result.error);
      }
      assert.equal(insertSettled, false,
        "风险记录写入必须被订单事务持有的客户主档锁挡住，不能在最终检查与订单提交之间插入");
    } finally {
      releaseTransaction();
    }

    await gateTransaction;
    const insertResult = await insertPromise;
    assert.ifError(insertResult.error);
    const updateResult = await updatePromise;
    assert.ifError(updateResult.error);
    assert.equal(await memberships.hasOpenRiskForBooking(tenantId, cameraId, {
      personalCustomerId: raceCustomer.id
    }), true, "订单事务释放锁后，并发风险记录应可落库并被后续复查读到");
    pass("MySQL 并发验证：最终风控复查持有主档锁，受支持的风险写入先取同一锁并等待订单事务结束");

    console.log(`Member risk database tests passed: ${passed} groups`);
  } finally {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
