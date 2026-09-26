import { RightOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Empty, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { NavigateFunction } from "react-router-dom";
import {
  SubscriptionPlan,
  SubscriptionRequestStatus,
  type SubscriptionRequestRecord,
  type SubscriptionRequestType,
  type TenantSubscriptionView
} from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { APP_ROUTES } from "@/app/navigation";
import {
  ENTITLEMENT_SOURCE_LABEL, PLAN_LABEL, RELEASE_STATUS_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE,
  REQUEST_TYPE_LABEL, SERVICE_STATUS_LABEL, formatMoney
} from "./subscriptionLabels";

/** §5.2 版本与订阅信息结构，由 TenantSubscriptionView 驱动。金额 null → 待确认/价格待公布（§14.2）。 */
export function TenantSubscriptionBody({ data, canManage, navigate }: { data: TenantSubscriptionView; canManage: boolean; navigate: NavigateFunction }) {
  const { t } = useLocale();
  const { overview, entitlements, standardPricing, requests, changeLog } = data;
  const openRequest = requests.find((row) => row.status === SubscriptionRequestStatus.Pending);
  const isPro = overview.plan === SubscriptionPlan.Pro;
  const requestPath = (id: string) => `${APP_ROUTES.subscription.path}/requests/${id}`;

  const requestColumns: ColumnsType<SubscriptionRequestRecord> = [
    { title: t("类型"), dataIndex: "type", key: "type", render: (value: SubscriptionRequestType) => t(REQUEST_TYPE_LABEL[value]) },
    { title: t("状态"), dataIndex: "status", key: "status", render: (value: SubscriptionRequestStatus) => <Tag color={REQUEST_STATUS_TONE[value]}>{t(REQUEST_STATUS_LABEL[value])}</Tag> },
    { title: t("办理金额"), key: "amount", render: (_, row) => t(formatMoney(row.handledAmount)) },
    { title: t("期间"), dataIndex: "periodText", key: "period", render: (value?: string) => value ?? t("—") },
    { title: t("操作"), key: "action", render: (_, row) => <Button type="link" style={{ paddingInline: 0 }} onClick={() => navigate(requestPath(row.id))}>{t("详情")}</Button> }
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      {!canManage && <Alert type="info" showIcon message={t("你可查看版本与到期摘要；升级、续费、降级等办理需订阅管理权限，请联系租户管理员或平台。")} />}

      <Card size="small" title={t("当前版本与服务")}>
        <Descriptions column={{ xs: 1, md: 2 }} size="small" colon={false} items={[
          { key: "tenant", label: t("租户"), children: `${overview.tenantName}（${overview.tenantCode}）` },
          { key: "plan", label: t("当前套餐版本"), children: <Tag color={isPro ? "gold" : "default"}>{t(PLAN_LABEL[overview.plan])}</Tag> },
          { key: "status", label: t("服务状态"), children: t(SERVICE_STATUS_LABEL[overview.serviceStatus]) },
          { key: "period", label: t("有效期"), children: overview.endAt ? `${overview.startAt ?? ""} ~ ${overview.endAt}${overview.timeZone ? `（${overview.timeZone}）` : ""}` : t("待平台确认") },
          { key: "amount", label: t("本期确认金额"), children: t(formatMoney(overview.currentAmount)) },
          { key: "handled", label: t("办理日期"), children: overview.handledAt ?? t("待确认") }
        ]} />
      </Card>

      <Card size="small" title={t("当前操作")}>
        <Space wrap>
          <Button onClick={() => navigate(APP_ROUTES.subscriptionPro.path)}>{t("了解 PRO")}<RightOutlined /></Button>
          {openRequest ? (
            <Button type="primary" onClick={() => navigate(requestPath(openRequest.id))}>{t("查看申请进度")}</Button>
          ) : (
            <>
              {!isPro && <Button type="primary" disabled={!canManage}>{t("升级 PRO")}</Button>}
              <Button disabled={!canManage}>{t("续费")}</Button>
              {isPro && <Button disabled={!canManage}>{t("申请下期基础版")}</Button>}
              <Button disabled={!canManage}>{t("到期不续费")}</Button>
            </>
          )}
        </Space>
      </Card>

      <Card size="small" title={t("当前功能权益与版本对比")}>
        {entitlements.length === 0 ? <Empty description={t("待平台确认")} /> : (
          <Descriptions column={1} size="small" colon={false} items={entitlements.map((feature) => ({
            key: feature.code,
            label: feature.name,
            children: `${t(ENTITLEMENT_SOURCE_LABEL[feature.source])} · ${t(RELEASE_STATUS_LABEL[feature.releaseStatus])}${feature.needsConfig ? t("（需配置）") : feature.available ? t("（可启用）") : ""}`
          }))} />
        )}
        <Button type="link" style={{ paddingInline: 0, marginTop: 8 }} onClick={() => navigate(APP_ROUTES.subscriptionPro.path)}>{t("查看 PRO 介绍与完整对比")}<RightOutlined /></Button>
      </Card>

      <Card size="small" title={t("标准套餐价与续费说明")}>
        <Descriptions column={{ xs: 1, md: 2 }} size="small" colon={false} items={standardPricing.map((price) => ({
          key: price.plan,
          label: t(PLAN_LABEL[price.plan]),
          children: price.published ? t(formatMoney(price.annualFee, "价格待公布")) : t("价格待公布")
        }))} />
        <Typography.Text type="secondary">{t("升级补差与外部费用另计，不代表已开通自动扣费。")}</Typography.Text>
      </Card>

      <Card size="small" title={t("申请与办理记录")}>
        {requests.length === 0 ? <Empty description={t("暂无申请记录")} /> : <Table<SubscriptionRequestRecord> rowKey="id" size="small" columns={requestColumns} dataSource={requests} pagination={false} />}
      </Card>

      <Card size="small" title={t("订阅变更记录")}>
        {changeLog.length === 0 ? <Empty description={t("暂无变更记录")} /> : (
          <Descriptions column={1} size="small" colon={false} items={changeLog.map((entry) => ({
            key: entry.id,
            label: `${entry.action}${entry.effectiveAt ? `（${entry.effectiveAt}）` : ""}`,
            children: entry.afterText ?? entry.reason ?? t("—")
          }))} />
        )}
      </Card>

      <Card size="small" title={t("待生效变更与退出说明")}>
        <Typography.Text type="secondary">
          {overview.next
            ? `${t("下一套餐")}：${t(PLAN_LABEL[overview.next.plan])}${overview.next.effectiveAt ? `，${overview.next.effectiveAt} ${t("生效")}` : ""}`
            : t("暂无待生效变更；到期不续费登记后当前已付费服务仍持续到到期。历史查询与数据保留按平台说明。")}
        </Typography.Text>
      </Card>
    </Space>
  );
}
