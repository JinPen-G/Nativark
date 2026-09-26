import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Input, Segmented, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SubscriptionPlan, SubscriptionServiceStatus, type TenantSubscriptionOverview } from "@rental-os/shared";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { useLocale } from "@/app/locale";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";
import { PLAN_LABEL, SERVICE_STATUS_LABEL } from "./subscriptionLabels";

/**
 * SUB-03 平台管理端「租户订阅」列表（§8.1）。数据走只读列表查询；直接开通/办理待 SUB-03 写契约。
 * 列表读 DTO 先用 TenantSubscriptionOverview 承接（正式列表 DTO 随 SUB-03 定，见 api/subscription.ts）。
 */
export function PlatformSubscriptionsPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [plan, setPlan] = useState("all");
  const [serviceStatus, setServiceStatus] = useState<string | undefined>();
  const [dueWithin, setDueWithin] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");
  const query = useQuery({
    queryKey: ["subscription", "platform-list", plan, serviceStatus, dueWithin, keyword],
    queryFn: () => subscriptionApi.platformList({ plan: plan === "all" ? undefined : plan, serviceStatus, dueWithin, keyword: keyword || undefined })
  });

  const columns: ColumnsType<TenantSubscriptionOverview> = [
    { title: t("租户"), key: "tenant", render: (_, row) => `${row.tenantName}（${row.tenantCode}）` },
    { title: t("当前套餐"), dataIndex: "plan", key: "plan", render: (value: SubscriptionPlan) => <Tag color={value === SubscriptionPlan.Pro ? "gold" : "default"}>{t(PLAN_LABEL[value])}</Tag> },
    { title: t("服务状态"), dataIndex: "serviceStatus", key: "status", render: (value: SubscriptionServiceStatus) => t(SERVICE_STATUS_LABEL[value]) },
    { title: t("统一截止"), dataIndex: "endAt", key: "endAt", render: (value?: string) => value ?? t("待平台确认") },
    { title: t("待生效"), key: "next", render: (_, row) => row.next ? `${t(PLAN_LABEL[row.next.plan])}${row.next.effectiveAt ? `（${row.next.effectiveAt}）` : ""}` : t("—") },
    { title: t("操作"), key: "action", render: (_, row) => <Button type="link" style={{ paddingInline: 0 }} onClick={() => navigate(`${APP_ROUTES.platformSubscriptions.path}/${row.tenantId}`)}>{t("详情 / 办理")}</Button> }
  ];

  return (
    <PageHeader
      title="租户订阅"
      description="按版本、状态、到期范围与租户筛选；进入详情可直接开通、升级、续期、临时延长、下期降级与功能授权。"
      extra={<Button type="primary" icon={<PlusOutlined />}>{t("直接为租户开通")}</Button>}
      view={
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap>
            <Segmented value={plan} onChange={(value) => setPlan(String(value))}
              options={[{ value: "all", label: t("全部") }, { value: "standard", label: t("基础版") }, { value: "pro", label: "PRO" }]} />
            <Select style={{ minWidth: 160 }} placeholder={t("服务状态")} allowClear value={serviceStatus} onChange={setServiceStatus}
              options={[
                { value: "active", label: t("有效") },
                { value: "expiring", label: t("即将到期") },
                { value: "expired", label: t("已到期") },
                { value: "pending_activation", label: t("待生效") },
                { value: "unconfigured", label: t("尚未配置") }
              ]} />
            <Select style={{ minWidth: 160 }} placeholder={t("到期范围")} allowClear value={dueWithin} onChange={setDueWithin}
              options={[{ value: "7", label: t("7 天内到期") }, { value: "30", label: t("30 天内到期") }, { value: "expired", label: t("已过期") }]} />
            <Input.Search style={{ minWidth: 220 }} allowClear placeholder={t("搜索租户名称 / 编码")} onSearch={setKeyword} />
          </Space>
          {query.isLoading ? <div style={{ textAlign: "center", padding: 48 }}><LoadingState /></div>
            : query.error ? <Alert type="error" showIcon message={t("租户订阅列表加载失败")} description={<Button size="small" onClick={() => query.refetch()}>{t("重试")}</Button>} />
            : <Card size="small" styles={{ body: { padding: 0 } }}><Table<TenantSubscriptionOverview> rowKey="tenantId" columns={columns} dataSource={query.data ?? []} pagination={{ pageSize: 20, hideOnSinglePage: true }} /></Card>}
        </Space>
      }
    />
  );
}
