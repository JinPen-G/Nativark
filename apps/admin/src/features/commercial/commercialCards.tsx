/** Read-only commercial card projections; prices remain the original published/configured facts. */
import { PackageOpen } from "lucide-react";
import type { RentalDiscountPlan, RentalItemGroup, RentalPricingGroup, RentalPricingPlanV1, RentalValueAddedService } from "@rental-os/shared";
import { RENTAL_PRICING_UNIT_LABELS } from "@rental-os/shared";
import type { ListCard } from "@/components/ui";
import { Button } from "@/registry/components/button/button";
import { CardBadge, CardFacts, CardFootnote, CardHighlights, CardList, CardMetric, CardSecondary, CardSection } from "@/components/ui/data-table/RecordCard";
import { ItemGroupPhoto } from "@/features/catalog/ItemGroupPhoto";
type Translate = (key: string) => string;
type Money = (value: number) => string;
type CardRate = Pick<RentalPricingPlanV1["rates"][number], "itemGroupId" | "unit" | "baseAmount"> & { pricingGroupId?: string };

export function pricingGroupCards({ t, rates, models, defaultUnit, money, canEditSecurity, edit, security }: {
  t: Translate; rates: CardRate[]; models: RentalItemGroup[]; defaultUnit?: string; money: Money; canEditSecurity: boolean;
  edit: (row: RentalPricingGroup) => void; security: (row: RentalPricingGroup) => void;
}): ListCard<RentalPricingGroup> {
  const groupRates = (row: RentalPricingGroup) => rates.filter(rate => (rate.pricingGroupId ?? rate.itemGroupId) === row.id);
  return { kind: "pricing", title: row => row.name, subtitle: row => `${row.code} · v${row.version}`,
    media: row => { const model = row.members.map(member => models.find(model => model.id === member.id)).find(model => model?.images?.length); const image = model?.images?.find(image => image.isCover) ?? model?.images?.[0];
      return model && image ? <ItemGroupPhoto groupId={model.id} image={image} presentation="card" alt={model.name} /> : null;
    },
    status: row => <CardBadge tone={row.status === "enabled" ? "positive" : undefined}>{t(row.status === "enabled" ? "已启用" : "已停用")}</CardBadge>,
    body: row => { const list = groupRates(row), unit = row.defaultPricingUnit ?? defaultUnit, primary = unit ? list.find(rate => rate.unit === unit) : list[0];
      return <>{primary ? <CardMetric value={money(primary.baseAmount)} suffix={`/ ${t(RENTAL_PRICING_UNIT_LABELS[primary.unit] ?? primary.unit)}`} label={t("当前基本价")} /> : <CardSecondary>{t("当前单位未配置基本价")}</CardSecondary>}
        <CardHighlights items={[{ icon: <PackageOpen aria-hidden="true" />, label: t("包含型号"), value: row.members.length }, ...(list.length > 1 ? [{ label: t("可用计价单位"), value: list.length }] : [])]} />
      </>;
    },
    details: row => <><CardSection title={t("全部基本价")}><CardFacts items={groupRates(row).map(rate => ({ label: t(RENTAL_PRICING_UNIT_LABELS[rate.unit] ?? rate.unit), value: money(rate.baseAmount) }))} />{!groupRates(row).length && <CardSecondary>{t("当前单位未配置基本价")}</CardSecondary>}</CardSection>
      <CardSection title={t("包含的型号")}><CardList>{row.members.map(member => <li key={member.id}><PackageOpen aria-hidden="true" /><div>{member.name}<CardSecondary>{member.code}</CardSecondary></div></li>)}</CardList></CardSection>
    </>,
    actions: (row, afterClose) => <><Button variant="secondary" size="sm" onClick={() => afterClose(() => edit(row))}>{t("编辑分组")}</Button><Button variant="secondary" size="sm" disabled={!canEditSecurity} onClick={() => afterClose(() => security(row))}>{t("押金/预授权")}</Button></>,
  };
}

export function discountCards({ t, money, pricingGroups, customerLabel, edit }: {
  t: Translate; money: Money; pricingGroups: RentalPricingGroup[]; customerLabel: (key: string) => string; edit: (row: RentalDiscountPlan) => void;
}): ListCard<RentalDiscountPlan> {
  const groups = (row: RentalDiscountPlan) => row.applicablePricingGroupIds?.map(id => pricingGroups.find(group => group.id === id)?.name ?? t("已删除分组")) ?? [];
  return { kind: "discount", title: row => row.name, subtitle: row => `${row.code} · v${row.version}`,
    status: row => <><CardBadge tone={row.status === "enabled" ? "positive" : undefined}>{t(row.status === "enabled" ? "已启用" : row.status === "draft" ? "草稿" : "已停用")}</CardBadge><CardSecondary>{t(row.discountType === "percentage" ? "百分比优惠" : row.discountType === "threshold_amount" ? "满减优惠" : "金额减免")}</CardSecondary></>,
    body: row => <><CardMetric value={row.discountType === "percentage" ? `${row.discountValue}%` : money(row.discountValue)} label={t(row.discountType === "percentage" ? "优惠比例" : "减免金额")} />
      {row.discountType === "threshold_amount" && <CardSecondary>{row.thresholdAmount == null ? t("未配置门槛") : <>{t("消费满")} {money(row.thresholdAmount)}</>}</CardSecondary>}
      <CardHighlights items={[
        { label: t("适用客户"), value: customerLabel(row.customerScope) },
        { label: t("适用范围"), value: groups(row).length ? `${groups(row).length} ${t("定价分组")}` : t("全部定价分组") },
      ]} />
      <CardFootnote><span>{t("其他方案")}：{t(row.stackableWithOtherPlans ? "可叠加" : "不叠加")}</span><span>{t(row.stackableWithCoupon ? "可与优惠券叠加" : "不可与优惠券叠加")}</span></CardFootnote>
    </>,
    details: row => <><CardSection title={t("适用范围")}><CardSecondary>{groups(row).join(" · ") || t("全部定价分组")}</CardSecondary>{row.maximumDiscount != null && <CardSecondary>{t("最高减免")} {money(row.maximumDiscount)}</CardSecondary>}</CardSection>
      <CardSection title={t("互斥与叠加")}><CardFacts items={[{ label: t("互斥组"), value: row.exclusiveGroup || t("独立方案") }, { label: t("其他方案"), value: t(row.stackableWithOtherPlans ? "可叠加" : "不叠加") }, { label: t("优惠券"), value: t(row.stackableWithCoupon ? "可叠加" : "不叠加") }]} /></CardSection>
    </>,
    actions: (row, afterClose) => <Button variant="secondary" size="sm" onClick={() => afterClose(() => edit(row))}>{t("编辑优惠方案")}</Button>,
  };
}

export function serviceCards({ t, money, serviceLabel, billingLabel, edit, capacity }: {
  t: Translate; money: Money; serviceLabel: (key: string) => string; billingLabel: (key: string) => string;
  edit: (row: RentalValueAddedService) => void; capacity: (row: RentalValueAddedService) => void;
}): ListCard<RentalValueAddedService> {
  return { kind: "service", title: row => row.name, subtitle: row => `${row.code} · v${row.version}`,
    status: row => <><CardBadge tone={row.status === "enabled" ? "positive" : undefined}>{t(row.status === "enabled" ? "已启用" : "已停用")}</CardBadge>{serviceLabel(row.serviceType) !== row.name && <CardSecondary>{serviceLabel(row.serviceType)}</CardSecondary>}</>,
    body: row => <><CardMetric value={money(row.price)} suffix={`/ ${billingLabel(row.billingUnit)}`} label={t("服务价格")} />
      {(row.coverageLimit != null || row.deductible != null) && <CardHighlights items={[
        ...(row.coverageLimit != null ? [{ label: t("保障额度"), value: money(row.coverageLimit) }] : []),
        ...(row.deductible != null ? [{ label: t("免赔额"), value: money(row.deductible) }] : []),
      ]} />}
      <CardFootnote>{row.requiresCapacity ? t("需要预留容量") : t("无容量限制")}{row.termsVersion && <span>· {t("条款版本")} {row.termsVersion}</span>}</CardFootnote>
    </>,
    details: row => <CardSection title={t("服务与保障")}><CardFacts items={[{ label: t("条款版本"), value: row.termsVersion || "—" }, { label: t("计费方式"), value: billingLabel(row.billingUnit) }, { label: t("保障额度"), value: row.coverageLimit == null ? t("未配置") : money(row.coverageLimit) }, { label: t("免赔额"), value: row.deductible == null ? t("未配置") : money(row.deductible) }]} /></CardSection>,
    actions: (row, afterClose) => <><Button variant="secondary" size="sm" onClick={() => afterClose(() => edit(row))}>{t("编辑服务")}</Button>{row.requiresCapacity && <Button variant="secondary" size="sm" onClick={() => afterClose(() => capacity(row))}>{t("容量窗口")}</Button>}</>,
  };
}
