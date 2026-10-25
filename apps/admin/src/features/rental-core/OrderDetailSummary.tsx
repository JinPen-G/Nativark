import type { ReactNode } from "react";
import dayjs from "dayjs";
import { formatRentalMoney, type RentalFundingBalance, type RentalOrder } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { DataTableStatus } from "@/components/ui";
import { plannedReturnAt } from "./orderListPresentation";
import { detailFulfillmentLabels, detailStatusLabels, knownMoney } from "./orderDetailPresentation";
import styles from "./OrderDetail.module.css";
import { CustomerPreview } from "@/features/membership/CustomerPreview";

export function OrderMoney({ value, currency, prominent = false }: { value?: number; currency?: string; prominent?: boolean }) {
  return <span className={[styles.money, prominent && styles.heroMoney].filter(Boolean).join(" ")}>
    {knownMoney(value) ? formatRentalMoney(value, currency) : "—"}
  </span>;
}

export function OrderDetailSummary({ order, funding, fundingState, deliveryAddress, pickupLabel }: {
  order: RentalOrder; funding?: RentalFundingBalance;
  fundingState: "ready" | "loading" | "error" | "restricted"; deliveryAddress?: ReactNode; pickupLabel?: string;
}) {
  const { t } = useLocale();
  const tone = order.status === "completed" ? "success" : ["pickup_overdue", "no_show"].includes(order.status) ? "warning"
    : ["renting", "ready_for_pickup"].includes(order.status) ? "info" : "neutral";
  const date = (at?: string) => at && dayjs(at).isValid() ? dayjs(at).format("YYYY-MM-DD HH:mm") : "—";
  const end = plannedReturnAt(order);
  const pickup = order.fulfillmentLocationSnapshot, returned = order.returnLocationSnapshot;
  const sameLocation = Boolean(pickup.id && pickup.id === returned.id && pickup.name === returned.name
    && pickup.operator.id === returned.operator.id && pickup.operator.name === returned.operator.name);
  return <section className={styles.overview} aria-label={t("订单概览")}>
    <div>
      <div className={styles.identity}>
        <DataTableStatus variant="soft" tone={tone}>{t(detailStatusLabels[order.status])}</DataTableStatus>
        <span className={styles.customer}><CustomerPreview customerId={order.customerId} name={order.customerName} type={order.customerType} snapshot /></span>
        <span className={styles.secondary}>{t(order.customerType === "corporate" ? "企业客户" : "个人客户")} · {t(detailFulfillmentLabels[order.fulfillmentMode] ?? order.fulfillmentMode)}</span>
      </div>
      {order.subjectSnapshot && order.subjectSnapshot.some(subject => subject.name !== order.customerName) && <dl className={styles.balanceFacts} style={{ marginTop: "var(--space-2)" }}>
        {order.subjectSnapshot.map(subject => <div key={subject.role}><dt>{t({ contract: "签约主体", payer: "付款主体", user: "使用主体", agent: "经办人" }[subject.role])}</dt><dd><CustomerPreview customerId={subject.customerId} name={subject.name} type={subject.customerType} phoneMasked={subject.phoneMasked} companyName={subject.corporateName} snapshot /></dd></div>)}
      </dl>}
      <div className={styles.plan}>
        <div className={styles.planItem}><span className={styles.label}>{t("计划{action}", { action: t(pickupLabel ?? "领取") })}</span><strong className={styles.date}>{date(order.startAt)}</strong>
          {!sameLocation && <><span className={styles.location}>{order.fulfillmentLocationSnapshot.name}</span><span className={styles.secondary}>{order.fulfillmentLocationSnapshot.operator.name}</span></>}
          {order.actualRentalStartAt && <span className={styles.secondary}>{t("实际签收")} · {date(order.actualRentalStartAt)}</span>}
        </div>
        <div className={styles.planItem}><span className={styles.label}>{t("当前应还时间")}</span><strong className={styles.date}>{date(end)}</strong>
          {!sameLocation && <><span className={styles.location}>{order.returnLocationSnapshot.name}</span><span className={styles.secondary}>{order.returnLocationSnapshot.operator.name}</span></>}
          {end !== order.endAt && <span className={styles.secondary}>{t("原约定归还")} · {date(order.endAt)}</span>}
        </div>
      </div>
      {sameLocation && <div className={styles.address}><span className={styles.label}>{t("取还地点")} · </span><span>{pickup.name}</span><span className={styles.secondary}> · {pickup.operator.name}</span></div>}
      {deliveryAddress && <div className={styles.address}><span className={styles.label}>{t("收货地址")}</span><div>{deliveryAddress}</div></div>}
    </div>
    <aside className={styles.balance} aria-label={t("租金与费用摘要")}>
      <div className={styles.balanceTop}><span className={styles.label}>{t("当前待收")}</span>{fundingState === "ready" && <span className={styles.secondary}>{t("模拟资金")}</span>}</div>
      <OrderMoney value={fundingState === "ready" ? funding?.rental.due : undefined} currency={order.currency} prominent />
      {fundingState === "ready" && knownMoney(funding?.rental.pendingExtensionAmount) && funding!.rental.pendingExtensionAmount > 0 && <span className={styles.secondary}>{t("含续租待补")} · <OrderMoney value={funding!.rental.pendingExtensionAmount} currency={order.currency} /></span>}
      {fundingState === "ready" ? <dl className={styles.balanceFacts}>
        <div><dt>{t("当前应收")}</dt><dd><OrderMoney value={funding?.rental.payable} currency={order.currency} /></dd></div>
        <div><dt>{t("累计收款")}</dt><dd><OrderMoney value={funding?.rental.collected} currency={order.currency} /></dd></div>
        {knownMoney(funding?.rental.balance) && funding!.rental.balance < 0 && <div><dt>{t("待退款")}</dt><dd><OrderMoney value={Math.abs(funding!.rental.balance)} currency={order.currency} /></dd></div>}
      </dl> : <p className={styles.note}>{t(fundingState === "restricted" ? "当前账号无资金查看权限" : fundingState === "error" ? "资金读取失败，请在费用与资金中重试" : "正在读取资金摘要")}</p>}
      {fundingState !== "ready" && <span className={styles.secondary}>{t("订单应付")} · <OrderMoney value={order.finalPayableAmount ?? order.payableAmount} currency={order.currency} /></span>}
    </aside>
  </section>;
}
