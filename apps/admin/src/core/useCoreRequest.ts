/** Core请求复用原HTTP认证/信封，仅限定本Core路径和页面/会话代次；不创建凭据或重试写入。 */
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { request } from "@/api/http";
import { currentSessionEpoch } from "@/app/queryClient";
import { useCorePageHost } from "./CorePage";

type Options = NonNullable<Parameters<typeof request>[1]>;

export function useCoreRequest() {
  const host = useCorePageHost();
  const live = useRef(host); live.current = host;
  const generation = JSON.stringify([host.lifetimeKey, host.page.key]);
  const lifecycle = useRef<{ generation: string; controller: AbortController } | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifecycle.current = { generation, controller };
    return () => controller.abort();
  }, [generation]);
  const send = useCallback(async <T,>(path: string, options: Options = {}): Promise<T> => {
    // 路径由Core自身登记的API拼成，不接受URL、查询或上级目录；参数单独通过options传递。
    const parts = path.split("/");
    if (parts.shift() !== "" || !parts.length || parts.some(part => {
      const decoded = decodeURIComponent(part);
      return !part || /[/\?#\\\u0000-\u0020]/.test(decoded) || decoded === "." || decoded === "..";
    })) throw new Error("Core请求必须使用本Core内的规范路径");
    const current = live.current;
    const boundary = lifecycle.current;
    if (!boundary || boundary.generation !== generation || generation !== JSON.stringify([current.lifetimeKey, current.page.key]) || boundary.controller.signal.aborted
      || !current.canAccess(current.page.coreId, current.page.definition.permissions))
      throw new DOMException("当前Core页面已失效", "AbortError");
    const epoch = currentSessionEpoch();
    const signal = options.signal ? AbortSignal.any([options.signal, boundary.controller.signal]) : boundary.controller.signal;
    const result = await request<T>(`/cores/${current.page.coreId}${path}`, { ...options, signal });
    if (signal.aborted || currentSessionEpoch() !== epoch || generation !== JSON.stringify([live.current.lifetimeKey, live.current.page.key])
      || !live.current.canAccess(current.page.coreId, current.page.definition.permissions))
      throw new DOMException("原Core请求不能写入已变化的页面", "AbortError");
    return result;
  }, [generation]);
  return {
    request: send,
    queryKey: useMemo(() => ["core", host.page.coreId, host.lifetimeKey, host.page.key] as const,
      [host.page.coreId, host.lifetimeKey, host.page.key])
  };
}
