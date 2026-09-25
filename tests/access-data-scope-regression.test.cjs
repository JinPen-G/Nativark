const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");
const { ApiAuthGuard } = require("../apps/api/src/common/api-auth.guard");
const { buildOrganizationWhere, buildSystemUserWhere, isOrganizationScopedUser } = require("../apps/api/src/common/data-permission");
const { enabledOrganizationSubtreeIds, organizationLocationScope } = require("../apps/api/src/common/organization-location-scope");
const { MembershipService } = require("../apps/api/src/modules/platform/membership.service");
const { PlatformRepository } = require("../apps/api/src/modules/platform/platform.repository");
const { PlatformService } = require("../apps/api/src/modules/platform/platform.service");
const { RentalWorkspaceReportRepository } = require("../apps/api/src/modules/rental-core/rental-workspace-report.repository");
const { CustomerOperationsRepository } = require("../apps/api/src/modules/platform/customer-operations.repository");
const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const {
  assigneeCanAccessLocation,
  assigneeScopesOverlap,
  resolveAssigneeLocationIds,
  resolveWorkspaceMemberDataScope
} = require("../apps/api/src/modules/rental-core/work-order-assignee-scope");
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
  assert.deepEqual(memberQueries.find((row) => row.kind === "orders").where.AND[0].OR, [
    { fulfillmentLocationId: { in: ["location-a"] } },
    { returnLocationId: { in: ["location-a"] } }
  ]);
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

  const organizations = [
    { id: "org-root", parentId: null, status: "enabled" },
    { id: "org-child", parentId: "org-root", status: "enabled" },
    { id: "org-grandchild", parentId: "org-child", status: "enabled" },
    { id: "org-disabled", parentId: "org-root", status: "disabled" },
    { id: "org-hidden-descendant", parentId: "org-disabled", status: "enabled" },
    { id: "org-sibling", parentId: null, status: "enabled" }
  ];
  assert.deepEqual(enabledOrganizationSubtreeIds(organizations, "org-root"), ["org-child", "org-grandchild", "org-root"]);
  assert.deepEqual(enabledOrganizationSubtreeIds(organizations, "org-disabled"), []);
  assert.deepEqual(enabledOrganizationSubtreeIds(organizations, "org-missing"), []);
  console.log("  PASS 组织范围只包含当前组织及连续启用的下级组织");

  const scopedOrganizationUser = {
    id: "operator-org", tenantId: "tenant-a", organizationId: "org-root", dataScope: "organization",
    isSaasAdmin: false, isPlatformAdmin: false, permissions: []
  };
  assert.equal(isOrganizationScopedUser(scopedOrganizationUser), true);
  assert.deepEqual(buildSystemUserWhere("tenant-b", scopedOrganizationUser), {
    tenantId: "tenant-a", organizationId: "org-root"
  });
  assert.deepEqual(buildOrganizationWhere("tenant-b", scopedOrganizationUser), {
    tenantId: "tenant-a", id: "org-root"
  });
  assert.deepEqual(buildOrganizationWhere("tenant-a", { ...scopedOrganizationUser, organizationId: undefined }), {
    tenantId: "tenant-a", id: "__no_authorized_organization__"
  });

  const memoryPlatform = Object.create(PlatformService.prototype);
  memoryPlatform.organizations = [
    { id: "org-root", tenantId: "tenant-a", type: "operator", code: "ROOT", name: "根组织", status: "enabled" },
    { id: "org-child", tenantId: "tenant-a", parentId: "org-root", type: "store", code: "CHILD", name: "下级组织", status: "enabled" },
    { id: "org-disabled", tenantId: "tenant-a", parentId: "org-root", type: "store", code: "OFF", name: "停用组织", status: "disabled" },
    { id: "org-hidden", tenantId: "tenant-a", parentId: "org-disabled", type: "store", code: "HIDDEN", name: "停用链下级", status: "enabled" },
    { id: "org-sibling", tenantId: "tenant-a", type: "operator", code: "SIBLING", name: "平级组织", status: "enabled" },
    { id: "org-other-tenant", tenantId: "tenant-b", type: "operator", code: "OTHER", name: "其他租户", status: "enabled" }
  ];
  memoryPlatform.users = [
    { id: "user-root", tenantId: "tenant-a", organizationId: "org-root" },
    { id: "user-child", tenantId: "tenant-a", organizationId: "org-child" },
    { id: "user-disabled", tenantId: "tenant-a", organizationId: "org-disabled" },
    { id: "user-hidden", tenantId: "tenant-a", organizationId: "org-hidden" },
    { id: "user-sibling", tenantId: "tenant-a", organizationId: "org-sibling" },
    { id: "user-other-tenant", tenantId: "tenant-b", organizationId: "org-root" }
  ];
  memoryPlatform.useMysqlDataSource = () => false;
  memoryPlatform.toUserRow = (user) => user;
  assert.deepEqual(memoryPlatform.listOrganizations("tenant-b", scopedOrganizationUser).map((row) => row.id), ["org-root", "org-child"]);
  assert.deepEqual(memoryPlatform.listUsers("tenant-b", scopedOrganizationUser).map((row) => row.id), ["user-root", "user-child"]);
  assert.deepEqual(memoryPlatform.listOrganizations("tenant-a", { ...scopedOrganizationUser, organizationId: "missing" }), []);
  console.log("  PASS 内存模式组织与运营账号列表按当前组织启用子树和会话租户过滤");

  const repositoryQueries = { organization: [], users: [] };
  const repositoryOrganizationRows = [
    { id: "org-root", tenantId: "tenant-a", parentId: null, type: "OPERATOR", code: "ROOT", name: "根组织", status: "enabled" },
    { id: "org-child", tenantId: "tenant-a", parentId: "org-root", type: "STORE", code: "CHILD", name: "下级组织", status: "enabled" },
    { id: "org-disabled", tenantId: "tenant-a", parentId: "org-root", type: "STORE", code: "OFF", name: "停用组织", status: "disabled" },
    { id: "org-hidden", tenantId: "tenant-a", parentId: "org-disabled", type: "STORE", code: "HIDDEN", name: "停用链下级", status: "enabled" },
    { id: "org-sibling", tenantId: "tenant-a", parentId: null, type: "OPERATOR", code: "SIBLING", name: "平级组织", status: "enabled" }
  ];
  const platformRepository = new PlatformRepository({
    organizationUnit: {
      async findMany(args) {
        repositoryQueries.organization.push(args);
        return repositoryOrganizationRows;
      }
    },
    user: {
      async findMany(args) {
        repositoryQueries.users.push(args);
        return [];
      }
    }
  });
  assert.deepEqual((await platformRepository.listOrganizations("tenant-b", scopedOrganizationUser)).map((row) => row.id), ["org-root", "org-child"]);
  await platformRepository.listUsers("tenant-b", scopedOrganizationUser);
  assert.deepEqual(repositoryQueries.organization[0].where, { tenantId: "tenant-a" });
  assert.deepEqual(repositoryQueries.users[0].where, {
    tenantId: "tenant-a", organizationId: { in: ["org-child", "org-root"] }
  });
  console.log("  PASS Prisma 查询条件将组织及运营账号限制在租户内的启用组织子树");

  const organizationQueries = [];
  const locationQueries = [];
  const scopePrisma = {
    organizationUnit: {
      async findMany(args) {
        organizationQueries.push(args);
        return organizations;
      }
    },
    rentalFulfillmentLocation: {
      async findMany(args) {
        locationQueries.push(args);
        return [{ id: "location-root" }, { id: "location-child" }];
      },
      async findFirst({ where }) {
        const targetId = where.AND?.[0]?.id;
        return ["location-root", "location-child"].includes(targetId) ? { id: targetId } : null;
      }
    }
  };
  const scopeGuard = new ApiAuthGuard({}, undefined, undefined, undefined, scopePrisma);
  const orgUser = { id: "operator-org", tenantId: "tenant-a", organizationId: "org-root", dataScope: "organization", permissions: [] };
  const organizationScope = await scopeGuard.resolveLocationScope(orgUser, "workspace-a", { mode: "all", locationIds: [] });
  assert.deepEqual(organizationScope, { mode: "selected", locationIds: ["location-child", "location-root"] });
  assert.deepEqual(organizationQueries[0].where, { tenantId: "tenant-a" });
  assert.deepEqual(locationQueries[0].where, {
    tenantId: "tenant-a", workspaceId: "workspace-a",
    organizationId: { in: ["org-child", "org-grandchild", "org-root"] }
  });
  const organizationReadCount = organizationQueries.length;
  const tenantOrgAdmin = {
    id: "org-admin", tenantId: "tenant-a", organizationId: "org-root", dataScope: "organization",
    isSaasAdmin: false, isPlatformAdmin: false, isActive: true, mustChangePassword: false,
    permissions: ["system:user:manage"], locationScope: { mode: "all", locationIds: [] }
  };
  const organizationAdminGuard = new ApiAuthGuard({
    async resolveAccessContext() {
      return { user: tenantOrgAdmin, tenantUser: tenantOrgAdmin, workspaceId: undefined, workspaceValid: true };
    }
  }, undefined, undefined, undefined, scopePrisma);
  const organizationRequest = {
    url: "/api/platform/organizations", originalUrl: "/api/platform/organizations", method: "GET",
    headers: { authorization: "Bearer test" }, query: {}
  };
  await organizationAdminGuard.canActivate({ switchToHttp: () => ({ getRequest: () => organizationRequest }) });
  assert.equal(organizationQueries.length, organizationReadCount, "tenant configuration routes must not require a selected workspace");
  await assert.rejects(
    () => organizationAdminGuard.canActivate({ switchToHttp: () => ({ getRequest: () => ({
      ...organizationRequest, method: "POST", body: { code: "FORGED", name: "越权组织" }
    }) }) }),
    /需要全租户数据范围及全部履约地点范围/u
  );
  await assert.rejects(
    () => organizationAdminGuard.canActivate({ switchToHttp: () => ({ getRequest: () => ({
      ...organizationRequest, url: "/api/platform/roles", originalUrl: "/api/platform/roles", method: "GET"
    }) }) }),
    /需要全租户数据范围及全部履约地点范围/u
  );
  console.log("  PASS 组织管理接口不因组织范围账号未选择经营空间而被地点解析阻断");

  const locationManager = {
    id: "location-admin", tenantId: "tenant-a", dataScope: "all", isSaasAdmin: false,
    isPlatformAdmin: false, isActive: true, mustChangePassword: false,
    permissions: ["rental-os:station:manage"], locationScope: { mode: "all", locationIds: [] }
  };
  const locationMutationGuard = new ApiAuthGuard({
    async resolveAccessContext() {
      return { user: locationManager, tenantUser: locationManager, workspaceId: "workspace-a", workspaceValid: true };
    }
  });
  const unauthorizedMappingRequest = {
    url: "/api/rental/v1/locations", originalUrl: "/api/rental/v1/locations", method: "POST",
    headers: { authorization: "Bearer test" }, query: {}, body: { organizationId: "org-root" }
  };
  await assert.rejects(
    () => locationMutationGuard.canActivate({ switchToHttp: () => ({ getRequest: () => unauthorizedMappingRequest }) }),
    /需要全租户数据范围、全部履约地点范围和账号管理权限/u
  );
  const selectedLocationManager = {
    ...locationManager,
    permissions: ["system:user:manage", "rental-os:station:manage"],
    locationScope: { mode: "selected", locationIds: ["location-a"] }
  };
  const selectedLocationGuard = new ApiAuthGuard({
    async resolveAccessContext() {
      return { user: selectedLocationManager, tenantUser: selectedLocationManager, workspaceId: "workspace-a", workspaceValid: true };
    }
  });
  await assert.rejects(
    () => selectedLocationGuard.canActivate({ switchToHttp: () => ({ getRequest: () => unauthorizedMappingRequest }) }),
    /需要全租户数据范围、全部履约地点范围和账号管理权限/u
  );
  console.log("  PASS 仅有履约地点管理权限不能通过改组织归属扩大数据范围");

  const narrowedOrganizationScope = organizationLocationScope(
    ["location-root", "location-child"],
    { mode: "selected", locationIds: ["location-child", "location-outside"] }
  );
  assert.deepEqual(narrowedOrganizationScope, { mode: "selected", locationIds: ["location-child"] });
  console.log("  PASS 组织映射按租户与当前空间读取，显式地点范围只能进一步缩小组织范围");

  await scopeGuard.assertStaffLocationAccess(
    { method: "POST", body: { fulfillmentLocationId: "location-child" } },
    "/rental/v1/orders",
    orgUser,
    "workspace-a",
    organizationScope
  );
  await assert.rejects(
    () => scopeGuard.assertStaffLocationAccess(
      { method: "POST", body: { fulfillmentLocationId: "location-other" } },
      "/rental/v1/orders",
      orgUser,
      "workspace-a",
      organizationScope
    ),
    /不在当前账号授权范围内/u
  );
  await scopeGuard.assertStaffLocationAccess(
    { method: "PUT", body: { name: "组织范围内地点" } },
    "/rental/v1/locations/location-child",
    orgUser,
    "workspace-a",
    organizationScope
  );
  await assert.rejects(
    () => scopeGuard.assertStaffLocationAccess(
      { method: "PUT", body: { name: "越权地点" } },
      "/rental/v1/locations/location-outside",
      orgUser,
      "workspace-a",
      organizationScope
    ),
    /不在当前账号授权范围内/u
  );
  await assert.rejects(
    () => scopeGuard.assertStaffLocationAccess(
      { method: "POST", body: { name: "未映射新地点" } },
      "/rental/v1/locations",
      orgUser,
      "workspace-a",
      organizationScope
    ),
    /不能新建履约地点/u
  );
  await assert.rejects(
    () => scopeGuard.assertStaffLocationAccess(
      { method: "POST", body: { fulfillmentLocationId: "location-child" } },
      "/rental/v1/orders",
      orgUser,
      "workspace-a",
      { mode: "selected", locationIds: [] }
    ),
    /履约地点范围未就绪/u
  );
  console.log("  PASS 组织范围允许映射内履约、拒绝范围外地点及空映射访问");

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
  let dispositionListWhere;
  const expiredDraftWheres = [];
  const factRepository = new RentalCoreFactRepository({
    businessWorkspace: { async findFirst({ where }) { return { id: where.id ?? "workspace-a" }; } },
    rentalStockDisposition: { async findMany({ where }) { dispositionListWhere = where; return []; } },
    rentalOrder: {
      async findMany({ where }) {
        orderListWhere = where;
        if (where.status === "DRAFT" && where.reservations) expiredDraftWheres.push(where);
        return [];
      }
    }
  });
  await runWithRequestIdentity(identity, () => factRepository.listOrders("tenant-a"));
  const expectedOrderScope = [
    { OR: [
      { fulfillmentLocationId: { in: ["location-a"] } },
      { returnLocationId: { in: ["location-a"] } }
    ] },
    { OR: [
      { createdBy: "operator-a" },
      { workOrders: { some: { OR: [{ createdBy: "operator-a" }, { assigneeId: "operator-a" }] } } }
    ] }
  ];
  assert.deepEqual(orderListWhere.AND, expectedOrderScope);
  console.log("  PASS 订单列表在数据库查询条件中同时应用地点与本人范围");

  await runWithRequestIdentity(identity, () => factRepository.listExpiredDraftOrderIds(
    "tenant-a", "2026-09-25T00:00:00.000Z", 10
  ));
  assert.equal(expiredDraftWheres.length, 2, "两个待过期候选查询都必须执行");
  for (const where of expiredDraftWheres) {
    assert.equal(where.tenantId, "tenant-a");
    assert.equal(where.workspaceId, "workspace-a");
    assert.deepEqual(where.AND, expectedOrderScope);
  }
  console.log("  PASS 批量过期待确认订单候选在数据库查询时同时应用地点与本人范围");

  await runWithRequestIdentity(identity, () => factRepository.listStockDispositions("tenant-a"));
  assert.deepEqual(dispositionListWhere.AND, [
    { locationId: { in: ["location-a"] } },
    { order: { is: { OR: [
      { createdBy: "operator-a" },
      { workOrders: { some: { OR: [{ createdBy: "operator-a" }, { assigneeId: "operator-a" }] } } }
    ] } } }
  ]);
  console.log("  PASS 归还处置按处置地点及本人订单/工单归属过滤，防止工单前置记录绕过范围");
  let restoreDispositionWhere;
  const restoreScopeRepository = new RentalCoreFactRepository({
    businessWorkspace: { async findFirst({ where }) { return { id: where.id ?? "workspace-a" }; } },
    async $transaction(run) { return run(this); },
    rentalStockDisposition: {
      async findFirst({ where }) { restoreDispositionWhere = where; return null; }
    }
  });
  await assert.rejects(
    () => runWithRequestIdentity(identity, () => restoreScopeRepository.restoreStockDisposition("tenant-a", "outside-disposition", "operator-a")),
    /不存在或不属于当前经营空间/u
  );
  assert.deepEqual(restoreDispositionWhere.AND, dispositionListWhere.AND);
  console.log("  PASS 直接恢复归还处置的写路径复用相同地点和本人范围条件");

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

  assert.equal(resolveWorkspaceMemberDataScope({
    memberRoleId: "role-workspace",
    memberRole: { isActive: true, dataScope: "ORGANIZATION" },
    memberDataScope: "STORE"
  }), "store", "空间成员数据范围应覆盖空间角色范围");
  assert.equal(resolveWorkspaceMemberDataScope({
    isPlatformAdmin: true,
    memberRoleId: "disabled-role",
    memberRole: { isActive: false, dataScope: "ALL" },
    memberDataScope: "ALL"
  }), undefined, "停用的空间角色不能作为处理人授权来源");
  assert.equal(resolveWorkspaceMemberDataScope({
    userRoleAssignments: [
      { isActive: true, dataScope: "OWN" },
      { isActive: true, dataScope: "ORGANIZATION" }
    ]
  }), "organization", "未指定空间角色时应遵循有效租户角色范围解析");
  assert.deepEqual(resolveAssigneeLocationIds("organization", { mode: "selected", locationIds: ["loc-a", "loc-outside"] }, ["loc-a", "loc-b"]), ["loc-a"]);
  assert.deepEqual(resolveAssigneeLocationIds("store", { mode: "selected", locationIds: ["loc-a"] }, []), ["loc-a"]);
  assert.equal(assigneeCanAccessLocation(["loc-a"], "loc-b"), false);
  assert.equal(assigneeCanAccessLocation(undefined, "loc-b"), true);
  assert.equal(assigneeScopesOverlap(["loc-b"], ["loc-a"]), false);
  console.log("  PASS 工单处理人范围继承、组织地点映射、显式地点收窄及停用角色拒绝");

  const checkedAssignmentLocations = [];
  const workOrderService = Object.create(RentalCoreService.prototype);
  workOrderService.state = () => ({});
  workOrderService.factStore = {
    async listStockDispositions() {
      return [{ id: "disposition-a", locationId: "loc-a", status: "blocked", blockReason: "需检修" }];
    },
    async listWorkOrders() {
      return [{ id: "work-order-b", locationId: "loc-b", status: "pending" }];
    },
    async listWorkOrderAssignees(_tenantId, locationId) {
      checkedAssignmentLocations.push(locationId);
      return [];
    }
  };
  await assert.rejects(
    () => workOrderService.createWorkOrder("tenant-a", { dispositionId: "disposition-a", type: "repair", assigneeId: "unauthorized-worker" }, "manager"),
    /无权访问该履约地点/u
  );
  await assert.rejects(
    () => workOrderService.assignWorkOrder("tenant-a", "work-order-b", { assigneeId: "unauthorized-worker" }),
    /无权访问该履约地点/u
  );
  assert.deepEqual(checkedAssignmentLocations, ["loc-a", "loc-b"]);
  console.log("  PASS 新建工单与改派都按工单目标地点重新校验处理人，不能绕过列表筛选");

  const assigneeRows = [
    { userId: "org-worker", roleId: null, role: null, dataScope: null, locationScope: null, user: {
      id: "org-worker", account: "org-worker", displayName: "组织内处理人", organizationId: "org-root", isPlatformAdmin: false,
      role: { isActive: true, fixedAllPermissions: false, dataScope: "ORGANIZATION" }, roleAssignments: []
    } },
    { userId: "location-worker", roleId: null, role: null, dataScope: "STORE", locationScope: { mode: "selected", locationIds: ["loc-a"] }, user: {
      id: "location-worker", account: "location-worker", displayName: "地点内处理人", organizationId: null, isPlatformAdmin: false,
      role: null, roleAssignments: []
    } },
    { userId: "outside-worker", roleId: null, role: null, dataScope: "STORE", locationScope: { mode: "selected", locationIds: ["loc-b"] }, user: {
      id: "outside-worker", account: "outside-worker", displayName: "范围外处理人", organizationId: null, isPlatformAdmin: false,
      role: null, roleAssignments: []
    } },
    { userId: "unrestricted-worker", roleId: null, role: null, dataScope: "ALL", locationScope: null, user: {
      id: "unrestricted-worker", account: "unrestricted-worker", displayName: "全地点处理人", organizationId: null, isPlatformAdmin: false,
      role: null, roleAssignments: []
    } },
    { userId: "unmapped-worker", roleId: null, role: null, dataScope: null, locationScope: null, user: {
      id: "unmapped-worker", account: "unmapped-worker", displayName: "无有效地点处理人", organizationId: "org-disabled", isPlatformAdmin: false,
      role: { isActive: true, fixedAllPermissions: false, dataScope: "ORGANIZATION" }, roleAssignments: []
    } },
    { userId: "disabled-worker", roleId: "role-disabled", role: { isActive: false, fixedAllPermissions: false, dataScope: "ALL" }, dataScope: "ALL", locationScope: null, user: {
      id: "disabled-worker", account: "disabled-worker", displayName: "停用角色处理人", organizationId: null, isPlatformAdmin: false,
      role: null, roleAssignments: []
    } }
  ];
  const assigneeRepository = new RentalCoreFactRepository({
    businessWorkspace: { async findFirst({ where }) { return { id: where.id ?? "workspace-a" }; } },
    workspaceMember: { async findMany() { return assigneeRows; } },
    organizationUnit: { async findMany() { return organizations; } },
    rentalFulfillmentLocation: {
      async findMany({ where }) {
        const orgIds = new Set(where.organizationId.in);
        return [
          { id: "loc-a", organizationId: "org-root" },
          { id: "loc-b", organizationId: "org-sibling" }
        ].filter((row) => orgIds.has(row.organizationId));
      },
      async findFirst({ where }) { return ["loc-a", "loc-b"].includes(where.id) ? { id: where.id } : null; }
    }
  });
  const locationScopedIdentity = {
    tenantId: "tenant-a", userId: "manager-a", workspaceId: "workspace-a", isSaasAdmin: false,
    dataScope: "all", locationScope: { mode: "selected", locationIds: ["loc-a"] }
  };
  const visibleAssignees = await runWithRequestIdentity(locationScopedIdentity, () => assigneeRepository.listWorkOrderAssignees("tenant-a"));
  assert.deepEqual(visibleAssignees.map((row) => row.id).sort(), ["location-worker", "org-worker", "unrestricted-worker"]);
  const allVisibleAssignees = await runWithRequestIdentity({
    ...locationScopedIdentity, locationScope: { mode: "all", locationIds: [] }
  }, () => assigneeRepository.listWorkOrderAssignees("tenant-a"));
  assert.deepEqual(allVisibleAssignees.map((row) => row.id).sort(), ["location-worker", "org-worker", "outside-worker", "unrestricted-worker"]);
  const eligibleAtLocation = await runWithRequestIdentity(locationScopedIdentity, () => assigneeRepository.listWorkOrderAssignees("tenant-a", "loc-a"));
  assert.deepEqual(eligibleAtLocation.map((row) => row.id).sort(), ["location-worker", "org-worker", "unrestricted-worker"]);
  const allLocationAssignees = await runWithRequestIdentity({
    ...locationScopedIdentity, locationScope: { mode: "all", locationIds: [] }
  }, () => assigneeRepository.listWorkOrderAssignees("tenant-a", "loc-b"));
  assert.deepEqual(allLocationAssignees.map((row) => row.id).sort(), ["outside-worker", "unrestricted-worker"]);
  await assert.rejects(
    () => scopeGuard.assertStaffLocationAccess(
      { method: "GET", query: { locationId: "loc-b" } },
      "/rental/v1/work-order-assignees",
      { id: "manager-a", tenantId: "tenant-a", dataScope: "all" },
      "workspace-a",
      { mode: "selected", locationIds: ["loc-a"] }
    ),
    /所选履约地点不在当前账号授权范围内/u
  );
  console.log("  PASS 工单处理人列表按请求地点可见范围过滤，目标地点校验候选人组织与地点授权");

  console.log("数据范围回归专项全部通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
