import { useState } from "react";
import { Button } from "@/components/ui";
export type MemoryPreference = {
  id: string;
  label: string;
  value: string;
  status: "proposed" | "confirmed" | "expired" | "revoked";
  actorKind: "human" | "automation" | "system";
  revision: string;
  expiresAt?: string;
};
export interface MemoryPreferencesProps {
  items?: readonly MemoryPreference[];
  onReview?: (item: Pick<MemoryPreference, "id" | "revision">) => void | Promise<void>;
}
const labels: Record<MemoryPreference["status"], string> = {
  proposed: "待确认",
  confirmed: "已确认",
  expired: "已过期",
  revoked: "已撤回",
};
export function MemoryPreferences({ items, onReview }: MemoryPreferencesProps) {
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  if (!items) return <p role="status">记忆与偏好不可用</p>;
  return (
    <ul aria-label="记忆与偏好">
      {items.map((item) => (
        <li key={`${item.id}:${item.revision}`}>
          <span>{item.label}</span>
          <span>{item.status === "confirmed" || item.status === "proposed" ? item.value : "内容不可用"}</span>
          <span>{labels[item.status]}</span>
          {item.actorKind === "automation" && (
            <small>自动化建议，不代表用户已确认</small>
          )}
          {item.status === "proposed" && (
            <Button
              disabled={!onReview || reviewing !== null}
              onClick={async () => {
                if (!onReview || reviewing) return;
                const key = `${item.id}:${item.revision}`;
                setReviewing(key);
                setReviewError(null);
                try {
                  await onReview({ id: item.id, revision: item.revision });
                } catch {
                  setReviewError(key);
                } finally {
                  setReviewing(null);
                }
              }}
            >
              {reviewing === `${item.id}:${item.revision}` ? "处理中…" : "人工核对"}
            </Button>
          )}
          {reviewError === `${item.id}:${item.revision}` && <small role="alert">核对启动失败，请重试</small>}
        </li>
      ))}
    </ul>
  );
}
