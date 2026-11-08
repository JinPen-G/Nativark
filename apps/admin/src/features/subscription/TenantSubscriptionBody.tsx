import { RightOutlined } from "@/components/ui/icons";
import { useState } from "react";
import { Space, Tag, Typography } from "antd";
import { DataTableText, ListFilters, ListSection, Empty, Tabs, useListFilter } from "@/components/ui";
import { RecordFacts } from "@/components/RecordDetailLayout";
import styles from "./TenantSubscription.module.css";
import { Alert, Table } from "@/components/ui";
import { Button } from "@/components/ui";
import type { ColumnsType } from "antd/es/table";
import type { NavigateFunction } from "react-router-dom";
import {
  SubscriptionPlan,
  SubscriptionRequestStatus,
  SubscriptionRequestType,
  type SubscriptionRequestRecord,
  type TenantSubscriptionView
} from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { SubscriptionRequestModal } from "./SubscriptionRequestModal";
import { APP_ROUTES } from "@/app/navigation";
import {
  ENTITLEMENT_SOURCE_LABEL, PLAN_LABEL, RELEASE_STATUS_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE,
  REQUEST_TYPE_LABEL, SERVICE_STATUS_LABEL, formatMoney, formatSubscriptionDate
} from "./subscriptionLabels";

/** §5.2 版本与订阅信息结构，由 TenantSubscriptionView 驱动。金额 null → 待确认/价格待公布（§14.2）。 */
export function TenantSubscriptionBody({ data, canManage, navigate }: { data: TenantSubscriptionView; canManage: boolean; navigate: NavigateFunction }) {
  const { t } = useLocale();
  const [requestType, setRequestType] = useState<SubscriptionRequestType | null>(null);
  const { overview, entitlements, standardPricing, requests, changeLog } = data;
  const featureFilter = useListFilter(entitlements, { fields: feature => [feature.name, feature.code, feature.valueText], status: feature => feature.releaseStatus });
  const isPro = overview.plan === SubscriptionPlan.Pro;
  const requestPath = (id: string) => `${APP_ROUTES.subscription.path}/requests/${encodeURIComponent(id)}`;
  const requestButton = (type: SubscriptionRequestType, label: string, primary = false) => {
    const pending = requests.find((row) => row.status === SubscriptionRequestStatus.Pending && row.type === type);
    return <Button type={primary ? "primary" : "default"} disabled={!canManage} onClick={() => pending ? navigate(requestPath(pending.id)) : setRequestType(type)}>{pending ? `${t(label)} · ${t("查看申请进度")}` : t(label)}</Button>;
  };

  const requestColumns: ColumnsType<SubscriptionRequestRecord> = [
    { title: t("申请"), key: "type", render: (_, row) => <DataTableText primary={t(REQUEST_TYPE_LABEL[row.type])} secondary={formatSubscriptionDate(row.submittedAt, overview.timeZone, t)} /> },
    { title: t("状态"), dataIndex: "status", key: "status", render: (value: SubscriptionRequestStatus) => <Tag color={REQUEST_STATUS_TONE[value]}>{t(REQUEST_STATUS_LABEL[value])}</Tag> },
    { title: t("办理金额"), key: "amount", render: (_, row) => t(formatMoney(row.handledAmount)) },
    { title: t("期间"), dataIndex: "periodText", key: "period", render: (value?: string) => value ?? t("—") },
    { title: t("操作"), key: "action", render: (_, row) => <Button type="link" style={{ paddingInline: 0 }} onClick={() => navigate(requestPath(row.id))}>{t("详情")}</Button> }
  ];

  return (
    <div className={styles.stack}>
      {!canManage && <Alert type="info" showIcon message={t("你可查看版本与到期摘要；升级、续费、降级等办理需订阅管理权限，请联系租户管理员或平台。")} />}

      <section className={styles.summary} aria-label={t("当前版本与服务")}>
        <div className={styles.identity}><strong>{t(PLAN_LABEL[overview.plan])}</strong><Tag color={overview.serviceStatus === "active" ? "success" : "default"}>{t(SERVICE_STATUS_LABEL[overview.serviceStatus])}</Tag></div>
        <RecordFacts items={[
          { key: "tenant", label: "租户", value: `${overview.tenantName}（${overview.tenantCode}）` },
          { key: "period", label: "有效期 [开始, 截止)", value: !overview.startAt && !overview.endAt ? t("待平台确认") : `${formatSubscriptionDate(overview.startAt, overview.timeZone, t)} ~ ${formatSubscriptionDate(overview.endAt, overview.timeZone, t)}` },
          { key: "amount", label: "本期确认金额", value: t(formatMoney(overview.currentAmount)) },
          { key: "handled", label: "办理日期", value: formatSubscriptionDate(overview.handledAt, overview.timeZone, t) }
        ]} />
        <Space wrap className={styles.actions}>
          <Button onClick={() => navigate(APP_ROUTES.subscriptionPro.path)}>{t("版本对比")}<RightOutlined /></Button>
          {!isPro && requestButton(SubscriptionRequestType.UpgradeConsult, "升级咨询", true)}
          {requestButton(isPro ? SubscriptionRequestType.RenewPro : SubscriptionRequestType.RenewStandard, "续费")}
          {isPro && requestButton(SubscriptionRequestType.NextStandard, "申请下期基础版")}
          {requestButton(SubscriptionRequestType.NoRenew, "到期不续费")}
        </Space>
      </section>
      {overview.next && <Alert type="info" showIcon title={`${t("下一套餐")}：${t(PLAN_LABEL[overview.next.plan])}${overview.next.effectiveAt ? ` · ${formatSubscriptionDate(overview.next.effectiveAt, overview.timeZone, t)} ${t("生效")}` : ""}`} />}
      <Tabs aria-label={t("版本与订阅")} items={[
        { key: "overview", label: t("概览"), children: <div className={styles.stack}>
          <ListSection title={t("申请与办理记录")}>
            <Table<SubscriptionRequestRecord> rowKey="id" size="small" columns={requestColumns} dataSource={requests} pagination={{ defaultPageSize: 20 }} locale={{ emptyText: t("暂无申请记录") }} />
          </ListSection>
          <ListSection title={t("标准套餐价与续费说明")}>
            <RecordFacts items={standardPricing.map((price) => ({
              key: price.plan, label: t(PLAN_LABEL[price.plan]), value: price.published ? t(formatMoney(price.annualFee, "价格待公布")) : t("价格待公布")
            }))} />
            <Typography.Text type="secondary">{t("升级补差与外部费用另计，不代表已开通自动扣费。")}</Typography.Text>
          </ListSection>
        </div> },
        { key: "features", label: t("功能权益"), children: <ListSection title={t("当前功能权益与版本对比")}
          controls={entitlements.length > 0 ? <ListFilters filter={featureFilter} placeholder="功能名称、编码或说明" statusLabel="交付状态" options={Object.entries(RELEASE_STATUS_LABEL).map(([value, label]) => ({ value, label }))} /> : undefined}>
        {entitlements.length === 0 ? <Empty description={t("待平台确认")} /> : (
          <Table rowKey="code" dataSource={featureFilter.rows} pagination={featureFilter.pagination} columns={[
            { title: t("功能"), render: (_, feature) => <DataTableText primary={feature.name} secondary={feature.valueText || feature.code} /> },
            { title: t("权益来源"), render: (_, feature) => t(ENTITLEMENT_SOURCE_LABEL[feature.source]) },
            { title: t("交付状态"), render: (_, feature) => <DataTableText primary={t(RELEASE_STATUS_LABEL[feature.releaseStatus])} secondary={feature.needsConfig ? t("需配置") : feature.available ? t("可启用") : t("当前不可启用")} /> },
            { title: t("外部费用"), dataIndex: "externalFeeNote", render: value => value || "—" },
          ]} />
        )}
        <Button type="link" style={{ paddingInline: 0, alignSelf: "start" }} onClick={() => navigate(APP_ROUTES.subscriptionPro.path)}>{t("查看 PRO 介绍与完整对比")}<RightOutlined /></Button>
        </ListSection> },
        { key: "history", label: t("订阅变更记录"), children: <ListSection>
        {changeLog.length === 0 ? <Empty description={t("暂无变更记录")} /> : (
          <Table rowKey="id" dataSource={changeLog} pagination={{ defaultPageSize: 20 }} columns={[
            { title: t("变更"), render: (_, entry) => <DataTableText primary={t(entry.action)} secondary={formatSubscriptionDate(entry.operatedAt, overview.timeZone, t)} /> },
            { title: t("生效时间"), dataIndex: "effectiveAt", render: value => formatSubscriptionDate(value, overview.timeZone, t) },
            { title: t("变更前"), dataIndex: "beforeText", render: value => value || "—" },
            { title: t("变更后"), dataIndex: "afterText", render: value => value || "—" },
            { title: t("原因"), dataIndex: "reason", render: value => value || "—" },
          ]} />
        )}
        </ListSection> }
      ]} />
      <SubscriptionRequestModal open={requestType !== null} type={requestType} onClose={() => setRequestType(null)} />
    </div>
  );
}
