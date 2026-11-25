/** 一个宿主一份查询缓存与请求代次；身份/业务范围切换先中止旧请求，再清缓存。
 * 这个本地围栏不证明业务写入回滚，unknown 继续由原 Core 收据核对。 */
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { createMutationSoundCallbacks } from "../features/sound/mutationSound";

export function createAdminSessionQueries(authenticated: () => boolean) {
  let epoch = 0;
  let abort = new AbortController();
  const currentSessionEpoch = () => epoch;
  const currentSessionSignal = () => abort.signal;
  const queryClient = new QueryClient({
    mutationCache: new MutationCache(createMutationSoundCallbacks(currentSessionEpoch)),
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: true,
        refetchIntervalInBackground: false,
        refetchInterval: query => {
          if (!authenticated() || query.meta?.liveRefresh === false) return false;
          const status = (query.state.error as { response?: { status?: number } } | null)?.response?.status;
          if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
          return Math.min(30_000, 3_000 * 2 ** Math.min(query.state.fetchFailureCount, 4));
        },
        staleTime: 30_000
      },
      mutations: { retry: false }
    }
  });
  function clearSessionQueryCache() {
    void queryClient.cancelQueries();
    abort.abort();
    abort = new AbortController();
    epoch += 1;
    queryClient.clear();
  }
  return { queryClient, currentSessionEpoch, currentSessionSignal, clearSessionQueryCache };
}
