import { ActionButton, Alert, EmptyScene } from "@/components/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isTransientRefreshError } from "@/app/queryClient";
import { useLocale } from "@/app/locale";
import { LoadingState } from "./LoadingState";
import { useTableRefresh } from "./ui/data-table/TableRefreshContext";
import { ContentTransition } from "./workspace/ContentTransition";

export function QueryState({ loading, error, onRetry, children, transitionKey = "" }: { loading: boolean; error?: unknown; onRetry?: () => unknown; children: ReactNode; transitionKey?: string }) {
  const { t } = useLocale();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const reader = useTableRefresh();
  const retry = onRetry ?? reader.onRefresh;
  const loaded = useRef({ key: transitionKey, ready: false });
  if (loaded.current.key !== transitionKey) loaded.current = { key: transitionKey, ready: false };
  if (!loading && !error) loaded.current.ready = true;
  const transient = Boolean(error && loaded.current.ready && isTransientRefreshError(error));
  const disconnected = !online && isTransientRefreshError(error) && !(error as { response?: { status?: number } } | undefined)?.response?.status;
  const phase = loading ? "loading" : error && !transient ? "error" : "ready";
  const retryAction = retry && <ActionButton variant="secondary" label={t("重试")} pending={reader.busy} onAction={async () => {
    const result = await retry();
    // Query.refetch may resolve to an error result; that is not a successful retry.
    const failed = (value: unknown): boolean => Array.isArray(value) ? value.some(failed) : Boolean(value && typeof value === "object" && "isError" in value && value.isError);
    if (failed(result)) throw new Error(t("数据暂不可用，请稍后重试"));
  }} />;
  return <ContentTransition value={`${transitionKey}:${phase}`}>{loading
    ? <div className="query-state-loading"><LoadingState /></div>
    : error && !transient
      ? disconnected ? <EmptyScene scene="offline" title={t("网络连接已断开")} action={retryAction} />
        : <Alert type="error" showIcon title={t("数据暂不可用，请稍后重试")} action={retryAction} />
      : <>
        {transient ? <Alert type="warning" showIcon title={t("数据暂未更新，正在自动重试")} action={retryAction} /> : null}
        {children}
      </>}</ContentTransition>;
}
// ListSection may inspect the ready body's first child without mounting or
// reimplementing this component. Loading/error branches keep their visible title.
QueryState.listSectionPassthrough = true;
