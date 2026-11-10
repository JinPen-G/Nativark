/** Template previews expose the saved rules. Issued coupons keep their own snapshots and original ledger workflow. */
import dayjs from "dayjs";
import type { RentalCouponTemplate, RentalItemGroup } from "@rental-os/shared";
import { Button } from "@/registry/components/button/button";
import { CardBadge, CardFacts, CardSecondary, CardSection } from "@/components/ui/data-table/RecordCard";
import { AnimatedNumber, type ListCard } from "@/components/ui";
import { SplitMeter, Ticket } from "./commercialCardParts";
import styles from "./commercialCards.module.css";

const states: Record<RentalCouponTemplate["status"], string> = {
  draft: "草稿", scheduled: "待开始", active: "进行中", paused: "已暂停", ended: "已结束", void: "已作废",
};
const targets = { rental: "商品租金与使用量", fulfillment: "履约费", service: "增值服务费" };

export function couponCards({ t, money, groups, edit }: {
  t: (value: string) => string;
  money: (value: number) => string;
  groups: RentalItemGroup[];
  edit: (row: RentalCouponTemplate) => void;
}): ListCard<RentalCouponTemplate> {
  const date = (value: string | undefined) => value && dayjs(value).isValid()
    ? <time dateTime={value}>{dayjs(value).format("YYYY-MM-DD HH:mm")}</time>
    : t("未提供");
  const productNames = (row: RentalCouponTemplate) => row.applicableItemGroupIds.length
    ? row.applicableItemGroupIds.map(id => groups.find(group => group.id === id)?.name ?? t("已删除商品")).join(" · ")
    : t("全部商品");

  return {
    kind: "discount",
    title: row => row.name,
    subtitle: row => `${row.code} · v${row.version}`,
    status: row => <CardBadge tone={row.status === "active" ? "positive" : undefined}>{t(states[row.status])}</CardBadge>,
    body: row => { const value = row.discountType === "fixed_amount" ? money(row.discountValue) : `${row.discountValue}%`;
      const unclaimed = Math.max(0, row.totalQuota - row.claimedQuantity), budgetUsed = row.lockedBudget + row.redeemedBudget;
      const remaining = row.totalBudget === undefined ? undefined : Math.max(0, row.totalBudget - budgetUsed);
      return <>
        <Ticket inactive={!["active", "scheduled"].includes(row.status)} kind={t(row.discountType === "fixed_amount" ? "减免金额" : "优惠比例")} value={value}
          cap={row.maximumDiscount !== undefined ? <>{t("最高减免")} {money(row.maximumDiscount)}</> : undefined}>
          <p className={styles.ticketLead}>{row.minimumSpend > 0 ? <>{t("使用门槛")} {money(row.minimumSpend)}</> : t("无门槛")}</p>
          <dl className={styles.ticketFacts}>
            <div><dt>{t("作用费用")}</dt><dd>{t(targets[row.appliesTo])}</dd></div>
            <div><dt>{t("使用期限")}</dt><dd>{dayjs(row.effectiveFrom).isValid() ? dayjs(row.effectiveFrom).format("YYYY-MM-DD") : t("未提供")} → {dayjs(row.effectiveTo).isValid() ? dayjs(row.effectiveTo).format("YYYY-MM-DD") : t("未提供")}</dd></div>
          </dl>
        </Ticket>
        <SplitMeter label={`${t("已领 / 发行")} ${row.claimedQuantity} / ${row.totalQuota}`} parts={[
          { id: "claimed", label: t("已领"), value: row.claimedQuantity, text: <AnimatedNumber value={row.claimedQuantity} /> },
          { id: "unclaimed", label: t("未领取"), value: unclaimed, text: <AnimatedNumber value={unclaimed} /> },
        ]} />
        <SplitMeter proportional={row.totalBudget !== undefined} label={`${t("总预算")} ${row.totalBudget === undefined ? t("不限") : money(row.totalBudget)}`} parts={[
          { id: "redeemed", label: t("已核销"), value: row.redeemedBudget, text: money(row.redeemedBudget) },
          { id: "locked", label: t("已锁定"), value: row.lockedBudget, text: money(row.lockedBudget) },
          { id: "remaining", label: t("剩余预算"), value: remaining ?? 0, text: remaining === undefined ? t("不限") : money(remaining) },
        ]} />
      </>;
    },
    details: row => <>
      <CardSection title={t("适用范围")}>
        <CardSecondary>{productNames(row)}</CardSecondary>
        <CardFacts items={[
          { label: t("作用费用"), value: t(targets[row.appliesTo]) },
          { label: t("与自动优惠叠加"), value: t(row.stackableWithDiscountPlans ? "允许" : "不允许") },
          { label: t("每客限领"), value: row.perCustomerLimit },
          { label: t("每客限用"), value: row.perCustomerUseLimit },
        ]} />
      </CardSection>
      <CardSection title={t("领取与使用时间")}>
        <CardFacts items={[
          { label: t("开始领取时间"), value: date(row.claimFrom) },
          { label: t("停止领取时间"), value: date(row.claimTo) },
          { label: t("开始使用时间"), value: date(row.effectiveFrom) },
          { label: t("停止使用时间"), value: date(row.effectiveTo) },
          ...(row.applicableRentalFrom || row.applicableRentalTo ? [
            { label: t("适用租期开始（可选）"), value: row.applicableRentalFrom ? date(row.applicableRentalFrom) : t("不限") },
            { label: t("适用租期结束（可选）"), value: row.applicableRentalTo ? date(row.applicableRentalTo) : t("不限") },
          ] : []),
        ]} />
      </CardSection>
      <CardSection title={t("预算")}>
        <CardFacts items={[
          { label: t("总预算"), value: row.totalBudget === undefined ? t("不限") : money(row.totalBudget) },
          { label: t("已锁定预算"), value: money(row.lockedBudget) },
          { label: t("已核销预算"), value: money(row.redeemedBudget) },
        ]} />
      </CardSection>
    </>,
    actions: (row, afterClose) => <Button variant="secondary" size="sm" onClick={() => afterClose(() => edit(row))}>{t("编辑")}</Button>,
  };
}
