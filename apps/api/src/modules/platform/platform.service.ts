import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { getRequestWorkspaceId, requireRequestTenantId, requireRequestWorkspaceId } from "../../common/request-identity";
import {
  RENTAL_CATEGORY_DEFINITIONS,
  CreateBusinessWorkspaceRequest,
  SaveWorkspaceMemberRequest,
  ChangeCustomerAccountStatusRequest,
  ChangeCustomerMembershipStatusRequest,
  CustomerProfileOrderQuery,
  MergeCustomersRequest,
  SaveCustomerProfileAddressRequest,
  SaveCustomerContractRequest,
  SaveCustomerCreditRequest,
  RecordCustomerCorporateCreditPaymentRequest,
  SaveCustomerInvoiceProfileRequest,
  SaveSharedCustomerRequest,
  UpdateBusinessWorkspaceRequest,
  GeneratePlatformNumberRequest,
  OrganizationSummary,
  PermissionModule,
  PlatformAuditLogQuery,
  PlatformAuditLogRow,
  PlatformDictionaryGroup,
  PlatformDictionaryItem,
  PlatformFilterPreset,
  PlatformFilterPresetQuery,
  PlatformFilterPresetScope,
  PlatformNumberRule,
  SavePlatformFilterPresetRequest,
  RoleScope,
  RentalCategoryCode,
  SaveOrganizationRequest,
  SavePlatformDictionaryGroupRequest,
  SavePlatformNumberRuleRequest,
  SaveSystemRuleSectionRequest,
  SaveSystemRoleRequest,
  SaveSystemUserAccessRequest,
  SaveSystemUserRequest,
  SystemAiConnectionTestResult,
  SystemRoleRow,
  SystemRulesConfig,
  SystemSecurityBaselineConfig,
  SystemUserRow,
  TenantBootstrapPreview,
  TenantBootstrapRequest,
  TenantBootstrapResult,
  TenantStatus,
  TenantSummary,
  UpdateTenantRequest,
  UpdateTenantStatusRequest
} from "@rental-os/shared";
import {
  buildOrganizationWhere,
  buildSystemUserWhere,
  describeDataPermission
} from "../../common/data-permission";
import { PlatformRepository } from "./platform.repository";
import { MembershipService } from "./membership.service";
import { SharedCustomerRepository } from "./shared-customer.repository";
import { CustomerOperationsService } from "./customer-operations.service";
import { CustomerMergeService } from "./customer-merge.service";
import { CustomerCorporateService } from "./customer-corporate.service";
import { CustomerCorporateSettlementService } from "./customer-corporate-settlement.service";
import { WorkspaceCapabilityService } from "../rental-core/workspace-capability.service";
import { RentalCoreService } from "../rental-core/rental-core.service";

interface StoredUser extends Omit<SaveSystemUserRequest, "tenantId"> {
  id: string;
  tenantId: string;
  password: string;
  mustChangePassword?: boolean;
  needsTenantOnboarding?: boolean;
}

// 平台主体租户：平台级配置（登录安全基线等）的读写与审计范围，区别于业务租户和演示租户
const PLATFORM_SUBJECT_TENANT_ID = "tenant_platform";

/**
 * 内存数据源的合成经营空间 id。
 *
 * 内存模式没有空间表，但守卫在缺空间时 fail-closed，故给它一个稳定的占位空间，
 * 使内存模式的会话行为与 mysql 模式一致（都带空间），而不是靠豁免绕过检查。
 * 前缀 `ws_memory_` 便于在日志里一眼识别它不是真实空间。
 */
const MEMORY_MODE_WORKSPACE_ID = "ws_memory_default";

@Injectable()
export class PlatformService {
  constructor(
    private readonly configService: ConfigService,
    private readonly platformRepository: PlatformRepository,
    @Optional() private readonly rentalCoreService?: RentalCoreService,
    // SPACE-04：放在最后且 @Optional。
    //
    // 不能插到 rentalCoreService 之前：多个不连库的测试用位置参数构造本服务
    // （`new PlatformService(config, undefined, rentalCore)`），插在中间会让
    // rentalCore 落到错误的槽位，租户初始化的回调不再注册默认经营空间，
    // 表现为后续调用报「当前 SaaS 租户尚未建立经营空间」——实测踩过。
    @Optional() private readonly sharedCustomers?: SharedCustomerRepository,
    // Review P1-3：创建空间时同事务初始化品类必选能力。
    // 同样必须放在最后且 @Optional()，理由见上：位置参数构造的测试会错位。
    @Optional() private readonly workspaceCapabilityService?: WorkspaceCapabilityService,
    // CUSTOMER-01B：客户账号与空间会员状态治理。同样追加在最后且 @Optional()，
    // 理由同上——既有测试用位置参数构造本服务，插到中间会让前面的依赖错位。
    @Optional() private readonly customerOperations?: CustomerOperationsService,
    // CUSTOMER-01C：企业资料（开票/合同/授信账期）与订单主体解析。
    // 同样追加在最后且 @Optional()，理由同上——位置参数构造的既有测试会错位。
    @Optional() private readonly customerCorporate?: CustomerCorporateService,
    // CUSTOMER-01D：重复识别、人工合并与注销前置检查。同样追加在最后且 @Optional()。
    @Optional() private readonly customerMerge?: CustomerMergeService,
    // CORP-SETTLE-01A：企业授信账务流水。继续追加在最后，保持既有位置参数测试兼容。
    @Optional() private readonly customerCorporateSettlement?: CustomerCorporateSettlementService,
    @Optional() private readonly memberships?: MembershipService
  ) {}

  private readonly logger = new Logger(PlatformService.name);

  private readonly tenants: TenantSummary[] = [
    {
      tenantId: "tenant_platform",
      tenantCode: "platform",
      tenantName: "Rental OS SaaS 平台",
      tenantStatus: TenantStatus.Active,
      enabledBusinessLines: []
    },
    {
      tenantId: "tenant_001",
      tenantCode: "demo",
      tenantName: "演示香港租户",
      tenantStatus: TenantStatus.Active,
      enabledBusinessLines: ["rental_core", "rental_os"],
      categoryCode: RentalCategoryCode.Camera,
      categoryName: "摄影设备",
      capabilities: [...RENTAL_CATEGORY_DEFINITIONS.find((category) => category.code === RentalCategoryCode.Camera)!.defaultCapabilities]
    },
    {
      tenantId: "tenant_002",
      tenantCode: "demo2",
      tenantName: "演示深圳租户",
      tenantStatus: TenantStatus.Active,
      enabledBusinessLines: ["rental_core"],
      categoryCode: RentalCategoryCode.Camping,
      categoryName: "露营设备",
      capabilities: [...RENTAL_CATEGORY_DEFINITIONS.find((category) => category.code === RentalCategoryCode.Camping)!.defaultCapabilities]
    }
  ];

  private readonly organizations: OrganizationSummary[] = [
    {
      id: "org_saas_platform",
      tenantId: "tenant_platform",
      type: RoleScope.Operator,
      code: "SAAS",
      name: "SaaS 平台运营",
      status: "enabled"
    },
    {
      id: "org_operator_hk",
      tenantId: "tenant_001",
      type: RoleScope.Operator,
      code: "OP-HK",
      name: "香港营运中心",
      status: "enabled"
    },
    {
      id: "org_store_mongkok",
      tenantId: "tenant_001",
      parentId: "org_operator_hk",
      type: RoleScope.Store,
      code: "STORE-MK",
      name: "旺角服务点",
      status: "enabled"
    },
    {
      id: "org_store_central",
      tenantId: "tenant_001",
      parentId: "org_operator_hk",
      type: RoleScope.Store,
      code: "STORE-CENTRAL",
      name: "中环服务点",
      status: "enabled"
    },
    {
      id: "org_operator_sz",
      tenantId: "tenant_002",
      type: RoleScope.Operator,
      code: "OP-SZ",
      name: "深圳营运中心",
      status: "enabled"
    }
  ];

  private readonly permissionTree: PermissionModule[] = [
    {
      code: "rental-core",
      name: "Rental Core",
      children: [
        { code: "rental-core:catalog:view", name: "通用商品目录查看" },
        { code: "rental-core:catalog:manage", name: "通用商品目录管理" },
        { code: "rental-core:asset:view", name: "通用资产库存查看" },
        { code: "rental-core:asset:manage", name: "通用资产库存管理" },
        { code: "rental-core:maintenance:view", name: "养护工单查看", description: "查看归还处置和养护工单" },
        { code: "rental-core:maintenance:manage", name: "养护工单处理", description: "创建、派工、开始和提交养护工单" },
        { code: "rental-core:maintenance:review", name: "养护工单验收", description: "审核养护结果并恢复库存可用状态" },
        { code: "rental-core:capability:view", name: "经营空间能力查看" },
        { code: "rental-core:capability:manage", name: "经营空间能力治理" },
        // CAM-01A：确认能力给出的风险提示（如需转接环的器材组合）才能带风险下单。
        // 与 :manage 分开：治理能力启停是配置动作，带风险下单是一次经营决策，
        // 两者的授权对象通常不同（店长可确认风险，但不一定负责能力启停）。
        { code: "rental-core:capability:override", name: "能力风险例外确认" }
      ]
    },
    {
      code: "rental-os",
      name: "租赁业务",
      children: [
        { code: "rental-os:rules:manage", name: "业务规则配置" },
        // RULE-01A：发布与编辑分权（需求 4.6.14）。发布改变对外生效条款，
        // 与「改草稿」是两个责任；共用一个码会让任何能编辑的人直接对客户生效。
        { code: "rental-os:rules:publish", name: "业务规则发布", description: "发布或安排规则版本生效、作废已发布或待生效版本" },
        { code: "rental-os:order:view", name: "订单查看", description: "查看租赁订单列表和详情" },
        { code: "rental-os:order:operate", name: "订单操作", description: "新建租赁订单、领取检查和归还检查" },
        { code: "rental-os:order:reassign", name: "资源解锁与改配", description: "解锁、释放及更换订单锁定资源，必须填写原因" },
        { code: "rental-os:order:settle", name: "订单结算", description: "确认费用、补缴、退款或月结入账" },
        { code: "rental-os:order:offline-payment", name: "线下收款登记", description: "登记待确认的线下收款；不含确认到账、退款或资金结算" },
        // ORDER-CLOSE-02：裁定「该收/该退多少」与实际动钱拆成两个权限。此前四类审核
        // 都认 order:settle，而资金事件也认它，一个权限同时授予定金额和收退款。
        { code: "rental-os:order:fee-review", name: "费用裁定", description: "裁定逾期人工核价、提前归还退款、续租负差额与检查异常的金额；不含实际收退款" },
        { code: "rental-os:order:create", name: "按钮-新建订单", description: "显示并执行新建租赁订单入口" },
        { code: "rental-os:order:pickup", name: "按钮-领取交付", description: "执行领取交付和确认开始履约" },
        { code: "rental-os:order:return", name: "按钮-归还验收", description: "执行归还验收和提交结算" },
        { code: "rental-os:order:extend", name: "按钮-延长租期", description: "执行延长租期和逾期补办续租" },
        { code: "rental-os:order:cancel", name: "按钮-取消/爽约", description: "执行取消订单和标记爽约" },
        { code: "rental-os:order:close", name: "按钮-关闭/拒绝履约", description: "执行关闭订单和拒绝履约" },
        { code: "rental-os:order:fee-manage", name: "按钮-费用处理", description: "登记订单费用、收款、退款和减免" },
        { code: "rental-os:dispatch:manage", name: "调度管理" },
        { code: "rental-os:price:manage", name: "价格规则" },
        { code: "rental-os:calendar:edit", name: "营业日历编辑（草稿）", description: "新建和修改营业日历草稿，不含发布" },
        { code: "rental-os:calendar:publish", name: "营业日历发布", description: "发布年度营业日历版本" },
        { code: "rental-os:calendar:view-history", name: "营业日历历史只读", description: "查看历史版本、发布差异、覆盖审计与报价命中的日历依据，不得修改" },
        { code: "rental-os:marketing:manage", name: "行销方案管理" },
        { code: "rental-os:station:view", name: "履约地点查看" },
        { code: "rental-os:station:manage", name: "履约地点管理" },
        { code: "rental-os:member:view", name: "会员查看" },
        { code: "rental-os:member:manage", name: "会员管理" },
        // 证件类型是当前经营空间的业务配置，不是租户级会员资料维护：
        // 空间配置人员不必顺带拿到改会员主档的权限，反之亦然。
        { code: "rental-os:qualification-type:manage", name: "空间证件类型管理", description: "维护当前经营空间的资质证件类型" },
        { code: "rental-os:member:review", name: "会员注册审核", description: "处理个人会员注册审核，不含证件审核" },
        { code: "rental-os:member:qualification-review", name: "会员证件审核", description: "处理身份证件和品类资质审核" },
        { code: "rental-os:member:account-manage", name: "会员账号与密码管理", description: "开通账号、设置临时密码和管理账号状态" },
        { code: "rental-os:member:plan:manage", name: "会员方案编辑", description: "编辑个人和企业会员方案草稿、授予方案" },
        { code: "rental-os:member:plan:publish", name: "会员方案发布", description: "发布会员方案版本" },
        { code: "rental-os:member:risk-action", name: "按钮-会员风控动作", description: "暂停、拉黑和恢复会员" },
        // CUSTOMER-01B：敏感资料解密查看单独授权。必须出现在权限目录里——
        // 角色管理页的可选项完全来自这棵树，漏了它就没人能被授予该权限。
        { code: "rental-os:customer:reveal-sensitive", name: "客户敏感资料解密", description: "查看客户证件号等明文，并可查阅敏感访问审计" },
        { code: "rental-os:customer:merge", name: "客户合并", description: "人工合并重复客户主档，不可逆" },
        { code: "rental-os:customer:close", name: "客户注销", description: "注销客户账号或空间会员关系，不可逆" },
        { code: "rental-os:corporate:view", name: "企业客户查看" },
        { code: "rental-os:corporate:manage", name: "企业客户管理" },
        { code: "rental-os:corporate:employee-manage", name: "企业员工管理", description: "维护企业管理员和员工关系" },
        { code: "rental-os:corporate:monthly-settle", name: "按钮-企业月结回款", description: "登记企业账单回款" },
        { code: "rental-os:finance:view", name: "财务查看", description: "查看资金流水、发票收据、调账和对账" },
        { code: "rental-os:finance:manage", name: "财务管理", description: "维护财务单据和处理资金状态" },
        { code: "rental-os:finance:adjust", name: "按钮-手工调账", description: "提交、审核和入账手工调账" },
        { code: "rental-os:finance:invoice", name: "按钮-发票/收据", description: "开具、发送和作废发票收据" },
        { code: "rental-os:finance:reconcile", name: "财务对账", description: "查看和处理资金、月结、调账异常" },
        { code: "rental-os:service:manage", name: "增值服务管理" },
        { code: "rental-os:report:view", name: "报表查看" }
      ]
    },
    {
      code: "system",
      name: "系统设置",
      children: [
        { code: "system:user:manage", name: "系统用户" },
        { code: "system:role:manage", name: "角色权限", description: "新增角色、编辑角色、配置权限" },
        { code: "system:params:manage", name: "系统通用参数", description: "维护会员、运维、日历、推送和 AI 模型接入参数" },
        { code: "system:integration:manage", name: "外部接入与任务", description: "管理附件、通知、导入导出、打印、TBox 和外部 adapter mock 日志" },
        { code: "system:button:export", name: "按钮-导出", description: "平台列表和报表导出按钮" },
        { code: "system:tenant:manage", name: "租户配置" }
      ]
    }
  ];

  private readonly roleRows: SystemRoleRow[] = [
    {
      id: "role_platform_admin",
      tenantId: "tenant_001",
      code: "TENANT_ADMIN",
      name: "租户管理员",
      description: "固定拥有当前 SaaS 租户全部权限，不允许跨租户。",
      scope: RoleScope.Operator,
      fixedAllPermissions: true,
      enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H", "SYSTEM_GLOBAL"],
      isActive: true,
      permissions: ["*"],
      buttonPermissions: ["*"],
      dataScope: "all"
    },
    {
      id: "role_store_operator",
      tenantId: "tenant_001",
      code: "STORE_OPERATOR",
      name: "门店营运",
      description: "经营空间营运人员处理订单、领取/归还和基础品类资产查看。",
      scope: RoleScope.Store,
      fixedAllPermissions: false,
      enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H"],
      isActive: true,
      permissions: [
        "rental-os:order:view",
        "rental-os:order:operate",
        "rental-os:order:settle",
        // 迁移说明：该角色此前凭 order:settle 就能裁定四类费用审核，拆权后必须显式补上
        // 才不会失能。只补这一个已有结算权的预设角色，不给其他角色授新权。
        "rental-os:order:fee-review",
        "rental-os:station:view",
        "rental-core:catalog:view",
        "rental-core:asset:view",
        "rental-core:asset:manage",
        "rental-os:member:view",
        "rental-os:corporate:view",
        "rental-os:finance:view"
      ],
      buttonPermissions: [
        "rental-os:order:create",
        "rental-os:order:pickup",
        "rental-os:order:return",
        "rental-os:order:extend",
        "rental-os:order:cancel",
        "rental-os:order:fee-manage"
      ],
      dataScope: "store"
    },
    {
      id: "role_pricing_manager",
      tenantId: "tenant_001",
      code: "PRICING_MANAGER",
      name: "价格规则管理员",
      description: "维护租赁价格、规则和增值服务配置。",
      scope: RoleScope.Operator,
      fixedAllPermissions: false,
      enabledBusinessScopes: ["STORE_STANDARD", "SYSTEM_GLOBAL"],
      isActive: true,
      permissions: [
        "rental-os:rules:manage",
        "rental-os:rules:publish",
        "rental-os:price:manage",
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
      dataScope: "organization"
    },
    {
      id: "role_tenant_admin_002",
      tenantId: "tenant_002",
      code: "TENANT_ADMIN",
      name: "租户管理员",
      description: "固定拥有当前 SaaS 租户全部权限，不允许跨租户。",
      scope: RoleScope.Operator,
      fixedAllPermissions: true,
      enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H", "SYSTEM_GLOBAL"],
      isActive: true,
      permissions: ["*"],
      buttonPermissions: ["*"],
      dataScope: "all"
    },
    {
      id: "role_store_operator_002",
      tenantId: "tenant_002",
      code: "STORE_OPERATOR",
      name: "门店营运",
      description: "经营空间营运人员处理订单、领取/归还与基础资产查看。",
      scope: RoleScope.Store,
      fixedAllPermissions: false,
      enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H"],
      isActive: true,
      permissions: [
        "rental-os:order:view",
        "rental-os:order:operate",
        "rental-os:station:view",
        "rental-core:catalog:view",
        "rental-core:asset:view"
      ],
      buttonPermissions: [
        "rental-os:order:create",
        "rental-os:order:pickup",
        "rental-os:order:return"
      ],
      dataScope: "store"
    }
  ];

  private readonly users: StoredUser[] = [
    {
      id: "user_saas_admin",
      tenantId: "tenant_platform",
      account: "admin",
      password: "RentalOS!2026",
      displayName: "SaaS 平台管理员",
      organizationId: "org_saas_platform",
      roleIds: [],
      isSaasAdmin: true,
      isPlatformAdmin: false,
      isActive: true
    },
    {
      id: "user_admin_001",
      tenantId: "tenant_001",
      account: "admin",
      password: "RentalDemo!2026",
      displayName: "香港租户管理员",
      phone: "852-1000-0001",
      organizationId: "org_operator_hk",
      roleIds: ["role_platform_admin"],
      isPlatformAdmin: true,
      isActive: true
    },
    {
      id: "user_store_001",
      tenantId: "tenant_001",
      account: "store",
      password: "RentalDemo!2026",
      displayName: "旺角门店值班员",
      phone: "852-2388-0001",
      organizationId: "org_store_mongkok",
      roleIds: ["role_store_operator"],
      isPlatformAdmin: false,
      isActive: true
    },
    {
      id: "user_pricing_001",
      tenantId: "tenant_001",
      account: "pricing",
      password: "RentalDemo!2026",
      displayName: "价格规则管理员",
      phone: "852-3000-1001",
      organizationId: "org_operator_hk",
      roleIds: ["role_pricing_manager"],
      isPlatformAdmin: false,
      isActive: true
    },
    {
      id: "user_admin_002",
      tenantId: "tenant_002",
      account: "admin",
      password: "RentalDemo!2026",
      displayName: "深圳租户管理员",
      phone: "86-755-1000-0001",
      organizationId: "org_operator_sz",
      roleIds: ["role_tenant_admin_002"],
      isPlatformAdmin: true,
      isActive: true
    }
  ];

  private readonly authSessions = new Map<string, {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    audience: "operator" | "staff";
    revokedAt?: Date;
    /** SPACE-02：内存模式没有经营空间，这里恒为 null，使经营接口 fail-closed。 */
    currentWorkspaceId?: string | null;
  }>();

  private systemRulesConfig: SystemRulesConfig = {
    member: {
      accountType: "MOBILE",
      auditRequired: true,
      welcomeGift: {
        enabled: true,
        trigger: "AUDIT_PASS",
        amount: 100,
        validity: 365
      },
      referralGift: {
        enabled: true,
        trigger: "INVITEE_AUDIT_PASS",
        amount: 50,
        validity: 365
      }
    },
    fleet: {
      maintenance: {
        thresholdMileage: 5000,
        thresholdMonths: 6,
        advanceKm: 500,
        advanceDays: 15
      },
      cleaning: {
        thresholdCount: 5,
        thresholdDays: 7,
        advanceCount: 1,
        advanceDays: 1
      }
    },
    calendar: {
      weekly: [
        { id: 1, name: "周一", isHoliday: false, isFullDay: true, startTime: "" },
        { id: 2, name: "周二", isHoliday: false, isFullDay: true, startTime: "" },
        { id: 3, name: "周三", isHoliday: false, isFullDay: true, startTime: "" },
        { id: 4, name: "周四", isHoliday: false, isFullDay: true, startTime: "" },
        { id: 5, name: "周五", isHoliday: false, isFullDay: true, startTime: "" },
        { id: 6, name: "周六", isHoliday: true, isFullDay: true, startTime: "" },
        { id: 0, name: "周日", isHoliday: true, isFullDay: true, startTime: "" }
      ],
      specialDates: [
        { range: ["2026-05-01", "2026-05-05"], type: "HOLIDAY", name: "劳动节" },
        { range: ["2026-05-09", "2026-05-09"], type: "WORKDAY", name: "五一补班" }
      ]
    },
    push: {
      list: [
        {
          id: "push_order_confirmed",
          category: "订单",
          title: "订单已确认",
          content: "尊敬的{用户}，您的订单{订单号}已经确认，请按约定时间办理领取。",
          trigger: "订单支付成功",
          channels: ["APP", "SMS"],
          enabled: true
        },
        {
          id: "push_member_approved",
          category: "系统",
          title: "审核通过通知",
          content: "您的账号已通过审核，现在可以开始用车了。",
          trigger: "会员审核通过",
          channels: ["APP", "SMS"],
          enabled: true
        },
        {
          id: "push_birthday",
          category: "营销",
          title: "生日祝福",
          content: "祝您生日快乐！一张租车券已放入您的账户。",
          trigger: "用户生日当天",
          channels: ["APP", "SMS", "EMAIL"],
          enabled: true
        }
      ]
    },
    aiModel: {
      enabled: true,
      provider: "OPENAI_COMPATIBLE",
      baseUrl: "https://api.example.com/v1",
      modelName: "gpt-xxx",
      apiKeyMasked: "sk-****8F3A",
      promptSourceText: "租户专属版",
      promptConfigVersion: "prompt-config-20260519.01",
      promptVersion: "rental-os-dispatch-agent-v1",
      promptHash: "sha256:8c21...f09a",
      lastTestStatus: "成功",
      lastTestTime: "2026-05-05 10:30",
      guardrails: [
        {
          title: "提示词配置文件",
          desc: "按租户命中专属提示词；未命中时使用全租户默认提示词。"
        },
        {
          title: "硬约束不可突破",
          desc: "同车行、车组、状态、时间窗、硬锁和人工保护仍由系统校验。"
        },
        {
          title: "数据最小化",
          desc: "不提交手机号、证件号、支付资料、API Key 或无关敏感备注。"
        }
      ],
      logs: [
        {
          time: "2026-05-19 14:32",
          analysisId: "AI-DISPATCH-20260519-0008",
          operator: "王店长",
          model: "gpt-xxx",
          promptSourceText: "租户专属版",
          promptVersion: "rental-os-dispatch-agent-v1",
          promptHash: "sha256:8c21...f09a",
          filteredCount: 5,
          status: "成功",
          promptText:
            "你是 Rental OS 平台租赁业务 AI 调度分析 Agent。\n你的职责是帮助调度员分析车辆排程风险，并在系统合法候选车辆范围内生成推荐。",
          requestPayload: JSON.stringify(
            {
              analysisContext: {
                tenantId: "tenant-demo-tpe",
                windowDays: 7,
                storeScope: ["台北总店", "桃园机场店"]
              },
              orders: [{ orderNo: "ORD-202605-0108", phone: "[excluded]" }],
              candidatesByOrder: {
                "ORD-202605-0108": ["VH-TPE-2841", "VH-TPE-6630"]
              },
              privacyFilter: ["手机号", "证件号", "支付资料", "API Key", "未脱敏敏感备注"]
            },
            null,
            2
          ),
          responsePayload: JSON.stringify(
            {
              analysisId: "AI-DISPATCH-20260519-0008",
              parseStatus: "JSON_SCHEMA_PASSED",
              validationStatus: "PARTIAL_PASSED"
            },
            null,
            2
          )
        },
        {
          time: "2026-05-18 09:15",
          analysisId: "AI-DISPATCH-20260518-0014",
          operator: "陈调度",
          model: "gpt-xxx",
          promptSourceText: "默认版",
          promptVersion: "rental-os-dispatch-agent-v1",
          promptHash: "sha256:7f18...a921",
          filteredCount: 5,
          status: "成功",
          promptText:
            "你是 Rental OS 平台租赁业务 AI 调度分析 Agent。\n必须遵守系统硬约束，不得直接修改订单、车辆或排程。",
          requestPayload: JSON.stringify(
            {
              analysisContext: {
                tenantId: "tenant-demo-tpe",
                windowDays: 3,
                storeScope: ["台北总店"]
              },
              orders: [{ orderNo: "ORD-202605-0062", phone: "[excluded]" }],
              privacyFilter: ["手机号", "证件号", "支付资料", "API Key", "未脱敏敏感备注"]
            },
            null,
            2
          ),
          responsePayload: JSON.stringify(
            {
              analysisId: "AI-DISPATCH-20260518-0014",
              parseStatus: "JSON_SCHEMA_PASSED",
              validationStatus: "PASSED"
            },
            null,
            2
          )
        }
      ]
    },
    security: this.defaultSecurityBaseline(),
    updatedAt: "2026-05-05T10:30:00+08:00",
    updatedBy: "系统初始化"
  };

  private readonly auditLogs: PlatformAuditLogRow[] = [
    {
      id: "audit_seed_001",
      tenantId: "tenant_001",
      action: "tenant.bootstrap",
      operator: "系统初始化",
      targetType: "tenant",
      targetId: "tenant_001",
      detail: "初始化 demo 租户、默认角色和系统参数。",
      createdAt: "2026-05-05T10:00:00+08:00"
    },
    {
      id: "audit_seed_002",
      tenantId: "tenant_001",
      action: "system-rules.update",
      operator: "系统初始化",
      targetType: "system-rules",
      targetId: "system-rules",
      detail: "写入租赁业务系统通用参数默认值。",
      createdAt: "2026-05-05T10:30:00+08:00"
    }
  ];

  private filterPresets: PlatformFilterPreset[] = [];

  private dictionaryGroups: PlatformDictionaryGroup[] = [
    {
      code: "order_main_status",
      name: "订单主状态",
      module: "租赁业务",
      description: "租赁业务订单列表、详情和审计中心统一展示主状态。",
      items: [
        { code: "reserved", label: "已预订", value: "reserved", sortNo: 10, enabled: true },
        { code: "renting", label: "租赁中", value: "renting", sortNo: 20, enabled: true },
        { code: "settlement_pending", label: "待结算", value: "settlement_pending", sortNo: 30, enabled: true },
        { code: "completed", label: "已完成", value: "completed", sortNo: 40, enabled: true }
      ],
      updatedAt: "2026-05-05T10:00:00+08:00",
      updatedBy: "系统初始化"
    },
    {
      code: "vehicle_operation_status",
      name: "车辆营运状态",
      module: "车辆资产",
      description: "车辆档案库、调度候选和车辆状态动作统一使用。",
      items: [
        { code: "idle", label: "空闲", value: "idle", sortNo: 10, enabled: true },
        { code: "reserved", label: "已预约", value: "reserved", sortNo: 20, enabled: true },
        { code: "renting", label: "租赁中", value: "renting", sortNo: 30, enabled: true },
        { code: "controlled", label: "受控", value: "controlled", sortNo: 40, enabled: true },
        { code: "maintenance", label: "维保中", value: "maintenance", sortNo: 50, enabled: true }
      ],
      updatedAt: "2026-05-05T10:00:00+08:00",
      updatedBy: "系统初始化"
    },
    {
      code: "customer_level",
      name: "客户等级",
      module: "客户运营",
      description: "客户等级方案和会员资料共用展示项。",
      items: [
        { code: "silver", label: "白银会员", value: "MEMBER_SILVER", sortNo: 10, enabled: true },
        { code: "gold", label: "黄金会员", value: "MEMBER_GOLD", sortNo: 20, enabled: true },
        { code: "black", label: "黑金会员", value: "MEMBER_BLACK", sortNo: 30, enabled: true }
      ],
      updatedAt: "2026-05-05T10:00:00+08:00",
      updatedBy: "系统初始化"
    }
  ];

  private numberRules: PlatformNumberRule[] = [
    this.buildNumberRule("STORE_ORDER", "租赁订单号", "订单中心", "SO", "yyyyMMdd", 6),
    this.buildNumberRule("CONTRACT", "合同编号", "合同单据", "CT", "yyyyMM", 5),
    this.buildNumberRule("ACCIDENT_REPORT", "事故报案号", "事故出险", "AC", "yyyyMMdd", 4),
    this.buildNumberRule("CUSTOMER", "客户编号", "客户运营", "CU", "yyyyMM", 5),
    this.buildNumberRule("VEHICLE_LICENSE", "车辆证照编号", "车辆资产", "VL", "yyyyMM", 4)
  ];

  getSystemRules(tenantId?: string) {
    if (this.useMysqlDataSource()) {
      const scope = tenantId ?? requireRequestTenantId();
      return this.platformRepository.getSystemRules(scope).then((config) =>
        config ? this.cloneSystemRulesConfig(config) : this.cloneSystemRulesConfig()
      );
    }
    return this.cloneSystemRulesConfig();
  }

  async getSecurityBaseline() {
    // 登录等认证前流程没有租户身份：安全基线显式从平台主体读取，不回退演示租户
    const config = await this.getSystemRules(PLATFORM_SUBJECT_TENANT_ID);
    return this.normalizeSecurityBaseline(config.security);
  }

  async saveSecurityBaseline(
    input: SystemSecurityBaselineConfig,
    operator = "平台管理员"
  ) {
    const security = this.normalizeSecurityBaseline(input);
    // 安全基线是平台级配置：读取、写入和审计都固定使用平台主体，不回退演示租户
    const config = await this.getSystemRules(PLATFORM_SUBJECT_TENANT_ID);
    const next: SystemRulesConfig = {
      ...config,
      security,
      updatedAt: new Date().toISOString(),
      updatedBy: operator
    };
    this.validateSystemRulesConfig(next);

    if (this.useMysqlDataSource()) {
      await this.platformRepository.saveSystemRules(next, operator, PLATFORM_SUBJECT_TENANT_ID);
      await this.platformRepository.recordAuditLog({
        tenantId: PLATFORM_SUBJECT_TENANT_ID,
        action: "security-baseline.update",
        operator,
        targetType: "security-baseline",
        targetId: "system-security",
        detail: "更新登录限流、密码策略、脱敏和二次确认配置。"
      });
    } else {
      this.systemRulesConfig = next;
      this.recordMemoryAudit({
        tenantId: PLATFORM_SUBJECT_TENANT_ID,
        action: "security-baseline.update",
        operator,
        targetType: "security-baseline",
        targetId: "system-security",
        detail: "更新登录限流、密码策略、脱敏和二次确认配置。"
      });
    }

    return security;
  }

  async checkSecondConfirmation(action: string, confirmationCode?: string) {
    const baseline = await this.getSecurityBaseline();
    const required =
      baseline.secondConfirmation.enabled &&
      baseline.secondConfirmation.actions.includes(action);

    if (required && !confirmationCode?.trim()) {
      throw new BadRequestException("该关键操作需要二次确认码");
    }

    return {
      action,
      required,
      accepted: !required || confirmationCode === "000000",
      message:
        required && confirmationCode !== "000000"
          ? "MVP 预留二次确认校验，演示确认码为 000000。"
          : "二次确认校验通过。"
    };
  }

  getDataPermissionPreview(user?: SystemUserRow) {
    return describeDataPermission(user);
  }

  async recordSecurityAudit(input: {
    tenantId?: string;
    tenantCode?: string;
    action: string;
    operator: string;
    targetId?: string;
    detail: string;
  }) {
    const tenantId =
      input.tenantId ??
      (input.tenantCode
        ? (await this.findTenantByCode(input.tenantCode))?.tenantId
        : undefined);
    // 无法确定归属租户的安全审计不落库，也不得回退到演示租户
    if (!tenantId) return;

    if (this.useMysqlDataSource()) {
      await this.platformRepository.recordAuditLog({
        tenantId,
        action: input.action,
        operator: input.operator,
        targetType: "auth",
        targetId: input.targetId,
        detail: input.detail
      });
    } else {
      this.recordMemoryAudit({
        tenantId,
        action: input.action,
        operator: input.operator,
        targetType: "auth",
        targetId: input.targetId,
        detail: input.detail
      });
    }
  }

  async saveSystemRuleSection(input: SaveSystemRuleSectionRequest) {
    const sectionKey = input.sectionKey.trim();
    const allowedSections = new Set([
      "memberRegister",
      "memberPoints",
      "fleetMaintenance",
      "fleetCleaning",
      "calendarFixed",
      "calendarSpecial",
      "push",
      "aiModel"
    ]);

    if (!allowedSections.has(sectionKey)) {
      throw new BadRequestException("系统参数分区不存在");
    }

    this.validateSystemRulesConfig(input.config);
    const nextConfig = {
      ...this.cloneSystemRulesConfig(input.config),
      updatedAt: new Date().toISOString(),
      updatedBy: input.operator || "营运端"
    };

    if (this.useMysqlDataSource()) {
      await this.platformRepository.saveSystemRules(nextConfig, input.operator);
      return this.cloneSystemRulesConfig(nextConfig);
    }

    this.systemRulesConfig = nextConfig;
    return this.cloneSystemRulesConfig();
  }

  testAiConnection(operator = "营运端"): SystemAiConnectionTestResult {
    const testedAt = new Date().toISOString();
    this.systemRulesConfig.aiModel.lastTestStatus = "成功";
    this.systemRulesConfig.aiModel.lastTestTime = testedAt;
    this.systemRulesConfig.aiModel.logs.unshift({
      time: testedAt,
      analysisId: `AI-DISPATCH-${Date.now()}`,
      operator,
      model: this.systemRulesConfig.aiModel.modelName,
      promptSourceText: this.systemRulesConfig.aiModel.promptSourceText,
      promptVersion: this.systemRulesConfig.aiModel.promptVersion,
      promptHash: this.systemRulesConfig.aiModel.promptHash,
      filteredCount: 5,
      status: "成功",
      promptText:
        "系统通用参数页发起 AI 连接测试。MVP 阶段仅校验配置结构，不连接真实模型服务。",
      requestPayload: JSON.stringify(
        {
          provider: this.systemRulesConfig.aiModel.provider,
          baseUrl: this.systemRulesConfig.aiModel.baseUrl || "",
          modelName: this.systemRulesConfig.aiModel.modelName,
          apiKey: "[masked]"
        },
        null,
        2
      ),
      responsePayload: JSON.stringify(
        {
          status: "mock_success",
          message: "配置结构校验通过，真实模型连接已预留。"
        },
        null,
        2
      )
    });
    this.systemRulesConfig.updatedAt = testedAt;
    this.systemRulesConfig.updatedBy = operator;

    return {
      status: "成功",
      testedAt,
      provider: this.systemRulesConfig.aiModel.provider,
      modelName: this.systemRulesConfig.aiModel.modelName,
      message: "AI 模型连接测试已完成。MVP 阶段未调用真实外部模型。"
    };
  }

  async listAuditLogs(query: PlatformAuditLogQuery = {}, user?: SystemUserRow) {
    const tenantId = user?.isSaasAdmin
      ? query.tenantId
      : user?.tenantId ?? query.tenantId;
    const scopedQuery = { ...query, tenantId };
    if (this.useMysqlDataSource()) {
      return this.platformRepository.listAuditLogs(scopedQuery);
    }

    const limit = Math.min(Math.max(Number(scopedQuery.limit ?? 50), 1), 200);
    const workspaceId = getRequestWorkspaceId();
    const rows = this.auditLogs
      .filter((log) => !scopedQuery.tenantId || log.tenantId === scopedQuery.tenantId)
      .filter((log) => !workspaceId || log.workspaceId === workspaceId)
      .filter((log) => !scopedQuery.action || log.action.includes(scopedQuery.action))
      .filter((log) => !scopedQuery.operator || log.operator.includes(scopedQuery.operator))
      .filter((log) => !scopedQuery.targetType || log.targetType === scopedQuery.targetType)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return {
      rows: rows.slice(0, limit),
      total: rows.length
    };
  }

  async listFilterPresets(
    query: PlatformFilterPresetQuery = {},
    user?: SystemUserRow
  ) {
    const tenantId = this.resolvePlatformTenantId(query.tenantId, user);
    const scopeKey = query.scopeKey
      ? this.normalizeFilterPresetScope(query.scopeKey)
      : undefined;

    if (this.useMysqlDataSource()) {
      return this.platformRepository.listFilterPresets({ tenantId, scopeKey });
    }

    return this.clone(
      this.filterPresets
        .filter((preset) => preset.tenantId === tenantId)
        .filter((preset) => !scopeKey || preset.scopeKey === scopeKey)
        .sort((left, right) => {
          if (left.isDefault !== right.isDefault) {
            return left.isDefault ? -1 : 1;
          }
          return right.updatedAt.localeCompare(left.updatedAt);
        })
    );
  }

  async saveFilterPreset(
    input: SavePlatformFilterPresetRequest,
    user?: SystemUserRow
  ) {
    const preset = this.normalizeFilterPresetInput(input, user);

    if (this.useMysqlDataSource()) {
      return this.platformRepository.saveFilterPreset(preset);
    }

    if (preset.isDefault) {
      this.filterPresets = this.filterPresets.map((item) =>
        item.tenantId === preset.tenantId && item.scopeKey === preset.scopeKey
          ? { ...item, isDefault: false }
          : item
      );
    }

    const existingIndex = this.filterPresets.findIndex((item) =>
      preset.id
        ? item.id === preset.id
        : item.tenantId === preset.tenantId &&
          item.scopeKey === preset.scopeKey &&
          item.name === preset.name
    );
    const nextPreset: PlatformFilterPreset = {
      id:
        existingIndex >= 0
          ? this.filterPresets[existingIndex].id
          : preset.id || randomUUID(),
      tenantId: preset.tenantId,
      scopeKey: preset.scopeKey,
      name: preset.name,
      description: preset.description,
      filters: preset.filters,
      isDefault: Boolean(preset.isDefault),
      isSystem: false,
      updatedAt: new Date().toISOString(),
      updatedBy: preset.operator || user?.displayName || "营运端"
    };

    if (existingIndex >= 0) {
      this.filterPresets[existingIndex] = nextPreset;
    } else {
      this.filterPresets.unshift(nextPreset);
    }
    this.recordMemoryAudit({
      tenantId: nextPreset.tenantId,
      action: "filter-preset.save",
      operator: nextPreset.updatedBy,
      targetType: "filter-preset",
      targetId: nextPreset.id,
      detail: `保存筛选预设：${nextPreset.name}`
    });
    return this.clone(nextPreset);
  }

  async setDefaultFilterPreset(
    id: string,
    operator?: string,
    user?: SystemUserRow
  ) {
    const tenantId = this.resolvePlatformTenantId(undefined, user);
    if (this.useMysqlDataSource()) {
      return this.platformRepository.setDefaultFilterPreset(
        id,
        operator || user?.displayName || "营运端",
        tenantId
      );
    }

    const preset = this.filterPresets.find((item) => item.id === id);
    if (!preset || preset.tenantId !== tenantId) {
      throw new NotFoundException("筛选预设不存在");
    }
    const updatedBy = operator || user?.displayName || "营运端";
    const updatedAt = new Date().toISOString();
    this.filterPresets = this.filterPresets.map((item) => {
      if (item.tenantId === preset.tenantId && item.scopeKey === preset.scopeKey) {
        return {
          ...item,
          isDefault: item.id === id,
          updatedAt: item.id === id ? updatedAt : item.updatedAt,
          updatedBy: item.id === id ? updatedBy : item.updatedBy
        };
      }
      return item;
    });
    const nextPreset = this.filterPresets.find((item) => item.id === id);
    if (!nextPreset) {
      throw new NotFoundException("筛选预设不存在");
    }
    this.recordMemoryAudit({
      tenantId: nextPreset.tenantId,
      action: "filter-preset.default",
      operator: updatedBy,
      targetType: "filter-preset",
      targetId: nextPreset.id,
      detail: `设为默认筛选预设：${nextPreset.name}`
    });
    return this.clone(nextPreset);
  }

  async deleteFilterPreset(
    id: string,
    operator?: string,
    user?: SystemUserRow
  ) {
    const tenantId = this.resolvePlatformTenantId(undefined, user);
    if (this.useMysqlDataSource()) {
      return this.platformRepository.deleteFilterPreset(
        id,
        operator || user?.displayName || "营运端",
        tenantId
      );
    }

    const index = this.filterPresets.findIndex((item) => item.id === id);
    if (index < 0 || this.filterPresets[index].tenantId !== tenantId) {
      throw new NotFoundException("筛选预设不存在");
    }
    const [deleted] = this.filterPresets.splice(index, 1);
    this.recordMemoryAudit({
      tenantId: deleted.tenantId,
      action: "filter-preset.delete",
      operator: operator || user?.displayName || "营运端",
      targetType: "filter-preset",
      targetId: deleted.id,
      detail: `删除筛选预设：${deleted.name}`
    });
    return { id, deleted: true };
  }

  async listDictionaries() {
    if (this.useMysqlDataSource()) {
      return this.platformRepository.getPlatformDictionaries(this.dictionaryGroups);
    }
    return this.clone(this.dictionaryGroups);
  }

  async saveDictionaryGroup(input: SavePlatformDictionaryGroupRequest) {
    this.validateDictionaryGroup(input);

    if (this.useMysqlDataSource()) {
      return this.platformRepository.savePlatformDictionaryGroup(input);
    }

    const group: PlatformDictionaryGroup = {
      code: input.code.trim(),
      name: input.name.trim(),
      module: input.module.trim(),
      description: input.description?.trim(),
      items: this.normalizeDictionaryItems(input.items),
      updatedAt: new Date().toISOString(),
      updatedBy: input.operator || "营运端"
    };
    const index = this.dictionaryGroups.findIndex((item) => item.code === group.code);
    if (index >= 0) {
      this.dictionaryGroups[index] = group;
    } else {
      this.dictionaryGroups.unshift(group);
    }
    this.recordMemoryAudit({
      tenantId: "tenant_001",
      action: "dictionary.update",
      operator: group.updatedBy,
      targetType: "dictionary",
      targetId: group.code,
      detail: `更新数据字典：${group.name}`
    });
    return this.clone(group);
  }

  async listNumberRules() {
    if (this.useMysqlDataSource()) {
      return this.platformRepository.getPlatformNumberRules(this.numberRules);
    }
    return this.clone(
      this.numberRules.map((rule) => ({
        ...rule,
        sample: this.formatNumber(rule, rule.currentSequence + 1)
      }))
    );
  }

  async saveNumberRule(input: SavePlatformNumberRuleRequest) {
    this.validateNumberRule(input);

    if (this.useMysqlDataSource()) {
      return this.platformRepository.savePlatformNumberRule(input);
    }

    const existing = this.numberRules.find((rule) => rule.code === input.code);
    const rule: PlatformNumberRule = {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      module: input.module.trim(),
      prefix: input.prefix.trim().toUpperCase(),
      datePattern: input.datePattern,
      sequenceLength: input.sequenceLength,
      currentSequence: input.currentSequence ?? existing?.currentSequence ?? 0,
      resetCycle: input.resetCycle,
      enabled: input.enabled,
      sample: "",
      updatedAt: new Date().toISOString(),
      updatedBy: input.operator || "营运端"
    };
    rule.sample = this.formatNumber(rule, rule.currentSequence + 1);

    const index = this.numberRules.findIndex((item) => item.code === rule.code);
    if (index >= 0) {
      this.numberRules[index] = rule;
    } else {
      this.numberRules.unshift(rule);
    }
    this.recordMemoryAudit({
      tenantId: "tenant_001",
      action: "number-rule.update",
      operator: rule.updatedBy,
      targetType: "number-rule",
      targetId: rule.code,
      detail: `更新编号规则：${rule.name}`
    });
    return this.clone(rule);
  }

  async generateNumber(input: GeneratePlatformNumberRequest) {
    if (this.useMysqlDataSource()) {
      return this.platformRepository.generatePlatformNumber(input);
    }

    const rule = this.numberRules.find((item) => item.code === input.code);
    if (!rule) {
      throw new NotFoundException("编号规则不存在");
    }
    if (!rule.enabled) {
      throw new BadRequestException("编号规则已停用");
    }

    rule.currentSequence += 1;
    rule.sample = this.formatNumber(rule, rule.currentSequence + 1);
    rule.updatedAt = new Date().toISOString();
    rule.updatedBy = input.operator || "营运端";
    this.recordMemoryAudit({
      tenantId: "tenant_001",
      action: "number.generate",
      operator: rule.updatedBy,
      targetType: "number-rule",
      targetId: rule.code,
      detail: `生成编号：${this.formatNumber(rule, rule.currentSequence)}`
    });

    return {
      code: rule.code,
      generatedNo: this.formatNumber(rule, rule.currentSequence),
      nextSequence: rule.currentSequence + 1
    };
  }

  getTenantBootstrapPreview(): TenantBootstrapPreview {
    return {
      roles: [
        {
          code: "TENANT_ADMIN",
          name: "租户管理员",
          permissions: ["*"]
        },
        {
          code: "STORE_OPERATOR",
          name: "门店营运",
          permissions: [
            "rental-os:order:view",
            "rental-os:order:operate",
            "rental-core:asset:view"
          ]
        }
      ],
      dictionaries: this.dictionaryGroups.map((item) => item.code),
      numberRules: this.numberRules.map((item) => item.code),
      systemRules: ["system-rules"]
    };
  }

  async bootstrapTenant(input: TenantBootstrapRequest, currentUser?: SystemUserRow): Promise<TenantBootstrapResult> {
    this.assertSaasAdmin(currentUser);
    const tenantCode = input.tenantCode.trim().toLowerCase();
    const tenantName = input.tenantName.trim();
    const adminAccount = input.adminAccount.trim();
    const adminDisplayName = input.adminDisplayName.trim();

    if (!tenantCode || !tenantName || !adminAccount || !adminDisplayName || !input.categoryCode) {
      throw new BadRequestException("租户编码、名称、经营品类和管理员信息不能为空");
    }
    if (!Object.values(RentalCategoryCode).includes(input.categoryCode)) {
      throw new BadRequestException("经营品类不存在");
    }
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(tenantCode)) {
      throw new BadRequestException("租户编码必须以小写字母开头，只能包含小写字母、数字、下划线和短横线");
    }

    if (this.useMysqlDataSource()) {
      const result = await this.platformRepository.bootstrapTenant(
        input,
        this.getTenantBootstrapPreview(),
        {
          systemRules: this.systemRulesConfig,
          dictionaries: this.dictionaryGroups,
          numberRules: this.numberRules
        },
        // 需求 4.1：品类配置必须与租户档案同事务创建，任一步失败整体回滚，
        // 不留"租户和管理员已建、品类配置没建"的半成品租户。
        async (tx, tenantId) => {
          await this.rentalCoreService?.initializeTenant(tenantId, input.categoryCode, tx, input.currency);
        }
      );
      // bootstrapTenant 的配置写入刚刚随仓储事务提交；现在才可发布/持久化缓存。
      await this.rentalCoreService?.onApplicationBootstrap();
      await this.rentalCoreService?.persist(result.tenant.tenantId);
      return result;
    }

    if (this.tenants.some((tenant) => tenant.tenantCode === tenantCode)) {
      throw new BadRequestException("租户编码已存在");
    }

    const tenantId = `tenant_${tenantCode}`;
    const orgId = `org_operator_${tenantCode}`;
    const storeId = `org_store_${tenantCode}`;
    const platformRoleId = `role_tenant_admin_${tenantCode}`;
    const storeRoleId = `role_store_operator_${tenantCode}`;
    const tenant: TenantSummary = {
      tenantId,
      tenantCode,
      tenantName,
      tenantStatus: TenantStatus.Active,
      enabledBusinessLines: ["rental_core"],
      categoryCode: input.categoryCode,
      categoryName: this.rentalCategoryName(input.categoryCode),
      capabilities: [...(RENTAL_CATEGORY_DEFINITIONS.find((category) => category.code === input.categoryCode)?.defaultCapabilities ?? [])]
    };
    this.tenants.push(tenant);
    this.organizations.push(
      {
        id: orgId,
        tenantId,
        type: RoleScope.Operator,
        code: `OP-${tenantCode.toUpperCase()}`,
        name: `${tenantName}营运中心`,
        status: "enabled"
      },
      {
        id: storeId,
        tenantId,
        parentId: orgId,
        type: RoleScope.Store,
        code: input.storeCode?.trim() || `STORE-${tenantCode.toUpperCase()}`,
        name: input.storeName?.trim() || `${tenantName}履约空间`,
        status: "enabled"
      }
    );
    this.roleRows.push(
      {
        ...this.roleRows[0],
        id: platformRoleId,
        tenantId,
        code: "TENANT_ADMIN",
        name: "租户管理员",
        permissions: ["*"],
        buttonPermissions: ["*"]
      },
      {
        ...this.roleRows[1],
        id: storeRoleId,
        tenantId
      }
    );

    const temporaryPassword = `R!${randomUUID().replace(/-/g, "").slice(0, 12)}8a`;

    const user: StoredUser = {
      id: `user_admin_${tenantCode}`,
      tenantId,
      account: adminAccount,
      password: temporaryPassword,
      displayName: adminDisplayName,
      phone: input.adminPhone,
      organizationId: orgId,
      roleIds: [platformRoleId],
      isPlatformAdmin: true,
      isSaasAdmin: false,
      mustChangePassword: true,
      needsTenantOnboarding: true,
      isActive: true
    };
    this.users.push(user);
    this.recordMemoryAudit({
      tenantId,
      action: "tenant.bootstrap",
      operator: currentUser?.displayName || input.operator || "SaaS 平台管理员",
      targetType: "tenant",
      targetId: tenantId,
      detail: `初始化租户：${tenantName}`
    });

    await this.rentalCoreService?.initializeTenant(tenantId, input.categoryCode, undefined, input.currency);
    await this.rentalCoreService?.persist(tenantId);
    return {
      tenant,
      adminUser: this.toUserRow(user),
      preview: this.getTenantBootstrapPreview(),
      templateExecution: this.buildTenantBootstrapExecution(),
      temporaryPassword,
      message: "租户初始化已完成；临时密码仅本次返回，管理员首次登录必须修改。"
    };
  }

  listTenants(currentUser?: SystemUserRow) {
    this.assertSaasAdmin(currentUser);
    if (this.useMysqlDataSource()) {
      return this.platformRepository.listTenants();
    }
    return this.tenants
      .filter((tenant) => tenant.tenantCode !== "platform")
      .map((tenant) => ({
        ...tenant,
        userCount: this.users.filter((user) => user.tenantId === tenant.tenantId).length,
        organizationCount: this.organizations.filter((organization) => organization.tenantId === tenant.tenantId).length,
        orderCount: tenant.orderCount ?? 0
      }));
  }

  getTenant(id: string, currentUser?: SystemUserRow) {
    this.assertSaasAdmin(currentUser);
    if (this.useMysqlDataSource()) return this.platformRepository.getTenant(id);
    const tenant = this.tenants.find((item) => item.tenantId === id);
    if (!tenant) throw new NotFoundException("租户不存在");
    if (tenant.tenantCode === "platform") throw new BadRequestException("SaaS 平台主体不属于业务租户列表");
    return tenant;
  }

  updateTenant(id: string, input: UpdateTenantRequest, currentUser?: SystemUserRow) {
    this.assertSaasAdmin(currentUser);
    if (this.useMysqlDataSource()) return this.platformRepository.updateTenant(id, input, currentUser!);
    const tenant = this.tenants.find((item) => item.tenantId === id);
    if (!tenant) throw new NotFoundException("租户不存在");
    if (tenant.tenantCode === "platform") throw new BadRequestException("SaaS 平台主体不能通过租户接口修改");
    const tenantName = input.tenantName.trim();
    if (!tenantName) throw new BadRequestException("租户名称不能为空");
    tenant.tenantName = tenantName;
    return tenant;
  }

  updateTenantStatus(id: string, input: UpdateTenantStatusRequest, currentUser?: SystemUserRow) {
    this.assertSaasAdmin(currentUser);
    if (this.useMysqlDataSource()) return this.platformRepository.updateTenantStatus(id, input, currentUser!);
    const tenant = this.tenants.find((item) => item.tenantId === id);
    if (!tenant) throw new NotFoundException("租户不存在");
    if (tenant.tenantCode === "platform") throw new BadRequestException("SaaS 平台主体不能冻结或停用");
    if (!input.reason.trim()) throw new BadRequestException("状态变更原因不能为空");
    tenant.tenantStatus = input.status;
    tenant.statusReason = input.reason.trim();
    if (input.status !== TenantStatus.Active) {
      for (const session of this.authSessions.values()) {
        const user = this.users.find((item) => item.id === session.userId);
        if (user?.tenantId === id) session.revokedAt = new Date();
      }
    }
    return tenant;
  }

  async listTenantBusinessWorkspaces(tenantId: string, currentUser?: SystemUserRow) {
    this.assertSaasAdmin(currentUser);
    this.requireWorkspaceDataSource();
    await this.platformRepository.getTenant(tenantId);
    return this.platformRepository.listBusinessWorkspacesForTenant(tenantId);
  }

  async createTenantBusinessWorkspace(
    tenantId: string,
    input: CreateBusinessWorkspaceRequest,
    currentUser?: SystemUserRow
  ) {
    this.assertSaasAdmin(currentUser);
    this.requireWorkspaceDataSource();
    await this.platformRepository.getTenant(tenantId);
    const result = await this.platformRepository.createBusinessWorkspaceForTenant(
      tenantId,
      input,
      async (tx, workspaceId) => {
        await this.rentalCoreService?.registerWorkspace(workspaceId, tenantId, input.categoryCode, tx);
        // 与 createBusinessWorkspace 同一口径：必选能力与空间档案原子创建。
        await this.initializeWorkspaceCapabilities(
          tenantId,
          workspaceId,
          input.categoryCode,
          tx,
          undefined,
          input.runMode ?? "development"
        );
        const tenantAdmins = await tx.user.findMany({
          where: { tenantId, isPlatformAdmin: true, isActive: true },
          select: { id: true }
        });
        if (tenantAdmins.length) {
          await tx.workspaceMember.createMany({
            data: tenantAdmins.map((admin) => ({ tenantId, workspaceId, userId: admin.id, isActive: true })),
            skipDuplicates: true
          });
        }
      }
    );
    await this.rentalCoreService?.onApplicationBootstrap();
    return result;
  }

  async updateTenantBusinessWorkspace(
    tenantId: string,
    workspaceId: string,
    input: UpdateBusinessWorkspaceRequest,
    currentUser?: SystemUserRow
  ) {
    this.assertSaasAdmin(currentUser);
    this.requireWorkspaceDataSource();
    await this.platformRepository.getTenant(tenantId);
    await this.assertProductionModeAllowed(tenantId, workspaceId, input);
    return this.platformRepository.updateBusinessWorkspaceForTenant(tenantId, workspaceId, input);
  }

  findTenantByCode(code: string) {
    if (this.useMysqlDataSource()) {
      return this.platformRepository.findTenantByCode(code);
    }
    return this.tenants.find((tenant) => tenant.tenantCode === code);
  }

  /**
   * SPACE-01：经营空间主档与成员关系一律以 MySQL 为事实源。
   *
   * 刻意不提供内存模式实现：内存假数据源在本项目造成过 P0-01（跨租户泄露被
   * 演示固件掩盖），四份文档都写明不得把内存数据源当成持久化的证明。
   * 空间隔离是安全边界，宁可在无库时明确拒绝，也不给一个"看起来能用"的假实现。
   */
  private requireWorkspaceDataSource() {
    if (!this.useMysqlDataSource()) {
      throw new BadRequestException("经营空间管理需要 MySQL 数据源，当前为内存演示模式");
    }
  }

  listBusinessWorkspaces(currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.platformRepository.listBusinessWorkspaces(currentUser);
  }

  /**
   * 共享客户主档仓储只在连库时注入（不连库的单元测试用位置参数构造本服务）。
   * 缺失时明确拒绝，而不是让 `undefined.xxx` 抛成 500。
   */
  private requireSharedCustomers(): SharedCustomerRepository {
    if (!this.sharedCustomers) {
      throw new BadRequestException("共享客户主档需要 MySQL 数据源，当前为内存演示模式");
    }
    return this.sharedCustomers;
  }

  /* ---------- SPACE-04：租户共享客户主档 ---------- */

  listSharedCustomers(currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireSharedCustomers().listByTenant(tenantId);
  }

  /**
   * CUSTOMER-01B 的入口一律在这里解析 `tenantId` 与 `workspaceId` 后转交
   * `CustomerOperationsService`，与本文件其他经营入口同一口径：
   * 空间只从会话取，客户端传什么都不作数。
   */
  private requireCustomerOperations() {
    if (!this.customerOperations) {
      throw new ConflictException("客户运营服务未就绪");
    }
    return this.customerOperations;
  }

  getCustomerDetail(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().getCustomerDetail(
      tenantId,
      getRequestWorkspaceId(),
      customerId,
      currentUser
    );
  }

  getCustomerProfileOverview(customerId: string, query: CustomerProfileOrderQuery = {}, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().getProfileOverview(
      tenantId,
      getRequestWorkspaceId(),
      customerId,
      currentUser,
      query
    );
  }

  saveCustomerProfileAddress(customerId: string, input: SaveCustomerProfileAddressRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().saveCustomerAddress(tenantId, customerId, input);
  }

  removeCustomerProfileAddress(customerId: string, addressId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().removeCustomerAddress(tenantId, customerId, addressId);
  }

  listSharedCustomersMasked(currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().listCustomers(
      tenantId,
      getRequestWorkspaceId(),
      currentUser
    );
  }

  ensureCustomerAccount(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().ensureAccount(tenantId, customerId, currentUser?.displayName);
  }

  changeCustomerAccountStatus(
    customerId: string,
    input: ChangeCustomerAccountStatusRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    this.assertCustomerActionPermission(
      currentUser,
      input.status === "closed" ? "rental-os:customer:close" : "rental-os:member:account-manage",
      input.status === "closed" ? "注销客户账号" : "变更客户账号状态"
    );
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    // 账号级动作**不**解析 workspaceId：它影响全部空间，绑定某个空间会造成误解。
    return this.requireCustomerOperations().changeAccountStatus(
      tenantId,
      customerId,
      input,
      currentUser?.displayName
    );
  }

  changeCustomerMembershipStatus(
    customerId: string,
    input: ChangeCustomerMembershipStatusRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    this.assertCustomerActionPermission(
      currentUser,
      input.status === "closed"
        ? "rental-os:customer:close"
        : input.status === "risk_restricted"
          ? "rental-os:member:risk-action"
          : "rental-os:member:manage",
      input.status === "closed"
        ? "注销租户会员关系"
        : input.status === "risk_restricted"
          ? "限制客户风险状态"
          : "变更租户会员状态"
    );
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().changeMembershipStatus(
      tenantId,
      customerId,
      input,
      currentUser?.displayName
    );
  }

  listCustomerStatusHistory(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().listStatusHistory(tenantId, customerId);
  }

  listCustomerSensitiveAccess(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().listSensitiveAccess(tenantId, customerId, currentUser);
  }


  private requireCustomerMerge() {
    if (!this.customerMerge) throw new ConflictException("客户合并服务未就绪");
    return this.customerMerge;
  }

  findCustomerDuplicates(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerMerge().findDuplicates(tenantId, customerId);
  }

  previewCustomerMerge(customerId: string, targetCustomerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    if (!targetCustomerId?.trim()) throw new BadRequestException("必须指定保留主档 targetCustomerId");
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerMerge().previewMerge(tenantId, customerId, targetCustomerId.trim());
  }

  mergeCustomers(input: MergeCustomersRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    // 合并是租户级动作，不绑定空间：被合并方的空间会员关系原样保留，不做跨空间搬迁。
    return this.requireCustomerMerge().mergeCustomers(tenantId, input, currentUser?.displayName);
  }

  getCustomerClosability(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    // 不传 workspaceId：本接口回答「整个租户客户账号能否注销」。
    // 空间会员注销的检查在改状态时按空间范围各自进行。
    return this.requireCustomerMerge().assertClosable(tenantId, customerId);
  }

  getCustomerMembershipClosability(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerMerge().assertClosable(tenantId, customerId);
  }

  getCustomerTransactability(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().assertTransactable(
      tenantId,
      requireRequestWorkspaceId(),
      customerId
    );
  }

  /**
   * CUSTOMER-01C：企业资料入口。
   *
   * 与客户主档一样按 `tenantId` 解析——企业资料属于租户级客户身份，不按空间隔离
   * （同一家企业在两个空间是同一家企业，开票与合同不该各存一份）。
   */
  private requireCustomerCorporate() {
    if (!this.customerCorporate) {
      throw new ConflictException("企业客户服务未就绪");
    }
    return this.customerCorporate;
  }

  private requireCustomerCorporateSettlement() {
    if (!this.customerCorporateSettlement) {
      throw new ConflictException("企业授信账务服务未就绪");
    }
    return this.customerCorporateSettlement;
  }

  listCustomerInvoiceProfiles(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().listInvoiceProfiles(tenantId, customerId);
  }

  saveCustomerInvoiceProfile(
    customerId: string,
    input: SaveCustomerInvoiceProfileRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().saveInvoiceProfile(tenantId, customerId, input);
  }

  listCustomerContracts(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().listContracts(tenantId, customerId);
  }

  saveCustomerContract(
    customerId: string,
    input: SaveCustomerContractRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().saveContract(tenantId, customerId, input);
  }

  getCustomerCredit(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().getCredit(tenantId, customerId);
  }

  saveCustomerCredit(
    customerId: string,
    input: SaveCustomerCreditRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().saveCredit(
      tenantId,
      customerId,
      input,
      currentUser?.displayName
    );
  }

  async registerSharedCustomer(input: SaveSharedCustomerRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    if (!this.memberships) throw new ConflictException("会员服务未就绪");
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    const customerId = input.customerType === "corporate"
      ? (await this.memberships.saveCorporateMember(tenantId, {
          name: input.name,
          phone: input.phone,
          email: input.email,
          corporateName: input.corporateName?.trim() || input.name,
          corporateTaxNo: input.corporateTaxNo
        })).customerId
      : (await this.memberships.registerPersonal(tenantId, {
          name: input.name,
          phone: input.phone,
          email: input.email,
          identityNo: input.identityNo,
          gender: input.gender,
          birthday: input.birthday,
          sourceChannel: input.sourceChannel,
          region: input.region,
          channel: "admin"
        }, currentUser?.displayName)).customerId;
    return this.requireSharedCustomers().findById(tenantId, customerId);
  }

  async createBusinessWorkspace(input: CreateBusinessWorkspaceRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    // 需求 4.1：空间档案与其品类配置同事务创建，任一步失败整体回滚。
    const result = await this.platformRepository.createBusinessWorkspace(input, currentUser, async (tx, workspaceId, tenantId) => {
      await this.rentalCoreService?.registerWorkspace(workspaceId, tenantId, input.categoryCode, tx);
      // Review P1-3：品类必选能力必须与空间档案原子创建。放在同一 tx 里，
      // 任一步失败则空间与能力实例一起回滚，不会留下「空间已建、能力没开」的半成品
      // ——那种空间在正式经营模式下连报价都做不了。
      await this.initializeWorkspaceCapabilities(
        tenantId,
        workspaceId,
        input.categoryCode,
        tx,
        currentUser,
        input.runMode ?? "development"
      );
    });
    // 仓储事务已经提交，才允许将新空间发布到本进程缓存。
    await this.rentalCoreService?.onApplicationBootstrap();
    return result;
  }

  /**
   * 在给定事务内初始化某空间的品类必选能力。
   *
   * 品类声明集从**品类定义**读取，与能力服务的 `overview` 同源；不接受调用方传入，
   * 否则调用方可以声明一份自选的必选清单。
   */
  private async initializeWorkspaceCapabilities(
    tenantId: string,
    workspaceId: string,
    categoryCode: RentalCategoryCode,
    tx: Prisma.TransactionClient,
    currentUser?: SystemUserRow,
    runMode: "production" | "demo" | "development" = "development"
  ) {
    if (!this.workspaceCapabilityService) {
      if (runMode === "production") {
        throw new ConflictException("能力服务不可用，不能创建正式经营空间");
      }
      return;
    }
    const category = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === categoryCode);
    const declared = category?.defaultCapabilities ?? [];
    const required = category?.requiredCapabilities ?? [];
    const result = await this.workspaceCapabilityService.initializeRequiredCapabilities(
      tenantId,
      workspaceId,
      categoryCode,
      declared,
      tx,
      { operator: currentUser?.displayName, requiredCodes: required }
    );
    if (result.skipped.length) {
      // 跳过的必选能力不是错误（未实现、或必填配置无默认值），但必须留痕：
      // 空间会保持非生产就绪，运营需要知道还差什么。
      this.logger.warn(
        `空间 ${workspaceId} 初始化必选能力时跳过：` +
          result.skipped.map((row) => `${row.code}（${row.why}）`).join("；")
      );
    }
    if (runMode === "production") {
      const enabled = new Set(result.enabled);
      const missing = required.filter((code) => !enabled.has(code));
      if (missing.length) {
        throw new ConflictException(
          `正式经营空间初始化失败：缺少可自动启用的必选能力 ${missing.join("、")}。` +
            "请改为演示/开发模式创建，或先补齐能力实现与默认配置。"
        );
      }
    }
  }

  async updateBusinessWorkspace(id: string, input: UpdateBusinessWorkspaceRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    await this.assertProductionModeAllowed(tenantId, id, input);
    return this.platformRepository.updateBusinessWorkspace(id, input, currentUser);
  }

  private async assertProductionModeAllowed(
    tenantId: string,
    workspaceId: string,
    input: UpdateBusinessWorkspaceRequest
  ) {
    if (input.runMode !== "production") return;
    if (!this.workspaceCapabilityService) {
      throw new ConflictException("能力服务不可用，不能将经营空间切换为正式经营模式");
    }
    const overview = await this.workspaceCapabilityService.overview(tenantId, workspaceId);
    if (!overview.productionReady) {
      throw new ConflictException(
        `经营空间尚未达到正式经营条件：缺少必选能力 ${overview.missingRequired.join("、")}`
      );
    }
  }

  listWorkspaceMembers(workspaceId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.platformRepository.listWorkspaceMembers(workspaceId, currentUser);
  }

  listWorkspaceFulfillmentLocations(workspaceId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.platformRepository.listWorkspaceFulfillmentLocations(workspaceId, currentUser);
  }

  saveWorkspaceMember(workspaceId: string, input: SaveWorkspaceMemberRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.platformRepository.saveWorkspaceMember(workspaceId, input, currentUser);
  }

  listOrganizations(tenantId?: string, currentUser?: SystemUserRow) {
    if (this.useMysqlDataSource()) {
      return this.platformRepository.listOrganizations(tenantId, currentUser);
    }
    const where = buildOrganizationWhere(tenantId, currentUser);
    return this.organizations.filter((item) => {
      if (where.tenantId && item.tenantId !== where.tenantId) {
        return false;
      }
      if (where.id && item.id !== where.id) {
        return false;
      }
      return true;
    });
  }

  async saveOrganization(input: SaveOrganizationRequest, currentUser?: SystemUserRow) {
    const tenantId = this.resolveTargetTenantId(input.tenantId, currentUser);
    input = { ...input, tenantId };
    if (this.useMysqlDataSource()) {
      return this.platformRepository.saveOrganization(input);
    }

    const code = input.code.trim();
    const name = input.name.trim();
    const parentId = input.parentId?.trim() || undefined;
    const status = input.status ?? "enabled";

    if (!code || !name) {
      throw new BadRequestException("组织编码和组织名称不能为空");
    }
    if (!this.tenants.some((tenant) => tenant.tenantId === input.tenantId)) {
      throw new BadRequestException("租户不存在");
    }
    if (
      this.organizations.some(
        (item) =>
          item.tenantId === input.tenantId &&
          item.code === code &&
          item.id !== input.id
      )
    ) {
      throw new BadRequestException("该租户下组织编码已存在");
    }
    if (parentId) {
      if (parentId === input.id) {
        throw new BadRequestException("上级组织不能选择自身");
      }
      const parent = this.organizations.find((item) => item.id === parentId);
      if (!parent || parent.tenantId !== input.tenantId) {
        throw new BadRequestException("上级组织不属于当前租户");
      }
    }

    const existing = input.id
      ? this.organizations.find(
          (item) => item.id === input.id && item.tenantId === input.tenantId
        )
      : undefined;
    if (input.id && !existing) {
      throw new NotFoundException("组织不存在");
    }
    const row: OrganizationSummary = {
      id: existing?.id ?? `org_${randomUUID()}`,
      tenantId: input.tenantId,
      parentId,
      type: input.type,
      code,
      name,
      status
    };

    if (existing) {
      Object.assign(existing, row);
    } else {
      this.organizations.push(row);
    }

    this.recordMemoryAudit({
      tenantId: row.tenantId,
      action: existing ? "organization.update" : "organization.create",
      operator: input.operator ?? "平台管理员",
      targetType: "organization",
      targetId: row.id,
      detail: `${existing ? "更新" : "创建"}组织 ${row.name}`
    });

    return row;
  }

  async setOrganizationStatus(
    id: string,
    status: OrganizationSummary["status"],
    operator = "租户管理员",
    currentUser?: SystemUserRow
  ) {
    const existing = this.organizations.find((item) => item.id === id);
    const mysqlTarget = this.useMysqlDataSource()
      ? await this.platformRepository.getOrganizationTenantId(id)
      : existing?.tenantId;
    this.resolveTargetTenantId(mysqlTarget, currentUser);
    if (this.useMysqlDataSource()) {
      return this.platformRepository.setOrganizationStatus(id, status, operator);
    }

    const row = this.organizations.find((item) => item.id === id);
    if (!row) {
      throw new NotFoundException("组织不存在");
    }
    row.status = status;

    this.recordMemoryAudit({
      tenantId: row.tenantId,
      action: "organization.status",
      operator,
      targetType: "organization",
      targetId: row.id,
      detail: `${status === "enabled" ? "启用" : "停用"}组织 ${row.name}`
    });

    return row;
  }

  listPermissionTree() {
    if (this.useMysqlDataSource()) {
      return this.platformRepository.listPermissionTree();
    }
    return this.permissionTree;
  }

  listRoles(tenantId?: string, currentUser?: SystemUserRow) {
    const targetTenantId = this.resolveTargetTenantId(tenantId, currentUser);
    if (this.useMysqlDataSource()) {
      return this.platformRepository.listRoles(targetTenantId);
    }
    return this.roleRows
      .filter((role) => !role.tenantId || role.tenantId === targetTenantId)
      .map((role) => ({ ...role, tenantId: targetTenantId }));
  }

  findTenantByIdForAuth(id: string) {
    if (this.useMysqlDataSource()) return this.platformRepository.getTenant(id);
    const tenant = this.tenants.find((item) => item.tenantId === id);
    if (!tenant) throw new NotFoundException("租户不存在");
    return tenant;
  }

  saveRole(input: SaveSystemRoleRequest, currentUser?: SystemUserRow) {
    const tenantId = this.resolveTargetTenantId(input.tenantId, currentUser);
    if (this.useMysqlDataSource()) {
      return this.platformRepository.saveRole(input, tenantId);
    }
    const existing = input.id
      ? this.roleRows.find((role) => role.id === input.id)
      : undefined;
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();

    if (!code || !name) {
      throw new BadRequestException("角色编码和角色名称不能为空");
    }
    if (existing?.tenantId && existing.tenantId !== tenantId) {
      throw new NotFoundException("角色不存在");
    }
    if (
      this.roleRows.some(
        (role) =>
          role.id !== existing?.id &&
          role.code === code &&
          (!role.tenantId || role.tenantId === tenantId)
      )
    ) {
      throw new BadRequestException("角色编码已存在");
    }

    const fixedAllPermissions =
      existing?.fixedAllPermissions ?? code === "TENANT_ADMIN";
    const requestedPermissions = [...new Set(input.permissions ?? [])];
    const requestedButtonPermissions = [
      ...new Set([
        ...(input.buttonPermissions ?? []),
        ...requestedPermissions.filter((permission) =>
          this.isButtonPermission(permission)
        )
      ])
    ];
    const role: SystemRoleRow = {
      id: existing?.id ?? `role_${randomUUID()}`,
      tenantId,
      code,
      name,
      description: input.description?.trim(),
      scope: input.scope,
      fixedAllPermissions,
      enabledBusinessScopes: [...new Set(input.enabledBusinessScopes ?? [])],
      isActive: input.isActive ?? true,
      permissions: fixedAllPermissions
        ? ["*"]
        : requestedPermissions.filter(
            (permission) => !this.isButtonPermission(permission)
          ),
      buttonPermissions: fixedAllPermissions ? ["*"] : requestedButtonPermissions,
      dataScope:
        fixedAllPermissions
          ? "all"
          : input.dataScope ?? existing?.dataScope ?? this.defaultDataScope(input.scope)
    };
    const index = this.roleRows.findIndex((item) => item.id === role.id);

    if (index >= 0) {
      this.roleRows[index] = role;
    } else {
      this.roleRows.unshift(role);
    }

    return role;
  }

  async saveRolePermissions(id: string, permissions: string[], tenantId: string | undefined, currentUser?: SystemUserRow) {
    const targetTenantId = this.resolveTargetTenantId(
      tenantId ?? (this.useMysqlDataSource()
        ? await this.platformRepository.getRoleTenantId(id)
        : this.roleRows.find((role) => role.id === id)?.tenantId),
      currentUser
    );
    if (this.useMysqlDataSource()) {
      return this.platformRepository.saveRolePermissions(id, permissions, targetTenantId);
    }
    const role = this.roleRows.find((item) => item.id === id);

    if (!role) {
      throw new NotFoundException(`Role ${id} was not found`);
    }
    if (role.fixedAllPermissions) {
      return role;
    }

    const nextPermissions = [...new Set(permissions)];
    role.permissions = nextPermissions.filter(
      (permission) => !this.isButtonPermission(permission)
    );
    role.buttonPermissions = nextPermissions.filter((permission) =>
      this.isButtonPermission(permission)
    );
    return role;
  }

  async deleteRole(id: string, tenantId: string | undefined, currentUser?: SystemUserRow) {
    const targetTenantId = this.resolveTargetTenantId(
      tenantId ?? (this.useMysqlDataSource()
        ? await this.platformRepository.getRoleTenantId(id)
        : this.roleRows.find((role) => role.id === id)?.tenantId),
      currentUser
    );
    if (this.useMysqlDataSource()) {
      return this.platformRepository.deleteRole(id, targetTenantId);
    }
    const index = this.roleRows.findIndex((role) => role.id === id);
    if (index < 0) {
      throw new NotFoundException(`Role ${id} was not found`);
    }

    const role = this.roleRows[index];
    if (role.fixedAllPermissions) {
      throw new BadRequestException("预设角色不能删除");
    }
    if (this.users.some((user) => user.roleIds.includes(id))) {
      throw new BadRequestException("该角色已分配给账号，不能删除");
    }

    this.roleRows.splice(index, 1);
    return {
      id,
      deleted: true
    };
  }

  async setUserStatus(id: string, isActive: boolean, tenantId: string | undefined, currentUser?: SystemUserRow) {
    const targetTenantId = this.resolveTargetTenantId(
      tenantId ?? (this.useMysqlDataSource()
        ? await this.platformRepository.getUserTenantId(id)
        : this.users.find((user) => user.id === id)?.tenantId),
      currentUser
    );
    if (this.useMysqlDataSource()) {
      return this.platformRepository.setUserStatus(id, isActive, targetTenantId);
    }
    const user = this.users.find((item) => item.id === id);
    if (!user || user.tenantId !== targetTenantId) {
      throw new NotFoundException(`User ${id} was not found`);
    }
    user.isActive = isActive;
    return this.toUserRow(user);
  }

  async resetUserPassword(id: string, tenantId: string | undefined, currentUser?: SystemUserRow) {
    const targetTenantId = this.resolveTargetTenantId(
      tenantId ?? (this.useMysqlDataSource()
        ? await this.platformRepository.getUserTenantId(id)
        : this.users.find((user) => user.id === id)?.tenantId),
      currentUser
    );
    if (this.useMysqlDataSource()) {
      return this.platformRepository.resetUserPassword(id, targetTenantId);
    }
    const user = this.users.find((item) => item.id === id);
    if (!user || user.tenantId !== targetTenantId) {
      throw new NotFoundException(`User ${id} was not found`);
    }
    const temporaryPassword = `R!${randomUUID().replace(/-/g, "").slice(0, 12)}8a`;
    user.password = temporaryPassword;
    user.mustChangePassword = true;
    await this.revokeUserSessions(user.id);
    return {
      userId: user.id,
      account: user.account,
      temporaryPassword,
      message: "密码已重置为一次性临时密码，用户下次登录必须修改。"
    };
  }

  async resetTenantAdminPassword(tenantId: string, currentUser?: SystemUserRow) {
    this.assertSaasAdmin(currentUser);
    if (this.useMysqlDataSource()) {
      return this.platformRepository.resetTenantAdminPassword(tenantId);
    }

    const tenant = this.tenants.find((item) => item.tenantId === tenantId && item.tenantCode !== "platform");
    if (!tenant) {
      throw new NotFoundException("租户不存在");
    }
    const admin = this.users.find((user) => user.tenantId === tenantId && user.isPlatformAdmin);
    if (!admin) {
      throw new NotFoundException("租户管理员账号不存在");
    }
    return this.resetUserPassword(admin.id, tenantId, currentUser);
  }

  listUsers(tenantId?: string, currentUser?: SystemUserRow) {
    if (this.useMysqlDataSource()) {
      return this.platformRepository.listUsers(tenantId, currentUser);
    }
    const where = buildSystemUserWhere(tenantId, currentUser);
    return this.users
      .filter((user) => {
        if (where.tenantId && user.tenantId !== where.tenantId) {
          return false;
        }
        if (where.id && user.id !== where.id) {
          return false;
        }
        if (where.organizationId && user.organizationId !== where.organizationId) {
          return false;
        }
        return true;
      })
      .map((user) => this.toUserRow(user));
  }

  saveUser(input: SaveSystemUserRequest, currentUser?: SystemUserRow) {
    const targetTenantId = this.resolveTargetTenantId(input.tenantId, currentUser);
    input = { ...input, tenantId: targetTenantId, isSaasAdmin: false };
    if (this.useMysqlDataSource()) {
      return this.platformRepository.saveUser(input, targetTenantId);
    }
    const tenant = this.tenants.find((item) => item.tenantId === input.tenantId);
    const account = input.account.trim();
    const displayName = input.displayName.trim();

    if (!tenant) {
      throw new BadRequestException("租户不存在");
    }
    if (!account || !displayName) {
      throw new BadRequestException("账号和姓名不能为空");
    }
    if (
      this.users.some(
        (user) =>
          user.id !== input.id &&
          user.tenantId === input.tenantId &&
          user.account === account
      )
    ) {
      throw new BadRequestException("该租户下账号已存在");
    }
    if (
      input.organizationId &&
      !this.organizations.some(
        (org) => org.tenantId === input.tenantId && org.id === input.organizationId
      )
    ) {
      throw new BadRequestException("归属组织不属于当前租户");
    }

    const existingUser = input.id
      ? this.users.find(
          (user) => user.id === input.id && user.tenantId === input.tenantId
        )
      : undefined;
    if (input.id && !existingUser) {
      throw new NotFoundException("账号不存在");
    }

    const tenantAdminRoleId =
      this.roleRows.find(
        (role) => role.tenantId === input.tenantId && role.code === "TENANT_ADMIN"
      )?.id ?? "role_platform_admin";
    const roleIds = input.isPlatformAdmin
      ? [tenantAdminRoleId]
      : [...new Set(input.roleIds)].filter((roleId) => roleId !== tenantAdminRoleId);
    const invalidRoleIds = roleIds.filter(
      (roleId) =>
        !this.roleRows.some(
          (role) =>
            role.id === roleId &&
            (!role.tenantId || role.tenantId === input.tenantId)
        )
    );

    if (!input.isPlatformAdmin && roleIds.length === 0) {
      throw new BadRequestException("普通用户至少选择一个角色");
    }
    if (invalidRoleIds.length > 0) {
      throw new BadRequestException("角色不存在");
    }

    const temporaryPassword = input.id ? undefined : `R!${randomUUID().replace(/-/g, "").slice(0, 12)}8a`;
    const payload: StoredUser = {
      ...input,
      tenantId: targetTenantId,
      id: input.id || `user_${randomUUID()}`,
      account,
      displayName,
      password: temporaryPassword ?? "",
      mustChangePassword: input.id ? existingUser?.mustChangePassword : true,
      roleIds
    };
    const index = this.users.findIndex((user) => user.id === payload.id);

    if (index >= 0) {
      this.users[index] = {
        ...this.users[index],
        ...payload,
        password: this.users[index].password
      };
    } else {
      this.users.unshift(payload);
    }

    return { ...this.toUserRow(index >= 0 ? this.users[index] : payload), temporaryPassword };
  }

  /**
   * ACCESS-01C：账号资料、租户角色和经营空间授权必须共用一个事务。
   *
   * 运营账号页面原先先保存账号，再并行保存各空间成员关系；其中一个空间
   * 失败时会留下半套授权。该入口只允许在真实空间数据源上执行，避免内存
   * 演示模式伪造空间权限事实。
   */
  saveUserWithWorkspaceAccess(
    input: SaveSystemUserAccessRequest,
    currentUser?: SystemUserRow
  ) {
    const targetTenantId = this.resolveTargetTenantId(input.tenantId, currentUser);
    this.requireWorkspaceDataSource();
    return this.platformRepository.saveUserWithWorkspaceAccess(
      { ...input, tenantId: targetTenantId, isSaasAdmin: false },
      targetTenantId
    );
  }

  getCustomerCreditAccount(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporateSettlement().account(tenantId, customerId);
  }

  listCustomerCreditLedger(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporateSettlement().listLedger(tenantId, customerId);
  }

  recordCustomerCreditPayment(
    customerId: string,
    input: RecordCustomerCorporateCreditPaymentRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporateSettlement().recordPayment(
      tenantId,
      customerId,
      input,
      currentUser?.displayName
    );
  }

  async findUserForLogin(tenantCode: string, account: string, password: string) {
    if (this.useMysqlDataSource()) {
      return this.platformRepository.findUserForLogin(tenantCode, account, password);
    }
    const tenant = this.tenants.find((item) => item.tenantCode === tenantCode);
    if (!tenant || tenant.tenantStatus !== TenantStatus.Active) {
      return undefined;
    }

    const user = this.users.find(
      (item) =>
        item.tenantId === tenant.tenantId &&
        item.account === account &&
        item.password === password &&
        item.isActive
    );

    const needsTenantOnboarding = Boolean(
      user?.needsTenantOnboarding && user.mustChangePassword && user.isPlatformAdmin && !user.isSaasAdmin
    );
    return user
      ? {
          tenant,
          user: this.toUserRow(user),
          needsTenantOnboarding
        }
      : undefined;
  }

  async findUserById(id: string) {
    if (this.useMysqlDataSource()) return this.platformRepository.findUserById(id);
    const user = this.users.find((item) => item.id === id && item.isActive);
    const tenant = this.tenants.find((item) => item.tenantId === user?.tenantId);
    return user && tenant?.tenantStatus === TenantStatus.Active ? this.toUserRow(user) : undefined;
  }

  createAuthSession(input: { id: string; userId: string; refreshTokenHash: string; expiresAt: Date; currentWorkspaceId?: string | null; audience?: "operator" | "staff" }) {
    if (this.useMysqlDataSource()) return this.platformRepository.createAuthSession(input);
    const session = { ...input, audience: input.audience ?? "operator" as const };
    this.authSessions.set(input.id, session);
    return session;
  }

  async rotateAuthSession(
    previousSessionId: string,
    input: { id: string; userId: string; refreshTokenHash: string; expiresAt: Date; currentWorkspaceId?: string | null; audience?: "operator" | "staff" }
  ): Promise<boolean> {
    if (this.useMysqlDataSource()) return this.platformRepository.rotateAuthSession(previousSessionId, input);
    const previous = this.authSessions.get(previousSessionId);
    if (!previous || previous.revokedAt || previous.expiresAt <= new Date()) return false;
    previous.revokedAt = new Date();
    this.authSessions.set(input.id, { ...input, audience: input.audience ?? "operator", currentWorkspaceId: input.currentWorkspaceId ?? null });
    return true;
  }

  /* ---------- SPACE-02：会话空间上下文 ---------- */

  /**
   * 内存演示模式没有经营空间（见 requireWorkspaceDataSource 的理由），
   * 因此这些方法在该模式下返回"无空间"，而不是伪造一个。
   * 结果是内存模式下经营接口会被 fail-closed 拒绝——这正是期望行为。
   */
  async listUserWorkspaces(userId: string) {
    if (!this.useMysqlDataSource()) return [];
    return this.platformRepository.listUserWorkspaces(userId);
  }

  /**
   * 解析会话应进入的经营空间。
   *
   * 内存数据源没有 `business_workspaces` 等表，因此返回一个**合成的默认空间 id**，
   * 而不是 undefined。理由：SPACE-03 之后守卫对缺空间的会话 fail-closed，
   * 返回 undefined 会让内存模式的每个会话都无法访问经营接口
   * （`saas-foundation` 测试即因此失败）。
   *
   * 刻意不在守卫里为内存模式开豁免口子：那等于在鉴权路径上留一条
   * 「某个配置值能绕过空间检查」的分支，是 fail-open 的老问题。
   * 这里合成的空间 id 只在内存模式下产生，而内存模式按
   * `docs/数据库启动与初始化.md` 仅用于显式测试，生产一律 mysql。
   */
  async resolveSessionWorkspaceId(userId: string, requested?: string) {
    if (!this.useMysqlDataSource()) {
      // 平台管理租户没有经营品类，不是经营主体，不该有经营空间——
      // 与 mysql 模式一致（它也没有成员关系，解析结果为 undefined）。
      // 给它合成空间会让登录在 getCategoryContext 处 403。
      const user = this.users.find((row) => row.id === userId);
      const tenant = user ? this.tenants.find((row) => row.tenantId === user.tenantId) : undefined;
      if (!tenant?.categoryCode) return undefined;
      return requested ?? MEMORY_MODE_WORKSPACE_ID;
    }
    return this.platformRepository.resolveSessionWorkspaceId(userId, requested);
  }

  async findWorkspaceScopedUser(userId: string, workspaceId?: string, tenantUser?: SystemUserRow) {
    if (!this.useMysqlDataSource()) return tenantUser ?? this.findUserById(userId);
    return this.platformRepository.findWorkspaceScopedUser(userId, workspaceId, tenantUser);
  }

  /**
   * 取某个经营空间的品类与能力。
   *
   * 内存模式没有空间表，此处返回**租户级档案**而不是空对象：调用方
   * （`AuthService.getCategoryContext`）在空间存在而品类缺失时会 fail-closed 拒绝，
   * 返回 `{}` 会让内存模式登录直接 403。内存模式只有一个合成空间
   * （见 `MEMORY_MODE_WORKSPACE_ID`），因此「空间品类 == 租户品类」在该模式下成立。
   */
  async getWorkspaceCategoryContext(tenantId: string, workspaceId: string) {
    if (!this.useMysqlDataSource()) {
      const tenant = await this.findTenantByIdForAuth(tenantId);
      return {
        categoryCode: tenant.categoryCode,
        categoryName: tenant.categoryName,
        capabilities: tenant.capabilities
      };
    }
    return this.platformRepository.getWorkspaceCategoryContext(tenantId, workspaceId);
  }

  async isLegacyVehicleDomainWorkspaceAllowed(tenantId: string, workspaceId: string) {
    if (!this.useMysqlDataSource()) return true;
    return this.platformRepository.isLegacyVehicleDomainWorkspaceAllowed(tenantId, workspaceId);
  }

  async setSessionWorkspace(sessionId: string, workspaceId: string | null, expectedWorkspaceId?: string | null) {
    if (!this.useMysqlDataSource()) {
      const session = this.authSessions.get(sessionId);
      if (!session) return false;
      if (expectedWorkspaceId !== undefined && session.currentWorkspaceId !== expectedWorkspaceId) return false;
      session.currentWorkspaceId = workspaceId;
      return true;
    }
    return this.platformRepository.setSessionWorkspace(sessionId, workspaceId, expectedWorkspaceId);
  }

  getAuthSession(id: string) {
    if (this.useMysqlDataSource()) return this.platformRepository.getAuthSession(id);
    const session = this.authSessions.get(id);
    return session && !session.revokedAt && session.expiresAt > new Date() ? session : undefined;
  }

  getAuthSessionByRefreshHash(refreshTokenHash: string) {
    if (this.useMysqlDataSource()) return this.platformRepository.getAuthSessionByRefreshHash(refreshTokenHash);
    return [...this.authSessions.values()].find((session) =>
      session.refreshTokenHash === refreshTokenHash && !session.revokedAt && session.expiresAt > new Date()
    );
  }

  revokeAuthSession(id: string) {
    if (this.useMysqlDataSource()) return this.platformRepository.revokeAuthSession(id);
    const session = this.authSessions.get(id);
    if (!session || session.revokedAt) return false;
    session.revokedAt = new Date();
    return true;
  }

  revokeUserSessions(userId: string) {
    if (this.useMysqlDataSource()) return this.platformRepository.revokeUserSessions(userId);
    for (const session of this.authSessions.values()) {
      if (session.userId === userId) session.revokedAt = new Date();
    }
  }

  async changeUserPassword(userId: string, currentPassword: string, nextPassword: string) {
    if (this.useMysqlDataSource()) {
      return this.platformRepository.changeUserPassword(userId, currentPassword, nextPassword);
    }
    const user = this.users.find((item) => item.id === userId);
    if (!user || user.password !== currentPassword) throw new BadRequestException("当前密码不正确");
    user.password = nextPassword;
    user.mustChangePassword = false;
    user.needsTenantOnboarding = false;
    await this.revokeUserSessions(userId);
  }

  /** 仅由本机开发环境入口调用；详情与环境限制由 AuthService 负责。 */
  async setLocalDemoAccountPassword(password: string) {
    if (this.useMysqlDataSource()) {
      return this.platformRepository.setLocalDemoAccountPassword(password);
    }
    const accounts = [
      { tenantId: "tenant_001", account: "admin" },
      { tenantId: "tenant_002", account: "admin" },
      { tenantId: "tenant_platform", account: "admin" }
    ];
    const users = accounts.map(({ tenantId, account }) => this.users.find((user) => user.tenantId === tenantId && user.account === account));
    if (users.some((user) => !user)) {
      throw new BadRequestException("本地演示账号尚未初始化，请先完成数据库初始化");
    }
    for (const user of users) {
      user!.password = password;
      user!.mustChangePassword = false;
      await this.revokeUserSessions(user!.id);
    }
  }

  getDefaultAdmin() {
    return this.toUserRow(this.users[0]);
  }

  private getTenantBootstrapTemplates() {
    return [
      {
        code: "fulfillment-location",
        name: "默认履约地点",
        count: 1,
        reusableForGenericRental: false,
        remark: "当前模板保留了车辆专用示例；通用租赁应改为服务点/仓库模板。"
      },
      {
        code: "asset-catalog",
        name: "车辆资产与车型组",
        count: 2,
        reusableForGenericRental: false,
        remark: "汽车租赁专用；通用租赁需替换为资产品类、规格和库存实例。"
      },
      {
        code: "customer",
        name: "个人会员与企业客户",
        count: 2,
        reusableForGenericRental: true,
        remark: "客户底座可复用，等级和证照字段后续按品类调整。"
      },
      {
        code: "demo-order",
        name: "演示租赁订单",
        count: 1,
        reusableForGenericRental: false,
        remark: "用于本地验证订单闭环；通用租赁需替换资产快照字段。"
      }
    ];
  }

  private buildTenantBootstrapExecution() {
    return {
      executionId: `tenant_bootstrap_${randomUUID()}`,
      items: this.getTenantBootstrapTemplates(),
      message: "已执行默认角色、参数、字典、编号和租赁业务基础模板。"
    };
  }

  private buildNumberRule(
    code: string,
    name: string,
    module: string,
    prefix: string,
    datePattern: PlatformNumberRule["datePattern"],
    sequenceLength: number
  ): PlatformNumberRule {
    const rule: PlatformNumberRule = {
      code,
      name,
      module,
      prefix,
      datePattern,
      sequenceLength,
      currentSequence: 0,
      resetCycle: datePattern === "yyyyMMdd" ? "daily" : "monthly",
      enabled: true,
      sample: "",
      updatedAt: "2026-05-05T10:00:00+08:00",
      updatedBy: "系统初始化"
    };
    rule.sample = this.formatNumber(rule, 1);
    return rule;
  }

  private resolvePlatformTenantId(tenantId?: string, user?: SystemUserRow) {
    if (user) {
      return user.isSaasAdmin
        ? tenantId?.trim() || user.tenantId
        : user.tenantId;
    }
    // 未认证调用方必须显式传租户；交给仓储层 requireRequestTenantId 拒绝空值
    return tenantId?.trim();
  }

  private normalizeFilterPresetScope(scopeKey: string): PlatformFilterPresetScope {
    const allowedScopes: PlatformFilterPresetScope[] = [
      "rental-os.orders",
      "rental-os.vehicles",
      "rental-os.members",
      "rental-os.corporates",
      "rental-os.stations",
      "rental-os.vehicle-transfer"
    ];
    if (!allowedScopes.includes(scopeKey as PlatformFilterPresetScope)) {
      throw new BadRequestException("筛选预设范围不支持");
    }
    return scopeKey as PlatformFilterPresetScope;
  }

  private normalizeFilterPresetInput(
    input: SavePlatformFilterPresetRequest,
    user?: SystemUserRow
  ): SavePlatformFilterPresetRequest & {
    tenantId: string;
    scopeKey: PlatformFilterPresetScope;
    operator: string;
  } {
    const scopeKey = this.normalizeFilterPresetScope(input.scopeKey);
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException("筛选预设名称不能为空");
    }
    if (name.length > 40) {
      throw new BadRequestException("筛选预设名称不能超过 40 个字符");
    }
    if (
      !input.filters ||
      typeof input.filters !== "object" ||
      Array.isArray(input.filters)
    ) {
      throw new BadRequestException("筛选条件必须是对象");
    }

    return {
      ...input,
      id: input.id?.trim(),
      tenantId: this.resolvePlatformTenantId(input.tenantId, user) ?? requireRequestTenantId(),
      scopeKey,
      name,
      description: input.description?.trim() || undefined,
      filters: this.clone(input.filters),
      isDefault: Boolean(input.isDefault),
      operator: input.operator?.trim() || user?.displayName || "营运端"
    };
  }

  private validateDictionaryGroup(input: SavePlatformDictionaryGroupRequest) {
    if (!input.code.trim() || !input.name.trim() || !input.module.trim()) {
      throw new BadRequestException("字典编码、名称和归属模块不能为空");
    }
    if (input.items.length === 0) {
      throw new BadRequestException("数据字典至少保留一个字典项");
    }
    this.normalizeDictionaryItems(input.items);
  }

  private normalizeDictionaryItems(items: PlatformDictionaryItem[]) {
    const codes = new Set<string>();
    return items
      .map((item) => ({
        code: item.code.trim(),
        label: item.label.trim(),
        value: item.value.trim(),
        sortNo: Number(item.sortNo),
        enabled: Boolean(item.enabled),
        remark: item.remark?.trim()
      }))
      .sort((left, right) => left.sortNo - right.sortNo)
      .map((item) => {
        if (!item.code || !item.label || !item.value) {
          throw new BadRequestException("字典项编码、显示名称和值不能为空");
        }
        if (!Number.isFinite(item.sortNo)) {
          throw new BadRequestException("字典项排序必须是数字");
        }
        if (codes.has(item.code)) {
          throw new BadRequestException("字典项编码不能重复");
        }
        codes.add(item.code);
        return item;
      });
  }

  private validateNumberRule(input: SavePlatformNumberRuleRequest) {
    if (!input.code.trim() || !input.name.trim() || !input.module.trim()) {
      throw new BadRequestException("编号规则编码、名称和归属模块不能为空");
    }
    if (!input.prefix.trim()) {
      throw new BadRequestException("编号前缀不能为空");
    }
    if (!Number.isInteger(input.sequenceLength) || input.sequenceLength < 3 || input.sequenceLength > 12) {
      throw new BadRequestException("流水号长度必须是 3 到 12 位整数");
    }
    if (input.currentSequence !== undefined && input.currentSequence < 0) {
      throw new BadRequestException("当前流水不能为负数");
    }
  }

  private formatNumber(rule: PlatformNumberRule, sequence: number) {
    const parts = [rule.prefix];
    const datePart = this.formatDatePart(rule.datePattern);
    if (datePart) {
      parts.push(datePart);
    }
    parts.push(String(sequence).padStart(rule.sequenceLength, "0"));
    return parts.join("-");
  }

  private formatDatePart(pattern: PlatformNumberRule["datePattern"]) {
    if (pattern === "none") {
      return "";
    }
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const yy = yyyy.slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    if (pattern === "yyyyMMdd") {
      return `${yyyy}${mm}${dd}`;
    }
    if (pattern === "yyyyMM") {
      return `${yyyy}${mm}`;
    }
    return `${yy}${mm}${dd}`;
  }

  private recordMemoryAudit(input: Omit<PlatformAuditLogRow, "id" | "createdAt">) {
    this.auditLogs.unshift({
      ...input,
      id: `audit_${randomUUID()}`,
      createdAt: new Date().toISOString()
    });
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private useMysqlDataSource() {
    return (
      this.configService.get<string>("PLATFORM_DATA_SOURCE") ?? "mysql"
    ).toLowerCase() === "mysql";
  }

  private assertSaasAdmin(user?: SystemUserRow) {
    if (!user?.isSaasAdmin) {
      throw new ForbiddenException("仅 SaaS 平台管理员可以管理租户");
    }
  }

  /** Guard 只能按路径放行候选权限；具体目标状态必须在服务层再次授权。 */
  private assertCustomerActionPermission(user: SystemUserRow | undefined, permission: string, action: string) {
    const allowed = Boolean(
      user && (user.isPlatformAdmin || user.permissions.includes("*") || user.permissions.includes(permission))
    );
    if (!allowed) throw new ForbiddenException(`${action}需要权限：${permission}`);
  }

  private resolveTargetTenantId(requestedTenantId: string | undefined, user?: SystemUserRow) {
    if (!user) throw new ForbiddenException("缺少登录用户上下文");
    if (user.isSaasAdmin) {
      if (!requestedTenantId) throw new BadRequestException("SaaS 平台操作必须明确目标租户");
      return requestedTenantId;
    }
    if (requestedTenantId && requestedTenantId !== user.tenantId) {
      throw new ForbiddenException("不能访问或修改其他租户的数据");
    }
    return user.tenantId;
  }

  private cloneSystemRulesConfig(
    config: SystemRulesConfig = this.systemRulesConfig
  ): SystemRulesConfig {
    const cloned = JSON.parse(JSON.stringify(config)) as SystemRulesConfig;
    cloned.security = this.normalizeSecurityBaseline(cloned.security);
    return cloned;
  }

  private isButtonPermission(permission: string) {
    return (
      permission.includes(":button:") ||
      [
        "rental-os:order:create",
        "rental-os:order:pickup",
        "rental-os:order:return",
        "rental-os:order:extend",
        "rental-os:order:cancel",
        "rental-os:order:close",
        "rental-os:order:fee-manage",
        "rental-os:member:risk-action",
        "rental-os:corporate:monthly-settle",
        "rental-os:finance:adjust",
        "rental-os:finance:invoice",
        "system:button:export"
      ].includes(permission)
    );
  }

  private defaultDataScope(scope: RoleScope) {
    if (scope === RoleScope.Operator) {
      return "organization" as const;
    }
    if (scope === RoleScope.Store || scope === RoleScope.Station) {
      return "store" as const;
    }
    return "organization" as const;
  }

  private resolveUserDataScope(roleRows: SystemRoleRow[]) {
    const order = ["own", "store", "organization", "all"];
    const scope = roleRows
      .map((role) => role.dataScope)
      .sort((left, right) => order.indexOf(right) - order.indexOf(left))[0];

    return scope ?? "own";
  }

  private defaultSecurityBaseline(): SystemSecurityBaselineConfig {
    return {
      loginRateLimit: {
        enabled: true,
        maxFailures: 5,
        windowMinutes: 10,
        lockMinutes: 15
      },
      passwordPolicy: {
        minLength: 8,
        requireLetter: true,
        requireNumber: true,
        disallowDefaultPassword: true,
        expireDays: 90
      },
      masking: {
        phone: true,
        identityNo: true,
        driverLicenseNo: true,
        email: false,
        apiKey: true
      },
      secondConfirmation: {
        enabled: true,
        actions: [
          "system.user.reset-password",
          "system.role.delete",
          "rental-os.order.close",
          "rental-os.fee.waive",
          "rental-os.vehicle.disable"
        ]
      }
    };
  }

  private normalizeSecurityBaseline(
    input?: Partial<SystemSecurityBaselineConfig>
  ): SystemSecurityBaselineConfig {
    const defaults = this.defaultSecurityBaseline();
    return {
      loginRateLimit: {
        ...defaults.loginRateLimit,
        ...(input?.loginRateLimit ?? {})
      },
      passwordPolicy: {
        ...defaults.passwordPolicy,
        ...(input?.passwordPolicy ?? {})
      },
      masking: {
        ...defaults.masking,
        ...(input?.masking ?? {})
      },
      secondConfirmation: {
        ...defaults.secondConfirmation,
        ...(input?.secondConfirmation ?? {}),
        actions:
          input?.secondConfirmation?.actions ??
          defaults.secondConfirmation.actions
      }
    };
  }

  private validateSystemRulesConfig(config: SystemRulesConfig) {
    const security = this.normalizeSecurityBaseline(config.security);
    const numbers = [
      config.member.welcomeGift.amount,
      config.member.welcomeGift.validity,
      config.member.referralGift.amount,
      config.member.referralGift.validity,
      config.fleet.maintenance.thresholdMileage,
      config.fleet.maintenance.thresholdMonths,
      config.fleet.maintenance.advanceKm,
      config.fleet.maintenance.advanceDays,
      config.fleet.cleaning.thresholdCount,
      config.fleet.cleaning.thresholdDays,
      config.fleet.cleaning.advanceCount,
      config.fleet.cleaning.advanceDays,
      security.loginRateLimit.maxFailures,
      security.loginRateLimit.windowMinutes,
      security.loginRateLimit.lockMinutes,
      security.passwordPolicy.minLength,
      security.passwordPolicy.expireDays
    ];
    if (numbers.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new BadRequestException("系统参数中的数字配置不能为负数");
    }
    if (
      config.calendar.specialDates.some(
        (item) => !item.name.trim() || !item.range[0] || !item.range[1]
      )
    ) {
      throw new BadRequestException("特殊日期必须填写日期范围和备注说明");
    }
    if (
      config.push.list.some(
        (item) =>
          !item.title.trim() ||
          !item.content.trim() ||
          !item.trigger.trim() ||
          item.channels.length === 0
      )
    ) {
      throw new BadRequestException("推送规则必须填写标题、内容、触发时机和至少一个渠道");
    }
    if (
      config.aiModel.enabled &&
      (!config.aiModel.modelName.trim() ||
        (config.aiModel.provider === "OPENAI_COMPATIBLE" &&
          !config.aiModel.baseUrl?.trim()))
    ) {
      throw new BadRequestException("启用 AI 模型时必须填写模型名称，兼容模式还必须填写 Base URL");
    }
  }

  private rentalCategoryName(categoryCode: RentalCategoryCode) {
    return RENTAL_CATEGORY_DEFINITIONS.find((category) => category.code === categoryCode)?.name ?? categoryCode;
  }

  private toUserRow(user: StoredUser): SystemUserRow {
    const organization = this.organizations.find(
      (item) => item.id === user.organizationId
    );
    const roleRows = this.roleRows.filter((role) => user.roleIds.includes(role.id));
    const activeRoleRows = roleRows.filter((role) => role.isActive);
    const isPlatformAdmin =
      Boolean(user.isPlatformAdmin) ||
      roleRows.some((role) => role.fixedAllPermissions);
    const permissions = isPlatformAdmin
      ? ["*"]
      : [
          ...new Set(
            activeRoleRows.flatMap((role) => [
              ...role.permissions,
              ...(role.buttonPermissions ?? [])
            ])
          )
        ];

    return {
      id: user.id,
      tenantId: user.tenantId,
      account: user.account,
      displayName: user.displayName,
      phone: user.phone,
      organizationId: user.organizationId,
      organizationName: organization?.name,
      roleIds: user.roleIds,
      roleNames: roleRows.map((role) =>
        role.isActive ? role.name : `${role.name}（停用）`
      ),
      scope: roleRows[0]?.scope ?? organization?.type ?? RoleScope.Operator,
      isPlatformAdmin,
      isSaasAdmin: Boolean(user.isSaasAdmin),
      mustChangePassword: Boolean(user.mustChangePassword),
      isActive: user.isActive,
      permissions,
      dataScope: isPlatformAdmin ? "all" : this.resolveUserDataScope(activeRoleRows)
    };
  }
}
