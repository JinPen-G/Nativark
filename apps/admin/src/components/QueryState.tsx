import { Empty, Spin } from "antd";
import type { ReactNode } from "react";
import { useLocale } from "@/app/locale";

export function QueryState({ loading, error, children }: { loading: boolean; error?: unknown; children: ReactNode }) {
  const { t } = useLocale();
  if (loading) return <div style={{ minHeight: 280, display: "grid", placeItems: "center" }}><Spin size="large" /></div>;
  if (error) return <Empty description={t("数据暂不可用，请检查 API 服务和登录状态")} />;
  return <>{children}</>;
}
