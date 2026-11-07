import type { ReactNode } from "react";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { BarChart } from "@/registry/components/bar-chart/bar-chart";
import { useLocale } from "@/app/locale";
import styles from "./BusinessInsights.module.css";

export function InsightMetrics({ items }: { items: { label: string; value?: number; suffix?: string }[] }) {
  return <dl className={styles.metrics}>{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value === undefined ? "—" : <AnimatedNumber value={item.value} suffix={item.suffix} />}</dd></div>)}</dl>;
}

export function InsightColumns({ children }: { children: ReactNode }) { return <div className={styles.columns}>{children}</div>; }

export function InsightSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className={styles.section}><header><h2>{title}</h2>{description && <p>{description}</p>}</header>{children}</section>;
}

export function BusinessTrend({ data, label, unit }: { data: { month: string; value: number }[]; label: string; unit?: string }) {
  const { t, locale } = useLocale();
  return <BarChart data={data.map(row => ({ key: row.month, label: row.month, axisLabel: row.month.slice(5), value: row.value }))}
    label={label} period={data.length ? `${data[0].month} – ${data[data.length - 1].month}` : ""} unit={unit}
    averageLabel={t("月均")} valueLabel={t("当月")} categoryLabel={t("月份")} showAverage height={180}
    formatValue={value => new Intl.NumberFormat(locale).format(value)} />;
}

export function BusinessTimeline({ items, empty }: { items: { id: string; title: ReactNode; detail?: ReactNode; at: string }[]; empty: string }) {
  const { locale } = useLocale();
  return items.length ? <ol className={styles.timeline}>{items.map(item => <li key={item.id}><div>{item.title}{item.detail && <p>{item.detail}</p>}</div><time dateTime={item.at}>{new Date(item.at).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></li>)}</ol> : <p className={styles.empty}>{empty}</p>;
}
