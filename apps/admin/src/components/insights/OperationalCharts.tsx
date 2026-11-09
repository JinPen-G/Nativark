/** Presentation of existing report facts. No forecasting, permission decisions or monetary recalculation. */
import type { ReactNode } from "react";
import { AnimatedNumber, DonutChart, Empty, Segmented, type DonutChartDatum } from "@/components/ui";
import { AnimatedCountText } from "@/components/ui/AnimatedNumber";
import { useLocale } from "@/app/locale";
import { ADMIN_INSIGHT_METRICS } from "@/app/designTokens";
import styles from "./OperationalCharts.module.css";

export function InsightPanel({ title, description, actions, children, className = "" }: {
  title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={`${styles.panel} ${className}`}>
    <header className={styles.heading}><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions}</header>
    <div className={styles.body}>{children}</div>
  </section>;
}

export function MetricBand({ items }: { items: { label: string; value: number | string; detail: string }[] }) {
  return <dl className={styles.metrics}>{items.map(item => <div key={item.label} data-copilot-record={`metric:${item.label}`} data-copilot-label={item.label}>
    <dt>{item.label}</dt><dd data-copilot-field="amount">{typeof item.value === "number" ? <AnimatedNumber value={item.value} /> : <AnimatedCountText text={item.value} />}</dd><p>{item.detail}</p>
  </div>)}</dl>;
}

export function DistributionChart({ title, rows, unit, format }: { title: string; rows: DonutChartDatum[]; unit?: string; format?: (value: number) => string }) {
  const { t, locale } = useLocale();
  return <div className={styles.distribution}><DonutChart data={rows} label={title} totalLabel={t("合计")} unit={unit} size={ADMIN_INSIGHT_METRICS.donutSize}
    thickness={ADMIN_INSIGHT_METRICS.donutThickness} legendAction="select" otherLabel={t("其他")}
    groupBelow={0} maxSegments={rows.length + 1}
    emptyLabel={t("暂无数据")} formatValue={format ?? (value => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value))} /></div>;
}

export function RankedFacts({ rows, empty, format = String }: { rows: { id: string; label: ReactNode; value: number; note?: ReactNode; onOpen?: () => void }[]; empty: string; format?: (value: number) => string }) {
  const max = Math.max(0, ...rows.map(row => row.value));
  return rows.length ? <ol className={styles.ranking}>{rows.map((row, index) => <li key={row.id}>
    <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
    <div className={styles.rankBody}><div className={styles.rankTitle}>{row.onOpen ? <button onClick={row.onOpen}>{row.label}</button> : <span>{row.label}</span>}<strong>{format(row.value)}</strong></div>
      <div className={styles.track} aria-hidden="true"><span style={{ width: `${max ? Math.max(0, row.value) / max * 100 : 0}%` }} /></div>{row.note && <p>{row.note}</p>}</div>
  </li>)}</ol> : <Empty description={empty} />;
}

export function ViewChoice({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <Segmented size="small" value={value} onChange={value => onChange(String(value))} options={options} />;
}
