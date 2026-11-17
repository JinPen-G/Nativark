import type { ReactNode } from "react";
import { useLocale } from "../app/locale";
import styles from "./RecordFacts.module.css";

export type RecordFact = { key: string; label: string; value: ReactNode; wide?: boolean };

/** Read-only detail geometry. Permissions, queries and commands stay with each domain. */
export function RecordFacts({ items }: { items: RecordFact[] }) {
  const { t } = useLocale();
  return <div className={styles.factsContainer}><dl className={styles.facts}>{items.map(item => <div key={item.key} className={item.wide ? styles.wide : undefined}><dt>{t(item.label)}</dt><dd data-copilot-field={item.key} data-copilot-label={t(item.label)}>{item.value ?? "—"}</dd></div>)}</dl></div>;
}
