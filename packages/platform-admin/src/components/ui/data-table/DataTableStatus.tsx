/** Tablecn outline Badge port plus the explicitly selected host soft variant.
 * Original source is reserved in packages/ui-tablecn/vendor/components/ui/badge.tsx.
 * Domains supply meaningful Lucide icons/labels. Semantic tint is a host extension.
 * Change motion remains owned by DataTableCellMotion, not a second animation on the badge.
 */
import type { ReactNode } from "react";
import { CircleCheck, CircleDashed, CircleHelp, CircleX, Timer, TriangleAlert, type LucideIcon } from "lucide-react";
import styles from "./DataTable.module.css";

export type DataTableStatusTone = "success" | "warning" | "error" | "info" | "neutral" | "active";
/** Secondary progress/reminders are annotations, never another primary badge. */
export function DataTableNote({ tone = "neutral", icon: Icon, children }: {
  tone?: "neutral" | "warning"; icon: LucideIcon; children: ReactNode;
}) {
  return <span className={styles.statusNote} data-slot="table-note" data-tone={tone}>
    <Icon aria-hidden="true" focusable="false" /><span>{children}</span>
  </span>;
}
const fallbackIcons: Record<DataTableStatusTone, LucideIcon> = {
  success: CircleCheck, warning: TriangleAlert, error: CircleX,
  info: CircleHelp, neutral: CircleDashed, active: Timer,
};
export function DataTableStatus({ tone = "neutral", icon, tinted = false, variant = "outline", children }: {
  tone?: DataTableStatusTone; icon?: LucideIcon; tinted?: boolean; variant?: "outline" | "soft"; children: ReactNode;
}) {
  const Icon = icon ?? fallbackIcons[tone];
  return <span className={styles.statusPill} data-slot="badge" data-variant={variant} data-tone={tone} data-tinted={tinted || undefined}>
    <Icon data-icon="inline-start" aria-hidden="true" focusable="false" />
    <span>{children}</span>
  </span>;
}
