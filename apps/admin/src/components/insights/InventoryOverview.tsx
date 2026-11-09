/** Current server inventory snapshots. Chart exploration never changes inventory or the complete facts. */
import { useState } from "react";
import type { RentalAssetStatus, RentalWorkspaceUtilization } from "@rental-os/shared";
import { AnimatedNumber, Button, Segmented } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { SplitBar } from "./split-bar/SplitBar";
import { retainedHiddenSegments } from "./chartVisibility";
import styles from "./OperationalCharts.module.css";

const assetLabels: Record<RentalAssetStatus, string> = {
  available: "可用", reserved: "已预占", rented: "在租", inspection: "检查中", maintenance: "维护中", disabled: "已停用",
};
const assetColors: Record<RentalAssetStatus, string> = {
  available: "var(--rental-status-success-ink)", reserved: "var(--rental-status-info-ink)", rented: "var(--series-2)",
  inspection: "var(--rental-status-warning-ink)", maintenance: "var(--series-3)", disabled: "var(--text-secondary)",
};

export function InventoryOverview({ utilization }: { utilization: RentalWorkspaceUtilization }) {
  const { t, locale } = useLocale();
  const assets = utilization.serializedAssets, stock = utilization.quantityStock;
  const [choice, setChoice] = useState<string>();
  const [hiddenAssets, setHiddenAssets] = useState<readonly string[]>([]);
  const [hiddenStock, setHiddenStock] = useState<readonly string[]>([]);
  const mode = choice ?? (assets.totalCount > 0 ? "assets" : "stock");
  const serialized = mode === "assets";
  const segments = serialized
    ? assets.statusBreakdown.filter(row => row.count > 0).map(row => ({ id: row.status, label: t(assetLabels[row.status]), value: row.count, color: assetColors[row.status] }))
    : [
      { id: "available", label: t("可用"), value: stock.availableTotal, color: "var(--rental-status-success-ink)" },
      { id: "reserved", label: t("已预占"), value: stock.reservedTotal, color: "var(--rental-status-info-ink)" },
      { id: "maintenance", label: t("维护/清洁"), value: stock.maintenanceTotal, color: "var(--series-3)" },
    ].filter(row => row.value > 0);
  const hidden = retainedHiddenSegments(segments, serialized ? hiddenAssets : hiddenStock);
  const updateHidden = serialized ? setHiddenAssets : setHiddenStock;
  const facts = serialized ? [
    { label: t("在册资产数"), value: assets.totalCount },
    { label: t("可运营资产数"), value: assets.operableCount },
    { label: t("在租资产数"), value: assets.rentedCount },
    { label: t("在租占比"), value: `${(assets.rentedRatio * 100).toFixed(2)}%` },
  ] : [
    { label: t("在手"), value: stock.onHandTotal },
    { label: t("可租余量"), value: stock.availableTotal },
    { label: t("已预占"), value: stock.reservedTotal },
    { label: t("维护/清洁"), value: stock.maintenanceTotal },
  ];
  return <div className={styles.inventory}>
    <Segmented size="small" aria-label={t("库存视图")} value={mode} onChange={value => setChoice(String(value))} options={[
      { value: "assets", label: t("序列化资产") }, { value: "stock", label: t("数量库存") },
    ]} />
    {segments.length ? <SplitBar key={mode} segments={segments} locale={locale} title={t(serialized ? "资产状态分布" : "库存数量分布")}
      totalLabel={t("图中合计")} hidden={hidden} onHiddenChange={updateHidden} />
      : <p className={styles.note}>{t(serialized ? "当前经营空间尚无序列化资产" : "当前经营空间尚无数量库存")}</p>}
    {hidden.length > 0 && <div className={styles.chartFilter}><span>{t("图例筛选仅影响图中占比")}</span><Button size="small" type="text" onClick={() => updateHidden([])}>{t("显示全部分类")}</Button></div>}
    <dl className={styles.snapshotFacts}>{facts.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{typeof item.value === "number" ? <AnimatedNumber value={item.value} /> : item.value}</dd></div>)}</dl>
    {!serialized && stock.reservedTotal + stock.maintenanceTotal > stock.onHandTotal && <p className={styles.warning}>{t("已预占")} + {t("维护/清洁")} &gt; {t("在手")}</p>}
    <p className={styles.snapshotTime}>{t("当前快照")} · {new Date(serialized ? assets.snapshotAt : stock.snapshotAt).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
  </div>;
}
