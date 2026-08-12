import { Empty, Spin } from "antd";
import type { ReactNode } from "react";

export function QueryState({ loading, error, children }: { loading: boolean; error?: unknown; children: ReactNode }) {
  if (loading) return <div style={{ minHeight: 280, display: "grid", placeItems: "center" }}><Spin size="large" /></div>;
  if (error) return <Empty description="数据暂不可用，请检查 API 服务和登录状态" />;
  return <>{children}</>;
}
