/** 租户寄件目录消费原日志分页；仅只读查看，不提供无证据的重发或删除。 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TenantDispatchChannel, TenantDispatchQuery, TenantDispatchRow, TenantDispatchStatus } from "@rental-os/shared";
import { Mail, MessageSquare } from "lucide-react";
import { useLocale } from "@/app/locale";
import { tenantMessagingApi } from "@/api/tenantMessaging";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Button, DataTableText, SearchField, Select, Segmented, Table } from "@/components/ui";
import { DispatchDetail, DispatchStatus, DISPATCH_STATUS_LABELS } from "./DispatchDetail";
import styles from "./Dispatch.module.css";

export function TenantDispatchPage() {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState<TenantDispatchQuery>({ page: 1, pageSize: 30 });
  const [selected, setSelected] = useState<TenantDispatchRow>();
  const records = useQuery({ queryKey: ["tenant-dispatch", query], queryFn: () => tenantMessagingApi.dispatches(query) });
  const update = (patch: Partial<TenantDispatchQuery>) => setQuery(value => ({ ...value, ...patch, page: 1 }));
  return <>
    <PageHeader title={t("寄件中心")} description={t("查看当前租户各经营空间的短信、邮件和运营邀请发送记录。")} />
    <QueryState loading={records.isLoading} error={records.error}>
      <Table<TenantDispatchRow> rowKey={row => `${row.source}:${row.id}:${row.channel}`} dataSource={records.data?.rows ?? []}
        toolbar={<>
        <SearchField label={t("查找寄件")} placeholder={t("收件人、标题或关联编号")} value={query.search ?? ""} onValueChange={search => update({ search })} />
        <Segmented value={query.channel ?? "all"} onChange={value => update({ channel: value === "all" ? undefined : value as TenantDispatchChannel })}
          options={[{ value: "all", label: t("全部") }, { value: "email", label: t("邮件") }, { value: "sms", label: t("短信") }]} />
        <Select aria-label={t("发送状态")} allowClear placeholder={t("全部状态")} value={query.status}
          onChange={(status: TenantDispatchStatus | undefined) => update({ status })}
          options={Object.entries(DISPATCH_STATUS_LABELS).map(([value, label]) => ({ value, label: t(label) }))} />
        </>}
        loading={records.isLoading} refreshing={records.isFetching} onRefresh={() => records.refetch()} toolbarNote={false}
        pagination={{ current: query.page, pageSize: query.pageSize, total: records.data?.total ?? 0,
          onChange: (page, pageSize) => setQuery(value => ({ ...value, page, pageSize })) }} columns={[
          { title: t("寄件"), render: (_, row) => <div className={styles.identity}><span aria-label={t(row.channel === "email" ? "邮件" : "短信")}>
            {row.channel === "email" ? <Mail size={17} /> : <MessageSquare size={17} />}</span><DataTableText primary={row.subject} secondary={row.recipient} /></div> },
          { title: t("经营空间"), render: (_, row) => row.workspaceName ?? t("租户通知") },
          { title: t("状态"), render: (_, row) => <DispatchStatus value={row.status} /> },
          { title: t("发送服务"), dataIndex: "provider" },
          { title: t("创建时间"), render: (_, row) => new Date(row.createdAt).toLocaleString(locale) },
          { title: t("操作"), fixed: "right", render: (_, row) => <Button type="text" size="small" onClick={() => setSelected(row)}>{t("查看详情")}</Button> }
        ]} />
    </QueryState>
    <DispatchDetail selected={selected} onClose={() => setSelected(undefined)} />
  </>;
}
