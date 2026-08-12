import {
  ConfigStatus,
  CorporateStatus,
  MemberReviewStatus,
  MemberStatus,
  MonthlyBillStatus,
  OrganizationType,
  PermissionKind,
  Prisma,
  PrismaClient,
  RentalCategoryCode,
  RoleScope,
  SettlementMode,
  SystemDataScope,
  TenantStatus,
  VehicleOperationStatus,
  VehicleServiceType
} from "@prisma/client";
import { hashPassword } from "../src/common/password";

const prisma = new PrismaClient();

type TenantSeed = {
  id: string;
  code: string;
  name: string;
  organizations: Array<{
    id: string;
    parentId?: string;
    type: OrganizationType;
    code: string;
    name: string;
  }>;
  users: Array<{
    id: string;
    account: string;
    displayName: string;
    phone: string;
    organizationId: string;
    roleIds: string[];
    isSaasAdmin: boolean;
    isPlatformAdmin: boolean;
  }>;
};

const tenants: TenantSeed[] = [
  {
    id: "tenant_platform",
    code: "platform",
    name: "Rental OS SaaS 平台",
    organizations: [
      { id: "org_saas_platform", type: OrganizationType.OPERATOR, code: "SAAS", name: "SaaS 平台运营" }
    ],
    users: [
      {
        id: "user_saas_admin",
        account: "admin",
        displayName: "SaaS 平台管理员",
        phone: "000-0000-0000",
        organizationId: "org_saas_platform",
        roleIds: ["role_saas_admin"],
        isSaasAdmin: true,
        isPlatformAdmin: false
      }
    ]
  },
  {
    id: "tenant_001",
    code: "demo",
    name: "演示香港租户",
    organizations: [
      { id: "org_operator_hk", type: OrganizationType.OPERATOR, code: "OP-HK", name: "香港营运中心" },
      { id: "org_store_mongkok", parentId: "org_operator_hk", type: OrganizationType.STORE, code: "STORE-MK", name: "旺角门市" },
      { id: "org_store_central", parentId: "org_operator_hk", type: OrganizationType.STORE, code: "STORE-CENTRAL", name: "中环门市" },
      { id: "org_store_airport", parentId: "org_operator_hk", type: OrganizationType.STORE, code: "STORE-AIRPORT", name: "机场门市" }
    ],
    users: [
      {
        id: "user_admin_001",
        account: "admin",
        displayName: "香港租户管理员",
        phone: "852-1000-0001",
        organizationId: "org_operator_hk",
        roleIds: ["role_platform_admin"],
        isSaasAdmin: false,
        isPlatformAdmin: true
      },
      {
        id: "user_store_001",
        account: "store",
        displayName: "旺角门店值班员",
        phone: "852-2388-0001",
        organizationId: "org_store_mongkok",
        roleIds: ["role_store_operator"],
        isSaasAdmin: false,
        isPlatformAdmin: false
      },
      {
        id: "user_pricing_001",
        account: "pricing",
        displayName: "价格规则管理员",
        phone: "852-2388-0002",
        organizationId: "org_operator_hk",
        roleIds: ["role_pricing_manager"],
        isSaasAdmin: false,
        isPlatformAdmin: false
      }
    ]
  },
  {
    id: "tenant_002",
    code: "demo2",
    name: "演示深圳租户",
    organizations: [
      { id: "org_operator_sz", type: OrganizationType.OPERATOR, code: "OP-SZ", name: "深圳营运中心" },
      { id: "org_store_nanshan", parentId: "org_operator_sz", type: OrganizationType.STORE, code: "STORE-NS", name: "南山门市" }
    ],
    users: [
      {
        id: "user_admin_002",
        account: "admin",
        displayName: "深圳租户管理员",
        phone: "0755-1000-0001",
        organizationId: "org_operator_sz",
        roleIds: ["role_platform_admin_sz"],
        isSaasAdmin: false,
        isPlatformAdmin: true
      },
      {
        id: "user_store_002",
        account: "store",
        displayName: "南山门店值班员",
        phone: "0755-2388-0001",
        organizationId: "org_store_nanshan",
        roleIds: ["role_store_operator_sz"],
        isSaasAdmin: false,
        isPlatformAdmin: false
      }
    ]
  }
];

const permissions = [
  ["store-rental:rules:manage", "业务规则配置", "门市租赁", PermissionKind.ACTION],
  ["store-rental:order:view", "订单查看", "门市租赁", PermissionKind.ACTION],
  ["store-rental:order:operate", "订单操作", "门市租赁", PermissionKind.ACTION],
  ["store-rental:order:settle", "订单结算", "门市租赁", PermissionKind.ACTION],
  ["store-rental:order:create", "按钮-新建订单", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:order:pickup", "按钮-取车交付", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:order:return", "按钮-还车验车", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:order:extend", "按钮-延长用车", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:order:cancel", "按钮-取消/爽约", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:order:close", "按钮-关闭/拒绝履约", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:order:fee-manage", "按钮-费用处理", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:dispatch:manage", "调度管理", "门市租赁", PermissionKind.ACTION],
  ["store-rental:price:manage", "价格规则", "门市租赁", PermissionKind.ACTION],
  ["store-rental:marketing:manage", "行销方案管理", "门市租赁", PermissionKind.ACTION],
  ["store-rental:station:view", "站点查看", "门市租赁", PermissionKind.ACTION],
  ["store-rental:station:manage", "站点管理", "门市租赁", PermissionKind.ACTION],
  ["store-rental:vehicle-group:manage", "车型组管理", "门市租赁", PermissionKind.ACTION],
  ["store-rental:vehicle:view", "车辆查看", "门市租赁", PermissionKind.ACTION],
  ["store-rental:vehicle:manage", "车辆管理", "门市租赁", PermissionKind.ACTION],
  ["store-rental:vehicle:status-action", "按钮-车辆状态动作", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:member:view", "会员查看", "门市租赁", PermissionKind.ACTION],
  ["store-rental:member:manage", "会员管理", "门市租赁", PermissionKind.ACTION],
  ["store-rental:member:risk-action", "按钮-会员风控动作", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:corporate:view", "企业客户查看", "门市租赁", PermissionKind.ACTION],
  ["store-rental:corporate:manage", "企业客户管理", "门市租赁", PermissionKind.ACTION],
  ["store-rental:corporate:monthly-settle", "按钮-企业月结回款", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:finance:view", "财务查看", "门市租赁", PermissionKind.ACTION],
  ["store-rental:finance:manage", "财务管理", "门市租赁", PermissionKind.ACTION],
  ["store-rental:finance:adjust", "按钮-手工调账", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:finance:invoice", "按钮-发票/收据", "门市租赁", PermissionKind.BUTTON],
  ["store-rental:finance:reconcile", "财务对账", "门市租赁", PermissionKind.ACTION],
  ["store-rental:service:manage", "增值服务管理", "门市租赁", PermissionKind.ACTION],
  ["store-rental:report:view", "报表查看", "门市租赁", PermissionKind.ACTION],
  ["system:user:manage", "系统用户", "系统设置", PermissionKind.ACTION],
  ["system:role:manage", "角色权限", "系统设置", PermissionKind.ACTION],
  ["system:params:manage", "系统通用参数", "系统设置", PermissionKind.ACTION],
  ["system:audit:view", "审计日志", "系统设置", PermissionKind.ACTION],
  ["system:dictionary:manage", "数据字典", "系统设置", PermissionKind.ACTION],
  ["system:number-rule:manage", "编号规则", "系统设置", PermissionKind.ACTION],
  ["system:integration:manage", "外部接入与任务", "系统设置", PermissionKind.ACTION],
  ["system:button:export", "按钮-导出", "系统设置", PermissionKind.BUTTON],
  ["system:tenant:manage", "租户配置", "系统设置", PermissionKind.ACTION],
  ["system:tenant:bootstrap", "租户初始化", "系统设置", PermissionKind.ACTION]
] as const;

const roleTemplates = [
  {
    id: "role_platform_admin",
    code: "TENANT_ADMIN",
    name: "租户管理员",
    description: "固定拥有当前 SaaS 租户全部权限，不允许跨租户。",
    scope: RoleScope.OPERATOR,
    fixedAllPermissions: true,
    enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H", "SYSTEM_GLOBAL"],
    permissions: permissions.map(([code]) => code),
    buttonPermissions: ["*"],
    dataScope: SystemDataScope.ALL
  },
  {
    id: "role_store_operator",
    code: "STORE_OPERATOR",
    name: "门店营运",
    description: "门店前台和门店值班人员处理订单、取还车和基础车辆查看。",
    scope: RoleScope.STORE,
    fixedAllPermissions: false,
    enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H"],
    permissions: [
      "store-rental:order:view",
      "store-rental:order:operate",
      "store-rental:order:settle",
      "store-rental:station:view",
      "store-rental:vehicle:view",
      "store-rental:member:view",
      "store-rental:corporate:view",
      "store-rental:finance:view"
    ],
    buttonPermissions: [
      "store-rental:order:create",
      "store-rental:order:pickup",
      "store-rental:order:return",
      "store-rental:order:extend",
      "store-rental:order:cancel",
      "store-rental:order:fee-manage",
      "store-rental:vehicle:status-action"
    ],
    dataScope: SystemDataScope.STORE
  },
  {
    id: "role_pricing_manager",
    code: "PRICING_MANAGER",
    name: "价格规则管理员",
    description: "维护门市租赁价格、规则和增值服务配置。",
    scope: RoleScope.OPERATOR,
    fixedAllPermissions: false,
    enabledBusinessScopes: ["STORE_STANDARD", "SYSTEM_GLOBAL"],
    permissions: [
      "store-rental:rules:manage",
      "store-rental:price:manage",
      "store-rental:marketing:manage",
      "store-rental:service:manage",
      "system:params:manage",
      "system:integration:manage",
      "store-rental:order:view",
      "store-rental:finance:view",
      "store-rental:finance:reconcile",
      "store-rental:report:view"
    ],
    buttonPermissions: ["system:button:export"],
    dataScope: SystemDataScope.ORGANIZATION
  }
];

const saasRoleTemplate = {
  id: "role_saas_admin",
  code: "SAAS_ADMIN",
  name: "SaaS 平台管理员",
  description: "仅负责 SaaS 租户开通、资料维护和生命周期管理。",
  scope: RoleScope.OPERATOR,
  fixedAllPermissions: false,
  enabledBusinessScopes: ["SAAS_PLATFORM"],
  permissions: permissions
    .map(([code]) => code)
    .filter((code) => code.startsWith("system:tenant:")),
  buttonPermissions: [],
  dataScope: SystemDataScope.ALL
} as const;

const stations = [
  {
    id: "station_mk_counter",
    code: "ST-MK-COUNTER",
    name: "旺角门市柜台",
    parentStoreName: "旺角门市",
    type: "门市柜台",
    status: "enabled",
    serviceStatus: "normal",
    address: "九龙旺角弥敦道 610 号",
    serviceTypes: ["STORE_STANDARD", "STORE_24H"]
  },
  {
    id: "station_central",
    code: "ST-CENTRAL",
    name: "中环门市服务点",
    parentStoreName: "中环门市",
    type: "门市柜台",
    status: "enabled",
    serviceStatus: "normal",
    address: "中环干诺道中 88 号",
    serviceTypes: ["STORE_STANDARD"]
  },
  {
    id: "station_airport",
    code: "ST-AIRPORT",
    name: "机场门市停车区",
    parentStoreName: "机场门市",
    type: "停车场",
    status: "enabled",
    serviceStatus: "maintenance",
    address: "香港国际机场一号停车场",
    serviceTypes: ["STORE_STANDARD", "STORE_24H"]
  }
];

const vehicleGroups = [
  { id: "VG_ECONOMY", code: "VG_ECONOMY", name: "Honda Jazz / 同级", seats: 5, brand: "Honda", model: "Fit", energyType: "fuel", transmission: "auto", luggageCount: 2 },
  { id: "VG_SEVEN", code: "VG_SEVEN", name: "Toyota Noah / 同级 7座", seats: 7, brand: "Toyota", model: "Noah", energyType: "fuel", transmission: "auto", luggageCount: 4 },
  { id: "VG_EV", code: "VG_EV", name: "Tesla Model 3 / 同级", seats: 5, brand: "Tesla", model: "Model 3", energyType: "ev", transmission: "auto", luggageCount: 3 }
];

const vehicles = [
  { id: "VEH_001", plateNo: "RX 7821", vin: "AHTLB3JE0R0001234", vehicleGroupId: "VG_SEVEN", stationId: "station_mk_counter", storeId: "org_store_mongkok", status: "renting", operationStatus: VehicleOperationStatus.RENTING, serviceType: VehicleServiceType.STORE_STANDARD, serviceTypes: ["STORE_STANDARD", "STORE_24H"], mileage: 12880, color: "白色", cid: "TBOX-HK-001", isSpecial: false },
  { id: "VEH_002", plateNo: "BCP 7315", vin: "JTMBW3FV0R1009012", vehicleGroupId: "VG_ECONOMY", stationId: "station_central", storeId: "org_store_central", status: "idle", operationStatus: VehicleOperationStatus.IDLE, serviceType: VehicleServiceType.STORE_STANDARD, serviceTypes: ["STORE_STANDARD"], mileage: 8021, color: "灰色", cid: "TBOX-HK-002", isSpecial: false },
  { id: "VEH_003", plateNo: "EV 9308", vin: "LRW3E7FS0PC001122", vehicleGroupId: "VG_EV", stationId: "station_airport", storeId: "org_store_airport", status: "reserved", operationStatus: VehicleOperationStatus.RESERVED, serviceType: VehicleServiceType.STORE_24H, serviceTypes: ["STORE_STANDARD", "STORE_24H"], mileage: 6420, color: "黑色", cid: "TBOX-HK-003", isSpecial: true }
];

const members = [
  {
    id: "member_001",
    name: "陈嘉豪",
    phone: "85261232388",
    phoneMasked: "852****2388",
    source: "H5 注册",
    levelName: "黄金会员",
    status: MemberStatus.ACTIVE,
    reviewStatus: MemberReviewStatus.APPROVED,
    tags: ["常用企业客户", "已完成认证"],
    pointsBalance: 1800,
    totalOrders: 6,
    totalSpendAmount: 12880,
    identityVerified: true,
    driverLicenseVerified: true,
    identityNoMasked: "Z1234****",
    driverLicenseNoMasked: "HK-9***-881",
    birthday: new Date("1990-08-12T00:00:00+08:00"),
    emergencyContactName: "陈太太",
    emergencyContactPhone: "85261239999",
    notes: "偏好旺角门市取车。",
    riskNote: ""
  },
  {
    id: "member_002",
    name: "林慧仪",
    phone: "85251116619",
    phoneMasked: "852****6619",
    source: "门店录入",
    levelName: "白银会员",
    status: MemberStatus.PENDING_REVIEW,
    reviewStatus: MemberReviewStatus.PENDING,
    tags: ["新注册"],
    pointsBalance: 0,
    totalOrders: 0,
    totalSpendAmount: 0,
    identityVerified: false,
    driverLicenseVerified: false,
    identityNoMasked: "R7788****",
    driverLicenseNoMasked: "HK-7***-612",
    birthday: new Date("1995-11-04T00:00:00+08:00"),
    emergencyContactName: "林先生",
    emergencyContactPhone: "85253334444",
    notes: "待审核驾照资料。",
    riskNote: "资料待人工核验"
  },
  {
    id: "member_003",
    name: "王子俊",
    phone: "85265099081",
    phoneMasked: "852****9081",
    source: "企业导入",
    levelName: "黑金会员",
    status: MemberStatus.SUSPENDED,
    reviewStatus: MemberReviewStatus.APPROVED,
    tags: ["高价值客户", "逾期历史"],
    pointsBalance: 3200,
    totalOrders: 15,
    totalSpendAmount: 36600,
    identityVerified: true,
    driverLicenseVerified: true,
    identityNoMasked: "Y8812****",
    driverLicenseNoMasked: "HK-3***-903",
    birthday: new Date("1988-02-21T00:00:00+08:00"),
    emergencyContactName: "王太",
    emergencyContactPhone: "85268881111",
    notes: "需营运主管确认后再恢复租车资格。",
    riskNote: "历史逾期两次，当前暂停租车资格"
  }
];

const corporates = [
  {
    id: "corp_001",
    shortName: "ABC Trading",
    fullName: "ABC Trading Limited",
    status: CorporateStatus.ACTIVE,
    creditLimitAmount: 100000,
    creditWarningAmount: 85000,
    accountPeriodDays: 30,
    billingCycleDay: 25,
    settlementMode: SettlementMode.MONTHLY,
    contactName: "赵经理",
    contactPhone: "85263330001",
    billingEmail: "finance@abctrading.com",
    statementEmail: "statement@abctrading.com",
    reconciliationContactName: "陈财务",
    reconciliationContactPhone: "85263330002",
    autoGenerateStatement: true,
    invoiceTitle: "ABC Trading Limited",
    linkedStores: ["旺角门市", "中环门市"],
    notes: "默认月结客户，支持旺角和中环门市下单。",
    activeOrderCount: 3,
    contacts: [
      { id: "corp_001_contact_1", name: "赵经理", title: "行政经理", phone: "85263330001", email: "ops@abctrading.com" },
      { id: "corp_001_contact_2", name: "陈财务", title: "财务主管", phone: "85263330002", email: "finance@abctrading.com" }
    ],
    contracts: [
      {
        id: "corp_001_contract_1",
        contractNo: "CTR-ABC-2026-001",
        contractName: "ABC Trading 2026 年度门市租赁协议",
        status: "active",
        startDate: new Date("2026-01-01T00:00:00+08:00"),
        endDate: new Date("2026-12-31T23:59:59+08:00"),
        amount: 120000,
        linkedStores: ["旺角门市", "中环门市"],
        statementEmail: "statement@abctrading.com",
        attachments: ["abc-contract-2026.pdf"],
        remark: "年度框架协议，按月结算"
      }
    ]
  },
  {
    id: "corp_002",
    shortName: "Peak Studio",
    fullName: "Peak Studio Production Company",
    status: CorporateStatus.PAUSED,
    creditLimitAmount: 40000,
    creditWarningAmount: 30000,
    accountPeriodDays: 15,
    billingCycleDay: 15,
    settlementMode: SettlementMode.MONTHLY,
    contactName: "李制片",
    contactPhone: "85267770018",
    billingEmail: "ap@peakstudio.hk",
    statementEmail: "billing@peakstudio.hk",
    reconciliationContactName: "李制片",
    reconciliationContactPhone: "85267770018",
    autoGenerateStatement: false,
    invoiceTitle: "Peak Studio Production Company",
    linkedStores: ["旺角门市"],
    notes: "合同即将到期，暂停新增订单。",
    activeOrderCount: 1,
    contacts: [
      { id: "corp_002_contact_1", name: "李制片", title: "制片主任", phone: "85267770018", email: "ap@peakstudio.hk" }
    ],
    contracts: []
  }
];

async function upsertTenants() {
  for (const tenant of tenants) {
    await prisma.tenant.upsert({
      where: { id: tenant.id },
      update: { code: tenant.code, name: tenant.name, status: TenantStatus.ACTIVE },
      create: { id: tenant.id, code: tenant.code, name: tenant.name, status: TenantStatus.ACTIVE }
    });
  }
}

const rentalCategories = [
  {
    code: RentalCategoryCode.CAMERA,
    name: "摄影设备",
    description: "机身、镜头、灯光和拍摄套装租赁",
    supportedInventoryModes: ["serialized", "quantity", "bundle"],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "usage_reading"],
    terminology: { itemLabel: "器材", itemGroupLabel: "器材型号", assetLabel: "器材资产", fulfillmentLabel: "器材门店", pickupLabel: "取机", returnLabel: "还机", identifierLabel: "资产编号", usageMetricLabel: "快门次数" },
    attributeSchema: { brand: "string", mount: "string", sensor: "string" },
    version: "0.1.0"
  },
  {
    code: RentalCategoryCode.CAMPING,
    name: "露营设备",
    description: "帐篷、桌椅、炊具和露营套装租赁",
    supportedInventoryModes: ["serialized", "quantity", "bundle"],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery"],
    terminology: { itemLabel: "装备", itemGroupLabel: "装备品类", assetLabel: "装备资产", fulfillmentLabel: "装备仓", pickupLabel: "领用", returnLabel: "归还", identifierLabel: "装备编号" },
    attributeSchema: { brand: "string", people: "number", season: "string" },
    version: "0.1.0"
  },
  {
    code: RentalCategoryCode.VEHICLE,
    name: "车辆载具",
    description: "汽车、摩托车和其他载具租赁",
    supportedInventoryModes: ["serialized", "bundle"],
    defaultCapabilities: ["serialized_inventory", "bundle_inventory", "pickup", "return", "dispatch", "usage_reading", "qualification", "iot"],
    terminology: { itemLabel: "车辆", itemGroupLabel: "车型组", assetLabel: "车辆", fulfillmentLabel: "门店", pickupLabel: "取车", returnLabel: "还车", identifierLabel: "车牌号", usageMetricLabel: "里程" },
    attributeSchema: { brand: "string", model: "string", energyType: "string" },
    version: "0.1.0"
  },
  {
    code: RentalCategoryCode.CONSTRUCTION,
    name: "工程设备",
    description: "工程机械、工具和配套设备租赁",
    supportedInventoryModes: ["serialized", "quantity", "bundle"],
    defaultCapabilities: ["serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery", "dispatch", "usage_reading", "qualification", "iot"],
    terminology: { itemLabel: "设备", itemGroupLabel: "设备型号", assetLabel: "设备资产", fulfillmentLabel: "设备仓", pickupLabel: "出库", returnLabel: "入库", identifierLabel: "设备编号", usageMetricLabel: "工时" },
    attributeSchema: { brand: "string", power: "string", ratedLoad: "number" },
    version: "0.1.0"
  }
];

async function upsertRentalCategoriesAndProfiles() {
  for (const category of rentalCategories) {
    await prisma.rentalCategoryDefinition.upsert({
      where: { code: category.code },
      update: category,
      create: category
    });
  }
  for (const profile of [
    { tenantId: "tenant_001", categoryCode: RentalCategoryCode.CAMERA },
    { tenantId: "tenant_002", categoryCode: RentalCategoryCode.CAMPING }
  ]) {
    const category = rentalCategories.find((item) => item.code === profile.categoryCode)!;
    await prisma.tenantRentalProfile.upsert({
      where: { tenantId: profile.tenantId },
      update: {
        categoryCode: profile.categoryCode,
        capabilities: category.defaultCapabilities,
        terminology: category.terminology,
        configVersion: category.version
      },
      create: {
        tenantId: profile.tenantId,
        categoryCode: profile.categoryCode,
        capabilities: category.defaultCapabilities,
        terminology: category.terminology,
        configVersion: category.version
      }
    });
  }
}

async function upsertOrganizations() {
  for (const tenant of tenants) {
    for (const org of tenant.organizations) {
      await prisma.organizationUnit.upsert({
        where: { id: org.id },
        update: {
          tenantId: tenant.id,
          parentId: org.parentId,
          type: org.type,
          code: org.code,
          name: org.name
        },
        create: {
          id: org.id,
          tenantId: tenant.id,
          parentId: org.parentId,
          type: org.type,
          code: org.code,
          name: org.name
        }
      });
    }
  }
}

async function upsertPermissions() {
  for (const [code, name, module, kind] of permissions) {
    await prisma.permission.upsert({
      where: { code },
      update: { name, module, kind },
      create: { code, name, module, kind }
    });
  }
}

async function upsertRolesAndUsers() {
  for (const tenant of tenants) {
    const tenantRoleTemplates = tenant.code === "platform" ? [saasRoleTemplate] : roleTemplates;
    for (const template of tenantRoleTemplates) {
      const suffix = tenant.id === "tenant_001" ? "" : "_sz";
      const roleId = tenant.code === "platform" ? template.id : `${template.id}${suffix}`;
      await prisma.role.upsert({
        where: { id: roleId },
        update: {
          tenantId: tenant.id,
          code: template.code,
          name: template.name,
          description: template.description,
          scope: template.scope,
          fixedAllPermissions: template.fixedAllPermissions,
          enabledBusinessScopes: template.enabledBusinessScopes,
          buttonPermissions: template.buttonPermissions,
          dataScope: template.dataScope,
          isActive: true
        },
        create: {
          id: roleId,
          tenantId: tenant.id,
          code: template.code,
          name: template.name,
          description: template.description,
          scope: template.scope,
          fixedAllPermissions: template.fixedAllPermissions,
          enabledBusinessScopes: template.enabledBusinessScopes,
          buttonPermissions: template.buttonPermissions,
          dataScope: template.dataScope,
          isActive: true
        }
      });

      const rolePermissionCodes = new Set([
        ...template.permissions,
        ...template.buttonPermissions.filter((code) => code !== "*")
      ]);
      for (const permissionCode of rolePermissionCodes) {
        const permission = await prisma.permission.findUniqueOrThrow({
          where: { code: permissionCode }
        });
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId, permissionId: permission.id } },
          update: {},
          create: { roleId, permissionId: permission.id }
        });
      }
    }

    for (const user of tenant.users) {
      await prisma.user.upsert({
        where: { id: user.id },
        update: {
          tenantId: tenant.id,
          organizationId: user.organizationId,
          account: user.account,
          displayName: user.displayName,
          phone: user.phone,
          roleId: user.roleIds[0],
          passwordHash: hashPassword(tenant.code === "platform" ? "RentalOS!2026" : "RentalDemo!2026"),
          isSaasAdmin: user.isSaasAdmin,
          isPlatformAdmin: user.isPlatformAdmin,
          mustChangePassword: false,
          isActive: true
        },
        create: {
          id: user.id,
          tenantId: tenant.id,
          organizationId: user.organizationId,
          account: user.account,
          displayName: user.displayName,
          phone: user.phone,
          roleId: user.roleIds[0],
          passwordHash: hashPassword(tenant.code === "platform" ? "RentalOS!2026" : "RentalDemo!2026"),
          isSaasAdmin: user.isSaasAdmin,
          isPlatformAdmin: user.isPlatformAdmin,
          mustChangePassword: false,
          isActive: true
        }
      });

      await prisma.userRole.deleteMany({ where: { userId: user.id } });
      for (const roleId of user.roleIds) {
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId } },
          update: {},
          create: { userId: user.id, roleId }
        });
      }
    }
  }
}

async function upsertSystemParameters() {
  for (const tenant of tenants) {
    await prisma.systemParameterSet.upsert({
      where: {
        tenantId_module_versionNo: {
          tenantId: tenant.id,
          module: "system-rules",
          versionNo: 1
        }
      },
      update: {
        status: ConfigStatus.EFFECTIVE,
        content: {
          member: { reviewRequired: true, blacklistBlockOrder: true },
          operations: { vehicleReturnBufferMinutes: 60, noShowHoldHours: 2 },
          notifications: { smsEnabled: false, emailEnabled: false },
          ai: { provider: "reserved", model: "mock" }
        },
        operator: "seed"
      },
      create: {
        tenantId: tenant.id,
        module: "system-rules",
        versionNo: 1,
        status: ConfigStatus.EFFECTIVE,
        content: {
          member: { reviewRequired: true, blacklistBlockOrder: true },
          operations: { vehicleReturnBufferMinutes: 60, noShowHoldHours: 2 },
          notifications: { smsEnabled: false, emailEnabled: false },
          ai: { provider: "reserved", model: "mock" }
        },
        operator: "seed"
      }
    });

    await prisma.systemParameterSet.upsert({
      where: {
        tenantId_module_versionNo: {
          tenantId: tenant.id,
          module: "platform-dictionaries",
          versionNo: 1
        }
      },
      update: {
        status: ConfigStatus.EFFECTIVE,
        content: {
          groups: [
            {
              code: "order_main_status",
              name: "门市订单主状态",
              module: "门市租赁",
              description: "按门市租车订单状态 PRD 维护主状态展示文案。",
              updatedAt: "2026-06-08T00:00:00+08:00",
              updatedBy: "seed",
              items: [
                { code: "pending_payment", label: "待支付", value: "pending_payment", sortNo: 10, enabled: true },
                { code: "reserved", label: "已预订", value: "reserved", sortNo: 20, enabled: true },
                { code: "inspecting", label: "验车中", value: "inspecting", sortNo: 30, enabled: true },
                { code: "renting", label: "租赁中", value: "renting", sortNo: 40, enabled: true },
                { code: "settlement_pending", label: "待结算", value: "settlement_pending", sortNo: 50, enabled: true },
                { code: "completed", label: "已完成", value: "completed", sortNo: 90, enabled: true }
              ]
            },
            {
              code: "customer_level",
              name: "客户等级",
              module: "客户运营",
              description: "客户等级方案和会员资料共用展示项。",
              updatedAt: "2026-05-05T10:00:00+08:00",
              updatedBy: "seed",
              items: [
                { code: "silver", label: "白银会员", value: "MEMBER_SILVER", sortNo: 10, enabled: true },
                { code: "gold", label: "黄金会员", value: "MEMBER_GOLD", sortNo: 20, enabled: true },
                { code: "black", label: "黑金会员", value: "MEMBER_BLACK", sortNo: 30, enabled: true }
              ]
            },
            {
              code: "vehicle_operation_status",
              name: "车辆营运状态",
              module: "门市租赁",
              description: "车辆档案库和调度看板共用的实例状态字典。",
              updatedAt: "2026-06-08T00:00:00+08:00",
              updatedBy: "seed",
              items: [
                { code: "idle", label: "空闲", value: "idle", sortNo: 10, enabled: true },
                { code: "reserved", label: "已预约", value: "reserved", sortNo: 20, enabled: true },
                { code: "renting", label: "租赁中", value: "renting", sortNo: 30, enabled: true },
                { code: "controlled", label: "受控", value: "controlled", sortNo: 40, enabled: true },
                { code: "maintenance", label: "维保中", value: "maintenance", sortNo: 50, enabled: true },
                { code: "disabled", label: "停用", value: "disabled", sortNo: 90, enabled: true }
              ]
            }
          ]
        },
        operator: "seed"
      },
      create: {
        tenantId: tenant.id,
        module: "platform-dictionaries",
        versionNo: 1,
        status: ConfigStatus.EFFECTIVE,
        content: {
          groups: [
            {
              code: "order_main_status",
              name: "门市订单主状态",
              module: "门市租赁",
              description: "按门市租车订单状态 PRD 维护主状态展示文案。",
              updatedAt: "2026-06-08T00:00:00+08:00",
              updatedBy: "seed",
              items: [
                { code: "pending_payment", label: "待支付", value: "pending_payment", sortNo: 10, enabled: true },
                { code: "reserved", label: "已预订", value: "reserved", sortNo: 20, enabled: true },
                { code: "inspecting", label: "验车中", value: "inspecting", sortNo: 30, enabled: true },
                { code: "renting", label: "租赁中", value: "renting", sortNo: 40, enabled: true },
                { code: "settlement_pending", label: "待结算", value: "settlement_pending", sortNo: 50, enabled: true },
                { code: "completed", label: "已完成", value: "completed", sortNo: 90, enabled: true }
              ]
            },
            {
              code: "customer_level",
              name: "客户等级",
              module: "客户运营",
              description: "客户等级方案和会员资料共用展示项。",
              updatedAt: "2026-05-05T10:00:00+08:00",
              updatedBy: "seed",
              items: [
                { code: "silver", label: "白银会员", value: "MEMBER_SILVER", sortNo: 10, enabled: true },
                { code: "gold", label: "黄金会员", value: "MEMBER_GOLD", sortNo: 20, enabled: true },
                { code: "black", label: "黑金会员", value: "MEMBER_BLACK", sortNo: 30, enabled: true }
              ]
            },
            {
              code: "vehicle_operation_status",
              name: "车辆营运状态",
              module: "门市租赁",
              description: "车辆档案库和调度看板共用的实例状态字典。",
              updatedAt: "2026-06-08T00:00:00+08:00",
              updatedBy: "seed",
              items: [
                { code: "idle", label: "空闲", value: "idle", sortNo: 10, enabled: true },
                { code: "reserved", label: "已预约", value: "reserved", sortNo: 20, enabled: true },
                { code: "renting", label: "租赁中", value: "renting", sortNo: 30, enabled: true },
                { code: "controlled", label: "受控", value: "controlled", sortNo: 40, enabled: true },
                { code: "maintenance", label: "维保中", value: "maintenance", sortNo: 50, enabled: true },
                { code: "disabled", label: "停用", value: "disabled", sortNo: 90, enabled: true }
              ]
            }
          ]
        },
        operator: "seed"
      }
    });

    await prisma.systemParameterSet.upsert({
      where: {
        tenantId_module_versionNo: {
          tenantId: tenant.id,
          module: "platform-number-rules",
          versionNo: 1
        }
      },
      update: {
        status: ConfigStatus.EFFECTIVE,
        content: {
          rules: [
            { code: "STORE_ORDER", name: "门市订单号", module: "订单中心", prefix: "SO", datePattern: "yyyyMMdd", sequenceLength: 6, currentSequence: 0, resetCycle: "daily", enabled: true, sample: "SO-20260505-000001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" },
            { code: "CONTRACT", name: "合同编号", module: "合同单据", prefix: "CT", datePattern: "yyyyMM", sequenceLength: 5, currentSequence: 0, resetCycle: "monthly", enabled: true, sample: "CT-202605-00001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" },
            { code: "ACCIDENT_REPORT", name: "事故报案号", module: "事故出险", prefix: "AC", datePattern: "yyyyMMdd", sequenceLength: 4, currentSequence: 0, resetCycle: "daily", enabled: true, sample: "AC-20260505-0001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" },
            { code: "CUSTOMER", name: "客户编号", module: "客户运营", prefix: "CU", datePattern: "yyyyMM", sequenceLength: 5, currentSequence: 0, resetCycle: "monthly", enabled: true, sample: "CU-202605-00001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" },
            { code: "VEHICLE_LICENSE", name: "车辆证照编号", module: "车辆资产", prefix: "VL", datePattern: "yyyyMM", sequenceLength: 4, currentSequence: 0, resetCycle: "monthly", enabled: true, sample: "VL-202605-0001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" }
          ]
        },
        operator: "seed"
      },
      create: {
        tenantId: tenant.id,
        module: "platform-number-rules",
        versionNo: 1,
        status: ConfigStatus.EFFECTIVE,
        content: {
          rules: [
            { code: "STORE_ORDER", name: "门市订单号", module: "订单中心", prefix: "SO", datePattern: "yyyyMMdd", sequenceLength: 6, currentSequence: 0, resetCycle: "daily", enabled: true, sample: "SO-20260505-000001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" },
            { code: "CONTRACT", name: "合同编号", module: "合同单据", prefix: "CT", datePattern: "yyyyMM", sequenceLength: 5, currentSequence: 0, resetCycle: "monthly", enabled: true, sample: "CT-202605-00001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" },
            { code: "ACCIDENT_REPORT", name: "事故报案号", module: "事故出险", prefix: "AC", datePattern: "yyyyMMdd", sequenceLength: 4, currentSequence: 0, resetCycle: "daily", enabled: true, sample: "AC-20260505-0001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" },
            { code: "CUSTOMER", name: "客户编号", module: "客户运营", prefix: "CU", datePattern: "yyyyMM", sequenceLength: 5, currentSequence: 0, resetCycle: "monthly", enabled: true, sample: "CU-202605-00001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" },
            { code: "VEHICLE_LICENSE", name: "车辆证照编号", module: "车辆资产", prefix: "VL", datePattern: "yyyyMM", sequenceLength: 4, currentSequence: 0, resetCycle: "monthly", enabled: true, sample: "VL-202605-0001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" }
          ]
        },
        operator: "seed"
      }
    });
  }
}

async function upsertRentalMasterData() {
  const tenantId = "tenant_001";
  for (const station of stations) {
    const { id, ...stationRow } = station;
    await prisma.storeStation.upsert({
      where: { id },
      update: { ...stationRow, tenantId },
      create: { id, ...stationRow, tenantId }
    });
  }

  for (const group of vehicleGroups) {
    const { id, ...groupRow } = group;
    await prisma.vehicleGroup.upsert({
      where: { id },
      update: { tenantId, ...groupRow, status: "enabled" },
      create: { id, tenantId, ...groupRow, status: "enabled" }
    });
  }

  for (const vehicle of vehicles) {
    await prisma.vehicle.upsert({
      where: { id: vehicle.id },
      update: {
        tenantId,
        storeId: vehicle.storeId,
        currentStationId: vehicle.stationId,
        vehicleGroupId: vehicle.vehicleGroupId,
        plateNo: vehicle.plateNo,
        vin: vehicle.vin,
        assetCompanyName: "演示香港租户",
        color: vehicle.color,
        cid: vehicle.cid,
        isSpecial: vehicle.isSpecial,
        enabled: true,
        operationStatus: vehicle.operationStatus,
        currentServiceType: vehicle.serviceType,
        serviceTypes: vehicle.serviceTypes,
        mileage: vehicle.mileage,
        status: vehicle.status
      },
      create: {
        id: vehicle.id,
        tenantId,
        storeId: vehicle.storeId,
        currentStationId: vehicle.stationId,
        vehicleGroupId: vehicle.vehicleGroupId,
        plateNo: vehicle.plateNo,
        vin: vehicle.vin,
        assetCompanyName: "演示香港租户",
        color: vehicle.color,
        cid: vehicle.cid,
        isSpecial: vehicle.isSpecial,
        enabled: true,
        operationStatus: vehicle.operationStatus,
        currentServiceType: vehicle.serviceType,
        serviceTypes: vehicle.serviceTypes,
        mileage: vehicle.mileage,
        status: vehicle.status
      }
    });
  }

  for (const vehicle of vehicles) {
    await prisma.vehicleCredentialRecord.upsert({
      where: { id: `cred_${vehicle.id}_license` },
      update: {
        vehicleId: vehicle.id,
        credentialType: "license",
        credentialName: "车辆牌照登记证",
        certNo: `${vehicle.plateNo.replace(/\s/g, "")}-LIC`,
        status: "valid",
        issueAt: new Date("2026-01-01T00:00:00+08:00"),
        expiresAt: new Date("2026-12-31T23:59:59+08:00"),
        reminderDays: 30,
        attachments: [],
        operator: "seed"
      },
      create: {
        id: `cred_${vehicle.id}_license`,
        vehicleId: vehicle.id,
        credentialType: "license",
        credentialName: "车辆牌照登记证",
        certNo: `${vehicle.plateNo.replace(/\s/g, "")}-LIC`,
        status: "valid",
        issueAt: new Date("2026-01-01T00:00:00+08:00"),
        expiresAt: new Date("2026-12-31T23:59:59+08:00"),
        reminderDays: 30,
        attachments: [],
        operator: "seed"
      }
    });
    await prisma.vehicleCredentialRecord.upsert({
      where: { id: `cred_${vehicle.id}_insurance` },
      update: {
        vehicleId: vehicle.id,
        credentialType: "insurance",
        credentialName: "车辆保险",
        certNo: `${vehicle.plateNo.replace(/\s/g, "")}-INS`,
        status: vehicle.operationStatus === VehicleOperationStatus.RENTING ? "valid" : "expiring",
        issueAt: new Date("2026-01-01T00:00:00+08:00"),
        expiresAt: new Date("2026-06-30T23:59:59+08:00"),
        reminderDays: 30,
        attachments: [],
        operator: "seed"
      },
      create: {
        id: `cred_${vehicle.id}_insurance`,
        vehicleId: vehicle.id,
        credentialType: "insurance",
        credentialName: "车辆保险",
        certNo: `${vehicle.plateNo.replace(/\s/g, "")}-INS`,
        status: vehicle.operationStatus === VehicleOperationStatus.RENTING ? "valid" : "expiring",
        issueAt: new Date("2026-01-01T00:00:00+08:00"),
        expiresAt: new Date("2026-06-30T23:59:59+08:00"),
        reminderDays: 30,
        attachments: [],
        operator: "seed"
      }
    });

    const onboardItems = [
      { id: `item_${vehicle.id}_key`, category: "key", itemName: "车辆钥匙", standardQuantity: 2, actualQuantity: vehicle.serviceType === VehicleServiceType.STORE_24H ? 1 : 2, status: vehicle.serviceType === VehicleServiceType.STORE_24H ? "missing" : "normal", priceAmount: 500, remark: vehicle.serviceType === VehicleServiceType.STORE_24H ? "自助点保留一把备用钥匙" : undefined },
      { id: `item_${vehicle.id}_doc`, category: "document", itemName: "行驶证/登记文件影本", standardQuantity: 1, actualQuantity: 1, status: "normal", priceAmount: 0, remark: undefined },
      { id: `item_${vehicle.id}_clean`, category: "cleaning", itemName: "清洁包", standardQuantity: 1, actualQuantity: 1, status: "normal", priceAmount: 80, remark: undefined }
    ];
    for (const item of onboardItems) {
      await prisma.vehicleOnboardItem.upsert({
        where: { id: item.id },
        update: {
          vehicleId: vehicle.id,
          category: item.category,
          itemName: item.itemName,
          standardQuantity: item.standardQuantity,
          actualQuantity: item.actualQuantity,
          status: item.status,
          priceAmount: item.priceAmount,
          checkedAt: new Date(),
          operator: "seed",
          remark: item.remark
        },
        create: {
          id: item.id,
          vehicleId: vehicle.id,
          category: item.category,
          itemName: item.itemName,
          standardQuantity: item.standardQuantity,
          actualQuantity: item.actualQuantity,
          status: item.status,
          priceAmount: item.priceAmount,
          checkedAt: new Date(),
          operator: "seed",
          remark: item.remark
        }
      });
    }

    await prisma.tboxDevice.upsert({
      where: {
        tenantId_cid: {
          tenantId,
          cid: vehicle.cid
        }
      },
      update: {
        provider: "store-rental reserved",
        modelNo: vehicle.serviceType === VehicleServiceType.STORE_24H ? "RTB-LTE-V1" : "RTB-4G-V2",
        status: "active",
        onlineStatus: "online",
        boundVehicleId: vehicle.id,
        batteryLevel: vehicle.serviceType === VehicleServiceType.STORE_24H ? 82 : 96,
        signalStrength: 88,
        lastHeartbeatAt: new Date()
      },
      create: {
        id: `tbox_${vehicle.cid}`,
        tenantId,
        cid: vehicle.cid,
        provider: "store-rental reserved",
        modelNo: vehicle.serviceType === VehicleServiceType.STORE_24H ? "RTB-LTE-V1" : "RTB-4G-V2",
        status: "active",
        onlineStatus: "online",
        boundVehicleId: vehicle.id,
        batteryLevel: vehicle.serviceType === VehicleServiceType.STORE_24H ? 82 : 96,
        signalStrength: 88,
        lastHeartbeatAt: new Date()
      }
    });
  }

  for (const station of stations) {
    for (const offset of [0, 1, 2, 3, 4, 5, 6]) {
      const date = new Date("2026-06-08T00:00:00+08:00");
      date.setDate(date.getDate() + offset);
      await prisma.stationCalendarDay.upsert({
        where: {
          stationId_date: {
            stationId: station.id,
            date
          }
        },
        update: {
          businessStatus: station.serviceStatus === "maintenance" ? "paused" : "open",
          openTime: "09:00",
          closeTime: station.serviceTypes.includes("STORE_24H") ? "23:59" : "20:00",
          capacityLimit: station.id === "station_airport" ? 36 : 18,
          note: station.serviceStatus === "maintenance" ? "站点维护中，需客服人工处理" : undefined,
          operator: "seed"
        },
        create: {
          id: `cal_${station.id}_${offset}`,
          stationId: station.id,
          date,
          businessStatus: station.serviceStatus === "maintenance" ? "paused" : "open",
          openTime: "09:00",
          closeTime: station.serviceTypes.includes("STORE_24H") ? "23:59" : "20:00",
          capacityLimit: station.id === "station_airport" ? 36 : 18,
          note: station.serviceStatus === "maintenance" ? "站点维护中，需客服人工处理" : undefined,
          operator: "seed"
        }
      });
    }

    const snapId = `cap_${station.id}_20260608`;
    await prisma.stationCapacitySnapshot.upsert({
      where: { id: snapId },
      update: {
        totalSpaces: station.id === "station_airport" ? 36 : 18,
        availableSpaces: station.id === "station_airport" ? 11 : 6,
        reservedSpaces: station.id === "station_airport" ? 25 : 12,
        occupiedVehicles: vehicles.filter((vehicle) => vehicle.stationId === station.id).length,
        pendingPickupVehicles: station.id === "station_mk_counter" ? 1 : 0,
        pendingReturnVehicles: station.id === "station_airport" ? 1 : 0,
        operator: "seed",
        source: "system"
      },
      create: {
        id: snapId,
        stationId: station.id,
        date: new Date("2026-06-08T00:00:00+08:00"),
        totalSpaces: station.id === "station_airport" ? 36 : 18,
        availableSpaces: station.id === "station_airport" ? 11 : 6,
        reservedSpaces: station.id === "station_airport" ? 25 : 12,
        occupiedVehicles: vehicles.filter((vehicle) => vehicle.stationId === station.id).length,
        pendingPickupVehicles: station.id === "station_mk_counter" ? 1 : 0,
        pendingReturnVehicles: station.id === "station_airport" ? 1 : 0,
        operator: "seed",
        source: "system"
      }
    });
  }
}

async function upsertCustomers() {
  const tenantId = "tenant_001";
  const plans = [
    { id: "member_plan_silver", code: "MEMBER_SILVER", name: "白银会员", tierRank: 1, orderDiscountPercent: 0, depositDiscountPercent: 0 },
    { id: "member_plan_gold", code: "MEMBER_GOLD", name: "黄金会员", tierRank: 2, orderDiscountPercent: 5, depositDiscountPercent: 10 },
    { id: "member_plan_black", code: "MEMBER_BLACK", name: "黑金会员", tierRank: 3, orderDiscountPercent: 10, depositDiscountPercent: 20 }
  ];

  for (const plan of plans) {
    await prisma.membershipPlan.upsert({
      where: { id: plan.id },
      update: {
        tenantId,
        code: plan.code,
        name: plan.name,
        status: ConfigStatus.EFFECTIVE,
        levelRules: { tierRank: plan.tierRank },
        benefits: {
          orderDiscountPercent: plan.orderDiscountPercent,
          depositDiscountPercent: plan.depositDiscountPercent
        }
      },
      create: {
        id: plan.id,
        tenantId,
        code: plan.code,
        name: plan.name,
        status: ConfigStatus.EFFECTIVE,
        levelRules: { tierRank: plan.tierRank },
        benefits: {
          orderDiscountPercent: plan.orderDiscountPercent,
          depositDiscountPercent: plan.depositDiscountPercent
        }
      }
    });
  }

  for (const member of members) {
    const { id, ...memberRow } = member;
    await prisma.member.upsert({
      where: { id },
      update: { tenantId, ...memberRow },
      create: { id, tenantId, ...memberRow }
    });
  }

  for (const corporate of corporates) {
    const { id, contacts, contracts, ...corporateRow } = corporate;
    await prisma.corporate.upsert({
      where: { id },
      update: { tenantId, ...corporateRow },
      create: { id, tenantId, ...corporateRow }
    });

    for (const contact of contacts) {
      const { id: contactId, ...contactRow } = contact;
      await prisma.corporateContact.upsert({
        where: { id: contactId },
        update: { corporateId: id, ...contactRow },
        create: { id: contactId, corporateId: id, ...contactRow }
      });
    }

    for (const contract of contracts) {
      const { id: contractId, ...contractRow } = contract;
      await prisma.corporateContract.upsert({
        where: { id: contractId },
        update: { corporateId: id, ...contractRow },
        create: { id: contractId, corporateId: id, ...contractRow }
      });
    }
  }
}

async function upsertSceneOrders() {
  const tenantId = "tenant_001";
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const sceneOrders = [
    {
      id: "order_scene_001",
      orderNo: "SO-20260625-0001",
      mode: "store_rental" as const,
      mainStatus: "renting" as const,
      dispatchStatus: "locked" as const,
      paymentStatus: "deposit_paid" as const,
      billingMode: "customer_pay" as const,
      memberId: "member_001",
      customerName: "陈嘉豪",
      customerPhoneMasked: "852****2388",
      vehicleGroupId: "VG_SEVEN",
      assignedVehicleId: "VEH_001",
      pickupStationId: "station_mk_counter",
      returnStationId: "station_mk_counter",
      pickupStoreSnapshot: { storeName: "旺角门市", stationName: "旺角门市柜台" },
      returnStoreSnapshot: { storeName: "旺角门市", stationName: "旺角门市柜台" },
      vehicleGroupSnapshot: { id: "VG_SEVEN", code: "VG_SEVEN", name: "Toyota Noah / 同级 7座", seats: 7, brand: "Toyota", model: "Noah", energyType: "fuel", transmission: "auto" },
      pricingSnapshot: { dailyRate: 780, depositAmount: 5000, currency: "HKD", pricingRuleVersion: 1 },
      termsSnapshot: { minRentalDays: 1, maxRentalDays: 30, mileagePolicy: "unlimited", fuelPolicy: "same_level_return", lateFeePerHour: 120, cancellationPolicy: "free_before_24h" },
      pickupAt: yesterday,
      returnAt: tomorrow,
      totalAmount: 2380,
      riskFlags: ["企业月结", "已验车"]
    },
    {
      id: "order_scene_002",
      orderNo: "SO-20260625-0002",
      mode: "store_rental" as const,
      mainStatus: "reserved" as const,
      dispatchStatus: "pre_assigned" as const,
      paymentStatus: "deposit_paid" as const,
      billingMode: "customer_pay" as const,
      memberId: "member_002",
      customerName: "林慧仪",
      customerPhoneMasked: "852****6619",
      vehicleGroupId: "VG_ECONOMY",
      assignedVehicleId: "VEH_002",
      pickupStationId: "station_central",
      returnStationId: "station_airport",
      pickupStoreSnapshot: { storeName: "中环门市", stationName: "中环门市服务点" },
      returnStoreSnapshot: { storeName: "机场门市", stationName: "机场门市停车区" },
      vehicleGroupSnapshot: { id: "VG_ECONOMY", code: "VG_ECONOMY", name: "Honda Jazz / 同级", seats: 5, brand: "Honda", model: "Fit", energyType: "fuel", transmission: "auto" },
      pricingSnapshot: { dailyRate: 380, depositAmount: 3000, currency: "HKD", pricingRuleVersion: 1 },
      termsSnapshot: { minRentalDays: 1, maxRentalDays: 30, mileagePolicy: "unlimited", fuelPolicy: "same_level_return", lateFeePerHour: 80, cancellationPolicy: "free_before_24h" },
      pickupAt: tomorrow,
      returnAt: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000),
      totalAmount: 780,
      riskFlags: ["异店还车", "待取车"]
    },
    {
      id: "order_scene_003",
      orderNo: "SO-20260625-0003",
      mode: "store_rental" as const,
      mainStatus: "completed" as const,
      dispatchStatus: "locked" as const,
      paymentStatus: "monthly_billing" as const,
      billingMode: "monthly" as const,
      memberId: "member_001",
      corporateId: "corp_001",
      customerName: "陈嘉豪",
      customerPhoneMasked: "852****2388",
      corporateShortName: "ABC Trading",
      vehicleGroupId: "VG_SEVEN",
      assignedVehicleId: "VEH_001",
      pickupStationId: "station_mk_counter",
      returnStationId: "station_mk_counter",
      pickupStoreSnapshot: { storeName: "旺角门市", stationName: "旺角门市柜台" },
      returnStoreSnapshot: { storeName: "旺角门市", stationName: "旺角门市柜台" },
      vehicleGroupSnapshot: { id: "VG_SEVEN", code: "VG_SEVEN", name: "Toyota Noah / 同级 7座", seats: 7, brand: "Toyota", model: "Noah", energyType: "fuel", transmission: "auto" },
      pricingSnapshot: { dailyRate: 780, depositAmount: 5000, currency: "HKD", pricingRuleVersion: 1 },
      termsSnapshot: { minRentalDays: 1, maxRentalDays: 30, mileagePolicy: "unlimited", fuelPolicy: "same_level_return", lateFeePerHour: 120, cancellationPolicy: "free_before_24h" },
      pickupAt: yesterday,
      returnAt: yesterday,
      totalAmount: 4500,
      riskFlags: ["企业月结", "已完成"]
    },
    {
      id: "order_scene_004",
      orderNo: "SO-20260625-0004",
      mode: "store_rental" as const,
      mainStatus: "accident_processing" as const,
      dispatchStatus: "locked" as const,
      paymentStatus: "deposit_paid" as const,
      billingMode: "customer_pay" as const,
      memberId: "member_003",
      customerName: "王子俊",
      customerPhoneMasked: "852****9081",
      vehicleGroupId: "VG_EV",
      assignedVehicleId: "VEH_003",
      pickupStationId: "station_airport",
      returnStationId: "station_airport",
      pickupStoreSnapshot: { storeName: "机场门市", stationName: "机场门市停车区" },
      returnStoreSnapshot: { storeName: "机场门市", stationName: "机场门市停车区" },
      vehicleGroupSnapshot: { id: "VG_EV", code: "VG_EV", name: "Tesla Model 3 / 同级", seats: 5, brand: "Tesla", model: "Model 3", energyType: "ev", transmission: "auto" },
      pricingSnapshot: { dailyRate: 1080, depositAmount: 8000, currency: "HKD", pricingRuleVersion: 1 },
      termsSnapshot: { minRentalDays: 1, maxRentalDays: 30, mileagePolicy: "unlimited", fuelPolicy: "same_level_return", lateFeePerHour: 150, cancellationPolicy: "free_before_24h" },
      pickupAt: yesterday,
      returnAt: tomorrow,
      totalAmount: 3200,
      riskFlags: ["事故处理中"]
    },
    {
      id: "order_scene_005",
      orderNo: "SO-20260625-0005",
      mode: "store_rental" as const,
      mainStatus: "pending_payment" as const,
      dispatchStatus: "unassigned" as const,
      paymentStatus: "unpaid" as const,
      billingMode: "customer_pay" as const,
      memberId: "member_002",
      customerName: "林慧仪",
      customerPhoneMasked: "852****6619",
      vehicleGroupId: "VG_ECONOMY",
      pickupStationId: "station_central",
      returnStationId: "station_central",
      pickupStoreSnapshot: { storeName: "中环门市", stationName: "中环门市服务点" },
      returnStoreSnapshot: { storeName: "中环门市", stationName: "中环门市服务点" },
      vehicleGroupSnapshot: { id: "VG_ECONOMY", code: "VG_ECONOMY", name: "Honda Jazz / 同级", seats: 5, brand: "Honda", model: "Fit", energyType: "fuel", transmission: "auto" },
      pricingSnapshot: { dailyRate: 380, depositAmount: 3000, currency: "HKD", pricingRuleVersion: 1 },
      termsSnapshot: { minRentalDays: 1, maxRentalDays: 30, mileagePolicy: "unlimited", fuelPolicy: "same_level_return", lateFeePerHour: 80, cancellationPolicy: "free_before_24h" },
      pickupAt: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000),
      returnAt: new Date(tomorrow.getTime() + 3 * 24 * 60 * 60 * 1000),
      totalAmount: 760,
      riskFlags: ["待支付"]
    },
    {
      id: "order_scene_006",
      orderNo: "SO-20260625-0006",
      mode: "store_rental" as const,
      mainStatus: "settlement_pending" as const,
      dispatchStatus: "locked" as const,
      paymentStatus: "deposit_paid" as const,
      billingMode: "customer_pay" as const,
      memberId: "member_003",
      customerName: "王子俊",
      customerPhoneMasked: "852****9081",
      vehicleGroupId: "VG_EV",
      assignedVehicleId: "VEH_003",
      pickupStationId: "station_airport",
      returnStationId: "station_airport",
      pickupStoreSnapshot: { storeName: "机场门市", stationName: "机场门市停车区" },
      returnStoreSnapshot: { storeName: "机场门市", stationName: "机场门市停车区" },
      vehicleGroupSnapshot: { id: "VG_EV", code: "VG_EV", name: "Tesla Model 3 / 同级", seats: 5, brand: "Tesla", model: "Model 3", energyType: "ev", transmission: "auto" },
      pricingSnapshot: { dailyRate: 1080, depositAmount: 8000, currency: "HKD", pricingRuleVersion: 1 },
      termsSnapshot: { minRentalDays: 1, maxRentalDays: 30, mileagePolicy: "unlimited", fuelPolicy: "same_level_return", lateFeePerHour: 150, cancellationPolicy: "free_before_24h" },
      pickupAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      returnAt: yesterday,
      totalAmount: 3240,
      riskFlags: ["待结算", "超里程"]
    },
    {
      id: "order_scene_007",
      orderNo: "SO-20260625-0007",
      mode: "store_rental" as const,
      mainStatus: "cancelled" as const,
      dispatchStatus: "unassigned" as const,
      paymentStatus: "refunded" as const,
      billingMode: "customer_pay" as const,
      memberId: "member_001",
      customerName: "陈嘉豪",
      customerPhoneMasked: "852****2388",
      vehicleGroupId: "VG_SEVEN",
      pickupStationId: "station_mk_counter",
      returnStationId: "station_mk_counter",
      pickupStoreSnapshot: { storeName: "旺角门市", stationName: "旺角门市柜台" },
      returnStoreSnapshot: { storeName: "旺角门市", stationName: "旺角门市柜台" },
      vehicleGroupSnapshot: { id: "VG_SEVEN", code: "VG_SEVEN", name: "Toyota Noah / 同级 7座", seats: 7, brand: "Toyota", model: "Noah", energyType: "fuel", transmission: "auto" },
      pricingSnapshot: { dailyRate: 780, depositAmount: 5000, currency: "HKD", pricingRuleVersion: 1 },
      termsSnapshot: { minRentalDays: 1, maxRentalDays: 30, mileagePolicy: "unlimited", fuelPolicy: "same_level_return", lateFeePerHour: 120, cancellationPolicy: "free_before_24h" },
      pickupAt: yesterday,
      returnAt: tomorrow,
      totalAmount: 1560,
      riskFlags: ["已取消"]
    }
  ];

  for (const order of sceneOrders) {
    const createData = {
      tenantId,
      ...order
      } as unknown as Prisma.StoreRentalOrderUncheckedCreateInput;
    const updateData = {
      tenantId,
      ...order
      } as unknown as Prisma.StoreRentalOrderUncheckedUpdateInput;
    await prisma.storeRentalOrder.upsert({
      where: { id: order.id },
      update: updateData,
      create: createData
    });
  }
}

async function main() {
  await upsertTenants();
  await upsertRentalCategoriesAndProfiles();
  await upsertOrganizations();
  await upsertPermissions();
  await upsertRolesAndUsers();
  await upsertSystemParameters();
  await upsertRentalMasterData();
  await upsertCustomers();
  await upsertSceneOrders();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Store rental seed completed.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
