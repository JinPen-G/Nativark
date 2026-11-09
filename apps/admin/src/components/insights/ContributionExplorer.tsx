/** Explore existing server breakdowns; the diagram only projects their values and never substitutes for report totals. */
import { useMemo, useState } from "react";
import type { RentalWorkspaceOperationReport } from "@rental-os/shared";
import { formatRentalMoney } from "@rental-os/shared";
import { Button, Segmented, Treemap, type TreemapNode } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { ADMIN_INSIGHT_METRICS } from "@/app/designTokens";
import { InsightPanel, RankedFacts } from "./OperationalCharts";
import styles from "./OperationalCharts.module.css";

type Metric = "receivableTotal" | "rentalRevenue" | "orderCount";
export function ContributionExplorer({ data, onDetails }: { data: RentalWorkspaceOperationReport; onDetails: (dimension: "customers" | "locations") => void }) {
  const { t, locale } = useLocale();
  const [dimension, setDimension] = useState<"customers" | "locations">("customers");
  const [metric, setMetric] = useState<Metric>("receivableTotal");
  const [focus, setFocus] = useState("contribution");
  const money = (value: number) => formatRentalMoney(value, data.currency);
  const format = metric === "orderCount" ? (value: number) => new Intl.NumberFormat(locale).format(value) : money;
  const labels: Record<Metric, string> = { receivableTotal: t("应收金额"), rentalRevenue: t("租赁收入"), orderCount: t("订单量") };
  const shortLabels: Record<Metric, string> = { receivableTotal: t("应收"), rentalRevenue: t("租金"), orderCount: t("订单") };
  const rows = useMemo(() => dimension === "customers" ? data.customerBreakdown.map((row, index) => ({
    id: row.customerId ? `customer:${row.customerType}:${row.customerId}` : `legacy:${row.customerType}:${row.customerName}:${index}`, label: row.customerName,
    type: row.customerType, value: row[metric], count: row.orderCount,
  })) : data.locationBreakdown.map(row => ({ id: `location:${row.locationId}`, label: row.locationName, type: "location", value: row[metric], count: row.orderCount })), [data.customerBreakdown, data.locationBreakdown, dimension, metric]);
  const tree = useMemo<TreemapNode>(() => {
    const children = dimension === "customers" ? [...new Set(rows.map(row => row.type))].map(type => ({
      id: `type:${type}`, label: type === "corporate" ? t("企业客户") : type === "personal" ? t("个人客户") : t("其他"),
      children: rows.filter(row => row.type === type).map(row => ({ id: row.id, label: row.label, value: row.value })),
    })) : rows.map(row => ({ id: row.id, label: row.label, value: row.value }));
    return { id: "contribution", label: t(dimension === "customers" ? "全部客户" : "全部地点"), children };
  }, [dimension, rows, t]);
  const nonnegative = rows.every(row => row.value >= 0);
  const multiple = rows.filter(row => row.value > 0).length > 1;
  return <InsightPanel title={t("贡献分析")} description={t("按客户或地点查看经营贡献")}
    actions={<Button type="text" size="small" onClick={() => onDetails(dimension)}>{t("明细视图")}</Button>}>
    <div className={styles.explorerTools}>
      <Segmented size="small" aria-label={t("分析维度")} value={dimension} onChange={value => { setDimension(value as "customers" | "locations"); setFocus("contribution"); }} options={[{ value: "customers", label: t("客户") }, { value: "locations", label: t("履约地点") }]} />
      <Segmented size="small" aria-label={t("分析指标")} value={metric} onChange={value => setMetric(String(value) as Metric)} options={(Object.entries(shortLabels) as Array<[Metric, string]>).map(([value, label]) => ({ value, label }))} />
    </div>
    {nonnegative && multiple ? <Treemap data={tree} label={t("贡献分析")} height={ADMIN_INSIGHT_METRICS.contributionHeight} formatValue={format} focus={focus} onFocusChange={setFocus} emptyLabel={t("当前筛选下没有订单")} />
      : <RankedFacts rows={[...rows].sort((a, b) => b.value - a.value).map(row => ({ id: row.id, label: row.label, value: row.value, note: `${t("订单量")} ${row.count}` }))} format={format} empty={t("当前筛选下没有订单")} />}
    <div className={styles.explorerFooter}><span>{labels[metric]} · {t("当前筛选范围")}</span>{multiple && nonnegative && <span>{t("点击分类放大，Esc 返回上级")}</span>}</div>
  </InsightPanel>;
}
