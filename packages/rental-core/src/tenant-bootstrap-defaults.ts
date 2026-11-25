/** 原租赁租户的兼容缺省数据，旧服务与独立宿主共用。
 * 仅用于首次初始化；不覆盖既有配置，不把历史AI展示记录作为Gateway或预算事实。 */
import type { PlatformDictionaryGroup, PlatformNumberRule } from "@rental-os/platform-contracts";
import { defaultSecurityBaseline } from "@rental-os/platform-server/security";
import { formatPlatformNumber } from "@rental-os/platform-server/tools";
import type { SystemRulesConfig, TenantBootstrapPreview } from "./tenant-bootstrap-contracts";

export function createRentalBootstrapSystemRules(): SystemRulesConfig { return {
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
    security: defaultSecurityBaseline(),
    updatedAt: "2026-05-05T10:30:00+08:00",
    updatedBy: "系统初始化"
  }; }

export function createRentalBootstrapDictionaries(): PlatformDictionaryGroup[] { return [
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
  ]; }

function buildBootstrapNumberRule(
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
    rule.sample = formatPlatformNumber(rule, 1);
    return rule;
  }

export function createRentalBootstrapNumberRules(): PlatformNumberRule[] { return [
    buildBootstrapNumberRule("STORE_ORDER", "租赁订单号", "订单中心", "SO", "yyyyMMdd", 6),
    buildBootstrapNumberRule("CONTRACT", "合同编号", "合同单据", "CT", "yyyyMM", 5),
    buildBootstrapNumberRule("ACCIDENT_REPORT", "事故报案号", "事故出险", "AC", "yyyyMMdd", 4),
    buildBootstrapNumberRule("CUSTOMER", "客户编号", "客户运营", "CU", "yyyyMM", 5),
    buildBootstrapNumberRule("VEHICLE_LICENSE", "车辆证照编号", "车辆资产", "VL", "yyyyMM", 4)
  ]; }

export function createRentalTenantBootstrapSeed() {
  return { systemRules: createRentalBootstrapSystemRules(), dictionaries: createRentalBootstrapDictionaries(), numberRules: createRentalBootstrapNumberRules() };
}

export function createRentalTenantBootstrapPreview(seed: Pick<ReturnType<typeof createRentalTenantBootstrapSeed>, "dictionaries" | "numberRules">): TenantBootstrapPreview {
  return { roles: [{ code: "TENANT_ADMIN", name: "租户管理员", permissions: ["*"] },
    { code: "STORE_OPERATOR", name: "门店营运", permissions: ["rental-os:order:view", "rental-os:order:operate", "rental-core:asset:view"] }],
    dictionaries: seed.dictionaries.map(item => item.code), numberRules: seed.numberRules.map(item => item.code), systemRules: ["system-rules"] };
}
