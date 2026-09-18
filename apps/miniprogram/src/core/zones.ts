import { fetchConfig } from "../api/merchant";
import { currentServiceCode, isSignedIn } from "./session";

/**
 * 各服务的营业时区登记（来自目录/配置响应）。统一订单索引暂不携带时区（MP-08 待补），
 * 因此订单列表按已登记的时区显示；未登记时退回当前服务时区并明确标注。
 */
const zones = new Map<string, string>();
const inflight = new Map<string, Promise<string | undefined>>();

export function rememberZone(serviceCode: string, timeZone: string): void {
  if (serviceCode && timeZone) zones.set(serviceCode, timeZone);
}

export function zoneOf(serviceCode: string): string | undefined {
  return zones.get(serviceCode);
}

export function knownZones(): number {
  return zones.size;
}

/**
 * 确保当前会话服务的营业时区已知：没访问过目录时向 /config 读一次。
 * 失败返回 undefined，由调用方退回默认时区并在页面标注。并发请求按服务编码合并。
 */
export async function ensureCurrentZone(): Promise<string | undefined> {
  const serviceCode = currentServiceCode();
  if (!serviceCode || !isSignedIn()) return undefined;
  const known = zones.get(serviceCode);
  if (known) return known;
  let pending = inflight.get(serviceCode);
  if (!pending) {
    pending = fetchConfig()
      .then((config) => {
        if (config.timeZone && config.workspace?.workspaceCode) rememberZone(config.workspace.workspaceCode, config.timeZone);
        return config.workspace?.workspaceCode === serviceCode ? config.timeZone || undefined : zones.get(serviceCode);
      })
      .catch(() => undefined)
      .finally(() => {
        inflight.delete(serviceCode);
      });
    inflight.set(serviceCode, pending);
  }
  return pending;
}
