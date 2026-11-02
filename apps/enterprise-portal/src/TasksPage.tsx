/** Task-first read model. Registered page links never execute a business command. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { EnterpriseAuditView, EnterpriseTaskCenter, EnterpriseTaskItem } from "@rental-os/shared";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useLocale } from "@/app/locale";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseTasksPage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const path = context.selectedCorporateId ? `/enterprise/corporates/${encodeURIComponent(context.selectedCorporateId)}/tasks` : "/enterprise/tasks";
  const tasks = useQuery({ queryKey: ["enterprise-tasks", context.identity], queryFn: ({ signal }) => context.read<EnterpriseTaskCenter>(path, signal) });
  const refresh = async () => { await tasks.refetch({ throwOnError: true }); };
  return <section>
    <Alert type="info" title={english ? "Tasks come from original persisted requests" : "待办来自原持久申请与批准，不代表业务已执行"}
      description={english ? "Current workspace approvals and your requests only. Order alerts, financial alerts and external delivery are unavailable until the original sources are connected." : "当前覆盖本人申请与当前经营空间审批；订单、财务提醒和外部通知尚未接通原来源，保持不可用。"} />
    {tasks.error ? <Alert type="error" title={tasks.error instanceof Error ? tasks.error.message : "读取失败"} action={<ActionButton intent="refresh" label={english ? "Read tasks again" : "重新读取待办"} onAction={refresh} />} /> :
      <Table rowKey={row => `${row.kind}:${row.id}:${row.page}`} caption={english ? "Enterprise tasks" : "企业待办"} dataSource={tasks.data?.items ?? []} loading={tasks.isFetching}
        pagination={false} sorting={false} onRefresh={refresh} columns={[
          { title: english ? "Type" : "任务类型", dataIndex: "kind" }, { title: english ? "State" : "状态", dataIndex: "state" },
          { title: english ? "Attention" : "待处理", render: (_, row: EnterpriseTaskItem) => row.requiresAction ? english ? "Action or reconciliation needed" : "需要处理或核对" : english ? "Track original request" : "跟进原申请" },
          { title: english ? "Page" : "入口", render: (_, row: EnterpriseTaskItem) => <Link to={`${context.basePath}/${row.page}`}>{english ? "Open original task page" : "打开原任务页"}</Link> }
        ]} />}
  </section>;
}
export function EnterpriseOwnRecordsPage() {
  const context = useEnterprise(), { locale } = useLocale(), english = locale === "en-US";
  const records = useQuery({ queryKey: ["enterprise-own-audit", context.identity], queryFn: ({ signal }) => context.read<EnterpriseAuditView[]>("/enterprise/my-audit", signal) });
  const refresh = async () => { await records.refetch({ throwOnError: true }); };
  return <section><Alert type="info" title={english ? "Your original operations only" : "仅本人原操作记录"}
    description={english ? "These receipts do not grant corporate audit/export access and do not confirm payment or fulfillment." : "原收据不授予企业全员审计或导出权限，也不据此确认支付或履约。"} />
    {records.error ? <Alert type="error" title={records.error instanceof Error ? records.error.message : "读取失败"} /> : <Table rowKey="operationKey" dataSource={records.data ?? []}
      loading={records.isFetching} pagination={false} sorting={false} onRefresh={refresh} columns={[
        { title: english ? "Time" : "时间", dataIndex: "createdAt" }, { title: english ? "Action" : "动作", dataIndex: "action" },
        { title: english ? "Target" : "原对象", dataIndex: "target" }, { title: english ? "Reason" : "原因", dataIndex: "reason" },
        { title: english ? "Original key" : "原操作键", dataIndex: "operationKey" }
      ]} />}
  </section>;
}
