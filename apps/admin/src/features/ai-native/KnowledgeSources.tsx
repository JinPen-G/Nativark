import { ActionButton } from "@/components/ui";
import { useResourceAction } from "./resource-action";
import { safeDisplayLabel } from "./safe-display";
export type KnowledgeSource = {
  id: string;
  title: string;
  version: string;
  status: "available" | "withdrawn" | "expired" | "forbidden" | "index_pending" | "unknown";
  locator?: string;
};
export interface KnowledgeSourcesProps {
  sources?: readonly KnowledgeSource[];
  onOpen?: (source: Pick<KnowledgeSource, "id" | "version">) => void | Promise<void>;
}
const label: Record<KnowledgeSource["status"], string> = {
  available: "可查看",
  withdrawn: "已撤回",
  expired: "已失效",
  forbidden: "无权限",
  index_pending: "索引待更新",
  unknown: "状态待核对",
};
export function KnowledgeSources({ sources, onOpen }: KnowledgeSourcesProps) {
  const rows: readonly KnowledgeSource[] = Array.isArray(sources) ? sources.slice(0, 50).filter(source => source && typeof source.id === "string" && typeof source.version === "string").map(source => ({
    ...source,
    title: safeDisplayLabel(source.title, "未命名来源"),
    locator: safeDisplayLabel(source.locator, "不可用"),
  })) : [];
  const signature = JSON.stringify(rows.map(source => [source.id, source.version, source.status]));
  const action = useResourceAction(signature, onOpen);
  if (!sources) return <p role="status">知识来源不可用</p>;
  if (!sources.length) return <p role="status">没有可展示的来源</p>;
  return (
    <ul aria-label="知识来源">
      {rows.map((source) => (
        <li key={`${source.id}:${source.version}`}>
          <span>{source.status === "available" ? source.title : "来源内容不可用"}</span>
          <small>版本 {source.version}</small>
          <span>{label[source.status] ?? "状态待核对"}</span>
          {source.status === "available" && (
            <ActionButton
              key={signature}
              label="查看来源"
              pendingLabel="正在打开…"
              successLabel="打开操作已结束"
              onAction={() => action.run(JSON.stringify([source.id, source.version]), { id: source.id, version: source.version })}
              disabled={!onOpen || action.pendingKey !== null}
            />
          )}
          {action.errorKey === JSON.stringify([source.id, source.version]) && <small role="alert">来源打开失败，请重试</small>}
        </li>
      ))}
    </ul>
  );
}
