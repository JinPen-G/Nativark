import { useState } from "react";
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
  onOpen?: (source: Pick<KnowledgeSource, "id" | "version">) => void | Promise<void>;
}
const label: Record<KnowledgeSource["status"], string> = {
  available: "可查看",
  withdrawn: "已撤回",
  expired: "已失效",
  forbidden: "无权限",
  index_pending: "索引待更新",
};
export function KnowledgeSources({ sources, onOpen }: KnowledgeSourcesProps) {
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  if (!sources) return <p role="status">知识来源不可用</p>;
  if (!sources.length) return <p role="status">没有可展示的来源</p>;
  return (
    <ul aria-label="知识来源">
      {sources.map((source) => (
        <li key={`${source.id}:${source.version}`}>
          <span>{source.status === "available" ? source.title || "未命名来源" : "来源内容不可用"}</span>
          <small>版本 {source.version}</small>
          <span>{label[source.status] ?? "状态待核对"}</span>
          {source.status === "available" && (
            <Button
              onClick={async () => {
                if (!onOpen || opening) return;
                const key = `${source.id}:${source.version}`;
                setOpening(key);
                setOpenError(null);
                try {
                  await onOpen({ id: source.id, version: source.version });
                } catch {
                  setOpenError(key);
                } finally {
                  setOpening(null);
                }
              }}
              disabled={!onOpen || opening !== null}
            >
              {opening === `${source.id}:${source.version}` ? "正在打开…" : "查看来源"}
            </Button>
          )}
          {openError === `${source.id}:${source.version}` && <small role="alert">来源打开失败，请重试</small>}
        </li>
      ))}
    </ul>
  );
}
