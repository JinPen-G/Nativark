/** 管理动作绑定原会话和页面生命周期；失效只停止后续界面动作，不推断写入回滚。 */
import { useLayoutEffect, useRef } from "react";
import { canManagePublicResource } from "../../application-access";
import { useAdminRuntime } from "../../runtime";

export function useManagementLifetime(audience: "tenant" | "saas", permission: string) {
  const runtime = useAdminRuntime(), epoch = runtime.currentSessionEpoch();
  const lifetime = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, [runtime, epoch]);
  const isCurrent = () => {
    const current = runtime.getSession();
    return Boolean(lifetime.current && !lifetime.current.signal.aborted && runtime.currentSessionEpoch() === epoch
      && current.sessionVerified && canManagePublicResource(current.user, audience, permission));
  };
  const current = () => {
    if (!isCurrent()) throw new DOMException("原管理页面或权限已失效", "AbortError");
    return AbortSignal.any([lifetime.current!.signal, runtime.currentSessionSignal()]);
  };
  return { runtime, epoch, isCurrent, current };
}
