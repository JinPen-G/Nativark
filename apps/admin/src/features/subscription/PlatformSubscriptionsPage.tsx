import { PlusOutlined } from "@ant-design/icons";
import { Button, Card, Input, Segmented, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useLocale } from "@/app/locale";
import { APP_ROUTES } from "@/app/navigation";
import type { SubscriptionSummary } from "./subscriptionTypes";

/**
 * SUB-03 平台管理端「租户订阅」列表（需求 §8.1），路由 /platform/subscriptions。
 *
 * 静态骨架：筛选（版本 / 状态 / 到期范围 / 租户）+ 列表列位就绪，数据为空态；
 * 行进入详情办理。查询与直接办理接总控 SUB-01/03 契约（TODO）。SaaS 管理端页，
 * 路由已用 system:subscription:manage 门禁。
 */
type Row = Pick<SubscriptionSummary, "tenantName" | "tenantCode" | "edition" | "status"> & {
  id: string;
  endAt?: string;
  pendingRequests?: number;
  lastHandledText?: string;
};

export function PlatformSubscriptionsPage() {
  const { t } = useLocale();
  const navigate = useNavigate();

  const columns: ColumnsType<Row> = [
    { title: t("租户"), key: "tenant", render: (_, row) => `${row.tenantName}（${row.tenantCode}）` },
    { title: t("当前套餐"), dataIndex: "edition", key: "edition", render: (value: string) => <Tag>{t(value || "待确认")}</Tag> },
    { title: t("服务状态"), dataIndex: "status", key: "status", render: (value: string) => t(value || "待确认") },
    { title: t("统一截止"), dataIndex: "endAt", key: "endAt", render: (value?: string) => value ?? t("待平台确认") },
    { title: t("剩余天数"), key: "remaining", render: () => t("—") },
    { title: t("待处理申请"), dataIndex: "pendingRequests", key: "pending", render: (value?: number) => value ?? 0 },
    { title: t("最近办理"), dataIndex: "lastHandledText", key: "last", render: (value?: string) => value ?? t("—") },
    { title: t("操作"), key: "action", render: (_, row) => <Button type="link" style={{ paddingInline: 0 }} onClick={() => navigate(`${APP_ROUTES.platformSubscriptions.path}/${row.id}`)}>{t("详情 / 办理")}</Button> }
  ];

  return (
    <PageHeader
      title="租户订阅"
      description="按版本、状态、到期范围与租户筛选；进入详情可直接开通、升级、续期、临时延长、下期降级与功能授权。"
      extra={<Button type="primary" icon={<PlusOutlined />}>{t("直接为租户开通")}</Button>}
      view={
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap>
            <Segmented options={[t("全部"), t("基础版"), t("PRO")]} />
            <Select style={{ minWidth: 160 }} placeholder={t("服务状态")} allowClear
              options={[
                { value: "active", label: t("有效") },
                { value: "expiring", label: t("即将到期") },
                { value: "expired", label: t("已到期") },
                { value: "scheduled", label: t("已安排续费/降级") },
                { value: "unconfigured", label: t("尚未配置") }
              ]} />
            <Select style={{ minWidth: 160 }} placeholder={t("到期范围")} allowClear
              options={[{ value: "7", label: t("7 天内到期") }, { value: "30", label: t("30 天内到期") }, { value: "expired", label: t("已过期") }]} />
            <Input.Search style={{ minWidth: 220 }} allowClear placeholder={t("搜索租户名称 / 编码")} />
          </Space>
          {/* TODO(SUB-01/03)：接只读列表查询 + 加载/错误反馈（LoadingState / Alert），当前为空态骨架。 */}
          <Card size="small" styles={{ body: { padding: 0 } }}>
            <Table<Row> rowKey="id" columns={columns} dataSource={[]} pagination={{ pageSize: 20, hideOnSinglePage: true }} />
          </Card>
        </Space>
      }
    />
  );
}
