/** 浏览器仅绑定登记路由和安全原定位；不实现 Auth、不从 URL 采用身份/租户/门店。 */
import { ClientError, createClientOperationStore, type ClientDestination, type ClientView } from "@rental-os/platform-client-contracts";

export function createBrowserOperationStore(storage: Storage, namespace: string) {
  return createClientOperationStore({
    keys: () => Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null),
    get: key => storage.getItem(key), set: (key, value) => storage.setItem(key, value), remove: key => storage.removeItem(key),
  }, namespace);
}
export function clientHash(destination: ClientDestination): string {
  if (!/^[a-z][a-z0-9.-]{0,127}$/.test(destination.routeId)) throw new ClientError("route_missing");
  const params = new URLSearchParams(destination.params);
  return `#/${destination.routeId}${params.size ? `?${params}` : ""}`;
}
export function readClientHash(hash: string): ClientDestination | undefined {
  if (!hash || hash === "#/" || hash === "#") return undefined;
  const match = /^#\/([a-z][a-z0-9.-]{0,127})(?:\?([^#]*))?$/.exec(hash);
  if (!match || hash.length > 4096) return { routeId: "invalid.route" };
  return { routeId: match[1], params: Object.fromEntries(new URLSearchParams(match[2])) };
}
/** 调用方在卸载时释放监听。恢复前台先复核原会话并清旧展示。 */
export function bindClientBrowser(view: ClientView, target: Window) {
  const navigate = () => view.navigate(readClientHash(target.location.hash));
  const foreground = () => { if (target.document.visibilityState === "visible") void view.resume(); else view.suspend(); };
  const pageShow = (event: PageTransitionEvent) => { if (event.persisted) void view.resume(); };
  const pageHide = () => view.suspend();
  target.addEventListener("hashchange", navigate);
  target.addEventListener("pageshow", pageShow);
  target.addEventListener("pagehide", pageHide);
  target.document.addEventListener("visibilitychange", foreground);
  navigate();
  return () => {
    target.removeEventListener("hashchange", navigate); target.removeEventListener("pageshow", pageShow);
    target.removeEventListener("pagehide", pageHide); target.document.removeEventListener("visibilitychange", foreground);
  };
}
