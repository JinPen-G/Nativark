import {
  ConfigStatus,
  OrganizationType,
  PermissionKind,
  Prisma,
  PrismaClient,
  RentalCategoryCode,
  RoleScope,
  SystemDataScope,
  TenantStatus,
  WorkspaceStatus
} from "@prisma/client";
import {
  RENTAL_CATEGORY_DEFINITIONS,
  RentalCategoryCode as SharedRentalCategoryCode
} from "@rental-os/shared";
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
      { id: "org_store_mongkok", parentId: "org_operator_hk", type: OrganizationType.STORE, code: "STORE-MK", name: "旺角服务点" },
      { id: "org_store_central", parentId: "org_operator_hk", type: OrganizationType.STORE, code: "STORE-CENTRAL", name: "中环服务点" },
      { id: "org_store_airport", parentId: "org_operator_hk", type: OrganizationType.STORE, code: "STORE-AIRPORT", name: "机场服务点" }
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
      { id: "org_store_nanshan", parentId: "org_operator_sz", type: OrganizationType.STORE, code: "STORE-NS", name: "南山服务点" }
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
  ["rental-core:catalog:view", "通用商品目录查看", "Rental Core", PermissionKind.ACTION],
  ["rental-core:catalog:manage", "通用商品目录管理", "Rental Core", PermissionKind.ACTION],
  ["rental-core:asset:view", "通用资产库存查看", "Rental Core", PermissionKind.ACTION],
  ["rental-core:asset:manage", "通用资产库存管理", "Rental Core", PermissionKind.ACTION],
  ["rental-core:maintenance:view", "养护工单查看", "Rental Core", PermissionKind.ACTION, "查看归还处置和养护工单"],
  ["rental-core:maintenance:manage", "养护工单处理", "Rental Core", PermissionKind.ACTION, "创建、派工、开始和提交养护工单"],
  ["rental-core:maintenance:review", "养护工单验收", "Rental Core", PermissionKind.ACTION, "审核养护结果并恢复库存可用状态"],
  // CORE-EXT-02A：能力治理与订单操作分权。门店营运不该能停用整个空间的业务能力，
  // 因此这两个权限**不**进 STORE_OPERATOR 模板；租户管理员靠 fixedAllPermissions 覆盖。
  ["rental-core:capability:view", "经营空间能力查看", "Rental Core", PermissionKind.ACTION],
  ["rental-core:capability:manage", "经营空间能力治理", "Rental Core", PermissionKind.ACTION],
  // CAM-01A：确认能力风险提示后才能带风险下单。与 :manage 分开授权（见 platform.service 注释）。
  ["rental-core:capability:override", "能力风险例外确认", "Rental Core", PermissionKind.ACTION],
  ["rental-os:rules:manage", "业务规则配置", "租赁业务", PermissionKind.ACTION],
  // RULE-01A：需求 4.6.14 明确「权限分为规则编辑、规则发布……」。发布会改变对外生效的
  // 条款，与编辑草稿是两个责任；共用一个码等于任何能改草稿的人都能直接对客户生效。
  ["rental-os:rules:publish", "业务规则发布", "租赁业务", PermissionKind.ACTION, "发布或安排规则版本生效、作废已发布或待生效版本"],
  ["rental-os:order:view", "订单查看", "租赁业务", PermissionKind.ACTION, "查看租赁订单列表和详情"],
  ["rental-os:order:operate", "订单操作", "租赁业务", PermissionKind.ACTION, "新建租赁订单、领取检查和归还检查"],
  ["rental-os:order:reassign", "资源解锁与改配", "租赁业务", PermissionKind.ACTION, "解锁、释放及更换订单锁定资源，必须填写原因"],
  ["rental-os:order:settle", "订单结算", "租赁业务", PermissionKind.ACTION, "确认费用、补缴、退款或月结入账"],
  ["rental-os:member:account-manage", "会员账号与密码管理", "会员管理", PermissionKind.ACTION, "开通账号、设置临时密码和管理账号状态"],
  ["rental-os:member:review", "会员注册审核", "会员管理", PermissionKind.ACTION, "处理个人会员注册审核，不含证件审核"],
  ["rental-os:member:qualification-review", "会员证件审核", "会员管理", PermissionKind.ACTION, "处理身份证件和品类资质审核"],
  ["rental-os:member:plan:manage", "会员方案编辑", "会员管理", PermissionKind.ACTION, "编辑个人和企业会员方案草稿、授予方案"],
  ["rental-os:member:plan:publish", "会员方案发布", "会员管理", PermissionKind.ACTION, "发布会员方案版本"],
  ["rental-os:corporate:employee-manage", "企业员工管理", "企业会员", PermissionKind.ACTION, "维护企业管理员和员工关系"],
  // ORDER-CLOSE-02：费用裁定与实际收退款分权。
  ["rental-os:order:fee-review", "费用裁定", "租赁业务", PermissionKind.ACTION, "裁定逾期人工核价、提前归还退款、续租负差额与检查异常的金额；不含实际收退款"],
  ["rental-os:order:create", "按钮-新建订单", "租赁业务", PermissionKind.BUTTON, "显示并执行新建租赁订单入口"],
  ["rental-os:order:pickup", "按钮-领取交付", "租赁业务", PermissionKind.BUTTON, "执行领取交付和确认开始履约"],
  ["rental-os:order:return", "按钮-归还验收", "租赁业务", PermissionKind.BUTTON, "执行归还验收和提交结算"],
  ["rental-os:order:extend", "按钮-延长租期", "租赁业务", PermissionKind.BUTTON, "执行延长租期和逾期补办续租"],
  ["rental-os:order:cancel", "按钮-取消/爽约", "租赁业务", PermissionKind.BUTTON, "执行取消订单和标记爽约"],
  ["rental-os:order:close", "按钮-关闭/拒绝履约", "租赁业务", PermissionKind.BUTTON, "执行关闭订单和拒绝履约"],
  ["rental-os:order:fee-manage", "按钮-费用处理", "租赁业务", PermissionKind.BUTTON, "登记订单费用、收款、退款和减免"],
  ["rental-os:dispatch:manage", "调度管理", "租赁业务", PermissionKind.ACTION],
  ["rental-os:price:manage", "价格规则", "租赁业务", PermissionKind.ACTION],
  ["rental-os:calendar:edit", "营业日历编辑（草稿）", "租赁业务", PermissionKind.ACTION, "新建和修改营业日历草稿，不含发布"],
  ["rental-os:calendar:publish", "营业日历发布", "租赁业务", PermissionKind.ACTION, "发布年度营业日历版本"],
  // 需求 4.5.8：客服或财务「查看历史版本及报价命中的日历依据，不得修改」。
  // 没有这个独立权限时，给客服开放历史就只能顺带授予编辑、发布或规则管理权，权限过大。
  ["rental-os:calendar:view-history", "营业日历历史只读", "租赁业务", PermissionKind.ACTION, "查看历史版本、发布差异、覆盖审计与报价命中的日历依据，不得修改"],
  ["rental-os:marketing:manage", "行销方案管理", "租赁业务", PermissionKind.ACTION],
  ["rental-os:station:view", "履约地点查看", "租赁业务", PermissionKind.ACTION],
  ["rental-os:station:manage", "履约地点管理", "租赁业务", PermissionKind.ACTION],
  ["rental-os:vehicle-group:manage", "品类型号与分组管理", "租赁业务", PermissionKind.ACTION],
  ["rental-os:vehicle:view", "品类资产查看", "租赁业务", PermissionKind.ACTION],
  ["rental-os:vehicle:manage", "品类资产管理", "租赁业务", PermissionKind.ACTION],
  ["rental-os:vehicle:status-action", "按钮-品类资产状态动作", "租赁业务", PermissionKind.BUTTON, "启停、维保、异常和状态处置"],
  ["rental-os:member:view", "会员查看", "租赁业务", PermissionKind.ACTION],
  ["rental-os:member:manage", "会员管理", "租赁业务", PermissionKind.ACTION],
  // 空间证件类型独立授权：守卫对 /membership/qualification-types 的写入只认这个码。
  // 存量角色未补授前，管理端靠旧的 member:manage 兜底进入页面；实际写入仍需授予本码。
  ["rental-os:qualification-type:manage", "空间证件类型管理", "租赁业务", PermissionKind.ACTION, "维护当前经营空间的资质证件类型"],
  ["rental-os:member:risk-action", "按钮-会员风控动作", "租赁业务", PermissionKind.BUTTON, "暂停、拉黑和恢复会员"],
  // CUSTOMER-01B：敏感资料解密查看单独授权（需求 4.8.5 / 4.8.14）。
  // 与「会员查看」分开：日常查客户只该看到脱敏值，看明文是另一件需要单独追责的事。
  ["rental-os:customer:reveal-sensitive", "客户敏感资料解密", "租赁业务", PermissionKind.ACTION, "查看客户证件号等明文，并可查阅敏感访问审计"],
  // CUSTOMER-01D：需求 4.8.14 要求客户合并与注销**分别授权**。
  // 两者都不可逆，且影响面不同：合并改变身份归属，注销终止业务资格。
  ["rental-os:customer:merge", "客户合并", "租赁业务", PermissionKind.ACTION, "人工合并重复客户主档，不可逆"],
  ["rental-os:customer:close", "客户注销", "租赁业务", PermissionKind.ACTION, "注销客户账号或空间会员关系，不可逆"],
  ["rental-os:corporate:view", "企业客户查看", "租赁业务", PermissionKind.ACTION],
  ["rental-os:corporate:manage", "企业客户管理", "租赁业务", PermissionKind.ACTION],
  ["rental-os:corporate:monthly-settle", "按钮-企业月结回款", "租赁业务", PermissionKind.BUTTON, "登记企业账单回款"],
  ["rental-os:finance:view", "财务查看", "租赁业务", PermissionKind.ACTION, "查看资金流水、发票收据、调账和对账"],
  ["rental-os:finance:manage", "财务管理", "租赁业务", PermissionKind.ACTION, "维护财务单据和处理资金状态"],
  ["rental-os:finance:adjust", "按钮-手工调账", "租赁业务", PermissionKind.BUTTON, "提交、审核和入账手工调账"],
  ["rental-os:finance:invoice", "按钮-发票/收据", "租赁业务", PermissionKind.BUTTON, "开具、发送和作废发票收据"],
  ["rental-os:finance:reconcile", "财务对账", "租赁业务", PermissionKind.ACTION, "查看和处理资金、月结、调账异常"],
  ["rental-os:service:manage", "增值服务管理", "租赁业务", PermissionKind.ACTION],
  ["rental-os:report:view", "报表查看", "租赁业务", PermissionKind.ACTION],
  ["system:user:manage", "系统用户", "系统设置", PermissionKind.ACTION],
  ["system:role:manage", "角色权限", "系统设置", PermissionKind.ACTION, "新增角色、编辑角色、配置权限"],
  ["system:params:manage", "系统通用参数", "系统设置", PermissionKind.ACTION, "维护会员、运维、日历、推送和 AI 模型接入参数"],
  ["system:audit:view", "审计日志", "系统设置", PermissionKind.ACTION],
  ["system:dictionary:manage", "数据字典", "系统设置", PermissionKind.ACTION],
  ["system:number-rule:manage", "编号规则", "系统设置", PermissionKind.ACTION],
  ["system:integration:manage", "外部接入与任务", "系统设置", PermissionKind.ACTION, "管理附件、通知、导入导出、打印、TBox 和外部 adapter mock 日志"],
  ["system:button:export", "按钮-导出", "系统设置", PermissionKind.BUTTON, "平台列表和报表导出按钮"],
  ["system:tenant:manage", "租户配置", "系统设置", PermissionKind.ACTION],
  // 公共官方日历来源注册表（需求 4.5.8）。跨租户的公共基础数据，只授予 SaaS 平台管理员；
  // 它不含任何经营空间业务数据，因此与「不得借此查看空间业务数据」不冲突。
  ["system:calendar-source:manage", "公共官方日历来源维护", "系统设置", PermissionKind.ACTION],
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
    description: "经营空间营运人员处理订单、领取/归还和基础品类资产查看。",
    scope: RoleScope.STORE,
    fixedAllPermissions: false,
    enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H"],
    permissions: [
      "rental-os:order:view",
      "rental-os:order:operate",
      "rental-os:order:settle",
      // 与 platform.service / platform.repository 的同一条迁移：该角色原本凭 order:settle
      // 就能裁定四类费用审核，拆权后必须显式补上，否则门店营运账号裁定一律 403。
      "rental-os:order:fee-review",
      "rental-os:station:view",
      "rental-os:vehicle:view",
      "rental-core:catalog:view",
      "rental-core:asset:view",
      "rental-os:member:view",
      "rental-os:corporate:view",
      "rental-os:finance:view",
      // 门店营运兼客服口径：可查营业日历历史与报价命中的日历依据，但不得编辑或发布。
      "rental-os:calendar:view-history"
    ],
    buttonPermissions: [
      "rental-os:order:create",
      "rental-os:order:pickup",
      "rental-os:order:return",
      "rental-os:order:extend",
      "rental-os:order:cancel",
      "rental-os:order:fee-manage",
      "rental-os:vehicle:status-action"
    ],
    dataScope: SystemDataScope.STORE
  },
  {
    id: "role_pricing_manager",
    code: "PRICING_MANAGER",
    name: "价格规则管理员",
    description: "维护租赁价格、规则和增值服务配置。",
    scope: RoleScope.OPERATOR,
    fixedAllPermissions: false,
    enabledBusinessScopes: ["STORE_STANDARD", "SYSTEM_GLOBAL"],
    permissions: [
      "rental-os:rules:manage",
      "rental-os:rules:publish",
      "rental-os:price:manage",
      "rental-os:calendar:edit",
      "rental-os:calendar:publish",
      "rental-os:marketing:manage",
      "rental-os:service:manage",
      "system:params:manage",
      "system:integration:manage",
      "rental-os:order:view",
      "rental-os:finance:view",
      "rental-os:finance:reconcile",
      "rental-os:report:view"
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

async function upsertTenants() {
  for (const tenant of tenants) {
    await prisma.tenant.upsert({
      where: { id: tenant.id },
      update: { code: tenant.code, name: tenant.name, status: TenantStatus.ACTIVE },
      create: { id: tenant.id, code: tenant.code, name: tenant.name, status: TenantStatus.ACTIVE }
    });
  }
}

const categoryCodeMap: Record<SharedRentalCategoryCode, RentalCategoryCode> = {
  [SharedRentalCategoryCode.Vehicle]: RentalCategoryCode.VEHICLE,
  [SharedRentalCategoryCode.Camera]: RentalCategoryCode.CAMERA,
  [SharedRentalCategoryCode.Camping]: RentalCategoryCode.CAMPING,
  [SharedRentalCategoryCode.Construction]: RentalCategoryCode.CONSTRUCTION
};

const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const rentalCategories = RENTAL_CATEGORY_DEFINITIONS.map((category) => ({
  code: categoryCodeMap[category.code],
  name: category.name,
  description: category.description,
  supportedInventoryModes: asJson(category.supportedInventoryModes),
  defaultCapabilities: asJson(category.defaultCapabilities),
  terminology: asJson(category.terminology),
  attributeSchema: asJson(category.attributeSchema),
  businessModel: asJson(category.businessModel),
  version: category.version
}));

const demoWorkspaces = [
  { id: "ws_tenant_001", code: "default", name: "摄影设备经营空间", categoryCode: RentalCategoryCode.CAMERA, isDefault: true },
  { id: "ws_tenant_001_camping", code: "camping", name: "露营装备经营空间", categoryCode: RentalCategoryCode.CAMPING, isDefault: false },
  { id: "ws_tenant_001_vehicle", code: "vehicle", name: "车辆载具经营空间", categoryCode: RentalCategoryCode.VEHICLE, isDefault: false },
  { id: "ws_tenant_001_construction", code: "construction", name: "工程设备经营空间", categoryCode: RentalCategoryCode.CONSTRUCTION, isDefault: false }
] as const;

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
  for (const [code, name, module, kind, description] of permissions) {
    await prisma.permission.upsert({
      where: { code },
      update: { name, description: description ?? null, module, kind },
      create: { code, name, description: description ?? null, module, kind }
    });
  }
}

/**
 * Seed 账号口令只能来自环境变量，仓库不保存任何明文密码。
 * 缺失时立即失败，避免用已知默认口令创建管理员账号。
 * 兼容既有的 `E2E_*` 变量名，使已有本地 .env 无需改动即可继续工作。
 */
function requiredSeedPassword(primary: string, alias: string) {
  const value = (process.env[primary] ?? process.env[alias])?.trim();
  if (!value) {
    throw new Error(
      `缺少 Seed 凭据 ${primary}（兼容别名 ${alias}）。` +
        "请在本地 .env 或环境变量中配置后重试；不得在仓库代码或文档中硬编码密码。"
    );
  }
  return value;
}

async function upsertRolesAndUsers() {
  const platformPassword = requiredSeedPassword("SEED_PLATFORM_PASSWORD", "E2E_PLATFORM_PASSWORD");
  const demoPassword = requiredSeedPassword("SEED_DEMO_PASSWORD", "E2E_DEMO_PASSWORD");
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
          passwordHash: hashPassword(tenant.code === "platform" ? platformPassword : demoPassword),
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
          passwordHash: hashPassword(tenant.code === "platform" ? platformPassword : demoPassword),
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

    // SPACE-01/02：空库初始化必须建立与回填迁移**同规则**的默认经营空间与成员关系。
    //
    // Seed 直接用 Prisma 写 tenant_rental_profiles，绕过了服务层的 upsertProfile，
    // 因此不能指望那条路径来建空间；而账号是在档案之后创建的，所以成员关系必须
    // 在这里、账号都建好之后补齐。缺了这一步，登录解析不到当前经营空间，
    // 所有经营接口都会被 SPACE-02 的 fail-closed 守卫拒绝。
    //
    // 只为拥有品类档案的租户建空间：平台管理租户没有档案，也不该被凭空给一个品类。
    const rentalProfile = await prisma.tenantRentalProfile.findUnique({ where: { tenantId: tenant.id } });
    if (rentalProfile) {
      const workspaceSeeds = tenant.id === "tenant_001"
        ? demoWorkspaces
        : [{ id: `ws_${tenant.id}`, code: "default", name: `${tenant.name} 默认经营空间`, categoryCode: rentalProfile.categoryCode, isDefault: true }] as const;
      for (const workspace of workspaceSeeds) {
        await prisma.businessWorkspace.upsert({
          where: { id: workspace.id },
          update: {
            code: workspace.code,
            name: workspace.name,
            categoryCode: workspace.categoryCode,
            status: WorkspaceStatus.ACTIVE,
            isDefault: workspace.isDefault,
            defaultMarker: workspace.isDefault ? "default" : workspace.id
          },
          create: {
            id: workspace.id,
            tenantId: tenant.id,
            code: workspace.code,
            name: workspace.name,
            categoryCode: workspace.categoryCode,
            status: WorkspaceStatus.ACTIVE,
            isDefault: workspace.isDefault,
            defaultMarker: workspace.isDefault ? "default" : workspace.id
          }
        });
        for (const user of tenant.users) {
          await prisma.workspaceMember.upsert({
            where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
            update: { isActive: true },
            create: {
              tenantId: tenant.id,
              workspaceId: workspace.id,
              userId: user.id,
              // 与迁移回填一致：不写空间级角色。本列为空表示沿用租户级角色集；
              // 写 roleIds[0] 会让 findWorkspaceScopedUser 用单个角色整体替换权限，
              // 多角色账号（如同时是店长与财务复核）的权限会静默收缩。
              roleId: null,
              isActive: true
            }
          });
        }
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
              name: "租赁订单主状态",
              module: "租赁业务",
              description: "按租赁订单状态规则维护主状态展示文案。",
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
              module: "租赁业务",
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
              name: "租赁订单主状态",
              module: "租赁业务",
              description: "按租赁订单状态规则维护主状态展示文案。",
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
              module: "租赁业务",
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
            { code: "STORE_ORDER", name: "租赁订单号", module: "订单中心", prefix: "SO", datePattern: "yyyyMMdd", sequenceLength: 6, currentSequence: 0, resetCycle: "daily", enabled: true, sample: "SO-20260505-000001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" },
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
            { code: "STORE_ORDER", name: "租赁订单号", module: "订单中心", prefix: "SO", datePattern: "yyyyMMdd", sequenceLength: 6, currentSequence: 0, resetCycle: "daily", enabled: true, sample: "SO-20260505-000001", updatedAt: "2026-05-05T10:00:00+08:00", updatedBy: "seed" },
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

/**
 * demo 客户端渠道配置（CLIENT-CHANNEL-01）：把四个经营空间发布到客户端，
 * 并填入示例品牌名、主题色与协议正文，让小程序/APP 游客态开箱即可浏览，
 * 同时演示 logo（此处只给品牌名，Logo 图仍用系统默认）与主题色能力。
 * 幂等：按 tenantId 唯一 upsert，可反复 seed。
 */
async function upsertDemoClientChannel() {
  const tenantId = "tenant_001";
  const rentalProfile = await prisma.tenantRentalProfile.findUnique({ where: { tenantId } });
  if (!rentalProfile) return;
  const profile = await prisma.clientChannelProfile.upsert({
    where: { tenantId },
    update: {
      brandName: "光影租赁",
      customerServicePhone: "021-88886666",
      customerServiceHours: "工作日 9:00-18:00",
      themeColor: "#1677FF",
      userAgreementName: "用户服务协议",
      userAgreementVersion: "2026-09",
      userAgreementBody: "示例用户服务协议正文：本协议用于开发演示，正式经营前由商户提供适用版本。",
      privacyPolicyName: "隐私政策",
      privacyPolicyVersion: "2026-09",
      privacyPolicyBody: "示例隐私政策正文：本政策用于开发演示，正式经营前由商户提供适用版本。",
      helpIntro: "示例帮助说明：如有疑问请拨打客服电话。",
      smsLoginEnabled: true,
      passwordLoginEnabled: true,
      defaultWorkspaceId: "ws_tenant_001"
    },
    create: {
      tenantId,
      brandName: "光影租赁",
      customerServicePhone: "021-88886666",
      customerServiceHours: "工作日 9:00-18:00",
      themeColor: "#1677FF",
      userAgreementName: "用户服务协议",
      userAgreementVersion: "2026-09",
      userAgreementBody: "示例用户服务协议正文：本协议用于开发演示，正式经营前由商户提供适用版本。",
      privacyPolicyName: "隐私政策",
      privacyPolicyVersion: "2026-09",
      privacyPolicyBody: "示例隐私政策正文：本政策用于开发演示，正式经营前由商户提供适用版本。",
      helpIntro: "示例帮助说明：如有疑问请拨打客服电话。",
      smsLoginEnabled: true,
      passwordLoginEnabled: true,
      defaultWorkspaceId: "ws_tenant_001"
    }
  });
  for (const workspace of demoWorkspaces) {
    await prisma.clientChannelWorkspace.upsert({
      where: { tenantId_workspaceId: { tenantId, workspaceId: workspace.id } },
      update: { profileId: profile.id, enabled: true },
      create: { tenantId, profileId: profile.id, workspaceId: workspace.id, enabled: true }
    });
  }
}

async function main() {
  // 先校验凭据再写库：缺少口令时必须在任何 upsert 之前失败，
  // 避免留下"租户/组织已建、管理员账号未建"的半成品库。
  requiredSeedPassword("SEED_PLATFORM_PASSWORD", "E2E_PLATFORM_PASSWORD");
  requiredSeedPassword("SEED_DEMO_PASSWORD", "E2E_DEMO_PASSWORD");
  await upsertTenants();
  await upsertRentalCategoriesAndProfiles();
  await upsertOrganizations();
  await upsertPermissions();
  await upsertRolesAndUsers();
  await upsertSystemParameters();
  await upsertDemoClientChannel();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Rental OS seed completed.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
