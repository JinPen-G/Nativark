/** Presentation only: split the canonical business-formatted string without
 * recalculating amounts, guessing currency symbols or moving negative signs.
 * Both static cells and the numeric morph renderer use this same component. */
import styles from "./DataTable.module.css";

export function DataTableMoney({ formatted }: { formatted: string }) {
  const parts = /^(-?)(.*?)(-?)(\d[\d,]*\.\d{2})$/u.exec(formatted);
  return <span className={styles.money} data-slot="table-money">
    {parts ? <>
      {parts[1] && <span className={styles.moneyValue}>{parts[1]}</span>}
      {parts[2] && <span className={styles.moneyCurrency}>{parts[2]}</span>}
      {parts[3] && <span className={styles.moneyValue}>{parts[3]}</span>}
      <span className={styles.moneyValue}>{parts[4]}</span>
    </> : <span className={styles.moneyMissing}>{formatted}</span>}
  </span>;
}
