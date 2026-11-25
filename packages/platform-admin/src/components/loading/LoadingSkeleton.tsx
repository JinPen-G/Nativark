import type { CSSProperties } from "react";
import { Skeleton } from "../ui/Skeleton";
import styles from "./LoadingSkeleton.module.css";

/** Geometry only: the original UIArc Skeleton owns color, pulse and reduced motion. */
export function SkeletonBlock({ width, className = "" }: {
  width?: CSSProperties["width"]; className?: string;
}) {
  return <div className={`${styles.block} ${className}`} data-kind="text" style={width ? { width } : undefined} aria-hidden="true">
    <Skeleton lines={1} />
  </div>;
}

/** Cell roles also work for lists with different visible/pinned column sets. */
export function TableSkeletonCell({ columnId }: { columnId: string }) {
  // Selection/actions and secondary cell content do not need their own shapes.
  if (columnId === "select" || columnId === "actions") return null;
  return <SkeletonBlock width={/amount|money/i.test(columnId) ? "60%" : "70%"} />;
}
