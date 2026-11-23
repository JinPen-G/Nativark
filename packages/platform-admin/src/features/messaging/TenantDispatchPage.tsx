/** 租户寄件目录消费原日志分页；仅只读查看，不提供无证据的重发或删除。 */
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TenantDispatchChannel, TenantDispatchQuery, TenantDispatchRow, TenantDispatchStatus } from "@rental-os/platform-contracts";
import { Mail, MessageSquare } from "lucide-react";
import { useLocale } from "../../app/locale";
import { resolveAdminBrandName } from "../../app/branding";
import { PageHeading, type PageHeadingProps } from "../../components/PageHeading";
import { QueryState } from "../../components/QueryState";
import { Button, DataTableText, SearchField, Select, Segmented, Table, Result } from "../../components/ui";
import { useAdminRuntime, useAdminSession } from "../../runtime";
import { useTenantMessagingApi } from "./client";
import { hasTenantMessagingPermission } from "./messagingAccess";
import { DispatchDetail, DispatchStatus, DISPATCH_STATUS_LABELS } from "./DispatchDetail";
import styles from "./Dispatch.module.css";

export interface TenantMessagingPageProps {
  renderHeader?: (props: Omit<PageHeadingProps, "brandName" | "icon">) => ReactNode;
  description?: string;
  businessScopeLabel?: string;
}

export function TenantDispatchPage(props: TenantMessagingPageProps) {
  const { user, sessionVerified } = useAdminSession();
  const runtime = useAdminRuntime();
  if (!sessionVerified || !hasTenantMessagingPermission(user, "system:integration:manage")) return <Result status="403" title="403" />;
  return <DispatchWorkspace key={runtime.currentSessionEpoch()} {...props} />;
}

function DispatchWorkspace({ renderHeader, description = "查看当前租户的短信、邮件和成员邀请发送记录。", businessScopeLabel = "业务范围" }: TenantMessagingPageProps) {
  const { t, locale } = useLocale();
  const { tenant, user } = useAdminSession();
  const runtime = useAdminRuntime();
  const api = useTenantMessagingApi();
  const [query, setQuery] = useState<TenantDispatchQuery>({ page: 1, pageSize: 30 });
  const [selected, setSelected] = useState<TenantDispatchRow>();
  const records = useQuery({ queryKey: ["tenant-dispatch", runtime.currentSessionEpoch(), query],
    queryFn: ({ signal }) => api.dispatches(query, signal) });
  const update = (patch: Partial<TenantDispatchQuery>) => setQuery(value => ({ ...value, ...patch, page: 1 }));
  const heading = { title: t("寄件中心"), description: t(description) };
  return <>
    {renderHeader ? renderHeader(heading) : <PageHeading {...heading} brandName={resolveAdminBrandName(tenant, user)} />}
    <QueryState loading={records.isLoading} error={records.error} onRetry={() => records.refetch({ throwOnError: true })}>
      <Table<TenantDispatchRow> rowKey={row => `${row.source}:${row.id}:${row.channel}`} dataSource={records.data?.rows ?? []}
        toolbar={<>
        <SearchField label={t("查找寄件")} placeholder={t("收件人、标题或关联编号")} value={query.search ?? ""} onValueChange={search => update({ search })} />
        <Segmented value={query.channel ?? "all"} onChange={value => update({ channel: value === "all" ? undefined : value as TenantDispatchChannel })}
          options={[{ value: "all", label: t("全部") }, { value: "email", label: t("邮件") }, { value: "sms", label: t("短信") }]} />
        <Select aria-label={t("发送状态")} allowClear placeholder={t("全部状态")} value={query.status}
          onChange={(status: TenantDispatchStatus | undefined) => update({ status })}
          options={Object.entries(DISPATCH_STATUS_LABELS).map(([value, label]) => ({ value, label: t(label) }))} />
        </>}
        loading={records.isLoading} refreshing={records.isFetching} onRefresh={() => records.refetch({ throwOnError: true })} toolbarNote={false}
        pagination={{ current: query.page, pageSize: query.pageSize, total: records.data?.total ?? 0,
          onChange: (page, pageSize) => setQuery(value => ({ ...value, page, pageSize })) }} columns={[
          { title: t("寄件"), render: (_, row) => <div className={styles.identity}><span aria-label={t(row.channel === "email" ? "邮件" : "短信")}>
            {row.channel === "email" ? <Mail size={17} /> : <MessageSquare size={17} />}</span><DataTableText primary={row.subject} secondary={row.recipient} /></div> },
          { title: t(businessScopeLabel), render: (_, row) => row.workspaceName ?? t("租户通知") },
          { title: t("状态"), render: (_, row) => <DispatchStatus value={row.status} /> },
          { title: t("发送服务"), dataIndex: "provider" },
          { title: t("创建时间"), render: (_, row) => new Date(row.createdAt).toLocaleString(locale) },
          { title: t("操作"), fixed: "right", render: (_, row) => <Button type="text" size="small" onClick={() => setSelected(row)}>{t("查看详情")}</Button> }
        ]} />
    </QueryState>
    <DispatchDetail selected={selected} onClose={() => setSelected(undefined)} businessScopeLabel={businessScopeLabel} />
  </>;
}
