import { Button } from "@/components/ui";
export type KnowledgeSource = {
  id: string;
  title: string;
  version: string;
  status: "available" | "withdrawn" | "expired" | "forbidden" | "index_pending";
  locator?: string;
};
export interface KnowledgeSourcesProps {
  sources?: readonly KnowledgeSource[];
  onOpen?: (source: Pick<KnowledgeSource, "id" | "version">) => void;
}
const label: Record<KnowledgeSource["status"], string> = {
  available: "可查看",
  withdrawn: "已撤回",
  expired: "已失效",
  forbidden: "无权限",
  index_pending: "索引待更新",
};
export function KnowledgeSources({ sources, onOpen }: KnowledgeSourcesProps) {
  if (!sources) return <p role="status">知识来源不可用</p>;
  if (!sources.length) return <p role="status">没有可展示的来源</p>;
  return (
    <ul aria-label="知识来源">
      {sources.map((source) => (
        <li key={`${source.id}:${source.version}`}>
          <span>{source.title || "未命名来源"}</span>
          <small>版本 {source.version}</small>
          <span>{label[source.status] ?? "状态待核对"}</span>
          {source.status === "available" && (
            <Button
              onClick={() =>
                onOpen?.({ id: source.id, version: source.version })
              }
              disabled={!onOpen}
            >
              查看来源
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
