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
  onReview?: (item: Pick<MemoryPreference, "id" | "revision">) => void;
}
const labels: Record<MemoryPreference["status"], string> = {
  proposed: "待确认",
  confirmed: "已确认",
  expired: "已过期",
  revoked: "已撤回",
};
export function MemoryPreferences({ items, onReview }: MemoryPreferencesProps) {
  if (!items) return <p role="status">记忆与偏好不可用</p>;
  return (
    <ul aria-label="记忆与偏好">
      {items.map((item) => (
        <li key={`${item.id}:${item.revision}`}>
          <span>{item.label}</span>
          <span>{item.value}</span>
          <span>{labels[item.status]}</span>
          {item.actorKind === "automation" && (
            <small>自动化建议，不代表用户已确认</small>
          )}
          {item.status === "proposed" && (
            <Button
              disabled={!onReview}
              onClick={() =>
                onReview?.({ id: item.id, revision: item.revision })
              }
            >
              人工核对
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
