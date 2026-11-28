/** 工单宿主显式选择的AI状态视图；不自动创建任务、批准或执行，状态不能充当授权。 */
import { useQuery } from "@tanstack/react-query";
import { TicketDetailPage } from "@rental-os/example-tickets-core/admin";
import { TICKETS_HTTP } from "@rental-os/example-tickets-core/http";
import { Alert, ListSection, QueryState, useCorePageHost, useCoreRequest, useLocale } from "@rental-os/platform-admin/core";
import { ActionButton } from "@rental-os/platform-admin/ui";
import type { TicketAiRouteState } from "@rental-os/example-tickets-core";
import { TicketsAiTask } from "./tickets-ai-task";

const names = {
  unconfigured: ["未配置", "Not configured"], denied: ["当前无权使用", "Access denied"],
  unpublished: ["未发布", "Not published"], available: ["可用", "Available"],
  pending_approval: ["待批准", "Awaiting approval"], reconciliation_required: ["结果待核对", "Result needs reconciliation"],
  unavailable: ["暂不可用", "Unavailable"]
} as const;
export const ticketAiReasons: Record<TicketAiRouteState["reason"], readonly [string, string]> = {
  host_not_selected: ["此宿主尚未启用该入口，普通工单操作仍可按原权限使用。", "This host has not enabled this entry. Ordinary tickets remain subject to their current access."],
  identity_adapter_missing: ["尚未接通适用的可信身份入口。请联系部署管理员。", "The required trusted identity entry is not connected. Contact your deployment administrator."],
  task_adapter_missing: ["任务执行入口尚未接通。请联系部署管理员。", "Task execution is not connected. Contact your deployment administrator."],
  permission_denied: ["当前角色或工单范围不允许此操作。", "Your current role or ticket scope does not permit this operation."],
  entitlement_denied: ["当前租户没有适用的 AI 使用权益。", "The tenant does not currently have the required AI entitlement."],
  policy_denied: ["当前租户政策不允许使用此能力。", "The current tenant policy does not allow this capability."],
  core_unavailable: ["工单能力当前不可用，请核对授权和启用状态。", "Tickets are unavailable. Check current grants and activation."],
  limit_reached: ["原任务或工具限额不足，请核对原用量。", "The original task or tool allowance is insufficient. Review the recorded usage."],
  tool_not_published: ["管理员尚未发布这项工单能力。", "An administrator has not published this ticket capability."],
  publication_expired: ["原能力发布已到期，请由管理员重新核定。", "The publication has expired. An administrator must review it."],
  current_authorities_verified: ["当前检查通过；实际请求仍会再次核对权限和限额。", "Current checks passed. Each request still verifies access and limits again."],
  original_proposal_pending: ["请先核对原输入和工单版本，再明确批准。批准不会自动执行。", "Review the original input and ticket version before approving. Approval does not execute the action."],
  original_result_unknown: ["保留原操作编号，只核对原结果，不要换键重新执行。", "Keep the original operation reference and reconcile its result. Do not execute with a new key."],
  authority_unavailable: ["暂未取得完整的当前依据，请重新读取；仍失败时联系管理员。", "Current evidence is unavailable. Reload, or contact an administrator if it persists."],
  basis_changed: ["工单、授权或发布依据已变化，请重新读取并确认。", "The ticket, access, or publication has changed. Reload and review it."],
  original_evidence_unavailable: ["原任务或结果依据暂不可读，不能推断未执行。", "Original task or result evidence cannot be read. This does not prove that execution did not occur."]
};

export function TicketAiPanel({ ticketId, ticketRevision }: { ticketId: string; ticketRevision: number }) {
  const { request, queryKey } = useCoreRequest(), { locale } = useLocale();
  const en = locale === "en-US", text = (zh: string, english: string) => en ? english : zh;
  const query = useQuery({ queryKey: [...queryKey, "ai-status", ticketId, ticketRevision], retry: false,
    queryFn: async ({ signal }) => {
      const status = TICKETS_HTTP.aiStatus.response.parse(await request(`/tickets/${encodeURIComponent(ticketId)}/ai-status`, { signal }));
      if (status.ticketId !== ticketId || status.ticketRevision !== ticketRevision)
        throw new Error(text("工单已变化，请刷新详情后重新读取AI状态", "The ticket changed. Reload its details before checking AI status."));
      return status;
    }, meta: { liveRefresh: false } });
  const reload = async () => { const result = await query.refetch(); if (result.isError) throw result.error; };
  const route = (label: string, state: TicketAiRouteState) => <Alert
    type={state.state === "available" ? "success" : state.state === "pending_approval" || state.state === "reconciliation_required" ? "warning" : "info"}
    title={`${label} · ${names[state.state][en ? 1 : 0]}`} description={ticketAiReasons[state.reason][en ? 1 : 0]} />;
  return <ListSection title={text("可选 AI", "Optional AI")} extra={<ActionButton intent="refresh"
    label={text("重新读取", "Reload")} disabled={query.isFetching} onAction={reload} />}>
    <QueryState loading={query.isPending || query.isFetching} error={query.error} onRetry={reload}>
      {query.data && !query.error && !query.isFetching && <>
        {route(text("内置工单任务", "Built-in ticket task"), query.data.builtin.status)}
        {query.data.builtin.status.state !== "unconfigured" && <TicketsAiTask ticketId={ticketId} ticketRevision={ticketRevision} state={query.data.builtin.status} />}
        {route(text("外部 MCP 读取", "External MCP reads"), query.data.mcp.status)}
        <p>{text("内置任务示例不调用模型；外部客户端的模型由使用者自付。", "The built-in task example makes no model call. External clients use models paid for by their users.")}</p>
      </>}
    </QueryState>
  </ListSection>;
}

export function TicketsAiDetailPage() {
  const ticketId = useCorePageHost().params?.ticketId;
  if (!ticketId) throw new Error("工单详情需要已登记的ticketId");
  return <TicketDetailPage ticketId={ticketId} extension={TicketAiPanel} />;
}
