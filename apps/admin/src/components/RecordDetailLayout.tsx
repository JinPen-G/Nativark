import type { ReactNode } from "react";
import { ArrowLeftOutlined } from "@/components/ui/icons";
import { useLocale } from "@/app/locale";
import { PageHeader } from "./PageHeader";
import { Button } from "./ui";
import styles from "./RecordDetailLayout.module.css";

import { RecordFacts, type RecordFact } from "@rental-os/platform-admin/shell";
export { RecordFacts, type RecordFact } from "@rental-os/platform-admin/shell";

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
