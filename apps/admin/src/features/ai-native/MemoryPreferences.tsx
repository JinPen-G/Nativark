import { ActionButton } from "@/components/ui";
import { useResourceAction } from "./resource-action";
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
  const rows: readonly MemoryPreference[] = Array.isArray(items) ? items.slice(0, 50).filter(item => item && typeof item.id === "string" && typeof item.revision === "string") : [];
  const signature = JSON.stringify(rows.map(item => [item.id, item.revision, item.status, item.actorKind, item.value, item.expiresAt]));
  const action = useResourceAction(signature, onReview);
  if (!items) return <p role="status">记忆与偏好不可用</p>;
  return (
    <ul aria-label="记忆与偏好">
      {rows.map((item) => (
        <li key={`${item.id}:${item.revision}`}>
          <span>{item.label}</span>
          <span>{(item.status === "confirmed" && item.actorKind === "human") || item.status === "proposed" ? item.value : "内容不可用"}</span>
          <span>{item.status === "confirmed" && item.actorKind !== "human" ? "确认依据待核对" : labels[item.status] ?? "状态待核对"}</span>
          {item.actorKind === "automation" && (
            <small>自动化建议，不代表用户已确认</small>
          )}
          {item.status === "proposed" && (
            <ActionButton
              key={signature}
              disabled={!onReview || action.pendingKey !== null}
              label="人工核对"
              pendingLabel="处理中…"
              successLabel="核对入口已处理"
              onAction={() => action.run(JSON.stringify([item.id, item.revision]), { id: item.id, revision: item.revision })}
            />
          )}
          {action.errorKey === JSON.stringify([item.id, item.revision]) && <small role="alert">核对启动失败，请重试</small>}
        </li>
      ))}
    </ul>
  );
}
