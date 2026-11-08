import { PlusOutlined } from "@/components/ui/icons";
import { Space, Tag } from "antd";
import { DataTableText, ListSection, ListFilterItem, Modal } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Input } from "@/components/ui";
import { SearchField, Select } from "@/components/ui";
import { Button } from "@/components/ui";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SubscriptionPlan, SubscriptionServiceStatus, type TenantSubscriptionOverview } from "@rental-os/shared";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useLocale } from "@/app/locale";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";
import { api } from "@/api/platform";
import { PLAN_LABEL, SERVICE_STATUS_LABEL, formatSubscriptionDate } from "./subscriptionLabels";
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";

export function PlatformSubscriptionsPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [plan, setPlan] = useState("all");
  const [serviceStatus, setServiceStatus] = useState<string | undefined>();
  const [dueWithin, setDueWithin] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20 });
  const [selecting, setSelecting] = useState(false);
  const [tenantId, setTenantId] = useState<string>();
  const scope = useListQueryIdentity();
  const query = useQuery({
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === scope ? previous : undefined,
    queryKey: ["subscription", "platform-list", scope, plan, serviceStatus, dueWithin, keyword, pagination],
    queryFn: () => subscriptionApi.platformList({ plan: plan === "all" ? undefined : plan, serviceStatus: dueWithin === "expired" ? SubscriptionServiceStatus.Expired : serviceStatus, dueWithin: dueWithin === "expired" ? undefined : dueWithin, keyword: keyword || undefined, ...pagination })
  });
  // The tenant registry includes tenants with no subscription; do not offer only the filtered subscription page.
  const tenants = useQuery({ queryKey: ["subscription", "tenant-selector"], queryFn: api.tenants, enabled: selecting });
  const resetPage = () => setPagination((value) => ({ ...value, page: 1 }));
  const openDetail = (id: string) => navigate(`${APP_ROUTES.platformSubscriptions.path}/${encodeURIComponent(id)}`);
  const columns: ColumnsType<TenantSubscriptionOverview> = [
    { title: t("租户"), key: "tenant", render: (_, row) => <DataTableText primary={row.tenantName} secondary={row.tenantCode} /> },
    { title: t("当前套餐"), dataIndex: "plan", key: "plan", render: (value: SubscriptionPlan) => <Tag color={value === SubscriptionPlan.Pro ? "gold" : "default"}>{t(PLAN_LABEL[value])}</Tag> },
    { title: t("服务状态"), dataIndex: "serviceStatus", key: "status", render: (value: SubscriptionServiceStatus) => t(SERVICE_STATUS_LABEL[value]) },
    { title: t("统一截止"), key: "endAt", render: (_, row) => formatSubscriptionDate(row.endAt, row.timeZone, t) },
    { title: t("待生效"), key: "next", render: (_, row) => row.next ? `${t(PLAN_LABEL[row.next.plan])} · ${formatSubscriptionDate(row.next.effectiveAt, row.timeZone, t)}` : t("—") },
    { title: t("操作"), key: "action", render: (_, row) => <Button type="text" size="small" onClick={() => openDetail(row.tenantId)}>{t("查看详情")}</Button> }
  ];
  return <>
    <PageHeader title="租户订阅"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setTenantId(undefined); setSelecting(true); }}>{t("直接为租户开通")}</Button>}
      view={<Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <QueryState loading={query.isLoading}>
          {query.error ? <Alert type="error" showIcon message={t("租户订阅列表加载失败")} action={<Button onClick={() => query.refetch()}>{t("重试")}</Button>} />
            : <ListSection controls={<>
              <SearchField label={t("搜索租户订阅")} placeholder={t("搜索租户名称 / 编码")} value={keywordInput} onValueChange={value => { setKeywordInput(value); if (!value.trim()) { setKeyword(""); resetPage(); } }} onSearch={(value) => { setKeyword(value); resetPage(); }} />
              <ListFilterItem label={t("服务状态")} priority active={Boolean(serviceStatus)}>
                <Select aria-label={t("服务状态")} placeholder={t("服务状态")} allowClear value={serviceStatus} onChange={(value) => { setServiceStatus(value); resetPage(); }} options={Object.values(SubscriptionServiceStatus).map((value) => ({ value, label: t(SERVICE_STATUS_LABEL[value]) }))} />
              </ListFilterItem>
              <ListFilterItem label={t("到期范围")} width="selectWide" collapsed active={Boolean(dueWithin)}>
                <Select aria-label={t("到期范围")} placeholder={t("到期范围")} allowClear value={dueWithin} onChange={(value) => { setDueWithin(value); resetPage(); }} options={[{ value: "7", label: t("7 天内到期") }, { value: "30", label: t("30 天内到期") }, { value: "expired", label: t("已过期") }]} />
              </ListFilterItem>
              <ListFilterItem label={t("版本")} collapsed active={plan !== "all"}>
                <Select aria-label={t("版本")} value={plan} onChange={(value) => { setPlan(String(value)); resetPage(); }} options={[{ value: "all", label: t("全部版本") }, { value: "standard", label: t("基础版") }, { value: "pro", label: "PRO" }]} />
              </ListFilterItem>
              {(keywordInput || keyword || plan !== "all" || serviceStatus || dueWithin) && <Button type="text" data-list-filter-reset onClick={() => { setKeyword(""); setKeywordInput(""); setPlan("all"); setServiceStatus(undefined); setDueWithin(undefined); resetPage(); }}>{t("清除筛选")}</Button>}
            </>}><Table<TenantSubscriptionOverview> rowKey="tenantId" columns={columns} onRefresh={() => query.refetch()} dataSource={query.data?.items ?? []} loading={query.isLoading} refreshing={query.isFetching} scroll={{ x: 900 }} pagination={{ current: query.data?.page ?? pagination.page, pageSize: query.data?.pageSize ?? pagination.pageSize, total: query.data?.total ?? 0, showSizeChanger: true, onChange: (page, pageSize) => setPagination({ page: pageSize === pagination.pageSize ? page : 1, pageSize }) }} /></ListSection>}
        </QueryState>
      </Space>} />
    <Modal open={selecting} title={t("选择要办理的租户")} okText={t("进入详情 / 办理")} okButtonProps={{ disabled: !tenantId || tenants.isError }} onCancel={() => setSelecting(false)} onOk={() => tenantId && openDetail(tenantId)}>
      <QueryState loading={tenants.isLoading}>
        {tenants.error ? <Alert type="error" message={t("租户加载失败")} action={<Button onClick={() => tenants.refetch()}>{t("重试")}</Button>} />
          : <Select showSearch={{ optionFilterProp: "label" }} style={{ width: "100%" }} placeholder={t("搜索租户名称 / 编码（含尚未配置订阅的租户）")} value={tenantId} onChange={setTenantId} options={(tenants.data ?? []).map((tenant) => ({ value: tenant.tenantId, label: `${tenant.tenantName}（${tenant.tenantCode}）` }))} />}
      </QueryState>
    </Modal>
  </>;
}
