/** Inline exploration of report facts, built from the existing UIArc controls and number motion. */
import { useId, useRef, useState } from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { ChevronDown, X } from "lucide-react";
import { formatRentalMoney, type RentalWorkspaceOperationReport } from "@rental-os/shared";
import { AnimatedNumber, Button } from "@/components/ui";
import { AnimatedCountText } from "@/components/ui/AnimatedNumber";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { useLocale } from "@/app/locale";
import { motionTokens } from "@/lib/motion-tokens";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { overviewOrderFacts } from "./workbenchPresentation";
import styles from "./WorkbenchOverview.module.css";

type MetricId = "orders" | "receivable" | "revenue" | "inventory";
type Metric = { id: MetricId; label: string; value: number | string; detail: string };

export function WorkbenchMetrics({ data, periodLabel, orders, assets, busy, onOpen }: {
  data: RentalWorkspaceOperationReport; periodLabel: string; orders: boolean; assets: boolean; busy: boolean;
  onOpen: (target: "orders" | "report" | "assets") => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const [selected, setSelected] = useState<MetricId>();
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const money = (value: number) => formatRentalMoney(value, data.currency);
  const facts = overviewOrderFacts(data);
  const items: Metric[] = [
    ...(orders ? [
      { id: "orders" as const, label: t("期间订单"), value: data.orderCount, detail: `${periodLabel} · ${t("非草稿")}` },
      { id: "receivable" as const, label: t("应收金额"), value: money(data.receivableTotal), detail: t("调账后应收") },
      { id: "revenue" as const, label: t("租赁收入"), value: money(data.rentalRevenue), detail: t("只含租金") },
    ] : []),
    ...(assets ? [{ id: "inventory" as const, label: t("可租库存"), value: facts.availableAssets + data.utilization.quantityStock.availableTotal, detail: t("当前快照") }] : []),
  ];
  const metric = items.find(item => item.id === selected);
  const close = () => { setSelected(undefined); if (selected) triggers.current.get(selected)?.focus(); };

  return <section className={styles.metricPanel} aria-label={t("经营指标")} aria-busy={busy} onKeyDown={event => {
    if (event.key === "Escape" && selected) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <div className={styles.metricGrid}>
      {items.map(item => <Button key={item.id} type="text" className={`${styles.metricToggle} ${styles.wideControl}`}
        ref={node => { if (node) triggers.current.set(item.id, node); else triggers.current.delete(item.id); }}
        aria-label={t("{metric}：{value}，查看明细", { metric: item.label, value: item.value })}
        aria-expanded={selected === item.id} aria-controls={`${id}-detail`} data-selected={selected === item.id || undefined}
        onClick={() => setSelected(previous => previous === item.id ? undefined : item.id)}>
        <span className={styles.metricContent} data-copilot-record={`metric:${item.id}`} data-copilot-label={item.label}>
          <span className={styles.metricLabel}>{item.label}<ChevronDown size={14} aria-hidden="true" /></span>
          <span className={styles.metricValue} data-copilot-field="amount">{typeof item.value === "number" ? <AnimatedNumber value={item.value} /> : <AnimatedCountText text={item.value} />}</span>
          <span className={styles.metricNote}>{item.detail}</span>
        </span>
      </Button>)}
    </div>
    <AnimatePresence initial={false}>
      {metric && <MetricDetail key="detail" id={`${id}-detail`} metric={metric} data={data} onClose={close} onOpen={onOpen} busy={busy} />}
    </AnimatePresence>
  </section>;
}

function MetricDetail({ id, metric, data, onClose, onOpen, busy }: {
  id: string; metric: Metric; data: RentalWorkspaceOperationReport; onClose: () => void;
  onOpen: (target: "orders" | "report" | "assets") => void; busy: boolean;
}) {
  const { t } = useLocale();
  const reduced = usePrefersReducedMotion();
  const present = useIsPresent();
  const money = (value: number) => formatRentalMoney(value, data.currency);
  const facts = overviewOrderFacts(data);
  const rows = metric.id === "orders" ? [
    { label: t("履约中"), value: facts.active }, { label: t("已关闭"), value: facts.completed },
    { label: t("异常订单"), value: data.exceptionOrderCount }, { label: t("平均租期"), value: `${data.utilization.orderOccupancy.averageHours} ${t("小时")}` },
  ] : metric.id === "receivable" ? [
    { label: t("不含税应收"), value: money(data.netOfTaxTotal) }, { label: t("价内税"), value: money(data.taxTotal) },
  ] : metric.id === "revenue" ? [
    { label: t("租赁收入"), value: money(data.rentalRevenue) }, { label: t("优惠金额"), value: money(data.discountTotal) },
    { label: t("异常费用"), value: money(data.exceptionFeeTotal) },
  ] : [
    { label: t("可租独立资产"), value: facts.availableAssets }, { label: t("数量库存可租余量"), value: data.utilization.quantityStock.availableTotal },
  ];
  const descriptions: Record<MetricId, string> = {
    orders: "订单按起租时间归入所选期间。异常订单指产生过异常费用的订单。",
    receivable: "价内税已包含在应收中；应收金额不代表实际到账。",
    revenue: "租赁收入仅含租金；优惠与异常费用分别列示，不在此相加。",
    inventory: "独立资产与数量库存的当前可租量，库存快照不随报表日期变化。",
  };
  const target = metric.id === "orders" ? "orders" : metric.id === "inventory" ? "assets" : "report";
  return <motion.div id={id} role="region" aria-label={t("{metric}明细", { metric: metric.label })} inert={!present || undefined}
    className={styles.metricDetail} initial={{ height: reduced ? "auto" : 0, opacity: reduced ? 1 : 0 }}
    animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
    transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}>
    <ContentTransition value={metric.id}>
      <div className={styles.metricDetailInner}>
        <div className={styles.detailHeading}><h2>{t("{metric}明细", { metric: metric.label })}</h2><Button type="text" size="small" icon={<X size={16} />} onClick={onClose} aria-label={t("收起指标明细")} /></div>
        <dl className={styles.detailFacts}>{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{typeof row.value === "number" ? <AnimatedNumber value={row.value} /> : row.value}</dd></div>)}</dl>
        <div className={styles.detailFooter}><p>{t(descriptions[metric.id])}</p><Button size="small" disabled={busy} onClick={() => onOpen(target)}>{t(target === "orders" ? "查看订单" : target === "assets" ? "资产与库存" : "经营报表")}</Button></div>
      </div>
    </ContentTransition>
  </motion.div>;
}
