/** 宿主提供当前服务端会话及唯一请求/缓存边界；Core 页面只消费这个接点。
 * 本模块不读取本地凭据，不决定服务端权限，也不创建第二个认证客户端。 */
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { AuthUser, TenantIdentity } from "@rental-os/platform-contracts";

export interface AdminSessionSnapshot {
  sessionVerified: boolean;
  tenant?: TenantIdentity;
  user?: AuthUser;
}

export interface AdminRequestOptions {
  method?: "get" | "post" | "put" | "patch" | "delete";
  data?: unknown;
  params?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface AdminRuntime {
  /** Snapshot 必须在身份/权限没有改变时保持引用稳定，来源仍为宿主验证后的会话。 */
  getSession: () => AdminSessionSnapshot;
  subscribe: (listener: () => void) => () => void;
  currentSessionEpoch: () => number;
  currentSessionSignal: () => AbortSignal;
  request: <T>(path: string, options?: AdminRequestOptions) => Promise<T>;
}

const RuntimeContext = createContext<AdminRuntime | null>(null);

export function AdminRuntimeProvider({ runtime, children }: { runtime: AdminRuntime; children: ReactNode }) {
  return createElement(RuntimeContext.Provider, { value: runtime }, children);
}

export function useAdminRuntime(): AdminRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("Core pages require AdminRuntimeProvider");
  return runtime;
}

export function useAdminSession(): AdminSessionSnapshot {
  const runtime = useAdminRuntime();
  return useSyncExternalStore(runtime.subscribe, runtime.getSession, runtime.getSession);
}

export { createAdminSessionQueries } from "./session-queries";
export { isTransientRefreshError } from "./query-errors";
