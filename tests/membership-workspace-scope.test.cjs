const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { MembershipService } = require("../apps/api/src/modules/platform/membership.service");
const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");

function createFixture({ member = true, customerType = "personal", accountStatus = "active" } = {}) {
  const calls = [];
  const customerId = customerType === "personal" ? "customer-1" : "corporate-1";
  const customer = { id: customerId, tenantId: "tenant-a", customerType, phone: "13800000000", phoneMasked: "138****0000" };
  const membership = { id: "membership-1", tenantId: "tenant-a", customerId, status: "active" };
  const account = { status: accountStatus, loginPhoneMasked: customer.phoneMasked, mustChangePassword: false };
  const now = new Date();
  const employee = {
    id: "employee-1", tenantId: "tenant-a", corporateCustomerId: customerId, personalCustomerId: "employee-customer",
    role: "admin", status: "active", effectiveFrom: now, effectiveTo: null, createdAt: now, updatedAt: now,
    personalCustomer: { name: "共享员工" }
  };
  const prisma = {
    calls,
    businessWorkspace: {
      async findFirst({ where }) {
        return where.tenantId === "tenant-a" && ["workspace-a", "workspace-b"].includes(where.id) ? { id: where.id } : null;
      }
    },
    customerProfile: {
      async findFirst({ where }) {
        calls.push({ model: "customerProfile.findFirst", where });
        return where.tenantId === customer.tenantId && where.id === customer.id ? customer : null;
      }
    },
    customerMembership: {
      async findUnique({ where }) {
        calls.push({ model: "customerMembership.findUnique", where });
        const key = where.tenantId_customerId;
        return member && key?.tenantId === membership.tenantId && key.customerId === membership.customerId ? membership : null;
      }
    },
    customerAccount: {
      async upsert(input) {
        calls.push({ model: "customerAccount.upsert", input });
        assert.deepEqual(input.where, { tenantId_customerId: { tenantId: "tenant-a", customerId } });
        Object.assign(account, input.update);
        return account;
      }
    },
    customerCorporateMembership: {
      async findMany({ where }) {
        calls.push({ model: "customerCorporateMembership.findMany", where });
        assert.deepEqual(where, { tenantId: "tenant-a", corporateCustomerId: customerId });
        return [employee];
      }
    },
    async $transaction(work) { return work(prisma); }
  };
  const operations = {
    async lockCustomerBusinessGate(tenantId, id, tx) {
      assert.equal(tx, prisma, "客户锁与账号更新必须使用同一事务");
      calls.push({ model: "lockCustomerBusinessGate", tenantId, customerId: id });
      return tenantId === customer.tenantId && id === customer.id;
    }
  };
  return { prisma, membership, account, service: new MembershipService(prisma, operations) };
}

void (async () => {
  const fixture = createFixture();
  for (const workspaceId of ["workspace-a", "workspace-b"]) {
    const result = await runWithRequestIdentity({ tenantId: "tenant-a", workspaceId }, async () => {
      const membership = await fixture.service.assertCustomerInWorkspace("tenant-a", workspaceId, "customer-1");
      assert.equal(membership.id, "membership-1", "切空间复用唯一租户会员，不要求再次接入");
      return fixture.service.setTemporaryPassword("tenant-a", "customer-1", "Temp1234", "管理员");
    });
    assert.equal(result.provisioned, true);
    assert.equal(result.mustChangePassword, true);
  }
  assert.equal(fixture.prisma.calls.filter((call) => call.model === "customerAccount.upsert").length, 2);
  assert.ok(fixture.prisma.calls.filter((call) => call.model === "customerMembership.findUnique").every((call) =>
    JSON.stringify(call.where) === JSON.stringify({ tenantId_customerId: { tenantId: "tenant-a", customerId: "customer-1" } })
  ));
  console.log("  PASS 两空间共享同一租户会员与临时密码入口");

  const missing = createFixture({ member: false });
  await assert.rejects(() => missing.service.setTemporaryPassword("tenant-a", "customer-1", "Temp1234", "管理员"), /尚未开通租户会员/u);
  assert.equal(missing.prisma.calls.some((call) => call.model === "customerAccount.upsert"), false);
  await assert.rejects(() => fixture.service.setTemporaryPassword("tenant-b", "customer-1", "Temp1234", "管理员"), /客户不存在/u);
  await assert.rejects(() => fixture.service.assertCustomerInWorkspace("tenant-a", "foreign-workspace", "customer-1"), /经营空间不存在或不属于本租户/u);
  console.log("  PASS 缺少会员、跨租户客户和外租户业务空间仍拒绝");

  const suspended = createFixture({ accountStatus: "suspended" });
  await suspended.service.setTemporaryPassword("tenant-a", "customer-1", "Temp1234", "管理员");
  assert.equal(suspended.account.status, "suspended", "重置密码不能解除账号暂停");
  assert.equal(suspended.membership.status, "active", "账号状态与会员状态独立");

  const corporate = createFixture({ customerType: "corporate" });
  const lists = [];
  for (const workspaceId of ["workspace-a", "workspace-b"]) {
    lists.push(await runWithRequestIdentity({ tenantId: "tenant-a", workspaceId }, () => corporate.service.listCorporateEmployees("tenant-a", "corporate-1")));
  }
  assert.deepEqual(lists[0], lists[1]);
  assert.equal(lists[0][0].id, "employee-1", "两个空间均能读取同一企业员工关系");
  await assert.rejects(() => corporate.service.listCorporateEmployees("tenant-b", "corporate-1"), /客户不存在/u);
  const missingCorporate = createFixture({ member: false, customerType: "corporate" });
  await assert.rejects(() => missingCorporate.service.listCorporateEmployees("tenant-a", "corporate-1"), /尚未开通租户会员/u);
  console.log("会员租户共享范围专项全部通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
