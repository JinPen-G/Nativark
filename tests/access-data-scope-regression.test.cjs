const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");
const { ApiAuthGuard } = require("../apps/api/src/common/api-auth.guard");
const { MembershipService } = require("../apps/api/src/modules/platform/membership.service");
const { RentalWorkspaceReportRepository } = require("../apps/api/src/modules/rental-core/rental-workspace-report.repository");
const { CustomerOperationsRepository } = require("../apps/api/src/modules/platform/customer-operations.repository");
const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
const { SharedCustomerRepository } = require("../apps/api/src/modules/platform/shared-customer.repository");
const { CustomerOperationsService } = require("../apps/api/src/modules/platform/customer-operations.service");

void (async () => {
  const memberQueries = [];
  const prisma = {
    businessWorkspace: { async findFirst({ where }) { return where.tenantId === "tenant-a" && where.id === "workspace-a" ? { id: where.id } : null; } },
    rentalOrder: {
      async findMany({ where }) {
        memberQueries.push({ kind: "orders", where });
        return [{ customerId: "visible-customer" }];
      },
      async findFirst({ where }) {
        memberQueries.push({ kind: "order-detail", where });
        return null;
      }
    },
    customerProfile: {
      async findMany({ where }) {
        memberQueries.push({ kind: "members", where });
        return [{ id: "visible-customer", name: "范围内会员", phoneMasked: "138****0000", membership: { status: "active" } }];
      },
      async findFirst() { return null; }
    }
  };
  const service = new MembershipService(prisma, {});
  const identity = {
    tenantId: "tenant-a",
    userId: "operator-a",
    workspaceId: "workspace-a",
    isSaasAdmin: false,
    dataScope: "own",
    locationScope: { mode: "selected", locationIds: ["location-a"] }
  };

  const options = await runWithRequestIdentity(identity, () => service.listPersonalOptions("tenant-a"));
  assert.deepEqual(options.map((row) => row.customerId), ["visible-customer"]);
  assert.deepEqual(memberQueries.find((row) => row.kind === "orders").where.fulfillmentLocationId, { in: ["location-a"] });
  assert.deepEqual(memberQueries.find((row) => row.kind === "members").where.AND[0].OR, [{ id: { in: ["visible-customer"] } }]);
  console.log("  PASS 预约会员选项按本人订单与授权履约地点过滤");

  await assert.rejects(
    () => runWithRequestIdentity(identity, () => service.listBookingOptions("tenant-a", "workspace-a", "outside-customer")),
    /不在当前账号的数据范围内/u
  );
  console.log("  PASS 直接请求其他客户的企业预约权益会被拒绝");

  const guard = new ApiAuthGuard({}, undefined, undefined, undefined, prisma);
  await assert.rejects(
    () => guard.assertCustomerRecordAccess(
      { id: "operator-a", tenantId: "tenant-a", dataScope: "own" },
      "workspace-a",
      { mode: "selected", locationIds: ["location-a"] },
      "outside-customer"
    ),
    /不在当前账号的数据范围内/u
  );
  console.log("  PASS 直接客户详情 URL 不能绕过本人/地点范围");

  const report = new RentalWorkspaceReportRepository({});
  await assert.rejects(
    () => runWithRequestIdentity(identity, () => report.getOperationReport("tenant-a", "workspace-a", "camera")),
    /仅本人数据范围无法查看/u
  );
  console.log("  PASS 仅本人账号不能读取空间级库存聚合报表");

  await assert.rejects(
    () => guard.assertStaffLocationAccess(
      {},
      "/rental/v1/orders",
      { id: "operator-org", tenantId: "tenant-a", dataScope: "organization" },
      "workspace-a",
      { mode: "selected", locationIds: ["location-a"] }
    ),
    /组织范围尚未建立/u
  );
  console.log("  PASS 组织范围不会被未经组织映射的履约地点白名单代替");

  let historyWhere;
  const operations = new CustomerOperationsRepository({
    customerStatusHistoryEntry: {
      async findMany({ where }) {
        historyWhere = where;
        return [];
      }
    }
  });
  await operations.listStatusHistory("tenant-a", "customer-a", "workspace-a");
  assert.deepEqual(historyWhere.OR, [
    { workspaceId: "workspace-a" },
    { scope: { in: ["account", "membership"] } }
  ]);
  await operations.listStatusHistory("tenant-a", "customer-a", "workspace-a", false);
  assert.deepEqual(historyWhere.OR, [{ scope: { in: ["account", "membership"] } }]);
  console.log("  PASS 会员时间线按空间收口；地点受限时只返回租户级账号/会员事件");

  let orderListWhere;
  const factRepository = new RentalCoreFactRepository({
    businessWorkspace: { async findFirst({ where }) { return { id: where.id ?? "workspace-a" }; } },
    rentalOrder: { async findMany({ where }) { orderListWhere = where; return []; } }
  });
  await runWithRequestIdentity(identity, () => factRepository.listOrders("tenant-a"));
  assert.deepEqual(orderListWhere.AND, [
    { OR: [
      { fulfillmentLocationId: { in: ["location-a"] } },
      { returnLocationId: { in: ["location-a"] } }
    ] },
    { OR: [
      { createdBy: "operator-a" },
      { workOrders: { some: { OR: [{ createdBy: "operator-a" }, { assigneeId: "operator-a" }] } } }
    ] }
  ]);
  console.log("  PASS 订单列表在数据库查询条件中同时应用地点与本人范围");

  let createdProfileData;
  const sharedCustomers = new SharedCustomerRepository({ customerProfile: { async create({ data }) { createdProfileData = data; return data; } } });
  await runWithRequestIdentity(identity, () => sharedCustomers.createProfile({
    tenantId: "tenant-a", customerType: "personal", name: "测试客户", phone: "13800000000",
    createdByUserId: "forged-user", createdInWorkspaceId: "forged-workspace"
  }));
  assert.equal(createdProfileData.createdByUserId, "operator-a");
  assert.equal(createdProfileData.createdInWorkspaceId, "workspace-a");
  console.log("  PASS 客户创建归属取自认证上下文，不接受调用方伪造");

  const operationsService = Object.create(CustomerOperationsService.prototype);
  operationsService.canReveal = () => true;
  await assert.rejects(
    () => runWithRequestIdentity(identity, () => operationsService.listSensitiveAccess("tenant-a", "visible-customer", { id: "operator-a", dataScope: "all" })),
    /尚未按履约地点归属/u
  );
  console.log("  PASS 地点受限账号不能读取未按地点归属的敏感访问审计");

  console.log("数据范围回归专项全部通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
