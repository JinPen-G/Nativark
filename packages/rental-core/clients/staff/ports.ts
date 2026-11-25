/**
 * 员工客户端的宿主端口。真实 request 供给员工 audience、鉴权、范围和迟到响应处理，
 * withStaffAction 供给原业务准入，contextVersion 与错误工厂供给缓存归属。
 */
export interface RentalStaffRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  data?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  auth?: "required" | "none";
  scope?: "workspace" | "tenant";
  idempotencyKey?: string;
  operationToken?: string;
  timeoutMs?: number;
  replayAfterRefresh?: boolean;
}

export type RentalStaffRequest = <T>(path: string, options?: RentalStaffRequestOptions) => Promise<T>;

export interface RentalStaffClientPorts {
  request: RentalStaffRequest;
}

export type RentalStaffAction = "order.quote" | "order.create" | "order.extend";

export interface RentalStaffOrdersPorts extends RentalStaffClientPorts {
  withStaffAction: <T>(action: RentalStaffAction, write: () => Promise<T>) => Promise<T>;
}

export interface RentalStaffAssetsPorts extends RentalStaffClientPorts {
  /** 使用真实会话的单调版本，登录、退出及经营空间变化须使旧版本失效。 */
  contextVersion: () => number;
  staleContext: () => Error;
}
