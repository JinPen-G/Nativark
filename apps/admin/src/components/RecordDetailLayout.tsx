import type { ReactNode } from "react";
import { ArrowLeftOutlined } from "@/components/ui/icons";
import { useLocale } from "@/app/locale";
import { PageHeader } from "./PageHeader";
import { Button } from "./ui";
import styles from "./RecordDetailLayout.module.css";

export type RecordFact = { key: string; label: string; value: ReactNode; wide?: boolean };

/** Read-only detail geometry. Permissions, queries and commands stay with each domain. */
export function RecordFacts({ items }: { items: RecordFact[] }) {
  const { t } = useLocale();
  return <dl className={styles.facts}>{items.map(item => <div key={item.key} className={item.wide ? styles.wide : undefined}><dt>{t(item.label)}</dt><dd data-copilot-field={item.key} data-copilot-label={t(item.label)}>{item.value ?? "—"}</dd></div>)}</dl>;
}

export function RecordDetailLayout({ title, status, facts, actions, onBack, children }: {
  title: string; status?: ReactNode; facts?: RecordFact[]; actions?: ReactNode; onBack: () => void; children: ReactNode;
}) {
  const { t } = useLocale();
  return <div className={styles.record} data-copilot-detail="" data-copilot-record="detail" data-copilot-label={title}>
    <PageHeader title={title} extra={<div className={styles.actions}>{actions}<Button icon={<ArrowLeftOutlined aria-hidden />} onClick={onBack}>{t("返回列表")}</Button></div>} />
    {(status || facts?.length) && <section className={styles.summary} aria-label={t("资料概览")}>
      {status && <div className={styles.status}>{status}</div>}
      {facts?.length ? <RecordFacts items={facts} /> : null}
    </section>}
    <div className={styles.content}>{children}</div>
  </div>;
}
