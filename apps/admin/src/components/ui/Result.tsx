/** Full-page results share the same UIArc state surface as tenant empty states.
 * Callers own authorization and real outcomes; this component never retries or redirects. */
import type { ReactNode } from "react";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { CheckCircleOutlined, InfoCircleOutlined, LockOutlined, WarningFilled } from "./icons";
import { EmptyScene } from "./EmptyScene";
import styles from "./empty-scene/EmptyScene.module.css";

export interface ResultProps {
  status?: "success" | "info" | "warning" | "error" | "403" | "404" | "500";
  title: string;
  subTitle?: string;
  extra?: ReactNode;
  icon?: ReactNode;
}

export function Result({ status = "info", title, subTitle = "", extra, icon }: ResultProps) {
  if (status === "404" && !icon) return <EmptyScene scene="map" title={title} description={subTitle} action={extra} />;
  const Glyph = status === "403" ? LockOutlined : status === "success" ? CheckCircleOutlined
    : status === "info" ? InfoCircleOutlined : WarningFilled;
  return <div className={`${styles.root} ${styles.symbol}`} data-result-status={status} data-has-description={Boolean(subTitle)}>
    <EmptyState label={title} title={title} description={subTitle} icon={icon ?? <Glyph />} action={extra} />
  </div>;
}
