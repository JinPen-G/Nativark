/** Read-only platform leads. The detail surface uses the current authorized list row;
 * it does not contact a lead, change its state or introduce a separate detail API. */
import { Button, CopyButton, DataTableText, Drawer, FormSection, ListSection, SearchField, Table } from "@/components/ui";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DemoContactType, DemoRequestRow } from "@rental-os/shared";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { RecordFacts } from "@/components/RecordDetailLayout";
import { useLocale } from "@/app/locale";
import { isTransientRefreshError } from "@/app/queryClient";
import { demoRequestsApi } from "@/api/demoRequests";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import styles from "./DemoRequestsPage.module.css";

export function DemoRequestsPage() {
  const { t, locale } = useLocale();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [selection, setSelection] = useState<{ scope: string; id: string }>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const scope = useListQueryIdentity();
  const query = useQuery({
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === scope ? previous : undefined,
    queryKey: ["platform-demo-requests", scope, page, pageSize, keyword],
    queryFn: () => demoRequestsApi.list({ page, pageSize, keyword: keyword || undefined })
  });
  const detail = selection?.scope === scope && !query.isPlaceholderData && (!query.isError || isTransientRefreshError(query.error))
    ? query.data?.items.find(row => row.id === selection.id) : undefined;
  useEffect(() => { if (!detail) setDetailsOpen(false); }, [detail]);
  const contactLabels: Record<DemoContactType, string> = { phone: "手机", email: "邮箱", wechat: "微信" };
  const timestamp = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale, { hour12: false }) : "—";
  const columns: ColumnsType<DemoRequestRow> = [
    { title: t("姓名"), render: (_, row) => <DataTableText primary={row.name} secondary={row.company} /> },
    { title: t("联系方式"), render: (_, row) => <DataTableText primary={row.contactValue} secondary={t(contactLabels[row.contactType])} /> },
    { title: t("需求说明"), dataIndex: "message", render: (value: string) => <span className={styles.excerpt}>{value || "—"}</span> },
    { title: t("提交时间"), dataIndex: "createdAt", render: timestamp },
    { title: t("操作"), key: "actions", render: (_, row) => <Button type="link" onClick={() => { setSelection({ scope, id: row.id }); setDetailsOpen(true); }}>{t("查看详情")}</Button> },
  ];
  return <>
    <PageHeader title={t("演示预约")} />
    <QueryState loading={query.isLoading} error={query.error} transitionKey={scope} onRetry={() => query.refetch({ throwOnError: true })}>
      <ListSection controls={<SearchField label={t("姓名、公司或联系方式，回车搜索")} placeholder={t("姓名、公司或联系方式，回车搜索")}
        value={keywordInput} onValueChange={value => { setKeywordInput(value); if (!value.trim()) { setKeyword(""); setPage(1); } }}
        onSearch={value => { setKeyword(value.trim().slice(0, 120)); setPage(1); }} />}>
        <Table<DemoRequestRow>
          rowKey="id" columns={columns} onRefresh={() => query.refetch({ throwOnError: true })} dataSource={query.data?.items ?? []} loading={query.isLoading || query.isPlaceholderData} refreshing={query.isFetching}
          locale={{ emptyText: t(keyword ? "没有匹配的记录" : "暂无演示预约，官网提交后会显示在这里。") }} emptyScene={keyword ? "search" : "empty"}
          pagination={{ current: page, pageSize, total: query.data?.total ?? 0, showSizeChanger: true,
            onChange: (nextPage, nextSize) => { setPage(nextSize === pageSize ? nextPage : 1); setPageSize(nextSize); } }}
        />
      </ListSection>
    </QueryState>
    <Drawer title={t("演示预约详情")} open={detailsOpen && Boolean(detail)} size={640} destroyOnHidden onClose={() => setDetailsOpen(false)}>
      {detail && <div className={styles.detail}>
        <FormSection title={detail.name} description={detail.company || undefined}>
          <RecordFacts items={[
            { key: "contact", label: t(contactLabels[detail.contactType]), wide: true, value: <div className={styles.contact}><span>{detail.contactValue}</span><CopyButton value={detail.contactValue} label={t("复制联系方式")} /></div> },
            { key: "createdAt", label: t("提交时间"), value: timestamp(detail.createdAt) },
            { key: "language", label: t("提交语言"), value: detail.language === "en" ? "English" : "中文" },
          ]} />
        </FormSection>
        <FormSection title={t("需求说明")}>
          <p className={styles.message}>{detail.message || t("未填写需求说明")}</p>
        </FormSection>
      </div>}
    </Drawer>
  </>;
}
