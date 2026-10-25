/** Member plan cards describe the configured version and benefits; no subscription price or member count is fabricated. */
import { Check, Sparkles, Clock3 } from "lucide-react";
import dayjs from "dayjs";
import type { CustomerMembershipBenefit, CustomerMembershipPlan, CustomerMembershipScopeOptions } from "@rental-os/shared";
import type { ListCard } from "@/components/ui";
import { Button } from "@/registry/components/button/button";
import { CardBadge, CardFacts, CardFootnote, CardHighlights, CardList, CardMetric, CardSecondary, CardSection } from "@/components/ui/data-table/RecordCard";

type Translate = (key: string) => string;
const benefitLabels: Record<string, string> = { rental_discount: "租金优惠", deposit_reduction: "押金减免", preauth_reduction: "预授权减免", service_benefit: "增值服务权益", priority_reservation: "优先预订", quote_validity_extension: "报价有效期延长" };
const reserved = (benefit: CustomerMembershipBenefit) => ["priority_reservation", "quote_validity_extension"].includes(benefit.type);
function benefitValue(benefit: CustomerMembershipBenefit, t: Translate) {
  return benefit.calculation === "percentage" ? `${benefit.value}%` : benefit.calculation === "priority" ? t("优先级") + ` ${benefit.value}` : String(benefit.value);
}
function scopeLabel(benefit: CustomerMembershipBenefit, options: CustomerMembershipScopeOptions | undefined, t: Translate) {
  if (!benefit.scope || benefit.scope.type === "tenant") return t("租户全部空间");
  if (benefit.scope.type === "workspaces") return benefit.scope.workspaceIds.map(id => options?.workspaces.find(workspace => workspace.id === id)?.name ?? t(options ? "已不可用空间" : "空间名称未加载")).join(" · ");
  return benefit.scope.categoryCodes.map(code => options?.categories.find(category => category.code === code)?.name ?? t(options ? "已不可用品类" : "品类名称未加载")).join(" · ");
}
function BenefitList({ benefits, t, options, full = false }: { benefits: CustomerMembershipBenefit[]; t: Translate; options?: CustomerMembershipScopeOptions; full?: boolean }) {
  return benefits.length ? <CardList>{benefits.map((benefit, index) => <li key={index}>{reserved(benefit) ? <Clock3 aria-hidden="true" /> : <Check aria-hidden="true" />}<div>
    <div>{t(benefitLabels[benefit.type] ?? benefit.type)} · {benefitValue(benefit, t)}</div>
    {full && <CardSecondary>{scopeLabel(benefit, options, t)}</CardSecondary>}
    {reserved(benefit) && <CardSecondary>{t("配置项，尚未生效")}</CardSecondary>}
  </div></li>)}</CardList> : <CardSecondary>{t("暂无配置权益")}</CardSecondary>;
}
export function membershipPlanCards({ t, options, canManage, canPublish, publishing, edit, history, publish }: {
  t: Translate; options?: CustomerMembershipScopeOptions; canManage: boolean; canPublish: boolean; publishing: boolean;
  edit: (row: CustomerMembershipPlan) => void; history: (row: CustomerMembershipPlan) => void; publish: (row: CustomerMembershipPlan) => void;
}): ListCard<CustomerMembershipPlan> & { defaultView: "cards" } {
  return { kind: "membership", defaultView: "cards", title: row => row.name, subtitle: row => row.code, featured: row => Boolean(row.currentVersion?.isRecommended),
    status: row => <><CardBadge tone="accent">{row.currentVersion ? `Lv.${row.currentVersion.levelRank}` : t("未建版本")}</CardBadge>
      {row.currentVersion?.isRecommended && <CardBadge emphasis><Sparkles aria-hidden="true" />{t("推荐")}</CardBadge>}
      <CardSecondary>{t(row.status === "active" ? "已启用" : row.status === "disabled" ? "已停用" : "草稿")}</CardSecondary></>,
    body: row => {
      const benefits = row.currentVersion?.benefits ?? [], primary = benefits.find(benefit => !reserved(benefit));
      const secondary = benefits.filter(benefit => benefit !== primary), extra = Math.max(0, secondary.length - 2);
      return <>
        {primary ? <CardMetric value={benefitValue(primary, t)} label={t(benefitLabels[primary.type] ?? primary.type)} /> : <CardSecondary>{t("暂无配置权益")}</CardSecondary>}
        {!!secondary.length && <CardHighlights items={secondary.slice(0, 2).map(benefit => ({
          icon: reserved(benefit) ? <Clock3 aria-hidden="true" /> : <Check aria-hidden="true" />,
          label: t(benefitLabels[benefit.type] ?? benefit.type), value: reserved(benefit) ? <CardSecondary>{t("配置项，尚未生效")}</CardSecondary> : benefitValue(benefit, t),
        }))} />}
        <CardFootnote>{t(row.targetType === "corporate" ? "企业会员" : "个人会员")}{row.currentVersion?.isDefault && <CardBadge>{t("默认方案")}</CardBadge>}{extra > 0 && <span>+{extra} {t("配置权益")}</span>}</CardFootnote>
      </>;
    },
    details: row => <><CardSection title={t("全部权益与适用范围")}><BenefitList benefits={row.currentVersion?.benefits ?? []} options={options} t={t} full /></CardSection>
      <CardSection title={t("方案信息")}><CardFacts items={[
        { label: t("生效日期"), value: row.currentVersion?.effectiveFrom ? dayjs(row.currentVersion.effectiveFrom).format("YYYY-MM-DD") : t("未设置") }, { label: t("失效日期"), value: row.currentVersion?.effectiveTo ? dayjs(row.currentVersion.effectiveTo).format("YYYY-MM-DD") : t("长期") },
        { label: t("当前版本"), value: row.currentVersion ? `v${row.currentVersion.version}` : "—" }, { label: t("历史版本"), value: row.versions?.length ?? "—" }, { label: t("版本状态"), value: row.currentVersion ? t(row.currentVersion.status === "published" ? "已发布" : row.currentVersion.status === "disabled" ? "已停用" : "草稿") : "—" },
      ]} /></CardSection></>,
    actions: (row, afterClose) => <><Button variant="secondary" size="sm" disabled={!canManage} onClick={() => afterClose(() => edit(row))}>{t("编辑草稿")}</Button><Button variant="secondary" size="sm" onClick={() => afterClose(() => history(row))}>{t("版本历史")}</Button>
      {row.currentVersion?.status === "draft" && <Button variant="primary" size="sm" disabled={!canPublish || publishing} onClick={() => afterClose(() => publish(row))}>{t("发布")} v{row.currentVersion.version}</Button>}
    </>,
  };
}
