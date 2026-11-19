/** 企业业务请求绑定当前客户会话与读取寿命，运输复用公共 web-client。
 * 服务端裁定企业角色、空间与字段投影。取消后的写入仍须核对原操作。 */
import { ClientTransportError, customerFetch, customerSessionGeneration, parseCustomerResponse } from "@rental-os/web-client";
import type { EnterpriseEntryResponse } from "../../src/enterprise";

export const CLIENT_BASE = "/api/client/v1";

export interface EnterpriseRequestBoundary {
  tenantCode: string;
  generation: string;
  signal: AbortSignal;
  offline: boolean;
  isCurrent: () => boolean;
  onAccessDenied: (error: ClientTransportError) => void;
}

export interface EnterpriseBusinessClient {
  read: <T>(path: string, signal?: AbortSignal) => Promise<T>;
  write: <T>(path: string, body: unknown, method?: "POST" | "PUT") => Promise<T>;
}

export function createEnterpriseBusinessClient(boundary: EnterpriseRequestBoundary): EnterpriseBusinessClient {
  const request = async <T>(path: string, init: RequestInit, externalSignal?: AbortSignal): Promise<T> => {
    if (boundary.offline) throw new Error("未连接企业服务");
    const signal = externalSignal ? AbortSignal.any([externalSignal, boundary.signal]) : boundary.signal;
    if (signal.aborted || !boundary.isCurrent()) throw new DOMException("当前企业请求已失效", "AbortError");
    try {
      if (customerSessionGeneration(boundary.tenantCode) !== boundary.generation) throw new ClientTransportError(401, "客户会话已变化");
      const result = await parseCustomerResponse<T>(await customerFetch(boundary.tenantCode, CLIENT_BASE, path,
        { ...init, signal }, (init.method ?? "GET") === "GET"));
      if (signal.aborted || !boundary.isCurrent()) throw new DOMException("当前企业请求已失效", "AbortError");
      if (customerSessionGeneration(boundary.tenantCode) !== boundary.generation) throw new ClientTransportError(401, "客户会话已变化");
      return result;
    } catch (error) {
      if (error instanceof ClientTransportError && (error.status === 401 || error.status === 403)
        && !signal.aborted && boundary.isCurrent()) boundary.onAccessDenied(error);
      throw error;
    }
  };
  return {
    read: <T>(path: string, signal?: AbortSignal) => request<T>(path, {}, signal),
    write: <T>(path: string, body: unknown, method: "POST" | "PUT" = "POST") =>
      request<T>(path, { method, body: JSON.stringify(body) }),
  };
}

export async function readEnterpriseEntry(tenantCode: string, customerId: string, generation: string, signal: AbortSignal): Promise<EnterpriseEntryResponse> {
  const result = await parseCustomerResponse<EnterpriseEntryResponse>(await customerFetch(tenantCode, CLIENT_BASE,
    `/enterprise/entry?tenantCode=${encodeURIComponent(tenantCode)}`, { signal }));
  if (signal.aborted) throw new DOMException("当前企业请求已失效", "AbortError");
  if (customerSessionGeneration(tenantCode) !== generation) throw new ClientTransportError(401, "客户会话已变化");
  if (result.tenantCode !== tenantCode || result.customerId !== customerId) throw new Error("企业权限响应与当前客户或商户不一致");
  return result;
}
