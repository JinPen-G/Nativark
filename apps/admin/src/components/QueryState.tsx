import { ActionButton, Alert } from "@/components/ui";
import type { ReactNode } from "react";
import { useLocale } from "@/app/locale";
import { LoadingState } from "./LoadingState";
import { useTableRefresh } from "./ui/data-table/TableRefreshContext";

export function QueryState({ loading, error, onRetry, children }: { loading: boolean; error?: unknown; onRetry?: () => unknown; children: ReactNode }) {
  const { t } = useLocale();
  const reader = useTableRefresh();
  const retry = onRetry ?? reader.onRefresh;
  if (loading) return <div className="query-state-loading"><LoadingState /></div>;
  if (error) return <Alert type="error" showIcon title={t("数据暂不可用，请稍后重试")} action={retry && <ActionButton variant="secondary" label={t("重试")} pending={reader.busy} onAction={async () => {
    const result = await retry();
    // Query.refetch may resolve to an error result; that is not a successful retry.
    const failed = (value: unknown): boolean => Array.isArray(value) ? value.some(failed) : Boolean(value && typeof value === "object" && "isError" in value && value.isError);
    if (failed(result)) throw new Error(t("数据暂不可用，请稍后重试"));
  }} />} />;
  return <>{children}</>;
}
// ListSection may inspect the ready body's first child without mounting or
// reimplementing this component. Loading/error branches keep their visible title.
QueryState.listSectionPassthrough = true;
