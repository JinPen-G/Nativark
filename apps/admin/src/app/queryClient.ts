import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000
    },
    mutations: { retry: false }
  }
});

/**
 * 当前会话代号。切换空间、切换租户或登出时递增。
 *
 * 为什么需要它：`queryClient.cancelQueries()` 只能取消 react-query 托管的请求，
 * 而本项目大量调用直接走 axios（表单提交、命令式拉取）。那些请求在切换空间的
 * 瞬间仍在飞行中，返回后会被当作新空间的数据使用——正是 SPACE-05 要求
 * 「取消旧请求」的那类残留。
 */
let sessionEpoch = 0;
let sessionAbort = new AbortController();

export function currentSessionSignal() {
  return sessionAbort.signal;
}

export function currentSessionEpoch() {
  return sessionEpoch;
}

/**
 * Tenant data must never survive an authenticated session boundary.
 * Cancelling first prevents a request started by the previous tenant from
 * repopulating the cache after the next tenant has signed in.
 *
 * 同样适用于经营空间边界：同租户不同空间的业务数据是两套，
 * 旧空间的响应绝不能落进新空间的缓存。
 */
export function clearSessionQueryCache() {
  void queryClient.cancelQueries();
  // 中止上一代会话的全部在途 axios 请求，再换一个新的控制器给后续请求用。
  sessionAbort.abort();
  sessionAbort = new AbortController();
  sessionEpoch += 1;
  queryClient.clear();
}
