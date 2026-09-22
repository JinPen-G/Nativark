import { themeBehavior } from "../../core/theme-behavior";
import type { ClientMembershipAssignmentView, CustomerMembershipBenefit } from "@rental-os/shared";
import { fetchMembershipAssignments, fetchMembershipBenefits } from "../../api/profile";
import { categoryLabel, membershipLabel } from "../../core/labels";
import { formatMoney } from "../../core/money";
import { errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { currentService, membershipStatus } from "../../core/session";
import { formatBusinessDate } from "../../core/time";
import { ROUTES, requireSignIn } from "../../core/ui";
import { ensureCurrentZone, zoneOf } from "../../core/zones";
import { currentServiceCode } from "../../core/session";

/**
 * P16 我的会员权益（需求 §11.3）：当前方案名称、有效期、会员状态；逐条权益的计算说明、适用范围、
 * 在当前服务是否适用及原因。只展示已授予事实，不提供购买/升级入口；非金额权益标“暂未生效”。
 */
interface BenefitRow {
  key: string;
  title: string;
  calculation: string;
  scope: string;
  applicableLabel: string;
  applicableTone: string;
  reason: string;
}

interface BenefitsData {
  view: ViewState;
  serviceName: string;
  membershipLabel: string;
  membershipTone: string;
  planName: string;
  planPeriod: string;
  planSource: string;
  benefits: BenefitRow[];
  history: Array<{ id: string; planName: string; status: string; period: string }>;
  hasPlan: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  rental_discount: "租金优惠",
  deposit_reduction: "押金减免",
  preauth_reduction: "预授权减免",
  service_benefit: "服务优惠",
  priority_reservation: "优先预约",
  quote_validity_extension: "报价有效期延长"
};

const MONEY_TYPES = new Set(["rental_discount", "deposit_reduction", "preauth_reduction", "service_benefit"]);

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState(), serviceName: "", membershipLabel: "", membershipTone: "neutral", planName: "", planPeriod: "", planSource: "", benefits: [], history: [], hasPlan: false } as BenefitsData,

  onLoad() {
    if (!requireSignIn(ROUTES.benefits)) return;
  },

  onShow() {
    void this.load();
  },

  async load() {
    const service = currentService();
    const status = membershipStatus() ?? "";
    this.setData({ serviceName: service?.name ?? "", membershipLabel: membershipLabel(status), membershipTone: status === "active" ? "success" : status === "pending_activation" ? "warning" : "danger" });
    try {
      const [benefits, assignments] = await Promise.all([fetchMembershipBenefits(), fetchMembershipAssignments(), ensureCurrentZone()]);
      this.render(benefits.personal, assignments.items, service?.categoryCode ?? "");
    } catch (error) {
      this.setData({ view: errorState(error) });
    }
  },

  render(personal: ClientMembershipAssignmentView | undefined, assignments: ClientMembershipAssignmentView[], categoryCode: string) {
    const zone = zoneOf(currentServiceCode()) ?? "Asia/Shanghai";
    // 金额权益的币种以经营空间结算币种为准；客户端权益接口不带币种，这里只标注单位而不臆造币种符号。
    const amountText = (value: number) => formatMoney(value, undefined, { missing: "" }).replace("（币种待确认）", "（按服务结算币种）");
    const scopeText = (benefit: CustomerMembershipBenefit): { text: string; applicable: boolean | undefined; reason: string } => {
      const scope = benefit.scope;
      if (!scope || scope.type === "tenant") return { text: "全部服务", applicable: true, reason: "" };
      if (scope.type === "categories") {
        const names = scope.categoryCodes.map(categoryLabel).join("、");
        const applicable = scope.categoryCodes.includes(categoryCode as never);
        return { text: `仅 ${names}`, applicable, reason: applicable ? "" : `当前服务（${categoryLabel(categoryCode)}）不在适用品类内` };
      }
      // 权益按空间 ID 声明；客户端只有空间编码，无法逐一对应：不断言适用与否，以报价时的实际结果为准。
      return { text: `指定 ${scope.workspaceIds.length} 个服务`, applicable: undefined, reason: "是否适用于当前服务以报价时的实际结果为准" };
    };
    const benefits: BenefitRow[] = (personal?.benefits ?? []).map((benefit, index) => {
      const scope = scopeText(benefit);
      const money = MONEY_TYPES.has(benefit.type);
      const calculation = benefit.calculation === "percentage"
        ? `减免 ${benefit.value}%${benefit.maximum ? `，最高 ${amountText(benefit.maximum)}` : ""}`
        : benefit.calculation === "amount"
          ? `减免固定金额 ${amountText(benefit.value)}${benefit.maximum ? `，最高 ${amountText(benefit.maximum)}` : ""}`
          : benefit.calculation === "quota" ? `额度 ${benefit.value}` : "优先级权益";
      return {
        key: `${benefit.type}-${index}`,
        title: TYPE_LABELS[benefit.type] ?? benefit.type,
        calculation,
        scope: scope.text,
        applicableLabel: !money ? "暂未生效" : scope.applicable === undefined ? "以报价为准" : scope.applicable ? "当前服务适用" : "当前服务不适用",
        applicableTone: !money ? "neutral" : scope.applicable === undefined ? "info" : scope.applicable ? "success" : "neutral",
        reason: !money ? "暂未生效：该类权益尚未接入执行流程" : scope.reason
      };
    });
    this.setData({
      view: readyState(),
      hasPlan: Boolean(personal),
      planName: personal?.planName ?? "",
      planPeriod: personal ? `${formatBusinessDate(personal.effectiveFrom, zone)} 起${personal.effectiveTo ? `，至 ${formatBusinessDate(personal.effectiveTo, zone)}` : "，长期有效"}` : "",
      planSource: personal?.source === "manual" ? "商户授予" : personal?.source === "system" ? "系统授予" : personal?.source ?? "",
      benefits,
      history: assignments.map((row) => ({ id: row.id, planName: row.planName, status: row.status === "active" ? "生效中" : row.status === "expired" ? "已到期" : row.status === "revoked" ? "已撤销" : row.status, period: `${formatBusinessDate(row.effectiveFrom, zone)}${row.effectiveTo ? ` 至 ${formatBusinessDate(row.effectiveTo, zone)}` : " 起"}` }))
    });
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.benefits })) return;
    void this.load();
  }
});
