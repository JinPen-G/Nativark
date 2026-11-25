/** 原列表摘要的紧凑事实行，公共设置与业务页面共用同一呈现。 */
import { AnimatedNumber } from "./ui/AnimatedNumber";
import styles from "./InsightMetrics.module.css";

export function InsightMetrics({ items }: { items: { label: string; value?: number; suffix?: string }[] }) {
  return <dl className={styles.metrics}>{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value === undefined ? "—" : <AnimatedNumber value={item.value} suffix={item.suffix} />}</dd></div>)}</dl>;
}
