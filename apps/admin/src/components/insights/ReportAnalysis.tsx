/** Rich read-only analysis of the approved report response. Details/export retain their existing contracts. */
import { useState } from "react";
import type { RentalWorkspaceOperationReport } from "@rental-os/shared";
import { formatRentalMoney } from "@rental-os/shared";
import { AnimatedNumber, Button } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { orderStatusChartColor } from "@/features/rental-core/orderStatusSemantics";
import { ContributionExplorer } from "./ContributionExplorer";
import { InventoryOverview } from "./InventoryOverview";
import { DistributionChart, InsightPanel } from "./OperationalCharts";
import { SplitBar } from "./split-bar/SplitBar";
import { retainedHiddenSegments } from "./chartVisibility";
import styles from "./OperationalCharts.module.css";

const statusLabels: Record<string, string> = { draft: "草稿", reserved: "已预订", pickup_overdue: "待确认爽约", ready_for_pickup: "待领取", renting: "在租", return_inspection: "归还检查", settling: "待结算", completed: "已关闭", cancelled: "已取消", no_show: "已爽约" };
const feeLabels: Record<string, string> = { overdue: "逾期费用", damage: "损坏费用", cancellation: "取消费用" };

export function ReportAnalysis({ data, onDetails }: { data: RentalWorkspaceOperationReport; onDetails: (dimension?: "customers" | "locations") => void }) {
  const { t, locale } = useLocale();
  const [feeSelection, setHiddenFees] = useState<readonly string[]>([]);
  const money = (value: number) => formatRentalMoney(value, data.currency);
  const fees = data.exceptionFeeBreakdown.filter(row => row.amount > 0).map(row => ({ id: row.type, label: t(feeLabels[row.type] ?? row.type), value: row.amount }));
  const hiddenFees = retainedHiddenSegments(fees, feeSelection);
  return <div className={styles.analysisLayout}>
    <div className={styles.insightColumn}>
      <ContributionExplorer data={data} onDetails={onDetails} />
      <InsightPanel title={t("应收与税额")} description={t("税额已包含在应收金额中")}>
        <div className={styles.receivable}><span>{t("应收金额")}</span><strong>{money(data.receivableTotal)}</strong></div>
        <dl className={styles.snapshotFacts}>
          <div><dt>{t("不含税应收")}</dt><dd>{money(data.netOfTaxTotal)}</dd></div>
          <div><dt>{t("其中税额")}</dt><dd>{money(data.taxTotal)}</dd></div>
          <div><dt>{t("优惠金额")}</dt><dd>{money(data.discountTotal)}</dd></div>
          <div><dt>{t("租赁收入")}</dt><dd>{money(data.rentalRevenue)}</dd></div>
        </dl>
      </InsightPanel>
    </div>
    <div className={styles.insightColumn}>
      <InsightPanel title={t("订单状态分布")} description={t("当前筛选范围的全部订单，不受分页影响")}>
        <DistributionChart title={t("订单状态")} unit={t("单")} rows={data.statusBreakdown.map(row => ({ key: row.status, label: t(statusLabels[row.status] ?? row.status), value: row.count, color: orderStatusChartColor(row.status) }))} />
        <dl className={styles.inlineFacts}><div><dt>{t("平均租期")}</dt><dd>{data.utilization.orderOccupancy.averageHours} <small>{t("小时")}</small></dd></div><div><dt>{t("占用时长合计")}</dt><dd>{data.utilization.orderOccupancy.totalHours} <small>{t("小时")}</small></dd></div></dl>
      </InsightPanel>
      <InsightPanel title={t("库存与资产（当前快照）")} description={t("库存快照不随报表日期变化")}><InventoryOverview utilization={data.utilization} /></InsightPanel>
    </div>
    <InsightPanel className={styles.widePanel} title={t("异常费用构成")} description={t("同一订单可能包含多种异常费用")}>
      <div className={styles.feeAnalysis}>
        <div>
          <dl className={styles.inlineFacts}><div><dt>{t("异常费用")}</dt><dd>{money(data.exceptionFeeTotal)}</dd></div><div><dt>{t("异常订单")}</dt><dd><AnimatedNumber value={data.exceptionOrderCount} /></dd></div></dl>
          {fees.length > 0 && <SplitBar segments={fees} label={t("异常费用构成")} totalLabel={t("图中合计")} locale={locale} format={{ style: "currency", currency: data.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }} hidden={hiddenFees} onHiddenChange={setHiddenFees} />}
          {hiddenFees.length > 0 && <div className={styles.chartFilter}><span>{t("图例筛选仅影响图中占比")}</span><Button type="text" size="small" onClick={() => setHiddenFees([])}>{t("显示全部分类")}</Button></div>}
        </div>
        <dl className={styles.feeRows}>{data.exceptionFeeBreakdown.map(row => <div key={row.type}><dt>{t(feeLabels[row.type] ?? row.type)}<span>{t("涉及订单")} {row.orderCount}</span></dt><dd>{money(row.amount)}</dd></div>)}</dl>
      </div>
    </InsightPanel>
  </div>;
}
