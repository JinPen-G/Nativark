/** Read-only commercial card projections; prices remain the original published/configured facts. */
import { BadgeCheck, Check, Headset, Minus, Package, PackageOpen, ShieldCheck, Sparkles, Truck, UserRound, type LucideIcon } from "lucide-react";
import type { RentalDiscountPlan, RentalItemGroup, RentalPricingGroup, RentalPricingPlanV1, RentalValueAddedService } from "@rental-os/shared";
import { RENTAL_PRICING_UNIT_LABELS } from "@rental-os/shared";
import type { ListCard } from "@/components/ui";
import { Button } from "@/registry/components/button/button";
import { CardBadge, CardFacts, CardList, CardSecondary, CardSection } from "@/components/ui/data-table/RecordCard";
import { ModelStack, PriceBoard, Ticket } from "./commercialCardParts";
import styles from "./commercialCards.module.css";
type Translate = (key: string) => string;
type Money = (value: number) => string;
type CardRate = Pick<RentalPricingPlanV1["rates"][number], "itemGroupId" | "unit" | "baseAmount"> & { pricingGroupId?: string };

export function pricingGroupCards({ t, rates, models, defaultUnit, money, canEditSecurity, edit, security }: {
  t: Translate; rates: CardRate[]; models: RentalItemGroup[]; defaultUnit?: string; money: Money; canEditSecurity: boolean;
  edit: (row: RentalPricingGroup) => void; security: (row: RentalPricingGroup) => void;
}): ListCard<RentalPricingGroup> {
  const groupRates = (row: RentalPricingGroup) => rates.filter(rate => (rate.pricingGroupId ?? rate.itemGroupId) === row.id);
  return { kind: "pricing", title: row => row.name, subtitle: row => `${row.code} · v${row.version}`,
    status: row => <CardBadge tone={row.status === "enabled" ? "positive" : undefined}>{t(row.status === "enabled" ? "已启用" : "已停用")}</CardBadge>,
    body: row => { const list = groupRates(row), unit = row.defaultPricingUnit ?? defaultUnit, primary = unit ? list.find(rate => rate.unit === unit) : list[0];
      const unitLabel = (value: string) => t(RENTAL_PRICING_UNIT_LABELS[value as keyof typeof RENTAL_PRICING_UNIT_LABELS] ?? value);
      const board = list.filter((rate, index) => list.findIndex(item => item.unit === rate.unit) === index).map(rate => ({ unit: rate.unit, label: unitLabel(rate.unit), amount: money(rate.baseAmount) }));
      return <>
        <PriceBoard rates={board} initial={unit ?? primary?.unit} label={t("当前基本价")} emptyText={t("当前单位未配置基本价")} />
        <div className={styles.models}><ModelStack members={row.members} models={models} label={t("包含型号")} /><span>{t("包含型号")} <b>{row.members.length}</b></span></div>
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
    status: row => <CardBadge tone={row.status === "enabled" ? "positive" : undefined}>{t(row.status === "enabled" ? "已启用" : row.status === "draft" ? "草稿" : "已停用")}</CardBadge>,
    body: row => { const stack = [
      { label: `${t("其他方案")}：${t(row.stackableWithOtherPlans ? "可叠加" : "不叠加")}`, on: row.stackableWithOtherPlans },
      { label: t(row.stackableWithCoupon ? "可与优惠券叠加" : "不可与优惠券叠加"), on: row.stackableWithCoupon },
    ];
      return <>
        <Ticket inactive={row.status !== "enabled"} kind={t(row.discountType === "percentage" ? "百分比优惠" : row.discountType === "threshold_amount" ? "满减优惠" : "金额减免")}
          value={row.discountType === "percentage" ? `${row.discountValue}%` : money(row.discountValue)}
          cap={row.maximumDiscount != null ? <>{t("最高减免")} {money(row.maximumDiscount)}</> : undefined}>
          <p className={styles.ticketLead}>{row.discountType === "threshold_amount" ? row.thresholdAmount == null ? t("未配置门槛") : <>{t("消费满")} {money(row.thresholdAmount)}</> : t("无门槛")}</p>
          <dl className={styles.ticketFacts}>
            <div><dt>{t("适用客户")}</dt><dd>{customerLabel(row.customerScope)}</dd></div>
            <div><dt>{t("适用范围")}</dt><dd>{groups(row).length ? `${groups(row).length} ${t("定价分组")}` : t("全部定价分组")}</dd></div>
          </dl>
        </Ticket>
        <ul className={styles.stack}>{stack.map(item => <li key={item.label} data-off={item.on ? undefined : ""}>{item.on ? <Check aria-hidden="true" /> : <Minus aria-hidden="true" />}{item.label}</li>)}</ul>
      </>;
    },
    details: row => <><CardSection title={t("适用范围")}><CardSecondary>{groups(row).join(" · ") || t("全部定价分组")}</CardSecondary>{row.maximumDiscount != null && <CardSecondary>{t("最高减免")} {money(row.maximumDiscount)}</CardSecondary>}</CardSection>
      <CardSection title={t("互斥与叠加")}><CardFacts items={[{ label: t("互斥组"), value: row.exclusiveGroup || t("独立方案") }, { label: t("其他方案"), value: t(row.stackableWithOtherPlans ? "可叠加" : "不叠加") }, { label: t("优惠券"), value: t(row.stackableWithCoupon ? "可叠加" : "不叠加") }]} /></CardSection>
    </>,
    actions: (row, afterClose) => <Button variant="secondary" size="sm" onClick={() => afterClose(() => edit(row))}>{t("编辑优惠方案")}</Button>,
  };
}

const serviceIcons: Record<RentalValueAddedService["serviceType"], LucideIcon> = {
  insurance: ShieldCheck, damage_waiver: BadgeCheck, delivery: Truck, consumable: Package, operator: UserRound, support: Headset, other: Sparkles,
};

export function serviceCards({ t, money, serviceLabel, billingLabel, edit, capacity }: {
  t: Translate; money: Money; serviceLabel: (key: string) => string; billingLabel: (key: string) => string;
  edit: (row: RentalValueAddedService) => void; capacity: (row: RentalValueAddedService) => void;
}): ListCard<RentalValueAddedService> {
  return { kind: "service", title: row => row.name, subtitle: row => `${row.code} · v${row.version}`,
    status: row => <CardBadge tone={row.status === "enabled" ? "positive" : undefined}>{t(row.status === "enabled" ? "已启用" : "已停用")}</CardBadge>,
    body: row => { const Icon = serviceIcons[row.serviceType] ?? Sparkles, rows: Array<{ label: string; value?: string }> = [
      ...(row.serviceType === "insurance" || row.coverageLimit != null ? [{ label: t("保障额度"), value: row.coverageLimit == null ? undefined : money(row.coverageLimit) }] : []),
      ...(row.serviceType === "insurance" || row.deductible != null ? [{ label: t("免赔额"), value: row.deductible == null ? undefined : money(row.deductible) }] : []),
      { label: t("容量"), value: t(row.requiresCapacity ? "需要预留容量" : "无容量限制") },
      { label: t("条款版本"), value: row.termsVersion || undefined },
    ];
      return <div className={styles.plan} data-disabled={row.status === "enabled" ? undefined : ""}>
        <div className={styles.planTop}>
          <span className={styles.icon} data-type={row.serviceType}><Icon aria-hidden="true" /></span>
          <div className={styles.planName}><span>{serviceLabel(row.serviceType)}</span>
            <div className={styles.price} aria-label={`${t("服务价格")} ${money(row.price)} / ${billingLabel(row.billingUnit)}`}><span className={styles.priceValue}>{money(row.price)}</span><span className={styles.pricePeriod}>/ {billingLabel(row.billingUnit)}</span></div>
          </div>
        </div>
        <ul className={styles.rows}>{rows.map(item => <li key={item.label} data-unset={item.value === undefined ? "" : undefined}>{item.value === undefined ? <Minus aria-hidden="true" /> : <Check aria-hidden="true" />}<span>{item.label}</span><b>{item.value ?? t("未配置")}</b></li>)}</ul>
      </div>;
    },
    details: row => <CardSection title={t("服务与保障")}><CardFacts items={[{ label: t("条款版本"), value: row.termsVersion || "—" }, { label: t("计费方式"), value: billingLabel(row.billingUnit) }, { label: t("保障额度"), value: row.coverageLimit == null ? t("未配置") : money(row.coverageLimit) }, { label: t("免赔额"), value: row.deductible == null ? t("未配置") : money(row.deductible) }]} /></CardSection>,
    actions: (row, afterClose) => <><Button variant="secondary" size="sm" onClick={() => afterClose(() => edit(row))}>{t("编辑服务")}</Button>{row.requiresCapacity && <Button variant="secondary" size="sm" onClick={() => afterClose(() => capacity(row))}>{t("容量窗口")}</Button>}</>,
  };
}