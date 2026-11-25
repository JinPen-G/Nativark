/** Optional record context uses the original inline disclosure; stage actions, money and required forms stay outside. */
import type { ReactNode } from "react";
import { ExpandableCard } from "@/registry/components/expandable-card/expandable-card";
import styles from "./RecordDisclosure.module.css";

export function RecordDisclosure({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <div className={styles.group}><ExpandableCard title={title} description={description}>{children}</ExpandableCard></div>;
}
