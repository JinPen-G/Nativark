import type { ReactNode } from "react";
import styles from "./DataTable.module.css";

/** One primary fact and its supporting text. Long content grows naturally; no fixed row clipping. */
export function DataTableText({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return <span className={styles.textStack}>
    <span className={styles.textPrimary}>{primary}</span>
    {secondary != null && secondary !== "" && <span className={styles.textSecondary}>{secondary}</span>}
  </span>;
}
