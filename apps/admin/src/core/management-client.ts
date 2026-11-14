/** Core管理复用原认证HTTP和单源schema；读取原结果不重发变更，不从客户端字段授权。 */
import { CORE_MANAGEMENT_HTTP as routes, CORE_MANAGEMENT_HTTP_BASE, CORE_SESSION_HTTP, CORE_SCOPE_HTTP,
  type BindCoreScope, type ChangeMemberCoreAssignment, type ChangeTenantCoreGrant } from "@rental-os/core-contracts";
import { request } from "@/api/http";
import { currentSessionEpoch, currentSessionSignal } from "@/app/queryClient";

type Query<K extends keyof typeof routes> = (typeof routes)[K] extends { request: { parse(input: unknown): infer Value } }
  ? Value : never;

async function send<Output>(declaration: { path: string; method: "GET" | "POST";
  request?: { parse(value: unknown): unknown }; response: { parse(value: unknown): Output } }, input: unknown,
  signal: AbortSignal, prefix = `/${CORE_MANAGEMENT_HTTP_BASE}`): Promise<Output> {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw new DOMException("原Core管理请求已失效", "AbortError");
  const data = declaration.request?.parse(input);
  const response = await request<unknown>(`${prefix}/${declaration.path}`, {
    method: declaration.method === "GET" ? "get" : "post", data, signal: active });
  if (active.aborted || currentSessionEpoch() !== epoch) throw new DOMException("原Core管理响应不能写入新会话", "AbortError");
  return declaration.response.parse(response);
}

export const coreManagementApi = {
  registered: (signal: AbortSignal) => send(routes.registered, undefined, signal),
  changeTenantGrant: (input: ChangeTenantCoreGrant, signal: AbortSignal) => send(routes.tenantGrant, input, signal),
  changeMemberAssignment: (input: ChangeMemberCoreAssignment, signal: AbortSignal) => send(routes.memberAssignment, input, signal),
  bind: (input: BindCoreScope, signal: AbortSignal) => send(routes.bind, input, signal),
  bindingOperation: (input: Query<"bindingOperation">, signal: AbortSignal) => send(routes.bindingOperation, input, signal),
  tenantGrant: (input: Query<"readTenantGrant">, signal: AbortSignal) => send(routes.readTenantGrant, input, signal),
  memberAssignment: (input: Query<"readMemberAssignment">, signal: AbortSignal) => send(routes.readMemberAssignment, input, signal),
  binding: (input: Query<"readBinding">, signal: AbortSignal) => send(routes.readBinding, input, signal),
  tenantGrantOperation: (input: Query<"readTenantGrantOperation">, signal: AbortSignal) => send(routes.readTenantGrantOperation, input, signal),
  memberAssignmentOperation: (input: Query<"readMemberAssignmentOperation">, signal: AbortSignal) => send(routes.readMemberAssignmentOperation, input, signal),
  sessionContext: (signal: AbortSignal) => send(CORE_SESSION_HTTP, undefined, signal, ""),
  scope: (input: ReturnType<typeof CORE_SCOPE_HTTP.request.parse>, signal: AbortSignal) => send(CORE_SCOPE_HTTP, input, signal, "")
};

/** 仅已知在提交前拒绝的原管理错误可解除本次未知锁；网络/5xx及未知响应保留原键。 */
export function coreManagementRejectedBeforeCommit(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { code?: string } } } | null)?.response;
  return Boolean(response && ([400, 401, 403].includes(response.status ?? 0)
    || response.status === 409 && ["revision_conflict", "operation_conflict"].includes(response.data?.code ?? "")
    || response.status === 503 && response.data?.code === "core_unavailable"));
}
