import { ReloadOutlined } from "@/components/ui/icons";
import { Space } from "antd";
import { ListSection, Alert, Table } from "@/components/ui";
import { Button, SearchField } from "@/components/ui";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DemoContactType, DemoRequestRow } from "@rental-os/shared";
import { PageHeader } from "@/components/PageHeader";
import { useLocale } from "@/app/locale";
import { demoRequestsApi } from "@/api/demoRequests";

export function DemoRequestsPage() {
  const { t, locale } = useLocale();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const query = useQuery({
    queryKey: ["platform-demo-requests", page, pageSize, keyword],
    queryFn: () => demoRequestsApi.list({ page, pageSize, keyword: keyword || undefined })
  });
  const contactLabels: Record<DemoContactType, string> = { phone: "手机", email: "邮箱", wechat: "微信" };
  const columns: ColumnsType<DemoRequestRow> = [
    { title: t("提交时间"), dataIndex: "createdAt", width: 190, render: (value: string) => new Date(value).toLocaleString(locale, { hour12: false }) },
    { title: t("姓名"), dataIndex: "name", width: 130 },
    { title: t("联系类型"), dataIndex: "contactType", width: 100, render: (value: DemoContactType) => t(contactLabels[value]) },
    { title: t("联系方式"), dataIndex: "contactValue", width: 220 },
    { title: t("公司 / 门店名称"), dataIndex: "company", width: 220, render: (value: string) => value || "—" },
    { title: t("需求说明"), dataIndex: "message", width: 300, render: (value: string) => <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value || "—"}</span> }
  ];
  return (
    <PageHeader
      title="演示预约"
      extra={<Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>{t("刷新")}</Button>}
      view={
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          {query.isError ? <Alert type="error" showIcon message={t("演示预约加载失败")} description={<Button onClick={() => void query.refetch()}>{t("重试")}</Button>} /> : (
            <ListSection controls={<SearchField label={t("姓名、公司或联系方式，回车搜索")} placeholder={t("姓名、公司或联系方式，回车搜索")}
              value={keywordInput} onValueChange={value => { setKeywordInput(value); if (!value.trim()) { setKeyword(""); setPage(1); } }}
              onSearch={value => { setKeyword(value.trim().slice(0, 120)); setPage(1); }} />}>
              <Table<DemoRequestRow>
                rowKey="id" columns={columns} onRefresh={() => query.refetch()} dataSource={query.data?.items ?? []} loading={query.isLoading} refreshing={query.isFetching}
                scroll={{ x: 1160 }} locale={{ emptyText: t(keyword ? "没有匹配的记录" : "暂无演示预约，官网提交后会显示在这里。") }}
                pagination={{ current: page, pageSize, total: query.data?.total ?? 0, showSizeChanger: true,
                  onChange: (nextPage, nextSize) => { setPage(nextSize === pageSize ? nextPage : 1); setPageSize(nextSize); } }}
              />
            </ListSection>
          )}
        </Space>
      }
    />
  );
}
