import type { AnimatedIconName } from "@/components/ui/AnimatedIcon";

export type ResultKind = "brief" | "quote" | "tasks" | "schedule" | "inventory" | "customer" | "comparison" | "ledger" | "document" | "trend";
export interface OperatorCapability { id: string; name: string; icon: AnimatedIconName; route: string; description: string; prompt: string; result: ResultKind; action?: string }
/** Candidate UI catalog, not a claim that a backend capability has shipped. */
export const OPERATOR_CAPABILITIES: OperatorCapability[] = [
  { id: "brief", name: "经营简报", icon: "dashboard", route: "/workbench", description: "抓住经营重点与今日待办", prompt: "整理今天的经营简报，优先告诉我需要关注的事项", result: "brief" },
  { id: "booking", name: "预约库存", icon: "inventory", route: "/rental/orders", description: "查档期、整理资源与报价草稿", prompt: "为周末两套设备整理预约资料和报价草稿", result: "quote", action: "确认预约草稿" },
  { id: "orders", name: "订单履约", icon: "orders", route: "/rental/orders", description: "准备交付、归还与交接清单", prompt: "整理今日待交付订单，生成交接清单", result: "tasks", action: "确认履约安排" },
  { id: "team", name: "门店协同", icon: "customers", route: "/rental/locations", description: "梳理门店任务与负责人分工", prompt: "安排周末两家门店的交付和归还分工", result: "schedule", action: "确认分工草稿" },
  { id: "assets", name: "资产养护", icon: "inventory", route: "/rental/assets", description: "关注养护、库存与资产异常", prompt: "检查设备养护优先级，列出需要处理的事项", result: "inventory" },
  { id: "members", name: "客户会员", icon: "customers", route: "/membership/personal", description: "整理客户资料、审核与权益", prompt: "汇总待审核会员，整理需要补充的资料", result: "customer" },
  { id: "pricing", name: "定价营销", icon: "pricing", route: "/rental/pricing-groups", description: "比较价格方案，准备活动建议", prompt: "比较周末租赁优惠方案，给出简短建议", result: "comparison" },
  { id: "finance", name: "财务结算", icon: "finance", route: "/rental/payment-reconciliation", description: "核对收款、保证金与对账差异", prompt: "整理本周待核对的收款和保证金事项", result: "ledger" },
  { id: "guide", name: "规则资料", icon: "folder", route: "/rental/settings", description: "解释业务规则，整理操作资料", prompt: "说明订单从预约到归还的操作步骤", result: "document" },
  { id: "review", name: "经营复盘", icon: "report", route: "/reports/operations", description: "看清趋势与变化，形成复盘", prompt: "整理本周经营复盘，用趋势和待办来展示", result: "trend" },
];
export interface OperatorArtifact { kind: ResultKind; title: string; summary: string; columns: string[]; rows: string[][]; metrics?: { label: string; value: string; note?: string }[]; note: string }
/** Every value below is illustrative; never merge these into business query caches. */
export function exampleArtifact(capability: OperatorCapability): OperatorArtifact {
  const common = { kind: capability.result, title: `${capability.name} · 工作成果`, note: "示例数据，仅用于界面演示；不代表当前经营情况。" };
  switch (capability.result) {
    case "quote": return { ...common, title: "周末预约与报价", summary: "两套设备的资源、租期与费用已整理，正式报价以后端结果为准。", columns: ["项目", "说明", "示例金额"], rows: [["租金", "2套 × 2天", "¥1,200"], ["可退押金", "与租金分开管理", "¥2,000"]], metrics: [{ label: "示例待支付", value: "¥3,200", note: "租金与押金合计" }] };
    case "tasks": return { ...common, title: "今日交接清单", summary: "按交付时间排序，实际交付仍需门店核验。", columns: ["任务", "负责人", "时间"], rows: [["DEMO-018 · 设备自提", "门店A · 小林", "09:30"], ["DEMO-019 · 设备配送", "门店B · 小周", "11:00"], ["配件与状态核验", "门店A · 小林", "交付前"]] };
    case "schedule": return { ...common, title: "周末门店协同", summary: "交付、归还和验收分别安排负责人，保留任务关联。", columns: ["安排", "负责人", "计划时间"], rows: [["门店A · 设备交付", "小林", "周六 09:00"], ["门店B · 归还接收", "小周", "周日 16:00"], ["归还后验收", "小陈", "归还后"]] };
    case "inventory": return { ...common, title: "资产关注清单", summary: "先处理影响履约的养护与可用性问题。", columns: ["资产", "关注事项", "优先级"], rows: [["DEMO-CAM-01", "例行养护即将到期", "较高"], ["DEMO-KIT-02", "配件清点", "常规"], ["DEMO-LENS-03", "归还后状态检查", "常规"]] };
    case "customer": return { ...common, title: "会员资料待办", summary: "只整理核验事项，不自动通过审核。", columns: ["示例会员", "待办", "建议"], rows: [["客户A", "资格资料未齐", "补充资料"], ["客户B", "证件即将到期", "提醒更新"]] };
    case "comparison": return { ...common, title: "周末优惠比较", summary: "比较示例场景，发布前仍需确认适用范围与叠加规则。", columns: ["方案", "适用场景", "关注点"], rows: [["长租优惠", "连续租用", "核对起租天数"], ["会员权益", "已开通会员", "核对权益范围"], ["优惠券", "指定活动", "核对门槛与叠加"]] };
    case "ledger": return { ...common, title: "资金核对事项", summary: "租金、押金与预授权分别核对，缺失记录不按零处理。", columns: ["事项", "类别", "处理建议"], rows: [["DEMO-018", "收款待核对", "匹配原收款记录"], ["DEMO-019", "押金待处理", "核实归还与验收"], ["DEMO-020", "预授权待核对", "查看原授权结果"]] };
    case "document": return { ...common, title: "订单操作指引", summary: "从预约到归还，按业务阶段完成核验。", columns: ["阶段", "需要确认"], rows: [["预约", "客户、租期、资源与服务端报价"], ["交付", "设备、配件、资格与交接"], ["归还", "状态、使用量与验收"], ["结算", "费用、收款、押金与预授权分别核对"]] };
    case "trend": return { ...common, title: "每周经营复盘", summary: "用趋势识别变化，再形成可执行的经营待办。", columns: ["维度", "示例观察", "后续行动"], rows: [["预订", "周末需求集中", "提前核对资源"], ["履约", "交付时间相邻", "准备交接分工"], ["资金", "有待核对事项", "逐笔匹配原记录"]], metrics: [{ label: "示例订单量", value: "24", note: "本周演示" }, { label: "示例上周", value: "19", note: "仅用于趋势展示" }] };
    default: return { ...common, title: "今日经营简报", summary: "先看待办，再看经营摘要；以下均为演示信息。", columns: ["重点", "建议"], rows: [["今日交付", "提前检查设备与配件"], ["待归还", "跟进时间与接收门店"], ["资金核对", "逐笔核实待办，不自动处理"]], metrics: [{ label: "示例待交付", value: "3" }, { label: "示例待归还", value: "2" }, { label: "示例待核对", value: "1" }] };
  }
}
