const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { MembershipService } = require("../apps/api/src/modules/platform/membership.service");

function createPrisma({ linked = true, customerType = "personal" } = {}) {
  const calls = [];
  return {
    calls,
    customerProfile: {
      async findFirst({ where }) {
        calls.push({ model: "customerProfile.findFirst", where });
        return { id: where.id, customerType, phone: "13800000000", phoneMasked: "138****0000" };
      }
    },
    customerWorkspaceLink: {
      async findFirst({ where }) {
        calls.push({ model: "customerWorkspaceLink.findFirst", where });
        return linked ? { tenantId: where.tenantId, workspaceId: where.workspaceId, customerId: where.customerId } : null;
      }
    },
    customerAccount: {
      async upsert(input) {
        calls.push({ model: "customerAccount.upsert", input });
        return { status: "active", loginPhoneMasked: "138****0000", mustChangePassword: true };
      }
    },
    customerCorporateMembership: {
      async findMany({ where }) {
        calls.push({ model: "customerCorporateMembership.findMany", where });
        return [];
      }
    }
  };
}

async function rejects(promise, pattern, label) {
  await assert.rejects(promise, (error) => {
    assert.match(error.message, pattern, `${label}：实际 ${error.message}`);
    return true;
  }, label);
}

void (async () => {
  const outOfScopePassword = new MembershipService(createPrisma({ linked: false }));
  await rejects(
    outOfScopePassword.setTemporaryPassword("tenant-a", "workspace-b", "customer-1", "Temp1234", "管理员"),
    /尚未接入当前经营空间/u,
    "跨空间不能设置会员临时密码"
  );
  console.log("  PASS 会员临时密码必须校验当前空间会员关系");

  const inScopePrisma = createPrisma({ linked: true });
  const inScopePassword = new MembershipService(inScopePrisma);
  const result = await inScopePassword.setTemporaryPassword("tenant-a", "workspace-a", "customer-1", "Temp1234", "管理员");
  assert.equal(result.provisioned, true);
  const accountCall = inScopePrisma.calls.find((call) => call.model === "customerAccount.upsert");
  assert.deepEqual(accountCall.input.where, { tenantId_customerId: { tenantId: "tenant-a", customerId: "customer-1" } });
  console.log("  PASS 当前空间会员可以设置临时密码");

  const outOfScopeEmployees = new MembershipService(createPrisma({ linked: false, customerType: "corporate" }));
  await rejects(
    outOfScopeEmployees.listCorporateEmployees("tenant-a", "workspace-b", "corporate-1"),
    /尚未接入当前经营空间/u,
    "跨空间不能读取企业员工"
  );
  console.log("  PASS 企业员工列表必须校验企业当前空间关系");

  console.log("会员空间范围专项：3 项全部通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
