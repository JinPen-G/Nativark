import { Empty } from "@/components/ui";
import type { ReactNode } from "react";
import { useLocale } from "@/app/locale";
import { LoadingState } from "./LoadingState";

export function QueryState({ loading, error, children }: { loading: boolean; error?: unknown; children: ReactNode }) {
  const { t } = useLocale();
  if (loading) return <div className="query-state-loading"><LoadingState /></div>;
  if (error) return <Empty description={t("数据暂不可用，请稍后重试")} />;
  return <>{children}</>;
}
// ListSection may inspect the ready body's first child without mounting or
// reimplementing this component. Loading/error branches keep their visible title.
QueryState.listSectionPassthrough = true;
