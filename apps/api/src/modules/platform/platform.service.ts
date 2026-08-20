import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { requireRequestTenantId } from "../../common/request-identity";
import {
  RENTAL_CATEGORY_DEFINITIONS,
  CreateBusinessWorkspaceRequest,
  SaveWorkspaceMemberRequest,
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
} from "@store-rental/shared";
import {
  buildOrganizationWhere,
  buildSystemUserWhere,
  describeDataPermission
} from "../../common/data-permission";
import { PlatformRepository } from "./platform.repository";
import { RentalCoreService } from "../rental-core/rental-core.service";

interface StoredUser extends SaveSystemUserRequest {
  id: string;
  password: string;
  mustChangePassword?: boolean;
}

// 平台主体租户：平台级配置（登录安全基线等）的读写与审计范围，区别于业务租户和演示租户
const PLATFORM_SUBJECT_TENANT_ID = "tenant_platform";

@Injectable()
export class PlatformService {
  constructor(
    private readonly configService: ConfigService,
    private readonly platformRepository: PlatformRepository,
    @Optional() private readonly rentalCoreService?: RentalCoreService
  ) {}

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
      enabledBusinessLines: ["rental_core", "store_rental"],
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
      name: "旺角门市",
      status: "enabled"
    },
    {
      id: "org_store_central",
      tenantId: "tenant_001",
      parentId: "org_operator_hk",
      type: RoleScope.Store,
      code: "STORE-CENTRAL",
      name: "中环门市",
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
      code: "store-rental",
      name: "门市租赁",
      children: [
        { code: "store-rental:rules:manage", name: "业务规则配置" },
        { code: "store-rental:order:view", name: "订单查看", description: "查看门市订单列表和详情" },
        { code: "store-rental:order:operate", name: "订单操作", description: "新建订单、取车验车、还车验车" },
        { code: "store-rental:order:settle", name: "订单结算", description: "确认费用、补缴、退款或月结入账" },
        { code: "store-rental:order:create", name: "按钮-新建订单", description: "显示并执行新建门市订单入口" },
        { code: "store-rental:order:pickup", name: "按钮-取车交付", description: "执行开始取车和确认发车" },
        { code: "store-rental:order:return", name: "按钮-还车验车", description: "执行还车验车和提交结算" },
        { code: "store-rental:order:extend", name: "按钮-延长用车", description: "执行延长用车和逾期补办续租" },
        { code: "store-rental:order:cancel", name: "按钮-取消/爽约", description: "执行取消订单和标记爽约" },
        { code: "store-rental:order:close", name: "按钮-关闭/拒绝履约", description: "执行关闭订单和拒绝履约" },
        { code: "store-rental:order:fee-manage", name: "按钮-费用处理", description: "登记订单费用、收款、退款和减免" },
        { code: "store-rental:dispatch:manage", name: "调度管理" },
        { code: "store-rental:price:manage", name: "价格规则" },
        { code: "store-rental:marketing:manage", name: "行销方案管理" },
        { code: "store-rental:station:view", name: "站点查看" },
        { code: "store-rental:station:manage", name: "站点管理" },
        { code: "store-rental:vehicle-group:manage", name: "车型组管理" },
        { code: "store-rental:vehicle:view", name: "车辆查看" },
        { code: "store-rental:vehicle:manage", name: "车辆管理" },
        { code: "store-rental:vehicle:status-action", name: "按钮-车辆状态动作", description: "启停、维保、事故和状态处置" },
        { code: "store-rental:member:view", name: "会员查看" },
        { code: "store-rental:member:manage", name: "会员管理" },
        { code: "store-rental:member:risk-action", name: "按钮-会员风控动作", description: "暂停、拉黑和恢复会员" },
        { code: "store-rental:corporate:view", name: "企业客户查看" },
        { code: "store-rental:corporate:manage", name: "企业客户管理" },
        { code: "store-rental:corporate:monthly-settle", name: "按钮-企业月结回款", description: "登记企业账单回款" },
        { code: "store-rental:finance:view", name: "财务查看", description: "查看资金流水、发票收据、调账和对账" },
        { code: "store-rental:finance:manage", name: "财务管理", description: "维护财务单据和处理资金状态" },
        { code: "store-rental:finance:adjust", name: "按钮-手工调账", description: "提交、审核和入账手工调账" },
        { code: "store-rental:finance:invoice", name: "按钮-发票/收据", description: "开具、发送和作废发票收据" },
        { code: "store-rental:finance:reconcile", name: "财务对账", description: "查看和处理资金、月结、调账异常" },
        { code: "store-rental:service:manage", name: "增值服务管理" },
        { code: "store-rental:report:view", name: "报表查看" }
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
      description: "门店前台和门店值班人员处理订单、取还车和基础车辆查看。",
      scope: RoleScope.Store,
      fixedAllPermissions: false,
      enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H"],
      isActive: true,
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
      dataScope: "store"
    },
    {
      id: "role_pricing_manager",
      tenantId: "tenant_001",
      code: "PRICING_MANAGER",
      name: "价格规则管理员",
      description: "维护门市租赁价格、规则和增值服务配置。",
      scope: RoleScope.Operator,
      fixedAllPermissions: false,
      enabledBusinessScopes: ["STORE_STANDARD", "SYSTEM_GLOBAL"],
      isActive: true,
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
      description: "门店前台和门店值班人员处理订单、取还与基础资产查看。",
      scope: RoleScope.Store,
      fixedAllPermissions: false,
      enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H"],
      isActive: true,
      permissions: [
        "store-rental:order:view",
        "store-rental:order:operate",
        "store-rental:station:view",
        "store-rental:vehicle:view"
      ],
      buttonPermissions: [
        "store-rental:order:create",
        "store-rental:order:pickup",
        "store-rental:order:return"
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
          content: "尊敬的{用户}，您的订单{订单号}已经确认，请准时取车。",
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
      promptVersion: "store-rental-dispatch-agent-v1",
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
          promptVersion: "store-rental-dispatch-agent-v1",
          promptHash: "sha256:8c21...f09a",
          filteredCount: 5,
          status: "成功",
          promptText:
            "你是 Store Rental Platform 门市租赁 AI 调度分析 Agent。\n你的职责是帮助调度员分析车辆排程风险，并在系统合法候选车辆范围内生成推荐。",
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
          promptVersion: "store-rental-dispatch-agent-v1",
          promptHash: "sha256:7f18...a921",
          filteredCount: 5,
          status: "成功",
          promptText:
            "你是 Store Rental Platform 门市租赁 AI 调度分析 Agent。\n必须遵守系统硬约束，不得直接修改订单、车辆或排程。",
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
      detail: "写入门市租赁系统通用参数默认值。",
      createdAt: "2026-05-05T10:30:00+08:00"
    }
  ];

  private filterPresets: PlatformFilterPreset[] = [];

  private dictionaryGroups: PlatformDictionaryGroup[] = [
    {
      code: "order_main_status",
      name: "订单主状态",
      module: "门市租赁",
      description: "门市租赁订单列表、详情和审计中心统一展示主状态。",
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
    this.buildNumberRule("STORE_ORDER", "门市订单号", "订单中心", "SO", "yyyyMMdd", 6),
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
    const rows = this.auditLogs
      .filter((log) => !scopedQuery.tenantId || log.tenantId === scopedQuery.tenantId)
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
            "store-rental:order:view",
            "store-rental:order:operate",
            "store-rental:vehicle:view"
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
          await this.rentalCoreService?.initializeTenant(tenantId, input.categoryCode, tx);
        }
      );
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
        name: input.storeName?.trim() || `${tenantName}门市`,
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

    await this.rentalCoreService?.initializeTenant(tenantId, input.categoryCode);
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

  createBusinessWorkspace(input: CreateBusinessWorkspaceRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.platformRepository.createBusinessWorkspace(input, currentUser);
  }

  updateBusinessWorkspace(id: string, input: UpdateBusinessWorkspaceRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.platformRepository.updateBusinessWorkspace(id, input, currentUser);
  }

  listWorkspaceMembers(workspaceId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.platformRepository.listWorkspaceMembers(workspaceId, currentUser);
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

    return user
      ? {
          tenant,
          user: this.toUserRow(user)
        }
      : undefined;
  }

  async findUserById(id: string) {
    if (this.useMysqlDataSource()) return this.platformRepository.findUserById(id);
    const user = this.users.find((item) => item.id === id && item.isActive);
    const tenant = this.tenants.find((item) => item.tenantId === user?.tenantId);
    return user && tenant?.tenantStatus === TenantStatus.Active ? this.toUserRow(user) : undefined;
  }

  createAuthSession(input: { id: string; userId: string; refreshTokenHash: string; expiresAt: Date; currentWorkspaceId?: string | null }) {
    if (this.useMysqlDataSource()) return this.platformRepository.createAuthSession(input);
    this.authSessions.set(input.id, { ...input });
    return input;
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

  async resolveSessionWorkspaceId(userId: string, requested?: string) {
    if (!this.useMysqlDataSource()) return undefined;
    return this.platformRepository.resolveSessionWorkspaceId(userId, requested);
  }

  async findWorkspaceScopedUser(userId: string, workspaceId?: string) {
    if (!this.useMysqlDataSource()) return this.findUserById(userId);
    return this.platformRepository.findWorkspaceScopedUser(userId, workspaceId);
  }

  async setSessionWorkspace(sessionId: string, workspaceId: string | null) {
    if (!this.useMysqlDataSource()) return;
    await this.platformRepository.setSessionWorkspace(sessionId, workspaceId);
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
    if (session) session.revokedAt = new Date();
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
    await this.revokeUserSessions(userId);
  }

  getDefaultAdmin() {
    return this.toUserRow(this.users[0]);
  }

  private getTenantBootstrapTemplates() {
    return [
      {
        code: "store-station",
        name: "默认门市与站点",
        count: 1,
        reusableForGenericRental: false,
        remark: "当前绑定门市租车；通用租赁应改为服务点/仓库模板。"
      },
      {
        code: "asset-vehicle",
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
        name: "演示门市租赁订单",
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
      message: "已执行默认角色、参数、字典、编号和门市租赁基础模板。"
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
      "store-rental.orders",
      "store-rental.vehicles",
      "store-rental.members",
      "store-rental.corporates",
      "store-rental.stations",
      "store-rental.vehicle-transfer"
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
        "store-rental:order:create",
        "store-rental:order:pickup",
        "store-rental:order:return",
        "store-rental:order:extend",
        "store-rental:order:cancel",
        "store-rental:order:close",
        "store-rental:order:fee-manage",
        "store-rental:vehicle:status-action",
        "store-rental:member:risk-action",
        "store-rental:corporate:monthly-settle",
        "store-rental:finance:adjust",
        "store-rental:finance:invoice",
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
          "store-rental.order.close",
          "store-rental.fee.waive",
          "store-rental.vehicle.disable"
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
    const names: Record<RentalCategoryCode, string> = {
      [RentalCategoryCode.Vehicle]: "车辆载具",
      [RentalCategoryCode.Camera]: "摄影设备",
      [RentalCategoryCode.Camping]: "露营设备",
      [RentalCategoryCode.Construction]: "工程设备"
    };
    return names[categoryCode];
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
