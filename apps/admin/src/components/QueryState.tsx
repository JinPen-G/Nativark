import { Alert, Empty } from "@/components/ui";
import { useRef, type ReactNode } from "react";
import { isTransientRefreshError } from "@/app/queryClient";
import { useLocale } from "@/app/locale";
import { LoadingState } from "./LoadingState";

export function QueryState({ loading, error, children }: { loading: boolean; error?: unknown; children: ReactNode }) {
  const { t } = useLocale();
  const loaded = useRef(false);
  if (!loading && !error) loaded.current = true;
  if (loading) return <div className="query-state-loading"><LoadingState /></div>;
  const transient = Boolean(error && loaded.current && isTransientRefreshError(error));
  if (error && !transient) return <Empty description={t("数据暂不可用，请检查 API 服务和登录状态")} />;
  // Keep children at the same React position while showing/removing the notice,
  // otherwise a transient refresh error would destroy an unsaved editor.
  return <>
    {transient ? <Alert type="warning" showIcon title={t("数据暂未更新，正在自动重试")} /> : null}
    {children}
  </>;
}
