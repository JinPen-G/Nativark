import type { ReactNode } from "react";
import type { RentalFundingBalance, RentalFundingEvent, RentalFundingInstrument, RentalFundingAction, RentalOrder, RentalOfflinePaymentMethod } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { Alert, Button, ListSection, Table } from "@/components/ui";
import { OrderMoney } from "./OrderDetailSummary";
import { newestFundingEvents } from "./orderDetailPresentation";
import styles from "./OrderDetail.module.css";

const instruments: Record<RentalFundingInstrument, string> = { rental: "租金与费用", deposit: "押金", preauthorization: "预授权" };
const actionLabels: Record<RentalFundingAction, string> = { initiate: "发起", append: "追加", capture: "抵扣", refund: "退款", release: "释放", fail: "记录失败" };
const methods: Record<RentalOfflinePaymentMethod, string> = { offline_cash: "线下现金", offline_transfer: "线下转账" };

/** Three independent server ledgers. No net-paid, due or security target is
 * reconstructed here; pending extensions retain their separate server field. */
export function OrderFundingPanel({ order, funding, loading, error, refresh, depositRequirement, preauthorizationRequirement, actions }: {
  order: RentalOrder; funding?: RentalFundingBalance; loading: boolean; error: boolean; refresh: () => unknown;
  depositRequirement: number; preauthorizationRequirement: number; actions: Partial<Record<RentalFundingInstrument, ReactNode>>;
}) {
  const { t } = useLocale();
  if (error) return <Alert type="error" showIcon title={t("资金读取失败")} description={<Button onClick={() => void refresh()}>{t("重新读取资金")}</Button>} />;
  if (!funding) return <p className={styles.note} role="status">{t(loading ? "正在读取资金摘要" : "资金摘要暂不可用")}</p>;
  const accounts = [
    { key: "rental" as const, name: "租金与费用", target: "当前应收", amount: funding.rental.payable,
      values: [["累计收款", funding.rental.collected], ["累计退款", funding.rental.refunded], ["保证金抵扣", funding.rental.securityCaptured], ["当前待收", funding.rental.due],
        ...(funding.rental.balance < 0 ? [["待退款", Math.abs(funding.rental.balance)]] : []), ...(funding.rental.pendingExtensionAmount !== 0 ? [["续租待补", funding.rental.pendingExtensionAmount]] : [])] },
    { key: "deposit" as const, name: "押金", target: "应收押金", amount: depositRequirement,
      values: [["已收押金", funding.deposit.collected], ["已抵扣", funding.deposit.captured], ["已退押金", funding.deposit.refunded], ["押金余额", funding.deposit.balance], ...(funding.deposit.pendingExtensionAmount !== 0 ? [["续租待补", funding.deposit.pendingExtensionAmount]] : [])] },
    { key: "preauthorization" as const, name: "预授权", target: "应冻结额度", amount: preauthorizationRequirement,
      values: [["累计冻结", funding.preauthorization.frozen], ["已转扣", funding.preauthorization.captured], ["已释放", funding.preauthorization.released], ["冻结余额", funding.preauthorization.balance], ...(funding.preauthorization.pendingExtensionAmount !== 0 ? [["续租待补", funding.preauthorization.pendingExtensionAmount]] : [])] },
  ];
  return <div className={styles.stack}>
    <Alert type="warning" showIcon title={t("当前未接入真实支付机构；以下操作只记录可追溯的模拟资金事件，不代表真实收款、冻结或退款。")} />
    <section aria-label={t("资金账户")}>
      {accounts.map(account => <section key={account.key} className={styles.account} aria-label={t(account.name)}>
        <div><h3 className={styles.accountName}>{t(account.name)}</h3><span className={styles.label}>{t(account.target)} · <OrderMoney value={account.amount} currency={order.currency} /></span></div>
        <dl className={styles.facts}>{account.values.map(([label, value]) => <div key={String(label)}><dt>{t(String(label))}</dt><dd><OrderMoney value={value as number | undefined} currency={order.currency} /></dd></div>)}</dl>
        {actions[account.key] && <div className={styles.accountActions}>{actions[account.key]}</div>}
      </section>)}
    </section>
    <ListSection title={t("资金流水")}>
      <Table<RentalFundingEvent> rowKey="id" size="small" loading={loading} onRefresh={refresh} dataSource={newestFundingEvents(funding.events)} columns={[
        { title: t("发生时间"), dataIndex: "at", render: value => value && Number.isFinite(Date.parse(String(value))) ? new Date(String(value)).toLocaleString() : "—" },
        { title: t("账户"), dataIndex: "instrument", render: value => t(instruments[value as RentalFundingInstrument]) },
        { title: t("动作"), dataIndex: "action", render: (value, row) => t(row.instrument === "preauthorization" && value === "initiate" ? "冻结" : row.instrument === "preauthorization" && value === "capture" ? "转扣" : row.instrument === "deposit" && value === "initiate" ? "收取" : actionLabels[value as RentalFundingAction]) },
        { title: t("方式"), dataIndex: "paymentMethod", render: value => value ? t(methods[value as RentalOfflinePaymentMethod]) : "—" },
        { title: t("金额"), dataIndex: "amount", align: "right", render: value => <OrderMoney value={value} currency={order.currency} /> },
        { title: t("事件后余额"), dataIndex: "balanceAfter", align: "right", render: value => <OrderMoney value={value} currency={order.currency} /> },
        { title: t("原因"), dataIndex: "reason" },
        { title: t("状态"), render: (_, row) => row.action === "fail" ? <span>{t("失败")} · {row.failureCode ?? "—"}</span> : t(row.provider === "mock" ? "模拟成功" : "已记录") },
      ]} />
      <p className={styles.note}>{t("按发生时间倒序；押金和预授权仅在抵扣或转扣后计入已付。")}</p>
    </ListSection>
  </div>;
}
