/** 公共记录详情布局。Core供给当前已获权事实与页头，原返回/事实分组和样式保持。 */
import type { ReactNode } from "react";
import { ArrowLeftOutlined } from "./ui/icons";
import { useLocale } from "../app/locale";
import { PageHeading } from "./PageHeading";
import { Button } from "./ui/Button";
import styles from "./RecordDetailLayout.module.css";

import { RecordFacts, type RecordFact } from "./RecordFacts";
export { RecordFacts, type RecordFact } from "./RecordFacts";

export interface RecordDetailLayoutProps {
  title: string; status?: ReactNode; facts?: RecordFact[]; actions?: ReactNode; onBack: () => void; children: ReactNode;
  brandName?: string;
  /** Core可提供自己的CorePage；函数形式让旧宿主接入同一返回/操作布局。 */
  header?: ReactNode | ((actions: ReactNode) => ReactNode);
}

export function RecordDetailLayout({ title, status, facts, actions, onBack, children, header, brandName = "Nativark" }: RecordDetailLayoutProps) {
  const { t } = useLocale();
  const headerActions = <div className={styles.actions}>{actions}<Button icon={<ArrowLeftOutlined aria-hidden />} onClick={onBack}>{t("返回列表")}</Button></div>;
  return <div className={styles.record} data-copilot-detail="" data-copilot-record="detail" data-copilot-label={title}>
    {typeof header === "function" ? header(headerActions) : header !== undefined ? header : <PageHeading title={title} brandName={brandName} extra={headerActions} />}
    {(status || facts?.length) && <section className={styles.summary} aria-label={t("资料概览")}>
      {status && <div className={styles.status}>{status}</div>}
      {facts?.length ? <RecordFacts items={facts} /> : null}
    </section>}
    <div className={styles.content}>{children}</div>
  </div>;
}

/** 共用详情内容栈，业务页面无需穿透公共CSS模块。 */
export function RecordDetailStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}
